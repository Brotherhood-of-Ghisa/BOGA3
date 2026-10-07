#!/usr/bin/env bash

# maestro-android-provision.sh — ensure the shared APK exists, boot the lane
# emulator (or use ANDROID_SERIAL), install the app, and record runtime state.
#
# Mirrors maestro-ios-provision.sh. Reset taxonomy (spec 11): a `full` reset
# uninstalls the app before reinstalling it (cold-install semantics); the default
# `data` reset keeps the installed binary — the harness clears app data in-flow.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/maestro-android-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${PROVISION_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/provision.log}"
: "${EMULATOR_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/emulator.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$PROVISION_LOG_FILE") 2>&1

maestro_android_require_sdk

echo "[maestro-android-provision] Runtime env: $RUNTIME_ENV_FILE"
echo "[maestro-android-provision] Artifact root: $MAESTRO_ARTIFACT_ROOT"
echo "[maestro-android-provision] Reset strategy: ${MAESTRO_RESET_STRATEGY:-data}"

MAESTRO_ANDROID_APK_PATH="$("$SCRIPT_DIR/maestro-android-dev-client-build.sh" --print-apk-path | tail -n 1)"
MAESTRO_ANDROID_APK_PATH="$(maestro_trim "$MAESTRO_ANDROID_APK_PATH")"
MAESTRO_ANDROID_PACKAGE="$(maestro_current_android_package)"
[[ -n "$MAESTRO_ANDROID_PACKAGE" ]] \
  || maestro_fail "Unable to resolve the Android application id from $APP_DIR/app.config.ts."

# Start the lane emulator headless and, on success, set
# MAESTRO_ANDROID_BOOTED_SERIAL to its adb serial. Called DIRECTLY (not via
# command substitution) so EMULATOR_PID survives in the caller for teardown.
# Returns without starting anything when an emulator for the AVD is already
# running (EMULATOR_PID stays unset, so teardown leaves it alone).
maestro_android_boot_lane_emulator() {
  local avd="$1"
  local log_file="$2"
  local template serial started_at now

  if ! maestro_android_avd_exists "$avd"; then
    if [[ "${ANDROID_EMULATOR_AUTO_CREATE:-0}" != "1" ]]; then
      maestro_fail "AVD '$avd' does not exist and ANDROID_EMULATOR_AUTO_CREATE is not 1. Create it, or run './boga worktree start' to regenerate the lane env."
    fi
    template="$(maestro_android_template_avd)" \
      || maestro_fail "No AVD to clone lane AVD '$avd' from. Create one (Android Studio or avdmanager) or set ANDROID_AVD_TEMPLATE."
    maestro_android_create_avd "$avd" "$template"
  fi

  mkdir -p "$(dirname -- "$log_file")"
  echo "[maestro-android-provision] Starting emulator '$avd' (headless)"
  nohup emulator -avd "$avd" \
    -no-window -no-audio -no-boot-anim -no-snapshot \
    -gpu swiftshader_indirect >"$log_file" 2>&1 &
  EMULATOR_PID=$!
  export EMULATOR_PID

  started_at="$(date +%s)"
  while true; do
    serial="$(maestro_android_find_serial_for_avd "$avd")"
    if [[ -n "$serial" ]] && maestro_android_wait_for_boot "$serial" 5; then
      MAESTRO_ANDROID_BOOTED_SERIAL="$serial"
      export MAESTRO_ANDROID_BOOTED_SERIAL
      return 0
    fi

    if ! maestro_process_alive "$EMULATOR_PID"; then
      tail -n 80 "$log_file" >&2 || true
      maestro_fail "Android emulator '$avd' exited before booting (see $log_file)."
    fi

    now="$(date +%s)"
    if (( now - started_at >= ${ANDROID_EMULATOR_BOOT_TIMEOUT_SECONDS:-240} )); then
      tail -n 80 "$log_file" >&2 || true
      maestro_fail "Android emulator '$avd' did not boot within ${ANDROID_EMULATOR_BOOT_TIMEOUT_SECONDS:-240}s (see $log_file)."
    fi
    sleep 2
  done
}

