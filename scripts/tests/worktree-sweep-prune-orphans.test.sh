#!/usr/bin/env bash
#
# Hermetic test for the docker-ground-truth eviction path:
#   - scripts/worktree-sweep.sh --prune-orphans  (classify + evict by exact label)
#   - scripts/worktree-clean.sh  fail-loud guard  (never drop a registry when the
#     Supabase cleanup it was paired with could not run)
#
# No real Docker: a stub `docker` on PATH reports a fixed set of Supabase project
# labels and records every removal. The safety model under test (classify_label):
#   live agent lock          -> KEEP
#   idle NON-agent worktree  -> KEEP  (human checkout; never nuked here)
#   dead agent lock          -> EVICT
#   abandoned agent worktree -> EVICT (unlocked, under .claude/worktrees)
#   no backing worktree      -> EVICT (orphan)
#
# Run directly:  bash scripts/tests/worktree-sweep-prune-orphans.test.sh

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_SCRIPTS="$(cd -- "$THIS_DIR/.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }
assert_contains() { if grep -qF -- "$2" <<<"$1"; then pass "$3"; else fail "$3 (missing: '$2')"; fi; }
assert_not_contains() { if grep -qF -- "$2" <<<"$1"; then fail "$3 (unexpected: '$2')"; else pass "$3"; fi; }
assert_file() { if [[ -f "$1" ]]; then pass "$2"; else fail "$2 (missing file $1)"; fi; }
assert_no_file() { if [[ -f "$1" ]]; then fail "$2 (unexpected file $1)"; else pass "$2"; fi; }

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
WORK="$(cd "$WORK" && pwd -P)"

export BOGA_CONFIG_ROOT="$WORK/config"
REGISTRY_DIR="$BOGA_CONFIG_ROOT/worktrees/slots"
mkdir -p "$REGISTRY_DIR"

REPO="$WORK/main"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Test"
mkdir -p "$REPO/docs/specs" "$REPO/apps/mobile" "$REPO/supabase" "$REPO/scripts"
: >"$REPO/AGENTS.md"
: >"$REPO/docs/specs/README.md"
: >"$REPO/apps/mobile/.keep"
: >"$REPO/supabase/.keep"
cp "$SRC_SCRIPTS/worktree-lib.sh" "$SRC_SCRIPTS/worktree-sweep.sh" "$SRC_SCRIPTS/worktree-clean.sh" "$REPO/scripts/"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "scaffold"

# shellcheck disable=SC1091
source "$REPO/scripts/worktree-lib.sh"

DEAD_PID="$(bash -c 'echo $$')"   # a pid that has already exited
ALIVE_PID=$$

register_slot() { # slot path
  cat >"$REGISTRY_DIR/$1" <<EOF
slot=$1
project_id=ignored-classify-derives-from-worktree
path=$2
common_git_dir=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)
updated_at=2000-01-01T00:00:00Z
EOF
}

# name slot mode(none|live|dead) basedir -> prints worktree path
add_slot_worktree() {
  local name="$1" slot="$2" mode="$3" base="${4:-$REPO/.claude/worktrees}"
  local path="$base/$name"
  git -C "$REPO" worktree add -q -b "$name" "$path" main
  printf '%s\n' "$slot" >"$path/.worktree-slot"
  case "$mode" in
    live) git -C "$REPO" worktree lock --reason "claude agent $name (pid $ALIVE_PID start Mon Jan  1 00:00:00 2024)" "$path" ;;
    dead) git -C "$REPO" worktree lock --reason "claude agent $name (pid $DEAD_PID start Mon Jan  1 00:00:00 2024)" "$path" ;;
  esac
  printf '%s\n' "$path"
}

LIVE_WT="$(add_slot_worktree live-prune 51 live)"
DEAD_WT="$(add_slot_worktree dead-prune 52 dead)"
ABAND_WT="$(add_slot_worktree aband-prune 53 none)"
HUMAN_WT="$(add_slot_worktree human-prune 54 none "$WORK")"   # NOT under .claude/worktrees
register_slot 51 "$LIVE_WT"
register_slot 52 "$DEAD_WT"
register_slot 53 "$ABAND_WT"
register_slot 54 "$HUMAN_WT"
register_slot 55 "$WORK/gone-orphan"   # orphan: registry points at a vanished path

LIVE_LABEL="$(boga_project_id_for_slot 51 "$LIVE_WT")"
DEAD_LABEL="$(boga_project_id_for_slot 52 "$DEAD_WT")"
ABAND_LABEL="$(boga_project_id_for_slot 53 "$ABAND_WT")"
HUMAN_LABEL="$(boga_project_id_for_slot 54 "$HUMAN_WT")"
ORPHAN_LABEL="BOGA-orphan-prune-wt55"

