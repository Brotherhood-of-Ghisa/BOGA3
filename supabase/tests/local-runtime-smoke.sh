#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "$SUPABASE_DIR/.." && pwd)"
source "${REPO_ROOT}/scripts/runtime-guard.sh"
boga_runtime_guard_script "$REPO_ROOT" "$0" "$@"

echo "[test] ensuring local runtime is up"
"${SUPABASE_DIR}/scripts/local-runtime-up.sh"

echo "[test] resetting database (migrations + seed)"
"${SUPABASE_DIR}/scripts/reset-local.sh"

echo "[test] linting local database schema"
"${SUPABASE_DIR}/scripts/db-lint-local.sh"

echo "[test] checking health endpoint"
"${SUPABASE_DIR}/scripts/smoke-health.sh"

echo "[test] checking deterministic seed fixtures"
"${SUPABASE_DIR}/scripts/smoke-seed.sh"

echo "[test] local runtime smoke suite passed"
