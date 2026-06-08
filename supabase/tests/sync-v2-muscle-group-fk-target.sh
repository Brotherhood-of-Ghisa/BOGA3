#!/usr/bin/env bash

# Integration test — the muscle-group mapping FK is a real composite FK into the
# per-user muscle_groups taxonomy.
#
# The per-table schema smoke and the deferrable-FK suite already confirm the
# constraint named exercise_muscle_mappings_muscle_group_fk exists, is deferrable
# + initially deferred, and cascades on delete. This test pins the one thing
# those do not: the EXACT composite column mapping —
#
#   exercise_muscle_mappings (owner_user_id, muscle_group_id)
#     -> app_public.muscle_groups (owner_user_id, id)
#
# i.e. that the child key is the ordered pair (owner_user_id, muscle_group_id),
# the referenced table is app_public.muscle_groups, and the referenced key is the
# ordered pair (owner_user_id, id) — its composite primary key. A regression that
# silently re-pointed the FK at the wrong column (or dropped owner_user_id from
# the key) would still pass the name/deferrable checks but fail here.
#
# Run via the e2e wrapper (test-sync-v2-e2e.sh), which ensures the local runtime
# baseline first. For local debug, run directly after a
# `supabase db reset --local --yes`.

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
    # Resolve strictly by this worktree's project_id (resolve_db_container errors
    # if this worktree's stack is down — no unscoped head -n1 fallback that could
    # target a foreign worktree's DB).
    DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
    PSQL_MODE="docker"
    return 0
  fi
  echo "[sync-v2-mg-fk-target] need host psql or supabase_db_* container." >&2
  exit 1
}

select_psql_mode
load_supabase_status_env

if [[ "${PSQL_MODE}" == "host" && -z "${DB_URL:-}" ]]; then
  echo "[sync-v2-mg-fk-target] DB_URL not set; is the local stack running?" >&2
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

fail() { echo "[sync-v2-mg-fk-target] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-mg-fk-target] pass: $*"; }

# Child key column list, in constraint-key order, for the mapping FK.
CHILD_COLS="$(run_psql "
  select string_agg(a.attname, ',' order by k.n)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(con.conkey) with ordinality as k(attnum, n) on true
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
   where n.nspname = 'app_public'
     and c.relname = 'exercise_muscle_mappings'
     and con.conname = 'exercise_muscle_mappings_muscle_group_fk'
     and con.contype = 'f';
")"
if [[ "${CHILD_COLS}" != "owner_user_id,muscle_group_id" ]]; then
  fail "expected child key (owner_user_id, muscle_group_id); got '${CHILD_COLS}'"
fi
pass "child key is the ordered composite (owner_user_id, muscle_group_id)"

# Referenced (parent) table — must be app_public.muscle_groups.
PARENT_TABLE="$(run_psql "
  select pn.nspname || '.' || pc.relname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class pc on pc.oid = con.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
   where n.nspname = 'app_public'
     and c.relname = 'exercise_muscle_mappings'
     and con.conname = 'exercise_muscle_mappings_muscle_group_fk'
     and con.contype = 'f';
")"
if [[ "${PARENT_TABLE}" != "app_public.muscle_groups" ]]; then
  fail "expected referenced table app_public.muscle_groups; got '${PARENT_TABLE}'"
fi
pass "referenced table is app_public.muscle_groups"

# Referenced (parent) key column list, in constraint-key order — must be the
# composite PK (owner_user_id, id).
PARENT_COLS="$(run_psql "
  select string_agg(a.attname, ',' order by k.n)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(con.confkey) with ordinality as k(attnum, n) on true
    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum
   where n.nspname = 'app_public'
     and c.relname = 'exercise_muscle_mappings'
     and con.conname = 'exercise_muscle_mappings_muscle_group_fk'
     and con.contype = 'f';
")"
if [[ "${PARENT_COLS}" != "owner_user_id,id" ]]; then
  fail "expected referenced key (owner_user_id, id); got '${PARENT_COLS}'"
fi
pass "referenced key is the ordered composite (owner_user_id, id)"

echo "[sync-v2-mg-fk-target] all assertions passed"
