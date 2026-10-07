#!/usr/bin/env bash

# maestro-android-runtime.sh — Android-specific Maestro runtime helpers. Sourced,
# never run. The platform-neutral helpers live in maestro-runtime.sh, which this
# file sources; everything here is Android-only: SDK/adb checks, AVD lifecycle
# (find, create, boot), APK/package resolution and logcat capture.
#
# The Android lane uses a slot-named AVD (`BOGA_wt<slot>`) so parallel worktrees
# never share an emulator, mirroring the iOS `BOGA wt<slot>` simulator rule.
# ANDROID_SERIAL overrides the AVD with an already-connected device.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/maestro-runtime.sh"

maestro_runtime_keys() {
  cat <<'EOF'
TASK_ID
MAESTRO_SESSION_TIMESTAMP
MAESTRO_SCENARIO_NAME
MAESTRO_RUNNER_PID
MAESTRO_ARTIFACT_ROOT
MAESTRO_RUNTIME_ENV_FILE
MAESTRO_FLOW_SOURCE_FILE
MAESTRO_FLOW_FILE
MAESTRO_OUTPUT_DIR
MAESTRO_DEBUG_DIR
MAESTRO_JUNIT_FILE
PROVISION_LOG_FILE
LAUNCH_LOG_FILE
TEARDOWN_LOG_FILE
EXPO_LOG_FILE
MAESTRO_RESET_STRATEGY
ANDROID_AVD
ANDROID_SERIAL
ANDROID_EMULATOR_AUTO_CREATE
EXPO_DEV_SERVER_PORT
MAESTRO_ANDROID_APK_PATH
MAESTRO_ANDROID_PACKAGE
MAESTRO_DEV_CLIENT_URL
EXPO_PID
EMULATOR_PID
EMULATOR_LOG_FILE
ANDROID_LOGCAT_FILE
MAESTRO_ENV_LOCAL_PATH
MAESTRO_ENV_LOCAL_BACKUP
EOF
}

maestro_android_require_sdk() {
  [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME:-}" ]] \
    || maestro_fail "ANDROID_HOME is not set to an existing Android SDK. Run './boga doctor --android'."
  maestro_require_command adb "Install the Android platform tools (run './boga doctor --android')."
  maestro_require_command emulator "Install the Android emulator (run './boga doctor --android')."
}

# --- AVD / device discovery ---------------------------------------------------

maestro_android_avd_home() {
  printf '%s\n' "${ANDROID_AVD_HOME:-$HOME/.android/avd}"
}

maestro_android_avd_exists() {
  local name="$1"
  [[ -n "$name" ]] || return 1
  emulator -list-avds 2>/dev/null | grep -Fxq -- "$name"
}

# Running emulator serials, one per line.
maestro_android_running_emulators() {
  adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" && $1 ~ /^emulator-/ { print $1 }'
}

# The AVD name of a running emulator serial (empty when unknown).
maestro_android_serial_avd_name() {
  local serial="$1"
  adb -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | head -n 1
}

# The serial of a running emulator whose AVD name is exactly <name>, or empty.
maestro_android_find_serial_for_avd() {
  local wanted="$1" serial
  while IFS= read -r serial; do
    [[ -n "$serial" ]] || continue
    if [[ "$(maestro_android_serial_avd_name "$serial")" == "$wanted" ]]; then
      printf '%s\n' "$serial"
      return 0
    fi
  done < <(maestro_android_running_emulators)
}

# The seed AVD a missing lane AVD is cloned from: ANDROID_AVD_TEMPLATE when set,
# else the first AVD on the host that is not itself a lane AVD. Prints nothing
# and returns 1 when there is none.
maestro_android_template_avd() {
  local name
  if [[ -n "${ANDROID_AVD_TEMPLATE:-}" ]]; then
    printf '%s\n' "$ANDROID_AVD_TEMPLATE"
    return 0
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if ! boga_is_lane_avd_name "$name"; then
      printf '%s\n' "$name"
      return 0
    fi
  done < <(emulator -list-avds 2>/dev/null)
  return 1
}

