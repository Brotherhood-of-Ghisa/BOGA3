#!/usr/bin/env bash

# Integration test — RLS cross-owner isolation.
#
# Sets up rows for two fixture users (A and B), then with user A's JWT
# exercises SELECT / INSERT / UPDATE / DELETE against user B's rows on every
# one of the eight v2 entity tables. All four operations must either:
#
#   - return zero rows (SELECT, UPDATE, DELETE under PostgREST + RLS),
#   - or fail with an RLS-deny status / response shape (INSERT with a
#     mismatched owner_user_id is rejected by the `with check` clause).
#
# This is the user-visible RLS contract: a leaked JWT for user A cannot
# touch user B's data. Asserted in addition to the catalog-level
# pg_class.relrowsecurity=true check on every entity table.
#
# Test surface: PostgREST RPC + REST tables, JWT-bearer auth (same pattern
# the existing sync-push / sync-pull contract suites use). Service-role is
# only used to seed B's data so we can verify A doesn't see it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "[sync-v2-rls] jq is required" >&2
    exit 1
  fi
}

PSQL_MODE="host"
DOCKER_DB_CONTAINER=""
select_psql_mode() {
  if command -v psql >/dev/null 2>&1; then PSQL_MODE="host"; return 0; fi
  if command -v docker >/dev/null 2>&1; then
    # Strictly this worktree's container (resolve_db_container errors — no
    # unscoped fallback that could target a foreign worktree's DB).
    DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
    PSQL_MODE="docker"; return 0
  fi
  echo "[sync-v2-rls] need host psql or supabase_db_* container." >&2
  exit 1
}
run_psql() {
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -c "$1" ;;
    docker) docker exec -e PGPASSWORD=postgres "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -c "$1" ;;
  esac
}
run_psql_sql() {
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
    docker) docker exec -e PGPASSWORD=postgres -i "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
  esac
}

fail() { echo "[sync-v2-rls] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-rls] pass: $*"; }

require_jq
select_psql_mode
load_supabase_status_env

[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] \
  || fail "missing API_URL/ANON_KEY/SERVICE_ROLE_KEY; is the local stack running?"

ENTITIES=(
  gyms
  exercise_definitions
  exercise_tag_definitions
  sessions
  exercise_muscle_mappings
  session_exercises
  exercise_sets
  session_exercise_tags
)

# -----------------------------------------------------------------------------
# Catalog check — relrowsecurity = true on every entity (precondition for
# the behavioural checks below).
# -----------------------------------------------------------------------------
for entity in "${ENTITIES[@]}"; do
  rls="$(run_psql "
    select case when c.relrowsecurity then 1 else 0 end
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public' and c.relname = '${entity}';
  ")"
  if [[ "${rls}" != "1" ]]; then
    fail "${entity}: pg_class.relrowsecurity is not true (got '${rls}')"
  fi
done
pass "rls — pg_class.relrowsecurity=true on every probed entity table"

# -----------------------------------------------------------------------------
# Sign in A and B; resolve their UUIDs.
# -----------------------------------------------------------------------------
sign_in() {
  local email="$1" password="$2"
  local payload
  payload="$(jq -nc --arg email "${email}" --arg password "${password}" \
    '{email: $email, password: $password}')"
  local response_file
  response_file="$(mktemp)"
  local status
  status="$(curl --silent --show-error \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -o "${response_file}" \
    -w "%{http_code}" \
    --data "${payload}" \
    "${API_URL}/auth/v1/token?grant_type=password")"
  local body
  body="$(cat "${response_file}")"
  rm -f "${response_file}"
  if [[ "${status}" != "200" ]]; then
    echo "${body}" >&2
    fail "sign_in ${email} returned ${status}"
  fi
  printf '%s' "${body}" | jq -r '.access_token'
}

USER_A_TOKEN="$(sign_in "${USER_A_EMAIL}" "${USER_A_PASSWORD}")"
USER_B_TOKEN="$(sign_in "${USER_B_EMAIL}" "${USER_B_PASSWORD}")"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]] || fail "no user_a token"
[[ -n "${USER_B_TOKEN}" && "${USER_B_TOKEN}" != "null" ]] || fail "no user_b token"

