#!/usr/bin/env bash

# ./boga worktree ls — read-only inventory of slot leases, Supabase stacks in
# Docker, and git worktrees without a lease. Feeds
# docs/procedures/worktree-cleanup.md; changes nothing.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

USE_GH=1

usage() {
  cat <<'EOF'
Usage: ./boga worktree ls [--no-gh]

Read-only. Prints:
  1. every slot lease: slot, project id, stack (running/total containers),
     PR state of the worktree's branch, branch, path;
  2. Supabase stacks in Docker that no lease owns;
  3. git worktrees without a valid lease (prunable, stale .worktree-slot, or none).

Options:
  --no-gh     Skip PR lookups (offline).
  -h, --help  Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-gh) USE_GH=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[worktree-ls] unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

REGISTRY_DIR="$(boga_registry_dir)"
DOCKER_OK=0
boga_docker_ready && DOCKER_OK=1

stack_state() {
  local project_id="$1" running total
  [[ "$DOCKER_OK" == "1" ]] || { printf 'docker?\n'; return 0; }
  running="$(docker ps -q --filter "label=com.supabase.cli.project=$project_id" | wc -l | tr -d ' ')"
  total="$(docker ps -aq --filter "label=com.supabase.cli.project=$project_id" | wc -l | tr -d ' ')"
  if [[ "$total" == "0" ]]; then printf 'none\n'; else printf '%s/%s\n' "$running" "$total"; fi
}

pr_state() {
  local path="$1" branch states open latest
  [[ -d "$path" ]] || { printf -- '-\n'; return 0; }
  branch="$(boga_worktree_branch_name "$path")" || { printf 'detached\n'; return 0; }
  [[ "$USE_GH" == "1" ]] || { printf 'skipped\n'; return 0; }
  states="$(boga_pr_states "$path" "$branch" 2>/dev/null)" || { printf 'gh?\n'; return 0; }
  [[ -n "$states" ]] || { printf 'no PR\n'; return 0; }
  open="$(awk '$2 == "OPEN" { print "#" $1 " OPEN"; exit }' <<<"$states")"
  if [[ -n "$open" ]]; then printf '%s\n' "$open"; return 0; fi
  latest="$(sort -rn <<<"$states" | head -n 1)"
  printf '#%s\n' "$latest"
}

branch_of() {
  local path="$1"
  [[ -d "$path" ]] || { printf -- '-\n'; return 0; }
  boga_worktree_branch_name "$path" 2>/dev/null || printf '(detached)\n'
}

echo "== Slot leases ($REGISTRY_DIR)"
printf '%-5s %-44s %-8s %-14s %-40s %s\n' "SLOT" "PROJECT_ID" "STACK" "PR" "BRANCH" "PATH"
LEASED_IDS=()
if [[ -d "$REGISTRY_DIR" ]]; then
  while IFS= read -r slot; do
    registry_file="$(boga_registry_file "$slot")"
    project_id="$(boga_registry_field "$registry_file" project_id 2>/dev/null || echo '?')"
    path="$(boga_registry_field "$registry_file" path 2>/dev/null || echo '?')"
    LEASED_IDS+=("$project_id")
    shown_path="$path"
    [[ -d "$path" ]] || shown_path="$path (missing)"
    printf '%-5s %-44s %-8s %-14s %-40s %s\n' "$slot" "$project_id" "$(stack_state "$project_id")" \
      "$(pr_state "$path")" "$(branch_of "$path")" "$shown_path"
  done < <(find "$REGISTRY_DIR" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | grep -E '^[0-9]+$' | sort -n)
fi

echo
echo "== Supabase stacks in Docker without a lease"
if [[ "$DOCKER_OK" != "1" ]]; then
  echo "  docker did not answer within ${BOGA_DOCKER_TIMEOUT_SECONDS:-10}s; skipped"
else
  printf '%-44s %-10s %s\n' "PROJECT_ID" "CONTAINERS" "NOTE"
  found=0
  while IFS= read -r label; do
    [[ -n "$label" ]] || continue
    leased=0
    for id in "${LEASED_IDS[@]+"${LEASED_IDS[@]}"}"; do [[ "$id" == "$label" ]] && leased=1; done
    [[ "$leased" == "1" ]] && continue
    found=1
    if [[ "$label" == "$(boga_dev_project_id)" ]]; then
      note="dev stack (main checkout) - keep"
    elif [[ "$label" == BOGA* ]]; then
      note="unleased BOGA stack"
    else
      note="other project - report only"
    fi
    printf '%-44s %-10s %s\n' "$label" "$(stack_state "$label")" "$note"
  done < <(
    {
      docker ps -a --filter label=com.supabase.cli.project --format '{{.Label "com.supabase.cli.project"}}'
      docker volume ls --filter label=com.supabase.cli.project --format '{{.Label "com.supabase.cli.project"}}'
      docker network ls --filter label=com.supabase.cli.project --format '{{.Label "com.supabase.cli.project"}}'
    } 2>/dev/null | sort -u
  )
  [[ "$found" == "1" ]] || echo "  (none)"
fi

echo
echo "== Git worktrees without a valid lease"
printf '%-24s %-40s %s\n' "STATE" "BRANCH" "PATH"
found=0
path=""
prunable=0
flush_worktree() {
  [[ -n "$path" ]] || return 0
  local state="" slot holder
  if [[ "$prunable" == "1" || ! -d "$path" ]]; then
    state="prunable (dir gone)"
  elif slot="$(boga_read_slot_file "$path" 2>/dev/null)"; then
    holder="$(boga_registry_field "$(boga_registry_file "$slot")" path 2>/dev/null || true)"
    if [[ -z "$holder" ]]; then
      state="lease missing (slot $slot)"
    elif [[ "$holder" != "$(boga_abs_dir "$path")" ]]; then
      state="slot $slot held elsewhere"
    fi
  else
    state="no lease"
  fi
  if [[ -n "$state" ]]; then
    found=1
    printf '%-24s %-40s %s\n' "$state" "$(branch_of "$path")" "$path"
  fi
}
while IFS= read -r line; do
  case "$line" in
    worktree\ *) flush_worktree; path="${line#worktree }"; prunable=0 ;;
    prunable*) prunable=1 ;;
  esac
done < <(git -C "$REPO_ROOT" worktree list --porcelain)
flush_worktree
[[ "$found" == "1" ]] || echo "  (none)"
