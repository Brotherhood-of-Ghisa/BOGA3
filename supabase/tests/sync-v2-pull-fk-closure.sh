#!/usr/bin/env bash

# Integration test — layered drain preserves client-FK closure (load-bearing).
#
# Pushes a fully-connected dataset for user A (one row in every entity type,
# with the entire FK chain wired up), then drains layers 0→3 sequentially.
# For every row emitted by the layer-N response, asserts that every FK parent
# of that row has already appeared in a layer-M response with M ≤ N (or in
# the same layer-N response — though the FK graph (server contract §A.5) has no
# intra-layer references).
#
# Method: simulate a client SQLite by maintaining a `seen_ids` set keyed by
# (type, id) across layer responses. Every time we process a row, we read its
# FK columns out of `fields` and assert each FK target is already in
# `seen_ids` before adding the row's own (type, id) to the set.
#
# If any forward reference is found the test fails — that's exactly the FK
# violation a client inserting layer-by-layer would hit against its own
# SQLite.
#
# Also asserts the layer→type partition exactly matches the topological
# mapping in the server contract §B.4.4:
#   Layer 0: gyms, exercise_definitions, muscle_groups
#   Layer 1: sessions, exercise_muscle_mappings, exercise_tag_definitions
#   Layer 2: session_exercises
#   Layer 3: exercise_sets, session_exercise_tags

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

command -v jq >/dev/null 2>&1 || { echo "[sync-v2-pull-fk-closure] jq required" >&2; exit 1; }

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] \
  || { echo "[sync-v2-pull-fk-closure] missing API_URL/ANON_KEY/SERVICE_ROLE_KEY" >&2; exit 1; }

http_request() {
  # method url bearer [body] [profile-or-NONE]
  local method="$1" url="$2" bearer="$3" body="${4:-}" profile="${5:-app_public}"
  [[ "${profile}" == "NONE" ]] && profile=""
  local response_file
  response_file="$(mktemp)"
  local -a curl_args=(
    --silent --show-error
    -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -H "Authorization: Bearer ${bearer}"
    -o "${response_file}"
    -w "%{http_code}"
  )
  if [[ -n "${profile}" ]]; then
    curl_args+=(-H "Accept-Profile: ${profile}" -H "Content-Profile: ${profile}")
  fi
  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  REQUEST_STATUS="$(curl "${curl_args[@]}" "${url}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}
assert_status() {
  if [[ "${REQUEST_STATUS}" != "$1" ]]; then
    echo "[fail] $2: expected $1, got ${REQUEST_STATUS}" >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}
fail() { echo "[sync-v2-pull-fk-closure] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-pull-fk-closure] pass: $*"; }

sign_in() {
  local email="$1" password="$2"
  local response_file
  response_file="$(mktemp)"
  local payload
  payload="$(jq -nc --arg e "${email}" --arg p "${password}" '{email: $e, password: $p}')"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
    -o "${response_file}" -w "%{http_code}" \
    --data "${payload}" \
    "${API_URL}/auth/v1/token?grant_type=password")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
  assert_status "200" "sign_in ${email}"
  printf '%s' "${REQUEST_BODY}" | jq -r '.access_token'
}

load_fixture_uuid() {
  http_request GET \
    "${API_URL}/rest/v1/dev_fixture_principals?fixture_key=eq.$1&select=subject_uuid" \
    "${ANON_KEY}" "" "NONE"
  assert_status "200" "fixture uuid $1"
  printf '%s' "${REQUEST_BODY}" | jq -r '.[0].subject_uuid'
}

USER_A_TOKEN="$(sign_in "${USER_A_EMAIL}" "${USER_A_PASSWORD}")"
USER_A_UUID="$(load_fixture_uuid "${USER_A_FIXTURE_KEY}")"
[[ -n "${USER_A_TOKEN}" && -n "${USER_A_UUID}" ]]

RUN_TAG="${SYNC_FK_CLOSURE_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

