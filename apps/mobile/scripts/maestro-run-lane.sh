#!/usr/bin/env bash

# maestro-run-lane.sh — uniform runner for the per-lane iOS Maestro wrappers.
#
# Replaces the one-file-per-lane wrappers (maestro-ios-smoke.sh, -data-smoke.sh,
# -auth-profile.sh, -sync-e2e.sh; groups-e2e was added directly here): the per-lane differences are DATA (flows,
# reset strategy, whether the app must see local Supabase, fixture user), kept
# in the case block below. The shared-provision combined runner
# (maestro-ios-gates.sh) keeps its own script — it is a different execution
# model, not a thin wrapper.
#
#   ./scripts/maestro-run-lane.sh smoke|data-smoke|exercise-page|session-view|auth-profile|sync-e2e|groups-e2e
#
# Canonical lane names / gate membership: scripts/lanes.tsv (run via
# `./boga test ios-smoke` etc.; the npm test:e2e:ios:* scripts also land here).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

lane="${1:-}"
LANES="smoke|data-smoke|exercise-page|session-view|auth-profile|sync-e2e|groups-e2e"
[[ -n "$lane" ]] || { echo "usage: $0 $LANES" >&2; exit 2; }

run_flow() {
  local reset="$1" scenario="$2" flow="$3"
  MAESTRO_RESET_STRATEGY="$reset" "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
    --scenario "$scenario" \
    --flow "$APP_DIR/.maestro/flows/$flow"
}

# Supabase-configured lanes: read the URL + anon key straight from this
# worktree's running stack and export them; the launcher materializes whatever
# EXPO_PUBLIC_SUPABASE_* a lane exports into a managed .env.local (see
# maestro_write_managed_env_local), backing up and later restoring the
# developer's file. So a lane's backend is determined by these explicit
# exports, deterministically, rather than by whatever .env.local a prior run
# happened to leave on disk.
#
# Resolve the values inside a subshell: supabase/scripts/_common.sh redefines
# SCRIPT_DIR / REPO_ROOT from its own location, which would otherwise clobber
# the paths this script uses.
export_local_supabase_env() {
  echo "[maestro-run-lane:$lane] ensuring worktree local Supabase baseline"
  "$REPO_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"
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
    echo "[maestro-run-lane:$lane] missing API_URL or ANON_KEY from local Supabase status" >&2
    exit 1
  fi
  export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY
  # shellcheck disable=SC1091
  source "$REPO_ROOT/supabase/scripts/auth-fixture-constants.sh"
}

