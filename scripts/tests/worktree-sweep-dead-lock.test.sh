#!/usr/bin/env bash
#
# Regression test for the "locked by a dead agent PID" completion signal in
# scripts/worktree-sweep.sh (and the boga_worktree_lock_pid / boga_pid_is_alive
# helpers in scripts/worktree-lib.sh).
#
# It builds a throwaway git repo covering both the registry-driven signal and the
# registry-less prune pass:
#   - registered slot locked by a dead PID  -> completed + reaped + cleaned
#   - registered slot locked by a live PID  -> kept
#   - registry-LESS worktree, dead PID      -> reaped by the prune pass
#   - registry-LESS worktree, live PID      -> kept
#   - registered dead worktree within grace -> deferred to the registry loop
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
assert_not_contains() { # haystack needle label
  if grep -qF -- "$2" <<<"$1"; then fail "$3 (unexpected: '$2')"; else pass "$3"; fi
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
  # Use the REAL Claude Code lock-reason format, which carries a ` start <date>`
  # suffix after the pid: `claude agent <name> (pid <N> start <date>)`. A fixture
  # using the older `(pid <N>)` form drifted from production and let a regex bug
  # (which only matched the closing-paren form) ship undetected — dead-agent
  # detection was a silent no-op for every real lock. Keep this fixture in lockstep
  # with reality; the legacy form is covered separately below.
  local name="$1" pid="$2" path="$REPO/.claude/worktrees/$1"
  git -C "$REPO" worktree add -q -b "$name" "$path" main
  git -C "$REPO" worktree lock --reason "claude agent $name (pid $pid start Mon Jan  1 00:00:00 2024)" "$path"
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

# Registry-less worktrees for the second (prune) pass: locked by a dead/live PID
# but deliberately never registered, so the registry scan can't see them.
ORPHAN_DEAD_WT="$(add_locked_worktree orphan-dead "$DEAD_PID")"
ORPHAN_LIVE_WT="$(add_locked_worktree orphan-live "$ALIVE_PID")"

SWEEP="$REPO/scripts/worktree-sweep.sh"
BASE_ARGS=(--no-supabase --no-merge-detection --no-fetch --grace-seconds 0 --current-slot 0)

in_worktree_list() { git -C "$REPO" worktree list --porcelain | grep -qx "worktree $1"; }

echo "== unit: boga_worktree_lock_pid / boga_pid_is_alive =="
# shellcheck disable=SC1091
source "$REPO/scripts/worktree-lib.sh"
assert_eq "$(boga_worktree_lock_pid "$REPO" "$DEAD_WT" || echo MISS)" "$DEAD_PID" "lock_pid reads dead worktree pid (real ' start' format)"
assert_eq "$(boga_worktree_lock_pid "$REPO" "$ALIVE_WT" || echo MISS)" "$ALIVE_PID" "lock_pid reads live worktree pid (real ' start' format)"
assert_ok     "pid_is_alive: true for live pid"  boga_pid_is_alive "$ALIVE_PID"
assert_not_ok "pid_is_alive: false for dead pid" boga_pid_is_alive "$DEAD_PID"

# Legacy lock reason without the ` start <date>` suffix must still parse, so the
# relaxed regex stays backward compatible with older harness versions.
LEGACY_WT="$REPO/.claude/worktrees/legacy-agent"
git -C "$REPO" worktree add -q -b legacy-agent "$LEGACY_WT" main
git -C "$REPO" worktree lock --reason "claude agent legacy-agent (pid $ALIVE_PID)" "$LEGACY_WT"
assert_eq "$(boga_worktree_lock_pid "$REPO" "$LEGACY_WT" || echo MISS)" "$ALIVE_PID" "lock_pid reads legacy '(pid N)' format"
git -C "$REPO" worktree unlock "$LEGACY_WT"
git -C "$REPO" worktree remove --force "$LEGACY_WT"

echo "== dry-run: detect + plan, change nothing =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" --dry-run 2>&1)"
assert_contains "$out" "completed slot 21 detected (locked-by-dead-agent-pid-$DEAD_PID)" "dead slot 21 flagged"
assert_contains "$out" "reaping abandoned git worktree for slot 21" "dead slot 21 reap announced"
assert_contains "$out" "dry-run: git -C $REPO worktree remove --force $DEAD_WT" "dead slot 21 remove planned"
assert_contains "$out" "keeping slot 22: registered worktree still looks active" "live slot 22 kept"
assert_ok "dry-run left dead worktree registered" in_worktree_list "$DEAD_WT"
assert_ok "dry-run left dead registry" test -f "$REGISTRY_DIR/21"
# Prune pass: registry-less dead orphan planned for reaping; live orphan untouched.
assert_contains "$out" "reaping registry-less worktree locked by dead pid $DEAD_PID: $ORPHAN_DEAD_WT" "orphan-dead reap planned"
assert_not_contains "$out" "$ORPHAN_LIVE_WT" "orphan-live (live pid) untouched"
assert_ok "dry-run left orphan-dead registered" in_worktree_list "$ORPHAN_DEAD_WT"

