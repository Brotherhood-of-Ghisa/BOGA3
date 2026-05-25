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
    echo "jq is required for auth/authz contract tests." >&2
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

assert_body_contains() {
  local needle="$1"
  local context="$2"
  if ! printf '%s' "${REQUEST_BODY}" | grep -qi "${needle}"; then
    echo "[fail] ${context}: expected response body to contain '${needle}'" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
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

postgrest_insert() {
  local table="$1"
  local token="$2"
  local body="$3"
  local url="${API_URL}/rest/v1/${table}"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" \
    -H "Accept-Profile: app_public" \
    -H "Content-Profile: app_public" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${body}" \
    "${url}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

postgrest_patch() {
  local table="$1"
  local query="$2"
  local token="$3"
  local body="$4"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X PATCH \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" \
    -H "Accept-Profile: app_public" \
    -H "Content-Profile: app_public" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${body}" \
    "${API_URL}/rest/v1/${table}?${query}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

postgrest_select() {
  local table="$1"
  local query="$2"
  local token="$3"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}" "app_public"
}

public_postgrest_insert_minimal() {
  local table="$1"
  local token="$2"
  local body="$3"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${body}" \
    "${API_URL}/rest/v1/${table}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

public_postgrest_patch_minimal() {
  local table="$1"
  local query="$2"
  local token="$3"
  local body="$4"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X PATCH \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${body}" \
    "${API_URL}/rest/v1/${table}?${query}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

public_postgrest_delete_minimal() {
  local table="$1"
  local query="$2"
  local token="$3"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X DELETE \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" \
    -H "Prefer: return=minimal" \
    -o "${response_file}" \
    -w "%{http_code}" \
    "${API_URL}/rest/v1/${table}?${query}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

public_postgrest_select() {
  local table="$1"
  local query="$2"
  local token="$3"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}"
}

require_jq
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "Missing Supabase local runtime env. Start local stack first." >&2
  exit 1
fi

echo "[auth-test] verifying public signup is disabled"
SIGNUP_PAYLOAD="$(jq -nc --arg email "signup_probe@example.test" --arg password "SignupProbe!234" '{email: $email, password: $password}')"
http_request POST "${API_URL}/auth/v1/signup" "${ANON_KEY}" "${ANON_KEY}" "" "${SIGNUP_PAYLOAD}"
assert_non_2xx "disabled self-signup"

echo "[auth-test] verifying password auth success/failure"
sign_in_password "${USER_A_EMAIL}" "${USER_A_PASSWORD}"
assert_status "200" "user_a password sign-in"
USER_A_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]]

sign_in_password "${USER_A_EMAIL}" "WrongPassword!999"
assert_non_2xx "user_a invalid password"

sign_in_password "${USER_B_EMAIL}" "${USER_B_PASSWORD}"
assert_status "200" "user_b password sign-in"
USER_B_TOKEN="$(printf '%s' "${REQUEST_BODY}" | jq -r '.access_token')"
[[ -n "${USER_B_TOKEN}" && "${USER_B_TOKEN}" != "null" ]]

USER_A_UUID="$(load_fixture_uuid "${USER_A_FIXTURE_KEY}")"
USER_B_UUID="$(load_fixture_uuid "${USER_B_FIXTURE_KEY}")"

RUN_TAG="${AUTH_AUTHZ_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
USERNAME_A="alpha-lifter-${RUN_TAG}"
USERNAME_B="beta-lifter-${RUN_TAG}"

GYM_A_ID="gym-user-a-${RUN_TAG}"
SESSION_A_ID="session-user-a-${RUN_TAG}"
SX_A_ID="sx-user-a-${RUN_TAG}"
SET_A_ID="set-user-a-${RUN_TAG}"
GYM_B_ID="gym-user-b-${RUN_TAG}"
GYM_SPOOF_ID="gym-spoof-${RUN_TAG}"
SX_CROSS_OWNER_ID="sx-user-b-cross-${RUN_TAG}"
APP_LOG_EVENT="auth-test-${RUN_TAG}"

echo "[auth-test] verifying app_logs insert-only diagnostics policy"
public_postgrest_insert_minimal "app_logs" "${ANON_KEY}" "$(jq -nc \
  --arg event "${APP_LOG_EVENT}-anon" \
  '{level: "error", source: "app", event: $event}')"
assert_non_2xx "anon insert app_logs"

public_postgrest_insert_minimal "app_logs" "${USER_A_TOKEN}" "$(jq -nc \
  --arg event "${APP_LOG_EVENT}" \
  --arg user_id "${USER_A_UUID}" \
  '{level: "error", source: "auth", event: $event, user_id: $user_id, context: {status: "probe"}}')"
assert_status "201" "user_a insert own app_log"

public_postgrest_insert_minimal "app_logs" "${USER_B_TOKEN}" "$(jq -nc \
  --arg event "${APP_LOG_EVENT}-spoof" \
  --arg user_id "${USER_A_UUID}" \
  '{level: "error", source: "auth", event: $event, user_id: $user_id}')"
assert_non_2xx "user_b spoof user_a app_log user_id"

public_postgrest_select "app_logs" "event=eq.${APP_LOG_EVENT}&select=id,event" "${USER_A_TOKEN}"
assert_non_2xx "authenticated select app_logs"

public_postgrest_patch_minimal "app_logs" "event=eq.${APP_LOG_EVENT}" "${USER_A_TOKEN}" '{"message":"patched"}'
assert_non_2xx "authenticated update app_logs"

public_postgrest_delete_minimal "app_logs" "event=eq.${APP_LOG_EVENT}" "${USER_A_TOKEN}"
assert_non_2xx "authenticated delete app_logs"

echo "[auth-test] verifying user_profiles ownership and lazy creation path"
postgrest_select "user_profiles" "id=eq.${USER_A_UUID}&select=id,username" "${USER_A_TOKEN}"
assert_status "200" "user_a select user_profile"
USER_A_PROFILE_COUNT="$(printf '%s' "${REQUEST_BODY}" | jq -r 'length')"
if [[ "${USER_A_PROFILE_COUNT}" == "0" ]]; then
  postgrest_insert "user_profiles" "${USER_A_TOKEN}" "$(jq -nc \
    --arg id "${USER_A_UUID}" \
    '{id: $id}')"
  assert_status "201" "user_a insert own user_profile when missing"
  printf '%s' "${REQUEST_BODY}" | jq -e --arg id "${USER_A_UUID}" '.[0].id == $id and .[0].username == null' >/dev/null
fi

postgrest_patch "user_profiles" "id=eq.${USER_A_UUID}" "${USER_A_TOKEN}" "$(jq -nc \
  --arg username "${USERNAME_A}" \
  '{username: $username}')"
assert_status "200" "user_a update own user_profile username"
printf '%s' "${REQUEST_BODY}" | jq -e --arg username "${USERNAME_A}" 'length == 1 and .[0].username == $username' >/dev/null

postgrest_select "user_profiles" "id=eq.${USER_A_UUID}&select=id,username" "${USER_B_TOKEN}"
assert_status "200" "user_b select user_a profile"
printf '%s' "${REQUEST_BODY}" | jq -e 'length == 0' >/dev/null

postgrest_patch "user_profiles" "id=eq.${USER_A_UUID}" "${USER_B_TOKEN}" '{"username":"cross-user"}'
assert_status "200" "user_b patch user_a profile"
printf '%s' "${REQUEST_BODY}" | jq -e 'length == 0' >/dev/null

postgrest_insert "user_profiles" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${USER_A_UUID}" \
  --arg username "spoof-profile-${RUN_TAG}" \
  '{id: $id, username: $username}')"
assert_non_2xx "user_b spoof user_a profile insert"

postgrest_select "user_profiles" "id=eq.${USER_B_UUID}&select=id,username" "${USER_B_TOKEN}"
assert_status "200" "user_b select own user_profile"
USER_B_PROFILE_COUNT="$(printf '%s' "${REQUEST_BODY}" | jq -r 'length')"
if [[ "${USER_B_PROFILE_COUNT}" == "0" ]]; then
  postgrest_insert "user_profiles" "${USER_B_TOKEN}" "$(jq -nc \
    --arg id "${USER_B_UUID}" \
    --arg username "${USERNAME_B}" \
    '{id: $id, username: $username}')"
  assert_status "201" "user_b insert own user_profile when missing"
  printf '%s' "${REQUEST_BODY}" | jq -e --arg username "${USERNAME_B}" 'length == 1 and .[0].username == $username' >/dev/null
else
  postgrest_patch "user_profiles" "id=eq.${USER_B_UUID}" "${USER_B_TOKEN}" "$(jq -nc \
    --arg username "${USERNAME_B}" \
    '{username: $username}')"
  assert_status "200" "user_b update own user_profile username"
  printf '%s' "${REQUEST_BODY}" | jq -e --arg username "${USERNAME_B}" 'length == 1 and .[0].username == $username' >/dev/null
fi

echo "[auth-test] creating user-scoped records for user_a"
NOW_MS="$(($(date +%s) * 1000))"
# v2 schema (designs/sync-v2/t1.md §2): every entity table requires
# client_updated_at_ms NOT NULL. Direct PostgREST inserts in this auth/RLS
# contract must supply it; the sync push RPC (t3) will close over the same
# rule on the wire-level path.
postgrest_insert "gyms" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${GYM_A_ID}" \
  --arg name "Garage A" \
  --argjson now "${NOW_MS}" \
  '{id: $id, name: $name, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_status "201" "user_a insert gym"
printf '%s' "${REQUEST_BODY}" | jq -e --arg owner "${USER_A_UUID}" '.[0].owner_user_id == $owner' >/dev/null

postgrest_insert "sessions" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SESSION_A_ID}" \
  --arg gym_id "${GYM_A_ID}" \
  --argjson now "${NOW_MS}" \
  --arg status "active" \
  '{id: $id, gym_id: $gym_id, status: $status, started_at: $now, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_status "201" "user_a insert session"

postgrest_insert "session_exercises" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SX_A_ID}" \
  --arg session_id "${SESSION_A_ID}" \
  --arg name "Chest Press" \
  --argjson now "${NOW_MS}" \
  '{id: $id, session_id: $session_id, order_index: 0, name: $name, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_status "201" "user_a insert session_exercise"

