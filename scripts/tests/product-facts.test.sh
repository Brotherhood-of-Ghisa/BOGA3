#!/usr/bin/env bash

# Tests for the product-fact rules in scripts/gen-docs.sh `check`
# (docs/product/README.md, "Fact format"), on a fixture repo (never the real
# one): fact headers parse and live in their subject's file, IDs are unique,
# kinds and statuses are known, `[[id]]` references and fact-table markers
# name a fact, a `Signature:` outside docs/product/ needs a citation in its
# paragraph (fenced code included), the grandfathered-restatement list only
# shrinks, and the docs/product/ corpus fits its combined budget.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

FIX="$(mktemp -d)"
trap 'rm -rf "${FIX}"' EXIT
mkdir -p "${FIX}/scripts" "${FIX}/docs/specs" "${FIX}/docs/product" "${FIX}/store"
cp "${REPO_ROOT}/scripts/gen-docs.sh" "${REPO_ROOT}/scripts/lane-timing.sh" "${FIX}/scripts/"
printf 'lint\textra\tnone\tyes\t.\ttrue\n' > "${FIX}/scripts/lanes.tsv"
printf '# Fixture\n\n> **Owns:** fixture.\n\n<!-- boga:gen:lane-matrix -->\n<!-- /boga:gen:lane-matrix -->\n' \
  > "${FIX}/docs/specs/02-quality-and-test-gates.md"
printf 'budget\tAGENTS.md\t500\nbudget\t*\t500\ncorpus\tdocs/product/\t200\n' > "${FIX}/scripts/doc-budgets.tsv"
printf 'Always load: `docs/product/README.md` and `docs/spec.md`.\n' > "${FIX}/AGENTS.md"
# README and REVIEW hold format examples, never facts.
printf '# Facts\n\n### Format\n\n```markdown\n### <subject>.<slug> · <kind> · <status>\nSignature: `<text>`\n```\n\nCite as `[[<id>]]`, tables as `<!-- fact-table: <id> -->`.\n' \
  > "${FIX}/docs/product/README.md"
printf '# Review\n\n### Output\n\nReplace with `[[id]]`.\n' > "${FIX}/docs/product/REVIEW.md"
cat > "${FIX}/docs/product/lift.md" <<'MD'
# Lift

```markdown
### not a fact: fenced headers are examples
```

### lift.formula · calculation · accepted

<!-- fact-table: lift.formula -->

| Load | Shown |
| --- | --- |
| 100 | 116.6 |

Code: `estimate`.
Signature: `48.8`, `n of m sets done`

### lift.old-formula · calculation · superseded-by: lift.formula

Replaced by [[lift.formula]].

### lift.count · definition · open

Undecided.
MD
SPEC="${FIX}/docs/spec.md"
cat > "${SPEC}" <<'MD'
# Spec

The estimate is in `estimate` ([[lift.formula]]): 48.8 and
N of M
sets done stay with the fact.

Unrelated figures: 148.8 kg, 48.85 kg, `n of m sets`.
MD
cp "${SPEC}" "${FIX}/spec.orig"
git -C "${FIX}" init -q
gd() { BOGA_TIMINGS_DIR="${FIX}/store" "${FIX}/scripts/gen-docs.sh" "$1" 2>&1; }
expect_fail() { # <what> <expected output fragment>...
  local what="$1"; shift
  out="$(gd check)" && fail "${what} must fail the check"
  for fragment in "$@"; do
    grep -qF -- "${fragment}" <<<"${out}" || fail "${what}: output must contain '${fragment}': ${out}"
  done
}

gd gen >/dev/null || fail "fixture gen must pass: $(gd gen)"
gd check >/dev/null || fail "a well-formed corpus with cited signatures must pass: $(gd check)"
out="$(gd budgets)"
grep -q "corpus docs/product/: [0-9]* of 200 words in 3 docs (ok)" <<<"${out}" || fail "budgets must report the corpus: ${out}"

# Fact headers.
FACTS="${FIX}/docs/product/lift.md"
cp "${FACTS}" "${FIX}/facts.orig"
restore() { cp "${FIX}/facts.orig" "${FACTS}"; }
printf '\n### lift.broken calculation accepted\n' >> "${FACTS}"
expect_fail "a malformed fact header" "docs/product/lift.md:26: malformed fact header '### lift.broken calculation accepted'"
restore; printf '\n### Lift.Upper · calculation · accepted\n' >> "${FACTS}"
expect_fail "an ID that is not <subject>.<slug>" "lift.md:26: malformed fact header"
restore; printf '\n### lift.formula · definition · accepted\n' >> "${FACTS}"
expect_fail "a duplicate ID" "lift.md:26: duplicate fact ID 'lift.formula' (first at docs/product/lift.md:7)"
restore; printf '\n### lift.extra · rule · accepted\n' >> "${FACTS}"
expect_fail "an unknown kind" "lift.md:26: fact 'lift.extra' has unknown kind 'rule'"
restore; printf '\n### lift.extra · principle · draft\n' >> "${FACTS}"
expect_fail "an unknown status" "lift.md:26: fact 'lift.extra' has unknown status 'draft'"
restore; printf '\n### lift.extra · principle · superseded-by: lift.gone\n' >> "${FACTS}"
expect_fail "a superseded-by naming no fact" "fact 'lift.extra' is superseded by 'lift.gone', which is no fact"
restore; printf '\n### copy.terse · principle · accepted\n' >> "${FACTS}"
expect_fail "a fact outside its subject's file" "lift.md:26: fact 'copy.terse' is in lift.md"
restore; printf '\nSignature: 48.8\n' >> "${FACTS}"
expect_fail "a Signature without code spans" "lift.md:26: malformed Signature line"
restore; printf '\n## Notes\n\nSignature: `53.8`\n' >> "${FACTS}"
expect_fail "a Signature under a non-fact section" "lift.md:28: malformed Signature line"
restore; printf '\n## lift.extra · principle · accepted\n' >> "${FACTS}"
expect_fail "a fact header at the wrong level" "lift.md:26: fact header at the wrong level"
restore; gd check >/dev/null || fail "restored facts must pass"

