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
  : "${MAESTRO_IOS_DEV_CLIENT_APP_PATH:=$MAESTRO_IOS_SHARED_BUILD_ROOT/mobile-dev-client.app}"
  : "${IOS_SIM_DEVICE:=}"
  : "${IOS_SIM_UDID:=}"
  : "${IOS_SIM_AUTO_CREATE:=0}"
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

