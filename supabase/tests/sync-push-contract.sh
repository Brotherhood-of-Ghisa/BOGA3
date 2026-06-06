#!/usr/bin/env bash

# Sync v2 sync_push RPC contract test.
#
# Exercises the wire-level behaviour pinned in designs/t1.md §1 (LWW,
# future-clock clamp, undelete) and designs/t2.md §3 (envelope, batch caps,
# success/error shapes, FK closure).
#
# Run via the wrapper at supabase/scripts/test-sync-push-contract.sh (which
# brings up the shared local runtime baseline first). For ad-hoc local
# iteration, call this script directly after running
# `./supabase/scripts/ensure-local-runtime-baseline.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for sync_push contract tests." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Generic HTTP / assertion helpers (shared idiom across the sync v2 contract
# suites, e.g. sync-pull-contract.sh).
# ---------------------------------------------------------------------------

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
    -o "${response_file}"
    -w "%{http_code}"
  )

  if [[ -n "${auth_bearer}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${auth_bearer}")
  fi

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
  if ! printf '%s' "${REQUEST_BODY}" | grep -q "${needle}"; then
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

# Per-call wrappers --------------------------------------------------------

sync_push() {
  local token="$1"
  local body="$2"
  http_request POST "${API_URL}/rest/v1/rpc/sync_push" "${token}" "${ANON_KEY}" "app_public" "${body}"
}

sync_push_no_jwt() {
  # No Authorization header at all — must surface AUTH_REQUIRED.
  local body="$1"
  http_request POST "${API_URL}/rest/v1/rpc/sync_push" "" "${ANON_KEY}" "app_public" "${body}"
}

service_select() {
  local table="$1"
  local query="$2"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${SERVICE_ROLE_KEY}" "${SERVICE_ROLE_KEY}" "app_public"
}

user_select() {
  local table="$1"
  local query="$2"
  local token="$3"
  http_request GET "${API_URL}/rest/v1/${table}?${query}" "${token}" "${ANON_KEY}" "app_public"
}

service_delete() {
  local table="$1"
  local query="$2"
  http_request DELETE "${API_URL}/rest/v1/${table}?${query}" "${SERVICE_ROLE_KEY}" "${SERVICE_ROLE_KEY}" "app_public"
}

# ---------------------------------------------------------------------------
# Bootstrap.
# ---------------------------------------------------------------------------

require_jq
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "Missing Supabase local runtime env (API_URL / ANON_KEY / SERVICE_ROLE_KEY). Start local stack first." >&2
  exit 1
fi

echo "[sync-push] signing in fixture users"
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
[[ -n "${USER_A_UUID}" && "${USER_A_UUID}" != "null" ]]
[[ -n "${USER_B_UUID}" && "${USER_B_UUID}" != "null" ]]

BASE_MS="$(($(date +%s) * 1000))"
RUN_TAG="${SYNC_PUSH_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

# Pre-clean any leftover rows from earlier failed runs of this same tag.
# (RUN_TAG already includes pid + nanosecond rand so collisions are
# essentially impossible, but service-role cleanup is cheap.)
GYM_A_ID="push-gym-a-${RUN_TAG}"
GYM_LWW_ID="push-gym-lww-${RUN_TAG}"
GYM_OLDER_ID="push-gym-older-${RUN_TAG}"
GYM_RETRY_ID="push-gym-retry-${RUN_TAG}"
GYM_DELETE_ID="push-gym-delete-${RUN_TAG}"
GYM_UNDELETE_ID="push-gym-undelete-${RUN_TAG}"
GYM_CLAMP_ID="push-gym-clamp-${RUN_TAG}"
GYM_CROSS_OWNER_ID="push-gym-cross-${RUN_TAG}"
EXDEF_A_ID="push-exdef-a-${RUN_TAG}"
SESSION_A_ID="push-session-a-${RUN_TAG}"
SX_A_ID="push-sx-a-${RUN_TAG}"
SX_ORPHAN_ID="push-sx-orphan-${RUN_TAG}"
SET_A_ID="push-set-a-${RUN_TAG}"
SESSION_FK_ID="push-session-fk-${RUN_TAG}"
SX_FK_ID="push-sx-fk-${RUN_TAG}"
MISSING_PARENT_ID="push-missing-parent-${RUN_TAG}"

# ===========================================================================
# 1. Happy path: single-row gyms; user A sees it, user B does not.
# ===========================================================================

echo "[sync-push] happy path: single gym for user A"
PAYLOAD="$(jq -nc \
  --arg id "${GYM_A_ID}" \
  --argjson cuam "${BASE_MS}" \
  --argjson created_at "${BASE_MS}" \
  --argjson updated_at "${BASE_MS}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Single Gym", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $created_at, updated_at: $updated_at, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "single gym push"
assert_json_expr '.ok == true' "single gym push ok=true"
assert_json_expr '.server_received_at | type == "string"' "single gym push server_received_at is ISO string"
assert_json_expr '.server_received_at | test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")' "server_received_at ISO-8601 with ms"

# A sees it.
user_select "gyms" "id=eq.${GYM_A_ID}&select=id,name,owner_user_id" "${USER_A_TOKEN}"
assert_status "200" "user A read gym after push"
assert_json_expr --arg id "${GYM_A_ID}" --arg owner "${USER_A_UUID}" \
  'length == 1 and .[0].id == $id and .[0].owner_user_id == $owner' \
  "user A sees their gym"

# B does not see it.
user_select "gyms" "id=eq.${GYM_A_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "user B read gym (RLS deny)"
assert_json_expr 'length == 0' "user B does not see user A's gym"

# Bigint epoch-ms returned as JSON integer (designs/t2.md §1). Service-role
# select bypasses RLS; we want a deterministic peek at the raw stored value.
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_A_ID}&select=client_updated_at_ms,created_at"
assert_status "200" "service select bigint shape"
assert_json_expr '.[0].client_updated_at_ms | type == "number"' "client_updated_at_ms is JSON number"
assert_json_expr '.[0].created_at | type == "number"' "created_at is JSON number"