echo "== --no-dead-lock-detection: signal off, dead slot kept =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" --no-dead-lock-detection 2>&1)"
assert_contains "$out" "keeping slot 21: registered worktree still looks active" "dead slot 21 kept when detection off"
assert_ok "detection-off left dead worktree" in_worktree_list "$DEAD_WT"
assert_ok "detection-off left dead registry" test -f "$REGISTRY_DIR/21"
# Detection off must also disable the prune pass.
assert_not_contains "$out" "reaping registry-less worktree" "detection-off skips prune pass"
assert_ok "detection-off left orphan-dead" in_worktree_list "$ORPHAN_DEAD_WT"

echo "== real run: reap dead, keep live =="
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" 2>&1)"
assert_contains "$out" "completed slot 21 detected (locked-by-dead-agent-pid-$DEAD_PID)" "real run flagged dead slot 21"
assert_not_ok "real run removed dead worktree from git" in_worktree_list "$DEAD_WT"
assert_not_ok "real run removed dead worktree dir" test -e "$DEAD_WT"
assert_not_ok "real run removed dead registry" test -f "$REGISTRY_DIR/21"
assert_ok "real run kept live worktree" in_worktree_list "$ALIVE_WT"
assert_ok "real run kept live registry" test -f "$REGISTRY_DIR/22"
# Prune pass: registry-less dead orphan reaped; live orphan spared.
assert_contains "$out" "reaping registry-less worktree locked by dead pid $DEAD_PID: $ORPHAN_DEAD_WT" "real run reaped orphan-dead"
assert_not_ok "real run removed orphan-dead from git" in_worktree_list "$ORPHAN_DEAD_WT"
assert_not_ok "real run removed orphan-dead dir" test -e "$ORPHAN_DEAD_WT"
assert_ok "real run kept orphan-live worktree" in_worktree_list "$ORPHAN_LIVE_WT"

echo "== prune pass respects grace via the registry-backed loop =="
# A registry-backed dead worktree: the prune pass must defer to the registry
# loop (which honours --grace-seconds), never reaping it out from under it.
GRACED_WT="$(add_locked_worktree graced-dead "$DEAD_PID")"
register_slot 31 "$GRACED_WT"
out="$(bash "$SWEEP" --no-supabase --no-merge-detection --no-fetch --grace-seconds 3600 --current-slot 0 2>&1)"
assert_contains "$out" "keeping slot 31: registry younger than 3600s grace period" "graced slot 31 held by grace"
assert_not_contains "$out" "reaping registry-less worktree locked by dead pid $DEAD_PID: $GRACED_WT" "prune pass does not bypass grace"
assert_ok "graced worktree still present" in_worktree_list "$GRACED_WT"
# With no grace, the registry loop (not the prune pass) completes + reaps it.
out="$(bash "$SWEEP" "${BASE_ARGS[@]}" 2>&1)"
assert_contains "$out" "completed slot 31 detected (locked-by-dead-agent-pid-$DEAD_PID)" "graced slot 31 completes once grace passes"
assert_not_ok "graced worktree reaped after grace" in_worktree_list "$GRACED_WT"

echo "== live lock vetoes merge-detection eviction =="
# A live-locked worktree on a branch that does NOT exist on the remote would
# otherwise be evicted via branch-deleted-on-<remote>. The live lock must veto
# that, so an agent's Supabase is never torn out while it works on an unpushed
# branch. Merge detection is ON here (only --no-fetch, to stay offline); the test
# repo has no remote ref for the branch, so branch-deleted would fire without the veto.
VETO_WT="$(add_locked_worktree veto-live "$ALIVE_PID")"
register_slot 41 "$VETO_WT"
out="$(bash "$SWEEP" --no-supabase --no-fetch --grace-seconds 0 --current-slot 0 2>&1)"
assert_contains "$out" "keeping slot 41: registered worktree still looks active" "live lock vetoes branch-deleted eviction"
assert_not_contains "$out" "completed slot 41 detected" "live-locked slot 41 never marked completed"
assert_ok "veto worktree still present" in_worktree_list "$VETO_WT"
assert_ok "veto registry still present" test -f "$REGISTRY_DIR/41"

echo
echo "== summary: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
