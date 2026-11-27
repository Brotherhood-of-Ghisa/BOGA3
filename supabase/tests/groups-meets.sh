#!/usr/bin/env bash

# groups-meets.sh — group meet storage, challenges and the online roster (a
# body of the groups-contract lane).
#
# Contract: docs/specs/tech/group-meet-contract.md ("Storage and lifecycle",
# "Challenges", "Roster and session links"). Proves, against the real local
# stack through PostgREST:
#
#   - posture: RLS on, no policies, no direct grants, no owner_user_id, no FK
#     into Sync v2 tables; RPCs SECURITY DEFINER, search_path-pinned and
#     executable by anon+authenticated; helpers not client-executable; direct
#     select/insert/update/delete denied on every meet table;
#   - every RPC: AUTH_REQUIRED (anon), AGENT_FORBIDDEN (OAuth), UPDATE_REQUIRED
#     (old contract), NOT_FOUND for a stranger and a former member,
#     byte-identical to a nonexistent group;
#   - create/edit/cancel by owner and admin only (member FORBIDDEN); field
#     validation; an idempotent create retry; a stale version is CONFLICT with
#     the row unchanged; an edit retry is idempotent; edits refused after the
#     end; a started meet's start cannot move later; cancel refused after the start; a cancelled meet keeps its audit
#     fields, refuses edits, challenges and joins, and leaves the lists;
#   - challenges: any member adds, the author or an admin edits/removes,
#     another member is FORBIDDEN; metrics follow the exercise (Hold ⇒ seconds);
#     DUPLICATE on the same live exercise + metric; an add retry survives an
#     archive; an unchanged save is a no-op; a removed challenge leaves
#     reads and frees its pair; two concurrent different adds both commit;
#   - join/leave by members until the cutoff (ends_at + 24h), refused after it;
#   - stream: scheduled and cancelled once each, challenge_changed only after
#     the cutoff, payloads holding definition snapshots only; the v7 page lists
#     them, the v6 page does not.
#
# Times are moved by direct SQL on the meet rows (the server is the only
# writer; the RPCs read clock_timestamp()). Hermetic: per-run users, deleted
# on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-meets"
FIXTURE_EMAIL_PREFIX="groups-meets"
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
PASSWORD="GroupsMeets!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
RACE_DIR=""

cleanup() {
  [[ -z "${RACE_DIR}" ]] || rm -rf "${RACE_DIR}"
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

# The current app's group calls: protocol 4 and Hold support (a group with a
# Hold comparison refuses clients without it).
rpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H "${GROUP_CONTRACT_HEADER}" \
    -H 'x-boga-group-seconds: 1' -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
# expect_json <context> [jq args...] <filter>: the last response matches.
expect_json() {
  local context="$1" filter="${!#}"
  set -- "${@:2:$#-2}"
  jq -e "$@" "${filter}" <<<"${BODY}" >/dev/null || fail "${context}"
}
# rpc_no_hold: the same call from a client without Hold support.
rpc_no_hold() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H "${GROUP_CONTRACT_HEADER}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
new_uuid() { run_psql "select gen_random_uuid();"; }
now_ms() { run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;"; }
sql_value() { run_psql "$1"; }
HOUR=3600000

# b_meet <group> <meet> <starts_ms> <ends_ms|null> [venue] [title] — a full
# create body (no address, coordinates or note unless the caller adds them).
b_meet() {
  jq -nc --arg g "$1" --arg m "$2" --argjson s "$3" --argjson e "$4" --arg v "${5-Iron Temple}" --arg t "${6-}" \
    '{p_group_id:$g, p_meet_id:$m, p_title:(if $t == "" then null else $t end), p_starts_at_ms:$s, p_ends_at_ms:$e,
      p_venue_name:$v, p_address:null, p_latitude:null, p_longitude:null, p_entry_note:null}'
}
# b_edit <create-body> <expected-version>: the same fields as an edit body.
b_edit() { jq -c --argjson v "$2" '. + {p_expected_version:$v}' <<<"$1"; }
b_ref() { jq -nc --arg g "$1" --arg m "$2" '{p_group_id:$g, p_meet_id:$m}'; }
b_cancel() { jq -nc --arg g "$1" --arg m "$2" --argjson v "$3" '{p_group_id:$g, p_meet_id:$m, p_expected_version:$v}'; }
b_ch_add() {
  jq -nc --arg g "$1" --arg m "$2" --arg c "$3" --arg e "$4" --arg x "$5" \
    '{p_group_id:$g, p_meet_id:$m, p_challenge_id:$c, p_group_exercise_id:$e, p_metric:$x}'
}
b_ch_edit() {
  jq -nc --arg g "$1" --arg m "$2" --arg c "$3" --argjson v "$4" --arg e "$5" --arg x "$6" \
    '{p_group_id:$g, p_meet_id:$m, p_challenge_id:$c, p_expected_version:$v, p_group_exercise_id:$e, p_metric:$x}'
}
b_ch_remove() {
  jq -nc --arg g "$1" --arg m "$2" --arg c "$3" --argjson v "$4" \
    '{p_group_id:$g, p_meet_id:$m, p_challenge_id:$c, p_expected_version:$v}'
}
# move_meet <meet> <starts offset ms> <ends offset ms>: shifts the window
# relative to now.
move_meet() {
  run_psql "update app_public.group_meets set starts_at = clock_timestamp() + ($2 * interval '1 millisecond'),
    ends_at = clock_timestamp() + ($3 * interval '1 millisecond') where id = '$1';" >/dev/null
}
meet_events() {
  sql_value "select count(*) from app_public.group_events where kind = 'meet'
    and payload->'meet'->>'meet_id' = '$1' and payload->>'event' = '$2';"
}

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning owner, admin, member, author, former member and stranger"
provision OWNER owner
provision ADMIN admin
provision MEMBER member
provision AUTHOR author
provision FORMER former
provision STRANGER stranger
for who in OWNER ADMIN MEMBER AUTHOR FORMER STRANGER; do
  uid_var="${who}_UID"
  set_username "${!uid_var}" "meet-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
MISSING_GROUP="$(new_uuid)"

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Meets ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"Europe/London"}')"
expect_ok "owner creates the group"
GROUP="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
CODE="$(jq -r '.code' <<<"${BODY}")"
for who in ADMIN MEMBER AUTHOR FORMER; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${CODE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
rpc "${OWNER_TOKEN}" group_set_role "$(jq -nc --arg g "${GROUP}" --arg u "${ADMIN_UID}" '{p_group_id:$g, p_user_id:$u, p_role:"admin"}')"
expect_ok "admin role"
rpc "${FORMER_TOKEN}" group_leave "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "former member leaves"
rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" \
  '{p_group_id:$g, p_name:"Meet Bench", p_load_input_mode:"total_load", p_source_exercise_id:null}')"
expect_ok "bench exercise"
BENCH="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" \
  '{p_group_id:$g, p_name:"Meet Plank", p_load_input_mode:"total_load", p_source_exercise_id:null,
    p_bodyweight_contribution:0, p_default_metric:"seconds"}')"
