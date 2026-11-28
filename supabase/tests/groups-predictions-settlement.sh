#!/usr/bin/env bash

# groups-predictions-settlement.sh — the weekly close and settlement of group
# predictions, weekly results, the ranking derivations and the reset (a body
# of the groups-competitions lane).
#
# Contract: docs/specs/tech/group-predictions-contract.md ("Week and timing",
# "Markets", "Settlement and ranking"). Proves, against the real local stack
# (Sync push and the group-eval Edge drain write every figure) and a moved
# clock:
#
#   - posture: the results table is closed to every API role; the reset is
#     SECURITY DEFINER, pinned and service-role only; app tokens cannot run it;
#   - close: at the board's start open remainders expire (partly matched ones
#     too) and e1RM baselines freeze; close and settlement wait while group
#     evaluation is pending; a second close changes nothing; a post or
#     withdrawal whose clock predates the start is refused once the board has
#     closed; a session logged after close does not move a frozen baseline;
#   - settlement: one yes and one no per template, and every void case
#     (e1RM: no baseline, no counting set; cow_top: metric not selected,
#     nobody ranked, no CoW, cancelled, unavailable, matched before a cancel
#     that was replaced) while a match after the replacement settles; cow_top
#     waits for a final CoW; settlement never runs before the week ends;
#   - points: each match moves exactly the loser's stake to the winner, a void
#     moves nothing, a board's profits sum to zero; results rows (matched,
#     wins, losses, voids, profit) per AI, including an AI that never matched;
#     all-time and head-to-head derivations;
#   - finality: re-running close, settle and the sweep, or editing a settled
#     week's session, changes nothing; settled rows refuse updates;
#   - the hourly group_eval_sweep() closes and settles a due board; a failing
#     board is logged and does not stop another;
#   - reset: removes only that group's prediction data and keeps the setting
#     and the bettors.
#
# Direct-drain mode: the kick URL is unset and the sweep paused for the run,
# both restored on exit. Hermetic: per-run users and OAuth clients, deleted on
# exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-predictions-settlement"
FIXTURE_EMAIL_PREFIX="groups-prediction-settle"
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
PASSWORD="GroupsPredictionSettle!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
RUN_CLIENT_IDS=()
FAULT_CONSTRAINT=gps_close_fault
RUN_STARTED="$(run_psql "select clock_timestamp();")"
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"
set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  run_psql "set client_min_messages = warning;
    alter table app_public.group_prediction_boards drop constraint if exists ${FAULT_CONSTRAINT};" >/dev/null
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
    delete from public.app_logs where event like 'group.prediction_sweep_%' and created_at >= '${RUN_STARTED}';
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
  grep -q "ERROR:  $1" <<<"${out}" || fail "$2: expected $1, got: ${out}"
}
drain() {
  eval_drain
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}
# Session jobs enqueue comparison jobs; a second drain runs the ones queued
# after the first one's claim.
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

# post_at <clock-sql> <bettor> <week> <template> <parameters-json> <side> <price> <stake>
# posts on GROUP's board for <week> at the given clock; BODY and OFFER.
post_at() {
  local uid_var="$2_UID" client_var="$2_CLIENT"
  BODY="$(run_psql "select app_public.agent_group_prediction_post_at($1, '${!uid_var}', '${!client_var}', '${GROUP}',
    '$3', '$4', '$5'::jsonb, '$6', $7, $8, null, null, null);")"
  OFFER="$(jq -r '.offer.offer_id' <<<"${BODY}")"
}
# pair <clock-sql> <week> <template> <parameters-json> <yes> <no> <price> <yes-stake> <no-stake>:
# one resting yes and a no that matches it whole; MARKET.
pair() {
  post_at "$1" "$5" "$2" "$3" "$4" yes "$7" "$8"
  jq -e '.matches == []' <<<"${BODY}" >/dev/null || fail "pair $3 $4: the yes offer matched early"
  post_at "$1" "$6" "$2" "$3" "$4" no "$7" "$9"
  jq -e --argjson y "$8" --argjson n "$9" '.matches | length == 1 and .[0].yes_stake == $y and .[0].no_stake == $n' \
    <<<"${BODY}" >/dev/null || fail "pair $3 $4: expected one ${8}/${9} match, got ${BODY}"
  MARKET="$(jq -r '.market.market_id' <<<"${BODY}")"
}
market_field() { sql_value "select $2 from app_public.group_prediction_markets where id = '$1';"; }
expect_outcome() {
  local actual
  actual="$(market_field "$2" "outcome || ':' || coalesce(trim_scale(result_value)::text, '-') || ':' || coalesce(result_unit, '-')")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}
# result_line <week> <bettor>: profit/matched/wins/losses/voids, or "none".
result_line() {
  sql_value "select coalesce((select r.profit_cents || '/' || r.matched || '/' || r.wins || '/' || r.losses || '/' || r.voids
    from app_public.group_prediction_results r where r.group_id = '${GROUP}' and r.week_start = '$1'
      and r.bettor_id = '$(bettor_id "$2")'), 'none');"
}
close_at() { sql_value "select app_public.group_prediction_close_at($1, '${GROUP}', '$2');"; }
settle_at() { sql_value "select app_public.group_prediction_settle_at($1, '${GROUP}', '$2');"; }
week_clock() { printf "(lower(app_public.group_cow_bounds('UTC', '%s')) + interval '%s')" "$1" "$2"; }
# The board's own figures and results as one text, for finality checks.
snapshot() {
  sql_value "select md5(coalesce((select string_agg(x, '|' order by x) from (
      select b.week_start::text || b.closed_at::text || coalesce(b.settled_at::text, '-') as x from app_public.group_prediction_boards b
       where b.group_id = '${GROUP}'
      union all select m.id::text || coalesce(m.outcome, '-') || coalesce(m.result_value::text, '-') || coalesce(m.baseline_value::text, '-')
        from app_public.group_prediction_markets m where m.group_id = '${GROUP}'
      union all select r.bettor_id::text || r.week_start::text || r.profit_cents || r.matched || r.wins || r.losses || r.voids
        from app_public.group_prediction_results r where r.group_id = '${GROUP}'
      union all select o.id::text || o.remaining_cents || o.released_cents || coalesce(o.release_reason, '-')
        from app_public.group_prediction_offers o join app_public.group_prediction_markets m on m.id = o.market_id
       where m.group_id = '${GROUP}') s), ''));"
}

