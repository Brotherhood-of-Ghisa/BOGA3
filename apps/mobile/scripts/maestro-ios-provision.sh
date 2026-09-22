#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"
maestro_source_env

RUNTIME_ENV_FILE="${1:-}"
[[ -n "$RUNTIME_ENV_FILE" ]] || maestro_fail "Usage: $0 <runtime-env-file>"

maestro_load_runtime_env "$RUNTIME_ENV_FILE"

: "${PROVISION_LOG_FILE:=$MAESTRO_ARTIFACT_ROOT/provision.log}"
mkdir -p "$MAESTRO_ARTIFACT_ROOT"
exec > >(tee -a "$PROVISION_LOG_FILE") 2>&1

maestro_require_command open "Install macOS app launcher support."
maestro_require_command xcrun "Install Xcode and the iOS simulator runtime."

echo "[maestro-ios-provision] Runtime env: $RUNTIME_ENV_FILE"
echo "[maestro-ios-provision] Artifact root: $MAESTRO_ARTIFACT_ROOT"
echo "[maestro-ios-provision] Reset strategy: ${MAESTRO_RESET_STRATEGY:-data}"

MAESTRO_IOS_DEV_CLIENT_APP_PATH="$("$SCRIPT_DIR/maestro-ios-dev-client-build.sh" --print-app-path | tail -n 1)"
MAESTRO_IOS_DEV_CLIENT_APP_PATH="$(maestro_trim "$MAESTRO_IOS_DEV_CLIENT_APP_PATH")"
MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID="$(maestro_dev_client_bundle_id "$MAESTRO_IOS_DEV_CLIENT_APP_PATH")"
MAESTRO_IOS_DEV_CLIENT_EXECUTABLE="$(maestro_dev_client_executable_name "$MAESTRO_IOS_DEV_CLIENT_APP_PATH")"

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  echo "[maestro-ios-provision] Booting configured simulator UDID: $IOS_SIM_UDID"
  IOS_SIM_UDID="$(IOS_SIM_UDID="$IOS_SIM_UDID" IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}" "$SCRIPT_DIR/ios-sim-boot.sh")"
else
  echo "[maestro-ios-provision] Booting configured simulator device: $IOS_SIM_DEVICE"
  IOS_SIM_UDID="$(IOS_SIM_DEVICE="$IOS_SIM_DEVICE" IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}" "$SCRIPT_DIR/ios-sim-boot.sh")"
fi

IOS_SIM_DEVICE="$(maestro_simulator_name_for_udid "$IOS_SIM_UDID")"
echo "[maestro-ios-provision] Simulator ready: $IOS_SIM_DEVICE ($IOS_SIM_UDID)"

# ios-sim-boot.sh has already waited (bounded) for boot-complete; a second bare
# `bootstatus -b` here would block forever on a device that stops booting.
open -a Simulator --args -CurrentDeviceUDID "$IOS_SIM_UDID" >/dev/null 2>&1 || true

if [[ "${MAESTRO_RESET_STRATEGY:-data}" == "full" ]]; then
  echo "[maestro-ios-provision] Performing full reset by uninstalling the dev client before reinstall"
  xcrun simctl uninstall "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" >/dev/null 2>&1 || true
fi

for attempt in 1 2; do
  if xcrun simctl install "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_APP_PATH"; then
    break
  fi

  if (( attempt == 2 )); then
    maestro_fail "Failed to install the iOS dev client after ${attempt} attempts."
  fi

  echo "[maestro-ios-provision] Retrying dev-client install after transient simctl failure"
  sleep 2
done

xcrun simctl get_app_container "$IOS_SIM_UDID" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" >/dev/null

maestro_write_runtime_env "$RUNTIME_ENV_FILE"

echo "[maestro-ios-provision] Installed $MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID on $IOS_SIM_UDID"
