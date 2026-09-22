#!/usr/bin/env bash

# Shared helpers for the BOGA worktree lifecycle and runtime guards.
# This file is meant to be sourced by bash scripts; do not execute it directly.
# Contract: docs/specs/12-worktree-config-and-isolation.md.

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
    # `node_modules` at the BOGA root for tools to walk up into. They still
    # need a slot lease like every other worktree.
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
[worktree] and child worktrees. Remove this worktree and recreate it outside the checkout:
[worktree]   ./boga worktree create <branch-name>
[worktree]
[worktree] Agent worktrees under \`<parent>/.claude/worktrees/\` are exempt by design.
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

# The main (non-linked) worktree of repo_root's worktree group: the first entry
# of `git worktree list`.
boga_main_worktree_path() {
  local repo_root="$1"
  git -C "$repo_root" worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print; exit }'
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

# boga_project_id_for_name <slot> <worktree-name>: the id for a linked worktree
# directory named <worktree-name> on <slot>. Pure function of its arguments.
#
# Shape: BOGA-<name>-wt<slot>, capped at SUPABASE_CLI_PROJECT_ID_LIMIT. The CLI
# silently cuts a longer id to its first 40 characters, and the tail it cuts is
# the slot number — the one component that guarantees uniqueness (two leases
# never share a slot). So an over-long id is shortened in the MIDDLE, never at
# the tail:
#
#   BOGA-<name cut to fit>-<crc>-wt<slot>
#
# - `-wt<slot>` is kept whole, so ids of live leases stay distinct by slot alone.
# - <crc> is the 8-hex-digit POSIX `cksum` (CRC-32) of the FULL, unsanitized
#   worktree name. The cut keeps only a prefix of <name>, so without it two
#   names sharing a long prefix would get the same id on the same slot: a stale
#   stack left by one would be adopted (volumes and all) by the next worktree to
#   take that slot. `cksum` is specified by POSIX, so macOS and CI Linux agree.
# - Deterministic: no clock, no randomness, no state. `worktree doctor` recomputes
#   this and compares it to config.toml, so it must be.
#
# An id that already fits is returned unchanged, so short-named worktrees keep
# the id (and Docker volumes) they had before the cap existed.
boga_project_id_for_name() {
  local slot="$1"
  local worktree_name="$2"
  local fragment suffix id crc budget

  fragment="$(boga_project_id_fragment "$worktree_name")"
  suffix="-wt${slot}"
  id="BOGA-${fragment}${suffix}"
  if (( ${#id} <= SUPABASE_CLI_PROJECT_ID_LIMIT )); then
    printf '%s\n' "$id"
    return 0
  fi

  # shellcheck disable=SC2046 # cksum prints "<crc> <bytes>"; split on purpose.
  set -- $(printf '%s' "$worktree_name" | cksum)
  crc="$(printf '%08x' "$1")"
  # What is left of the limit after "BOGA-", "-<crc>" and the suffix.
  budget=$(( SUPABASE_CLI_PROJECT_ID_LIMIT - 5 - 1 - ${#crc} - ${#suffix} ))
  fragment="${fragment:0:budget}"
  # The fragment has no "--" (sanitized), so one trailing hyphen at most.
  fragment="${fragment%-}"
  printf 'BOGA-%s-%s%s\n' "$fragment" "$crc" "$suffix"
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
    boga_project_id_for_name "$slot" "$worktree_name"
  fi
}

# The dedicated local DEV Supabase stack's project id (see
# supabase/scripts/dev-stack-lib.sh). It has no slot lease; nothing but
# `boga db dev-reset` removes it.
boga_dev_project_id() {
  printf 'BOGA-dev\n'
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

# ---------- slot lease ----------
#
# A lease is `<worktree>/.worktree-slot` = N plus the registry file
# `<config>/worktrees/slots/N` whose `path=` is that worktree. Only
# scripts/worktree-start.sh creates one and only scripts/worktree-release.sh
# deletes one.

boga_registry_dir() {
  printf '%s/worktrees/slots\n' "$(boga_config_root)"
}

boga_registry_file() {
  printf '%s/%s\n' "$(boga_registry_dir)" "$1"
}

# boga_registry_field <registry-file> <key>: print the value of key=... (fails if absent).
boga_registry_field() {
  local registry_file="$1"
  local key="$2"
  local value

  [[ -f "$registry_file" ]] || return 1
  value="$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$registry_file")"
  [[ -n "$value" ]] || return 1
  printf '%s\n' "$value"
}

boga_mobile_node_modules_is_isolated() {
  local repo_root="$1"
  local node_modules="$repo_root/apps/mobile/node_modules"

  [[ ! -L "$node_modules" ]]
}

# Fail-hard guard for every command that uses per-slot resources: placement,
# isolated node_modules, and a valid slot lease. Prints the fix and returns 1.
boga_require_slot_lease() {
  local repo_root slot registry_file holder
  repo_root="$(boga_abs_dir "$1")"

  boga_validate_worktree_placement "$repo_root" || return 1

  if ! boga_mobile_node_modules_is_isolated "$repo_root"; then
    cat >&2 <<EOF
[worktree] Refusing to use symlinked apps/mobile/node_modules.
[worktree] Each worktree must own its own dependency install so agents do not share mutable builds.
[worktree] Remove the symlink and run:
[worktree]   cd apps/mobile && npm install
EOF
    return 1
  fi

  if ! slot="$(boga_read_slot_file "$repo_root" 2>/dev/null)"; then
    cat >&2 <<EOF
[worktree] No slot lease for $repo_root (no valid .worktree-slot).
[worktree] Run: ./boga worktree start   (docs/specs/01-worktree-and-environment.md)
EOF
    return 1
  fi

  registry_file="$(boga_registry_file "$slot")"
  if ! holder="$(boga_registry_field "$registry_file" path 2>/dev/null)"; then
    cat >&2 <<EOF
[worktree] No slot lease for $repo_root (slot $slot has no registry file $registry_file).
[worktree] Run: ./boga worktree start   (it re-creates the lease for slot $slot)
EOF
    return 1
  fi

  if [[ "$holder" != "$repo_root" ]]; then
    cat >&2 <<EOF
[worktree] Slot $slot is leased to another path: $holder
[worktree] This worktree's .worktree-slot is stale. Run ./boga worktree ls, then see
[worktree] docs/specs/12-worktree-config-and-isolation.md (failure hypothesis 1).
EOF
    return 1
  fi
}

# ---------- small shared helpers ----------

# boga_run_with_timeout <seconds> <cmd...>: run cmd, killing it after <seconds>.
boga_run_with_timeout() {
  local seconds="$1"
  shift
  perl -e 'alarm shift @ARGV; exec @ARGV or die "exec failed: $!\n"' "$seconds" "$@"
}

# True when the Docker daemon answers within BOGA_DOCKER_TIMEOUT_SECONDS (default 10).
boga_docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  boga_run_with_timeout "${BOGA_DOCKER_TIMEOUT_SECONDS:-10}" docker info >/dev/null 2>&1
}

boga_worktree_branch_name() {
  local worktree_path="$1"
  local branch

  branch="$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null)" || return 1
  [[ -n "$branch" ]] || return 1
  printf '%s\n' "$branch"
}

# boga_pr_states <worktree-path> <branch>: one "<number> <STATE>" line per PR
# whose head is <branch> (any state). Fails when gh fails.
boga_pr_states() {
  local worktree_path="$1"
  local branch="$2"

  (cd "$worktree_path" && gh pr list --head "$branch" --state all --limit 20 \
    --json number,state --jq '.[] | "\(.number) \(.state)"')
}

# Supabase CLI pin. The repo owns the default; `supabase/.env.local`
# (-> ~/.config/boga/supabase/cli.env) may override it, and an explicit
# SUPABASE_CLI_VERSION in the caller's env wins over both.
#
# Minimum: 2.108.0 is the first CLI whose edge-runtime bootstrap bundles its
# deps (supabase/cli#5678). Older CLIs import deno.land on every edge container
# start, so `supabase start` fails its health check with "Error status 502"
# whenever deno.land is unreachable.
BOGA_SUPABASE_CLI_DEFAULT_VERSION="2.109.1"
BOGA_SUPABASE_CLI_MIN_VERSION="2.108.0"

# The CLI caps `project_id` at this length and silently rewrites a longer one
# ("project_id field in config is invalid. Auto-fixing to ..."), so the running
# containers are named for a prefix of what config.toml says — losing the
# trailing slot number that makes a worktree's stack unique. Observed on 2.109.1.
# This is the CLI's own rule, not Docker Compose's: Compose accepts both longer
# and uppercase project names, and these container names are uppercase. Revisit
# when BOGA_SUPABASE_CLI_DEFAULT_VERSION moves.
SUPABASE_CLI_PROJECT_ID_LIMIT=40

boga_supabase_cli_version() {
  local repo_root="$1"
  local env_file="$repo_root/supabase/.env.local"
  local pinned=""

  if [[ -n "${SUPABASE_CLI_VERSION:-}" ]]; then
    printf '%s\n' "$SUPABASE_CLI_VERSION"
    return 0
  fi

  [[ -f "$env_file" ]] || env_file="$(boga_config_root)/supabase/cli.env"
  if [[ -f "$env_file" ]]; then
    pinned="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?SUPABASE_CLI_VERSION=[\"']?([^\"'[:space:]#]*).*/\\2/p" "$env_file" | tail -n 1)"
  fi
  printf '%s\n' "${pinned:-$BOGA_SUPABASE_CLI_DEFAULT_VERSION}"
}

# boga_version_at_least <version> <minimum>: numeric major.minor.patch compare
# (a -beta.N suffix is ignored). Non-semver input such as "latest" fails.
boga_version_at_least() {
  local -a have want
  local i

  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]] || return 1
  IFS=. read -r -a have <<< "${1%%-*}"
  IFS=. read -r -a want <<< "${2%%-*}"
  for i in 0 1 2; do
    (( 10#${have[i]} > 10#${want[i]:-0} )) && return 0
    (( 10#${have[i]} < 10#${want[i]:-0} )) && return 1
  done
  return 0
}