# Session builders (protocol 8 Sync push), as the week-summary lane.
e_set2() {
  jq -nc --arg id "$1" --arg se "$2" --argjson o "$3" --arg w "$4" --arg r "$5" --arg t "$6" --argjson c "$7" \
    --argjson del "${8:-null}" \
    '{type: "exercise_sets", id: $id, client_updated_at_ms: $c,
      fields: {session_exercise_id: $se, order_index: $o, weight_value: $w, reps_value: $r, set_type: $t,
               planned_weight_value: null, planned_reps_value: null, planned_set_type: null,
               performance_status: null, created_at: $c, updated_at: $c, deleted_at: $del}}'
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
def_link() {
  next_cuam
  push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}")"
  next_cuam
  push "$1" "link $2" "$(e_link "$2" "${GROUP}" "$3" "${CUAM}")"
}

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning an owner, three members and another group's owner"
provision OWNER owner
provision ALEX alex
provision BLAIR blair
provision CASEY casey
provision OTHER other
for who in OWNER ALEX BLAIR CASEY OTHER; do
  uid_var="${who}_UID"
  set_username "${!uid_var}" "settle-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
set_kick_url ""
set_sweep_active false

# The open board is next week's; keep the whole run inside this week.
until [[ "$(sql_value "select lower(app_public.group_cow_bounds('UTC', app_public.group_cow_week('UTC', clock_timestamp()) + 7))
    - clock_timestamp() > interval '20 minutes';")" == t ]]; do
  echo "[${LANE_LABEL}] waiting for the UTC week to turn"
  sleep 60
done

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Settle ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"UTC"}')"
expect_ok "owner creates the group"
GROUP="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OTHER_TOKEN}" group_create "$(jq -nc --arg n "Settle other ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"UTC"}')"
expect_ok "another owner creates group H"
HGROUP="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
CODE="$(jq -r '.code' <<<"${BODY}")"
for who in ALEX BLAIR CASEY; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${CODE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g, p_enabled:true}')"
expect_ok "predictions on in G"
rpc "${OTHER_TOKEN}" group_prediction_settings_set "$(jq -nc --arg g "${HGROUP}" '{p_group_id:$g, p_enabled:true}')"
expect_ok "predictions on in H"
exercise() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GROUP}" --arg n "$1" \
    '{p_group_id:$g, p_name:$n, p_load_input_mode:"total_load", p_source_exercise_id:null,
      p_bodyweight_contribution:0, p_default_metric:"e1rm"}')"
  expect_ok "exercise $1"
  jq -r '.exercise.group_exercise_id' <<<"${BODY}"
}
BENCH="$(exercise "Settle Bench")"
ROW="$(exercise "Settle Row")"

T="gps-${RUN_TAG}"
CUAM="$(now_ms)"
def_link "${ALEX_TOKEN}" "${T}-a-bench" "${BENCH}"
def_link "${BLAIR_TOKEN}" "${T}-b-bench" "${BENCH}"
def_link "${CASEY_TOKEN}" "${T}-c-bench" "${BENCH}"
drain "setup"

add_bettor A1 "${ALEX_UID}" "Claude"
add_bettor A2 "${ALEX_UID}" "Codex"
add_bettor B1 "${BLAIR_UID}" "Claude"
add_bettor C1 "${CASEY_UID}" "Claude"
add_bettor H1 "${OTHER_UID}" "Claude"

W="$(sql_value "select (app_public.group_cow_week('UTC', clock_timestamp()) + 7)::text;")"
W7="$(sql_value "select ('${W}'::date + 7)::text;")"
W14="$(sql_value "select ('${W}'::date + 14)::text;")"
W21="$(sql_value "select ('${W}'::date + 21)::text;")"
W28="$(sql_value "select ('${W}'::date + 28)::text;")"
PAST="$(sql_value "select (app_public.group_cow_week('UTC', clock_timestamp()) - 14)::text;")"
WS_MS="$(sql_value "select app_public.group_prediction_ms(lower(app_public.group_cow_bounds('UTC', '${W}')));")"

# Baselines: sessions started before next week (now, this week). Alex 100x5,
# Casey 80x5 on Bench; Blair has none.
NOW_MS="$(now_ms)"
sess "${ALEX_TOKEN}" "${T}-a0" $(( NOW_MS + 1000 )) "${T}-a-bench" a0:100:5:rir_1
sess "${CASEY_TOKEN}" "${T}-c0" $(( NOW_MS + 2000 )) "${T}-c-bench" c0:80:5:rir_1
drain2 "baselines"
A_BASE="$(sql_value "select trim_scale(value) from app_public.group_metric_set_scores where member_user_id = '${ALEX_UID}'
  and set_id = '${T}-a0' and metric = 'e1rm' and counting;")"
