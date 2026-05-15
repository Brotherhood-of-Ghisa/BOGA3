#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for sync ingest contract tests." >&2
    exit 1
  fi
}

http_request() {
  local method="$1"
  local url="$2"
  local auth_bearer="$3"
  local apikey_value="$4"
  local profile_header="${5:-}"
  local body="${6:-}"

  local response_file
  response_file="$(mktemp)"

  local -a curl_args
  curl_args=(
    --silent
    --show-error
    -X "${method}"
    -H "apikey: ${apikey_value}"
    -H "Authorization: Bearer ${auth_bearer}"
    -o "${response_file}"
    -w "%{http_code}"
  )

  if [[ -n "${profile_header}" ]]; then
    curl_args+=(-H "Accept-Profile: ${profile_header}" -H "Content-Profile: ${profile_header}")
  fi

  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
  fi

  REQUEST_STATUS="$(curl "${curl_args[@]}" "${url}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

assert_status() {
  local expected="$1"
  local context="$2"
  if [[ "${REQUEST_STATUS}" != "${expected}" ]]; then
    echo "[fail] ${context}: expected status ${expected}, got ${REQUEST_STATUS}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

assert_non_2xx() {
  local context="$1"
  if [[ "${REQUEST_STATUS}" =~ ^2 ]]; then
    echo "[fail] ${context}: expected non-2xx status, got ${REQUEST_STATUS}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

assert_json_expr() {
  if [[ "$#" -lt 2 ]]; then
    echo "[fail] assert_json_expr requires at least <jq-expr> <context>" >&2
    exit 1
  fi

  local expr_index=$(( $# - 1 ))
  local context_index=$#
  local expr="${!expr_index}"
  local context="${!context_index}"
  local jq_arg_count=$(( $# - 2 ))
  local -a jq_args=()

  if (( jq_arg_count > 0 )); then
    jq_args=("${@:1:jq_arg_count}")
  fi

  if (( jq_arg_count > 0 )); then
    jq_ok() {
      printf '%s' "${REQUEST_BODY}" | jq -e "${jq_args[@]}" "${expr}" >/dev/null
    }
  else
    jq_ok() {
      printf '%s' "${REQUEST_BODY}" | jq -e "${expr}" >/dev/null
    }
  fi

  if ! jq_ok; then
    echo "[fail] ${context}: jq assertion failed: ${expr}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

sign_in_password() {
  local email="$1"
  local password="$2"
  local payload
  payload="$(jq -nc --arg email "${email}" --arg password "${password}" '{email: $email, password: $password}')"
  http_request POST "${API_URL}/auth/v1/token?grant_type=password" "${ANON_KEY}" "${ANON_KEY}" "" "${payload}"
}

postgrest_select() {
  local table="$1"
  local query="$2"
  local token="$3"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}" "app_public"
}

rpc_sync_events_ingest() {
  local token="$1"
  local request_body="$2"
  http_request POST "${API_URL}/rest/v1/rpc/sync_events_ingest" "${token}" "${ANON_KEY}" "app_public" "${request_body}"
}

require_jq
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "Missing Supabase local runtime env. Start local stack first." >&2
  exit 1
fi

echo "[sync-ingest] signing in fixture users"
sign_in_password "${USER_A_EMAIL}" "${USER_A_PASSWORD}"
assert_status "200" "user_a sign-in"
USER_A_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]]

sign_in_password "${USER_B_EMAIL}" "${USER_B_PASSWORD}"
assert_status "200" "user_b sign-in"
USER_B_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_B_TOKEN}" && "${USER_B_TOKEN}" != "null" ]]

BASE_MS="$(($(date +%s) * 1000))"
RUN_TAG="${SYNC_INGEST_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

DEVICE_ID="sync-device-${RUN_TAG}"

EXDEF_ID="sync-exdef-${RUN_TAG}"
GYM_ID="sync-gym-${RUN_TAG}"
SESSION_ID="sync-session-${RUN_TAG}"
SX_ID="sync-sx-${RUN_TAG}"
SET_ID="sync-set-${RUN_TAG}"
MAPPING_ROW_ID="sync-map-row-${RUN_TAG}"
MAPPING_ENTITY_ID="${EXDEF_ID}:pectorals"
TAG_DEF_ID="sync-tag-${RUN_TAG}"
SESSION_TAG_ROW_ID="sync-session-tag-row-${RUN_TAG}"
SESSION_TAG_ENTITY_ID="${SX_ID}:${TAG_DEF_ID}"

EVENT_ID_1="event-${RUN_TAG}-1"
EVENT_ID_2="event-${RUN_TAG}-2"
EVENT_ID_3="event-${RUN_TAG}-3"
EVENT_ID_4="event-${RUN_TAG}-4"
EVENT_ID_5="event-${RUN_TAG}-5"
EVENT_ID_6="event-${RUN_TAG}-6"
EVENT_ID_7="event-${RUN_TAG}-7"
EVENT_ID_8="event-${RUN_TAG}-8"
EVENT_ID_9="event-${RUN_TAG}-9"
EVENT_ID_10="event-${RUN_TAG}-10"
EVENT_ID_11="event-${RUN_TAG}-11"

BATCH_1="batch-${RUN_TAG}-1"
BATCH_2="batch-${RUN_TAG}-2"
BATCH_3="batch-${RUN_TAG}-3"
BATCH_4="batch-${RUN_TAG}-4"
BATCH_5="batch-${RUN_TAG}-5"

MISSING_DELETE_DEVICE_ID="sync-device-missing-delete-${RUN_TAG}"
MISSING_DELETE_SESSION_ID="sync-session-missing-delete-${RUN_TAG}"
MISSING_DELETE_EVENT_ID="event-missing-delete-${RUN_TAG}-1"
MISSING_DELETE_BATCH_ID="batch-missing-delete-${RUN_TAG}"

MISSING_DELETE_EVENTS="$(jq -nc \
  --arg event_id "${MISSING_DELETE_EVENT_ID}" \
  --arg session_id "${MISSING_DELETE_SESSION_ID}" \
  --argjson ts "$((BASE_MS + 50))" \
  '[
    {
      event_id: $event_id,
      sequence_in_device: 1,
      occurred_at_ms: $ts,
      entity_type: "sessions",
      entity_id: $session_id,
      event_type: "delete",
      payload: {
        id: $session_id,
        deleted_at_ms: $ts,
        updated_at_ms: $ts
      }
    }
  ]')"
MISSING_DELETE_REQUEST="$(jq -nc \
  --arg device_id "${MISSING_DELETE_DEVICE_ID}" \
  --arg batch_id "${MISSING_DELETE_BATCH_ID}" \
  --argjson sent_at_ms "$((BASE_MS + 50))" \
  --argjson events "${MISSING_DELETE_EVENTS}" \
  '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${MISSING_DELETE_REQUEST}"
assert_status "200" "missing session delete ingest status"
assert_json_expr '.status == "SUCCESS"' "missing session delete is idempotent success"

postgrest_select "sync_ingested_events" "device_id=eq.${MISSING_DELETE_DEVICE_ID}&select=event_id,sequence_in_device" "${USER_A_TOKEN}"
assert_status "200" "missing session delete metadata read"
assert_json_expr --arg event_id "${MISSING_DELETE_EVENT_ID}" 'length == 1 and .[0].event_id == $event_id and .[0].sequence_in_device == 1' "missing session delete metadata persisted"

EVENTS_SUCCESS="$(jq -nc \
  --arg event_1 "${EVENT_ID_1}" \
  --arg event_2 "${EVENT_ID_2}" \
  --arg event_3 "${EVENT_ID_3}" \
  --arg event_4 "${EVENT_ID_4}" \
  --arg event_5 "${EVENT_ID_5}" \
  --arg event_6 "${EVENT_ID_6}" \
  --arg event_7 "${EVENT_ID_7}" \
  --arg event_8 "${EVENT_ID_8}" \
  --arg exdef_id "${EXDEF_ID}" \
  --arg gym_id "${GYM_ID}" \
  --arg session_id "${SESSION_ID}" \
  --arg sx_id "${SX_ID}" \
  --arg set_id "${SET_ID}" \
  --arg mapping_row_id "${MAPPING_ROW_ID}" \
  --arg mapping_entity_id "${MAPPING_ENTITY_ID}" \
  --arg tag_def_id "${TAG_DEF_ID}" \
  --arg session_tag_row_id "${SESSION_TAG_ROW_ID}" \
  --arg session_tag_entity_id "${SESSION_TAG_ENTITY_ID}" \
  --argjson t1 "$((BASE_MS + 1))" \
  --argjson t2 "$((BASE_MS + 2))" \
  --argjson t3 "$((BASE_MS + 3))" \
  --argjson t4 "$((BASE_MS + 4))" \
  --argjson t5 "$((BASE_MS + 5))" \
  --argjson t6 "$((BASE_MS + 6))" \
  --argjson t7 "$((BASE_MS + 7))" \
  --argjson t8 "$((BASE_MS + 8))" \
  '[
    {
      event_id: $event_1,
      sequence_in_device: 1,
      occurred_at_ms: $t1,
      entity_type: "exercise_definitions",
      entity_id: $exdef_id,
      event_type: "upsert",
      payload: {
        id: $exdef_id,
        name: "Bench Press",
        deleted_at_ms: null,
        created_at_ms: $t1,
        updated_at_ms: $t1
      }
    },
    {
      event_id: $event_2,
      sequence_in_device: 2,
      occurred_at_ms: $t2,
      entity_type: "gyms",
      entity_id: $gym_id,
      event_type: "upsert",
      payload: {
        id: $gym_id,
        name: "Warehouse Gym",
        origin_scope_id: "private",
        origin_source_id: "local",
        created_at_ms: $t2,
        updated_at_ms: $t2
      }
    },
    {
      event_id: $event_3,
      sequence_in_device: 3,
      occurred_at_ms: $t3,
      entity_type: "sessions",
      entity_id: $session_id,
      event_type: "upsert",
      payload: {
        id: $session_id,
        gym_id: $gym_id,
        status: "active",
        started_at_ms: $t3,
        completed_at_ms: null,
        duration_sec: null,
        deleted_at_ms: null,
        created_at_ms: $t3,
        updated_at_ms: $t3
      }
    },
    {
      event_id: $event_4,
      sequence_in_device: 4,
      occurred_at_ms: $t4,
      entity_type: "session_exercises",
      entity_id: $sx_id,
      event_type: "upsert",
      payload: {
        id: $sx_id,
        session_id: $session_id,
        exercise_definition_id: $exdef_id,
        order_index: 0,
        name: "Bench Press",
        machine_name: "Plate Press",
        origin_scope_id: "private",
        origin_source_id: "local",
        created_at_ms: $t4,
        updated_at_ms: $t4
      }
    },
    {
      event_id: $event_5,
      sequence_in_device: 5,
      occurred_at_ms: $t5,
      entity_type: "exercise_sets",
      entity_id: $set_id,
      event_type: "upsert",
      payload: {
        id: $set_id,
        session_exercise_id: $sx_id,
        order_index: 0,
        weight_value: "225",
        reps_value: "5",
        set_type: "rir_2",
        created_at_ms: $t5,
        updated_at_ms: $t5
      }
    },
    {
      event_id: $event_6,
      sequence_in_device: 6,
      occurred_at_ms: $t6,
      entity_type: "exercise_muscle_mappings",
      entity_id: $mapping_entity_id,
      event_type: "attach",
      payload: {
        id: $mapping_entity_id,
        row_id: $mapping_row_id,
        exercise_definition_id: $exdef_id,
        muscle_group_id: "pectorals",
        weight: 1,
        role: "primary",
        created_at_ms: $t6,
        updated_at_ms: $t6
      }
    },
    {
      event_id: $event_7,
      sequence_in_device: 7,
      occurred_at_ms: $t7,
      entity_type: "exercise_tag_definitions",
      entity_id: $tag_def_id,
      event_type: "upsert",
      payload: {
        id: $tag_def_id,
        exercise_definition_id: $exdef_id,
        name: "Pause",
        normalized_name: "pause",
        deleted_at_ms: null,
        created_at_ms: $t7,
        updated_at_ms: $t7
      }
    },
    {
      event_id: $event_8,
      sequence_in_device: 8,
      occurred_at_ms: $t8,
      entity_type: "session_exercise_tags",
      entity_id: $session_tag_entity_id,
      event_type: "attach",
      payload: {
        id: $session_tag_entity_id,
        row_id: $session_tag_row_id,
        session_exercise_id: $sx_id,
        exercise_tag_definition_id: $tag_def_id,
        created_at_ms: $t8
      }
    }
  ]')"

echo "[sync-ingest] unauthenticated ingest is denied"
ANON_BODY="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_1}" --argjson sent_at_ms "${BASE_MS}" --argjson events "${EVENTS_SUCCESS}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${ANON_KEY}" "${ANON_BODY}"
assert_non_2xx "anon ingest denied"

echo "[sync-ingest] success path applies full projection"
REQUEST_1="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_1}" --argjson sent_at_ms "${BASE_MS}" --argjson events "${EVENTS_SUCCESS}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_1}"
assert_status "200" "user_a ingest success"
assert_json_expr '.status == "SUCCESS"' "user_a ingest success envelope"

postgrest_select "gyms" "id=eq.${GYM_ID}&select=id,name,deleted_at" "${USER_A_TOKEN}"
assert_status "200" "user_a projection gym read"
assert_json_expr --arg id "${GYM_ID}" 'length == 1 and .[0].id == $id and .[0].deleted_at == null' "user_a projection gym state"

postgrest_select "sessions" "id=eq.${SESSION_ID}&select=id,status,gym_id" "${USER_A_TOKEN}"
assert_status "200" "user_a projection session read"
assert_json_expr --arg id "${SESSION_ID}" --arg gym_id "${GYM_ID}" 'length == 1 and .[0].id == $id and .[0].gym_id == $gym_id and .[0].status == "active"' "user_a projection session state"

postgrest_select "session_exercises" "id=eq.${SX_ID}&select=id,session_id,exercise_definition_id,order_index" "${USER_A_TOKEN}"
assert_status "200" "user_a projection session_exercise read"
assert_json_expr --arg id "${SX_ID}" --arg session_id "${SESSION_ID}" --arg exdef_id "${EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].session_id == $session_id and .[0].exercise_definition_id == $exdef_id and .[0].order_index == 0' "user_a projection session_exercise state"

postgrest_select "exercise_sets" "id=eq.${SET_ID}&select=id,session_exercise_id,order_index,set_type" "${USER_A_TOKEN}"
assert_status "200" "user_a projection exercise_set read"
assert_json_expr --arg id "${SET_ID}" --arg sx_id "${SX_ID}" 'length == 1 and .[0].id == $id and .[0].session_exercise_id == $sx_id and .[0].order_index == 0 and .[0].set_type == "rir_2"' "user_a projection exercise_set state"

postgrest_select "exercise_definitions" "id=eq.${EXDEF_ID}&select=id,name,deleted_at" "${USER_A_TOKEN}"
assert_status "200" "user_a projection exercise_definition read"
assert_json_expr --arg id "${EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].name == "Bench Press" and .[0].deleted_at == null' "user_a projection exercise_definition state"

postgrest_select "exercise_muscle_mappings" "id=eq.${MAPPING_ROW_ID}&select=id,exercise_definition_id,muscle_group_id,weight" "${USER_A_TOKEN}"
assert_status "200" "user_a projection exercise_muscle_mapping read"
assert_json_expr --arg id "${MAPPING_ROW_ID}" --arg exdef_id "${EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].exercise_definition_id == $exdef_id and .[0].muscle_group_id == "pectorals" and (. [0].weight | tonumber) == 1' "user_a projection exercise_muscle_mapping state"

postgrest_select "exercise_tag_definitions" "id=eq.${TAG_DEF_ID}&select=id,exercise_definition_id,name,normalized_name,deleted_at" "${USER_A_TOKEN}"
assert_status "200" "user_a projection exercise_tag_definition read"
assert_json_expr --arg id "${TAG_DEF_ID}" --arg exdef_id "${EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].exercise_definition_id == $exdef_id and .[0].name == "Pause" and .[0].normalized_name == "pause" and .[0].deleted_at == null' "user_a projection exercise_tag_definition state"

postgrest_select "session_exercise_tags" "id=eq.${SESSION_TAG_ROW_ID}&select=id,session_exercise_id,exercise_tag_definition_id" "${USER_A_TOKEN}"
assert_status "200" "user_a projection session_exercise_tag read"
assert_json_expr --arg id "${SESSION_TAG_ROW_ID}" --arg sx_id "${SX_ID}" --arg tag_def_id "${TAG_DEF_ID}" 'length == 1 and .[0].id == $id and .[0].session_exercise_id == $sx_id and .[0].exercise_tag_definition_id == $tag_def_id' "user_a projection session_exercise_tag state"

postgrest_select "sync_ingested_events" "device_id=eq.${DEVICE_ID}&select=event_id,sequence_in_device&order=sequence_in_device.asc" "${USER_A_TOKEN}"
assert_status "200" "user_a sync_ingested_events read"
assert_json_expr --arg event_1 "${EVENT_ID_1}" --arg event_8 "${EVENT_ID_8}" 'length == 8 and .[0].event_id == $event_1 and .[7].event_id == $event_8 and .[0].sequence_in_device == 1 and .[7].sequence_in_device == 8' "user_a sync_ingested_events initial coverage"

echo "[sync-ingest] duplicate replay is idempotent"
REQUEST_2="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_2}" --argjson sent_at_ms "$((BASE_MS + 100))" --argjson events "${EVENTS_SUCCESS}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_2}"
assert_status "200" "duplicate replay status"
assert_json_expr '.status == "SUCCESS"' "duplicate replay SUCCESS envelope"

postgrest_select "sync_ingested_events" "device_id=eq.${DEVICE_ID}&select=event_id" "${USER_A_TOKEN}"
assert_status "200" "sync_ingested_events count after replay"
assert_json_expr 'length == 8' "duplicate replay did not insert duplicate ingest rows"

echo "[sync-ingest] duplicate event_id with changed payload is rejected"
CHANGED_DUP_EVENT="$(jq -nc --arg event_id "${EVENT_ID_2}" --arg gym_id "${GYM_ID}" --argjson t "$((BASE_MS + 120))" '[
  {
    event_id: $event_id,
    sequence_in_device: 2,
    occurred_at_ms: $t,
    entity_type: "gyms",
    entity_id: $gym_id,
    event_type: "upsert",
    payload: {
      id: $gym_id,
      name: "Warehouse Gym (Tampered)",
      origin_scope_id: "private",
      origin_source_id: "local",
      created_at_ms: $t,
      updated_at_ms: $t
    }
  }
]')"
REQUEST_CHANGED="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_3}" --argjson sent_at_ms "$((BASE_MS + 120))" --argjson events "${CHANGED_DUP_EVENT}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_CHANGED}"
assert_status "200" "changed duplicate response status"
assert_json_expr --arg event_id "${EVENT_ID_2}" '.status == "FAILURE" and .error_index == 0 and .should_retry == false and .error_event_id == $event_id and (.message | length) > 0' "changed duplicate response envelope"

postgrest_select "gyms" "id=eq.${GYM_ID}&select=name" "${USER_A_TOKEN}"
assert_status "200" "gym read after changed duplicate"
assert_json_expr 'length == 1 and .[0].name == "Warehouse Gym"' "changed duplicate did not mutate projection"

echo "[sync-ingest] ordering failure stops at first bad event with prefix commit"
GYM_PREFIX_ID="sync-gym-prefix-${RUN_TAG}"
GYM_SKIPPED_ID="sync-gym-skipped-${RUN_TAG}"
ORDERING_EVENTS="$(jq -nc \
  --arg event_9 "${EVENT_ID_9}" \
  --arg event_11 "${EVENT_ID_11}" \
  --arg gym_prefix_id "${GYM_PREFIX_ID}" \
  --arg gym_skipped_id "${GYM_SKIPPED_ID}" \
  --argjson t9 "$((BASE_MS + 200))" \
  --argjson t11 "$((BASE_MS + 201))" \
  '[
    {
      event_id: $event_9,
      sequence_in_device: 9,
      occurred_at_ms: $t9,
      entity_type: "gyms",
      entity_id: $gym_prefix_id,
      event_type: "upsert",
      payload: {
        id: $gym_prefix_id,
        name: "Prefix Gym",
        origin_scope_id: "private",
        origin_source_id: "local",
        created_at_ms: $t9,
        updated_at_ms: $t9
      }
    },
    {
      event_id: $event_11,
      sequence_in_device: 11,
      occurred_at_ms: $t11,
      entity_type: "gyms",
      entity_id: $gym_skipped_id,
      event_type: "upsert",
      payload: {
        id: $gym_skipped_id,
        name: "Skipped Gym",
        origin_scope_id: "private",
        origin_source_id: "local",
        created_at_ms: $t11,
        updated_at_ms: $t11
      }
    }
  ]')"
