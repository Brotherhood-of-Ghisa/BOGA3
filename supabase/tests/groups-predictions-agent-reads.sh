#!/usr/bin/env bash

# groups-predictions-agent-reads.sh — the agent reads of group predictions
# (groups, form, board) and the AI-scheduled CoW (a body of the
# groups-competitions lane).
#
# Contract: docs/specs/tech/group-predictions-agent-contract.md. Proves,
# against the real local stack (Sync push and the group-eval Edge drain write
# every figure) and a moved clock:
#
#   - posture: the four RPCs are SECURITY DEFINER, pinned and service_role
#     only; app and OAuth tokens cannot execute them; every helper is
#     internal; the picks table is closed to every API role;
#   - access: setting off, non-member, former member and missing group are
#     one NOT_FOUND for form, board and schedule; the groups list holds only
#     current groups with predictions on; a group without a zone has no open
#     week, and its form, board and schedule are VALIDATION;
#   - groups list: members, live exercises with their boards and e1RM unit,
#     open week and close time, remaining stake after a post, a match and a
#     withdrawal, next week's CoW with the AI that picked it;
#   - form: 8 weeks; each week's e1RM best and baseline equal the settlement
#     figures (group_prediction_best_e1rm), the percent is best / baseline;
#     working sets and records equal the settlement figures; each All
#     board's #1 is the board reader's rank 1; Hold has no e1RM; a member
#     whose kg the board hides, or scores from an earlier membership, are
#     hidden in the form too;
#   - board: open offers and matches of every AI; no note anywhere and no
#     walk-away price outside the caller's own offers (asserted on JSON
#     keys); own offers and unsettled positions; after settlement the last
#     week's markets and results and the ranking (all-time, head-to-head)
#     equal the stored figures;
#   - schedule: a member's AI fills the empty slot with the owner as creator
#     and the pick recorded; the `cow` scheduled Stream event names the
#     owner; a retry returns the same CoW, a changed retry is CONFLICT; every
#     group_cow_create validation; a taken slot is CONFLICT; the
#     previous-week rule (FORBIDDEN while another AI posted in the last four
#     weeks, the caller's own posts not counting; allowed once that post is
#     older, or once the picked CoW was cancelled and replaced); owners cancel
#     and replace an AI-picked CoW as before;
#   - a settled e1RM line's kg figure follows the current kg disclosure (board
#     unit, bodyweight switch, live links) and is null when hidden.
#
# Direct-drain mode: the kick URL is unset and the sweep paused for the run,
# both restored on exit. Hermetic: per-run users and OAuth clients, deleted on
# exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-predictions-agent-reads"
FIXTURE_EMAIL_PREFIX="groups-prediction-reads"
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
PASSWORD="GroupsPredictionReads!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
RUN_CLIENT_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"
set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
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
    delete from app_public.group_prediction_bettors where user_id in (${ids});
    delete from auth.users where id in (${ids});
    delete from auth.oauth_clients where id::text in (${clients});
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
  psql_session_stop
  exit "${status}"
}
trap cleanup_on_exit EXIT

# --- helpers ---------------------------------------------------------------------

sql_value() { run_psql "$1"; }
new_uuid() { run_psql "select gen_random_uuid();"; }
now_ms() { run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;"; }
expect_sql() {
  local actual
  actual="$(sql_value "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}
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
    -H 'x-boga-group-seconds: 1' -H "x-boga-sync-protocol: ${BOGA_TEST_SYNC_PROTOCOL:-8}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
# srpc <function> <json-body>: the agent API's service-role call.
srpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$2" "${API_URL}/rest/v1/rpc/$1"
}
drain() {
  eval_drain
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}
drain2() { drain "$1"; drain "$1 (follow-up)"; }

# add_bettor <name> <uid> <client name>: <NAME>_UID and <NAME>_CLIENT.
add_bettor() {
  local client
  client="$(new_uuid)"
  RUN_CLIENT_IDS+=("${client}")
  run_psql "insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method, client_name)
    values ('${client}', 'dynamic', 'https://example.invalid/callback', 'authorization_code,refresh_token', 'none', '$3');" >/dev/null
  printf -v "$1_UID" '%s' "$2"
  printf -v "$1_CLIENT" '%s' "${client}"
}
bettor_id() {
  local uid_var="$1_UID" client_var="$1_CLIENT"
  sql_value "select id from app_public.group_prediction_bettors where user_id = '${!uid_var}' and client_id = '${!client_var}';"
}
ident() { # ident <bettor>: the SQL arguments p_owner, p_client_id
  local uid_var="$1_UID" client_var="$1_CLIENT"
  printf "'%s', '%s'" "${!uid_var}" "${!client_var}"
}
ident_json() { # ident_json <bettor> [group]
  local uid_var="$1_UID" client_var="$1_CLIENT"
  jq -nc --arg o "${!uid_var}" --arg c "${!client_var}" --arg g "${2:-}" \
    '{p_owner:$o, p_client_id:$c} + (if $g == "" then {} else {p_group_id:$g} end)'
}
# post_at <clock-sql> <bettor> <group> <week> <template> <parameters-json> <side> <price> <stake> <walk|null> <note|null>
post_at() {
  BODY="$(run_psql "select app_public.agent_group_prediction_post_at($1, $(ident "$2"), '$3', '$4', '$5', '$6'::jsonb,
    '$7', $8, $9, ${10}, ${11}, null);")"
  OFFER="$(jq -r '.offer.offer_id' <<<"${BODY}")"
}
form_at() { BODY="$(run_psql "select app_public.agent_group_prediction_form_at($1, $(ident "$2"), '$3');")"; }
board_at() { BODY="$(run_psql "select app_public.agent_group_prediction_board_at($1, $(ident "$2"), '$3');")"; }
groups_at() { BODY="$(run_psql "select app_public.agent_group_prediction_groups_at($1, $(ident "$2"));")"; }
# schedule <bettor> <group> <cow-id> <week> <exercise> <metrics-json>: the service-role call.
schedule() {
  srpc agent_group_prediction_cow_schedule "$(ident_json "$1" "$2" | jq -c --arg id "$3" --arg w "$4" --arg x "$5" \
    --argjson m "$6" '. + {p_cow_id:$id, p_week_start:$w, p_group_exercise_id:$x, p_metrics:$m}')"
}
schedule_at_sql() { # schedule_at_sql <clock-sql> <bettor> <group> <cow-id> <week> <exercise> <metrics-sql>: an expression
  printf "app_public.agent_group_prediction_cow_schedule_at(%s, %s, '%s', '%s', '%s', '%s', %s)" \
    "$1" "$(ident "$2")" "$3" "$4" "$5" "$6" "$7"
}
week_clock() { printf "(lower(app_public.group_cow_bounds('UTC', '%s')) + interval '%s')" "$1" "$2"; }
week_ms() { sql_value "select app_public.group_prediction_ms(lower(app_public.group_cow_bounds('UTC', '$1')));"; }

