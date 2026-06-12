#!/usr/bin/env bash

# Tests for scripts/pr-check.sh (PR Tests-table checker), using the fixture
# bodies under fixtures/pr-bodies/. Infra-free: --paths replaces git diff.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PC="${REPO_ROOT}/scripts/pr-check.sh"
FIX="${SCRIPT_DIR}/fixtures/pr-bodies"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

expect_pass() {
  local desc="$1"; shift
  "${PC}" "$@" >/dev/null 2>&1 || fail "expected PASS: ${desc}"
}
expect_fail() {
  local desc="$1"; shift
  if "${PC}" "$@" >/dev/null 2>&1; then
    fail "expected FAIL: ${desc}"
  fi
}

DOC_PATHS=(--paths docs/specs/05-data-model.md)
SYNC_PATHS=(--paths apps/mobile/src/sync/scheduler.ts)

# A compliant body for a docs-only change passes.
expect_pass "good body, docs-only change" --body "${FIX}/good.md" "${DOC_PATHS[@]}"

# Structural failures regardless of the diff:
expect_fail "unfilled ⬜ row" --body "${FIX}/unfilled.md" "${DOC_PATHS[@]}"
expect_fail "⛔ without a reason" --body "${FIX}/na-no-reason.md" "${DOC_PATHS[@]}"
expect_fail "missing Tests table" --body "${FIX}/missing-table.md" "${DOC_PATHS[@]}"

# Trigger cross-check: a sync change with backend/ios-sync-e2e marked ⛔.
# Default mode warns (exit 0); --strict fails.
expect_pass "wrong N/A is a WARNING by default" --body "${FIX}/wrong-na.md" "${SYNC_PATHS[@]}"
expect_fail "wrong N/A FAILS with --strict" --body "${FIX}/wrong-na.md" "${SYNC_PATHS[@]}" --strict

# The warning text must cite the trigger rule (the #149/#150 fix: a wrong N/A
# is answered with the rule it violated, not just "wrong").
out="$("${PC}" --body "${FIX}/wrong-na.md" "${SYNC_PATHS[@]}" 2>&1)"
grep -q 'trigger: .*sync runtime' <<<"${out}" || fail "wrong-NA warning must cite the trigger rule; got: ${out}"

# The good body also passes when read from stdin.
expect_pass "body via stdin" --body - "${DOC_PATHS[@]}" < "${FIX}/good.md"

# A sync change with everything honestly ✅/justified still passes strict when
# the required gates are ✅. good.md marks backend/sync-e2e ⛔, so strict+sync
# must fail — proving strict catches the exact #125-#151 failure mode.
expect_fail "good-for-docs body is NOT good for a sync change (strict)" --body "${FIX}/good.md" "${SYNC_PATHS[@]}" --strict

echo "  pr-check: all assertions passed"
