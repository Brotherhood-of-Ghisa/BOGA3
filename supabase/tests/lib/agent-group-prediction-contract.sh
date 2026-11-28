#!/usr/bin/env bash
# Sourced by agent-api-contract.sh with its real OAuth identities and HTTP helpers.
# Proves the group prediction routes: the three reads, the three receipted
# writes, the gate (NOT_FOUND), validation, replay, the write rate limit and
# the audit names. The market rules themselves are proved in
# groups-predictions*.sh; the pure parsing in agent-api-group-predictions.test.ts.

echo '[agent-api-test] verifying group predictions: reads, receipted writes, the gate, rate limit and audit names'

GP_NAME="agent-api-${RUN_TAG}"

# Creating a group needs a username; user A has none, so give it one for this block (cleanup restores it).
GP_PRIOR_USERNAME="$(run_psql "select coalesce((select username from app_public.user_profiles where id = '${USER_A_UUID}'), '');")"
GP_RESTORE_SQL="update app_public.user_profiles set username = nullif('${GP_PRIOR_USERNAME}', '') where id = '${USER_A_UUID}';"
run_psql "insert into app_public.user_profiles (id, username) values ('${USER_A_UUID}', 'ap${RUN_TAG}')
  on conflict (id) do update set username = excluded.username;" >/dev/null

# grp_rpc_with_headers <bearer> <function> <json-body>: the app's group call (contract 4), as a member makes it.
grp_rpc_with_headers() {
  local response_file
  response_file="$(mktemp)"
  RESPONSE_STATUS="$(curl --silent --show-error -X POST \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H 'x-boga-group-contract: 4' \
    -H 'x-boga-sync-protocol: 8' -H 'Content-Type: application/json' -H 'Content-Profile: app_public' \
    -o "${response_file}" -w '%{http_code}' --data "$3" "${API_URL}/rest/v1/rpc/$2")"
  RESPONSE_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

grp_new_group() { # grp_new_group <name> <predictions on|off>: prints the id
  grp_rpc_with_headers "${APP_ACCESS_TOKEN}" group_create \
    "$(jq -nc --arg n "${GP_NAME} $1" '{p_name:$n, p_description:null, p_time_zone:"UTC"}')"
  assert_status "200" "create group $1"
  local id
  id="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.group_id')"
  if [[ "$2" == "on" ]]; then
    grp_rpc_with_headers "${APP_ACCESS_TOKEN}" group_prediction_settings_set \
      "$(jq -nc --arg g "${id}" '{p_group_id:$g, p_enabled:true}')"
    assert_status "200" "predictions on in $1"
  fi
  printf '%s' "${id}"
}

jq_check() { # jq_check <context> <filter> [jq args...]: RESPONSE_BODY satisfies the filter
  local context="$1" filter="$2"
  shift 2
  printf '%s' "${RESPONSE_BODY}" | jq -e "$@" "${filter}" >/dev/null || fail "${context}"
}

# No note anywhere in a response. (Another AI's walk-away price never leaving a read is proved by groups-predictions-agent-reads.sh.)
assert_no_secrets() {
  printf '%s' "${RESPONSE_BODY}" | jq -e '[paths | select(.[-1] == "note")] == []' >/dev/null ||
    fail "$1: a note reached an agent response"
}

GP_ON="$(grp_new_group on on)"
GP_OFF="$(grp_new_group off off)"
GP_MISSING="$(printf '%s' "${GP_ON}" | sed 's/^.\{8\}/ffffffff/')"
grp_rpc_with_headers "${APP_ACCESS_TOKEN}" group_competition_exercise_create \
  "$(jq -nc --arg g "${GP_ON}" '{p_group_id:$g, p_name:"Contract Bench", p_load_input_mode:"total_load",
    p_source_exercise_id:null, p_bodyweight_contribution:0, p_default_metric:"e1rm"}')"
assert_status "200" "group exercise"
GP_EXERCISE="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.exercise.group_exercise_id')"

