#!/usr/bin/env bash

# groups-leaderboards.sh — M25 group evaluator pipeline contract.
#
# Contract: docs/specs/tech/groups-contract.md §2.8–§2.10, §8. Proves, against
# the real local Supabase stack (PostgREST, the group-eval Edge Function, pg_net,
# pg_cron):
#
#   - posture: queue and facts follow the group ground rules; evaluator RPCs are
#     service_role-only; group-eval rejects a missing or wrong secret; the sweep
#     cron job and the enqueue triggers (and their order on sessions) exist;
#   - facts: every set of a shared session normalized by the app's TS rules
#     (performed rule, parsing, per-side entered mode, e1RM, position, live,
#     fingerprint, rules_version); edits, tombstones, undeletes, hard deletes;
#     an unshared session yields nothing;
#   - targets: links, inert links (non-uuid, unknown, foreign exercise, foreign
#     group, archived, member left), unarchive, load-mode change, retarget, unlink;
#     no server function writes exercise_group_links beyond sync_push/dev_wipe;
#   - coalescing, the claim generation guard, lease expiry, the rules requeue;
#   - failure isolation: a forced enqueue failure, an unreachable kick URL, and a
#     failing evaluator job never break sync_push; the job is kept and retried;
#   - the sweep drains a missed kick; the pg_net smoke (one kick per push).
#
# Direct-drain mode: the lane unsets the kick URL for the run and POSTs to
# group-eval itself, so every assertion is deterministic; only the sweep and
# smoke sections turn the kick on. Hermetic: per-run users, deleted on exit,
# with the kick URL, sweep job, and probe constraints restored.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-leaderboards"
FIXTURE_EMAIL_PREFIX="groups-lb"
# (_common.sh repoints SCRIPT_DIR at supabase/scripts; SUPABASE_DIR is stable.)
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" ]] || fail "local Supabase status env is incomplete (API_URL/ANON_KEY)"
DB_CONTAINER="$(resolve_db_container)" || exit 1

RUN_TAG="${GROUPS_LEADERBOARDS_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsLeaderboards!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
LOCAL_KICK_URL="http://kong:8000/functions/v1/group-eval"
FORCE_ENQUEUE_CONSTRAINT="groups_lb_force_enqueue_failure"
FORCE_EVAL_CONSTRAINT="groups_lb_force_eval_failure"

RUN_USER_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
[[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" || "${ORIGINAL_SWEEP_ACTIVE}" == "f" ]] ||
  fail "the migration did not schedule the group-eval-sweep cron job"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "the migration did not create the group_eval_secret Vault secret"

set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  run_psql "set client_min_messages = warning;
            alter table app_public.group_eval_queue drop constraint if exists ${FORCE_ENQUEUE_CONSTRAINT};
            alter table app_public.group_set_facts drop constraint if exists ${FORCE_EVAL_CONSTRAINT};" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event in ('group.share_failed', 'group.event_failed', 'group.eval_enqueue_failed',
                       'group.eval_kick_failed', 'group.eval_failed')
         and user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

# --- lane helpers --------------------------------------------------------------

now_ms() { run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;"; }
new_uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }

# expect_sql <context> <sql> <expected>
expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}

# drain [secret]: POST group-eval (direct-drain mode); STATUS/BODY hold the reply.
drain() {
  local secret="${1-${EVAL_SECRET}}" out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "Content-Type: application/json" \
    -H "x-group-eval-secret: ${secret}" \
    -o "${out}" -w "%{http_code}" --data '{}' \
    "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
}

drain_ok() {
  drain
  expect_ok "group-eval drain: $1"
  check "group-eval drain reply shape: $1" '(.jobs | type) == "array" and .rules_version == 1'
}

# mine: the athlete's jobs in the last drain, keyed by session id or group exercise id.
mine() {
  jq -c --arg u "${ATHLETE_UID}" \
    '[.jobs[] | select(.member_user_id == $u)
      | {key: (.session_id // .group_exercise_id), kind, outcome, causes: (.causes | sort),
         targets: ([.targets[].group_exercise_id] | sort)}] | sort_by(.key)' <<<"${BODY}"
}

# expect_mine <context> <jq program building the expected array>
expect_mine() {
  local expected actual
  expected="$(jq -nc "$2" | jq -c 'map(.causes |= sort | .targets |= sort) | sort_by(.key)')"
  actual="$(mine)"
  [[ "${actual}" == "${expected}" ]] || fail "$1: expected jobs ${expected}, got ${actual}"
}

# queue_of: the athlete's pending jobs as `kind:key:causes`.
queue_of() {
  run_psql "select coalesce(string_agg(kind || ':' || coalesce(session_id, group_exercise_id::text) || ':'
                                     || array_to_string(causes, '+'), ',' order by 2), '')
              from (select kind, session_id, group_exercise_id, causes,
                           coalesce(session_id, group_exercise_id::text) as k
                      from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}') q;"
}

logs_count() {
  run_psql "select count(*) from public.app_logs where user_id = '${ATHLETE_UID}' and event = '$1';"
}

