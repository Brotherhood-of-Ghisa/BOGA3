#!/usr/bin/env bash

# maestro-android-launch.sh — forward the Metro and (when configured) local
# Supabase ports to the emulator, start Metro, and open the installed dev client
# against it, blocking until Metro has served the app-entry bundle.
#
# Mirrors maestro-ios-launch.sh. Android reaches the host through `adb reverse`
# rather than the simulator sharing the host loopback, so the reverses are set up
# before the dev client is launched.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-android-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${LAUNCH_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/launch.log}"
: "${EXPO_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/expo-start.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$LAUNCH_LOG_FILE") 2>&1

maestro_require_command curl "Install curl."
maestro_android_require_sdk

[[ -n "${ANDROID_SERIAL:-}" ]] || maestro_fail "Missing ANDROID_SERIAL in runtime env."
[[ -n "${MAESTRO_ANDROID_PACKAGE:-}" ]] || maestro_fail "Missing Android package in runtime env."
[[ -n "${EXPO_DEV_SERVER_PORT:-}" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT in runtime env."

# The dev-client deep link. On Android, append the expo-dev-launcher reserved
# params that keep its launch-time UI off the RN root:
#   __expo_disable_onboarding  — finish onboarding (its sheet is a modal that
#                                replaces the accessibility tree)
#   __expo_disable_fab         — hide the floating tools button (overlaps header
#                                actions)
#   __expo_disable_auto_launch — do NOT open the dev menu at launch, which
#                                otherwise shows by default on Android (unlike
#                                iOS, whose dev menu is seeded off natively)
# The reserved `__expo_*` names are required (ExpoLauncherUrl.kt); only
# `disableOnboarding` has a legacy alias.
MAESTRO_DEV_CLIENT_URL="$(maestro_development_client_url "$EXPO_DEV_SERVER_PORT")&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1"

echo "[maestro-android-launch] Runtime env: $RUNTIME_ENV_FILE"
echo "[maestro-android-launch] Starting Expo on port $EXPO_DEV_SERVER_PORT"
echo "[maestro-android-launch] Dev client URL: $MAESTRO_DEV_CLIENT_URL"
echo "[maestro-android-launch] Device: $ANDROID_SERIAL"

# Forward the emulator's loopback to the host for Metro and, when the lane is
# Supabase-configured, the local API. `adb reverse` is idempotent; re-running is
# safe. The API port is derived from the same EXPO_PUBLIC_SUPABASE_URL the
# managed .env.local below pins, and only a loopback URL is forwarded (a hosted
# or LAN URL needs no reverse).
adb -s "$ANDROID_SERIAL" reverse "tcp:${EXPO_DEV_SERVER_PORT}" "tcp:${EXPO_DEV_SERVER_PORT}"
api_port="$(node -e '
  const value = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!value) process.exit(0);
  const url = new URL(value);
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    console.log(url.port || (url.protocol === "https:" ? "443" : "80"));
  }
' 2>/dev/null || true)"
if [[ -n "$api_port" ]]; then
  adb -s "$ANDROID_SERIAL" reverse "tcp:${api_port}" "tcp:${api_port}"
  echo "[maestro-android-launch] Forwarded local Supabase API port $api_port"
fi

cd "$APP_DIR"
# Pin this lane's Supabase config into apps/mobile/.env.local before starting the
# dev server (same contract as maestro-ios-launch.sh); teardown restores the
# developer's file. `--clear` is passed only when this lane's config differs from
# what Metro's transform cache was last built with.
maestro_write_managed_env_local "$APP_DIR" "$RUNTIME_ENV_FILE"
maestro_clear_flag=""
if [[ "${MAESTRO_METRO_CLEAR:-0}" == "1" ]]; then
  echo "[maestro-android-launch] Supabase config changed since last bundle; starting Expo with --clear"
  maestro_clear_flag="--clear"
fi

# Invoke the worktree-local executable directly so EXPO_PID owns the Metro
# listener (an `npx` wrapper would orphan Metro on teardown). `--host localhost`
# binds 127.0.0.1; adb reverse makes that reachable from the emulator.
# shellcheck disable=SC2086
CI=1 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" "$APP_DIR/node_modules/.bin/expo" start --dev-client $maestro_clear_flag --host localhost --port "$EXPO_DEV_SERVER_PORT" >"$EXPO_LOG_FILE" 2>&1 &
EXPO_PID=$!
maestro_write_runtime_env "$RUNTIME_ENV_FILE"

if ! maestro_wait_for_metro_status "$EXPO_DEV_SERVER_PORT" "${EXPO_START_WAIT_SECONDS:-30}"; then
  tail -n 120 "$EXPO_LOG_FILE" || true
  maestro_fail "Expo dev server did not become reachable on port $EXPO_DEV_SERVER_PORT within ${EXPO_START_WAIT_SECONDS:-30}s."
fi

if ! maestro_process_alive "$EXPO_PID"; then
  tail -n 120 "$EXPO_LOG_FILE" || true
  maestro_fail "Expo dev server exited before launch handoff."
fi

# Open the installed dev client against this Metro instance. The scheme is the
# expo-dev-client `exp+<scheme>` link the config plugin registers on Android.
adb -s "$ANDROID_SERIAL" shell am start \
  -a android.intent.action.VIEW \
  -d "$MAESTRO_DEV_CLIENT_URL" >/dev/null

# Block until Metro has built + served the app-entry bundle (the launch above
# made the dev client request it). Polling Metro's own log returns the instant the
# bundle is ready, with no separate warm-up driver. Best-effort like iOS: a miss
# only logs; the gated flow still asserts the RN root authoritatively.
if ! maestro_wait_for_metro_bundle "$EXPO_LOG_FILE" "${MAESTRO_BUNDLE_WAIT_SECONDS:-180}"; then
  echo "[maestro-android-launch] WARN: Metro app-entry bundle not confirmed within ${MAESTRO_BUNDLE_WAIT_SECONDS:-180}s; proceeding (gated flow asserts the RN root authoritatively)."
else
  echo "[maestro-android-launch] Metro app-entry bundle built and served (dev client hot)."
fi

if ! maestro_process_alive "$EXPO_PID"; then
  tail -n 120 "$EXPO_LOG_FILE" || true
  maestro_fail "Expo dev server exited immediately after opening the development client."
fi

maestro_write_runtime_env "$RUNTIME_ENV_FILE"

echo "[maestro-android-launch] Expo ready and development client opened on $ANDROID_SERIAL"
