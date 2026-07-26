#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

ensure_tmp_dir

if [[ -x "${REPO_ROOT}/scripts/worktree-sweep.sh" ]]; then
  echo "[supabase] sweeping completed worktree Supabase infra before startup"
  "${REPO_ROOT}/scripts/worktree-sweep.sh" --current-slot "${WORKTREE_SLOT:-0}" \
    || echo "[supabase] warning: worktree sweep failed; continuing current runtime startup" >&2
fi

sync_mobile_supabase_env() {
  local mobile_dir="${REPO_ROOT}/apps/mobile"
  local env_file="${mobile_dir}/.env.local"
  local tmp_file

  if [[ ! -d "${mobile_dir}" ]]; then
    echo "[supabase] skipping mobile env sync: ${mobile_dir} not found"
    return 0
  fi

  tmp_file="$(mktemp)"

  if [[ -f "${env_file}" ]]; then
    awk '!/^EXPO_PUBLIC_SUPABASE_URL=|^EXPO_PUBLIC_SUPABASE_ANON_KEY=/' "${env_file}" >"${tmp_file}"
  fi

  {
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${API_URL}"
    printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  } >>"${tmp_file}"

  mv "${tmp_file}" "${env_file}"
  echo "[supabase] synced mobile Supabase env: ${env_file}"
}

echo "[supabase] starting local stack (CLI ${SUPABASE_CLI_VERSION})"
run_supabase start

load_supabase_status_env
HEALTH_URL="$(health_url)"

stop_functions_serve_if_running

echo "[supabase] starting local edge function server"
if [[ -f "${FUNCTION_ENV_FILE}" ]]; then
  (
    cd "${REPO_ROOT}"
    nohup npx -y "supabase@${SUPABASE_CLI_VERSION}" functions serve \
      --no-verify-jwt \
      --env-file "${FUNCTION_ENV_FILE}" \
      >"${FUNCTIONS_LOG_FILE}" 2>&1 &
    echo $! > "${FUNCTIONS_PID_FILE}"
  )
else
  (
    cd "${REPO_ROOT}"
    nohup npx -y "supabase@${SUPABASE_CLI_VERSION}" functions serve \
      --no-verify-jwt \
      >"${FUNCTIONS_LOG_FILE}" 2>&1 &
    echo $! > "${FUNCTIONS_PID_FILE}"
  )
fi

START_TS="$(date +%s)"
until curl_health --max-time 2 >/dev/null; do
  NOW_TS="$(date +%s)"
  if (( NOW_TS - START_TS >= 45 )); then
    echo "Timed out waiting for health endpoint: ${HEALTH_URL}" >&2
    if [[ -f "${FUNCTIONS_LOG_FILE}" ]]; then
      echo "--- functions log tail ---" >&2
      tail -n 40 "${FUNCTIONS_LOG_FILE}" >&2 || true
    fi
    exit 1
  fi
  sleep 1
done

sync_mobile_supabase_env

echo "[supabase] local runtime ready"
echo "  api: ${API_URL}"
echo "  health: ${HEALTH_URL}"
echo "  functions log: ${FUNCTIONS_LOG_FILE}"
