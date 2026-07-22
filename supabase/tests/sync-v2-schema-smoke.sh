#!/usr/bin/env bash

# Sync v2 schema smoke test.
#
# Asserts, against the freshly-reset local database, that the clean-room
# migration in supabase/migrations/<ts>_sync_v2_clean_room.sql produced exactly
# the shape docs/specs/tech/sync-v2-server-contract.md Part A prescribes:
#
#   - All nine v2 entity tables exist in app_public.
#   - Every v1 sync server object name is absent from information_schema /
#     pg_catalog.
#   - RLS is enabled on every entity table and the four named policies are
#     present.
#   - Each entity carries the two universal triggers
#     (<table>_touch_server_received_at, <table>_owner_user_id_immutable).
#   - The nine cross-entity FKs are present with condeferrable=true,
#     condeferred=true, and the expected on-delete actions.
#   - Only the M19 load-input-mode CHECK exists; all other entity CHECKs are absent.
#
# Run via `./boga test sync-v2-schema` (run-suite.sh ensures the local
# runtime is up + baseline applied before this script runs). For local
# debug, call this script directly after a
# `supabase db reset --local --yes`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

# psql is invoked either via a host binary (preferred — works against any DB
# URL) or via `docker exec` into the running supabase_db container (fallback
# for local dev boxes without libpq installed). The shared-CI runner that
# executes the slow gate has psql on PATH; this fallback is purely to keep
# the local-dev experience friction-free.
PSQL_MODE="host"
DOCKER_DB_CONTAINER=""

select_psql_mode() {
  if command -v psql >/dev/null 2>&1; then
    PSQL_MODE="host"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    # Resolve the container whose name matches this worktree's project_id, via
    # the shared helper in _common.sh. An unscoped `head -n1` would pick the
    # wrong container when multiple agent worktrees share a Docker engine, so
    # resolve_db_container has NO such fallback — it errors clearly instead.
    DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
    PSQL_MODE="docker"
    return 0
  fi

  echo "[sync-v2-smoke] need either a host psql binary or a running supabase_db_* container." >&2
  echo "[sync-v2-smoke] install libpq (\`brew install libpq && brew link --force libpq\`) or run \`supabase start\`." >&2
  exit 1
}

select_psql_mode
load_supabase_status_env

if [[ "${PSQL_MODE}" == "host" && -z "${DB_URL:-}" ]]; then
  echo "[sync-v2-smoke] DB_URL is not set after loading supabase status; is the local stack running?" >&2
  exit 1
fi

