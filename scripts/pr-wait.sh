#!/usr/bin/env bash

# ./boga pr wait — block until the PR for this branch merges or closes, so the
# owning agent knows when to run `./boga worktree release`. Run it in the
# background right after opening the PR. Contract:
# docs/specs/12-worktree-config-and-isolation.md (lifecycle step 3).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

INTERVAL="${BOGA_PR_WAIT_INTERVAL_SECONDS:-60}"
BRANCH=""
MAX_GH_FAILURES=5

usage() {
  cat <<'EOF'
Usage: ./boga pr wait [--interval <seconds>] [--branch <name>]

Polls `gh pr list --head <branch>` every --interval seconds (default 60) and
exits when the PR is no longer open:
  0  MERGED        -> run ./boga worktree release
  3  CLOSED        (not merged) -> ask the human, then release
  2  no PR for the branch
  1  gh failed 5 times in a row
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      INTERVAL="${2:-}"
      boga_is_integer "$INTERVAL" || { echo "[pr-wait] --interval requires seconds" >&2; exit 2; }
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      [[ -n "$BRANCH" ]] || { echo "[pr-wait] --branch requires a value" >&2; exit 2; }
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[pr-wait] unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(boga_worktree_branch_name "$REPO_ROOT")" \
    || { echo "[pr-wait] detached HEAD: pass --branch <name>" >&2; exit 2; }
fi

echo "[pr-wait] waiting for the PR on $BRANCH (every ${INTERVAL}s)"
failures=0
while true; do
  if ! states="$(boga_pr_states "$REPO_ROOT" "$BRANCH")"; then
    failures=$((failures + 1))
    if (( failures >= MAX_GH_FAILURES )); then
      echo "[pr-wait] gh failed $failures times in a row; giving up" >&2
      exit 1
    fi
    sleep "$INTERVAL"
    continue
  fi
  failures=0

  if [[ -z "$states" ]]; then
    echo "[pr-wait] no PR for branch $BRANCH" >&2
    exit 2
  fi
  if grep -q ' OPEN$' <<<"$states"; then
    sleep "$INTERVAL"
    continue
  fi

  latest="$(sort -rn <<<"$states" | head -n 1)"
  number="${latest%% *}"
  state="${latest##* }"
  if [[ "$state" == "MERGED" ]]; then
    echo "[pr-wait] PR #$number MERGED. Next: ./boga worktree release"
    exit 0
  fi
  echo "[pr-wait] PR #$number $state without merging. Ask the human, then: ./boga worktree release --force"
  exit 3
done
