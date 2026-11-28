#!/usr/bin/env bash

# notification-meets.sh — meet start and end pushes on the durable pipeline and
# the per-group Meets preference (a body of the auth-authz lane).
#
# Contract: docs/specs/tech/group-meet-contract.md ("Notifications");
# product fact [[notifications.meets]]. Real RPCs, the meet's own timed
# transition (group_meet_eval_advance), the evaluator's published scores and
# the worker's handoff seam. Meet times are shifted by direct SQL (the server
# is the only writer of meets). Proves:
#
#   - the Meets preference defaults on, is per group and independent of the
#     group mute, and denies outsiders, anon and OAuth clients;
#   - the start and the end each queue one intent per eligible current member,
#     at the meet's own moment, and none for a member with Meets off, a muted
#     group, a former member or an outsider; a cancelled meet queues nothing;
#   - an edited start moves the start push; a retry never duplicates;
#   - a start or end older than 24 hours queues nothing, and a start the end
#     has already passed is skipped;
#   - handoff rechecks the preference, mute, membership and cancellation, and
#     the end push carries the standings so far (names only).
#
# Hermetic: per-run users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="notification-meets"
FIXTURE_EMAIL_PREFIX="notification-meets"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done
load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] ||
  fail "local Supabase status env is incomplete"
DB_CONTAINER="$(resolve_db_container)" || exit 1
psql_session_start

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-z0-9-' '-')"
PASSWORD="NotificationMeets!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
GID=""
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"
set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  run_psql "alter table app_public.notification_intents drop constraint if exists nm_fault;" >/dev/null 2>&1 || true
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and (user_id in (${ids})
      or context ->> 'group_id' in (select id::text from app_public.groups where created_by in (${ids})));
    delete from app_public.group_eval_queue where member_user_id in (${ids});
    delete from app_public.groups where created_by in (${ids})
      or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
    delete from auth.users where id in (${ids});
    delete from app_public.notification_config;
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

set_kick_url ""
set_sweep_active false

expect_sql() {
  local got
  got="$(run_psql "$2")"
  [[ "${got}" == "$3" ]] || fail "$1: expected '$3', got '${got}'"
}
drain() {
  eval_drain
  expect_ok "drain: $1"
  check "drain: $1 (no failed job)" '.failed == 0'
}
new_uuid() { run_psql "select gen_random_uuid();"; }

HOUR=3600000
NOW="$(run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;")"
CUAM="${NOW}"
T="nm-${RUN_TAG}"
LOCAL_PROJECT="3c00cd23-0946-4eb6-bbf0-4542879cd314"

e_mlink() {
  jq -nc --arg m "$1" --arg s "$2" --argjson c "$3" \
    '{type: "session_meet_links", id: ($m + ":" + $s), client_updated_at_ms: $c,
      fields: {session_id: $s, meet_id: $m, created_at: $c, updated_at: $c, deleted_at: null}}'
}

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning"
# OWNER, A and B are eligible; C turns Meets off, D mutes the group, E leaves it,
# OUTSIDER never joined.
for who in OWNER A B C D E OUTSIDER; do
  provision "${who}" "$(printf '%s' "${who}" | tr 'A-Z' 'a-z')"
  uid_var="${who}_UID"
  set_username "${!uid_var}" "nm-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Notification meets ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"Europe/London"}')"
expect_ok "create group"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
INVITE="$(jq -er '.code' <<<"${BODY}")"
for who in A B C D E; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
run_psql "update app_public.group_memberships set joined_at = clock_timestamp() - interval '30 days'
  where group_id = '${GID}';
  insert into app_public.notification_config(environment, project_id, bundle_id, sending_enabled, provider)
  values ('local', '${LOCAL_PROJECT}', 'com.phano.boga3.dev', true, 'local')
  on conflict (singleton) do update set sending_enabled = true, provider = 'local';" >/dev/null

# One installation per user, permission and opt-in on.
register() {
  local who="$1" token_var="$1_TOKEN" install capability key
  install="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  capability="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
  key="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
  rpc "${!token_var}" notification_register "$(jq -nc --arg i "${install}" --arg c "${capability}" --arg k "${key}" \
    --arg t "LocalPushToken[nm-${who}-${RUN_TAG}]" --arg p "${LOCAL_PROJECT}" \
    '{p_installation_id:$i,p_capability:$c,p_encryption_key:$k,p_token:$t,p_environment:"local",p_project_id:$p,
      p_bundle_id:"com.phano.boga3.dev",p_permission:true,p_opted_in:true}')"
  expect_ok "register ${who}"
}
for who in OWNER A B C D E OUTSIDER; do register "${who}"; done

