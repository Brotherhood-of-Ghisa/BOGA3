#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${LAUNCH_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/launch.log}"
: "${EXPO_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/expo-start.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$LAUNCH_LOG_FILE") 2>&1

maestro_require_command curl "Install curl."
maestro_require_command xcrun "Install Xcode and the iOS simulator runtime."

[[ -n "${IOS_SIM_UDID:-}" ]] || maestro_fail "Missing IOS_SIM_UDID in runtime env."
[[ -n "${MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID:-}" ]] || maestro_fail "Missing dev-client bundle id in runtime env."
[[ -n "${EXPO_DEV_SERVER_PORT:-}" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT in runtime env."

MAESTRO_IOS_DEV_CLIENT_URL="$(maestro_development_client_url "$EXPO_DEV_SERVER_PORT")"
SCHEME="$(maestro_current_app_scheme)"

echo "[maestro-ios-launch] Runtime env: $RUNTIME_ENV_FILE"
echo "[maestro-ios-launch] Starting Expo on port $EXPO_DEV_SERVER_PORT"
echo "[maestro-ios-launch] Launch scheme: $SCHEME"
echo "[maestro-ios-launch] Dev client URL: $MAESTRO_IOS_DEV_CLIENT_URL"

cd "$APP_DIR"
CI=1 npx expo start --dev-client --host localhost --scheme "$SCHEME" --port "$EXPO_DEV_SERVER_PORT" >"$EXPO_LOG_FILE" 2>&1 &
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

# Seed the URL-scheme trust approval BEFORE the first openurl so the cold-sim
# "Open in <App>?" SpringBoard dialog never renders. Without this, iOS-26 raises
# the prompt on the first deep link of each scheme and it covers the RN root.
# Best-effort: never fails the launch (the warm-up still backstops residual prompts).
maestro_preauthorize_url_schemes "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" "$SCHEME"

xcrun simctl terminate "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl openurl "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_URL"
sleep 5

if ! maestro_process_alive "$EXPO_PID"; then
  tail -n 120 "$EXPO_LOG_FILE" || true
  maestro_fail "Expo dev server exited immediately after opening the development client."
fi

maestro_write_runtime_env "$RUNTIME_ENV_FILE"

echo "[maestro-ios-launch] Expo ready and development client opened on $IOS_SIM_UDID"
