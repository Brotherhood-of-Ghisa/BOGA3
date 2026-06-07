#!/usr/bin/env bash

# tFINAL integration test — Clean migration tree (plan outcomes 1, 2, 3).
#
# Asserts, against the live local stack (already reset + migrations applied by
# the slow-gate wrapper), that the sync v2 clean-room migration produces the
# end-state required by plan.md ## Outcomes #1–#3:
#
#   #1  v1 sync objects absent (sync_apply_projection_event,
#       sync_events_ingest, sync_events_ingest_impl, sync_ingest_failure,
#       sync_device_ingest_state, sync_ingested_events); all nine v2 tables
#       present in app_public.
#   #2  Each of the nine tables has composite PK (owner_user_id, id),
#       universal columns (owner_user_id, client_updated_at_ms,
#       server_received_at, deleted_at), the per-table btree indexes,
#       and ZERO CHECK constraints (per t1 §1, "no server validation").
#   #3  Each table has the two universal triggers
#       (<table>_touch_server_received_at, <table>_owner_user_id_immutable);
#       the enforce_owner_user_id_immutable function body contains the
#       literal strings 'IS DISTINCT FROM' and 'auth.uid() IS NULL'
#       (NULL-safe form per t1 §6.3).
#
# This script overlaps with sync-v2-schema-smoke.sh but reads the catalogs at
# the integration level (column-type assertions, function-body introspection)
# rather than only existence checks. The two suites complement each other —
# the per-task smoke runs in t1's wrapper; this script runs in the tFINAL
# wrapper, after t2/t3/t4 have stacked on top.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

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
  echo "[sync-v2-clean-room] need either host psql or running supabase_db_* container." >&2
  exit 1
}

select_psql_mode
load_supabase_status_env

if [[ "${PSQL_MODE}" == "host" && -z "${DB_URL:-}" ]]; then
  echo "[sync-v2-clean-room] DB_URL not set; is the local stack running?" >&2
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

fail() {
  echo "[sync-v2-clean-room] FAIL: $*" >&2
  exit 1
}
pass() {
  echo "[sync-v2-clean-room] pass: $*"
}

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

# -----------------------------------------------------------------------------
# Plan outcome #1.A — v1 sync objects absent.
# -----------------------------------------------------------------------------

