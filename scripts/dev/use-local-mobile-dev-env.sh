#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/worktree-lib.sh"
boga_require_slot_lease "${REPO_ROOT}" || exit 1

slot="$(boga_read_slot_file "${REPO_ROOT}")" || {
  echo "[supabase] missing .worktree-slot file; run ./boga worktree start first" >&2
  exit 1
}
if [[ "${slot}" != "0" ]]; then
  slot_api_port="$(boga_port_for_slot api "${slot}")"
  echo "[supabase] 'boga env dev' targets the main checkout's dedicated BOGA-dev stack (slot 0 only)." >&2
  echo "[supabase] Linked worktrees (slot ${slot}) must use their own isolated slot stack (API port ${slot_api_port})." >&2
  echo "[supabase] Boot your worktree's stack with './boga db up' (which automatically configures apps/mobile/.env.local)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${REPO_ROOT}/supabase/scripts/_common.sh"
# shellcheck disable=SC1091
source "${REPO_ROOT}/supabase/scripts/dev-stack-lib.sh"

MOBILE_ENV_FILE="${REPO_ROOT}/apps/mobile/.env.local"

rewrite_mobile_supabase_env() {
  local dev_url="$1"
  local tmp_file

  if [[ ! -d "$(dirname "${MOBILE_ENV_FILE}")" ]]; then
    echo "[supabase] mobile app directory not found: $(dirname "${MOBILE_ENV_FILE}")" >&2
    exit 1
  fi

  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' EXIT

  if [[ -f "${MOBILE_ENV_FILE}" ]]; then
    awk '!/^EXPO_PUBLIC_SUPABASE_URL=|^EXPO_PUBLIC_SUPABASE_ANON_KEY=/' "${MOBILE_ENV_FILE}" >"${tmp_file}"
  fi

  {
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${dev_url}"
    printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  } >>"${tmp_file}"

  mv "${tmp_file}" "${MOBILE_ENV_FILE}"
  trap - EXIT
}

# Target the dedicated dev stack (BOGA-dev) and ensure its baseline (boots if down, seeds human accounts)
engage_dev_stack
dev_stack_assert_engaged

echo "[supabase] ensuring dev DB baseline (BOGA-dev on port 65431)"
"${REPO_ROOT}/supabase/scripts/ensure-dev-baseline.sh"

load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "[supabase] missing local Supabase API_URL or ANON_KEY after startup" >&2
  exit 1
fi

rewrite_mobile_supabase_env "${API_URL}"

echo "[supabase] switched mobile Supabase env to local DEV stack: ${MOBILE_ENV_FILE}"
echo "[supabase] url: ${API_URL}"
echo "[supabase] restart Expo/Metro so EXPO_PUBLIC_* values are rebundled"
