#!/usr/bin/env bash

# ./boga worktree release — delete a worktree's Supabase stack, slot lease, and
# checkout once its PR has merged or closed. The only command that deletes a
# lease. Contract: docs/specs/12-worktree-config-and-isolation.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

FORCE=0
KEEP_WORKTREE=0
SLOT_ARG=""
PROJECT_ID_ARG=""

usage() {
  cat <<'EOF'
Usage:
  ./boga worktree release [--force] [--keep-worktree]            # this worktree (the owner)
  ./boga worktree release --slot <N> [--force] [--keep-worktree] # a lease whose owner is gone
  ./boga worktree release --project-id <id> --force              # a Docker stack with no lease

Refuses unless the worktree branch's PR is MERGED or CLOSED (checked with gh).
Then removes every Docker container, volume, and network labelled
com.supabase.cli.project=<project_id>, deletes the lease, and runs
`git worktree remove --force`. The branch is kept.

Options:
  --force           Skip the PR check (no PR, open PR, detached HEAD, or missing path).
  --keep-worktree   Keep the git worktree checkout.
  --slot <N>        Release the lease for slot N (cleanup procedure).
  --project-id <id> Remove an unleased stack by exact label (cleanup procedure; needs --force).
  -h, --help        Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --keep-worktree) KEEP_WORKTREE=1; shift ;;
    --slot)
      SLOT_ARG="${2:-}"
      [[ -n "$SLOT_ARG" ]] || { echo "[worktree-release] --slot requires a value" >&2; exit 2; }
      shift 2
      ;;
    --project-id)
      PROJECT_ID_ARG="${2:-}"
      [[ -n "$PROJECT_ID_ARG" ]] || { echo "[worktree-release] --project-id requires a value" >&2; exit 2; }
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[worktree-release] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "[worktree-release] $*" >&2
  exit 1
}

[[ -n "$SLOT_ARG" && -n "$PROJECT_ID_ARG" ]] && fail "pass --slot or --project-id, not both"

REGISTRY_DIR="$(boga_registry_dir)"
TARGET_SLOT=""
TARGET_PROJECT_ID=""
TARGET_PATH=""

if [[ -n "$PROJECT_ID_ARG" ]]; then
  [[ "$FORCE" == "1" ]] || fail "--project-id has no PR to check; re-run with --force once the human has confirmed"
  TARGET_PROJECT_ID="$PROJECT_ID_ARG"
  if leased_by="$(grep -lx "project_id=$TARGET_PROJECT_ID" "$REGISTRY_DIR"/* 2>/dev/null | head -n 1)" && [[ -n "$leased_by" ]]; then
    fail "$TARGET_PROJECT_ID is leased by slot $(basename "$leased_by"); use --slot $(basename "$leased_by")"
  fi
elif [[ -n "$SLOT_ARG" ]]; then
  boga_validate_slot_value "$SLOT_ARG" >/dev/null || exit 1
  TARGET_SLOT="$SLOT_ARG"
  registry_file="$(boga_registry_file "$TARGET_SLOT")"
  [[ -f "$registry_file" ]] || fail "slot $TARGET_SLOT has no lease ($registry_file)"
  TARGET_PROJECT_ID="$(boga_registry_field "$registry_file" project_id)" || fail "lease $registry_file has no project_id"
  TARGET_PATH="$(boga_registry_field "$registry_file" path)" || fail "lease $registry_file has no path"
else
  boga_require_slot_lease "$REPO_ROOT" || exit 1
  TARGET_SLOT="$(boga_read_slot_file "$REPO_ROOT")"
  TARGET_PROJECT_ID="$(boga_registry_field "$(boga_registry_file "$TARGET_SLOT")" project_id)"
  TARGET_PATH="$(boga_abs_dir "$REPO_ROOT")"
fi