# Session builders (protocol 8 Sync push), as the settlement lane.
e_set2() {
  jq -nc --arg id "$1" --arg se "$2" --argjson o "$3" --arg w "$4" --arg r "$5" --arg t "$6" --argjson c "$7" \
    '{type: "exercise_sets", id: $id, client_updated_at_ms: $c,
      fields: {session_exercise_id: $se, order_index: $o, weight_value: $w, reps_value: $r, set_type: $t,
               planned_weight_value: null, planned_reps_value: null, planned_set_type: null,
               performance_status: null, created_at: $c, updated_at: $c, deleted_at: null}}'
}
# sess <token> <session> <started_ms> <definition> <set-spec>...; set-spec =
# <set-suffix>:<weight>:<reps>:<set_type>; a completed session of one hour.
sess() {
  local token="$1" sid="$2" started="$3" def="$4"
  shift 4
  next_cuam
  local -a rows=("$(e_session "${sid}" "${started}" completed $(( started + 3600000 )) 3600 null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r t
  for spec in "$@"; do
    IFS=: read -r id w r t <<<"${spec}"
    rows+=("$(e_set2 "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "${t}" "${CUAM}")")
    order=$(( order + 1 ))
  done
  push "${token}" "session ${sid}" "${rows[@]}"
}
def_link() { # def_link <token> <definition> <group> <group exercise>
  next_cuam
  push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}")"
  next_cuam
  push "$1" "link $2" "$(e_link "$2" "$3" "$4" "${CUAM}")"
}
exercise() { # exercise <group> <name> <default metric>
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "$1" --arg n "$2" --arg m "$3" \
    '{p_group_id:$g, p_name:$n, p_load_input_mode:"total_load", p_source_exercise_id:null,
      p_bodyweight_contribution:0, p_default_metric:$m}')"
  expect_ok "exercise $2"
  jq -r '.exercise.group_exercise_id' <<<"${BODY}"
}
new_group() { # new_group <token> <name> <zone-json>: prints the id
  rpc "$1" group_create "$(jq -nc --arg n "$2 ${RUN_TAG}" --argjson z "$3" '{p_name:$n, p_description:null, p_time_zone:$z}')"
  expect_ok "create group $2"
  jq -r '.group_id' <<<"${BODY}"
}
join_group() { # join_group <owner-token> <group> <member-token>...
  local owner="$1" group="$2" code
  shift 2
  rpc "${owner}" group_invite_get "$(jq -nc --arg g "${group}" '{p_group_id:$g}')"
  code="$(jq -r '.code' <<<"${BODY}")"
  for token in "$@"; do
    rpc "${token}" group_join "$(jq -nc --arg c "${code}" '{p_code:$c}')"
    expect_ok "join ${group}"
  done
}
predictions_on() { # predictions_on <token> <group>
  rpc "$1" group_prediction_settings_set "$(jq -nc --arg g "$2" '{p_group_id:$g, p_enabled:true}')"
  expect_ok "predictions on in $2"
}
# JSON key checks: no "note" key anywhere, and "walk_away_price" only under
# .mine.offers.
no_secret_keys() {
  jq -e '[paths | select(.[-1] == "note")] == []
    and ([paths | select(.[-1] == "walk_away_price")] | all(.[0] == "mine" and .[1] == "offers"))' \
    <<<"${BODY}" >/dev/null || fail "$1: a note or another AI's walk-away price reached the read"
}

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning an owner, three members, a former member and a stranger"
provision OWNER owner
provision ALEX alex
provision BLAIR blair
provision CASEY casey
provision FORMER former
provision STRANGER stranger
for who in OWNER ALEX BLAIR CASEY FORMER STRANGER; do
  uid_var="${who}_UID"
  set_username "${!uid_var}" "reads-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
set_kick_url ""
set_sweep_active false

# The open board is next week's; keep the whole run inside this week.
until [[ "$(sql_value "select lower(app_public.group_cow_bounds('UTC', app_public.group_cow_week('UTC', clock_timestamp()) + 7))
    - clock_timestamp() > interval '20 minutes';")" == t ]]; do
  echo "[${LANE_LABEL}] waiting for the UTC week to turn"
  sleep 60
done

GROUP="$(new_group "${OWNER_TOKEN}" "Reads" '"UTC"')"
OFF_GROUP="$(new_group "${OWNER_TOKEN}" "Reads off" '"UTC"')"
NOZONE="$(new_group "${OWNER_TOKEN}" "Reads no zone" 'null')"
RULE_GROUP="$(new_group "${OWNER_TOKEN}" "Reads rule" '"UTC"')"
OTHER_GROUP="$(new_group "${STRANGER_TOKEN}" "Reads stranger" '"UTC"')"
join_group "${OWNER_TOKEN}" "${GROUP}" "${ALEX_TOKEN}" "${BLAIR_TOKEN}" "${CASEY_TOKEN}" "${FORMER_TOKEN}"
join_group "${OWNER_TOKEN}" "${OFF_GROUP}" "${ALEX_TOKEN}"
join_group "${OWNER_TOKEN}" "${NOZONE}" "${ALEX_TOKEN}"
join_group "${OWNER_TOKEN}" "${RULE_GROUP}" "${ALEX_TOKEN}" "${BLAIR_TOKEN}"
predictions_on "${OWNER_TOKEN}" "${GROUP}"
predictions_on "${OWNER_TOKEN}" "${NOZONE}"
predictions_on "${OWNER_TOKEN}" "${RULE_GROUP}"
predictions_on "${STRANGER_TOKEN}" "${OTHER_GROUP}"
rpc "${FORMER_TOKEN}" group_leave "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "the former member leaves"

BENCH="$(exercise "${GROUP}" "Reads Bench" e1rm)"
PLANK="$(exercise "${GROUP}" "Reads Plank" seconds)"
OLD="$(exercise "${GROUP}" "Reads Old" e1rm)"
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GROUP}" --arg x "${OLD}" \
  '{p_group_id:$g, p_exercise_id:$x, p_archived:true}')"
expect_ok "archive Old"
RULE_BENCH="$(exercise "${RULE_GROUP}" "Rule Bench" e1rm)"
NOZONE_BENCH="$(exercise "${NOZONE}" "No zone Bench" e1rm)"

T="gpr-${RUN_TAG}"
CUAM="$(now_ms)"
def_link "${ALEX_TOKEN}" "${T}-a-bench" "${GROUP}" "${BENCH}"
def_link "${BLAIR_TOKEN}" "${T}-b-bench" "${GROUP}" "${BENCH}"

add_bettor A1 "${ALEX_UID}" "Claude"
add_bettor A2 "${ALEX_UID}" "Codex"
add_bettor B1 "${BLAIR_UID}" "Claude"
add_bettor C1 "${CASEY_UID}" "Claude"
add_bettor F1 "${FORMER_UID}" "Claude"
add_bettor S1 "${STRANGER_UID}" "Claude"
add_bettor O1 "${OWNER_UID}" "Claude"

