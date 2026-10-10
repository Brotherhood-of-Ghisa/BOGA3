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
#        plan file or names a milestone/task ID (plans are ephemeral;
#        AGENTS.md "Planning"; exemptions: scripts/plan-ref-exempt.txt).
#      - no tracked or new text file holds a merge-conflict marker line
#        (`<<<<<<< `, `||||||| `, `>>>>>>> `),
#      - every repo path cited in a persistent doc exists, never at a line,
#      - the components catalog names every `components/ui/*.tsx` primitive and
#        every `components/<area>/` folder, and no row names a folder that is
#        gone (so adding a component forces a catalog edit),
#      - every doc reachable from AGENTS.md fits its word budget, and each
#        `corpus` directory fits its combined one
#        (scripts/doc-budgets.tsv; `gen` lowers grandfathered ceilings),
#      - product facts (docs/product/README.md): every fact heading parses,
#        IDs are unique, every `[[id]]` and fact-table marker names a fact,
#        every fact's statement fits the per-fact word cap, and a fact's
#        `Signature:` text appears outside docs/product/ only in a paragraph
#        that cites it,
#      - no file under docs/specs/ui/design-targets/: a design target is a
#        build input, kept with the task or PR (docs/specs/ui/ai-design-policy.md).

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
# 4b. ...nor named: no milestone, task, task-decision, acceptance-criterion
#     or plan-section ID (`M<n>`, `<PLAN>-T<nn>` such as `M<n>-T<nn>`,
#     `T<nn>-D<n>`, `T-<YYYYMMDD>-<nn>`, `AC<n>`, `C<n>.<n>`)
#     outside the working-notes trees. A bare `M<n>` followed by a number is
#     SVG path data (`M12 4`, `M2.18`), not a milestone; rule keys a spec
#     defines (`T1`, `D14`, `E0.3`) are not plan IDs. scripts/plan-ref-exempt.txt lists applied migrations (history,
#     left as they are) and files still being cleaned (that list only shrinks).
PLAN_ID = re.compile(r"(?<![A-Za-z0-9_-])(?:[A-Z][A-Z0-9]{0,4}-T\d{2}(?:-D\d+)?|T\d{2}-D\d+|T-20\d{6}-\d{2}|AC\d{1,2}\b|C\d{1,2}(?:\.\d+)+\b"
                     r"|M\d{1,3}(?! ?\d|\.\d|[A-Za-z0-9_]))")
plan_id_exempt, plan_id_applied, plan_id_hits = set(), [], set()
PLAN_ID_EXEMPT = os.path.join(root, "scripts/plan-ref-exempt.txt")
with open(PLAN_ID_EXEMPT) if os.path.exists(PLAN_ID_EXEMPT) else open(os.devnull) as f:
    for line in f:
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0] == "applied" and len(parts) == 3:
            plan_id_applied.append((parts[1], parts[2]))
        elif parts[0] == "derived" and len(parts) == 2:
            plan_id_applied.append((parts[1], None))
        elif len(parts) == 1:
            plan_id_exempt.add(parts[0])
        else:
            problems.append(f"scripts/plan-ref-exempt.txt: malformed row: {line.rstrip()!r}")

def plan_id_history(rel):
    """An applied migration (named at or before its folder's last applied one)
    or a file derived from them."""
    for prefix, last in plan_id_applied:
        if last is None and rel == prefix:
            return True
        if last is not None and rel.startswith(prefix) and "/" not in rel[len(prefix):] \
                and rel[len(prefix):] <= last:
            return True
    return False
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
    for m in PLAN_ID.finditer(text):
        plan_id_hits.add(rel)
        if rel not in plan_id_exempt and not plan_id_history(rel):
            ln = text.count("\n", 0, m.start()) + 1
            problems.append(f"{rel}:{ln}: names milestone/task '{m.group(0)}' — plans are ephemeral; "
                            "state the rule or behaviour itself")
    if "plans/" not in text:
        continue
    for ln, line in enumerate(text.splitlines(), 1):
        for m in PLAN_REF.finditer(line):
            target = m.group(1)
            if target == "README.md" or target.startswith("templates/"):
                continue
            problems.append(f"{rel}:{ln}: references plan file {m.group(0)} — plans are ephemeral; cite the owning spec instead")

for rel in sorted(plan_id_exempt - plan_id_hits):
    problems.append(f"scripts/plan-ref-exempt.txt: '{rel}' names no milestone or task any more — remove its row")

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

