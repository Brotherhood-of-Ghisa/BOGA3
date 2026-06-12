#!/usr/bin/env bash

# gen-docs.sh — generate and drift-check the doc blocks derived from repo data.
#
#   ./scripts/gen-docs.sh gen     # rewrite generated blocks in place
#   ./scripts/gen-docs.sh check   # fail if blocks are stale or docs are broken
#
# Canonical invocations: `./boga docs gen` / `./boga docs check`; `check` also
# runs as the `docs-check` lane (fast gate + CI).
#
# What it owns:
#   1. The lane-matrix table in docs/specs/02-quality-and-test-gates.md,
#      generated from scripts/lanes.tsv + measured medians from
#      docs/testing/timings/records/ between these markers:
#        <!-- boga:gen:lane-matrix ... -->  ...  <!-- /boga:gen:lane-matrix -->
#   2. check-only validations:
#      - every `boga test <name>` citation in the always-load docs + PR
#        template names a real lane or gate alias,
#      - every relative .md link in curated docs resolves,
#      - every numbered spec carries the Owns/Not here/Load when header.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-check}"

case "${MODE}" in
  gen|check) ;;
  *) echo "usage: $0 gen|check" >&2; exit 2 ;;
esac

REPO_ROOT="${REPO_ROOT}" MODE="${MODE}" python3 - <<'PY'
import json, os, re, statistics, sys

root = os.environ["REPO_ROOT"]
mode = os.environ["MODE"]
problems = []

# ---------- registry ----------
lanes = []  # (name, gate, infra, ci, cwd, command)
with open(os.path.join(root, "scripts/lanes.tsv")) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 6:
            problems.append(f"lanes.tsv: malformed row (expected 6 tab-separated columns): {line!r}")
            continue
        lanes.append(parts)
lane_names = {l[0] for l in lanes}
GATE_ALIASES = {"fast", "backend", "frontend", "slow", "all",
                "fast-frontend", "fast-backend", "fast-repo",
                "for"}  # `boga test for` — the trigger-matcher subcommand

# ---------- measured medians (all machines, green runs) ----------
def load_medians():
    rec_dir = os.path.join(root, "docs/testing/timings/records")
    by_lane = {}
    if not os.path.isdir(rec_dir):
        return {}
    for name in os.listdir(rec_dir):
        path = os.path.join(rec_dir, name)
        try:
            recs = []
            if name.endswith(".ndjson"):
                with open(path) as f:
                    recs = [json.loads(l) for l in f if l.strip()]
            elif name.endswith(".json"):
                with open(path) as f:
                    recs = [json.load(f)]
        except (json.JSONDecodeError, OSError):
            continue
        for r in recs:
            if r.get("exit_code") == 0:
                by_lane.setdefault(r["lane"], []).append(r["wall_ms"])
    return {lane: statistics.median(ms) for lane, ms in by_lane.items()}

def fmt(ms):
    if ms >= 60000:
        return f"~{ms/60000:.1f}m"
    if ms >= 9500:
        return f"~{ms/1000:.0f}s"
    return f"~{ms/1000:.1f}s"

medians = load_medians()

# ---------- generate the lane matrix ----------
INFRA_SECTIONS = [
    ("none", "*Infra: none — CI runs these*"),
    ("supabase", "*Infra: local Supabase + Docker — CI-able, local-only today*"),
    ("ios", "*Infra: iOS simulator + Metro — never CI-able*"),
    ("ios+supabase", None),  # folded into the ios section
]
GATE_DISPLAY = {
    "fast-frontend": "`boga test fast` (frontend half)",
    "fast-backend": "`boga test fast` (backend half)",
    "fast-repo": "`boga test fast` (repo half)",
    "slow-backend": "`boga test backend`",
    "slow-frontend": "`boga test frontend`",
    "extra": "— (run by name)",
}

def matrix_lines():
    out = ["| Lane | Run via | In which gate | CI? | Measured median† |",
           "| --- | --- | --- | :--: | --- |"]
    emitted_ios_header = False
    for infra_key, header in INFRA_SECTIONS:
        rows = [l for l in lanes if l[2] == infra_key]
        if not rows:
            continue
        if infra_key.startswith("ios"):
            if not emitted_ios_header:
                out.append("| *Infra: iOS simulator + Metro — never CI-able (+ local Supabase where noted)* | | | | |")
                emitted_ios_header = True
        elif header:
            out.append(f"| {header} | | | | |")
        for name, gate, infra, ci, cwd, cmd in rows:
            med = fmt(medians[name]) if name in medians else "N/A"
            ci_mark = "✅" if ci == "yes" else "❌"
            suffix = " *(+ local Supabase)*" if infra == "ios+supabase" else ""
            out.append(f"| {name}{suffix} | `./boga test {name}` | {GATE_DISPLAY.get(gate, gate)} | {ci_mark} | {med} |")
    out.append("")
    out.append("† All-machine median of the recorded green runs "
               "(`docs/testing/timings/records/`); `N/A` = no measured data yet, **not** \"instant\" — "
               "run the lane to record it. Per-machine numbers: `./boga timings`.")
    return out