expect_ok "a Hold exercise"
PLANK="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" \
  '{p_group_id:$g, p_name:"Meet Row", p_load_input_mode:"total_load", p_source_exercise_id:null}')"
expect_ok "archived exercise"
ARCHIVED="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GROUP}" --arg e "${ARCHIVED}" \
  '{p_group_id:$g, p_exercise_id:$e, p_archived:true}')"
expect_ok "archive the row exercise"
rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" \
  '{p_group_id:$g, p_name:"Meet Squat", p_load_input_mode:"total_load", p_source_exercise_id:null}')"
expect_ok "squat exercise"
SQUAT="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"

# --- posture -----------------------------------------------------------------------

MEET_TABLES="'group_meets','group_meet_challenges','group_meet_roster'"
SYNC_TABLES="'gyms','exercise_definitions','muscle_groups','exercise_tag_definitions','sessions','exercise_muscle_mappings','session_exercises','exercise_sets','session_exercise_tags','exercise_group_links','session_meet_links'"
[[ "$(sql_value "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app_public' and c.relname in (${MEET_TABLES}) and c.relkind = 'r' and c.relrowsecurity;")" == 3 ]] ||
  fail "RLS must be on for every meet table"
[[ "$(sql_value "select count(*) from pg_policies where schemaname = 'app_public' and tablename in (${MEET_TABLES});")" == 0 ]] ||
  fail "meet tables must have no policies"
[[ "$(sql_value "select count(*) from unnest(array['anon','authenticated']) r(role)
  cross join unnest(array[${MEET_TABLES}]) t(name)
  where has_table_privilege(r.role, 'app_public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');")" == 0 ]] ||
  fail "a client role holds a direct privilege on a meet table"
[[ "$(sql_value "select count(*) from information_schema.columns where table_schema = 'app_public'
  and table_name in (${MEET_TABLES}) and column_name = 'owner_user_id';")" == 0 ]] || fail "a meet table entered sync scope"
[[ "$(sql_value "select count(*) from pg_constraint con join pg_class c on c.oid = con.conrelid
  join pg_class r on r.oid = con.confrelid join pg_namespace n on n.oid = r.relnamespace
  where con.contype = 'f' and c.relname in (${MEET_TABLES}) and n.nspname = 'app_public' and r.relname in (${SYNC_TABLES});")" == 0 ]] ||
  fail "a meet table has an FK into a Sync v2 table"
MEET_RPCS="'group_meet_create','group_meet_update','group_meet_cancel','group_meet_get','group_meet_list','group_meet_challenge_add','group_meet_challenge_update','group_meet_challenge_remove','group_meet_join','group_meet_leave','group_competition_stream_v7'"
[[ "$(sql_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_public' and p.proname in (${MEET_RPCS}) and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig)
    and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == 11 ]] ||
  fail "every meet RPC must be SECURITY DEFINER, search_path-pinned and executable by anon+authenticated"
# Results, Refresh and the leaderboard are client RPCs too; the worker's
# transition entry point is the service role's alone.
MEET_RESULT_RPCS="'group_meet_results','group_meet_refresh_results','group_meet_leaderboard'"
[[ "$(sql_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_public' and p.proname in (${MEET_RESULT_RPCS}) and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig)
    and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == 3 ]] ||
  fail "every meet results RPC must be SECURITY DEFINER, search_path-pinned and executable by anon+authenticated"
[[ "$(sql_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_public' and p.proname = 'group_meet_eval_advance' and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == 1 ]] ||
  fail "the meet transition entry point must be the service role's alone"
[[ "$(sql_value "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) r(role)
  where n.nspname = 'app_public' and p.proname like 'group\_meet\_%'
    and p.proname not in (${MEET_RPCS}, ${MEET_RESULT_RPCS}, 'group_meet_eval_advance')
    and (has_function_privilege(r.role, p.oid, 'EXECUTE') or not 'search_path=app_public, pg_temp' = any(p.proconfig));")" == 0 ]] ||
  fail "a meet helper is client-executable or has no pinned search_path"
for name in group_meets group_meet_challenges group_meet_roster; do
  rest GET "${OWNER_TOKEN}" "${name}" 'select=*'; [[ "${STATUS}" != 200 ]] || fail "direct select ${name}"
  rest POST "${OWNER_TOKEN}" "${name}" '' '{}'; [[ "${STATUS}" != 201 ]] || fail "direct insert ${name}"
  rest PATCH "${OWNER_TOKEN}" "${name}" 'meet_id=eq.00000000-0000-0000-0000-000000000000' '{}'; [[ "${STATUS}" != 200 ]] || fail "direct update ${name}"
  rest DELETE "${OWNER_TOKEN}" "${name}" 'meet_id=eq.00000000-0000-0000-0000-000000000000'; [[ "${STATUS}" != 200 && "${STATUS}" != 204 ]] || fail "direct delete ${name}"
done
pass "posture: RLS on, no policies or grants, no owner column or Sync v2 FK, RPC/helper privileges, direct access denied"

# --- create, edit, cancel ------------------------------------------------------------

NOW="$(now_ms)"
MEET="$(new_uuid)"
CREATE="$(b_meet "${GROUP}" "${MEET}" "$((NOW + 48 * HOUR))" null "  Iron Temple  " "Saturday Lifts")"
CREATE="$(jq -c '.p_address = "1 Gym Street, London" | .p_latitude = 51.5 | .p_longitude = -0.12 | .p_entry_note = "Bring chalk"' <<<"${CREATE}")"

# Every RPC's denials, on bodies that would otherwise succeed or fail later.
CH_PROBE="$(new_uuid)"
for call in \
  "group_meet_create|${CREATE}" \
  "group_meet_update|$(b_edit "${CREATE}" 1)" \
  "group_meet_cancel|$(b_cancel "${GROUP}" "${MEET}" 1)" \
  "group_meet_get|$(b_ref "${GROUP}" "${MEET}")" \
  "group_meet_list|$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')" \
  "group_meet_challenge_add|$(b_ch_add "${GROUP}" "${MEET}" "${CH_PROBE}" "${BENCH}" e1rm)" \
  "group_meet_challenge_update|$(b_ch_edit "${GROUP}" "${MEET}" "${CH_PROBE}" 1 "${BENCH}" volume)" \
  "group_meet_challenge_remove|$(b_ch_remove "${GROUP}" "${MEET}" "${CH_PROBE}" 1)" \
  "group_meet_join|$(b_ref "${GROUP}" "${MEET}")" \
  "group_meet_leave|$(b_ref "${GROUP}" "${MEET}")" \
  "group_meet_results|$(b_ref "${GROUP}" "${MEET}")" \
  "group_meet_refresh_results|$(b_ref "${GROUP}" "${MEET}")" \
  "group_meet_leaderboard|$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"; do
  name="${call%%|*}"; args="${call#*|}"
  rpc "${ANON_KEY}" "${name}" "${args}"; expect_error AUTH_REQUIRED "anonymous ${name}"
  rpc "$(mint_token "${OWNER_TOKEN}" meet-probe)" "${name}" "${args}"; expect_error AGENT_FORBIDDEN "OAuth ${name}"
  saved_header="${GROUP_CONTRACT_HEADER}"; GROUP_CONTRACT_HEADER='x-boga-group-contract: 3'
  rpc "${OWNER_TOKEN}" "${name}" "${args}"; expect_error UPDATE_REQUIRED "old contract ${name}"
  GROUP_CONTRACT_HEADER="${saved_header}"
  rpc_no_hold "${OWNER_TOKEN}" "${name}" "${args}"; expect_error UPDATE_REQUIRED "a client without Hold support ${name}"
  rpc "${STRANGER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "stranger ${name}"
  stranger_body="${BODY}"
  rpc "${FORMER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "former member ${name}"
  [[ "${BODY}" == "${stranger_body}" ]] || fail "former member and stranger differ on ${name}"
  rpc "${STRANGER_TOKEN}" "${name}" "$(jq -c --arg g "${MISSING_GROUP}" '.p_group_id = $g' <<<"${args}")"
  [[ "${BODY}" == "${stranger_body}" ]] || fail "a stranger's ${name} differs between a real and a nonexistent group"
done
pass "every meet RPC: AUTH_REQUIRED, AGENT_FORBIDDEN, UPDATE_REQUIRED (old contract, no Hold support); stranger ≡ former member ≡ nonexistent group"

rpc "${MEMBER_TOKEN}" group_meet_create "${CREATE}"
expect_error FORBIDDEN "a member cannot schedule a meet"
for bad in \
  '.p_meet_id = null' \
  '.p_starts_at_ms = null' \
  ".p_ends_at_ms = .p_starts_at_ms" \
  ".p_ends_at_ms = .p_starts_at_ms + $((7 * 24 * HOUR + 1))" \
  '.p_venue_name = "   "' \
  '.p_venue_name = ("v" * 81)' \
  '.p_title = ("t" * 81)' \
  '.p_address = ("a" * 201)' \
  '.p_entry_note = ("n" * 1001)' \
  '.p_longitude = null' \
  '.p_latitude = 91' \
  ".p_starts_at_ms = $((NOW - 5 * HOUR)) | .p_ends_at_ms = $((NOW - HOUR))" \
  ".p_starts_at_ms = $((NOW + 401 * 24 * HOUR)) | .p_ends_at_ms = null" \
  '.p_starts_at_ms = 9000000000000000000 | .p_ends_at_ms = null' \
  '.p_ends_at_ms = 9000000000000000000' \
  '.p_starts_at_ms = -1'; do
  rpc "${OWNER_TOKEN}" group_meet_create "$(jq -c "${bad}" <<<"${CREATE}")"
  expect_error VALIDATION "invalid meet fields (${bad})"
done
[[ "$(sql_value "select count(*) from app_public.group_meets where group_id = '${GROUP}';")" == 0 ]] || fail "a refused create wrote a row"

rpc "${ADMIN_TOKEN}" group_meet_create "${CREATE}"
expect_ok "an admin schedules a meet"
expect_json "meet shape" '(.meet | keys | sort) == (["meet_id","group_id","title","starts_at_ms","ends_at_ms","cutoff_at_ms","time_zone","venue_name","address","latitude","longitude","entry_note","version","state","created_by","created_at_ms","cancelled_at_ms","cancelled_by"] | sort)'
expect_json "meet fields: trimmed venue, default 3 h end, cutoff 24 h after, group zone" \
  --argjson s "$((NOW + 48 * HOUR))" \
  '.meet.venue_name == "Iron Temple" and .meet.title == "Saturday Lifts" and .meet.starts_at_ms == $s
   and .meet.ends_at_ms == $s + 10800000 and .meet.cutoff_at_ms == $s + 10800000 + 86400000
   and .meet.time_zone == "Europe/London" and .meet.state == "scheduled" and .meet.version == 1
   and .meet.latitude == 51.5 and .meet.entry_note == "Bring chalk" and .meet.cancelled_at_ms == null'
expect_json "creator recorded" --arg u "${ADMIN_UID}" '.meet.created_by.user_id == $u'
FIRST="${BODY}"
rpc "${OWNER_TOKEN}" group_meet_create "${CREATE}"
expect_ok "create retry"
[[ "${BODY}" == "${FIRST}" ]] || fail "an identical create retry must return the same meet"
rpc "${OWNER_TOKEN}" group_meet_create "$(jq -c '.p_venue_name = "Elsewhere"' <<<"${CREATE}")"
expect_error CONFLICT "the same meet id with other fields"
[[ "$(sql_value "select count(*) from app_public.group_meets where group_id = '${GROUP}';")" == 1 ]] || fail "create retries wrote duplicates"
[[ "$(meet_events "${MEET}" scheduled)" == 1 ]] || fail "scheduling must write exactly one stream item"

EDIT="$(b_edit "$(jq -c '.p_venue_name = "Steel Hall" | .p_ends_at_ms = .p_starts_at_ms + 7200000' <<<"${CREATE}")" 1)"
rpc "${MEMBER_TOKEN}" group_meet_update "${EDIT}"
expect_error FORBIDDEN "a member cannot edit"
rpc "${OWNER_TOKEN}" group_meet_update "${EDIT}"
expect_ok "owner edits"
expect_json "edit applied" '.meet.version == 2 and .meet.venue_name == "Steel Hall" and .meet.ends_at_ms - .meet.starts_at_ms == 7200000'
rpc "${OWNER_TOKEN}" group_meet_update "${EDIT}"
expect_ok "edit retry"
expect_json "an edit retry is idempotent" '.meet.version == 2'
BEFORE="$(sql_value "select row_to_json(m)::text from app_public.group_meets m where id = '${MEET}';")"
rpc "${ADMIN_TOKEN}" group_meet_update "$(jq -c '.p_venue_name = "Stale Gym"' <<<"${EDIT}")"
expect_error CONFLICT "a stale version"
[[ "$(sql_value "select row_to_json(m)::text from app_public.group_meets m where id = '${MEET}';")" == "${BEFORE}" ]] ||
  fail "a stale edit changed the row"
rpc "${OWNER_TOKEN}" group_meet_update "$(jq -c '.p_expected_version = 2 | .p_ends_at_ms = .p_starts_at_ms' <<<"${EDIT}")"
expect_error VALIDATION "an edit ending before it starts"
rpc "${OWNER_TOKEN}" group_meet_update "$(jq -c --arg m "$(new_uuid)" '.p_expected_version = 2 | .p_meet_id = $m' <<<"${EDIT}")"
expect_error NOT_FOUND "editing a meet that does not exist"
[[ "$(sql_value "select count(*) from app_public.group_events where kind = 'meet' and payload->'meet'->>'meet_id' = '${MEET}';")" == 1 ]] ||
  fail "an edit must write no stream item"
pass "create/edit: managers only, validation, idempotent create and edit retries, stale version CONFLICT with the row unchanged"

# A live meet stays editable; an ended one refuses date, time and venue edits.
move_meet "${MEET}" "-$((1 * HOUR))" "$((2 * HOUR))"
rpc "${OWNER_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${MEET}" 2)"
expect_error CONFLICT "cancel after the start"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${MEET}")"
expect_json "a started meet is live" '.meet.state == "live"'
LIVE_BODY="$(jq -c --argjson s "$(jq '.meet.starts_at_ms' <<<"${BODY}")" --argjson e "$(jq '.meet.ends_at_ms' <<<"${BODY}")" \
  '.p_expected_version = 2 | .p_starts_at_ms = $s | .p_ends_at_ms = $e | .p_title = "Live edit"' <<<"${EDIT}")"
rpc "${OWNER_TOKEN}" group_meet_update "${LIVE_BODY}"
expect_ok "a live meet can be edited"
rpc "${OWNER_TOKEN}" group_meet_update "$(jq -c ".p_expected_version = 3 | .p_starts_at_ms = $((NOW + 24 * HOUR)) | .p_ends_at_ms = null" <<<"${LIVE_BODY}")"
expect_error CONFLICT "a started meet's start cannot move into the future (it would reopen cancel)"
move_meet "${MEET}" "-$((3 * HOUR))" "-1000"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${MEET}")"
expect_json "an ended meet is finalizing" '.meet.state == "finalizing"'
rpc "${OWNER_TOKEN}" group_meet_update "$(jq -c ".p_expected_version = 3 | .p_starts_at_ms = $((NOW + 24 * HOUR)) | .p_ends_at_ms = null" <<<"${LIVE_BODY}")"
expect_error CONFLICT "an edit after the end"
pass "lifecycle: live edits allowed, cancel refused after the start, edits refused after the end"

# Cancel: managers only, before the start, keeps the row with its audit fields.
CANCELLED="$(new_uuid)"
rpc "${OWNER_TOKEN}" group_meet_create "$(b_meet "${GROUP}" "${CANCELLED}" "$((NOW + 72 * HOUR))" null "Cancel Gym")"
expect_ok "a meet to cancel"
rpc "${MEMBER_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${CANCELLED}" 1)"
expect_error FORBIDDEN "a member cannot cancel"
rpc "${ADMIN_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${CANCELLED}" 0)"
expect_error CONFLICT "a stale cancel"
rpc "${ADMIN_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${CANCELLED}" 1)"
expect_ok "an admin cancels before the start"
expect_json "cancelled with audit fields" --arg u "${ADMIN_UID}" \
  '.meet.state == "cancelled" and .meet.version == 2 and .meet.cancelled_by.user_id == $u and (.meet.cancelled_at_ms | type) == "number"'
