#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[test] ensuring shared local runtime baseline"
"${SUPABASE_DIR}/scripts/ensure-local-runtime-baseline.sh"

echo "[test] running dev_wipe_my_data RPC contract suite"
"${SUPABASE_DIR}/tests/dev-wipe-my-data-contract.sh"

echo "[test] dev_wipe_my_data contract suite passed"
