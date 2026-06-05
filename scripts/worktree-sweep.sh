#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

CURRENT_SLOT=""
SUPABASE=1
DRY_RUN=0
GRACE_SECONDS="${BOGA_WORKTREE_SWEEP_GRACE_SECONDS:-600}"
DETECT_MERGED="${BOGA_WORKTREE_SWEEP_DETECT_MERGED:-1}"
DETECT_DEAD_LOCKS="${BOGA_WORKTREE_SWEEP_DETECT_DEAD_LOCKS:-1}"
FETCH="${BOGA_WORKTREE_SWEEP_FETCH:-1}"
REMOTE="${BOGA_WORKTREE_SWEEP_REMOTE:-origin}"
MAIN_BRANCH="${BOGA_WORKTREE_SWEEP_MAIN_BRANCH:-main}"
FETCH_TIMEOUT_SECONDS="${BOGA_WORKTREE_SWEEP_FETCH_TIMEOUT_SECONDS:-10}"

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-sweep.sh [options]

Opportunistically cleans Supabase infrastructure for completed/orphaned BOGA
worktree slots recorded in ~/.config/boga/worktrees/slots.

A slot is considered completed when, after the grace period, ANY of these hold
for its registered worktree: the path is gone / no longer a BOGA root; it was
in this git worktree group and is no longer listed by `git worktree list`; it
is still listed but locked by an agent PID that is no longer running; its
checked-out branch's HEAD is reachable from the configured remote main; or its
checked-out branch no longer exists on the configured remote.

When a slot completes because its lock-holder PID is dead, the sweep first reaps
the abandoned git worktree (`git worktree unlock` + `git worktree remove
--force`) before the Supabase/registry cleanup, so the slot is fully reclaimed.

After the registry scan, a second pass reaps any *registry-less* worktree that
is still locked by a dead agent PID — agent worktrees whose registry was already
removed (or never written), which the registry scan can't see. The current
checkout and registry-backed worktrees are left untouched. Disable both the
signal and this pass with --no-dead-lock-detection.

Options:
  --current-slot <n>        Slot that must never be cleaned (default: current worktree slot).
  --no-supabase             Only report/prune logic; do not clean Supabase infra.
  --dry-run                 Print actions without removing containers/volumes/worktrees/registry files.
  --grace-seconds n         Minimum registry age before cleanup (default: 600).
  --no-merge-detection      Disable "branch merged / branch deleted on remote" completion signals.
  --no-dead-lock-detection  Disable the "locked by a dead agent PID" completion signal + worktree reaping.
  --no-fetch             Skip the pre-scan `git fetch --prune` (uses cached remote-tracking refs).
  --remote <name>        Remote to consult for merge detection (default: origin).
  --main-branch <name>   Main branch to consult for merge detection (default: main).
  -h, --help             Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --current-slot)
      CURRENT_SLOT="${2:-}"
      [[ -n "$CURRENT_SLOT" ]] || { echo "[worktree-sweep] --current-slot requires a value" >&2; exit 2; }
      shift 2
      ;;
    --no-supabase)
      SUPABASE=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --grace-seconds)
      GRACE_SECONDS="${2:-}"
      [[ -n "$GRACE_SECONDS" ]] || { echo "[worktree-sweep] --grace-seconds requires a value" >&2; exit 2; }
      shift 2
      ;;
    --no-merge-detection)
      DETECT_MERGED=0
      shift
      ;;
    --no-dead-lock-detection)
      DETECT_DEAD_LOCKS=0
      shift
      ;;
    --no-fetch)
      FETCH=0
      shift
      ;;
    --remote)
      REMOTE="${2:-}"
      [[ -n "$REMOTE" ]] || { echo "[worktree-sweep] --remote requires a value" >&2; exit 2; }
      shift 2
      ;;
    --main-branch)
      MAIN_BRANCH="${2:-}"
      [[ -n "$MAIN_BRANCH" ]] || { echo "[worktree-sweep] --main-branch requires a value" >&2; exit 2; }
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[worktree-sweep] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$CURRENT_SLOT" ]]; then
  CURRENT_SLOT="$(boga_worktree_slot_or_default "$REPO_ROOT")"
fi
boga_validate_slot_value "$CURRENT_SLOT" >/dev/null

if ! boga_is_integer "$GRACE_SECONDS"; then
  echo "[worktree-sweep] invalid grace seconds: $GRACE_SECONDS" >&2
  exit 2
fi

if ! boga_is_integer "$FETCH_TIMEOUT_SECONDS"; then
  echo "[worktree-sweep] invalid fetch timeout seconds: $FETCH_TIMEOUT_SECONDS" >&2
  exit 2
fi

CONFIG_ROOT="$(boga_config_root)"
REGISTRY_DIR="$CONFIG_ROOT/worktrees/slots"
CURRENT_COMMON_GIT_DIR="$(boga_common_git_dir "$REPO_ROOT")"
REMOTE_MAIN_REF="refs/remotes/$REMOTE/$MAIN_BRANCH"

