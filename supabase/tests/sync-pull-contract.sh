#!/usr/bin/env bash

# Sync v2 — sync_pull RPC contract tests.
#
# Asserts the wire contract of POST /rest/v1/rpc/sync_pull per
# docs/specs/tech/sync-v2-server-contract.md §B.4.
#
# Scenarios covered:
#   1. Snapshot pull (cursor=null)
#   2. Paginated drain (limit=2 over 5 rows)
#   3. Layer→type mapping integrity (all four layers, all eight entities;
#      asserts the §B.4.4 partition: pairwise disjoint, union = all 8)
#   4. RLS isolation (user_a vs user_b)
#   5. Tombstones included (rows with deleted_at != null appear in the pull)
#   6. Empty page after drain (next_cursor echoes the input cursor)
#   7. Same-millisecond tiebreak (two rows in one tx, same server_received_at;
#      paged by (type, id) lex order)
#   8. Limit bounds: 0 rejected, 201 rejected, 200 accepted
#   9. Layer bounds: -1 rejected, 4 rejected, 0..3 each accepted
#  10. AUTH_REQUIRED (no JWT)
#
# Run via `./boga test sync-pull-contract` (run-suite.sh ensures the shared
# baseline is up + migrations applied before invoking this script).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "[sync-pull-contract] jq is required" >&2
    exit 1
  fi
}

PSQL_MODE="host"
DOCKER_DB_CONTAINER=""

select_psql_mode() {
  if command -v psql >/dev/null 2>&1; then
    PSQL_MODE="host"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    # Resolve strictly by this worktree's project_id (resolve_db_container errors
    # if this worktree's stack is not up — never a foreign DB).
    DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
    PSQL_MODE="docker"
    return 0
  fi
  echo "[sync-pull-contract] need either host psql or supabase_db_* container" >&2
  exit 1
}

run_psql() {
  case "${PSQL_MODE}" in
    host)
      PGPASSWORD="${PGPASSWORD:-postgres}" \
        psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -c "$1"
      ;;
    docker)
      docker exec -e PGPASSWORD=postgres "${DOCKER_DB_CONTAINER}" \
        psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -c "$1"
      ;;
  esac
}

# Multi-statement SQL goes via stdin (psql -f -) since `-c` is single-statement.
run_psql_sql() {
  case "${PSQL_MODE}" in
    host)
      PGPASSWORD="${PGPASSWORD:-postgres}" \
        psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1"
      ;;
    docker)
      docker exec -e PGPASSWORD=postgres -i "${DOCKER_DB_CONTAINER}" \
        psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1"
      ;;
  esac
}

fail() {
  echo "[sync-pull-contract] FAIL: $*" >&2
  exit 1
}
pass() {
  echo "[sync-pull-contract] pass: $*"
}

require_jq
select_psql_mode
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "[sync-pull-contract] missing API_URL/ANON_KEY; is the local stack running?" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Helpers: HTTP RPC + JSON assertions.
# -----------------------------------------------------------------------------

sync_pull() {
  # $1: payload JSON
  # $2: optional bearer (defaults to USER_A_TOKEN)
  local payload="$1"
  local bearer="${2:-${USER_A_TOKEN}}"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${bearer}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "Accept-Profile: app_public" \
    -H "Content-Profile: app_public" \
    -H "Prefer: params=single-object" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${payload}" \
    "${API_URL}/rest/v1/rpc/sync_pull")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

sync_pull_anon() {
  local payload="$1"
  local response_file
  response_file="$(mktemp)"
  REQUEST_STATUS="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "Accept-Profile: app_public" \
    -H "Content-Profile: app_public" \
    -H "Prefer: params=single-object" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${payload}" \
    "${API_URL}/rest/v1/rpc/sync_pull")"
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

assert_jq() {
  # Args: <jq-expr> <context>
  local expr="$1"
  local context="$2"
  if ! printf '%s' "${REQUEST_BODY}" | jq -e "${expr}" >/dev/null; then
    echo "[fail] ${context}: jq expression \`${expr}\` did not match." >&2
    echo "${REQUEST_BODY}" | jq . >&2 || echo "${REQUEST_BODY}" >&2
    exit 1
  fi
}

# Sign in user_a / user_b. Reuses the fixture user constants from
# auth-fixture-constants.sh.
sign_in() {
  local email="$1"
  local password="$2"
  local payload
  payload="$(jq -nc --arg email "${email}" --arg password "${password}" \
    '{email: $email, password: $password}')"
  local response_file
  response_file="$(mktemp)"
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
  if [[ "${REQUEST_STATUS}" != "200" ]]; then
    fail "sign_in ${email} returned ${REQUEST_STATUS}"
  fi
  printf '%s' "${REQUEST_BODY}" | jq -r '.access_token'
}

echo "[sync-pull-contract] signing in fixture users"
USER_A_TOKEN="$(sign_in "${USER_A_EMAIL}" "${USER_A_PASSWORD}")"
USER_B_TOKEN="$(sign_in "${USER_B_EMAIL}" "${USER_B_PASSWORD}")"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]] || fail "no user_a token"
[[ -n "${USER_B_TOKEN}" && "${USER_B_TOKEN}" != "null" ]] || fail "no user_b token"

