#!/usr/bin/env bash

# Tests for scripts/gen-docs.sh: check passes on the committed tree, and gen is
# STRUCTURALLY idempotent (running it changes nothing but the volatile median
# column). Together these prove the committed generated blocks are exactly what
# the generator produces — modulo medians, which legitimately drift.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GD="${REPO_ROOT}/scripts/gen-docs.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# Strip the trailing (median) column from lane-matrix rows, mirroring the
# normalize() in scripts/gen-docs.sh `check`. Timing records land on every gate
# run (docs/testing/timings/records/) and `gen` refreshes the median column from
# them, so it shifts continuously; freezing it here would make this test fail on
# any machine whose timings differ from the committed snapshot — which is exactly
# why `check` ignores that column. We assert idempotency of STRUCTURE only.
strip_medians() {
  awk '/^\|/ { if (gsub(/\|/, "|") >= 5) sub(/\|[^|]*\|[[:space:]]*$/, "|") } { print }'
}

"${GD}" check >/dev/null || fail "gen-docs check must pass on the committed tree"

# gen must introduce no STRUCTURAL change on a current tree (lanes, gates, CI
# flags) — only the median column may refresh, and that is ignored. Guard: only
# run this half when the generated file is clean in git, so a developer's
# uncommitted edits don't get clobbered or misattributed.
SPEC="docs/specs/02-quality-and-test-gates.md"
if git -C "${REPO_ROOT}" diff --quiet -- "${SPEC}"; then
  before="$(strip_medians < "${REPO_ROOT}/${SPEC}")"
  "${GD}" gen >/dev/null
  after="$(strip_medians < "${REPO_ROOT}/${SPEC}")"
  # Discard any median-only churn gen wrote, keeping the working tree hermetic.
  git -C "${REPO_ROOT}" checkout -- "${SPEC}"
  [ "${before}" = "${after}" ] \
    || fail "gen-docs gen changed lane-matrix STRUCTURE on a current tree — run ./boga docs gen and commit"
else
  echo "  (skipping idempotency half: ${SPEC} has uncommitted edits)"
fi

echo "  gen-docs: all assertions passed"
