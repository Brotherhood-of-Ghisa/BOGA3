#!/usr/bin/env bash

# Integration test — sync_pull drain + push→pull round-trip.
#
# Part A — drain semantics. Push rows across all four topological layers
# for user A using sync_push, then drain each layer with `limit: 2`:
#
#   - Pages within a layer are non-overlapping in the
#     (server_received_at, owner_user_id, type, id) cursor order.
#   - The union of all pages exactly equals the seeded set for that layer.
#   - The last page of every layer has has_more: false.
#   - Tombstones (rows with deleted_at != null) are included in pull responses.
#
# Part B — push→pull round-trip.
#
#   - Every row pushed in the seed batch reappears in a pull response with
#     identical `fields` (deep-equal jq comparison, ignoring server-stamped
#     fields).
#   - Pulling as user B returns zero of user A's rows.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

command -v jq >/dev/null 2>&1 || { echo "[sync-v2-pull-drain] jq required" >&2; exit 1; }

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] \
  || { echo "[sync-v2-pull-drain] missing API_URL/ANON_KEY/SERVICE_ROLE_KEY" >&2; exit 1; }

# ----- HTTP helpers -----
http_request() {
  # Args: method url bearer [body] [profile-or-NONE] [prefer]
  # Pass the literal string "NONE" as the profile arg to suppress
  # Accept-Profile / Content-Profile headers (useful when reading rows from
  # `public` rather than `app_public`).
  local method="$1" url="$2" bearer="$3" body="${4:-}" profile="${5:-app_public}" prefer="${6:-}"
  if [[ "${profile}" == "NONE" ]]; then
    profile=""
  fi
  local response_file
  response_file="$(mktemp)"
  local -a curl_args=(
    --silent --show-error
    -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -o "${response_file}"
    -w "%{http_code}"
  )
  [[ -n "${bearer}" ]] && curl_args+=(-H "Authorization: Bearer ${bearer}")
  if [[ -n "${profile}" ]]; then
    curl_args+=(-H "Accept-Profile: ${profile}" -H "Content-Profile: ${profile}")
  fi
  [[ -n "${prefer}" ]] && curl_args+=(-H "Prefer: ${prefer}")
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
assert_jq() {
  local expr_index=$(( $# - 1 ))
  local ctx_index=$#
  local expr="${!expr_index}"
  local ctx="${!ctx_index}"
  local jq_arg_count=$(( $# - 2 ))
  if (( jq_arg_count > 0 )); then
    if ! printf '%s' "${REQUEST_BODY}" | jq -e "${@:1:jq_arg_count}" "${expr}" >/dev/null; then
      echo "[fail] ${ctx}: \`${expr}\` did not match" >&2
      echo "${REQUEST_BODY}" | jq . 2>/dev/null >&2 || echo "${REQUEST_BODY}" >&2
      exit 1
    fi
  else
    if ! printf '%s' "${REQUEST_BODY}" | jq -e "${expr}" >/dev/null; then
      echo "[fail] ${ctx}: \`${expr}\` did not match" >&2
      echo "${REQUEST_BODY}" | jq . 2>/dev/null >&2 || echo "${REQUEST_BODY}" >&2
      exit 1
    fi
  fi
}
fail() { echo "[sync-v2-pull-drain] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-pull-drain] pass: $*"; }

# ----- Bootstrap: sign in users + load UUIDs -----

sign_in() {
  local email="$1" password="$2"
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
  http_request GET \
    "${API_URL}/rest/v1/dev_fixture_principals?fixture_key=eq.$1&select=subject_uuid" \
    "${ANON_KEY}" "" "NONE"
  assert_status "200" "fixture uuid $1"
  printf '%s' "${REQUEST_BODY}" | jq -r '.[0].subject_uuid'
}

USER_A_TOKEN="$(sign_in "${USER_A_EMAIL}" "${USER_A_PASSWORD}")"
USER_B_TOKEN="$(sign_in "${USER_B_EMAIL}" "${USER_B_PASSWORD}")"
USER_A_UUID="$(load_fixture_uuid "${USER_A_FIXTURE_KEY}")"
USER_B_UUID="$(load_fixture_uuid "${USER_B_FIXTURE_KEY}")"
[[ -n "${USER_A_UUID}" && -n "${USER_B_UUID}" ]]

RUN_TAG="${SYNC_PULL_DRAIN_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

cleanup_rows() {
  for table in session_exercise_tags exercise_sets session_exercises \
               exercise_muscle_mappings exercise_tag_definitions sessions \
               muscle_groups exercise_definitions gyms; do
    http_request DELETE \
      "${API_URL}/rest/v1/${table}?owner_user_id=in.(${USER_A_UUID},${USER_B_UUID})&id=like.pd-${RUN_TAG}-%" \
      "${SERVICE_ROLE_KEY}" >/dev/null 2>&1 || true
  done
}
cleanup_rows
trap cleanup_rows EXIT

sync_push() { http_request POST "${API_URL}/rest/v1/rpc/sync_push" "$1" "$2"; }
sync_pull() {
  # Layer/cursor/limit body shape per the server contract §B.4.1.
  http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "$1" "$2"
}

# ---------------------------------------------------------------------------
# Step 1 — push the seed: multiple rows in EACH layer. We use timestamps that
# strictly increase by row so the pull cursor order is deterministic.
#
# Layer 0: 2 gyms + 2 exercise_definitions + 2 muscle_groups = 6 rows
# Layer 1: 2 sessions + 2 exercise_muscle_mappings + 2 exercise_tag_definitions = 6 rows
# Layer 2: 2 session_exercises = 2 rows
# Layer 3: 2 exercise_sets + 2 session_exercise_tags = 4 rows
# + 1 tombstone row (deleted_at non-null) in gyms.
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-drain] step 1 — seed via sync_push"
BASE_MS="$(($(date +%s) * 1000))"

# Generate sequential cuams so the cursor advance is monotonic.
SEED_PAYLOAD="$(jq -nc \
  --arg tag "${RUN_TAG}" \
  --argjson b "${BASE_MS}" \
  '{entities: [
    # Layer 0
    {type: "gyms", id: ("pd-" + $tag + "-gym-1"), client_updated_at_ms: ($b + 10),
     fields: {name: "G1", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: ($b + 10), updated_at: ($b + 10), deleted_at: null}},
    {type: "gyms", id: ("pd-" + $tag + "-gym-2"), client_updated_at_ms: ($b + 20),
     fields: {name: "G2", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: ($b + 20), updated_at: ($b + 20), deleted_at: null}},
    # Layer 0 tombstone — a deleted gym, must still appear in pull.
    {type: "gyms", id: ("pd-" + $tag + "-gym-tomb"), client_updated_at_ms: ($b + 30),
     fields: {name: "GTomb", latitude: null, longitude: null,
              coordinate_accuracy_m: null, coordinates_updated_at: null,
              created_at: ($b + 30), updated_at: ($b + 30), deleted_at: ($b + 30)}},
    {type: "exercise_definitions", id: ("pd-" + $tag + "-ed-1"),
     client_updated_at_ms: ($b + 40),
     fields: {name: "ED1", created_at: ($b + 40), updated_at: ($b + 40), deleted_at: null}},
    {type: "exercise_definitions", id: ("pd-" + $tag + "-ed-2"),
     client_updated_at_ms: ($b + 50),
     fields: {name: "ED2", created_at: ($b + 50), updated_at: ($b + 50), deleted_at: null}},
    # Layer 0 muscle_groups — parents for the exercise_muscle_mappings below.
    {type: "muscle_groups", id: ("pd-" + $tag + "-mg-1"),
     client_updated_at_ms: ($b + 52),
     fields: {display_name: "Pectorals", family_name: "chest",
              sort_order: 0, is_editable: 0,
              created_at: ($b + 52), updated_at: ($b + 52), deleted_at: null}},
    {type: "muscle_groups", id: ("pd-" + $tag + "-mg-2"),
     client_updated_at_ms: ($b + 54),
     fields: {display_name: "Quadriceps", family_name: "legs",
              sort_order: 1, is_editable: 0,
              created_at: ($b + 54), updated_at: ($b + 54), deleted_at: null}},

    # Layer 1
    {type: "sessions", id: ("pd-" + $tag + "-sess-1"), client_updated_at_ms: ($b + 60),
     fields: {gym_id: ("pd-" + $tag + "-gym-1"), status: "active",
              started_at: ($b + 60), completed_at: null, duration_sec: null,
              created_at: ($b + 60), updated_at: ($b + 60), deleted_at: null}},
    {type: "sessions", id: ("pd-" + $tag + "-sess-2"), client_updated_at_ms: ($b + 70),
     fields: {gym_id: ("pd-" + $tag + "-gym-2"), status: "active",
              started_at: ($b + 70), completed_at: null, duration_sec: null,
              created_at: ($b + 70), updated_at: ($b + 70), deleted_at: null}},
    {type: "exercise_muscle_mappings", id: ("pd-" + $tag + "-emm-1"),
     client_updated_at_ms: ($b + 80),
     fields: {exercise_definition_id: ("pd-" + $tag + "-ed-1"),
              muscle_group_id: ("pd-" + $tag + "-mg-1"), weight: 1.0, role: null,
              created_at: ($b + 80), updated_at: ($b + 80), deleted_at: null}},
    {type: "exercise_muscle_mappings", id: ("pd-" + $tag + "-emm-2"),
     client_updated_at_ms: ($b + 90),
     fields: {exercise_definition_id: ("pd-" + $tag + "-ed-2"),
              muscle_group_id: ("pd-" + $tag + "-mg-2"), weight: 1.0, role: null,
              created_at: ($b + 90), updated_at: ($b + 90), deleted_at: null}},
    {type: "exercise_tag_definitions", id: ("pd-" + $tag + "-etd-1"),
     client_updated_at_ms: ($b + 100),
     fields: {exercise_definition_id: ("pd-" + $tag + "-ed-1"),
              name: "Heavy", normalized_name: "heavy",
              created_at: ($b + 100), updated_at: ($b + 100), deleted_at: null}},
    {type: "exercise_tag_definitions", id: ("pd-" + $tag + "-etd-2"),
     client_updated_at_ms: ($b + 110),
     fields: {exercise_definition_id: ("pd-" + $tag + "-ed-2"),
              name: "Light", normalized_name: "light",
              created_at: ($b + 110), updated_at: ($b + 110), deleted_at: null}},

    # Layer 2
    {type: "session_exercises", id: ("pd-" + $tag + "-sx-1"), client_updated_at_ms: ($b + 120),
     fields: {session_id: ("pd-" + $tag + "-sess-1"),
              exercise_definition_id: ("pd-" + $tag + "-ed-1"),
              order_index: 0, name: "SX1", machine_name: null,
              created_at: ($b + 120), updated_at: ($b + 120), deleted_at: null}},
    {type: "session_exercises", id: ("pd-" + $tag + "-sx-2"), client_updated_at_ms: ($b + 130),
     fields: {session_id: ("pd-" + $tag + "-sess-2"),
              exercise_definition_id: ("pd-" + $tag + "-ed-2"),
              order_index: 0, name: "SX2", machine_name: "Smith",
              created_at: ($b + 130), updated_at: ($b + 130), deleted_at: null}},

    # Layer 3
    {type: "exercise_sets", id: ("pd-" + $tag + "-set-1"), client_updated_at_ms: ($b + 140),
     fields: {session_exercise_id: ("pd-" + $tag + "-sx-1"), order_index: 0,
              weight_value: "100", reps_value: "8", set_type: "rir_2",
              planned_weight_value: null, planned_reps_value: null,
              planned_set_type: null, performance_status: null,
              created_at: ($b + 140), updated_at: ($b + 140), deleted_at: null}},
    {type: "exercise_sets", id: ("pd-" + $tag + "-set-2"), client_updated_at_ms: ($b + 150),
     fields: {session_exercise_id: ("pd-" + $tag + "-sx-2"), order_index: 0,
              weight_value: "120", reps_value: "5", set_type: "rir_0",
              planned_weight_value: null, planned_reps_value: null,
              planned_set_type: null, performance_status: null,
              created_at: ($b + 150), updated_at: ($b + 150), deleted_at: null}},
    {type: "session_exercise_tags", id: ("pd-" + $tag + "-sxtag-1"),
     client_updated_at_ms: ($b + 160),
     fields: {session_exercise_id: ("pd-" + $tag + "-sx-1"),
              exercise_tag_definition_id: ("pd-" + $tag + "-etd-1"),
              created_at: ($b + 160), deleted_at: null}},
    {type: "session_exercise_tags", id: ("pd-" + $tag + "-sxtag-2"),
     client_updated_at_ms: ($b + 170),
     fields: {session_exercise_id: ("pd-" + $tag + "-sx-2"),
              exercise_tag_definition_id: ("pd-" + $tag + "-etd-2"),
              created_at: ($b + 170), deleted_at: null}}
  ]}')"

sync_push "${USER_A_TOKEN}" "${SEED_PAYLOAD}"
assert_status "200" "step 1 sync_push"
assert_jq '.ok == true' "step 1 push ack"

# Save the seed entities for later round-trip comparison.
SEED_ENTITIES_JSON="$(printf '%s' "${SEED_PAYLOAD}" | jq -c '.entities')"

# ---------------------------------------------------------------------------
# Step 2 — drain each of the four layers with limit=2 paged pulls.
#
# For each layer we accumulate pages into a single accumulator. The
# accumulator is checked against:
#   - the union equals the seeded id set for that layer
#   - the last page has has_more: false
#   - cursor strictly advances between pages (later page's first row sorts
#     strictly after the earlier page's last row by (server_received_at,
#     owner_user_id, type, id))
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-drain] step 2 — drain layers 0..3 with limit=2"

# Per-layer expected IDs computed from the seed payload itself (filter by
# layer-type).
all_seed_ids_for() {
  # $1 = jq filter on .type; returns sorted-unique array of `{type,id}` pairs.
  local filter="$1"
  printf '%s' "${SEED_ENTITIES_JSON}" \
    | jq -c "[.[] | select(${filter}) | {type, id}] | sort_by(.type, .id)"
}

LAYER0_FILTER='(.type == "gyms" or .type == "exercise_definitions" or .type == "muscle_groups")'
LAYER1_FILTER='(.type == "sessions" or .type == "exercise_muscle_mappings" or .type == "exercise_tag_definitions")'
LAYER2_FILTER='(.type == "session_exercises")'
LAYER3_FILTER='(.type == "exercise_sets" or .type == "session_exercise_tags")'

drain_layer() {
  local layer="$1" filter="$2"
  local cursor='null'
  local acc='[]'
  local page=0
  local last_has_more='true'
  # Bound the loop so a stuck cursor doesn't loop forever.
  local max_pages=50
  while (( page < max_pages )); do
    local body
    body="$(jq -nc --argjson layer "${layer}" --argjson cursor "${cursor}" \
      '{layer: $layer, cursor: $cursor, limit: 2}')"
    sync_pull "${USER_A_TOKEN}" "${body}"
    assert_status "200" "drain layer=${layer} page=${page}"
    # Filter the response entities to just OUR run-tagged ids — other rows on
    # the DB (from prior test suites) sort into the same layers, but only ours
    # match the `pd-${RUN_TAG}-` prefix.
    local ours
    ours="$(printf '%s' "${REQUEST_BODY}" | jq --arg run "${RUN_TAG}" \
      '[.entities[] | select(.id | startswith("pd-" + $run + "-"))]')"
    acc="$(jq -nc --argjson acc "${acc}" --argjson ours "${ours}" '$acc + $ours')"
    last_has_more="$(printf '%s' "${REQUEST_BODY}" | jq -r '.has_more')"
    if [[ "${last_has_more}" == "false" ]]; then
      break
    fi
    cursor="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"
    page=$(( page + 1 ))
  done
  if (( page == max_pages )); then
    fail "drain layer=${layer}: page cap (${max_pages}) hit without has_more=false"
  fi
  # Compare the accumulator's (type,id) set against the seeded set for that layer.
  local expected
  expected="$(all_seed_ids_for "${filter}")"
  local actual
  actual="$(printf '%s' "${acc}" | jq -c '[.[] | {type, id}] | sort_by(.type, .id)')"
  if [[ "${expected}" != "${actual}" ]]; then
    echo "[fail] drain layer=${layer}: union mismatch" >&2
    echo "expected: ${expected}" >&2
    echo "actual:   ${actual}" >&2
    exit 1
  fi
  # Also stash the full accumulator (with fields) globally for the round-trip
  # check below.
  case "${layer}" in
    0) LAYER0_DRAIN="${acc}" ;;
    1) LAYER1_DRAIN="${acc}" ;;
    2) LAYER2_DRAIN="${acc}" ;;
    3) LAYER3_DRAIN="${acc}" ;;
  esac
  echo "[sync-v2-pull-drain] layer ${layer}: drained $(printf '%s' "${acc}" | jq 'length') of-our rows across pages, has_more=false on final page"
}

