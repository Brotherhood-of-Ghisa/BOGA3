#!/usr/bin/env bash
# Sourced by sync-push-contract.sh: current kg-only readings, the private
# calculation preference and contribution fields share the normal sync v3 LWW
# contract. Reuse the parent lane's isolated owners, helpers and cleanup.

echo "[sync-push] optional bodyweight sync v3 round-trip and owner isolation"
BW_SETTING_ID="settings"
BW_ID="push-weight-${RUN_TAG}"
BW_SESSION_ID="push-session-bodyweight-${RUN_TAG}"
BW_DEF_ID="push-exdef-bodyweight-${RUN_TAG}"
BW_SX_ID="push-sx-bodyweight-${RUN_TAG}"
BW_SET_ID="push-set-bodyweight-${RUN_TAG}"
BW_BODY="$(jq -nc --arg reading "${BW_ID}" --arg session "${BW_SESSION_ID}" \
  --arg def "${BW_DEF_ID}" --arg sx "${BW_SX_ID}" --arg set "${BW_SET_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "user_settings", id: "settings", client_updated_at_ms: $ts,
     fields: {bodyweight_calculations_enabled: true, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "body_weight_measurements", id: $reading, client_updated_at_ms: $ts,
     fields: {weight_kg: 79.83225712, measured_at: $ts, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $session, client_updated_at_ms: $ts,
     fields: {gym_id: null, status: "completed", started_at: $ts, completed_at: ($ts+60000), duration_sec: 60,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_definitions", id: $def, client_updated_at_ms: $ts,
     fields: {name: "Pull-Up", load_input_mode: "total_load", bodyweight_contribution: 1,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercises", id: $sx, client_updated_at_ms: $ts,
     fields: {session_id: $session, exercise_definition_id: $def, name: "Pull-Up", machine_name: null,
              order_index: 0, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $set, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, order_index: 0, weight_value: "20", reps_value: "8", set_type: null,
              planned_weight_value: "10", planned_reps_value: "10", planned_set_type: null,
              performance_status: null, created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${BW_BODY}"
assert_status 200 "optional bodyweight initial push"
assert_json_expr '.ok == true' "optional bodyweight initial ack"

# Drain each layer because the shared fixture account can contain seeded rows.
bw_pull_layer() {
  local layer="$1" cursor=null accumulated='[]' page guard=0
  while (( guard < 1000 )); do
    guard=$((guard + 1))
    http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" app_public \
      "$(jq -nc --argjson layer "${layer}" --argjson cursor "${cursor}" '{layer:$layer,limit:200,cursor:$cursor}')"
    assert_status 200 "bodyweight pull layer ${layer}"
    assert_json_expr '.entities | type == "array"' "bodyweight valid pull page"
    page="${REQUEST_BODY}"
    accumulated="$(jq -nc --argjson previous "${accumulated}" --argjson page "${page}" '$previous + $page.entities')"
    if [[ "$(printf '%s' "${page}" | jq -r '.has_more')" == false ]]; then
      REQUEST_BODY="$(jq -nc --argjson entities "${accumulated}" '{entities:$entities}')"
      return
    fi
    cursor="$(printf '%s' "${page}" | jq -c '.next_cursor')"
  done
  echo '[fail] bodyweight pull drain exceeded page guard' >&2
  exit 1
}

for bw_layer in 0 1 2 3 4; do
  bw_pull_layer "${bw_layer}"
  bw_expected_types='[]'
  case "${bw_layer}" in
    0) bw_expected_types='["user_settings","exercise_definitions"]' ;;
    1) bw_expected_types='["sessions"]' ;;
    2) bw_expected_types='["session_exercises"]' ;;
    3) bw_expected_types='["exercise_sets"]' ;;
    4) bw_expected_types='["body_weight_measurements"]' ;;
  esac
  assert_json_expr --argjson expected "${BW_BODY}" --argjson types "${bw_expected_types}" \
    '.entities as $rows | all($expected.entities[] | select(.type as $t | $types | index($t));
      . as $e | any($rows[]; .id == $e.id and .type == $e.type and .fields == $e.fields))' \
    "all current bodyweight fields round-trip layer ${bw_layer}"
