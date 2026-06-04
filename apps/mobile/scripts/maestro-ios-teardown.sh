#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"
[[ -f "$RUNTIME_ENV_FILE" ]] || exit 0

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${TEARDOWN_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/teardown.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$TEARDOWN_LOG_FILE") 2>&1

echo "[maestro-ios-teardown] Runtime env: $RUNTIME_ENV_FILE"

if [[ -n "${EXPO_PID:-}" ]] && maestro_process_alive "$EXPO_PID"; then
  echo "[maestro-ios-teardown] Stopping Expo process $EXPO_PID"
  kill "$EXPO_PID" >/dev/null 2>&1 || true
  if ! maestro_wait_for_process_exit "$EXPO_PID" 10; then
    echo "[maestro-ios-teardown] Expo process did not exit cleanly; sending SIGKILL"
    kill -9 "$EXPO_PID" >/dev/null 2>&1 || true
  fi
else
  echo "[maestro-ios-teardown] No active Expo process recorded"
fi

# Restore the developer's .env.local that the launch step set aside while it
# pinned this lane's Supabase config (no-op when nothing was managed). Done after
# the dev server is stopped so the restore can never feed a mid-flow reload.
if [[ -n "${MAESTRO_ENV_LOCAL_PATH:-}" ]]; then
  echo "[maestro-ios-teardown] Restoring developer .env.local (${MAESTRO_ENV_LOCAL_BACKUP:+from backup})"
  maestro_restore_managed_env_local
fi

if [[ -n "${IOS_SIM_UDID:-}" && -n "${MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID:-}" ]]; then
  echo "[maestro-ios-teardown] Terminating app $MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID on $IOS_SIM_UDID"
  xcrun simctl terminate "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" >/dev/null 2>&1 || true
fi

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  if [[ "${MAESTRO_KEEP_SIMULATOR_BOOTED:-0}" == "1" ]]; then
    echo "[maestro-ios-teardown] Keeping simulator booted: $IOS_SIM_UDID"
  else
    echo "[maestro-ios-teardown] Shutting down simulator $IOS_SIM_UDID"
    xcrun simctl shutdown "$IOS_SIM_UDID" >/dev/null 2>&1 || true
  fi
fi

echo "[maestro-ios-teardown] Teardown complete"
