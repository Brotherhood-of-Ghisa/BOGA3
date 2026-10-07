#!/usr/bin/env bash
# Real Android Maestro runtime helpers, with stubbed adb/emulator: no SDK,
# emulator, device or slot lease needed. Guards the AVD discovery/creation and
# the runtime-state key set the android-* lanes depend on.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Isolate from any host SDK: a temp ANDROID_HOME with the expected subdirs (so
# android-env.sh takes it as-is and does not scan for the host's), a temp AVD
# home, and stub adb/emulator ahead of it on PATH.
export ANDROID_HOME="$WORK/sdk"
export ANDROID_SDK_ROOT=""
export ANDROID_AVD_HOME="$WORK/avd"
mkdir -p "$ANDROID_HOME/platform-tools" "$ANDROID_HOME/emulator" "$ANDROID_AVD_HOME" "$WORK/bin"
unset ANDROID_SERIAL ANDROID_AVD ANDROID_AVD_TEMPLATE ANDROID_EMULATOR_AUTO_CREATE

export STUB_LOG="$WORK/commands.log"
: >"$STUB_LOG"

cat > "$WORK/bin/adb" <<'STUB'
#!/usr/bin/env bash
printf 'adb %s\n' "$*" >> "${STUB_LOG}"
if [[ "$1" == "devices" ]]; then
  printf '%s\n' "${STUB_ADB_DEVICES:-}"
elif [[ "$3" == "emu" && "$4" == "avd" && "$5" == "name" ]]; then
  var="STUB_AVD_NAME_${2//-/_}"
  printf '%s\n' "${!var:-}"
elif [[ "$3" == "shell" && "$4" == "getprop" ]]; then
  printf '%s\n' "${STUB_BOOT_COMPLETED:-}"
fi
exit 0
STUB
cat > "$WORK/bin/emulator" <<'STUB'
#!/usr/bin/env bash
printf 'emulator %s\n' "$*" >> "${STUB_LOG}"
if [[ "$1" == "-list-avds" ]]; then
  printf '%s\n' ${STUB_AVD_LIST:-}
fi
exit 0
STUB
chmod +x "$WORK/bin/adb" "$WORK/bin/emulator"
export PATH="$WORK/bin:$PATH"

# shellcheck disable=SC1091
source "$SRC_ROOT/apps/mobile/scripts/maestro-android-runtime.sh"

PASS=0
assert() {
  if eval "$1"; then PASS=$((PASS + 1)); else echo "FAIL: $2" >&2; exit 1; fi
}

# 1. The runtime-state key set carries the Android keys (and the neutral URL).
keys="$(maestro_runtime_keys)"
for key in ANDROID_AVD ANDROID_SERIAL ANDROID_EMULATOR_AUTO_CREATE \
  MAESTRO_ANDROID_APK_PATH MAESTRO_ANDROID_PACKAGE MAESTRO_DEV_CLIENT_URL \
  EMULATOR_PID EMULATOR_LOG_FILE ANDROID_LOGCAT_FILE; do
  assert "grep -qxF '$key' <<<\"\$keys\"" "runtime keys include $key"
done

# 2. AVD existence reads emulator -list-avds exactly.
export STUB_AVD_LIST=$'BOGA_wt4\nPixel_10_Pro'
assert 'maestro_android_avd_exists BOGA_wt4' "lane AVD is found"
assert '! maestro_android_avd_exists BOGA_wt9' "missing AVD is not found"

# 3. The clone template is the first non-lane AVD; an explicit template wins.
assert '[[ "$(maestro_android_template_avd)" == Pixel_10_Pro ]]' "template is the first non-lane AVD"
ANDROID_AVD_TEMPLATE=Custom_Seed
assert '[[ "$(maestro_android_template_avd)" == Custom_Seed ]]' "ANDROID_AVD_TEMPLATE wins"
unset ANDROID_AVD_TEMPLATE
export STUB_AVD_LIST=$'BOGA_wt4\nBOGA_wt5'
assert '! maestro_android_template_avd' "no non-lane AVD means no template"

