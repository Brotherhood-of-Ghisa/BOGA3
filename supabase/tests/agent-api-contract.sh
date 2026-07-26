#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

fail() {
  echo "[agent-api-test] FAIL: $*" >&2
  if [[ -n "${RESPONSE_BODY:-}" ]]; then
    echo "${RESPONSE_BODY}" >&2
  fi
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

request() {
  local method="$1"
  local url="$2"
  local bearer="${3:-}"
  local api_key="${4:-}"
  local body="${5:-}"
  local content_type="${6:-application/json}"
  local response_file
  response_file="$(mktemp)"
  local -a request_args=(
    --silent
    --show-error
    -X "${method}"
    -H "Accept: application/json"
    -o "${response_file}"
    -w "%{http_code}"
  )
  [[ -n "${bearer}" ]] && request_args+=(-H "Authorization: Bearer ${bearer}")
  [[ -n "${api_key}" ]] && request_args+=(-H "apikey: ${api_key}")
  if [[ -n "${body}" ]]; then
    request_args+=(-H "Content-Type: ${content_type}" --data "${body}")
  fi
  RESPONSE_STATUS="$(curl "${request_args[@]}" "${url}")"
  RESPONSE_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

app_public_request() {
  local method="$1"
  local route="$2"
  local bearer="$3"
  local body="${4:-}"
  local response_file
  response_file="$(mktemp)"
  local -a request_args=(
    --silent
    --show-error
    -X "${method}"
    -H "Accept: application/json"
    -H "Accept-Profile: app_public"
    -H "Content-Profile: app_public"
    -H "Authorization: Bearer ${bearer}"
    -H "apikey: ${ANON_KEY}"
    -o "${response_file}"
    -w "%{http_code}"
  )
  if [[ -n "${body}" ]]; then
    request_args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  RESPONSE_STATUS="$(curl "${request_args[@]}" "${API_URL}/rest/v1/${route}")"
  RESPONSE_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

assert_status() {
  local expected="$1"
  local context="$2"
  [[ "${RESPONSE_STATUS}" == "${expected}" ]] ||
    fail "${context}: expected status ${expected}, got ${RESPONSE_STATUS}"
}

assert_non_2xx() {
  local context="$1"
  [[ ! "${RESPONSE_STATUS}" =~ ^2 ]] ||
    fail "${context}: expected a non-2xx response, got ${RESPONSE_STATUS}"
}

sign_in_password() {
  local email="$1"
  local password="$2"
  local payload
  payload="$(jq -nc --arg email "${email}" --arg password "${password}" \
    '{email: $email, password: $password}')"
  request POST "${API_URL}/auth/v1/token?grant_type=password" \
    "${ANON_KEY}" "${ANON_KEY}" "${payload}"
  assert_status "200" "password sign-in for ${email}"
  printf '%s' "${RESPONSE_BODY}" | jq -er '.access_token'
}

register_oauth_client() {
  local client_name="$1"
  local payload
  payload="$(jq -nc \
    --arg name "${client_name}" \
    --arg redirect "${OAUTH_REDIRECT_URI}" \
    '{
      client_name: $name,
      redirect_uris: [$redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"]
    }')"
  request POST "${API_URL}/auth/v1/oauth/clients/register" "" "" "${payload}"
  assert_status "201" "dynamic OAuth client registration"
  printf '%s' "${RESPONSE_BODY}" | jq -er '.client_id'
}

mint_agent_token() {
  local user_email="$1"
  local user_password="$2"
  local client_name="$3"
  local app_token client_id verifier challenge location authorization_id
  local consent_payload redirect_url authorization_code token_payload
  local header_file body_file

  app_token="$(sign_in_password "${user_email}" "${user_password}")"
  client_id="$(register_oauth_client "${client_name}")"
  verifier="$(openssl rand -hex 48)"
  challenge="$(
    printf '%s' "${verifier}" |
      openssl dgst -sha256 -binary |
      openssl base64 -A |
      tr '+/' '-_' |
      tr -d '='
  )"

  header_file="$(mktemp)"
  body_file="$(mktemp)"
  RESPONSE_STATUS="$(
    curl --silent --show-error \
      --get \
      --max-redirs 0 \
      -D "${header_file}" \
      -o "${body_file}" \
      -w "%{http_code}" \
      --data-urlencode "client_id=${client_id}" \
      --data-urlencode "redirect_uri=${OAUTH_REDIRECT_URI}" \
      --data-urlencode "response_type=code" \
      --data-urlencode "scope=openid profile" \
      --data-urlencode "code_challenge=${challenge}" \
      --data-urlencode "code_challenge_method=S256" \
      --data-urlencode "state=agent-api-contract" \
      "${API_URL}/auth/v1/oauth/authorize"
  )"
  RESPONSE_BODY="$(cat "${body_file}")"
  location="$(
    tr -d '\r' <"${header_file}" |
      awk 'tolower($1) == "location:" {sub(/^[^:]+:[[:space:]]*/, ""); print; exit}'
  )"
  rm -f "${header_file}" "${body_file}"
  assert_status "302" "OAuth authorization start"
  authorization_id="$(printf '%s' "${location}" | sed -n 's/.*[?&]authorization_id=\([^&]*\).*/\1/p')"
  [[ "${authorization_id}" =~ ^[A-Za-z0-9_-]+$ ]] ||
    fail "OAuth authorization did not return an authorization identifier"

  request GET "${API_URL}/auth/v1/oauth/authorizations/${authorization_id}" \
    "${app_token}" "${ANON_KEY}"
  assert_status "200" "OAuth consent details"
  [[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.client.id')" == "${client_id}" ]] ||
    fail "OAuth consent details returned the wrong client"

  consent_payload='{"action":"approve"}'
  request POST "${API_URL}/auth/v1/oauth/authorizations/${authorization_id}/consent" \
    "${app_token}" "${ANON_KEY}" "${consent_payload}"
  assert_status "200" "explicit OAuth consent"
  redirect_url="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.redirect_url')"
  authorization_code="$(printf '%s' "${redirect_url}" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
  [[ -n "${authorization_code}" ]] || fail "OAuth consent did not return a code"

  token_payload="$(
    curl --silent --show-error \
      -X POST \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "grant_type=authorization_code" \
      --data-urlencode "client_id=${client_id}" \
      --data-urlencode "code=${authorization_code}" \
      --data-urlencode "redirect_uri=${OAUTH_REDIRECT_URI}" \
      --data-urlencode "code_verifier=${verifier}" \
      "${API_URL}/auth/v1/oauth/token"
  )"
  AGENT_ACCESS_TOKEN="$(printf '%s' "${token_payload}" | jq -er '.access_token')" ||
    fail "OAuth token exchange did not return an access token"
  AGENT_REFRESH_TOKEN="$(printf '%s' "${token_payload}" | jq -er '.refresh_token')" ||
    fail "OAuth token exchange did not return a refresh token"
  AGENT_CLIENT_ID="${client_id}"
  APP_ACCESS_TOKEN="${app_token}"
}

make_expired_token() {
  node -e '
    const crypto = require("node:crypto");
    const token = process.argv[1];
    const parts = token.split(".");
    if (parts.length !== 3) process.exit(2);
    const header = { alg: "HS256", typ: "JWT" };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
    payload.exp = Math.floor(Date.now() / 1000) - 60;
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const message = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto
      .createHmac("sha256", "super-secret-jwt-token-with-at-least-32-characters-long")
      .update(message)
      .digest("base64url");
    process.stdout.write(`${message}.${signature}`);
  ' "$1"
}

run_psql() {
  local sql="$1"
  docker exec -i "${DB_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 -Atq <<<"${sql}"
}

agent_get() {
  local route="$1"
  local token="${2:-${AGENT_ACCESS_TOKEN}}"
  request GET "${AGENT_API_BASE}/${route}" "${token}" ""
}

cleanup() {
  [[ -n "${RUN_TAG:-}" && -n "${USER_A_UUID:-}" && -n "${USER_B_UUID:-}" ]] || return 0
  run_psql "
    begin;
      set constraints all deferred;
      delete from public.agent_access_audit
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and request_id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.exercise_sets
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.session_exercises
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.exercise_muscle_mappings
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.sessions
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.muscle_groups
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.exercise_definitions
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.gyms
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
    commit;
  " >/dev/null 2>&1 || true
}

cleanup_with_status() {
  local status="$?"
  cleanup
  exit "${status}"
}

require_command curl
require_command docker
require_command jq
require_command node
require_command openssl

load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"
AGENT_API_BASE="${API_URL}/functions/v1/agent-api/v1/agent"
OAUTH_REDIRECT_URI="http://127.0.0.1:43123/callback"
RUN_TAG="${AGENT_API_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
USER_A_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_A_FIXTURE_KEY}';")"
USER_B_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_B_FIXTURE_KEY}';")"
[[ -n "${USER_A_UUID}" && -n "${USER_B_UUID}" ]] ||
  fail "fixture users are not provisioned"
