#!/usr/bin/env bash

# Contract tests for the developer-only app_public.dev_wipe_my_data() helper.
#
# The helper deletes every row owned by the caller across all eight entity
# tables, in one transaction, and returns the count. It is security definer,
# so it must scope its own deletes to the caller and refuse to run outside a
# non-production environment.
#
# Scenarios:
#   1. AUTH_REQUIRED — called with no authenticated user (auth.uid() NULL).
#   2. FORBIDDEN_ENV — called as an authenticated user but with app.env unset
#      (the default for the local stack), so the environment guard fires.
#   3. Owner-scoped wipe — with app.env set to a non-production value, the
#      caller's complete FK chain is deleted, the returned count equals the
#      number of rows removed, and a second user's rows are left untouched.
#
# The helper is invoked through psql with the JWT-claim GUC set (so auth.uid()
# resolves) and app.env set per-transaction, mirroring the
# set_config('request.jwt.claims', ...) pattern the sync-pull contract test
# uses for owner-scoped direct SQL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

PSQL_MODE="host"
DOCKER_DB_CONTAINER=""
select_psql_mode() {
  if command -v psql >/dev/null 2>&1; then PSQL_MODE="host"; return 0; fi
  if command -v docker >/dev/null 2>&1; then
    local project_id=""
    [[ -f "${SUPABASE_DIR}/config.toml" ]] && project_id="$(awk -F'"' '/^project_id[[:space:]]*=/ {print $2; exit}' "${SUPABASE_DIR}/config.toml" || true)"
    [[ -n "${project_id}" ]] && DOCKER_DB_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -F "supabase_db_${project_id}" | head -n1 || true)"
    [[ -z "${DOCKER_DB_CONTAINER}" ]] && DOCKER_DB_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^supabase_db_' | head -n1 || true)"
    if [[ -n "${DOCKER_DB_CONTAINER}" ]]; then PSQL_MODE="docker"; return 0; fi
  fi
  echo "[dev-wipe] need host psql or supabase_db_* container." >&2
  exit 1
}

# Single-statement query returning a scalar (errors are fatal).
run_psql() {
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -c "$1" ;;
    docker) docker exec -e PGPASSWORD=postgres "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -c "$1" ;;
  esac
}

# Multi-statement SQL via stdin (errors are fatal under ON_ERROR_STOP).
run_psql_sql() {
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
    docker) docker exec -e PGPASSWORD=postgres -i "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
  esac
}

# Run SQL where we EXPECT a raise; capture stderr and return non-zero-safe.
run_psql_sql_expect_error() {
  local sql="$1"
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -v ON_ERROR_STOP=1 -f - <<<"${sql}" 2>&1 ;;
    docker) docker exec -e PGPASSWORD=postgres -i "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -v ON_ERROR_STOP=1 -f - <<<"${sql}" 2>&1 ;;
  esac
}

fail() { echo "[dev-wipe] FAIL: $*" >&2; exit 1; }
pass() { echo "[dev-wipe] pass: $*"; }

select_psql_mode
load_supabase_status_env

USER_A_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_A_FIXTURE_KEY}';")"
USER_B_UUID="$(run_psql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_B_FIXTURE_KEY}';")"
[[ -n "${USER_A_UUID}" && -n "${USER_B_UUID}" ]] || fail "could not resolve fixture UUIDs (is the local stack seeded?)"

RUN_TAG="$(date +%s)-$$-${RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
NOW_MS="$(($(date +%s) * 1000))"

# IDs for user A's full eight-table FK chain (deleted by the helper) plus a
# single user B gym that must survive (owner-scoping check).
A_GYM="dw-${RUN_TAG}-agym"
A_EDEF="dw-${RUN_TAG}-aedef"
A_ETD="dw-${RUN_TAG}-aetd"
A_SESS="dw-${RUN_TAG}-asess"
A_EMM="dw-${RUN_TAG}-aemm"
A_SX="dw-${RUN_TAG}-asx"
A_SET="dw-${RUN_TAG}-aset"
A_SXTAG="dw-${RUN_TAG}-asxtag"
B_GYM="dw-${RUN_TAG}-bgym"

cleanup_rows() {
  run_psql_sql "
    delete from app_public.session_exercise_tags    where id in ('${A_SXTAG}');
    delete from app_public.exercise_sets            where id in ('${A_SET}');
    delete from app_public.session_exercises        where id in ('${A_SX}');
    delete from app_public.exercise_muscle_mappings where id in ('${A_EMM}');
    delete from app_public.exercise_tag_definitions where id in ('${A_ETD}');
    delete from app_public.sessions                 where id in ('${A_SESS}');
    delete from app_public.exercise_definitions     where id in ('${A_EDEF}');
    delete from app_public.gyms                     where id in ('${A_GYM}', '${B_GYM}');
  " >/dev/null 2>&1 || true
}
cleanup_rows
trap cleanup_rows EXIT

# ---------------------------------------------------------------------------
# Scenario 1: AUTH_REQUIRED — no authenticated user.
#
# Call the function in a transaction that does NOT set request.jwt.claims, so
# auth.uid() resolves to NULL and the function raises before any deletes.
# ---------------------------------------------------------------------------
echo "[dev-wipe] scenario 1: AUTH_REQUIRED when unauthenticated"
out="$(run_psql_sql_expect_error "
  begin;
    select set_config('app.env', 'local', true);
    select app_public.dev_wipe_my_data();
  commit;
" || true)"
if ! printf '%s' "${out}" | grep -q 'AUTH_REQUIRED'; then
  fail "scenario 1 expected AUTH_REQUIRED, got: ${out}"
fi
pass "scenario 1: unauthenticated call raises AUTH_REQUIRED"