# ===========================================================================
# 2. Multi-layer batch out of array order — deferrable FKs cover it.
#    Child (exercise_sets) before parent (session_exercises) before
#    grandparent (sessions) and seed (exercise_definitions). Commits OK.
# ===========================================================================

echo "[sync-push] multi-layer batch, child before parent"
PAYLOAD="$(jq -nc \
  --arg set_id "${SET_A_ID}" --arg sx_id "${SX_A_ID}" \
  --arg session_id "${SESSION_A_ID}" --arg exdef_id "${EXDEF_A_ID}" \
  --argjson now "$((BASE_MS + 100))" \
  '{entities: [
    {type: "exercise_sets", id: $set_id, client_updated_at_ms: $now,
     fields: {session_exercise_id: $sx_id, order_index: 0,
              weight_value: "100", reps_value: "8", set_type: "rir_2",
              created_at: $now, updated_at: $now, deleted_at: null}},
    {type: "session_exercises", id: $sx_id, client_updated_at_ms: $now,
     fields: {session_id: $session_id, exercise_definition_id: $exdef_id,
              order_index: 0, name: "Bench Press", machine_name: null,
              created_at: $now, updated_at: $now, deleted_at: null}},
    {type: "sessions", id: $session_id, client_updated_at_ms: $now,
     fields: {gym_id: null, status: "active", started_at: $now,
              completed_at: null, duration_sec: null,
              created_at: $now, updated_at: $now, deleted_at: null}},
    {type: "exercise_definitions", id: $exdef_id, client_updated_at_ms: $now,
     fields: {name: "Bench Press", created_at: $now, updated_at: $now,
              deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "multi-layer batch push"
assert_json_expr '.ok == true' "multi-layer batch push ok=true"

# Every row landed.
service_select "exercise_definitions" "owner_user_id=eq.${USER_A_UUID}&id=eq.${EXDEF_A_ID}&select=id"
assert_json_expr 'length == 1' "multi-layer: exercise_definition landed"
service_select "sessions" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SESSION_A_ID}&select=id"
assert_json_expr 'length == 1' "multi-layer: session landed"
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SX_A_ID}&select=id,exercise_definition_id"
assert_json_expr --arg exdef "${EXDEF_A_ID}" 'length == 1 and .[0].exercise_definition_id == $exdef' "multi-layer: session_exercise landed and resolved exdef FK"
service_select "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SET_A_ID}&select=id,weight_value,reps_value,set_type"
assert_json_expr 'length == 1 and .[0].weight_value == "100" and .[0].reps_value == "8" and .[0].set_type == "rir_2"' "multi-layer: exercise_set landed"

