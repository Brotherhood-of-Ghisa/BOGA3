#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

# Reuse deterministic local Supabase auth fixtures for the M11 happy path.
source "$REPO_ROOT/supabase/scripts/auth-fixture-constants.sh"

echo "[maestro-ios-auth-profile] ensuring worktree local Supabase baseline"
"$REPO_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"

# This is the only lane whose app build must see the local Supabase backend.
# Read the URL + anon key straight from this worktree's running stack and export
# them; the launcher materializes whatever EXPO_PUBLIC_SUPABASE_* a lane exports
# into a managed .env.local (see maestro_write_managed_env_local), backing up and
# later restoring the developer's file. So this lane's backend is determined by
# these explicit exports, deterministically, rather than by whatever .env.local a
# prior run happened to leave on disk.
#
# Resolve the values inside a subshell: supabase/scripts/_common.sh redefines
# SCRIPT_DIR / REPO_ROOT from its own location, which would otherwise clobber the
# paths this script uses to launch the run-flow helper below.
{
  IFS= read -r EXPO_PUBLIC_SUPABASE_URL
  IFS= read -r EXPO_PUBLIC_SUPABASE_ANON_KEY
} < <(
  # shellcheck disable=SC1091
  source "$REPO_ROOT/supabase/scripts/_common.sh"
  load_supabase_status_env
  printf '%s\n%s\n' "${API_URL:-}" "${ANON_KEY:-}"
)
if [[ -z "${EXPO_PUBLIC_SUPABASE_URL:-}" || -z "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ]]; then
  echo "[maestro-ios-auth-profile] missing API_URL or ANON_KEY from local Supabase status" >&2
  exit 1
fi
export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY

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

# First-sync gate (pinned in-progress surfaces): a signed-in user whose first
# cycle has not drained sees the full-screen block (phase + activity indicator);
# the harness pins the online in-progress state to assert it deterministically,
# then stamps the bootstrap flag to prove the block→dismiss transition.
MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Sync gate first cycle" \
  --flow "$APP_DIR/.maestro/flows/sync-gate-first-cycle.yaml"

# First-sync gate (REAL cycle): same sign-in, but the REAL bootstrapper→seed→
# push→pull cycle runs against the provisioned local Supabase and lifts the gate
# on its own — no `bootstrap=complete` harness stamp. Asserts the user lands on
# stats-history and the block is gone. Complements the pinned flow above, which
# owns the (too-fast-to-observe-naturally) in-progress surfaces.
MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Sync gate first cycle (real)" \
  --flow "$APP_DIR/.maestro/flows/sync-gate-first-cycle-real.yaml"

# First-run end-to-end round-trip: extends the real-cycle gate proof above with a
# logged workout that must upload (Pending changes -> 0) and then survive a full
# device wipe + re-sign-in (restored from the remote DB). Proves new-user
# bootstrap + delta upload + remote round-trip on the simulator.
#
# Runs as a DEDICATED fixture user (user_b), not the user_a the rest of this lane
# uses. The preceding real-cycle flow leaves user_a's ~400-row catalog only
# PARTIALLY pushed (its gate lifts + flow tears down before the push drains), so a
# flow that pulled user_a would hit the bootstrapper's pull branch with an
# incomplete catalog and flakily fail to find "Barbell Back Squat". user_b is
# untouched by every other flow, so this flow's first sign-in always finds an empty
# server and takes the bootstrapper's SEED branch -> the full catalog is seeded
# locally and deterministically. See the flow file's ISOLATION note.
MAESTRO_ROUNDTRIP_EMAIL="$USER_B_EMAIL" \
MAESTRO_ROUNDTRIP_PASSWORD="$USER_B_PASSWORD" \
MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "First-run log and remote round-trip" \
  --flow "$APP_DIR/.maestro/flows/sync-first-run-log-and-roundtrip.yaml"

MAESTRO_RESET_STRATEGY="full" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Settings sync status" \
  --flow "$APP_DIR/.maestro/flows/settings-sync-status.yaml"

MAESTRO_RESET_STRATEGY="full" exec "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "Auth profile happy path" \
  --flow "$APP_DIR/.maestro/flows/auth-profile-happy-path.yaml"