# Create the lane AVD by cloning a template AVD's config. avdmanager is NOT
# required: the Android SDK ships without cmdline-tools on many hosts, and a lane
# AVD needs only a valid <name>.ini + <name>.avd/config.ini — the emulator
# materializes userdata from the system image on first boot. Cloning the
# template's config keeps the system image, ABI, skin and hardware profile in
# step with the host. A clean lane AVD is created, never the template's data.
maestro_android_create_avd() {
  local name="$1"
  local template="$2"
  local avd_home seed_config target

  avd_home="$(maestro_android_avd_home)"
  seed_config="$avd_home/$template.avd/config.ini"
  [[ -f "$seed_config" ]] \
    || maestro_fail "Cannot create AVD '$name': template AVD '$template' has no config at $seed_config."

  target="$(awk -F= '$1 == "target" { print $2 }' "$seed_config" | tail -n 1)"
  [[ -n "$target" ]] || maestro_fail "Cannot create AVD '$name': template '$template' config has no target."

  mkdir -p "$avd_home/$name.avd"
  cat > "$avd_home/$name.ini" <<EOF
avd.ini.encoding=UTF-8
path=$avd_home/$name.avd
path.rel=avd/$name.avd
target=$target
EOF
  sed -e "s/^AvdId=.*/AvdId=$name/" -e "s/^avd.ini.displayname=.*/avd.ini.displayname=$name/" \
    "$seed_config" > "$avd_home/$name.avd/config.ini"

  echo "[maestro] created lane AVD '$name' cloned from '$template' ($avd_home/$name.avd)"
}

# Wait for sys.boot_completed=1 on <serial>, bounded.
maestro_android_wait_for_boot() {
  local serial="$1"
  local timeout_seconds="$2"
  local started_at now boot

  started_at="$(date +%s)"
  while true; do
    boot="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    [[ "$boot" == "1" ]] && return 0

    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      return 1
    fi
    sleep 2
  done
}

# --- APK / package ------------------------------------------------------------

# The Android application id the dev-client APK was built with. Derived from the
# same app config the build used, so it can never drift from the installed APK.
maestro_current_android_package() {
  (
    cd "$APP_DIR"
    npx expo config --json
  ) | node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    const pkg = config?.android?.package;
    console.log(typeof pkg === "string" ? pkg : "");
  '
}

# --- device log capture -------------------------------------------------------

# Dump the device logcat into the artifact root. `-d` dumps the current buffer
# and exits (no follow), so it never blocks teardown. Best-effort: a missing
# device only skips the capture.
maestro_capture_android_logs() {
  local serial="$1"
  local output_file="$2"

  [[ -n "$serial" ]] || return 0
  mkdir -p "$(dirname -- "$output_file")"
  adb -s "$serial" logcat -d -v threadtime >"$output_file" 2>&1 || true
}

maestro_android_force_stop() {
  local serial="$1"
  local package="$2"

  [[ -n "$serial" && -n "$package" ]] || return 0
  adb -s "$serial" shell am force-stop "$package" >/dev/null 2>&1 || true
}

# Pre-grant the runtime permissions the dev client requests so the native
# "nearby devices" dialog (`ACCESS_LOCAL_NETWORK`, Android 16) and the location
# dialogs never render over the RN root on a cold install — the Android analogue
# of maestro_preauthorize_location. `pm grant` writes exactly the grant a human's
# "Allow" tap would. Best-effort by design: an undeclared or ungrantable
# permission is logged, never fatal, so the warm-up/flow still backstops it.
maestro_android_preauthorize_permissions() {
  local serial="$1"
  local package="$2"
  local permission

  [[ -n "$serial" && -n "$package" ]] || return 0

  echo "[maestro] pre-granting dev-client permissions for $package on $serial so the cold-install dialogs never appear"
  for permission in \
    android.permission.ACCESS_LOCAL_NETWORK \
    android.permission.ACCESS_FINE_LOCATION \
    android.permission.ACCESS_COARSE_LOCATION \
    android.permission.POST_NOTIFICATIONS
  do
    if adb -s "$serial" shell pm grant "$package" "$permission" >/dev/null 2>&1; then
      echo "[maestro]   granted '$permission' -> $package"
    else
      echo "[maestro]   could not pre-grant '$permission' (best-effort)"
    fi
  done
}