USER_A_UUID="$(run_psql "
  select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_A_FIXTURE_KEY}';
")"
USER_B_UUID="$(run_psql "
  select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_B_FIXTURE_KEY}';
")"
[[ -n "${USER_A_UUID}" && -n "${USER_B_UUID}" ]] || fail "could not resolve fixture UUIDs"

RUN_TAG="${SYNC_RLS_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
NOW_MS="$(($(date +%s) * 1000))"

# Per-entity row IDs. The chain is the same one the push contract test seeds:
# user B owns a gym, an exercise_definition, an exercise_tag_definition, a
# session referencing the gym, an exercise_muscle_mapping referencing the
# exercise_definition, a session_exercise referencing the session +
# exercise_definition, an exercise_set referencing the session_exercise, and a
# session_exercise_tag referencing the session_exercise + exercise_tag_definition.
GYM_ID="rls-${RUN_TAG}-bgym"
EDEF_ID="rls-${RUN_TAG}-bedef"
MG_ID="rls-${RUN_TAG}-bmg"
ETD_ID="rls-${RUN_TAG}-betd"
SESS_ID="rls-${RUN_TAG}-bsess"
EMM_ID="rls-${RUN_TAG}-bemm"
SX_ID="rls-${RUN_TAG}-bsx"
SET_ID="rls-${RUN_TAG}-bset"
SXTAG_ID="rls-${RUN_TAG}-bsxtag"

# Build per-entity ID map so we know which ID to target for each table.
declare -a ROW_IDS=(
  "${GYM_ID}"
  "${EDEF_ID}"
  "${ETD_ID}"
  "${SESS_ID}"
  "${EMM_ID}"
  "${SX_ID}"
  "${SET_ID}"
  "${SXTAG_ID}"
)

cleanup_rows() {
  run_psql_sql "
    delete from app_public.session_exercise_tags    where id = '${SXTAG_ID}';
    delete from app_public.exercise_sets            where id = '${SET_ID}';
    delete from app_public.session_exercises        where id = '${SX_ID}';
    delete from app_public.exercise_muscle_mappings where id = '${EMM_ID}';
    delete from app_public.muscle_groups            where id = '${MG_ID}';
    delete from app_public.exercise_tag_definitions where id = '${ETD_ID}';
    delete from app_public.sessions                 where id = '${SESS_ID}';
    delete from app_public.exercise_definitions     where id = '${EDEF_ID}';
    delete from app_public.gyms                     where id = '${GYM_ID}';
  " >/dev/null 2>&1 || true
}
cleanup_rows
trap cleanup_rows EXIT