MARK_OPEN = re.compile(r"<!-- boga:gen:lane-matrix[^>]*-->")
MARK_CLOSE = "<!-- /boga:gen:lane-matrix -->"
spec02 = os.path.join(root, "docs/specs/02-quality-and-test-gates.md")
src = open(spec02).read()
m = MARK_OPEN.search(src)
if not m or MARK_CLOSE not in src:
    problems.append("02-quality-and-test-gates.md: lane-matrix markers missing")
else:
    head, rest = src[:m.end()], src[src.index(MARK_CLOSE):]
    generated = "\n" + "\n".join(matrix_lines()) + "\n"
    new = head + generated + rest
    if mode == "gen":
        if new != src:
            open(spec02, "w").write(new)
            print("[gen-docs] regenerated lane matrix in docs/specs/02-quality-and-test-gates.md")
        else:
            print("[gen-docs] lane matrix already current")
    else:
        # Staleness ignores the median column: timing records land on every
        # gate run and shift medians constantly — that must not fail the
        # check. Structural drift (lanes, gates, CI flags) still fails; `gen`
        # refreshes medians opportunistically.
        def normalize(text):
            out = []
            for line in text.splitlines():
                if line.startswith("|") and line.count("|") >= 5:
                    line = line.rsplit("|", 2)[0] + "|"
                out.append(line)
            return "\n".join(out)
        if normalize(new) != normalize(src):
            problems.append("02-quality-and-test-gates.md: lane matrix is STALE — run ./boga docs gen")

# ---------- check-only validations ----------
CURATED = []
for base, dirs, files in os.walk(os.path.join(root, "docs")):
    rel = os.path.relpath(base, root)
    if any(rel.startswith(p) for p in ("docs/plans", "docs/tasks", "docs/brainstorms")):
        continue
    CURATED += [os.path.join(base, f) for f in files if f.endswith(".md")]
CURATED += [os.path.join(root, p) for p in (
    "AGENTS.md", "RUNBOOK.md", "supabase/README.md", "scripts/dev/README.md",
    "apps/mobile/scripts/README.md", "apps/mobile/README-maestro.md",
    "apps/mobile/README-LOCAL-DEV-BUILD.md", "apps/mobile/README_HUMAN_TESTING.md",
) if os.path.exists(os.path.join(root, p))]

# 1. `boga test <name>` citations name real lanes/gates
CITE_FILES = ["AGENTS.md", "docs/specs/02-quality-and-test-gates.md",
              ".github/pull_request_template.md"]
for relpath in CITE_FILES:
    path = os.path.join(root, relpath)
    if not os.path.exists(path):
        continue
    for ln, line in enumerate(open(path), 1):
        for name in re.findall(r"boga test ([a-z0-9][a-z0-9-]*)", line):
            if name not in lane_names and name not in GATE_ALIASES:
                problems.append(f"{relpath}:{ln}: cites unknown lane/gate 'boga test {name}'")

# 2. relative .md links resolve
LINK = re.compile(r"\]\(([^)#\s]+\.md)(#[^)]*)?\)")
for path in CURATED:
    rel = os.path.relpath(path, root)
    for ln, line in enumerate(open(path), 1):
        for target, _anchor in LINK.findall(line):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            base = root if target.startswith("/") else os.path.dirname(path)
            if not os.path.exists(os.path.normpath(os.path.join(base, target.lstrip("/")))):
                problems.append(f"{rel}:{ln}: broken link -> {target}")

# 3. numbered specs carry the ownership header
for fname in sorted(os.listdir(os.path.join(root, "docs/specs"))):
    if re.match(r"\d{2}-.*\.md$", fname):
        head = open(os.path.join(root, "docs/specs", fname)).read(800)
        if "**Owns:**" not in head:
            problems.append(f"docs/specs/{fname}: missing the '> **Owns:** … / **Not here:** … / **Load when:** …' header")

if problems:
    print(f"[gen-docs] {len(problems)} problem(s):", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"[gen-docs] {mode} OK")
PY
