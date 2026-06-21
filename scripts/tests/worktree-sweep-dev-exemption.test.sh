#!/usr/bin/env bash
#
# Hermetic regression test for the dedicated dev stack's sweep exemption.
#
# The dev Supabase stack (project_id BOGA-dev) is deliberately NOT backed by a
# git worktree, so worktree-sweep.sh's orphan classifier would read it as an
# orphan and evict it on the next `local-runtime-up.sh` — destroying the dev
# data the dev/test split exists to protect. worktree-sweep.sh special-cases it
# to KEEP. This test pins that: a BOGA-dev stack with NO backing worktree must be
# kept, while a genuine orphan beside it is still evicted.
#
# No real Docker: a stub `docker` on PATH reports a fixed set of project labels.
#
# Run directly:  bash scripts/tests/worktree-sweep-dev-exemption.test.sh

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_SCRIPTS="$(cd -- "$THIS_DIR/.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }
assert_contains() { if grep -qF -- "$2" <<<"$1"; then pass "$3"; else fail "$3 (missing: '$2')"; fi; }
assert_not_contains() { if grep -qF -- "$2" <<<"$1"; then fail "$3 (unexpected: '$2')"; else pass "$3"; fi; }

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

DEV_LABEL="$(boga_dev_project_id)"          # BOGA-dev — the stack under protection
ORPHAN_LABEL="BOGA-some-orphan-wt55"        # a genuine orphan beside it (control)
register_slot() { cat >"$REGISTRY_DIR/$1" <<EOF
slot=$1
project_id=ignored
path=$2
common_git_dir=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)
updated_at=2000-01-01T00:00:00Z
EOF
}
register_slot 55 "$WORK/gone-orphan"        # registry points at a vanished path

# ---- docker stub: report DEV_LABEL + ORPHAN_LABEL ----
STUB_DIR="$WORK/bin"; mkdir -p "$STUB_DIR"
export STUB_LABELS="$WORK/labels" STUB_REMOVED="$WORK/removed"
printf '%s\n' "$DEV_LABEL" "$ORPHAN_LABEL" >"$STUB_LABELS"
: >"$STUB_REMOVED"
cat >"$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
KEY="com.supabase.cli.project"
have_format=0; filter_val=""
for a in "$@"; do
  [[ "$a" == "--format" ]] && have_format=1
  case "$a" in label=$KEY=*) filter_val="${a#label=$KEY=}" ;; esac
done
case "${1:-}" in
  info) exit 0 ;;
  ps) if (( have_format )); then cat "$STUB_LABELS" 2>/dev/null || true
      elif [[ -n "$filter_val" ]]; then echo "${filter_val}__c"; fi ;;
  volume) case "${2:-}" in
      ls) if (( have_format )); then cat "$STUB_LABELS" 2>/dev/null || true
          elif [[ -n "$filter_val" ]]; then echo "${filter_val}__v"; fi ;;
      rm) for x in "$@"; do [[ "$x" == *__v ]] && echo "${x%__v}" >>"$STUB_REMOVED"; done ;;
    esac ;;
  network) case "${2:-}" in
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

echo "== --report: BOGA-dev kept, orphan evictable =="
out="$(bash "$SWEEP" --report 2>&1)"
assert_contains "$out" "$DEV_LABEL" "report lists the dev stack"
assert_contains "$out" "dedicated dev stack" "dev stack reason is the exemption"
# The verdict for the dev label's line must be KEEP, the orphan's EVICT.
dev_line="$(grep -F "$DEV_LABEL " <<<"$out" | grep -vF "$ORPHAN_LABEL" | head -1)"
assert_contains "$dev_line" "KEEP" "dev stack verdict is KEEP"

echo "== --prune-orphans: never remove BOGA-dev, still remove the orphan =="
: >"$STUB_REMOVED"
out="$(bash "$SWEEP" --prune-orphans 2>&1)"
removed="$(sort -u "$STUB_REMOVED")"
assert_contains "$out" "keeping $DEV_LABEL: dedicated dev stack" "prune keeps the dev stack"
assert_contains "$removed" "$ORPHAN_LABEL" "prune removed the genuine orphan"
assert_not_contains "$removed" "$DEV_LABEL" "prune NEVER removed the dev stack"

echo
echo "[dev-exemption] pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