CW="$(sql_value "select app_public.group_cow_week('UTC', clock_timestamp())::text;")"
W="$(sql_value "select ('${CW}'::date + 7)::text;")"
W7="$(sql_value "select ('${W}'::date + 7)::text;")"
W14="$(sql_value "select ('${W}'::date + 14)::text;")"
P14="$(sql_value "select ('${CW}'::date - 14)::text;")"
P7="$(sql_value "select ('${CW}'::date - 7)::text;")"
DAY=86400000

# Sessions over three weeks: Alex 100x5 two weeks ago, 110x5 last week, two
# sets this week (105x5, 90x5); Blair 80x5 last week. A session is shared
# only when its start falls in a membership, so theirs start 30 days back.
run_psql "update app_public.group_memberships set joined_at = joined_at - interval '30 days'
  where group_id = '${GROUP}' and user_id in ('${ALEX_UID}', '${BLAIR_UID}');" >/dev/null
THIS_WEEK_MS=$(( $(week_ms "${CW}") + 1000 ))
sess "${ALEX_TOKEN}" "${T}-a1" $(( $(week_ms "${P14}") + DAY )) "${T}-a-bench" a1:100:5:rir_1
sess "${ALEX_TOKEN}" "${T}-a2" $(( $(week_ms "${P7}") + DAY )) "${T}-a-bench" a2:110:5:rir_1
sess "${BLAIR_TOKEN}" "${T}-b2" $(( $(week_ms "${P7}") + 2 * DAY )) "${T}-b-bench" b2:80:5:rir_1
sess "${ALEX_TOKEN}" "${T}-a3" "${THIS_WEEK_MS}" "${T}-a-bench" a3:105:5:rir_1 a3b:90:5:rir_1
drain2 "sessions"
score() { sql_value "select trim_scale(value) from app_public.group_metric_set_scores where set_id = '${T}-$1' and metric = 'e1rm' and counting;"; }
E1="$(score a1)"; E2="$(score a2)"; E3="$(score a3)"; EB="$(score b2)"
[[ -n "${E1}" && -n "${E2}" && -n "${E3}" && -n "${EB}" ]] || fail "the sessions were not scored"
pass "fixture: group G (UTC, Bench, Plank, archived Old), an off group, a no-zone group, a rule group, a stranger's group; sessions over three weeks scored"

# --- posture -----------------------------------------------------------------------

READ_RPCS="'agent_group_prediction_groups','agent_group_prediction_form','agent_group_prediction_board','agent_group_prediction_cow_schedule'"
expect_sql "the four RPCs: definer, pinned, service_role only" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_public' and p.proname in (${READ_RPCS}) and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE');" 4
expect_sql "every other new function: internal, not definer" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) r(role)
  where n.nspname = 'app_public' and p.proname in ('group_prediction_read_enter', 'group_prediction_me_json',
      'group_prediction_open_week_json', 'group_prediction_stake_left', 'group_prediction_cow_json', 'group_prediction_normalized',
      'group_prediction_exercise_json', 'group_prediction_group_json', 'group_prediction_form_weeks', 'group_prediction_form_e1rm',
      'group_prediction_form_leaders', 'agent_group_prediction_form_at', 'group_prediction_public_offer_json',
      'group_prediction_public_match_json', 'group_prediction_settled_market_json', 'group_prediction_result_shown',
      'group_prediction_open_book_json',
      'group_prediction_mine_json', 'group_prediction_last_week_json', 'group_prediction_ranking_json',
      'agent_group_prediction_board_at', 'agent_group_prediction_groups_at', 'group_prediction_cow_pick_refused',
      'agent_group_prediction_cow_schedule_at')
    and (has_function_privilege(r.role, p.oid, 'EXECUTE') or p.prosecdef);" 0
expect_sql "picks table: RLS on, no policies, no API grants" "select (select c.relrowsecurity from pg_class c
    where c.oid = 'app_public.group_prediction_cow_picks'::regclass)::text
  || (select count(*) from pg_policies where schemaname = 'app_public' and tablename = 'group_prediction_cow_picks')
  || (select count(*) from unnest(array['anon','authenticated','service_role']) r(role)
      where has_table_privilege(r.role, 'app_public.group_prediction_cow_picks', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));" "true00"
for bearer in "${ALEX_TOKEN}" "$(mint_token "${ALEX_TOKEN}" "${A1_CLIENT}")"; do
  for fn in agent_group_prediction_groups agent_group_prediction_form agent_group_prediction_board; do
    rpc "${bearer}" "${fn}" "$(ident_json A1 "$( [[ "${fn}" == agent_group_prediction_groups ]] || printf '%s' "${GROUP}")")"
    [[ "${STATUS}" != 200 ]] || fail "a client token executed ${fn}"
  done
  rpc "${bearer}" agent_group_prediction_cow_schedule "$(ident_json A1 "${GROUP}" | jq -c --arg id "$(new_uuid)" \
    --arg w "${W}" --arg x "${BENCH}" '. + {p_cow_id:$id, p_week_start:$w, p_group_exercise_id:$x, p_metrics:["e1rm"]}')"
  [[ "${STATUS}" != 200 ]] || fail "a client token executed agent_group_prediction_cow_schedule"
done
pass "posture: four service-role RPCs, internal helpers, closed picks table; app and OAuth tokens refused"

# --- access ------------------------------------------------------------------------

for fn in agent_group_prediction_form agent_group_prediction_board; do
  srpc "${fn}" "$(ident_json S1 "${GROUP}")"; expect_error NOT_FOUND "${fn}: a stranger"
  srpc "${fn}" "$(ident_json F1 "${GROUP}")"; expect_error NOT_FOUND "${fn}: a former member"
  srpc "${fn}" "$(ident_json A1 "${OFF_GROUP}")"; expect_error NOT_FOUND "${fn}: the setting off"
  srpc "${fn}" "$(ident_json A1 "$(new_uuid)")"; expect_error NOT_FOUND "${fn}: a missing group"
  srpc "${fn}" "$(ident_json A1 "${NOZONE}")"; expect_error VALIDATION "${fn}: no zone"
  srpc "${fn}" "$(jq -nc --arg g "${GROUP}" '{p_owner:null, p_client_id:"x", p_group_id:$g}')"
  expect_error VALIDATION "${fn}: no agent identity"
