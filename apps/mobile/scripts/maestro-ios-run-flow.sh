#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"
maestro_source_env

FLOW_SOURCE=""
SCENARIO_NAME=""

usage() {
  cat <<'EOF'
Usage: ./scripts/maestro-ios-run-flow.sh --flow <flow-file> --scenario <name>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --flow)
      FLOW_SOURCE="$2"
      shift 2
      ;;
    --scenario)
      SCENARIO_NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      maestro_fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$FLOW_SOURCE" ]] || maestro_fail "Missing --flow argument."
[[ -n "$SCENARIO_NAME" ]] || maestro_fail "Missing --scenario argument."
[[ -f "$FLOW_SOURCE" ]] || maestro_fail "Missing Maestro flow file: $FLOW_SOURCE"

maestro_require_command maestro "Install Maestro from https://maestro.mobile.dev."

MAESTRO_RUNNER_PID="$$"

MAESTRO_SESSION_TIMESTAMP="$(date +"%Y%m%d-%H%M%S")-$$"
MAESTRO_SCENARIO_NAME="$SCENARIO_NAME"
MAESTRO_ARTIFACT_ROOT="$(maestro_runtime_artifact_root "$MAESTRO_SESSION_TIMESTAMP")"
MAESTRO_RUNTIME_ENV_FILE="$MAESTRO_ARTIFACT_ROOT/runtime.env"
MAESTRO_FLOW_SOURCE_FILE="$FLOW_SOURCE"
MAESTRO_OUTPUT_DIR="$MAESTRO_ARTIFACT_ROOT/maestro-output"
MAESTRO_DEBUG_DIR="$MAESTRO_ARTIFACT_ROOT/maestro-debug"
MAESTRO_JUNIT_FILE="$MAESTRO_ARTIFACT_ROOT/maestro-junit.xml"
PROVISION_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/provision.log"
LAUNCH_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/launch.log"
TEARDOWN_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/teardown.log"
EXPO_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/expo-start.log"
SIMULATOR_SYSTEM_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/simulator-system.log"

mkdir -p "$MAESTRO_OUTPUT_DIR" "$MAESTRO_DEBUG_DIR"

[[ -n "${EXPO_DEV_SERVER_PORT:-}" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT. Set it in .maestro/maestro.env.local."
if [[ -z "${IOS_SIM_UDID:-}" && -z "${IOS_SIM_DEVICE:-}" ]]; then
  maestro_fail "Missing simulator target. Set IOS_SIM_UDID or IOS_SIM_DEVICE in .maestro/maestro.env.local."
fi

maestro_write_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

cleanup() {
  local exit_code=$?
  trap - EXIT
  # Keep cleanup centralized so both success and failure paths terminate Metro/app state consistently.
  if [[ -f "$MAESTRO_RUNTIME_ENV_FILE" ]]; then
    "$SCRIPT_DIR/maestro-ios-teardown.sh" "$MAESTRO_RUNTIME_ENV_FILE" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

"$SCRIPT_DIR/maestro-ios-provision.sh" "$MAESTRO_RUNTIME_ENV_FILE"
"$SCRIPT_DIR/maestro-ios-launch.sh" "$MAESTRO_RUNTIME_ENV_FILE"
maestro_load_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

# Cold sims (e.g. a freshly auto-created slot) need the cold Metro JS bundle
# driven hot before the gated flow's 30s assertion window. The dev-client
# "Open in <App>?" URL-scheme trust dialog is already pre-authorized away in
# maestro-ios-launch.sh, so the warm-up's main job here is to load the bundle;
# it also keeps best-effort dialog dismissal as defense-in-depth. Idempotent:
# no-ops on warm sims.
maestro_warm_dev_client \
  "$IOS_SIM_UDID" \
  "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" \
  "$MAESTRO_IOS_DEV_CLIENT_URL" \
  "$MAESTRO_ARTIFACT_ROOT/warmup.yaml" \
  "$MAESTRO_ARTIFACT_ROOT/maestro-warmup"

flow_basename="$(basename -- "$FLOW_SOURCE")"
MAESTRO_FLOW_FILE="$MAESTRO_ARTIFACT_ROOT/$flow_basename"
maestro_prepare_flow_copy "$FLOW_SOURCE" "$MAESTRO_FLOW_FILE" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID"
maestro_write_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

set +e
maestro test "$MAESTRO_FLOW_FILE" \
  --udid "$IOS_SIM_UDID" \
  --format junit \
  --output "$MAESTRO_JUNIT_FILE" \
  --debug-output "$MAESTRO_DEBUG_DIR" \
  --test-output-dir "$MAESTRO_OUTPUT_DIR"
maestro_exit_code=$?
set -e

# Maestro 2.x exits 0 even when flows fail; fall back to JUnit inspection so quality-slow gates fail correctly.
if (( maestro_exit_code == 0 )) && [[ -f "$MAESTRO_JUNIT_FILE" ]]; then
  if grep -Eq '(failures|errors)="[1-9]' "$MAESTRO_JUNIT_FILE"; then
    echo "[maestro-ios-run-flow] Detected flow failures in $MAESTRO_JUNIT_FILE despite maestro exit 0; treating as failure." >&2
    maestro_exit_code=1
  fi
fi

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  echo "[maestro-ios-run-flow] Capturing simulator system logs to $SIMULATOR_SYSTEM_LOG_FILE"
  maestro_capture_simulator_logs \
    "$IOS_SIM_UDID" \
    "${MAESTRO_IOS_DEV_CLIENT_EXECUTABLE:-}" \
    "$SIMULATOR_SYSTEM_LOG_FILE" \
    "30m" || true
fi

echo "${SCENARIO_NAME} run complete."
echo "Artifacts: $MAESTRO_ARTIFACT_ROOT"
echo "Runtime: port=$EXPO_DEV_SERVER_PORT, device=${IOS_SIM_DEVICE:-}, udid=${IOS_SIM_UDID:-}"

exit "$maestro_exit_code"