C_BASE="$(sql_value "select trim_scale(value) from app_public.group_metric_set_scores where member_user_id = '${CASEY_UID}'
  and set_id = '${T}-c0' and metric = 'e1rm' and counting;")"
[[ -n "${A_BASE}" && -n "${C_BASE}" ]] || fail "baseline sets were not scored"
pass "fixture: group G (UTC) with Alex, Blair, Casey; group H; Bench and Row; baselines scored; AIs A1, A2 (Alex), B1, C1"

# --- posture ---------------------------------------------------------------------

expect_sql "results table: RLS on, no policies, no API grants" "select (select c.relrowsecurity from pg_class c
    where c.oid = 'app_public.group_prediction_results'::regclass)::text
  || (select count(*) from pg_policies where schemaname = 'app_public' and tablename = 'group_prediction_results')
  || (select count(*) from unnest(array['anon','authenticated','service_role']) r(role)
      where has_table_privilege(r.role, 'app_public.group_prediction_results', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));" "true00"
expect_sql "reset: definer, pinned, service_role only" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_public' and p.proname = 'group_predictions_reset' and p.prosecdef
    and 'search_path=app_public, pg_temp' = any(p.proconfig) and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE');" 1
expect_sql "close, settle and sweep: internal, not definer" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) r(role)
  where n.nspname = 'app_public' and p.proname in ('group_prediction_close_at', 'group_prediction_settle_at',
      'group_prediction_sweep_at', 'group_prediction_sweep', 'group_prediction_all_time', 'group_prediction_head_to_head')
    and (has_function_privilege(r.role, p.oid, 'EXECUTE') or p.prosecdef);" 0
rpc "${OWNER_TOKEN}" group_predictions_reset "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
[[ "${STATUS}" != 200 ]] || fail "an app token ran the reset"
rpc "$(mint_token "${OWNER_TOKEN}" "${A1_CLIENT}")" group_predictions_reset "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
[[ "${STATUS}" != 200 ]] || fail "an OAuth token ran the reset"
pass "posture: results closed to API roles; reset definer + service role only; close/settle/sweep internal"

# --- next week's board: posts at the real clock ------------------------------------

NOW="clock_timestamp()"
pair "${NOW}" "${W}" e1rm_line "{\"member_user_id\":\"${ALEX_UID}\",\"group_exercise_id\":\"${BENCH}\",\"line\":105}" A1 B1 60 6 4
M_E1RM_YES="${MARKET}"
pair "${NOW}" "${W}" e1rm_line "{\"member_user_id\":\"${ALEX_UID}\",\"group_exercise_id\":\"${BENCH}\",\"line\":115}" B1 A2 50 5 5
M_E1RM_NO="${MARKET}"
pair "${NOW}" "${W}" e1rm_line "{\"member_user_id\":\"${BLAIR_UID}\",\"group_exercise_id\":\"${BENCH}\",\"line\":100}" A1 B1 50 3 3
M_E1RM_NO_BASE="${MARKET}"
pair "${NOW}" "${W}" e1rm_line "{\"member_user_id\":\"${CASEY_UID}\",\"group_exercise_id\":\"${BENCH}\",\"line\":100}" A2 B1 50 2 2
M_E1RM_NO_SET="${MARKET}"
pair "${NOW}" "${W}" sets_line "{\"member_user_id\":\"${BLAIR_UID}\",\"line\":5}" A2 A1 70 7 3
M_SETS_YES="${MARKET}"
pair "${NOW}" "${W}" sets_line "{\"member_user_id\":\"${ALEX_UID}\",\"line\":10}" B1 A1 50 4 4
M_SETS_NO="${MARKET}"
pair "${NOW}" "${W}" records_line '{"line":4}' B1 A1 50 5 5
M_REC_YES="${MARKET}"
pair "${NOW}" "${W}" records_line '{"line":5}' A1 A2 40 4 6
M_REC_NO="${MARKET}"
pair "${NOW}" "${W}" lead_change "{\"group_exercise_id\":\"${BENCH}\",\"metric\":\"e1rm\"}" A2 B1 50 1 1
M_LEAD_YES="${MARKET}"
pair "${NOW}" "${W}" lead_change "{\"group_exercise_id\":\"${ROW}\",\"metric\":\"e1rm\"}" A1 B1 50 2 2
M_LEAD_NO="${MARKET}"
pair "${NOW}" "${W}" cow_top "{\"member_user_id\":\"${BLAIR_UID}\",\"metric\":\"e1rm\"}" A1 B1 50 1 1
M_COW_YES="${MARKET}"
pair "${NOW}" "${W}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"e1rm\"}" B1 A1 50 1 1
M_COW_NO="${MARKET}"
pair "${NOW}" "${W}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"improvement\"}" A2 A1 50 1 1
M_COW_UNSELECTED="${MARKET}"
pair "${NOW}" "${W}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"volume\"}" B1 A2 50 1 1
M_COW_UNRANKED="${MARKET}"
# A partly matched offer (10 yes, 5 matched) and offers that never match.
post_at "${NOW}" A2 "${W}" sets_line "{\"member_user_id\":\"${CASEY_UID}\",\"line\":5}" yes 50 10
PARTIAL="${OFFER}"
post_at "${NOW}" B1 "${W}" sets_line "{\"member_user_id\":\"${CASEY_UID}\",\"line\":5}" no 50 5
M_PARTIAL="$(jq -r '.market.market_id' <<<"${BODY}")"
post_at "${NOW}" A1 "${W}" sets_line "{\"member_user_id\":\"${CASEY_UID}\",\"line\":10}" yes 50 3
UNMATCHED="${OFFER}"
post_at "${NOW}" C1 "${W}" records_line '{"line":20}' yes 30 2
C1_OFFER="${OFFER}"
expect_sql "the partial offer rests with 5.00 left" "select remaining_cents from app_public.group_prediction_offers where id = '${PARTIAL}';" 500