# 7. the components catalog stays an inventory, not a snapshot. A hand-written
#    catalog rots silently: the pre-trim one had drifted to omit 10 of 21
#    folders while still reading as authoritative. The descriptions are the
#    valuable half and cannot be generated, so instead of generating the table
#    we fail when it falls out of step with the tree in either direction.
#    Adding a primitive or a component folder therefore forces a catalog edit.
CATALOG_REL = "docs/specs/ui/components-catalog.md"
CATALOG = os.path.join(root, CATALOG_REL)
UI_DIR = os.path.join(root, "apps/mobile/components/ui")
COMPONENTS_DIR = os.path.join(root, "apps/mobile/components")
# Non-visual support modules under components/ui/: colour maths and the barrel.
# They are not primitives a screen reaches for, so the catalog need not list
# them. `.ts` files are exempt as a class; only `.tsx` must be named.
if os.path.exists(CATALOG) and os.path.isdir(UI_DIR):
    catalog_src = open(CATALOG).read()
    for entry in sorted(os.listdir(UI_DIR)):
        if not entry.endswith(".tsx"):
            continue
        if f"`{entry}`" not in catalog_src:
            problems.append(f"{CATALOG_REL}: primitive 'apps/mobile/components/ui/{entry}' is not named "
                            "in the Primitives table — add the row that says what to reach for it for")
    for entry in sorted(os.listdir(COMPONENTS_DIR)):
        if entry == "ui" or not os.path.isdir(os.path.join(COMPONENTS_DIR, entry)):
            continue
        if f"`{entry}/`" not in catalog_src:
            problems.append(f"{CATALOG_REL}: component folder 'apps/mobile/components/{entry}/' has no row "
                            "in 'Shared components by area' — add it with a one-line description")
    # The reverse direction: a row naming a folder that no longer exists.
    for folder in sorted(set(re.findall(r"^\| `([a-z0-9-]+)/` \|", catalog_src, re.M))):
        if not os.path.isdir(os.path.join(COMPONENTS_DIR, folder)):
            problems.append(f"{CATALOG_REL}: row names 'apps/mobile/components/{folder}/', which does not exist")

# 8. word budgets for the docs an agent can load: AGENTS.md and every
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

budget_rows, corpus_rows = [], []
if os.path.exists(os.path.join(root, ENTRYPOINT)):
    limits, exempt, ceilings, corpora = {}, [], {}, {}
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
            elif parts[0] == "corpus" and len(parts) == 3 and parts[1].endswith("/"):
                corpora[parts[1]] = int(parts[2])
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
    # A corpus is a directory an agent loads whole, so its docs share one
    # budget on top of their own.
    for prefix, limit in sorted(corpora.items()):
        docs = [rel for rel in PERSISTENT_DOCS if rel.startswith(prefix)]
        words = sum(len(open(os.path.join(root, rel), encoding="utf-8").read().split()) for rel in docs)
        corpus_rows.append((words, limit, prefix, len(docs)))
        if words > limit:
            problems.append(f"{prefix}: {words} words in {len(docs)} docs, over its {limit}-word corpus "
                            "budget — trim it; it is loaded whole (rules: docs/specs/README.md)")

# 9. product facts (docs/product/README.md, "Fact format"). Every `### `
#    heading in a subject file is a fact header `### <subject>.<slug> · <kind>
#    · <status>` whose subject is the file's name, and IDs are unique. Every
#    `[[id]]` and `<!-- fact-table: <id> -->` in a persistent doc names a fact.
#    A fact's `Signature:` texts (literal, case- and wrap-insensitive) appear
#    outside docs/product/ only in a paragraph that cites the fact: anything
#    else restates it. Paragraphs split at blank lines outside fenced code, so
#    fenced code counts too.
#    Every fact's statement fits FACT_STATEMENT_WORDS. The statement is what an
#    agent must read to apply the fact: the lines between the header and the
#    `Why:` trailer, less the `<!-- fact-table -->` example rows (those are test
#    fixtures, bounded by the corpus budget, not by this cap). A fact over the
#    cap is stating a screen rather than a decision — split it, or move the
#    render detail to the component that owns it.
PRODUCT_DIR = "docs/product/"
PRODUCT_NON_FACT = {"README.md", "REVIEW.md"}
FACT_STATEMENT_WORDS = 130
FACT_KINDS = {"definition", "calculation", "presentation", "principle"}
FACT_HEADER = re.compile(r"^### (\S+) · (\S+) · (.+?)\s*$")
FACT_ID = re.compile(r"^([a-z0-9]+)\.[a-z0-9]+(?:-[a-z0-9]+)*$")
FACT_REF = re.compile(r"\[\[([^\[\]\s<>]+\.[^\[\]\s<>]+)\]\]")
FACT_TABLE = re.compile(r"<!-- fact-table: ([^\s<>]+) -->")
SIGNATURE = re.compile(r"^Signature:(.*)$")

