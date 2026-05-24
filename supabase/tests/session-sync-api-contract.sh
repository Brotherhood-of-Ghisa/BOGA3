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
    echo "jq is required for sync API contract tests." >&2
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
  local prefer_header="${7:-}"

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

  if [[ -n "${prefer_header}" ]]; then
    curl_args+=(-H "Prefer: ${prefer_header}")
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

assert_body_contains() {
  local needle="$1"
  local context="$2"
  if ! printf '%s' "${REQUEST_BODY}" | grep -qi "${needle}"; then
    echo "[fail] ${context}: expected response body to contain '${needle}'" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

postgrest_select() {
  local table="$1"
  local query="$2"
  local token="$3"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}" "app_public"
}

postgrest_insert() {
  local table="$1"
  local token="$2"
  local body="$3"
  http_request POST "${API_URL}/rest/v1/${table}" "${token}" "${ANON_KEY}" "app_public" "${body}" "return=representation"
}

postgrest_patch() {
  local table="$1"
  local query="$2"
  local token="$3"
  local body="$4"
  http_request PATCH "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}" "app_public" "${body}" "return=representation"
}

load_fixture_uuid() {
  local fixture_key="$1"
  http_request GET "${API_URL}/rest/v1/dev_fixture_principals?fixture_key=eq.${fixture_key}&select=subject_uuid" "${ANON_KEY}" "${ANON_KEY}"
  assert_status "200" "load fixture uuid ${fixture_key}"
  printf '%s' "${REQUEST_BODY}" | jq -r '.[0].subject_uuid'
}

sign_in_password() {
  local email="$1"
  local password="$2"
  local payload
  payload="$(jq -nc --arg email "${email}" --arg password "${password}" '{email: $email, password: $password}')"
  http_request POST "${API_URL}/auth/v1/token?grant_type=password" "${ANON_KEY}" "${ANON_KEY}" "" "${payload}"
}

require_jq
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "Missing Supabase local runtime env. Start local stack first." >&2
  exit 1
fi

echo "[sync-api] signing in fixture users"
sign_in_password "${USER_A_EMAIL}" "${USER_A_PASSWORD}"
assert_status "200" "user_a sign-in"
USER_A_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]]

sign_in_password "${USER_B_EMAIL}" "${USER_B_PASSWORD}"
assert_status "200" "user_b sign-in"
USER_B_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_B_TOKEN}" && "${USER_B_TOKEN}" != "null" ]]

USER_A_UUID="$(load_fixture_uuid "${USER_A_FIXTURE_KEY}")"
USER_B_UUID="$(load_fixture_uuid "${USER_B_FIXTURE_KEY}")"

BASE_MS="$(($(date +%s) * 1000))"
RUN_TAG="${SYNC_API_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

GYM_A_ID="sync-gym-a-${RUN_TAG}"
SESSION_A_ID="sync-session-a-${RUN_TAG}"
SX_A_ID="sync-sx-a-${RUN_TAG}"
SET_A_ID="sync-set-a-${RUN_TAG}"
ANON_GYM_ID="sync-gym-anon-${RUN_TAG}"
GYM_INVALID_ID="sync-gym-a-invalid-${RUN_TAG}"
GYM_INVALID_COORDINATE_ID="sync-gym-a-invalid-coordinate-${RUN_TAG}"
SESSION_INVALID_STATUS_ID="sync-session-a-invalid-status-${RUN_TAG}"
SX_INVALID_ID="sync-sx-a-invalid-${RUN_TAG}"
SX_CROSS_OWNER_ID="sync-sx-cross-owner-${RUN_TAG}"
SET_INVALID_ID="sync-set-a-invalid-${RUN_TAG}"
SET_INVALID_TYPE_ID="sync-set-a-invalid-type-${RUN_TAG}"
SET_CROSS_OWNER_ID="sync-set-cross-owner-${RUN_TAG}"
SESSION_SPOOF_ID="sync-session-spoof-${RUN_TAG}"

echo "[sync-api] unauthorized requests return error payloads"
postgrest_select "gyms" "select=id&limit=1" "${ANON_KEY}"
assert_non_2xx "anon select gyms"
assert_body_contains "message" "anon select gyms error payload"

postgrest_insert "gyms" "${ANON_KEY}" "$(jq -nc \
  --arg id "${ANON_GYM_ID}" \
  --arg name "Anon Gym" \
  --argjson now "${BASE_MS}" \
  '{id: $id, name: $name, created_at: $now, updated_at: $now}')"
assert_non_2xx "anon insert gym"
assert_body_contains "message" "anon insert gym error payload"

