#!/usr/bin/env bash

# run-meta-tests.sh — infra-free self-tests for the repo meta-tooling
# (gen-docs.sh, test-for.sh), the lane-timing store, the
# Supabase container resolver,
# the Maestro fixture-user and
# flow-has-a-lane rules, and
# the worktree lifecycle (temp git repos + stub gh/docker), Android
# launchers (stub adb/Expo/JDK), the iOS simulator boot-wait (stub xcrun), and
# the edge function server stop (stub npx process tree), and the dev stack's
# main-checkout-only rule (temp git worktree, stubbed launcher children).
# Runs as the `meta-tests` lane (fast gate, repo half; see scripts/lanes.tsv)
# and in CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS=(
  "gen-docs.test.sh"
  "lane-timing.test.sh"
  "test-for.test.sh"
  "full-sweep.test.sh"
  "maestro-fixture-users.test.sh"
  "maestro-flow-lanes.test.sh"
  "maestro-testids.test.sh"
  "supabase-cli-version.test.sh"
  "supabase-exit-trap-guard.test.sh"
  "supabase-container-resolver.test.sh"
  "worktree-lifecycle.test.sh"
  "android-launcher.test.sh"
  "ios-sim-boot.test.sh"
  "functions-serve-stop.test.sh"
  "dev-stack-main-checkout.test.sh"
)

failed=0
for t in "${TESTS[@]}"; do
  echo "[meta-tests] running ${t}"
  if "${SCRIPT_DIR}/${t}"; then
    echo "[meta-tests] PASS ${t}"
  else
    echo "[meta-tests] FAIL ${t}" >&2
    failed=1
  fi
done

if [[ "${failed}" != "0" ]]; then
  echo "[meta-tests] FAILED" >&2
  exit 1
fi
echo "[meta-tests] all passed (${#TESTS[@]} files)"