trap cleanup_with_status EXIT

GYM_A="agent-api-${RUN_TAG}-gym-a"
EXERCISE_A="agent-api-${RUN_TAG}-exercise-a"
EXERCISE_A2="agent-api-${RUN_TAG}-exercise-a2"
EXERCISE_B="agent-api-${RUN_TAG}-exercise-b"
MUSCLE_A="agent-api-${RUN_TAG}-muscle-a"
MAPPING_A="agent-api-${RUN_TAG}-mapping-a"
SESSION_A="agent-api-${RUN_TAG}-session-a"
BLOCK_A="agent-api-${RUN_TAG}-block-a"
SET_A1="agent-api-${RUN_TAG}-set-a1"
SET_A2="agent-api-${RUN_TAG}-set-a2"
NOW_MS="$(($(date +%s) * 1000))"
STARTED_MS="$((NOW_MS - 3600000))"
COMPLETED_MS="$((NOW_MS - 3000000))"

echo "[agent-api-test] seeding isolated user A/B training fixtures"
run_psql "
  begin;
    set constraints all deferred;
    insert into app_public.gyms
      (owner_user_id,id,name,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${GYM_A}','Agent A Gym',${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_definitions
      (owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EXERCISE_A}','Agent A Bench','total_load',${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${EXERCISE_A2}','Agent A Squat','per_side_load',${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_B_UUID}'::uuid,'${EXERCISE_B}','User B Secret Lift','total_load',${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.muscle_groups
      (owner_user_id,id,display_name,family_name,sort_order,is_editable,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${MUSCLE_A}','Pectorals','chest',0,0,
       ${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_muscle_mappings
      (owner_user_id,id,exercise_definition_id,muscle_group_id,weight,role,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${MAPPING_A}','${EXERCISE_A}','${MUSCLE_A}',1.0,'primary',
       ${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.sessions
      (owner_user_id,id,gym_id,status,started_at,completed_at,duration_sec,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${SESSION_A}','${GYM_A}','completed',
       ${STARTED_MS},${COMPLETED_MS},600,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.session_exercises
      (owner_user_id,id,session_id,exercise_definition_id,order_index,name,machine_name,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${BLOCK_A}','${SESSION_A}','${EXERCISE_A}',0,
       'Agent A Bench','Rack 1',${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_sets
      (owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
       performance_status,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${SET_A1}','${BLOCK_A}',0,'100','8','working',
       'matched',${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SET_A2}','${BLOCK_A}',1,'105','5','working',
       'failed',${NOW_MS},${NOW_MS},${NOW_MS});
  commit;
" >/dev/null

echo "[agent-api-test] minting a real OAuth access token through PKCE + consent"
mint_agent_token "${USER_A_EMAIL}" "${USER_A_PASSWORD}" "BoGa contract agent ${RUN_TAG}"
[[ -n "${AGENT_ACCESS_TOKEN}" && -n "${AGENT_CLIENT_ID}" && -n "${APP_ACCESS_TOKEN}" ]] ||
  fail "OAuth fixture did not produce required credentials"

echo "[agent-api-test] verifying profile privacy and user A exercise retrieval"
agent_get "profile"
assert_status "200" "training profile"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.units.load == "kg"
  and .data.timezone == "UTC"
  and (.data.active_gyms | map(.name) | index("Agent A Gym")) != null
  and (.data.available_equipment | index("Rack 1")) != null
  and (tostring | test("user_a.local@example.test|billing|password"; "i") | not)
' >/dev/null || fail "training profile leaked account data or omitted training context"

agent_get "exercises?query=Agent%20A&limit=10"
assert_status "200" "user A exercise search"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg a "${EXERCISE_A}" \
  --arg a2 "${EXERCISE_A2}" \
  --arg b "${EXERCISE_B}" '
    (.data.exercises | map(.id) | index($a)) != null
    and (.data.exercises | map(.id) | index($a2)) != null
    and (.data.exercises | map(.id) | index($b)) == null
  ' >/dev/null || fail "exercise search crossed the ownership boundary"

echo "[agent-api-test] verifying owned context, calculations, units, and ISO timestamps"
agent_get "exercises/${EXERCISE_A}/context?recent_sessions=5"
assert_status "200" "owned exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg exercise "${EXERCISE_A}" '
    .data.exercise.id == $exercise
    and (.data.recent_performances[0].sets | length == 2)
    and .data.recent_performances[0].volume.unit == "kg_reps"
    and .data.personal_records.estimated_one_rep_max.unit == "kg"
    and (.data.last_performed_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
    and (.data.unavailable_fields | index("user_authored_training_notes")) != null
  ' >/dev/null || fail "exercise context schema/calculations are incomplete"

echo "[agent-api-test] verifying cross-owner IDs are indistinguishable from missing IDs"
agent_get "exercises/${EXERCISE_B}/context"
assert_status "404" "cross-owner exercise context"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "NOT_FOUND" ]] ||
  fail "cross-owner context did not return the stable not-found envelope"
agent_get "exercises/agent-api-${RUN_TAG}-missing/context"
assert_status "404" "missing exercise context"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "NOT_FOUND" ]] ||
  fail "missing context did not match cross-owner not-found behavior"

echo "[agent-api-test] verifying identity inputs and bounded pagination"
agent_get "exercises?user_id=${USER_B_UUID}"
assert_status "400" "caller-supplied user_id"
agent_get "exercises?owner_user_id=${USER_B_UUID}"
assert_status "400" "caller-supplied owner_user_id"
agent_get "exercises?limit=51"
assert_status "400" "exercise maximum limit"
agent_get "workouts/recent?limit=26"
assert_status "400" "workout maximum limit"
agent_get "exercises?query=Agent%20A&limit=1"
assert_status "200" "first exercise page"
FIRST_EXERCISE_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.exercises[0].id')"
NEXT_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.next_cursor')"
[[ -n "${NEXT_CURSOR}" && "${NEXT_CURSOR}" != "null" ]] ||
  fail "bounded exercise page did not return a cursor"
agent_get "exercises?query=Agent%20A&limit=1&cursor=${NEXT_CURSOR}"
assert_status "200" "second exercise page"
SECOND_EXERCISE_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.exercises[0].id')"
[[ "${FIRST_EXERCISE_ID}" != "${SECOND_EXERCISE_ID}" ]] ||
  fail "exercise cursor repeated the first page"

agent_get "workouts/recent?limit=1"
assert_status "200" "recent workouts"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg session "${SESSION_A}" '
    .data.workouts[0].id == $session
    and .data.workouts[0].total_volume.unit == "kg_reps"
    and (.data.workouts[0].completed_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
  ' >/dev/null || fail "recent workout response is not compact and explicit"

echo "[agent-api-test] verifying invalid and expired credentials"
agent_get "profile" "not-a-token"
assert_status "401" "invalid bearer token"
EXPIRED_TOKEN="$(make_expired_token "${AGENT_ACCESS_TOKEN}")" ||
  fail "could not construct a locally signed expired token"
agent_get "profile" "${EXPIRED_TOKEN}"
assert_status "401" "expired bearer token"

echo "[agent-api-test] verifying agent credentials cannot use app write surfaces"
WRITE_GYM="agent-api-${RUN_TAG}-write-probe"
app_public_request POST "gyms" "${AGENT_ACCESS_TOKEN}" \
  "$(jq -nc --arg id "${WRITE_GYM}" --argjson now "${NOW_MS}" \
    '{id:$id,name:"Agent write probe",created_at:$now,updated_at:$now,client_updated_at_ms:$now}')"
assert_non_2xx "agent PostgREST insert"
WRITE_COUNT="$(run_psql "
  select count(*) from app_public.gyms
  where owner_user_id = '${USER_A_UUID}'::uuid and id = '${WRITE_GYM}';
")"
[[ "${WRITE_COUNT}" == "0" ]] || fail "agent credential created a gym"

RPC_WRITE_GYM="agent-api-${RUN_TAG}-rpc-write-probe"
app_public_request POST "rpc/sync_push" "${AGENT_ACCESS_TOKEN}" \
  "$(jq -nc --arg id "${RPC_WRITE_GYM}" --argjson now "${NOW_MS}" \
    '{entities:[{
      type:"gyms",
      id:$id,
      client_updated_at_ms:$now,
      fields:{name:"RPC agent write probe",created_at:$now,updated_at:$now,deleted_at:null}
    }]}')"
assert_non_2xx "agent sync_push RPC"
RPC_WRITE_COUNT="$(run_psql "
  select count(*) from app_public.gyms
  where owner_user_id = '${USER_A_UUID}'::uuid and id = '${RPC_WRITE_GYM}';
")"
[[ "${RPC_WRITE_COUNT}" == "0" ]] || fail "agent credential wrote through sync_push"

request POST "${AGENT_API_BASE}/profile" "${AGENT_ACCESS_TOKEN}" "" '{}'
assert_status "405" "agent API write method"

app_public_request GET "exercise_definitions?select=id" "${AGENT_ACCESS_TOKEN}"
assert_status "200" "agent direct table read denial"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq 'length')" == "0" ]] ||
  fail "agent credential bypassed the dedicated API read boundary"

echo "[agent-api-test] verifying metadata-only audit records"
AUDIT_COUNT="$(run_psql "
  select count(*) from public.agent_access_audit
  where owner_user_id = '${USER_A_UUID}'::uuid
    and oauth_client_id = '${AGENT_CLIENT_ID}';
")"
[[ "${AUDIT_COUNT}" -ge 8 ]] || fail "agent API access was not audited"
AUDIT_SHAPE="$(run_psql "
  select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'agent_access_audit'
    and column_name in ('access_token','refresh_token','request_payload','response_payload','notes');
")"
[[ "${AUDIT_SHAPE}" == "0" ]] || fail "audit schema contains prohibited payload/token columns"

echo "[agent-api-test] revoking the grant and proving the credential stops working"
request DELETE \
  "${API_URL}/auth/v1/user/oauth/grants?client_id=${AGENT_CLIENT_ID}" \
  "${APP_ACCESS_TOKEN}" "${ANON_KEY}"
assert_status "204" "OAuth grant revocation"
agent_get "profile"
assert_status "401" "revoked agent access"

request POST "${API_URL}/auth/v1/token?grant_type=refresh_token" \
  "${ANON_KEY}" "${ANON_KEY}" \
  "$(jq -nc --arg refresh_token "${AGENT_REFRESH_TOKEN}" '{refresh_token:$refresh_token}')"
assert_non_2xx "revoked refresh token"

echo "[agent-api-test] PASS"
