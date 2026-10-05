#!/usr/bin/env bash

# gen-docs.sh — generate and drift-check the doc blocks derived from repo data.
#
#   ./scripts/gen-docs.sh gen     # rewrite generated blocks in place
#   ./scripts/gen-docs.sh check   # fail if blocks are stale or docs are broken
#   ./scripts/gen-docs.sh budgets # report word counts of the agent-loadable docs
#
# Canonical invocations: `./boga docs gen` / `./boga docs check`; `check` also
# runs as the `docs-check` lane (fast gate + CI).
#
# What it owns:
#   1. The lane-matrix table in docs/specs/02-quality-and-test-gates.md,
#      generated from scripts/lanes.tsv + recent-run medians from this
#      machine's timing store (scripts/lane-timing.sh; the rule is in
#      load_medians below) between these markers:
#        <!-- boga:gen:lane-matrix ... -->  ...  <!-- /boga:gen:lane-matrix -->
#   2. check-only validations:
#      - every `boga test <name>` citation in the always-load docs + PR
#        template names a real lane or gate alias,
#      - every relative .md link in curated docs resolves,
#      - every numbered spec carries the Owns/Not here/Load when header,
#      - no file outside docs/plans/** and docs/brainstorms/** references a
#        plan file (plans are ephemeral; AGENTS.md "Planning").
#      - no tracked or new text file holds a merge-conflict marker line
#        (`<<<<<<< `, `||||||| `, `>>>>>>> `),
#      - every repo path cited in a persistent doc exists, never at a line,
#      - every doc reachable from AGENTS.md fits its word budget
#        (scripts/doc-budgets.tsv; `gen` lowers grandfathered ceilings).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-check}"
# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/lane-timing.sh"
RECORDS_DIR="$(boga_timing_records_dir)"

case "${MODE}" in
  gen|check|budgets) ;;
  *) echo "usage: $0 gen|check|budgets" >&2; exit 2 ;;
esac

REPO_ROOT="${REPO_ROOT}" MODE="${MODE}" RECORDS_DIR="${RECORDS_DIR}" python3 - <<'PY'
import json, os, re, statistics, subprocess, sys

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
GATE_ALIASES = {"fast", "backend", "frontend", "frontend-ui", "slow", "all",
                "fast-frontend", "fast-backend", "fast-repo",
                "for"}  # `boga test for` — the trigger-matcher subcommand

# ---------- measured medians (all machines, recent green runs) ----------
# A lane's median is taken over its RECENT_RUNS newest green runs (by
# recorded_at), so a lane that got faster or slower shows it after a few runs
# instead of being outvoted by its whole history. Records are not ranked by
# commit: most runs are of uncommitted work (`dirty`) and PR commits are
# squash-merged, so a record's commit does not say which code it measured.
RECENT_RUNS = 5
# `gen` keeps a committed median unless the new one moved more than this
# fraction from it, so run-to-run noise does not churn the table.
CHURN_TOLERANCE = 0.20

def load_medians():
    rec_dir = os.environ["RECORDS_DIR"]
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
                by_lane.setdefault(r["lane"], []).append((str(r.get("recorded_at", "")), r["wall_ms"]))
    medians = {}
    for lane, runs in by_lane.items():
        runs.sort(reverse=True)  # recorded_at is YYYYMMDDTHHMMSSZ: newest first
        medians[lane] = statistics.median(ms for _, ms in runs[:RECENT_RUNS])
    return medians

def fmt(ms):
    if ms >= 60000:
        return f"~{ms/60000:.1f}m"
    if ms >= 9500:
        return f"~{ms/1000:.0f}s"
    return f"~{ms/1000:.1f}s"

def parse_fmt(cell):
    """Inverse of fmt(): '~2.1m' -> 126000.0; None for N/A or anything else."""
    m = re.fullmatch(r"~(\d+(?:\.\d+)?)([sm])", cell.strip())
    if not m:
        return None
    return float(m.group(1)) * (60000 if m.group(2) == "m" else 1000)

def committed_cells(text):
    """lane -> median cell as currently written in the spec's lane matrix."""
    cells = {}
    for line in text.splitlines():
        m = re.match(r"\|[^|]*\| `\./boga test ([^`]+)` \|.*\|([^|]*)\|\s*$", line)
        if m:
            cells[m.group(1)] = m.group(2).strip()
    return cells