# fact <set>: `performed:live:weight:reps:e1rm` (e1RM rounded to 6 places).
fact() {
  run_psql "select performed || ':' || live || ':' || coalesce(weight_kg::text, '-') || ':'
                   || coalesce(reps::text, '-') || ':' || coalesce(round(e1rm_kg::numeric, 6)::text, '-')
              from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}' and set_id = '$1';"
}
fingerprint_of() {
  run_psql "select fingerprint from app_public.group_set_facts
             where member_user_id = '${ATHLETE_UID}' and set_id = '$1';"
}
# e1rm <weight> <reps>: the Wathan estimate, as the oracle for the TS value.
e1rm() {
  node -e 'const [w, r] = process.argv.slice(1).map(Number);
           process.stdout.write((100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r))).toFixed(6));' "$1" "$2"
}

# wait_until <context> <sql returning t|f> <timeout-seconds>
wait_until() {
  local deadline=$(( $(date +%s) + $3 ))
  until [[ "$(run_psql "$2")" == "t" ]]; do
    if (( $(date +%s) >= deadline )); then
      echo "[${LANE_LABEL}] queue: $(run_psql "select coalesce(jsonb_agg(to_jsonb(q) - 'causes')::text, '[]') from app_public.group_eval_queue q;")" >&2
      echo "[${LANE_LABEL}] logs: $(run_psql "select coalesce(jsonb_agg(jsonb_build_object('event', event, 'context', context))::text, '[]') from public.app_logs where event like 'group.eval_%' and created_at > now() - interval '10 minutes';")" >&2
      fail "$1: not true within $3 s"
    fi
    sleep 1
  done
}

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
provision ATHLETE athlete
provision OTHER other
set_username "${OWNER_UID}" "lb_owner_${RUN_TAG//-/_}"
set_username "${ATHLETE_UID}" "lb_athlete_${RUN_TAG//-/_}"
set_username "${OTHER_UID}" "lb_other_${RUN_TAG//-/_}"

# Direct-drain mode for the run, with the sweep paused so it never races a
# manual drain; the exit trap restores both.
set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "LB ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create G"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OTHER_TOKEN}" group_create "$(jq -nc --arg n "LB other ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create H"
HID="$(jq -er '.group_id' <<<"${BODY}")"

# gx_create <token> <group> <name> <mode>: echoes the group exercise id.
gx_create() {
  rpc "$1" group_exercise_create \
    "$(jq -nc --arg g "$2" --arg n "$3" --arg m "$4" '{p_group_id: $g, p_name: $n, p_load_input_mode: $m, p_source_exercise_id: null}')"
  expect_ok "group_exercise_create $3"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
GX="$(gx_create "${OWNER_TOKEN}" "${GID}" "Bench" total_load)"
GX3="$(gx_create "${OWNER_TOKEN}" "${GID}" "Bench (alt)" total_load)"
GXA="$(gx_create "${OWNER_TOKEN}" "${GID}" "DB press" total_load)"
HX="$(gx_create "${OTHER_TOKEN}" "${HID}" "Other bench" total_load)"
rpc "${OWNER_TOKEN}" group_exercise_archive "$(jq -nc --arg g "${GID}" --arg e "${GXA}" '{p_group_id: $g, p_exercise_id: $e}')"
expect_ok "archive GXA"

rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "group_invite_get"
INVITE_CODE="$(jq -er '.code' <<<"${BODY}")"
pass "users, groups G/H, group exercises GX/GX3/GXA (archived)/HX"

# =============================================================================
echo "[${LANE_LABEL}] posture"
# =============================================================================

for table in group_eval_queue group_set_facts; do
  expect_sql "${table}: RLS on" \
    "select relrowsecurity from pg_class where oid = 'app_public.${table}'::regclass;" "t"
  expect_sql "${table}: no policies" \
    "select count(*) from pg_policies where schemaname = 'app_public' and tablename = '${table}';" "0"
  expect_sql "${table}: no anon/authenticated privileges" \
    "select count(*) from information_schema.role_table_grants
      where table_schema = 'app_public' and table_name = '${table}' and grantee in ('anon', 'authenticated', 'public');" "0"
  expect_sql "${table}: no owner_user_id column (drift-checker ground rule 1)" \
    "select count(*) from information_schema.columns
      where table_schema = 'app_public' and table_name = '${table}' and column_name = 'owner_user_id';" "0"
  expect_sql "${table}: no FK into a Sync v2 table (ground rule 2)" \
    "select count(*) from pg_constraint c join pg_class t on t.oid = c.confrelid
      where c.conrelid = 'app_public.${table}'::regclass and c.contype = 'f'
        and exists (select 1 from information_schema.columns col
                     where col.table_schema = 'app_public' and col.table_name = t.relname
                       and col.column_name = 'owner_user_id');" "0"
done

expect_sql "every evaluator function pins search_path" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (p.proname like 'group\_eval\_%' or p.proname = 'group_set_fingerprint')
      and not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false);" "0"
expect_sql "service_role executes exactly the evaluator surface" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (p.proname like 'group\_eval\_%' or p.proname = 'group_set_fingerprint')
      and has_function_privilege('service_role', p.oid, 'execute');" \
  "group_eval_check_secret,group_eval_claim,group_eval_complete,group_eval_fail,group_eval_requeue_rules,group_eval_session_rows"
expect_sql "anon and authenticated execute no evaluator function" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (p.proname like 'group\_eval\_%' or p.proname = 'group_set_fingerprint')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));" "0"
expect_sql "sessions group triggers fire share → stream → eval (name order)" \
  "select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'app_public.sessions'::regclass and not tgisinternal and tgname like 'sessions_group%';" \
  "sessions_group_share_session,sessions_group_stream_event,sessions_group_z_eval_enqueue"
