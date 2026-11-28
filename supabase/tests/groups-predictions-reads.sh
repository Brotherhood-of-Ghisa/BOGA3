#!/usr/bin/env bash

# groups-predictions-reads.sh — the member read path of group predictions (a
# body of the groups-contract lane).
#
# Contract: docs/specs/tech/group-predictions-contract.md ("Access", "Member
# screens"). Proves, against the real local stack:
#
#   - posture: the four readers are SECURITY DEFINER, pinned and
#     anon+authenticated only; every helper is executable by no API role;
#   - access: AUTH_REQUIRED, AGENT_FORBIDDEN (an OAuth token), UPDATE_REQUIRED;
#     a stranger, a former member, the setting off and a missing group are one
#     byte-identical NOT_FOUND; any member (not only owners) reads; a group
#     without a zone has no weeks;
#   - shapes: the board (next week's markets with best prices, open stake and
#     matched bets; a withdrawn-only market is absent; this week's matched bets
#     awaiting a result), the market thread (offers with notes, counters,
#     withdrawals, matches, the week), the ranking (week and all-time profit,
#     matched bets, head-to-head, recent weeks; ordered by all-time then week profit; profits sum to zero)
#     and the history (settled weeks, who won what, keyset pages, bad cursors);
#   - privacy: no payload carries a walk-away price, and no agent-facing
#     function was changed by this path (notes reach members only).
#
# Hermetic: per-run users and OAuth clients, deleted on exit with everything
# they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-predictions-reads"
FIXTURE_EMAIL_PREFIX="groups-predictions-reads"
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

cleanup() {
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
expect_sql_error() {
  local out
  if out="$(run_psql "$3" 2>&1)"; then fail "$2: expected $1, the statement succeeded"; fi
  grep -q "ERROR:  $1:" <<<"${out}" || fail "$2: expected $1, got: ${out}"
}

# srpc <function> <json-body>: the agent API's service-role call.
srpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$2" "${API_URL}/rest/v1/rpc/$1"
}
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
# post <bettor> <week> <template> <parameters-json> <side> <price> <stake> [extra-json]: the agent write at the
# current clock, for the open week.
post() {
  local uid_var="$1_UID" client_var="$1_CLIENT" extra="${8:-}"
  [[ -n "${extra}" ]] || extra='{}'
  srpc agent_group_prediction_post "$(jq -nc --arg o "${!uid_var}" --arg c "${!client_var}" --arg g "${GROUP}" \
    --arg wk "$2" --arg t "$3" --argjson p "$4" --arg s "$5" --argjson pr "$6" --argjson st "$7" --argjson x "${extra}" \
    '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_week_start:$wk, p_template:$t, p_parameters:$p,
      p_side:$s, p_price:$pr, p_stake:$st} + $x')"
}
# post_ok <context> <post args...>: sets OFFER and MARKET.
post_ok() {
  local context="$1"
  shift
  post "$@"
  expect_ok "${context}"
  OFFER="$(jq -r '.offer.offer_id' <<<"${BODY}")"
  MARKET="$(jq -r '.market.market_id' <<<"${BODY}")"
}
# post_past <bettor> <template> <parameters-json> <side> <price> <stake>: posts to this week's board with the
# clock a week back (the board was open then).
post_past() {
  local uid_var="$1_UID" client_var="$1_CLIENT"
  run_psql "select app_public.agent_group_prediction_post_at(clock_timestamp() - interval '7 days',
    '${!uid_var}', '${!client_var}', '${GROUP}', '${THIS_WEEK}', '$2', '$3'::jsonb, '$4', $5, $6, null, null, null);" >/dev/null
}
records() { printf '{"line":%s}' "$1"; }
sets() { jq -nc --arg m "$1" --argjson l "$2" '{member_user_id:$m, line:$l}'; }
group_body() { jq -nc --arg g "$1" '{p_group_id:$g}'; }
market_body() { jq -nc --arg g "$1" --arg m "$2" '{p_group_id:$g, p_market_id:$m}'; }
history_body() { jq -nc --arg g "$1" --argjson b "$2" --argjson l "$3" '{p_group_id:$g, p_before:$b, p_limit:$l}'; }
set_body() { jq -nc --arg g "$1" --argjson e "$2" '{p_group_id:$g, p_enabled:$e}'; }
# A reader's body for each of the four.
reader_body() {
  case "$1" in
    group_prediction_market) market_body "$2" "$(new_uuid)" ;;
    *) group_body "$2" ;;
  esac
}
READERS="group_prediction_board group_prediction_market group_prediction_ranking group_prediction_history"
no_walk_away() { ! grep -q 'walk_away' <<<"${BODY}" || fail "$1: a payload must never carry a walk-away price"; }

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning owner, admin, two members, a former member and a stranger"
provision OWNER owner
provision ADMIN admin
provision ALEX alex
provision BLAIR blair
provision FORMER former
provision STRANGER stranger
for who in OWNER ADMIN ALEX BLAIR FORMER STRANGER; do
  uid_var="${who}_UID"
  set_username "${!uid_var}" "reads-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