done
schedule S1 "${GROUP}" "$(new_uuid)" "${W}" "${BENCH}" '["e1rm"]'; expect_error NOT_FOUND "schedule: a stranger"
schedule F1 "${GROUP}" "$(new_uuid)" "${W}" "${BENCH}" '["e1rm"]'; expect_error NOT_FOUND "schedule: a former member"
schedule A1 "${OFF_GROUP}" "$(new_uuid)" "${W}" "${BENCH}" '["e1rm"]'; expect_error NOT_FOUND "schedule: the setting off"
schedule A1 "${NOZONE}" "$(new_uuid)" "${W}" "${NOZONE_BENCH}" '["e1rm"]'; expect_error VALIDATION "schedule: no zone"

srpc agent_group_prediction_groups "$(ident_json A1)"
expect_ok "groups: Alex's AI"
check "groups: only Alex's current groups with predictions on" '[.groups[].group_id] | sort == ($e | sort)' \
  --argjson e "$(jq -nc --arg a "${GROUP}" --arg b "${NOZONE}" --arg c "${RULE_GROUP}" '[$a, $b, $c]')"
check "groups: no open week without a zone" '.groups[] | select(.group_id == $g) | .open_week == null and .next_week_cow == null' \
  --arg g "${NOZONE}"
srpc agent_group_prediction_groups "$(ident_json F1)"
expect_ok "groups: the former member's AI"
check "groups: a former member lists nothing" '.groups == []'
pass "access: NOT_FOUND for stranger, former member, setting off and missing group; no zone VALIDATION; the list holds only current groups with predictions on"

# --- groups list -------------------------------------------------------------------

groups_at "clock_timestamp()" A1
jq -e --arg g "${GROUP}" --arg w "${W}" --arg bench "${BENCH}" --arg plank "${PLANK}" --arg a "${ALEX_UID}" \
  --argjson closes "$(week_ms "${W}")" '
  (.groups[] | select(.group_id == $g)) as $x
  | $x.time_zone == "UTC" and $x.stake_left == 100 and $x.next_week_cow == null
    and $x.open_week.week_start == $w and $x.open_week.closes_at_ms == $closes
    and ($x.members | length) == 4 and ([$x.members[].role] | sort) == ["member", "member", "member", "owner"]
    and $x.me.bettor_id == null and ($x.me.display_name | endswith(" · Claude")) and $x.me.member.user_id == $a
    and ([$x.group_exercises[].group_exercise_id] | sort) == ([$bench, $plank] | sort)
    and ($x.group_exercises[] | select(.group_exercise_id == $bench)) == {group_exercise_id: $bench, name: "Reads Bench",
      type: "repetitions", board_metrics: ["e1rm", "volume"], e1rm_unit: "kg"}
    and ($x.group_exercises[] | select(.group_exercise_id == $plank)) == {group_exercise_id: $plank, name: "Reads Plank",
      type: "hold", board_metrics: ["seconds"], e1rm_unit: null}' <<<"${BODY}" >/dev/null ||
  fail "groups: G's members, exercises, open week, stake and identity: ${BODY}"
pass "groups: members with roles, live exercises with boards and units (archived left out), open week and close time, 100.00 stake, the caller before its first post"

# --- form --------------------------------------------------------------------------

form_at "clock_timestamp()" C1 "${GROUP}"
no_secret_keys "form"
jq -e --arg cw "${CW}" '(.weeks | length) == 8 and .weeks[-1].week_start == $cw and (.weeks[-1].complete | not)
  and ([.weeks[:-1][].complete] | all) and (.members | length) == 4' <<<"${BODY}" >/dev/null ||
  fail "form: 8 weeks ending with this week, current members: ${BODY}"