# The week's CoW on Bench (e1rm, volume), not final yet: seeded directly.
COW_W="$(new_uuid)"
seed_cow() { # seed_cow <id> <week> <metrics> <extra columns> <extra values>
  run_psql "begin; set local session_replication_role = replica;
    insert into app_public.group_cows(id, group_id, group_exercise_id, week_start, time_zone, starts_at, ends_at, metrics,
      create_key, created_by, available_at$4)
    select '$1', '${GROUP}', '${BENCH}', '$2', 'UTC', lower(r), upper(r), $3, 'seed-$1', '${OWNER_UID}', upper(r)$5
      from app_public.group_cow_bounds('UTC', '$2') r;
    commit;" >/dev/null
}
seed_cow "${COW_W}" "${W}" "array['e1rm','volume']" "" ""

# Nothing closes or settles before its time.
expect_sql "no close before the start" "select app_public.group_prediction_close_at($(week_clock "${W}" '-1 second'), '${GROUP}', '${W}');" f
expect_sql "no settlement before the end" "select app_public.group_prediction_settle_at($(week_clock "${W}" '7 days -1 second'), '${GROUP}', '${W}');" f
pass "board: 14 matched markets (every template, yes/no/void cases), a partial fill, unmatched offers, a non-final CoW"

# --- close -------------------------------------------------------------------------

# Pending evaluation of a pre-week session holds the close (the baselines
# would read stale scores); once drained, the board closes.
run_psql "insert into app_public.group_eval_queue(kind, member_user_id, session_id, causes)
  values ('session', '${ALEX_UID}', '${T}-a0', '{set}');" >/dev/null
[[ "$(close_at "$(week_clock "${W}" '1 hour')" "${W}")" == f ]] || fail "close must wait for pending evaluation"
expect_sql "the sweep counts it as waiting without closing" "select (w ->> 'waiting')::int >= 1
  and (select closed_at is null from app_public.group_prediction_boards where group_id = '${GROUP}' and week_start = '${W}')
  from app_public.group_prediction_sweep_at($(week_clock "${W}" '1 hour')) w;" t
drain2 "the pending baseline session"
[[ "$(close_at "$(week_clock "${W}" '1 hour')" "${W}")" == t ]] || fail "close at the start + 1h"
[[ "$(close_at "$(week_clock "${W}" '2 hours')" "${W}")" == f ]] || fail "a second close must change nothing"
expect_sql "open remainders expired, matched stake kept" "select string_agg(o.remaining_cents || '/' || o.released_cents || '/' || o.release_reason, ',' order by o.seq)
  from app_public.group_prediction_offers o where o.id in ('${PARTIAL}', '${UNMATCHED}', '${C1_OFFER}');" "0/500/expired,0/300/expired,0/200/expired"
expect_sql "no offer of the board stays open" "select count(*) from app_public.group_prediction_offers o
  join app_public.group_prediction_markets m on m.id = o.market_id where m.group_id = '${GROUP}' and o.remaining_cents > 0;" 0
expect_sql "Alex's baseline frozen at the 100x5 e1RM" "select trim_scale(baseline_value) || baseline_unit
  from app_public.group_prediction_markets where id = '${M_E1RM_YES}';" "${A_BASE}kg"
expect_sql "Casey's baseline frozen" "select trim_scale(baseline_value) from app_public.group_prediction_markets where id = '${M_E1RM_NO_SET}';" "${C_BASE}"
expect_sql "Blair has no baseline" "select coalesce(baseline_value::text, 'none') from app_public.group_prediction_markets where id = '${M_E1RM_NO_BASE}';" none
expect_sql "only e1RM lines carry a baseline" "select count(*) from app_public.group_prediction_markets
  where group_id = '${GROUP}' and baseline_value is not null and template <> 'e1rm_line';" 0
# A post or withdrawal whose clock was read before the start (it waited on the
# lock while the board closed) is refused.
expect_sql_error CONFLICT "posting on a closed board with a stale clock" "select app_public.agent_group_prediction_post_at(
  $(week_clock "${W}" '-1 minute'), '${A1_UID}', '${A1_CLIENT}', '${GROUP}', '${W}', 'records_line', '{\"line\":9}'::jsonb,
  'yes', 50, 1, null, null, null);"
expect_sql_error CONFLICT "withdrawing on a closed board with a stale clock" "select app_public.agent_group_prediction_withdraw_at(
  $(week_clock "${W}" '-1 minute'), '${A1_UID}', '${A1_CLIENT}', '${GROUP}', '${UNMATCHED}');"
pass "close: open remainders expire (partial too), baselines freeze, a second close is a no-op, stale-clock writes refused"

# --- the week: sessions through Sync and the evaluator ------------------------------