# ---------------------------------------------------------------------------
# Scenario 2: FORBIDDEN_ENV — authenticated, but app.env unset.
#
# Set the JWT claim so auth.uid() resolves to user A, but leave app.env unset.
# The environment guard must fire and the function must raise FORBIDDEN_ENV.
# ---------------------------------------------------------------------------
echo "[dev-wipe] scenario 2: FORBIDDEN_ENV when app.env is unset"
out="$(run_psql_sql_expect_error "
  begin;
    select set_config('request.jwt.claims', json_build_object('sub', '${USER_A_UUID}', 'role', 'authenticated')::text, true);
    select app_public.dev_wipe_my_data();
  commit;
" || true)"
if ! printf '%s' "${out}" | grep -q 'FORBIDDEN_ENV'; then
  fail "scenario 2 expected FORBIDDEN_ENV, got: ${out}"
fi
pass "scenario 2: unset app.env raises FORBIDDEN_ENV"

# ---------------------------------------------------------------------------
# Scenario 3: owner-scoped wipe under a non-production env.
#
# Seed user A's full eight-table FK chain plus one user B gym, then call the
# helper as user A with app.env='local'. Assert: the return count equals A's
# eight rows, all of A's rows are gone, and B's gym survives.
# ---------------------------------------------------------------------------
echo "[dev-wipe] scenario 3: owner-scoped wipe deletes only the caller's rows"

# Start from a clean slate for user A so the returned count is deterministic:
# earlier suites in the same gate run may have left rows owned by this fixture
# user, and the helper (correctly) deletes ALL of the caller's rows. Removing
# A's existing rows up front means the helper's count reflects exactly the
# eight rows seeded below.
run_psql_sql "
  begin;
    set constraints all deferred;
    delete from app_public.session_exercise_tags    where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.exercise_sets            where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.session_exercises        where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.exercise_muscle_mappings where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.exercise_tag_definitions where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.sessions                 where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.exercise_definitions     where owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.gyms                     where owner_user_id = '${USER_A_UUID}'::uuid;
  commit;
" >/dev/null

run_psql_sql "
  begin;
    set constraints all deferred;

    insert into app_public.gyms
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_GYM}', 'A Gym', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_definitions
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_EDEF}', 'A Exercise', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_tag_definitions
      (owner_user_id, id, exercise_definition_id, name, normalized_name,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_ETD}', '${A_EDEF}', 'A Tag', 'a tag',
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.sessions
      (owner_user_id, id, gym_id, status, started_at,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_SESS}', '${A_GYM}', 'active', ${NOW_MS},
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_muscle_mappings
      (owner_user_id, id, exercise_definition_id, muscle_group_id, weight,
       created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_EMM}', '${A_EDEF}', 'pectorals', 1.0,
            ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.session_exercises
      (owner_user_id, id, session_id, exercise_definition_id, order_index,
       name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_SX}', '${A_SESS}', '${A_EDEF}', 0,
            'A SX', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_sets
      (owner_user_id, id, session_exercise_id, order_index,
       weight_value, reps_value, created_at, updated_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_SET}', '${A_SX}', 0,
            '100', '8', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.session_exercise_tags
      (owner_user_id, id, session_exercise_id, exercise_tag_definition_id,
       created_at, client_updated_at_ms)
    values ('${USER_A_UUID}'::uuid, '${A_SXTAG}', '${A_SX}', '${A_ETD}',
            ${NOW_MS}, ${NOW_MS});

    insert into app_public.gyms
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}'::uuid, '${B_GYM}', 'B Gym', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  commit;
" >/dev/null

# Set the GUCs with `set local` (which prints no result rows) so the only
# tuple in the transaction's output is the function's returned count; the
# trailing COMMIT is a status line, not a tuple. Extract the lone all-digits
# line so we never pick up COMMIT or a GUC echo.
deleted="$(run_psql_sql "
  begin;
    set local request.jwt.claims = '$(printf '{"sub":"%s","role":"authenticated"}' "${USER_A_UUID}")';
    set local app.env = 'local';
    select app_public.dev_wipe_my_data();
  commit;
" | grep -E '^[0-9]+$' | head -n1)"

if [[ "${deleted}" != "8" ]]; then
  fail "scenario 3 expected 8 rows deleted, got '${deleted}'"
fi
pass "scenario 3: helper returned rows_deleted = 8"

remaining_a="$(run_psql "
  select
    (select count(*) from app_public.gyms                     where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_GYM}')
  + (select count(*) from app_public.exercise_definitions     where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_EDEF}')
  + (select count(*) from app_public.exercise_tag_definitions where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_ETD}')
  + (select count(*) from app_public.sessions                 where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_SESS}')
  + (select count(*) from app_public.exercise_muscle_mappings where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_EMM}')
  + (select count(*) from app_public.session_exercises        where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_SX}')
  + (select count(*) from app_public.exercise_sets            where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_SET}')
  + (select count(*) from app_public.session_exercise_tags    where owner_user_id = '${USER_A_UUID}'::uuid and id = '${A_SXTAG}');
")"
if [[ "${remaining_a}" != "0" ]]; then
  fail "scenario 3 expected all of user A's rows gone, ${remaining_a} remain"
fi
pass "scenario 3: every one of the caller's rows was deleted"

remaining_b="$(run_psql "select count(*) from app_public.gyms where owner_user_id = '${USER_B_UUID}'::uuid and id = '${B_GYM}';")"
if [[ "${remaining_b}" != "1" ]]; then
  fail "scenario 3 expected user B's gym to survive, count=${remaining_b}"
fi
pass "scenario 3: a second user's rows were left untouched"

echo "[dev-wipe] all assertions passed"
