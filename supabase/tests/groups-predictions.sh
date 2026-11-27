#!/usr/bin/env bash

# groups-predictions.sh — the group Predictions setting and the agent offer
# writes (a body of the groups-contract lane).
#
# Contract: docs/specs/tech/group-predictions-contract.md ("Access",
# "Bettors", "Week and timing", "Markets", "Offers, matching and counters").
# Proves, against the real local stack:
#
#   - posture: RLS on, no policies, no grants to any API role, no
#     owner_user_id, no FK into Sync v2 tables; the setting RPCs are SECURITY
#     DEFINER, pinned and anon+authenticated only; the agent RPCs service_role
#     only; helpers executable by no API role; direct table access denied;
#   - setting: off by default; any member reads; owner/admin set, member
#     FORBIDDEN; AUTH_REQUIRED, AGENT_FORBIDDEN, UPDATE_REQUIRED; a stranger
#     and a former member get NOT_FOUND, byte-identical to a missing group;
#   - agent RPCs: app and OAuth tokens cannot execute them; setting off,
#     non-member, former member and missing group are one NOT_FOUND; a group
#     without a zone is VALIDATION; this week CONFLICT, a later week
#     VALIDATION; posting and withdrawing at the board's start (moved clock)
#     CONFLICT;
#   - markets: every template's keys, bounds and steps; Hold refused for
#     e1RM; metric per exercise for lead_change; archived exercise and
#     non-current member refused; a market is created once;
#   - offers: field checks; a bettor is one (user, client) across posts; the
#     display name is username + client name;
#   - matching: crossing at the resting price; best price then oldest;
#     partial fills rest; no self-match; two AIs of one user match; the
#     rounding rule at odd prices and cent stakes, a dust fill refused, and
#     points conserved by every match;
#   - counters: inside the walk-away price → an immediate match at the
#     counter's price; outside → rests; a plain offer never uses a walk-away
#     price; one counter per AI per offer; own/same-side/other-market
#     counters refused;
#   - stake: open + matched capped at 100.00 per AI, group and week; withdraw
#     frees only the unmatched remainder; another AI's offer is NOT_FOUND;
#   - concurrency: two simultaneous crossing posts never over-fill, and one
#     AI's two simultaneous posts never pass the stake cap;
#   - an offer of a member who has left never fills; a client name is
#     stripped of control characters and cut to 60.
#
# Hermetic: per-run users and OAuth clients, deleted on exit with everything
# they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-predictions"
FIXTURE_EMAIL_PREFIX="groups-predictions"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done
load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET/SERVICE_ROLE_KEY)"
DB_CONTAINER="$(resolve_db_container)" || exit 1
psql_session_start

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsPredictions!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
RUN_CLIENT_IDS=()
RACE_DIR=""