USER_A_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_A_FIXTURE_KEY}'")"
USER_B_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_B_FIXTURE_KEY}'")"
[[ -n "${USER_A_UUID}" ]] || fail "could not load USER_A_UUID"
[[ -n "${USER_B_UUID}" ]] || fail "could not load USER_B_UUID"

# Run-tag namespaces every entity ID so re-runs against an existing baseline DB
# don't collide.
RUN_TAG="${SYNC_PULL_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
echo "[sync-pull-contract] run tag: ${RUN_TAG}"

# Service-role direct SQL is used to seed deterministic rows (bypasses RLS for
# fixture setup and lets us pin server_received_at via the touch trigger). The
# RPC is exercised via the authenticated REST path.

cleanup_run_rows() {
  # Purge any rows seeded under this RUN_TAG (so a second run is hermetic).
  run_psql "
    delete from app_public.session_exercise_tags where id like 'pull-${RUN_TAG}-%';
    delete from app_public.exercise_sets where id like 'pull-${RUN_TAG}-%';
    delete from app_public.session_exercises where id like 'pull-${RUN_TAG}-%';
    delete from app_public.exercise_muscle_mappings where id like 'pull-${RUN_TAG}-%';
    delete from app_public.muscle_groups where id like 'pull-${RUN_TAG}-%';
    delete from app_public.sessions where id like 'pull-${RUN_TAG}-%';
    delete from app_public.exercise_tag_definitions where id like 'pull-${RUN_TAG}-%';
    delete from app_public.exercise_definitions where id like 'pull-${RUN_TAG}-%';
    delete from app_public.gyms where id like 'pull-${RUN_TAG}-%';
  " >/dev/null
}

cleanup_run_rows

# Always clean up on exit so a partial test run doesn't leave residue that
# breaks the next invocation.
trap cleanup_run_rows EXIT

# Common epoch ms for created_at/updated_at/client_updated_at_ms fields.
NOW_MS="$(($(date +%s) * 1000))"