# --- the Meets preference ----------------------------------------------------------

rpc "${B_TOKEN}" notification_preferences_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
expect_ok "read preferences"
check "Meets defaults on, beside the mute" '.meets == true and .muted == false and .activity and .bests and .ranks'
rpc "${B_TOKEN}" notification_preferences_get '{}'
expect_ok "read global preferences"
check "the global read reports the default" '.meets == true'
rpc "${C_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:false}')"
expect_ok "C turns Meets off"
check "Meets off is reported, the mute untouched" '.meets == false and .muted == false'
rpc "${D_TOKEN}" notification_group_mute "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_muted:true}')"
expect_ok "D mutes the group"
check "a mute leaves Meets alone" '.meets == true and .muted == true'
rpc "${D_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:true}')"
expect_ok "D sets Meets on while muted"
check "Meets does not clear the mute" '.meets == true and .muted == true'
rpc "${C_TOKEN}" notification_group_mute "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_muted:false}')"
expect_ok "C sets the mute again"
check "a mute write keeps Meets off" '.meets == false and .muted == false'
rpc "${C_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:null}')"
expect_error VALIDATION "null Meets"
rpc "${OUTSIDER_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:false}')"
expect_error NOT_FOUND "an outsider"
OUTSIDER_BODY="${BODY}"
rpc "${OUTSIDER_TOKEN}" notification_group_meets_set '{"p_group_id":"00000000-0000-0000-0000-000000000001","p_meets":false}'
expect_error NOT_FOUND "a missing group"
[[ "${BODY}" == "${OUTSIDER_BODY}" ]] || fail "the membership boundary differs for a missing group"
rpc "${ANON_KEY}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:false}')"
expect_error AUTH_REQUIRED "anon"
AGENT="$(mint_token "${A_TOKEN}" notification-meets-probe)"
rpc "${AGENT}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:false}')"
expect_error AGENT_FORBIDDEN "an OAuth client"
for worker_rpc in notification_meet_enqueue notification_meet_publish notification_meet_standings; do
  rpc "${A_TOKEN}" "${worker_rpc}" '{}'
  [[ ! "${STATUS}" =~ ^2 ]] || fail "an app token can invoke ${worker_rpc}"
done
pass "the Meets preference: default, per group, independent of the mute, denials"

# E leaves the group: a former member.
rpc "${E_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
expect_ok "E leaves"

# --- meets ---------------------------------------------------------------------------

new_meet() {
  local meet title="$3"
  meet="$(new_uuid)"
  rpc "${OWNER_TOKEN}" group_meet_create "$(jq -nc --arg g "${GID}" --arg m "${meet}" --arg t "${title}" --argjson s "$((NOW + 2 * HOUR))" \
    '{p_group_id:$g, p_meet_id:$m, p_title:(if $t == "" then null else $t end), p_starts_at_ms:$s, p_ends_at_ms:null,
      p_venue_name:"Iron Temple", p_address:null, p_latitude:null, p_longitude:null, p_entry_note:null}')"
  expect_ok "create meet"
  run_psql "update app_public.group_meets set starts_at = app_public.group_meet_at($1),
    ends_at = app_public.group_meet_at($2) where id = '${meet}';" >/dev/null
  printf '%s' "${meet}"
}
advance_all() {
  run_psql "select coalesce(string_agg(r::text, ' ' order by i), '') from (
    select i, app_public.group_meet_eval_advance() as r from generate_series(1, ${1:-10}) i) x
    where (r->>'advanced')::boolean;" >/dev/null
}
# intents <meet> <kind>: the recipients' labels, sorted.
intents() {
  run_psql "select coalesce(string_agg(split_part(p.username, '-', 2), ',' order by p.username), '')
    from app_public.notification_intents n join app_public.user_profiles p on p.id = n.recipient_user_id
    where n.meet_id = '$1' and n.kind = '$2';"
}
intent_count() { run_psql "select count(*) from app_public.notification_intents where meet_id = '$1';"; }
delivery_count() {
  run_psql "select count(*) from app_public.notification_deliveries d join app_public.notification_intents n on n.id = d.intent_id
    where n.meet_id = '$1' and n.kind = '$2';"
}