# ===========================================================================
# 3. LWW newer wins — push T=100, then T=200 with a different name.
# ===========================================================================

echo "[sync-push] LWW newer wins"
T100=$((BASE_MS + 200))
T200=$((BASE_MS + 300))
PAYLOAD="$(jq -nc --arg id "${GYM_LWW_ID}" --argjson cuam "${T100}" \
  --argjson ts "${T100}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "First Name", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "LWW first write"

PAYLOAD="$(jq -nc --arg id "${GYM_LWW_ID}" --argjson cuam "${T200}" \
  --argjson ts "${T200}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Second Name", latitude: 51.5, longitude: -0.12,
              coordinate_accuracy_m: 12.5, coordinates_updated_at: $ts,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "LWW second write (newer)"

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_LWW_ID}&select=name,latitude,client_updated_at_ms"
assert_json_expr --argjson cuam "${T200}" 'length == 1 and .[0].name == "Second Name" and .[0].latitude == 51.5 and .[0].client_updated_at_ms == $cuam' "LWW newer write overwrote every column"

# ===========================================================================
# 4. LWW older no-op — push T=200, then T=100 with different name; stored row
#    is unchanged but the ack still says ok:true.
# ===========================================================================

echo "[sync-push] LWW older no-op"
PAYLOAD="$(jq -nc --arg id "${GYM_OLDER_ID}" --argjson cuam "${T200}" \
  --argjson ts "${T200}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Newer First", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "LWW older-no-op: setup"

PAYLOAD="$(jq -nc --arg id "${GYM_OLDER_ID}" --argjson cuam "${T100}" \
  --argjson ts "${T100}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Older Loses", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "LWW older write returns ok:true"
assert_json_expr '.ok == true' "LWW older write ack"

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_OLDER_ID}&select=name,client_updated_at_ms"
assert_json_expr --argjson cuam "${T200}" 'length == 1 and .[0].name == "Newer First" and .[0].client_updated_at_ms == $cuam' "LWW older write left stored row unchanged"

# ===========================================================================
# 5. LWW retry idempotent — identical payload twice in quick succession.
# ===========================================================================

echo "[sync-push] LWW retry idempotent"
T_RETRY=$((BASE_MS + 400))
PAYLOAD="$(jq -nc --arg id "${GYM_RETRY_ID}" --argjson cuam "${T_RETRY}" \
  --argjson ts "${T_RETRY}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Retry Gym", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "retry: first push"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "retry: second push"
assert_json_expr '.ok == true' "retry: ok=true on retry"
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_RETRY_ID}&select=name,client_updated_at_ms"
assert_json_expr --argjson cuam "${T_RETRY}" 'length == 1 and .[0].name == "Retry Gym" and .[0].client_updated_at_ms == $cuam' "retry: stored row matches payload"

# ===========================================================================
# 6. Soft-delete via deleted_at.
# ===========================================================================

echo "[sync-push] soft-delete via deleted_at"
T_DEL_LIVE=$((BASE_MS + 500))
T_DEL_TOMBSTONE=$((BASE_MS + 600))