MISSING_GROUP="$(new_uuid)"

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Predictions reads ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"UTC"}')"
expect_ok "owner creates the group"
GROUP="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(group_body "${GROUP}")"
CODE="$(jq -r '.code' <<<"${BODY}")"
for who in ADMIN ALEX BLAIR FORMER; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${CODE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
rpc "${OWNER_TOKEN}" group_set_role "$(jq -nc --arg g "${GROUP}" --arg u "${ADMIN_UID}" '{p_group_id:$g, p_user_id:$u, p_role:"admin"}')"
expect_ok "admin role"
rpc "${FORMER_TOKEN}" group_leave "$(group_body "${GROUP}")"
expect_ok "former member leaves"
# This week's board is posted to with the clock a week back, so members must
# have joined before then.
run_psql "update app_public.group_memberships set joined_at = joined_at - interval '14 days' where group_id = '${GROUP}';" >/dev/null
rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "No zone reads ${RUN_TAG}" '{p_name:$n, p_description:null}')"
expect_ok "a group without a zone"
NOZONE="$(jq -r '.group_id' <<<"${BODY}")"
THIS_WEEK="$(sql_value "select app_public.group_cow_week('UTC', clock_timestamp())::text;")"
OPEN_WEEK="$(sql_value "select (app_public.group_cow_week('UTC', clock_timestamp()) + 7)::text;")"
add_bettor A1 "${ALEX_UID}" "Claude"
add_bettor A2 "${ALEX_UID}" "Codex"
add_bettor B "${BLAIR_UID}" "Claude"
add_bettor C "${OWNER_UID}" "Claude"
add_bettor D "${ADMIN_UID}" "Claude"

# --- posture ------------------------------------------------------------------------

PRED_FUNCS="n.nspname = 'app_public' and (p.proname like 'group\_prediction\_%' or p.proname like 'agent\_group\_prediction\_%')"
expect_sql "readers: definer, pinned, anon+authenticated only" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ${PRED_FUNCS} and p.proname in ('group_prediction_board','group_prediction_market','group_prediction_ranking','group_prediction_history')
    and p.prosecdef and 'search_path=app_public, pg_temp' = any(p.proconfig)
    and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not has_function_privilege('service_role', p.oid, 'EXECUTE');" 4
expect_sql "reader helpers: no API role executes them, all pinned, none definer" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon','authenticated','service_role']) r(role)
  where ${PRED_FUNCS} and (p.proname like 'group\_prediction\_reader\_%' or p.proname in ('group_prediction_require_reader',
      'group_prediction_matched_markets_json'))
    and (has_function_privilege(r.role, p.oid, 'EXECUTE') or p.prosecdef
      or not 'search_path=app_public, pg_temp' = any(p.proconfig));" 0
pass "posture: the four readers are definer, pinned and anon+authenticated; every helper is closed"

# --- access --------------------------------------------------------------------------

rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_ok "owner turns predictions on"
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${NOZONE}" true)"
expect_ok "owner turns predictions on for the zoneless group"
rpc "${OWNER_TOKEN}" group_prediction_board "$(group_body "${MISSING_GROUP}")"
expect_error NOT_FOUND "a missing group"
missing="${BODY}"
for fn in ${READERS}; do
  body="$(reader_body "${fn}" "${GROUP}")"
  rpc "${ANON_KEY}" "${fn}" "${body}"
  expect_error AUTH_REQUIRED "${fn}: anon"
  rpc "$(mint_token "${OWNER_TOKEN}" "${A1_CLIENT}")" "${fn}" "${body}"
  expect_error AGENT_FORBIDDEN "${fn}: an OAuth token"
  GROUP_CONTRACT_HEADER="x-boga-group-contract: 3" rpc "${OWNER_TOKEN}" "${fn}" "${body}"
  expect_error UPDATE_REQUIRED "${fn}: an old contract"
  for who in STRANGER FORMER; do
    token_var="${who}_TOKEN"
    rpc "${!token_var}" "${fn}" "${body}"
    expect_error NOT_FOUND "${fn}: ${who}"
    [[ "${BODY}" == "${missing}" ]] || fail "${fn}: ${who} must be byte-identical to a missing group"
  done
  rpc "${OWNER_TOKEN}" "${fn}" "$(reader_body "${fn}" "${MISSING_GROUP}")"
  [[ "${BODY}" == "${missing}" ]] || fail "${fn}: a missing group must be the one NOT_FOUND"
done
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" false)"
expect_ok "owner turns predictions off"
for fn in ${READERS}; do
  rpc "${ALEX_TOKEN}" "${fn}" "$(reader_body "${fn}" "${GROUP}")"
  expect_error NOT_FOUND "${fn}: the setting is off"
  [[ "${BODY}" == "${missing}" ]] || fail "${fn}: the setting off must be byte-identical to a missing group"
done
rpc "${OWNER_TOKEN}" group_prediction_settings_set "$(set_body "${GROUP}" true)"
expect_ok "owner turns predictions back on"
pass "access: AUTH_REQUIRED, AGENT_FORBIDDEN, UPDATE_REQUIRED; stranger, former member, setting off and missing group are one NOT_FOUND"

# --- empty ----------------------------------------------------------------------------

for who in OWNER ADMIN ALEX BLAIR; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_prediction_board "$(group_body "${GROUP}")"
  expect_ok "${who} reads the board"
done
check "an empty board: this week closed, next week open, no markets" \
  '.group_id == $g and .time_zone == "UTC" and .this_week.week_start == $t and .this_week.state == "closed" and .this_week.markets == []
   and .next_week.week_start == $o and .next_week.state == "open" and .next_week.markets == []
   and .next_week.starts_at_ms == .this_week.ends_at_ms and .next_week.ends_at_ms > .next_week.starts_at_ms' \
  --arg g "${GROUP}" --arg t "${THIS_WEEK}" --arg o "${OPEN_WEEK}"
rpc "${OWNER_TOKEN}" group_prediction_ranking "$(group_body "${GROUP}")"
expect_ok "empty ranking"
check "no settled week, no rows" '. == {group_id: $g, week_start: null, rows: []}' --arg g "${GROUP}"
rpc "${OWNER_TOKEN}" group_prediction_history "$(history_body "${GROUP}" null 4)"
expect_ok "empty history"
check "no settled week" '. == {group_id: $g, weeks: [], next_cursor: null}' --arg g "${GROUP}"
rpc "${OWNER_TOKEN}" group_prediction_board "$(group_body "${NOZONE}")"
expect_ok "a group without a zone"
check "no zone, no weeks" '. == {group_id: $g, time_zone: null, this_week: null, next_week: null}' --arg g "${NOZONE}"
pass "empty: members read, a new group has no markets, no ranking and no history, a zoneless group has no weeks"

# --- the board ------------------------------------------------------------------------