cleanup_rows() {
  for table in session_exercise_tags exercise_sets session_exercises \
               exercise_muscle_mappings exercise_tag_definitions sessions \
               muscle_groups exercise_definitions gyms; do
    http_request DELETE \
      "${API_URL}/rest/v1/${table}?owner_user_id=eq.${USER_A_UUID}&id=like.fkc-${RUN_TAG}-%" \
      "${SERVICE_ROLE_KEY}" >/dev/null 2>&1 || true
  done
}
cleanup_rows
trap cleanup_rows EXIT

BASE_MS="$(($(date +%s) * 1000))"

# Per the FK graph (server contract §A.5). Used by the seen_ids check below to
# discover the parents of any row given its type and field set.
#
# Format: "<type>|<fk_field_name>|<parent_type>"
# Where:
#   <type>            - this entity type
#   <fk_field_name>   - the column in `fields` carrying the parent's id
#                       (NULLs are tolerated — e.g. sessions.gym_id is
#                       nullable, session_exercises.exercise_definition_id
#                       is nullable)
#   <parent_type>     - the entity type the FK targets
FK_EDGES=(
  "sessions|gym_id|gyms"
  "session_exercises|session_id|sessions"
  "session_exercises|exercise_definition_id|exercise_definitions"
  "exercise_sets|session_exercise_id|session_exercises"
  "exercise_muscle_mappings|exercise_definition_id|exercise_definitions"
  "exercise_muscle_mappings|muscle_group_id|muscle_groups"
  "exercise_tag_definitions|exercise_definition_id|exercise_definitions"
  "session_exercise_tags|session_exercise_id|session_exercises"
  "session_exercise_tags|exercise_tag_definition_id|exercise_tag_definitions"
)

# Per-layer expected type set per the server contract §B.4.4 partition.
# Sorted lex so we can compare against `jq | unique | sort`.
LAYER_TYPES_0='["exercise_definitions","gyms","muscle_groups"]'
LAYER_TYPES_1='["exercise_muscle_mappings","exercise_tag_definitions","sessions"]'
LAYER_TYPES_2='["session_exercises"]'
LAYER_TYPES_3='["exercise_sets","session_exercise_tags"]'

# ---------------------------------------------------------------------------
# Step 1 — push a fully-connected dataset (one of every entity type) wired
# through the FK chain.
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-fk-closure] step 1 — push fully-connected dataset"
GYM_ID="fkc-${RUN_TAG}-gym"
ED_ID="fkc-${RUN_TAG}-ed"
MG_ID="fkc-${RUN_TAG}-mg"
ETD_ID="fkc-${RUN_TAG}-etd"
SESS_ID="fkc-${RUN_TAG}-sess"
EMM_ID="fkc-${RUN_TAG}-emm"
SX_ID="fkc-${RUN_TAG}-sx"
SET_ID="fkc-${RUN_TAG}-set"
SXTAG_ID="fkc-${RUN_TAG}-sxtag"