expect_sql "enqueue triggers on the five Sync v2 tables" \
  "select string_agg(tgrelid::regclass::text || '.' || tgname, ',' order by tgname) from pg_trigger
    where not tgisinternal and tgname like '%group%eval_enqueue';" \
  "app_public.exercise_definitions.exercise_definitions_group_eval_enqueue,app_public.exercise_group_links.exercise_group_links_group_eval_enqueue,app_public.exercise_sets.exercise_sets_group_eval_enqueue,app_public.session_exercises.session_exercises_group_eval_enqueue,app_public.sessions.sessions_group_z_eval_enqueue"
expect_sql "the sweep cron job" \
  "select schedule || '|' || command from cron.job where jobname = 'group-eval-sweep';" \
  "30 seconds|select app_public.group_eval_sweep()"
expect_sql "no server function writes exercise_group_links beyond sync_push and dev_wipe_my_data" \
  "select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app_public', 'public')
      and p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(app_public\\.)?exercise_group_links';" \
  "dev_wipe_my_data,sync_push"
pass "catalog posture"

for table in group_eval_queue group_set_facts; do
  for bearer in "${ATHLETE_TOKEN}" "${ANON_KEY}"; do
    rest GET "${bearer}" "${table}" "select=*"
    if [[ "${STATUS}" =~ ^2 ]]; then
      check "direct select ${table} must return nothing" 'length == 0'
    else
      check "direct select ${table} must be a 42501 denial (HTTP ${STATUS})" '.code == "42501"'
    fi
  done
done
for bearer in "${ATHLETE_TOKEN}" "${ANON_KEY}"; do
  rpc "${bearer}" group_eval_claim '{"p_limit": 1}'
  [[ ! "${STATUS}" =~ ^2 ]] || fail "a client claimed evaluator jobs (HTTP ${STATUS})"
  check "client group_eval_claim must be a 42501 denial" '.code == "42501"'
done
drain ""
[[ "${STATUS}" == "401" ]] || fail "group-eval without a secret: expected 401, got ${STATUS}"
drain "wrong-${EVAL_SECRET}"
[[ "${STATUS}" == "401" ]] || fail "group-eval with a wrong secret: expected 401, got ${STATUS}"
STATUS="$(curl --silent -o /dev/null -w '%{http_code}' "${API_URL}/functions/v1/group-eval")"
[[ "${STATUS}" == "405" ]] || fail "group-eval GET: expected 405, got ${STATUS}"
BODY=""
pass "direct PostgREST denial; group-eval 401 without/with a wrong secret, 405 on GET"

# =============================================================================
echo "[${LANE_LABEL}] facts"
# =============================================================================

CUAM="$(now_ms)"
T="lb-${RUN_TAG}"
HOUR=3600000
DEF_BENCH="${T}-def-bench"
DEF_DB="${T}-def-db"
DEF_ROW="${T}-def-row"
S0="${T}-s0"
S1="${T}-s1"
S2="${T}-s2"
S3="${T}-s3"

next_cuam
push "${ATHLETE_TOKEN}" "definitions" \
  "$(e_def "${DEF_BENCH}" "Bench" "${CUAM}" total_load)" \
  "$(e_def "${DEF_DB}" "DB press" "${CUAM}" per_side_load)" \
  "$(e_def "${DEF_ROW}" "Row" "${CUAM}" total_load)"

# Logged before joining: never shared, so never queued.
next_cuam
S0_START=$(( CUAM - 24 * HOUR ))
push "${ATHLETE_TOKEN}" "unshared session" \
  "$(e_session "${S0}" "${S0_START}" completed $(( S0_START + HOUR )) 3600 null "${CUAM}")" \
  "$(e_se "${T}-s0-se" "${S0}" "${DEF_BENCH}" 0 Bench "${CUAM}")" \
  "$(e_set "${T}-s0-set" "${T}-s0-se" 0 100 5 "" "${CUAM}")"
expect_sql "an unshared session is not queued" \
  "select count(*) from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}';" "0"
drain_ok "unshared"
expect_sql "an unshared session has no facts" \
  "select count(*) from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}';" "0"
pass "an unshared session is neither queued nor evaluated"

rpc "${ATHLETE_TOKEN}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
expect_ok "athlete joins G"