cleanup() {
  [[ -z "${RACE_DIR}" ]] || rm -rf "${RACE_DIR}"
  local ids clients="''"
  if [[ ${#RUN_CLIENT_IDS[@]} -gt 0 ]]; then
    clients="$(printf "'%s'," "${RUN_CLIENT_IDS[@]}")"; clients="${clients%,}"
  fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and user_id in (${ids});
    delete from app_public.group_eval_queue where member_user_id in (${ids});
    delete from app_public.groups where created_by in (${ids})
      or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
    delete from auth.users where id in (${ids});
    delete from auth.oauth_clients where id::text in (${clients});
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

sql_value() { run_psql "$1"; }
new_uuid() { run_psql "select gen_random_uuid();"; }
expect_sql() { [[ "$(sql_value "$2")" == "$3" ]] || fail "$1: expected '$3', got '$(sql_value "$2")'"; }
# expect_sql_error <TOKEN> <context> <sql>: the statement fails with TOKEN.
expect_sql_error() {
  local out
  if out="$(run_psql "$3" 2>&1)"; then fail "$2: expected $1, the statement succeeded"; fi
  grep -q "ERROR:  $1:" <<<"${out}" || fail "$2: expected $1, got: ${out}"
}

# The current app's group calls: protocol 4 and Hold support (the group has a
# Hold comparison, which refuses clients without it).
rpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H "${GROUP_CONTRACT_HEADER}" \
    -H 'x-boga-group-seconds: 1' -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
# srpc <function> <json-body>: the agent API's service-role call.
srpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$2" "${API_URL}/rest/v1/rpc/$1"
}

# Bettors: <NAME>_UID and <NAME>_CLIENT. add_bettor <name> <uid> [client name]
# registers an OAuth client (named, when given) for the run.
add_bettor() {
  local client
  client="$(new_uuid)"
  RUN_CLIENT_IDS+=("${client}")
  run_psql "insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method, client_name)
    values ('${client}', 'dynamic', 'https://example.invalid/callback', 'authorization_code,refresh_token', 'none',
      $( [[ -n "${3:-}" ]] && printf "'%s'" "$3" || printf 'null'));" >/dev/null
  printf -v "$1_UID" '%s' "$2"
  printf -v "$1_CLIENT" '%s' "${client}"
}

# post <bettor> <template> <parameters-json> <side> <price> <stake> [extra-json]
# posts on GROUP's open board; extra keys override the body.
post() {
  local uid_var="$1_UID" client_var="$1_CLIENT" extra="${7:-}"
  [[ -n "${extra}" ]] || extra='{}'
  srpc agent_group_prediction_post "$(jq -nc --arg o "${!uid_var}" --arg c "${!client_var}" --arg g "${GROUP}" \
    --arg wk "${OPEN_WEEK}" --arg t "$2" --argjson p "$3" --arg s "$4" --argjson pr "$5" --argjson st "$6" \
    --argjson x "${extra}" \
    '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_week_start:$wk, p_template:$t, p_parameters:$p,
      p_side:$s, p_price:$pr, p_stake:$st} + $x')"
}
# post_ok <context> <post args...>: posts, expects 200, sets OFFER.
post_ok() {
  local context="$1"
  shift
  post "$@"
  expect_ok "${context}"
  OFFER="$(jq -r '.offer.offer_id' <<<"${BODY}")"
}
# counter <bettor> <answered-offer> <price> <stake> [extra-json]
counter() {
  local extra="${5:-}"
  [[ -n "${extra}" ]] || extra='{}'
  post "$1" "" null "" "$3" "$4" "$(jq -nc --arg a "$2" --argjson x "${extra}" \
    '{p_template:null, p_parameters:null, p_side:null, p_answers_offer_id:$a} + $x')"
}
withdraw() {
  local uid_var="$1_UID" client_var="$1_CLIENT"
  srpc agent_group_prediction_withdraw "$(jq -nc --arg o "${!uid_var}" --arg c "${!client_var}" --arg g "${GROUP}" \
    --arg x "$2" '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_offer_id:$x}')"
}
records() { printf '{"line":%s}' "$1"; }
offer_field() { sql_value "select $2 from app_public.group_prediction_offers where id = '$1';"; }
settings_body() { jq -nc --arg g "$1" '{p_group_id:$g}'; }
set_body() { jq -nc --arg g "$1" --argjson e "$2" '{p_group_id:$g, p_enabled:$e}'; }

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning owner, admin, two members, a former member and a stranger"
provision OWNER owner
provision ADMIN admin
provision ALEX alex
provision BLAIR blair
provision FORMER former
provision STRANGER stranger
provision LEAVER leaver
for who in OWNER ADMIN ALEX BLAIR FORMER STRANGER LEAVER; do
  uid_var="${who}_UID"
  set_username "${!uid_var}" "pred-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
MISSING_GROUP="$(new_uuid)"

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Predictions ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"UTC"}')"
expect_ok "owner creates the group"
GROUP="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(settings_body "${GROUP}")"
CODE="$(jq -r '.code' <<<"${BODY}")"
for who in ADMIN ALEX BLAIR FORMER LEAVER; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${CODE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
rpc "${OWNER_TOKEN}" group_set_role "$(jq -nc --arg g "${GROUP}" --arg u "${ADMIN_UID}" '{p_group_id:$g, p_user_id:$u, p_role:"admin"}')"
expect_ok "admin role"
exercise() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" --arg n "$1" --arg m "$2" \
    '{p_group_id:$g, p_name:$n, p_load_input_mode:"total_load", p_source_exercise_id:null,
      p_bodyweight_contribution:0, p_default_metric:$m}')"
  expect_ok "exercise $1"
  jq -r '.exercise.group_exercise_id' <<<"${BODY}"
}
BENCH="$(exercise "Prediction Bench" e1rm)"
PLANK="$(exercise "Prediction Plank" seconds)"
ARCHIVED="$(exercise "Prediction Row" e1rm)"
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GROUP}" --arg e "${ARCHIVED}" \
  '{p_group_id:$g, p_exercise_id:$e, p_archived:true}')"
expect_ok "archive the row exercise"
rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "No zone ${RUN_TAG}" '{p_name:$n, p_description:null}')"
expect_ok "a group without a zone"
NOZONE="$(jq -r '.group_id' <<<"${BODY}")"
OPEN_WEEK="$(sql_value "select (app_public.group_cow_week('UTC', clock_timestamp()) + 7)::text;")"
THIS_WEEK="$(sql_value "select app_public.group_cow_week('UTC', clock_timestamp())::text;")"
LATER_WEEK="$(sql_value "select (app_public.group_cow_week('UTC', clock_timestamp()) + 14)::text;")"

add_bettor A1 "${ALEX_UID}" "Claude"
add_bettor A2 "${ALEX_UID}" "Codex"
add_bettor B "${BLAIR_UID}" "Claude"
add_bettor O "${OWNER_UID}"
add_bettor D "${ADMIN_UID}"
add_bettor V "${OWNER_UID}"
add_bettor E "${BLAIR_UID}"
add_bettor F "${OWNER_UID}"
add_bettor G1 "${BLAIR_UID}"
add_bettor G2 "${ADMIN_UID}"
add_bettor X "${FORMER_UID}"
add_bettor S "${STRANGER_UID}"
add_bettor L "${LEAVER_UID}" "Claude"
add_bettor H "${OWNER_UID}"
add_bettor N "${ALEX_UID}"
run_psql "update auth.oauth_clients set client_name = 'Evil' || chr(10) || repeat('x', 80) where id = '${N_CLIENT}';" >/dev/null
rpc "${FORMER_TOKEN}" group_leave "$(settings_body "${GROUP}")"
expect_ok "former member leaves"