V1_FUNCTIONS=(
  sync_apply_projection_event
  sync_apply_projection_event_strict_20260515190609
  sync_events_ingest
  sync_events_ingest_impl
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
pass "outcome #1.A — v1 sync functions absent from pg_proc"

V1_TABLES=(sync_device_ingest_state sync_ingested_events)
for tbl in "${V1_TABLES[@]}"; do
  count="$(run_psql "
    select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${tbl}'
       and c.relkind = 'r';
  ")"
  if [[ "${count}" != "0" ]]; then
    fail "v1 table app_public.${tbl} still present (count=${count})"
  fi
done
pass "outcome #1.A — v1 sync-state tables absent from pg_class"

# -----------------------------------------------------------------------------
# Plan outcome #1.B — all nine v2 entity tables present.
# -----------------------------------------------------------------------------

for entity in "${ENTITIES[@]}"; do
  count="$(run_psql "
    select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${entity}'
       and c.relkind = 'r';
  ")"
  if [[ "${count}" != "1" ]]; then
    fail "expected app_public.${entity} to exist (got count=${count})"
  fi
done
pass "outcome #1.B — nine v2 entity tables present in app_public"

# -----------------------------------------------------------------------------
# Plan outcome #2 — schema shape: composite PK, universal columns with correct
# types, per-table owner_received index, zero CHECK constraints.
# -----------------------------------------------------------------------------

# 2.A — composite PK (owner_user_id, id).
for entity in "${ENTITIES[@]}"; do
  pk_cols="$(run_psql "
    select string_agg(a.attname, ',' order by k.n)
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join lateral unnest(con.conkey) with ordinality as k(attnum, n) on true
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
     where n.nspname = 'app_public'
       and c.relname = '${entity}'
       and con.contype = 'p';
  ")"
  if [[ "${pk_cols}" != "owner_user_id,id" ]]; then
    fail "${entity}: expected composite PK (owner_user_id, id); got '${pk_cols}'"
  fi
done
pass "outcome #2.A — composite (owner_user_id, id) PK on every entity"

# 2.B — universal columns present with correct Postgres types.
# (owner_user_id uuid, client_updated_at_ms bigint, server_received_at
# timestamptz, deleted_at bigint per t1 §2.)
#
# Parallel arrays (not assoc array) to keep this portable to older bash on
# macOS dev boxes where `declare -A` interacts badly with `set -u`.
UNIVERSAL_COLS=(owner_user_id client_updated_at_ms server_received_at deleted_at)
UNIVERSAL_TYPES_LIST=("uuid" "bigint" "timestamp with time zone" "bigint")
for entity in "${ENTITIES[@]}"; do
  for i in 0 1 2 3; do
    col="${UNIVERSAL_COLS[$i]}"
    expected="${UNIVERSAL_TYPES_LIST[$i]}"
    actual="$(run_psql "
      select data_type
        from information_schema.columns
       where table_schema = 'app_public'
         and table_name = '${entity}'
         and column_name = '${col}';
    ")"
    if [[ -z "${actual}" ]]; then
      fail "${entity}.${col}: column missing"
    fi
    if [[ "${actual}" != "${expected}" ]]; then
      fail "${entity}.${col}: expected data_type='${expected}', got '${actual}'"
    fi
  done
done
pass "outcome #2.B — universal columns (owner_user_id uuid, client_updated_at_ms bigint, server_received_at timestamptz, deleted_at bigint) present on every entity"

# 2.C — per-table owner_received_idx present (composite index on
# (owner_user_id, server_received_at)). This is the index the sync_pull RPC
# plans against; t1 §2 requires it on every entity.
for entity in "${ENTITIES[@]}"; do
  idx_name="${entity}_owner_received_idx"
  count="$(run_psql "
    select count(*)
      from pg_indexes
     where schemaname = 'app_public'
       and tablename = '${entity}'
       and indexname = '${idx_name}';
  ")"
  if [[ "${count}" != "1" ]]; then
    fail "${entity}: expected index ${idx_name} (got count=${count})"
  fi
done
pass "outcome #2.C — <table>_owner_received_idx present on every entity"

# 2.D — zero CHECK constraints on every entity (t1 §1 "no server validation").
for entity in "${ENTITIES[@]}"; do
  count="$(run_psql "
    select count(*)
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = '${entity}'
       and con.contype = 'c';
  ")"
  if [[ "${count}" != "0" ]]; then
    fail "${entity}: expected 0 CHECK constraints; got ${count}"
  fi
done
pass "outcome #2.D — zero CHECK constraints on any of the nine entity tables"

# -----------------------------------------------------------------------------
# Plan outcome #3 — triggers + immutability function body.
# -----------------------------------------------------------------------------

# 3.A — two universal triggers per entity.
for entity in "${ENTITIES[@]}"; do
  for trig in "${entity}_touch_server_received_at" "${entity}_owner_user_id_immutable"; do
    count="$(run_psql "
      select count(*)
        from information_schema.triggers
       where event_object_schema = 'app_public'
         and event_object_table = '${entity}'
         and trigger_name = '${trig}';
    ")"
    # information_schema.triggers reports one row per event (INSERT/UPDATE/DELETE
    # on a single CREATE TRIGGER). The clean-room migration creates each named
    # trigger for BEFORE UPDATE only, so the expected row count is 1. Use
    # `>= 1` defensively in case a future migration adds extra events with the
    # same name (still satisfies "trigger present").
    if [[ "${count}" -lt 1 ]]; then
      fail "${entity}: expected trigger ${trig} (got count=${count})"
    fi
  done
done
pass "outcome #3.A — both <table>_touch_server_received_at and <table>_owner_user_id_immutable triggers present on every entity"

# 3.B — enforce_owner_user_id_immutable function body contains the literal
# 'IS DISTINCT FROM' and 'auth.uid() IS NULL' tokens (NULL-safe form per
# t1 §6.3). Compare case-insensitively because Postgres normalises some SQL
# tokens on prosrc storage; the t1 §6.3 canonical text uses lowercase, so we
# do a lowercase substring match.
PROSRC="$(run_psql "
  select prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_public'
     and p.proname = 'enforce_owner_user_id_immutable';
")"
if [[ -z "${PROSRC}" ]]; then
  fail "enforce_owner_user_id_immutable function body could not be read from pg_proc"
fi
PROSRC_LC="$(printf '%s' "${PROSRC}" | tr '[:upper:]' '[:lower:]')"
if [[ "${PROSRC_LC}" != *"is distinct from"* ]]; then
  fail "enforce_owner_user_id_immutable body does not contain 'IS DISTINCT FROM'"
fi
if [[ "${PROSRC_LC}" != *"auth.uid() is null"* ]]; then
  fail "enforce_owner_user_id_immutable body does not contain 'auth.uid() IS NULL' guard"
fi
pass "outcome #3.B — enforce_owner_user_id_immutable body uses IS DISTINCT FROM and explicit auth.uid() IS NULL guard"

echo "[sync-v2-clean-room] all assertions passed"