# -----------------------------------------------------------------------------
# Scenario 1: Snapshot pull.
#
# Seed three Layer-0 rows for user A (one gyms, two exercise_definitions) with
# strictly-increasing server_received_at FAR in the future (2098) so any other
# Layer-0 rows already on this DB (baseline seeds, residue from other contract
# suites) sort strictly BEFORE ours. A pull from a cursor positioned just
# before our first seeded instant then returns EXACTLY our three rows.
#
# This makes the has_more=false assertion hermetic: with a small enough seed
# set fully inside one page, has_more is false regardless of how many OTHER
# Layer-0 rows exist for this owner. (A cursor=null snapshot would set
# has_more=true whenever >limit Layer-0 rows exist in total — a non-hermetic
# false-fail that leftover rows from a dirty DB can trigger.)
#
# Expect: 3 entities in sort order; has_more=false; next_cursor = last row.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 1: snapshot pull"
run_psql_sql "
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-gym-1', 'Gym 1',
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2098-01-01 10:00:00.000+00');
  insert into app_public.exercise_definitions (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-ed-1', 'Bench',
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2098-01-01 10:00:01.000+00'),
           ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-ed-2', 'Squat',
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2098-01-01 10:00:02.000+00');
" >/dev/null

# Cursor positioned just before our first seeded instant; limit 10 comfortably
# holds all three rows so the page is complete (has_more=false) hermetically.
SNAPSHOT_CURSOR='{"server_received_at":"2097-12-31T23:59:59.999+00:00","owner_user_id":"00000000-0000-0000-0000-000000000000","type":"gyms","id":""}'
sync_pull '{"layer":0,"cursor":'"${SNAPSHOT_CURSOR}"',"limit":10}'
assert_status "200" "scenario 1 status"
# The window contains exactly our three rows: assert both the run-tag-scoped
# count AND the total entities length (proves nothing else lands in this slice).
assert_jq '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-"))] | length == 3' "scenario 1 entity count"
assert_jq '.entities | length == 3' "scenario 1 page holds exactly the seeded rows"
assert_jq '.has_more == false' "scenario 1 has_more"
# Sort key: gym → first by server_received_at, ed-2 → last.
assert_jq '.entities[0].type == "gyms" and .entities[0].id == "pull-'"${RUN_TAG}"'-gym-1"' "scenario 1 first entity"
assert_jq '.entities[-1].type == "exercise_definitions" and .entities[-1].id == "pull-'"${RUN_TAG}"'-ed-2"' "scenario 1 last entity"
# next_cursor is the sort key of the last emitted row.
assert_jq '.next_cursor | type == "object" and has("server_received_at") and has("owner_user_id") and has("type") and has("id")' "scenario 1 next_cursor shape"
assert_jq '.next_cursor.type == "exercise_definitions" and .next_cursor.id == "pull-'"${RUN_TAG}"'-ed-2"' "scenario 1 next_cursor points at last row"

# Also exercise the cursor=null snapshot path: the initial pull of this layer
# must include all three seeded rows (count scoped to our run tag so unrelated
# residue does not interfere). has_more is intentionally NOT asserted here — it
# is a global property of the layer, not of our slice.
sync_pull '{"layer":0,"cursor":null,"limit":200}'
assert_status "200" "scenario 1 cursor=null status"
assert_jq '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-"))] | length == 3' "scenario 1 cursor=null includes all seeded rows"
pass "scenario 1: snapshot pull"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 2: Paginated drain.
#
# Seed five Layer-0 rows with strictly-increasing server_received_at. Pull
# with limit=2 three times; expect 2 + 2 + 1, union equals seeded set in
# cursor order.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 2: paginated drain"
# We seed five rows far in the future (server_received_at = 2099-02-01) so any
# baseline rows from earlier suites (with server_received_at = now()) sort
# strictly BEFORE ours; the initial cursor sits just before our seeded
# instants. This makes the drain assertions deterministic regardless of what
# else lives in the local DB at run time.
INITIAL_CURSOR='{"server_received_at":"2099-01-31T23:59:59.999+00:00","owner_user_id":"00000000-0000-0000-0000-000000000000","type":"gyms","id":""}'
run_psql_sql "
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-pg-1', 'G1', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-02-01 10:00:01.000+00'),
           ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-pg-2', 'G2', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-02-01 10:00:02.000+00'),
           ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-pg-3', 'G3', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-02-01 10:00:03.000+00'),
           ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-pg-4', 'G4', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-02-01 10:00:04.000+00'),
           ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-pg-5', 'G5', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-02-01 10:00:05.000+00');
" >/dev/null

sync_pull '{"layer":0,"cursor":'"${INITIAL_CURSOR}"',"limit":2}'
assert_status "200" "scenario 2 page 1 status"
assert_jq '.entities | length == 2' "scenario 2 page 1 length"
assert_jq '.has_more == true' "scenario 2 page 1 has_more"
assert_jq '.entities[0].id == "pull-'"${RUN_TAG}"'-pg-1"' "scenario 2 page 1 first id"
assert_jq '.entities[1].id == "pull-'"${RUN_TAG}"'-pg-2"' "scenario 2 page 1 second id"
CURSOR_2="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"

sync_pull '{"layer":0,"cursor":'"${CURSOR_2}"',"limit":2}'
assert_status "200" "scenario 2 page 2 status"
assert_jq '.entities | length == 2' "scenario 2 page 2 length"
assert_jq '.has_more == true' "scenario 2 page 2 has_more"
assert_jq '.entities[0].id == "pull-'"${RUN_TAG}"'-pg-3"' "scenario 2 page 2 first id"
assert_jq '.entities[1].id == "pull-'"${RUN_TAG}"'-pg-4"' "scenario 2 page 2 second id"
CURSOR_3="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"

