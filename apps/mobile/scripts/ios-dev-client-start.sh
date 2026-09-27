#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"
maestro_source_env

maestro_require_command xcrun "Install Xcode and the iOS simulator runtime."
maestro_require_command open "Install macOS app launcher support."
maestro_require_command curl "Install curl."

APP_PATH="$("$SCRIPT_DIR/maestro-ios-dev-client-build.sh" --print-app-path | tail -n 1)"
APP_PATH="$(maestro_trim "$APP_PATH")"
BUNDLE_ID="$(maestro_dev_client_bundle_id "$APP_PATH")"
SCHEME="$(maestro_current_app_scheme)"
DEV_CLIENT_URL="$(maestro_development_client_url "$EXPO_DEV_SERVER_PORT")"

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  SIM_UDID="$(IOS_SIM_UDID="$IOS_SIM_UDID" IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}" "$SCRIPT_DIR/ios-sim-boot.sh")"
else
  SIM_UDID="$(IOS_SIM_DEVICE="$IOS_SIM_DEVICE" IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}" "$SCRIPT_DIR/ios-sim-boot.sh")"
fi

SIM_NAME="$(maestro_simulator_name_for_udid "$SIM_UDID")"

echo "[ios-dev-client-start] simulator: $SIM_NAME ($SIM_UDID)"
echo "[ios-dev-client-start] installing: $APP_PATH"
xcrun simctl install "$SIM_UDID" "$APP_PATH"
open -a Simulator --args -CurrentDeviceUDID "$SIM_UDID" >/dev/null 2>&1 || true

cleanup() {
  local exit_code=$?
  if [[ -n "${EXPO_PID:-}" ]] && maestro_process_alive "$EXPO_PID"; then
    kill "$EXPO_PID" 2>/dev/null || true
    wait "$EXPO_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "[ios-dev-client-start] starting Expo on port $EXPO_DEV_SERVER_PORT"
cd "$APP_DIR"
# Expo 57's `--host localhost` advertises 127.0.0.1 in its manifest but listens on
# whatever Node resolves `localhost` to first, which on macOS is IPv6 [::1]; the
# dev client then cannot fetch the bundle. ipv4first makes that listen bind
# 127.0.0.1, matching the manifest and the probes below.
CI=1 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" npx expo start --dev-client --host localhost --scheme "$SCHEME" --port "$EXPO_DEV_SERVER_PORT" &
EXPO_PID=$!

if ! maestro_wait_for_metro_status "$EXPO_DEV_SERVER_PORT" "${EXPO_START_WAIT_SECONDS:-30}"; then
  echo "[ios-dev-client-start] Expo dev server did not become reachable on port $EXPO_DEV_SERVER_PORT" >&2
  exit 1
fi

xcrun simctl terminate "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl openurl "$SIM_UDID" "$DEV_CLIENT_URL"

cat <<EOF
[ios-dev-client-start] ready
  simulator: $SIM_NAME ($SIM_UDID)
  expo:      http://127.0.0.1:$EXPO_DEV_SERVER_PORT
  app:       $BUNDLE_ID

Press Ctrl+C to stop Expo.
EOF

wait "$EXPO_PID"