done

# Preference and readings both obey LWW and remain owner-private.
BW_SETTINGS_NEW="$(printf '%s' "${BW_BODY}" | jq '
  {entities: [.entities[] | select(.type=="user_settings") |
    .client_updated_at_ms += 100 | .fields.bodyweight_calculations_enabled = false |
    .fields.updated_at = .client_updated_at_ms]}')"
sync_push "${USER_A_TOKEN}" "${BW_SETTINGS_NEW}"
assert_status 200 "preference update"
user_select user_settings "id=eq.settings&select=bodyweight_calculations_enabled" "${USER_A_TOKEN}"
assert_json_expr '.[0].bodyweight_calculations_enabled == false' "preference update persisted"
sync_push "${USER_A_TOKEN}" "$(printf '%s' "${BW_BODY}" | jq '{entities:[.entities[]|select(.type=="user_settings")]}')"
assert_status 200 "stale preference acknowledged"
user_select user_settings "id=eq.settings&select=bodyweight_calculations_enabled" "${USER_A_TOKEN}"
assert_json_expr '.[0].bodyweight_calculations_enabled == false' "stale preference cannot overwrite"

BW_READING_NEW="$(printf '%s' "${BW_BODY}" | jq '
  {entities: [.entities[] | select(.type=="body_weight_measurements") |
    .client_updated_at_ms += 200 | .fields.weight_kg = 90 |
    .fields.updated_at = .client_updated_at_ms | .fields.deleted_at = .client_updated_at_ms]}')"
sync_push "${USER_A_TOKEN}" "${BW_READING_NEW}"
assert_status 200 "reading tombstone"
user_select body_weight_measurements "id=eq.${BW_ID}&select=weight_kg,deleted_at" "${USER_A_TOKEN}"
assert_json_expr '.[0].weight_kg == 90 and .[0].deleted_at != null' "reading tombstone retained"

for bw_table in user_settings body_weight_measurements; do
  user_select "${bw_table}" "select=id" "${USER_B_TOKEN}"
  assert_status 200 "${bw_table} cross-owner select"
  assert_json_expr 'length == 0' "${bw_table} cross-owner rows hidden"
done

# The live schema and pull payload contain only the final fields.
for projection in \
  'exercise_definitions?select=bodyweight_coefficient' \
  'exercise_sets?select=weight_unit' \
  'body_weight_measurements?select=weight_value'; do
  http_request GET "${API_URL}/rest/v1/${projection}" "${USER_A_TOKEN}" "${ANON_KEY}" app_public
  assert_non_2xx "superseded column ${projection} is absent"
done

# Protocol 3 is the one shipping contract. Older clients fail before rows move.
for old_protocol in "" 1 2 invalid; do
  BOGA_TEST_SYNC_PROTOCOL="${old_protocol}" sync_push "${USER_A_TOKEN}" "${BW_BODY}"
  assert_non_2xx 'old client push rejected'
  assert_json_expr '.message | startswith("UPDATE_REQUIRED:")' 'actionable update-required push error'
  BOGA_TEST_SYNC_PROTOCOL="${old_protocol}" http_request POST "${API_URL}/rest/v1/rpc/sync_pull" \
    "${USER_A_TOKEN}" "${ANON_KEY}" app_public '{"layer":0,"limit":10}'
  assert_non_2xx 'old client pull rejected'
  assert_json_expr '.message | startswith("UPDATE_REQUIRED:")' 'actionable update-required pull error'
done

service_delete user_settings "owner_user_id=eq.${USER_A_UUID}&id=eq.settings"
assert_status 204 "settings cleanup"
service_delete body_weight_measurements "owner_user_id=eq.${USER_A_UUID}&id=eq.${BW_ID}"
assert_status 204 "reading cleanup"

echo "[sync-push] optional bodyweight sync v3 contract passed"
