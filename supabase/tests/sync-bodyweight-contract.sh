#!/usr/bin/env bash
# Sourced by sync-push-contract.sh: reuse its isolated owners, helpers and cleanup.
# This extends the existing backend lane, not a standalone entrypoint.

echo "[sync-push] M27 bodyweight round-trip, compatibility and owner isolation"
BW_ID="push-weight-${RUN_TAG}"
BW_SESSION_ID="push-session-bodyweight-${RUN_TAG}"
BW_DEF_ID="push-exdef-bodyweight-${RUN_TAG}"
BW_SX_ID="push-sx-bodyweight-${RUN_TAG}"
BW_SET_ID="push-set-bodyweight-${RUN_TAG}"
BW_BODY="$(jq -nc --arg reading "${BW_ID}" --arg session "${BW_SESSION_ID}" \
  --arg def "${BW_DEF_ID}" --arg sx "${BW_SX_ID}" --arg set "${BW_SET_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "body_weight_measurements", id: $reading, client_updated_at_ms: $ts,
     fields: {weight_value: "176", weight_unit: "lb", weight_kg: 79.83225712, measured_at: $ts,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $session, client_updated_at_ms: $ts,
     fields: {gym_id: null, status: "completed", started_at: $ts, completed_at: ($ts+60000), duration_sec: 60,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_definitions", id: $def, client_updated_at_ms: $ts,
     fields: {name: "Pull-Up", load_input_mode: "total_load", bodyweight_coefficient: 1,
              movement_standard: "strict", loading_method: "weighted", created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercises", id: $sx, client_updated_at_ms: $ts,
     fields: {session_id: $session, exercise_definition_id: $def, name: "Pull-Up", machine_name: null,
              order_index: 0, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $set, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, order_index: 0, weight_value: "20", reps_value: "8", set_type: null,
              weight_unit: "lb", external_load_mode: "assistance", planned_weight_value: "10", planned_reps_value: "10",
              planned_set_type: null, planned_weight_unit: "kg", planned_external_load_mode: "added", performance_status: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${BW_BODY}"
assert_status 200 "M27 initial push"
assert_json_expr '.ok == true' "M27 initial ack"

# Drain all pages: the shared fixture account can hold a seeded catalogue and
# rows from earlier integration runs, so this run need not be on the first page.
bw_pull_layer() {
  local layer="$1" caps="$2" cursor=null accumulated='[]' page
  local guard=0
  while (( guard < 1000 )); do
    guard=$((guard + 1))
    http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" app_public \
      "$(jq -nc --argjson layer "${layer}" --argjson caps "${caps}" --argjson cursor "${cursor}" '{layer:$layer,limit:200,cursor:$cursor} + (if $caps then {capabilities:["bodyweight_v1"]} else {} end)')"
    assert_status 200 "M27 drain layer ${layer}"
    assert_json_expr '.entities | type == "array"' "M27 valid pull page"
    page="${REQUEST_BODY}"
    accumulated="$(jq -nc --argjson previous "${accumulated}" --argjson page "${page}" '$previous + $page.entities')"
    if [[ "$(printf '%s' "${page}" | jq -r '.has_more')" == false ]]; then
      REQUEST_BODY="$(jq -nc --argjson entities "${accumulated}" '{entities:$entities}')"
      return
    fi
    cursor="$(printf '%s' "${page}" | jq -c '.next_cursor')"
  done
  echo '[fail] M27 pull drain exceeded page guard' >&2
  exit 1
}

# Entire field maps round-trip, including raw units, private dated readings and plans.
for bw_layer in 0 1 2 3 4; do
  bw_pull_layer "${bw_layer}" true
  assert_status 200 "M27 pull layer ${bw_layer}"
  bw_expected_types='[]'
  case "${bw_layer}" in
    0) bw_expected_types='["exercise_definitions"]' ;;
    1) bw_expected_types='["sessions"]' ;;
    2) bw_expected_types='["session_exercises"]' ;;
    3) bw_expected_types='["exercise_sets"]' ;;
    4) bw_expected_types='["body_weight_measurements"]' ;;
  esac
  assert_json_expr --argjson expected "${BW_BODY}" --argjson types "${bw_expected_types}" \
    '.entities as $rows | all($expected.entities[] | select(.type as $t | $types | index($t)); . as $e | any($rows[]; .id == $e.id and .type == $e.type and .fields == $e.fields))' \
    "M27 all fields round-trip layer ${bw_layer}"
done