echo "[sync-api] gyms success flow (create/read/update/list)"
postgrest_insert "gyms" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${GYM_A_ID}" \
  --arg name "Warehouse Gym" \
  --argjson now "${BASE_MS}" \
  '{id: $id, name: $name, origin_scope_id: "private", origin_source_id: "local", created_at: $now, updated_at: $now}')"
assert_status "201" "user_a create gym"
assert_json_expr --arg owner "${USER_A_UUID}" --arg id "${GYM_A_ID}" 'length == 1 and .[0].id == $id and .[0].owner_user_id == $owner' "user_a create gym row"

postgrest_select "gyms" "id=eq.${GYM_A_ID}&select=id,name,updated_at,owner_user_id" "${USER_A_TOKEN}"
assert_status "200" "user_a read gym by id"
assert_json_expr --arg owner "${USER_A_UUID}" 'length == 1 and .[0].owner_user_id == $owner' "user_a read gym owner"

postgrest_patch "gyms" "id=eq.${GYM_A_ID}" "${USER_A_TOKEN}" "$(jq -nc \
  --arg name "Warehouse Gym (Renamed)" \
  --argjson updated_at "$((BASE_MS + 1))" \
  '{name: $name, latitude: 51.5072, longitude: -0.1276, coordinate_accuracy_m: 12.5, coordinates_updated_at: $updated_at, updated_at: $updated_at}')"
assert_status "200" "user_a update gym"
assert_json_expr 'length == 1 and .[0].name == "Warehouse Gym (Renamed)" and .[0].latitude == 51.5072 and .[0].longitude == -0.1276 and .[0].coordinate_accuracy_m == 12.5' "user_a update gym result"

postgrest_select "gyms" "select=id,name,updated_at&updated_at=gte.$((BASE_MS))&order=updated_at.asc" "${USER_A_TOKEN}"
assert_status "200" "user_a list gyms by updated_at"
assert_json_expr --arg id "${GYM_A_ID}" 'map(.id) | index($id) != null' "user_a list gyms contains created gym"

echo "[sync-api] gyms validation + ownership denial"
postgrest_insert "gyms" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${GYM_INVALID_ID}" \
  --argjson now "$((BASE_MS + 2))" \
  '{id: $id, name: "   ", created_at: $now, updated_at: $now}')"
assert_non_2xx "gym blank name validation"
assert_body_contains "23514" "gym blank name validation code"

postgrest_insert "gyms" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${GYM_INVALID_COORDINATE_ID}" \
  --argjson now "$((BASE_MS + 3))" \
  '{id: $id, name: "Bad Coordinates", latitude: 91, longitude: -0.1276, coordinate_accuracy_m: 12.5, coordinates_updated_at: $now, created_at: $now, updated_at: $now}')"
assert_non_2xx "gym latitude validation"
assert_body_contains "23514" "gym latitude validation code"

postgrest_select "gyms" "id=eq.${GYM_A_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "user_b cross-user gym read"
assert_json_expr 'length == 0' "user_b cross-user gym read denied"

postgrest_patch "gyms" "id=eq.${GYM_A_ID}" "${USER_B_TOKEN}" '{"name":"Hijack"}'
assert_status "200" "user_b cross-user gym update"
assert_json_expr 'length == 0' "user_b cross-user gym update denied"

echo "[sync-api] sessions success flow (create/read/update/list)"
postgrest_insert "sessions" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SESSION_A_ID}" \
  --arg gym_id "${GYM_A_ID}" \
  --argjson started_at "$((BASE_MS + 10))" \
  --argjson created_at "$((BASE_MS + 10))" \
  --argjson updated_at "$((BASE_MS + 10))" \
  '{id: $id, gym_id: $gym_id, status: "draft", started_at: $started_at, created_at: $created_at, updated_at: $updated_at}')"
assert_status "201" "user_a create session"
assert_json_expr --arg owner "${USER_A_UUID}" 'length == 1 and .[0].owner_user_id == $owner and .[0].status == "draft"' "user_a create session row"

postgrest_select "sessions" "id=eq.${SESSION_A_ID}&select=id,gym_id,status,started_at,owner_user_id" "${USER_A_TOKEN}"
assert_status "200" "user_a read session by id"
assert_json_expr --arg gym_id "${GYM_A_ID}" 'length == 1 and .[0].gym_id == $gym_id' "user_a read session payload"

postgrest_patch "sessions" "id=eq.${SESSION_A_ID}" "${USER_A_TOKEN}" "$(jq -nc \
  --argjson completed_at "$((BASE_MS + 4000))" \
  --argjson updated_at "$((BASE_MS + 4001))" \
  '{status: "completed", completed_at: $completed_at, duration_sec: 4, updated_at: $updated_at}')"