# --- reads -------------------------------------------------------------------------

agent_get "groups"
assert_status "200" "list prediction groups"
jq_check "the list holds the group with predictions on and not the one off" '
  ([.data.groups[].group_id] | index($on)) != null and ([.data.groups[].group_id] | index($off)) == null
  and (.data.groups[] | select(.group_id == $on) | .stake_left == 100 and .open_week.week_start != null)' \
  --arg on "${GP_ON}" --arg off "${GP_OFF}"
assert_no_secrets "list"
GP_WEEK="$(printf '%s' "${RESPONSE_BODY}" | jq -er --arg g "${GP_ON}" '.data.groups[] | select(.group_id == $g) | .open_week.week_start')"

agent_get "groups/${GP_ON}/form"
assert_status "200" "group form"
jq_check "the form has eight weeks" '(.data.weeks | length) == 8'
agent_get "groups/${GP_ON}/board"
assert_status "200" "prediction board"
jq_check "an empty board before the first post" '.data.group_id == $g and .data.mine.stake_left == 100' --arg g "${GP_ON}"
agent_get "groups?limit=1"
assert_status "400" "a query on the list"
agent_get "groups/${GP_ON}/board" "$(make_expired_token "${AGENT_ACCESS_TOKEN}")"
assert_status "401" "an expired token on the board"

# --- the gate: a group with the setting off, a missing group and a non-member -------

for route in "groups/${GP_OFF}/board" "groups/${GP_OFF}/form" "groups/${GP_MISSING}/board" "groups/${GP_MISSING}/form"; do
  agent_get "${route}"
  assert_status "404" "${route}"
  jq_check "${route}: NOT_FOUND" '.error.code == "NOT_FOUND"'
done
GP_OFFER_BODY="$(jq -nc --arg w "${GP_WEEK}" '{week_start:$w, template:"sets_line", parameters:{member_user_id:"'"${USER_A_UUID}"'", line:5},
  side:"yes", price:60, stake:10, walk_away_price:70, note:"agent-api private note"}')"
agent_post "groups/${GP_OFF}/offers" "${GP_OFFER_BODY}" "agent-api-${RUN_TAG}-gp-off"
assert_status "404" "a post to a group with the setting off"
agent_post "groups/${GP_OFF}/cow" "$(jq -nc --arg w "${GP_WEEK}" --arg x "${GP_EXERCISE}" '{week_start:$w, group_exercise_id:$x, metrics:["e1rm"]}')" \
  "agent-api-${RUN_TAG}-gp-off-cow"
assert_status "404" "a CoW pick in a group with the setting off"

SAVED_AGENT_TOKEN="${AGENT_ACCESS_TOKEN}" SAVED_REFRESH_TOKEN="${AGENT_REFRESH_TOKEN}"
SAVED_CLIENT_ID="${AGENT_CLIENT_ID}" SAVED_APP_TOKEN="${APP_ACCESS_TOKEN}"
mint_agent_token "${USER_B_EMAIL}" "${USER_B_PASSWORD}" "BoGa contract agent B ${RUN_TAG}"
OTHER_AGENT_TOKEN="${AGENT_ACCESS_TOKEN}"
AGENT_ACCESS_TOKEN="${SAVED_AGENT_TOKEN}" AGENT_REFRESH_TOKEN="${SAVED_REFRESH_TOKEN}"
AGENT_CLIENT_ID="${SAVED_CLIENT_ID}" APP_ACCESS_TOKEN="${SAVED_APP_TOKEN}"
agent_get "groups" "${OTHER_AGENT_TOKEN}"
assert_status "200" "a non-member's list"
jq_check "a non-member sees none of these groups" '[.data.groups[].group_id] | index($on) == null' --arg on "${GP_ON}"
agent_get "groups/${GP_ON}/board" "${OTHER_AGENT_TOKEN}"
assert_status "404" "a non-member's board"
NON_MEMBER_BOARD="${RESPONSE_BODY}"
agent_get "groups/${GP_MISSING}/board"
[[ "$(printf '%s' "${NON_MEMBER_BOARD}" | jq -c 'del(.error.request_id)')" == "$(printf '%s' "${RESPONSE_BODY}" | jq -c 'del(.error.request_id)')" ]] ||
  fail "a non-member's refusal must look like a missing group"
