#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

MOBILE_ENV_FILE="${REPO_ROOT}/apps/mobile/.env.local"

detect_lan_host() {
  if [[ -n "${BOGA_MOBILE_LAN_HOST:-}" ]]; then
    printf '%s\n' "${BOGA_MOBILE_LAN_HOST}"
    return 0
  fi

  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null && return 0
    ipconfig getifaddr en1 2>/dev/null && return 0
  fi

  echo "[supabase] could not detect a LAN IP. Set BOGA_MOBILE_LAN_HOST and retry." >&2
  exit 1
}

rewrite_mobile_supabase_env() {
  local lan_url="$1"
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
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${lan_url}"
    printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  } >>"${tmp_file}"

  mv "${tmp_file}" "${MOBILE_ENV_FILE}"
  trap - EXIT
}

"${SCRIPT_DIR}/local-runtime-up.sh"
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "[supabase] missing local Supabase API_URL or ANON_KEY after startup" >&2
  exit 1
fi

LAN_HOST="$(detect_lan_host)"
API_PORT="${API_URL##*:}"
LAN_URL="http://${LAN_HOST}:${API_PORT}"

rewrite_mobile_supabase_env "${LAN_URL}"

echo "[supabase] switched mobile Supabase env to local LAN: ${MOBILE_ENV_FILE}"
echo "[supabase] url: ${LAN_URL}"
echo "[supabase] restart Expo/Metro so EXPO_PUBLIC_* values are rebundled"