sync_pull '{"layer":0,"cursor":'"${CURSOR_3}"',"limit":2}'
assert_status "200" "scenario 2 page 3 status"
assert_jq '.entities | length == 1' "scenario 2 page 3 length"
assert_jq '.has_more == false' "scenario 2 page 3 has_more"
assert_jq '.entities[0].id == "pull-'"${RUN_TAG}"'-pg-5"' "scenario 2 page 3 first id"
pass "scenario 2: paginated drain (2 + 2 + 1)"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 3: Layer→type mapping integrity — THE plan-level outcome.
#
# Seed at least one row of EVERY entity type for user A, with a fully-
# connected FK chain. Pull each layer (0..3) with cursor=null, limit=100.
# Assert each layer's response `type` set equals exactly the §B.4.4 mapping;
# union = all eight; pairwise disjoint.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 3: layer→type mapping integrity"
run_psql_sql "
  -- Layer 0: gyms, exercise_definitions, muscle_groups.
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l0-gym', 'G', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.exercise_definitions (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l0-ed', 'ED', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  -- Parent for the exercise_muscle_mappings row below (composite FK target).
  insert into app_public.muscle_groups (owner_user_id, id, display_name, family_name, sort_order, is_editable, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l0-mg', 'Pectorals', 'chest', 0, 0, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

  -- Layer 1: sessions, exercise_muscle_mappings, exercise_tag_definitions.
  -- exercise_tag_definitions lives here (not Layer 0) per the corrected
  -- partition in docs/specs/tech/sync-v2-server-contract.md §B.3.4.1: it FKs
  -- into exercise_definitions (Layer 0), so §A.7.7's no-intra-layer-FK rule
  -- forces it into a strictly later layer.
  insert into app_public.sessions (owner_user_id, id, gym_id, started_at, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l1-s', 'pull-${RUN_TAG}-l0-gym', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.exercise_muscle_mappings (owner_user_id, id, exercise_definition_id, muscle_group_id, weight, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l1-emm', 'pull-${RUN_TAG}-l0-ed', 'pull-${RUN_TAG}-l0-mg', 1.0, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.exercise_tag_definitions (owner_user_id, id, exercise_definition_id, name, normalized_name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l1-etd', 'pull-${RUN_TAG}-l0-ed', 'Tag', 'tag', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

  -- Layer 2: session_exercises.
  insert into app_public.session_exercises (owner_user_id, id, session_id, exercise_definition_id, order_index, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l2-sx', 'pull-${RUN_TAG}-l1-s', 'pull-${RUN_TAG}-l0-ed', 0, 'SX', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

  -- Layer 3: exercise_sets, session_exercise_tags.
  insert into app_public.exercise_sets (owner_user_id, id, session_exercise_id, order_index, weight_value, reps_value, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l3-es', 'pull-${RUN_TAG}-l2-sx', 0, '100', '10', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.session_exercise_tags (owner_user_id, id, session_exercise_id, exercise_tag_definition_id, created_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-l3-st', 'pull-${RUN_TAG}-l2-sx', 'pull-${RUN_TAG}-l1-etd', ${NOW_MS}, ${NOW_MS});
" >/dev/null

# Layer 0 should yield exactly {gyms, exercise_definitions, muscle_groups} per
# the corrected partition in docs/specs/tech/sync-v2-server-contract.md
# §B.3.4.1: exercise_tag_definitions FKs into exercise_definitions, so the
# §A.7.7 "no intra-layer FK" invariant forces it into Layer 1, not Layer 0.
sync_pull '{"layer":0,"cursor":null,"limit":200}'
assert_status "200" "scenario 3 layer 0 status"
L0_TYPES="$(printf '%s' "${REQUEST_BODY}" | jq -c '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-")) | .type] | unique | sort')"
[[ "${L0_TYPES}" == '["exercise_definitions","gyms","muscle_groups"]' ]] \
  || fail "scenario 3 layer 0: expected {gyms, exercise_definitions, muscle_groups}, got ${L0_TYPES}"

sync_pull '{"layer":1,"cursor":null,"limit":200}'
assert_status "200" "scenario 3 layer 1 status"
L1_TYPES="$(printf '%s' "${REQUEST_BODY}" | jq -c '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-")) | .type] | unique | sort')"
[[ "${L1_TYPES}" == '["exercise_muscle_mappings","exercise_tag_definitions","sessions"]' ]] \
  || fail "scenario 3 layer 1: expected {sessions, exercise_muscle_mappings, exercise_tag_definitions}, got ${L1_TYPES}"

