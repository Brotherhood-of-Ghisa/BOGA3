#!/usr/bin/env bash
#
# dev-runtime-down.sh — stop the dev Supabase stack (BOGA-dev). Containers +
# volumes persist for a fast restart (mirrors local-runtime-down.sh for slot-0).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-stack-lib.sh"

engage_dev_stack
dev_stack_assert_engaged

echo "[dev-stack] stopping dev Supabase (${BOGA_DEV_PROJECT_ID})"
run_supabase stop
