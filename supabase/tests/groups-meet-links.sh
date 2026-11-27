#!/usr/bin/env bash

# groups-meet-links.sh — the session↔meet counting rule and the roster union
# (a body of the groups-contract lane).
#
# Contract: docs/specs/tech/group-meet-contract.md ("Roster and session
# links"); product fact [[meets.linking]]. Members push real sessions and
# `session_meet_links` rows through sync_push (so the share trigger decides
# sharing), then the test reads app_public.group_meet_counting_links and
# group_meet_get. Proves:
#
#   - counting cases: a session inside the window counts; one starting exactly
#     at ends_at or ending exactly at starts_at does not; the 1 ms edges inside
#     do; a running session counts once the meet has started and not before;
#     an unshared session, a tombstoned link, a tombstoned session, a former
#     member's link and a cancelled meet's links do not; one session counts
#     for meets in two groups; a link that does not count still syncs;
#   - the roster union: joined only, linked only, both, and a member who left
#     the meet online but keeps a counting link, with `joined`/`linked` flags;
#     a member whose link does not count is not on the roster.
#
# Times are set by direct SQL on meet rows and membership periods (the server
# is the only writer of both). Hermetic: per-run users, deleted on exit with
# everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-meet-links"
FIXTURE_EMAIL_PREFIX="groups-meet-links"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done
load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1
psql_session_start

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsMeetLinks!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()

cleanup() {
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
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
  psql_session_stop
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

HOUR=3600000
NOW="$(run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;")"
CUAM="${NOW}"

# e_mlink <meet> <session> <cuam> [deleted_ms]: the client's deterministic id.
e_mlink() {
  jq -nc --arg m "$1" --arg s "$2" --argjson c "$3" --argjson del "${4:-null}" \
    '{type: "session_meet_links", id: ($m + ":" + $s), client_updated_at_ms: $c,
      fields: {session_id: $s, meet_id: $m, created_at: $c, updated_at: $c, deleted_at: $del}}'
}
# sess <token> <id> <started_ms> <completed_ms|null> [deleted_ms]: a completed
# session, or a running one when completed is null.
sess() {
  local status=completed
  [[ "$4" != null ]] || status=active
  next_cuam
  push "$1" "session $2" "$(e_session "$2" "$3" "${status}" "$4" null "${5:-null}" "${CUAM}")"
}
# link <token> <meet> <session> [deleted_ms]
link() {
  next_cuam
  push "$1" "link $3 → $2" "$(e_mlink "$2" "$3" "${CUAM}" "${4:-null}")"
}
# new_meet <token> <group> <starts_ms> <ends_ms>: created in the future, then
# moved to the window by SQL (create refuses a past start).
new_meet() {
  local meet
  meet="$(run_psql "select gen_random_uuid();")"
  rpc "$1" group_meet_create "$(jq -nc --arg g "$2" --arg m "${meet}" --argjson s "$((NOW + HOUR))" \
    '{p_group_id:$g, p_meet_id:$m, p_title:null, p_starts_at_ms:$s, p_ends_at_ms:null, p_venue_name:"Iron Temple",
      p_address:null, p_latitude:null, p_longitude:null, p_entry_note:null}')"
  expect_ok "create meet"
  run_psql "update app_public.group_meets set starts_at = app_public.group_meet_at($3),
    ends_at = app_public.group_meet_at($4) where id = '${meet}';" >/dev/null
  printf '%s' "${meet}"
}
# counting <meet> [now_ms]: the counting session ids, sorted, comma-joined.
counting() {
  local at="clock_timestamp()"
  [[ -z "${2:-}" ]] || at="app_public.group_meet_at($2)"
  run_psql "select coalesce(string_agg(c.session_id, ',' order by c.session_id), '')
    from app_public.group_meets m, app_public.group_meet_counting_links(m, ${at}) c where m.id = '$1';"
}
expect_counting() {
  local got
  got="$(counting "$1" "${4:-}")"
  [[ "${got}" == "$2" ]] || fail "$3: expected [$2], got [${got}]"
}
b_ref() { jq -nc --arg g "$1" --arg m "$2" '{p_group_id:$g, p_meet_id:$m}'; }

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning owner and members"
for who in OWNER MEMBER RECENT FORMER JOINED LINKED BOTH LEFT IDLE; do
  provision "${who}" "$(printf '%s' "${who}" | tr 'A-Z' 'a-z')"
  uid_var="${who}_UID"
  set_username "${!uid_var}" "ml-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done