START=$(( $(now_ms) + 1000 ))
SE_B="${T}-se-bench"
SE_D="${T}-se-db"
SE_G="${T}-se-gone"
next_cuam
DEL="${CUAM}"
push "${ATHLETE_TOKEN}" "shared session S1" \
  "$(e_session "${S1}" "${START}" active null null null "${CUAM}")" \
  "$(e_se "${SE_B}" "${S1}" "${DEF_BENCH}" 0 Bench "${CUAM}")" \
  "$(e_se "${SE_D}" "${S1}" "${DEF_DB}" 1 "DB press" "${CUAM}")" \
  "$(e_se "${SE_G}" "${S1}" "${DEF_ROW}" 2 Row "${CUAM}" "${DEL}")" \
  "$(e_set "${T}-b1" "${SE_B}" 0 " 102.5 " "5 " "" "${CUAM}")" \
  "$(e_set "${T}-b2" "${SE_B}" 1 "" 8 "" "${CUAM}")" \
  "$(e_set "${T}-b3" "${SE_B}" 2 100 5 planned "${CUAM}")" \
  "$(e_set "${T}-b4" "${SE_B}" 3 100 5 skipped "${CUAM}")" \
  "$(e_set "${T}-b5" "${SE_B}" 4 100 5 unperformed "${CUAM}")" \
  "$(e_set "${T}-b6" "${SE_B}" 5 90 3 future_status "${CUAM}")" \
  "$(e_set "${T}-b7" "${SE_B}" 6 1e3 5 "" "${CUAM}")" \
  "$(e_set "${T}-b8" "${SE_B}" 7 100 2.5 "" "${CUAM}")" \
  "$(e_set "${T}-b9" "${SE_B}" 8 60 10 "" "${CUAM}" "${DEL}" warm_up)" \
  "$(e_set "${T}-ba" "${SE_B}" 9 "" "" "" "${CUAM}")" \
  "$(e_set "${T}-bb" "${SE_B}" 10 100 10000000000 "" "${CUAM}")" \
  "$(e_set "${T}-d1" "${SE_D}" 0 30 10 "" "${CUAM}")" \
  "$(e_set "${T}-g1" "${SE_G}" 0 50 5 "" "${CUAM}")"
expect_sql "a 17-row push coalesces into one session job" \
  "select count(*) from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}';" "1"
[[ "$(queue_of)" == "session:${S1}:set" ]] || fail "queue after S1: got '$(queue_of)'"

drain_ok "S1"
expect_mine "S1 drain" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: []}]"
expect_sql "S1 job left the queue" \
  "select count(*) from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}';" "0"

expect_fact() {
  local actual
  actual="$(fact "${T}-$1")"
  [[ "${actual}" == "$2" ]] || fail "fact $1: expected '$2', got '${actual}'"
}
expect_fact b1 "true:true:102.5:5:$(e1rm 102.5 5)"
expect_fact b2 "true:true:0:8:-"
expect_fact b3 "false:true:-:-:-"
expect_fact b4 "false:true:-:-:-"
expect_fact b5 "false:true:-:-:-"
expect_fact b6 "true:true:90:3:$(e1rm 90 3)"
expect_fact b7 "false:true:-:-:-"
expect_fact b8 "false:true:-:-:-"
expect_fact b9 "true:false:60:10:$(e1rm 60 10)"
expect_fact ba "false:true:-:-:-"
# Any reps text the TS parser accepts must be storable, or the job would fail
# on every retry.
expect_fact bb "true:true:100:10000000000:$(e1rm 100 10000000000)"
expect_fact d1 "true:true:30:10:$(e1rm 30 10)"
expect_fact g1 "true:false:50:5:$(e1rm 50 5)"
expect_sql "every S1 fact: position, session start, rules version, SQL fingerprint of the raw row" \
  "select count(*) || ':' || bool_and(f.achieved_at_ms = ${START} and f.rules_version = 1
            and f.session_id = '${S1}' and f.session_exercise_id = es.session_exercise_id
            and f.set_order_index = es.order_index
            and f.fingerprint = app_public.group_set_fingerprint(es.weight_value, es.reps_value,
                                                                es.performance_status, es.deleted_at))
     from app_public.group_set_facts f
     join app_public.exercise_sets es on es.owner_user_id = f.member_user_id and es.id = f.set_id
    where f.member_user_id = '${ATHLETE_UID}';" "13:true"
expect_sql "exercise identity and order carried per set" \
  "select string_agg(set_id || '=' || coalesce(exercise_definition_id, '-') || '@' || exercise_order_index, ',' order by set_id)
     from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}' and set_id in ('${T}-b1', '${T}-d1', '${T}-g1');" \
  "${T}-b1=${DEF_BENCH}@0,${T}-d1=${DEF_DB}@1,${T}-g1=${DEF_ROW}@2"
pass "facts: performed rule, parsing, 0 kg blank weight, per-side entered mode, e1RM, live, fingerprint"

# --- fingerprint and live flow-through ---------------------------------------------