# Records market 3: A1 rests a yes @60 with a note and a private walk-away
# price; B's no @50 crosses it and matches at 60 (yes 6.00, no 4.00).
post_ok "A1 rests a yes" A1 "${OPEN_WEEK}" records_line "$(records 3)" yes 60 10 '{"p_walk_away_price":70,"p_note":"Alex thinks it is quiet"}'
RECORDS_MARKET="${MARKET}"; A1_YES="${OFFER}"
post_ok "B takes part of it" B "${OPEN_WEEK}" records_line "$(records 3)" no 50 4 '{"p_note":"Blair sees a busy week"}'
B_NO="${OFFER}"
# Sets market 10 on Blair: A2 rests a no @30 with a walk-away price; A1 counters inside it.
post_ok "A2 rests a no" A2 "${OPEN_WEEK}" sets_line "$(sets "${BLAIR_UID}" 10)" no 30 5 '{"p_walk_away_price":20,"p_note":"Blair skips leg day"}'
SETS_MARKET="${MARKET}"; A2_NO="${OFFER}"
post_ok "A1 counters inside the walk-away price" A1 "${OPEN_WEEK}" sets_line "$(sets "${BLAIR_UID}" 10)" yes 25 3 \
  "$(jq -nc --arg a "${A2_NO}" '{p_template:null, p_parameters:null, p_side:null, p_answers_offer_id:$a}')"
A1_COUNTER="${OFFER}"
check "the counter matched at its price" '.matches | length == 1 and .[0].via == "counter" and .[0].price == 25'
# A withdrawn-only market, and one that only rests.
post_ok "B rests a yes on a records line" B "${OPEN_WEEK}" records_line "$(records 7)" yes 40 2
WITHDRAWN_MARKET="${MARKET}"; B_WITHDRAWN="${OFFER}"
srpc agent_group_prediction_withdraw "$(jq -nc --arg o "${BLAIR_UID}" --arg c "${B_CLIENT}" --arg g "${GROUP}" --arg x "${B_WITHDRAWN}" \
  '{p_owner:$o, p_client_id:$c, p_group_id:$g, p_offer_id:$x}')"
expect_ok "B withdraws"
post_ok "C rests a no" C "${OPEN_WEEK}" records_line "$(records 12)" no 80 5 '{"p_note":"Owner expects fewer records"}'
RESTING_MARKET="${MARKET}"
post_ok "D rests another yes at a higher price" D "${OPEN_WEEK}" records_line "$(records 12)" yes 30 2
# This week: the board was open a week ago. D and C cross there.
post_past C records_line '{"line":2}' yes 50 5
post_past D records_line '{"line":2}' no 50 5
run_psql "select app_public.group_prediction_close_at(clock_timestamp(), '${GROUP}', '${THIS_WEEK}');" >/dev/null
THIS_MARKET="$(sql_value "select id from app_public.group_prediction_markets where group_id = '${GROUP}' and week_start = '${THIS_WEEK}';")"

rpc "${BLAIR_TOKEN}" group_prediction_board "$(group_body "${GROUP}")"
expect_ok "a plain member reads the board"
no_walk_away "board"
check "next week lists open and matched markets, not the withdrawn one" \
  '.next_week.markets | map(.market.market_id) | sort == ([$r, $s, $x] | sort)' \
  --arg r "${RECORDS_MARKET}" --arg s "${SETS_MARKET}" --arg x "${RESTING_MARKET}"
check "a market with an open offer and a matched bet" \
  '.next_week.markets[] | select(.market.market_id == $r) | .open_offers == 1 and .best_yes == 60 and .best_no == null
    and .open_stake == 4 and .matched_bets == 1 and .last_price == 60 and .market.template == "records_line"
    and .market.parameters == {line: 3} and .market.member == null and .market.exercise_name == null and .market.outcome == null' \
  --arg r "${RECORDS_MARKET}"
check "a member market names its member; the counter's remainder and the answered remainder both rest" \
  '.next_week.markets[] | select(.market.market_id == $s) | .market.member.user_id == $b and (.market.member.username | startswith("reads-blair"))
    and .open_offers == 2 and .best_yes == 25 and .best_no == 30 and .open_stake == 1.36 and .matched_bets == 1 and .last_price == 25' \
  --arg s "${SETS_MARKET}" --arg b "${BLAIR_UID}"
