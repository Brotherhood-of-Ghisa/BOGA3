#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

# Reuse deterministic local Supabase auth fixtures for the M11 happy path.
source "$REPO_ROOT/supabase/scripts/auth-fixture-constants.sh"

echo "[maestro-ios-auth-profile] ensuring worktree local Supabase baseline"
"$REPO_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"

export MAESTRO_AUTH_PROFILE_EMAIL="${MAESTRO_AUTH_PROFILE_EMAIL:-$USER_A_EMAIL}"
export MAESTRO_AUTH_PROFILE_PASSWORD="${MAESTRO_AUTH_PROFILE_PASSWORD:-$USER_A_PASSWORD}"
export MAESTRO_AUTH_PROFILE_USERNAME="${MAESTRO_AUTH_PROFILE_USERNAME:-maestro-${TASK_ID:-auth-profile}-$(date +%H%M%S)}"

# Login-on-start enforcement runs first against this auth-configured lane: a
# clean cold launch must land on the sign-in screen (no data screen) and only
# reach data screens after a successful sign-in. Each flow self-provisions a
# clean install via the `full` reset strategy, so they run as independent runs.
MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Launch requires sign-in" \
  --flow "$APP_DIR/.maestro/flows/launch-requires-sign-in.yaml"

# First-sync gate: a signed-in user whose first cycle has not drained sees the
# full-screen block (phase + activity indicator); it dismisses once the cycle
# completes within the foreground window.
MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Sync gate first cycle" \
  --flow "$APP_DIR/.maestro/flows/sync-gate-first-cycle.yaml"

MAESTRO_RESET_STRATEGY="full" exec "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Auth profile happy path" \
  --flow "$APP_DIR/.maestro/flows/auth-profile-happy-path.yaml"