# --- posture -----------------------------------------------------------------------

TABLES="'group_prediction_settings','group_prediction_bettors','group_prediction_boards','group_prediction_markets','group_prediction_offers','group_prediction_matches'"
SYNC_TABLES="'gyms','exercise_definitions','muscle_groups','exercise_tag_definitions','sessions','exercise_muscle_mappings','session_exercises','exercise_sets','session_exercise_tags','exercise_group_links','session_meet_links'"
expect_sql "RLS on every prediction table" "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app_public' and c.relname in (${TABLES}) and c.relkind = 'r' and c.relrowsecurity;" 6
expect_sql "no policies" "select count(*) from pg_policies where schemaname = 'app_public' and tablename in (${TABLES});" 0
expect_sql "no API role holds a table privilege" "select count(*) from unnest(array['anon','authenticated','service_role']) r(role)
  cross join unnest(array[${TABLES}]) t(name)
  where has_table_privilege(r.role, 'app_public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');" 0
expect_sql "no table enters sync scope" "select count(*) from information_schema.columns where table_schema = 'app_public'
  and table_name in (${TABLES}) and column_name = 'owner_user_id';" 0
expect_sql "no FK into a Sync v2 table" "select count(*) from pg_constraint con join pg_class c on c.oid = con.conrelid
  join pg_class r on r.oid = con.confrelid join pg_namespace n on n.oid = r.relnamespace
  where con.contype = 'f' and c.relname in (${TABLES}) and n.nspname = 'app_public' and r.relname in (${SYNC_TABLES});" 0
PRED_FUNCS="n.nspname = 'app_public' and (p.proname like 'group\_prediction\_%' or p.proname like 'agent\_group\_prediction\_%')"
expect_sql "setting RPCs: definer, pinned, anon+authenticated only" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ${PRED_FUNCS} and p.proname in ('group_prediction_settings_get','group_prediction_settings_set') and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig)
    and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not has_function_privilege('service_role', p.oid, 'EXECUTE');" 2
expect_sql "agent RPCs: definer, pinned, service_role only" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ${PRED_FUNCS} and p.proname in ('agent_group_prediction_post','agent_group_prediction_withdraw') and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE');" 2
expect_sql "helpers: no API role executes them, all pinned, none definer" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) r(role)
  where ${PRED_FUNCS} and p.proname not in ('group_prediction_settings_get','group_prediction_settings_set',
      'agent_group_prediction_post','agent_group_prediction_withdraw')
    and (has_function_privilege(r.role, p.oid, 'EXECUTE') or p.prosecdef
      or not 'search_path=app_public, pg_temp' = any(p.proconfig));" 0
for name in group_prediction_settings group_prediction_bettors group_prediction_boards group_prediction_markets \
    group_prediction_offers group_prediction_matches; do
  for bearer in "${OWNER_TOKEN}" "${SERVICE_ROLE_KEY}"; do
    rest GET "${bearer}" "${name}" 'select=*'; [[ "${STATUS}" != 200 ]] || fail "direct select ${name}"
    rest POST "${bearer}" "${name}" '' '{}'; [[ "${STATUS}" != 201 ]] || fail "direct insert ${name}"
  done
done
pass "posture: RLS on, no policies or grants, no owner column or Sync v2 FK, RPC/helper privileges, direct access denied"

# --- the setting -------------------------------------------------------------------

rpc "${ALEX_TOKEN}" group_prediction_settings_get "$(settings_body "${GROUP}")"
expect_ok "member reads the setting"
check "off by default" '. == {group_id: $g, enabled: false}' --arg g "${GROUP}"
rpc "${ALEX_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_error FORBIDDEN "a plain member cannot change the setting"
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" null)"
expect_error VALIDATION "the setting needs on or off"
rpc "${ADMIN_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_ok "admin turns predictions on"
check "admin set on" '.enabled == true'
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_ok "owner sets it again (no change)"
rpc "${BLAIR_TOKEN}" group_prediction_settings_get "$(settings_body "${GROUP}")"
check "members read on" '.enabled == true'
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${NOZONE}" true)"
expect_ok "owner turns on the zoneless group"
for fn in group_prediction_settings_get group_prediction_settings_set; do
  body="$( [[ "${fn}" == *_get ]] && settings_body "${MISSING_GROUP}" || set_body "${MISSING_GROUP}" true)"
  rpc "${OWNER_TOKEN}" "${fn}" "${body}"
  expect_error NOT_FOUND "${fn}: missing group"
  missing="${BODY}"
  for who in STRANGER FORMER; do
    token_var="${who}_TOKEN"
    body="$( [[ "${fn}" == *_get ]] && settings_body "${GROUP}" || set_body "${GROUP}" true)"
    rpc "${!token_var}" "${fn}" "${body}"
    expect_error NOT_FOUND "${fn}: ${who}"
    [[ "${BODY}" == "${missing}" ]] || fail "${fn}: ${who} must be byte-identical to a missing group"
  done
  rpc "${ANON_KEY}" "${fn}" "${body}"
  expect_error AUTH_REQUIRED "${fn}: anon"
  rpc "$(mint_token "${OWNER_TOKEN}" "${A1_CLIENT}")" "${fn}" "${body}"
  expect_error AGENT_FORBIDDEN "${fn}: OAuth token"
  GROUP_CONTRACT_HEADER="x-boga-group-contract: 3" rpc "${OWNER_TOKEN}" "${fn}" "${body}"
  expect_error UPDATE_REQUIRED "${fn}: an old contract"