rpc "${ADMIN_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${CANCELLED}" 1)"
expect_json "a cancel retry is idempotent" '.meet.version == 2 and .meet.state == "cancelled"'
rpc "${OWNER_TOKEN}" group_meet_cancel "$(b_cancel "${GROUP}" "${CANCELLED}" 2)"
expect_error CONFLICT "cancelling twice"
rpc "${OWNER_TOKEN}" group_meet_update "$(b_edit "$(b_meet "${GROUP}" "${CANCELLED}" "$((NOW + 72 * HOUR))" null "Back On")" 2)"
expect_error CONFLICT "editing a cancelled meet"
[[ "$(sql_value "select (cancelled_by = '${ADMIN_UID}' and cancelled_at is not null and venue_name = 'Cancel Gym')::text
  from app_public.group_meets where id = '${CANCELLED}';")" == true ]] || fail "the cancelled row must stay as an audit record"
[[ "$(meet_events "${CANCELLED}" cancelled):$(meet_events "${CANCELLED}" scheduled)" == "1:1" ]] ||
  fail "cancel must write exactly one cancelled item"
rpc "${MEMBER_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${CANCELLED}")"
expect_error CONFLICT "joining a cancelled meet"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${CANCELLED}" "$(new_uuid)" "${BENCH}" e1rm)"
expect_error CONFLICT "a challenge on a cancelled meet"
pass "cancel: managers only, pre-start, stale CONFLICT, idempotent retry, audit row kept, refuses edits/joins/challenges"

