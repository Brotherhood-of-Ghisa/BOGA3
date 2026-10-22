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
  local response_file headers_file
  response_file="$(mktemp)"
  headers_file="$(mktemp)"
  local -a request_args=(
    --silent
    --show-error
    -X "${method}"
    -H "Accept: application/json"
    -D "${headers_file}"
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
  RESPONSE_HEADERS="$(tr -d '\r' <"${headers_file}")"
  rm -f "${response_file}" "${headers_file}"
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
    request_args+=(-H "x-boga-sync-protocol: ${BOGA_TEST_SYNC_PROTOCOL:-4}" -H "Content-Type: application/json" --data "${body}")
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

agent_post() {
  local route="$1"
  local body="$2"
  local idempotency_key="${3:-}"
  local token="${4:-${AGENT_ACCESS_TOKEN}}"
  local response_file
  response_file="$(mktemp)"
  local -a request_args=(
    --silent
    --show-error
    -X POST
    -H "Accept: application/json"
    -H "Authorization: Bearer ${token}"
    -H "Content-Type: application/json"
    -o "${response_file}"
    -w "%{http_code}"
  )
  [[ -n "${idempotency_key}" ]] && request_args+=(-H "Idempotency-Key: ${idempotency_key}")
  request_args+=(--data "${body}")
  RESPONSE_STATUS="$(curl "${request_args[@]}" "${AGENT_API_BASE}/${route}")"
  RESPONSE_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

# PostgREST against the default `public` schema (permission/receipt tables).
public_request() {
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
    -H "Accept-Profile: public"
    -H "Content-Profile: public"
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

fetch_grant_granted_at() {
  request GET "${API_URL}/auth/v1/user/oauth/grants" "${APP_ACCESS_TOKEN}" "${ANON_KEY}"
  assert_status "200" "oauth grants for the plan permission"
  printf '%s' "${RESPONSE_BODY}" |
    jq -er --arg cid "${AGENT_CLIENT_ID}" \
      '(if type == "array" then . else .grants end)[]
       | select((.client_id // .client.id) == $cid) | .granted_at'
}

# A failed run must not leave this slot's stack without Auth.
start_auth_container() {
  [[ "${AUTH_STOPPED:-0}" == "1" ]] || return 0
  docker start "${AUTH_CONTAINER}" >/dev/null
  for _ in $(seq 1 60); do
    request GET "${API_URL}/auth/v1/health" "" "${ANON_KEY}"
    if [[ "${RESPONSE_STATUS}" == "200" ]]; then
      AUTH_STOPPED=0
      return 0
    fi
    sleep 1
  done
  echo "[agent-api-test] Auth did not become healthy after restarting ${AUTH_CONTAINER}" >&2
  return 1
}

cleanup() {
  start_auth_container || true
  [[ -n "${RUN_TAG:-}" && -n "${USER_A_UUID:-}" && -n "${USER_B_UUID:-}" ]] || return 0
  run_psql "
    begin;
      set constraints all deferred;
      delete from public.agent_access_audit
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and request_id like 'agent-api-${RUN_TAG}-%';
      delete from public.agent_plan_write_receipts
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from public.agent_plan_permissions
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from app_public.session_plan_sets
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from app_public.session_plan_exercises
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from app_public.session_plans
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from app_public.training_programmes
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid);
      delete from app_public.exercise_sets
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.session_exercises
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.exercise_muscle_mappings
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and (id like 'agent-api-${RUN_TAG}-%' or id like 'map_agent-api-${RUN_TAG}-%'
            or exercise_definition_id in (select id from app_public.exercise_definitions
              where owner_user_id = '${USER_A_UUID}'::uuid and name like 'agent-api-${RUN_TAG} %'));
      delete from app_public.exercise_definitions
        where owner_user_id = '${USER_A_UUID}'::uuid and name like 'agent-api-${RUN_TAG} %';
      delete from app_public.sessions
        where owner_user_id in ('${USER_A_UUID}'::uuid, '${USER_B_UUID}'::uuid)
          and id like 'agent-api-${RUN_TAG}-%';
      delete from app_public.body_weight_measurements
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

# Bash 3.2 hands the EXIT trap status 0 after an unbound-variable abort, so a
# run that never reached its last line fails here instead of passing.
COMPLETED=0
cleanup_with_status() {
  local status="$?"
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[agent-api-test] FAIL: the run stopped before completing" >&2
    status=1
  fi
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
MUSCLE_A2="agent-api-${RUN_TAG}-muscle-a2"
MUSCLE_B="agent-api-${RUN_TAG}-muscle-b"
MAPPING_A="agent-api-${RUN_TAG}-mapping-a"
SESSION_A="agent-api-${RUN_TAG}-session-a"
BLOCK_A="agent-api-${RUN_TAG}-block-a"
SET_A1="agent-api-${RUN_TAG}-set-a1"
SET_A2="agent-api-${RUN_TAG}-set-a2"
SET_A3="agent-api-${RUN_TAG}-set-a3-unperformed"
SET_A4="agent-api-${RUN_TAG}-set-a4-warm-up"
BLOCK_A2="agent-api-${RUN_TAG}-block-a2-warm-up-only"
SET_A2_W1="agent-api-${RUN_TAG}-set-a2-w1"
SET_A2_W2="agent-api-${RUN_TAG}-set-a2-w2"
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
       ${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${MUSCLE_A2}','Triceps','arms',1,0,
       ${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_B_UUID}'::uuid,'${MUSCLE_B}','User B Muscle','arms',0,0,
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
       'Agent A Bench','Rack 1',${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${BLOCK_A2}','${SESSION_A}','${EXERCISE_A2}',1,
       'Agent A Squat',null,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_sets
      (owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
       performance_status,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${SET_A1}','${BLOCK_A}',0,'100','8','rir_2',
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SET_A2}','${BLOCK_A}',1,'105','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SET_A3}','${BLOCK_A}',2,'200','10','rir_0',
       'unperformed',${NOW_MS},${NOW_MS},${NOW_MS}),
      -- A warm-up heavier than every working set: listed, never a stat.
      ('${USER_A_UUID}'::uuid,'${SET_A4}','${BLOCK_A}',3,'140','5','warm_up',
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      -- A warm-up-only exercise has no stat footprint for its session.
      ('${USER_A_UUID}'::uuid,'${SET_A2_W1}','${BLOCK_A2}',0,'60','10','warm_up',
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SET_A2_W2}','${BLOCK_A2}',1,'100','5','warm_up',
       null,${NOW_MS},${NOW_MS},${NOW_MS});
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
    and (.data.recent_performances[0].sets | map(.set_type)) == ["rir_2", null, "warm_up"]
    and (.data.recent_performances[0].sets | map(.performance_status) | all(. == null))
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

echo "[agent-api-test] verifying exact keyset-paginated exercise history"
agent_get "exercises/${EXERCISE_A}/history?limit=1"
assert_status "200" "first exercise history page"
HISTORY_FIRST_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.sets[0].id')"
HISTORY_NEXT_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.next_cursor')"
[[ -n "${HISTORY_NEXT_CURSOR}" && "${HISTORY_NEXT_CURSOR}" != "null" ]] ||
  fail "first exercise history page did not return a cursor"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg session "${SESSION_A}" \
  --arg set "${SET_A1}" '
    .data.sets[0].id == $set
    and .data.sets[0].session_id == $session
    and .data.sets[0].load.value == 100
    and .data.sets[0].reps == 8
    and .data.sets[0].set_type == "rir_2"
    and .data.sets[0].volume.unit == "kg_reps"
    and (.data.sets[0].session_completed_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
  ' >/dev/null || fail "first exercise history set payload is invalid"

agent_get "exercises/${EXERCISE_A}/history?limit=1&cursor=${HISTORY_NEXT_CURSOR}"
assert_status "200" "second exercise history page"
HISTORY_SECOND_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.sets[0].id')"
[[ "${HISTORY_FIRST_SET_ID}" != "${HISTORY_SECOND_SET_ID}" ]] ||
  fail "exercise history cursor repeated the first page"
[[ "${HISTORY_SECOND_SET_ID}" == "${SET_A2}" ]] ||
  fail "second exercise history page was not SET_A2"

# Cross-owner and missing exercise history
agent_get "exercises/${EXERCISE_B}/history"
assert_status "404" "cross-owner exercise history"
agent_get "exercises/agent-api-${RUN_TAG}-missing/history"
assert_status "404" "missing exercise history"

echo "[agent-api-test] verifying exact completed workout detail"
agent_get "workouts/${SESSION_A}?limit=1"
assert_status "200" "workout detail first page"
WORKOUT_FIRST_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.sets[0].id')"
WORKOUT_NEXT_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.next_cursor')"
[[ -n "${WORKOUT_NEXT_CURSOR}" && "${WORKOUT_NEXT_CURSOR}" != "null" ]] ||
  fail "workout detail first page did not return a cursor"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg session "${SESSION_A}" \
  --arg gym "Agent A Gym" \
  --arg set "${SET_A1}" '
    .data.workout.id == $session
    and .data.workout.gym.name == $gym
    and .data.workout.total_volume.unit == "kg_reps"
    and (.data.workout.completed_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
    and (.data.workout.exercises | length) == 2
    and .data.workout.sets[0].id == $set
  ' >/dev/null || fail "workout detail payload is invalid"

agent_get "workouts/${SESSION_A}?limit=1&cursor=${WORKOUT_NEXT_CURSOR}"
assert_status "200" "workout detail second page"
WORKOUT_SECOND_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.sets[0].id')"
[[ "${WORKOUT_FIRST_SET_ID}" != "${WORKOUT_SECOND_SET_ID}" ]] ||
  fail "workout detail cursor repeated the first page"
[[ "${WORKOUT_SECOND_SET_ID}" == "${SET_A2}" ]] ||
  fail "second workout detail page was not SET_A2"

# Missing workout detail
agent_get "workouts/agent-api-${RUN_TAG}-missing"
assert_status "404" "missing workout detail"

echo "[agent-api-test] verifying equal order_index set pagination preserves sets via set_id tie-breaker"
EXERCISE_EQ="agent-api-${RUN_TAG}-exercise-eq"
EQ_SESSION="agent-api-${RUN_TAG}-eq-session"
EQ_BLOCK="agent-api-${RUN_TAG}-eq-block"
EQ_SET_1="agent-api-${RUN_TAG}-eq-set-1"
EQ_SET_2="agent-api-${RUN_TAG}-eq-set-2"
run_psql "
  begin;
    set constraints all deferred;
    insert into app_public.exercise_definitions
      (owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EXERCISE_EQ}','Agent A Overhead','total_load',${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.sessions
      (owner_user_id,id,gym_id,status,started_at,completed_at,duration_sec,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EQ_SESSION}','${GYM_A}','completed',
       $((NOW_MS - 5000000)),$((NOW_MS - 4500000)),300,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.session_exercises
      (owner_user_id,id,session_id,exercise_definition_id,order_index,name,machine_name,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EQ_BLOCK}','${EQ_SESSION}','${EXERCISE_EQ}',0,
       'Agent A Overhead',null,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_sets
      (owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
       performance_status,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EQ_SET_1}','${EQ_BLOCK}',0,'110','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${EQ_SET_2}','${EQ_BLOCK}',0,'115','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS});
  commit;
" >/dev/null

agent_get "workouts/${EQ_SESSION}?limit=1"
assert_status "200" "equal order_index workout detail page 1"
EQ_PAGE1_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.sets[0].id')"
EQ_PAGE1_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.next_cursor')"
[[ "${EQ_PAGE1_SET_ID}" == "${EQ_SET_1}" ]] || fail "expected page 1 to return EQ_SET_1"
[[ -n "${EQ_PAGE1_CURSOR}" && "${EQ_PAGE1_CURSOR}" != "null" ]] || fail "expected page 1 to return a cursor"

agent_get "workouts/${EQ_SESSION}?limit=1&cursor=${EQ_PAGE1_CURSOR}"
assert_status "200" "equal order_index workout detail page 2"
EQ_PAGE2_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.workout.sets[0].id')"
[[ "${EQ_PAGE2_SET_ID}" == "${EQ_SET_2}" ]] || fail "equal order_index workout detail page 2 did not return EQ_SET_2"

agent_get "exercises/${EXERCISE_EQ}/history?limit=1"
assert_status "200" "history with EQ_SESSION page 1"
EQ_HIST_PAGE1_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.sets[0].id')"
EQ_HIST_PAGE1_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.next_cursor')"
[[ "${EQ_HIST_PAGE1_SET_ID}" == "${EQ_SET_1}" ]] || fail "expected history page 1 to return latest completed set EQ_SET_1"

agent_get "exercises/${EXERCISE_EQ}/history?limit=1&cursor=${EQ_HIST_PAGE1_CURSOR}"
assert_status "200" "history with EQ_SESSION page 2"
EQ_HIST_PAGE2_SET_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.sets[0].id')"
[[ "${EQ_HIST_PAGE2_SET_ID}" == "${EQ_SET_2}" ]] || fail "equal order_index history page 2 did not return EQ_SET_2 via tie-breaker"

echo "[agent-api-test] verifying warm-ups are listed but feed no derived figure"
agent_get "exercises/${EXERCISE_A}/context"
assert_status "200" "working-set exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.metric_revision == "working_sets_v7"
  and .data.recent_performances[0].volume.value == 1325
  and .data.recent_performances[0].volume.eligible_set_count == 2
  and .data.recent_performances[0].estimated_one_rep_max.value < 140
  and .data.recent_performances[0].sets[2].set_type == "warm_up"
  and .data.recent_performances[0].sets[2].volume.value == 700
  and .data.recent_performances[0].sets[2].estimated_one_rep_max.value > 140
  and .data.personal_records.top_weight.value == 105
  and .data.personal_records.estimated_one_rep_max.value < 140
  and .data.personal_records.max_session_volume.value == 1325
  and .data.volume_series[-1].value == 1325
' >/dev/null || fail "a heavier warm-up leaked into exercise-context figures"
agent_get "exercises/${EXERCISE_A2}/context"
assert_status "200" "warm-up-only exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.recent_performances == []
  and .data.volume_series == []
  and .data.last_performed_at == null
  and .data.personal_records.estimated_one_rep_max == null
  and .data.personal_records.top_weight == null
  and .data.personal_records.max_session_volume == null
  and .data.personal_records.excluded_incomplete_volume_sessions == 0
' >/dev/null || fail "a warm-up-only session left a stat footprint"
agent_get "workouts/recent?limit=1"
assert_status "200" "working-set recent workouts"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.metric_revision == "working_sets_v7"
  and .data.workouts[0].exercise_count == 1
  and (.data.workouts[0].exercises | length) == 2
  and .data.workouts[0].completed_set_count == 2
  and .data.workouts[0].total_volume.value == 1325
  and .data.workouts[0].total_volume.eligible_set_count == 2
  and .data.workouts[0].exercises[0].set_count == 2
  and .data.workouts[0].exercises[0].volume.value == 1325
  and .data.workouts[0].exercises[1].set_count == 0
  and .data.workouts[0].exercises[1].volume.value == 0
' >/dev/null || fail "warm-ups leaked into workout counts or volume"

echo "[agent-api-test] verifying a split exercise reports the whole exercise unless a gym is named"
GYM_SPLIT="agent-api-${RUN_TAG}-gym-split"
GYM_SPLIT_WARMUP="agent-api-${RUN_TAG}-gym-warmup"
EXERCISE_SPLIT="agent-api-${RUN_TAG}-exercise-split"
SPLIT_WARMUP_SESSION="agent-api-${RUN_TAG}-split-warmup-session"
SPLIT_HOME_SESSION="agent-api-${RUN_TAG}-split-home-session"
SPLIT_NONE_SESSION="agent-api-${RUN_TAG}-split-none-session"
SPLIT_AWAY_SESSION="agent-api-${RUN_TAG}-split-away-session"
run_psql "
  begin;
    set constraints all deferred;
    insert into app_public.gyms
      (owner_user_id,id,name,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${GYM_SPLIT}','Agent A Away Gym',${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${GYM_SPLIT_WARMUP}','Agent A Warm-Up Gym',${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_definitions
      (owner_user_id,id,name,load_input_mode,split_by_gym,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${EXERCISE_SPLIT}','Agent A Split Row','total_load',true,
       ${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.sessions
      (owner_user_id,id,gym_id,status,started_at,completed_at,duration_sec,
       created_at,updated_at,client_updated_at_ms)
    values
      -- The heaviest history is the oldest gym, so a reader that pooled its
      -- gyms' records would report 200 kg for every gym.
      ('${USER_A_UUID}'::uuid,'${SPLIT_HOME_SESSION}','${GYM_A}','completed',
       $((NOW_MS - 9100000)),$((NOW_MS - 9000000)),600,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_NONE_SESSION}',null,'completed',
       $((NOW_MS - 6100000)),$((NOW_MS - 6000000)),600,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_AWAY_SESSION}','${GYM_SPLIT}','completed',
       $((NOW_MS - 5100000)),$((NOW_MS - 5000000)),600,${NOW_MS},${NOW_MS},${NOW_MS}),
      -- This exercise's newest session, and warm-ups only: no stat footprint,
      -- so its gym is not listed as a bucket.
      ('${USER_A_UUID}'::uuid,'${SPLIT_WARMUP_SESSION}','${GYM_SPLIT_WARMUP}','completed',
       $((NOW_MS - 4100000)),$((NOW_MS - 4000000)),600,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.session_exercises
      (owner_user_id,id,session_id,exercise_definition_id,order_index,name,machine_name,
       created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${SPLIT_HOME_SESSION}-block','${SPLIT_HOME_SESSION}','${EXERCISE_SPLIT}',0,
       'Agent A Split Row',null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_NONE_SESSION}-block','${SPLIT_NONE_SESSION}','${EXERCISE_SPLIT}',0,
       'Agent A Split Row',null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_AWAY_SESSION}-block','${SPLIT_AWAY_SESSION}','${EXERCISE_SPLIT}',0,
       'Agent A Split Row',null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_WARMUP_SESSION}-block','${SPLIT_WARMUP_SESSION}','${EXERCISE_SPLIT}',0,
       'Agent A Split Row',null,${NOW_MS},${NOW_MS},${NOW_MS});
    insert into app_public.exercise_sets
      (owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
       performance_status,created_at,updated_at,client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid,'${SPLIT_HOME_SESSION}-set','${SPLIT_HOME_SESSION}-block',0,'200','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_NONE_SESSION}-set','${SPLIT_NONE_SESSION}-block',0,'150','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_AWAY_SESSION}-set','${SPLIT_AWAY_SESSION}-block',0,'100','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_AWAY_SESSION}-set-2','${SPLIT_AWAY_SESSION}-block',1,'95','5',null,
       null,${NOW_MS},${NOW_MS},${NOW_MS}),
      ('${USER_A_UUID}'::uuid,'${SPLIT_WARMUP_SESSION}-set','${SPLIT_WARMUP_SESSION}-block',0,'250','3','warm_up',
       null,${NOW_MS},${NOW_MS},${NOW_MS});
  commit;
" >/dev/null

agent_get "exercises/${EXERCISE_SPLIT}/context"
assert_status "200" "split exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" --arg home "${GYM_A}" \
  --arg warmup "${GYM_SPLIT_WARMUP}" '
  .data.exercise.split_by_gym == true
  # Unset gym_bucket is the whole exercise, so no single gym owns the response.
  and (.data.exercise | has("gym") | not)
  and (.data.exercise.gym_buckets | length) == 2
  # No-gym sessions are never a bucket: they count only in the whole exercise.
  and (.data.exercise.gym_buckets | map(.gym.id)) == [$away, $home]
  and (.data.exercise.gym_buckets[0].gym.name == "Agent A Away Gym")
  # Every gym reports its own records beside the whole exercise.
  and (.data.exercise.gym_buckets | map(.personal_records.top_weight.value)) == [100, 200]
  and (.data.exercise.gym_buckets | map(.session_count)) == [1, 1]
  # The newest session is warm-ups only, so its gym is not listed and its
  # 250 kg never becomes a record.
  and (.data.exercise.gym_buckets | map(.gym.id) | index($warmup)) == null
  and (.data.exercise | has("gym_buckets_truncated") | not)
  # The whole exercise holds every gym and the no-gym session, each labelled.
  and (.data.recent_performances | map(.session_id)) == [
    "'"${SPLIT_AWAY_SESSION}"'", "'"${SPLIT_NONE_SESSION}"'", "'"${SPLIT_HOME_SESSION}"'"]
  and (.data.recent_performances | map(.gym.id // null)) == [$away, null, $home]
  and (.data.recent_performances | map(has("gym")) | all)
  and .data.personal_records.top_weight.value == 200
  # The volume series runs oldest first and names the gym of each point too.
  and (.data.volume_series | map(.gym.id // null)) == [$home, null, $away]
  and (.data.volume_series | map(has("gym")) | all)
' >/dev/null || fail "split exercise context did not report the whole exercise beside each gym"

agent_get "exercises/${EXERCISE_SPLIT}/context?gym_bucket=${GYM_A}"
assert_status "200" "split exercise context for a named gym"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg home "${GYM_A}" '
  .data.exercise.gym.id == $home
  and (.data.exercise.gym_buckets | length) == 2
  and (.data.recent_performances | map(.gym.id)) == [$home]
  and .data.personal_records.top_weight.value == 200
' >/dev/null || fail "gym_bucket did not select the named gym"

agent_get "exercises/${EXERCISE_SPLIT}/context?gym_bucket=${GYM_SPLIT}"
assert_status "200" "split exercise context for the newest gym"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" '
  .data.exercise.gym.id == $away
  and (.data.recent_performances | length) == 1
  and .data.personal_records.top_weight.value == 100
' >/dev/null || fail "gym_bucket pooled another gym into the named one"

# The sessions with no gym are no longer a bucket, so the old selector fails
# loud instead of returning figures a caller would misread.
agent_get "exercises/${EXERCISE_SPLIT}/context?gym_bucket=none"
assert_status "400" "gym_bucket=none on split exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .error.code == "INVALID_ARGUMENT" and (.error.message | test("whole exercise"))
' >/dev/null || fail "gym_bucket=none did not explain that no-gym sessions count in the whole exercise"

agent_get "exercises/${EXERCISE_SPLIT}/history"
assert_status "200" "split exercise history"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" --arg home "${GYM_A}" \
  --arg warmup "${GYM_SPLIT_WARMUP}" '
  # Paging does not partition by gym: one page, every gym, each set labelled.
  (.data.exercise | has("gym") | not)
  and (.data.exercise | has("gym_buckets") | not)
  and (.data.exercise | has("gym_buckets_truncated") | not)
  and (.data.sets | length) == 5
  # Raw history keeps every performed set, warm-up included, newest first.
  and (.data.sets | map(.gym.id // null)) == [$warmup, $away, $away, null, $home]
  and .data.next_cursor == null
' >/dev/null || fail "split exercise history partitioned its page by gym"

agent_get "exercises/${EXERCISE_SPLIT}/history?gym_bucket=none"
assert_status "400" "gym_bucket=none on split exercise history"

# An unfiltered drain walks every gym in one chronological stream; a filtered
# one keeps its filter even when the caller stops repeating gym_bucket.
agent_get "exercises/${EXERCISE_SPLIT}/history?limit=2"
assert_status "200" "unfiltered history page 1"
ALL_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.next_cursor')"
[[ -n "${ALL_CURSOR}" && "${ALL_CURSOR}" != "null" ]] || fail "a five-set history returned no cursor"
agent_get "exercises/${EXERCISE_SPLIT}/history?limit=3&cursor=${ALL_CURSOR}"
assert_status "200" "unfiltered history page 2"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" --arg home "${GYM_A}" '
  (.data.sets | map(.gym.id // null)) == [$away, null, $home]
  and .data.next_cursor == null
' >/dev/null || fail "an unfiltered cursor did not keep walking every gym"

agent_get "exercises/${EXERCISE_SPLIT}/history?gym_bucket=${GYM_SPLIT}&limit=1"
assert_status "200" "filtered history page 1"
AWAY_CURSOR="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.next_cursor')"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" '
  .data.exercise.gym.id == $away and (.data.sets | length) == 1
' >/dev/null || fail "gym_bucket did not filter the first page"
[[ -n "${AWAY_CURSOR}" && "${AWAY_CURSOR}" != "null" ]] || fail "the filtered two-set bucket returned no cursor"
agent_get "exercises/${EXERCISE_SPLIT}/history?limit=1&cursor=${AWAY_CURSOR}"
assert_status "200" "filtered history page 2 without gym_bucket"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg away "${GYM_SPLIT}" '
  .data.exercise.gym.id == $away
  and (.data.sets | map(.gym.id)) == [$away]
  and .data.sets[0].session_id == "'"${SPLIT_AWAY_SESSION}"'"
' >/dev/null || fail "following a filtered cursor left its gym"
agent_get "exercises/${EXERCISE_SPLIT}/history?limit=1&cursor=${AWAY_CURSOR}&gym_bucket=${GYM_A}"
assert_status "400" "cursor and gym_bucket naming different buckets"
printf '%s' "${RESPONSE_BODY}" | jq -e '.error.message | test("does not match the cursor")' >/dev/null ||
  fail "a cursor for one gym and gym_bucket for another did not conflict"
# A cursor pinned to the old no-gym bucket (gym_bucket: null) names a bucket
# that no longer exists; it is rejected, never widened to every gym.
NO_GYM_CURSOR="$(printf '%s' "${AWAY_CURSOR}" | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' |
  jq -Rr '@base64d | fromjson | .gym_bucket = null | tojson | @base64' | tr '+/' '-_' | tr -d '=')"
agent_get "exercises/${EXERCISE_SPLIT}/history?limit=1&cursor=${NO_GYM_CURSOR}"
assert_status "400" "a cursor pinned to the no-gym bucket"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .error.code == "INVALID_CURSOR" and (.error.message | test("sessions with no gym"))
' >/dev/null || fail "a cursor pinned to the no-gym bucket was not rejected for its bucket"

agent_get "exercises/${EXERCISE_SPLIT}/context?gym_bucket=agent-api-${RUN_TAG}-gym-absent"
assert_status "404" "gym_bucket naming a gym the user does not own"
agent_get "exercises/${EXERCISE_SPLIT}/context?gym_bucket="
assert_status "400" "empty gym_bucket"

agent_get "exercises/${EXERCISE_A}/context"
assert_status "200" "unsplit exercise context"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.exercise.split_by_gym == false
  and (.data.exercise | has("gym") | not)
  and (.data.exercise | has("gym_buckets") | not)
  and (.data.recent_performances[0] | has("gym") | not)
  and (.data.volume_series[0] | has("gym") | not)
  and (.data.recent_performances[0].sets[0] | has("gym") | not)
' >/dev/null || fail "an unsplit exercise carries gym-bucket fields"

agent_get "exercises/${EXERCISE_A}/context?gym_bucket=none"
assert_status "400" "gym_bucket on an unsplit exercise"
agent_get "exercises/${EXERCISE_A}/history?gym_bucket=none"
assert_status "400" "gym_bucket on an unsplit exercise history"

# Exercise and workout projections share the mobile load-calculation kernel.
# Updates use the owner's database identity, as ordinary sync writes do, while
# ownership triggers remain active throughout every parity vector.
update_training_fixture() {
  run_psql "begin;
    select set_config('request.jwt.claims', json_build_object('sub', '${USER_A_UUID}', 'role', 'authenticated')::text, true);
    $1
    commit;"
}

assert_training_payload() {
  local expression="$1"
  local context="$2"
  assert_status "200" "${context}"
  printf '%s' "${RESPONSE_BODY}" | jq -e "${expression}" >/dev/null || fail "${context}"
}

echo "[agent-api-test] verifying conventional response compatibility"
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '
  .data.metric_revision == "working_sets_v7"
  and (.data.exercise | has("bodyweight_contribution") | not)
  and (.data.recent_performances[0] | has("session_body_weight") | not)
  and .data.recent_performances[0].volume.value == 1325
  and .data.recent_performances[0].volume.complete == true
  and .data.personal_records.top_weight.value == 105
  and .data.recent_performances[0].sets[0].load.unit == "kg"
  and .data.recent_performances[0].sets[0].calculated_load.unit == "kg"
' 'conventional fields retain numeric values and kg units'

echo "[agent-api-test] verifying the private preference, contribution and dated reading"
update_training_fixture "
  insert into app_public.user_settings
    (owner_user_id,id,bodyweight_calculations_enabled,created_at,updated_at,client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid,'settings',true,${NOW_MS},${NOW_MS},${NOW_MS})
    on conflict(owner_user_id,id) do update set bodyweight_calculations_enabled=true,
      updated_at=excluded.updated_at,client_updated_at_ms=excluded.client_updated_at_ms;
  update app_public.exercise_definitions set bodyweight_contribution=1
    where owner_user_id='${USER_A_UUID}'::uuid and id='${EXERCISE_A}';
  insert into app_public.body_weight_measurements
    (owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid,'agent-api-${RUN_TAG}-asof',80,
      ${STARTED_MS},${NOW_MS},${NOW_MS},${NOW_MS});
  update app_public.exercise_sets set weight_value='20',reps_value='8'
    where owner_user_id='${USER_A_UUID}'::uuid and id='${SET_A1}';
  update app_public.exercise_sets set weight_value='',reps_value='8'
    where owner_user_id='${USER_A_UUID}'::uuid and id='${SET_A2}';
" >/dev/null
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '
  .data.exercise.bodyweight_contribution == 1
  and .data.exercise.load_input_mode == "total_load"
  and .data.recent_performances[0].session_body_weight.value == 80
  and .data.recent_performances[0].session_body_weight.status == "known"
  and .data.recent_performances[0].volume.value == 1440
  and .data.recent_performances[0].sets[0].load.value == 20
  and .data.recent_performances[0].sets[0].calculated_load.value == 100
  and .data.recent_performances[0].sets[1].load.value == 0
  and .data.recent_performances[0].sets[1].calculated_load.value == 80
  and .data.personal_records.estimated_one_rep_max.value > 47.6
  and .data.personal_records.estimated_one_rep_max.value < 47.8
  and .data.personal_records.top_weight.value == 20
' 'bodyweight-aware values match app fixtures including canonical blank zero'
agent_get "workouts/recent?limit=1"
assert_training_payload '.data.workouts[0].total_volume.value == 1440
  and .data.workouts[0].total_volume.complete == true
  and .data.workouts[0].completed_set_count == 2
  and .data.workouts[0].session_body_weight.status == "known"
  and .data.workouts[0].exercises[0].bodyweight_contribution == 1
' 'workout and exercise totals agree'

# The per-side adjustment (body contribution counted once, then 2 × the entered
# load), the personal zero fallback for a session with no reading and the
# known/missing/invalid reading payload are the shared TS projection's, in
# apps/mobile/__tests__/agent-api-training-metrics.test.ts.
echo "[agent-api-test] verifying dated readings, correction and future exclusion"
update_training_fixture "
  update app_public.exercise_sets set performance_status='unperformed'
    where owner_user_id='${USER_A_UUID}'::uuid and id='${SET_A2}';
  insert into app_public.body_weight_measurements
    (owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid,'agent-api-${RUN_TAG}-reading',90,
      ${NOW_MS},${NOW_MS},${NOW_MS},${NOW_MS});
" >/dev/null
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '.data.recent_performances[0].session_body_weight.value == 80
  and .data.recent_performances[0].session_body_weight.status == "known"
  and (.data.recent_performances[0].session_body_weight.measured_at | endswith("Z"))
  and .data.recent_performances[0].volume.value == 800
  and (tostring | contains("measurement_id") | not)
' 'dated B is identifiable and a later reading does not replace it'
update_training_fixture "
  update app_public.body_weight_measurements set weight_kg=95,deleted_at=${NOW_MS}
    where owner_user_id='${USER_A_UUID}'::uuid and id='agent-api-${RUN_TAG}-reading';
" >/dev/null
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '.data.recent_performances[0].volume.value == 800
  and .data.recent_performances[0].session_body_weight.value == 80
' 'editing or deleting a later reading leaves earlier history unchanged'
update_training_fixture "
  update app_public.body_weight_measurements set weight_kg=82
    where owner_user_id='${USER_A_UUID}'::uuid and id='agent-api-${RUN_TAG}-asof';
" >/dev/null
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '.data.recent_performances[0].volume.value == 816
  and .data.recent_performances[0].session_body_weight.value == 82
' 'editing an applicable reading refreshes metrics'

echo "[agent-api-test] verifying preference off returns the ordinary contract"
update_training_fixture "
  update app_public.user_settings set bodyweight_calculations_enabled=false,
    updated_at=${NOW_MS}+1,client_updated_at_ms=${NOW_MS}+1
    where owner_user_id='${USER_A_UUID}'::uuid and id='settings';
" >/dev/null
agent_get "exercises/${EXERCISE_A}/context"
assert_training_payload '(.data.exercise | has("bodyweight_contribution") | not)
  and (.data.recent_performances[0] | has("session_body_weight") | not)
  and .data.recent_performances[0].volume.value == 160
  and .data.recent_performances[0].sets[0].load.value == 20
  and .data.recent_performances[0].sets[0].calculated_load.value == 20
' 'disabled preference returns ordinary Weight math without reading context'
echo "[agent-api-test] PASS: bodyweight projection parity and completeness"


echo "[agent-api-test] verifying the plan permission is default-denied"
PLAN_KEY="agent-api-${RUN_TAG}-plan-key"
PROG_KEY="agent-api-${RUN_TAG}-prog-key"
PLAN_BODY="$(jq -nc --arg gym "${GYM_A}" --arg ex "${EXERCISE_A}" --argjson now "${NOW_MS}" '
  {title:"Agent upcoming plan",gym_id:$gym,scheduled_for:($now + 86400000),
   exercises:[{exercise_definition_id:$ex,name:"Bench press",
     sets:[{target_reps:5,target_weight_value:"100",target_set_type:"rir_2"},
           {target_reps:8,target_weight_value:null}]}]}')"
UNSCHEDULED_BODY="$(jq -nc --arg ex "${EXERCISE_A}" '
  {title:"Agent unscheduled plan",
   exercises:[{exercise_definition_id:$ex,name:"Bench press",sets:[{target_reps:10}]}]}')"
PROG_BODY="$(jq -nc --arg ex "${EXERCISE_A}" '
  {name:"Agent programme",description:"Two-week wave",
   plans:[
     {title:"Week 1",exercises:[{exercise_definition_id:$ex,name:"Bench press",sets:[{target_reps:5}]}]},
     {title:"Week 2",exercises:[{exercise_definition_id:$ex,name:"Bench press",sets:[{target_reps:6}]}]}]}')"

agent_get "session-plans"
assert_status "403" "default-denied plan read"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "PLAN_PERMISSION_REQUIRED" ]] ||
  fail "default-denied plan read did not return PLAN_PERMISSION_REQUIRED"
agent_post "session-plans" "${PLAN_BODY}" "${PLAN_KEY}"
assert_status "403" "default-denied plan create"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "PLAN_PERMISSION_REQUIRED" ]] ||
  fail "default-denied plan create did not return PLAN_PERMISSION_REQUIRED"
agent_post "programmes" "${PROG_BODY}" "${PROG_KEY}"
assert_status "403" "default-denied programme create"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "PLAN_PERMISSION_REQUIRED" ]] ||
  fail "default-denied programme create did not return PLAN_PERMISSION_REQUIRED"
agent_post "exercises" "$(jq -nc --arg m "${MUSCLE_A}" --arg name "agent-api-${RUN_TAG} Denied" \
  '{name:$name,muscles:[{muscle_id:$m,role:"primary"}]}')" "agent-api-${RUN_TAG}-ex-denied"
assert_status "403" "default-denied exercise create"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "PLAN_PERMISSION_REQUIRED" ]] ||
  fail "default-denied exercise create did not return PLAN_PERMISSION_REQUIRED"
agent_post "exercises/${EXERCISE_A}" "$(jq -nc --argjson rev "${NOW_MS}" '{expected_revision:$rev,split_by_gym:true}')" \
  "agent-api-${RUN_TAG}-ex-denied-update"
assert_status "403" "default-denied exercise update"
[[ "$(run_psql "select split_by_gym from app_public.exercise_definitions
  where owner_user_id = '${USER_A_UUID}'::uuid and id = '${EXERCISE_A}';")" == "f" ]] ||
  fail "a denied exercise update changed the exercise"

echo "[agent-api-test] verifying the permission table is app-only and owner-scoped"
GRANTED_AT="$(fetch_grant_granted_at)"
PERMISSION_ROW="$(jq -nc --arg owner "${USER_A_UUID}" --arg cid "${AGENT_CLIENT_ID}" --arg at "${GRANTED_AT}" '
  {owner_user_id:$owner,client_id:$cid,plan_access_enabled:true,granted_at:$at}')"
public_request POST "agent_plan_permissions" "${APP_ACCESS_TOKEN}" "${PERMISSION_ROW}"
[[ "${RESPONSE_STATUS}" =~ ^2 ]] || fail "app owner could not insert a permission row (${RESPONSE_STATUS})"
public_request GET "agent_plan_permissions?select=client_id,plan_access_enabled" "${APP_ACCESS_TOKEN}"
assert_status "200" "app owner permission read"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq 'length')" == "1" ]] ||
  fail "app owner did not see exactly its own permission row"
public_request GET "agent_plan_permissions?select=client_id" "${AGENT_ACCESS_TOKEN}"
assert_status "200" "oauth permission read"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq 'length')" == "0" ]] ||
  fail "an OAuth agent token read the permission table"
public_request POST "agent_plan_permissions" "${AGENT_ACCESS_TOKEN}" "${PERMISSION_ROW}"
assert_non_2xx "oauth permission insert"
CROSS_ROW="$(jq -nc --arg owner "${USER_B_UUID}" --arg cid "${AGENT_CLIENT_ID}" --arg at "${GRANTED_AT}" '
  {owner_user_id:$owner,client_id:$cid,plan_access_enabled:true,granted_at:$at}')"
public_request POST "agent_plan_permissions" "${APP_ACCESS_TOKEN}" "${CROSS_ROW}"
assert_non_2xx "cross-owner permission insert"
request POST "${API_URL}/rest/v1/agent_plan_permissions" "${ANON_KEY}" "${ANON_KEY}" "${PERMISSION_ROW}"
assert_non_2xx "anon permission insert"

echo "[agent-api-test] verifying authorized reads and atomic plan/programme writes"
SESSIONS_BEFORE="$(run_psql "
  select count(*) from app_public.sessions where owner_user_id = '${USER_A_UUID}'::uuid;
")"
PERFORMED_BEFORE="$(run_psql "
  select count(*) from app_public.session_exercises
  where owner_user_id = '${USER_A_UUID}'::uuid and id not like 'agent-api-%';
")"
agent_get "session-plans?include_unscheduled=true"
assert_status "200" "authorized plan read"
agent_post "session-plans" "${PLAN_BODY}" "${PLAN_KEY}"
assert_status "200" "create session plan"
PLAN_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.plan_id')"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.idempotent_replay')" == "false" ]] ||
  fail "first plan create was marked as a replay"
agent_post "session-plans" "${UNSCHEDULED_BODY}" "agent-api-${RUN_TAG}-plan-key-2"
assert_status "200" "create unscheduled session plan"
UNSCHEDULED_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.plan_id')"
agent_post "programmes" "${PROG_BODY}" "${PROG_KEY}"
assert_status "200" "create training programme"
PROGRAMME_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.programme_id')"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.plan_ids | length')" == "2" ]] ||
  fail "programme create did not emit two child plans"

agent_get "session-plans"
assert_status "200" "upcoming plan read"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg plan "${PLAN_ID}" --arg unscheduled "${UNSCHEDULED_ID}" '
    (.data.plans | map(.id) | index($plan)) != null
    and (.data.plans | map(.id) | index($unscheduled)) == null
    and (.data.plans[] | select(.id == $plan) | .provenance) == "agent"
    and (.data.plans[] | select(.id == $plan) | .progress) == "planned"
    and (.data.plans[] | select(.id == $plan) | .next_block_id) != null
    and (.data.plans[] | select(.id == $plan) | .exercises[0].sets | length) == 2
  ' >/dev/null || fail "upcoming plan read is missing provenance, progress or snapshots"
agent_get "session-plans?include_unscheduled=true"
assert_status "200" "unscheduled plan read"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg unscheduled "${UNSCHEDULED_ID}" '(.data.plans | map(.id) | index($unscheduled)) != null' \
  >/dev/null || fail "include_unscheduled did not return the unscheduled plan"

echo "[agent-api-test] verifying live session card attached to block derives in_progress and excludes next_block_id"
BLOCK_ID="$(run_psql "
  select id from app_public.session_plan_exercises
  where owner_user_id = '${USER_A_UUID}'::uuid and session_plan_id = '${PLAN_ID}'
  limit 1;
")"
ATTACH_SESSION_ID="agent-api-${RUN_TAG}-attach-sess"
ATTACH_CARD_ID="agent-api-${RUN_TAG}-attach-card"
run_psql "
  insert into app_public.sessions (id, owner_user_id, status, started_at, created_at, updated_at, client_updated_at_ms)
  values ('${ATTACH_SESSION_ID}', '${USER_A_UUID}'::uuid, 'active', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.session_exercises (id, owner_user_id, session_id, exercise_definition_id, order_index, name, source_plan_exercise_id, created_at, updated_at, client_updated_at_ms)
  values ('${ATTACH_CARD_ID}', '${USER_A_UUID}'::uuid, '${ATTACH_SESSION_ID}', '${EXERCISE_A}', 0, 'Bench press', '${BLOCK_ID}', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
" >/dev/null
agent_get "session-plans"
assert_status "200" "plan read with attached block"
printf '%s' "${RESPONSE_BODY}" | jq -e \
  --arg plan "${PLAN_ID}" '
    (.data.plans[] | select(.id == $plan) | .progress) == "in_progress"
    and (.data.plans[] | select(.id == $plan) | .next_block_id) == null
  ' >/dev/null || fail "attached live session did not derive in_progress or clear next_block_id"
run_psql "
  delete from app_public.session_exercises where id = '${ATTACH_CARD_ID}';
  delete from app_public.sessions where id = '${ATTACH_SESSION_ID}';
" >/dev/null

echo "[agent-api-test] verifying the write graph is pending-only and performed-free"
PLAN_STATE="$(run_psql "
  select p.provenance || '|' ||
    (select count(*) from app_public.session_plan_exercises e
      where e.owner_user_id = p.owner_user_id and e.session_plan_id = p.id and e.progress_status = 'pending') || '|' ||
    (select count(*) from app_public.session_plan_exercises e
      where e.owner_user_id = p.owner_user_id and e.session_plan_id = p.id)
  from app_public.session_plans p
  where p.owner_user_id = '${USER_A_UUID}'::uuid and p.id = '${PLAN_ID}';
")"
[[ "${PLAN_STATE}" == "agent|1|1" ]] || fail "created plan is not a single pending agent block (${PLAN_STATE})"
PROG_STATE="$(run_psql "
  select
    (select count(*) from app_public.session_plans
      where owner_user_id = '${USER_A_UUID}'::uuid and programme_id = '${PROGRAMME_ID}') || '|' ||
    (select count(*) from app_public.session_plan_exercises
      where owner_user_id = '${USER_A_UUID}'::uuid
        and session_plan_id in (select id from app_public.session_plans
          where owner_user_id = '${USER_A_UUID}'::uuid and programme_id = '${PROGRAMME_ID}'));
")"
[[ "${PROG_STATE}" == "2|2" ]] || fail "programme graph is incomplete (${PROG_STATE})"
PERFORMED_EXERCISES="$(run_psql "
  select count(*) from app_public.session_exercises
  where owner_user_id = '${USER_A_UUID}'::uuid and id not like 'agent-api-%';
")"
[[ "${PERFORMED_EXERCISES}" == "${PERFORMED_BEFORE}" ]] || fail "agent plan writes created performed exercise rows"
PERFORMED_SESSIONS="$(run_psql "
  select count(*) from app_public.sessions where owner_user_id = '${USER_A_UUID}'::uuid;
")"
[[ "${PERFORMED_SESSIONS}" == "${SESSIONS_BEFORE}" ]] || fail "agent plan writes changed the performed session count"

echo "[agent-api-test] verifying idempotency replay, conflict and rejection"
agent_post "session-plans" "${PLAN_BODY}" "${PLAN_KEY}"
assert_status "200" "idempotent replay"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.plan_id')" == "${PLAN_ID}" ]] ||
  fail "idempotent replay returned a different plan id"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.idempotent_replay')" == "true" ]] ||
  fail "idempotent replay was not flagged"
CONFLICT_BODY="$(jq -nc --arg gym "${GYM_A}" --arg ex "${EXERCISE_A}" --argjson now "${NOW_MS}" '
  {title:"Agent conflicting plan",gym_id:$gym,scheduled_for:($now + 172800000),
   exercises:[{exercise_definition_id:$ex,name:"Bench press",sets:[{target_reps:3}]}]}')"
agent_post "session-plans" "${CONFLICT_BODY}" "${PLAN_KEY}"
assert_status "409" "idempotency conflict"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "IDEMPOTENCY_CONFLICT" ]] ||
  fail "idempotency conflict did not return IDEMPOTENCY_CONFLICT"
agent_post "session-plans" "${PLAN_BODY}" ""
assert_status "400" "missing idempotency key"
FOREIGN_BODY="$(jq -nc '{title:"Foreign ref",exercises:[{exercise_definition_id:"agent-api-missing",name:"X",sets:[{target_reps:5}]}]}')"
agent_post "session-plans" "${FOREIGN_BODY}" "agent-api-${RUN_TAG}-foreign"
assert_status "400" "foreign exercise reference"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "FOREIGN_RESOURCE_REFERENCE" ]] ||
  fail "foreign exercise did not return FOREIGN_RESOURCE_REFERENCE"