done
pass "setting: off by default, members read, owner/admin set, member FORBIDDEN, AUTH_REQUIRED/AGENT_FORBIDDEN/UPDATE_REQUIRED, NOT_FOUND identical"

# --- agent access --------------------------------------------------------------------

for bearer in "${ALEX_TOKEN}" "$(mint_token "${ALEX_TOKEN}" "${A1_CLIENT}")" "${ANON_KEY}"; do
  rpc "${bearer}" agent_group_prediction_post "$(jq -nc --arg o "${ALEX_UID}" --arg c "${A1_CLIENT}" --arg g "${GROUP}" \
    --arg w "${OPEN_WEEK}" '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_week_start:$w}')"
  [[ "${STATUS}" == 401 || "${STATUS}" == 403 ]] && [[ "$(jq -r '.code' <<<"${BODY}")" == 42501 ]] ||
    fail "a client token must not execute agent_group_prediction_post"
  rpc "${bearer}" agent_group_prediction_withdraw "$(jq -nc --arg o "${ALEX_UID}" --arg c "${A1_CLIENT}" --arg g "${GROUP}" \
    --arg x "${MISSING_GROUP}" '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_offer_id:$x}')"
  [[ "$(jq -r '.code' <<<"${BODY}")" == 42501 ]] || fail "a client token must not execute agent_group_prediction_withdraw"
done
GROUP_SAVED="${GROUP}"
GROUP="${MISSING_GROUP}"; post A1 records_line "$(records 3)" yes 50 1
expect_error NOT_FOUND "missing group"
missing="${BODY}"
GROUP="${GROUP_SAVED}"
for who in S X; do
  post "${who}" records_line "$(records 3)" yes 50 1
  expect_error NOT_FOUND "agent of a non-member (${who})"
  [[ "${BODY}" == "${missing}" ]] || fail "${who}: must be byte-identical to a missing group"
done
withdraw S "${MISSING_GROUP}"
[[ "${BODY}" == "${missing}" ]] || fail "withdraw by a non-member must be the same NOT_FOUND"
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" false)"
expect_ok "owner turns predictions off"
post A1 records_line "$(records 3)" yes 50 1
expect_error NOT_FOUND "setting off"
[[ "${BODY}" == "${missing}" ]] || fail "setting off must be byte-identical to a missing group"
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_ok "owner turns predictions back on"
GROUP="${NOZONE}"; post O records_line "$(records 3)" yes 50 1
expect_error VALIDATION "a group without a zone has no board"
GROUP="${GROUP_SAVED}"
post A1 records_line "$(records 3)" yes 50 1 "$(jq -nc --arg w "${THIS_WEEK}" '{p_week_start:$w}')"
expect_error CONFLICT "this week's board has closed"
post A1 records_line "$(records 3)" yes 50 1 "$(jq -nc --arg w "${LATER_WEEK}" '{p_week_start:$w}')"
expect_error VALIDATION "only next week's board is open"
post A1 records_line "$(records 3)" yes 50 1 '{"p_week_start":null}'
expect_error VALIDATION "a week is required"
expect_sql "nothing was stored by refused posts" "select count(*) from app_public.group_prediction_boards where group_id = '${GROUP}';" 0
pass "agent access: client tokens cannot execute; off/non-member/former/missing one NOT_FOUND; no zone VALIDATION; week checks"

# --- markets -------------------------------------------------------------------------