# Alex: 110x5 (a record on both boards, still #1) plus a warm-up and one more
# working set. Then Blair: 120x5 takes #1 from Alex (a lead change), and four
# more working sets. Casey and Row: nothing.
sess "${ALEX_TOKEN}" "${T}-a1" $(( WS_MS + 86400000 )) "${T}-a-bench" a1w:60:5:warm_up a1:110:5:rir_1 a1b:100:5:rir_1
drain2 "Alex's week"
sess "${BLAIR_TOKEN}" "${T}-b1" $(( WS_MS + 2 * 86400000 )) "${T}-b-bench" \
  b1:120:5:rir_1 b1b:100:5:rir_1 b1c:100:5:rir_1 b1d:100:5:rir_1 b1e:100:5:rir_1
drain2 "Blair's week"
# A late session started before the week (logged after close) beats every
# baseline; the frozen one stands.
sess "${ALEX_TOKEN}" "${T}-a2" $(( NOW_MS + 3000 )) "${T}-a-bench" a2:150:5:rir_1
drain2 "a late pre-week session"
expect_sql "the late session is now Alex's best before the week" "select (max(value) > ${A_BASE})::text
  from app_public.group_metric_set_scores where member_user_id = '${ALEX_UID}' and metric = 'e1rm' and counting;" true
expect_sql "the frozen baseline does not move" "select trim_scale(baseline_value) from app_public.group_prediction_markets where id = '${M_E1RM_YES}';" "${A_BASE}"
A_WEEK="$(sql_value "select trim_scale(value) from app_public.group_metric_set_scores where member_user_id = '${ALEX_UID}'
  and set_id = '${T}-a1' and metric = 'e1rm' and counting;")"
pass "week: Alex 110x5 and Blair 120x5 (lead change) scored; a late pre-week session leaves the baseline frozen"

# --- settlement --------------------------------------------------------------------

[[ "$(settle_at "$(week_clock "${W}" '7 days 1 hour')" "${W}")" == f ]] || fail "settlement must wait for the CoW"
expect_sql "a waiting board stores nothing" "select count(*) from app_public.group_prediction_markets where group_id = '${GROUP}' and outcome is not null;" 0
# The CoW is final: Blair #1 on e1RM, Alex #2; nobody ranked on Volume.
run_psql "begin; set local session_replication_role = replica;
  update app_public.group_cows set finalized_at = clock_timestamp(), final_outcome = 'ready',
    final_rankings = jsonb_build_array(
      jsonb_build_object('metric', 'e1rm', 'unit', 'kg', 'unavailableMemberIds', '[]'::jsonb, 'entries', jsonb_build_array(
        jsonb_build_object('memberId', '${BLAIR_UID}', 'value', 140, 'receivedAtUs', 1, 'rank', 1),
        jsonb_build_object('memberId', '${ALEX_UID}', 'value', 128, 'receivedAtUs', 1, 'rank', 2))),
      jsonb_build_object('metric', 'volume', 'unit', 'kg_reps', 'unavailableMemberIds', '[]'::jsonb, 'entries', '[]'::jsonb))
   where id = '${COW_W}';
  commit;" >/dev/null
# A pending comparison job of the group holds settlement; once drained, it settles.
run_psql "insert into app_public.group_metric_eval_queue(group_id, group_exercise_id, causes)
  values ('${GROUP}', '${ROW}', '{set}');" >/dev/null
[[ "$(settle_at "$(week_clock "${W}" '7 days 2 hours')" "${W}")" == f ]] || fail "settlement must wait for pending evaluation"
drain2 "the pending comparison"
[[ "$(settle_at "$(week_clock "${W}" '7 days 2 hours')" "${W}")" == t ]] || fail "settlement once the CoW is final"

expect_outcome "e1RM yes (110x5 vs 105% of 100x5)" "${M_E1RM_YES}" "yes:${A_WEEK}:kg"
expect_outcome "e1RM no (115%)" "${M_E1RM_NO}" "no:${A_WEEK}:kg"
expect_outcome "e1RM void: no baseline" "${M_E1RM_NO_BASE}" "void:-:-"
expect_outcome "e1RM void: no counting set in the week" "${M_E1RM_NO_SET}" "void:-:-"
expect_outcome "sets yes (Blair 5 working sets)" "${M_SETS_YES}" "yes:5:sets"
expect_outcome "sets no (Alex 2 working sets; the warm-up never counts)" "${M_SETS_NO}" "no:2:sets"
expect_outcome "records yes (4 boards taken)" "${M_REC_YES}" "yes:4:records"
expect_outcome "records no (line 5)" "${M_REC_NO}" "no:4:records"
expect_outcome "lead change yes (Bench 1RM: Alex → Blair)" "${M_LEAD_YES}" "yes:1:lead_changes"
expect_outcome "lead change no (Row)" "${M_LEAD_NO}" "no:0:lead_changes"
expect_outcome "CoW yes (Blair #1)" "${M_COW_YES}" "yes:1:place"
expect_outcome "CoW no (Alex #2)" "${M_COW_NO}" "no:2:place"
expect_outcome "CoW void: metric not selected" "${M_COW_UNSELECTED}" "void:-:-"
expect_outcome "CoW void: nobody ranked" "${M_COW_UNRANKED}" "void:-:-"
expect_outcome "the partial fill's market (Casey: no sessions)" "${M_PARTIAL}" "no:0:sets"
expect_sql "unmatched markets get no outcome" "select count(*) from app_public.group_prediction_markets m where m.group_id = '${GROUP}'
  and m.outcome is not null and not exists (select 1 from app_public.group_prediction_matches x where x.market_id = m.id);" 0
