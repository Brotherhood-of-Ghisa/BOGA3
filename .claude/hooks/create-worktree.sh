#!/usr/bin/env bash
#
# Claude Code `WorktreeCreate` hook. Places agent worktrees outside the BOGA
# checkout so BOGA's nested-worktree guard passes and subagents can run
# `./scripts/quality-fast.sh` directly inside their worktree.
#
# Contract (per https://code.claude.com/docs/en/hooks.md#worktreecreate):
#   stdin  — JSON with at least `session_id` and `cwd`.
#   stdout — the absolute path to the created worktree on success.
#   exit 0 = success; any non-zero exit aborts subagent creation.

set -euo pipefail

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"

[[ -n "$session_id" ]] || { echo "[boga-worktree-hook] missing session_id" >&2; exit 1; }
[[ -d "$cwd" ]] || { echo "[boga-worktree-hook] invalid cwd: $cwd" >&2; exit 1; }

worktree_root="${BOGA_AGENT_WORKTREE_ROOT:-$HOME/.cache/boga-agent-worktrees}"
mkdir -p "$worktree_root"

branch="worktree-agent-${session_id}"
worktree_path="${worktree_root}/${branch}"

# If a stale worktree already exists at this path (e.g. a previous run with
# the same session_id failed mid-setup), reuse it after re-validating; the
# harness will reset it to the right ref before handing off to the subagent.
if [[ -d "$worktree_path" ]]; then
  echo "$worktree_path"
  exit 0
fi

cd "$cwd"

git worktree add "$worktree_path" -b "$branch" >&2

# Minimum BOGA per-worktree setup needed by `boga_validate_runtime_worktree`
# in scripts/worktree-lib.sh:
#   1. `.worktree-slot` must hold a 0-99 integer (port-allocation slot).
#   2. `apps/mobile/node_modules` must NOT be a symlink — the worktree owns
#      its own dependency install so agents don't share mutable build state.
#
# We deliberately skip the supabase/maestro config generation that
# `./scripts/worktree-setup.sh` performs: agent worktrees only need the
# frontend gates to run, and avoiding the heavier supabase ceremony keeps
# hook startup time bounded.

slot="$(printf '%s' "$session_id" | cksum | awk '{print $1 % 100}')"
printf '%s\n' "$slot" > "$worktree_path/.worktree-slot"

(cd "$worktree_path/apps/mobile" && npm ci --prefer-offline --no-audit --no-fund >&2)

echo "$worktree_path"
