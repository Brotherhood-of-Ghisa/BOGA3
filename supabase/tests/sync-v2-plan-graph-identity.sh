#!/usr/bin/env bash

# Integration test — plan graph triggers never change the request identity.
#
# The graph_version triggers on session_plan_exercises / session_plan_sets run
# before RLS WITH CHECK. If a trigger set the request identity from a row's
# owner_user_id, a signed-in user could write rows claiming another owner.
# This suite proves, through PostgREST with user A's JWT, that A cannot
# INSERT, upsert over, UPDATE or DELETE user B's session_plans,
# session_plan_exercises or session_plan_sets rows, and that B's rows
# (graph_version included) are byte-identical afterwards. It also proves:
#
#   - A's own block insert still succeeds and advances A's plan graph_version;
#   - an identity-less delete cascade (deleting an auth user who owns a full
#     programme/plan/block/set graph) still succeeds;
#   - catalog: no trigger function on an app_public table sets a
#     request.jwt.* setting, and every function that does is unreachable by
#     public, anon and authenticated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/auth-fixture-constants.sh"

fail() { echo "[plan-graph-identity] FAIL: $*" >&2; exit 1; }
pass() { echo "[plan-graph-identity] pass: $*"; }

command -v jq >/dev/null 2>&1 || fail "jq is required"

PSQL_MODE="host"
DOCKER_DB_CONTAINER=""
if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || fail "need host psql or the supabase_db_* container"
  # Strictly this worktree's container (resolve_db_container errors — no
  # unscoped fallback that could target a foreign worktree's DB).
  DOCKER_DB_CONTAINER="$(resolve_db_container)" || exit 1
  PSQL_MODE="docker"
fi
run_psql_sql() {
  case "${PSQL_MODE}" in
    host)   PGPASSWORD="${PGPASSWORD:-postgres}" psql "${DB_URL}" -A -t -X -q -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
    docker) docker exec -e PGPASSWORD=postgres -i "${DOCKER_DB_CONTAINER}" psql -U postgres -d postgres -A -t -X -q -v ON_ERROR_STOP=1 -f - <<<"$1" ;;
  esac
}

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" ]] || fail "missing API_URL/ANON_KEY; is the local stack running?"

token_payload="$(jq -nc --arg email "${USER_A_EMAIL}" --arg password "${USER_A_PASSWORD}" '{email: $email, password: $password}')"
USER_A_TOKEN="$(curl --silent --show-error -X POST \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  --data "${token_payload}" "${API_URL}/auth/v1/token?grant_type=password" | jq -r '.access_token')"
[[ -n "${USER_A_TOKEN}" && "${USER_A_TOKEN}" != "null" ]] || fail "user_a sign-in failed"

USER_A_UUID="$(run_psql_sql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_A_FIXTURE_KEY}';")"
USER_B_UUID="$(run_psql_sql "select subject_uuid from public.dev_fixture_principals where fixture_key = '${USER_B_FIXTURE_KEY}';")"
[[ -n "${USER_A_UUID}" && -n "${USER_B_UUID}" ]] || fail "could not resolve fixture UUIDs"

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-zA-Z0-9-' '-')"
NOW_MS="$(($(date +%s) * 1000))"
B_TP="pgi-${RUN_TAG}-btp"
B_SP="pgi-${RUN_TAG}-bsp"
B_SPE="pgi-${RUN_TAG}-bspe"
B_SPS="pgi-${RUN_TAG}-bsps"
A_SP="pgi-${RUN_TAG}-asp"
A_SPE="pgi-${RUN_TAG}-aspe"
PROBE="pgi-${RUN_TAG}-probe"
DEL_USER="$(uuidgen | tr 'A-Z' 'a-z')"

cleanup() {
  run_psql_sql "
    delete from auth.users where id = '${DEL_USER}'::uuid;
    delete from app_public.session_plan_sets      where id like 'pgi-${RUN_TAG}-%';
    delete from app_public.session_plan_exercises where id like 'pgi-${RUN_TAG}-%';
    delete from app_public.session_plans          where id like 'pgi-${RUN_TAG}-%';
    delete from app_public.training_programmes    where id like 'pgi-${RUN_TAG}-%';
  " >/dev/null 2>&1 || true
}
# Bash 3.2 hands the EXIT trap status 0 after an unbound-variable abort, so a
# run that never reached its last line fails here instead of passing.
COMPLETED=0
on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[plan-graph-identity] FAIL: the run stopped before completing" >&2
    status=1
  fi
  cleanup
  exit "${status}"
}
trap on_exit EXIT