make_group() {
  rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "$1 ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"Europe/London"}')"
  expect_ok "create $1"
  jq -r '.group_id' <<<"${BODY}"
}
join_group() {
  rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "$1" '{p_group_id:$g}')"
  local code
  code="$(jq -r '.code' <<<"${BODY}")"
  shift
  for who in "$@"; do
    local token_var="${who}_TOKEN"
    rpc "${!token_var}" group_join "$(jq -nc --arg c "${code}" '{p_code:$c}')"
    expect_ok "${who} joins"
  done
}
GROUP="$(make_group "Meet links")"
OTHER_GROUP="$(make_group "Meet links two")"
join_group "${GROUP}" MEMBER RECENT FORMER JOINED LINKED BOTH LEFT IDLE
join_group "${OTHER_GROUP}" MEMBER
# Membership started a month ago for everyone but RECENT, whose period starts
# now: RECENT's earlier session is never shared.
run_psql "update app_public.group_memberships set joined_at = clock_timestamp() - interval '30 days'
  where group_id in ('${GROUP}', '${OTHER_GROUP}') and user_id <> '${RECENT_UID}';" >/dev/null

# The meet window: three hours ago to one hour ago (live results until the
# cutoff, so online joins still work).
S=$((NOW - 3 * HOUR))
E=$((NOW - HOUR))
MEET="$(new_meet "${OWNER_TOKEN}" "${GROUP}" "${S}" "${E}")"
OTHER_MEET="$(new_meet "${OWNER_TOKEN}" "${OTHER_GROUP}" "${S}" "${E}")"
ROSTER_MEET="$(new_meet "${OWNER_TOKEN}" "${GROUP}" "${S}" "${E}")"
CANCELLED_MEET="$(new_meet "${OWNER_TOKEN}" "${GROUP}" "${S}" "${E}")"
FUTURE_MEET="$(new_meet "${OWNER_TOKEN}" "${GROUP}" "$((NOW + 2 * HOUR))" "$((NOW + 4 * HOUR))")"

# --- counting cases (MEMBER's sessions on MEET) --------------------------------------

p="ml-${RUN_TAG}"
sess "${MEMBER_TOKEN}" "${p}-inside" "$((S + HOUR))" "$((S + 2 * HOUR))"
sess "${MEMBER_TOKEN}" "${p}-starts-at-end" "${E}" "$((E + HOUR))"
sess "${MEMBER_TOKEN}" "${p}-ends-at-start" "$((S - HOUR))" "${S}"
sess "${MEMBER_TOKEN}" "${p}-edge-end" "$((E - 1))" "$((E + HOUR))"
sess "${MEMBER_TOKEN}" "${p}-edge-start" "$((S - HOUR))" "$((S + 1))"
sess "${MEMBER_TOKEN}" "${p}-running" "$((S - HOUR))" null
sess "${MEMBER_TOKEN}" "${p}-unlinked" "$((S + HOUR))" "$((S + 2 * HOUR))"
sess "${MEMBER_TOKEN}" "${p}-link-gone" "$((S + HOUR))" "$((S + 2 * HOUR))"
sess "${MEMBER_TOKEN}" "${p}-session-gone" "$((S + HOUR))" "$((S + 2 * HOUR))"
for s in inside starts-at-end ends-at-start edge-end edge-start running link-gone session-gone; do
  link "${MEMBER_TOKEN}" "${MEET}" "${p}-${s}"
done
# A link that does not count still syncs (no-overlap rows are kept).
[[ "$(run_psql "select count(*) from app_public.session_meet_links where owner_user_id = '${MEMBER_UID}'
  and id = '${MEET}:${p}-starts-at-end' and deleted_at is null;")" == 1 ]] ||
  fail "a link that does not count must still be stored"
link "${MEMBER_TOKEN}" "${MEET}" "${p}-link-gone" "${NOW}"
sess "${MEMBER_TOKEN}" "${p}-session-gone" "$((S + HOUR))" "$((S + 2 * HOUR))" "${NOW}"

# RECENT's session started before their membership: never shared.
sess "${RECENT_TOKEN}" "${p}-unshared" "$((S + HOUR))" "$((S + 2 * HOUR))"
link "${RECENT_TOKEN}" "${MEET}" "${p}-unshared"
[[ "$(run_psql "select count(*) from app_public.group_session_shares where session_id = '${p}-unshared';")" == 0 ]] ||
  fail "the fixture's pre-membership session must not be shared"
# FORMER's shared, linked session stops counting when they leave the group.
sess "${FORMER_TOKEN}" "${p}-former" "$((S + HOUR))" "$((S + 2 * HOUR))"
link "${FORMER_TOKEN}" "${MEET}" "${p}-former"

expect_counting "${MEET}" "${p}-edge-end,${p}-edge-start,${p}-former,${p}-inside,${p}-running" \
  "the window counts inside and at the 1 ms edges, never exactly at them"
rpc "${FORMER_TOKEN}" group_leave "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "former member leaves the group"
expect_counting "${MEET}" "${p}-edge-end,${p}-edge-start,${p}-inside,${p}-running" \
  "unshared, tombstoned link, tombstoned session and former member do not count"
pass "counting: overlap edges, sharing, tombstones and membership"

# A running session counts once the meet has started, not before.
[[ "$(counting "${MEET}" "$((S - 1))")" != *"${p}-running"* ]] ||
  fail "a running session does not count before the meet starts"