REQUEST_ORDERING="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_4}" --argjson sent_at_ms "$((BASE_MS + 200))" --argjson events "${ORDERING_EVENTS}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_ORDERING}"
assert_status "200" "ordering failure response status"
assert_json_expr --arg event_id "${EVENT_ID_11}" '.status == "FAILURE" and .error_index == 1 and .should_retry == true and .error_event_id == $event_id and (.message | test("Expected sequence"))' "ordering failure response envelope"

postgrest_select "gyms" "id=eq.${GYM_PREFIX_ID}&select=id,name" "${USER_A_TOKEN}"
assert_status "200" "prefix gym read"
assert_json_expr --arg id "${GYM_PREFIX_ID}" 'length == 1 and .[0].id == $id and .[0].name == "Prefix Gym"' "prefix commit applied event before failure"

postgrest_select "gyms" "id=eq.${GYM_SKIPPED_ID}&select=id" "${USER_A_TOKEN}"
assert_status "200" "skipped gym read"
assert_json_expr 'length == 0' "failed event and suffix were not applied"

postgrest_select "sync_ingested_events" "device_id=eq.${DEVICE_ID}&select=event_id,sequence_in_device&order=sequence_in_device.asc" "${USER_A_TOKEN}"
assert_status "200" "sync_ingested_events read after ordering failure"
assert_json_expr --arg event_9 "${EVENT_ID_9}" 'length == 9 and .[8].event_id == $event_9 and .[8].sequence_in_device == 9' "prefix commit ingest metadata persisted"

