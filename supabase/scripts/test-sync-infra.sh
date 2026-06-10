#!/usr/bin/env bash

# Runs the mobile sync-infra jest lane (drift-check + cycle-round-trip +
# cycle-multidevice-lww + auth-required-envelope) against THIS worktree's
# slot-isolated local Supabase, with zero manual environment setup. It:
#   1. ensures the local stack + baseline fixtures are up (idempotent; reuses a
#      running stack),
#   2. reads the stack's API_URL / ANON_KEY and exposes them as the
#      SYNC_TEST_SUPABASE_URL / SYNC_TEST_SUPABASE_ANON_KEY the lane expects,
#   3. runs `npm run test:sync:infra` in apps/mobile.
#
# Invoked by ./scripts/quality-slow.sh backend; also runnable standalone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

echo "[test-sync-infra] ensuring local Supabase baseline (idempotent)"
"${SCRIPT_DIR}/ensure-local-runtime-baseline.sh"

echo "[test-sync-infra] loading local stack env"
load_supabase_status_env
: "${API_URL:?[test-sync-infra] supabase status did not yield API_URL — is the local stack running?}"
: "${ANON_KEY:?[test-sync-infra] supabase status did not yield ANON_KEY — is the local stack running?}"
export SYNC_TEST_SUPABASE_URL="${API_URL}"
export SYNC_TEST_SUPABASE_ANON_KEY="${ANON_KEY}"

echo "[test-sync-infra] running apps/mobile test:sync:infra against ${API_URL}"
(cd "${REPO_ROOT}/apps/mobile" && npm run test:sync:infra)

echo "[test-sync-infra] done"
