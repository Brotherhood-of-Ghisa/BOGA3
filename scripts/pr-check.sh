#!/usr/bin/env bash

# pr-check.sh — mechanical validation of a PR body's Tests table.
#
#   ./boga pr check --body <file> [--diff <range>] [--paths p1 p2 ...] [--strict]
#   ... --body - reads the body from stdin.
#
# Checks (structural — always FAIL on violation):
#   - the body has a "## Tests" section with the gate table,
#   - no row is left unfilled (⬜ or empty Ran? cell),
#   - every ⛔ N/A row states a reason in its Result cell.
#
# Trigger cross-check (WARN by default, FAIL with --strict):
#   - computes the gates the change requires via scripts/test-for.sh
#     (registry: scripts/triggers.tsv) and flags required gates whose row is
#     marked ⛔ — i.e. "this change's paths demand that lane; N/A is not valid".
#     The finding cites the trigger rule, which is exactly what a legitimate ⛔
#     justification should have cited.
#
# CI runs this on every pull request (body from the event payload). If the
# diff base is unavailable (shallow clone), the trigger cross-check is skipped
# with a warning; structural checks still apply.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BODY_FILE=""
DIFF_RANGE=""
STRICT=0
EXPLICIT_PATHS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --body) BODY_FILE="$2"; shift ;;
    --diff) DIFF_RANGE="$2"; shift ;;
    --strict) STRICT=1 ;;
    --paths) shift; while [[ $# -gt 0 && "$1" != --* ]]; do EXPLICIT_PATHS+=("$1"); shift; done; continue ;;
    --help|-h) sed -n '3,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[pr-check] unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -n "${BODY_FILE}" ]] || { echo "[pr-check] --body <file|-> is required" >&2; exit 2; }

BODY_TMP="$(mktemp)"
REQ_TMP="$(mktemp)"
trap 'rm -f "${BODY_TMP}" "${REQ_TMP}"' EXIT

if [[ "${BODY_FILE}" == "-" ]]; then
  cat > "${BODY_TMP}"
else
  cat "${BODY_FILE}" > "${BODY_TMP}"
fi

# Required gates for this change (best-effort; empty file = skip cross-check).
if [[ ${#EXPLICIT_PATHS[@]} -gt 0 ]]; then
  "${REPO_ROOT}/scripts/test-for.sh" --tsv "${EXPLICIT_PATHS[@]}" > "${REQ_TMP}" || : > "${REQ_TMP}"
else
  "${REPO_ROOT}/scripts/test-for.sh" --tsv ${DIFF_RANGE:+--diff "${DIFF_RANGE}"} > "${REQ_TMP}" 2>/dev/null || : > "${REQ_TMP}"
fi

BODY_TMP="${BODY_TMP}" REQ_TMP="${REQ_TMP}" STRICT="${STRICT}" python3 - <<'PY'
import os, re, sys

body = open(os.environ["BODY_TMP"]).read()
strict = os.environ["STRICT"] == "1"

failures, warnings = [], []

# ---- locate the Tests table ----
m = re.search(r"^##\s+Tests\s*$(.*?)(?=^##\s|\Z)", body, re.M | re.S)
if not m:
    failures.append('no "## Tests" section found (PR template: .github/pull_request_template.md)')
    rows = []
else:
    rows = []
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3 or set(cells[1]) <= {"-", " ", ":"} or cells[0] == "Gate":
            continue
        rows.append(cells)
    if not rows:
        failures.append("the Tests section has no gate rows")

# ---- structural checks per row ----
GATE_KEY = re.compile(r"boga test ([a-z0-9-]+)")
row_state = {}  # gate key -> (mark, result, label)
for cells in rows:
    label, ran, result = cells[0], cells[1], cells[2] if len(cells) > 2 else ""
    short = label.split("—")[0].strip() or label[:40]
    if "✅" in ran and "⛔" in ran:
        # mixed marks are allowed (e.g. partial gate) but need a result
        mark = "mixed"
    elif "✅" in ran:
        mark = "ran"
    elif "⛔" in ran:
        mark = "na"
    else:
        failures.append(f'row "{short}": Ran? cell is unfilled (no ✅ or ⛔) — run the gate or justify the N/A')
        continue
    if not result:
        failures.append(f'row "{short}": empty Result cell — greens need evidence, ⛔ needs the trigger rule it relies on')
    km = GATE_KEY.search(label)
    if km:
        row_state[km.group(1)] = (mark, result, short)

# ---- trigger cross-check ----
required = {}
for line in open(os.environ["REQ_TMP"]):
    line = line.rstrip("\n")
    if line and "\t" in line:
        req, rule = line.split("\t", 1)
        required[req] = rule
# docs-check / meta-tests run inside the fast gate
ALIAS = {"docs-check": "fast", "meta-tests": "fast"}
collapsed = {}
for req, rule in required.items():
    collapsed.setdefault(ALIAS.get(req, req), []).append(rule)

if not required:
    warnings.append("trigger cross-check skipped: no changed paths resolved (shallow clone or empty diff)")
else:
    for gate, rules in sorted(collapsed.items()):
        state = row_state.get(gate)
        if state is None:
            warnings.append(f'change requires "{gate}" but the Tests table has no `boga test {gate}` row')
        elif state[0] == "na":
            msg = (f'gate "{gate}" is marked ⛔ N/A but this change\'s paths REQUIRE it '
                   f'(trigger: {"; ".join(rules)})')
            (failures if strict else warnings).append(msg)

for w in warnings:
    print(f"[pr-check] WARN: {w}")
if failures:
    print(f"[pr-check] {len(failures)} failure(s):", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    sys.exit(1)
print("[pr-check] OK" + (" (strict)" if strict else ""))
PY
