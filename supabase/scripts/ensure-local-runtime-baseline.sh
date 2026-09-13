#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

LOCK_DIR="${SUPABASE_DIR}/.temp/runtime-baseline.lock"
LOCK_TIMEOUT_SECONDS="${SUPABASE_BASELINE_LOCK_TIMEOUT_SECONDS:-120}"
LOCK_POLL_SECONDS="${SUPABASE_BASELINE_LOCK_POLL_SECONDS:-1}"

release_lock() {
  if [[ -d "${LOCK_DIR}" ]]; then
    rm -f "${LOCK_DIR}/owner.pid" "${LOCK_DIR}/created_at"
    rmdir "${LOCK_DIR}" 2>/dev/null || true
  fi
}

acquire_lock() {
  ensure_tmp_dir

  local started_at now holder
  started_at="$(date +%s)"

  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    now="$(date +%s)"

    if (( now - started_at >= LOCK_TIMEOUT_SECONDS )); then
      holder="unknown"
      if [[ -f "${LOCK_DIR}/owner.pid" ]]; then
        holder="$(cat "${LOCK_DIR}/owner.pid" 2>/dev/null || echo "unknown")"
      fi
      echo "[supabase] timed out waiting for baseline lock (${LOCK_TIMEOUT_SECONDS}s). Holder: ${holder}" >&2
      exit 1
    fi

    sleep "${LOCK_POLL_SECONDS}"
  done

  printf '%s\n' "$$" >"${LOCK_DIR}/owner.pid"
  printf '%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"${LOCK_DIR}/created_at"
  trap release_lock EXIT
}

load_supabase_status_env_if_available() {
  local output line key value

  output="$(run_supabase status -o env 2>/dev/null)" || return 1

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
  done <<<"${output}"

  return 0
}

runtime_rest_api_reachable() {
  [[ -n "${API_URL:-}" ]] || return 1
  [[ -n "${ANON_KEY:-}" ]] || return 1

  curl --silent --show-error --fail \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    "${API_URL}/rest/v1/dev_fixture_principals?select=fixture_key&limit=1" \
    >/dev/null 2>&1
}

# <function dir> <probe path under /functions/v1>: neither probe ever answers 404
# once its function is served (agent-api → 401, group-eval GET → 405).
FUNCTION_ROUTE_PROBES=(
  "agent-api agent-api/v1/agent/session"
  "group-eval group-eval"
)

ensure_function_routes_registered() {
  local probe name path status missing=""
  for probe in "${FUNCTION_ROUTE_PROBES[@]}"; do
    name="${probe%% *}"
    path="${probe#* }"
    [[ -d "${SUPABASE_DIR}/functions/${name}" ]] || continue
    status="$(
      curl --silent --output /dev/null --write-out '%{http_code}' \
        --max-time 5 \
        -H "apikey: ${ANON_KEY}" \
        "${API_URL}/functions/v1/${path}" \
        2>/dev/null || true
    )"
    [[ "${status}" == "404" ]] && missing="${missing} ${name}"
  done

  [[ -n "${missing}" ]] || return 0

  # The local Edge Runtime snapshots function directories when its container is
  # created. Recreate only this worktree's stack when a checkout adds a function
  # after the runtime was already running; database volumes remain intact.
  echo "[supabase]${missing} absent from the running Edge Runtime; refreshing function routing"
  run_supabase stop >/dev/null
  "${SCRIPT_DIR}/local-runtime-up.sh"
  load_supabase_status_env
}

apply_pending_local_migrations() {
  echo "[supabase] applying pending local migrations"
  run_supabase db push --local --include-all --yes >/dev/null
}

ensure_runtime_and_baseline() {
  local runtime_was_running=0

  if load_supabase_status_env_if_available && runtime_rest_api_reachable; then
    runtime_was_running=1
    echo "[supabase] local runtime already running; reusing existing instance without reset"
  else
    echo "[supabase] local runtime unavailable; starting and bootstrapping baseline"
    "${SCRIPT_DIR}/local-runtime-up.sh"
    "${SCRIPT_DIR}/reset-local.sh"
    load_supabase_status_env
  fi

  ensure_function_routes_registered
  apply_pending_local_migrations

  # The group evaluator's pg_net kick needs this stack's in-network URL (Vault;
  # a db reset clears it). Idempotent.
  "${SCRIPT_DIR}/group-eval-configure.sh"

  if ! "${SCRIPT_DIR}/smoke-seed.sh"; then
    if (( runtime_was_running == 1 )); then
      echo "[supabase] existing runtime is missing required baseline seed fixtures." >&2
      echo "[supabase] run ./supabase/scripts/reset-local.sh once, or restart the local stack, then retry." >&2
    fi
    exit 1
  fi

  echo "[supabase] ensuring deterministic auth fixtures"
  "${SCRIPT_DIR}/auth-provision-local-fixtures.sh"

  echo "[supabase] verifying baseline fixtures after auth provisioning"
  "${SCRIPT_DIR}/smoke-seed.sh"

  echo "[supabase] local runtime baseline ready"
}

acquire_lock
ensure_runtime_and_baseline