push_b1() { # push_b1 <weight> [deleted_ms] — reps keep b1's raw "5 " so only the weight moves
  next_cuam
  push "${ATHLETE_TOKEN}" "b1 ${1}" "$(e_set "${T}-b1" "${SE_B}" 0 "$1" "5 " "" "${CUAM}" "${2:-null}")"
}
FP_1025="$(fingerprint_of "${T}-b1")"
push_b1 " 102.5 "
drain_ok "b1 re-push, same values"
[[ "$(fingerprint_of "${T}-b1")" == "${FP_1025}" ]] || fail "an unchanged re-push must keep the fingerprint"
push_b1 105
drain_ok "b1 edit"
FP_105="$(fingerprint_of "${T}-b1")"
[[ "${FP_105}" != "${FP_1025}" ]] || fail "an edited weight must change the fingerprint"
expect_fact b1 "true:true:105:5:$(e1rm 105 5)"
next_cuam
push_b1 105 "${CUAM}"
drain_ok "b1 tombstone"
expect_fact b1 "true:false:105:5:$(e1rm 105 5)"
[[ "$(fingerprint_of "${T}-b1")" != "${FP_105}" ]] || fail "a tombstone must change the fingerprint"
push_b1 105
drain_ok "b1 undelete"
expect_fact b1 "true:true:105:5:$(e1rm 105 5)"
[[ "$(fingerprint_of "${T}-b1")" == "${FP_105}" ]] || fail "an undelete must restore the fingerprint"

# The fingerprint covers exactly weight, reps, status, and deleted_at.
next_cuam
push "${ATHLETE_TOKEN}" "b1 set type + order" "$(e_set "${T}-b1" "${SE_B}" 20 105 "5 " "" "${CUAM}" null rir_1)"
drain_ok "b1 set type + order"
[[ "$(fingerprint_of "${T}-b1")" == "${FP_105}" ]] || fail "set type and order must not change the fingerprint"
expect_sql "b1 carries its new order" \
  "select set_order_index from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}' and set_id = '${T}-b1';" "20"
next_cuam
push "${ATHLETE_TOKEN}" "b1 reps" "$(e_set "${T}-b1" "${SE_B}" 0 105 6 "" "${CUAM}")"
drain_ok "b1 reps"
[[ "$(fingerprint_of "${T}-b1")" != "${FP_105}" ]] || fail "a reps edit must change the fingerprint"
next_cuam
push "${ATHLETE_TOKEN}" "b1 status" "$(e_set "${T}-b1" "${SE_B}" 0 105 "5 " planned "${CUAM}")"
drain_ok "b1 status"
[[ "$(fingerprint_of "${T}-b1")" != "${FP_105}" ]] || fail "a status edit must change the fingerprint"
expect_fact b1 "false:true:-:-:-"
push_b1 105
drain_ok "b1 restored"
[[ "$(fingerprint_of "${T}-b1")" == "${FP_105}" ]] || fail "restoring the raw values must restore the fingerprint"

FP_D1="$(fingerprint_of "${T}-d1")"
next_cuam
push "${ATHLETE_TOKEN}" "exercise tombstone" "$(e_se "${SE_D}" "${S1}" "${DEF_DB}" 1 "DB press" "${CUAM}" "${CUAM}")"
drain_ok "exercise tombstone"
expect_fact d1 "true:false:30:10:$(e1rm 30 10)"
[[ "$(fingerprint_of "${T}-d1")" == "${FP_D1}" ]] || fail "an exercise tombstone must not change a set fingerprint"
next_cuam
push "${ATHLETE_TOKEN}" "exercise undelete" "$(e_se "${SE_D}" "${S1}" "${DEF_DB}" 1 "DB press" "${CUAM}")"
next_cuam
push "${ATHLETE_TOKEN}" "session tombstone" "$(e_session "${S1}" "${START}" active null null "${CUAM}" "${CUAM}")"
drain_ok "session tombstone"
expect_sql "a session tombstone makes every fact not live" \
  "select count(*) filter (where live) from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}';" "0"
next_cuam
push "${ATHLETE_TOKEN}" "session undelete" "$(e_session "${S1}" "${START}" active null null null "${CUAM}")"
drain_ok "session undelete"
expect_sql "an undelete restores live per row (b9 and g1 stay tombstoned)" \
  "select string_agg(replace(set_id, '${T}-', ''), ',' order by set_id) from app_public.group_set_facts
    where member_user_id = '${ATHLETE_UID}' and not live;" "b9,g1"
pass "fingerprint and live follow edits, tombstones, and undeletes of a set, an exercise, and the session"

# A hard delete (dev_wipe_my_data, account deletion) fires no trigger; the
# session's next evaluation drops the vanished set's fact.
run_psql "delete from app_public.exercise_sets where owner_user_id = '${ATHLETE_UID}' and id = '${T}-b8';" >/dev/null
push_b1 105
drain_ok "after hard delete"
expect_sql "a hard-deleted set's fact is removed by the next evaluation" \
  "select count(*) from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}' and set_id = '${T}-b8';" "0"
pass "hard-deleted set's fact removed"

# =============================================================================
echo "[${LANE_LABEL}] targets and inert links"
# =============================================================================

next_cuam
push "${ATHLETE_TOKEN}" "link bench → GX" "$(e_link "${DEF_BENCH}" "${GID}" "${GX}" "${CUAM}")"
[[ "$(queue_of)" == "target:${GX}:link" ]] || fail "link queue: got '$(queue_of)'"
drain_ok "link"
expect_mine "link → GX" "[{key: \"${GX}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: [\"${GX}\"]}]"
push_b1 106
drain_ok "set change with a link"
expect_mine "session job resolves the linked target" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GX}\"]}]"