e1rm() { jq -nc --arg m "$1" --arg e "$2" --argjson l "$3" '{member_user_id:$m, group_exercise_id:$e, line:$l}'; }
sets() { jq -nc --arg m "$1" --argjson l "$2" '{member_user_id:$m, line:$l}'; }
cowtop() { jq -nc --arg m "$1" --arg x "$2" '{member_user_id:$m, metric:$x}'; }
lead() { jq -nc --arg e "$1" --arg x "$2" '{group_exercise_id:$e, metric:$x}'; }
refuse() { post V "$1" "$2" yes 50 0.01; expect_error VALIDATION "$3"; }
accept() { post V "$1" "$2" yes 50 0.01; expect_ok "$3"; }
for line in 77.5 81 82.45 122.5 '"100"'; do refuse e1rm_line "$(e1rm "${ALEX_UID}" "${BENCH}" "${line}")" "e1RM line ${line}"; done
for line in 80 82.5 120; do accept e1rm_line "$(e1rm "${ALEX_UID}" "${BENCH}" "${line}")" "e1RM line ${line}"; done
refuse e1rm_line "$(e1rm "${ALEX_UID}" "${PLANK}" 100)" "a Hold exercise has no e1RM line"
refuse e1rm_line "$(e1rm "${ALEX_UID}" "${ARCHIVED}" 100)" "an archived exercise"
refuse e1rm_line "$(e1rm "${FORMER_UID}" "${BENCH}" 100)" "a former member as the subject"
refuse e1rm_line "$(e1rm "${STRANGER_UID}" "${BENCH}" 100)" "a stranger as the subject"
refuse e1rm_line "$(e1rm not-a-uuid "${BENCH}" 100)" "a malformed id"
for line in 0 3 205 7.5; do refuse sets_line "$(sets "${BLAIR_UID}" "${line}")" "sets line ${line}"; done
for line in 5 200; do accept sets_line "$(sets "${BLAIR_UID}" "${line}")" "sets line ${line}"; done
for line in 0 51 1.5; do refuse records_line "$(records "${line}")" "records line ${line}"; done
for line in 1 50; do accept records_line "$(records "${line}")" "records line ${line}"; done
refuse cow_top "$(cowtop "${ALEX_UID}" weight)" "a CoW metric outside e1rm/volume/improvement"
for metric in e1rm volume improvement; do accept cow_top "$(cowtop "${ALEX_UID}" "${metric}")" "cow_top ${metric}"; done
refuse lead_change "$(lead "${BENCH}" seconds)" "seconds on a repetition exercise"
refuse lead_change "$(lead "${PLANK}" e1rm)" "e1rm on a Hold exercise"
refuse lead_change "$(lead "${BENCH}" weight)" "a metric boards do not rank"
accept lead_change "$(lead "${PLANK}" seconds)" "lead_change seconds on a Hold exercise"
accept lead_change "$(lead "${BENCH}" volume)" "lead_change volume"
refuse records_line '{"line":3,"member_user_id":null}' "an extra key"
refuse sets_line "$(records 10)" "a missing key"
refuse e1rm_line "$(jq -nc --arg m "${ALEX_UID}" '{member_user_id:$m, group_exercise_id:null, line:100}')" "a null parameter"
refuse cow_top '{"member_user_id":"x","metric":3}' "a non-string metric"
refuse coin_flip "$(records 3)" "an unknown template"
refuse records_line '[3]' "parameters that are not an object"
accept e1rm_line "$(e1rm "${ALEX_UID}" "${BENCH}" 100.0)" "e1RM line 100.0"
MARKET_100="$(jq -r '.market.market_id' <<<"${BODY}")"
check "a line reads back without trailing zeros" '.market.parameters.line == 100'
accept e1rm_line "$(e1rm "${ALEX_UID}" "${BENCH}" 100)" "the same e1RM market again"
check "one market per template and parameters" '.market.market_id == $m' --arg m "${MARKET_100}"
expect_sql "one board per group and week" "select count(*) from app_public.group_prediction_boards where group_id = '${GROUP}';" 1
expect_sql "the board froze the zone and bounds" "select time_zone = 'UTC' and starts_at = lower(app_public.group_cow_bounds('UTC', '${OPEN_WEEK}'))
  and ends_at = upper(app_public.group_cow_bounds('UTC', '${OPEN_WEEK}')) from app_public.group_prediction_boards where group_id = '${GROUP}';" t
pass "markets: template keys, bounds and steps, Hold and metric rules, live exercise, current member, one market per key"

# --- offer fields ------------------------------------------------------------------------

for bad in '0' '100'; do post V records_line "$(records 2)" yes "${bad}" 1; expect_error VALIDATION "price ${bad}"; done
for bad in '0' '100.01' '1.234' '-1'; do post V records_line "$(records 2)" yes 50 "${bad}"; expect_error VALIDATION "stake ${bad}"; done
post V records_line "$(records 2)" maybe 50 1; expect_error VALIDATION "side maybe"
post V records_line "$(records 2)" yes 50 1 '{"p_walk_away_price":49}'; expect_error VALIDATION "a yes walk-away below the price"
post V records_line "$(records 2)" no 50 1 '{"p_walk_away_price":51}'; expect_error VALIDATION "a no walk-away above the price"
post V records_line "$(records 2)" yes 50 1 '{"p_walk_away_price":100}'; expect_error VALIDATION "a walk-away of 100"
post V records_line "$(records 2)" yes 50 1 "$(jq -nc --arg n "$(printf 'n%.0s' $(seq 1 141))" '{p_note:$n}')"
expect_error VALIDATION "a 141-character note"
post_ok "a 140-character note, trimmed" V records_line "$(records 2)" yes 50 0.01 \
  "$(jq -nc --arg n "  $(printf 'n%.0s' $(seq 1 140))  " '{p_note:$n}')"
check "no note in an agent response" '[.. | objects | has("note")] | any | not'
expect_sql "the note is stored trimmed" "select char_length(note) from app_public.group_prediction_offers where id = '${OFFER}';" 140
expect_sql "one bettor per user and client across posts" "select count(*) from app_public.group_prediction_bettors
  where user_id = '${OWNER_UID}' and client_id = '${V_CLIENT}';" 1
pass "offer fields: price, stake, side, walk-away, note bounds; notes never returned; one bettor per (user, client)"

# --- matching ---------------------------------------------------------------------------