REV="$(sql_value "select published_rules_revision from app_public.group_exercises where id = '${BENCH}';")"
# Every week of every current member: the e1RM best and baseline equal the
# settlement figures, the percent is best / baseline, and working sets equal
# the settlement count.
FORM="${BODY}"
mismatches="$(run_psql "with f as (select '$(jq -c . <<<"${FORM}" | sed "s/'/''/g")'::jsonb as j),
  rows as (select (m -> 'member' ->> 'user_id')::uuid as member, e, w
    from f cross join jsonb_array_elements(f.j -> 'members') m
    cross join jsonb_array_elements(m -> 'e1rm') e cross join jsonb_array_elements(e -> 'weeks') w),
  weeks as (select (w ->> 'week_start')::date as week_start, (w ->> 'starts_at_ms')::bigint as from_ms,
      (w ->> 'ends_at_ms')::bigint as to_ms, (w ->> 'records')::integer as records
    from f cross join jsonb_array_elements(f.j -> 'weeks') w)
  select count(*) from rows r join weeks k on k.week_start = (r.w ->> 'week_start')::date
   where (r.e ->> 'group_exercise_id')::uuid <> '${BENCH}'
      or (r.w ->> 'best')::numeric is distinct from (select b.value from app_public.group_prediction_best_e1rm('${GROUP}',
        '${BENCH}', ${REV}, r.member, k.from_ms, k.to_ms) b)
      or (r.w ->> 'baseline')::numeric is distinct from (select b.value from app_public.group_prediction_best_e1rm('${GROUP}',
        '${BENCH}', ${REV}, r.member, null, k.from_ms) b)
      or (r.w ->> 'percent_of_baseline')::numeric is distinct from round((r.w ->> 'best')::numeric * 100
        / nullif((r.w ->> 'baseline')::numeric, 0), 1)
  union all
  select count(*) from f cross join jsonb_array_elements(f.j -> 'members') m
    cross join jsonb_array_elements(m -> 'working_sets') s join weeks k on k.week_start = (s ->> 'week_start')::date
   where (s ->> 'sets')::integer <> app_public.group_prediction_week_sets('${GROUP}', (m -> 'member' ->> 'user_id')::uuid,
     k.from_ms, k.to_ms)
  union all
  select count(*) from weeks k where k.records <> app_public.group_prediction_week_records('${GROUP}', k.from_ms, k.to_ms);")"
[[ "${mismatches}" == $'0\n0\n0' ]] || fail "form: figures differ from the settlement figures (${mismatches})"
jq -e --arg a "${ALEX_UID}" --arg b "${BLAIR_UID}" --arg c "${CASEY_UID}" --arg p14 "${P14}" --arg p7 "${P7}" --arg cw "${CW}" \
  --argjson e1 "${E1}" --argjson e2 "${E2}" --argjson e3 "${E3}" --argjson eb "${EB}" '
  def member($u): .members[] | select(.member.user_id == $u);
  def wk($w): .weeks[] | select(.week_start == $w);
  (member($a).e1rm | length) == 1 and member($a).e1rm[0].unit == "kg"
  and (member($a).e1rm[0] | wk($p14)) == {week_start: $p14, baseline: null, best: $e1, percent_of_baseline: null}
  and (member($a).e1rm[0] | wk($p7) | .baseline == $e1 and .best == $e2)
  and (member($a).e1rm[0] | wk($cw) | .baseline == $e2 and .best == $e3 and .percent_of_baseline != null)
  and (member($b).e1rm[0] | wk($p7) | .baseline == null and .best == $eb)
  and ([member($c).e1rm[0].weeks[].best] | all(. == null))
  and ([member($a).working_sets[] | select(.week_start == $p14 or .week_start == $p7 or .week_start == $cw) | .sets] == [1, 1, 2])
  and ([.weeks[] | select(.week_start == $p14 or .week_start == $p7 or .week_start == $cw) | .records] | add) > 0' \
  <<<"${FORM}" >/dev/null || fail "form: Alex, Blair and Casey's figures: ${FORM}"
# Each All board's #1 is the board reader's rank 1; Plank has a seconds board
# and no e1RM; the archived exercise has neither.
for metric in e1rm volume; do
  leader="$(sql_value "select (r.row_json -> 'member' ->> 'user_id') || ':' || (r.row_json ->> 'value')
    from app_public.group_competition_board_rows('${GROUP}', '${BENCH}', ${REV}, '${metric}', false) r where r.rank = 1;")"
  jq -e --arg x "${BENCH}" --arg m "${metric}" --arg l "${leader}" \
    '.leaders[] | select(.group_exercise_id == $x and .metric == $m)
      | .state == "ready" and .leader.former == false
        and (.leader.member.user_id + ":" + (.leader.value | tostring)) == $l' <<<"${FORM}" >/dev/null ||
    fail "form: Bench ${metric} #1 is not the board's rank 1 (${leader}): ${FORM}"
done
jq -e --arg plank "${PLANK}" --arg old "${OLD}" '
  ([.leaders[] | select(.group_exercise_id == $plank) | .metric] == ["seconds"])
  and ([.leaders[] | select(.group_exercise_id == $old)] == [])
  and ([.members[].e1rm[].group_exercise_id] | all(. != $plank and . != $old))' <<<"${FORM}" >/dev/null ||
  fail "form: Plank and the archived exercise: ${FORM}"
# Disclosure: with bodyweight calculations on, Blair's bench without a live
# link and her own exercise counting bodyweight, the board hides her kg, and so
# does the form (in one rolled-back transaction, without triggers).
hidden="$(run_psql "begin; set local session_replication_role = replica;
  update app_public.groups set bodyweight_calculations_enabled = true where id = '${GROUP}';
  update app_public.exercise_definitions set bodyweight_contribution = 0.5
   where owner_user_id = '${BLAIR_UID}' and id = '${T}-b-bench';
  update app_public.exercise_group_links set deleted_at = floor(extract(epoch from now()) * 1000)::bigint
   where owner_user_id = '${BLAIR_UID}' and exercise_definition_id = '${T}-b-bench';
  select (select count(*) from app_public.group_competition_board_rows('${GROUP}', '${BENCH}', ${REV}, 'e1rm', false) r
     where r.member_user_id = '${BLAIR_UID}')
    || ':' || (select count(*) from app_public.group_prediction_form_e1rm('${GROUP}', 'UTC', clock_timestamp()) e
     where e.member_user_id = '${BLAIR_UID}' and (e.best is not null or e.baseline is not null))
    || ':' || (select count(*) from app_public.group_prediction_form_e1rm('${GROUP}', 'UTC', clock_timestamp()) e
     where e.member_user_id = '${ALEX_UID}' and e.best is not null);
  rollback;")"
[[ "${hidden}" == "0:0:3" ]] || fail "form disclosure: expected Blair hidden on the board and in the form, got ${hidden}"
# The board's membership rule: scores from an earlier membership (Blair's,
# moved to a former one in a rolled-back transaction) leave the board and the
# form alike, while the current membership's stay.
rejoined="$(run_psql "begin; set local session_replication_role = replica;
  update app_public.group_metric_set_scores set membership_id = gen_random_uuid()
   where group_exercise_id = '${BENCH}' and member_user_id = '${BLAIR_UID}';
  update app_public.group_metric_board_entries set membership_id = gen_random_uuid()
   where group_exercise_id = '${BENCH}' and member_user_id = '${BLAIR_UID}';
  select (select count(*) from app_public.group_competition_board_rows('${GROUP}', '${BENCH}', ${REV}, 'e1rm', false) r
     where r.member_user_id = '${BLAIR_UID}')
    || ':' || (select count(*) from app_public.group_prediction_form_e1rm('${GROUP}', 'UTC', clock_timestamp()) e
     where e.member_user_id = '${BLAIR_UID}' and (e.best is not null or e.baseline is not null))
    || ':' || (select count(*) from app_public.group_prediction_form_e1rm('${GROUP}', 'UTC', clock_timestamp()) e
     where e.member_user_id = '${ALEX_UID}' and e.best is not null);
  rollback;")"
[[ "${rejoined}" == "0:0:3" ]] || fail "form membership rule: expected an earlier membership's scores off the board and the form, got ${rejoined}"
pass "form: 8 weeks; e1RM best, baseline and percent, working sets and records equal the settlement figures; #1 per All board is the board's rank 1; Hold and archived handled; hidden kg and an earlier membership's scores stay hidden"

# --- board -------------------------------------------------------------------------

NOW="clock_timestamp()"
SETS_A="{\"member_user_id\":\"${ALEX_UID}\",\"line\":5}"
post_at "${NOW}" A1 "${GROUP}" "${W}" sets_line "${SETS_A}" yes 60 10 70 "'A1 private note'"
A1_OFFER="${OFFER}"
post_at "${NOW}" B1 "${GROUP}" "${W}" sets_line "${SETS_A}" no 65 6 null "'B1 note'"
B1_REST="${OFFER}"
post_at "${NOW}" A2 "${GROUP}" "${W}" records_line '{"line":3}' yes 40 5 50 null
A2_OFFER="${OFFER}"
groups_at "${NOW}" A1
check "stake after a post: 90.00 left" '.groups[] | select(.group_id == $g) | .stake_left == 90' --arg g "${GROUP}"
# B1 takes 6 of A1's yes at 60: A1 risks 6.00 against 4.00.
post_at "${NOW}" B1 "${GROUP}" "${W}" sets_line "${SETS_A}" no 55 4 null null
jq -e '.matches | length == 1 and .[0].price == 60 and .[0].yes_stake == 6 and .[0].no_stake == 4' <<<"${BODY}" >/dev/null ||
  fail "board fixture: B1 did not take A1's offer: ${BODY}"
groups_at "${NOW}" A1
check "stake after a match: still 90.00 left" '.groups[] | select(.group_id == $g) | .stake_left == 90' --arg g "${GROUP}"
srpc agent_group_prediction_board "$(ident_json C1 "${GROUP}")"
expect_ok "board: Casey's AI (service role)"
no_secret_keys "board as C1"
jq -e --arg a1 "${A1_OFFER}" --arg b1 "${B1_REST}" --arg a2 "${A2_OFFER}" --arg w "${W}" '
  .open_week.week_start == $w and ([.open_week.offers[].offer_id] == [$a1, $b1, $a2])
  and (.open_week.offers[0] | .remaining == 4 and .stake == 10 and .mine == false and .bettor.client_name == "Claude")
  and (.open_week.markets | length) == 2 and (.open_week.matches | length) == 1
  and (.open_week.matches[0] | .yes_stake == 6 and .no_stake == 4 and .price == 60)
  and .mine == {stake_left: 100, offers: [], positions: []} and .last_week == null and .ranking == []' <<<"${BODY}" >/dev/null ||
  fail "board as C1: open offers, matches and an empty side: ${BODY}"
board_at "${NOW}" A1 "${GROUP}"
no_secret_keys "board as A1"
jq -e --arg a1 "${A1_OFFER}" '.mine.stake_left == 90 and ([.mine.offers[] | {offer_id, walk_away_price, state, matched}]
    == [{offer_id: $a1, walk_away_price: 70, state: "open", matched: 6}])
  and (.mine.positions | length) == 1 and .mine.positions[0].side == "yes" and .mine.positions[0].market.template == "sets_line"
  and ([.open_week.offers[] | select(.mine) | .offer_id] == [$a1])' <<<"${BODY}" >/dev/null ||
  fail "board as A1: own offers with the walk-away price and the position: ${BODY}"