MISSING_A="$(new_uuid)"
MISSING_B="$(new_uuid)"
next_cuam
push "${ATHLETE_TOKEN}" "inert links" \
  "$(e_link "${DEF_ROW}" "not-a-uuid" "also-not-a-uuid" "${CUAM}")" \
  "$(e_link "${DEF_ROW}" "${MISSING_A}" "${MISSING_B}" "${CUAM}")" \
  "$(e_link "${DEF_DB}" "${GID}" "${HX}" "${CUAM}")"
[[ -z "$(queue_of)" ]] || fail "non-uuid, unknown, and foreign-exercise links must not queue: got '$(queue_of)'"
[[ "$(logs_count group.eval_enqueue_failed)" == "0" ]] || fail "inert links must not log enqueue failures"
pass "non-uuid, unknown, and foreign-exercise links are inert: no job, no failure row"

next_cuam
push "${ATHLETE_TOKEN}" "link into a group the athlete is not in" "$(e_link "${DEF_BENCH}" "${HID}" "${HX}" "${CUAM}")"
drain_ok "foreign group"
expect_mine "foreign group: queued, no live target" "[{key: \"${HX}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: []}]"

next_cuam
push "${ATHLETE_TOKEN}" "retarget G:db from HX to archived GXA" "$(e_link "${DEF_DB}" "${GID}" "${GXA}" "${CUAM}")"
drain_ok "archived"
expect_mine "archived target: frozen, no live target" "[{key: \"${GXA}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: []}]"
push_b1 107
drain_ok "session job with an archived link"
expect_mine "session job skips the archived target" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GX}\"]}]"
rpc "${OWNER_TOKEN}" group_exercise_unarchive "$(jq -nc --arg g "${GID}" --arg e "${GXA}" '{p_group_id: $g, p_exercise_id: $e}')"
expect_ok "unarchive GXA"
push_b1 108
drain_ok "after unarchive"
# Unarchive also queues a catch-up target job per live link (M25-T05, contract §2.10).
expect_mine "after unarchive the link counts" \
  "[{key: \"${GXA}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: [\"${GXA}\"]},
    {key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GX}\", \"${GXA}\"]}]"
pass "archived targets are frozen (links written after archive included); unarchive restores them"

next_cuam
push "${ATHLETE_TOKEN}" "bench load mode → per side" "$(e_def "${DEF_BENCH}" "Bench" "${CUAM}" per_side_load)"
drain_ok "load mode"
expect_mine "load mode re-applies every live link" \
  "[{key: \"${GX}\", kind: \"target\", outcome: \"completed\", causes: [\"load_mode\"], targets: [\"${GX}\"]},
    {key: \"${HX}\", kind: \"target\", outcome: \"completed\", causes: [\"load_mode\"], targets: []}]"

next_cuam
push "${ATHLETE_TOKEN}" "retarget bench GX → GX3" "$(e_link "${DEF_BENCH}" "${GID}" "${GX3}" "${CUAM}")"
drain_ok "retarget"
expect_mine "retarget re-applies the old and the new target" \
  "[{key: \"${GX}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: [\"${GX}\"]},
    {key: \"${GX3}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: [\"${GX3}\"]}]"
next_cuam
push "${ATHLETE_TOKEN}" "unlink bench" "$(e_link "${DEF_BENCH}" "${GID}" "${GX3}" "${CUAM}" "${CUAM}")"
drain_ok "unlink"
expect_mine "unlink re-applies the target it left" "[{key: \"${GX3}\", kind: \"target\", outcome: \"completed\", causes: [\"link\"], targets: [\"${GX3}\"]}]"
push_b1 109
drain_ok "after unlink"
expect_mine "an unlinked exercise no longer resolves" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GXA}\"]}]"
pass "load-mode change, retarget, and unlink resolve the right targets"

# =============================================================================
echo "[${LANE_LABEL}] generation guard, lease expiry, rules requeue"
# =============================================================================

push_b1 110
JOB_ID="$(run_psql "select id from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}' and session_id = '${S1}';")"
GEN="$(run_psql "select generation from app_public.group_eval_queue where id = ${JOB_ID};")"
run_psql "select app_public.group_eval_claim(200);" >/dev/null
expect_sql "a claimed job is leased" "select claimed_until > now() from app_public.group_eval_queue where id = ${JOB_ID};" "t"
push_b1 111
expect_sql "a push during the claim bumps the generation" \
  "select generation = ${GEN} + 1 from app_public.group_eval_queue where id = ${JOB_ID};" "t"
FACT_BEFORE="$(fact "${T}-b1")"
expect_sql "complete with the claimed generation keeps the newer work" \
  "select app_public.group_eval_complete(${JOB_ID}, ${GEN},
            (select jsonb_agg(to_jsonb(f) - 'member_user_id' - 'session_id' - 'evaluated_at')
               from app_public.group_set_facts f
              where f.member_user_id = '${ATHLETE_UID}' and f.session_id = '${S1}')) ->> 'completed';" "false"
