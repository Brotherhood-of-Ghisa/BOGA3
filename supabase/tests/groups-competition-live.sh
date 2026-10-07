#!/usr/bin/env bash
# The app's groups client against a live protocol-4 server (lane
# groups-protocol4). Provisions its own owner and member, activates competitions
# on this worktree's slot-local stack, runs apps/mobile's
# groups-competition-api-live Jest suite against it, then deletes the users and
# everything they made. Activation is one-way, so the wrapper rebuilds the stack
# on exit — which is why this body lives outside the default backend gate.
# The ordinary (pre-competition) client wire is groups-api-live.sh's job.
#
# ORDER: this body runs BEFORE groups-competitions.sh in the lane. That body
# unsets the evaluator kick URL for direct-drain mode and rebuilds the stack on
# exit, leaving no configured baseline behind; this body needs a live evaluator
# to publish a board, so it must see the preflight's baseline. Reversing them
# leaves the board empty and this suite times out.
# Execute only through its Boga lane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-protocol4"
FIXTURE_EMAIL_PREFIX="groups-protocol4"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq npm; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" ]] || fail "local Supabase status env is incomplete (API_URL/ANON_KEY)"
DB_CONTAINER="$(resolve_db_container)" || exit 1

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsProtocol4!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()

cleanup() {
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"; ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and user_id in (${ids});
    delete from app_public.group_eval_queue where member_user_id in (${ids});
    delete from app_public.groups where created_by in (${ids})
      or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
    delete from auth.users where id in (${ids});
    commit;" >/dev/null
}
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning the owner and the member"
provision OWNER owner
provision MEMBER member
set_username "${OWNER_UID}" "live-owner-${RUN_TAG}"
set_username "${MEMBER_UID}" "live-member-${RUN_TAG}"

echo "[${LANE_LABEL}] running the protocol-4 client suite against ${API_URL}"
(
  cd "${REPO_ROOT}/apps/mobile"
  export GROUPS_LIVE_SUPABASE_URL="${API_URL}"
  export GROUPS_LIVE_SUPABASE_ANON_KEY="${ANON_KEY}"
  export GROUPS_LIVE_OWNER_EMAIL="${FIXTURE_EMAIL_PREFIX}-owner-${RUN_TAG}@example.test"
  export GROUPS_LIVE_MEMBER_EMAIL="${FIXTURE_EMAIL_PREFIX}-member-${RUN_TAG}@example.test"
  export GROUPS_LIVE_PASSWORD="${PASSWORD}"
  export GROUPS_LIVE_RUN_TAG="${RUN_TAG}"
  "${SUPABASE_DIR}/scripts/with-local-group-competitions.sh" npm run --silent test:groups:competition-live
)
COMPLETED=1
pass "the groups client's calls match a live protocol-4 server (run ${RUN_TAG})"