[[ "$(counting "${MEET}" "$((S + 1))")" == *"${p}-running"* ]] ||
  fail "a running session counts once the meet has started"
pass "counting: a running session's end is now"

# One session counts for meets in two groups.
link "${MEMBER_TOKEN}" "${OTHER_MEET}" "${p}-inside"
expect_counting "${OTHER_MEET}" "${p}-inside" "a session counts in its second group's meet"
[[ "$(counting "${MEET}")" == *"${p}-inside"* ]] || fail "the first group's meet still counts it"
pass "counting: one session counts for meets in two groups"

# A cancelled meet counts nothing (cancel is pre-start, so set by SQL here).
link "${MEMBER_TOKEN}" "${CANCELLED_MEET}" "${p}-inside"
expect_counting "${CANCELLED_MEET}" "${p}-inside" "the link counts before the cancel"
run_psql "update app_public.group_meets set cancelled_at = starts_at - interval '1 hour', cancelled_by = '${OWNER_UID}'
  where id = '${CANCELLED_MEET}';" >/dev/null
expect_counting "${CANCELLED_MEET}" "" "a cancelled meet counts no link"
pass "counting: a cancelled meet counts nothing"

# --- roster union (ROSTER_MEET) ------------------------------------------------------

sess "${LINKED_TOKEN}" "${p}-linked" "$((S + HOUR))" "$((S + 2 * HOUR))"
link "${LINKED_TOKEN}" "${ROSTER_MEET}" "${p}-linked"
sess "${BOTH_TOKEN}" "${p}-both" "$((S + HOUR))" "$((S + 2 * HOUR))"
link "${BOTH_TOKEN}" "${ROSTER_MEET}" "${p}-both"
sess "${LEFT_TOKEN}" "${p}-left" "$((S + HOUR))" "$((S + 2 * HOUR))"
link "${LEFT_TOKEN}" "${ROSTER_MEET}" "${p}-left"
# IDLE's link does not overlap: not on the roster.
sess "${IDLE_TOKEN}" "${p}-idle" "$((E + HOUR))" "$((E + 2 * HOUR))"
link "${IDLE_TOKEN}" "${ROSTER_MEET}" "${p}-idle"
for who in JOINED BOTH LEFT; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER_MEET}")"
  expect_ok "${who} joins the meet"
done
rpc "${LEFT_TOKEN}" group_meet_leave "$(b_ref "${GROUP}" "${ROSTER_MEET}")"
expect_ok "LEFT leaves the meet online"

rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${ROSTER_MEET}")"
expect_ok "read the roster"
roster_flags() {
  jq -c --arg u "$1" '[.roster[] | select(.member.user_id == $u) | [.joined, .linked, (.joined_at_ms != null), .current_member]]' <<<"${BODY}"
}
[[ "$(jq '.roster | length' <<<"${BODY}")" == 4 ]] || fail "the roster is joined ∪ counting links (4 members): ${BODY}"
[[ "$(roster_flags "${JOINED_UID}")" == '[[true,false,true,true]]' ]] || fail "joined only"
[[ "$(roster_flags "${LINKED_UID}")" == '[[false,true,false,true]]' ]] || fail "linked only"
[[ "$(roster_flags "${BOTH_UID}")" == '[[true,true,true,true]]' ]] || fail "joined and linked"
[[ "$(roster_flags "${LEFT_UID}")" == '[[false,true,false,true]]' ]] || fail "left the meet, live link"
[[ "$(roster_flags "${IDLE_UID}")" == '[]' ]] || fail "a link that does not count adds no one"
jq -e '[.roster[] | .joined] == [true, true, false, false]' <<<"${BODY}" >/dev/null ||
  fail "joined members come first, in join order"

# Tombstoning the last link drops a linked-only member.
link "${LINKED_TOKEN}" "${ROSTER_MEET}" "${p}-linked" "${NOW}"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${ROSTER_MEET}")"
[[ "$(roster_flags "${LINKED_UID}")" == '[]' ]] || fail "a left link drops a linked-only member"
pass "roster: joined only, linked only, both, left with a live link"

# A future meet: links cannot count yet, so only joins are on the roster.
link "${MEMBER_TOKEN}" "${FUTURE_MEET}" "${p}-running"
expect_counting "${FUTURE_MEET}" "" "a running session does not count before the meet starts"
pass "counting: future meet"

# The server never writes a member's Sync v2 rows: only sync_push (the member's
# own push) and dev_wipe_my_data touch session_meet_links.
[[ "$(run_psql "select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app_public', 'public')
    and p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(app_public\\.)?session_meet_links';")" \
  == "dev_wipe_my_data,sync_push" ]] || fail "only sync_push and dev_wipe_my_data may write session_meet_links"
pass "no server function writes session_meet_links beyond sync_push and dev_wipe_my_data"

COMPLETED=1
echo "[${LANE_LABEL}] PASS"