run_psql() {
  # -A: unaligned, -t: tuples-only, -X: ignore .psqlrc, -v ON_ERROR_STOP=1.
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

fail() {
  echo "[sync-v2-smoke] FAIL: $*" >&2
  exit 1
}

pass() {
  echo "[sync-v2-smoke] pass: $*"
}

# -----------------------------------------------------------------------------
# 1. All nine v2 entity tables exist in app_public.
# -----------------------------------------------------------------------------

ENTITIES=(
  gyms
  exercise_definitions
  muscle_groups
  exercise_tag_definitions
  sessions
  exercise_muscle_mappings
  session_exercises
  exercise_sets
  session_exercise_tags
)

for entity in "${ENTITIES[@]}"; do
  count="$(run_psql "
    select count(*)
      from information_schema.tables
     where table_schema = 'app_public'
       and table_name = '${entity}';
  ")"
  if [[ "${count}" != "1" ]]; then
    fail "expected app_public.${entity} to exist (got count=${count})"
  fi
done
pass "all nine v2 entity tables present"

# -----------------------------------------------------------------------------
# 2. Every v1 sync server object name is absent.
# -----------------------------------------------------------------------------

# v1 functions that must be gone.
V1_FUNCTIONS=(
  sync_events_ingest
  sync_events_ingest_impl
  sync_apply_projection_event
  sync_apply_projection_event_strict_20260515190609
  sync_ingest_failure
  sync_apply_gym_coordinates_from_ingested_event
)
for fn in "${V1_FUNCTIONS[@]}"; do
  count="$(run_psql "
    select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public'
       and p.proname = '${fn}';
  ")"
  if [[ "${count}" != "0" ]]; then
    fail "v1 function app_public.${fn} still present (count=${count})"
  fi
done
pass "all v1 sync functions absent"

# v1 sync-state tables that must be gone.
V1_TABLES=(
  sync_device_ingest_state
  sync_ingested_events
)
for tbl in "${V1_TABLES[@]}"; do
  count="$(run_psql "
    select count(*)
      from information_schema.tables
     where table_schema = 'app_public'
       and table_name = '${tbl}';
  ")"
  if [[ "${count}" != "0" ]]; then
    fail "v1 table app_public.${tbl} still present (count=${count})"
  fi
done
pass "all v1 sync-state tables absent"

# -----------------------------------------------------------------------------
# 3. RLS enabled with the four named policies per entity.
# -----------------------------------------------------------------------------

for entity in "${ENTITIES[@]}"; do
  rls_enabled="$(run_psql "
    select case when c.relrowsecurity then 1 else 0 end
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${entity}';
  ")"
  if [[ "${rls_enabled}" != "1" ]]; then
    fail "RLS not enabled on app_public.${entity} (got '${rls_enabled}')"
  fi

  for policy in "${entity}_owner_select" "${entity}_owner_insert" "${entity}_owner_update" "${entity}_owner_delete"; do
    count="$(run_psql "
      select count(*)
        from pg_policies
       where schemaname = 'app_public'
         and tablename = '${entity}'
         and policyname = '${policy}';
    ")"
    if [[ "${count}" != "1" ]]; then
      fail "expected policy ${policy} on app_public.${entity} (got count=${count})"
    fi
  done
done
pass "RLS enabled and four owner policies present on every entity table"

# -----------------------------------------------------------------------------
# 4. Two universal triggers per entity.
# -----------------------------------------------------------------------------

for entity in "${ENTITIES[@]}"; do
  for trig in "${entity}_touch_server_received_at" "${entity}_owner_user_id_immutable"; do
    count="$(run_psql "
      select count(*)
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app_public'
         and c.relname = '${entity}'
         and t.tgname = '${trig}'
         and not t.tgisinternal;
    ")"
    if [[ "${count}" != "1" ]]; then
      fail "expected trigger ${trig} on app_public.${entity} (got count=${count})"
    fi
  done
done
pass "both universal triggers present on every entity table"

# -----------------------------------------------------------------------------
# 5. The nine deferrable composite FKs.
#
# Map: <constraint_name>|<expected_confdeltype>
#   confdeltype values: 'a' = no action, 'c' = cascade, 'n' = set null,
#                       'r' = restrict, 'd' = set default.
# Per docs/specs/tech/sync-v2-server-contract.md §A.5.2:
#   sessions_gym_fk                                  on delete set null   -> n
#   session_exercises_session_fk                     on delete cascade    -> c
#   session_exercises_exercise_definition_fk         on delete no action  -> a
#   exercise_sets_session_exercise_fk                on delete cascade    -> c
#   exercise_muscle_mappings_exercise_definition_fk  on delete cascade    -> c
#   exercise_muscle_mappings_muscle_group_fk         on delete cascade    -> c
#   exercise_tag_definitions_exercise_definition_fk  on delete cascade    -> c
#   session_exercise_tags_session_exercise_fk        on delete cascade    -> c
#   session_exercise_tags_exercise_tag_definition_fk on delete cascade    -> c
# -----------------------------------------------------------------------------

FK_EXPECTATIONS=(
  "sessions|sessions_gym_fk|n"
  "session_exercises|session_exercises_session_fk|c"
  "session_exercises|session_exercises_exercise_definition_fk|a"
  "exercise_sets|exercise_sets_session_exercise_fk|c"
  "exercise_muscle_mappings|exercise_muscle_mappings_exercise_definition_fk|c"
  "exercise_muscle_mappings|exercise_muscle_mappings_muscle_group_fk|c"
  "exercise_tag_definitions|exercise_tag_definitions_exercise_definition_fk|c"
  "session_exercise_tags|session_exercise_tags_session_exercise_fk|c"
  "session_exercise_tags|session_exercise_tags_exercise_tag_definition_fk|c"
)

for spec in "${FK_EXPECTATIONS[@]}"; do
  IFS='|' read -r table fk_name expected_delete <<<"${spec}"
  row="$(run_psql "
    select con.contype::text
        || '|' || (case when con.condeferrable then 1 else 0 end)::text
        || '|' || (case when con.condeferred then 1 else 0 end)::text
        || '|' || con.confdeltype::text
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${table}'
       and con.conname = '${fk_name}';
  ")"
  if [[ -z "${row}" ]]; then
    fail "FK ${fk_name} on app_public.${table} not found"
  fi

  IFS='|' read -r contype condeferrable condeferred confdeltype <<<"${row}"
  if [[ "${contype}" != "f" ]]; then
    fail "${fk_name}: expected contype=f (foreign key), got '${contype}'"
  fi
  if [[ "${condeferrable}" != "1" ]]; then
    fail "${fk_name}: expected condeferrable=true, got '${condeferrable}'"
  fi
  if [[ "${condeferred}" != "1" ]]; then
    fail "${fk_name}: expected condeferred=true (INITIALLY DEFERRED), got '${condeferred}'"
  fi
  if [[ "${confdeltype}" != "${expected_delete}" ]]; then
    fail "${fk_name}: expected confdeltype=${expected_delete}, got '${confdeltype}'"
  fi
done
pass "nine composite FKs present with condeferrable=t, condeferred=t, expected on-delete actions"

# -----------------------------------------------------------------------------
# 6. Only the M19 load-input-mode CHECK is allowed (contract §A.1).
# -----------------------------------------------------------------------------

for entity in "${ENTITIES[@]}"; do
  names="$(run_psql "
    select coalesce(string_agg(con.conname, ',' order by con.conname), '')
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${entity}'
       and con.contype = 'c';
  ")"
  expected=""
  if [[ "${entity}" == "exercise_definitions" ]]; then
    expected="exercise_definitions_load_input_mode_valid"
  fi
  if [[ "${names}" != "${expected}" ]]; then
    fail "app_public.${entity} CHECK constraints '${names}'; expected '${expected}' per docs/specs/tech/sync-v2-server-contract.md §A.1"
  fi
done
pass "only the M19 load-input-mode CHECK is present across v2 entity tables"

echo "[sync-v2-smoke] all assertions passed"