CROSS_BODY="$(jq -nc --arg ex "${EXERCISE_B}" '{title:"Cross ref",exercises:[{exercise_definition_id:$ex,name:"X",sets:[{target_reps:5}]}]}')"
agent_post "session-plans" "${CROSS_BODY}" "agent-api-${RUN_TAG}-cross"
assert_status "400" "cross-owner exercise reference"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "FOREIGN_RESOURCE_REFERENCE" ]] ||
  fail "cross-owner exercise did not match the foreign-reference error"
IDENTITY_BODY="$(jq -nc --arg owner "${USER_B_UUID}" '
  {title:"Identity",owner_user_id:$owner,exercises:[{name:"X",sets:[{target_reps:5}]}]}')"
agent_post "session-plans" "${IDENTITY_BODY}" "agent-api-${RUN_TAG}-identity"
assert_status "400" "identity-shaped request field"
OVERSIZED_BODY="$(jq -nc --arg ex "${EXERCISE_A}" '
  {title:"Too many",exercises:[range(31) | {exercise_definition_id:$ex,name:"X",sets:[{target_reps:5}]}]}')"
agent_post "session-plans" "${OVERSIZED_BODY}" "agent-api-${RUN_TAG}-oversized"
assert_status "400" "oversized plan graph"
INVALID_SET_TYPE_BODY="$(jq -nc --arg ex "${EXERCISE_A}" '
  {title:"Bad set type",exercises:[{exercise_definition_id:$ex,name:"X",sets:[{target_reps:5,target_set_type:"invalid_type"}]}]}')"
