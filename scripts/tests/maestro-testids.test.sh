#!/usr/bin/env bash

# maestro-testids.test.sh — every element id a Maestro flow targets must still
# exist in the app source.
#
# Why this exists: a screen/component change runs only the backend-free iOS
# lanes (`boga test frontend-ui`); the Supabase-backed e2e lanes run for their
# own areas and in the scheduled full sweep (spec 02). The commonest way a
# restyle breaks a flow it did not run is renaming or dropping a testID the
# flow taps. This check catches that in about a second, on every PR (meta-tests
# lane, fast gate + CI), for every flow — including the e2e ones.
#
# Rule: each `id: "<x>"` selector in apps/mobile/.maestro/flows/*.yaml must be
# produced by a string or template literal in apps/mobile/{app,components,src}
# (jest suites excluded). A template `a-${n}-b` matches any value in the slot.
# A template that STARTS with a slot (`${testID}-row`) only matches when the
# part standing in for that slot is itself produced by the source, so a
# prop-supplied prefix can't make any `*-row` id resolve; a text-free join
# (`${prefix}-${value}`) needs its head to be a value the source passes as a
# `…testIDPrefix` prop. A flow-side slot
# (`${output.id}`) must line up with a source-side slot.
#
# Limits: literal-level, not render-level — an id that exists in source but is
# no longer rendered on that screen passes. Ids built by a text-free join
# (chip/segment rows: `${testIDPrefix}-${option.value}`, ~12% of selectors)
# are only loosely checked, since any known prefix can absorb the rest. The
# lanes — and the scheduled full sweep — are what catch those.
#
# Infra-free. Part of the `meta-tests` lane (and CI). Self-tests the rule on
# synthetic trees first, then checks the real repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# check_tree <mobile-dir>: exits non-zero listing every unresolved flow id.
check_tree() {
  MOBILE_DIR="$1" python3 - <<'PYCHECK'
import functools, glob, os, re, sys

mobile = os.environ["MOBILE_DIR"]
SLOT = re.compile(r"\$\{[^}]*\}")
LITERAL = re.compile(r"([\"'`])((?:(?!\1)[^\n\\])*)\1")

PREFIX_PROP = re.compile(r"[A-Za-z]*(?:TestID|TestId|testID|testId)Prefix\s*[=:]\s*\{?\s*([\"'`])((?:(?!\1)[^\n\\])*)\1")

literals, prefixes = set(), set()
for d in ("app", "components", "src"):
    for path in glob.glob(os.path.join(mobile, d, "**", "*.ts*"), recursive=True):
        if "/__tests__/" in path:
            continue
        with open(path) as f:
            text = f.read()
        literals.update(m.group(2) for m in LITERAL.finditer(text))
        prefixes.update(m.group(2) for m in PREFIX_PROP.finditer(text))

def compile_all(values):
    """-> (anchored regexes, rest-regexes of templates that start with a slot)"""
    anchored, headless = [], []
    for lit in values:
        parts = SLOT.split(lit)
        if len(parts) == 1 or parts[0]:
            anchored.append(re.compile("^" + "(.+)".join(re.escape(p) for p in parts) + "$"))
        elif any(parts[1:]):
            headless.append(re.compile("^" + "(.+?)".join(re.escape(p) for p in parts[1:]) + "$"))
    return anchored, headless

anchored, headless, joins = [], [], []
for lit in literals:
    parts = SLOT.split(lit)
    if len(parts) == 1 or parts[0]:
        anchored.append(re.compile("^" + "(.+)".join(re.escape(p) for p in parts) + "$"))
    elif any(re.search(r"[A-Za-z0-9]", p) for p in parts[1:]):
        # `${head}-row`: the rest carries text; the head must itself resolve
        headless.append(re.compile("^" + "(.+?)".join(re.escape(p) for p in parts[1:]) + "$"))
    elif any(parts[1:]):
        # `${prefix}-${value}`: only separators, so the head must be a value
        # the source passes as a testID prefix prop (values may be runtime data)
        joins.append(re.compile("^" + "(.+?)".join(re.escape(p) for p in parts[1:]) + "$"))
prefix_anchored, prefix_headless = compile_all(prefixes)

def splits(value):
    return ((value[:i], value[i:]) for i in range(1, len(value)))

@functools.lru_cache(maxsize=None)
def is_prefix(value, depth=0):
    if any(p.match(value) for p in prefix_anchored):
        return True
    return depth < 2 and any(any(r.match(t) for r in prefix_headless) and is_prefix(h, depth + 1)
                             for h, t in splits(value))

@functools.lru_cache(maxsize=None)
def resolves(value, depth=0):
    if any(p.match(value) for p in anchored):
        return True
    if depth >= 2:
        return False
    for head, tail in splits(value):
        if any(rest.match(tail) for rest in headless) and resolves(head, depth + 1):
            return True
        if any(j.match(tail) for j in joins) and is_prefix(head):
            return True
    return False

flows = sorted(glob.glob(os.path.join(mobile, ".maestro", "flows", "*.yaml")))
if not flows:
    sys.exit(f"  ASSERT FAILED: no flows under {mobile}/.maestro/flows — the glob likely broke")
missing, checked = [], 0
for flow in flows:
    with open(flow) as f:
        for m in re.finditer(r'\bid:\s*"([^"]+)"', f.read()):
            checked += 1
            if not resolves(SLOT.sub("X", m.group(1))):
                missing.append(f"{os.path.basename(flow)}: {m.group(1)}")
if missing:
    print("  flow ids with no matching testID in app source (renamed or removed?):", file=sys.stderr)
    for line in sorted(set(missing)):
        print(f"    {line}", file=sys.stderr)
    sys.exit(1)
print(f"  maestro-testids: {checked} id selector(s) across {len(flows)} flow(s) resolve to app source")
PYCHECK
}

