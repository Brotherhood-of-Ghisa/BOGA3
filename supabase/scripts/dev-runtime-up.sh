#!/usr/bin/env bash
#
# dev-runtime-up.sh — start the dedicated local DEV Supabase stack (BOGA-dev),
# isolated from the slot-0 gate stack. See dev-stack-lib.sh / docs/specs/12.
#
# Idempotent: `supabase start` reuses a running stack and applies migrations +
# seed.sql on a fresh volume. Does NOT touch slot-0 and does NOT rewrite
# apps/mobile/.env.local (the dev launchers own that).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-stack-lib.sh"

engage_dev_stack
dev_stack_assert_engaged

echo "[dev-stack] starting dev Supabase (${BOGA_DEV_PROJECT_ID}, workdir ${BOGA_DEV_WORKDIR})"
run_supabase start

load_supabase_status_env
echo "[dev-stack] dev runtime ready"
echo "  project: ${BOGA_DEV_PROJECT_ID}"
echo "  api: ${API_URL:-<unknown>}"