BOOK1="$(records 3)"
post_ok "A1 rests a yes" A1 records_line "${BOOK1}" yes 40 10
A1_YES="${OFFER}"
check "a lone offer rests" '.matches == [] and .offer.state == "open" and .offer.remaining == 10'
post_ok "A1 rests a crossing no of its own" A1 records_line "${BOOK1}" no 30 1
check "an AI never matches itself" '.matches == []'
post_ok "B takes part of A1's yes" B records_line "${BOOK1}" no 35 6
check "crosses at the resting price, the remainder of A1 rests" \
  '.matches | length == 1 and .[0].price == 40 and .[0].yes_stake == 4 and .[0].no_stake == 6 and .[0].via == "cross"
   and .[0].yes_offer_id == $y and .[0].side == "no"' --arg y "${A1_YES}"
check "the counterparty is named username · client" '.matches[0].counterparty.display_name == $n and .matches[0].counterparty.client_name == "Claude"' \
  --arg n "pred-alex-${RUN_TAG} · Claude"
check "B is filled" '.offer.state == "filled" and .offer.matched == 6 and .offer.remaining == 0'
expect_sql "A1's yes keeps 6.00 resting" "select remaining_cents from app_public.group_prediction_offers where id = '${A1_YES}';" 600
post_ok "A2, the same user's other AI, takes A1's yes" A2 records_line "${BOOK1}" no 40 1.5
check "two AIs of one user match" '.matches | length == 1 and .[0].yes_offer_id == $y and .[0].no_stake == 1.5 and .[0].yes_stake == 1' \
  --arg y "${A1_YES}"

BOOK2="$(records 4)"
post_ok "A1 yes @50" A1 records_line "${BOOK2}" yes 50 1; Y50="${OFFER}"
post_ok "A1 yes @60 (older)" A1 records_line "${BOOK2}" yes 60 1; Y60_OLD="${OFFER}"
post_ok "A2 yes @60 (newer)" A2 records_line "${BOOK2}" yes 60 1; Y60_NEW="${OFFER}"
post_ok "O yes @45, below the sweep" O records_line "${BOOK2}" yes 45 1
post_ok "B sweeps with a no @50" B records_line "${BOOK2}" no 50 10
check "best price then oldest, each at its resting price" \
  '[.matches[] | [.yes_offer_id, .price]] == [[$a, 60], [$b, 60], [$c, 50]]' \
  --arg a "${Y60_OLD}" --arg b "${Y60_NEW}" --arg c "${Y50}"
check "B's remainder rests" '.offer.state == "open" and .offer.matched > 0 and .offer.remaining > 0'

BOOK3="$(records 7)"
post_ok "B rests a no @37" B records_line "${BOOK3}" no 37 1; B37="${OFFER}"
post_ok "A1 takes it with 0.50 at 37" A1 records_line "${BOOK3}" yes 37 0.5
check "odd price: no = yes × 63 / 37 rounded half up" '.matches[0].yes_stake == 0.5 and .matches[0].no_stake == 0.85'
post_ok "A2 takes the 0.15 left at 37" A2 records_line "${BOOK3}" yes 40 1
check "the no side's last cents: yes 0.09 against no 0.15" '.matches[0].yes_stake == 0.09 and .matches[0].no_stake == 0.15'
expect_sql "B's no @37 is filled" "select remaining_cents from app_public.group_prediction_offers where id = '${B37}';" 0
post_ok "B rests a no @99 of one cent" B records_line "$(records 9)" no 99 0.01
post_ok "A1 takes it with 1.00" A1 records_line "$(records 9)" yes 99 1
check "a one-cent no side matches 1.00 of yes at 99" '.matches[0].yes_stake == 1 and .matches[0].no_stake == 0.01 and .offer.remaining == 0'
post_ok "B rests a yes @1 of one cent" B records_line "$(records 10)" yes 1 0.01
post_ok "A1's 0.50 no cannot cover it" A1 records_line "$(records 10)" no 1 0.5
check "a fill that would stake nothing on one side is not made" '.matches == [] and .offer.remaining == 0.5'
expect_sql "every match obeys the rounding rule" "select count(*) from app_public.group_prediction_matches t
  join app_public.group_prediction_markets m on m.id = t.market_id where m.group_id = '${GROUP}'
    and t.no_stake_cents <> (2 * t.yes_stake_cents * (100 - t.price) + t.price) / (2 * t.price);" 0
expect_sql "points are conserved: matched offer stakes equal match stakes" "select
  (select sum(o.stake_cents - o.remaining_cents - o.released_cents) from app_public.group_prediction_offers o
     join app_public.group_prediction_markets m on m.id = o.market_id where m.group_id = '${GROUP}')
  = (select sum(t.yes_stake_cents + t.no_stake_cents) from app_public.group_prediction_matches t
     join app_public.group_prediction_markets m on m.id = t.market_id where m.group_id = '${GROUP}');" t
expect_sql "each offer's matched stake is the sum of its fills" "select count(*) from app_public.group_prediction_offers o
  join app_public.group_prediction_markets m on m.id = o.market_id where m.group_id = '${GROUP}'
    and o.stake_cents - o.remaining_cents - o.released_cents <> coalesce((select sum(case when t.yes_offer_id = o.id
      then t.yes_stake_cents else t.no_stake_cents end) from app_public.group_prediction_matches t
      where o.id in (t.yes_offer_id, t.no_offer_id)), 0);" 0
