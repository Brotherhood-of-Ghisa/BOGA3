#!/usr/bin/env bash

# Wrapper for the sync v2 sync_pull RPC contract test. Ensures the shared
# local runtime baseline is up + migrations applied, then runs the contract
# test script in supabase/tests/sync-pull-contract.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[test] ensuring shared local runtime baseline"
"${SUPABASE_DIR}/scripts/ensure-local-runtime-baseline.sh"

echo "[test] running sync v2 sync_pull RPC contract"
"${SUPABASE_DIR}/tests/sync-pull-contract.sh"

echo "[test] sync v2 sync_pull RPC contract passed"