agent_post "session-plans" "${INVALID_SET_TYPE_BODY}" "agent-api-${RUN_TAG}-bad-set-type"
assert_status "400" "invalid target set type"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "invalid target set type did not return INVALID_ARGUMENT"
PARTIAL_ROWS="$(run_psql "
  select
    (select count(*) from app_public.session_plans
      where owner_user_id = '${USER_A_UUID}'::uuid and title in ('Foreign ref','Cross ref','Identity','Too many'))
    + (select count(*) from public.agent_plan_write_receipts
      where owner_user_id = '${USER_A_UUID}'::uuid
        and idempotency_key in ('agent-api-${RUN_TAG}-foreign','agent-api-${RUN_TAG}-cross',
          'agent-api-${RUN_TAG}-identity','agent-api-${RUN_TAG}-oversized'));
")"
[[ "${PARTIAL_ROWS}" == "0" ]] || fail "a rejected write left a partial plan row or receipt"

echo "[agent-api-test] verifying stale grants, disable and re-enable"
run_psql "update public.agent_plan_permissions
  set granted_at = granted_at - interval '1 hour'
  where owner_user_id = '${USER_A_UUID}'::uuid and client_id = '${AGENT_CLIENT_ID}';" >/dev/null
agent_get "session-plans"
assert_status "403" "stale grant timestamp"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "PLAN_PERMISSION_REQUIRED" ]] ||
  fail "stale grant did not return PLAN_PERMISSION_REQUIRED"
