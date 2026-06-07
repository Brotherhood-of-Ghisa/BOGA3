#!/usr/bin/env bash

# Shared helpers for BOGA worktree setup and runtime guards.
# This file is meant to be sourced by bash scripts; do not execute it directly.

boga_config_root() {
  printf '%s\n' "${BOGA_CONFIG_ROOT:-$HOME/.config/boga}"
}

boga_worktree_root() {
  printf '%s\n' "${BOGA_WORKTREE_ROOT:-$HOME/Projects/boga-worktrees}"
}

boga_max_slot() {
  printf '%s\n' "${BOGA_WORKTREE_MAX_SLOT:-99}"
}

boga_is_integer() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

boga_abs_dir() {
  local dir="$1"
  (cd "$dir" && pwd -P)
}

boga_is_repo_root() {
  local dir="$1"
  [[ -f "$dir/AGENTS.md" ]] \
    && [[ -f "$dir/docs/specs/README.md" ]] \
    && [[ -d "$dir/apps/mobile" ]] \
    && [[ -d "$dir/supabase" ]]
}

boga_parent_repo_root() {
  local root dir next
  root="$(boga_abs_dir "$1")"
  dir="$(dirname "$root")"

  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if boga_is_repo_root "$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
    next="$(dirname "$dir")"
    [[ "$next" == "$dir" ]] && break
    dir="$next"
  done

  return 1
}

boga_validate_worktree_placement() {
  local root parent
  root="$(boga_abs_dir "$1")"

  if parent="$(boga_parent_repo_root "$root")"; then
    # Blessed-nesting allowlist: worktrees created by an AI agent harness
    # (e.g. Claude Code's `isolation: "worktree"`) live at
    # `<parent>/.claude/worktrees/<name>/`. That location is already
    # `.gitignore`d and the worktrees there share nothing with the parent —
    # each has its own `apps/mobile/node_modules`, and there is no
    # `node_modules` at the BOGA root for tools to walk up into.
    if [[ "$root" == "$parent/.claude/worktrees/"* ]]; then
      return 0
    fi

    if [[ "${BOGA_ALLOW_NESTED_WORKTREE:-0}" == "1" ]]; then
      echo "[worktree] warning: nested BOGA checkout allowed by BOGA_ALLOW_NESTED_WORKTREE=1" >&2
      echo "[worktree] parent: $parent" >&2
      echo "[worktree] child:  $root" >&2
      return 0
    fi

    cat >&2 <<EOF
[worktree] Refusing to use a BOGA worktree nested inside another BOGA checkout.
[worktree] Parent checkout: $parent
[worktree] Nested checkout: $root
[worktree]
[worktree] Nested layouts make tools walk into parent node_modules, parent tsconfig files,
[worktree] and child worktrees. Remove this worktree and recreate it outside the checkout,
[worktree] preferably with:
[worktree]   ./scripts/worktree-create.sh <branch-name>
[worktree]
[worktree] Agent worktrees under `<parent>/.claude/worktrees/` are exempt by design.
[worktree] Override only for one-off diagnostics with BOGA_ALLOW_NESTED_WORKTREE=1.
EOF
    return 1
  fi

  return 0
}

