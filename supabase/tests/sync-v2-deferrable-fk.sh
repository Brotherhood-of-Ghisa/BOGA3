#!/usr/bin/env bash

# Integration test — deferrable FKs.
#
# Asserts the two halves of the deferrable-FK contract from docs/specs/tech/sync-v2-server-contract.md §A.5.2:
#
#   A. All nine cross-entity FKs are present in information_schema.
#      referential_constraints with is_deferrable='YES' and
#      initially_deferred='YES'.
#   B. A transaction that inserts a complete FK chain in child-before-parent
#      order COMMITS without a "row violates foreign key constraint" error.
#      The child must reference a not-yet-existing parent at the row's INSERT
#      time, and the parent must reference a not-yet-existing grandparent.
#      With INITIALLY DEFERRED FKs, the check happens at COMMIT, by which
#      time the closure is complete.
#
# This is integration-level on top of the per-table schema smoke (which only
# checks pg_constraint.condeferred). The transaction-level assertion is the
# behaviour the push RPC relies on (docs/specs/tech/sync-v2-server-contract.md §B.3.2
# "SET CONSTRAINTS ALL DEFERRED inside the function").

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
  if command -v psql >/dev/null 2>&1; then
    PSQL_MODE="host"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    # Resolve strictly by this worktree's project_id (resolve_db_container in
    # _common.sh errors if this worktree's stack is down — no unscoped
    # head -n1 fallback that could target a foreign worktree's DB).
    DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
    PSQL_MODE="docker"
    return 0
  fi
  echo "[sync-v2-deferrable-fk] need host psql or supabase_db_* container." >&2
  exit 1
}

select_psql_mode
load_supabase_status_env

if [[ "${PSQL_MODE}" == "host" && -z "${DB_URL:-}" ]]; then
  echo "[sync-v2-deferrable-fk] DB_URL not set; is the local stack running?" >&2
  exit 1
fi

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

fail() { echo "[sync-v2-deferrable-fk] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-deferrable-fk] pass: $*"; }

# -----------------------------------------------------------------------------
# A. All nine cross-entity FKs deferrable + initially deferred.
#
# Map (constraint_name -> child_table) per docs/specs/tech/sync-v2-server-contract.md §A.5.2.
# -----------------------------------------------------------------------------

FK_SPECS=(
  "sessions|sessions_gym_fk"
  "session_exercises|session_exercises_session_fk"
  "session_exercises|session_exercises_exercise_definition_fk"
  "exercise_sets|exercise_sets_session_exercise_fk"
  "exercise_muscle_mappings|exercise_muscle_mappings_exercise_definition_fk"
  "exercise_muscle_mappings|exercise_muscle_mappings_muscle_group_fk"
  "exercise_tag_definitions|exercise_tag_definitions_exercise_definition_fk"
  "session_exercise_tags|session_exercise_tags_session_exercise_fk"
  "session_exercise_tags|session_exercise_tags_exercise_tag_definition_fk"
)

for spec in "${FK_SPECS[@]}"; do
  IFS='|' read -r table fk_name <<<"${spec}"
  # The deferrable/initially_deferred flags live on
  # information_schema.table_constraints (the referential_constraints view
  # exposes update_rule / delete_rule / match_option only, per the SQL spec).
  # We join the two views by constraint_name to confirm the row is BOTH a
  # foreign-key constraint AND deferrable / initially-deferred.
  row="$(run_psql "
    select tc.is_deferrable || '|' || tc.initially_deferred
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc
        on rc.constraint_schema = tc.constraint_schema
       and rc.constraint_name = tc.constraint_name
     where tc.constraint_schema = 'app_public'
       and tc.constraint_name = '${fk_name}'
       and tc.constraint_type = 'FOREIGN KEY';
  ")"
  if [[ -z "${row}" ]]; then
    fail "FK ${fk_name} (child table app_public.${table}) not found via information_schema.referential_constraints + table_constraints"
  fi
  IFS='|' read -r is_deferrable initially_deferred <<<"${row}"
  if [[ "${is_deferrable}" != "YES" ]]; then
    fail "${fk_name}: expected is_deferrable=YES, got '${is_deferrable}'"
  fi
  if [[ "${initially_deferred}" != "YES" ]]; then
    fail "${fk_name}: expected initially_deferred=YES, got '${initially_deferred}'"
  fi
done
pass "deferrable-fk A — nine expected FKs present with is_deferrable=YES and initially_deferred=YES (information_schema.referential_constraints joined to .table_constraints)"

# Also check: exactly 9 cross-entity FKs in app_public schema with both flags
# set. (The auth.users CASCADE FKs from each entity's owner_user_id sit in
# information_schema with unique_constraint_schema='auth', so they don't show
# up under app_public; the nine here are exactly the cross-entity set.)
TOTAL_DEFERRED_FKS="$(run_psql "
  select count(*)
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_schema = rc.constraint_schema
     and tc.constraint_name = rc.constraint_name
   where rc.constraint_schema = 'app_public'
     and rc.unique_constraint_schema = 'app_public'
     and tc.constraint_type = 'FOREIGN KEY'
     and tc.is_deferrable = 'YES'
     and tc.initially_deferred = 'YES';
")"
if [[ "${TOTAL_DEFERRED_FKS}" != "9" ]]; then
  fail "expected exactly 9 deferrable+initially-deferred app_public→app_public FKs; got ${TOTAL_DEFERRED_FKS}"
fi
pass "deferrable-fk A — exactly 9 cross-entity deferrable FKs in app_public"