pass "settlement: yes and no per template; e1RM and cow_top void cases; cow_top waits for the final CoW"

# Hand-counted (stakes in points): A1 +4 -3 +4 -5 -4 -2 +1 +1; A2 +5 +3 +4 +1 -5;
# B1 -4 -5 -4 +5 -1 +2 -1 -1 +5; C1 never matched.
[[ "$(result_line "${W}" A1)" == "-400/10/4/4/2" ]] || fail "A1's week: $(result_line "${W}" A1)"
[[ "$(result_line "${W}" A2)" == "800/8/4/1/3" ]] || fail "A2's week: $(result_line "${W}" A2)"
[[ "$(result_line "${W}" B1)" == "-400/12/3/6/3" ]] || fail "B1's week: $(result_line "${W}" B1)"
[[ "$(result_line "${W}" C1)" == "0/0/0/0/0" ]] || fail "C1's week: $(result_line "${W}" C1)"
expect_sql "a board's profits sum to zero" "select sum(profit_cents) from app_public.group_prediction_results
  where group_id = '${GROUP}' and week_start = '${W}';" 0
# Each match moves exactly the loser's stake to the winner; a void nothing.
expect_sql "results equal the per-match transfers" "with per as (
    select x.yes_bettor_id as b, case m.outcome when 'yes' then x.no_stake_cents when 'no' then -x.yes_stake_cents else 0 end as p
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = '${GROUP}' and m.week_start = '${W}'
    union all
    select x.no_bettor_id, case m.outcome when 'no' then x.yes_stake_cents when 'yes' then -x.no_stake_cents else 0 end
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = '${GROUP}' and m.week_start = '${W}')
  select count(*) from app_public.group_prediction_results r
   where r.group_id = '${GROUP}' and r.week_start = '${W}'
     and r.profit_cents <> coalesce((select sum(p) from per where per.b = r.bettor_id), 0);" 0
pass "points: winners gain the losers' stakes, voids move nothing, the board sums to zero, per-AI rows (C1 with none)"

# --- later weeks: the other cow_top voids -------------------------------------------

# Each board is posted the day before its week starts (a moved clock).
DAY_BEFORE() { week_clock "$1" '-1 day'; }
pair "$(DAY_BEFORE "${W7}")" "${W7}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"e1rm\"}" A1 B1 50 1 1
M_COW_NONE="${MARKET}"
pair "$(DAY_BEFORE "${W7}")" "${W7}" sets_line "{\"member_user_id\":\"${ALEX_UID}\",\"line\":5}" A1 B1 50 2 2
M_W7_SETS="${MARKET}"
pair "$(DAY_BEFORE "${W14}")" "${W14}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"e1rm\"}" A1 B1 50 1 1
M_COW_CANCELLED="${MARKET}"
pair "$(DAY_BEFORE "${W21}")" "${W21}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"e1rm\"}" A1 B1 50 1 1
M_COW_UNAVAILABLE="${MARKET}"
seed_cow "$(new_uuid)" "${W14}" "array['e1rm']" ", cancelled_at" ", clock_timestamp()"
seed_cow "$(new_uuid)" "${W21}" "array['e1rm']" ", finalized_at, final_outcome, final_rankings" \
  ", clock_timestamp(), 'unavailable', '[]'::jsonb"
for week in "${W7}" "${W14}" "${W21}"; do
  [[ "$(settle_at "$(week_clock "${week}" '7 days 1 hour')" "${week}")" == t ]] || fail "settle ${week} (closes first)"
done
expect_outcome "CoW void: no CoW that week" "${M_COW_NONE}" "void:-:-"
expect_outcome "sets no (Alex has no sessions that week)" "${M_W7_SETS}" "no:0:sets"
expect_outcome "CoW void: cancelled" "${M_COW_CANCELLED}" "void:-:-"
expect_outcome "CoW void: unavailable" "${M_COW_UNAVAILABLE}" "void:-:-"
# A CoW cancelled 12 hours before its week and replaced: the market matched
# before the cancel voids; one first matched after it settles on the
# replacement (Blair #1).
pair "$(DAY_BEFORE "${W28}")" "${W28}" cow_top "{\"member_user_id\":\"${ALEX_UID}\",\"metric\":\"e1rm\"}" A2 B1 50 1 1
M_COW_BEFORE_CANCEL="${MARKET}"
seed_cow "$(new_uuid)" "${W28}" "array['e1rm']" ", cancelled_at" ", lower(r) - interval '12 hours'"
pair "$(week_clock "${W28}" '-6 hours')" "${W28}" cow_top "{\"member_user_id\":\"${BLAIR_UID}\",\"metric\":\"e1rm\"}" A2 B1 50 1 1
M_COW_AFTER_REPLACE="${MARKET}"
seed_cow "$(new_uuid)" "${W28}" "array['e1rm']" ", finalized_at, final_outcome, final_rankings" \
  ", clock_timestamp(), 'ready', jsonb_build_array(jsonb_build_object('metric', 'e1rm', 'unit', 'kg',
    'unavailableMemberIds', '[]'::jsonb, 'entries', jsonb_build_array(jsonb_build_object('memberId', '${BLAIR_UID}',
    'value', 140, 'receivedAtUs', 1, 'rank', 1))))"