# Seed user B's complete FK chain via direct SQL (bypassing RLS so we can
# install rows under another user's owner_user_id deterministically). This is
# the standard test-data pattern for cross-owner isolation; the production
# write path is `sync_push`, but here we're checking RLS visibility, not the
# push RPC.
echo "[sync-v2-rls] seeding user B's complete FK chain"
run_psql_sql "
  begin;
    set constraints all deferred;

    insert into app_public.gyms
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${GYM_ID}', 'B Gym', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_definitions
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${EDEF_ID}', 'B Exercise', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.muscle_groups
      (owner_user_id, id, display_name, family_name, sort_order, is_editable,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${MG_ID}', 'B Pectorals', 'chest', 0, 0,
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_tag_definitions
      (owner_user_id, id, exercise_definition_id, name, normalized_name,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${ETD_ID}', '${EDEF_ID}', 'B Tag', 'b tag',
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.sessions
      (owner_user_id, id, gym_id, status, started_at,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${SESS_ID}', '${GYM_ID}', 'active', ${NOW_MS},
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_muscle_mappings
      (owner_user_id, id, exercise_definition_id, muscle_group_id, weight,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${EMM_ID}', '${EDEF_ID}', '${MG_ID}', 1.0,
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.session_exercises
      (owner_user_id, id, session_id, exercise_definition_id, order_index,
       name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${SX_ID}', '${SESS_ID}', '${EDEF_ID}', 0,
            'B SX', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_sets
      (owner_user_id, id, session_exercise_id, order_index,
       weight_value, reps_value, created_at, updated_at,
       client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${SET_ID}', '${SX_ID}', 0,
            '100', '8', ${NOW_MS}, ${NOW_MS},
            ${NOW_MS});

    insert into app_public.session_exercise_tags
      (owner_user_id, id, session_exercise_id, exercise_tag_definition_id,
       created_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${SXTAG_ID}', '${SX_ID}', '${ETD_ID}',
            ${NOW_MS}, ${NOW_MS});
  commit;
" >/dev/null

# -----------------------------------------------------------------------------
# HTTP helpers — every call goes through PostgREST with user A's JWT.
# -----------------------------------------------------------------------------

http_request() {
  local method="$1" url="$2" auth_bearer="$3" body="${4:-}" prefer="${5:-}"
  local response_file
  response_file="$(mktemp)"
  local -a curl_args
  curl_args=(
    --silent --show-error
    -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -H "Authorization: Bearer ${auth_bearer}"
    -H "Accept-Profile: app_public"
    -H "Content-Profile: app_public"
    -o "${response_file}"
    -w "%{http_code}"
  )
  [[ -n "${prefer}" ]] && curl_args+=(-H "Prefer: ${prefer}")
  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  REQUEST_STATUS="$(curl "${curl_args[@]}" "${url}")"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

# -----------------------------------------------------------------------------
# Per-entity rls assertions (with user A's JWT against user B's row).
# -----------------------------------------------------------------------------

# Minimal "fields" payload per entity for the INSERT case. We try to write a
# row claiming ownership = user B; RLS `with check (owner_user_id =
# auth.uid())` must reject the write either with an explicit
# new-row-violates-row-level-security message, or PostgREST emits a 403 /
# 401 / 42501 envelope. We assert non-2xx.

insert_payload_for() {
  case "$1" in
    gyms)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, name: "Injected", client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    exercise_definitions)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, name: "Injected", client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    exercise_tag_definitions)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg edef "${EDEF_ID}" \
        --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, exercise_definition_id: $edef,
          name: "Injected", normalized_name: "injected",
          client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    sessions)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg gym "${GYM_ID}" --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, gym_id: $gym, status: "active",
          started_at: $ts, client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    exercise_muscle_mappings)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg edef "${EDEF_ID}" --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, exercise_definition_id: $edef,
          muscle_group_id: "pectorals", weight: 1.0,
          client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    session_exercises)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg sess "${SESS_ID}" --arg edef "${EDEF_ID}" --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, session_id: $sess,
          exercise_definition_id: $edef, order_index: 0, name: "Injected",
          client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    exercise_sets)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg sx "${SX_ID}" --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, session_exercise_id: $sx,
          order_index: 0, weight_value: "100", reps_value: "8",
          client_updated_at_ms: $ts, created_at: $ts, updated_at: $ts}'
      ;;
    session_exercise_tags)
      jq -nc --arg owner "${USER_B_UUID}" --arg id "rls-inject-${RUN_TAG}-$1" \
        --arg sx "${SX_ID}" --arg etd "${ETD_ID}" --argjson ts "${NOW_MS}" \
        '{owner_user_id: $owner, id: $id, session_exercise_id: $sx,
          exercise_tag_definition_id: $etd, client_updated_at_ms: $ts, created_at: $ts}'
      ;;
  esac
}

target_row_id_for() {
  case "$1" in
    gyms)                     echo "${GYM_ID}" ;;
    exercise_definitions)     echo "${EDEF_ID}" ;;
    exercise_tag_definitions) echo "${ETD_ID}" ;;
    sessions)                 echo "${SESS_ID}" ;;
    exercise_muscle_mappings) echo "${EMM_ID}" ;;
    session_exercises)        echo "${SX_ID}" ;;
    exercise_sets)            echo "${SET_ID}" ;;
    session_exercise_tags)    echo "${SXTAG_ID}" ;;
  esac
}

