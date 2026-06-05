#!/usr/bin/env bash
#
# Regression test for the "locked by a dead agent PID" completion signal in
# scripts/worktree-sweep.sh (and the boga_worktree_lock_pid / boga_pid_is_alive
# helpers in scripts/worktree-lib.sh).
#
# It builds a throwaway git repo with two registered worktree slots:
#   - one locked by a PID that is dead   -> must be reaped + cleaned
#   - one locked by a PID that is alive  -> must be kept
# and exercises dry-run, real, and --no-dead-lock-detection runs.
#
# Self-contained: no Supabase/Docker (runs with --no-supabase) and no network
# (runs with --no-merge-detection --no-fetch). Run directly:
#   bash scripts/tests/worktree-sweep-dead-lock.test.sh

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_SCRIPTS="$(cd -- "$THIS_DIR/.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }

assert_eq() { # actual expected label
  if [[ "$1" == "$2" ]]; then pass "$3"; else fail "$3 (got '$1' want '$2')"; fi
}
assert_ok() { # label cmd...
  local label="$1"; shift
  if "$@"; then pass "$label"; else fail "$label"; fi
}
assert_not_ok() { # label cmd...
  local label="$1"; shift
  if "$@"; then fail "$label"; else pass "$label"; fi
}
assert_contains() { # haystack needle label
  if grep -qF -- "$2" <<<"$1"; then pass "$3"; else fail "$3 (missing: '$2')"; fi
}

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
# Resolve symlinks (macOS /var -> /private/var) so every path matches the
# pwd -P canonicalization that boga_abs_dir / git worktree list use.
WORK="$(cd "$WORK" && pwd -P)"

export BOGA_CONFIG_ROOT="$WORK/config"
REGISTRY_DIR="$BOGA_CONFIG_ROOT/worktrees/slots"
mkdir -p "$REGISTRY_DIR"

REPO="$WORK/main"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Test"

# BOGA repo-root markers so boga_is_repo_root() passes in every linked worktree.
# Each marker dir needs a tracked file — git does not record empty directories,
# so they would otherwise be absent from the worktree checkouts.
mkdir -p "$REPO/docs/specs" "$REPO/apps/mobile" "$REPO/supabase" "$REPO/scripts"
: >"$REPO/AGENTS.md"
: >"$REPO/docs/specs/README.md"
: >"$REPO/apps/mobile/.keep"
: >"$REPO/supabase/.keep"
# Exercise the freshly-edited scripts under test.
cp "$SRC_SCRIPTS/worktree-lib.sh" "$SRC_SCRIPTS/worktree-sweep.sh" "$SRC_SCRIPTS/worktree-clean.sh" "$REPO/scripts/"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "scaffold"

COMMON_GIT_DIR="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"

register_slot() { # slot path
  cat >"$REGISTRY_DIR/$1" <<EOF
slot=$1
project_id=BOGA-test-wt$1
path=$2
common_git_dir=$COMMON_GIT_DIR
updated_at=2000-01-01T00:00:00Z
EOF
}

add_locked_worktree() { # name pid -> prints worktree path
  local name="$1" pid="$2" path="$REPO/.claude/worktrees/$1"
  git -C "$REPO" worktree add -q -b "$name" "$path" main
  git -C "$REPO" worktree lock --reason "claude agent $name (pid $pid)" "$path"
  printf '%s\n' "$path"
}

# A PID that has already exited: a child shell prints its own pid, then dies.
# (No backgrounding — a forked-but-killed child would run our EXIT trap.)
DEAD_PID="$(bash -c 'echo $$')"
ALIVE_PID=$$  # this test process stays alive for the whole run

DEAD_WT="$(add_locked_worktree dead-agent "$DEAD_PID")"
ALIVE_WT="$(add_locked_worktree live-agent "$ALIVE_PID")"
register_slot 21 "$DEAD_WT"
register_slot 22 "$ALIVE_WT"

SWEEP="$REPO/scripts/worktree-sweep.sh"
BASE_ARGS=(--no-supabase --no-merge-detection --no-fetch --grace-seconds 0 --current-slot 0)

in_worktree_list() { git -C "$REPO" worktree list --porcelain | grep -qx "worktree $1"; }

echo "== unit: boga_worktree_lock_pid / boga_pid_is_alive =="
# shellcheck disable=SC1091
source "$REPO/scripts/worktree-lib.sh"
assert_eq "$(boga_worktree_lock_pid "$REPO" "$DEAD_WT" || echo MISS)" "$DEAD_PID" "lock_pid reads dead worktree pid"
assert_eq "$(boga_worktree_lock_pid "$REPO" "$ALIVE_WT" || echo MISS)" "$ALIVE_PID" "lock_pid reads live worktree pid"
assert_ok     "pid_is_alive: true for live pid"  boga_pid_is_alive "$ALIVE_PID"
assert_not_ok "pid_is_alive: false for dead pid" boga_pid_is_alive "$DEAD_PID"

echo "== dry-run: detect + plan, change nothing =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" --dry-run 2>&1)"
assert_contains "$out" "completed slot 21 detected (locked-by-dead-agent-pid-$DEAD_PID)" "dead slot 21 flagged"
assert_contains "$out" "reaping abandoned git worktree for slot 21" "dead slot 21 reap announced"
assert_contains "$out" "dry-run: git -C $REPO worktree remove --force $DEAD_WT" "dead slot 21 remove planned"
assert_contains "$out" "keeping slot 22: registered worktree still looks active" "live slot 22 kept"
assert_ok "dry-run left dead worktree registered" in_worktree_list "$DEAD_WT"
assert_ok "dry-run left dead registry" test -f "$REGISTRY_DIR/21"

echo "== --no-dead-lock-detection: signal off, dead slot kept =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" --no-dead-lock-detection 2>&1)"
assert_contains "$out" "keeping slot 21: registered worktree still looks active" "dead slot 21 kept when detection off"
assert_ok "detection-off left dead worktree" in_worktree_list "$DEAD_WT"
assert_ok "detection-off left dead registry" test -f "$REGISTRY_DIR/21"

echo "== real run: reap dead, keep live =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" 2>&1)"
assert_contains "$out" "completed slot 21 detected (locked-by-dead-agent-pid-$DEAD_PID)" "real run flagged dead slot 21"
assert_not_ok "real run removed dead worktree from git" in_worktree_list "$DEAD_WT"
assert_not_ok "real run removed dead worktree dir" test -e "$DEAD_WT"
assert_not_ok "real run removed dead registry" test -f "$REGISTRY_DIR/21"
assert_ok "real run kept live worktree" in_worktree_list "$ALIVE_WT"
assert_ok "real run kept live registry" test -f "$REGISTRY_DIR/22"

echo
echo "== summary: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
