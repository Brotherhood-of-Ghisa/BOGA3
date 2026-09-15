#!/usr/bin/env bash

# groups-boards.sh — M25 boards and events contract (the second body of the
# groups-leaderboards lane; groups-leaderboards.sh proves the pipeline).
#
# Contract: docs/specs/tech/groups-contract.md §2.6, §2.10–§2.11, §4.2, §4.5.
# Proves, against the real local stack (sync_push, group-eval, PostgREST):
#
#   - posture of group_board_entries / group_board_state and the read RPCs;
#   - every row of design §5's change table (R1–R10), one section each;
#   - the provisional rule for active sessions (T8), D6 conversion, P7 ties,
#     rejoin catch-up, the per-group advisory lock, apply failure isolation;
#   - group_board_podiums / group_board / group_board_history shapes, paging,
#     and error tokens; group_stream's record / record_voided / link items.
#
# Direct-drain mode as groups-leaderboards.sh: the kick URL is unset and the
# sweep paused for the run; the lane POSTs group-eval itself. Hermetic:
# per-run users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-boards"
FIXTURE_EMAIL_PREFIX="groups-bd"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1

RUN_TAG="${GROUPS_BOARDS_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsBoards!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
FORCE_APPLY_CONSTRAINT="groups_bd_force_apply_failure"
BOARD_LOCK_KEY=25005

RUN_USER_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"

set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  run_psql "set client_min_messages = warning;
            alter table app_public.group_board_entries drop constraint if exists ${FORCE_APPLY_CONSTRAINT};" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event like 'group.%' and user_id in (${ids});
      delete from app_public.group_eval_queue where member_user_id in (${ids});
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

# check_args <context> [--arg name value]... <filter>: `check` with its jq args first.
check_args() {
  local context="$1"
  shift
  local -a args=()
  while [[ "${1:-}" == "--arg" ]]; do args+=("$1" "$2" "$3"); shift 3; done
  check "${context}" "$1" "${args[@]}"
}

expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}

drain() {
  local out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "Content-Type: application/json" -H "x-group-eval-secret: ${EVAL_SECRET}" \
    -o "${out}" -w "%{http_code}" --data '{}' "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}

# e1rm <weight> <reps>: the Wathan estimate, rounded like the boards (6 dp, trimmed).
e1rm() {
  node -e 'const [w, r, f] = process.argv.slice(1).map(Number);
           const v = (100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r))) * (f || 1);
           process.stdout.write(String(Number(v.toFixed(6))));' "$1" "$2" "${3:-1}"
}

# who <uuid>: the short label the event and entry summaries print.
who() {
  case "$1" in
    "${ATHLETE_UID}") echo A ;;
    "${RIVAL_UID}") echo R ;;
    "${AWAY_UID}") echo M ;;
    *) echo "?" ;;
  esac
}
WHO_SQL() { # a SQL case expression mapping member uuids in column $1 to A/R/M
  echo "case $1 when '${ATHLETE_UID}' then 'A' when '${RIVAL_UID}' then 'R' when '${AWAY_UID}' then 'M' else '?' end"
}

# entry <gx> <member-label> <metric>: `value@set` or empty.
entry() {
  local uid
  case "$2" in A) uid="${ATHLETE_UID}" ;; R) uid="${RIVAL_UID}" ;; M) uid="${AWAY_UID}" ;; esac
  run_psql "select value_kg || '@' || replace(set_id, '${T}-', '') from app_public.group_board_entries
             where group_exercise_id = '$1' and member_user_id = '${uid}' and metric = '$3' and not certified;"
}
expect_entry() {
  local actual
  actual="$(entry "$1" "$2" "$3")"
  [[ "${actual}" == "$4" ]] || fail "$5: entry $2/$3 expected '$4', got '${actual}'"
}

# mark: remember the newest event; since <gx>: the events written after it,
# as `kind[:reason][:metric]@who`, in write order.
MARK=0
mark() { MARK="$(run_psql "select coalesce(max(seq), 0) from app_public.group_events;")"; }
since() {
  run_psql "select coalesce(string_agg(kind || coalesce(':' || reason, '') || coalesce(':' || metric, '')
                                       || '@' || $(WHO_SQL member_user_id), ',' order by seq), '')
              from app_public.group_events
             where seq > ${MARK} and group_exercise_id = '$1';"
}
expect_since() {
  local actual
  actual="$(since "$1")"
  [[ "${actual}" == "$2" ]] || fail "$3: events expected '$2', got '${actual}'"
}

# The latest event of a kind for a target, as a column value.
latest() { # latest <gx> <kind> <column-sql>
  run_psql "select $3 from app_public.group_events where group_exercise_id = '$1' and kind = '$2'
             order by seq desc limit 1;"
}

# --- sync_push builders -----------------------------------------------------------

SESSION_AT=0
next_session_at() { SESSION_AT=$(( SESSION_AT + 60000 )); }

# sess <token> <session> <active|completed> <definition> <set-spec>...
#   set-spec = <set-suffix>:<weight>:<reps>[:<status>[:<deleted>]] on one
#   exercise `<session>-se`; the session starts at SESSION_AT.
sess() {
  local token="$1" sid="$2" status="$3" def="$4"
  shift 4
  next_cuam
  local done=null dur=null
  if [[ "${status}" == "completed" ]]; then done=$(( SESSION_AT + 3600000 )); dur=3600; fi
  local -a rows=("$(e_session "${sid}" "${SESSION_AT}" "${status}" "${done}" "${dur}" null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r st del
  for spec in "$@"; do
    IFS=: read -r id w r st del <<<"${spec}"
    rows+=("$(e_set "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "${st:-}" "${CUAM}" "${del:-null}")")
    order=$(( order + 1 ))
  done
  push "${token}" "session ${sid}" "${rows[@]}"
}

# set_edit <token> <session> <set-suffix> <order> <weight> <reps> [status] [deleted]
set_edit() {
  next_cuam
  push "$1" "edit $3" "$(e_set "${T}-$3" "$2-se" "$4" "$5" "$6" "${7:-}" "${CUAM}" "${8:-null}")"
}

# session_status <token> <session> <started> <active|completed> [deleted]
session_row() {
  next_cuam
  local done=null dur=null
  if [[ "$4" == "completed" ]]; then done=$(( $3 + 3600000 )); dur=3600; fi
  push "$1" "session $2 $4" "$(e_session "$2" "$3" "$4" "${done}" "${dur}" "${5:-null}" "${CUAM}")"
}

# def <token> <id> <mode>
def() { next_cuam; push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}" "$3")"; }
# link <token> <definition> <group> <group-exercise> [deleted]
link() {
  next_cuam
  local del="${5:-}"
  [[ -z "${del}" ]] || del="${CUAM}"
  push "$1" "link $2 → $4" "$(e_link "$2" "$3" "$4" "${CUAM}" "${del:-null}")"
}