srpc agent_group_prediction_withdraw "$(ident_json A1 "${GROUP}" | jq -c --arg x "${A1_OFFER}" '. + {p_offer_id:$x}')"
expect_ok "A1 withdraws its remainder"
groups_at "${NOW}" A1
check "stake after a withdrawal: 94.00 left" '.groups[] | select(.group_id == $g) | .stake_left == 94' --arg g "${GROUP}"
board_at "${NOW}" C1 "${GROUP}"
check "board: a withdrawn offer leaves the book" '[.open_week.offers[].offer_id] == [$b1, $a2]' --arg b1 "${B1_REST}" --arg a2 "${A2_OFFER}"
pass "board: open offers and matches of every AI; own offers with walk-away prices, positions; no notes, no other walk-away price; stake after post, match and withdrawal"

# --- schedule ----------------------------------------------------------------------

COW1="$(new_uuid)"
schedule B1 "${GROUP}" "${COW1}" "${W}" "${BENCH}" '["e1rm","volume"]'
expect_ok "schedule: Blair's AI fills next week's slot"
check "schedule: the CoW" '.cow.cow_id == $id and .cow.week_start == $w and .cow.metrics == ["e1rm","volume"]
  and .cow.state == "scheduled" and .cow.exercise_name == "Reads Bench" and .cow.picked_by.bettor_id == $b' \
  --arg id "${COW1}" --arg w "${W}" --arg b "$(bettor_id B1)"
expect_sql "schedule: the owner creates, the pick names the AI" "select c.created_by::text || ':' || k.bettor_id::text
  from app_public.group_cows c join app_public.group_prediction_cow_picks k on k.cow_id = c.id where c.id = '${COW1}';" \
  "${BLAIR_UID}:$(bettor_id B1)"
expect_sql "schedule: the scheduled Stream event, with the owner as actor" "select count(*) || ':' || min(e.actor_user_id::text)
  from app_public.group_events e where e.group_id = '${GROUP}' and e.kind = 'cow'
   and e.payload ->> 'event' = 'scheduled' and e.payload -> 'definition' ->> 'cow_id' = '${COW1}';" "1:${BLAIR_UID}"
schedule B1 "${GROUP}" "${COW1}" "${W}" "${BENCH}" '["e1rm","volume"]'
expect_ok "schedule: a retry"
check "schedule: a retry returns the same CoW" '.cow.cow_id == $id and .cow.revision == 1' --arg id "${COW1}"
schedule B1 "${GROUP}" "${COW1}" "${W}" "${BENCH}" '["e1rm"]'
expect_error CONFLICT "schedule: a changed retry"
schedule A1 "${GROUP}" "${COW1}" "${W}" "${BENCH}" '["e1rm","volume"]'
expect_error CONFLICT "schedule: another AI reusing the id"
schedule A1 "${GROUP}" "$(new_uuid)" "${W}" "${BENCH}" '["e1rm"]'
expect_error CONFLICT "schedule: the slot is taken"
groups_at "${NOW}" A1
check "groups: next week's CoW names the AI" '.groups[] | select(.group_id == $g) | .next_week_cow.cow_id == $id
  and .next_week_cow.picked_by.bettor_id == $b' --arg g "${GROUP}" --arg id "${COW1}" --arg b "$(bettor_id B1)"
# Owners cancel and replace an AI-picked CoW as before.
REVISION="$(sql_value "select revision from app_public.group_cows where id = '${COW1}';")"
rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${GROUP}" --arg c "${COW1}" --argjson r "${REVISION}" \
  '{p_group_id:$g, p_cow_id:$c, p_expected_revision:$r}')"
expect_ok "the owner cancels the AI-picked CoW"
check "cancelled" '.cow.state == "cancelled"'
CAL="$(sql_value "select cow_calendar_revision from app_public.groups where id = '${GROUP}';")"
COW2="$(new_uuid)"
rpc "${OWNER_TOKEN}" group_cow_create "$(jq -nc --arg g "${GROUP}" --arg c "${COW2}" --arg x "${BENCH}" --argjson r "${CAL}" \
  --arg w "${W}" '{p_group_id:$g, p_cow_id:$c, p_group_exercise_id:$x, p_metrics:["improvement"], p_calendar_revision:$r, p_week_start:$w}')"
expect_ok "the owner replaces it"
groups_at "${NOW}" A1
check "groups: the replacement has no AI pick" '.groups[] | select(.group_id == $g) | .next_week_cow.cow_id == $id
  and .next_week_cow.picked_by == null' --arg g "${GROUP}" --arg id "${COW2}"
expect_sql "schedule: the manager path's Stream actors are unchanged" "select string_agg(e.payload ->> 'event' || '=' || e.actor_user_id::text,
  ',' order by e.seq) from app_public.group_events e where e.group_id = '${GROUP}' and e.kind = 'cow';" \
  "scheduled=${BLAIR_UID},cancelled=${OWNER_UID},scheduled=${OWNER_UID}"
rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${GROUP}" --arg c "${COW2}" '{p_group_id:$g, p_cow_id:$c, p_expected_revision:1}')"
expect_ok "the owner cancels the replacement (the slot is empty again)"

# group_cow_create's validation, one failure each.
for metrics in '[]' '["e1rm","e1rm"]' '["e1rm","volume","improvement","e1rm"]' '["seconds"]' '[null]'; do
  schedule A1 "${GROUP}" "$(new_uuid)" "${W}" "${BENCH}" "${metrics}"
  expect_error VALIDATION "schedule: metrics ${metrics}"