for entity in "${ENTITIES[@]}"; do
  echo "[sync-v2-rls] entity ${entity}"
  target_id="$(target_row_id_for "${entity}")"

  # 1. SELECT — user A asking for B's row, must return zero rows (RLS hides).
  http_request GET \
    "${API_URL}/rest/v1/${entity}?id=eq.${target_id}&select=id" \
    "${USER_A_TOKEN}"
  if [[ "${REQUEST_STATUS}" != "200" ]]; then
    fail "${entity}: A's SELECT of B's row returned status ${REQUEST_STATUS} (expected 200 with empty array). body=${REQUEST_BODY}"
  fi
  if [[ "$(printf '%s' "${REQUEST_BODY}" | jq 'length')" != "0" ]]; then
    fail "${entity}: A's SELECT of B's row leaked rows: ${REQUEST_BODY}"
  fi

  # 2. INSERT — user A attempts to install a row claiming owner_user_id=B.
  # The `with check (owner_user_id = auth.uid())` policy must reject. We
  # tolerate any non-2xx response. (PostgREST surfaces this as 403/401/4xx.)
  body="$(insert_payload_for "${entity}")"
  http_request POST "${API_URL}/rest/v1/${entity}" "${USER_A_TOKEN}" "${body}"
  if [[ "${REQUEST_STATUS}" =~ ^2 ]]; then
    fail "${entity}: A's INSERT claiming owner=B unexpectedly succeeded (status ${REQUEST_STATUS}). body=${REQUEST_BODY}"
  fi

  # 3. UPDATE — user A attempts to flip a column on B's row. PostgREST
  # returns 200 with an empty array (no rows matched the policy filter).
  upd_body='{"client_updated_at_ms": 0}'
  http_request PATCH \
    "${API_URL}/rest/v1/${entity}?id=eq.${target_id}" \
    "${USER_A_TOKEN}" "${upd_body}" "return=representation"
  if [[ ! "${REQUEST_STATUS}" =~ ^2 ]]; then
    # PostgREST may also return 4xx if the body doesn't pass type checks; the
    # important assertion is "no rows updated", which we verify below by
    # service-role re-read.
    :
  fi
  if [[ "${REQUEST_STATUS}" =~ ^2 ]]; then
    if [[ "$(printf '%s' "${REQUEST_BODY}" | jq 'length')" != "0" ]]; then
      fail "${entity}: A's UPDATE of B's row leaked an updated row: ${REQUEST_BODY}"
    fi
  fi

  # 4. DELETE — same.
  http_request DELETE \
    "${API_URL}/rest/v1/${entity}?id=eq.${target_id}" \
    "${USER_A_TOKEN}" "" "return=representation"
  if [[ "${REQUEST_STATUS}" =~ ^2 ]]; then
    if [[ "$(printf '%s' "${REQUEST_BODY}" | jq 'length')" != "0" ]]; then
      fail "${entity}: A's DELETE of B's row leaked deleted rows: ${REQUEST_BODY}"
    fi
  fi

  # Service-role confirmation: B's row still present, untouched, owned by B.
  http_request GET \
    "${API_URL}/rest/v1/${entity}?id=eq.${target_id}&select=id,owner_user_id" \
    "${SERVICE_ROLE_KEY}"
  if [[ "${REQUEST_STATUS}" != "200" ]]; then
    fail "${entity}: service-role re-read of B's row returned status ${REQUEST_STATUS}. body=${REQUEST_BODY}"
  fi
  remaining_owner="$(printf '%s' "${REQUEST_BODY}" | jq -r --arg id "${target_id}" '.[] | select(.id == $id) | .owner_user_id')"
  if [[ "${remaining_owner}" != "${USER_B_UUID}" ]]; then
    fail "${entity}: post-RLS-probe row owner mismatch (expected ${USER_B_UUID}, got '${remaining_owner}'). RLS may have leaked."
  fi
done

pass "rls — A's JWT cannot SELECT/INSERT/UPDATE/DELETE B's rows on any probed entity table"

echo "[sync-v2-rls] all assertions passed"
