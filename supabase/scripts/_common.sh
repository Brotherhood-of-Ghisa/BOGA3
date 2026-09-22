#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/worktree-lib.sh"

# Fail hard without this worktree's slot lease (docs/specs/12): nothing here
# sets one up or repairs config on the fly — `./boga worktree start` does.
boga_require_slot_lease "${REPO_ROOT}" || exit 1

require_worktree_runtime_config() {
  local template_file="${SUPABASE_DIR}/config.toml.template"
  local config_file="${SUPABASE_DIR}/config.toml"

  if [[ ! -f "${config_file}" ]]; then
    echo "[supabase] ${config_file} is missing; run ./boga worktree start" >&2
    exit 1
  fi
  if [[ -f "${template_file}" && "${template_file}" -nt "${config_file}" ]]; then
    echo "[supabase] ${config_file} is older than its template; run ./boga worktree start" >&2
    exit 1
  fi
}

require_worktree_runtime_config

WORKTREE_SLOT="$(boga_read_slot_file "${REPO_ROOT}")"
export WORKTREE_SLOT

# Resolve before sourcing the override file below: it may also assign
# SUPABASE_CLI_VERSION, and an explicit caller env value must still win.
resolved_supabase_cli_version="$(boga_supabase_cli_version "${REPO_ROOT}")"

if [[ -f "${SUPABASE_DIR}/.env.local" ]]; then
  # Script-only overrides (CLI version, optional local toggles).
  # shellcheck disable=SC1091
  source "${SUPABASE_DIR}/.env.local"
elif declare -F boga_config_root >/dev/null 2>&1 && [[ -f "$(boga_config_root)/supabase/cli.env" ]]; then
  # shellcheck disable=SC1091
  source "$(boga_config_root)/supabase/cli.env"
fi

SUPABASE_CLI_VERSION="${resolved_supabase_cli_version}"
FUNCTIONS_PID_FILE="${SUPABASE_DIR}/.temp/health-functions-serve.pid"
FUNCTIONS_LOG_FILE="${SUPABASE_DIR}/.temp/health-functions-serve.log"
FUNCTION_ENV_FILE="${SUPABASE_DIR}/functions/.env.local"

ensure_tmp_dir() {
  mkdir -p "${SUPABASE_DIR}/.temp"
}

# When BOGA_SUPABASE_WORKDIR is set, every `supabase` call targets that project
# directory instead of this worktree's default (slot-0) stack. This is how the
# dedicated dev stack (project_id BOGA-dev, see supabase/scripts/dev-stack-lib.sh)
# reuses all of these helpers — load_supabase_status_env, the up/down/reset
# scripts, auth provisioning — against a second, isolated Supabase without a
# parallel copy of this machinery. Unset (the default), everything targets the
# gate stack exactly as before.
require_supported_supabase_cli() {
  boga_version_at_least "${SUPABASE_CLI_VERSION}" "${BOGA_SUPABASE_CLI_MIN_VERSION}" && return 0
  cat >&2 <<EOF
[supabase] Supabase CLI ${SUPABASE_CLI_VERSION} is below the supported minimum ${BOGA_SUPABASE_CLI_MIN_VERSION}.
[supabase] Older CLIs fetch deno.land on every edge-runtime start, so 'supabase start' fails with "Error status 502" when deno.land is unreachable.
[supabase] Remove or raise SUPABASE_CLI_VERSION in $(boga_config_root)/supabase/cli.env (repo default: ${BOGA_SUPABASE_CLI_DEFAULT_VERSION}); ./boga doctor checks this.
EOF
  return 1
}

run_supabase() {
  require_supported_supabase_cli || return 1
  (
    cd "${REPO_ROOT}"
    if [[ -n "${BOGA_SUPABASE_WORKDIR:-}" ]]; then
      npx -y "supabase@${SUPABASE_CLI_VERSION}" --workdir "${BOGA_SUPABASE_WORKDIR}" "$@"
    else
      npx -y "supabase@${SUPABASE_CLI_VERSION}" "$@"
    fi
  )
}

# Read the active Supabase project_id from config.toml. Honors
# BOGA_SUPABASE_WORKDIR so the dev stack resolves to BOGA-dev, not the slot-0 id.
# Echoes the id (empty string if config.toml is absent or has no project_id).
worktree_project_id() {
  local config_file="${SUPABASE_DIR}/config.toml"
  [[ -n "${BOGA_SUPABASE_WORKDIR:-}" ]] && config_file="${BOGA_SUPABASE_WORKDIR}/supabase/config.toml"
  [[ -f "${config_file}" ]] || return 0
  awk -F'"' '/^project_id[[:space:]]*=/ {print $2; exit}' "${config_file}" || true
}