agent_post "groups/${GP_ON}/offers" "${GP_OFFER_BODY}" "agent-api-${RUN_TAG}-gp-nonmember" "${OTHER_AGENT_TOKEN}"
assert_status "404" "a non-member's post"
agent_post "groups/${GP_ON}/cow" "$(jq -nc --arg w "${GP_WEEK}" --arg x "${GP_EXERCISE}" '{week_start:$w, group_exercise_id:$x, metrics:["e1rm"]}')" \
  "agent-api-${RUN_TAG}-gp-nonmember-cow" "${OTHER_AGENT_TOKEN}"
assert_status "404" "a non-member's CoW pick"

# --- post, replay, conflict --------------------------------------------------------

agent_post "groups/${GP_ON}/offers" "${GP_OFFER_BODY}"
assert_status "400" "a post without an idempotency key"
agent_post "groups/${GP_ON}/offers" "${GP_OFFER_BODY}" "agent-api-${RUN_TAG}-gp-post"
assert_status "200" "post an offer"
jq_check "the post returns the offer, the market, no matches and the stake left, as a first write" '
  .data.idempotent_replay == false and .data.matches == [] and .data.stake_left == 90
  and .data.offer.price == 60 and .data.offer.stake == 10 and .data.offer.walk_away_price == 70
  and .data.market.template == "sets_line"'
assert_no_secrets "post"
GP_OFFER_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.offer.offer_id')"
FIRST_POST="${RESPONSE_BODY}"
agent_post "groups/${GP_ON}/offers" "${GP_OFFER_BODY}" "agent-api-${RUN_TAG}-gp-post"
assert_status "200" "replay the post"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -c '.data | del(.idempotent_replay)')" == \
  "$(printf '%s' "${FIRST_POST}" | jq -c '.data | del(.idempotent_replay)')" ]] || fail "a replay must return the first result"
jq_check "a replay says so" '.data.idempotent_replay == true'
[[ "$(run_psql "select count(*) from app_public.group_prediction_offers o join app_public.group_prediction_markets m on m.id = o.market_id
  where m.group_id = '${GP_ON}';")" == "1" ]] || fail "a replayed post must not write a second offer"
# The same body with its keys written in another order is the same request.
agent_post "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c 'to_entries | reverse | from_entries')" \
  "agent-api-${RUN_TAG}-gp-post"
assert_status "200" "replay the post with its keys reordered"
jq_check "a reordered replay is a replay" '.data.idempotent_replay == true'
agent_post "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.price = 61')" "agent-api-${RUN_TAG}-gp-post"
assert_status "409" "the same key with another body"
jq_check "IDEMPOTENCY_CONFLICT" '.error.code == "IDEMPOTENCY_CONFLICT"'
agent_post "groups/${GP_ON}/offers" "${GP_OFFER_BODY}" "agent-api-${RUN_TAG}-gp-post-second"
assert_status "200" "the same offer under another key rests as a second offer"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.stake_left')" == "80" ]] || fail "the second offer must use 10 more points"

agent_get "groups/${GP_ON}/board"
assert_status "200" "the board after posting"
assert_no_secrets "board"
jq_check "the board shows my two offers, the first with its walk-away price, and the stake left" '
  (.data.mine.offers | length) == 2 and .data.mine.stake_left == 80
  and (.data.mine.offers[] | select(.offer_id == $o) | .walk_away_price == 70)' --arg o "${GP_OFFER_ID}"

# --- validation -------------------------------------------------------------------