# --- challenges ------------------------------------------------------------------------

UPCOMING="$(new_uuid)"
rpc "${OWNER_TOKEN}" group_meet_create "$(b_meet "${GROUP}" "${UPCOMING}" "$((NOW + 24 * HOUR))" "$((NOW + 26 * HOUR))" "Upcoming Gym" "Next one")"
expect_ok "an upcoming meet"
CH_A="$(new_uuid)"
for bad in "${BENCH}|seconds" "${PLANK}|e1rm" "${ARCHIVED}|e1rm" "${MISSING_GROUP}|e1rm" "${BENCH}|best"; do
  rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "${CH_A}" "${bad%|*}" "${bad#*|}")"
  expect_error VALIDATION "challenge validation ${bad}"
done
rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "$(new_uuid)" "${CH_A}" "${BENCH}" e1rm)"
expect_error NOT_FOUND "a challenge on a meet that does not exist"
ADD_A="$(b_ch_add "${GROUP}" "${UPCOMING}" "${CH_A}" "${BENCH}" e1rm)"
rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "${ADD_A}"
expect_ok "a member adds a challenge"
expect_json "challenge shape" '(.challenge | keys | sort) == (["challenge_id","meet_id","group_exercise_id","exercise_name","exercise_archived","metric","version","author","created_at_ms"] | sort)'
expect_json "challenge fields" --arg u "${AUTHOR_UID}" '.challenge.author.user_id == $u and .challenge.metric == "e1rm" and .challenge.exercise_name == "Meet Bench" and .challenge.version == 1'
FIRST="${BODY}"
rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "${ADD_A}"
[[ "${BODY}" == "${FIRST}" ]] || fail "an identical challenge add retry must return the same challenge"
rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "$(jq -c '.p_metric = "volume"' <<<"${ADD_A}")"
expect_error CONFLICT "the same challenge id with other fields"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "$(new_uuid)" "${BENCH}" e1rm)"
expect_error DUPLICATE "the same live exercise + metric"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "$(new_uuid)" "${PLANK}" seconds)"
expect_ok "a Hold challenge on a Hold exercise"
CH_PLANK="$(jq -r '.challenge.challenge_id' <<<"${BODY}")"
ADD_SQUAT="$(b_ch_add "${GROUP}" "${UPCOMING}" "$(new_uuid)" "${SQUAT}" e1rm)"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "${ADD_SQUAT}"
expect_ok "a squat challenge"
FIRST="${BODY}"
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GROUP}" --arg e "${SQUAT}" \
  '{p_group_id:$g, p_exercise_id:$e, p_archived:true}')"