# gx <name> <mode> [group]: a new group exercise (owner); echoes its id.
gx() {
  rpc "${OWNER_TOKEN}" group_exercise_create \
    "$(jq -nc --arg g "${3:-${GID}}" --arg n "$1" --arg m "$2" \
        '{p_group_id: $g, p_name: $n, p_load_input_mode: $m, p_source_exercise_id: null}')"
  expect_ok "group_exercise_create $1"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}

# board <token> <gx> <metric> <certified> [after-json] [limit]: group_board into BODY.
board() {
  rpc "$1" group_board "$(jq -nc --arg g "${GID}" --arg x "$2" --arg m "$3" --argjson c "$4" \
      --argjson a "${5:-null}" --argjson l "${6:-null}" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c, p_after: $a, p_limit: $l}')"
}
history() {
  rpc "$1" group_board_history "$(jq -nc --arg g "${GID}" --arg x "$2" --arg m "$3" --argjson c "$4" \
      --argjson b "${5:-null}" --argjson l "${6:-null}" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c, p_before: $b, p_limit: $l}')"
}

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
provision ATHLETE athlete
provision RIVAL rival
provision AWAY away
provision OUTSIDER outsider
for pair in "OWNER:owner" "ATHLETE:athlete" "RIVAL:rival" "AWAY:away" "OUTSIDER:outsider"; do
  uid_var="${pair%%:*}_UID"
  set_username "${!uid_var}" "bd_${pair##*:}_${RUN_TAG//-/_}"
done

set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "BD ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create G"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OUTSIDER_TOKEN}" group_create "$(jq -nc --arg n "BD other ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create H"
HID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "group_invite_get"
INVITE_CODE="$(jq -er '.code' <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${AWAY_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
  expect_ok "join G"
done

T="bd-${RUN_TAG}"
CUAM="$(now_ms)"
SESSION_AT=$(( CUAM + 1000 ))
drain "setup"
pass "users, group G (athlete A, rival R, member M), outsider group H"

# =============================================================================
echo "[${LANE_LABEL}] posture"
# =============================================================================

for table in group_board_entries group_board_state; do
  expect_sql "${table}: RLS on" "select relrowsecurity from pg_class where oid = 'app_public.${table}'::regclass;" "t"
  expect_sql "${table}: no policies" \
    "select count(*) from pg_policies where schemaname = 'app_public' and tablename = '${table}';" "0"
  expect_sql "${table}: no anon/authenticated privileges" \
    "select count(*) from information_schema.role_table_grants
      where table_schema = 'app_public' and table_name = '${table}' and grantee in ('anon', 'authenticated', 'public');" "0"
  expect_sql "${table}: no owner_user_id column" \
    "select count(*) from information_schema.columns
      where table_schema = 'app_public' and table_name = '${table}' and column_name = 'owner_user_id';" "0"
  expect_sql "${table}: no FK into a Sync v2 table" \
    "select count(*) from pg_constraint c join pg_class t on t.oid = c.confrelid
      where c.conrelid = 'app_public.${table}'::regclass and c.contype = 'f'
        and exists (select 1 from information_schema.columns col
                     where col.table_schema = 'app_public' and col.table_name = t.relname
                       and col.column_name = 'owner_user_id');" "0"
  for bearer in "${ATHLETE_TOKEN}" "${ANON_KEY}"; do
    rest GET "${bearer}" "${table}" "select=*"
    if [[ "${STATUS}" =~ ^2 ]]; then
      check "direct select ${table} must return nothing" 'length == 0'
    else
      check "direct select ${table} must be a 42501 denial (HTTP ${STATUS})" '.code == "42501"'
    fi
  done
done

BOARD_FNS="p.proname like 'group\\_board%' or p.proname in ('group_eval_apply', 'group_stream_event_json')"
expect_sql "every board function pins search_path" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false);" "0"
expect_sql "clients execute exactly the three board reads" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute');" \
  "group_board,group_board_history,group_board_podiums"
expect_sql "service_role executes no board internal" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and p.proname not in ('group_board', 'group_board_history', 'group_board_podiums')
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "the three reads are security definer" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.prosecdef
      and p.proname in ('group_board', 'group_board_history', 'group_board_podiums');" "3"
expect_sql "the rejoin catch-up trigger" \
  "select count(*) from pg_trigger where tgrelid = 'app_public.group_memberships'::regclass
      and tgname = 'group_memberships_board_catch_up' and not tgisinternal;" "1"
pass "tables, grants, direct-access denial"

# boards_of <gx> <kind>: the latest such event's boards as `metric:previous:group_record`.
boards_of() {
  run_psql "select string_agg((b ->> 'metric') || ':' || coalesce(b ->> 'previous_value_kg', 'null') || ':'
                              || (b ->> 'group_record'), ',' order by b ->> 'metric')
              from jsonb_array_elements((select payload -> 'boards' from app_public.group_events
                                          where group_exercise_id = '$1' and kind = 'record'
                                          order by seq desc limit 1)) b;"
}

# =============================================================================
echo "[${LANE_LABEL}] R1 — a new set beats my best"
# =============================================================================

GX1="$(gx "R1 bench" total_load)"
DA1="${T}-dA1"; DR1="${T}-dR1"
def "${ATHLETE_TOKEN}" "${DA1}" total_load
link "${ATHLETE_TOKEN}" "${DA1}" "${GID}" "${GX1}"
def "${RIVAL_TOKEN}" "${DR1}" total_load
link "${RIVAL_TOKEN}" "${DR1}" "${GID}" "${GX1}"
mark
drain "R1 links"
expect_since "${GX1}" "" "a link with no counting sets moves nothing"

next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1a" completed "${DA1}" "r1a1:100:5"
drain "R1 first set"
expect_since "${GX1}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" "R1 first counting set (D1)"
[[ "$(boards_of "${GX1}")" == "e1rm:null:true,weight:null:true" ]] || fail "R1 first record boards: $(boards_of "${GX1}")"
expect_entry "${GX1}" A weight "100@r1a1" "R1"
expect_entry "${GX1}" A e1rm "$(e1rm 100 5)@r1a1" "R1"
expect_sql "R1 the first lead change points at its record and has no previous leader" \
  "select (related_event_id = (select id from app_public.group_events where group_exercise_id = '${GX1}' and kind = 'record'))
          || ':' || jsonb_typeof(payload -> 'previous') || ':' || (payload -> 'leader' ->> 'member_user_id')
     from app_public.group_events where group_exercise_id = '${GX1}' and kind = 'lead_change' and metric = 'weight';" \
  "true:null:${ATHLETE_UID}"

mark
next_session_at
sess "${RIVAL_TOKEN}" "${T}-s1r" completed "${DR1}" "r1r1:110:3"
drain "R1 rival"
expect_since "${GX1}" "record@R,lead_change:record:weight@R,lead_change:record:e1rm@R" "R1 rival takes #1"
[[ "$(boards_of "${GX1}")" == "e1rm:null:true,weight:null:true" ]] || fail "R1 rival boards: $(boards_of "${GX1}")"
[[ "$(latest "${GX1}" lead_change "payload -> 'previous' ->> 'member_user_id'")" == "${ATHLETE_UID}" ]] ||
  fail "R1 the lead change names the previous leader"

mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1b" completed "${DA1}" "r1b1:90:5"
drain "R1 no beat"
expect_since "${GX1}" "" "R1 a set that doesn't beat my best writes nothing"
expect_entry "${GX1}" A weight "100@r1a1" "R1 no beat"

mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1c" completed "${DA1}" "r1c1:105:2"
drain "R1 personal record only"
expect_since "${GX1}" "record@A" "R1 a PR that is not #1: record, no lead change"
[[ "$(boards_of "${GX1}")" == "weight:100:false" ]] || fail "R1 PR boards: $(boards_of "${GX1}")"
pass "R1: records (first set included), group-record flag, lead changes only when #1 moves"

# =============================================================================
echo "[${LANE_LABEL}] R2 — a record set edited down, made unperformed, or deleted"
# =============================================================================

GX2="$(gx "R2 squat" total_load)"
DA2="${T}-dA2"; DR2="${T}-dR2"
def "${ATHLETE_TOKEN}" "${DA2}" total_load
link "${ATHLETE_TOKEN}" "${DA2}" "${GID}" "${GX2}"
def "${RIVAL_TOKEN}" "${DR2}" total_load
link "${RIVAL_TOKEN}" "${DR2}" "${GID}" "${GX2}"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-s2r" completed "${DR2}" "r2r1:90:5"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s2a" completed "${DA2}" "r2a1:100:5" "r2a2:70:5"
drain "R2 setup"
expect_entry "${GX2}" A weight "100@r2a1" "R2 setup"

mark
set_edit "${ATHLETE_TOKEN}" "${T}-s2a" r2a1 0 80 5
drain "R2 edited down"
expect_since "${GX2}" "record_voided:edited@A,lead_change:void:weight@A,lead_change:void:e1rm@A" "R2 edited down"
expect_entry "${GX2}" A weight "80@r2a1" "R2 edited down falls back"
expect_sql "R2 the lead change points at the void" \
  "select (select related_event_id from app_public.group_events where group_exercise_id = '${GX2}'
            and kind = 'lead_change' order by seq desc limit 1)
        = (select id from app_public.group_events where group_exercise_id = '${GX2}' and kind = 'record_voided');" "t"
[[ "$(latest "${GX2}" record_voided "payload -> 'leaders' -> 0 -> 'leader' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "R2 the void names who now holds the record"

next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s2b" completed "${DA2}" "r2b1:120:5"
drain "R2 record again"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s2b" r2b1 0 120 5 unperformed
drain "R2 unperformed"
expect_since "${GX2}" "record_voided:edited@A,lead_change:void:weight@A,lead_change:void:e1rm@A" "R2 unperformed"

next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s2c" completed "${DA2}" "r2c1:130:5"
drain "R2 record a third time"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s2c" r2c1 0 130 5 "" "$(now_ms)"
drain "R2 deleted"
expect_since "${GX2}" "record_voided:deleted@A,lead_change:void:weight@A,lead_change:void:e1rm@A" "R2 deleted"
expect_entry "${GX2}" A weight "80@r2a1" "R2 deleted falls back"
expect_sql "R2 every record card stays, each voided once" \
  "select count(*) filter (where kind = 'record') || ':' || count(*) filter (where kind = 'record_voided')
     from app_public.group_events where group_exercise_id = '${GX2}' and member_user_id = '${ATHLETE_UID}';" "3:3"
pass "R2: edited down, unperformed, deleted → void, fallback entry, lead_change{void}"

# =============================================================================
echo "[${LANE_LABEL}] R3 — a record set edited up"
# =============================================================================

GX3="$(gx "R3 row" total_load)"
DA3="${T}-dA3"
def "${ATHLETE_TOKEN}" "${DA3}" total_load
link "${ATHLETE_TOKEN}" "${DA3}" "${GID}" "${GX3}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s3" completed "${DA3}" "r3a1:100:5"
drain "R3 record"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s3" r3a1 0 110 5
drain "R3 edited up"
expect_since "${GX3}" "record_voided:edited@A,record@A" "R3 void the old record and record the new value"
expect_sql "R3 both records are the same set, one voided" \
  "select count(*) || ':' || count(*) filter (where exists (select 1 from app_public.group_events v
            where v.kind = 'record_voided' and v.related_event_id = e.id))
     from app_public.group_events e where e.group_exercise_id = '${GX3}' and e.kind = 'record' and e.set_id = '${T}-r3a1';" "2:1"
expect_entry "${GX3}" A weight "110@r3a1" "R3"
pass "R3: edited up → void + new record"

# =============================================================================
echo "[${LANE_LABEL}] R4 — a session deleted, then undeleted"
# =============================================================================

GX4="$(gx "R4 press" total_load)"
DA4="${T}-dA4"
def "${ATHLETE_TOKEN}" "${DA4}" total_load
link "${ATHLETE_TOKEN}" "${DA4}" "${GID}" "${GX4}"
next_session_at
S4_AT="${SESSION_AT}"
sess "${ATHLETE_TOKEN}" "${T}-s4" completed "${DA4}" "r4a1:100:5"
drain "R4 record"
R4_RECORD="$(latest "${GX4}" record "id")"
mark
session_row "${ATHLETE_TOKEN}" "${T}-s4" "${S4_AT}" completed "$(now_ms)"
drain "R4 session deleted"
expect_since "${GX4}" "record_voided:deleted@A,lead_change:void:weight@A,lead_change:void:e1rm@A" "R4 session deleted"
expect_entry "${GX4}" A weight "" "R4 the board empties"
expect_sql "R4 an emptied board's lead change has no leader" \
  "select jsonb_typeof(payload -> 'leader') from app_public.group_events
    where group_exercise_id = '${GX4}' and kind = 'lead_change' order by seq desc limit 1;" "null"

# The voided card stays in the stream while its session is tombstoned (D15).
rpc "${RIVAL_TOKEN}" group_stream "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_before: null, p_limit: 50}')"
expect_ok "stream with a tombstoned session"
check_args "R4 the voided record card stays in the stream" \
  --arg k "${R4_RECORD}" '[.items[] | select(.kind == "record" and .key == $k)][0].voided.reason == "deleted"'

mark
session_row "${ATHLETE_TOKEN}" "${T}-s4" "${S4_AT}" completed
drain "R4 session undeleted"
expect_since "${GX4}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" "R4 undelete: fresh record"
[[ "$(latest "${GX4}" record "id")" != "${R4_RECORD}" ]] || fail "R4 the fresh record is a new event"
pass "R4: session delete voids; undelete writes fresh records"

# =============================================================================
echo "[${LANE_LABEL}] R5 — link, unlink, retarget"
# =============================================================================

