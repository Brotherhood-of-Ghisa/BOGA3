#!/usr/bin/env bash

# ./boga worktree create — a new linked worktree branched from the latest
# origin/main (or --from), placed outside every BOGA checkout, then
# `./boga worktree start` inside it. Contract:
# docs/specs/12-worktree-config-and-isolation.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

BRANCH_NAME=""
WORKTREE_NAME=""
START_POINT=""
DETACH=0
ROOT_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage:
  ./boga worktree create [options] <branch-name>

Fetches origin main, creates a linked worktree under the worktree root on a new
branch from origin/main, then runs ./boga worktree start in it. An existing
local branch is checked out as-is (start then requires it to contain origin/main).

Options:
  --name <name>       Directory name under the worktree root (default: the branch name).
  --from <ref>        Start point instead of origin/main (explicit override; start
                      then checks against <ref>).
  --root <path>       Worktree parent directory (default: $BOGA_WORKTREE_ROOT or ~/Projects/boga-worktrees).
  --detach            Create a detached worktree at --from (or origin/main).
  -h, --help          Show this help text.
EOF
}

sanitize_name() {
  local raw="$1"
  local sanitized
  sanitized="$(printf '%s' "$raw" | tr '/[:space:]' '---' | tr -c 'A-Za-z0-9._-' '-')"
  sanitized="${sanitized##-}"
  sanitized="${sanitized%%-}"
  [[ -n "$sanitized" ]] || sanitized="worktree"
  printf '%s\n' "$sanitized"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      WORKTREE_NAME="${2:-}"
      [[ -n "$WORKTREE_NAME" ]] || { echo "[worktree-create] --name requires a value" >&2; exit 2; }
      shift 2
      ;;
    --from)
      START_POINT="${2:-}"
      [[ -n "$START_POINT" ]] || { echo "[worktree-create] --from requires a value" >&2; exit 2; }
      shift 2
      ;;
    --root)
      ROOT_OVERRIDE="${2:-}"
      [[ -n "$ROOT_OVERRIDE" ]] || { echo "[worktree-create] --root requires a value" >&2; exit 2; }
      shift 2
      ;;
    --detach)
      DETACH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "[worktree-create] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$BRANCH_NAME" ]]; then
        echo "[worktree-create] unexpected extra argument: $1" >&2
        usage >&2
        exit 2
      fi
      BRANCH_NAME="$1"
      shift
      ;;
  esac
done

if [[ "$DETACH" != "1" && -z "$BRANCH_NAME" ]]; then
  echo "[worktree-create] missing <branch-name>" >&2
  usage >&2
  exit 2
fi

boga_validate_worktree_placement "$REPO_ROOT" || exit 1

START_ARGS=()
if [[ -n "$START_POINT" ]]; then
  START_ARGS=(--base "$START_POINT")
else
  echo "[worktree-create] fetching origin main"
  git -C "$REPO_ROOT" fetch --quiet origin main
  START_POINT="origin/main"
fi

WORKTREE_PARENT="${ROOT_OVERRIDE:-$(boga_worktree_root)}"
mkdir -p "$WORKTREE_PARENT"
WORKTREE_PARENT="$(boga_abs_dir "$WORKTREE_PARENT")"

if [[ "$DETACH" == "1" ]]; then
  WORKTREE_NAME="${WORKTREE_NAME:-$(sanitize_name "$START_POINT")}"
else
  WORKTREE_NAME="${WORKTREE_NAME:-$(sanitize_name "$BRANCH_NAME")}"
fi

WORKTREE_PATH="$WORKTREE_PARENT/$WORKTREE_NAME"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "[worktree-create] target path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

echo "[worktree-create] creating worktree: $WORKTREE_PATH"

if [[ "$DETACH" == "1" ]]; then
  git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_PATH" "$START_POINT"
elif git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
else
  git -C "$REPO_ROOT" worktree add --no-track -b "$BRANCH_NAME" "$WORKTREE_PATH" "$START_POINT"
fi

"$WORKTREE_PATH/scripts/worktree-start.sh" "${START_ARGS[@]+"${START_ARGS[@]}"}"

cat <<EOF
[worktree-create] ready
  path:   $WORKTREE_PATH
  branch: ${BRANCH_NAME:-detached}
  next:   cd "$WORKTREE_PATH"
EOF