gp_invalid() { # gp_invalid <context> <route> <body> <key-suffix>
  agent_post "$2" "$3" "agent-api-${RUN_TAG}-gp-bad-$4"
  assert_status "400" "$1"
  jq_check "$1: INVALID_ARGUMENT" '.error.code == "INVALID_ARGUMENT"'
}
gp_invalid "an unknown field" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '. + {user_id:"x"}')" unknown
gp_invalid "a stake of zero" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.stake = 0')" stake0
gp_invalid "a stake of three decimals" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.stake = 1.234')" stake3
gp_invalid "an unknown template" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.template = "free_text"')" template
gp_invalid "a week that is not a date" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.week_start = "2026-02-30"')" week
gp_invalid "a note over 140 characters" "groups/${GP_ON}/offers" \
  "$(printf '%s' "${GP_OFFER_BODY}" | jq -c --arg n "$(printf 'x%.0s' $(seq 1 141))" '.note = $n')" note
gp_invalid "a price the market refuses (150)" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.price = 150')" price
gp_invalid "a sets line off the step" "groups/${GP_ON}/offers" \
  "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.parameters.line = 7')" line
gp_invalid "a stake over the weekly 100" "groups/${GP_ON}/offers" "$(printf '%s' "${GP_OFFER_BODY}" | jq -c '.stake = 95 | .price = 55')" over
gp_invalid "a withdraw body with a field" "groups/${GP_ON}/offers/${GP_OFFER_ID}/withdraw" '{"x":1}' withdraw
gp_invalid "a CoW with no metrics" "groups/${GP_ON}/cow" \
  "$(jq -nc --arg w "${GP_WEEK}" --arg x "${GP_EXERCISE}" '{week_start:$w, group_exercise_id:$x, metrics:[]}')" cow-metrics
agent_get "groups/${GP_ON}/nothing"
assert_status "404" "an unknown group route"
agent_get "groups/not-a-uuid/board"
assert_status "404" "a group id that is not an id"
agent_get "groups/${GP_ON}/offers"
assert_status "405" "a GET on the offers route"
agent_post "groups/${GP_ON}/board" '{}' "agent-api-${RUN_TAG}-gp-method"
assert_status "405" "a POST on the board route"

# --- withdraw ---------------------------------------------------------------------

agent_post "groups/${GP_ON}/offers/${GP_MISSING}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-wd-missing"
assert_status "404" "withdrawing an offer that does not exist"
agent_post "groups/${GP_ON}/offers/${GP_OFFER_ID}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-wd" "${OTHER_AGENT_TOKEN}"
assert_status "404" "another AI withdrawing my offer"
agent_post "groups/${GP_ON}/offers/${GP_OFFER_ID}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-wd"
assert_status "200" "withdraw my offer"
jq_check "the withdrawal frees the stake" '.data.idempotent_replay == false and .data.freed == 10 and .data.stake_left == 90
  and .data.offer.state == "withdrawn"'
assert_no_secrets "withdraw"
agent_post "groups/${GP_ON}/offers/${GP_OFFER_ID}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-wd"
assert_status "200" "replay the withdrawal"
jq_check "a replay says so" '.data.idempotent_replay == true and .data.freed == 10'
agent_post "groups/${GP_ON}/offers/${GP_OFFER_ID}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-wd-again"
assert_status "200" "withdraw an offer with nothing left"
jq_check "nothing is freed twice" '.data.freed == 0 and .data.stake_left == 90'

# --- the CoW pick ------------------------------------------------------------------