# Case and line wraps do not hide a restatement; `148.8` and `48.85` above
# are other numbers, not `48.8`.
printf '\nN of M\nsets Done here.\n' >> "${SPEC}"
expect_fail "a wrapped, re-cased signature" "docs/spec.md:9: restates [[lift.formula]] ('n of m sets done')"
cp "${FIX}/spec.orig" "${SPEC}"

# References name a fact; placeholders are not references.
printf '\nSee [[lift.formla]].\n\n<!-- fact-table: lift.gone -->\n' >> "${SPEC}"
expect_fail "an unknown reference" "docs/spec.md:9: 'lift.formla' names no fact" "docs/spec.md:11: 'lift.gone' names no fact"
cp "${FIX}/spec.orig" "${SPEC}"
gd check >/dev/null || fail "removing the bad references must pass: $(gd check)"

# Signatures: uncited prose and fenced code restate; a citation in another
# paragraph does not count.
printf '\nThe constant 48.8 again.\n' >> "${SPEC}"
expect_fail "an uncited signature" "docs/spec.md:9: restates [[lift.formula]] ('48.8')"
printf '\n```text\n1RM = load / (48.8 + x)\n\nn OF m\nsets DONE\n```\n' >> "${SPEC}"
expect_fail "a signature in fenced code" "docs/spec.md:12: restates [[lift.formula]] ('48.8')"
grep -q "spec.md:14" <<<"${out}" && fail "one paragraph is one finding, at its first signature: ${out}"
# A doc outside docs/product/ cannot cite from a paragraph that is not its own.
printf '\nCites [[lift.formula]] but states nothing.\n' >> "${SPEC}"
expect_fail "a citation in another paragraph" "docs/spec.md:9: restates" "docs/spec.md:12: restates"

# Grandfathered restatements: the count allows exactly that many paragraphs.
GF="${FIX}/scripts/product-fact-restatements.tsv"
printf '# header\ndocs/spec.md\tlift.formula\t2\n' > "${GF}"
gd check >/dev/null || fail "grandfathered restatements must pass: $(gd check)"
printf '\nAnd 48.8 once more.\n' >> "${SPEC}"
expect_fail "a restatement beyond the grandfathered count" "docs/spec.md:20: restates [[lift.formula]]"
sed -i.bak '$d' "${SPEC}"; sed -i.bak '$d' "${SPEC}"; rm -f "${SPEC}.bak"
printf 'docs/spec.md\tlift.formula\t3\n' > "${GF}"
expect_fail "a stale grandfathered count" "'docs/spec.md' restates [[lift.formula]] in 2 paragraph(s), not 3 — lower the row"
printf 'docs/spec.md\tlift.count\t1\ndocs/spec.md\tlift.formula\ndocs/other.md\tlift.formula\t0\n' > "${GF}"
printf 'docs/spec.md\tlift.formula\t2\ndocs/spec.md\tlift.formula\t2\n' >> "${GF}"
expect_fail "rows for a fact with no signature, without a count, at 0, or repeated" \
  "malformed row (doc, fact with a Signature, paragraphs above 0; one row per doc and fact): 'docs/spec.md\\tlift.count\\t1'" \
  "one row per doc and fact): 'docs/spec.md\\tlift.formula'" \
  "one row per doc and fact): 'docs/other.md\\tlift.formula\\t0'"
grep -cF "one row per doc and fact): 'docs/spec.md\\tlift.formula\\t2'" <<<"${out}" | grep -qx 1 \
  || fail "a repeated row must fail once, the first one counting: ${out}"
rm -f "${GF}"

# Corpus budget: the directory's docs share one limit.
printf 'budget\tAGENTS.md\t500\nbudget\t*\t500\ncorpus\tdocs/product/\t20\n' > "${FIX}/scripts/doc-budgets.tsv"
expect_fail "a corpus over its budget" "docs/product/: " "words in 3 docs, over its 20-word corpus budget"
printf 'corpus\tdocs/product\t20\n' >> "${FIX}/scripts/doc-budgets.tsv"
expect_fail "a corpus row without a trailing slash" "malformed row: 'corpus\\tdocs/product\\t20'"

echo "  product-facts: all assertions passed"