def median_cell(name):
    if name not in medians:
        return "N/A"
    old = parse_fmt(committed.get(name, ""))
    if old and abs(medians[name] - old) <= CHURN_TOLERANCE * old:
        return committed[name]
    return fmt(medians[name])

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
            med = median_cell(name)
            ci_mark = "✅" if ci == "yes" else "❌"
            suffix = " *(+ local Supabase)*" if infra == "ios+supabase" else ""
            gate_cell = GATE_DISPLAY.get(gate, gate)
            if gate == "slow-frontend" and infra == "ios":
                gate_cell += " + `frontend-ui`"
            out.append(f"| {name}{suffix} | `./boga test {name}` | {gate_cell} | {ci_mark} | {med} |")
    out.append("")
    out.append(f"† Median of each lane's {RECENT_RUNS} newest green runs (all machines, by `recorded_at`) "
               "in the generating machine's timing store (`~/.config/boga/timings/records/`); "
               f"`./boga docs gen` keeps a committed figure until that median moves more than {CHURN_TOLERANCE:.0%} from it. "
               "`N/A` = no measured data yet, **not** \"instant\" — run the lane to record it. "
               "Per-machine numbers over a time window: `./boga timings`.")
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
    committed = committed_cells(src[m.end():src.index(MARK_CLOSE)])
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
    if any(rel.startswith(p) for p in ("docs/plans", "docs/brainstorms")):
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

# 4. plans are never referenced: no concrete plan file path (other than the
#    README and templates) in any tracked or new file outside the working-notes
#    trees. Matches docs/plans/…, ../plans/…, ./plans/… and plans/… (relative
#    from docs/); placeholders like docs/plans/tasks/<task-id>.md pass.
PLAN_REF = re.compile(r"(?<![A-Za-z0-9_-])plans/((?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[A-Za-z0-9]+)\b")
try:
    listed = subprocess.run(
        ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True, check=True).stdout.decode().split("\0")
except (OSError, subprocess.CalledProcessError) as exc:
    listed = []
    problems.append(f"plan-reference and conflict-marker checks need a git work tree ({exc})")
# 5. no merge-conflict markers in any tracked or new text file, plans
#    included. `=======` alone is not flagged: it is also a valid Markdown
#    setext underline, and a real conflict always carries the open/close pair.
CONFLICT = re.compile(r"^(?:<{7}|\|{7}|>{7})(?: |$)", re.M)
for rel in listed:
    if not rel:
        continue
    path = os.path.join(root, rel)
    if os.path.islink(path) or not os.path.isfile(path):
        continue
    try:
        text = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        continue
    for m in CONFLICT.finditer(text):
        ln = text.count("\n", 0, m.start()) + 1
        problems.append(f"{rel}:{ln}: merge-conflict marker '{m.group(0).strip()}' — resolve the conflict")
    if rel.startswith(("docs/plans/", "docs/brainstorms/")) or os.path.getsize(path) > 2_000_000:
        continue
    if "plans/" not in text:
        continue
    for ln, line in enumerate(text.splitlines(), 1):
        for m in PLAN_REF.finditer(line):
            target = m.group(1)
            if target == "README.md" or target.startswith("templates/"):
                continue
            problems.append(f"{rel}:{ln}: references plan file {m.group(0)} — plans are ephemeral; cite the owning spec instead")

# 6. repo paths cited in persistent docs exist. A path is an inline-code
#    token or link target with a `/` whose first segment exists under one of
#    the doc's bases (its directory, its package root, the repo root,
#    apps/mobile); anything else (`origin/main`, `@scope/pkg`) is not a path.
#    Skipped: fenced code, globs and placeholders, gitignored outputs, and
#    lines marked HISTORICAL. `docs/specs/NN` is shorthand for that spec.
#    A citation never points at a line (`file.ts:42`, `file.ts#L42`).
HISTORICAL = "<!-- docs-check: historical-path -->"
LINE_REF = re.compile(r"^[^\s`]+\.(?:md|tsx?|jsx?|cjs|mjs|sh|sql|json|tsv|ya?ml|toml|py|swift|kt|plist)"
                      r"(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$")
INLINE_CODE = re.compile(r"(?<!`)`([^`\n]+)`(?!`)")
ANY_LINK = re.compile(r"\]\(([^)\s]+)\)")
SEGMENT = r"[A-Za-z0-9_.@()\[\]+-]+"
PATHLIKE = re.compile(rf"^(?:\./)?{SEGMENT}(?:/{SEGMENT})*/?$")
PERSISTENT_DOCS = sorted(
    rel for rel in listed
    if rel.endswith(".md") and not rel.startswith(("docs/plans/", "docs/brainstorms/"))
    and os.path.isfile(os.path.join(root, rel)) and not os.path.islink(os.path.join(root, rel)))

