#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

# iOS sync e2e — the UI <-> real-backend end-to-end lane (test:e2e:ios:sync).
#
# This lane exists because the jest cross-stack lane (test:sync:infra) drives
# the real sync cycle but with emulated storage and no UI: an entire class of
# real bugs (UI gating, NetInfo on the simulator, session handoff to the
# scheduler, trigger wiring) lives in the layers it bypasses. This lane is the
# device-level proof: the REAL recorder UI, the REAL sync cycle, a REAL local
# Supabase. Its anchor flow proves, in one run:
#   A. new-user sign-in -> real bootstrap cycle lifts the first-sync gate,
#   B. one workout logged through the recorder UI,
#   C. forced sync drains "Pending changes" to 0 (run-specific upload proof),
#   D. full device wipe + re-sign-in restores the workout from the remote DB
#      (after a wipe, the remote DB is the ONLY possible source).
#
# When to run: any change under apps/mobile/src/sync/**, the scheduler, auth
# session wiring, or the sync RPCs. Part of `quality-slow.sh frontend`.

# Reuse the deterministic local Supabase auth fixtures.
source "$REPO_ROOT/supabase/scripts/auth-fixture-constants.sh"

echo "[maestro-ios-sync-e2e] ensuring worktree local Supabase baseline"
"$REPO_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"

# This lane's app build must see the local Supabase backend. Read the URL +
# anon key straight from this worktree's running stack and export them; the
# launcher materializes whatever EXPO_PUBLIC_SUPABASE_* a lane exports into a
# managed .env.local (see maestro_write_managed_env_local), backing up and
# later restoring the developer's file.
#
# Resolve the values inside a subshell: supabase/scripts/_common.sh redefines
# SCRIPT_DIR / REPO_ROOT from its own location, which would otherwise clobber
# the paths this script uses to launch the run-flow helper below.
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
  echo "[maestro-ios-sync-e2e] missing API_URL or ANON_KEY from local Supabase status" >&2
  exit 1
fi
export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY

# The flow signs in as the DEDICATED fixture user (user_b), not the user_a the
# auth-profile lane uses. That is load-bearing: user_a's server-side catalog can
# be left PARTIALLY pushed by the auth-profile lane's gate flows, which would
# make this flow's bootstrap take the (incomplete) PULL branch and flake. user_b
# is exclusive to this flow, so its first sign-in deterministically takes the
# SEED branch. See the flow file's ISOLATION note.
MAESTRO_ROUNDTRIP_EMAIL="$USER_B_EMAIL" \
MAESTRO_ROUNDTRIP_PASSWORD="$USER_B_PASSWORD" \
MAESTRO_RESET_STRATEGY="full" exec "$SCRIPT_DIR/maestro-ios-run-flow.sh" \
  --scenario "First-run log and remote round-trip" \
  --flow "$APP_DIR/.maestro/flows/sync-first-run-log-and-roundtrip.yaml"