run_psql "update public.agent_plan_permissions
  set granted_at = '${GRANTED_AT}', plan_access_enabled = false
  where owner_user_id = '${USER_A_UUID}'::uuid and client_id = '${AGENT_CLIENT_ID}';" >/dev/null
agent_get "session-plans"
assert_status "403" "disabled permission"
agent_post "exercises/${EXERCISE_A}" "$(jq -nc --argjson rev "${NOW_MS}" '{expected_revision:$rev,name:"Disabled"}')" \
  "agent-api-${RUN_TAG}-ex-disabled"
assert_status "403" "disabled permission exercise write"
run_psql "update public.agent_plan_permissions
  set plan_access_enabled = true
  where owner_user_id = '${USER_A_UUID}'::uuid and client_id = '${AGENT_CLIENT_ID}';" >/dev/null
agent_get "session-plans"
assert_status "200" "re-enabled permission"

echo "[agent-api-test] verifying service-role atomic plan and programme mutation RPCs"

rpc_expect_error() {
  local expected_err="$1"
  local sql="$2"
  local context="$3"
  local out
  out="$(docker exec -i "${DB_CONTAINER}" psql -U postgres -Atq -c "${sql}" 2>&1 || true)"
  if [[ "${out}" != *"${expected_err}"* ]]; then
    fail "${context}: expected error containing '${expected_err}', got: ${out}"
  fi
}