expect_ok "archive the squat exercise"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "${ADD_SQUAT}"
expect_json "an identical add retry after the exercise is archived returns the stored challenge" \
  --argjson first "${FIRST}" '.challenge == ($first.challenge + {exercise_archived: true})'
rpc "${MEMBER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "$(jq -r '.challenge.challenge_id' <<<"${FIRST}")" 1)"
expect_ok "the author removes the squat challenge"

rpc "${MEMBER_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 1 "${BENCH}" volume)"
expect_error FORBIDDEN "another member cannot edit a challenge"
rpc "${MEMBER_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 1 "${BENCH}" best)"
expect_error FORBIDDEN "another member's bad input is still FORBIDDEN (role before input)"
rpc "${MEMBER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_A}" 1)"
expect_error FORBIDDEN "another member cannot remove a challenge"
rpc "${AUTHOR_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 1 "${BENCH}" volume)"
expect_ok "the author edits"
expect_json "edit applied" '.challenge.version == 2 and .challenge.metric == "volume"'
rpc "${AUTHOR_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 1 "${BENCH}" volume)"
expect_json "a challenge edit retry is idempotent" '.challenge.version == 2'
rpc "${ADMIN_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 1 "${BENCH}" weight)"
expect_error CONFLICT "a stale challenge version"
rpc "${ADMIN_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 2 "${PLANK}" seconds)"
expect_error DUPLICATE "editing onto another live challenge's pair"
rpc "${ADMIN_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_A}" 2 "${BENCH}" reps)"
expect_ok "an admin edits a member's challenge"
expect_json "admin edit applied" '.challenge.version == 3 and .challenge.metric == "reps"'
rpc "${OWNER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_PLANK}" 1)"
expect_ok "the owner removes a member's challenge"
rpc "${OWNER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_PLANK}" 1)"
expect_json "a remove retry is idempotent" '.removed == true'
rpc "${MEMBER_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_PLANK}" 2 "${PLANK}" seconds)"
expect_error CONFLICT "editing a removed challenge"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${UPCOMING}")"
expect_json "a removed challenge leaves reads" --arg a "${CH_A}" '[.challenges[].challenge_id] == [$a]'
rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "$(new_uuid)" "${PLANK}" seconds)"
expect_ok "a removed challenge frees its exercise + metric"
rpc "${AUTHOR_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_A}" 3)"
expect_ok "the author removes their own challenge"
[[ "$(sql_value "select count(*) from app_public.group_events where kind = 'meet' and payload->'meet'->>'meet_id' = '${UPCOMING}' and payload->>'event' = 'challenge_changed';")" == 0 ]] ||
  fail "challenge changes before the cutoff must write no stream item"

