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
in this git worktree group and is no longer listed by `git worktree list`; its
checked-out branch's HEAD is reachable from the configured remote main; or its
checked-out branch no longer exists on the configured remote.

Options:
  --current-slot <n>     Slot that must never be cleaned (default: current worktree slot).
  --no-supabase          Only report/prune logic; do not clean Supabase infra.
  --dry-run              Print actions without removing containers/volumes/registry files.
  --grace-seconds n      Minimum registry age before cleanup (default: 600).
  --no-merge-detection   Disable "branch merged / branch deleted on remote" completion signals.
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

# True once a project's stack is older than the grace period, so we never tear
# down a stack whose worktree was only just removed (and might be recreated).
supabase_project_age_ready() {
  local project="$1"
  local cid created epoch now

  cid="$(docker ps -a --filter "label=com.supabase.cli.project=$project" -q 2>/dev/null | head -n1)"
  [[ -n "$cid" ]] || return 0
  created="$(docker inspect -f '{{.Created}}' "$cid" 2>/dev/null || true)"
  [[ -n "$created" ]] || return 0
  epoch="$(boga_iso_to_epoch "$created" 2>/dev/null || true)"
  [[ -n "$epoch" ]] || return 0
  now="$(date +%s)"
  (( now - epoch >= 10#$GRACE_SECONDS ))
}

# Registry-independent backstop: a Supabase stack can outlive its registry record
# entirely — e.g. when a slot is recycled (the prior project id is overwritten) or
# when registration never happened. Such stacks are invisible to the registry scan
# above. Here we enumerate running Supabase projects directly from Docker labels and
# reclaim any BOGA worktree stack that has neither a slot registry entry nor a live
# worktree. The main `BOGA` project and non-BOGA projects are never touched.
sweep_orphaned_supabase_projects() {
  if [[ "$SUPABASE" != "1" ]]; then
    return 0
  fi
  if ! boga_docker_available; then
    echo "[worktree-sweep] docker unavailable; skipping orphaned-project backstop"
    return 0
  fi

  local current_project_id project frag line wt_path wt_name reg_file reg_pid
  local -a live_fragments=() registered_project_ids=()

  current_project_id="$(boga_project_id_for_slot "$CURRENT_SLOT" "$REPO_ROOT" 2>/dev/null || true)"

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        wt_path="${line#worktree }"
        [[ -d "$wt_path" ]] || continue
        wt_name="$(basename "$(boga_abs_dir "$wt_path")")"
        live_fragments+=("$(boga_project_id_fragment "$wt_name")")
        ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)

  shopt -s nullglob
  for reg_file in "$REGISTRY_DIR"/*; do
    reg_pid="$(boga_registry_project_id_from_file "$reg_file" 2>/dev/null || true)"
    [[ -n "$reg_pid" ]] && registered_project_ids+=("$reg_pid")
  done

  while IFS= read -r project; do
    [[ -n "$project" ]] || continue
    # Only ever reclaim BOGA worktree stacks (BOGA-<frag>-wt<slot>). The main
    # `BOGA` project and any non-BOGA project from another tool are left alone.
    case "$project" in
      BOGA-*-wt[0-9]*) : ;;
      *) continue ;;
    esac
    [[ -n "$current_project_id" && "$project" == "$current_project_id" ]] && continue

    # Owned by the registry scan above if a slot file still names it.
    if boga_array_contains "$project" "${registered_project_ids[@]:-}"; then
      continue
    fi

    # Still live if its originating worktree is still checked out.
    frag="${project#BOGA-}"
    frag="${frag%-wt[0-9]*}"
    if boga_array_contains "$frag" "${live_fragments[@]:-}"; then
      continue
    fi

    if ! supabase_project_age_ready "$project"; then
      echo "[worktree-sweep] keeping orphan-looking project $project: younger than ${GRACE_SECONDS}s grace period"
      continue
    fi

    echo "[worktree-sweep] orphaned Supabase project detected (no registry, no worktree): $project"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "[worktree-sweep] dry-run: $SCRIPT_DIR/worktree-clean.sh --project $project --supabase"
      continue
    fi
    "$SCRIPT_DIR/worktree-clean.sh" --project "$project" --supabase \
      || echo "[worktree-sweep] warning: failed to tear down orphan project $project" >&2
  done < <(docker ps -a --filter "label=com.supabase.cli.project" --format '{{.Label "com.supabase.cli.project"}}' 2>/dev/null | sort -u)
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

  # Slot 0 is the always-on main checkout (project id `BOGA`). Its branch is
  # trivially "merged into origin/main", so completion detection would flag it
  # whenever the sweep runs from a non-main worktree (current slot != 0). Never
  # reclaim it.
  if [[ "$slot" == "0" ]]; then
    echo "[worktree-sweep] keeping slot 0 (always-on main checkout)"
    continue
  fi

  if ! registry_age_is_ready "$registry_file"; then
    echo "[worktree-sweep] keeping slot $slot: registry younger than ${GRACE_SECONDS}s grace period"
    continue
  fi

  if reason="$(completion_reason "$registry_file")"; then
    clean_slot "$slot" "$reason" \
      || echo "[worktree-sweep] warning: cleanup for slot $slot failed; continuing" >&2
  else
    echo "[worktree-sweep] keeping slot $slot: registered worktree still looks active"
  fi
done

sweep_orphaned_supabase_projects

echo "[worktree-sweep] done"