MUT_KEY_BASE="agent-api-${RUN_TAG}-mut"
MUT_HASH_1="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
MUT_HASH_2="ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"

for fn in agent_update_plan_meta agent_update_programme_meta agent_insert_plan_block agent_update_plan_block agent_reorder_plan_blocks agent_reorder_programme_plans agent_reorder_block_sets agent_tombstone_plan_block agent_detach_programme_plan agent_tombstone_plan agent_tombstone_programme; do
  [[ "$(run_psql "select has_function_privilege('anon', to_regproc('app_public.${fn}'), 'execute');")" == "f" ]] ||
    fail "anon has execute privilege on ${fn}"
  [[ "$(run_psql "select has_function_privilege('authenticated', to_regproc('app_public.${fn}'), 'execute');")" == "f" ]] ||
    fail "authenticated has execute privilege on ${fn}"
  [[ "$(run_psql "select has_function_privilege('service_role', to_regproc('app_public.${fn}'), 'execute');")" == "t" ]] ||
    fail "service_role lacks execute privilege on ${fn}"
done

V_PLAN_INITIAL="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
rpc_expect_error "PLAN_CONCURRENT_MODIFICATION" "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid,
    '${AGENT_CLIENT_ID}',
    '${MUT_KEY_BASE}-stale-1',
    '${MUT_HASH_1}',
    '${PLAN_ID}',
    '2020-01-01T00:00:00.000000Z',
    '{\"title\": \"Should Not Land\"}'::jsonb
  );