# Two members add different challenges at once: both commit.
RACE_DIR="$(mktemp -d)"
CH_R1="$(new_uuid)"; CH_R2="$(new_uuid)"
(rpc "${MEMBER_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "${CH_R1}" "${BENCH}" e1rm)"; printf '%s' "${STATUS}") >"${RACE_DIR}/a" &
race_a=$!
(rpc "${AUTHOR_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "${CH_R2}" "${BENCH}" weight)"; printf '%s' "${STATUS}") >"${RACE_DIR}/b" &
race_b=$!
wait "${race_a}"; wait "${race_b}"
[[ "$(cat "${RACE_DIR}/a"):$(cat "${RACE_DIR}/b")" == "200:200" ]] || fail "concurrent different adds must both commit, got $(cat "${RACE_DIR}/a"):$(cat "${RACE_DIR}/b")"
[[ "$(sql_value "select count(*) from app_public.group_meet_challenges where id in ('${CH_R1}','${CH_R2}') and removed_at is null;")" == 2 ]] ||
  fail "both concurrent challenges must be stored"
pass "challenges: any member adds, author/admin edit and remove, others FORBIDDEN, metric per exercise, DUPLICATE, soft removal frees the pair, concurrent adds commit"

# Challenges stay editable after the meet; after the cutoff each change writes one item.
move_meet "${UPCOMING}" "-$((30 * HOUR))" "-$((28 * HOUR))"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${UPCOMING}")"
expect_json "past the cutoff a meet is final" '.meet.state == "final"'
CH_LATE="$(new_uuid)"
rpc "${MEMBER_TOKEN}" group_meet_challenge_add "$(b_ch_add "${GROUP}" "${UPCOMING}" "${CH_LATE}" "${BENCH}" volume)"
expect_ok "a challenge added after the cutoff"
rpc "${MEMBER_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_LATE}" 1 "${BENCH}" reps)"
expect_ok "a challenge edited after the cutoff"
rpc "${MEMBER_TOKEN}" group_meet_challenge_update "$(b_ch_edit "${GROUP}" "${UPCOMING}" "${CH_LATE}" 2 "${BENCH}" reps)"
expect_json "saving a challenge unchanged keeps its version" '.challenge.version == 2'
rpc "${MEMBER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_LATE}" 2)"
expect_ok "a challenge removed after the cutoff"
rpc "${MEMBER_TOKEN}" group_meet_challenge_remove "$(b_ch_remove "${GROUP}" "${UPCOMING}" "${CH_LATE}" 2)"
expect_ok "a remove retry after the cutoff"
CHANGES="$(sql_value "select string_agg(payload->>'change', ',' order by seq) from app_public.group_events
  where kind = 'meet' and payload->'meet'->>'meet_id' = '${UPCOMING}' and payload->>'event' = 'challenge_changed';")"