pass "matching: resting price, best then oldest, partial fills, no self-match, same-user AIs match, rounding, conservation"

# --- counters -----------------------------------------------------------------------------

BOOK4="$(records 5)"
post_ok "A1 yes @40 with walk-away 55" A1 records_line "${BOOK4}" yes 40 4 '{"p_walk_away_price":55}'; A1_W="${OFFER}"
counter B "${A1_W}" 50 6
expect_ok "B counters no @50"
check "inside the walk-away: an immediate match at the counter's price" \
  '.matches | length == 1 and .[0].via == "counter" and .[0].price == 50 and .[0].yes_stake == 4 and .[0].no_stake == 4'
check "the counter's remainder rests open to all" '.offer.answers_offer_id == $a and .offer.side == "no" and .offer.remaining == 2' \
  --arg a "${A1_W}"
check "the walk-away is never shown to the counterparty" '[.. | objects | select(has("walk_away_price")) | .offer_id] == [.offer.offer_id]'
counter B "${A1_W}" 52 1
expect_error DUPLICATE "a second counter on the same offer"
counter A1 "${A1_W}" 50 1
expect_error VALIDATION "a counter on one's own offer"
counter E "${A1_W}" 50 1 '{"p_side":"yes"}'
expect_error VALIDATION "a counter on the same side"
counter E "${A1_W}" 50 1 "$(jq -nc --argjson p "$(records 6)" '{p_template:"records_line", p_parameters:$p}')"
expect_error VALIDATION "a counter naming another market"
counter E "${MISSING_GROUP}" 50 1
expect_error NOT_FOUND "a counter on an unknown offer"
counter E "${A1_W}" 50 0.5 "$(jq -nc --argjson p "${BOOK4}" '{p_template:"records_line", p_parameters:$p, p_side:"no"}')"
expect_ok "a counter may repeat its market and side"
check "a filled answered offer leaves the counter resting" '.matches == []'

BOOK5="$(records 6)"
post_ok "A2 yes @40 with walk-away 45" A2 records_line "${BOOK5}" yes 40 1 '{"p_walk_away_price":45}'; A2_W="${OFFER}"
counter E "${A2_W}" 50 1
expect_ok "E counters no @50, outside the walk-away"
check "outside the walk-away the counter rests" '.matches == [] and .offer.state == "open"'
post_ok "O yes @30 with walk-away 60" O records_line "$(records 8)" yes 30 1 '{"p_walk_away_price":60}'
post_ok "E posts a plain no @50, inside that walk-away" E records_line "$(records 8)" no 50 1
check "a plain offer never uses a walk-away price" '.matches == []'
post_ok "A1 yes @45 with walk-away 70" A1 records_line "$(records 12)" yes 45 1 '{"p_walk_away_price":70}'; A1_X="${OFFER}"
counter E "${A1_X}" 40 2
expect_ok "a counter that crosses the posted price"
check "crosses at the answered offer's own price" '.matches | length == 1 and .[0].via == "cross" and .[0].price == 45'
post_ok "N rests a yes" N records_line "$(records 18)" yes 50 1
post_ok "B takes N's yes" B records_line "$(records 18)" no 50 1
check "a registered client name loses control characters and is cut to 60" \
  '.matches[0].counterparty.client_name == ("Evil" + ("x" * 56)) and (.matches[0].counterparty.display_name | test("[[:cntrl:]]") | not)'
post_ok "L rests a yes @50 with walk-away 60" L records_line "$(records 17)" yes 50 1 '{"p_walk_away_price":60}'; L_YES="${OFFER}"
rpc "${LEAVER_TOKEN}" group_leave "$(settings_body "${GROUP}")"
expect_ok "L's user leaves the group"
post_ok "E posts a crossing no after L's user left" E records_line "$(records 17)" no 50 1
check "an offer of a member who left no longer fills" '.matches == []'
counter E "${L_YES}" 55 1
expect_ok "E counters inside L's walk-away"
check "nor through its walk-away price" '.matches == []'
pass "counters: inside walk-away match at the counter's price, outside rests, plain offers ignore walk-away, one per AI per offer"

# --- stake limit and withdraw ---------------------------------------------------------------

