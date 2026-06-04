#!/usr/bin/env bash

# Combined iOS gate runner: runs the Smoke, Data-runtime-smoke, and Dev wipe-local
# flows against ONE provisioned simulator and ONE Metro instance, instead of
# cold-booting, warming, and tearing down a simulator once PER gate.
#
# Why: each standalone gate pays a ~55-60s fixed overhead (cold sim boot +
# dev-client warm-up + Metro start + teardown) before its flow even runs. Run
# back-to-back as separate gates that is paid twice (~83s + ~113s). Sharing one
# launch pays it once, so the second flow starts against an already-warm sim +
# hot Metro bundle (see test-suite perf report).
#
# Reset semantics are preserved exactly:
#   * Provision runs a `full` reset (uninstall + reinstall the dev client),
#     which is the clean-slate precondition the standalone Smoke gate relies on.
#   * The Data-runtime-smoke and Dev wipe-local flows reset the data layer
#     IN-FLOW via their `boga3://maestro-harness?reset=data` deep links, so they
#     need no separate provision and are safe to run right after Smoke in the
#     same session.
#
# All three flows are infra-free: the dev client runs local-only (no Supabase
# configured), so they share this backend-free lane. The Dev wipe-local flow
# exercises the developer-only "Wipe local & re-bootstrap" affordance and
# confirms the app re-bootstraps to a usable data screen afterward.
#
# The individual gate scripts (maestro-ios-smoke.sh / -data-smoke.sh) are left
# unchanged; this is an additive, faster path for running both together. Each
# flow still produces its own JUnit + debug output (namespaced per flow), and a
# failure in either flow fails the whole run with a non-zero exit.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"

# A full provision reset gives both flows a clean install to start from. Set it
# BEFORE maestro_source_env so its `:=` default ("data") does not override it.
export MAESTRO_RESET_STRATEGY="full"
maestro_source_env

maestro_require_command maestro "Install Maestro from https://maestro.mobile.dev."

# Flows to run, in order. Smoke validates a cold launch + navigation on the
# freshly-installed client; Data-runtime-smoke then exercises the data round
# trip (it self-resets the data layer in-flow); Dev wipe-local then drives the
# developer-only wipe affordance and confirms the app re-bootstraps afterward
# (it also self-resets the data layer in-flow).
SCENARIOS=("Smoke" "Data runtime smoke" "Dev wipe-local")
FLOWS=(
  "$APP_DIR/.maestro/flows/smoke-launch.yaml"
  "$APP_DIR/.maestro/flows/data-runtime-smoke.yaml"
  "$APP_DIR/.maestro/flows/settings-dev-wipe-local.yaml"
)

MAESTRO_RUNNER_PID="$$"
MAESTRO_SESSION_TIMESTAMP="$(date +"%Y%m%d-%H%M%S")-$$"
MAESTRO_SCENARIO_NAME="iOS gates (smoke + data-runtime-smoke + dev-wipe-local)"
MAESTRO_ARTIFACT_ROOT="$(maestro_runtime_artifact_root "$MAESTRO_SESSION_TIMESTAMP")"
MAESTRO_RUNTIME_ENV_FILE="$MAESTRO_ARTIFACT_ROOT/runtime.env"
PROVISION_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/provision.log"
LAUNCH_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/launch.log"
TEARDOWN_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/teardown.log"
EXPO_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/expo-start.log"
SIMULATOR_SYSTEM_LOG_FILE="$MAESTRO_ARTIFACT_ROOT/simulator-system.log"

mkdir -p "$MAESTRO_ARTIFACT_ROOT"

[[ -n "${EXPO_DEV_SERVER_PORT:-}" ]] || maestro_fail "Missing EXPO_DEV_SERVER_PORT. Set it in .maestro/maestro.env.local."
if [[ -z "${IOS_SIM_UDID:-}" && -z "${IOS_SIM_DEVICE:-}" ]]; then
  maestro_fail "Missing simulator target. Set IOS_SIM_UDID or IOS_SIM_DEVICE in .maestro/maestro.env.local."