boga_git_path_abs() {
  local repo_root="$1"
  local git_path="$2"

  case "$git_path" in
    /*) boga_abs_dir "$git_path" ;;
    *) boga_abs_dir "$repo_root/$git_path" ;;
  esac
}

boga_common_git_dir() {
  local repo_root="$1"
  local common_dir

  common_dir="$(git -C "$repo_root" rev-parse --git-common-dir)"
  boga_git_path_abs "$repo_root" "$common_dir"
}

boga_is_linked_git_worktree() {
  local repo_root="$1"
  local git_dir common_dir git_abs common_abs

  git_dir="$(git -C "$repo_root" rev-parse --git-dir)"
  common_dir="$(git -C "$repo_root" rev-parse --git-common-dir)"
  git_abs="$(boga_git_path_abs "$repo_root" "$git_dir")"
  common_abs="$(boga_git_path_abs "$repo_root" "$common_dir")"

  [[ "$git_abs" != "$common_abs" ]]
}

boga_validate_slot_value() {
  local slot="$1"
  local max_slot
  max_slot="$(boga_max_slot)"

  if ! boga_is_integer "$slot"; then
    echo "[worktree] invalid slot '$slot': expected integer 0-$max_slot" >&2
    return 1
  fi

  if (( 10#$slot < 0 || 10#$slot > 10#$max_slot )); then
    echo "[worktree] invalid slot '$slot': expected integer 0-$max_slot" >&2
    return 1
  fi
}

boga_read_slot_file() {
  local repo_root="$1"
  local slot_file="$repo_root/.worktree-slot"
  local slot

  [[ -f "$slot_file" ]] || return 1
  slot="$(tr -d '[:space:]' <"$slot_file")"
  boga_validate_slot_value "$slot" || return 1
  printf '%s\n' "$slot"
}

boga_worktree_slot_or_default() {
  local repo_root="$1"
  local slot

  if slot="$(boga_read_slot_file "$repo_root")"; then
    printf '%s\n' "$slot"
    return 0
  fi

  printf '0\n'
}

boga_project_id_fragment() {
  local raw="$1"
  local sanitized

  sanitized="$(printf '%s' "$raw" | tr -c 'A-Za-z0-9-' '-')"
  while [[ "$sanitized" == *--* ]]; do
    sanitized="${sanitized//--/-}"
  done
  sanitized="${sanitized##-}"
  sanitized="${sanitized%%-}"
  [[ -n "$sanitized" ]] || sanitized="worktree"

  printf '%s\n' "$sanitized"
}

boga_project_id_for_slot() {
  local slot="$1"
  local repo_root="${2:-}"
  local worktree_name

  if [[ "$slot" == "0" ]]; then
    printf 'BOGA\n'
  else
    if [[ -n "$repo_root" ]]; then
      worktree_name="$(basename "$(boga_abs_dir "$repo_root")")"
    else
      worktree_name="worktree"
    fi
    printf 'BOGA-%s-wt%s\n' "$(boga_project_id_fragment "$worktree_name")" "$slot"
  fi
}

boga_legacy_project_id_for_slot() {
  local slot="$1"
  if [[ "$slot" == "0" ]]; then
    printf 'scaffolding\n'
  else
    printf 'scaffolding-wt%s\n' "$slot"
  fi
}

boga_registry_project_id_from_file() {
  local registry_file="$1"
  local value

  [[ -f "$registry_file" ]] || return 1

  value="$(awk -F= '$1 == "project_id" { print substr($0, index($0, "=") + 1); exit }' "$registry_file")"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}

boga_port_for_slot() {
  local name="$1"
  local slot="$2"
  local base multiplier

  case "$name" in
    api) base=55431; multiplier=100 ;;
    db) base=55422; multiplier=100 ;;
    shadow) base=55420; multiplier=100 ;;
    studio) base=55423; multiplier=100 ;;
    inbucket) base=55424; multiplier=100 ;;
    analytics) base=55427; multiplier=100 ;;
    pooler) base=55429; multiplier=100 ;;
    inspector) base=8183; multiplier=10 ;;
    expo) base=8082; multiplier=1 ;;
    *) echo "[worktree] unknown port name: $name" >&2; return 1 ;;
  esac

  printf '%s\n' "$(( base + ((10#$slot) * multiplier) ))"
}

boga_registry_path_from_file() {
  local registry_file="$1"
  local value

  [[ -f "$registry_file" ]] || return 1

  value="$(awk -F= '$1 == "path" { print substr($0, index($0, "=") + 1); exit }' "$registry_file")"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return 0
  fi

  head -n 1 "$registry_file"
}

boga_registry_common_git_dir_from_file() {
  local registry_file="$1"
  local value

  [[ -f "$registry_file" ]] || return 1

  value="$(awk -F= '$1 == "common_git_dir" { print substr($0, index($0, "=") + 1); exit }' "$registry_file")"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}

boga_worktree_branch_name() {
  local worktree_path="$1"
  local branch

  branch="$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null)" || return 1
  [[ -n "$branch" ]] || return 1
  printf '%s\n' "$branch"
}

boga_worktree_head_merged_into() {
  local worktree_path="$1"
  local remote_ref="$2"
  local head

  head="$(git -C "$worktree_path" rev-parse --verify --quiet HEAD)" || return 1
  git -C "$worktree_path" merge-base --is-ancestor "$head" "$remote_ref" 2>/dev/null
}

boga_worktree_branch_exists_on_remote() {
  local worktree_path="$1"
  local remote="$2"
  local branch

  branch="$(boga_worktree_branch_name "$worktree_path")" || return 2
  git -C "$worktree_path" show-ref --verify --quiet "refs/remotes/$remote/$branch"
}

boga_pid_is_alive() {
  local pid="$1"

  boga_is_integer "$pid" || return 1
  kill -0 "$pid" 2>/dev/null
}

# Print the PID embedded in the lock reason of the worktree registered at
# target_abs, by scanning `git worktree list --porcelain` for repo_root's
# worktree group. Agent worktrees are locked with a reason shaped like
# `claude agent <name> (pid <N> start <date>)` (older harness versions omit the
# ` start <date>` suffix and emit `(pid <N>)`); this extracts <N> from either.
# Returns non-zero when the path is not a locked worktree in this group, or its
# lock reason carries no `(pid <N>` marker (e.g. a manual lock) — callers must
# treat that as "unknown owner, do not reap".
boga_worktree_lock_pid() {
  local repo_root="$1"
  local target_abs="$2"
  local line worktree_path current_abs=""

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        worktree_path="${line#worktree }"
        if [[ -d "$worktree_path" ]]; then
          current_abs="$(boga_abs_dir "$worktree_path")"
        else
          current_abs=""
        fi
        ;;
      locked*)
        if [[ -n "$current_abs" \
          && "$current_abs" == "$target_abs" \
          && "$line" =~ \(pid\ ([0-9]+) ]]; then
          printf '%s\n' "${BASH_REMATCH[1]}"
          return 0
        fi
        ;;
    esac
  done < <(git -C "$repo_root" worktree list --porcelain)

  return 1
}

boga_file_mtime_epoch() {
  local path="$1"

  stat -f %m "$path" 2>/dev/null || stat -c %Y "$path" 2>/dev/null
}

boga_mobile_node_modules_is_isolated() {
  local repo_root="$1"
  local node_modules="$repo_root/apps/mobile/node_modules"

  [[ ! -L "$node_modules" ]]
}

boga_validate_runtime_worktree() {
  local repo_root="$1"

  boga_validate_worktree_placement "$repo_root" || return 1

  # For blessed agent worktrees under `<parent>/.claude/worktrees/`, the slot
  # file is not required — slots drive port allocation for supabase/expo
  # metro, which agent worktrees don't run. They just need an isolated
  # `apps/mobile/node_modules` to execute the frontend gates.
  local parent
  if parent="$(boga_parent_repo_root "$repo_root")" && [[ "$repo_root" == "$parent/.claude/worktrees/"* ]]; then
    if ! boga_mobile_node_modules_is_isolated "$repo_root"; then
      cat >&2 <<EOF
[worktree] Refusing to use symlinked apps/mobile/node_modules in agent worktree.
[worktree] Each worktree must own its own dependency install so agents do not share mutable builds.
[worktree] Inside this worktree, run:
[worktree]   cd apps/mobile && npm ci
EOF
      return 1
    fi
    return 0
  fi

  if [[ -f "$repo_root/.worktree-slot" ]]; then
    boga_read_slot_file "$repo_root" >/dev/null || return 1
  elif boga_is_linked_git_worktree "$repo_root"; then
    cat >&2 <<EOF
[worktree] Missing $repo_root/.worktree-slot for a linked git worktree.
[worktree] Run:
[worktree]   ./scripts/worktree-setup.sh
EOF
    return 1
  fi

  if ! boga_mobile_node_modules_is_isolated "$repo_root"; then
    cat >&2 <<EOF
[worktree] Refusing to use symlinked apps/mobile/node_modules.
[worktree] Each worktree must own its own dependency install so agents do not share mutable builds.
[worktree] Remove the symlink and run:
[worktree]   cd apps/mobile && npm install
EOF
    return 1
  fi
}
