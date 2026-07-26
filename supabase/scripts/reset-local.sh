#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

refresh_edge_proxy_after_reset() {
  local project_id kong_container started_at now
  project_id="$(worktree_project_id)"
  kong_container="supabase_kong_${project_id}"

  # Supabase CLI 2.76 may recreate the Edge Runtime container during db reset
  # without refreshing Kong's cached upstream IP. The functions are healthy
  # inside Docker, but the public /functions/v1 route then returns 502 forever.
  # Restart only this worktree's proxy and wait for the real public health route.
  if [[ -z "${project_id}" ]] ||
    ! docker ps --format '{{.Names}}' | grep -Fxq "${kong_container}"; then
    echo "[supabase] could not resolve this worktree's Kong container after reset" >&2
    return 1
  fi

  echo "[supabase] refreshing Edge Function proxy routing after reset"
  docker restart "${kong_container}" >/dev/null
  load_supabase_status_env

  started_at="$(date +%s)"
  until curl_health --max-time 2 >/dev/null 2>&1; do
    now="$(date +%s)"
    if (( now - started_at >= 45 )); then
      echo "[supabase] timed out waiting for the public health function after reset" >&2
      return 1
    fi
    sleep 1
  done
}

echo "[supabase] resetting local database (migrations + seed)"
output_file="$(mktemp)"
trap 'rm -f "${output_file}"' EXIT

set +e
run_supabase db reset --local --yes >"${output_file}" 2>&1
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  cat "${output_file}"
  refresh_edge_proxy_after_reset
  exit 0
fi

cat "${output_file}" >&2

if grep -q 'Error status 502' "${output_file}"; then
  echo "[supabase] db reset hit upstream 502 after migrations/seed; checking seed smoke before failing" >&2
  refresh_edge_proxy_after_reset
  if "${SCRIPT_DIR}/smoke-seed.sh"; then
    echo "[supabase] seed smoke passed after upstream 502; treating reset as complete" >&2
    exit 0
  fi
fi

exit "${status}"