" "stale base_version plan update"
[[ "$(run_psql "select title from app_public.session_plans where id = '${PLAN_ID}';")" != "Should Not Land" ]] ||
  fail "stale plan update wrote title"

BLOCK1_ID="$(run_psql "select id from app_public.session_plan_exercises where session_plan_id = '${PLAN_ID}' and deleted_at is null order by order_index limit 1;")"
ATTACH_SESS_ID="agent-api-${RUN_TAG}-mut-attach-sess"
ATTACH_CARD_ID="agent-api-${RUN_TAG}-mut-attach-card"
run_psql "
  insert into app_public.sessions (owner_user_id, id, status, started_at, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${ATTACH_SESS_ID}', 'active', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.session_exercises (owner_user_id, id, session_id, source_plan_exercise_id, order_index, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${ATTACH_CARD_ID}', '${ATTACH_SESS_ID}', '${BLOCK1_ID}', 0, 'Attached Block', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
" >/dev/null
rpc_expect_error "IMMUTABLE_BLOCK_MUTATION" "
  select app_public.agent_update_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-att-upd', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK1_ID}', '${V_PLAN_INITIAL}',
    '{\"name\": \"Mutated Attached\"}'::jsonb
  );
" "attached block update"
rpc_expect_error "IMMUTABLE_BLOCK_MUTATION" "
  select app_public.agent_tombstone_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-att-del', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK1_ID}', '${V_PLAN_INITIAL}'
  );
" "attached block tombstone"
rpc_expect_error "IMMUTABLE_BLOCK_MUTATION" "
  select app_public.agent_tombstone_plan(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-att-pldel', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_INITIAL}'
  );
" "attached plan tombstone"
run_psql "
  delete from app_public.session_exercises where id = '${ATTACH_CARD_ID}';
  delete from app_public.sessions where id = '${ATTACH_SESS_ID}';
" >/dev/null

update_training_fixture "update app_public.session_plan_exercises set progress_status = 'completed' where id = '${BLOCK1_ID}';"
V_RESOLVED="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
rpc_expect_error "IMMUTABLE_BLOCK_MUTATION" "
  select app_public.agent_update_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-res-upd', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK1_ID}', '${V_RESOLVED}',
    '{\"name\": \"Mutated Resolved\"}'::jsonb
  );
" "resolved block update"
update_training_fixture "update app_public.session_plan_exercises set progress_status = 'pending' where id = '${BLOCK1_ID}';"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
rpc_expect_error "INVALID_ARGUMENT" "
  select app_public.agent_tombstone_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-tomb-one', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK1_ID}', '${V_PLAN_CUR}'
  );
" "tombstone sole block"

PROG_CHILD_1="$(run_psql "select id from app_public.session_plans where programme_id = '${PROGRAMME_ID}' and deleted_at is null order by programme_order_index limit 1;")"
V_PROG_CUR="$(run_psql "select to_char(app_public.agent_programme_graph_version('${USER_A_UUID}'::uuid, '${PROGRAMME_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
rpc_expect_error "INVALID_ARGUMENT" "
  select app_public.agent_detach_programme_plan(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-detach-under', '${MUT_HASH_1}',
    '${PROGRAMME_ID}', '${PROG_CHILD_1}', '${V_PROG_CUR}'
  );
" "detach leaving < 2 plans"

RES_META="$(run_psql "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-meta-1', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    '{\"title\": \"Renamed Plan Agent\", \"gym_id\": \"${GYM_A}\"}'::jsonb
  );
")"
[[ "$(printf '%s' "${RES_META}" | jq -r '.plan_id')" == "${PLAN_ID}" ]] || fail "update_plan_meta result missing plan_id"
[[ "$(printf '%s' "${RES_META}" | jq -r '.idempotent_replay')" == "false" ]] || fail "initial update_plan_meta was replay"
[[ "$(run_psql "select title || '|' || last_modified_by from app_public.session_plans where id = '${PLAN_ID}';")" == "Renamed Plan Agent|agent" ]] ||
  fail "update_plan_meta did not stamp title and last_modified_by = 'agent'"

RES_REPLAY="$(run_psql "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-meta-1', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    '{\"title\": \"Renamed Plan Agent\", \"gym_id\": \"${GYM_A}\"}'::jsonb
  );
")"
[[ "$(printf '%s' "${RES_REPLAY}" | jq -r '.idempotent_replay')" == "true" ]] || fail "replay was not flagged"
[[ "$(printf '%s' "${RES_REPLAY}" | jq -r '.version')" == "$(printf '%s' "${RES_META}" | jq -r '.version')" ]] ||
  fail "replay returned different version"

rpc_expect_error "IDEMPOTENCY_CONFLICT" "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-meta-1', '${MUT_HASH_2}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    '{\"title\": \"Differing Payload\"}'::jsonb
  );
" "idempotency conflict on update_plan_meta"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
rpc_expect_error "FOREIGN_RESOURCE_REFERENCE" "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-meta-foreign', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    '{\"gym_id\": \"agent-api-nonexistent-gym\"}'::jsonb
  );
" "foreign gym in update_plan_meta"
rpc_expect_error "INVALID_ARGUMENT" "
  select app_public.agent_update_plan_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-meta-empty', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    '{\"title\": \"\"}'::jsonb
  );
" "empty title in update_plan_meta"

RES_INS_BLOCK="$(run_psql "
  select app_public.agent_insert_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-ins-blk', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    jsonb_build_object(
      'exercise_definition_id', '${EXERCISE_A2}',
      'name', 'Block Two Bench',
      'sets', jsonb_build_array(
        jsonb_build_object('target_reps', 10, 'target_weight_value', '60'),
        jsonb_build_object('target_reps', 8, 'target_weight_value', '70')
      )
    )
  );
")"
BLOCK2_ID="$(printf '%s' "${RES_INS_BLOCK}" | jq -er '.exercise_id')"
[[ "$(printf '%s' "${RES_INS_BLOCK}" | jq '.set_ids | length')" == "2" ]] || fail "insert_plan_block did not return 2 set IDs"
[[ "$(run_psql "select order_index || '|' || last_modified_by from app_public.session_plan_exercises where id = '${BLOCK2_ID}';")" == "1|agent" ]] ||
  fail "new block did not get dense order_index 1 and last_modified_by = 'agent'"
[[ "$(run_psql "select count(*) from app_public.session_plan_sets where session_plan_exercise_id = '${BLOCK2_ID}' and last_modified_by = 'agent';")" == "2" ]] ||
  fail "inserted sets lack last_modified_by = 'agent'"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
SET2_ID_1="$(printf '%s' "${RES_INS_BLOCK}" | jq -r '.set_ids[0]')"
SET2_ID_2="$(printf '%s' "${RES_INS_BLOCK}" | jq -r '.set_ids[1]')"
RES_UPD_BLOCK="$(run_psql "
  select app_public.agent_update_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-upd-blk', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK2_ID}', '${V_PLAN_CUR}',
    jsonb_build_object(
      'name', 'Block Two Bench Edited',
      'sets', jsonb_build_array(
        jsonb_build_object('id', '${SET2_ID_1}', 'target_reps', 12, 'target_weight_value', '65'),
        jsonb_build_object('target_reps', 6, 'target_weight_value', '75')
      )
    )
  );
")"
[[ "$(run_psql "select name || '|' || last_modified_by from app_public.session_plan_exercises where id = '${BLOCK2_ID}';")" == "Block Two Bench Edited|agent" ]] ||
  fail "block update did not stamp name and agent attribution"
[[ "$(run_psql "select target_reps || '|' || (deleted_at is null) from app_public.session_plan_sets where id = '${SET2_ID_1}';")" == "12|true" ]] ||
  fail "kept set was not updated"
[[ "$(run_psql "select deleted_at is not null from app_public.session_plan_sets where id = '${SET2_ID_2}';")" == "t" ]] ||
  fail "omitted set was not tombstoned"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
LIVE_SET_IDS="$(run_psql "select json_agg(id order by order_index desc) from app_public.session_plan_sets where session_plan_exercise_id = '${BLOCK2_ID}' and deleted_at is null;")"
run_psql "
  select app_public.agent_reorder_block_sets(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-reord-sets', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK2_ID}', '${V_PLAN_CUR}',
    '${LIVE_SET_IDS}'::jsonb
  );
" >/dev/null
FIRST_SET_ID="$(printf '%s' "${LIVE_SET_IDS}" | jq -r '.[0]')"
[[ "$(run_psql "select order_index from app_public.session_plan_sets where id = '${FIRST_SET_ID}';")" == "0" ]] ||
  fail "sets reorder did not update order_index to 0"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_reorder_plan_blocks(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-reord-blks', '${MUT_HASH_1}',
    '${PLAN_ID}', '${V_PLAN_CUR}',
    jsonb_build_array('${BLOCK2_ID}', '${BLOCK1_ID}')
  );
" >/dev/null
[[ "$(run_psql "select order_index from app_public.session_plan_exercises where id = '${BLOCK2_ID}';")" == "0" ]] ||
  fail "block reorder did not set block 2 to order 0"
[[ "$(run_psql "select order_index from app_public.session_plan_exercises where id = '${BLOCK1_ID}';")" == "1" ]] ||
  fail "block reorder did not set block 1 to order 1"

V_PLAN_CUR="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PLAN_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_tombstone_plan_block(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-tomb-blk2', '${MUT_HASH_1}',
    '${PLAN_ID}', '${BLOCK2_ID}', '${V_PLAN_CUR}'
  );