[[ "$TARGET_SLOT" == "0" || "$TARGET_PROJECT_ID" == "BOGA" ]] && fail "slot 0 (the main checkout) is never released"
[[ "$TARGET_PROJECT_ID" == "$(boga_dev_project_id)" ]] && fail "the dev stack is never released; use ./boga db dev-reset"

# ---------- 1. PR must be merged or closed ----------
if [[ "$FORCE" != "1" ]]; then
  [[ -n "$TARGET_PATH" && -d "$TARGET_PATH" ]] \
    || fail "worktree path missing ($TARGET_PATH): no branch to check; --force once the human has confirmed"
  branch="$(boga_worktree_branch_name "$TARGET_PATH")" \
    || fail "detached HEAD in $TARGET_PATH: no PR to check; --force once the human has confirmed"
  states="$(boga_pr_states "$TARGET_PATH" "$branch")" || fail "gh pr list failed for branch $branch"
  [[ -n "$states" ]] || fail "no PR for branch $branch; --force once the human has confirmed"
  if open_pr="$(awk '$2 == "OPEN" { print "#" $1; exit }' <<<"$states")" && [[ -n "$open_pr" ]]; then
    fail "PR $open_pr for branch $branch is still OPEN; release after it merges (./boga pr wait)"
  fi
  echo "[worktree-release] PR check ok for $branch: $(tr '\n' ' ' <<<"$states")"
fi

# ---------- 2. Docker stack (fail hard, keep the lease) ----------
boga_docker_ready \
  || fail "Docker did not answer within ${BOGA_DOCKER_TIMEOUT_SECONDS:-10}s; lease kept so the stack stays findable (docs/specs/12 failure hypothesis 8)"

if [[ -n "$TARGET_PATH" && -f "$TARGET_PATH/supabase/.temp/health-functions-serve.pid" ]]; then
  serve_pid="$(cat "$TARGET_PATH/supabase/.temp/health-functions-serve.pid" 2>/dev/null || true)"
  if [[ -n "$serve_pid" ]] && kill -0 "$serve_pid" 2>/dev/null; then
    kill "$serve_pid" 2>/dev/null || true
    echo "[worktree-release] stopped functions serve (pid $serve_pid)"
  fi
fi

label="label=com.supabase.cli.project=$TARGET_PROJECT_ID"
ids=()
while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(docker ps -aq --filter "$label")
if (( ${#ids[@]} > 0 )); then
  docker rm -f "${ids[@]}" >/dev/null
  echo "[worktree-release] removed ${#ids[@]} container(s) for $TARGET_PROJECT_ID"
fi
ids=()
while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(docker volume ls -q --filter "$label")
if (( ${#ids[@]} > 0 )); then
  docker volume rm -f "${ids[@]}" >/dev/null
  echo "[worktree-release] removed ${#ids[@]} volume(s) for $TARGET_PROJECT_ID"
fi
ids=()
while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(docker network ls -q --filter "$label")
if (( ${#ids[@]} > 0 )); then
  docker network rm "${ids[@]}" >/dev/null
  echo "[worktree-release] removed ${#ids[@]} network(s) for $TARGET_PROJECT_ID"
fi

# ---------- 3. Lease ----------
if [[ -n "$TARGET_SLOT" ]]; then
  rm -f "$(boga_registry_file "$TARGET_SLOT")"
  echo "[worktree-release] released slot $TARGET_SLOT"
fi

# ---------- 4. Worktree ----------
if [[ -n "$TARGET_PATH" && -d "$TARGET_PATH" && "$KEEP_WORKTREE" != "1" ]]; then
  if boga_is_linked_git_worktree "$TARGET_PATH"; then
    main_worktree="$(boga_main_worktree_path "$TARGET_PATH")"
    git -C "$main_worktree" worktree remove --force --force "$TARGET_PATH"
    echo "[worktree-release] removed worktree $TARGET_PATH (branch kept)"
  else
    echo "[worktree-release] $TARGET_PATH is not a linked worktree; left in place" >&2
  fi
fi

echo "[worktree-release] done: $TARGET_PROJECT_ID"