# Seed B's programme → plan → block → set and A's own plan, as the superuser
# with no request identity (the graph triggers skip their bump without one).
run_psql_sql "
  begin;
    set constraints all deferred;
    insert into app_public.training_programmes (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}', '${B_TP}', 'B Programme', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
    insert into app_public.session_plans (owner_user_id, id, programme_id, title, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}', '${B_SP}', '${B_TP}', 'B Plan', ${NOW_MS}, ${NOW_MS}, ${NOW_MS}),
           ('${USER_A_UUID}', '${A_SP}', null, 'A Plan', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
    insert into app_public.session_plan_exercises (owner_user_id, id, session_plan_id, order_index, name, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}', '${B_SPE}', '${B_SP}', 0, 'B Block', ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
    insert into app_public.session_plan_sets (owner_user_id, id, session_plan_exercise_id, order_index, target_reps, created_at, updated_at, client_updated_at_ms)
    values ('${USER_B_UUID}', '${B_SPS}', '${B_SPE}', 0, 8, ${NOW_MS}, ${NOW_MS}, ${NOW_MS});
  commit;
" >/dev/null

# Every column of B's four rows plus any row carrying a probe id, as one hash.
b_snapshot() {
  run_psql_sql "
    select md5(coalesce(string_agg(r, '|' order by r), ''))
      from (
        select to_jsonb(t)::text as r from app_public.training_programmes t where owner_user_id = '${USER_B_UUID}' and id like 'pgi-${RUN_TAG}-%'
        union all select to_jsonb(t)::text from app_public.session_plans t where owner_user_id = '${USER_B_UUID}' and id like 'pgi-${RUN_TAG}-%'
        union all select to_jsonb(t)::text from app_public.session_plan_exercises t where owner_user_id = '${USER_B_UUID}' and id like 'pgi-${RUN_TAG}-%'
        union all select to_jsonb(t)::text from app_public.session_plan_sets t where owner_user_id = '${USER_B_UUID}' and id like 'pgi-${RUN_TAG}-%'
      ) s;"
}
BEFORE="$(b_snapshot)"

# One PostgREST call as user A. Prints the HTTP status.
as_a() {
  local method="$1" path="$2" body="${3:-}" prefer="${4:-return=minimal}"
  curl --silent --output /dev/null --write-out '%{http_code}' -X "${method}" \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${USER_A_TOKEN}" \
    -H "Accept-Profile: app_public" -H "Content-Profile: app_public" \
    -H "Content-Type: application/json" -H "Prefer: ${prefer}" \
    ${body:+--data "${body}"} "${API_URL}/rest/v1/${path}"
}

expect_denied() {
  local label="$1" status="$2"
  [[ "${status}" =~ ^2 ]] && fail "${label}: unexpectedly succeeded (status ${status})"
  pass "${label}: denied (status ${status})"
}

row() { # table id extra-json → a full row claiming owner B
  jq -nc --arg owner "${USER_B_UUID}" --arg id "$2" --argjson now "${NOW_MS}" --argjson extra "$3" \
    '{owner_user_id: $owner, id: $id, created_at: $now, updated_at: $now, client_updated_at_ms: ($now + 1)} + $extra'
}
SP_EXTRA='{"title":"pwned","programme_id":null}'
SPE_EXTRA="$(jq -nc --arg p "${B_SP}" '{session_plan_id: $p, order_index: 9, name: "pwned"}')"
SPS_EXTRA="$(jq -nc --arg b "${B_SPE}" '{session_plan_exercise_id: $b, order_index: 9, target_reps: 99}')"

# INSERT claiming owner B, under B's own parents.
expect_denied "session_plans INSERT claiming owner B" "$(as_a POST session_plans "$(row session_plans "${PROBE}-sp" "${SP_EXTRA}")")"
expect_denied "session_plan_exercises INSERT claiming owner B" "$(as_a POST session_plan_exercises "$(row x "${PROBE}-spe" "${SPE_EXTRA}")")"
expect_denied "session_plan_sets INSERT claiming owner B" "$(as_a POST session_plan_sets "$(row x "${PROBE}-sps" "${SPS_EXTRA}")")"

# Upsert over B's existing primary keys (INSERT … ON CONFLICT DO UPDATE).
UPSERT="resolution=merge-duplicates,return=minimal"
expect_denied "session_plans upsert over B's row" "$(as_a POST session_plans "$(row x "${B_SP}" "${SP_EXTRA}")" "${UPSERT}")"
expect_denied "session_plan_exercises upsert over B's row" "$(as_a POST session_plan_exercises "$(row x "${B_SPE}" "${SPE_EXTRA}")" "${UPSERT}")"
expect_denied "session_plan_sets upsert over B's row" "$(as_a POST session_plan_sets "$(row x "${B_SPS}" "${SPS_EXTRA}")" "${UPSERT}")"

# UPDATE and DELETE by B's ids: RLS hides the rows, so PostgREST reports
# success with zero rows touched; the snapshot below proves nothing changed.
as_a PATCH "session_plans?id=eq.${B_SP}" '{"title":"pwned"}' >/dev/null
as_a PATCH "session_plan_exercises?id=eq.${B_SPE}" '{"name":"pwned"}' >/dev/null
as_a PATCH "session_plan_sets?id=eq.${B_SPS}" '{"target_reps":99}' >/dev/null
as_a DELETE "session_plan_sets?id=eq.${B_SPS}" >/dev/null
as_a DELETE "session_plan_exercises?id=eq.${B_SPE}" >/dev/null
as_a DELETE "session_plans?id=eq.${B_SP}" >/dev/null

AFTER="$(b_snapshot)"
[[ "${AFTER}" == "${BEFORE}" ]] || fail "user B's plan rows changed after user A's writes"
probe_rows="$(run_psql_sql "
  select (select count(*) from app_public.session_plans where id like '${PROBE}%')
       + (select count(*) from app_public.session_plan_exercises where id like '${PROBE}%')
       + (select count(*) from app_public.session_plan_sets where id like '${PROBE}%');")"
[[ "${probe_rows}" == "0" ]] || fail "${probe_rows} probe row(s) were written"
pass "user B's plan, block and set rows (graph_version included) are unchanged"

# A's own block insert succeeds and advances A's plan graph_version.
A_VER_BEFORE="$(run_psql_sql "select graph_version from app_public.session_plans where owner_user_id = '${USER_A_UUID}' and id = '${A_SP}';")"
own_block="$(jq -nc --arg owner "${USER_A_UUID}" --arg id "${A_SPE}" --arg p "${A_SP}" --argjson now "${NOW_MS}" \
  '{owner_user_id: $owner, id: $id, session_plan_id: $p, order_index: 0, name: "A Block", created_at: $now, updated_at: $now, client_updated_at_ms: $now}')"
status="$(as_a POST session_plan_exercises "${own_block}")"
[[ "${status}" == "201" ]] || fail "user A's own block insert returned ${status}"
A_VER_AFTER="$(run_psql_sql "select graph_version > '${A_VER_BEFORE}'::timestamptz from app_public.session_plans where owner_user_id = '${USER_A_UUID}' and id = '${A_SP}';")"
[[ "${A_VER_AFTER}" == "t" ]] || fail "user A's plan graph_version did not advance on an own block insert"
pass "user A's own block insert succeeds and advances A's plan graph_version"

# Deleting an auth user cascades through their whole plan graph with no
# request identity; the graph triggers must not abort it.
run_psql_sql "
  begin;
    insert into auth.users (id, instance_id, aud, role, email)
    values ('${DEL_USER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgi-${RUN_TAG}@example.test');
    set constraints all deferred;
    insert into app_public.training_programmes (owner_user_id, id, name, created_at, updated_at, client_updated_at_ms)
    values ('${DEL_USER}', 'pgi-${RUN_TAG}-dtp', 'P', 1, 1, 1);
    insert into app_public.session_plans (owner_user_id, id, programme_id, title, created_at, updated_at, client_updated_at_ms)
    values ('${DEL_USER}', 'pgi-${RUN_TAG}-dsp', 'pgi-${RUN_TAG}-dtp', 'T', 1, 1, 1);
    insert into app_public.session_plan_exercises (owner_user_id, id, session_plan_id, order_index, name, created_at, updated_at, client_updated_at_ms)
    values ('${DEL_USER}', 'pgi-${RUN_TAG}-dspe', 'pgi-${RUN_TAG}-dsp', 0, 'E', 1, 1, 1);
    insert into app_public.session_plan_sets (owner_user_id, id, session_plan_exercise_id, order_index, target_reps, created_at, updated_at, client_updated_at_ms)
    values ('${DEL_USER}', 'pgi-${RUN_TAG}-dsps', 'pgi-${RUN_TAG}-dspe', 0, 5, 1, 1, 1);
  commit;
" >/dev/null
run_psql_sql "delete from auth.users where id = '${DEL_USER}'::uuid;" >/dev/null \
  || fail "deleting an auth user that owns a plan graph failed"
pass "an auth user's delete cascade through a full plan graph succeeds"

# Catalog: identity is never set from a trigger, and only service-only
# functions may set it.
trigger_setters="$(run_psql_sql "
  select coalesce(string_agg(distinct p.proname, ', '), '')
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where n.nspname = 'app_public' and not t.tgisinternal
     and p.prosrc ~* 'set_config\s*\(\s*''request\.jwt';")"
[[ -z "${trigger_setters}" ]] || fail "trigger function(s) set a request.jwt setting: ${trigger_setters}"
pass "no app_public trigger function sets a request.jwt setting"

reachable_setters="$(run_psql_sql "
  select coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app_public', 'public')
     and p.prosrc ~* 'set_config\s*\(\s*''request\.jwt'
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));")"
[[ -z "${reachable_setters}" ]] || fail "anon/authenticated can execute identity-setting function(s): ${reachable_setters}"
pass "every identity-setting function is unreachable by anon and authenticated"

COMPLETED=1
echo "[plan-graph-identity] all assertions passed"