expect_sql "the job is released, not deleted" \
  "select claimed_until is null from app_public.group_eval_queue where id = ${JOB_ID};" "t"
[[ "$(fact "${T}-b1")" == "${FACT_BEFORE}" ]] || fail "a stale complete must write nothing"
drain_ok "after generation guard"
expect_fact b1 "true:true:111:5:$(e1rm 111 5)"
pass "a re-enqueue during a claim is never lost"

push_b1 112
JOB_ID="$(run_psql "select id from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}' and session_id = '${S1}';")"
run_psql "select app_public.group_eval_claim(200);" >/dev/null
expect_sql "a leased job is not claimed twice" \
  "select app_public.group_eval_claim(200) -> 'jobs' @> jsonb_build_array(jsonb_build_object('job_id', ${JOB_ID}));" "f"
run_psql "update app_public.group_eval_queue set claimed_until = now() - interval '1 second' where id = ${JOB_ID};" >/dev/null
drain_ok "expired lease"
expect_mine "an expired lease is reclaimed" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GXA}\"]}]"
pass "lease expiry"

# Two statements: one statement's snapshot cannot see what its own volatile
# function inserted.
expect_sql "a rules bump requeues evaluated sessions" "select app_public.group_eval_requeue_rules(2, 1000) >= 1;" "t"
[[ "$(queue_of)" == "session:${S1}:rules" ]] || fail "a rules bump must requeue S1 with cause rules: got '$(queue_of)'"
drain_ok "rules"
expect_mine "a rules requeue re-normalizes silently" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"rules\"], targets: [\"${GXA}\"]}]"
pass "rules requeue"

# =============================================================================
echo "[${LANE_LABEL}] failure isolation"
# =============================================================================

run_psql "alter table app_public.group_eval_queue add constraint ${FORCE_ENQUEUE_CONSTRAINT} check (false) not valid;" >/dev/null
push_b1 113
rest GET "${ATHLETE_TOKEN}" exercise_sets "select=weight_value&id=eq.${T}-b1"
expect_ok "read back b1 under the enqueue fault"
check "the pushed row committed under the enqueue fault" '.[0].weight_value == "113"'
expect_sql "exactly one sanitized enqueue failure row" \
  "select count(*) || '|' || min(message) || '|' || min((select string_agg(k, ',' order by k) from jsonb_object_keys(context) k))
          || '|' || min(context ->> 'table') || '|' || min(context ->> 'row_id') || '|' || min(context ->> 'sqlstate')
     from public.app_logs where user_id = '${ATHLETE_UID}' and event = 'group.eval_enqueue_failed';" \
  "1|group evaluator enqueue failed; the sync write committed|row_id,sqlstate,table|exercise_sets|${T}-b1|23514"
run_psql "alter table app_public.group_eval_queue drop constraint ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
push_b1 114
[[ "$(queue_of)" == "session:${S1}:set" ]] || fail "the next push after the fault must enqueue: got '$(queue_of)'"
drain_ok "after enqueue fault"
pass "a forced enqueue failure: sync_push committed, one sanitized row, the next push enqueues"

next_cuam
push "${ATHLETE_TOKEN}" "second shared session S2" \
  "$(e_session "${S2}" $(( START + 60000 )) active null null null "${CUAM}")" \
  "$(e_se "${T}-s2-se" "${S2}" "${DEF_ROW}" 0 Row "${CUAM}")" \
  "$(e_set "${T}-p1" "${T}-s2-se" 0 70 8 "" "${CUAM}")"
push_b1 115
run_psql "alter table app_public.group_set_facts add constraint ${FORCE_EVAL_CONSTRAINT} check (set_id <> '${T}-p1') not valid;" >/dev/null
drain_ok "evaluator fault"
expect_mine "one failing job; the other completes" \
  "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: [\"${GXA}\"]},
    {key: \"${S2}\", kind: \"session\", outcome: \"failed\", causes: [\"set\"], targets: []}]"
expect_fact b1 "true:true:115:5:$(e1rm 115 5)"
expect_sql "the failed job is kept with attempts, backoff, and its sqlstate" \
  "select attempts || '|' || (available_at > now()) || '|' || last_sqlstate || '|' || (claimed_until is null)
     from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}' and session_id = '${S2}';" "1|true|23514|true"
expect_sql "exactly one sanitized job failure row" \
  "select count(*) || '|' || min((select string_agg(k, ',' order by k) from jsonb_object_keys(context) k))
          || '|' || min(context ->> 'kind') || '|' || min(context ->> 'sqlstate')
     from public.app_logs where user_id = '${ATHLETE_UID}' and event = 'group.eval_failed';" "1|job_id,kind,sqlstate|session|23514"
run_psql "alter table app_public.group_set_facts drop constraint ${FORCE_EVAL_CONSTRAINT};" >/dev/null
# Skip the 2 s backoff so the retry is deterministic.
run_psql "update app_public.group_eval_queue set available_at = now()
           where member_user_id = '${ATHLETE_UID}' and session_id = '${S2}';" >/dev/null