echo "[sync-ingest] missing sequence can be retried successfully"
RECOVERY_EVENT="$(jq -nc \
  --arg event_10 "${EVENT_ID_10}" \
  --arg gym_skipped_id "${GYM_SKIPPED_ID}" \
  --argjson t10 "$((BASE_MS + 210))" \
  '[
    {
      event_id: $event_10,
      sequence_in_device: 10,
      occurred_at_ms: $t10,
      entity_type: "gyms",
      entity_id: $gym_skipped_id,
      event_type: "upsert",
      payload: {
        id: $gym_skipped_id,
        name: "Recovered Gym",
        origin_scope_id: "private",
        origin_source_id: "local",
        created_at_ms: $t10,
        updated_at_ms: $t10
      }
    }
  ]')"
REQUEST_RECOVERY="$(jq -nc --arg device_id "${DEVICE_ID}" --arg batch_id "${BATCH_5}" --argjson sent_at_ms "$((BASE_MS + 210))" --argjson events "${RECOVERY_EVENT}" '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_RECOVERY}"
assert_status "200" "recovery batch status"
assert_json_expr '.status == "SUCCESS"' "recovery batch SUCCESS"

postgrest_select "gyms" "id=eq.${GYM_SKIPPED_ID}&select=id,name" "${USER_A_TOKEN}"
assert_status "200" "recovered gym read"
assert_json_expr --arg id "${GYM_SKIPPED_ID}" 'length == 1 and .[0].id == $id and .[0].name == "Recovered Gym"' "recovery sequence applied"