mkdir -p "$REGISTRY_DIR"

maybe_fetch_for_merge_detection() {
  if [[ "$DETECT_MERGED" != "1" || "$FETCH" != "1" ]]; then
    return 0
  fi

  echo "[worktree-sweep] fetching $REMOTE (prune, timeout ${FETCH_TIMEOUT_SECONDS}s) for merge detection"
  local fetch_status=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$FETCH_TIMEOUT_SECONDS" git -C "$REPO_ROOT" fetch --prune --quiet "$REMOTE" "$MAIN_BRANCH" >/dev/null 2>&1 || fetch_status=$?
  else
    git -C "$REPO_ROOT" fetch --prune --quiet "$REMOTE" "$MAIN_BRANCH" >/dev/null 2>&1 || fetch_status=$?
  fi

  if (( fetch_status != 0 )); then
    echo "[worktree-sweep] warning: fetch failed (exit $fetch_status); disabling merge detection for this run" >&2
    DETECT_MERGED=0
    return 0
  fi

  if ! git -C "$REPO_ROOT" show-ref --verify --quiet "$REMOTE_MAIN_REF"; then
    echo "[worktree-sweep] warning: $REMOTE_MAIN_REF not found after fetch; disabling merge detection for this run" >&2
    DETECT_MERGED=0
  fi
}

maybe_fetch_for_merge_detection

active_path_is_current_worktree_group() {
  local candidate="$1"
  local line worktree_path

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        worktree_path="${line#worktree }"
        [[ -d "$worktree_path" ]] || continue
        if [[ "$(boga_abs_dir "$worktree_path")" == "$candidate" ]]; then
          return 0
        fi
        ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain)

  return 1
}

