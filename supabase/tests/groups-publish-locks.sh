#!/usr/bin/env bash

# groups-publish-locks.sh — the comparison publisher's lock on the group row
# (a body of the groups-leaderboards lane).
#
# Contract: docs/specs/tech/groups-contract.md ("RPC conventions", "Coherent
# publication"). Proves, with sessions held open against the real local stack,
# each scenario under the definitions before the change (installed verbatim
# in pg_temp from the migrations that hold them) and under today's:
#
#   - deadlock: an evaluator completion holds one comparison's queue row
#     (`group_eval_apply`, as `group_eval_complete` runs it per target) while a
#     publisher of that comparison waits for the row; the completion then
#     queues a second comparison, whose foreign-key check takes KEY SHARE on
#     the group row. The old publisher held that row FOR UPDATE: deadlock. The
#     publisher holds it FOR NO KEY UPDATE: the completion goes on, commits,
#     and the publisher finishes after it;
#   - readers: a screen read holding its member check does not block a
#     publisher (the old FOR SHARE check, or the old FOR UPDATE publisher, did);
#   - CoW: CoW publication's KEY SHARE on the group row does not wait for an
#     in-flight comparison publisher (it did behind FOR UPDATE), and still waits
#     for a manager holding the row FOR UPDATE, so its group row → CoW fence
#     order matches management's.
#
# Direct-drain mode: the kick URL is unset and the sweep paused for the run.
# Hermetic: per-run users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-publish-locks"
FIXTURE_EMAIL_PREFIX="groups-locks"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1
psql_session_start

RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="GroupsLocks!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
MIGRATIONS_DIR="${SUPABASE_DIR}/migrations"

RUN_USER_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"

set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

# --- held sessions ---------------------------------------------------------------
#
# Three background psql sessions, each on its own pair of FIFOs and file
# descriptors (Bash 3.2 has no {fd} allocation): `bg_send` writes a batch and
# returns at once; `bg_read` returns its output once the batch has run. A
# batch's ERROR lines are part of its output, so a scenario can assert on them.
BG_NAMES="E P R"
bg_fds() { case "$1" in E) echo "3 4" ;; P) echo "5 6" ;; R) echo "13 14" ;; *) return 1 ;; esac; }
bg_var() { printf 'BG_%s_%s' "$1" "$2"; }

bg_start() {
  local name="$1" dir in out pid_var
  read -r in out <<<"$(bg_fds "${name}")"
  dir="$(mktemp -d)"
  mkfifo "${dir}/in" "${dir}/out"
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "${DB_CONTAINER}" \
    sh -c 'exec psql -X -U postgres -d postgres -Atq 2>&1' <"${dir}/in" >"${dir}/out" &
  printf -v "$(bg_var "${name}" PID)" '%s' "$!"
  printf -v "$(bg_var "${name}" DIR)" '%s' "${dir}"
  eval "exec ${in}>\"${dir}/in\" ${out}<\"${dir}/out\""
  bg_send "${name}" "select pg_backend_pid();"
  pid_var="$(bg_var "${name}" BACKEND)"
  printf -v "${pid_var}" '%s' "$(bg_read "${name}")"
  [[ "${!pid_var}" =~ ^[0-9]+$ ]] || fail "held session ${name} did not start"
}

bg_send() {
  local in out
  read -r in out <<<"$(bg_fds "$1")"
  printf '%s\n;\n\\echo __bg_done__\n' "$2" >&"${in}"
}

# bg_read <name>: the batch's output lines, joined by spaces.
bg_read() {
  local in out line text=""
  read -r in out <<<"$(bg_fds "$1")"
  while IFS= read -r -t 30 line <&"${out}"; do
    if [[ "${line}" == "__bg_done__" ]]; then printf '%s' "${text% }"; return 0; fi
    text+="${line} "
  done
  fail "held session $1 did not answer within 30 s (so far: ${text})"
}