done
schedule A1 "${GROUP}" "$(new_uuid)" "${W}" "${OLD}" '["e1rm"]'; expect_error VALIDATION "schedule: an archived exercise"
schedule A1 "${GROUP}" "$(new_uuid)" "${W}" "${RULE_BENCH}" '["e1rm"]'; expect_error VALIDATION "schedule: another group's exercise"
schedule A1 "${GROUP}" "$(new_uuid)" "${W}" "$(new_uuid)" '["e1rm"]'; expect_error VALIDATION "schedule: a missing exercise"
schedule A1 "${GROUP}" "$(new_uuid)" "${CW}" "${BENCH}" '["e1rm"]'; expect_error VALIDATION "schedule: this week"
schedule A1 "${GROUP}" "$(new_uuid)" "${W7}" "${BENCH}" '["e1rm"]'; expect_error VALIDATION "schedule: a later week"
srpc agent_group_prediction_cow_schedule "$(ident_json A1 "${GROUP}" | jq -c --arg w "${W}" --arg x "${BENCH}" \
  '. + {p_cow_id:null, p_week_start:$w, p_group_exercise_id:$x, p_metrics:["e1rm"]}')"
expect_error VALIDATION "schedule: no CoW id"
expect_sql "schedule: no refused call wrote a CoW or a pick" "select count(*) from app_public.group_cows c
  left join app_public.group_prediction_cow_picks k on k.cow_id = c.id where c.group_id = '${GROUP}';" 2

# The previous-week rule, in the rule group: Blair's AI picks next week's
# CoW now; inside that week (moved clock) it would pick the week after.
schedule B1 "${RULE_GROUP}" "$(new_uuid)" "${W}" "${RULE_BENCH}" '["e1rm"]'
expect_ok "rule: B1 picks week W"
IN_W="$(week_clock "${W}" '1 day')"
RULE_SETS="{\"member_user_id\":\"${BLAIR_UID}\",\"line\":5}"
# B1's own post does not count.
post_at "$(week_clock "${W}" '1 hour')" B1 "${RULE_GROUP}" "${W7}" sets_line "${RULE_SETS}" yes 50 1 null null
expect_sql "rule: allowed while only the picking AI has posted" "select ($(schedule_at_sql "${IN_W}" B1 "${RULE_GROUP}" \
  "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']") -> 'cow' ->> 'week_start') = '${W7}';
  " t
# That rolled forward the clock for W7; undo it for the FORBIDDEN cases.
run_psql "delete from app_public.group_cows where group_id = '${RULE_GROUP}' and week_start = '${W7}';" >/dev/null
# Another AI of another user posts: refused.
post_at "$(week_clock "${W}" '2 hours')" A1 "${RULE_GROUP}" "${W7}" sets_line "${RULE_SETS}" no 70 1 null null
expect_sql_error FORBIDDEN "rule: refused while another AI posted in the last four weeks" \
  "select $(schedule_at_sql "${IN_W}" B1 "${RULE_GROUP}" "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']");"
# Another AI of the picking AI's own user counts too: with A1 holding W's
# pick and only A2 (Alex's second AI) posting, A1 is refused the week after
# (rolled back).
expect_sql "rule: another AI of the same user counts as another bettor" "begin;
  delete from app_public.group_prediction_offers o using app_public.group_prediction_markets m
   where m.id = o.market_id and m.group_id = '${RULE_GROUP}' and o.bettor_id = '$(bettor_id B1)';
  update app_public.group_prediction_offers o set bettor_id = '$(bettor_id A2)'
    from app_public.group_prediction_markets m where m.id = o.market_id and m.group_id = '${RULE_GROUP}'
     and o.bettor_id = '$(bettor_id A1)';
  update app_public.group_prediction_cow_picks k set bettor_id = '$(bettor_id A1)'
    from app_public.group_cows c where c.id = k.cow_id and c.group_id = '${RULE_GROUP}' and c.week_start = '${W}';
  select app_public.group_prediction_cow_pick_refused('${RULE_GROUP}', '$(bettor_id A1)', '${W7}', ${IN_W})
    and not app_public.group_prediction_cow_pick_refused('${RULE_GROUP}', '$(bettor_id A2)', '${W7}', ${IN_W});
  rollback;" t
# Another AI may still pick it.
expect_sql "rule: another AI picks the week after" "select ($(schedule_at_sql "${IN_W}" A2 "${RULE_GROUP}" \
  "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']") -> 'cow' -> 'picked_by' ->> 'bettor_id') = '$(bettor_id A2)';" t
run_psql "delete from app_public.group_cows where group_id = '${RULE_GROUP}' and week_start = '${W7}';" >/dev/null
# The other AI's post is more than four weeks old at the clock: allowed.
run_psql "update app_public.group_prediction_offers o set created_at = ${IN_W} - interval '28 days 1 second'
  from app_public.group_prediction_markets m where m.id = o.market_id and m.group_id = '${RULE_GROUP}'
   and o.bettor_id = '$(bettor_id A1)';" >/dev/null
expect_sql "rule: allowed once no other AI posted in the last four weeks" "select ($(schedule_at_sql "${IN_W}" B1 "${RULE_GROUP}" \
  "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']") -> 'cow' ->> 'week_start') = '${W7}';" t
run_psql "delete from app_public.group_cows where group_id = '${RULE_GROUP}' and week_start = '${W7}';
  update app_public.group_prediction_offers o set created_at = ${IN_W} - interval '1 hour'
  from app_public.group_prediction_markets m where m.id = o.market_id and m.group_id = '${RULE_GROUP}'
   and o.bettor_id = '$(bettor_id A1)';" >/dev/null
expect_sql_error FORBIDDEN "rule: refused again once the other AI's post is recent" \
  "select $(schedule_at_sql "${IN_W}" B1 "${RULE_GROUP}" "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']");"
# The owner cancels B1's pick of W and schedules a replacement: the
# replacement is the week's CoW, so B1 did not pick it and may pick W7.
RULE_COW="$(sql_value "select id from app_public.group_cows where group_id = '${RULE_GROUP}' and week_start = '${W}' and cancelled_at is null;")"
rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${RULE_GROUP}" --arg c "${RULE_COW}" '{p_group_id:$g, p_cow_id:$c, p_expected_revision:1}')"
expect_ok "rule: the owner cancels B1's pick"
rpc "${OWNER_TOKEN}" group_cow_create "$(jq -nc --arg g "${RULE_GROUP}" --arg c "$(new_uuid)" --arg x "${RULE_BENCH}" \
  --argjson r "$(sql_value "select cow_calendar_revision from app_public.groups where id = '${RULE_GROUP}';")" --arg w "${W}" \
  '{p_group_id:$g, p_cow_id:$c, p_group_exercise_id:$x, p_metrics:["e1rm"], p_calendar_revision:$r, p_week_start:$w}')"