case "$lane" in
  # Infra-free cold-launch + navigation smoke on the freshly-installed dev
  # client. No Supabase.
  smoke)
    run_flow full "Smoke" smoke-launch.yaml
    ;;

  # Infra-free, no Supabase. data-runtime-smoke: real expo-sqlite migration +
  # smoke write/read, and the backend-less build seeds its own starter catalog
  # at boot. Then the two screen flows whose device claims need no backend:
  # the completion screen's native share sheet, and an exercise created through
  # the catalogue's editor sheet. They share ONE provisioned simulator + Metro
  # (maestro-ios-run-flows.sh), because a lane of their own would pay the
  # provision/launch/teardown overhead again; each resets its own data in-flow
  # through the maestro-harness deep link, so a `data` reset is enough.
  data-smoke)
    MAESTRO_RESET_STRATEGY=data \
    "$SCRIPT_DIR/maestro-ios-run-flows.sh" \
      --session "Data runtime smoke" \
      --scenario "Data runtime smoke" --flow "$APP_DIR/.maestro/flows/data-runtime-smoke.yaml" \
      --scenario "Session completion share" --flow "$APP_DIR/.maestro/flows/session-completion-states-fixture.yaml" \
      --scenario "Exercise catalogue" --flow "$APP_DIR/.maestro/flows/exercise-catalogue.yaml"
    ;;

  # The exercise page: its own fixture, seeded and reset in-flow through the
  # maestro-harness deep link. Infra-free, no Supabase.
  exercise-page)
    run_flow data "Exercise page" exercise-page.yaml
    ;;

  # The session view: one flow that seeds its session through the harness
  # (`reset=data&fixture=session-view`). Infra-free; `data` reset is enough.
  session-view)
    run_flow data "Session view" session-view.yaml
    ;;

  # The Supabase-configured auth/profile lane: login-on-start enforcement and the
  # fixture-backed sign-in / profile / username-update / sign-out happy path (the
  # happy-path flow also asserts the route guard at both ends). The first-sync
  # gate's in-progress + dismissal surfaces are covered by the jest
  # sync-gate-screen suite; the real-cycle gate lift is proven on-device by the
  # sync-e2e round-trip. Signs in as user_a —
  # its own dedicated fixture, per the one-user-per-flow rule (see docs/specs/11,
  # enforced by scripts/tests/maestro-fixture-users.test.sh).
  auth-profile)
    export_local_supabase_env
    export MAESTRO_AUTH_PROFILE_EMAIL="${MAESTRO_AUTH_PROFILE_EMAIL:-$USER_A_EMAIL}"
    export MAESTRO_AUTH_PROFILE_PASSWORD="${MAESTRO_AUTH_PROFILE_PASSWORD:-$USER_A_PASSWORD}"
    export MAESTRO_AUTH_PROFILE_USERNAME="${MAESTRO_AUTH_PROFILE_USERNAME:-maestro-${TASK_ID:-auth-profile}-$(date +%H%M%S)}"
    run_flow full "Auth profile happy path" auth-profile-happy-path.yaml
    ;;

  # The UI <-> server sync e2e lane: real sign-in + real sync cycle + real
  # local Supabase. Proves (A) a new user's first sign-in seeds, pushes and
  # lifts the first-sync gate, and (B) a reading entered on the device comes
  # back from the server after a full device wipe and a fresh sign-in.
  #
  # Signs in as user_b — its own dedicated fixture, per the one-user-per-flow rule
  # (docs/specs/11), enforced by scripts/tests/maestro-fixture-users.test.sh.
  # sync-e2e-fixture-reset.sh first empties user_b's server data, so every run's
  # first sign-in takes the bootstrapper's SEED branch and the wipe restores only
  # this run's data.
  sync-e2e)
    export_local_supabase_env
    "$REPO_ROOT/supabase/scripts/sync-e2e-fixture-reset.sh"
    MAESTRO_ROUNDTRIP_EMAIL="$USER_B_EMAIL" \
    MAESTRO_ROUNDTRIP_PASSWORD="$USER_B_PASSWORD" \
    run_flow full "First-run log and remote round-trip" sync-first-run-log-and-roundtrip.yaml
    ;;

  # The two-user groups e2e lane (M22; docs/specs/tech/groups-contract.md §8):
  # the device signs in as user_c and drives the real group UI, while the flow
  # scripts the counterparty user_d over HTTP (runScript
  # .maestro/scripts/groups-counterparty.js: join, sync_push, removed-member
  # read). Both fixtures are dedicated to this flow (docs/specs/11); the
  # counterparty is bound through a MAESTRO_*_COUNTERPARTY_* var, which
  # scripts/tests/maestro-fixture-users.test.sh counts as a claimed fixture.
  # groups-fixture-reset.sh first hard-deletes both users' groups and sync rows
  # (service role), so repeated runs in one slot need no Supabase reset.
  groups-e2e)
    export_local_supabase_env
    "$REPO_ROOT/supabase/scripts/groups-fixture-reset.sh"
    MAESTRO_GROUPS_DEVICE_EMAIL="$USER_C_EMAIL" \
    MAESTRO_GROUPS_DEVICE_PASSWORD="$USER_C_PASSWORD" \
    MAESTRO_GROUPS_DEVICE_USERNAME="$USER_C_USERNAME" \
    MAESTRO_GROUPS_COUNTERPARTY_EMAIL="$USER_D_EMAIL" \
    MAESTRO_GROUPS_COUNTERPARTY_PASSWORD="$USER_D_PASSWORD" \
    MAESTRO_GROUPS_COUNTERPARTY_USERNAME="$USER_D_USERNAME" \
    MAESTRO_GROUPS_SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL" \
    MAESTRO_GROUPS_SUPABASE_ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
    MAESTRO_RESET_STRATEGY=full \
    "$REPO_ROOT/supabase/scripts/with-local-group-competitions.sh" \
      "$SCRIPT_DIR/maestro-ios-run-flow.sh" --scenario "Two-user groups stream" \
      --flow "$APP_DIR/.maestro/flows/groups-two-user-stream.yaml"
    ;;

  *)
    echo "[maestro-run-lane] unknown lane: $lane ($LANES)" >&2
    exit 2
    ;;
esac