sync_pull '{"layer":2,"cursor":null,"limit":200}'
assert_status "200" "scenario 3 layer 2 status"
L2_TYPES="$(printf '%s' "${REQUEST_BODY}" | jq -c '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-")) | .type] | unique | sort')"
[[ "${L2_TYPES}" == '["session_exercises"]' ]] \
  || fail "scenario 3 layer 2: expected {session_exercises}, got ${L2_TYPES}"

sync_pull '{"layer":3,"cursor":null,"limit":200}'
assert_status "200" "scenario 3 layer 3 status"
L3_TYPES="$(printf '%s' "${REQUEST_BODY}" | jq -c '[.entities[] | select(.id | startswith("pull-'"${RUN_TAG}"'-")) | .type] | unique | sort')"
[[ "${L3_TYPES}" == '["exercise_sets","session_exercise_tags"]' ]] \
  || fail "scenario 3 layer 3: expected {exercise_sets, session_exercise_tags}, got ${L3_TYPES}"

# Union equals all nine; pairwise disjoint (jq computes both at once).
UNION_AND_DISJOINT="$(jq -nc \
  --argjson l0 "${L0_TYPES}" \
  --argjson l1 "${L1_TYPES}" \
  --argjson l2 "${L2_TYPES}" \
  --argjson l3 "${L3_TYPES}" '
  ($l0 + $l1 + $l2 + $l3) as $all
  | {
      union_sorted: ($all | unique | sort),
      total_count: ($all | length),
      unique_count: ($all | unique | length)
    }')"
EXPECTED_UNION='["exercise_definitions","exercise_muscle_mappings","exercise_sets","exercise_tag_definitions","gyms","muscle_groups","session_exercise_tags","session_exercises","sessions"]'
ACTUAL_UNION="$(printf '%s' "${UNION_AND_DISJOINT}" | jq -c '.union_sorted')"
TOTAL_COUNT="$(printf '%s' "${UNION_AND_DISJOINT}" | jq -r '.total_count')"
UNIQUE_COUNT="$(printf '%s' "${UNION_AND_DISJOINT}" | jq -r '.unique_count')"
[[ "${ACTUAL_UNION}" == "${EXPECTED_UNION}" ]] \
  || fail "scenario 3 union: expected all nine, got ${ACTUAL_UNION}"
[[ "${TOTAL_COUNT}" == "9" ]] \
  || fail "scenario 3 total: expected 9 entity-type slots across layers, got ${TOTAL_COUNT}"
[[ "${UNIQUE_COUNT}" == "9" ]] \
  || fail "scenario 3 disjoint: expected 9 unique entity types (pairwise-disjoint), got ${UNIQUE_COUNT}"