# --- self-tests on synthetic trees ---------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

make_tree() {
  mkdir -p "$1/.maestro/flows" "$1/components" "$1/app/__tests__"
  cat >"$1/components/row.tsx" <<'EOF'
export const Row = ({ testID, n }) => <View testID={`${testID}-row`}><Text testID={`set-${n}-toggle`} /></View>;
export const Screen = () => <Row testID="stats-list" n={1} />;
EOF
  printf -- '- tapOn:\n    id: "stats-list-row"\n- tapOn:\n    id: "set-3-toggle"\n' >"$1/.maestro/flows/a.yaml"
}

expect_check() {
  local expected="$1" label="$2" dir="$3" out
  if out="$( (check_tree "${dir}") 2>&1 )"; then
    [[ "${expected}" == pass ]] || fail "self-test '${label}': expected a violation, got: ${out}"
  else
    [[ "${expected}" == fail ]] || fail "self-test '${label}': expected a pass, got: ${out}"
  fi
  echo "  self-test ok (${expected}): ${label}"
}

make_tree "${TMP}/ok"
expect_check pass "literal prefix + templated slot resolve" "${TMP}/ok"

make_tree "${TMP}/renamed"
printf -- '- tapOn:\n    id: "stats-list-header"\n' >>"${TMP}/renamed/.maestro/flows/a.yaml"
expect_check fail "an id no source literal produces" "${TMP}/renamed"

make_tree "${TMP}/unknown-prefix"
printf -- '- tapOn:\n    id: "gone-screen-row"\n' >>"${TMP}/unknown-prefix/.maestro/flows/a.yaml"
expect_check fail "a leading-slot template whose prefix no source produces" "${TMP}/unknown-prefix"

make_tree "${TMP}/test-only"
printf 'const x = "only-in-a-jest-suite";\n' >"${TMP}/test-only/app/__tests__/x.test.tsx"
printf -- '- tapOn:\n    id: "only-in-a-jest-suite"\n' >>"${TMP}/test-only/.maestro/flows/a.yaml"
expect_check fail "an id that exists only in a jest suite" "${TMP}/test-only"

make_tree "${TMP}/flow-slot"
printf -- '- tapOn:\n    id: "set-${output.n}-toggle"\n' >>"${TMP}/flow-slot/.maestro/flows/a.yaml"
expect_check pass "a flow-side \${output} slot over a source template slot" "${TMP}/flow-slot"

# --- the real repo ---------------------------------------------------------------

check_tree "${REPO_ROOT}/apps/mobile"