assert_status "200" "user_a update session"
assert_json_expr 'length == 1 and .[0].status == "completed" and .[0].duration_sec == 4' "user_a update session result"

postgrest_select "sessions" "select=id,status,updated_at&updated_at=gte.$((BASE_MS))&order=updated_at.asc" "${USER_A_TOKEN}"
assert_status "200" "user_a list sessions by updated_at"
assert_json_expr --arg id "${SESSION_A_ID}" 'map(.id) | index($id) != null' "user_a list sessions contains created session"

echo "[sync-api] sessions validation + ownership denial"
postgrest_insert "sessions" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SESSION_INVALID_STATUS_ID}" \
  --arg gym_id "${GYM_A_ID}" \
  --argjson now "$((BASE_MS + 20))" \
  '{id: $id, gym_id: $gym_id, status: "bad_status", started_at: $now, created_at: $now, updated_at: $now}')"
assert_non_2xx "session invalid status validation"
assert_body_contains "23514" "session invalid status validation code"

postgrest_patch "sessions" "id=eq.${SESSION_A_ID}" "${USER_B_TOKEN}" '{"status":"active"}'
assert_status "200" "user_b cross-user session update"
assert_json_expr 'length == 0' "user_b cross-user session update denied"

postgrest_select "sessions" "id=eq.${SESSION_A_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "user_b cross-user session read"
assert_json_expr 'length == 0' "user_b cross-user session read denied"

echo "[sync-api] session_exercises success flow (create/read/update/list)"
postgrest_insert "session_exercises" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SX_A_ID}" \
  --arg session_id "${SESSION_A_ID}" \
  --argjson created_at "$((BASE_MS + 30))" \
  --argjson updated_at "$((BASE_MS + 30))" \
  '{id: $id, session_id: $session_id, order_index: 0, name: "Chest Press", machine_name: "Plate Press", exercise_definition_id: null, created_at: $created_at, updated_at: $updated_at}')"
assert_status "201" "user_a create session_exercise"
assert_json_expr --arg owner "${USER_A_UUID}" 'length == 1 and .[0].owner_user_id == $owner and .[0].order_index == 0 and .[0].exercise_definition_id == null' "user_a create session_exercise row"

postgrest_select "session_exercises" "id=eq.${SX_A_ID}&select=id,session_id,order_index,name,machine_name,exercise_definition_id" "${USER_A_TOKEN}"
assert_status "200" "user_a read session_exercise by id"
assert_json_expr --arg session_id "${SESSION_A_ID}" 'length == 1 and .[0].session_id == $session_id and .[0].exercise_definition_id == null' "user_a read session_exercise payload"

postgrest_patch "session_exercises" "id=eq.${SX_A_ID}" "${USER_A_TOKEN}" "$(jq -nc \
  --arg machine_name "Incline Press" \
  --argjson updated_at "$((BASE_MS + 31))" \
  '{machine_name: $machine_name, exercise_definition_id: null, updated_at: $updated_at}')"
assert_status "200" "user_a update session_exercise"
assert_json_expr 'length == 1 and .[0].machine_name == "Incline Press" and .[0].exercise_definition_id == null' "user_a update session_exercise result"

postgrest_select "session_exercises" "session_id=eq.${SESSION_A_ID}&select=id,order_index,name&order=order_index.asc" "${USER_A_TOKEN}"
assert_status "200" "user_a list session_exercises by session"
assert_json_expr --arg id "${SX_A_ID}" 'length == 1 and .[0].id == $id' "user_a list session_exercises payload"

echo "[sync-api] session_exercises validation + ownership denial"
postgrest_insert "session_exercises" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SX_INVALID_ID}" \
  --arg session_id "${SESSION_A_ID}" \
  --argjson now "$((BASE_MS + 32))" \
  '{id: $id, session_id: $session_id, order_index: 1, name: "   ", created_at: $now, updated_at: $now}')"
assert_non_2xx "session_exercise blank name validation"
assert_body_contains "23514" "session_exercise blank name validation code"

postgrest_patch "session_exercises" "id=eq.${SX_A_ID}" "${USER_B_TOKEN}" '{"name":"Hijack"}'
assert_status "200" "user_b cross-user session_exercise update"
assert_json_expr 'length == 0' "user_b cross-user session_exercise update denied"

postgrest_insert "session_exercises" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${SX_CROSS_OWNER_ID}" \
  --arg session_id "${SESSION_A_ID}" \
  --argjson now "$((BASE_MS + 33))" \
  '{id: $id, session_id: $session_id, order_index: 9, name: "Bad Link", created_at: $now, updated_at: $now}')"
assert_non_2xx "cross-user session_exercise parent link"
assert_body_contains "foreign key" "cross-user session_exercise parent link error"