PAYLOAD="$(jq -nc --arg id "${GYM_DELETE_ID}" --argjson cuam "${T_DEL_LIVE}" \
  --argjson ts "${T_DEL_LIVE}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "About To Delete", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "soft-delete: create live row"

PAYLOAD="$(jq -nc --arg id "${GYM_DELETE_ID}" --argjson cuam "${T_DEL_TOMBSTONE}" \
  --argjson ts "${T_DEL_TOMBSTONE}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "About To Delete", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: $ts}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "soft-delete: write tombstone"

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_DELETE_ID}&select=deleted_at"
assert_json_expr --argjson ts "${T_DEL_TOMBSTONE}" 'length == 1 and .[0].deleted_at == $ts' "soft-delete: deleted_at stored non-null"

# ===========================================================================
# 7. Undelete via LWW (designs/t1.md §1.1.2 scenario B).
#    Tombstone at T=600 (already exists from #6); now push deleted_at=null at
#    T=700 with a newer client_updated_at_ms. deleted_at flips back to null.
# ===========================================================================

echo "[sync-push] undelete via LWW (scenario B)"
T_UNDELETE_TOMB=$((BASE_MS + 700))
T_UNDELETE=$((BASE_MS + 800))

PAYLOAD="$(jq -nc --arg id "${GYM_UNDELETE_ID}" --argjson cuam "${T_UNDELETE_TOMB}" \
  --argjson ts "${T_UNDELETE_TOMB}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Pre-Undelete", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: $ts}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "undelete: initial tombstone"

PAYLOAD="$(jq -nc --arg id "${GYM_UNDELETE_ID}" --argjson cuam "${T_UNDELETE}" \
  --argjson ts "${T_UNDELETE}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Resurrected", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "undelete: newer write with deleted_at=null"

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_UNDELETE_ID}&select=name,deleted_at"
assert_json_expr 'length == 1 and .[0].name == "Resurrected" and .[0].deleted_at == null' "undelete: deleted_at flipped back to null and name overwrote"

# ===========================================================================
# 8. Future-clock clamp — client claims now()+1day. Stored value must be
#    <= now()+5min (designs/t1.md §1).
# ===========================================================================

echo "[sync-push] future-clock clamp"
NOW_MS_BEFORE="$(($(date +%s) * 1000))"
DAY_MS=$((24 * 60 * 60 * 1000))
FIVE_MIN_MS=$((5 * 60 * 1000))
FUTURE_CUAM=$((NOW_MS_BEFORE + DAY_MS))

PAYLOAD="$(jq -nc --arg id "${GYM_CLAMP_ID}" --argjson cuam "${FUTURE_CUAM}" \
  --argjson ts "${FUTURE_CUAM}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Time Traveler", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "clamp: push future-stamped row"

NOW_MS_AFTER="$(($(date +%s) * 1000))"
MAX_ACCEPTABLE=$((NOW_MS_AFTER + FIVE_MIN_MS + 1000))

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_CLAMP_ID}&select=client_updated_at_ms"
assert_status "200" "clamp: service-role select"
assert_json_expr --argjson max "${MAX_ACCEPTABLE}" --argjson sent "${FUTURE_CUAM}" \
  '.[0].client_updated_at_ms <= $max and .[0].client_updated_at_ms < $sent' \
  "clamp: stored client_updated_at_ms clamped to <= now()+5min and strictly less than the sent value"

# ===========================================================================
# 9. FK closure: missing parent — push session_exercise pointing at a
#    session that is neither in the batch nor on the server. Must roll
#    back with FK_VIOLATION and zero rows landed.
# ===========================================================================