# Read a [section] port from this worktree's config.toml (e.g. `db`, `api`).
# Echoes the port, or an empty string when config.toml or the key is absent.
worktree_config_port() {
  local section="$1"
  local config_file="${SUPABASE_DIR}/config.toml"
  [[ -n "${BOGA_SUPABASE_WORKDIR:-}" ]] && config_file="${BOGA_SUPABASE_WORKDIR}/supabase/config.toml"
  [[ -f "${config_file}" ]] || return 0
  awk -v section="[${section}]" '
    $0 == section { in_section = 1; next }
    /^\[/ { in_section = 0 }
    in_section && $1 == "port" {
      value = $0
      sub(/^[^=]+=[[:space:]]*/, "", value)
      gsub(/[" ]/, "", value)
      print value
      exit
    }
  ' "${config_file}" || true
}

# The Supabase CLI caps `project_id` at SUPABASE_CLI_PROJECT_ID_LIMIT characters
# (defined in scripts/worktree-lib.sh) and silently rewrites a longer one on
# every invocation, so a worktree whose derived id is longer runs containers
# named for a *prefix* of what config.toml says. An exact-name lookup then finds
# nothing while the stack sits there perfectly healthy.
#
# Matching the truncation is not enough on its own. The id ends in the slot
# number, which is exactly what the cut removes, so two worktrees whose names
# agree in their first 35-odd characters truncate to the SAME container name —
# and this repo's parallel plans produce sibling worktrees of exactly that
# shape. Binding a foreign worktree's Postgres is the failure `resolve_db_container`
# exists to prevent, and it is silent: the suite runs green against another
# worktree's data.
#
# So the truncated candidate must prove it belongs to THIS worktree before it is
# accepted. Ports are allocated per slot and written into config.toml, so the
# published host port is a discriminator the truncated name has lost. The exact
# name needs no such proof — nothing else can carry it.

# Does ${container} publish ${want_port} on the host?
container_publishes_host_port() {
  local container="$1" want_port="$2"

  # An empty port must never match: the real --format output contains empty
  # tokens for unpublished ports, and `grep -Fxq ""` would match one.
  [[ -n "${want_port}" ]] || return 1

  docker inspect "${container}" \
    --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}' \
    2>/dev/null | tr ' ' '\n' | grep -Fxq "${want_port}"
}

# resolve_worktree_container <service> <project_id> <expected_host_port>
#
# Echoes the container name for this worktree's <service> and returns 0.
# Returns 1 when no candidate is running at all, and 2 when a candidate matched
# by name but was REFUSED because it is not this slot's — the two need different
# advice, so callers must not collapse them. <expected_host_port> is this
# worktree's slot-allocated port for that service, from config.toml.
resolve_worktree_container() {
  local service="$1" project_id="$2" expected_port="$3"
  local exact truncated

  exact="supabase_${service}_${project_id}"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "${exact}"; then
    printf '%s\n' "${exact}"
    return 0
  fi

  truncated="supabase_${service}_${project_id:0:SUPABASE_CLI_PROJECT_ID_LIMIT}"
  if [[ "${truncated}" != "${exact}" ]] &&
    docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "${truncated}"; then
    if [[ -n "${expected_port}" ]] && container_publishes_host_port "${truncated}" "${expected_port}"; then
      printf '%s\n' "${truncated}"
      return 0
    fi
    echo "[resolve_worktree_container] refusing '${truncated}': it matches this" \
         "worktree's truncated project_id but does not publish this slot's" \
         "${service} port ${expected_port:-<unset>}." >&2
    echo "[resolve_worktree_container] that means it is another worktree's stack, or" \
         "this worktree's stack is not fully up. Either way, binding it would run" \
         "against the wrong database. Check \`./boga worktree doctor\`." >&2
    return 2
  fi

  return 1
}

# Resolve the Postgres container for THIS worktree's Supabase stack.
#
# This host runs multiple worktree Supabase stacks at once, so a name match
# MUST be scoped to this worktree's project_id. An unscoped
# `grep '^supabase_db_' | head -n1` can select a FOREIGN worktree's database,
# producing fixture-owner UUID mismatches and spurious FK errors. We therefore
# resolve strictly through `resolve_worktree_container` — this worktree's
# project_id, or the one truncation Docker itself applies to it — and ERROR (no
# fallback) if no such container is running.
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
         "run ./boga worktree start to generate this worktree's config." >&2
    return 1
  fi

  local container rc=0
  container="$(resolve_worktree_container db "${project_id}" "$(worktree_config_port db)")" || rc=$?

  # Refused (2): a container matched by name but is not this slot's. It already
  # said so, and telling the operator to "start the stack" would be wrong —
  # a stack IS up, it just isn't theirs. The fix is a shorter worktree name.
  if (( rc == 2 )); then
    return 1
  fi

  if (( rc != 0 )); then
    echo "[resolve_db_container] no running container named 'supabase_db_${project_id}'" \
         "for this worktree (project_id='${project_id}')." >&2
    echo "[resolve_db_container] running supabase db containers:" >&2
    docker ps --format '{{.Names}}' 2>/dev/null | grep '^supabase_db_' >&2 || echo "[resolve_db_container]   (none)" >&2
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