echo "[sync-ingest] cross-user reads are denied by RLS"
postgrest_select "sync_ingested_events" "device_id=eq.${DEVICE_ID}&select=event_id" "${USER_B_TOKEN}"
assert_status "200" "user_b ingest metadata read"
assert_json_expr 'length == 0' "user_b denied from user_a ingest metadata"

postgrest_select "exercise_definitions" "id=eq.${EXDEF_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "user_b projection read"
assert_json_expr 'length == 0' "user_b denied from user_a projection row"

# -----------------------------------------------------------------------------
# T5 — composite-PK positive coverage.
#
# Under the T1 redesign, sync-domain tables use a composite primary key
# `(id, owner_user_id)`, so two users can each own a row with the same `id`
# without conflict. The six "<entity> id <id> belongs to a different owner"
# exception branches in `sync_apply_projection_event` were removed because the
# collision they guarded against is impossible by construction.
#
# This block proves the projection-via-event path honours that contract: both
# users ingest an `upsert` event for `exercise_definitions(id=SHARED_EXDEF_ID)`
# and both succeed; each side reads back their own row via PostgREST (RLS
# scopes the read to the owner). If anyone re-introduces a cross-owner
# rejection branch this test will fail loudly.
#
# Each user runs through its own device id so per-device sequence counters do
# not collide.
# -----------------------------------------------------------------------------
echo "[sync-ingest] shared id across two owners projects independently"
SHARED_EXDEF_ID="sync-shared-exdef-${RUN_TAG}"
SHARED_DEVICE_A="sync-shared-device-a-${RUN_TAG}"
SHARED_DEVICE_B="sync-shared-device-b-${RUN_TAG}"
SHARED_EVENT_A="event-shared-a-${RUN_TAG}"
SHARED_EVENT_B="event-shared-b-${RUN_TAG}"
SHARED_BATCH_A="batch-shared-a-${RUN_TAG}"
SHARED_BATCH_B="batch-shared-b-${RUN_TAG}"

