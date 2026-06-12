#!/usr/bin/env bash

# test-for.sh — which gates/lanes does a change require?
#
#   ./boga test for                          # paths from `git diff origin/main...HEAD`
#   ./boga test for --diff <range>           # paths from `git diff <range>`
#   ./boga test for path1 [path2...]         # explicit paths (no git needed)
#   ... [--tsv]                              # machine-readable: one `lane<TAB>rule` per line
#
# Matches changed paths against scripts/triggers.tsv (the machine-readable
# trigger registry; the human tables live in AGENTS.md / spec 02). The
# requirement is the UNION of every matching row, and each requirement is
# printed with the rule that demanded it — cite that rule when marking a gate
# ⛔ N/A in the PR Tests table.
#
# Exit code is 0 unless the registry is unreadable; this tool informs, the PR
# checker (pr-check.sh) enforces.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DIFF_RANGE=""
TSV=0
PATHS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --diff) DIFF_RANGE="$2"; shift ;;
    --tsv) TSV=1 ;;
    --help|-h) sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PATHS+=("$1") ;;
  esac
  shift
done

if [[ ${#PATHS[@]} -eq 0 ]]; then
  if [[ -n "${DIFF_RANGE}" ]]; then
    while IFS= read -r p; do
      [[ -n "$p" ]] && PATHS+=("$p")
    done < <(git -C "${REPO_ROOT}" diff --name-only "${DIFF_RANGE}" 2>/dev/null)
  else
    # Default: everything this change touches — commits ahead of origin/main,
    # uncommitted edits, and untracked files — so the answer is the same
    # before and after you commit.
    git -C "${REPO_ROOT}" fetch origin main -q 2>/dev/null || true
    while IFS= read -r p; do
      [[ -n "$p" ]] && PATHS+=("$p")
    done < <(
      {
        git -C "${REPO_ROOT}" diff --name-only origin/main...HEAD 2>/dev/null
        git -C "${REPO_ROOT}" diff --name-only HEAD 2>/dev/null
        git -C "${REPO_ROOT}" ls-files --others --exclude-standard 2>/dev/null
      } | sort -u
    )
  fi
fi

if [[ ${#PATHS[@]} -eq 0 ]]; then
  echo "[test-for] no changed paths (diff: ${DIFF_RANGE:-explicit args})" >&2
  exit 0
fi

PATHS_FILE="$(mktemp)"
trap 'rm -f "${PATHS_FILE}"' EXIT
printf '%s\n' "${PATHS[@]}" > "${PATHS_FILE}"

REPO_ROOT="${REPO_ROOT}" TSV="${TSV}" PATHS_FILE="${PATHS_FILE}" python3 - <<'PY'
import os, re, sys

root = os.environ["REPO_ROOT"]
tsv_mode = os.environ["TSV"] == "1"
with open(os.environ["PATHS_FILE"]) as f:
    paths = [l.strip() for l in f if l.strip()]

def glob_to_re(pat):
    out = []
    i = 0
    while i < len(pat):
        c = pat[i]
        if c == "*":
            if pat[i:i+2] == "**":
                out.append(".*")
                i += 2
                if i < len(pat) and pat[i] == "/":
                    i += 1
                continue
            out.append("[^/]*")
        elif c in ".+^$(){}[]|\\":
            out.append("\\" + c)
        else:
            out.append(c)
        i += 1
    return re.compile("^" + "".join(out) + "$")

rules = []  # (regex, pattern, requires[list], rule)
with open(os.path.join(root, "scripts/triggers.tsv")) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            print(f"[test-for] malformed triggers.tsv row: {line!r}", file=sys.stderr)
            sys.exit(1)
        pattern, requires, rule = parts
        rules.append((glob_to_re(pattern), pattern, [r.strip() for r in requires.split(",")], rule))

required = {}   # requirement -> set of rule names that demanded it
unmatched = []
per_path = []
for p in paths:
    hits = [(pat, reqs, rule) for rx, pat, reqs, rule in rules if rx.match(p)]
    if not hits:
        unmatched.append(p)
    per_path.append((p, hits))
    for _pat, reqs, rule in hits:
        for r in reqs:
            required.setdefault(r, set()).add(rule)

GATE_ORDER = ["fast", "backend", "frontend"]
ordered = [g for g in GATE_ORDER if g in required] + sorted(r for r in required if r not in GATE_ORDER)

if tsv_mode:
    for r in ordered:
        print(f"{r}\t{'; '.join(sorted(required[r]))}")
    sys.exit(0)

print(f"Changed paths: {len(paths)}")
for p, hits in per_path:
    if hits:
        print(f"  {p}")
        for _pat, reqs, rule in hits:
            print(f"    -> {','.join(reqs)}  ({rule})")
if unmatched:
    print(f"  (no trigger matched: {', '.join(unmatched)} — fast gate is still the default for any code change)")
print()
print("REQUIRED (union):")
for r in ordered:
    print(f"  ./boga test {r:<14} — {'; '.join(sorted(required[r]))}")
if not ordered:
    print("  none — but run ./boga test fast if any code changed.")
PY