# Existing reader requests never receive an unknown entity. New layer requires
# an explicit array capability (a scalar/object with that key does not suffice).
for bw_layer in 0 1 2 3; do
  bw_pull_layer "${bw_layer}" false
  assert_status 200 "M27 old reader layer ${bw_layer}"
  assert_json_expr 'all(.entities[]; .type != "body_weight_measurements")' "M27 legacy reader safe"
done
for bw_caps in null '"bodyweight_v1"' '{"bodyweight_v1":true}'; do
  http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" app_public \
    "$(jq -nc --argjson caps "${bw_caps}" '{layer:4,limit:200,cursor:null,capabilities:$caps}')"
  assert_json_expr '.error.code == "INTERNAL"' "M27 invalid/missing capability denied"
done

# A newer legacy full-row writer can edit ordinary fields without discarding
# columns it does not know. Explicit null remains distinct from omission.
BW_OLD_BODY="$(printf '%s' "${BW_BODY}" | jq '
  .entities |= map(select(.type != "body_weight_measurements") | .client_updated_at_ms += 100 |
    .fields |= del(.body_weight_kg,.body_weight_source,.body_weight_measurement_id,.body_weight_measured_at,
      .bodyweight_coefficient,.movement_standard,.loading_method,.weight_unit,.external_load_mode,
      .planned_weight_unit,.planned_external_load_mode))')"
sync_push "${USER_A_TOKEN}" "${BW_OLD_BODY}"
assert_status 200 "M27 older writer accepted"
user_select sessions "id=eq.${BW_SESSION_ID}&select=*" "${USER_A_TOKEN}"
assert_json_expr '.[0] | has("body_weight_kg") | not' "sessions have no stored body weight"
user_select exercise_definitions "id=eq.${BW_DEF_ID}&select=bodyweight_coefficient,movement_standard,loading_method" "${USER_A_TOKEN}"
assert_json_expr '.[0] == {bodyweight_coefficient:1,movement_standard:"strict",loading_method:"weighted"}' "M27 older writer preserved exercise rules"
user_select exercise_sets "id=eq.${BW_SET_ID}&select=weight_unit,external_load_mode,planned_weight_unit,planned_external_load_mode" "${USER_A_TOKEN}"
assert_json_expr '.[0] == {weight_unit:"lb",external_load_mode:"assistance",planned_weight_unit:"kg",planned_external_load_mode:"added"}' "M27 older writer preserved actual and planned modes"

# Readings use normal LWW, tombstone and undelete; none may refresh a session.
BW_READING_BODY="$(printf '%s' "${BW_BODY}" | jq '.entities |= map(select(.type=="body_weight_measurements") | .client_updated_at_ms += 200 | .fields.weight_kg = 90 | .fields.weight_value = "90" | .fields.weight_unit = "kg" | .fields.deleted_at = .client_updated_at_ms)')"
sync_push "${USER_A_TOKEN}" "${BW_READING_BODY}"
assert_status 200 "M27 reading tombstone"
user_select body_weight_measurements "id=eq.${BW_ID}&select=weight_kg,deleted_at" "${USER_A_TOKEN}"
assert_json_expr '.[0].weight_kg == 90 and .[0].deleted_at != null' "M27 reading tombstone retained"
sync_push "${USER_A_TOKEN}" "$(printf '%s' "${BW_BODY}" | jq '.entities |= map(select(.type=="body_weight_measurements"))')"
assert_status 200 "M27 stale reading acknowledged"
user_select body_weight_measurements "id=eq.${BW_ID}&select=weight_kg,deleted_at" "${USER_A_TOKEN}"
assert_json_expr '.[0].weight_kg == 90 and .[0].deleted_at != null' "M27 stale reading cannot overwrite"
sync_push "${USER_A_TOKEN}" "$(printf '%s' "${BW_READING_BODY}" | jq '.entities[] |= (.client_updated_at_ms += 100 | .fields.deleted_at = null)')"
assert_status 200 "M27 reading undelete"
user_select body_weight_measurements "id=eq.${BW_ID}&select=deleted_at" "${USER_A_TOKEN}"
assert_json_expr '.[0].deleted_at == null' "M27 reading undeleted"

user_select body_weight_measurements "id=eq.${BW_ID}&select=id" "${USER_B_TOKEN}"
assert_status 200 "M27 cross-owner select"
assert_json_expr 'length == 0' "M27 cross-owner cannot read"
http_request PATCH "${API_URL}/rest/v1/body_weight_measurements?id=eq.${BW_ID}" "${USER_B_TOKEN}" "${ANON_KEY}" app_public '{"weight_kg":1}' return=representation
assert_status 200 "M27 cross-owner update hidden"
assert_json_expr 'length == 0' "M27 cross-owner cannot change reading"
http_request POST "${API_URL}/rest/v1/body_weight_measurements" "${USER_B_TOKEN}" "${ANON_KEY}" app_public \
  "$(printf '%s' "${BW_BODY}" | jq --arg owner "${USER_A_UUID}" '.entities[0] | .fields + {id:.id, owner_user_id:$owner,client_updated_at_ms:.client_updated_at_ms}')"
