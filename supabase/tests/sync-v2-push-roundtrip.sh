#!/usr/bin/env bash

# Integration test — sync_push end-to-end.
#
# Asserts the integration-level behaviour of POST /rest/v1/rpc/sync_push:
#
#   - A multi-row multi-layer batch is accepted in NON-TOPOLOGICAL array
#     order. Every row lands.
#   - LWW NEWER wins: a second push at strictly-greater client_updated_at_ms
#     overwrites every column on every row.
#   - LWW OLDER loses: a third push at strictly-lesser client_updated_at_ms
#     is a no-op (ack ok:true, stored row unchanged).
#   - Future-clock clamp: pushing an inflated client_updated_at_ms results
#     in the stored value being <= now()+5min and strictly less than the
#     sent value (server contract §A.1).
#   - FK closure failure: an orphan-child push (session_exercises whose
#     session_id is neither in the batch nor on the server) returns the
#     FK_VIOLATION error envelope and no rows from the batch land.
#
# This is integration-level on top of the per-feature push contract suite
# (sync-push-contract.sh) — it exercises the multi-layer ordering + LWW +
# clamp + FK-violation paths together against the as-built RPC.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

require_jq() {
  command -v jq >/dev/null 2>&1 || { echo "[sync-v2-push-roundtrip] jq required" >&2; exit 1; }
}

require_jq
load_supabase_status_env

[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] \
  || { echo "[sync-v2-push-roundtrip] missing API_URL/ANON_KEY/SERVICE_ROLE_KEY" >&2; exit 1; }

