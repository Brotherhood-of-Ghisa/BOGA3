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
printf 'bad: docs/plans/tasks/%s%s.md\n' 'M' '99-T01-Probe' > "${PROBE}"
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

# Milestone and task IDs fail anywhere outside the plan trees; SVG path data
# does not. Applied migrations (named at or before the cutoff in
# scripts/plan-ref-exempt.txt) are history; a newer one is checked. IDs are
# built at runtime so this file itself names none.
M="M"; T="T"; C="C"
printf 'ok: <path d="%s12 4L%s2.18 3"/> %s<n>-%s<nn>; rule keys T1 D14 E0.3 P5 R10\n' "$M" "$M" "$M" "$T" > "${PROBE}"
"${GD}" check >/dev/null 2>&1 || fail "SVG path data, placeholders and rule keys must pass: $("${GD}" check 2>&1)"
printf 'a (%s25-%s07)\nb %s-20261005-01\nc as built in %s22.\nd DLM-%s10-D2, %s13-D1 (A%s6)\n' \
  "$M" "$T" "$T" "$M" "$T" "$T" "$C" > "${PROBE}"
if out="$("${GD}" check 2>&1)"; then
  fail "a milestone or task ID must fail the check"
fi
for hit in "1: names milestone/task '${M}25-${T}07'" "2: names milestone/task '${T}-20261005-01'" "3: names milestone/task '${M}22'" \
  "4: names milestone/task 'DLM-${T}10-D2'" "4: names milestone/task '${T}13-D1'" "4: names milestone/task 'A${C}6'"; do
  grep -q "gen-docs-plan-ref-probe.txt:${hit}" <<<"${out}" || fail "plan-ID failure must name file, line and ID (${hit}): ${out}"
done
rm -f "${PROBE}"
OLD_MIG="${REPO_ROOT}/supabase/migrations/00000000000000_gen_docs_probe.sql"
NEW_MIG="${REPO_ROOT}/supabase/migrations/99999999999999_gen_docs_probe.sql"
trap 'rm -f "${PROBE}" "${OLD_MIG}" "${NEW_MIG}"' EXIT
printf -- '-- %s25 history\n' "$M" > "${OLD_MIG}"
"${GD}" check >/dev/null 2>&1 || fail "an applied migration may name a milestone: $("${GD}" check 2>&1)"
printf -- '-- %s25 new\n' "$M" > "${NEW_MIG}"
out="$("${GD}" check 2>&1)" && fail "a migration after the applied cutoff must fail the check"
grep -q "99999999999999_gen_docs_probe.sql:1: names milestone/task" <<<"${out}" || fail "new-migration failure must name it: ${out}"
grep -q "00000000000000_gen_docs_probe.sql" <<<"${out}" && fail "an applied migration must stay exempt: ${out}"
rm -f "${OLD_MIG}" "${NEW_MIG}"