build_shared_event() {
  local event_id="$1"
  local exdef_name="$2"
  local ts="$3"
  jq -nc \
    --arg event_id "${event_id}" \
    --arg exdef_id "${SHARED_EXDEF_ID}" \
    --arg name "${exdef_name}" \
    --argjson ts "${ts}" \
    '[
      {
        event_id: $event_id,
        sequence_in_device: 1,
        occurred_at_ms: $ts,
        entity_type: "exercise_definitions",
        entity_id: $exdef_id,
        event_type: "upsert",
        payload: {
          id: $exdef_id,
          name: $name,
          deleted_at_ms: null,
          created_at_ms: $ts,
          updated_at_ms: $ts
        }
      }
    ]'
}

SHARED_EVENTS_A="$(build_shared_event "${SHARED_EVENT_A}" "Bench Press" "$((BASE_MS + 300))")"
REQUEST_SHARED_A="$(jq -nc \
  --arg device_id "${SHARED_DEVICE_A}" \
  --arg batch_id "${SHARED_BATCH_A}" \
  --argjson sent_at_ms "$((BASE_MS + 300))" \
  --argjson events "${SHARED_EVENTS_A}" \
  '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_A_TOKEN}" "${REQUEST_SHARED_A}"
assert_status "200" "user_a shared-id ingest status"
assert_json_expr '.status == "SUCCESS"' "user_a shared-id ingest envelope"

