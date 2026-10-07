#!/usr/bin/env bash

# maestro-android-teardown.sh — stop Metro, restore the developer's .env.local,
# stop the app, and shut down the lane emulator (unless it was pre-existing or
# MAESTRO_KEEP_EMULATOR_BOOTED=1). Mirrors maestro-ios-teardown.sh.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/maestro-android-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"
[[ -f "$RUNTIME_ENV_FILE" ]] || exit 0

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${TEARDOWN_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/teardown.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$TEARDOWN_LOG_FILE") 2>&1

echo "[maestro-android-teardown] Runtime env: $RUNTIME_ENV_FILE"

if [[ -n "${EXPO_PID:-}" ]] && maestro_process_alive "$EXPO_PID"; then
  echo "[maestro-android-teardown] Stopping Expo process $EXPO_PID"
  kill "$EXPO_PID" >/dev/null 2>&1 || true
  if ! maestro_wait_for_process_exit "$EXPO_PID" 10; then
    echo "[maestro-android-teardown] Expo process did not exit cleanly; sending SIGKILL"
    kill -9 "$EXPO_PID" >/dev/null 2>&1 || true
  fi
else
  echo "[maestro-android-teardown] No active Expo process recorded"
fi

# Restore the developer's .env.local that the launch step set aside while it
# pinned this lane's Supabase config (no-op when nothing was managed). Done after
# the dev server is stopped so the restore can never feed a mid-flow reload.
if [[ -n "${MAESTRO_ENV_LOCAL_PATH:-}" ]]; then
  echo "[maestro-android-teardown] Restoring developer .env.local (${MAESTRO_ENV_LOCAL_BACKUP:+from backup})"
  maestro_restore_managed_env_local
fi

maestro_android_force_stop "${ANDROID_SERIAL:-}" "${MAESTRO_ANDROID_PACKAGE:-}"

# Only a lane emulator this run started (EMULATOR_PID set) is shut down; a
# reused, pre-existing emulator is left as found.
if [[ -n "${EMULATOR_PID:-}" && -n "${ANDROID_SERIAL:-}" ]]; then
  if [[ "${MAESTRO_KEEP_EMULATOR_BOOTED:-0}" == "1" ]]; then
    echo "[maestro-android-teardown] Keeping emulator booted: $ANDROID_SERIAL (pid $EMULATOR_PID)"
  else
    echo "[maestro-android-teardown] Shutting down emulator $ANDROID_SERIAL"
    adb -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
    if ! maestro_wait_for_process_exit "$EMULATOR_PID" 30; then
      echo "[maestro-android-teardown] Emulator process did not exit; sending SIGTERM"
      kill "$EMULATOR_PID" >/dev/null 2>&1 || true
    fi
  fi
fi

echo "[maestro-android-teardown] Teardown complete"