# -----------------------------------------------------------------------------
# B. Behavioural: insert children before parents inside one transaction.
#
# Pick user_a's UUID from the fixture-principals row. We then run a single
# transaction that:
#   1. SET CONSTRAINTS ALL DEFERRED  (matches the push RPC's pattern)
#   2. INSERT exercise_sets (FK -> session_exercises that does not exist yet)
#   3. INSERT session_exercises (FK -> sessions that does not exist yet,
#                                 FK -> exercise_definitions that does not
#                                 exist yet)
#   4. INSERT sessions (FK -> gyms that does not exist yet)
#   5. INSERT exercise_definitions
#   6. INSERT gyms
#   7. COMMIT.
#
# If FKs were IMMEDIATE the second step would fail with foreign_key_violation.
# With INITIALLY DEFERRED the check happens at COMMIT; by then the chain is
# closed and the transaction succeeds.
# -----------------------------------------------------------------------------

USER_A_UUID="$(run_psql "
  select subject_uuid
    from public.dev_fixture_principals
   where fixture_key = '${USER_A_FIXTURE_KEY}';
")"
[[ -n "${USER_A_UUID}" ]] || fail "could not resolve USER_A_UUID from dev_fixture_principals"

RUN_TAG="${SYNC_FK_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"

GYM_ID="fk-gym-${RUN_TAG}"
EDEF_ID="fk-edef-${RUN_TAG}"
SESSION_ID="fk-session-${RUN_TAG}"
SX_ID="fk-sx-${RUN_TAG}"
SET_ID="fk-set-${RUN_TAG}"

NOW_MS="$(($(date +%s) * 1000))"

cleanup_rows() {
  run_psql_sql "
    delete from app_public.exercise_sets        where id = 'fk-set-${RUN_TAG}'    and owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.session_exercises    where id = 'fk-sx-${RUN_TAG}'     and owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.sessions             where id = 'fk-session-${RUN_TAG}' and owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.exercise_definitions where id = 'fk-edef-${RUN_TAG}'   and owner_user_id = '${USER_A_UUID}'::uuid;
    delete from app_public.gyms                 where id = 'fk-gym-${RUN_TAG}'    and owner_user_id = '${USER_A_UUID}'::uuid;
  " >/dev/null 2>&1 || true
}
cleanup_rows
trap cleanup_rows EXIT

# Single transaction; child first, parents last. If any per-statement FK check
# fires immediately the script will exit with the psql error.
run_psql_sql "
  begin;
    set constraints all deferred;

    insert into app_public.exercise_sets
      (owner_user_id, id, session_exercise_id, order_index,
       weight_value, reps_value, created_at, updated_at,
       client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, '${SET_ID}', '${SX_ID}', 0,
       '100', '8', ${NOW_MS}, ${NOW_MS},
       ${NOW_MS});

    insert into app_public.session_exercises
      (owner_user_id, id, session_id, exercise_definition_id, order_index,
       name, created_at, updated_at, client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, '${SX_ID}', '${SESSION_ID}', '${EDEF_ID}', 0,
       'Bench Press', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.sessions
      (owner_user_id, id, gym_id, status, started_at,
       created_at, updated_at, client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, '${SESSION_ID}', '${GYM_ID}', 'active', ${NOW_MS},
       ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.exercise_definitions
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, '${EDEF_ID}', 'Bench Press', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

    insert into app_public.gyms
      (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, '${GYM_ID}', 'Iron Temple', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});

  commit;
" >/dev/null

# Spot-check every row landed.
SET_LANDED="$(run_psql "
  select count(*)
    from app_public.exercise_sets
   where owner_user_id = '${USER_A_UUID}'::uuid
     and id = '${SET_ID}';
")"
if [[ "${SET_LANDED}" != "1" ]]; then
  fail "deferred-FK txn committed but exercise_sets row missing (count=${SET_LANDED})"
fi

SX_LANDED="$(run_psql "
  select count(*)
    from app_public.session_exercises
   where owner_user_id = '${USER_A_UUID}'::uuid
     and id = '${SX_ID}';
")"
if [[ "${SX_LANDED}" != "1" ]]; then
  fail "deferred-FK txn committed but session_exercises row missing (count=${SX_LANDED})"
fi

SESS_LANDED="$(run_psql "
  select count(*)
    from app_public.sessions
   where owner_user_id = '${USER_A_UUID}'::uuid
     and id = '${SESSION_ID}';
")"
if [[ "${SESS_LANDED}" != "1" ]]; then
  fail "deferred-FK txn committed but sessions row missing (count=${SESS_LANDED})"
fi

pass "deferrable-fk B — child-before-parent chain commits inside one deferrable-FK transaction"

# Negative control: with FKs forced IMMEDIATE the same payload must fail.
# We expect the SET CONSTRAINTS ALL IMMEDIATE statement to error or, failing
# that, the first child INSERT to surface foreign_key_violation. Either way
# `run_psql_sql` returns non-zero — we wrap in `set +e` to capture it.
echo "[sync-v2-deferrable-fk] negative control: same payload with FKs IMMEDIATE should error"
set +e
run_psql_sql "
  begin;
    set constraints all immediate;
    insert into app_public.exercise_sets
      (owner_user_id, id, session_exercise_id, order_index,
       weight_value, reps_value, created_at, updated_at,
       client_updated_at_ms)
    values
      ('${USER_A_UUID}'::uuid, 'fk-neg-set-${RUN_TAG}', 'fk-neg-sx-${RUN_TAG}', 0,
       '100', '8', ${NOW_MS}, ${NOW_MS},
       ${NOW_MS});
  commit;
" >/dev/null 2>&1
neg_rc=$?
set -e
if [[ "${neg_rc}" == "0" ]]; then
  fail "negative control: insert with FKs IMMEDIATE unexpectedly committed (rc=0)"
fi
pass "deferrable-fk B — negative control: IMMEDIATE FKs reject the same orphan insert (rc=${neg_rc})"

echo "[sync-v2-deferrable-fk] all assertions passed"