post_ok "D yes @50 for 60.00" D records_line "$(records 13)" yes 50 60; D_YES="${OFFER}"
post_ok "B takes 10.00 of it" B records_line "$(records 13)" no 50 10
check "a client without a name reads as an AI" '.matches[0].counterparty.display_name == $n' --arg n "pred-admin-${RUN_TAG} · AI"
post_ok "D no @50 for 40.00 elsewhere" D records_line "$(records 14)" no 50 40
check "exactly 100.00 committed" '.stake_left == 0'
post D records_line "$(records 15)" yes 50 0.01
expect_error VALIDATION "past 100.00 open + matched"
withdraw D "${D_YES}"
expect_ok "D withdraws its yes"
check "only the unmatched remainder is freed" '.freed == 50 and .offer.state == "withdrawn" and .offer.matched == 10 and .offer.withdrawn == 50 and .stake_left == 50'
withdraw D "${D_YES}"
expect_ok "withdraw again"
check "nothing more is freed" '.freed == 0 and .stake_left == 50'
post_ok "the freed stake can be posted again" D records_line "$(records 15)" yes 50 50
check "back to 100.00" '.stake_left == 0'
withdraw B "${D_YES}"
expect_error NOT_FOUND "withdrawing another AI's offer"
post_ok "E takes the no side at 50 after the withdrawal" E records_line "$(records 13)" no 50 1
check "no fill against a withdrawn offer" '[.matches[] | .yes_offer_id] | index($d) == null' --arg d "${D_YES}"
pass "stake: open + matched capped at 100.00, withdraw frees only the unmatched remainder, other AIs' offers NOT_FOUND"

# --- moved clock ------------------------------------------------------------------------------

AT_START="lower(app_public.group_cow_bounds('UTC', '${OPEN_WEEK}'))"
args() { printf "'%s', '%s', '%s'" "$1" "$2" "${GROUP}"; }
expect_sql_error CONFLICT "posting at the board's start" "select app_public.agent_group_prediction_post_at(${AT_START},
  $(args "${O_UID}" "${O_CLIENT}"), '${OPEN_WEEK}', 'records_line', '{\"line\":16}', 'yes', 50, 1, null, null, null);"
expect_sql_error CONFLICT "withdrawing at the board's start" "select app_public.agent_group_prediction_withdraw_at(${AT_START},
  $(args "${E_UID}" "${E_CLIENT}"), '${OFFER}');"
expect_sql "a second before the start still posts" "select (app_public.agent_group_prediction_post_at(${AT_START} - interval '1 second',
  $(args "${O_UID}" "${O_CLIENT}"), '${OPEN_WEEK}', 'records_line', '{\"line\":16}', 'yes', 50, 1, null, null, null))->'offer'->>'state';" open
# In Honolulu the UTC start is still Sunday, so the open week is unchanged
# but its zone bounds would start ten hours later: the frozen board holds.
run_psql "update app_public.groups set cow_time_zone = 'Pacific/Honolulu' where id = '${GROUP}';" >/dev/null
expect_sql_error CONFLICT "a zone change cannot move a frozen board" "select app_public.agent_group_prediction_post_at(${AT_START},
  $(args "${O_UID}" "${O_CLIENT}"), '${OPEN_WEEK}', 'records_line', '{\"line\":16}', 'yes', 50, 1, null, null, null);"
run_psql "update app_public.groups set cow_time_zone = 'UTC' where id = '${GROUP}';" >/dev/null
pass "moved clock: posting and withdrawing close at the board's start"

# --- concurrency -------------------------------------------------------------------------------

BOOK7="$(records 11)"
post_ok "F rests a yes @50 for 1.00" F records_line "${BOOK7}" yes 50 1; F_YES="${OFFER}"
RACE_DIR="$(mktemp -d)"
(post G1 records_line "${BOOK7}" no 50 1; printf '%s' "${STATUS}") >"${RACE_DIR}/a" &
race_a=$!
(post G2 records_line "${BOOK7}" no 50 1; printf '%s' "${STATUS}") >"${RACE_DIR}/b" &
race_b=$!
wait "${race_a}"; wait "${race_b}"
[[ "$(tail -c 3 "${RACE_DIR}/a"):$(tail -c 3 "${RACE_DIR}/b")" == "200:200" ]] || fail "both concurrent posts must commit"
expect_sql "F's yes is filled exactly once" "select remaining_cents || ':' || (select count(*) from app_public.group_prediction_matches
  where yes_offer_id = '${F_YES}') || ':' || (select sum(yes_stake_cents) from app_public.group_prediction_matches
  where yes_offer_id = '${F_YES}') from app_public.group_prediction_offers where id = '${F_YES}';" "0:1:100"
# H exists before the race, so only the prediction lock orders the two posts.
post_ok "H stakes one cent first" H records_line "$(records 19)" yes 50 0.01
(post H records_line "$(records 19)" yes 50 50; printf '%s' "${STATUS}") >"${RACE_DIR}/c" &
race_a=$!
(post H records_line "$(records 20)" yes 50 50; printf '%s' "${STATUS}") >"${RACE_DIR}/d" &
race_b=$!
wait "${race_a}"; wait "${race_b}"
[[ "$(sort <<<"$(tail -c 3 "${RACE_DIR}/c")
$(tail -c 3 "${RACE_DIR}/d")" | tr '\n' ':')" == "200:400:" ]] || fail "exactly one of two concurrent 50.00 posts past the cap must commit"
expect_sql "the stake cap held under the race" "select app_public.group_prediction_exposure(id, '${GROUP}', '${OPEN_WEEK}')
  from app_public.group_prediction_bettors where user_id = '${OWNER_UID}' and client_id = '${H_CLIENT}';" 5001
pass "concurrency: two simultaneous crossing posts never over-fill; one AI's concurrent posts never pass the cap"

COMPLETED=1
pass "group predictions: setting, access, markets, offers, matching, counters, stake limit (run ${RUN_TAG})"