expect_ok "rule: the owner replaces it"
expect_sql "rule: allowed once the picked CoW was cancelled and replaced" "select ($(schedule_at_sql "${IN_W}" B1 "${RULE_GROUP}" \
  "$(new_uuid)" "${W7}" "${RULE_BENCH}" "array['e1rm']") -> 'cow' ->> 'week_start') = '${W7}';" t
pass "schedule: fills the empty slot with the owner as creator and the AI's pick; Stream event; retries; taken slot; every validation; previous-week rule (window, own posts, cancel and replace); owner cancel and replace"

# --- settlement: last week's results and the ranking --------------------------------

# Settle W (Alex logs no session in W: sets_line no) and read at a clock after
# its end.
END_W="$(week_clock "${W}" '7 days 1 hour')"
expect_sql "W settles" "select app_public.group_prediction_settle_at(${END_W}, '${GROUP}', '${W}');" t
board_at "${END_W}" A1 "${GROUP}"
no_secret_keys "board after settlement"
LAST="${BODY}"
jq -e --arg w "${W}" --arg w14 "${W14}" '.last_week.week_start == $w and .open_week.week_start == $w14
  and ([.last_week.markets[] | {template, outcome, result_unit}] == [{template: "sets_line", outcome: "no", result_unit: "sets"}])
  and .mine.positions == [] and .mine.offers == []' <<<"${LAST}" >/dev/null ||
  fail "board after settlement: last week and the empty open board: ${LAST}"
mismatches="$(run_psql "with f as (select '$(jq -c . <<<"${LAST}" | sed "s/'/''/g")'::jsonb as j)
  select count(*) from f cross join jsonb_array_elements(f.j -> 'last_week' -> 'results') r
    full join (select * from app_public.group_prediction_results where group_id = '${GROUP}' and week_start = '${W}') s
      on s.bettor_id = (r -> 'bettor' ->> 'bettor_id')::uuid
   where s.bettor_id is null or r is null or (r ->> 'profit')::numeric <> app_public.group_prediction_points(s.profit_cents)
      or (r ->> 'matched')::integer <> s.matched or (r ->> 'wins')::integer <> s.wins
  union all
  select count(*) from f cross join jsonb_array_elements(f.j -> 'ranking') r
    full join app_public.group_prediction_all_time('${GROUP}') a on a.bettor_id = (r -> 'bettor' ->> 'bettor_id')::uuid
   where a.bettor_id is null or r is null or (r ->> 'all_time_profit')::numeric <> app_public.group_prediction_points(a.profit_cents)
      or (r ->> 'matched')::bigint <> a.matched
  union all
  select count(*) from f cross join jsonb_array_elements(f.j -> 'ranking') r cross join jsonb_array_elements(r -> 'head_to_head') h
    full join app_public.group_prediction_head_to_head('${GROUP}') x on x.bettor_id = (r -> 'bettor' ->> 'bettor_id')::uuid
      and x.opponent_id = (h -> 'opponent' ->> 'bettor_id')::uuid
   where x.bettor_id is null or h is null or (h ->> 'profit')::numeric <> app_public.group_prediction_points(x.profit_cents);")"
[[ "${mismatches}" == $'0\n0\n0' ]] || fail "board after settlement: results and ranking differ from the stored figures (${mismatches})"
jq -e --arg a1 "$(bettor_id A1)" --arg b1 "$(bettor_id B1)" '
  (.ranking | map(.bettor.bettor_id)) as $order | $order[0] == $b1
  and (.ranking[] | select(.bettor.bettor_id == $a1) | .week_profit == -6 and .all_time_profit == -6 and .wins == 0 and .losses == 1
    and .head_to_head == [{opponent: .head_to_head[0].opponent, matched: 1, wins: 0, losses: 1, voids: 0, profit: -6}]
    and .head_to_head[0].opponent.bettor_id == $b1)
  and (.ranking[] | select(.bettor.bettor_id == $b1) | .week_profit == 6)' <<<"${LAST}" >/dev/null ||
  fail "board after settlement: the ranking: ${LAST}"
# A settled e1RM line's kg figure follows the current disclosure, in one
# rolled-back transaction without triggers: shown while the board shows
# Alex's kg; with bodyweight calculations off, shown even without a live link;
# with them on and his own exercise counting bodyweight: hidden without a live
# link, shown with his live link to Bench (which does not count it), hidden
# once a second live link of that exercise points at one that does, and hidden
# once Bench itself counts bodyweight (its board unit is no longer kg).
E1RM_SETTLED="jsonb_populate_record(null::app_public.group_prediction_markets, jsonb_build_object('id', gen_random_uuid(),
  'group_id', '${GROUP}', 'week_start', '${W}', 'template', 'e1rm_line', 'member_user_id', '${ALEX_UID}',
  'group_exercise_id', '${BENCH}', 'line', 100, 'outcome', 'yes', 'result_value', ${E3}, 'result_unit', 'kg'))"
SHOWN="select coalesce(app_public.group_prediction_settled_market_json(${E1RM_SETTLED}) ->> 'result_value', 'hidden');"
A_LINK="owner_user_id = '${ALEX_UID}' and exercise_definition_id = '${T}-a-bench'"
figures="$(run_psql "begin; set local session_replication_role = replica;
  ${SHOWN}
  update app_public.exercise_group_links set deleted_at = 1 where ${A_LINK};
  ${SHOWN}
  update app_public.groups set bodyweight_calculations_enabled = true where id = '${GROUP}';
  update app_public.exercise_definitions set bodyweight_contribution = 0.5 where owner_user_id = '${ALEX_UID}' and id = '${T}-a-bench';
  ${SHOWN}
  update app_public.exercise_group_links set deleted_at = null where ${A_LINK};
  ${SHOWN}
  update app_public.group_exercises set bodyweight_contribution = 0.5 where id = '${OLD}';
  insert into app_public.exercise_group_links(owner_user_id, id, exercise_definition_id, group_id, group_exercise_id,
      created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at)
    select owner_user_id, id || ':second', exercise_definition_id, group_id, group_exercise_id, created_at, updated_at,
      null, client_updated_at_ms, server_received_at from app_public.exercise_group_links where ${A_LINK};
  update app_public.exercise_group_links set group_exercise_id = '${OLD}' where ${A_LINK} and id like '%:second';
  ${SHOWN}
  delete from app_public.exercise_group_links where ${A_LINK} and id like '%:second';
  update app_public.group_exercises set bodyweight_contribution = 0.5 where id = '${BENCH}';
  ${SHOWN}
  rollback;" | tr '\n' ' ')"
[[ "${figures}" == "${E3} ${E3} hidden ${E3} hidden hidden " ]] ||
  fail "settled e1RM figure disclosure: expected '${E3} ${E3} hidden ${E3} hidden hidden ', got '${figures}'"
pass "board after settlement: last week's markets and results, ranking with all-time and head-to-head equal the stored figures; a settled kg figure follows current disclosure"

COMPLETED=1
echo "[${LANE_LABEL}] all checks passed"