# ---- docker stub -----------------------------------------------------------
STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export STUB_LABELS="$WORK/labels"
export STUB_REMOVED="$WORK/removed"
printf '%s\n' "$LIVE_LABEL" "$DEAD_LABEL" "$ABAND_LABEL" "$HUMAN_LABEL" "$ORPHAN_LABEL" >"$STUB_LABELS"
: >"$STUB_REMOVED"
cat >"$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
KEY="com.supabase.cli.project"
have_format=0
filter_val=""
for a in "$@"; do
  [[ "$a" == "--format" ]] && have_format=1
  case "$a" in label=$KEY=*) filter_val="${a#label=$KEY=}" ;; esac
done
case "${1:-}" in
  info) [[ "${STUB_DOCKER_DOWN:-0}" == "1" ]] && exit 1; exit 0 ;;
  ps)
    if (( have_format )); then cat "$STUB_LABELS" 2>/dev/null || true
    elif [[ -n "$filter_val" ]]; then echo "${filter_val}__c"; fi ;;
  volume)
    case "${2:-}" in
      ls) if (( have_format )); then cat "$STUB_LABELS" 2>/dev/null || true
          elif [[ -n "$filter_val" ]]; then echo "${filter_val}__v"; fi ;;
      rm) for x in "$@"; do [[ "$x" == *__v ]] && echo "${x%__v}" >>"$STUB_REMOVED"; done ;;
    esac ;;
  network)
    case "${2:-}" in
      ls) [[ -n "$filter_val" ]] && echo "${filter_val}__n" ;;
      rm) for x in "$@"; do [[ "$x" == *__n ]] && echo "${x%__n}" >>"$STUB_REMOVED"; done ;;
    esac ;;
  rm) for x in "$@"; do [[ "$x" == *__c ]] && echo "${x%__c}" >>"$STUB_REMOVED"; done ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/docker"
export PATH="$STUB_DIR:$PATH"

SWEEP="$REPO/scripts/worktree-sweep.sh"
CLEAN="$REPO/scripts/worktree-clean.sh"

echo "== prune-orphans --dry-run: classify, change nothing =="
out="$(bash "$SWEEP" --prune-orphans --dry-run 2>&1)"
assert_contains "$out" "keeping $LIVE_LABEL: live agent pid $ALIVE_PID" "live agent kept"
assert_contains "$out" "keeping $HUMAN_LABEL: idle non-agent worktree" "human checkout kept"
assert_contains "$out" "evicting $DEAD_LABEL: dead-agent lock (pid $DEAD_PID)" "dead agent evicted"
assert_contains "$out" "evicting $ABAND_LABEL: abandoned agent worktree" "abandoned agent evicted"
assert_contains "$out" "evicting $ORPHAN_LABEL: orphan" "orphan evicted"
assert_contains "$out" "dry-run: docker rm -f ${DEAD_LABEL}__c" "dry-run plans container removal"
assert_contains "$out" "dry-run: rm -f $REGISTRY_DIR/52" "dry-run plans registry removal"
if [[ ! -s "$STUB_REMOVED" ]]; then pass "dry-run removed nothing"; else fail "dry-run removed something: $(cat "$STUB_REMOVED")"; fi
assert_file "$REGISTRY_DIR/52" "dry-run kept dead registry"

echo "== prune-orphans real run: evict only the unbacked stacks =="
: >"$STUB_REMOVED"
out="$(bash "$SWEEP" --prune-orphans 2>&1)"
removed="$(sort -u "$STUB_REMOVED")"
assert_contains "$removed" "$DEAD_LABEL" "real run removed dead stack"
assert_contains "$removed" "$ABAND_LABEL" "real run removed abandoned stack"
assert_contains "$removed" "$ORPHAN_LABEL" "real run removed orphan stack"
assert_not_contains "$removed" "$LIVE_LABEL" "real run never removed live stack"
assert_not_contains "$removed" "$HUMAN_LABEL" "real run never removed human stack"
assert_no_file "$REGISTRY_DIR/52" "dead registry removed"
assert_no_file "$REGISTRY_DIR/53" "abandoned registry removed"
assert_no_file "$REGISTRY_DIR/55" "orphan registry removed"
assert_file "$REGISTRY_DIR/51" "live registry kept"
assert_file "$REGISTRY_DIR/54" "human registry kept"
assert_contains "$out" "prune-orphans done: 3 evicted, 2 kept" "summary counts correct"

echo "== worktree-clean fail-loud: docker down must NOT drop the registry =="
register_slot 60 "$WORK/whatever-60"
clean_rc=0
out="$(STUB_DOCKER_DOWN=1 bash "$CLEAN" --slot 60 --supabase --remove-registry 2>&1)" || clean_rc=$?
if [[ "$clean_rc" -ne 0 ]]; then pass "clean exits non-zero when docker unavailable"; else fail "clean returned 0 despite docker down"; fi
assert_contains "$out" "refusing to remove slot registry" "clean refuses to orphan the stack"
assert_file "$REGISTRY_DIR/60" "registry preserved when supabase cleanup could not run"

echo
echo "== summary: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