pass "scenario 3: layer→type mapping integrity (topological partition per the server contract §B.4.4)"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 4: RLS isolation.
#
# Seed Layer-0 rows for user B; pull as user A; A must see NONE of B's rows
# even though they sort into the cursor window.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 4: RLS isolation"
run_psql_sql "
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, 'pull-${RUN_TAG}-bgym-1', 'B Gym 1', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}),
           ('${USER_B_UUID}'::uuid, 'pull-${RUN_TAG}-bgym-2', 'B Gym 2', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-agym-1', 'A Gym 1', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
" >/dev/null

sync_pull '{"layer":0,"cursor":null,"limit":200}'
assert_status "200" "scenario 4 status"
# User A must see their own row.
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-agym-1")] | length == 1' "scenario 4 user_a sees own row"
# User A must NOT see user B's rows.
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-bgym-1" or .id == "pull-'"${RUN_TAG}"'-bgym-2")] | length == 0' "scenario 4 user_a does not see user_b rows"
# Symmetric check: user B sees their own two but not user A's.
sync_pull '{"layer":0,"cursor":null,"limit":200}' "${USER_B_TOKEN}"
assert_status "200" "scenario 4 user_b status"
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-bgym-1" or .id == "pull-'"${RUN_TAG}"'-bgym-2")] | length == 2' "scenario 4 user_b sees own rows"
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-agym-1")] | length == 0' "scenario 4 user_b does not see user_a row"
pass "scenario 4: RLS isolation"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 5: Tombstones included.
#
# Insert a gyms row, then service-role-UPDATE it to set deleted_at; pull
# must return the row with fields.deleted_at non-null.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 5: tombstones included"
# The owner-immutability trigger refuses any UPDATE when auth.uid() is NULL
# (docs/specs/tech/sync-v2-server-contract.md §A.6.3). To soft-delete a row via
# direct SQL we set the JWT-claim GUC for
# the duration of the UPDATE so auth.uid() resolves to USER_A_UUID. This
# matches the path service_role and the push RPC take.
run_psql_sql "
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-tomb', 'Tombstone Gym', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  begin;
    select set_config('request.jwt.claims', json_build_object('sub', '${USER_A_UUID}', 'role', 'authenticated')::text, true);
    update app_public.gyms set deleted_at = ${NOW_MS}, client_updated_at_ms = ${NOW_MS} + 1
      where owner_user_id = '${USER_A_UUID}'::uuid and id = 'pull-${RUN_TAG}-tomb';
  commit;
" >/dev/null

sync_pull '{"layer":0,"cursor":null,"limit":200}'
assert_status "200" "scenario 5 status"
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-tomb")] | length == 1' "scenario 5 tombstone row present"
assert_jq '[.entities[] | select(.id == "pull-'"${RUN_TAG}"'-tomb")][0].fields.deleted_at != null' "scenario 5 deleted_at is not null"
pass "scenario 5: tombstones included"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 6: Empty page after drain.
#
# Pull a snapshot, then pull again with the returned next_cursor. The second
# response must be { entities: [], has_more: false, next_cursor: <echo input> }.
# We construct an obviously-past cursor so the second pull is definitely empty.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 6: empty page after drain"
# Seed one row at a known time, drain, then re-pull with the returned cursor.
run_psql_sql "
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-empty-1', 'Empty1', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2099-01-01 00:00:00.000+00');
" >/dev/null

# Pull beyond a cursor positioned just before this row.
INITIAL_CURSOR='{"server_received_at":"2098-12-31T23:59:59.999+00:00","owner_user_id":"00000000-0000-0000-0000-000000000000","type":"gyms","id":""}'
sync_pull '{"layer":0,"cursor":'"${INITIAL_CURSOR}"',"limit":10}'
assert_status "200" "scenario 6 first pull status"
assert_jq '.entities | length == 1' "scenario 6 first pull length"
assert_jq '.has_more == false' "scenario 6 first pull has_more"
CURSOR_DRAINED="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"

sync_pull '{"layer":0,"cursor":'"${CURSOR_DRAINED}"',"limit":10}'
assert_status "200" "scenario 6 second pull status"
assert_jq '.entities == []' "scenario 6 entities empty"
assert_jq '.has_more == false' "scenario 6 has_more false"
# next_cursor echoes input cursor unchanged. Compare via jq deep-equality.
ECHOED="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"
if [[ "$(jq -nc --argjson a "${ECHOED}" --argjson b "${CURSOR_DRAINED}" '$a == $b')" != "true" ]]; then
  fail "scenario 6: empty-page next_cursor did not echo input. echoed=${ECHOED} input=${CURSOR_DRAINED}"
fi
pass "scenario 6: empty page echoes input cursor"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 7: Same-millisecond tiebreak.
#
# INSERT two rows for the same owner in the same transaction so they share
# server_received_at. Pull with limit=1 must return the lexicographically-
# earlier (type, id) first; second pull with next_cursor returns the other.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 7: same-millisecond tiebreak"
run_psql_sql "
  begin;
  insert into app_public.gyms (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-tie-a', 'A', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2097-01-01 00:00:00.000+00');
  insert into app_public.exercise_definitions (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms, server_received_at)
    values ('${USER_A_UUID}'::uuid, 'pull-${RUN_TAG}-tie-b', 'B', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}, '2097-01-01 00:00:00.000+00');
  commit;