PAYLOAD="$(jq -nc \
  --arg gym "${GYM_ID}" --arg ed "${ED_ID}" --arg mg "${MG_ID}" --arg etd "${ETD_ID}" \
  --arg sess "${SESS_ID}" --arg emm "${EMM_ID}" --arg sx "${SX_ID}" \
  --arg set "${SET_ID}" --arg sxtag "${SXTAG_ID}" \
  --argjson ts "${BASE_MS}" \
  '{entities: [
    {type: "gyms", id: $gym, client_updated_at_ms: ($ts + 1),
     fields: {name: "G", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_definitions", id: $ed, client_updated_at_ms: ($ts + 2),
     fields: {name: "ED", created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "muscle_groups", id: $mg, client_updated_at_ms: ($ts + 2),
     fields: {display_name: "Pectorals", family_name: "chest",
              sort_order: 0, is_editable: 0,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_tag_definitions", id: $etd, client_updated_at_ms: ($ts + 3),
     fields: {exercise_definition_id: $ed, name: "Tag", normalized_name: "tag",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $sess, client_updated_at_ms: ($ts + 4),
     fields: {gym_id: $gym, status: "active", started_at: $ts,
              completed_at: null, duration_sec: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_muscle_mappings", id: $emm, client_updated_at_ms: ($ts + 5),
     fields: {exercise_definition_id: $ed, muscle_group_id: $mg,
              weight: 1.0, role: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercises", id: $sx, client_updated_at_ms: ($ts + 6),
     fields: {session_id: $sess, exercise_definition_id: $ed,
              order_index: 0, name: "SX", machine_name: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $set, client_updated_at_ms: ($ts + 7),
     fields: {session_exercise_id: $sx, order_index: 0,
              weight_value: "100", reps_value: "8", set_type: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercise_tags", id: $sxtag, client_updated_at_ms: ($ts + 8),
     fields: {session_exercise_id: $sx, exercise_tag_definition_id: $etd,
              created_at: $ts, deleted_at: null}}
  ]}')"

http_request POST "${API_URL}/rest/v1/rpc/sync_push" "${USER_A_TOKEN}" "${PAYLOAD}"
assert_status "200" "fully-connected push"
printf '%s' "${REQUEST_BODY}" | jq -e '.ok == true' >/dev/null \
  || fail "fully-connected push did not return ok=true: ${REQUEST_BODY}"

# ---------------------------------------------------------------------------
# Step 2 — drain layers 0..3 in order. Verify the layer→type partition AND
# maintain `seen_ids` to assert FK closure.
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-fk-closure] step 2 — drain + assert partition + FK closure via seen_ids set"
SEEN_IDS='[]'  # JSON array of {type, id} pairs.

drain_layer_and_check() {
  local layer="$1" expected_types_sorted="$2"
  # Pull all rows for this layer (limit 200 covers everything in our 9-row seed).
  local body
  body="$(jq -nc --argjson layer "${layer}" '{layer: $layer, cursor: null, limit: 200}')"
  http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${body}"
  assert_status "200" "drain layer=${layer}"

  # Filter to our run-tagged rows.
  local OURS
  OURS="$(printf '%s' "${REQUEST_BODY}" | jq --arg run "${RUN_TAG}" \
    '[.entities[] | select(.id | startswith("fkc-" + $run + "-"))]')"
  local COUNT
  COUNT="$(printf '%s' "${OURS}" | jq 'length')"
  echo "[sync-v2-pull-fk-closure] layer ${layer}: ${COUNT} of-our rows"

  # Partition assertion — our rows in this layer cover exactly the expected
  # type-set.
  local actual_types
  actual_types="$(printf '%s' "${OURS}" | jq -c '[.[].type] | unique | sort')"
  if [[ "${actual_types}" != "${expected_types_sorted}" ]]; then
    fail "layer ${layer}: expected types ${expected_types_sorted}, got ${actual_types}"
  fi

  # FK closure check.
  # For each row in OURS we read its FK columns from `fields`, look up the
  # `(parent_type, parent_id)` pair in SEEN_IDS, and fail if absent.
  # After all rows in this layer pass, we add them ALL to SEEN_IDS — only
  # then, because in the FK graph (server contract §A.5) there are NO
  # intra-layer FKs, so a layer-N row cannot legitimately reference a sibling
  # in the same layer.
  # If that invariant ever breaks (intra-layer FK introduced) this check
  # surfaces it as a forward-reference violation.

  local row_count
  row_count="$(printf '%s' "${OURS}" | jq 'length')"
  local i=0
  while (( i < row_count )); do
    local row
    row="$(printf '%s' "${OURS}" | jq -c ".[${i}]")"
    local row_type row_id row_fields
    row_type="$(printf '%s' "${row}" | jq -r '.type')"
    row_id="$(printf '%s' "${row}" | jq -r '.id')"
    row_fields="$(printf '%s' "${row}" | jq -c '.fields')"

    # Walk every FK edge whose <child type> matches this row's type.
    for edge in "${FK_EDGES[@]}"; do
      IFS='|' read -r child_type fk_col parent_type <<<"${edge}"
      if [[ "${child_type}" != "${row_type}" ]]; then
        continue
      fi
      local parent_id
      parent_id="$(printf '%s' "${row_fields}" | jq -r --arg col "${fk_col}" '.[$col] // null')"
      if [[ "${parent_id}" == "null" || -z "${parent_id}" ]]; then
        # Nullable FK is fine — sessions.gym_id, session_exercises.exercise_definition_id
        # both can be null per the entity schema (server contract §A.2).
        continue
      fi
      # Is (parent_type, parent_id) in SEEN_IDS?
      local hit
      hit="$(jq -nr \
        --argjson seen "${SEEN_IDS}" \
        --arg pt "${parent_type}" \
        --arg pid "${parent_id}" \
        '[$seen[] | select(.type == $pt and .id == $pid)] | length')"
      if [[ "${hit}" == "0" ]]; then
        echo "[fail] FK closure violated at layer ${layer}: ${row_type}/${row_id}.${fk_col} = ${parent_type}/${parent_id} is not in seen_ids (would FK-fail on client insert)" >&2
        echo "SEEN_IDS at failure:" >&2
        printf '%s' "${SEEN_IDS}" | jq . >&2
        exit 1
      fi
    done
    i=$(( i + 1 ))
  done

  # All FK closure checks pass — promote this layer's rows into SEEN_IDS for
  # the next layer.
  SEEN_IDS="$(jq -nc --argjson seen "${SEEN_IDS}" --argjson ours "${OURS}" \
    '$seen + ($ours | map({type, id}))')"
}

drain_layer_and_check 0 "${LAYER_TYPES_0}"
drain_layer_and_check 1 "${LAYER_TYPES_1}"
drain_layer_and_check 2 "${LAYER_TYPES_2}"
drain_layer_and_check 3 "${LAYER_TYPES_3}"

# Final sanity: SEEN_IDS holds all nine of our seed rows.
TOTAL_SEEN="$(printf '%s' "${SEEN_IDS}" | jq 'length')"
if [[ "${TOTAL_SEEN}" != "9" ]]; then
  fail "after draining all four layers SEEN_IDS holds ${TOTAL_SEEN} rows, expected 9 (one per entity type)"
fi

pass "FK closure — fully-connected dataset drained layer-by-layer with zero forward FK references"
pass "FK closure — nine entity types partition exactly across the four layers"

# ---------------------------------------------------------------------------
# Step 3 — pull every layer one more time as a sanity check that the
# partition assertion holds against ALL rows for user A (not only our
# run-tagged subset). I.e. for any layer L the response, restricted to types
# in the §B.4.4 set for L, must equal exactly that set or a subset (other
# tests may not have seeded every type but the response cannot include types
# from a different layer).
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-fk-closure] step 3 — partition assertion on the full layer response (no filter)"
ALL_LAYER_TYPES=( "${LAYER_TYPES_0}" "${LAYER_TYPES_1}" "${LAYER_TYPES_2}" "${LAYER_TYPES_3}" )
for layer in 0 1 2 3; do
  body="$(jq -nc --argjson layer "${layer}" '{layer: $layer, cursor: null, limit: 200}')"
  http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${body}"
  assert_status "200" "partition layer=${layer}"
  ACTUAL_TYPES="$(printf '%s' "${REQUEST_BODY}" | jq -c '[.entities[].type] | unique | sort')"
  ALLOWED="${ALL_LAYER_TYPES[${layer}]}"
  # ACTUAL_TYPES must be a subset of ALLOWED (it may be empty if no rows live
  # for this user-layer combination, but it must NEVER contain a type that
  # doesn't belong to this layer).
  SUBSET="$(jq -nr --argjson a "${ACTUAL_TYPES}" --argjson b "${ALLOWED}" \
    '($a - $b) | length')"
  if [[ "${SUBSET}" != "0" ]]; then
    fail "partition violation layer ${layer}: response carries types not in ${ALLOWED} — actual=${ACTUAL_TYPES}"
  fi
done
pass "FK closure — every layer's full response is a subset of its declared type set (no cross-layer leakage)"

echo "[sync-v2-pull-fk-closure] all assertions passed"