[[ "$(settle_at "$(week_clock "${W28}" '7 days 1 hour')" "${W28}")" == t ]] || fail "settle ${W28}"
expect_outcome "CoW void: matched before a cancel, even with a replacement" "${M_COW_BEFORE_CANCEL}" "void:-:-"
expect_outcome "CoW yes: first matched after the replacement" "${M_COW_AFTER_REPLACE}" "yes:1:place"
[[ "$(result_line "${W7}" A1)" == "-200/2/0/1/1" ]] || fail "A1's second week: $(result_line "${W7}" A1)"
expect_sql "settling closes a board first" "select count(*) from app_public.group_prediction_boards
  where group_id = '${GROUP}' and week_start in ('${W7}', '${W14}', '${W21}') and closed_at is not null and settled_at >= closed_at;" 3
pass "cow_top voids: no CoW, cancelled (also when replaced after the match), unavailable; a replacement settles later matches"

# --- ranking derivations ------------------------------------------------------------

expect_sql "all-time: the sum of A1's weeks" "select profit_cents || '/' || matched || '/' || wins || '/' || losses || '/' || voids || '/' || weeks
  from app_public.group_prediction_all_time('${GROUP}') where bettor_id = '$(bettor_id A1)';" "-600/14/4/5/5/4"
expect_sql "all-time equals the results summed" "select count(*) from app_public.group_prediction_all_time('${GROUP}') a
  where a.profit_cents <> (select sum(r.profit_cents) from app_public.group_prediction_results r
    where r.group_id = '${GROUP}' and r.bettor_id = a.bettor_id);" 0
expect_sql "head-to-head A1 v B1" "select matched || '/' || wins || '/' || losses || '/' || voids || '/' || profit_cents
  from app_public.group_prediction_head_to_head('${GROUP}') where bettor_id = '$(bettor_id A1)' and opponent_id = '$(bettor_id B1)';" \
  "11/4/3/4/100"
expect_sql "head-to-head is symmetric" "select count(*) from app_public.group_prediction_head_to_head('${GROUP}') a
  left join app_public.group_prediction_head_to_head('${GROUP}') b on b.bettor_id = a.opponent_id and b.opponent_id = a.bettor_id
  where b.bettor_id is null or b.matched <> a.matched or b.wins <> a.losses or b.voids <> a.voids or b.profit_cents <> -a.profit_cents;" 0
expect_sql "head-to-head of two AIs of one user (A1 v A2)" "select matched || '/' || wins || '/' || losses || '/' || voids || '/' || profit_cents
  from app_public.group_prediction_head_to_head('${GROUP}') where bettor_id = '$(bettor_id A1)' and opponent_id = '$(bettor_id A2)';" \
  "3/0/2/1/-700"
pass "ranking: all-time per AI is the sum of its weeks; head-to-head per pair, symmetric, same-user AIs included"

# --- finality ----------------------------------------------------------------------

BEFORE="$(snapshot)"
[[ "$(settle_at "$(week_clock "${W}" '8 days')" "${W}")" == f ]] || fail "a second settlement must change nothing"
[[ "$(close_at "$(week_clock "${W}" '8 days')" "${W}")" == f ]] || fail "closing a settled board must change nothing"
run_psql "select app_public.group_prediction_sweep_at(clock_timestamp());" >/dev/null
# Blair deletes the 120x5 and Alex edits the 110x5 up: records void and the lead
# moves, but settled weeks never resettle.
next_cuam
push "${BLAIR_TOKEN}" "delete Blair's best" "$(e_set2 "${T}-b1" "${T}-b1-se" 0 120 5 rir_1 "${CUAM}" "${CUAM}")"
next_cuam
push "${ALEX_TOKEN}" "edit Alex's week best" "$(e_set2 "${T}-a1" "${T}-a1-se" 1 130 5 rir_1 "${CUAM}")"
drain2 "edits after settlement"
expect_sql "the live figures moved" "select app_public.group_prediction_week_sets('${GROUP}', '${BLAIR_UID}',
  ${WS_MS}, ${WS_MS} + 7 * 86400000);" 4
[[ "$(settle_at "$(week_clock "${W}" '9 days')" "${W}")" == f ]] || fail "settlement after the edits must change nothing"
[[ "$(snapshot)" == "${BEFORE}" ]] || fail "a settled week changed"
expect_sql_error "A settled prediction is final" "a settled market refuses an update" \
  "update app_public.group_prediction_markets set outcome = 'no' where id = '${M_E1RM_YES}';"
expect_sql_error "A settled prediction is final" "a results row refuses an update" \
  "update app_public.group_prediction_results set profit_cents = 0 where group_id = '${GROUP}' and week_start = '${W}';"
pass "finality: re-running close/settle/sweep or editing settled sessions changes nothing; settled rows refuse updates"

# --- the hourly sweep ---------------------------------------------------------------

