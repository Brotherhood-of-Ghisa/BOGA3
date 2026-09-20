#!/usr/bin/env bash

# Combined iOS gate runner: runs the Smoke and Data-runtime-smoke flows against
# ONE provisioned simulator and ONE Metro instance, instead of cold-booting,
# warming, and tearing down a simulator once PER gate.
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
#   * The Data-runtime-smoke flow resets the data layer IN-FLOW via its
#     `boga3://maestro-harness?reset=data` deep links, so it needs no separate
#     provision and is safe to run right after Smoke in the same session.
#
# The individual lanes (maestro-run-lane.sh smoke / data-smoke) are left
# unchanged; this is an additive, faster path for running both together.
#
# The shared-session execution model itself lives in maestro-ios-run-flows.sh
# (it is shared with the ios-ui-regression lane); this script is only the flow
# list and the reset strategy for the two infra-free gates.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

# A full provision reset gives both flows a clean install to start from.
export MAESTRO_RESET_STRATEGY="full"

exec "$SCRIPT_DIR/maestro-ios-run-flows.sh" \
  --session "iOS gates (smoke + data-runtime-smoke)" \
  --scenario "Smoke" --flow "$APP_DIR/.maestro/flows/smoke-launch.yaml" \
  --scenario "Data runtime smoke" --flow "$APP_DIR/.maestro/flows/data-runtime-smoke.yaml"