if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  echo "[maestro-android-provision] Using configured device ANDROID_SERIAL=$ANDROID_SERIAL"
  adb -s "$ANDROID_SERIAL" get-state >/dev/null 2>&1 \
    || maestro_fail "ANDROID_SERIAL=$ANDROID_SERIAL is not a connected device (adb get-state failed)."
  if ! maestro_android_wait_for_boot "$ANDROID_SERIAL" "${ANDROID_DEVICE_BOOT_TIMEOUT_SECONDS:-60}"; then
    maestro_fail "Device $ANDROID_SERIAL did not report sys.boot_completed=1."
  fi
else
  [[ -n "${ANDROID_AVD:-}" ]] \
    || maestro_fail "Missing Android target. Set ANDROID_AVD (or ANDROID_SERIAL) in .maestro/maestro.env.local."
  ANDROID_SERIAL="$(maestro_android_find_serial_for_avd "$ANDROID_AVD")"
  if [[ -n "$ANDROID_SERIAL" ]]; then
    echo "[maestro-android-provision] Reusing running emulator for AVD '$ANDROID_AVD': $ANDROID_SERIAL"
    maestro_android_wait_for_boot "$ANDROID_SERIAL" "${ANDROID_DEVICE_BOOT_TIMEOUT_SECONDS:-60}" \
      || maestro_fail "Running emulator $ANDROID_SERIAL never reported boot-complete."
  else
    maestro_android_boot_lane_emulator "$ANDROID_AVD" "$EMULATOR_LOG_FILE"
    ANDROID_SERIAL="$MAESTRO_ANDROID_BOOTED_SERIAL"
  fi
fi

export ANDROID_SERIAL
echo "[maestro-android-provision] Device ready: $ANDROID_SERIAL"

# Persist runtime state NOW (before the install), so a failure below still leaves
# teardown the serial/emulator PID it needs to shut the lane emulator down rather
# than orphaning it.
maestro_write_runtime_env "$RUNTIME_ENV_FILE"

if [[ "${MAESTRO_RESET_STRATEGY:-data}" == "full" ]]; then
  echo "[maestro-android-provision] Performing full reset by uninstalling the dev client before reinstall"
  adb -s "$ANDROID_SERIAL" uninstall "$MAESTRO_ANDROID_PACKAGE" >/dev/null 2>&1 || true
fi

adb -s "$ANDROID_SERIAL" wait-for-device 2>/dev/null || true

# A freshly booted emulator's adbd can drop the first `adb install` with a
# `protocol fault`; reconnecting that device's transport clears it. Retry a few
# times, reconnecting between attempts, rather than failing the lane. Use
# `adb reconnect` (per-device) rather than `kill-server`, which would disrupt a
# concurrent lane's emulator in another worktree.
installed=0
for attempt in 1 2 3; do
  if adb -s "$ANDROID_SERIAL" install -r -t "$MAESTRO_ANDROID_APK_PATH"; then
    installed=1
    break
  fi

  echo "[maestro-android-provision] Install attempt ${attempt} failed; reconnecting adb and retrying"
  adb -s "$ANDROID_SERIAL" reconnect >/dev/null 2>&1 || true
  sleep 3
  adb -s "$ANDROID_SERIAL" wait-for-device 2>/dev/null || true
done
(( installed == 1 )) || maestro_fail "Failed to install the Android dev client after 3 attempts."

adb -s "$ANDROID_SERIAL" shell pm list packages "$MAESTRO_ANDROID_PACKAGE" 2>/dev/null \
  | grep -q "package:$MAESTRO_ANDROID_PACKAGE" \
  || maestro_fail "Package $MAESTRO_ANDROID_PACKAGE is not installed on $ANDROID_SERIAL after install."

maestro_android_preauthorize_permissions "$ANDROID_SERIAL" "$MAESTRO_ANDROID_PACKAGE"

maestro_write_runtime_env "$RUNTIME_ENV_FILE"

echo "[maestro-android-provision] Installed $MAESTRO_ANDROID_PACKAGE on $ANDROID_SERIAL"
