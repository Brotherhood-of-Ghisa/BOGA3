#!/usr/bin/env bash
# Real dispatcher + env helpers, with adb/Expo/JDK stubs: no SDK, device or DB needed.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
WORK="$(cd "$WORK" && pwd -P)"
FIXTURE="$WORK/repo"
export BOGA_CONFIG_ROOT="$WORK/config"
export ANDROID_TEST_HOME="$WORK/user"
export ANDROID_TEST_LOG="$WORK/commands.log"
export JAVA_HOME="$WORK/jdk"
mkdir -p "$FIXTURE/scripts/dev" "$FIXTURE/apps/mobile/.maestro" \
  "$BOGA_CONFIG_ROOT/worktrees/slots" "$WORK/bin" "$JAVA_HOME/bin" \
  "$ANDROID_TEST_HOME/Library/Android/sdk/platform-tools" \
  "$ANDROID_TEST_HOME/Library/Android/sdk/emulator" "$WORK/legacy-sdk" "$WORK/explicit-sdk"
cp "$SRC_ROOT/boga" "$FIXTURE/"
cp "$SRC_ROOT/scripts/"{worktree-lib.sh,lane-timing.sh,java-env.sh} "$FIXTURE/scripts/"
cp "$SRC_ROOT/scripts/dev/export-mobile-supabase-env.sh" "$FIXTURE/scripts/dev/"
# Redirect only home-directory lookups in the copied helper; never change the
# caller's HOME or depend on/create anything in the machine's real SDK folders.
sed 's/${HOME}/${ANDROID_TEST_HOME}/g' "$SRC_ROOT/scripts/android-env.sh" > "$FIXTURE/scripts/android-env.sh"
cat > "$JAVA_HOME/bin/java" <<'STUB'
#!/usr/bin/env bash
printf 'openjdk version "17.0.1"\n' >&2
STUB
cat > "$ANDROID_TEST_HOME/Library/Android/sdk/platform-tools/adb" <<'STUB'
#!/usr/bin/env bash
printf 'adb %s\n' "$*" >> "$ANDROID_TEST_LOG"
exit "${ANDROID_TEST_ADB_EXIT:-0}"
STUB
cat > "$WORK/bin/npx" <<'STUB'
#!/usr/bin/env bash
printf 'npx %s\n' "$*" >> "$ANDROID_TEST_LOG"
printf 'sdk=%s\njava=%s\nmetro=%s\nurl=%s\n' "$ANDROID_HOME" "$JAVA_HOME" "$EXPO_DEV_SERVER_PORT" "${EXPO_PUBLIC_SUPABASE_URL:-}" >> "$ANDROID_TEST_LOG"
STUB
chmod +x "$JAVA_HOME/bin/java" "$WORK/bin/npx" "$ANDROID_TEST_HOME/Library/Android/sdk/platform-tools/adb"
export PATH="$WORK/bin:$PATH"
unset ANDROID_HOME ANDROID_SDK_ROOT EXPO_DEV_SERVER_PORT EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY

PASS=0
assert_eq() {
  [[ "$1" == "$2" ]] || { echo "FAIL: $3 (got '$1', want '$2')" >&2; exit 1; }
  PASS=$((PASS + 1))
}
assert_log() {
  grep -qFx -- "$1" "$ANDROID_TEST_LOG" || { echo "FAIL: missing '$1'" >&2; cat "$ANDROID_TEST_LOG" >&2; exit 1; }
  PASS=$((PASS + 1))
}
configure() {
  printf '%s\n' "$1" > "$FIXTURE/.worktree-slot"
  printf 'path=%s\n' "$FIXTURE" > "$BOGA_CONFIG_ROOT/worktrees/slots/$1"
  # Same shell-default syntax emitted by worktree-start.sh.
  printf 'EXPO_DEV_SERVER_PORT="${EXPO_DEV_SERVER_PORT:-%s}"\n' "$((8082 + $1))" > "$FIXTURE/apps/mobile/.maestro/maestro.env.local"
  printf 'EXPO_PUBLIC_SUPABASE_URL=%s\nEXPO_PUBLIC_SUPABASE_ANON_KEY=fixture\n' "$2" > "$FIXTURE/apps/mobile/.env.local"
}
launch() {
  : > "$ANDROID_TEST_LOG"
  "$FIXTURE/boga" android "$@" > "$WORK/output" 2>&1 || { cat "$WORK/output" >&2; return 1; }
}
reject() {
  : > "$ANDROID_TEST_LOG"
  if "$FIXTURE/boga" android "$@" > "$WORK/output" 2>&1; then
    echo "FAIL: accepted invalid launcher input: $*" >&2; exit 1
  fi
  assert_eq "$(cat "$ANDROID_TEST_LOG")" "" "invalid port rejected before adb/Expo"
}