" >/dev/null
[[ "$(run_psql "select deleted_at is not null from app_public.session_plan_exercises where id = '${BLOCK2_ID}';")" == "t" ]] ||
  fail "tombstoned block is not deleted"
[[ "$(run_psql "select order_index from app_public.session_plan_exercises where id = '${BLOCK1_ID}';")" == "0" ]] ||
  fail "remaining sibling block was not redensified to order_index 0"

V_PROG_CUR="$(run_psql "select to_char(app_public.agent_programme_graph_version('${USER_A_UUID}'::uuid, '${PROGRAMME_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_update_programme_meta(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-prog-meta', '${MUT_HASH_1}',
    '${PROGRAMME_ID}', '${V_PROG_CUR}',
    '{\"name\": \"Renamed Coaching Wave\", \"description\": \"Updated description\"}'::jsonb
  );
" >/dev/null
[[ "$(run_psql "select name || '|' || last_modified_by from app_public.training_programmes where id = '${PROGRAMME_ID}';")" == "Renamed Coaching Wave|agent" ]] ||
  fail "update_programme_meta did not update name and agent attribution"

PROG_CHILD_3="agent-api-${RUN_TAG}-child-3"
run_psql "
  select app_public.agent_insert_plan_graph(
    '${USER_A_UUID}'::uuid,
    '${PROG_CHILD_3}',
    '${PROGRAMME_ID}',
    2,
    jsonb_build_object(
      'title', 'Child Plan 3',
      'exercises', jsonb_build_array(
        jsonb_build_object('exercise_definition_id', '${EXERCISE_A}', 'name', 'Exercise 1', 'sets', jsonb_build_array(jsonb_build_object('target_reps', 5)))
      )
    ),
    ${NOW_MS}
  );
" >/dev/null
PROG_CHILD_2="$(run_psql "select id from app_public.session_plans where programme_id = '${PROGRAMME_ID}' and id not in ('${PROG_CHILD_1}', '${PROG_CHILD_3}') and deleted_at is null;")"
V_PROG_CUR="$(run_psql "select to_char(app_public.agent_programme_graph_version('${USER_A_UUID}'::uuid, '${PROGRAMME_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_reorder_programme_plans(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-reord-progs', '${MUT_HASH_1}',
    '${PROGRAMME_ID}', '${V_PROG_CUR}',
    jsonb_build_array('${PROG_CHILD_3}', '${PROG_CHILD_1}', '${PROG_CHILD_2}')
  );
" >/dev/null
[[ "$(run_psql "select programme_order_index from app_public.session_plans where id = '${PROG_CHILD_3}';")" == "0" ]] ||
  fail "reorder_programme_plans did not set plan 3 to order 0"

V_PROG_CUR="$(run_psql "select to_char(app_public.agent_programme_graph_version('${USER_A_UUID}'::uuid, '${PROGRAMME_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_detach_programme_plan(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-detach-3', '${MUT_HASH_1}',
    '${PROGRAMME_ID}', '${PROG_CHILD_3}', '${V_PROG_CUR}'
  );
" >/dev/null
[[ "$(run_psql "select (programme_id is null) || '|' || (deleted_at is null) || '|' || last_modified_by from app_public.session_plans where id = '${PROG_CHILD_3}';")" == "true|true|agent" ]] ||
  fail "detached plan is not standalone live with agent attribution"
[[ "$(run_psql "select count(*) from app_public.session_plans where programme_id = '${PROGRAMME_ID}' and deleted_at is null;")" == "2" ]] ||
  fail "programme does not have exactly 2 plans left"
[[ "$(run_psql "select programme_order_index from app_public.session_plans where id = '${PROG_CHILD_1}';")" == "0" ]] ||
  fail "remaining plan 1 not redensified to order 0"

V_CHILD3="$(run_psql "select to_char(app_public.agent_plan_graph_version('${USER_A_UUID}'::uuid, '${PROG_CHILD_3}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_tombstone_plan(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-tomb-pl3', '${MUT_HASH_1}',
    '${PROG_CHILD_3}', '${V_CHILD3}'
  );
" >/dev/null
[[ "$(run_psql "select deleted_at is not null from app_public.session_plans where id = '${PROG_CHILD_3}';")" == "t" ]] ||
  fail "tombstoned standalone plan is not deleted"

V_PROG_CUR="$(run_psql "select to_char(app_public.agent_programme_graph_version('${USER_A_UUID}'::uuid, '${PROGRAMME_ID}') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")"
run_psql "
  select app_public.agent_tombstone_programme(
    '${USER_A_UUID}'::uuid, '${AGENT_CLIENT_ID}', '${MUT_KEY_BASE}-tomb-prog', '${MUT_HASH_1}',
    '${PROGRAMME_ID}', '${V_PROG_CUR}'
  );
" >/dev/null
[[ "$(run_psql "select deleted_at is not null from app_public.training_programmes where id = '${PROGRAMME_ID}';")" == "t" ]] ||
  fail "tombstoned programme is not deleted"
[[ "$(run_psql "select count(*) from app_public.session_plans where id in ('${PROG_CHILD_1}', '${PROG_CHILD_2}') and programme_id is null and deleted_at is null;")" == "2" ]] ||
  fail "tombstone_programme did not detach live child plans as standalone live"


echo "[agent-api-test] verifying the muscle list and the exercise catalog view"
agent_get "muscles"
assert_status "200" "muscle list"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg a "${MUSCLE_A}" --arg a2 "${MUSCLE_A2}" --arg b "${MUSCLE_B}" '
  (.data.muscles | map(.id) | index($a)) != null
  and (.data.muscles | map(.id) | index($a2)) != null
  and (.data.muscles | map(.id) | index($b)) == null
  and (.data.muscles[] | select(.id == $a) | .family) == "chest"
' >/dev/null || fail "muscle list is not the owner taxonomy"
agent_get "exercises?query=Agent%20A%20Bench"
assert_status "200" "catalog view"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg ex "${EXERCISE_A}" --argjson rev "${NOW_MS}" '
  .data.exercises[] | select(.id == $ex)
  | .split_by_gym == false and .deleted == false and .revision == $rev
' >/dev/null || fail "catalog view lacks split_by_gym, revision or deleted"
# Gym usage counts sessions holding a working set: the warm-up-only exercise has none.
agent_get "exercises/${EXERCISE_A}/context"
assert_status "200" "gym usage of an unsplit exercise"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg gym "${GYM_A}" '
  .data.exercise.gym_usage.gyms | length == 1 and .[0].gym == {id:$gym,name:"Agent A Gym"} and .[0].session_count == 1
' >/dev/null || fail "context gym usage does not count the working-set session at its gym"
printf '%s' "${RESPONSE_BODY}" | jq -e '.data.exercise.gym_usage | .no_gym_session_count == 0 and .complete == true' \
  >/dev/null || fail "context gym usage lacks no-gym count or completeness"
agent_get "exercises/${EXERCISE_A2}/context"
assert_status "200" "gym usage of a warm-up-only exercise"
printf '%s' "${RESPONSE_BODY}" | jq -e '.data.exercise.gym_usage.gyms == []' >/dev/null ||
  fail "a warm-up-only session counted toward gym usage"

echo "[agent-api-test] verifying exercise create, replay and validation"
CREATE_NAME="agent-api-${RUN_TAG} Cable Fly"
CREATE_KEY="agent-api-${RUN_TAG}-ex-create"
CREATE_BODY="$(jq -nc --arg name "${CREATE_NAME}" --arg a "${MUSCLE_A}" --arg a2 "${MUSCLE_A2}" '
  {name:$name,split_by_gym:true,
   muscles:[{muscle_id:$a2,role:"secondary"},{muscle_id:$a,role:"primary"}]}')"
agent_post "exercises" "${CREATE_BODY}" "${CREATE_KEY}"
assert_status "200" "exercise create"
CREATED_ID="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.exercise_id')"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg name "${CREATE_NAME}" '
  .data.idempotent_replay == false
  and .data.exercise.name == $name and .data.exercise.split_by_gym == true
  and .data.exercise.load_input_mode == "total_load"
  and .data.exercise.revision == .data.revision
  and (.data.exercise.muscles | map(.role) | sort) == ["primary","secondary"]
' >/dev/null || fail "exercise create did not return the created exercise"
[[ "$(run_psql "select string_agg(id || ':' || role || ':' || weight, ',' order by role)
  from app_public.exercise_muscle_mappings
  where owner_user_id = '${USER_A_UUID}'::uuid and exercise_definition_id = '${CREATED_ID}';")" == \
  "map_${CREATED_ID}__${MUSCLE_A}:primary:1,map_${CREATED_ID}__${MUSCLE_A2}:secondary:0.5" ]] ||
  fail "created muscle links are not pair-id rows weighted 1 and 0.5"
agent_post "exercises" "${CREATE_BODY}" "${CREATE_KEY}"
assert_status "200" "exercise create replay"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${CREATED_ID}" \
  '.data.exercise_id == $id and .data.idempotent_replay == true' >/dev/null ||
  fail "exercise create replay did not return the original exercise"
agent_post "exercises" "$(jq -nc --arg name "agent-api-${RUN_TAG} Foreign" --arg b "${MUSCLE_B}" \
  '{name:$name,muscles:[{muscle_id:$b,role:"primary"}]}')" "agent-api-${RUN_TAG}-ex-foreign"
assert_status "400" "exercise create with another owner's muscle"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "FOREIGN_RESOURCE_REFERENCE" ]] ||
  fail "another owner's muscle did not return FOREIGN_RESOURCE_REFERENCE"
agent_post "exercises" "$(jq -nc --arg name "agent-api-${RUN_TAG} Two primaries" --arg a "${MUSCLE_A}" --arg a2 "${MUSCLE_A2}" \
  '{name:$name,muscles:[{muscle_id:$a,role:"primary"},{muscle_id:$a2,role:"primary"}]}')" "agent-api-${RUN_TAG}-ex-two"
assert_status "400" "exercise create with two primaries"
[[ "$(run_psql "select count(*) from app_public.exercise_definitions
  where owner_user_id = '${USER_A_UUID}'::uuid and name in
    ('agent-api-${RUN_TAG} Foreign','agent-api-${RUN_TAG} Two primaries','agent-api-${RUN_TAG} Denied');")" == "0" ]] ||
  fail "a rejected exercise create left a row"

echo "[agent-api-test] verifying revision-checked exercise update and muscle reconciliation"
UPDATE_BODY="$(jq -nc --argjson rev "${NOW_MS}" --arg a "${MUSCLE_A}" --arg a2 "${MUSCLE_A2}" '
  {expected_revision:$rev,split_by_gym:true,name:"Agent A Bench Press",
   muscles:[{muscle_id:$a2,role:"primary"},{muscle_id:$a,role:"secondary"}]}')"
agent_post "exercises/${EXERCISE_A}" "${UPDATE_BODY}" "agent-api-${RUN_TAG}-ex-update"
assert_status "200" "exercise update"
REVISION_A="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.revision')"
(( REVISION_A > NOW_MS )) || fail "exercise update did not advance the revision (${REVISION_A})"
printf '%s' "${RESPONSE_BODY}" | jq -e '.data.exercise.split_by_gym == true and .data.exercise.name == "Agent A Bench Press"' \
  >/dev/null || fail "exercise update response does not show the change"
[[ "$(run_psql "select string_agg(id || ':' || role || ':' || weight || ':' || (deleted_at is null), ',' order by id)
  from app_public.exercise_muscle_mappings
  where owner_user_id = '${USER_A_UUID}'::uuid and exercise_definition_id = '${EXERCISE_A}';")" == \
  "${MAPPING_A}:secondary:0.5:true,map_${EXERCISE_A}__${MUSCLE_A2}:primary:1:true" ]] ||
  fail "update did not revive the existing link in place and add a pair-id link"
[[ "$(run_psql "select count(*) from app_public.exercise_muscle_mappings
  where owner_user_id = '${USER_A_UUID}'::uuid and exercise_definition_id = '${EXERCISE_A}'
    and client_updated_at_ms = ${REVISION_A};")" == "2" ]] ||
  fail "changed links were not stamped with the update's revision"
agent_post "exercises/${EXERCISE_A}" "$(jq -nc --argjson rev "${NOW_MS}" '{expected_revision:$rev,split_by_gym:false}')" \
  "agent-api-${RUN_TAG}-ex-stale"
assert_status "409" "stale exercise revision"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "REVISION_CONFLICT" ]] ||
  fail "a stale revision did not return REVISION_CONFLICT"
agent_post "exercises/${EXERCISE_A}" "$(jq -nc --argjson rev "${REVISION_A}" --arg a "${MUSCLE_A}" \
  '{expected_revision:$rev,muscles:[{muscle_id:$a,role:"primary"}]}')" "agent-api-${RUN_TAG}-ex-drop"
assert_status "200" "exercise update dropping a muscle"
REVISION_A="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.revision')"
[[ "$(run_psql "select string_agg(id || ':' || role || ':' || (deleted_at is null), ',' order by id)
  from app_public.exercise_muscle_mappings
  where owner_user_id = '${USER_A_UUID}'::uuid and exercise_definition_id = '${EXERCISE_A}';")" == \
  "${MAPPING_A}:primary:true,map_${EXERCISE_A}__${MUSCLE_A2}:primary:false" ]] ||
  fail "a dropped muscle was not kept as a tombstone"
agent_post "exercises/${EXERCISE_A2}" "$(jq -nc --argjson rev "${NOW_MS}" '{expected_revision:$rev,load_input_mode:"total_load"}')" \
  "agent-api-${RUN_TAG}-ex-mode"
assert_status "200" "exercise load-mode update"
[[ "$(run_psql "select load_input_mode from app_public.exercise_definitions
  where owner_user_id = '${USER_A_UUID}'::uuid and id = '${EXERCISE_A2}';")" == "total_load" ]] ||
  fail "load-mode update did not land"
agent_post "exercises/${EXERCISE_B}" "$(jq -nc --argjson rev "${NOW_MS}" '{expected_revision:$rev,name:"Stolen"}')" \
  "agent-api-${RUN_TAG}-ex-cross"
assert_status "404" "cross-owner exercise update"
[[ "$(run_psql "select name from app_public.exercise_definitions
  where owner_user_id = '${USER_B_UUID}'::uuid and id = '${EXERCISE_B}';")" == "User B Secret Lift" ]] ||
  fail "a cross-owner update touched user B's exercise"

echo "[agent-api-test] verifying soft delete and restore"
CREATED_REVISION="$(run_psql "select client_updated_at_ms from app_public.exercise_definitions
  where owner_user_id = '${USER_A_UUID}'::uuid and id = '${CREATED_ID}';")"
agent_post "exercises/${CREATED_ID}/delete" "$(jq -nc --argjson rev "${CREATED_REVISION}" '{expected_revision:$rev}')" \
  "agent-api-${RUN_TAG}-ex-delete"
assert_status "200" "exercise delete"
printf '%s' "${RESPONSE_BODY}" | jq -e '.data.deleted == true and .data.changed == true and .data.exercise.deleted == true' \
  >/dev/null || fail "exercise delete did not report the deleted exercise"
DELETED_REVISION="$(printf '%s' "${RESPONSE_BODY}" | jq -er '.data.revision')"
agent_get "exercises?query=Cable%20Fly"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${CREATED_ID}" '(.data.exercises | map(.id) | index($id)) == null' \
  >/dev/null || fail "a deleted exercise is still in the default search"
agent_get "exercises?query=Cable%20Fly&include_deleted=true"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${CREATED_ID}" '.data.exercises[] | select(.id == $id) | .deleted == true' \
  >/dev/null || fail "include_deleted did not list the deleted exercise"
agent_post "exercises/${CREATED_ID}/delete" "$(jq -nc --argjson rev "${CREATED_REVISION}" '{expected_revision:$rev}')" \
  "agent-api-${RUN_TAG}-ex-delete-again"
assert_status "200" "delete of a deleted exercise with an old revision"
printf '%s' "${RESPONSE_BODY}" | jq -e --argjson rev "${DELETED_REVISION}" '.data.changed == false and .data.revision == $rev' \
  >/dev/null || fail "deleting a deleted exercise was not a no-op"
agent_post "exercises/${CREATED_ID}" "$(jq -nc --argjson rev "${DELETED_REVISION}" '{expected_revision:$rev,name:"Nope"}')" \
  "agent-api-${RUN_TAG}-ex-edit-deleted"
assert_status "409" "edit of a deleted exercise"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "EXERCISE_DELETED" ]] ||
  fail "editing a deleted exercise did not return EXERCISE_DELETED"