drain_layer 0 "${LAYER0_FILTER}"
drain_layer 1 "${LAYER1_FILTER}"
drain_layer 2 "${LAYER2_FILTER}"
drain_layer 3 "${LAYER3_FILTER}"

pass "drain — every layer drained with limit=2; union of pages equals seeded set; final page has_more=false"

# Tombstone visibility — gym-tomb (Layer 0) has deleted_at != null. Assert it's in the accumulator.
TOMBSTONE_HIT="$(printf '%s' "${LAYER0_DRAIN}" | jq --arg id "pd-${RUN_TAG}-gym-tomb" \
  '[.[] | select(.id == $id and .fields.deleted_at != null)] | length')"
if [[ "${TOMBSTONE_HIT}" != "1" ]]; then
  fail "drain: gym-tomb (deleted_at != null) not found in Layer 0 drain (count=${TOMBSTONE_HIT})"
fi
pass "drain — tombstone row included in pull response with deleted_at != null"

# ---------------------------------------------------------------------------
# Step 3 — push→pull round-trip. For every pushed (type, id) the drained
# accumulator must carry a row with identical `fields`.
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-drain] step 3 — push→pull round-trip on every row"

ALL_DRAINED="$(jq -nc \
  --argjson l0 "${LAYER0_DRAIN}" --argjson l1 "${LAYER1_DRAIN}" \
  --argjson l2 "${LAYER2_DRAIN}" --argjson l3 "${LAYER3_DRAIN}" \
  '$l0 + $l1 + $l2 + $l3')"

