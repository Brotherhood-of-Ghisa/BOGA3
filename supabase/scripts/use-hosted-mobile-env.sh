#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
HOSTED_ENV_FILE="${SUPABASE_DIR}/.env.hosted"
MOBILE_ENV_FILE="${REPO_ROOT}/apps/mobile/.env.local"

if [[ ! -f "${HOSTED_ENV_FILE}" ]]; then
  echo "[supabase] hosted env file not found: ${HOSTED_ENV_FILE}" >&2
  echo "[supabase] run ./scripts/worktree-setup.sh, then fill hosted credentials in supabase/.env.hosted" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${HOSTED_ENV_FILE}"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
  echo "[supabase] missing SUPABASE_URL or SUPABASE_ANON_KEY in ${HOSTED_ENV_FILE}" >&2
  echo "[supabase] fill hosted credentials before switching the mobile app to hosted Supabase" >&2
  exit 1
fi

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
  printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${SUPABASE_URL}"
  printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${SUPABASE_ANON_KEY}"
} >>"${tmp_file}"

mv "${tmp_file}" "${MOBILE_ENV_FILE}"
trap - EXIT

echo "[supabase] switched mobile Supabase env to hosted: ${MOBILE_ENV_FILE}"
echo "[supabase] restart Expo/Metro so EXPO_PUBLIC_* values are rebundled"
