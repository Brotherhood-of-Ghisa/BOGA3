#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

echo "[supabase] resetting local database (migrations + seed)"
output_file="$(mktemp)"
trap 'rm -f "${output_file}"' EXIT

set +e
run_supabase db reset --local --yes >"${output_file}" 2>&1
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  cat "${output_file}"
  exit 0
fi

cat "${output_file}" >&2

if grep -q 'Error status 502' "${output_file}"; then
  echo "[supabase] db reset hit upstream 502 after migrations/seed; checking seed smoke before failing" >&2
  if "${SCRIPT_DIR}/smoke-seed.sh"; then
    echo "[supabase] seed smoke passed after upstream 502; treating reset as complete" >&2
    exit 0
  fi
fi

exit "${status}"