echo "[sync-push] FK closure: missing parent rolls back batch"
T_FK=$((BASE_MS + 900))
PAYLOAD="$(jq -nc --arg id "${MISSING_PARENT_ID}" --arg session "doesnotexist-${RUN_TAG}" \
  --argjson cuam "${T_FK}" --argjson ts "${T_FK}" \
  '{entities: [
    {type: "session_exercises", id: $id, client_updated_at_ms: $cuam,
     fields: {session_id: $session, exercise_definition_id: null,
              order_index: 0, name: "Orphan", machine_name: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_non_2xx "FK: orphan session_exercise rejected"
assert_body_contains "FK_VIOLATION" "FK: error envelope carries FK_VIOLATION token"

# Zero rows landed under the orphan id.
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${MISSING_PARENT_ID}&select=id"
assert_json_expr 'length == 0' "FK: orphan row absent from server"

# ===========================================================================
# 10. FK closure: parent in same batch, child-before-parent in array order.
#     Transaction commits because constraints are deferred to COMMIT.
# ===========================================================================

echo "[sync-push] FK closure: child-before-parent in array order commits"
T_FK_OK=$((BASE_MS + 1000))
PAYLOAD="$(jq -nc --arg session_id "${SESSION_FK_ID}" --arg sx_id "${SX_FK_ID}" \
  --argjson cuam "${T_FK_OK}" --argjson ts "${T_FK_OK}" \
  '{entities: [
    {type: "session_exercises", id: $sx_id, client_updated_at_ms: $cuam,
     fields: {session_id: $session_id, exercise_definition_id: null,
              order_index: 0, name: "Deferred FK", machine_name: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $session_id, client_updated_at_ms: $cuam,
     fields: {gym_id: null, status: "active", started_at: $ts,
              completed_at: null, duration_sec: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "deferred FK: child-before-parent commits"
assert_json_expr '.ok == true' "deferred FK ack"
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SX_FK_ID}&select=id,session_id"
assert_json_expr --arg sid "${SESSION_FK_ID}" 'length == 1 and .[0].session_id == $sid' "deferred FK: both rows landed"

# ===========================================================================
# 11. RLS cross-owner injection. The function derives owner_user_id from
#     auth.uid() and ignores any owner-shaped key the client might smuggle
#     into the envelope (there is no such key on the wire per t2 §2.1's
#     "no owner_user_id on the wire envelope"). The row lands under the
#     authenticated user. We assert two things:
#       (a) A push under user A's JWT lands the row under user A,
#       (b) User B can't see it via direct table SELECT.
# ===========================================================================

echo "[sync-push] RLS cross-owner: writes land under JWT owner regardless of body content"
T_CROSS=$((BASE_MS + 1100))
PAYLOAD="$(jq -nc --arg id "${GYM_CROSS_OWNER_ID}" --arg ownerB "${USER_B_UUID}" \
  --argjson cuam "${T_CROSS}" --argjson ts "${T_CROSS}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $cuam,
     fields: {name: "Cross-Owner Probe", owner_user_id: $ownerB,
              latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "cross-owner: pushing as A with body claiming B"
service_select "gyms" "id=eq.${GYM_CROSS_OWNER_ID}&select=owner_user_id"
assert_json_expr --arg ownerA "${USER_A_UUID}" 'length == 1 and .[0].owner_user_id == $ownerA' "cross-owner: row lands under JWT user (A), not body-claimed user"
user_select "gyms" "id=eq.${GYM_CROSS_OWNER_ID}&select=id" "${USER_B_TOKEN}"
assert_status "200" "cross-owner: user B select"
assert_json_expr 'length == 0' "cross-owner: user B does not see the row"

# ===========================================================================
# 12. Batch size bounds.
#     - empty array rejected (length 0 < 1)
#     - 201-row batch rejected
#     - 200-row batch accepted
# ===========================================================================

echo "[sync-push] batch size bounds"
sync_push "${USER_A_TOKEN}" '{"entities": []}'
assert_non_2xx "batch bounds: empty rejected"
assert_body_contains "INTERNAL" "batch bounds: empty body carries INTERNAL"
assert_body_contains "1..200" "batch bounds: empty body carries the 1..200 range token"

# Generate 201-row batch (gyms only; all under run-tagged ids).
LARGE_BODY="$(jq -nc \
  --arg run "${RUN_TAG}" \
  --argjson base "${BASE_MS}" \
  --argjson count 201 \
  '{entities: [
    range(0; $count) | {
      type: "gyms",
      id: ("push-batch-201-" + $run + "-" + (. | tostring)),
      client_updated_at_ms: ($base + .),
      fields: {
        name: ("Batch " + (. | tostring)),
        latitude: null, longitude: null,
        coordinate_accuracy_m: null, coordinates_updated_at: null,
        created_at: ($base + .),
        updated_at: ($base + .),
        deleted_at: null
      }
    }
  ]}')"
sync_push "${USER_A_TOKEN}" "${LARGE_BODY}"
assert_non_2xx "batch bounds: 201 rejected"
assert_body_contains "INTERNAL" "batch bounds: 201 body carries INTERNAL"
assert_body_contains "1..200" "batch bounds: 201 body carries the 1..200 range token"

# Confirm zero rows landed for the 201-batch ids (the whole txn rolled back
# before any row touched the table).
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=like.push-batch-201-${RUN_TAG}-*&select=id"
assert_json_expr 'length == 0' "batch bounds: 201 rejected zero rows landed"

# 200-row batch accepts.
OK_BODY="$(jq -nc \
  --arg run "${RUN_TAG}" \
  --argjson base "${BASE_MS}" \
  --argjson count 200 \
  '{entities: [
    range(0; $count) | {
      type: "gyms",
      id: ("push-batch-200-" + $run + "-" + (. | tostring)),
      client_updated_at_ms: ($base + .),
      fields: {
        name: ("Batch200 " + (. | tostring)),
        latitude: null, longitude: null,
        coordinate_accuracy_m: null, coordinates_updated_at: null,
        created_at: ($base + .),
        updated_at: ($base + .),
        deleted_at: null
      }
    }
  ]}')"
sync_push "${USER_A_TOKEN}" "${OK_BODY}"
assert_status "200" "batch bounds: 200 accepted"
assert_json_expr '.ok == true' "batch bounds: 200 ack ok=true"
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=like.push-batch-200-${RUN_TAG}-*&select=id"
assert_json_expr 'length == 200' "batch bounds: 200 rows landed"

# ===========================================================================
# 13. AUTH_REQUIRED — POST without a JWT.
# ===========================================================================

echo "[sync-push] AUTH_REQUIRED without JWT"
NO_JWT_BODY="$(jq -nc \
  --argjson cuam "${BASE_MS}" \
  --argjson ts "${BASE_MS}" \
  '{entities: [
    {type: "gyms", id: "noop", client_updated_at_ms: $cuam,
     fields: {name: "noop", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push_no_jwt "${NO_JWT_BODY}"
assert_non_2xx "auth: no JWT rejected"
assert_body_contains "AUTH_REQUIRED" "auth: no JWT body carries AUTH_REQUIRED"

# ===========================================================================
# Cleanup: remove the rows this run created. RLS-safe via service_role.
# ===========================================================================

echo "[sync-push] cleanup"
service_delete "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=like.push-set-%-${RUN_TAG}"
service_delete "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=like.push-sx-%-${RUN_TAG}"
service_delete "sessions" "owner_user_id=eq.${USER_A_UUID}&id=like.push-session-%-${RUN_TAG}"
service_delete "exercise_definitions" "owner_user_id=eq.${USER_A_UUID}&id=like.push-exdef-%-${RUN_TAG}"
service_delete "gyms" "owner_user_id=eq.${USER_A_UUID}&id=like.push-gym-%-${RUN_TAG}"
service_delete "gyms" "owner_user_id=eq.${USER_A_UUID}&id=like.push-batch-200-${RUN_TAG}-%"

echo "[sync-push] all assertions passed"