check "resting offers on both sides show the best prices" \
  '.next_week.markets[] | select(.market.market_id == $x) | .open_offers == 2 and .best_yes == 30 and .best_no == 80 and .open_stake == 7
    and .matched_bets == 0 and .last_price == null' --arg x "${RESTING_MARKET}"
check "this week's matched bets await a result" \
  '.this_week.state == "closed" and (.this_week.markets | length == 1) and .this_week.markets[0].market.market_id == $m
    and (.this_week.markets[0].bets | length == 1) and .this_week.markets[0].bets[0].winner == null
    and .this_week.markets[0].bets[0].yes_bettor.display_name == "reads-owner-\($t) · Claude"
    and .this_week.markets[0].bets[0].no_bettor.display_name == "reads-admin-\($t) · Claude"
    and .this_week.markets[0].bets[0].price == 50 and .this_week.markets[0].bets[0].yes_stake == 5
    and .this_week.markets[0].bets[0].no_stake == 5 and .this_week.markets[0].bets[0].yes_bettor.current_member == true' \
  --arg m "${THIS_MARKET}" --arg t "${RUN_TAG}"
pass "board: next week's markets with best prices, open stake and matched bets; this week's matched bets; no walk-away price"

# --- the market thread -----------------------------------------------------------------

rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${GROUP}" "${RECORDS_MARKET}")"
expect_ok "a member reads a market thread"
no_walk_away "market"
check "the thread: both offers with their notes, the match, the week" \
  '.group_id == $g and .market.market_id == $r and .week.week_start == $o and .week.state == "open"
   and (.offers | map(.offer_id) == [$a, $b]) and .offers[0].note == "Alex thinks it is quiet" and .offers[1].note == "Blair sees a busy week"
   and .offers[0].state == "open" and .offers[0].stake == 10 and .offers[0].matched == 6 and .offers[0].remaining == 4
   and .offers[0].live == true and .offers[1].state == "filled" and .offers[1].live == false and .offers[1].side == "no"
   and .offers[0].bettor.display_name == "reads-alex-\($t) · Claude" and .offers[0].bettor.member.user_id == $alex
   and (.matches | length == 1) and .matches[0].price == 60 and .matches[0].yes_stake == 6 and .matches[0].no_stake == 4
   and .matches[0].yes_offer_id == $a and .matches[0].no_offer_id == $b and .matches[0].winner == null and .matches[0].via == "cross"' \
  --arg g "${GROUP}" --arg r "${RECORDS_MARKET}" --arg o "${OPEN_WEEK}" --arg a "${A1_YES}" --arg b "${B_NO}" \
  --arg t "${RUN_TAG}" --arg alex "${ALEX_UID}"
rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${GROUP}" "${SETS_MARKET}")"
expect_ok "a counter thread"
check "the counter names the offer it answers and matched at its own price" \
  '(.offers | map(select(.answers_offer_id == $n)) | length == 1) and .offers[0].offer_id == $n and .offers[1].offer_id == $c
   and .offers[1].answers_offer_id == $n and .matches[0].via == "counter" and .matches[0].price == 25
   and .market.exercise_name == null and .market.member.user_id == $b' \
  --arg n "${A2_NO}" --arg c "${A1_COUNTER}" --arg b "${BLAIR_UID}"
rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${GROUP}" "${WITHDRAWN_MARKET}")"
expect_ok "a withdrawn-only market has a thread"
check "the withdrawal shows" '(.offers | length == 1) and .offers[0].state == "withdrawn" and .offers[0].remaining == 0
  and .offers[0].released == 2 and .offers[0].released_at_ms != null and .offers[0].live == false and .matches == []'
rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${GROUP}" "${THIS_MARKET}")"
expect_ok "this week's market thread"
check "this week's board is closed" '.week.week_start == $t and .week.state == "closed"' --arg t "${THIS_WEEK}"
rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${GROUP}" "$(new_uuid)")"
expect_error NOT_FOUND "an unknown market"
[[ "${BODY}" != "${missing}" ]] || fail "an unknown market must not read as a lost group (the app would evict the group)"
rpc "${ADMIN_TOKEN}" group_prediction_market "$(market_body "${NOZONE}" "${RECORDS_MARKET}")"
expect_error NOT_FOUND "a market of another group"
pass "market thread: offers with notes, counters, withdrawals, matches and the week; an unknown market is its own NOT_FOUND"

# --- settlement, ranking, history -------------------------------------------------------

# Settlement waits while group evaluation is pending for the group's
# exercises; this body proves reads, not evaluation, so clear the queues.
run_psql "delete from app_public.group_eval_queue where group_id = '${GROUP}';
  delete from app_public.group_metric_eval_queue where group_id = '${GROUP}';" >/dev/null
settle() {
  expect_sql "settle $1" "select app_public.group_prediction_settle_at(upper(app_public.group_cow_bounds('UTC', '$1')) + interval '1 hour', '${GROUP}', '$1');" t
}
settle "${THIS_WEEK}"
rpc "${OWNER_TOKEN}" group_prediction_ranking "$(group_body "${GROUP}")"
expect_ok "ranking after one settled week"
no_walk_away "ranking"
check "this week's two AIs are ranked: the admin's AI won 5.00 from the owner's" \
  '.week_start == $t and (.rows | length == 2) and .rows[0].bettor.display_name == "reads-admin-\($r) · Claude"
   and .rows[0].week_profit == 5 and .rows[0].all_time_profit == 5 and .rows[0].matched == 1 and .rows[0].wins == 1
   and .rows[1].week_profit == -5 and .rows[1].losses == 1' --arg t "${THIS_WEEK}" --arg r "${RUN_TAG}"
settle "${OPEN_WEEK}"
rpc "${OWNER_TOKEN}" group_prediction_ranking "$(group_body "${GROUP}")"
expect_ok "ranking after two settled weeks"
no_walk_away "ranking"
# Records 3: 0 records, so no wins: B (no) takes A1's 6.00. Sets 10: 0 sets,
# so no wins: A2 (no) takes A1's 1.66. C and D carry over from the first week.
check "ranking order, profits, bets, head-to-head and recent weeks" \
  '.week_start == $o and (.rows | map(.bettor.display_name | sub("reads-"; "") | sub("-\($r)"; "")) == ["blair · Claude", "admin · Claude", "alex · Codex", "owner · Claude", "alex · Claude"])
   and (.rows | map(.week_profit) == [6, 0, 1.66, 0, -7.66]) and (.rows | map(.all_time_profit) == [6, 5, 1.66, -5, -7.66])
   and (.rows | map(.matched) == [1, 1, 1, 1, 2]) and (.rows | map(.weeks) == [1, 2, 1, 2, 1])
   and ((.rows | map(.week_profit) | add) * 100 | round) == 0 and ((.rows | map(.all_time_profit) | add) * 100 | round) == 0
   and (.rows[0].head_to_head | length == 1) and .rows[0].head_to_head[0].wins == 1 and .rows[0].head_to_head[0].profit == 6
   and .rows[0].head_to_head[0].opponent.display_name == "reads-alex-\($r) · Claude"
   and (.rows[4].head_to_head | map(.matched) | add) == 2 and ((.rows[4].head_to_head | map(.profit) | add) * 100 | round) == -766
   and (.rows[1].recent | map(.week_start) == [$o, $t]) and .rows[1].recent[0].profit == 0 and .rows[1].recent[1].profit == 5
   and .rows[1].recent[0].matched == 0' --arg o "${OPEN_WEEK}" --arg t "${THIS_WEEK}" --arg r "${RUN_TAG}"
expect_sql "the ranking's profits sum to zero in storage" "select coalesce(sum(profit_cents), 0) from app_public.group_prediction_results where group_id = '${GROUP}';" 0