agent_post "exercises/${CREATED_ID}/restore" "$(jq -nc --argjson rev "${DELETED_REVISION}" '{expected_revision:$rev}')" \
  "agent-api-${RUN_TAG}-ex-restore"
assert_status "200" "exercise restore"
printf '%s' "${RESPONSE_BODY}" | jq -e '.data.deleted == false and .data.changed == true and .data.exercise.deleted == false' \
  >/dev/null || fail "exercise restore did not report the live exercise"
[[ "$(run_psql "select count(*) from app_public.session_exercises
  where owner_user_id = '${USER_A_UUID}'::uuid and exercise_definition_id = '${EXERCISE_A}';")" == "1" ]] ||
  fail "exercise edits changed performed history"
[[ "$(run_psql "select string_agg(distinct tool_name, ',' order by tool_name) from public.agent_access_audit
  where owner_user_id = '${USER_A_UUID}'::uuid and oauth_client_id = '${AGENT_CLIENT_ID}'
    and tool_name in ('list_muscles','create_exercise','update_exercise','delete_exercise','restore_exercise');")" == \
  "create_exercise,delete_exercise,list_muscles,restore_exercise,update_exercise" ]] ||
  fail "exercise routes are not audited under their tool names"

echo "[agent-api-test] verifying plan tables stay closed to direct OAuth access"
app_public_request GET "session_plans?select=id" "${AGENT_ACCESS_TOKEN}"
assert_status "200" "agent direct plan-table read denial"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq 'length')" == "0" ]] ||
  fail "agent credential bypassed the plan-table boundary"


echo "[agent-api-test] verifying invalid and expired credentials"
agent_get "profile" "not-a-token"
assert_status "401" "invalid bearer token"
EXPIRED_TOKEN="$(make_expired_token "${AGENT_ACCESS_TOKEN}")" ||
  fail "could not construct a locally signed expired token"
agent_get "profile" "${EXPIRED_TOKEN}"
assert_status "401" "expired bearer token"

echo "[agent-api-test] verifying a Supabase Auth outage is retryable, not a token rejection"
AUTH_CONTAINER="${DB_CONTAINER/#supabase_db_/supabase_auth_}"
docker ps --format '{{.Names}}' | grep -Fxq "${AUTH_CONTAINER}" ||
  fail "this slot's Auth container ${AUTH_CONTAINER} is not running"
AUTH_STOPPED=1
docker stop "${AUTH_CONTAINER}" >/dev/null
agent_get "profile"
assert_status "503" "agent request during an Auth outage"
printf '%s' "${RESPONSE_BODY}" | jq -e '.error.code == "UPSTREAM_UNAVAILABLE"' >/dev/null ||
  fail "Auth outage did not report UPSTREAM_UNAVAILABLE"
printf '%s\n' "${RESPONSE_HEADERS}" | grep -Eqi '^retry-after: 5$' ||
  fail "Auth outage response has no Retry-After"
! printf '%s\n' "${RESPONSE_HEADERS}" | grep -qi '^www-authenticate:' ||
  fail "Auth outage response challenged the token"
start_auth_container || fail "Auth did not recover after the outage probe"
agent_get "profile"
assert_status "200" "agent request after Auth recovers"

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

app_public_request POST "rpc/dev_wipe_my_data" "${AGENT_ACCESS_TOKEN}" '{}'
assert_non_2xx "agent developer wipe RPC"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.message')" == *"AGENT_FORBIDDEN"* ]] ||
  fail "agent developer wipe RPC did not hit the explicit OAuth-client guard"
WIPE_PROBE_COUNT="$(run_psql "
  select
    (select count(*) from app_public.gyms
      where owner_user_id = '${USER_A_UUID}'::uuid and id = '${GYM_A}')
    + (select count(*) from app_public.exercise_definitions
      where owner_user_id = '${USER_A_UUID}'::uuid and id = '${EXERCISE_A}');
")"
[[ "${WIPE_PROBE_COUNT}" == "2" ]] ||
  fail "agent developer wipe RPC removed owned training rows"

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

COMPLETED=1
echo "[agent-api-test] PASS"
