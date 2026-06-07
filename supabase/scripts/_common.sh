#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/scripts/worktree-lib.sh" ]]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/scripts/worktree-lib.sh"
  boga_validate_worktree_placement "${REPO_ROOT}" || exit 1
fi

ensure_worktree_runtime_config() {
  local setup_script="${REPO_ROOT}/scripts/worktree-setup.sh"
  local template_file="${SUPABASE_DIR}/config.toml.template"
  local config_file="${SUPABASE_DIR}/config.toml"

  if [[ ! -x "${setup_script}" ]]; then
    [[ -f "${config_file}" ]] || {
      echo "supabase/config.toml not found and ${setup_script} is unavailable." >&2
      exit 1
    }
    return 0
  fi

  if [[ ! -f "${REPO_ROOT}/.worktree-slot" ]]; then
    "${setup_script}" >/dev/null
    return 0
  fi

  if [[ -f "${template_file}" ]]; then
    if [[ ! -f "${config_file}" ]]; then
      echo "[supabase] config.toml missing; regenerating from template" >&2
      "${setup_script}" --generate-config-only
    elif [[ "${template_file}" -nt "${config_file}" ]]; then
      echo "[supabase] config.toml.template is newer; regenerating config.toml" >&2
      "${setup_script}" --generate-config-only
    fi
  elif [[ ! -f "${config_file}" ]]; then
    echo "supabase/config.toml not found and no config.toml.template exists. Run ./scripts/worktree-setup.sh." >&2
    exit 1
  fi
}

ensure_worktree_runtime_config

if declare -F boga_worktree_slot_or_default >/dev/null 2>&1; then
  WORKTREE_SLOT="$(boga_worktree_slot_or_default "${REPO_ROOT}")"
else
  WORKTREE_SLOT=0
fi
export WORKTREE_SLOT

if [[ -f "${SUPABASE_DIR}/.env.local" ]]; then
  # Script-only overrides (CLI version, optional local toggles).
  # shellcheck disable=SC1091
  source "${SUPABASE_DIR}/.env.local"
elif declare -F boga_config_root >/dev/null 2>&1 && [[ -f "$(boga_config_root)/supabase/cli.env" ]]; then
  # shellcheck disable=SC1091
  source "$(boga_config_root)/supabase/cli.env"
fi

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.76.15}"
FUNCTIONS_PID_FILE="${SUPABASE_DIR}/.temp/health-functions-serve.pid"
FUNCTIONS_LOG_FILE="${SUPABASE_DIR}/.temp/health-functions-serve.log"
FUNCTION_ENV_FILE="${SUPABASE_DIR}/functions/.env.local"

ensure_tmp_dir() {
  mkdir -p "${SUPABASE_DIR}/.temp"
}

run_supabase() {
  (
    cd "${REPO_ROOT}"
    npx -y "supabase@${SUPABASE_CLI_VERSION}" "$@"
  )
}

# Read this worktree's Supabase project_id from supabase/config.toml.
# Echoes the id (empty string if config.toml is absent or has no project_id).
worktree_project_id() {
  local config_file="${SUPABASE_DIR}/config.toml"
  [[ -f "${config_file}" ]] || return 0
  awk -F'"' '/^project_id[[:space:]]*=/ {print $2; exit}' "${config_file}" || true
}

# Resolve the Postgres container for THIS worktree's Supabase stack.
#
# This host runs multiple worktree Supabase stacks at once, so a name match
# MUST be scoped to this worktree's project_id. An unscoped
# `grep '^supabase_db_' | head -n1` can select a FOREIGN worktree's database,
# producing fixture-owner UUID mismatches and spurious FK errors. We therefore
# match strictly on `supabase_db_${project_id}` and ERROR (no fallback) if that
# exact container is not running.
#
# On success: echoes the container name and returns 0.
# On failure: prints a clear diagnostic to stderr and returns 1.
resolve_db_container() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[resolve_db_container] docker is not available on PATH." >&2
    return 1
  fi

  local project_id
  project_id="$(worktree_project_id)"
  if [[ -z "${project_id}" ]]; then
    echo "[resolve_db_container] could not read project_id from ${SUPABASE_DIR}/config.toml;" \
         "run ./scripts/worktree-setup.sh to generate this worktree's config." >&2
    return 1
  fi

  local container
  # Exact, anchored match on this worktree's project_id. The container name is
  # `supabase_db_<project_id>`; project_id is unique per worktree, so this never
  # matches a foreign stack. No unscoped head -n1 fallback.
  container="$(docker ps --format '{{.Names}}' 2>/dev/null \
    | grep -F "supabase_db_${project_id}" \
    | head -n1 || true)"

  if [[ -z "${container}" ]]; then
    echo "[resolve_db_container] no running container named 'supabase_db_${project_id}'" \
         "for this worktree (project_id='${project_id}')." >&2
    echo "[resolve_db_container] this worktree's local Supabase stack is not up." \
         "Start it with ./supabase/scripts/ensure-local-runtime-baseline.sh" \
         "(or local-runtime-up.sh). NOT falling back to a foreign stack." >&2
    return 1
  fi

  printf '%s\n' "${container}"
  return 0
}

load_supabase_status_env() {
  local line key value
  local output
  output="$(run_supabase status -o env)"

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" =~ ^[A-Z0-9_]+$ ]] || continue
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value#\"}"
      value="${value%\"}"
    fi
    export "${key}=${value}"
  done <<< "${output}"
}

health_url() {
  if [[ -z "${API_URL:-}" ]]; then
    load_supabase_status_env
  fi
  printf '%s/functions/v1/health' "${API_URL}"
}

curl_health() {
  local url
  url="$(health_url)"

  curl --silent --show-error --fail \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    "$@" \
    "${url}"
}

functions_pid_is_running() {
  [[ -f "${FUNCTIONS_PID_FILE}" ]] || return 1

  local pid
  pid="$(cat "${FUNCTIONS_PID_FILE}")"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null
}

stop_functions_serve_if_running() {
  if functions_pid_is_running; then
    local pid
    pid="$(cat "${FUNCTIONS_PID_FILE}")"
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  fi
  rm -f "${FUNCTIONS_PID_FILE}"
}