# The fixture's sessions for the standings: A and B log Bench inside MEET1's window.
comparison() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GID}" --arg n "$1" \
    '{p_group_id:$g, p_name:$n, p_load_input_mode:"total_load", p_source_exercise_id:null,
      p_bodyweight_contribution:0, p_default_metric:"e1rm"}')"
  expect_ok "comparison $1"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
BENCH="$(comparison Bench)"
for who in A B; do
  token_var="${who}_TOKEN"
  next_cuam
  push "${!token_var}" "${who} exercises" \
    "$(e_def "${T}-${who}-bench" Bench "${CUAM}")" "$(e_link "${T}-${who}-bench" "${GID}" "${BENCH}" "${CUAM}")"
done

# MEET1: live now (started 3h ago, ends in 1h).
MEET1="$(new_meet "$((NOW - 3 * HOUR))" "$((NOW + HOUR))" "Bench day")"
CH_REPS="$(new_uuid)"
rpc "${A_TOKEN}" group_meet_challenge_add "$(jq -nc --arg g "${GID}" --arg m "${MEET1}" --arg c "${CH_REPS}" --arg x "${BENCH}" \
  '{p_group_id:$g, p_meet_id:$m, p_challenge_id:$c, p_group_exercise_id:$x, p_metric:"reps"}')"
expect_ok "challenge"
for pair in "A 8" "B 5"; do
  read -r who reps <<<"${pair}"
  token_var="${who}_TOKEN"
  sid="${T}-${who}-main"
  next_cuam
  push "${!token_var}" "${who} session" \
    "$(e_session "${sid}" "$((NOW - 2 * HOUR))" completed "$((NOW - HOUR - HOUR / 2))" 1800 null "${CUAM}")" \
    "$(e_se "${sid}-bench" "${sid}" "${T}-${who}-bench" 0 Bench "${CUAM}")" \
    "$(e_set "${sid}-bench-1" "${sid}-bench" 0 100 "${reps}" '' "${CUAM}" null rir_0)"
  next_cuam
  push "${!token_var}" "${who} link" "$(e_mlink "${MEET1}" "${sid}" "${CUAM}")"
done
drain "the standings fixture"

advance_all
[[ "$(intents "${MEET1}" meet_start)" == "a,b,owner" ]] ||
  fail "the start queues one intent per eligible current member (not Meets off, muted, former or outsider): '$(intents "${MEET1}" meet_start)'"
[[ "$(intent_count "${MEET1}")" == 3 && "$(delivery_count "${MEET1}" meet_start)" == 3 ]] ||
  fail "one delivery per eligible installation"
expect_sql "the start intent is the meet's own moment, fresh for 24 hours" \
  "select bool_and(n.event_at = m.starts_at and n.expires_at = m.starts_at + interval '24 hours'
      and n.lifter_user_id is null and n.session_id = m.id::text)
     from app_public.notification_intents n join app_public.group_meets m on m.id = n.meet_id where m.id = '${MEET1}';" t
advance_all
run_psql "select app_public.notification_meet_publish(m, 'meet_start', clock_timestamp()) from app_public.group_meets m
  where id = '${MEET1}';" >/dev/null
[[ "$(intent_count "${MEET1}")" == 3 && "$(delivery_count "${MEET1}" meet_start)" == 3 ]] ||
  fail "a retry (a second advance and a second publish) duplicates nothing"
[[ "$(intents "${MEET1}" meet_end)" == "" ]] || fail "no end push before the end"
pass "start: eligible recipients only, once"