def package_root(d):
    while d:
        if os.path.exists(os.path.join(root, d, "package.json")):
            return d
        d = os.path.dirname(d)
    return ""

# Existence is judged against git's file list (tracked + new), never the disk,
# so local-only outputs (node_modules, dist) count the same here as on CI.
REPO_PATHS = set()
for rel in listed:
    while rel:
        REPO_PATHS.add(rel)
        rel = os.path.dirname(rel)

def repo_path(base, path):
    return os.path.normpath(os.path.join(base, path))

def path_exists(base, path):
    full = repo_path(base, path)
    if full in REPO_PATHS:
        return True
    m = re.fullmatch(r"docs/specs/(\d{2})", full)
    return bool(m) and any(p.startswith(f"docs/specs/{m.group(1)}-") for p in REPO_PATHS)

cited = []  # (doc, line, token, candidate repo paths)
for rel in PERSISTENT_DOCS:
    d = os.path.dirname(rel)
    bases = list(dict.fromkeys([d, package_root(d), "", "apps/mobile"]))
    fenced = False
    for ln, line in enumerate(open(os.path.join(root, rel), encoding="utf-8"), 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if fenced or HISTORICAL in line:
            continue
        tokens = [t for span in INLINE_CODE.findall(line) for t in span.split()]
        tokens += ANY_LINK.findall(line)
        for token in tokens:
            token = re.sub(r"[,;.)]+$", "", token)
            if LINE_REF.match(token) and "://" not in token:
                problems.append(f"{rel}:{ln}: links to a line ('{token}') — line numbers rot with every "
                                "edit; link to the file or path")
            token = re.sub(r"(?::\d+(?:-\d+)?|#.*|:)$", "", token)
            if ("/" not in token or "://" in token or token.startswith(("/", "-"))
                    or re.search(r"[*<>{}$~|]", token) or not PATHLIKE.match(token)):
                continue
            path = token[2:] if token.startswith("./") else token
            first = path.split("/")[0]
            anchored = [b for b in bases if first == ".." or repo_path(b, first) in REPO_PATHS]
            if anchored and not any(path_exists(b, path) for b in anchored):
                cited.append((rel, ln, token, [repo_path(b, path) for b in anchored]))
def gitignored(path):
    """True if a .gitignore rule matches path. Asked one path at a time: git
    aborts a whole --stdin batch on a path outside the repo or beyond a local
    symlink. A directory rule (`node_modules/`) only matches a trailing `/`."""
    return any(subprocess.run(
        ["git", "-C", root, "check-ignore", "-q", "--no-index", v],
        capture_output=True).returncode == 0 for v in (path, path + "/"))

if cited:
    ignored = {c for *_, cs in cited for c in cs if gitignored(c)}
    for rel, ln, token, cs in cited:
        if not any(c in ignored for c in cs):
            problems.append(f"{rel}:{ln}: cites missing path '{token}' — fix the path, or mark a deliberately "
                            f"historical line with {HISTORICAL}")

# 7. word budgets for the docs an agent can load: AGENTS.md and every
#    persistent doc reachable from it through Markdown links or inline-code
#    `.md` paths. Words are whitespace-separated tokens (`wc -w`). Limits,
#    exempt prefixes and grandfathered ceilings live in scripts/doc-budgets.tsv;
#    a ceiling only falls (`gen` lowers it to the current count and drops it
#    once the doc fits its budget; nothing ever raises or adds one).
ENTRYPOINT = "AGENTS.md"
BUDGETS_TSV = os.path.join(root, "scripts/doc-budgets.tsv")
MD_LINK = re.compile(r"\]\(([^)#\s]+\.md)(?:#[^)]*)?\)")
MD_CODE = re.compile(r"`([^`\s]+\.md)(?:#[^`]*)?`")

def reachable_docs():
    """doc -> the doc that first links to it (breadth-first from ENTRYPOINT)."""
    via = {ENTRYPOINT: None}
    queue = [ENTRYPOINT]
    while queue:
        doc = queue.pop(0)
        text = open(os.path.join(root, doc), encoding="utf-8").read()
        for target in MD_LINK.findall(text) + MD_CODE.findall(text):
            if "://" in target or re.search(r"[*<>~]", target):
                continue
            for base in (os.path.dirname(doc), ""):
                full = os.path.normpath(os.path.join(root, base, target.lstrip("/")))
                if os.path.isfile(full):
                    rel = os.path.relpath(os.path.realpath(full), os.path.realpath(root))
                    if rel not in via and not rel.startswith(("docs/plans/", "docs/brainstorms/", "..")):
                        via[rel] = doc
                        queue.append(rel)
                    break
    return via

budget_rows = []
if os.path.exists(os.path.join(root, ENTRYPOINT)):
    limits, exempt, ceilings = {}, [], {}
    with open(BUDGETS_TSV) as f:
        for line in f:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if parts[0] == "budget" and len(parts) == 3:
                limits[parts[1]] = int(parts[2])
            elif parts[0] == "exempt" and len(parts) == 2:
                exempt.append(parts[1])
            elif parts[0] == "ceiling" and len(parts) == 3:
                ceilings[parts[1]] = int(parts[2])
            else:
                problems.append(f"scripts/doc-budgets.tsv: malformed row: {line.rstrip()!r}")
    via = reachable_docs()
    new_ceilings, stale = {}, []  # stale: what `gen` fixes by rewriting ceilings
    for doc, parent in via.items():
        words = len(open(os.path.join(root, doc), encoding="utf-8").read().split())
        if any(doc.startswith(p) for p in exempt):
            budget_rows.append((words, None, None, "exempt", doc, parent))
            continue
        limit = limits.get(doc, limits["*"])
        ceiling = ceilings.get(doc)
        status = "ok" if words <= limit else "grandfathered"
        if ceiling is None and words > limit:
            status = "OVER"
            problems.append(f"{doc}: {words} words, over its {limit}-word budget — split or trim it "
                            "(rules: docs/specs/README.md)")
        elif ceiling is not None and words > ceiling:
            status = "OVER"
            new_ceilings[doc] = ceiling
            problems.append(f"{doc}: {words} words, over its grandfathered ceiling of {ceiling} "
                            f"(budget {limit}) — trim or split it; a ceiling never rises")
        elif ceiling is not None and words > limit:
            new_ceilings[doc] = words
            if words < ceiling:
                stale.append(f"{doc}: {words} words, under its ceiling of {ceiling} — "
                             "run ./boga docs gen to lower it")
        elif ceiling is not None:
            stale.append(f"{doc}: {words} words fits its {limit}-word budget — "
                         "run ./boga docs gen to drop its ceiling row")
        budget_rows.append((words, limit, ceiling, status, doc, parent))
    for doc in sorted(set(ceilings) - {r[4] for r in budget_rows if r[3] != "exempt"}):
        stale.append(f"scripts/doc-budgets.tsv: ceiling for '{doc}', which is not a budgeted doc "
                     "(not reachable from AGENTS.md, or exempt) — run ./boga docs gen to drop it")
    if mode == "gen" and new_ceilings != ceilings:
        kept = [l for l in open(BUDGETS_TSV) if not l.startswith("ceiling\t")]
        rows = [f"ceiling\t{d}\t{n}\n" for d, n in sorted(new_ceilings.items())]
        open(BUDGETS_TSV, "w").write("".join(kept).rstrip("\n") + "\n" + "".join(rows))
        print("[gen-docs] lowered grandfathered ceilings in scripts/doc-budgets.tsv")
    elif mode != "gen":
        problems += stale

if mode == "budgets":
    print(f"{'words':>6}  {'budget':>6}  {'ceiling':>7}  {'status':<13}  doc  (loaded via)")
    for words, limit, ceiling, status, doc, parent in sorted(budget_rows, reverse=True):
        print(f"{words:6}  {limit or '-':>6}  {ceiling or '-':>7}  {status:<13}  {doc}  ({parent or 'entrypoint'})")
    budgeted = [r for r in budget_rows if r[3] != "exempt"]
    print(f"\n{len(budgeted)} budgeted docs, {sum(r[0] for r in budgeted)} words; "
          f"{sum(r[0] > r[1] for r in budgeted)} over budget by "
          f"{sum(r[0] - r[1] for r in budgeted if r[0] > r[1])} words in total")
    sys.exit(0)

if problems:
    print(f"[gen-docs] {len(problems)} problem(s):", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"[gen-docs] {mode} OK")
PY
