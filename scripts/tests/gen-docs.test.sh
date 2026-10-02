#!/usr/bin/env bash

# Tests for scripts/gen-docs.sh: check passes on the committed tree, and gen is
# STRUCTURALLY idempotent (running it changes nothing but the volatile median
# column). Together these prove the committed generated blocks are exactly what
# the generator produces — modulo medians, which legitimately drift. A hermetic
# fixture (temp repo + temp timing store) pins the median rule: newest green
# runs only, committed figures kept within the churn tolerance, and the median
# column exempt from check's staleness test.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GD="${REPO_ROOT}/scripts/gen-docs.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# Strip the trailing (median) column from lane-matrix rows, mirroring the
# normalize() in scripts/gen-docs.sh `check`. Timing records land on every gate
# run (~/.config/boga/timings/records/) and `gen` refreshes the median column from
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

# Median rule, on a fixture repo + timing store (never the real ones).
FIX="$(mktemp -d)"
trap 'rm -f "${PROBE}"; rm -rf "${FIX}"' EXIT
mkdir -p "${FIX}/scripts" "${FIX}/docs/specs" "${FIX}/store"
cp "${GD}" "${REPO_ROOT}/scripts/lane-timing.sh" "${FIX}/scripts/"
for lane in speedup steady legacy unrun; do
  printf '%s\textra\tnone\tyes\t.\ttrue\n' "${lane}"
done > "${FIX}/scripts/lanes.tsv"
FSPEC="${FIX}/docs/specs/02-quality-and-test-gates.md"
printf '# Fixture\n\n> **Owns:** fixture.\n\n<!-- boga:gen:lane-matrix -->\n<!-- /boga:gen:lane-matrix -->\n' > "${FSPEC}"
git -C "${FIX}" init -q
fgen() { BOGA_TIMINGS_DIR="${FIX}/store" "${FIX}/scripts/gen-docs.sh" "$1" >/dev/null; }
cell() { grep -F "\`./boga test $1\`" "${FSPEC}" | awk -F'|' '{ gsub(/ /, "", $6); print $6 }'; }
rec() { # <file> <lane> <recorded_at> <wall_ms> <exit_code>
  printf '{"lane": "%s", "recorded_at": "%s", "wall_ms": %s, "exit_code": %s}\n' "$2" "$3" "$4" "$5" > "${FIX}/store/$1"
}

fgen gen || fail "fixture gen with an empty store must pass"
[ "$(cell speedup)" = "N/A" ] || fail "no records must render N/A, got '$(cell speedup)'"
# Seed the committed figures the next gen starts from.
sed -i.bak -e '/test speedup`/s/N\/A |$/~2.1m |/' -e '/test steady`/s/N\/A |$/~10s |/' "${FSPEC}"
rm -f "${FSPEC}.bak"

# speedup: 21 old green runs at 136s (filenames sort AFTER the new ones, so
# order must come from recorded_at), then 3 green at 50s and 2 newer red runs.
for i in $(seq 10 30); do rec "zz-old-${i}.json" speedup "202606${i}T120000Z" 136000 0; done
for i in 1 2 3; do rec "new-${i}.json" speedup "20261002T12000${i}Z" 50000 0; done
for i in 4 5; do rec "new-${i}.json" speedup "20261002T12000${i}Z" 1000 1; done
# steady: 11s is within 20% of the committed ~10s, so the cell must not churn.
for i in 1 2 3 4 5; do rec "steady-${i}.json" steady "20261002T11000${i}Z" 11000 0; done
# legacy: an ndjson record replaces N/A.
printf '{"lane": "legacy", "recorded_at": "20260605T000000Z", "wall_ms": 3000, "exit_code": 0}\n' > "${FIX}/store/seed.ndjson"

fgen gen || fail "fixture gen must pass"
[ "$(cell speedup)" = "~50s" ] \
  || fail "median must follow the 5 newest green runs (3x50s, 2x136s), got '$(cell speedup)'"
[ "$(cell steady)" = "~10s" ] \
  || fail "a median within 20% of the committed figure must keep it, got '$(cell steady)'"
[ "$(cell legacy)" = "~3.0s" ] || fail "ndjson records must count, got '$(cell legacy)'"
[ "$(cell unrun)" = "N/A" ] || fail "a lane with no records must stay N/A, got '$(cell unrun)'"
grep -q "5 newest green runs" "${FSPEC}" || fail "the footnote must state the recent-runs rule"

# check ignores the median column: a hand-edited figure is not stale.
sed -i.bak '/test steady`/s/~10s |$/~99m |/' "${FSPEC}"
rm -f "${FSPEC}.bak"
fgen check || fail "check must ignore the median column"

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