# Handoff: the preview is narrow and public; the recheck cancels what no longer holds.
handoff() {
  local who="$1" kind="$2" delivery claim
  delivery="$(run_psql "select d.id from app_public.notification_deliveries d
    join app_public.notification_intents n on n.id = d.intent_id
    join app_public.notification_installations i on i.id = d.installation_id
    join auth.users u on u.id = i.user_id
    where n.meet_id = '${MEET1}' and n.kind = '${kind}' and u.email like 'notification-meets-${who}-%' limit 1;")"
  [[ -n "${delivery}" ]] || { DELIVERY=""; BODY="null"; return 0; }
  claim="$(run_psql "update app_public.notification_deliveries set state = 'leased', claim_id = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '60 seconds' where id = ${delivery} returning claim_id;")"
  DELIVERY="${delivery}"
  rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq -nc --argjson d "${delivery}" --arg c "${claim}" \
    '{p_delivery_id:$d,p_claim_id:$c,p_generation:1}')"
  expect_ok "begin send ${who} ${kind}"
}
handoff b meet_start
check "the start preview: the meet and its venue, no figures" \
  '.projection.kind == "meet_start" and .projection.heading == "Bench day is on at Iron Temple"
   and .projection.identity == $g and .projection.detail == "" and .projection.bestCount == 0 and .projection.rankCount == 0
   and .projection.route == {groupId: $gid, memberId: $b, sessionId: $m}
   and (.projection | keys | sort) == ["bestCount","bindingId","detail","expiresAt","heading","identity","kind","notificationId","rankCount","recipientUserId","route","v"]' \
  --arg g "Notification meets ${RUN_TAG}" --arg gid "${GID}" --arg b "${B_UID}" --arg m "${MEET1}"
expect_sql "the handoff is now sending" "select state from app_public.notification_deliveries where id = ${DELIVERY};" sending

# The recheck: B's group is muted after the intent was queued → nothing sent.
handoff a meet_start
expect_sql "A's start is sending while eligible" "select state from app_public.notification_deliveries where id = ${DELIVERY};" sending
rpc "${OWNER_TOKEN}" notification_group_mute "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_muted:true}')"
expect_ok "owner mutes"
handoff owner meet_start
[[ "${BODY}" == null ]] || fail "a mute after queueing cancels the handoff"
expect_sql "the muted recipient's delivery is cancelled" "select state from app_public.notification_deliveries where id = ${DELIVERY};" cancelled
rpc "${OWNER_TOKEN}" notification_group_mute "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_muted:false}')"
expect_ok "owner unmutes"
pass "handoff: preview and mute recheck"

# --- the end: standings so far -----------------------------------------------------

run_psql "update app_public.group_meets set ends_at = app_public.group_meet_at($((NOW - HOUR))) where id = '${MEET1}';" >/dev/null
advance_all
[[ "$(intents "${MEET1}" meet_end)" == "a,b,owner" ]] || fail "the end queues one intent per eligible member: '$(intents "${MEET1}" meet_end)'"
expect_sql "the end intent is the meet's end" \
  "select bool_and(n.event_at = m.ends_at and n.expires_at = m.ends_at + interval '24 hours')
     from app_public.notification_intents n join app_public.group_meets m on m.id = n.meet_id
    where m.id = '${MEET1}' and n.kind = 'meet_end';" t
[[ "$(intents "${MEET1}" meet_start)" == "a,b,owner" ]] || fail "the start intents are unchanged"
handoff b meet_end
check "the end preview carries the standings so far, names only" \
  '.projection.kind == "meet_end" and .projection.heading == "Bench day: results so far"
   and .projection.detail == ("Bench · Max reps: " + $a + ", " + $b)' \
  --arg a "nm-a-${RUN_TAG}" --arg b "nm-b-${RUN_TAG}"
# A late edit keeps the same single end intent.
advance_all
[[ "$(intent_count "${MEET1}")" == 6 ]] || fail "the end fires once"
pass "end: standings so far, once"

# Handoff rechecks: Meets off, a former member, a cancelled meet.
handoff a meet_end
expect_sql "A's end is sending while eligible" "select state from app_public.notification_deliveries where id = ${DELIVERY};" sending
rpc "${A_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:false}')"
expect_ok "A turns Meets off after the end was queued"
handoff owner meet_end
expect_sql "owner's end is sending while eligible" "select state from app_public.notification_deliveries where id = ${DELIVERY};" sending
run_psql "select app_public.notification_projection(n.id) is null from app_public.notification_intents n
  where n.meet_id = '${MEET1}' and n.kind = 'meet_end' and n.recipient_user_id = '${A_UID}';" | grep -qx t ||
  fail "Meets off after queueing yields no preview"