GX5="$(gx "R5 deadlift" total_load)"
GX5B="$(gx "R5 deadlift (alt)" total_load)"
DA5="${T}-dA5"; DA5B="${T}-dA5b"; DR5="${T}-dR5"
def "${RIVAL_TOKEN}" "${DR5}" total_load
link "${RIVAL_TOKEN}" "${DR5}" "${GID}" "${GX5}"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-s5r" completed "${DR5}" "r5r1:100:5"
# The athlete's sets predate their links: linking makes them count retroactively.
def "${ATHLETE_TOKEN}" "${DA5}" total_load
def "${ATHLETE_TOKEN}" "${DA5B}" total_load
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s5a" completed "${DA5}" "r5a1:120:5"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s5b" completed "${DA5B}" "r5b1:50:5"
drain "R5 setup"

mark
link "${ATHLETE_TOKEN}" "${DA5}" "${GID}" "${GX5}"
drain "R5 link"
expect_since "${GX5}" "link@A,lead_change:link:weight@A,lead_change:link:e1rm@A" "R5 link"
expect_sql "R5 a retroactive link writes no record (P16)" \
  "select count(*) from app_public.group_events where group_exercise_id = '${GX5}' and kind = 'record'
      and member_user_id = '${ATHLETE_UID}';" "0"
expect_sql "R5 the link item's effects and exercises" \
  "select (payload -> 'exercise_definition_ids') = '[\"${DA5}\"]'::jsonb
          and (payload -> 'effects' -> 1 ->> 'metric') = 'weight'
          and jsonb_typeof(payload -> 'effects' -> 1 -> 'before') = 'null'
          and (payload -> 'effects' -> 1 -> 'after') = '{\"rank\": 1, \"value_kg\": 120}'::jsonb
     from app_public.group_events where group_exercise_id = '${GX5}' and kind = 'link';" "t"
[[ "$(latest "${GX5}" lead_change "related_event_id")" == "$(latest "${GX5}" link "id")" ]] ||
  fail "R5 the lead change points at the link item"

mark
link "${ATHLETE_TOKEN}" "${DA5B}" "${GID}" "${GX5}"
drain "R5 link that moves nothing"
expect_since "${GX5}" "" "R5 a link that moves no entry writes no item"

mark
link "${ATHLETE_TOKEN}" "${DA5}" "${GID}" "${GX5}" deleted
drain "R5 unlink"
expect_since "${GX5}" "unlink@A,lead_change:link:weight@A,lead_change:link:e1rm@A" "R5 unlink"
expect_entry "${GX5}" A weight "50@r5b1" "R5 unlink falls back to the still-linked exercise"
expect_sql "R5 unlink never voids a record" \
  "select count(*) from app_public.group_events where group_exercise_id = '${GX5}' and kind = 'record_voided';" "0"

# Retarget within the group: the same deterministic link id moves GX5 → GX5B.
mark
link "${ATHLETE_TOKEN}" "${DA5B}" "${GID}" "${GX5B}"
drain "R5 retarget"
expect_since "${GX5}" "unlink@A" "R5 retarget leaves the old board (R stays #1)"
expect_since "${GX5B}" "link@A,lead_change:link:weight@A,lead_change:link:e1rm@A" "R5 retarget joins the new board"
expect_entry "${GX5}" A weight "" "R5 retarget: no entry left on the old board"
pass "R5: link, unlink, retarget → link/unlink items, lead_change{link}, no records"

# =============================================================================
echo "[${LANE_LABEL}] R6 — certification (T06): Certified boards stay empty"
# =============================================================================

expect_sql "R6 no Certified entry exists" \
  "select count(*) from app_public.group_board_entries where group_id = '${GID}' and certified;" "0"
rpc "${ATHLETE_TOKEN}" group_board_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "podiums (defaults: Certified · e1RM)"
check_args "R6 Certified podiums are empty, with the All count for the empty state" \
  --arg x "${GX1}" \
  '.metric == "e1rm" and .certified == true
   and all(.exercises[]; .podium == [] and .me == null and .entry_count == 0)
   and ([.exercises[] | select(.exercise.group_exercise_id == $x)][0].all_entry_count == 2)'
pass "R6: no Certified entries; Certified podiums empty (T06 fills them)"

# =============================================================================
echo "[${LANE_LABEL}] R7 — load_input_mode changed (D6 conversion)"
# =============================================================================

GX7="$(gx "R7 curl (per side)" per_side_load)"
GX7B="$(gx "R7 lunge (total)" total_load)"
DA7="${T}-dA7"; DA7B="${T}-dA7b"
def "${ATHLETE_TOKEN}" "${DA7}" total_load
link "${ATHLETE_TOKEN}" "${DA7}" "${GID}" "${GX7}"
def "${ATHLETE_TOKEN}" "${DA7B}" per_side_load
link "${ATHLETE_TOKEN}" "${DA7B}" "${GID}" "${GX7B}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s7" completed "${DA7}" "r7a1:100:5"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s7b" completed "${DA7B}" "r7b1:40:8"
drain "R7 setup"
expect_entry "${GX7}" A weight "50@r7a1" "D6 total → per side ÷2"
expect_entry "${GX7}" A e1rm "$(e1rm 100 5 0.5)@r7a1" "D6 e1RM ÷2"
expect_entry "${GX7B}" A weight "80@r7b1" "D6 per side → total ×2"
expect_entry "${GX7B}" A e1rm "$(e1rm 40 8 2)@r7b1" "D6 e1RM ×2"
expect_sql "D6 the entered value and factor are kept" \
  "select string_agg(entered_weight_kg || 'x' || load_factor, ',' order by group_exercise_id = '${GX7}' desc)
     from app_public.group_board_entries
    where group_exercise_id in ('${GX7}', '${GX7B}') and member_user_id = '${ATHLETE_UID}' and metric = 'weight';" \
  "100x0.5,40x2"

mark
def "${ATHLETE_TOKEN}" "${DA7}" per_side_load
drain "R7 mode up"
expect_since "${GX7}" "record_voided:edited@A,record@A" "R7 rescale up: void + record"
expect_entry "${GX7}" A weight "100@r7a1" "R7 rescale up"
mark
def "${ATHLETE_TOKEN}" "${DA7}" total_load
drain "R7 mode down"
expect_since "${GX7}" "record_voided:edited@A" "R7 rescale down: void"
expect_entry "${GX7}" A weight "50@r7a1" "R7 rescale down"
pass "R7: load mode rescales like an edit; D6 in both directions"

# =============================================================================
echo "[${LANE_LABEL}] R9 — an archived board is frozen; unarchive catches up"
# =============================================================================