" >/dev/null

# Cursor positioned just before the shared instant.
INITIAL_CURSOR='{"server_received_at":"2096-12-31T23:59:59.999+00:00","owner_user_id":"00000000-0000-0000-0000-000000000000","type":"gyms","id":""}'
sync_pull '{"layer":0,"cursor":'"${INITIAL_CURSOR}"',"limit":1}'
assert_status "200" "scenario 7 page 1 status"
assert_jq '.entities | length == 1' "scenario 7 page 1 length"
assert_jq '.has_more == true' "scenario 7 page 1 has_more"
# Lex earliest of (type, id) where (gyms, ...tie-a) and (exercise_definitions, ...tie-b):
# 'exercise_definitions' < 'gyms' so tie-b should come first.
assert_jq '.entities[0].type == "exercise_definitions" and .entities[0].id == "pull-'"${RUN_TAG}"'-tie-b"' "scenario 7 page 1 first row is exercise_definitions"
CURSOR_7="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"

sync_pull '{"layer":0,"cursor":'"${CURSOR_7}"',"limit":1}'
assert_status "200" "scenario 7 page 2 status"
assert_jq '.entities | length == 1' "scenario 7 page 2 length"
assert_jq '.entities[0].type == "gyms" and .entities[0].id == "pull-'"${RUN_TAG}"'-tie-a"' "scenario 7 page 2 row is gyms"
pass "scenario 7: same-millisecond tiebreak (lex (type,id))"

cleanup_run_rows

# -----------------------------------------------------------------------------
# Scenario 8: Limit bounds.
#
# limit=0 rejected (INTERNAL); limit=201 rejected (INTERNAL); limit=200 accepted.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 8: limit bounds"
sync_pull '{"layer":0,"cursor":null,"limit":0}'
assert_status "200" "scenario 8 limit=0 status (RPC body returns error envelope on 200)"
assert_jq '.error.code == "INTERNAL"' "scenario 8 limit=0 INTERNAL error"
sync_pull '{"layer":0,"cursor":null,"limit":201}'
assert_jq '.error.code == "INTERNAL"' "scenario 8 limit=201 INTERNAL error"
sync_pull '{"layer":0,"cursor":null,"limit":200}'
assert_jq '.error == null or (has("entities") and has("next_cursor") and has("has_more"))' "scenario 8 limit=200 accepted"
pass "scenario 8: limit bounds (0 rejected, 201 rejected, 200 accepted)"

# -----------------------------------------------------------------------------
# Scenario 9: Layer bounds.
#
# layer=-1 rejected; layer=4 rejected; layer=0..3 each accepted (snapshot,
# may return empty entities).
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 9: layer bounds"
sync_pull '{"layer":-1,"cursor":null,"limit":10}'
assert_jq '.error.code == "INTERNAL"' "scenario 9 layer=-1 INTERNAL error"
sync_pull '{"layer":4,"cursor":null,"limit":10}'
assert_jq '.error.code == "INTERNAL"' "scenario 9 layer=4 INTERNAL error"
for layer in 0 1 2 3; do
  sync_pull '{"layer":'"${layer}"',"cursor":null,"limit":10}'
  assert_status "200" "scenario 9 layer=${layer} status"
  assert_jq '.error == null or (has("entities") and has("next_cursor") and has("has_more"))' "scenario 9 layer=${layer} accepted"
done
pass "scenario 9: layer bounds (-1 rejected, 4 rejected, 0..3 accepted)"

# -----------------------------------------------------------------------------
# Scenario 10: AUTH_REQUIRED.
#
# Pull without an authenticated JWT (anon key only) returns AUTH_REQUIRED.
# -----------------------------------------------------------------------------

echo "[sync-pull-contract] scenario 10: AUTH_REQUIRED"
sync_pull_anon '{"layer":0,"cursor":null,"limit":10}'
assert_status "200" "scenario 10 status"
assert_jq '.error.code == "AUTH_REQUIRED"' "scenario 10 AUTH_REQUIRED envelope"
pass "scenario 10: AUTH_REQUIRED"

echo "[sync-pull-contract] all scenarios passed"