# Two boards already past their end, seeded directly with one open offer each:
# G's settles through group_eval_sweep(); H's fails (a fault constraint) and
# is logged without stopping G's.
seed_past_board() { # seed_past_board <group> <bettor>: prints the offer id
  local uid_var="$2_UID" client_var="$2_CLIENT"
  run_psql "with b as (
      insert into app_public.group_prediction_boards(group_id, week_start, time_zone, starts_at, ends_at)
      select '$1', '${PAST}', 'UTC', lower(r), upper(r) from app_public.group_cow_bounds('UTC', '${PAST}') r returning *),
    bt as (
      insert into app_public.group_prediction_bettors(user_id, client_id) values ('${!uid_var}', '${!client_var}')
      on conflict (user_id, client_id) do update set client_id = excluded.client_id returning id),
    m as (
      insert into app_public.group_prediction_markets(group_id, week_start, template, line)
      select b.group_id, b.week_start, 'records_line', 1 from b returning id)
    insert into app_public.group_prediction_offers(market_id, bettor_id, side, price, stake_cents, remaining_cents)
    select m.id, bt.id, 'yes', 50, 700, 700 from m, bt returning id;"
}
PAST_OFFER="$(seed_past_board "${GROUP}" A1)"
seed_past_board "${HGROUP}" H1 >/dev/null
run_psql "alter table app_public.group_prediction_boards add constraint ${FAULT_CONSTRAINT}
  check (group_id <> '${HGROUP}' or closed_at is null) not valid;" >/dev/null
run_psql "select app_public.group_eval_sweep();" >/dev/null
expect_sql "the sweep closed and settled G's due board" "select (closed_at is not null and settled_at is not null)::text
  from app_public.group_prediction_boards where group_id = '${GROUP}' and week_start = '${PAST}';" true
expect_sql "its open offer expired" "select release_reason from app_public.group_prediction_offers where id = '${PAST_OFFER}';" expired
[[ "$(result_line "${PAST}" A1)" == "0/0/0/0/0" ]] || fail "the swept board's row: $(result_line "${PAST}" A1)"
expect_sql "H's failing board stays open" "select (closed_at is null)::text from app_public.group_prediction_boards
  where group_id = '${HGROUP}' and week_start = '${PAST}';" true
expect_sql "the failure is logged with its board" "select count(*) from public.app_logs where event = 'group.prediction_sweep_failed'
  and created_at >= '${RUN_STARTED}' and context ->> 'group_id' = '${HGROUP}' and context ->> 'week_start' = '${PAST}'
  and context ->> 'sqlstate' = '23514';" 1
expect_sql "the work is recorded" "select count(*) > 0 from public.app_logs where event = 'group.prediction_sweep_work'
  and created_at >= '${RUN_STARTED}' and (context ->> 'settled')::int >= 1 and (context ->> 'failed')::int >= 1;" t
run_psql "alter table app_public.group_prediction_boards drop constraint ${FAULT_CONSTRAINT};" >/dev/null
expect_sql "the next sweep has no failure" "select app_public.group_prediction_sweep_at(clock_timestamp()) ->> 'failed';" 0
expect_sql "and settles H's board" "select (settled_at is not null)::text from app_public.group_prediction_boards
  where group_id = '${HGROUP}' and week_start = '${PAST}';" true
LOGS_BEFORE="$(sql_value "select count(*) from public.app_logs where event like 'group.prediction_sweep_%';")"
expect_sql "an idle sweep does no work" "select (w ->> 'closed')::int + (w ->> 'settled')::int + (w ->> 'failed')::int
  from app_public.group_prediction_sweep_at(clock_timestamp()) w;" 0
expect_sql "an idle sweep writes no log row" "select count(*) from public.app_logs where event like 'group.prediction_sweep_%';" "${LOGS_BEFORE}"
pass "sweep: group_eval_sweep() closes and settles due boards; a failing board is logged and retried, the others proceed"

# --- reset -------------------------------------------------------------------------

srpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" --data "$2" "${API_URL}/rest/v1/rpc/$1"
}
H_BEFORE="$(sql_value "select count(*) from app_public.group_prediction_offers o join app_public.group_prediction_markets m
  on m.id = o.market_id where m.group_id = '${HGROUP}';")"
BETTORS_BEFORE="$(sql_value "select count(*) from app_public.group_prediction_bettors where user_id in ('${ALEX_UID}', '${BLAIR_UID}');")"
srpc group_predictions_reset "$(jq -nc --arg g "${GROUP}" '{p_group_id:$g}')"
expect_ok "service role resets G"
check "six boards deleted" '.boards_deleted == 6'
expect_sql "G holds no prediction data" "select (select count(*) from app_public.group_prediction_boards where group_id = '${GROUP}')
  + (select count(*) from app_public.group_prediction_markets where group_id = '${GROUP}')
  + (select count(*) from app_public.group_prediction_results where group_id = '${GROUP}')
  + (select count(*) from app_public.group_prediction_matches x where x.market_id in ('${M_E1RM_YES}', '${M_COW_NONE}'))
  + (select count(*) from app_public.group_prediction_offers o where o.id in ('${PARTIAL}', '${PAST_OFFER}'));" 0
expect_sql "H is untouched" "select count(*) from app_public.group_prediction_offers o join app_public.group_prediction_markets m
  on m.id = o.market_id where m.group_id = '${HGROUP}';" "${H_BEFORE}"
expect_sql "the setting and the bettors stay" "select (select enabled from app_public.group_prediction_settings where group_id = '${GROUP}')::text
  || (select count(*) from app_public.group_prediction_bettors where user_id in ('${ALEX_UID}', '${BLAIR_UID}'));" "true${BETTORS_BEFORE}"
expect_sql "operator SQL resets H" "select app_public.group_predictions_reset('${HGROUP}') ->> 'boards_deleted';" 1
pass "reset: removes only that group's boards, markets, offers, matches and results; keeps the setting and bettors"

COMPLETED=1
pass "group predictions: close, settlement, results, ranking, sweep and reset (run ${RUN_TAG})"