echo "[sync-api] exercise_sets success flow (create/read/update/list)"
postgrest_insert "exercise_sets" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SET_A_ID}" \
  --arg session_exercise_id "${SX_A_ID}" \
  --arg set_type "rir_2" \
  --argjson created_at "$((BASE_MS + 40))" \
  --argjson updated_at "$((BASE_MS + 40))" \
  '{id: $id, session_exercise_id: $session_exercise_id, order_index: 0, weight_value: "120", reps_value: "10", set_type: $set_type, created_at: $created_at, updated_at: $updated_at}')"
assert_status "201" "user_a create exercise_set"
assert_json_expr --arg owner "${USER_A_UUID}" 'length == 1 and .[0].owner_user_id == $owner and .[0].order_index == 0 and .[0].set_type == "rir_2"' "user_a create exercise_set row"

postgrest_select "exercise_sets" "id=eq.${SET_A_ID}&select=id,session_exercise_id,order_index,weight_value,reps_value,set_type" "${USER_A_TOKEN}"
assert_status "200" "user_a read exercise_set by id"
assert_json_expr --arg sx_id "${SX_A_ID}" 'length == 1 and .[0].session_exercise_id == $sx_id and .[0].set_type == "rir_2"' "user_a read exercise_set payload"

postgrest_patch "exercise_sets" "id=eq.${SET_A_ID}" "${USER_A_TOKEN}" "$(jq -nc \
  --arg reps_value "12" \
  --arg set_type "rir_0" \
  --argjson updated_at "$((BASE_MS + 41))" \
  '{reps_value: $reps_value, set_type: $set_type, updated_at: $updated_at}')"
assert_status "200" "user_a update exercise_set"
assert_json_expr 'length == 1 and .[0].reps_value == "12" and .[0].set_type == "rir_0"' "user_a update exercise_set result"

postgrest_select "exercise_sets" "session_exercise_id=eq.${SX_A_ID}&select=id,order_index,reps_value&order=order_index.asc" "${USER_A_TOKEN}"
assert_status "200" "user_a list exercise_sets by session_exercise"
assert_json_expr --arg id "${SET_A_ID}" 'length == 1 and .[0].id == $id' "user_a list exercise_sets payload"

echo "[sync-api] exercise_sets validation + ownership denial"
postgrest_insert "exercise_sets" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SET_INVALID_ID}" \
  --arg session_exercise_id "${SX_A_ID}" \
  --argjson now "$((BASE_MS + 42))" \
  '{id: $id, session_exercise_id: $session_exercise_id, order_index: -1, weight_value: "100", reps_value: "8", created_at: $now, updated_at: $now}')"
assert_non_2xx "exercise_set negative order validation"
assert_body_contains "23514" "exercise_set negative order validation code"

postgrest_insert "exercise_sets" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SET_INVALID_TYPE_ID}" \
  --arg session_exercise_id "${SX_A_ID}" \
  --arg set_type "bad_type" \
  --argjson now "$((BASE_MS + 43))" \
  '{id: $id, session_exercise_id: $session_exercise_id, order_index: 1, weight_value: "100", reps_value: "8", set_type: $set_type, created_at: $now, updated_at: $now}')"
assert_non_2xx "exercise_set invalid set_type validation"
assert_body_contains "23514" "exercise_set invalid set_type validation code"

postgrest_patch "exercise_sets" "id=eq.${SET_A_ID}" "${USER_B_TOKEN}" '{"reps_value":"99"}'
assert_status "200" "user_b cross-user exercise_set update"
assert_json_expr 'length == 0' "user_b cross-user exercise_set update denied"

postgrest_insert "exercise_sets" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${SET_CROSS_OWNER_ID}" \
  --arg session_exercise_id "${SX_A_ID}" \
  --argjson now "$((BASE_MS + 44))" \
  '{id: $id, session_exercise_id: $session_exercise_id, order_index: 9, weight_value: "200", reps_value: "3", created_at: $now, updated_at: $now}')"
assert_non_2xx "cross-user exercise_set parent link"
assert_body_contains "foreign key" "cross-user exercise_set parent link error"

echo "[sync-api] owner spoofing is denied across write methods"
postgrest_insert "sessions" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${SESSION_SPOOF_ID}" \
  --arg owner "${USER_A_UUID}" \
  --argjson now "$((BASE_MS + 50))" \
  '{id: $id, owner_user_id: $owner, status: "draft", started_at: $now, created_at: $now, updated_at: $now}')"
assert_non_2xx "session owner spoofing insert"
assert_body_contains "row-level security" "session owner spoofing insert denied"

echo "[sync-api] sync API contract checks passed"