postgrest_insert "exercise_sets" "${USER_A_TOKEN}" "$(jq -nc \
  --arg id "${SET_A_ID}" \
  --arg session_exercise_id "${SX_A_ID}" \
  --argjson now "${NOW_MS}" \
  '{id: $id, session_exercise_id: $session_exercise_id, order_index: 0, weight_value: "120", reps_value: "10", created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_status "201" "user_a insert exercise_set"

echo "[auth-test] verifying unauthenticated access is denied for protected app tables"
postgrest_select "gyms" "select=id&limit=1" "${ANON_KEY}"
assert_non_2xx "anon select gyms"

echo "[auth-test] verifying cross-user RLS denies reads/updates"
postgrest_select "gyms" "id=eq.${GYM_A_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "user_b select user_a gym"
printf '%s' "${REQUEST_BODY}" | jq -e 'length == 0' >/dev/null

postgrest_patch "sessions" "id=eq.${SESSION_A_ID}" "${USER_B_TOKEN}" '{"status":"active"}'
assert_status "200" "user_b patch user_a session"
printf '%s' "${REQUEST_BODY}" | jq -e 'length == 0' >/dev/null

echo "[auth-test] verifying owner spoofing insert is denied by RLS"
postgrest_insert "gyms" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${GYM_SPOOF_ID}" \
  --arg name "Spoof Gym" \
  --arg owner "${USER_A_UUID}" \
  --argjson now "${NOW_MS}" \
  '{id: $id, owner_user_id: $owner, name: $name, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_non_2xx "user_b spoof owner_user_id on gym insert"

echo "[auth-test] verifying cross-user parent/child mismatch is rejected"
postgrest_insert "session_exercises" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${SX_CROSS_OWNER_ID}" \
  --arg session_id "${SESSION_A_ID}" \
  --arg name "Bad Link" \
  --argjson now "${NOW_MS}" \
  '{id: $id, session_id: $session_id, order_index: 1, name: $name, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_non_2xx "cross-user session_exercise parent link"
assert_body_contains "foreign key" "cross-user session_exercise parent link"

echo "[auth-test] verifying user_b can create own rows"
postgrest_insert "gyms" "${USER_B_TOKEN}" "$(jq -nc \
  --arg id "${GYM_B_ID}" \
  --arg name "Garage B" \
  --argjson now "${NOW_MS}" \
  '{id: $id, name: $name, created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
assert_status "201" "user_b insert own gym"

echo "[auth-test] auth/authz contract checks passed"
