#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"
MAESTRO_SAMPLE_ENV_FILE="$APP_DIR/.maestro/maestro.env.sample"
MAESTRO_LOCAL_ENV_FILE="$APP_DIR/.maestro/maestro.env.local"

if [[ -f "$REPO_ROOT/scripts/worktree-lib.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/worktree-lib.sh"
fi
if [[ -f "$REPO_ROOT/scripts/java-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/java-env.sh"
fi

maestro_fail() {
  echo "$*" >&2
  exit 1
}

maestro_require_command() {
  local command_name="$1"
  local install_hint="${2:-}"

  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -n "$install_hint" ]]; then
    maestro_fail "Missing required command '$command_name'. $install_hint"
  fi

  maestro_fail "Missing required command '$command_name'."
}

maestro_require_local_env_file() {
  [[ -f "$MAESTRO_SAMPLE_ENV_FILE" ]] || maestro_fail "Missing checked-in Maestro sample config: $MAESTRO_SAMPLE_ENV_FILE"
  [[ -f "$MAESTRO_LOCAL_ENV_FILE" ]] || maestro_fail "Missing $MAESTRO_LOCAL_ENV_FILE. Run './scripts/worktree-setup.sh' from the repo root, then set IOS_SIM_UDID or IOS_SIM_DEVICE for this workspace."
}

maestro_source_env() {
  local env_file

  if declare -F boga_validate_runtime_worktree >/dev/null 2>&1; then
    boga_validate_runtime_worktree "$REPO_ROOT" || exit 1
  fi

  maestro_require_local_env_file

  for env_file in "$MAESTRO_SAMPLE_ENV_FILE" "$MAESTRO_LOCAL_ENV_FILE"; do
    if [[ -f "$env_file" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$env_file"
      set +a
    fi
  done

  : "${TASK_ID:=ad-hoc}"
  : "${MAESTRO_IOS_SHARED_BUILD_ROOT:=$HOME/.cache/boga/maestro/ios-dev-client}"

  # The simulator dev-client .app is host-local and byte-identical across every
  # worktree that shares the same native inputs, so its build cache is SHARED: one
  # canonical host-local root, never keyed by worktree slot. That is what lets a
  # fresh worktree reuse an already-built client instead of rebuilding from
  # scratch. Collapse any legacy per-slot ".../ios-dev-client/wt<n>" root left
  # behind in an older generated maestro.env.local back to the shared root so
  # pre-existing worktrees converge on the same cache too.
  case "$MAESTRO_IOS_SHARED_BUILD_ROOT" in
    */ios-dev-client/wt[0-9]*)
      MAESTRO_IOS_SHARED_BUILD_ROOT="${MAESTRO_IOS_SHARED_BUILD_ROOT%/wt[0-9]*}"
      ;;
  esac

  # Always derive the .app path from the single shared root so the build-write
  # path and the cache-lookup path can never diverge (the prior shadowing bug,
  # where a non-slot sample default silently won over a per-slot local value).
  MAESTRO_IOS_DEV_CLIENT_APP_PATH="$MAESTRO_IOS_SHARED_BUILD_ROOT/mobile-dev-client.app"
  : "${IOS_SIM_DEVICE:=}"
  : "${IOS_SIM_UDID:=}"
  # Default ON: a fresh worktree pins a slot-named simulator (e.g. "BOGA wt46")
  # that does not exist yet. With auto-create the smoke gate self-heals by
  # creating + booting that slot on the fly instead of failing the lookup.
  : "${IOS_SIM_AUTO_CREATE:=1}"
  : "${EXPO_DEV_SERVER_PORT:=}"
  : "${EXPO_START_WAIT_SECONDS:=30}"
  : "${MAESTRO_RESET_STRATEGY:=data}"
  : "${MAESTRO_KEEP_SIMULATOR_BOOTED:=0}"

  export TASK_ID
  export MAESTRO_IOS_SHARED_BUILD_ROOT
  export MAESTRO_IOS_DEV_CLIENT_APP_PATH
  export IOS_SIM_DEVICE
  export IOS_SIM_UDID
  export IOS_SIM_AUTO_CREATE
  export EXPO_DEV_SERVER_PORT
  export EXPO_START_WAIT_SECONDS
  export MAESTRO_RESET_STRATEGY
  export MAESTRO_KEEP_SIMULATOR_BOOTED

  [[ -n "$EXPO_DEV_SERVER_PORT" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT. Run './scripts/worktree-setup.sh' from the repo root or set it in $MAESTRO_LOCAL_ENV_FILE."
}

maestro_trim() {
  echo "$1" | xargs
}