# 4. Serial discovery matches a running emulator by AVD name.
export STUB_ADB_DEVICES=$'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice'
export STUB_AVD_NAME_emulator_5554=BOGA_wt4
export STUB_AVD_NAME_emulator_5556=BOGA_wt5
assert '[[ "$(maestro_android_find_serial_for_avd BOGA_wt4)" == emulator-5554 ]]' "finds the emulator by AVD name"
assert '[[ "$(maestro_android_find_serial_for_avd BOGA_wt5)" == emulator-5556 ]]' "finds the second emulator"
assert '[[ -z "$(maestro_android_find_serial_for_avd BOGA_wt9)" ]]' "no serial for an unstarted AVD"
export STUB_ADB_DEVICES="List of devices attached"

# 5. AVD creation clones the template config with the new identity.
mkdir -p "$ANDROID_AVD_HOME/Seed.avd"
printf 'AvdId=Seed\navd.ini.displayname=Seed\nimage.sysdir.1=system-images/android-37.1/x86_64/\ntarget=android-37.1\n' \
  >"$ANDROID_AVD_HOME/Seed.avd/config.ini"
maestro_android_create_avd BOGA_wt7 Seed >/dev/null
assert '[[ -f "$ANDROID_AVD_HOME/BOGA_wt7.ini" && -f "$ANDROID_AVD_HOME/BOGA_wt7.avd/config.ini" ]]' "create writes the ini + config"
assert 'grep -qxF "AvdId=BOGA_wt7" "$ANDROID_AVD_HOME/BOGA_wt7.avd/config.ini"' "config identity is rewritten"
assert 'grep -qxF "target=android-37.1" "$ANDROID_AVD_HOME/BOGA_wt7.ini"' "ini carries the template target"
assert 'grep -qF "path=$ANDROID_AVD_HOME/BOGA_wt7.avd" "$ANDROID_AVD_HOME/BOGA_wt7.ini"' "ini points at the new AVD dir"

# 6. Boot-complete polling honours the property.
export STUB_BOOT_COMPLETED=1
assert 'maestro_android_wait_for_boot emulator-5554 5' "boot completes when the property is 1"
export STUB_BOOT_COMPLETED=""
assert '! maestro_android_wait_for_boot emulator-5554 0' "boot times out when the property never lands"

# 7. force-stop and logcat use the target serial.
: >"$STUB_LOG"
maestro_android_force_stop emulator-5554 com.phano.boga3.dev
assert 'grep -qxF "adb -s emulator-5554 shell am force-stop com.phano.boga3.dev" "$STUB_LOG"' "force-stop targets the serial"
maestro_capture_android_logs emulator-5554 "$WORK/logcat.txt"
assert '[[ -f "$WORK/logcat.txt" ]]' "logcat capture writes the artifact"
assert 'grep -qxF "adb -s emulator-5554 logcat -d -v threadtime" "$STUB_LOG"' "logcat targets the serial"

# 8. The runtime env persists the Android keys it was given.
TASK_ID=ad-hoc
ANDROID_AVD=BOGA_wt7
ANDROID_SERIAL=emulator-5554
MAESTRO_ANDROID_APK_PATH=/tmp/mobile-dev-client.apk
MAESTRO_ANDROID_PACKAGE=com.phano.boga3.dev
maestro_write_runtime_env "$WORK/runtime.env"
assert 'grep -qF "ANDROID_AVD=BOGA_wt7" "$WORK/runtime.env"' "runtime.env carries ANDROID_AVD"
assert 'grep -qF "MAESTRO_ANDROID_APK_PATH=/tmp/mobile-dev-client.apk" "$WORK/runtime.env"' "runtime.env carries the APK path"
assert 'grep -qF "MAESTRO_ANDROID_PACKAGE=com.phano.boga3.dev" "$WORK/runtime.env"' "runtime.env carries the package"

# 9. Permission pre-grant issues pm grant for the nearby/location permissions.
: >"$STUB_LOG"
maestro_android_preauthorize_permissions emulator-5554 com.phano.boga3.dev
assert 'grep -qxF "adb -s emulator-5554 shell pm grant com.phano.boga3.dev android.permission.ACCESS_LOCAL_NETWORK" "$STUB_LOG"' "pre-grants ACCESS_LOCAL_NETWORK"
assert 'grep -qxF "adb -s emulator-5554 shell pm grant com.phano.boga3.dev android.permission.ACCESS_FINE_LOCATION" "$STUB_LOG"' "pre-grants fine location"

echo "[maestro-android-runtime.test] $PASS assertions passed"