SHARED_EVENTS_B="$(build_shared_event "${SHARED_EVENT_B}" "Bench Press" "$((BASE_MS + 301))")"
REQUEST_SHARED_B="$(jq -nc \
  --arg device_id "${SHARED_DEVICE_B}" \
  --arg batch_id "${SHARED_BATCH_B}" \
  --argjson sent_at_ms "$((BASE_MS + 301))" \
  --argjson events "${SHARED_EVENTS_B}" \
  '{device_id: $device_id, batch_id: $batch_id, sent_at_ms: $sent_at_ms, events: $events}')"
rpc_sync_events_ingest "${USER_B_TOKEN}" "${REQUEST_SHARED_B}"
assert_status "200" "user_b shared-id ingest status"
assert_json_expr '.status == "SUCCESS"' "user_b shared-id ingest envelope"

# Each user reads back their own copy. RLS scopes the read to the owner, so the
# composite-PK guarantee shows up here as "each side sees exactly one row, and
# that row carries the name they sent" — cross-owner overwrite would surface as
# the wrong name on one side.
postgrest_select "exercise_definitions" "id=eq.${SHARED_EXDEF_ID}&select=id,name" "${USER_A_TOKEN}"
assert_status "200" "user_a shared-id projection read"
assert_json_expr --arg id "${SHARED_EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].name == "Bench Press"' "user_a sees own shared-id row"

postgrest_select "exercise_definitions" "id=eq.${SHARED_EXDEF_ID}&select=id,name" "${USER_B_TOKEN}"
assert_status "200" "user_b shared-id projection read"
assert_json_expr --arg id "${SHARED_EXDEF_ID}" 'length == 1 and .[0].id == $id and .[0].name == "Bench Press"' "user_b sees own shared-id row"

# RLS still hides each owner's row from the other; the composite PK does not
# weaken row-level isolation.
postgrest_select "sync_ingested_events" "device_id=eq.${SHARED_DEVICE_A}&select=event_id" "${USER_B_TOKEN}"
assert_status "200" "user_b cross-device ingest metadata read"
assert_json_expr 'length == 0' "user_b denied from user_a shared-id ingest metadata"

postgrest_select "sync_ingested_events" "device_id=eq.${SHARED_DEVICE_B}&select=event_id" "${USER_A_TOKEN}"
assert_status "200" "user_a cross-device ingest metadata read"
assert_json_expr 'length == 0' "user_a denied from user_b shared-id ingest metadata"

echo "[sync-ingest] sync ingest contract checks passed"