GX9="$(gx "R9 dip" total_load)"
DA9="${T}-dA9"
def "${ATHLETE_TOKEN}" "${DA9}" total_load
link "${ATHLETE_TOKEN}" "${DA9}" "${GID}" "${GX9}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s9a" completed "${DA9}" "r9a1:100:5"
drain "R9 setup"
rpc "${OWNER_TOKEN}" group_exercise_archive "$(jq -nc --arg g "${GID}" --arg e "${GX9}" '{p_group_id: $g, p_exercise_id: $e}')"
expect_ok "archive GX9"
mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s9b" completed "${DA9}" "r9b1:150:5"
drain "R9 while archived"
expect_since "${GX9}" "" "R9 no event while archived"
expect_entry "${GX9}" A weight "100@r9a1" "R9 entries frozen"
board "${ATHLETE_TOKEN}" "${GX9}" weight false
expect_ok "an archived board is readable"
check "R9 the archived board still serves its rows" '.rows[0].value_kg == 100 and .exercise.archived_at_ms != null'
rpc "${OWNER_TOKEN}" group_exercise_unarchive "$(jq -nc --arg g "${GID}" --arg e "${GX9}" '{p_group_id: $g, p_exercise_id: $e}')"
expect_ok "unarchive GX9"
drain "R9 unarchive catch-up"
expect_since "${GX9}" "record@A" "R9 sets logged while archived count after unarchive"
expect_entry "${GX9}" A weight "150@r9b1" "R9 catch-up"
pass "R9: archived boards frozen and readable; unarchive applies what was missed"

# =============================================================================
echo "[${LANE_LABEL}] R10 — a rules_version bump recomputes silently"
# =============================================================================

run_psql "update app_public.group_board_entries set value_kg = 1
           where group_exercise_id = '${GX1}' and member_user_id = '${ATHLETE_UID}' and metric = 'weight';" >/dev/null
mark
expect_sql "R10 a rules bump requeues evaluated sessions" "select app_public.group_eval_requeue_rules(2, 1000) >= 1;" "t"
drain "R10 rules"
expect_entry "${GX1}" A weight "105@r1c1" "R10 the recompute corrects entries"
expect_sql "R10 the recompute writes no event in the group" \
  "select count(*) from app_public.group_events where group_id = '${GID}' and seq > ${MARK};" "0"
pass "R10: rules recompute corrects entries silently"

# =============================================================================
echo "[${LANE_LABEL}] provisional records in an active session (T8)"
# =============================================================================

GXP="$(gx "T8 clean" total_load)"
DAP="${T}-dAP"; DRP="${T}-dRP"
def "${ATHLETE_TOKEN}" "${DAP}" total_load
link "${ATHLETE_TOKEN}" "${DAP}" "${GID}" "${GXP}"
def "${RIVAL_TOKEN}" "${DRP}" total_load
link "${RIVAL_TOKEN}" "${DRP}" "${GID}" "${GXP}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sp0" completed "${DAP}" "p0:80:5"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-spr" completed "${DRP}" "pr1:90:5"
drain "T8 setup"

mark
next_session_at
SPA_AT="${SESSION_AT}"
sess "${ATHLETE_TOKEN}" "${T}-spa" active "${DAP}" "pa1:100:5"
drain "T8 provisional record"
expect_since "${GXP}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" "T8 record cards appear mid-session (D2)"
PREC="$(latest "${GXP}" record "id")"

mark
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 1000 5
drain "T8 typo up"
expect_since "${GXP}" "" "T8 an edit up while active writes no event"
expect_sql "T8 the same record is updated in place, with its lead change" \
  "select (select payload ->> 'weight_kg' from app_public.group_events where id = '${PREC}') || ':' ||
          (select payload -> 'leader' ->> 'value_kg' from app_public.group_events
            where related_event_id = '${PREC}' and kind = 'lead_change' and metric = 'weight');" "1000:1000"

expect_sql "T8 an in-place edit keeps the record's previous best" \
  "select b ->> 'previous_value_kg' from jsonb_array_elements((select payload -> 'boards' from app_public.group_events
                                                                where id = '${PREC}')) b
    where b ->> 'metric' = 'weight';" "80"

set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 95 5
drain "T8 fixed to a value that still beats the previous best"
expect_since "${GXP}" "" "T8 a fix that still beats the previous best writes no event"
expect_sql "T8 the card stays at the corrected value, against the same previous best, and still leads" \
  "select (payload ->> 'weight_kg') || ':'
          || (select b ->> 'previous_value_kg' from jsonb_array_elements(payload -> 'boards') b where b ->> 'metric' = 'weight')
          || ':' || (select lc.payload -> 'leader' ->> 'value_kg' from app_public.group_events lc
                      where lc.related_event_id = '${PREC}' and lc.kind = 'lead_change' and lc.metric = 'weight')
     from app_public.group_events where id = '${PREC}';" "95:80:95"

set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 85 5
drain "T8 fixed below the rival but above the previous best"
expect_since "${GXP}" "" "T8 losing #1 through a provisional fix writes no event"
expect_sql "T8 the record stays; its lead changes are retracted" \
  "select (select count(*) from app_public.group_events where id = '${PREC}') || ':'
          || (select count(*) from app_public.group_events where related_event_id = '${PREC}');" "1:0"
