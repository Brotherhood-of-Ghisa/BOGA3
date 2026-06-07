#!/usr/bin/env bash

# Wrapper — server-side end-to-end Sync v2 test suite.
#
# Runs every test under supabase/tests/sync-v2-*.sh that exercises a Sync v2
# server-contract invariant (schema, deferrable FKs, RLS isolation, push/pull
# round-trip, drift, drain) as specified in
# docs/specs/tech/sync-v2-server-contract.md. Exits 0 only if all of them
# pass. Mirrors the shape of the per-feature wrappers
# (test-sync-v2-schema-smoke.sh, test-sync-push-contract.sh,
# test-sync-pull-contract.sh) so the slow-gate plumbing stays uniform.
#
# Invocation:
#   ./supabase/scripts/test-sync-v2-e2e.sh           # run all tests
#
# The shared local runtime baseline is ensured once at the top of this
# script so the individual tests can assume a healthy stack + provisioned
# fixture users.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TESTS_DIR="${SUPABASE_DIR}/tests"

echo "[test] ensuring shared local runtime baseline"
"${SUPABASE_DIR}/scripts/ensure-local-runtime-baseline.sh"

# Per-outcome integration tests. Ordered so a failure surfaces the earliest
# possible signal — schema-level invariants before behavioural-level ones,
# behavioural before drift-tooling.
TESTS=(
  "sync-v2-clean-room.sh"          # outcomes 1, 2, 3
  "sync-v2-deferrable-fk.sh"       # outcome 4
  "sync-v2-rls-cross-owner.sh"     # outcome 5
  "sync-v2-push-roundtrip.sh"      # outcome 6
  "sync-v2-pull-drain.sh"          # outcomes 7, 8 (cross-task push→pull integration)
  "sync-v2-pull-fk-closure.sh"     # outcome 8a (layered drain FK closure)
  "sync-v2-drift-synthetic.sh"     # outcome 9 negative (synthetic drift) + positive (as-built) — folded
  "sync-v2-drift-asbuilt.sh"       # outcome 9 positive (standalone — also exercised inside the synthetic script)
  "sync-v2-spec-rule.sh"           # outcome 10
)

for test in "${TESTS[@]}"; do
  script="${TESTS_DIR}/${test}"
  if [[ ! -x "${script}" ]]; then
    echo "[test] FAIL: ${script} is missing or not executable" >&2
    exit 1
  fi
  echo "[test] running ${test}"
  "${script}"
done

echo "[test] sync v2 e2e suite passed (all ${#TESTS[@]} integration tests)"