run_psql "update app_public.group_memberships set ended_at = clock_timestamp(), end_reason = 'left' where group_id = '${GID}' and user_id = '${B_UID}';" >/dev/null
run_psql "select app_public.notification_projection(n.id) is null from app_public.notification_intents n
  where n.meet_id = '${MEET1}' and n.kind = 'meet_end' and n.recipient_user_id = '${B_UID}';" | grep -qx t ||
  fail "a member who left after queueing gets no preview"
run_psql "update app_public.group_memberships set ended_at = null, end_reason = null where group_id = '${GID}' and user_id = '${B_UID}';" >/dev/null
run_psql "update app_public.group_meets set cancelled_at = starts_at - interval '1 hour' where id = '${MEET1}';" >/dev/null
run_psql "select count(*) = 0 from app_public.notification_intents n where n.meet_id = '${MEET1}'
  and app_public.notification_projection(n.id) is not null;" | grep -qx t || fail "a cancelled meet yields no preview"
run_psql "update app_public.group_meets set cancelled_at = null where id = '${MEET1}';" >/dev/null
rpc "${A_TOKEN}" notification_group_meets_set "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_meets:true}')"
expect_ok "A turns Meets back on"
pass "handoff: Meets off, former member and cancellation recheck"

# --- cancelled, edited, late and overtaken meets -------------------------------------

# Cancelled before the start: nothing, even once the times pass.
MEET2="$(new_meet "$((NOW + 2 * HOUR))" "$((NOW + 3 * HOUR))" "")"
rpc "${OWNER_TOKEN}" group_meet_cancel "$(jq -nc --arg g "${GID}" --arg m "${MEET2}" '{p_group_id:$g,p_meet_id:$m,p_expected_version:1}')"
expect_ok "cancel"
run_psql "update app_public.group_meets set starts_at = app_public.group_meet_at($((NOW - 2 * HOUR))),
  ends_at = app_public.group_meet_at($((NOW - HOUR))), cancelled_at = app_public.group_meet_at($((NOW - 3 * HOUR)))
  where id = '${MEET2}';" >/dev/null
advance_all
[[ "$(intent_count "${MEET2}")" == 0 ]] || fail "a cancelled meet queues nothing"

# An edited start moves the start push: nothing at the old time, the intent at the new one.
MEET3="$(new_meet "$((NOW + 2 * HOUR))" "$((NOW + 5 * HOUR))" "")"
advance_all
[[ "$(intent_count "${MEET3}")" == 0 ]] || fail "a scheduled meet queues nothing yet"
rpc "${OWNER_TOKEN}" group_meet_update "$(jq -nc --arg g "${GID}" --arg m "${MEET3}" --argjson s "$((NOW + 4 * HOUR))" \
  --argjson e "$((NOW + 6 * HOUR))" '{p_group_id:$g,p_meet_id:$m,p_expected_version:1,p_title:null,p_starts_at_ms:$s,p_ends_at_ms:$e,
    p_venue_name:"New Gym",p_address:null,p_latitude:null,p_longitude:null,p_entry_note:null}')"
expect_ok "edit the start"
EDITED_START="$(run_psql "select floor(extract(epoch from starts_at) * 1000)::bigint from app_public.group_meets where id = '${MEET3}';")"
# Three hours pass: the original start is behind us, the edited one is still an hour away.
run_psql "update app_public.group_meets set starts_at = starts_at - interval '3 hours', ends_at = ends_at - interval '3 hours'
  where id = '${MEET3}';" >/dev/null
advance_all
[[ "$(intent_count "${MEET3}")" == 0 ]] || fail "nothing is sent at the original start once it was edited"
# One more hour: the edited start has just arrived.
run_psql "update app_public.group_meets set starts_at = starts_at - interval '1 hour', ends_at = ends_at - interval '1 hour'
  where id = '${MEET3}';" >/dev/null
advance_all
[[ "$(intents "${MEET3}" meet_start)" == "a,b,owner" ]] || fail "the edited start queued its push"
expect_sql "the push is at the edited moment, with the edited venue" \
  "select bool_and(floor(extract(epoch from n.event_at) * 1000)::bigint = ${EDITED_START} - 4 * ${HOUR})
     from app_public.notification_intents n where n.meet_id = '${MEET3}';" t