fi

maestro_write_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

cleanup() {
  local exit_code=$?
  trap - EXIT
  # One teardown for the whole run (both flows shared this sim + Metro).
  if [[ -f "$MAESTRO_RUNTIME_ENV_FILE" ]]; then
    "$SCRIPT_DIR/maestro-ios-teardown.sh" "$MAESTRO_RUNTIME_ENV_FILE" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# --- One-time shared setup: provision + launch + warm (paid ONCE for both) ---
"$SCRIPT_DIR/maestro-ios-provision.sh" "$MAESTRO_RUNTIME_ENV_FILE"
"$SCRIPT_DIR/maestro-ios-launch.sh" "$MAESTRO_RUNTIME_ENV_FILE"
maestro_load_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

maestro_warm_dev_client \
  "$IOS_SIM_UDID" \
  "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID" \
  "$MAESTRO_IOS_DEV_CLIENT_URL" \
  "$MAESTRO_ARTIFACT_ROOT/warmup.yaml" \
  "$MAESTRO_ARTIFACT_ROOT/maestro-warmup"

# --- Run each flow against the shared sim + Metro ---
run_flow() {
  local scenario="$1"
  local flow_source="$2"
  local slug flow_dir junit_file output_dir debug_dir flow_file rc

  [[ -f "$flow_source" ]] || maestro_fail "Missing Maestro flow file: $flow_source"

  slug="$(basename -- "$flow_source" .yaml)"
  flow_dir="$MAESTRO_ARTIFACT_ROOT/$slug"
  junit_file="$flow_dir/maestro-junit.xml"
  output_dir="$flow_dir/maestro-output"
  debug_dir="$flow_dir/maestro-debug"
  flow_file="$flow_dir/$(basename -- "$flow_source")"
  mkdir -p "$output_dir" "$debug_dir"

  maestro_prepare_flow_copy "$flow_source" "$flow_file" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID"

  echo "[maestro-ios-gates] >>> ${scenario} (${slug})"
  set +e
  maestro test "$flow_file" \
    --udid "$IOS_SIM_UDID" \
    --format junit \
    --output "$junit_file" \
    --debug-output "$debug_dir" \
    --test-output-dir "$output_dir"
  rc=$?
  set -e

  # Maestro 2.x exits 0 even when flows fail; fall back to JUnit inspection so
  # this gate fails correctly (same guard as maestro-ios-run-flow.sh).
  if (( rc == 0 )) && [[ -f "$junit_file" ]]; then
    if grep -Eq '(failures|errors)="[1-9]' "$junit_file"; then
      echo "[maestro-ios-gates] Detected flow failures in $junit_file despite maestro exit 0; treating as failure." >&2
      rc=1
    fi
  fi

  if (( rc == 0 )); then
    echo "[maestro-ios-gates] PASS: ${scenario}"
  else
    echo "[maestro-ios-gates] FAIL: ${scenario} (rc=$rc)" >&2
  fi
  return "$rc"
}

overall_exit=0
for i in "${!FLOWS[@]}"; do
  if ! run_flow "${SCENARIOS[$i]}" "${FLOWS[$i]}"; then
    overall_exit=1
  fi
done

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  echo "[maestro-ios-gates] Capturing simulator system logs to $SIMULATOR_SYSTEM_LOG_FILE"
  maestro_capture_simulator_logs \
    "$IOS_SIM_UDID" \
    "${MAESTRO_IOS_DEV_CLIENT_EXECUTABLE:-}" \
    "$SIMULATOR_SYSTEM_LOG_FILE" \
    "30m" || true
fi

echo "Combined iOS gates complete (smoke + data-runtime-smoke + dev-wipe-local)."
echo "Artifacts: $MAESTRO_ARTIFACT_ROOT"
echo "Runtime: port=$EXPO_DEV_SERVER_PORT, device=${IOS_SIM_DEVICE:-}, udid=${IOS_SIM_UDID:-}"

exit "$overall_exit"
