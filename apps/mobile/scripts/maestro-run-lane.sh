#!/usr/bin/env bash

# maestro-run-lane.sh — uniform runner for the per-lane iOS Maestro wrappers.
#
# Replaces the one-file-per-lane wrappers (maestro-ios-smoke.sh, -data-smoke.sh,
# -auth-profile.sh, -sync-e2e.sh): the per-lane differences are DATA (flows,
# reset strategy, whether the app must see local Supabase, fixture user), kept
# in the case block below. The shared-provision combined runner
# (maestro-ios-gates.sh) keeps its own script — it is a different execution
# model, not a thin wrapper.
#
#   ./scripts/maestro-run-lane.sh smoke|data-smoke|auth-profile|sync-e2e
#
# Canonical lane names / gate membership: scripts/lanes.tsv (run via
# `./boga test ios-smoke` etc.; the npm test:e2e:ios:* scripts also land here).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

lane="${1:-}"
[[ -n "$lane" ]] || { echo "usage: $0 smoke|data-smoke|auth-profile|sync-e2e" >&2; exit 2; }

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

  # Infra-free real expo-sqlite migration + smoke write/read; the backend-less
  # build seeds its own starter catalog at boot. No Supabase.
  data-smoke)
    run_flow data "Data runtime smoke" data-runtime-smoke.yaml
    ;;

  # The Supabase-configured auth/profile lane: login-on-start enforcement and the
  # fixture-backed sign-in / profile / username-update / sign-out happy path (the
  # happy-path flow also asserts the route guard at both ends). The first-sync
  # gate's in-progress + dismissal surfaces are covered by the jest
  # sync-gate-screen suite; the real-cycle gate lift and the settings sync-status
  # surface are proven on-device by the sync-e2e round-trip. Signs in as user_a —
  # its own dedicated fixture, per the one-user-per-flow rule (see docs/specs/11,
  # enforced by scripts/tests/maestro-fixture-users.test.sh).
  auth-profile)
    export_local_supabase_env
    export MAESTRO_AUTH_PROFILE_EMAIL="${MAESTRO_AUTH_PROFILE_EMAIL:-$USER_A_EMAIL}"
    export MAESTRO_AUTH_PROFILE_PASSWORD="${MAESTRO_AUTH_PROFILE_PASSWORD:-$USER_A_PASSWORD}"
    export MAESTRO_AUTH_PROFILE_USERNAME="${MAESTRO_AUTH_PROFILE_USERNAME:-maestro-${TASK_ID:-auth-profile}-$(date +%H%M%S)}"
    run_flow full "Auth profile happy path" auth-profile-happy-path.yaml
    ;;

  # The UI <-> server sync e2e lane: real recorder UI + real sync cycle + real
  # local Supabase. Proves (A) new-user bootstrap lifts the gate, (B) a workout
  # logged through the recorder, (C) forced sync drains Pending changes to 0 and
  # the settings sync-status surface renders, (D) full device wipe + re-sign-in
  # restores the workout from the remote DB.
  #
  # Signs in as user_b — its own dedicated fixture, per the one-user-per-flow rule
  # (docs/specs/11): every Supabase-backed Maestro flow owns a distinct fixture so
  # no flow depends on another's residual server state. A pristine user also makes
  # first sign-in deterministic (empty server -> bootstrapper SEED branch). See the
  # flow file's ISOLATION note; enforced by scripts/tests/maestro-fixture-users.test.sh.
  sync-e2e)
    export_local_supabase_env
    MAESTRO_ROUNDTRIP_EMAIL="$USER_B_EMAIL" \
    MAESTRO_ROUNDTRIP_PASSWORD="$USER_B_PASSWORD" \
    run_flow full "First-run log and remote round-trip" sync-first-run-log-and-roundtrip.yaml
    ;;

  *)
    echo "[maestro-run-lane] unknown lane: $lane (smoke|data-smoke|auth-profile|sync-e2e)" >&2
    exit 2
    ;;
esac