run_psql "select app_public.notification_projection(n.id)->>'heading' from app_public.notification_intents n
  where n.meet_id = '${MEET3}' and n.recipient_user_id = '${B_UID}';" | grep -qx 'Meet is on at New Gym' ||
  fail "an untitled meet reads Meet, at its current venue"

# Freshness: a start and an end older than 24 hours queue nothing.
MEET4="$(new_meet "$((NOW - 40 * HOUR))" "$((NOW - 30 * HOUR))" "")"
advance_all
[[ "$(intent_count "${MEET4}")" == 0 ]] || fail "a start and an end older than 24 hours queue nothing"
expect_sql "the stream items still fire" \
  "select count(*) from app_public.group_events where kind = 'meet' and payload->'meet'->>'meet_id' = '${MEET4}'
    and payload->>'event' in ('on','results');" 2
# Overtaken: both due at once, the start is skipped, the end sends.
MEET5="$(new_meet "$((NOW - 2 * HOUR))" "$((NOW - HOUR))" "")"
advance_all
[[ "$(intents "${MEET5}" meet_start)" == "" && "$(intents "${MEET5}" meet_end)" == "a,b,owner" ]] ||
  fail "a start the end has passed is skipped; the end sends: start='$(intents "${MEET5}" meet_start)' end='$(intents "${MEET5}" meet_end)'"
pass "cancelled, edited, late and overtaken meets"

# A producer wakes the delivery worker once per transaction, and a rolled-back
# transaction leaves nothing behind.
MEET7="$(new_meet "$((NOW - HOUR))" "$((NOW + HOUR))" "")"
run_psql "begin;
  delete from vault.secrets where name in ('notification_worker_url','notification_worker_key');
  select vault.create_secret('http://127.0.0.1:9/functions/v1/notification-worker','notification_worker_url');
  select vault.create_secret('fixture-only','notification_worker_key');
  set local boga.notification_kicked='false';
  do \$\$ declare requests bigint; m app_public.group_meets; begin
    select * into m from app_public.group_meets where id = '${MEET7}';
    select count(*) into requests from net.http_request_queue;
    if app_public.notification_meet_publish(m, 'meet_start', now()) <> 3 then raise exception 'start did not queue its intents'; end if;
    if (select count(*) from net.http_request_queue) <> requests + 1 then raise exception 'the producer did not wake the worker'; end if;
    perform app_public.notification_meet_publish(m, 'meet_start', now());
    if (select count(*) from net.http_request_queue) <> requests + 1 then raise exception 'the transaction woke the worker twice'; end if;
  end \$\$;
  rollback;" >/dev/null
pass "the producer wakes the delivery worker once"

# The preview's text cleanup covers the C1 range the device validators reject.
run_psql "update app_public.group_meets set title = E'Bench\\u0085day' where id = '${MEET3}';" >/dev/null
run_psql "select app_public.notification_projection(n.id)->>'heading' from app_public.notification_intents n
  where n.meet_id = '${MEET3}' and n.recipient_user_id = '${B_UID}';" | grep -qx 'Bench day is on at New Gym' ||
  fail "a control character in a meet title becomes a space in the preview"

# A failed enqueue is logged and never blocks the transition.
MEET6="$(new_meet "$((NOW - 2 * HOUR))" "$((NOW + HOUR))" "")"
run_psql "alter table app_public.notification_intents add constraint nm_fault check (meet_id is distinct from '${MEET6}') not valid;" >/dev/null
advance_all
run_psql "alter table app_public.notification_intents drop constraint nm_fault;" >/dev/null
[[ "$(intent_count "${MEET6}")" == 0 ]] || fail "a failed enqueue rolls back its own intents"
expect_sql "the transition committed and the failure was logged" \
  "select (select on_at is not null from app_public.group_meets where id = '${MEET6}')::text || '|' ||
     (select count(*) from public.app_logs where event = 'group.meet_notification_failed' and context->>'meet_id' = '${MEET6}');" "true|1"
# Deleting a meet removes its intents and deliveries.
run_psql "delete from app_public.group_meets where id = '${MEET5}';" >/dev/null
[[ "$(intent_count "${MEET5}")" == 0 && "$(delivery_count "${MEET5}" meet_end)" == 0 ]] || fail "deleting a meet removes its intents"
COMPLETED=1
pass "notification meets"
