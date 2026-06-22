#!/usr/bin/env bash
#
# dev-reset.sh — explicit, opt-in rebuild of the DEV stack (re-run migrations +
# seed). DROPS ALL DEV DATA, including the dev sign-in accounts and any logged
# data. The dev launchers / `boga db dev` never call this; it is the deliberate
# "clean slate" escape hatch, separate from the slot-0 `reset-local.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-stack-lib.sh"

engage_dev_stack
dev_stack_assert_engaged

echo "[dev-stack] resetting dev Supabase (${BOGA_DEV_PROJECT_ID}) — migrations + seed"
run_supabase db reset --local --yes