for action in run start; do
  expo_command='run:android'
  [[ "$action" == run ]] || expo_command='start --dev-client'
  for slot in 0 1 7; do
    api_port="$((55431 + 100 * slot))"
    [[ "$slot" != 0 ]] || api_port=65431
    configure "$slot" "http://127.0.0.1:$api_port"
    launch "$action"
    assert_log "npx expo $expo_command --port $((8082 + slot))"
    assert_log "adb reverse tcp:$((8082 + slot)) tcp:$((8082 + slot))"
    assert_log "adb reverse tcp:$api_port tcp:$api_port"
    assert_log "sdk=$ANDROID_TEST_HOME/Library/Android/sdk"
    assert_log "java=$JAVA_HOME"
  done
  EXPO_DEV_SERVER_PORT=9123 launch "$action"
  assert_log "npx expo $expo_command --port 9123"
  assert_log 'adb reverse tcp:9123 tcp:9123'
  launch "$action" --port 9222
  assert_log "npx expo $expo_command --port 9222"
  assert_log 'adb reverse tcp:9222 tcp:9222'
  launch "$action" --port=9333
  assert_log "npx expo $expo_command --port 9333"
  assert_log 'adb reverse tcp:9333 tcp:9333'
  for invalid in 'not-a-port' '${EXPO_DEV_SERVER_PORT:-8082}' 0 65536 ''; do
    reject "$action" --port="$invalid"
  done
  reject "$action" --port
  printf 'EXPO_DEV_SERVER_PORT=invalid\n' > "$FIXTURE/apps/mobile/.maestro/maestro.env.local"
  reject "$action"
done

configure 1 http://localhost:55531
EXPO_PUBLIC_SUPABASE_URL=https://stale.example.test launch run --no-bundler
assert_log 'npx expo run:android --port 8083 --no-bundler'
assert_log 'url=http://localhost:55531'
assert_log 'adb reverse tcp:55531 tcp:55531'
rm "$FIXTURE/apps/mobile/.maestro/maestro.env.local"
launch start
assert_log 'npx expo start --dev-client --port 8083'
for url in https://project.supabase.co http://192.168.1.9:65431 ''; do
  configure 1 "$url"
  launch start
  assert_eq "$(grep -c '^adb ' "$ANDROID_TEST_LOG")" 1 'non-loopback/unconfigured backend has no API reverse'
done
configure 1 'http://[::1]:55531'
launch start
assert_log 'adb reverse tcp:55531 tcp:55531'
if ANDROID_TEST_ADB_EXIT=1 launch start; then
  echo 'FAIL: adb failure should stop launch' >&2; exit 1
fi
assert_eq "$(grep -c '^npx ' "$ANDROID_TEST_LOG" || true)" 0 'adb failure prevents Expo launch'

# Discovery precedence and PATH idempotence use the real helper logic.
helper="$FIXTURE/scripts/android-env.sh"
assert_eq "$(source "$helper"; source "$helper"; printf '%s' "$ANDROID_HOME")" "$ANDROID_TEST_HOME/Library/Android/sdk" 'macOS SDK default'
assert_eq "$(ANDROID_SDK_ROOT="$WORK/legacy-sdk"; source "$helper"; printf '%s' "$ANDROID_HOME")" "$WORK/legacy-sdk" 'valid legacy SDK root'
assert_eq "$(ANDROID_HOME="$WORK/explicit-sdk"; ANDROID_SDK_ROOT="$WORK/legacy-sdk"; source "$helper"; printf '%s' "$ANDROID_HOME")" "$WORK/explicit-sdk" 'explicit SDK wins'
assert_eq "$(ANDROID_SDK_ROOT="$WORK/missing"; source "$helper"; printf '%s' "$ANDROID_HOME")" "$ANDROID_TEST_HOME/Library/Android/sdk" 'invalid legacy root falls back'
assert_eq "$(source "$helper"; old_path="$PATH"; source "$helper"; [[ "$old_path" == "$PATH" ]]; echo "$?")" 0 'sourcing twice leaves PATH unchanged'
mv "$ANDROID_TEST_HOME/Library/Android/sdk" "$WORK/mac-sdk"
mkdir -p "$ANDROID_TEST_HOME/Android/Sdk"
assert_eq "$(source "$helper"; printf '%s' "$ANDROID_HOME")" "$ANDROID_TEST_HOME/Android/Sdk" 'Linux SDK default retained'
echo "[android-launcher.test] $PASS assertions passed"