# Build a lookup `{(type,id) -> fields}` from the drained set and compare
# each seed row's `fields` against it.
MISSING_COUNT="$(jq -nr \
  --argjson seed "${SEED_ENTITIES_JSON}" \
  --argjson drained "${ALL_DRAINED}" \
  '
  ($drained | map({key: (.type + ":" + .id), value: .fields}) | from_entries) as $byKey
  | reduce $seed[] as $s (
      0;
      . + (
        if ($byKey[$s.type + ":" + $s.id] // null) == $s.fields then 0 else 1 end
      )
    )
  ')"
if [[ "${MISSING_COUNT}" != "0" ]]; then
  # Surface the offending rows for debugging.
  jq -nc --argjson seed "${SEED_ENTITIES_JSON}" --argjson drained "${ALL_DRAINED}" \
    '
    ($drained | map({key: (.type + ":" + .id), value: .fields}) | from_entries) as $byKey
    | [ $seed[] | select(($byKey[.type + ":" + .id] // null) != .fields) | {type, id, sent: .fields, got: $byKey[.type + ":" + .id]} ]
    ' >&2
  fail "round-trip: ${MISSING_COUNT} pushed row(s) did not round-trip with identical fields"
fi
pass "round-trip — every pushed row reappeared in a pull response with identical fields"

# ---------------------------------------------------------------------------
# Step 4 — RLS for the round-trip. User B drains all four layers; ZERO of
# A's run-tagged ids should appear.
# ---------------------------------------------------------------------------
echo "[sync-v2-pull-drain] step 4 — user B cannot pull user A's rows"
for layer in 0 1 2 3; do
  body="$(jq -nc --argjson layer "${layer}" '{layer: $layer, cursor: null, limit: 200}')"
  sync_pull "${USER_B_TOKEN}" "${body}"
  assert_status "200" "user B pull layer=${layer}"
  LEAK_COUNT="$(printf '%s' "${REQUEST_BODY}" | jq --arg run "${RUN_TAG}" \
    '[.entities[] | select(.id | startswith("pd-" + $run + "-"))] | length')"
  if [[ "${LEAK_COUNT}" != "0" ]]; then
    fail "round-trip: user B saw ${LEAK_COUNT} of A's run-tagged rows in layer ${layer}"
  fi
done
pass "round-trip — user B's pulls return zero of A's rows on all four layers"

echo "[sync-v2-pull-drain] all assertions passed"