[[ "${CHANGES}" == "added,edited,removed" ]] || fail "after the cutoff each challenge change writes one item, got ${CHANGES}"
[[ "$(sql_value "select (payload->'previous'->>'metric' = 'volume' and payload->'challenge'->>'metric' = 'reps')::text
  from app_public.group_events where kind = 'meet' and payload->'meet'->>'meet_id' = '${UPCOMING}' and payload->>'change' = 'edited';")" == true ]] ||
  fail "an edited item must carry the previous definition"
pass "after the cutoff: challenges stay editable and each change writes exactly one stream item"

# --- roster ------------------------------------------------------------------------------

ROSTER="$(new_uuid)"
rpc "${OWNER_TOKEN}" group_meet_create "$(b_meet "${GROUP}" "${ROSTER}" "$((NOW + 5 * HOUR))" null "Roster Gym")"
expect_ok "a meet to join"
rpc "${MEMBER_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "a member joins"
expect_json "joined" '.joined == true'
rpc "${MEMBER_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "a join retry"
rpc "${AUTHOR_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "a second member joins"
rpc "${AUTHOR_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${ROSTER}")"
expect_json "roster lists both, viewer joined" --arg a "${MEMBER_UID}" --arg b "${AUTHOR_UID}" \
  '[.roster[].member.user_id] == [$a, $b] and .viewer.joined == true and .viewer.role == "member" and all(.roster[]; .current_member)'
rpc "${FORMER_TOKEN}" group_join "$(jq -nc --arg c "${CODE}" '{p_code:$c}')"
expect_ok "the former member rejoins the group"
rpc "${FORMER_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "and joins the meet"
rpc "${FORMER_TOKEN}" group_leave "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "then leaves the group again"
rpc "${OWNER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${ROSTER}")"
expect_json "a member who left the group stays on the roster, marked" --arg f "${FORMER_UID}" \
  '[.roster[] | select(.member.user_id == $f) | .current_member] == [false] and (.roster | length) == 3'
rpc "${AUTHOR_TOKEN}" group_meet_leave "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "a member leaves"
expect_json "left" '.joined == false'
rpc "${AUTHOR_TOKEN}" group_meet_leave "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "a leave retry"
move_meet "${ROSTER}" "-$((26 * HOUR))" "-$((23 * HOUR))"
rpc "${AUTHOR_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_ok "joining after the end, before the cutoff"
move_meet "${ROSTER}" "-$((27 * HOUR))" "-$((24 * HOUR + 1000))"
rpc "${OWNER_TOKEN}" group_meet_join "$(b_ref "${GROUP}" "${ROSTER}")"
expect_error CONFLICT "joining after the cutoff"
rpc "${MEMBER_TOKEN}" group_meet_leave "$(b_ref "${GROUP}" "${ROSTER}")"
expect_error CONFLICT "leaving after the cutoff"
[[ "$(sql_value "select string_agg(user_id::text, ',' order by joined_at) from app_public.group_meet_roster where meet_id = '${ROSTER}';")" == "${MEMBER_UID},${FORMER_UID},${AUTHOR_UID}" ]] ||
  fail "the roster must hold exactly the joined members"
pass "roster: members join and leave idempotently until the cutoff, refused after it"

# --- reads ---------------------------------------------------------------------------------

rpc "${MEMBER_TOKEN}" group_meet_list "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "a member lists meets"
expect_json "upcoming holds only scheduled/live, past the ended ones, cancelled in neither" \
  --arg past1 "${MEET}" --arg past2 "${UPCOMING}" --arg past3 "${ROSTER}" \
  '.upcoming == [] and ([.past[].meet_id] | sort) == ([$past1, $past2, $past3] | sort) and .next_cursor == null
   and ([.past[].starts_at_ms] == ([.past[].starts_at_ms] | sort | reverse))'
NEXT="$(new_uuid)"; LATER="$(new_uuid)"
rpc "${OWNER_TOKEN}" group_meet_create "$(b_meet "${GROUP}" "${LATER}" "$((NOW + 96 * HOUR))" null "Later Gym")"
expect_ok "a later meet"
rpc "${OWNER_TOKEN}" group_meet_create "$(b_meet "${GROUP}" "${NEXT}" "$((NOW + 10 * HOUR))" null "Next Gym")"
expect_ok "a next meet"
rpc "${MEMBER_TOKEN}" group_meet_list "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:2}')"
expect_json "upcoming soonest first; past paged" --arg n "${NEXT}" --arg l "${LATER}" \
  '[.upcoming[].meet_id] == [$n, $l] and (.past | length) == 2 and (.next_cursor | type) == "string"'