[[ "$(latest "${GXP}" lead_change "payload -> 'leader' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "T8 a retracted lead change leaves history ending with the rival's lead"

set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 70 5
drain "T8 typo fixed below the previous best"
expect_since "${GXP}" "" "T8 a fix below the previous best writes no void"
expect_sql "T8 the record and its lead changes are gone" \
  "select count(*) from app_public.group_events where id = '${PREC}' or related_event_id = '${PREC}';" "0"
expect_entry "${GXP}" A weight "80@p0" "T8 fallback"
[[ "$(latest "${GXP}" lead_change "payload -> 'leader' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "T8 history again ends with the rival's lead"

mark
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 100 5
drain "T8 record again"
expect_since "${GXP}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" "T8 a fresh provisional record"
mark
session_row "${ATHLETE_TOKEN}" "${T}-spa" "${SPA_AT}" completed
drain "T8 complete"
expect_since "${GXP}" "" "T8 completing the session writes nothing"
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 70 5
drain "T8 edit after completion"
expect_since "${GXP}" "record_voided:edited@A,lead_change:void:weight@A,lead_change:void:e1rm@A" "T8 once complete, an edit voids"
pass "T8: provisional records update or drop silently; voids only once the session completes"

# =============================================================================
echo "[${LANE_LABEL}] provisional retraction restores the baseline"
# =============================================================================

GXQ="$(gx "T8 baseline" total_load)"
DAQ="${T}-dAQ"; DRQ="${T}-dRQ"
def "${ATHLETE_TOKEN}" "${DAQ}" total_load
link "${ATHLETE_TOKEN}" "${DAQ}" "${GID}" "${GXQ}"
def "${RIVAL_TOKEN}" "${DRQ}" total_load
link "${RIVAL_TOKEN}" "${DRQ}" "${GID}" "${GXQ}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sq0" completed "${DAQ}" "q0:120:5"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-sqr" completed "${DRQ}" "qr1:125:5"
drain "baseline setup"

mark
next_session_at
SQA_AT="${SESSION_AT}"
sess "${ATHLETE_TOKEN}" "${T}-sqa" active "${DAQ}" "q1:200:5"
drain "typo record"
expect_since "${GXQ}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" "a provisional typo record"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-sqa" q2 1 150 5
drain "a real set below the typo"
expect_since "${GXQ}" "" "a set below the typo is not a record yet"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-sqa" q1 0 200 5 "" "$(now_ms)"
drain "the typo deleted"
expect_since "${GXQ}" "record@A,lead_change:record:weight@A,lead_change:record:e1rm@A" \
  "deleting the typo makes the real set a record against the pre-session best"
[[ "$(boards_of "${GXQ}")" == "e1rm:$(e1rm 120 5):true,weight:120:true" ]] ||
  fail "the record is measured against the pre-session best: $(boards_of "${GXQ}")"
[[ "$(latest "${GXQ}" lead_change "payload -> 'previous' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "the lead change rolls back past the retracted typo to the rival"
QREC="$(latest "${GXQ}" record "id")"

mark
session_row "${ATHLETE_TOKEN}" "${T}-sqa" "${SQA_AT}" active "$(now_ms)"
drain "active session tombstoned"
expect_since "${GXQ}" "" "tombstoning an active session writes no void"
expect_sql "its provisional record and lead changes are gone" \
  "select count(*) from app_public.group_events where id = '${QREC}' or related_event_id = '${QREC}';" "0"
expect_entry "${GXQ}" A weight "120@q0" "fallback after the tombstoned session"
[[ "$(latest "${GXQ}" lead_change "payload -> 'leader' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "history again ends with the rival's lead"
pass "provisional retraction restores the baseline; a tombstoned active session drops silently"

# =============================================================================
echo "[${LANE_LABEL}] value-based voids"
# =============================================================================

GXS="$(gx "value voids" total_load)"
DAS="${T}-dAS"
def "${ATHLETE_TOKEN}" "${DAS}" total_load
link "${ATHLETE_TOKEN}" "${DAS}" "${GID}" "${GXS}"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-ss" completed "${DAS}" "s1:100:5"
drain "value voids setup"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-ss" s1 0 "100 " 5
drain "whitespace-only edit"
expect_since "${GXS}" "" "an edit that leaves every value unchanged voids nothing"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-ss" s1 0 100 3
drain "reps-only edit"
expect_since "${GXS}" "record_voided:edited@A,record@A" "a reps edit voids the card and re-records the board it still holds"
[[ "$(boards_of "${GXS}")" == "weight:null:true" ]] ||
  fail "the replacement lists the unchanged Weight board: $(boards_of "${GXS}")"
expect_entry "${GXS}" A e1rm "$(e1rm 100 3)@s1" "the e1RM entry follows the edit"
pass "voids follow values: a whitespace edit voids nothing; a reps edit keeps the Weight card"

# =============================================================================
echo "[${LANE_LABEL}] ties (P7)"
# =============================================================================

GXT="$(gx "P7 ties" total_load)"
DAT="${T}-dAT"; DRT="${T}-dRT"
def "${ATHLETE_TOKEN}" "${DAT}" total_load
link "${ATHLETE_TOKEN}" "${DAT}" "${GID}" "${GXT}"
def "${RIVAL_TOKEN}" "${DRT}" total_load
link "${RIVAL_TOKEN}" "${DRT}" "${GID}" "${GXT}"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-str" completed "${DRT}" "tr1:100:5"
# The athlete's later session: two equal sets on two exercises of one session;
# exercise order 0 wins over set order.
next_session_at
next_cuam
push "${ATHLETE_TOKEN}" "tie session" \
  "$(e_session "${T}-sta" "${SESSION_AT}" completed $(( SESSION_AT + 3600000 )) 3600 null "${CUAM}")" \
  "$(e_se "${T}-sta-x" "${T}-sta" "${DAT}" 1 "Lift" "${CUAM}")" \
  "$(e_se "${T}-sta-y" "${T}-sta" "${DAT}" 0 "Lift" "${CUAM}")" \
  "$(e_set "${T}-tx1" "${T}-sta-x" 0 100 5 "" "${CUAM}")" \
  "$(e_set "${T}-ty1" "${T}-sta-y" 1 100 5 "" "${CUAM}")" \
  "$(e_set "${T}-ty2" "${T}-sta-y" 2 100 5 "" "${CUAM}")"
drain "P7 ties"
expect_entry "${GXT}" A weight "100@ty1" "P7 within a member: exercise order, then set order"
board "${ATHLETE_TOKEN}" "${GXT}" weight false
expect_ok "tie board"
check_args "P7 equal values rank the earlier session first" \
  --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}" \
  '[.rows[] | [.rank, .member.user_id]] == [[1, $r], [2, $a]]'
pass "P7: ties go to the earlier date, then exercise order, then set order"

# =============================================================================
echo "[${LANE_LABEL}] rejoin catch-up"
# =============================================================================

GXJ="$(gx "rejoin" total_load)"
DMJ="${T}-dMJ"
def "${AWAY_TOKEN}" "${DMJ}" total_load
link "${AWAY_TOKEN}" "${DMJ}" "${GID}" "${GXJ}"
next_session_at
sess "${AWAY_TOKEN}" "${T}-sj" completed "${DMJ}" "j1:100:5"
drain "rejoin setup"
rpc "${AWAY_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "M leaves"
mark
link "${AWAY_TOKEN}" "${DMJ}" "${GID}" "${GXJ}" deleted
drain "unlink while away"
expect_since "${GXJ}" "" "a change while away applies nothing (the board is frozen)"
expect_entry "${GXJ}" M weight "100@j1" "frozen while away"
board "${ATHLETE_TOKEN}" "${GXJ}" weight false
check "a member who left is listed as former" '.rows[0].former == true and .rows[0].rank == 1'
rpc "${AWAY_TOKEN}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
expect_ok "M rejoins"
drain "rejoin catch-up"
expect_since "${GXJ}" "unlink@M,lead_change:link:weight@M,lead_change:link:e1rm@M" "rejoin applies the unlink made while away"
expect_entry "${GXJ}" M weight "" "rejoin catch-up"
pass "rejoin: changes made while away are applied with normal attribution"

# =============================================================================
echo "[${LANE_LABEL}] serialization and apply failure isolation"
# =============================================================================

docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq \
  <<<"begin; select pg_advisory_xact_lock(${BOARD_LOCK_KEY}, hashtext('${GID}')); select pg_sleep(6); commit;" \
  >/dev/null 2>&1 &
LOCK_PID=$!
for _ in $(seq 1 50); do
  [[ "$(run_psql "select exists (select 1 from pg_locks where locktype = 'advisory' and classid = ${BOARD_LOCK_KEY} and granted);")" == "t" ]] && break
  sleep 0.1
done
if OUT="$(run_psql "set lock_timeout = '500ms';
                    select app_public.group_eval_apply('${GID}', '${ATHLETE_UID}', '${GX1}', array['set']);" 2>&1)"; then
  wait "${LOCK_PID}" || true
  fail "an apply must wait for the group's advisory lock"
fi
wait "${LOCK_PID}" || true
[[ "${OUT}" == *"lock timeout"* ]] || fail "the blocked apply must fail with a lock timeout (55P03): ${OUT}"
pass "every apply in a group takes the group's advisory lock"

run_psql "alter table app_public.group_board_entries add constraint ${FORCE_APPLY_CONSTRAINT} check (false) not valid;" >/dev/null
set_edit "${ATHLETE_TOKEN}" "${T}-s1b" r1b1 0 91 5
rest GET "${ATHLETE_TOKEN}" exercise_sets "select=weight_value&id=eq.${T}-r1b1"
expect_ok "read back under the apply fault"
check "sync_push committed under the apply fault" '.[0].weight_value == "91"'
out="$(mktemp)"
STATUS="$(curl --silent -X POST -H "Content-Type: application/json" -H "x-group-eval-secret: ${EVAL_SECRET}" \
  -o "${out}" -w "%{http_code}" --data '{}' "${API_URL}/functions/v1/group-eval")"
BODY="$(cat "${out}")"; rm -f "${out}"
expect_ok "drain under the apply fault"
check "the failing apply fails its job" '.failed == 1'
expect_sql "the job is kept with its sqlstate" \
  "select last_sqlstate || ':' || attempts from app_public.group_eval_queue
    where member_user_id = '${ATHLETE_UID}' and session_id = '${T}-s1b';" "23514:1"
run_psql "alter table app_public.group_board_entries drop constraint ${FORCE_APPLY_CONSTRAINT};
          update app_public.group_eval_queue set available_at = now() where member_user_id = '${ATHLETE_UID}';" >/dev/null
drain "retry after the apply fault"
expect_entry "${GX1}" A weight "105@r1c1" "entries intact after the retried job"
pass "a failing apply fails its job (kept, retried) and never blocks sync_push"

# =============================================================================
echo "[${LANE_LABEL}] board reads"
# =============================================================================

rpc "${ATHLETE_TOKEN}" group_board_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_metric: "weight", p_certified: false}')"
expect_ok "podiums All · Weight"
check_args "podium rows, me, and the BoardRow shape" --arg x "${GX1}" --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}" \
  '([.exercises[] | select(.exercise.group_exercise_id == $x)][0]) as $e
   | [$e.podium[].member.user_id] == [$r, $a] and $e.me.rank == 2 and $e.me.member.user_id == $a
   and $e.entry_count == 2
   and ($e.podium[0] | keys) == ["achieved_at_ms","certified","e1rm_kg","entered_weight_kg","exercise_name","former",
                                 "load_factor","member","rank","reps","session_id","set_id","value_kg","weight_kg"]
   and $e.podium[0].value_kg == 110 and $e.podium[0].reps == 3 and $e.podium[0].exercise_name == "Lift"
   and $e.podium[0].certified == false'
check "podium exercise order: active first, archived last" \
  '[.exercises[].exercise.archived_at_ms == null] | . == (sort | reverse)'

board "${ATHLETE_TOKEN}" "${GX1}" weight false null 1
expect_ok "board page 1"
check_args "board page 1" --arg r "${RIVAL_UID}" '(.rows | length) == 1 and .rows[0].member.user_id == $r and .has_more == true'
CURSOR="$(jq -c '.next_cursor' <<<"${BODY}")"
board "${ATHLETE_TOKEN}" "${GX1}" weight false "${CURSOR}" 1
expect_ok "board page 2"
check_args "board page 2 continues with absolute ranks" --arg a "${ATHLETE_UID}" \
  '(.rows | length) == 1 and .rows[0].member.user_id == $a and .rows[0].rank == 2
   and .has_more == false and .next_cursor == null'

HIST_KEYS=()
CURSOR=null
while :; do
  history "${ATHLETE_TOKEN}" "${GX2}" weight false "${CURSOR}" 1
  expect_ok "history page"
  check "history item shape" \
    '(.items | length) == 1 and (.items[0] | keys) == ["key","leader","occurred_at_ms","previous","reason","related","seq"]'
  HIST_KEYS+=("$(jq -r '.items[0].key' <<<"${BODY}")")
  [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
  CURSOR="$(jq -c '.next_cursor' <<<"${BODY}")"
done
expect_sql "history pages walk every lead change, newest first, without duplicates" \
  "select string_agg(id::text, ',' order by seq desc) from app_public.group_events
    where group_exercise_id = '${GX2}' and kind = 'lead_change' and metric = 'weight';" \
  "$(IFS=,; echo "${HIST_KEYS[*]}")"
history "${ATHLETE_TOKEN}" "${GX2}" weight false
expect_ok "history, one page"
check_args "history: reasons, related summaries, holders with members" --arg r "${RIVAL_UID}" \
  '.items[0].reason == "void" and .items[0].related.kind == "record_voided" and .items[0].related.reason == "deleted"
   and .items[0].leader.member.user_id == $r
   and ([.items[] | select(.reason == "record")][0].related.kind == "record")'

AGENT_TOKEN="$(mint_token "${ATHLETE_TOKEN}" "agent-client-${RUN_TAG}")"
for call in \
  "group_board_podiums|$(jq -nc --arg g "${GID}" '{p_group_id: $g}')" \
  "group_board|$(jq -nc --arg g "${GID}" --arg x "${GX1}" '{p_group_id: $g, p_group_exercise_id: $x}')" \
  "group_board_history|$(jq -nc --arg g "${GID}" --arg x "${GX1}" '{p_group_id: $g, p_group_exercise_id: $x}')"; do
  name="${call%%|*}"; args="${call#*|}"
  rpc "${ANON_KEY}" "${name}" "${args}"; expect_error AUTH_REQUIRED "${name} anonymous"
  rpc "${AGENT_TOKEN}" "${name}" "${args}"; expect_error AGENT_FORBIDDEN "${name} agent token"
  rpc "${OUTSIDER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "${name} non-member"
  check "${name} non-member body" '.message == "NOT_FOUND: group not found"'
  rpc "${OUTSIDER_TOKEN}" "${name}" "$(jq -c '. + {p_metric: "x"}' <<<"${args}")"
  expect_error NOT_FOUND "${name} non-member with bad input (membership is checked first)"
  rpc "${ATHLETE_TOKEN}" "${name}" "$(jq -c '. + {p_metric: "x"}' <<<"${args}")"
  expect_error VALIDATION "${name} bad metric"
  rpc "${ATHLETE_TOKEN}" "${name}" "$(jq -c '. + {p_certified: null}' <<<"${args}")"
  expect_error VALIDATION "${name} null certified"
done
rpc "${OUTSIDER_TOKEN}" group_exercise_create \
  "$(jq -nc --arg g "${HID}" '{p_group_id: $g, p_name: "Foreign", p_load_input_mode: "total_load", p_source_exercise_id: null}')"
expect_ok "foreign group exercise"
HX="$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"
board "${ATHLETE_TOKEN}" "${HX}" weight false
expect_error NOT_FOUND "board of another group's exercise"
check "foreign exercise body" '.message == "NOT_FOUND: group exercise not found"'
history "${ATHLETE_TOKEN}" "${HX}" weight false
expect_error NOT_FOUND "history of another group's exercise"
for bad in 0 101; do
  board "${ATHLETE_TOKEN}" "${GX1}" weight false null "${bad}"; expect_error VALIDATION "board p_limit ${bad}"
done
for bad in 0 51; do
  history "${ATHLETE_TOKEN}" "${GX1}" weight false null "${bad}"; expect_error VALIDATION "history p_limit ${bad}"
done
for bad in '"x"' '{}' "{\"value_kg\":\"1\",\"achieved_at_ms\":1,\"member_user_id\":\"${ATHLETE_UID}\"}" \
           "{\"value_kg\":1,\"achieved_at_ms\":1.5,\"member_user_id\":\"${ATHLETE_UID}\"}" \
           '{"value_kg":1,"achieved_at_ms":1,"member_user_id":"nope"}' \
           "{\"value_kg\":1,\"achieved_at_ms\":1,\"member_user_id\":\"${ATHLETE_UID}\",\"x\":1}"; do
  board "${ATHLETE_TOKEN}" "${GX1}" weight false "${bad}"; expect_error VALIDATION "board cursor ${bad}"
done
for bad in '"x"' '{}' '{"seq":-1}' '{"seq":1.5}' '{"seq":"1"}' '{"seq":1,"x":1}'; do
  history "${ATHLETE_TOKEN}" "${GX1}" weight false "${bad}"; expect_error VALIDATION "history cursor ${bad}"
done
pass "reads: podiums, board and history paging, AUTH_REQUIRED / AGENT_FORBIDDEN / NOT_FOUND / VALIDATION"

# =============================================================================
echo "[${LANE_LABEL}] group_stream: record, record_voided, link items"
# =============================================================================

# all_items: every item of the athlete's G stream as one array in BODY. The
# stream runs to several pages, so the checks below look at every page.
all_items() {
  local cursor=null acc='[]'
  while :; do
    rpc "${ATHLETE_TOKEN}" group_stream \
      "$(jq -nc --arg g "${GID}" --argjson b "${cursor}" '{p_group_id: $g, p_before: $b, p_limit: 50}')"
    expect_ok "stream page"
    acc="$(jq -c --argjson a "${acc}" '$a + .items' <<<"${BODY}")"
    [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
  done
  BODY="${acc}"
}
all_items
BODY="$(jq -c '{items: .}' <<<"${BODY}")"
check "only the five wire kinds; lead_change is never a stream item" \
  '[.items[].kind] | unique | all(. as $k | ["link","membership","record","record_voided","session"] | index($k))'
check "the T05 kinds are present" \
  '([.items[].kind] | unique) as $k | ($k | index("record")) and ($k | index("record_voided")) and ($k | index("link"))'
check "record item shape; it sorts at its session start" \
  '[.items[] | select(.kind == "record")][0]
   | (keys == ["achieved_at_ms","boards","certified","e1rm_kg","entered_weight_kg","group","group_exercise","key","kind",
               "load_factor","member","provisional","reps","session_id","set_id","sort_at_ms","voided","weight_kg"])
     and .sort_at_ms == .achieved_at_ms and .certified == false and (.group_exercise | keys) == ["group_exercise_id","load_input_mode","name"]'
check "record_voided item shape" \
  '[.items[] | select(.kind == "record_voided")][0]
   | keys == ["group","group_exercise","key","kind","leaders","member","reason","record","record_key","sort_at_ms"]'
check "link item shape" \
  '[.items[] | select(.kind == "link")][0]
   | keys == ["effects","event","exercises","group","group_exercise","key","kind","member","sort_at_ms"]'
all_items
check_args "a link item names the member's exercise, read live" --arg x "${GX5}" --arg d "${DA5}" \
  '[.[] | select(.kind == "link" and .event == "link" and .group_exercise.group_exercise_id == $x)][0].exercises
   == [{exercise_definition_id: $d, name: ("Lift " + $d)}]'
check "no lead_change item across every page" 'all(.[]; .kind != "lead_change")'

# walk <limit>: every key of the athlete's G stream, paging by next_cursor.
walk() {
  local cursor=null keys=""
  while :; do
    rpc "${ATHLETE_TOKEN}" group_stream \
      "$(jq -nc --arg g "${GID}" --argjson b "${cursor}" --argjson l "$1" '{p_group_id: $g, p_before: $b, p_limit: $l}')"
    expect_ok "stream walk ($1)"
    keys+="$(jq -r '[.items[] | .kind + ":" + .key] | join("\n")' <<<"${BODY}")"$'\n'
    [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
  done
  printf '%s' "${keys}" | sed '/^$/d'
}
WALK7="$(walk 7)"
WALK13="$(walk 13)"
[[ "${WALK7}" == "${WALK13}" ]] || fail "stream paging must not depend on the page size"
[[ "$(sort <<<"${WALK7}" | uniq -d)" == "" ]] || fail "stream paging must not repeat an item"
grep -q '^record:' <<<"${WALK7}" || fail "the walk must reach record items"
pass "group_stream: new kinds, shapes, cursor paging across all kinds"

# =============================================================================
echo "[${LANE_LABEL}] R8 — a member leaves; a removed member loses access"
# =============================================================================

rpc "${RIVAL_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "R leaves"
mark
set_edit "${RIVAL_TOKEN}" "${T}-s1r" r1r1 0 200 3
drain "R8 after leaving"
expect_sql "R8 leaving writes no board event" \
  "select count(*) from app_public.group_events where group_id = '${GID}' and seq > ${MARK};" "0"
expect_entry "${GX1}" R weight "110@r1r1" "R8 a former member's entries stay"
board "${ATHLETE_TOKEN}" "${GX1}" weight false
check_args "R8 a former member stays ranked, marked former" --arg r "${RIVAL_UID}" \
  '.rows[0].member.user_id == $r and .rows[0].former == true and .rows[1].former == false'
rpc "${RIVAL_TOKEN}" group_board_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_error NOT_FOUND "a former member cannot read the boards"

rpc "${OWNER_TOKEN}" group_remove_member "$(jq -nc --arg g "${GID}" --arg u "${AWAY_UID}" '{p_group_id: $g, p_user_id: $u}')"
expect_ok "owner removes M"
board "${AWAY_TOKEN}" "${GX1}" weight false
expect_error NOT_FOUND "a removed member cannot read a board"
history "${AWAY_TOKEN}" "${GX1}" weight false
expect_error NOT_FOUND "a removed member cannot read history"
pass "R8: leaving freezes entries (former, still ranked); removed and former members get NOT_FOUND"

echo "[${LANE_LABEL}] passed (run ${RUN_TAG})"
