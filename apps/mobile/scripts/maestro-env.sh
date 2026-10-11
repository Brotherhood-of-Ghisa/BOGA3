#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"
MAESTRO_SAMPLE_ENV_FILE="$APP_DIR/.maestro/maestro.env.sample"
MAESTRO_LOCAL_ENV_FILE="$APP_DIR/.maestro/maestro.env.local"

# shellcheck disable=SC1091
source "$REPO_ROOT/scripts/worktree-lib.sh"
if [[ -f "$REPO_ROOT/scripts/java-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/java-env.sh"
fi
if [[ -f "$REPO_ROOT/scripts/android-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/android-env.sh"
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
  [[ -f "$MAESTRO_LOCAL_ENV_FILE" ]] || maestro_fail "Missing $MAESTRO_LOCAL_ENV_FILE. Run './boga worktree start' from the repo root, then set IOS_SIM_UDID or IOS_SIM_DEVICE for this workspace if needed."
}

maestro_source_env() {
  local env_file

  # Fail hard without this worktree's slot lease (docs/specs/12).
  boga_require_slot_lease "$REPO_ROOT" || exit 1

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

  # Android emulator runtime (the android-* Maestro lanes). ANDROID_AVD is the
  # slot-named AVD `./boga worktree start` writes; ANDROID_SERIAL overrides it
  # with an already-connected device/emulator. The APK build cache is SHARED
  # across worktrees for the same reason the iOS .app cache is: the artifact is
  # host-local and byte-identical, so a fresh worktree reuses it instead of
  # rebuilding. Like the iOS root, a legacy per-slot root collapses back onto the
  # shared one.
  : "${ANDROID_AVD:=}"
  : "${ANDROID_SERIAL:=}"
  : "${ANDROID_EMULATOR_AUTO_CREATE:=1}"
  : "${ANDROID_AVD_TEMPLATE:=}"
  : "${MAESTRO_KEEP_EMULATOR_BOOTED:=0}"
  : "${MAESTRO_ANDROID_SHARED_BUILD_ROOT:=$HOME/.cache/boga/maestro/android-dev-client}"

  # A worktree generated before the Android keys existed has no ANDROID_AVD in its
  # env; derive the same slot-named value `./boga worktree start` writes now, so an
  # existing worktree runs the android-* lanes without regenerating its env. The
  # lease is already validated above, so the slot is trustworthy.
  if [[ -z "${ANDROID_AVD:-}" ]]; then
    local _android_slot
    if _android_slot="$(boga_read_slot_file "$REPO_ROOT" 2>/dev/null)"; then
      ANDROID_AVD="$(boga_android_avd_name_for_slot "$_android_slot")"
    fi
  fi

  case "$MAESTRO_ANDROID_SHARED_BUILD_ROOT" in
    */android-dev-client/wt[0-9]*)
      MAESTRO_ANDROID_SHARED_BUILD_ROOT="${MAESTRO_ANDROID_SHARED_BUILD_ROOT%/wt[0-9]*}"
      ;;
  esac

  # Always derive the APK path from the single shared root so the build-write and
  # cache-lookup paths can never diverge (same rule as the iOS .app path).
  MAESTRO_ANDROID_APK_PATH="$MAESTRO_ANDROID_SHARED_BUILD_ROOT/mobile-dev-client.apk"

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
  export ANDROID_AVD
  export ANDROID_SERIAL
  export ANDROID_EMULATOR_AUTO_CREATE
  export ANDROID_AVD_TEMPLATE
  export MAESTRO_KEEP_EMULATOR_BOOTED
  export MAESTRO_ANDROID_SHARED_BUILD_ROOT
  export MAESTRO_ANDROID_APK_PATH

  [[ -n "$EXPO_DEV_SERVER_PORT" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT. Run './boga worktree start' from the repo root or set it in $MAESTRO_LOCAL_ENV_FILE."
}

maestro_trim() {
  echo "$1" | xargs
}
