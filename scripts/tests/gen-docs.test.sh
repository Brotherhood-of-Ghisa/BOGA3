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

# Plans are never referenced: a concrete plan path outside docs/plans/** fails
# the check; README, templates, and placeholders pass. The probe is an
# untracked file (check scans new files too), removed on exit.
PROBE="${REPO_ROOT}/scripts/tests/.gen-docs-plan-ref-probe.txt"
trap 'rm -f "${PROBE}"' EXIT
printf '%s\n' 'ok: docs/plans/README.md docs/plans/templates/x.md docs/plans/tasks/<task-id>.md docs/plans/**' > "${PROBE}"
"${GD}" check >/dev/null 2>&1 || fail "plan README/template/placeholder references must pass"
# Built at runtime so this test file itself holds no plan path.
printf 'bad: docs/plans/tasks/%s.md\n' 'M99-T01-Probe' > "${PROBE}"
if out="$("${GD}" check 2>&1)"; then
  fail "a concrete docs/plans/ file reference must fail the check"
fi
grep -q "gen-docs-plan-ref-probe.txt:1: references plan file" <<<"${out}" \
  || fail "plan-reference failure must name the file and line: ${out}"
rm -f "${PROBE}"

# Merge-conflict markers fail the check wherever they are; a lone `=======`
# (Markdown setext underline) passes. Markers are built at runtime so this
# test file itself holds none.
LT="$(printf '<%.0s' 1 2 3 4 5 6 7)"; GT="$(printf '>%.0s' 1 2 3 4 5 6 7)"
printf 'Title\n=======\n' > "${PROBE}"
"${GD}" check >/dev/null 2>&1 || fail "a lone ======= line must pass"
printf 'a\n%s HEAD\nours\n=======\ntheirs\n%s branch\n' "${LT}" "${GT}" > "${PROBE}"
if out="$("${GD}" check 2>&1)"; then
  fail "a committed conflict marker must fail the check"
fi
grep -q "gen-docs-plan-ref-probe.txt:2: merge-conflict marker" <<<"${out}" \
  || fail "conflict-marker failure must name the file and opening line: ${out}"
grep -q "gen-docs-plan-ref-probe.txt:6: merge-conflict marker" <<<"${out}" \
  || fail "conflict-marker failure must name the closing line: ${out}"
rm -f "${PROBE}"

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