drain_ok "retry after the fault"
expect_mine "the retried job completes" "[{key: \"${S2}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: []}]"
expect_fact p1 "true:true:70:8:$(e1rm 70 8)"
pass "a failing evaluator job is kept, logged once, retried; the rest of the drain completes"

set_kick_url "http://127.0.0.1:9/unreachable"
push_b1 116
rest GET "${ATHLETE_TOKEN}" exercise_sets "select=weight_value&id=eq.${T}-b1"
check "the pushed row committed with an unreachable kick URL" '.[0].weight_value == "116"'
[[ "$(queue_of)" == "session:${S1}:set" ]] || fail "an unreachable kick must leave the job queued: got '$(queue_of)'"
set_kick_url ""
drain_ok "after unreachable kick"
expect_fact b1 "true:true:116:5:$(e1rm 116 5)"
pass "an unreachable kick URL: sync_push committed, the job waits for a drain"

# A kick that raises at call time (pg_net rejects a malformed URL
# synchronously): still one attempt and one row per transaction.
set_kick_url "not a url"
next_cuam
push "${ATHLETE_TOKEN}" "three rows under a failing kick" \
  "$(e_set "${T}-b1" "${SE_B}" 0 117 "5 " "" "${CUAM}")" \
  "$(e_set "${T}-b2" "${SE_B}" 1 "" 9 "" "${CUAM}")" \
  "$(e_set "${T}-b6" "${SE_B}" 5 91 3 future_status "${CUAM}")"
rest GET "${ATHLETE_TOKEN}" exercise_sets "select=weight_value&id=eq.${T}-b1"
check "the pushed rows committed under a failing kick" '.[0].weight_value == "117"'
expect_sql "exactly one sanitized kick failure row for the push" \
  "select count(*) || '|' || min((select string_agg(k, ',' order by k) from jsonb_object_keys(context) k))
          || '|' || min(message)
     from public.app_logs where user_id = '${ATHLETE_UID}' and event = 'group.eval_kick_failed';" \
  "1|sqlstate|group evaluator kick failed; the sync write committed and the sweep will retry"
[[ "$(queue_of)" == "session:${S1}:set" ]] || fail "a failing kick must leave the job queued: got '$(queue_of)'"
set_kick_url ""
drain_ok "after failing kick"
expect_fact b1 "true:true:117:5:$(e1rm 117 5)"
pass "a kick that raises: sync_push committed, one attempt and one row per push, the job waits"
expect_sql "no enqueue failures beyond the forced one" "select count(*) from public.app_logs
  where user_id = '${ATHLETE_UID}' and event = 'group.eval_enqueue_failed';" "1"

# =============================================================================
echo "[${LANE_LABEL}] sweep and pg_net"
# =============================================================================

push_b1 118
[[ "$(queue_of)" == "session:${S1}:set" ]] || fail "a missed kick leaves the job pending: got '$(queue_of)'"
set_kick_url "${LOCAL_KICK_URL}"
# The cron job is paused for the run; this is the call it makes every 30 s.
expect_sql "the sweep kicks when claimable work exists" "select app_public.group_eval_sweep();" "t"
wait_until "the sweep drains the missed kick" \
  "select not exists (select 1 from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}')
      and exists (select 1 from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}'
                   and set_id = '${T}-b1' and weight_kg = 118);" 30
pass "the sweep drains a missed kick"

SEQ_BEFORE="$(run_psql "select last_value from net.http_request_queue_id_seq;")"
next_cuam
SMOKE=("$(e_session "${S3}" $(( START + 120000 )) active null null null "${CUAM}")" "$(e_se "${T}-s3-se" "${S3}" "${DEF_ROW}" 0 Row "${CUAM}")")
for i in $(seq 0 29); do
  SMOKE+=("$(e_set "${T}-s3-${i}" "${T}-s3-se" "${i}" $(( 40 + i )) 5 "" "${CUAM}")")
done
push "${ATHLETE_TOKEN}" "32-row push with the kick on" "${SMOKE[@]}"
SEQ_AFTER="$(run_psql "select last_value from net.http_request_queue_id_seq;")"
[[ $(( SEQ_AFTER - SEQ_BEFORE )) -eq 1 ]] || fail "one pg_net request per push: got $(( SEQ_AFTER - SEQ_BEFORE ))"
wait_until "the kick drains the push" \
  "select count(*) = 30 from app_public.group_set_facts where member_user_id = '${ATHLETE_UID}' and session_id = '${S3}';" 30
set_kick_url ""
pass "pg_net smoke: one kick for a 32-row push, facts appear without a direct call"

# =============================================================================
echo "[${LANE_LABEL}] a member who left"
# =============================================================================

rpc "${ATHLETE_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "athlete leaves G"
push_b1 119
drain_ok "after leaving"
expect_mine "a member who left has no live targets" "[{key: \"${S1}\", kind: \"session\", outcome: \"completed\", causes: [\"set\"], targets: []}]"
expect_fact b1 "true:true:119:5:$(e1rm 119 5)"
pass "a former member's shared sessions are still normalized, but resolve no target"

echo "[${LANE_LABEL}] passed (run ${RUN_TAG})"