assert_non_2xx "M27 cross-owner insert denied"

# Re-sign an existing local fixture token; positive control proves the signature
# works before adding an OAuth client_id for the restrictive direct-access rule.
bw_mint_token() {
  node -e '
    const crypto = require("node:crypto");
    const [token, secret, clientId] = process.argv.slice(1);
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    if (clientId) claims.client_id = clientId;
    const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${enc({alg:"HS256",typ:"JWT"})}.${enc(claims)}`;
    process.stdout.write(`${unsigned}.${crypto.createHmac("sha256",secret).update(unsigned).digest("base64url")}`);
  ' "${USER_A_TOKEN}" "${JWT_SECRET}" "${1:-}"
}
BW_APP_TOKEN="$(bw_mint_token)"
BW_AGENT_TOKEN="$(bw_mint_token m27-probe)"
user_select body_weight_measurements "id=eq.${BW_ID}&select=id" "${BW_APP_TOKEN}"
assert_status 200 "M27 local signature control"
assert_json_expr 'length == 1' "M27 app token reads own reading"
user_select body_weight_measurements "id=eq.${BW_ID}&select=id" "${BW_AGENT_TOKEN}"
assert_status 200 "M27 OAuth direct select hidden"
assert_json_expr 'length == 0' "M27 OAuth cannot read weight history directly"
sync_push "${BW_AGENT_TOKEN}" "${BW_READING_BODY}"
assert_non_2xx "M27 OAuth cannot write weight history through sync"
http_request GET "${API_URL}/rest/v1/body_weight_measurements?select=id" "${ANON_KEY}" "${ANON_KEY}" app_public
assert_non_2xx "M27 anonymous direct access denied"

service_delete body_weight_measurements "owner_user_id=eq.${USER_A_UUID}&id=eq.${BW_ID}"
assert_status 204 "M27 source physical deletion"
BW_NULL_BODY="$(printf '%s' "${BW_BODY}" | jq '.entities |= map(select(.type != "body_weight_measurements") | .client_updated_at_ms += 400 |
  if .type=="exercise_sets" then .fields += {external_load_mode:null,planned_weight_unit:null,planned_external_load_mode:null}
  elif .type=="exercise_definitions" then .fields += {movement_standard:null,loading_method:null} else . end)')"
sync_push "${USER_A_TOKEN}" "${BW_NULL_BODY}"
assert_status 200 "M27 explicit null accepted"
user_select exercise_sets "id=eq.${BW_SET_ID}&select=external_load_mode,planned_weight_unit,planned_external_load_mode" "${USER_A_TOKEN}"
assert_json_expr 'all(.[0][]; . == null)' "M27 explicit null clears modes"
user_select exercise_definitions "id=eq.${BW_DEF_ID}&select=movement_standard,loading_method" "${USER_A_TOKEN}"
assert_json_expr 'all(.[0][]; . == null)' "M27 explicit null clears descriptors"

# The compatibility build must be rejected before any row or cursor can move.
# An empty curl header suppresses it entirely, matching pre-cutover builds.
for old_protocol in "" 1 invalid; do
  BOGA_TEST_SYNC_PROTOCOL="$old_protocol" sync_push "${USER_A_TOKEN}" "${BW_BODY}"
  assert_non_2xx 'old client push rejected'
  assert_json_expr '.message | startswith("UPDATE_REQUIRED:")' 'actionable update-required push error'
  BOGA_TEST_SYNC_PROTOCOL="$old_protocol" http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" app_public '{"layer":0,"limit":10}'
  assert_non_2xx 'old client pull rejected'
  assert_json_expr '.message | startswith("UPDATE_REQUIRED:")' 'actionable update-required pull error'
done
# Neither authenticated owners nor OAuth clients can call the private projection seam.
http_request POST "${API_URL}/rest/v1/rpc/session_weight_contexts" "${USER_A_TOKEN}" "${ANON_KEY}" app_public \
  "$(jq -nc --arg u "$USER_A_UUID" --arg s "$BW_SESSION_ID" '{p_owner:$u,p_session_ids:[$s]}')"
assert_non_2xx 'service projection cannot be called by a normal client'
