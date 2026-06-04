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
# Pin this lane's Supabase config into apps/mobile/.env.local before starting the
# dev server. Expo's dev server reads .env.local authoritatively — in dev it wins
# over process.env and is what gets compiled into the served bundle — so a
# leftover file (the auth lanes write their local-Supabase env into it via
# local-runtime-up.sh) would otherwise flip a later infra-free gate (smoke /
# data-runtime-smoke) into a Supabase-configured build, breaking it (the
# login-on-start gate appears and the starter catalog stops seeding at boot).
# `maestro_write_managed_env_local` materializes the lane's intent (the real
# values the auth lane exported, or empty for every infra-free lane) and backs up
# the developer's file; `maestro-ios-teardown.sh` restores it afterwards.
maestro_write_managed_env_local "$APP_DIR" "$RUNTIME_ENV_FILE"
# `--clear` discards Metro's persistent transform cache on start. It is required
# when this lane's Supabase config differs from what the cache was last built with
# (see maestro_write_managed_env_local) — otherwise a previous run's supabase.ts
# transform, with its baked-in EXPO_PUBLIC_SUPABASE_URL, is reused even though we
# just materialized a different .env.local, and the build silently keeps the prior
# lane's backend. When the config is unchanged the cache is correct, so we skip the
# clear and keep the warm bundle. The warm-up step drives any cold bundle hot
# before the gated flow asserts, so a clear costs one cold bundle, not flow time.
maestro_clear_flag=""
if [[ "${MAESTRO_METRO_CLEAR:-0}" == "1" ]]; then
  echo "[maestro-ios-launch] Supabase config changed since last bundle; starting Expo with --clear"
  maestro_clear_flag="--clear"
fi
# $maestro_clear_flag is intentionally unquoted so an empty value adds no argument
# (safe under `set -u`); the only value it ever holds is the single word --clear.
# shellcheck disable=SC2086
CI=1 npx expo start --dev-client $maestro_clear_flag --host localhost --scheme "$SCHEME" --port "$EXPO_DEV_SERVER_PORT" >"$EXPO_LOG_FILE" 2>&1 &
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

# Seed the location TCC grant for the dev client AFTER it is installed (the
# provision step runs before this launch). The app requests location at session
# start, so on a cold sim with no prior grant iOS raises a native permission
# alert that steals focus and stalls Maestro's render-visibility assertions even
# though the screen renders underneath. A `full` provision reset clears any
# previous grant, so the alert reappears every cold run without this pre-auth.
# Granting here makes the dialog never render. Best-effort: never fails the launch.
maestro_preauthorize_location "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID"

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