# Cited repo paths must exist. The probe is an untracked persistent doc (check
# scans new files too). Missing paths fail with file:line; non-paths, globs,
# placeholders, fenced code, gitignored outputs (incl. a directory rule on a
# path absent from disk, as on CI), spec shorthand and lines marked historical
# pass. A path outside the repo is missing and must not mask the ignore checks.
PATH_PROBE="${REPO_ROOT}/scripts/tests/.gen-docs-path-probe.md"
# An empty directory is on disk but not in git (nor on CI): it is missing.
EMPTY_DIR="${REPO_ROOT}/scripts/tests/.gen-docs-empty-dir"
trap 'rm -f "${PROBE}" "${PATH_PROBE}"; rmdir "${EMPTY_DIR}" 2>/dev/null || true' EXIT
mkdir -p "${EMPTY_DIR}"
cat > "${PATH_PROBE}" <<'MD'
Real: `scripts/lanes.tsv`, `./scripts/gen-docs.sh check`, [up](../lanes.tsv), `src/sync/`, `docs/specs/02`.
Not paths: `origin/main`, `@supabase/supabase-js`, `text/plain`, `/progress`, `127.0.0.1:54321`, [s](../lanes.tsv#columns).
Skipped: `docs/**/x.md`, `src/<area>/__tests__/`, `apps/mobile/artifacts/maestro/gone.png`, `apps/mobile/dist`.
Gone on purpose: `scripts/retired.sh` <!-- docs-check: historical-path -->
```bash
echo `./scripts/not-here.sh` [x](../not-here.md)
```
MD
"${GD}" check >/dev/null 2>&1 || fail "real, non-path, skipped and historical citations must pass: $("${GD}" check 2>&1)"
printf 'Gone: `scripts/no-such-file.sh` and [x](../no-such-doc.md#a) and `src/sync/nope.ts:12` and [o](../../../outside.md) and `scripts/tests/.gen-docs-empty-dir`.\n' >> "${PATH_PROBE}"
if out="$("${GD}" check 2>&1)"; then
  fail "a missing cited path must fail the check"
fi
for token in scripts/no-such-file.sh ../no-such-doc.md src/sync/nope.ts ../../../outside.md scripts/tests/.gen-docs-empty-dir; do
  grep -q "gen-docs-path-probe.md:8: cites missing path '${token}'" <<<"${out}" \
    || fail "missing-path failure must name file, line and '${token}': ${out}"
done
sed -i.bak '$d' "${PATH_PROBE}"; rm -f "${PATH_PROBE}.bak"
printf 'Lines: `scripts/lanes.tsv:12` and [x](../lanes.tsv#L3-L5).\n' >> "${PATH_PROBE}"
if out="$("${GD}" check 2>&1)"; then
  fail "a citation of a line must fail the check"
fi
for token in scripts/lanes.tsv:12 ../lanes.tsv#L3-L5; do
  grep -q "gen-docs-path-probe.md:8: links to a line ('${token}')" <<<"${out}" \
    || fail "line-link failure must name file, line and '${token}': ${out}"
done
grep -q "cites missing path" <<<"${out}" && fail "a line link to a real file is not a missing path: ${out}"
rm -f "${PATH_PROBE}"

# Word budgets, on a fixture repo (never the real one): reachability from
# AGENTS.md, exempt prefixes, and the ceiling ratchet (gen lowers and drops,
# never raises or adds).
BFIX="$(mktemp -d)"
trap 'rm -f "${PROBE}" "${PATH_PROBE}"; rmdir "${EMPTY_DIR}" 2>/dev/null || true; rm -rf "${BFIX}"' EXIT
mkdir -p "${BFIX}/scripts" "${BFIX}/docs/specs" "${BFIX}/docs/exempt" "${BFIX}/store"
cp "${GD}" "${REPO_ROOT}/scripts/lane-timing.sh" "${BFIX}/scripts/"
printf 'lint\textra\tnone\tyes\t.\ttrue\n' > "${BFIX}/scripts/lanes.tsv"
printf '# Fixture\n\n> **Owns:** fixture.\n\n<!-- boga:gen:lane-matrix -->\n<!-- /boga:gen:lane-matrix -->\n' \
  > "${BFIX}/docs/specs/02-quality-and-test-gates.md"
printf 'budget\tAGENTS.md\t50\nbudget\t*\t10\nexempt\tdocs/exempt/\n' > "${BFIX}/scripts/doc-budgets.tsv"
words() { printf 'w%.0s ' $(seq "$1"); echo; }
printf 'If X, load `docs/a.md`; if Y, load [b](docs/b.md).\n' > "${BFIX}/AGENTS.md"
words 5 > "${BFIX}/docs/a.md"
{ words 3; echo 'Design: `docs/exempt/c.md`.'; } > "${BFIX}/docs/b.md"
words 100 > "${BFIX}/docs/exempt/c.md"
words 100 > "${BFIX}/docs/orphan.md"
git -C "${BFIX}" init -q
bgd() { BOGA_TIMINGS_DIR="${BFIX}/store" "${BFIX}/scripts/gen-docs.sh" "$1" 2>&1; }
ceilings() { grep '^ceiling' "${BFIX}/scripts/doc-budgets.tsv" || true; }

bgd gen >/dev/null || fail "budget fixture: docs within budget, an exempt and an unreachable long doc must pass"
out="$(bgd budgets)"
grep -q "exempt .*docs/exempt/c.md  (docs/b.md)" <<<"${out}" || fail "budgets must report exempt docs and who links them: ${out}"
grep -q "orphan" <<<"${out}" && fail "an unreachable doc must not be budgeted: ${out}"
words 20 > "${BFIX}/docs/a.md"
out="$(bgd check)" && fail "a doc over its budget must fail the check"
grep -q "docs/a.md: 20 words, over its 10-word budget" <<<"${out}" || fail "over-budget failure must name doc and counts: ${out}"
bgd gen >/dev/null && fail "gen must never add a ceiling for an over-budget doc"
[ -z "$(ceilings)" ] || fail "gen must never add a ceiling: $(ceilings)"
printf 'ceiling\tdocs/a.md\t25\nceiling\tdocs/orphan.md\t100\n' >> "${BFIX}/scripts/doc-budgets.tsv"
out="$(bgd check)" && fail "a ceiling above the doc's count must fail the check"
grep -q "docs/a.md: 20 words, under its ceiling of 25" <<<"${out}" || fail "stale-ceiling failure must say so: ${out}"
grep -q "ceiling for 'docs/orphan.md'" <<<"${out}" || fail "a ceiling for an unbudgeted doc must fail: ${out}"
bgd gen >/dev/null || fail "gen must fix stale ceilings"
[ "$(ceilings)" = "$(printf 'ceiling\tdocs/a.md\t20')" ] || fail "gen must lower the ceiling and drop the unbudgeted one: $(ceilings)"
bgd check >/dev/null || fail "check must pass at the lowered ceiling"
words 21 > "${BFIX}/docs/a.md"
out="$(bgd check)" && fail "a grandfathered doc that grows must fail the check"
grep -q "over its grandfathered ceiling of 20" <<<"${out}" || fail "over-ceiling failure must say so: ${out}"
bgd gen >/dev/null || true
[ "$(ceilings)" = "$(printf 'ceiling\tdocs/a.md\t20')" ] || fail "gen must never raise a ceiling: $(ceilings)"
words 5 > "${BFIX}/docs/a.md"
out="$(bgd check)" && fail "a ceiling on a doc that fits its budget must fail the check"
grep -q "fits its 10-word budget" <<<"${out}" || fail "fits-budget failure must say so: ${out}"
bgd gen >/dev/null || fail "gen must drop the ceiling of a doc that fits"
[ -z "$(ceilings)" ] || fail "gen must drop the ceiling of a doc that fits: $(ceilings)"

# An exempt-list row for a file that names no milestone any more is stale.
printf 'docs/a.md\n' > "${BFIX}/scripts/plan-ref-exempt.txt"
out="$(bgd check)" && fail "a stale plan-ref-exempt row must fail the check"
grep -q "'docs/a.md' names no milestone or task any more" <<<"${out}" || fail "stale-row failure must name it: ${out}"
printf '%s7 history\n' "M" >> "${BFIX}/docs/a.md"
bgd check >/dev/null || fail "an exempt file may still name a milestone: $(bgd check)"

# Median rule, on a fixture repo + timing store (never the real ones).
FIX="$(mktemp -d)"
trap 'rm -f "${PROBE}" "${PATH_PROBE}"; rmdir "${EMPTY_DIR}" 2>/dev/null || true; rm -rf "${FIX}" "${BFIX}"' EXIT
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
