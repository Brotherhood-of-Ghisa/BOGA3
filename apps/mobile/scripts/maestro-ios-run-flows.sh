#!/usr/bin/env bash

# maestro-ios-run-flows.sh — run SEVERAL flows against ONE provisioned simulator
# and ONE Metro instance.
#
#   ./scripts/maestro-ios-run-flows.sh --session "<name>" \
#     --scenario "Smoke" --flow .maestro/flows/smoke-launch.yaml \
#     --scenario "Data runtime smoke" --flow .maestro/flows/data-runtime-smoke.yaml
#
# Why this exists next to maestro-ios-run-flow.sh (singular): each standalone
# run pays a ~55-60s fixed overhead (cold sim boot + dev-client warm-up + Metro
# start + teardown) before its flow runs at all. N standalone runs pay it N
# times; this pays it once, so every flow after the first starts against an
# already-warm sim and a hot Metro bundle.
#
# Use it for a set of flows that can share one app install — i.e. flows that
# reset whatever state they need IN-FLOW through the maestro-harness deep link
# (`?reset=data`). A flow whose objective includes cold-install / permission /
# onboarding behaviour wants its own `full`-reset run and belongs in the
# singular runner.
#
# The caller owns the reset strategy: export MAESTRO_RESET_STRATEGY before
# invoking (it is read by maestro_source_env and applied by provision).
#
# Per-flow artifacts (JUnit, output, debug) are namespaced under a per-flow
# subdirectory of the shared artifact root, and a failure in ANY flow fails the
# whole run with a non-zero exit — every flow still runs, so one run reports all
# the failures rather than only the first.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-ios-runtime.sh"

SESSION_NAME=""
FLOWS=()
SCENARIOS=()
pending_scenario=""

usage() {
  cat <<'EOF'
Usage: ./scripts/maestro-ios-run-flows.sh --session <name> [--scenario <name>] --flow <flow-file> [...]

  --session   label for the whole run (artifact root + log prefix)
  --scenario  label for the NEXT --flow (defaults to the flow's basename)
  --flow      a flow file; repeat --scenario/--flow for each flow, in run order
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      SESSION_NAME="$2"
      shift 2
      ;;
    --scenario)
      pending_scenario="$2"
      shift 2
      ;;
    --flow)
      FLOWS+=("$2")
      SCENARIOS+=("${pending_scenario:-$(basename -- "$2" .yaml)}")
      pending_scenario=""
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

[[ -n "$SESSION_NAME" ]] || maestro_fail "Missing --session argument."
(( ${#FLOWS[@]} > 0 )) || maestro_fail "Missing --flow argument (at least one required)."

# Defaulted with `:=` inside maestro_source_env, so an exported value from the
# caller wins; set nothing here and the shared default applies.
maestro_source_env

maestro_require_command maestro "Install Maestro from https://maestro.mobile.dev."

MAESTRO_RUNNER_PID="$$"
MAESTRO_SESSION_TIMESTAMP="$(date +"%Y%m%d-%H%M%S")-$$"
MAESTRO_SCENARIO_NAME="$SESSION_NAME"
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

for flow in "${FLOWS[@]}"; do
  [[ -f "$flow" ]] || maestro_fail "Missing Maestro flow file: $flow"
done

maestro_write_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

cleanup() {
  local exit_code=$?
  trap - EXIT
  # One teardown for the whole run (every flow shared this sim + Metro).
  if [[ -f "$MAESTRO_RUNTIME_ENV_FILE" ]]; then
    "$SCRIPT_DIR/maestro-ios-teardown.sh" "$MAESTRO_RUNTIME_ENV_FILE" || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# --- One-time shared setup: provision + launch (paid ONCE for every flow) ---
# launch.sh drives the cold Metro bundle hot (it blocks on Metro's bundle-ready
# marker after opening the dev-client link), so the flows below start against a
# hot bundle with no separate warm-up invocation.
"$SCRIPT_DIR/maestro-ios-provision.sh" "$MAESTRO_RUNTIME_ENV_FILE"
"$SCRIPT_DIR/maestro-ios-launch.sh" "$MAESTRO_RUNTIME_ENV_FILE"
maestro_load_runtime_env "$MAESTRO_RUNTIME_ENV_FILE"

run_one_flow() {
  local scenario="$1"
  local flow_source="$2"
  local slug flow_dir junit_file output_dir debug_dir flow_file rc

  slug="$(basename -- "$flow_source" .yaml)"
  flow_dir="$MAESTRO_ARTIFACT_ROOT/$slug"
  junit_file="$flow_dir/maestro-junit.xml"
  output_dir="$flow_dir/maestro-output"
  debug_dir="$flow_dir/maestro-debug"
  flow_file="$flow_dir/$(basename -- "$flow_source")"
  mkdir -p "$output_dir" "$debug_dir"

  maestro_prepare_flow_copy "$flow_source" "$flow_file" "$MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID"

  echo "[maestro-ios-run-flows] >>> ${scenario} (${slug})"
  maestro_env_flags=()
  if [[ -n "${MAESTRO_IOS_DEV_CLIENT_URL+set}" ]]; then
    maestro_env_flags+=(-e "MAESTRO_IOS_DEV_CLIENT_URL=${MAESTRO_IOS_DEV_CLIENT_URL}")
  fi

  set +e
  maestro test "$flow_file" \
    --udid "$IOS_SIM_UDID" \
    --format junit \
    --output "$junit_file" \
    --debug-output "$debug_dir" \
    --test-output-dir "$output_dir" \
    ${maestro_env_flags[@]+"${maestro_env_flags[@]}"}
  rc=$?
  set -e

  # Maestro 2.x exits 0 even when flows fail; fall back to JUnit inspection so
  # this runner fails correctly (same guard as maestro-ios-run-flow.sh).
  if (( rc == 0 )) && [[ -f "$junit_file" ]]; then
    if grep -Eq '(failures|errors)="[1-9]' "$junit_file"; then
      echo "[maestro-ios-run-flows] Detected flow failures in $junit_file despite maestro exit 0; treating as failure." >&2
      rc=1
    fi
  fi

  if (( rc == 0 )); then
    echo "[maestro-ios-run-flows] PASS: ${scenario}"
  else
    echo "[maestro-ios-run-flows] FAIL: ${scenario} (rc=$rc)" >&2
  fi
  return "$rc"
}

overall_exit=0
failed_scenarios=()
for i in "${!FLOWS[@]}"; do
  if ! run_one_flow "${SCENARIOS[$i]}" "${FLOWS[$i]}"; then
    overall_exit=1
    failed_scenarios+=("${SCENARIOS[$i]}")
  fi
done

if [[ -n "${IOS_SIM_UDID:-}" ]]; then
  echo "[maestro-ios-run-flows] Capturing simulator system logs to $SIMULATOR_SYSTEM_LOG_FILE"
  maestro_capture_simulator_logs \
    "$IOS_SIM_UDID" \
    "${MAESTRO_IOS_DEV_CLIENT_EXECUTABLE:-}" \
    "$SIMULATOR_SYSTEM_LOG_FILE" \
    "30m" || true
fi

echo "${SESSION_NAME} complete (${#FLOWS[@]} flow(s))."
if (( overall_exit != 0 )); then
  echo "[maestro-ios-run-flows] FAILED flows: ${failed_scenarios[*]}" >&2
fi
echo "Artifacts: $MAESTRO_ARTIFACT_ROOT"
echo "Runtime: port=$EXPO_DEV_SERVER_PORT, device=${IOS_SIM_DEVICE:-}, udid=${IOS_SIM_UDID:-}"

exit "$overall_exit"