bg_stop() {
  local name="$1" in out pid_var dir_var
  pid_var="$(bg_var "${name}" PID)"; dir_var="$(bg_var "${name}" DIR)"
  [[ -n "${!pid_var:-}" ]] || return 0
  read -r in out <<<"$(bg_fds "${name}")"
  printf 'rollback;\n\\q\n' >&"${in}" 2>/dev/null || true
  eval "exec ${in}>&- ${out}<&-"
  wait "${!pid_var}" 2>/dev/null || true
  rm -rf "${!dir_var}"
  printf -v "${pid_var}" '%s' ""
}

bg_stop_all() { local name; for name in ${BG_NAMES}; do bg_stop "${name}"; done; }

# wait_for_lock <name> <what>: until the session's backend waits on a lock.
wait_for_lock() {
  local pid_var deadline=$((SECONDS + 10))
  pid_var="$(bg_var "$1" BACKEND)"
  until [[ "$(run_psql "select exists(select 1 from pg_stat_activity where pid = ${!pid_var}
      and state = 'active' and wait_event_type = 'Lock');")" == t ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail "$2: session $1 never waited on a lock"
  done
}

# --- the definitions before the change ---------------------------------------------

# legacy_definition <migration> <fn> <alias>: the migration's last definition of
# app_public.<fn>, verbatim, renamed to pg_temp.<alias> (its body ends at the
# first `$$;` line after the header).
legacy_definition() {
  awk -v fn="$2" '
    tolower($0) ~ ("^create (or replace )?function app_public\\." fn "\\(") { buf = ""; take = 1 }
    take { buf = buf $0 "\n" }
    take && $0 ~ /\$\$;[[:space:]]*$/ { last = buf; take = 0 }
    END { printf "%s", last }
  ' "${MIGRATIONS_DIR}/$1" | sed -E "1s/^create (or replace )?function app_public\\.$2\\(/create function pg_temp.$3(/I"
}
OLD_PUBLISH_SQL="$(legacy_definition 20261023091259_group_metric_graph_referenced_sets.sql group_metric_eval_publish group_metric_eval_publish__legacy)"
OLD_READER_SQL="$(legacy_definition 20261004233855_group_competition_publication.sql group_competition_require_member group_competition_require_member__legacy)"
[[ "${OLD_PUBLISH_SQL}" == *"for update;"* && "${OLD_PUBLISH_SQL}" == "create function pg_temp."* ]] ||
  fail "the old publisher's definition was not found"
[[ "${OLD_READER_SQL}" == *"for share;"* && "${OLD_READER_SQL}" == "create function pg_temp."* ]] ||
  fail "the old reader check's definition was not found"

cleanup() {
  bg_stop_all
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs where event like 'group.%' and user_id in (${ids});
      delete from app_public.group_eval_queue where member_user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  psql_session_stop
  exit "${status}"
}
trap cleanup_on_exit EXIT

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
set_username "${OWNER_UID}" "locks_owner_${RUN_TAG//-/_}"
set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Locks ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create"
GID="$(jq -er '.group_id' <<<"${BODY}")"
for name in A B; do
  rpc "${OWNER_TOKEN}" group_competition_exercise_create \
    "$(jq -nc --arg g "${GID}" --arg n "Lift ${name}" '{p_group_id: $g, p_name: $n, p_load_input_mode: "total_load", p_source_exercise_id: null}')"
  expect_ok "group_competition_exercise_create ${name}"
  printf -v "GX_${name}" '%s' "$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"
done
# A CoW on Lift A, as scheduled for the week ahead: CoW publication needs only
# the row to take its locks; its claim never matches, so it publishes nothing.
run_psql "update app_public.groups set cow_time_zone = 'UTC' where id = '${GID}';" >/dev/null
COW_ID="$(run_psql "insert into app_public.group_cows(id, group_id, group_exercise_id, week_start, time_zone, starts_at, ends_at,
    metrics, create_key, created_by, available_at)
  select gen_random_uuid(), '${GID}', '${GX_A}', w.week, 'UTC', lower(w.bounds), upper(w.bounds), array['e1rm'],
    'locks-${RUN_TAG}', '${OWNER_UID}', lower(w.bounds)
  from (select app_public.group_cow_week('UTC', now()) + 7 as week) w0,
    lateral (select w0.week, app_public.group_cow_bounds('UTC', w0.week) as bounds) w
  returning id;")"
[[ "${COW_ID}" =~ ${UUID_RE} ]] || fail "CoW fixture not created"

# reset_queue: Lift A's comparison queued and committed, Lift B's not queued;
# JOB_A and GEN_A name the job a publisher works on.
reset_queue() {
  run_psql "delete from app_public.group_metric_eval_queue where group_id = '${GID}';
    select app_public.group_metric_eval_enqueue('${GID}', '${GX_A}', 'set');" >/dev/null
  JOB_A="$(run_psql "select id from app_public.group_metric_eval_queue where group_exercise_id = '${GX_A}';")"
  GEN_A="$(run_psql "select generation from app_public.group_metric_eval_queue where group_exercise_id = '${GX_A}';")"
  [[ "${JOB_A}" =~ ^[0-9]+$ ]] || fail "comparison job not queued"
}

# publish_sql <old|new>: one publisher call for JOB_A. The claim never matches,
# so it takes its locks, finds the job not its own and writes nothing.
publish_sql() {
  local fn=app_public.group_metric_eval_publish
  [[ "$1" == new ]] || fn=pg_temp.group_metric_eval_publish__legacy
  printf "select %s(%s, %s, gen_random_uuid(), '{}'::jsonb);" "${fn}" "${JOB_A}" "${GEN_A}"
}
apply_sql() { printf "select app_public.group_eval_apply('%s', '%s', '%s', array['set']);" "${GID}" "${OWNER_UID}" "$1"; }
cow_publish_sql() {
  printf "select app_public.group_cow_eval_publish('%s', 1, gen_random_uuid(), 0, 'none', '{}'::jsonb);" "${COW_ID}"
}

# =============================================================================
echo "[${LANE_LABEL}] deadlock: an evaluator completion against a publisher"
# =============================================================================

deadlock_case() {
  local mode="$1" p_out e_out
  reset_queue
  bg_start E; bg_start P
  [[ "${mode}" == new ]] || { bg_send P "${OLD_PUBLISH_SQL}"; bg_read P >/dev/null; }
  # The completion re-applies Lift A first: it now holds A's queue row.
  bg_send E "begin; $(apply_sql "${GX_A}")"; bg_read E >/dev/null
  # The publisher takes the group row, then waits for A's queue row.
  bg_send P "begin; $(publish_sql "${mode}")"
  wait_for_lock P "${mode} publisher behind the completion"
  # The completion queues Lift B: its insert's FK check locks the group row KEY SHARE.
  bg_send E "$(apply_sql "${GX_B}")"
  e_out="$(bg_read E)"
  bg_send E "commit;"; bg_read E >/dev/null
  p_out="$(bg_read P)"
  bg_send P "commit;"; bg_read P >/dev/null
  bg_stop E; bg_stop P
  if [[ "${mode}" == old ]]; then
    [[ "${e_out} ${p_out}" == *"deadlock detected"* ]] ||
      fail "old lock order: expected a deadlock (completion: '${e_out}', publisher: '${p_out}')"
  else
    [[ "${e_out} ${p_out}" != *"ERROR"* ]] ||
      fail "new lock order: completion or publisher failed (completion: '${e_out}', publisher: '${p_out}')"
    [[ "$(jq -r '.completed' <<<"${p_out}")" == false ]] ||
      fail "new lock order: the publisher did not finish after the completion ('${p_out}')"
    expect_sql_eq "both comparisons stay queued, A re-queued past the publisher's generation" \
      "select count(*) = 2 and bool_and(group_exercise_id <> '${GX_A}' or generation = ${GEN_A} + 1)
         from app_public.group_metric_eval_queue where group_id = '${GID}';" t
  fi
  pass "deadlock (${mode} definitions): $([[ "${mode}" == old ]] && echo 'reproduced' || echo 'none; both finish')"
}

expect_sql_eq() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}

deadlock_case old
deadlock_case new

# =============================================================================
echo "[${LANE_LABEL}] readers: a held member check against a publisher"
# =============================================================================

reader_case() {
  local mode="$1" fn=app_public.group_competition_require_member p_out
  reset_queue
  bg_start R; bg_start P
  if [[ "${mode}" == old ]]; then
    fn=pg_temp.group_competition_require_member__legacy
    bg_send R "${OLD_READER_SQL}"; bg_read R >/dev/null
    bg_send P "${OLD_PUBLISH_SQL}"; bg_read P >/dev/null
  fi
  # A screen read's transaction: its member check, then a slow query.
  bg_send R "begin; select ${fn}('${GID}', '${OWNER_UID}');"
  [[ "$(bg_read R)" == owner ]] || fail "${mode} reader: member check did not pass"
  bg_send P "begin; set local lock_timeout = '2s'; $(publish_sql "${mode}")"
  p_out="$(bg_read P)"
  bg_send P "rollback;"; bg_read P >/dev/null
  bg_stop R; bg_stop P
  if [[ "${mode}" == old ]]; then
    [[ "${p_out}" == *"lock timeout"* ]] || fail "old definitions: the reader did not block the publisher ('${p_out}')"
  else
    [[ "$(jq -r '.completed' <<<"${p_out}" 2>/dev/null)" == false ]] ||
      fail "new definitions: the publisher waited on or failed behind a reader ('${p_out}')"
  fi
  pass "reader (${mode} definitions): $([[ "${mode}" == old ]] && echo 'blocked the publisher' || echo 'does not block the publisher')"
}

reader_case old
reader_case new

# =============================================================================
echo "[${LANE_LABEL}] CoW publication against a comparison publisher and a manager"
# =============================================================================

cow_case() {
  local mode="$1" c_out
  reset_queue
  bg_start E; bg_start P; bg_start R
  [[ "${mode}" == new ]] || { bg_send P "${OLD_PUBLISH_SQL}"; bg_read P >/dev/null; }
  # A comparison publisher in flight: it holds the group row while it waits
  # for a completion's hold on its queue row.
  bg_send E "begin; $(apply_sql "${GX_A}")"; bg_read E >/dev/null
  bg_send P "begin; $(publish_sql "${mode}")"
  wait_for_lock P "${mode} publisher in flight"
  bg_send R "begin; set local lock_timeout = '2s'; $(cow_publish_sql)"
  c_out="$(bg_read R)"
  bg_send R "rollback;"; bg_read R >/dev/null
  bg_send E "rollback;"; bg_read E >/dev/null
  bg_read P >/dev/null
  bg_stop E; bg_stop P; bg_stop R
  if [[ "${mode}" == old ]]; then
    [[ "${c_out}" == *"lock timeout"* ]] || fail "old definitions: CoW publication did not wait for the publisher ('${c_out}')"
  else
    [[ "$(jq -r '.completed' <<<"${c_out}" 2>/dev/null)" == false ]] ||
      fail "new definitions: CoW publication waited on or failed behind a comparison publisher ('${c_out}')"
  fi
  pass "CoW publication (${mode} definitions): $([[ "${mode}" == old ]] && echo 'waited for' || echo 'does not wait for') a comparison publisher"
}

cow_case old
cow_case new

# A manager's write (group_require_member with its lock) holds the group row
# FOR UPDATE before the CoW fence; CoW publication still waits for it.
bg_start E; bg_start R
bg_send E "begin; select app_public.group_require_member('${GID}', '${OWNER_UID}', true);"
[[ "$(bg_read E)" == owner ]] || fail "manager lock not taken"
bg_send R "begin; $(cow_publish_sql)"
wait_for_lock R "CoW publication behind a manager"
expect_sql_eq "CoW publication waits on the manager's group-row lock, before its fence" \
  "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid = l.pid
     where a.pid = ${BG_R_BACKEND} and not l.granted and l.locktype = 'transactionid')
     and not exists(select 1 from pg_locks where pid = ${BG_R_BACKEND} and locktype = 'advisory');" t
bg_send E "rollback;"; bg_read E >/dev/null
[[ "$(jq -r '.completed' <<<"$(bg_read R)")" == false ]] || fail "CoW publication did not finish once the manager left"
bg_send R "rollback;"; bg_read R >/dev/null
bg_stop E; bg_stop R
pass "CoW publication still waits for a manager's group-row lock"

COMPLETED=1
echo "[${LANE_LABEL}] all publish-lock checks passed"