registry_age_is_ready() {
  local registry_file="$1"
  local now mtime

  mtime="$(boga_file_mtime_epoch "$registry_file" 2>/dev/null || true)"
  [[ -n "$mtime" ]] || return 1
  now="$(date +%s)"

  (( now - mtime >= 10#$GRACE_SECONDS ))
}

completion_reason() {
  local registry_file="$1"
  local registered_path registered_abs registry_common

  registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
  if [[ -z "$registered_path" ]]; then
    printf 'missing-registry-path\n'
    return 0
  fi

  if [[ ! -d "$registered_path" ]]; then
    printf 'registered-path-missing\n'
    return 0
  fi

  registered_abs="$(boga_abs_dir "$registered_path")"

  if ! boga_is_repo_root "$registered_abs"; then
    printf 'registered-path-not-boga-root\n'
    return 0
  fi

  registry_common="$(boga_registry_common_git_dir_from_file "$registry_file" 2>/dev/null || true)"
  if [[ -n "$registry_common" \
    && -d "$registry_common" \
    && "$(boga_abs_dir "$registry_common")" == "$CURRENT_COMMON_GIT_DIR" ]]; then
    if ! active_path_is_current_worktree_group "$registered_abs"; then
      printf 'not-in-current-git-worktree-list\n'
      return 0
    fi

    # Still listed by git, but the agent that locked it is gone. Without this
    # signal such a worktree never completes: its dir is on disk, it is in
    # `git worktree list`, and its pushed branch is neither merged nor deleted
    # on the remote — so the merge-detection signals below can't fire either.
    if [[ "$DETECT_DEAD_LOCKS" == "1" ]]; then
      local lock_pid
      if lock_pid="$(boga_worktree_lock_pid "$REPO_ROOT" "$registered_abs")" \
        && ! boga_pid_is_alive "$lock_pid"; then
        printf 'locked-by-dead-agent-pid-%s\n' "$lock_pid"
        return 0
      fi
    fi
  fi

  if [[ "$DETECT_MERGED" == "1" ]]; then
    if boga_worktree_head_merged_into "$registered_abs" "$REMOTE_MAIN_REF"; then
      printf 'branch-merged-into-%s/%s\n' "$REMOTE" "$MAIN_BRANCH"
      return 0
    fi

    if boga_worktree_branch_name "$registered_abs" >/dev/null 2>&1; then
      if ! boga_worktree_branch_exists_on_remote "$registered_abs" "$REMOTE"; then
        printf 'branch-deleted-on-%s\n' "$REMOTE"
        return 0
      fi
    fi
  fi

  return 1
}

# Unlock + force-remove a linked git worktree (dry-run aware). The caller logs
# the reason. The branch ref is not touched, so committed history survives; only
# the abandoned working tree is discarded.
git_worktree_remove() {
  local abs="$1"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[worktree-sweep] dry-run: git -C $REPO_ROOT worktree unlock $abs"
    echo "[worktree-sweep] dry-run: git -C $REPO_ROOT worktree remove --force $abs"
    return 0
  fi

  git -C "$REPO_ROOT" worktree unlock "$abs" >/dev/null 2>&1 || true
  if ! git -C "$REPO_ROOT" worktree remove --force "$abs" >/dev/null 2>&1; then
    echo "[worktree-sweep] warning: 'git worktree remove --force $abs' failed; running 'git worktree prune'" >&2
    git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
  fi
}

# True when some slot registry file points at the given (already-abs) worktree
# path. Used to leave registry-backed worktrees to the registry-driven loop
# (which honours the grace period) instead of pruning them out from under it.
path_has_registry() {
  local target_abs="$1"
  local registry_file registry_path

  for registry_file in "$REGISTRY_DIR"/*; do
    [[ -e "$registry_file" ]] || continue
    registry_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
    [[ -n "$registry_path" && -d "$registry_path" ]] || continue
    if [[ "$(boga_abs_dir "$registry_path")" == "$target_abs" ]]; then
      return 0
    fi
  done
  return 1
}

# For a slot completed because its lock-holder PID is dead, the git worktree is
# still registered and on disk; worktree-clean.sh only handles Supabase + the
# registry file, so without this the worktree (and its directory) would dangle.
# Reap it here, before the infra cleanup.
reap_dead_agent_worktree() {
  local registry_file="$1"
  local slot="$2"
  local reason="$3"
  local registered_path registered_abs

  registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
  if [[ -z "$registered_path" || ! -d "$registered_path" ]]; then
    return 0
  fi
  registered_abs="$(boga_abs_dir "$registered_path")"

  echo "[worktree-sweep] reaping abandoned git worktree for slot $slot ($reason): $registered_abs"
  git_worktree_remove "$registered_abs"
}

# Second pass: reap worktrees locked by a dead agent PID that have NO slot
# registry, so the registry-driven loop above never sees them. These are agent
# worktrees under `<repo>/.claude/worktrees/` whose registry was already removed
# (or never written) — they do not run their own Supabase stack, so reaping the
# dangling git worktree registration fully reclaims them. Registry-backed
# worktrees are intentionally skipped: the loop above owns them and its grace
# period; the current checkout is never touched.
prune_orphaned_dead_locks() {
  [[ "$DETECT_DEAD_LOCKS" == "1" ]] || return 0

  local current_abs line worktree_path abs lock_pid
  current_abs="$(boga_abs_dir "$REPO_ROOT")"

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        worktree_path="${line#worktree }"
        if [[ -d "$worktree_path" ]]; then
          abs="$(boga_abs_dir "$worktree_path")"
        else
          abs=""
        fi
        ;;
      locked*)
        [[ -n "$abs" && "$abs" != "$current_abs" ]] || continue
        [[ "$line" =~ \(pid\ ([0-9]+)\) ]] || continue
        lock_pid="${BASH_REMATCH[1]}"
        boga_pid_is_alive "$lock_pid" && continue
        path_has_registry "$abs" && continue
        echo "[worktree-sweep] reaping registry-less worktree locked by dead pid $lock_pid: $abs"
        git_worktree_remove "$abs"
        ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain)
}

clean_slot() {
  local slot="$1"
  local reason="$2"
  local args

  echo "[worktree-sweep] completed slot $slot detected ($reason)"

  args=(--slot "$slot" --remove-registry)
  if [[ "$SUPABASE" == "1" ]]; then
    args+=(--supabase)
  else
    echo "[worktree-sweep] --no-supabase set; registry cleanup only for slot $slot"
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    args+=(--dry-run)
  fi

  "$SCRIPT_DIR/worktree-clean.sh" "${args[@]}"
}

echo "[worktree-sweep] scanning completed worktree slots (current slot: $CURRENT_SLOT)"

shopt -s nullglob
for registry_file in "$REGISTRY_DIR"/*; do
  slot="$(basename "$registry_file")"
  if ! boga_validate_slot_value "$slot" >/dev/null 2>&1; then
    echo "[worktree-sweep] removing invalid registry file: $registry_file" >&2
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "[worktree-sweep] dry-run: rm -f $registry_file"
    else
      rm -f "$registry_file"
    fi
    continue
  fi

  if [[ "$slot" == "$CURRENT_SLOT" ]]; then
    echo "[worktree-sweep] keeping current slot $slot"
    continue
  fi

  if ! registry_age_is_ready "$registry_file"; then
    echo "[worktree-sweep] keeping slot $slot: registry younger than ${GRACE_SECONDS}s grace period"
    continue
  fi

  if reason="$(completion_reason "$registry_file")"; then
    case "$reason" in
      locked-by-dead-agent-pid-*)
        reap_dead_agent_worktree "$registry_file" "$slot" "$reason"
        ;;
    esac
    clean_slot "$slot" "$reason"
  else
    echo "[worktree-sweep] keeping slot $slot: registered worktree still looks active"
  fi
done

prune_orphaned_dead_locks

echo "[worktree-sweep] done"