GP_COW_BODY="$(jq -nc --arg w "${GP_WEEK}" --arg x "${GP_EXERCISE}" '{week_start:$w, group_exercise_id:$x, metrics:["e1rm","volume"]}')"
agent_post "groups/${GP_ON}/cow" "${GP_COW_BODY}" "agent-api-${RUN_TAG}-gp-cow"
assert_status "200" "pick next week's CoW"
jq_check "the CoW is the group's next week" '.data.idempotent_replay == false and .data.cow.week_start == $w' --arg w "${GP_WEEK}"
GP_COW_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.cow.cow_id')"
agent_post "groups/${GP_ON}/cow" "${GP_COW_BODY}" "agent-api-${RUN_TAG}-gp-cow"
assert_status "200" "replay the CoW pick"
jq_check "a replay says so and names the same CoW" '.data.idempotent_replay == true and ((.data.cow.cow_id) == $c)' --arg c "${GP_COW_ID}"
agent_post "groups/${GP_ON}/cow" "$(printf '%s' "${GP_COW_BODY}" | jq -c '.metrics = ["e1rm"]')" "agent-api-${RUN_TAG}-gp-cow"
assert_status "409" "the same key with other metrics"
jq_check "IDEMPOTENCY_CONFLICT" '.error.code == "IDEMPOTENCY_CONFLICT"'
agent_post "groups/${GP_ON}/cow" "${GP_COW_BODY}" "agent-api-${RUN_TAG}-gp-cow-second"
assert_status "409" "a second pick for a week that has a CoW"
jq_check "CONFLICT" '.error.code == "CONFLICT"'
[[ "$(run_psql "select count(*) from app_public.group_cows where group_id = '${GP_ON}' and cancelled_at is null;")" == "1" ]] ||
  fail "one CoW for the week"
agent_get "groups"
jq_check "the list names next week's CoW and the AI that picked it" \
  '.data.groups[] | select(.group_id == $g) | .next_week_cow != null and .next_week_cow.picked_by != null' --arg g "${GP_ON}"

# --- audit names, receipts and the write rate limit -------------------------------------------

[[ "$(run_psql "select string_agg(distinct tool_name, ',' order by tool_name) from public.agent_access_audit
  where owner_user_id = '${USER_A_UUID}'::uuid and oauth_client_id = '${AGENT_CLIENT_ID}'
    and tool_name in ('list_prediction_groups','get_group_form','get_prediction_board','post_prediction_offer',
      'withdraw_prediction_offer','schedule_group_cow');")" == \
  "get_group_form,get_prediction_board,list_prediction_groups,post_prediction_offer,schedule_group_cow,withdraw_prediction_offer" ]] ||
  fail "every prediction route must be audited under its tool name"
[[ "$(run_psql "select count(*) from public.agent_plan_write_receipts where owner_user_id = '${USER_A_UUID}'::uuid
  and client_id = '${AGENT_CLIENT_ID}' and operation in ('post_prediction_offer','withdraw_prediction_offer','schedule_group_cow')
  and result_ids::text like '%agent-api private note%';")" == "0" ]] || fail "a receipt must never hold a note"
# A refused write leaves no receipt: the key is free for a corrected request.
[[ "$(run_psql "select count(*) from public.agent_plan_write_receipts where owner_user_id = '${USER_A_UUID}'::uuid
  and client_id = '${AGENT_CLIENT_ID}' and idempotency_key like 'agent-api-${RUN_TAG}-gp-bad-%';")" == "0" ]] ||
  fail "a refused write must not keep its receipt"

GP_LIMITED=0
for attempt in $(seq 1 40); do
  agent_post "groups/${GP_ON}/offers/${GP_MISSING}/withdraw" '{}' "agent-api-${RUN_TAG}-gp-rate-${attempt}"
  if [[ "${RESPONSE_STATUS}" == "429" ]]; then
    GP_LIMITED="${attempt}"
    break
  fi
  [[ "${RESPONSE_STATUS}" == "404" ]] || fail "the rate-limit probe expected 404 or 429, got ${RESPONSE_STATUS}"
done
[[ "${GP_LIMITED}" -ge 2 && "${GP_LIMITED}" -le 40 ]] || fail "the prediction write window must refuse after 30 writes a minute"
jq_check "RATE_LIMITED" '.error.code == "RATE_LIMITED"'
agent_get "groups"
assert_status "200" "prediction reads have their own window"