def statement_words(rel):
    """fact id -> words of statement: header to `Why:`, less fact-table examples."""
    out, current, examples = {}, None, False
    for line in open(os.path.join(root, rel), encoding="utf-8"):
        line = line.rstrip("\n")
        if line.startswith("### "):
            m = FACT_HEADER.match(line)
            current, examples = (m.group(1) if m else None), False
            continue
        if current is None:
            continue
        if re.match(r"#{1,6} ", line) or line.startswith("Why:"):
            current = None  # the trailer (Why/Code/Pending/Signature) is not statement
            continue
        if FACT_TABLE.search(line):
            examples = True  # survives the blank line some facts leave before the table
            continue
        if not line.strip():
            continue
        if line.lstrip().startswith("|"):
            if examples:
                continue
            # Cell text only: the `|` rules and the `| --- |` separator are
            # syntax, and the format prefers tables over prose.
            cells = line.strip().strip("|").replace("|", " ")
            if not re.fullmatch(r"[\s:-]*", cells):
                out[current] = out.get(current, 0) + len(cells.split())
            continue
        examples = False
        out[current] = out.get(current, 0) + len(line.split())
    return out

def parse_fact_file(rel, facts, signatures):
    """Fill facts (id -> (rel, line, status)) and signatures (id -> texts)."""
    subject = os.path.basename(rel)[:-len(".md")]
    current, fenced = None, False
    for ln, line in enumerate(open(os.path.join(root, rel), encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if fenced:
            continue
        if line.startswith("### "):
            current = parse_fact_header(rel, ln, line, subject, facts)
            continue
        if re.match(r"#{1,6} ", line):
            current = None  # a Signature under another section belongs to no fact
            if re.match(r"#+ \S+\.\S+ · ", line):
                problems.append(f"{rel}:{ln}: fact header at the wrong level — a fact is a '### ' heading")
            continue
        sig = SIGNATURE.match(line)
        if not sig:
            continue
        texts = re.findall(r"`([^`]+)`", sig.group(1))
        if current is None or not texts or re.sub(r"`[^`]+`|[,\s]", "", sig.group(1)):
            problems.append(f"{rel}:{ln}: malformed Signature line — under a fact header, write "
                            "`Signature: `<text>`, `<text>``")
        else:
            signatures.setdefault(current, []).extend(texts)

def parse_fact_header(rel, ln, line, subject, facts):
    """The fact ID a header line opens, or None (reported) when it is malformed."""
    m = FACT_HEADER.match(line)
    fid_ok = m and FACT_ID.match(m.group(1))
    if not fid_ok:
        problems.append(f"{rel}:{ln}: malformed fact header {line!r} — expected "
                        "'### <subject>.<slug> · <kind> · <status>'")
        return None
    fid, kind, status = m.groups()
    if fid_ok.group(1) != subject:
        problems.append(f"{rel}:{ln}: fact '{fid}' is in {subject}.md — a fact lives in its subject's file")
    if kind not in FACT_KINDS:
        problems.append(f"{rel}:{ln}: fact '{fid}' has unknown kind '{kind}' — one of {', '.join(sorted(FACT_KINDS))}")
    if status not in ("accepted", "open") and not re.fullmatch(r"superseded-by: \S+", status):
        problems.append(f"{rel}:{ln}: fact '{fid}' has unknown status '{status}' — accepted, open "
                        "or superseded-by: <id>")
    if fid in facts:
        first, first_ln, _ = facts[fid]
        problems.append(f"{rel}:{ln}: duplicate fact ID '{fid}' (first at {first}:{first_ln})")
        return fid
    facts[fid] = (rel, ln, status)
    return fid

def paragraphs(text):
    """(first line number, text) per blank-line-separated block; fenced code never splits."""
    out, buf, start, fenced = [], [], 1, False
    for ln, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if not line.strip() and not fenced:
            if buf:
                out.append((start, "\n".join(buf)))
            buf = []
            continue
        if not buf:
            start = ln
        buf.append(line)
    if buf:
        out.append((start, "\n".join(buf)))
    return out

def signature_pattern(text):
    body = r"\s+".join(re.escape(word) for word in text.split())
    head = r"(?<!\w)" if re.match(r"\w", text) else ""
    tail = r"(?!\w)" if re.search(r"\w$", text) else ""
    return re.compile(head + body + tail, re.I)

def restatements(signatures):
    """(doc, fact) -> [(line, text)], one per uncited paragraph outside docs/product/."""
    patterns = {fid: [(t, signature_pattern(t)) for t in texts] for fid, texts in signatures.items()}
    found = {}
    for rel in PERSISTENT_DOCS:
        if rel.startswith(PRODUCT_DIR):
            continue
        for start, para in paragraphs(open(os.path.join(root, rel), encoding="utf-8").read()):
            cited = set(FACT_REF.findall(para))
            for fid, pats in patterns.items():
                hits = [(m.start(), t) for t, p in pats for m in [p.search(para)] if m and fid not in cited]
                if hits:
                    pos, text = min(hits)
                    found.setdefault((rel, fid), []).append((start + para.count("\n", 0, pos), text))
    return found

facts, signatures, fact_words = {}, {}, {}
for rel in PERSISTENT_DOCS:
    if (rel.startswith(PRODUCT_DIR) and "/" not in rel[len(PRODUCT_DIR):]
            and os.path.basename(rel) not in PRODUCT_NON_FACT):
        parse_fact_file(rel, facts, signatures)
        fact_words.update(statement_words(rel))
for fid, (rel, ln, status) in sorted(facts.items()):
    words = fact_words.get(fid, 0)
    if words > FACT_STATEMENT_WORDS:
        problems.append(f"{rel}:{ln}: fact '{fid}' states {words} words, over the "
                        f"{FACT_STATEMENT_WORDS}-word cap — state the decision, not the screen: split "
                        "it, or move render detail to the component that owns it "
                        "(rules: docs/product/README.md)")
for fid, (rel, ln, status) in sorted(facts.items()):
    target = status.split(": ", 1)[1] if status.startswith("superseded-by: ") else None
    if target is not None and target not in facts:
        problems.append(f"{rel}:{ln}: fact '{fid}' is superseded by '{target}', which is no fact")
for rel in PERSISTENT_DOCS:
    for ln, line in enumerate(open(os.path.join(root, rel), encoding="utf-8"), 1):
        for fid in FACT_REF.findall(line) + FACT_TABLE.findall(line):
            if fid not in facts:
                problems.append(f"{rel}:{ln}: '{fid}' names no fact in {PRODUCT_DIR} — fix the ID")

for (rel, fid), hits in sorted(restatements(signatures).items()):
    for ln, text in hits:
        problems.append(f"{rel}:{ln}: restates [[{fid}]] ('{text}') — cite [[{fid}]] in this "
                        "paragraph, or state only what the doc owns")

# 10. design targets are build inputs, never specs (ui/ai-design-policy.md):
#     nothing tracked or new lives under docs/specs/ui/design-targets/.
DESIGN_TARGETS = "docs/specs/ui/design-targets/"
for rel in sorted(r for r in listed if r.startswith(DESIGN_TARGETS)
                  and os.path.exists(os.path.join(root, r))):
    problems.append(f"{rel}: design targets are build inputs, not specs — keep the brief in the task "
                    "or PR and move what must last to its owner (docs/specs/ui/ai-design-policy.md)")

if mode == "budgets":
    print(f"{'words':>6}  {'budget':>6}  {'ceiling':>7}  {'status':<13}  doc  (loaded via)")
    for words, limit, ceiling, status, doc, parent in sorted(budget_rows, reverse=True):
        print(f"{words:6}  {limit or '-':>6}  {ceiling or '-':>7}  {status:<13}  {doc}  ({parent or 'entrypoint'})")
    budgeted = [r for r in budget_rows if r[3] != "exempt"]
    print(f"\n{len(budgeted)} budgeted docs, {sum(r[0] for r in budgeted)} words; "
          f"{sum(r[0] > r[1] for r in budgeted)} over budget by "
          f"{sum(r[0] - r[1] for r in budgeted if r[0] > r[1])} words in total")
    for words, limit, prefix, count in corpus_rows:
        print(f"corpus {prefix}: {words} of {limit} words in {count} docs ({'ok' if words <= limit else 'OVER'})")
    if fact_words:
        ranked = sorted(fact_words.items(), key=lambda kv: -kv[1])
        over = [f"{fid} ({n})" for fid, n in ranked if n > FACT_STATEMENT_WORDS]
        print(f"\n{len(fact_words)} product facts, {sum(fact_words.values())} statement words; "
              f"largest {ranked[0][1]}, median {sorted(fact_words.values())[len(fact_words) // 2]}, "
              f"cap {FACT_STATEMENT_WORDS}")
        print(f"over the cap: {', '.join(over) if over else 'none'}")
    sys.exit(0)

if problems:
    print(f"[gen-docs] {len(problems)} problem(s):", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"[gen-docs] {mode} OK")
PY