rpc "${BLAIR_TOKEN}" group_prediction_history "$(history_body "${GROUP}" null 4)"
expect_ok "history"
no_walk_away "history"
check "two settled weeks, latest first, each with its matched markets and results" \
  '.group_id == $g and (.weeks | map(.week_start) == [$o, $t]) and .next_cursor == null
   and (.weeks[0].markets | map(.market.market_id) | sort == ([$r, $s] | sort))
   and (.weeks[0].markets[] | select(.market.market_id == $r) | .market.outcome == "no" and .market.result_value == 0 and .market.result_unit == "records"
       and .bets[0].winner == "no" and .bets[0].yes_stake == 6 and .bets[0].no_stake == 4)
   and (.weeks[0].markets[] | select(.market.market_id == $s) | .market.outcome == "no" and .market.result_unit == "sets"
       and .bets[0].via == "counter" and .bets[0].yes_stake == 1.66 and .bets[0].no_stake == 4.98)
   and (.weeks[0].results | map(.profit) == [6, 1.66, 0, 0, -7.66]) and (.weeks[0].results | map(.matched) == [1, 1, 0, 0, 2])
   and (.weeks[0].settled_at_ms > .weeks[0].ends_at_ms - 1) and .weeks[1].markets[0].bets[0].winner == "no"' \
  --arg g "${GROUP}" --arg o "${OPEN_WEEK}" --arg t "${THIS_WEEK}" --arg r "${RECORDS_MARKET}" --arg s "${SETS_MARKET}"
rpc "${BLAIR_TOKEN}" group_prediction_history "$(history_body "${GROUP}" null 1)"
expect_ok "history page 1"
check "a page of one week points at the next" '(.weeks | length == 1) and .weeks[0].week_start == $o and .next_cursor != null' --arg o "${OPEN_WEEK}"
CURSOR="$(jq -c '.next_cursor' <<<"${BODY}")"
rpc "${BLAIR_TOKEN}" group_prediction_history "$(history_body "${GROUP}" "${CURSOR}" 1)"
expect_ok "history page 2"
check "the last page has no cursor" '(.weeks | length == 1) and .weeks[0].week_start == $t and .next_cursor == null' --arg t "${THIS_WEEK}"
for bad in '"not-json"' '"[]"' '"{}"' "$(jq -nc --arg g "${NOZONE}" --arg w "${THIS_WEEK}" '{group_id:$g, week_start:$w} | tostring')" \
    "$(jq -nc --arg g "${GROUP}" '{group_id:$g, week_start:7} | tostring')" "$(jq -nc --arg g "${GROUP}" '{group_id:$g, week_start:"x"} | tostring')" \
    "$(jq -nc --arg g "${GROUP}" --arg w "${THIS_WEEK}" '{group_id:$g, week_start:$w, extra:1} | tostring')"; do
  rpc "${BLAIR_TOKEN}" group_prediction_history "$(history_body "${GROUP}" "${bad}" 4)"
  expect_error VALIDATION "history cursor ${bad}"
done
for bad in 0 11 null; do
  rpc "${BLAIR_TOKEN}" group_prediction_history "$(history_body "${GROUP}" null "${bad}")"
  expect_error VALIDATION "history page size ${bad}"
done
pass "ranking: ordered by all-time then week profit, bets and head-to-head, profits sum to zero; history: settled weeks, who won what, keyset pages, bad cursors"

# --- privacy ------------------------------------------------------------------------------

expect_sql "walk-away prices were stored (so their absence above is the readers' doing)" "select count(*) from app_public.group_prediction_offers o
  join app_public.group_prediction_markets m on m.id = o.market_id where m.group_id = '${GROUP}' and o.walk_away_price is not null;" 2
expect_sql "notes were stored" "select count(*) from app_public.group_prediction_offers o
  join app_public.group_prediction_markets m on m.id = o.market_id where m.group_id = '${GROUP}' and o.note is not null;" 4
pass "privacy: walk-away prices were stored and no reader returned one; notes reach members"

COMPLETED=1
pass "group prediction readers: access, board, thread, ranking, history (run ${RUN_TAG})"