PAGE1="$(jq -c '[.past[].meet_id]' <<<"${BODY}")"
CURSOR="$(jq -r '.next_cursor' <<<"${BODY}")"
rpc "${MEMBER_TOKEN}" group_meet_list "$(jq -nc --arg g "${GROUP}" --arg c "${CURSOR}" '{p_group_id:$g, p_before:$c, p_limit:2}')"
expect_json "second page: no upcoming, the remaining past meet" --argjson p "${PAGE1}" \
  '.upcoming == [] and (.past | length) == 1 and (.past[0].meet_id as $id | $p | index($id) | not) and .next_cursor == null'
for bad in '"bad"' '"{}"' "$(jq -c --arg c "$(jq -c '{group_id, meet_id, other: 1}' <<<"${CURSOR}")" -n '$c')" "$(jq -c --arg c "$(jq -c --arg g "${MISSING_GROUP}" '.group_id = $g' <<<"${CURSOR}")" -n '$c')"; do
  rpc "${MEMBER_TOKEN}" group_meet_list "$(jq -nc --arg g "${GROUP}" --argjson c "${bad}" '{p_group_id:$g, p_before:$c}')"
  expect_error VALIDATION "a malformed or foreign cursor ${bad}"
done
rpc "${MEMBER_TOKEN}" group_meet_list "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:51}')"
expect_error VALIDATION "page size"
rpc "${MEMBER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "${CANCELLED}")"
expect_json "a member reads a cancelled meet by id with every field" '.meet.state == "cancelled" and .meet.venue_name == "Cancel Gym"'
rpc "${MEMBER_TOKEN}" group_meet_get "$(b_ref "${GROUP}" "$(new_uuid)")"
expect_error NOT_FOUND "a meet that does not exist"
pass "reads: upcoming and past lists, keyset pages, cursor validation, cancelled meets by id only"

# --- stream ----------------------------------------------------------------------------------

[[ "$(sql_value "select count(*) from app_public.group_events where kind = 'meet' and group_id = '${GROUP}'
  and (payload ?| array['score','scores','value','values','result','results','sets'] or payload::text ~ '\"(score|value|sets)\"'
       or exists (select 1 from jsonb_object_keys(payload) k where k not in ('event','meet','change','challenge','previous'))
       or (select array_agg(k order by k) from jsonb_object_keys(payload->'meet') k)
            <> array['ends_at_ms','meet_id','starts_at_ms','title','venue_name','version']);")" == 0 ]] ||
  fail "meet stream payloads must hold definition snapshots only"
[[ "$(sql_value "select count(*) from app_public.group_events where kind = 'meet' and group_id = '${GROUP}' and payload->>'event' = 'scheduled';")" == 6 ]] ||
  fail "every scheduled meet writes one scheduled item"
run_psql "begin;
  select app_public.group_meet_stream_write(m, 'scheduled', clock_timestamp(), null) from app_public.group_meets m where id = '${MEET}';
  commit;" >/dev/null
[[ "$(meet_events "${MEET}" scheduled)" == 1 ]] || fail "a transition item is written at most once"
rpc "${MEMBER_TOKEN}" group_competition_stream_v7 "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:50}')"
expect_ok "v7 stream"
expect_json "v7 lists every meet item with the item shape" \
  '([.items[] | select(.kind == "meet")] | length) == 10
   and all(.items[] | select(.kind == "meet"); (keys | sort) == (["kind","key","sort_at_ms","event","meet","change","challenge","previous","actor"] | sort))
   and ([.items[] | select(.kind == "meet" and .event == "cancelled")] | length) == 1'
expect_json "a cancelled item names its actor" --arg u "${ADMIN_UID}" \
  '[.items[] | select(.kind == "meet" and .event == "cancelled")][0].actor.user_id == $u'
rpc "${MEMBER_TOKEN}" group_competition_stream_v7 "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:3}')"
V7_ALL="[]"
while :; do
  V7_ALL="$(jq -c --argjson acc "${V7_ALL}" '$acc + [.items[].key]' <<<"${BODY}")"
  [[ "$(jq -r '.has_more' <<<"${BODY}")" == true ]] || break
  rpc "${MEMBER_TOKEN}" group_competition_stream_v7 "$(jq -nc --arg g "${GROUP}" --arg c "$(jq -r '.next_cursor' <<<"${BODY}")" '{p_group_id:$g, p_before:$c, p_limit:3}')"
  expect_ok "v7 page"
done
[[ "$(jq 'length == (unique | length)' <<<"${V7_ALL}")" == true ]] || fail "v7 pages repeat an item"
rpc "${MEMBER_TOKEN}" group_competition_stream_v7 "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:50}')"
[[ "$(jq -c '[.items[].key]' <<<"${BODY}")" == "${V7_ALL}" ]] || fail "walking v7 in pages of 3 must give the same items as one page"
rpc "${MEMBER_TOKEN}" group_competition_stream_v6 "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_limit:50}')"
expect_ok "v6 stream"
expect_json "v6 lists no meet items" '[.items[] | select(.kind == "meet")] == []'
rpc "${STRANGER_TOKEN}" group_competition_stream_v7 "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_error NOT_FOUND "a stranger's v7 stream"
pass "stream: snapshot-only payloads, once per transition, v7 pages list meet items, v6 unchanged"

COMPLETED=1
echo "[${LANE_LABEL}] PASS (run ${RUN_TAG})"