http_request() {
  local method="$1" url="$2" bearer="$3" body="${4:-}"
  local response_file
  response_file="$(mktemp)"
  local -a curl_args=(
    --silent --show-error
    -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -H "Authorization: Bearer ${bearer}"
    -H "Accept-Profile: app_public"
    -H "Content-Profile: app_public"
    -o "${response_file}"
    -w "%{http_code}"
  )
  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  REQUEST_STATUS="$(curl "${curl_args[@]}" "${url}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

assert_status() {
  local expected="$1" context="$2"
  if [[ "${REQUEST_STATUS}" != "${expected}" ]]; then
    echo "[fail] ${context}: expected ${expected}, got ${REQUEST_STATUS}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}
assert_non_2xx() {
  local context="$1"
  if [[ "${REQUEST_STATUS}" =~ ^2 ]]; then
    echo "[fail] ${context}: expected non-2xx, got ${REQUEST_STATUS}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}
assert_jq() {
  # Args: [<jq-arg> ...] <jq-expr> <context>
  # Last two args are the expression and the context message; everything
  # before them is forwarded verbatim to jq (so callers can pass --argjson /
  # --arg / etc.). Mirrors the assert_json_expr helper in
  # supabase/tests/sync-push-contract.sh.
  if [[ "$#" -lt 2 ]]; then
    echo "[fail] assert_jq needs at least <expr> <context>" >&2
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
    if ! printf '%s' "${REQUEST_BODY}" | jq -e "${jq_args[@]}" "${expr}" >/dev/null; then
      echo "[fail] ${context}: jq \`${expr}\` did not match" >&2
      echo "${REQUEST_BODY}" | jq . 2>/dev/null >&2 || echo "${REQUEST_BODY}" >&2
      exit 1
    fi
  else
    if ! printf '%s' "${REQUEST_BODY}" | jq -e "${expr}" >/dev/null; then
      echo "[fail] ${context}: jq \`${expr}\` did not match" >&2
      echo "${REQUEST_BODY}" | jq . 2>/dev/null >&2 || echo "${REQUEST_BODY}" >&2
      exit 1
    fi
  fi
}
assert_body_contains() {
  local needle="$1" context="$2"
  if ! printf '%s' "${REQUEST_BODY}" | grep -q "${needle}"; then
    echo "[fail] ${context}: expected body to contain '${needle}'" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

sign_in() {
  local email="$1" password="$2"
  # The Auth /token endpoint is not PostgREST so Accept-Profile is irrelevant
  # but harmless; this call goes through gotrue directly. Use a raw curl so we
  # don't pollute it with REST profile headers.
  local response_file
  response_file="$(mktemp)"
  local payload
  payload="$(jq -nc --arg e "${email}" --arg p "${password}" '{email: $e, password: $p}')"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${payload}" \
    "${API_URL}/auth/v1/token?grant_type=password")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
  assert_status "200" "sign_in ${email}"
  printf '%s' "${REQUEST_BODY}" | jq -r '.access_token'
}

load_fixture_uuid() {
  local key="$1"
  # dev_fixture_principals lives in `public`, not `app_public`, so we have to
  # bypass the http_request helper's Accept-Profile header for this one call.
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X GET \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -o "${response_file}" \
    -w "%{http_code}" \
    "${API_URL}/rest/v1/dev_fixture_principals?fixture_key=eq.${key}&select=subject_uuid")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
  assert_status "200" "fixture uuid ${key}"
  printf '%s' "${REQUEST_BODY}" | jq -r '.[0].subject_uuid'
}

sync_push() {
  http_request POST "${API_URL}/rest/v1/rpc/sync_push" "$1" "$2"
}

service_select() {
  http_request GET "${API_URL}/rest/v1/${1}?${2}" "${SERVICE_ROLE_KEY}"
}
service_delete() {
  http_request DELETE "${API_URL}/rest/v1/${1}?${2}" "${SERVICE_ROLE_KEY}"
}

echo "[sync-v2-push-roundtrip] signing in fixture users + loading uuids"
USER_A_TOKEN="$(sign_in "${USER_A_EMAIL}" "${USER_A_PASSWORD}")"
USER_A_UUID="$(load_fixture_uuid "${USER_A_FIXTURE_KEY}")"
[[ -n "${USER_A_TOKEN}" && -n "${USER_A_UUID}" ]]

RUN_TAG="${SYNC_PUSH_RT_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
BASE_MS="$(($(date +%s) * 1000))"

# Per-layer ID set. Non-topological ARRAY ORDER for the multi-layer batch:
# we list layer-3 first, layer-2, layer-1, layer-0 last so the deferrable-FK
# path is exercised inside one transaction (mirroring the push contract
# suite's deferrable-FK scenarios, but with all four topological layers and
# all nine types in one call rather than just the four-row chain).
GYM_ID="rt-${RUN_TAG}-gym"
EDEF_ID="rt-${RUN_TAG}-edef"
MG_ID="rt-${RUN_TAG}-mg"
ETD_ID="rt-${RUN_TAG}-etd"
SESS_ID="rt-${RUN_TAG}-sess"
EMM_ID="rt-${RUN_TAG}-emm"
SX_ID="rt-${RUN_TAG}-sx"
SET_ID="rt-${RUN_TAG}-set"
SXTAG_ID="rt-${RUN_TAG}-sxtag"
ORPHAN_SX_ID="rt-${RUN_TAG}-orphan-sx"
MISSING_PARENT_SESS_ID="rt-${RUN_TAG}-doesnotexist-sess"

cleanup_rows() {
  service_delete "session_exercise_tags"    "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "exercise_sets"            "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "session_exercises"        "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "exercise_muscle_mappings" "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "muscle_groups"            "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "exercise_tag_definitions" "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "sessions"                 "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "exercise_definitions"     "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
  service_delete "gyms"                     "owner_user_id=eq.${USER_A_UUID}&id=like.rt-${RUN_TAG}-%" >/dev/null
}
cleanup_rows
trap cleanup_rows EXIT

# ---------------------------------------------------------------------------
# Step 1 — multi-layer multi-row batch in NON-topological order. All four
# layers, all nine entity types in a single push.
# ---------------------------------------------------------------------------
echo "[sync-v2-push-roundtrip] step 1 — multi-layer batch in non-topological order"

T1=$((BASE_MS + 100))
BATCH_PAYLOAD="$(jq -nc \
  --arg gym "${GYM_ID}" --arg edef "${EDEF_ID}" --arg mg "${MG_ID}" --arg etd "${ETD_ID}" \
  --arg sess "${SESS_ID}" --arg emm "${EMM_ID}" --arg sx "${SX_ID}" \
  --arg set "${SET_ID}" --arg sxtag "${SXTAG_ID}" \
  --argjson ts "${T1}" \
  '{entities: [
    # Layer 3 first.
    {type: "exercise_sets", id: $set, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, order_index: 0,
              weight_value: "100", reps_value: "8", set_type: "rir_2",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercise_tags", id: $sxtag, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, exercise_tag_definition_id: $etd,
              created_at: $ts, deleted_at: null}},
    # Layer 2.
    {type: "session_exercises", id: $sx, client_updated_at_ms: $ts,
     fields: {session_id: $sess, exercise_definition_id: $edef,
              order_index: 0, name: "Bench Press", machine_name: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    # Layer 1.
    {type: "sessions", id: $sess, client_updated_at_ms: $ts,
     fields: {gym_id: $gym, status: "active", started_at: $ts,
              completed_at: null, duration_sec: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_muscle_mappings", id: $emm, client_updated_at_ms: $ts,
     fields: {exercise_definition_id: $edef, muscle_group_id: $mg,
              weight: 1.0, role: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_tag_definitions", id: $etd, client_updated_at_ms: $ts,
     fields: {exercise_definition_id: $edef, name: "Heavy", normalized_name: "heavy",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    # Layer 0.
    {type: "gyms", id: $gym, client_updated_at_ms: $ts,
     fields: {name: "Iron Temple", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_definitions", id: $edef, client_updated_at_ms: $ts,
     fields: {name: "Bench Press", created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "muscle_groups", id: $mg, client_updated_at_ms: $ts,
     fields: {display_name: "Pectorals", family_name: "chest",
              sort_order: 0, is_editable: 0,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"

sync_push "${USER_A_TOKEN}" "${BATCH_PAYLOAD}"
assert_status "200" "step 1 multi-layer batch"
assert_jq '.ok == true' "step 1 ack ok=true"
assert_jq '.server_received_at | test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")' "step 1 server_received_at iso8601"

# Each row is queryable via service-role SELECT.
for spec in "gyms|${GYM_ID}" "exercise_definitions|${EDEF_ID}" \
            "muscle_groups|${MG_ID}" \
            "exercise_tag_definitions|${ETD_ID}" "sessions|${SESS_ID}" \
            "exercise_muscle_mappings|${EMM_ID}" "session_exercises|${SX_ID}" \
            "exercise_sets|${SET_ID}" "session_exercise_tags|${SXTAG_ID}"; do
  IFS='|' read -r table row_id <<<"${spec}"
  service_select "${table}" "owner_user_id=eq.${USER_A_UUID}&id=eq.${row_id}&select=id"
  assert_jq 'length == 1' "step 1 service-role read ${table}.${row_id}"
done
echo "[sync-v2-push-roundtrip] step 1 ok — every row in every layer landed"

# ---------------------------------------------------------------------------
# Step 2 — LWW newer wins. Push the SAME batch but bump every column,
# including a fresh client_updated_at_ms strictly greater than T1.
# ---------------------------------------------------------------------------
echo "[sync-v2-push-roundtrip] step 2 — LWW newer wins"
T2=$((BASE_MS + 200))
NEWER_PAYLOAD="$(jq -nc \
  --arg gym "${GYM_ID}" --arg edef "${EDEF_ID}" --arg mg "${MG_ID}" --arg etd "${ETD_ID}" \
  --arg sess "${SESS_ID}" --arg emm "${EMM_ID}" --arg sx "${SX_ID}" \
  --arg set "${SET_ID}" --arg sxtag "${SXTAG_ID}" \
  --argjson ts "${T2}" \
  '{entities: [
    {type: "gyms", id: $gym, client_updated_at_ms: $ts,
     fields: {name: "Renamed Gym", latitude: 51.5, longitude: -0.12,
              coordinate_accuracy_m: 5.0, coordinates_updated_at: $ts,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_definitions", id: $edef, client_updated_at_ms: $ts,
     fields: {name: "Renamed Exercise", created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_tag_definitions", id: $etd, client_updated_at_ms: $ts,
     fields: {exercise_definition_id: $edef, name: "Renamed Tag",
              normalized_name: "renamed tag",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $sess, client_updated_at_ms: $ts,
     fields: {gym_id: $gym, status: "completed", started_at: $ts,
              completed_at: $ts, duration_sec: 3600,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_muscle_mappings", id: $emm, client_updated_at_ms: $ts,
     fields: {exercise_definition_id: $edef, muscle_group_id: $mg,
              weight: 2.0, role: "primary",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercises", id: $sx, client_updated_at_ms: $ts,
     fields: {session_id: $sess, exercise_definition_id: $edef,
              order_index: 1, name: "Renamed Exercise", machine_name: "Smith",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $set, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, order_index: 1,
              weight_value: "120", reps_value: "5", set_type: "rir_0",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercise_tags", id: $sxtag, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, exercise_tag_definition_id: $etd,
              created_at: $ts, deleted_at: null}}
  ]}')"

sync_push "${USER_A_TOKEN}" "${NEWER_PAYLOAD}"
assert_status "200" "step 2 newer-wins push"
assert_jq '.ok == true' "step 2 newer-wins ack"

# Probe: gyms.name flipped, sessions.status flipped, exercise_sets.weight_value flipped.
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_ID}&select=name,client_updated_at_ms"
assert_jq --argjson ts "${T2}" '.[0].name == "Renamed Gym" and .[0].client_updated_at_ms == $ts' "step 2 gyms LWW overwrote"
service_select "sessions" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SESS_ID}&select=status,duration_sec,client_updated_at_ms"
assert_jq --argjson ts "${T2}" '.[0].status == "completed" and .[0].duration_sec == 3600 and .[0].client_updated_at_ms == $ts' "step 2 sessions LWW overwrote"
service_select "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SET_ID}&select=weight_value,reps_value,set_type,client_updated_at_ms"
assert_jq --argjson ts "${T2}" '.[0].weight_value == "120" and .[0].reps_value == "5" and .[0].set_type == "rir_0" and .[0].client_updated_at_ms == $ts' "step 2 exercise_sets LWW overwrote"

# ---------------------------------------------------------------------------
# Step 3 — LWW older loses. Push the original T1 payload again. ack ok:true,
# but stored row stays at T2.
# ---------------------------------------------------------------------------
echo "[sync-v2-push-roundtrip] step 3 — LWW older loses (no-op)"
sync_push "${USER_A_TOKEN}" "${BATCH_PAYLOAD}"
assert_status "200" "step 3 older-loses push status"
assert_jq '.ok == true' "step 3 older-loses ack"

service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${GYM_ID}&select=name,client_updated_at_ms"
assert_jq --argjson ts "${T2}" '.[0].name == "Renamed Gym" and .[0].client_updated_at_ms == $ts' "step 3 LWW older: stored row unchanged"

# ---------------------------------------------------------------------------
# Step 4 — Future-clock clamp. Push a gyms row with client_updated_at_ms ~1 day
# ahead of now; stored value must be <= now()+5min and strictly less than
# the sent value.
# ---------------------------------------------------------------------------
echo "[sync-v2-push-roundtrip] step 4 — future-clock clamp"
NOW_MS_BEFORE="$(($(date +%s) * 1000))"
DAY_MS=$((24 * 60 * 60 * 1000))
FIVE_MIN_MS=$((5 * 60 * 1000))
FUTURE_CUAM=$((NOW_MS_BEFORE + DAY_MS))
CLAMP_ID="rt-${RUN_TAG}-clamp"
CLAMP_PAYLOAD="$(jq -nc --arg id "${CLAMP_ID}" --argjson ts "${FUTURE_CUAM}" \
  '{entities: [
    {type: "gyms", id: $id, client_updated_at_ms: $ts,
     fields: {name: "Time Traveler", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${CLAMP_PAYLOAD}"
assert_status "200" "step 4 clamp push"

NOW_MS_AFTER="$(($(date +%s) * 1000))"
MAX_ACCEPTABLE=$((NOW_MS_AFTER + FIVE_MIN_MS + 1000))
service_select "gyms" "owner_user_id=eq.${USER_A_UUID}&id=eq.${CLAMP_ID}&select=client_updated_at_ms"
assert_jq --argjson max "${MAX_ACCEPTABLE}" --argjson sent "${FUTURE_CUAM}" \
  '.[0].client_updated_at_ms <= $max and .[0].client_updated_at_ms < $sent' \
  "step 4 clamp: stored cuam clamped to <= now()+5min and strictly less than sent"

# ---------------------------------------------------------------------------
# Step 5 — Orphan child → FK_VIOLATION; zero rows from the rejected batch land.
# ---------------------------------------------------------------------------
echo "[sync-v2-push-roundtrip] step 5 — orphan child FK_VIOLATION"
T_FK=$((BASE_MS + 5000))
FK_PAYLOAD="$(jq -nc --arg id "${ORPHAN_SX_ID}" --arg sess "${MISSING_PARENT_SESS_ID}" \
  --argjson ts "${T_FK}" \
  '{entities: [
    {type: "session_exercises", id: $id, client_updated_at_ms: $ts,
     fields: {session_id: $sess, exercise_definition_id: null,
              order_index: 0, name: "Orphan", machine_name: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${FK_PAYLOAD}"
assert_non_2xx "step 5 orphan child rejected"
assert_body_contains "FK_VIOLATION" "step 5 FK_VIOLATION token in body"

# Confirm zero rows landed under the orphan id.
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${ORPHAN_SX_ID}&select=id"
assert_jq 'length == 0' "step 5 orphan row absent from server"

echo "[sync-v2-push-roundtrip] all assertions passed"
