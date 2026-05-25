#!/usr/bin/env bash

# Wrapper for the sync v2 clean-room schema smoke test. Ensures the shared
# local runtime baseline is up + migrations applied, then runs the smoke
# script in supabase/tests/sync-v2-schema-smoke.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[test] ensuring shared local runtime baseline"
"${SUPABASE_DIR}/scripts/ensure-local-runtime-baseline.sh"

echo "[test] running sync v2 schema smoke"
"${SUPABASE_DIR}/tests/sync-v2-schema-smoke.sh"

echo "[test] sync v2 schema smoke passed"
