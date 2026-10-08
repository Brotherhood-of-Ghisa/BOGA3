#!/usr/bin/env bash

# groups-boards.sh — boards and events contract (the second body of the
# groups-leaderboards lane; groups-leaderboards.sh proves the pipeline).
#
# Contract: docs/specs/tech/group-competition-contract.md (boards, events,
# readers) and docs/specs/tech/groups-contract.md (the change table).
# Proves, against the real local stack (sync_push, group-eval, PostgREST), on
# protocol-4 comparisons that rank Volume (kg × reps × D6 factor) and 1RM:
#
#   - posture of the board tables (old and comparison) and of the
#     group_competition_* reads;
#   - every row of the change table (R1–R10), one section each, through the
#     comparison job (group_metric_eval_publish → group_metric_apply_member);
#     a load-mode change rescores silently and a rules change publishes a new
#     revision with one rules_change event;
#   - working sets only ([[set.eligibility]]): a warm-up never ranks, records or certifies, and a
#     stored warm-up record stands while its board moves silently (forward only);
#   - the provisional rule for active sessions (T8), D6 conversion, value-based
#     voids, P7 ties, rejoin catch-up, the per-group advisory lock of a
#     publication;
#   - group_competition_podiums / _board / _history shapes, paging and
#     validation; group_competition_stream's record / record_voided / link /
#     unlink events and cursor paging. Anonymous, OAuth and outsider denials
#     and the wire shapes of every reader: groups-competitions.sh.
#
# Direct-drain mode as groups-leaderboards.sh: the kick
# URL is unset and the sweep paused for the run; the lane POSTs group-eval
# itself. Hermetic: per-run users, deleted on exit with everything they own.

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
psql_session_start

RUN_TAG="${GROUPS_BOARDS_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsBoards!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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

# Comparison jobs (group_metric_eval_queue) and every comparison table cascade
# from the run's groups.
cleanup() {
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event like 'group.%'
         and (user_id in (${ids})
              -- Comparison-job rows carry no user; they name the group.
              or context ->> 'group_id' in (select id::text from app_public.groups where created_by in (${ids})));
      delete from app_public.group_eval_queue where member_user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

# Bash 3.2 hands the EXIT trap status 0 after an unbound-variable abort, so a
# run that never reached its last line fails here instead of passing.
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  psql_session_stop
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
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
  check "${context}" "$1" ${args[@]+"${args[@]}"}
}

expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}

drain() {
  eval_drain
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}

# e1rm <weight> <reps> [factor]: the 1RM ([[1rm.formula]]) × the D6 factor,
# printed like `num` below (6 dp, trimmed).
e1rm() {
  # awk, not node: the same doubles, without a process start per assertion.
  awk -v w="$1" -v r="$2" -v f="${3:-1}" 'BEGIN {
    v = sprintf("%.6f", (r == 1 ? w : 100 * w / (48.8 + 53.8 * exp(-0.075 * r))) * f)
    sub(/0+$/, "", v); sub(/\.$/, "", v); printf "%s", v
  }'
}
# num <sql-numeric>: a stored full-precision value as the oracles print it.
num() { echo "trim_scale(round(($1)::numeric, 6))::text"; }

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

# rev <gx>: the comparison's current rules revision.
rev() { run_psql "select rules_revision from app_public.group_exercises where id = '$1';"; }

# entry <gx> <member-label> <metric>: `value@set` on the current revision's All
# board, or empty.
entry() {
  local uid
  case "$2" in A) uid="${ATHLETE_UID}" ;; R) uid="${RIVAL_UID}" ;; M) uid="${AWAY_UID}" ;; esac
  run_psql "select $(num e.value) || '@' || replace(e.set_id, '${T}-', '')
              from app_public.group_metric_board_entries e
              join app_public.group_exercises ge on ge.id = e.group_exercise_id and ge.rules_revision = e.rules_revision
             where e.group_exercise_id = '$1' and e.member_user_id = '${uid}' and e.metric = '$3' and not e.certified;"
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
#   set-spec = <set-suffix>:<weight>:<reps>[:<status>[:<deleted>[:<set_type>]]] on
#   one exercise `<session>-se`; the session starts at SESSION_AT.
sess() {
  local token="$1" sid="$2" status="$3" def="$4"
  shift 4
  next_cuam
  local done=null dur=null
  if [[ "${status}" == "completed" ]]; then done=$(( SESSION_AT + 3600000 )); dur=3600; fi
  local -a rows=("$(e_session "${sid}" "${SESSION_AT}" "${status}" "${done}" "${dur}" null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r st del ty
  for spec in "$@"; do
    IFS=: read -r id w r st del ty <<<"${spec}"
    rows+=("$(e_set "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "${st:-}" "${CUAM}" "${del:-null}" "${ty:-working}")")
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

# --- reads -----------------------------------------------------------------------

# gx <name> <mode> [group] [token]: a new ordinary comparison (contribution 0,
# default Volume); echoes its id.
gx() {
  rpc "${4:-${OWNER_TOKEN}}" group_competition_exercise_create \
    "$(jq -nc --arg g "${3:-${GID}}" --arg n "$1" --arg m "$2" \
        '{p_group_id: $g, p_name: $n, p_load_input_mode: $m, p_source_exercise_id: null,
          p_bodyweight_contribution: 0, p_default_metric: "volume"}')"
  expect_ok "group_competition_exercise_create $1"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
# gx_archive <gx> <true|false>: archive or unarchive one of G's comparisons.
gx_archive() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_archive \
    "$(jq -nc --arg g "${GID}" --arg e "$1" --argjson a "$2" '{p_group_id: $g, p_exercise_id: $e, p_archived: $a}')"
}

# board <token> <gx> <metric> <certified> [limit] [cursor]: group_competition_board into BODY.
board() {
  rpc "$1" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "$2" --arg m "$3" --argjson c "$4" \
      --argjson l "${5:-50}" --arg cur "${6:-}" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c, p_limit: $l,
        p_cursor: (if $cur == "" then null else $cur end)}')"
}
# history <token> <gx> <metric> <certified> [limit] [before]: group_competition_history
# of the current revision into BODY.
history() {
  rpc "$1" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "$2" --arg m "$3" --argjson c "$4" \
      --argjson l "${5:-50}" --arg b "${6:-}" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c, p_revision: null,
        p_before: (if $b == "" then null else $b end), p_limit: $l}')"
}

# stream_items <token>: every item of that member's G stream (all pages) as
# one JSON array in BODY.
stream_items() {
  local cursor=null acc='[]'
  while :; do
    rpc "$1" group_competition_stream \
      "$(jq -nc --arg g "${GID}" --argjson b "${cursor}" '{p_group_id: $g, p_before: $b, p_limit: 50}')"
    expect_ok "stream page"
    acc="$(jq -c --argjson a "${acc}" '$a + .items' <<<"${BODY}")"
    [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
  done
  BODY="${acc}"
}

# certify <token> <gx> <lifter-uid> <set-suffix> <metric> <write-token>:
# group_competition_certify at the comparison's current revision into BODY.
certify() {
  rpc "$1" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "$2" --arg m "$3" --arg s "${T}-$4" \
      --arg metric "$5" --arg t "$6" --argjson r "$(rev "$2")" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_member_user_id: $m, p_set_id: $s, p_metric: $metric,
        p_expected_revision: $r, p_write_token: $t}')"
}
# score_token <gx> <lifter-uid> <set-suffix> <metric>: a set's write token from
# its stored score (a warm-up has a score but no board row to read it from).
score_token() {
  run_psql "select write_token from app_public.group_metric_set_scores
             where group_exercise_id = '$1' and rules_revision = $(rev "$1") and member_user_id = '$2'
               and set_id = '${T}-$3' and metric = '$4';"
}

# b64 <text> / cursor_with <cursor> <jq-update>: an opaque reader cursor, or a
# valid one decoded, changed and re-encoded.
b64() { jq -nr --arg s "$1" '$s | @base64'; }
cursor_with() { jq -nr --arg s "$1" "\$s | @base64d | fromjson | $2 | tojson | @base64"; }

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

for table in group_board_entries group_board_state group_metric_board_entries group_metric_board_state; do
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

READS="'group_competition_board', 'group_competition_history', 'group_competition_podiums', 'group_competition_stream'"
BOARD_FNS="p.proname like 'group\\_board%' or p.proname in ('group_eval_apply', ${READS})"
expect_sql "every board function pins search_path" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false);" "0"
expect_sql "signed-in clients execute the four reads; anonymous callers none" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname in (${READS})
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute');" \
  "group_competition_board,group_competition_history,group_competition_podiums,group_competition_stream"
expect_sql "clients execute no board internal" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and p.proname not in (${READS})
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));" "0"
expect_sql "service_role executes no board internal" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${BOARD_FNS})
      and p.proname not in (${READS})
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "the four reads are security definer" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.prosecdef and p.proname in (${READS});" "4"
expect_sql "the rejoin catch-up trigger" \
  "select count(*) from pg_trigger where tgrelid = 'app_public.group_memberships'::regclass
      and tgname = 'group_memberships_board_catch_up' and not tgisinternal;" "1"
pass "tables, grants, direct-access denial"

# boards_of <gx>: the latest record's boards as `metric:previous:group_record`.
boards_of() {
  run_psql "select string_agg((b ->> 'metric') || ':' || coalesce($(num "b ->> 'previous_value'"), 'null') || ':'
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
expect_since "${GX1}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "R1 first counting set (D1)"
[[ "$(boards_of "${GX1}")" == "e1rm:null:true,volume:null:true" ]] || fail "R1 first record boards: $(boards_of "${GX1}")"
expect_entry "${GX1}" A volume "500@r1a1" "R1"
expect_entry "${GX1}" A e1rm "$(e1rm 100 5)@r1a1" "R1"
expect_sql "R1 the first lead change points at its record and has no previous leader" \
  "select (related_event_id = (select id from app_public.group_events where group_exercise_id = '${GX1}' and kind = 'record'))
          || ':' || jsonb_typeof(payload -> 'previous') || ':' || (payload -> 'leader' ->> 'member_user_id')
     from app_public.group_events where group_exercise_id = '${GX1}' and kind = 'lead_change' and metric = 'volume';" \
  "true:null:${ATHLETE_UID}"

# 110 × 5 beats A on both boards (Volume 550 > 500, 1RM 128.3 > 116.7).
mark
next_session_at
sess "${RIVAL_TOKEN}" "${T}-s1r" completed "${DR1}" "r1r1:110:5"
drain "R1 rival"
expect_since "${GX1}" "record@R,lead_change:record:volume@R,lead_change:record:e1rm@R" "R1 rival takes #1"
[[ "$(boards_of "${GX1}")" == "e1rm:null:true,volume:null:true" ]] || fail "R1 rival boards: $(boards_of "${GX1}")"
[[ "$(latest "${GX1}" lead_change "payload -> 'previous' ->> 'member_user_id'")" == "${ATHLETE_UID}" ]] ||
  fail "R1 the lead change names the previous leader"

mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1b" completed "${DA1}" "r1b1:90:5"
drain "R1 no beat"
expect_since "${GX1}" "" "R1 a set that doesn't beat my best writes nothing"
expect_entry "${GX1}" A volume "500@r1a1" "R1 no beat"

# 90 × 6 beats A's Volume (540 > 500) but not R's (550), and no 1RM (108.3).
mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1c" completed "${DA1}" "r1c1:90:6"
drain "R1 personal record only"
expect_since "${GX1}" "record@A" "R1 a PR that is not #1: record, no lead change"
[[ "$(boards_of "${GX1}")" == "volume:500:false" ]] || fail "R1 PR boards: $(boards_of "${GX1}")"
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
expect_entry "${GX2}" A volume "500@r2a1" "R2 setup"

mark
set_edit "${ATHLETE_TOKEN}" "${T}-s2a" r2a1 0 80 5
drain "R2 edited down"
expect_since "${GX2}" "record_voided:edited@A,lead_change:void:volume@A,lead_change:void:e1rm@A" "R2 edited down"
expect_entry "${GX2}" A volume "400@r2a1" "R2 edited down falls back"
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
expect_since "${GX2}" "record_voided:edited@A,lead_change:void:volume@A,lead_change:void:e1rm@A" "R2 unperformed"

next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s2c" completed "${DA2}" "r2c1:130:5"
drain "R2 record a third time"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s2c" r2c1 0 130 5 "" "$(now_ms)"
drain "R2 deleted"
expect_since "${GX2}" "record_voided:deleted@A,lead_change:void:volume@A,lead_change:void:e1rm@A" "R2 deleted"
expect_entry "${GX2}" A volume "400@r2a1" "R2 deleted falls back"
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
expect_entry "${GX3}" A volume "550@r3a1" "R3"
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
expect_since "${GX4}" "record_voided:deleted@A,lead_change:void:volume@A,lead_change:void:e1rm@A" "R4 session deleted"
expect_entry "${GX4}" A volume "" "R4 the board empties"
expect_sql "R4 an emptied board's lead change has no leader" \
  "select jsonb_typeof(payload -> 'leader') from app_public.group_events
    where group_exercise_id = '${GX4}' and kind = 'lead_change' order by seq desc limit 1;" "null"

# The voided card stays in the stream while its session is tombstoned (D15).
stream_items "${RIVAL_TOKEN}"
check_args "R4 the voided record card stays in the stream" --arg k "${R4_RECORD}" \
  '[.[] | select(.kind == "competition" and .key == $k)][0].event | .kind == "record" and .voided == true'
check_args "R4 its void says the set was deleted" --arg k "${R4_RECORD}" \
  'any(.[]; .kind == "competition" and .event.kind == "record_voided" and .event.related_event_id == $k
             and .event.reason == "deleted")'

mark
session_row "${ATHLETE_TOKEN}" "${T}-s4" "${S4_AT}" completed
drain "R4 session undeleted"
expect_since "${GX4}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "R4 undelete: fresh record"
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
expect_since "${GX5}" "link@A,lead_change:link:volume@A,lead_change:link:e1rm@A" "R5 link"
expect_sql "R5 a retroactive link writes no record (P16)" \
  "select count(*) from app_public.group_events where group_exercise_id = '${GX5}' and kind = 'record'
      and member_user_id = '${ATHLETE_UID}';" "0"
expect_sql "R5 the link item's effects and exercises" \
  "select (payload -> 'exercise_definition_ids') = '[\"${DA5}\"]'::jsonb
          and (payload -> 'effects' -> 1 ->> 'metric') = 'volume'
          and jsonb_typeof(payload -> 'effects' -> 1 -> 'before') = 'null'
          and (payload -> 'effects' -> 1 -> 'after')
              = '{\"rank\": 1, \"value\": 600, \"metric\": \"volume\", \"unit\": \"kg_reps\", \"rules_revision\": 1}'::jsonb
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
expect_since "${GX5}" "unlink@A,lead_change:link:volume@A,lead_change:link:e1rm@A" "R5 unlink"
expect_entry "${GX5}" A volume "250@r5b1" "R5 unlink falls back to the still-linked exercise"
expect_sql "R5 unlink never voids a record" \
  "select count(*) from app_public.group_events where group_exercise_id = '${GX5}' and kind = 'record_voided';" "0"

# Retarget within the group: the same deterministic link id moves GX5 → GX5B.
mark
link "${ATHLETE_TOKEN}" "${DA5B}" "${GID}" "${GX5B}"
drain "R5 retarget"
expect_since "${GX5}" "unlink@A" "R5 retarget leaves the old board (R stays #1)"
expect_since "${GX5B}" "link@A,lead_change:link:volume@A,lead_change:link:e1rm@A" "R5 retarget joins the new board"
expect_entry "${GX5}" A volume "" "R5 retarget: no entry left on the old board"
pass "R5: link, unlink, retarget → link/unlink items, lead_change{link}, no records"

# =============================================================================
echo "[${LANE_LABEL}] R6 — no certification: Certified boards stay empty (certification: groups-certification.sh)"
# =============================================================================

expect_sql "R6 no Certified entry exists" \
  "select count(*) from app_public.group_metric_board_entries where group_id = '${GID}' and certified;" "0"
rpc "${ATHLETE_TOKEN}" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "podiums (default: Certified)"
check_args "R6 Certified podiums are empty, each on its comparison's default metric" --arg x "${GX1}" \
  '.certified == true and any(.podiums[]; .exercise.group_exercise_id == $x)
   and all(.podiums[]; .board.certified == true and .board.metric == .exercise.rules.default_metric
                       and .board.entries == [] and .board.me == null and .board.entry_count == 0)'
pass "R6: uncertified sets make no Certified entries; Certified podiums empty"

# =============================================================================
echo "[${LANE_LABEL}] R7 — load_input_mode changed (D6 converts Volume and 1RM; a rescore, not a lift)"
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
expect_entry "${GX7}" A volume "250@r7a1" "D6 total → per side: Volume ÷2"
expect_entry "${GX7}" A e1rm "$(e1rm 100 5 0.5)@r7a1" "D6 e1RM ÷2"
expect_entry "${GX7B}" A volume "640@r7b1" "D6 per side → total: Volume ×2"
expect_entry "${GX7B}" A e1rm "$(e1rm 40 8 2)@r7b1" "D6 e1RM ×2"

# A source load-mode change is a rules rescore: the entries move, no void or
# record is written, and the record keeps the rescored values as its baseline.
rescore_baseline() {
  run_psql "select (select string_agg(k, ',' order by k) from jsonb_object_keys(rule_rescore_baseline) k)
                   || ':' || $(num "rule_rescore_baseline -> 'volume' ->> 'value'")
              from app_public.group_events where group_exercise_id = '${GX7}' and kind = 'record' and set_id = '${T}-r7a1';"
}
mark
def "${ATHLETE_TOKEN}" "${DA7}" per_side_load
drain "R7 mode up"
expect_since "${GX7}" "" "R7 rescale up writes no event"
expect_entry "${GX7}" A volume "500@r7a1" "R7 rescale up"
expect_entry "${GX7}" A e1rm "$(e1rm 100 5)@r7a1" "R7 rescale up"
[[ "$(rescore_baseline)" == "e1rm,volume:500" ]] || fail "R7 rescale up: the record's rescore baseline: $(rescore_baseline)"
mark
def "${ATHLETE_TOKEN}" "${DA7}" total_load
drain "R7 mode down"
expect_since "${GX7}" "" "R7 rescale down writes no event"
expect_entry "${GX7}" A volume "250@r7a1" "R7 rescale down"
expect_entry "${GX7}" A e1rm "$(e1rm 100 5 0.5)@r7a1" "R7 rescale down"
[[ "$(rescore_baseline)" == "e1rm,volume:250" ]] || fail "R7 rescale down: the record's rescore baseline: $(rescore_baseline)"
expect_sql "R7 the record stands" \
  "select count(*) from app_public.group_events where group_exercise_id = '${GX7}' and kind = 'record_voided';" "0"
pass "R7: a load-mode change rescales Volume and 1RM silently; D6 in both directions"

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
gx_archive "${GX9}" true
expect_ok "archive GX9"
mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s9b" completed "${DA9}" "r9b1:150:5"
drain "R9 while archived"
expect_since "${GX9}" "" "R9 no event while archived"
expect_entry "${GX9}" A volume "500@r9a1" "R9 entries frozen"
board "${ATHLETE_TOKEN}" "${GX9}" volume false
expect_ok "an archived board is readable"
check "R9 the archived board still serves its rows" '.state == "archived" and .entries[0].value == 500'
gx_archive "${GX9}" false
expect_ok "unarchive GX9"
drain "R9 unarchive catch-up"
expect_since "${GX9}" "record@A" "R9 sets logged while archived count after unarchive"
expect_entry "${GX9}" A volume "750@r9b1" "R9 catch-up"
pass "R9: archived boards frozen and readable; unarchive applies what was missed"

# =============================================================================
echo "[${LANE_LABEL}] R10 — a rules change recomputes silently on a new revision"
# =============================================================================

# Corrupt A's stored Volume, then change GX1's rules (a contribution, inert
# while the group's bodyweight calculations are off): the new revision is
# computed from the sets, and its first publication writes only rules_change.
run_psql "update app_public.group_metric_board_entries set value = 1
           where group_exercise_id = '${GX1}' and member_user_id = '${ATHLETE_UID}' and metric = 'volume';" >/dev/null
mark
rpc "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${GID}" --arg x "${GX1}" --argjson r "$(rev "${GX1}")" \
  '{p_group_id: $g, p_exercise_id: $x, p_expected_revision: $r, p_name: "R1 bench", p_load_input_mode: "total_load",
    p_bodyweight_contribution: 0.5, p_default_metric: "volume"}')"
expect_ok "R10 rules change"
drain "R10 rules"
expect_sql "R10 the new revision is published" \
  "select rules_revision || ':' || published_rules_revision from app_public.group_exercises where id = '${GX1}';" "2:2"
expect_entry "${GX1}" A volume "540@r1c1" "R10 the recompute corrects entries"
expect_entry "${GX1}" R volume "550@r1r1" "R10 the recompute corrects entries"
expect_sql "R10 the recompute writes no event in the group but its rules change" \
  "select string_agg(kind, ',' order by seq) from app_public.group_events where group_id = '${GID}' and seq > ${MARK};" \
  "rules_change"
pass "R10: a rules change recomputes entries silently on a new revision"

# =============================================================================
echo "[${LANE_LABEL}] working sets only — a warm-up never counts, forward only"
# =============================================================================

GXW="$(gx "W bench" total_load)"
DAW="${T}-dAW"; DRW="${T}-dRW"
def "${ATHLETE_TOKEN}" "${DAW}" total_load
link "${ATHLETE_TOKEN}" "${DAW}" "${GID}" "${GXW}"
def "${RIVAL_TOKEN}" "${DRW}" total_load
link "${RIVAL_TOKEN}" "${DRW}" "${GID}" "${GXW}"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-sw-r1" completed "${DRW}" "wr1:110:5"
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sw-a1" completed "${DAW}" "wa1:100:5" "wa2:130:5:::warm_up"
drain "W baseline"
expect_entry "${GXW}" A volume "500@wa1" "W the warm-up does not count"
expect_entry "${GXW}" A e1rm "$(e1rm 100 5)@wa1" "W the warm-up does not count"
expect_sql "W the warm-up made no record" \
  "select count(*) from app_public.group_events where set_id = '${T}-wa2';" "0"

# stored_warm_up <member-uid> <set-suffix>: a result stored before the rule —
# the member's apply with the warm-up's scores counted, as the old board
# filter did. Then the scores are as they really are.
stored_warm_up() {
  run_psql "update app_public.group_metric_set_scores set counting = true
             where group_exercise_id = '${GXW}' and member_user_id = '$1' and set_id = '${T}-$2';
            select app_public.group_metric_apply_member('${GID}', '$1', '${GXW}', $(rev "${GXW}"),
                     app_public.group_metric_eval_source_graph('${GID}', '${GXW}'), false);
            update app_public.group_metric_set_scores set counting = false
             where group_exercise_id = '${GXW}' and member_user_id = '$1' and set_id = '${T}-$2';" >/dev/null
}
stored_warm_up "${ATHLETE_UID}" wa2
expect_entry "${GXW}" A volume "650@wa2" "W the stored warm-up best"
WA2_RECORD="$(run_psql "select id from app_public.group_events where kind = 'record' and set_id = '${T}-wa2';")"
[[ -n "${WA2_RECORD}" ]] || fail "W the stored warm-up record exists"

mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sw-a2" completed "${DAW}" "wa3:105:5"
drain "W re-evaluation"
expect_since "${GXW}" "" "W the warm-up best falls silently: no lead change, void or record"
expect_entry "${GXW}" A volume "525@wa3" "W the entry falls to the best working set"
expect_entry "${GXW}" A e1rm "$(e1rm 105 5)@wa3" "W the entry falls to the best working set"
board "${OWNER_TOKEN}" "${GXW}" volume false
expect_ok "W board"
check_args "W the rival leads again" --arg r "${RIVAL_UID}" '.entries[0].member.user_id == $r and .entries[0].value == 550'
expect_sql "W the stored warm-up record stands (forward only)" \
  "select count(*) from app_public.group_events where kind = 'record_voided' and related_event_id = '${WA2_RECORD}';" "0"

certify "${RIVAL_TOKEN}" "${GXW}" "${ATHLETE_UID}" wa2 e1rm "$(score_token "${GXW}" "${ATHLETE_UID}" wa2 e1rm)"
expect_error NOT_FOUND "W a stored warm-up record cannot be certified"
check "W ... as not a record set" '.message == "NOT_FOUND: record set not found for this metric"'

mark
next_session_at
sess "${RIVAL_TOKEN}" "${T}-sw-r2" completed "${DRW}" "wr2:200:3:::warm_up" "wr3:112:5"
drain "W heavy warm-up"
expect_since "${GXW}" "record@R" "W only the working set is a record"
[[ "$(boards_of "${GXW}")" == "e1rm:$(e1rm 110 5):true,volume:550:true" ]] || fail "W record boards: $(boards_of "${GXW}")"
expect_entry "${GXW}" R volume "560@wr3" "W a warm-up heavier than every working set never ranks"
expect_entry "${GXW}" R e1rm "$(e1rm 112 5)@wr3" "W a warm-up heavier than every working set never ranks"
certify "${ATHLETE_TOKEN}" "${GXW}" "${RIVAL_UID}" wr2 e1rm "$(score_token "${GXW}" "${RIVAL_UID}" wr2 e1rm)"
expect_error NOT_FOUND "W a heavy warm-up cannot be certified"
board "${ATHLETE_TOKEN}" "${GXW}" e1rm false
expect_ok "W 1RM board"
WR3_TOKEN="$(jq -er --arg r "${RIVAL_UID}" --arg s "${T}-wr3" \
  '.entries[] | select(.member.user_id == $r and .performance.set_id == $s) | .write_token' <<<"${BODY}")"
certify "${ATHLETE_TOKEN}" "${GXW}" "${RIVAL_UID}" wr3 e1rm "${WR3_TOKEN}"
expect_ok "W the working record set can be certified"

# A stored warm-up record whose set is edited is voided as any record is, and
# its board move keeps its void attribution.
DMW="${T}-dMW"
def "${AWAY_TOKEN}" "${DMW}" total_load
link "${AWAY_TOKEN}" "${DMW}" "${GID}" "${GXW}"
next_session_at
sess "${AWAY_TOKEN}" "${T}-sw-m1" completed "${DMW}" "wm0:90:5" "wm1:150:5:::warm_up"
drain "W member warm-up"
stored_warm_up "${AWAY_UID}" wm1
expect_entry "${GXW}" M volume "750@wm1" "W the member's stored warm-up best leads"
mark
next_cuam
push "${AWAY_TOKEN}" "edit wm1" "$(e_set "${T}-wm1" "${T}-sw-m1-se" 1 80 3 "" "${CUAM}" null warm_up)"
drain "W warm-up record edited"
expect_since "${GXW}" "record_voided:edited@M,lead_change:void:volume@M,lead_change:void:e1rm@M" \
  "W an edited warm-up record is voided with its lead changes"
pass "working sets only: never ranks, records or certifies; a stored warm-up record stands, its board moves silently"

# =============================================================================
echo "[${LANE_LABEL}] zero kg — a 0 kg result never ranks, records or fails the apply"
# =============================================================================

# A member whose only counting sets on a linked exercise are 0 kg (typed 0,
# or blank weight with reps) has no Volume and no 1RM: the scorer emits no
# value at 0 kg, so the comparison writes no entry and no event.
GXZ="$(gx "Z zero" per_side_load)"
DAZ="${T}-dAZ"
def "${ATHLETE_TOKEN}" "${DAZ}" total_load
link "${ATHLETE_TOKEN}" "${DAZ}" "${GID}" "${GXZ}"
mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sz" completed "${DAZ}" "z1:0:5" "z2::8"
drain "Z only 0 kg sets"
expect_entry "${GXZ}" A volume "" "Z a 0 kg set has no Volume"
expect_entry "${GXZ}" A e1rm "" "Z a 0 kg set has no 1RM"
expect_since "${GXZ}" "" "Z a 0 kg set makes no record or lead change"
mark
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-sz2" completed "${DAZ}" "z3:20:5"
drain "Z a loaded set"
expect_since "${GXZ}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "Z the first loaded set is the first record"
expect_entry "${GXZ}" A volume "50@z3" "Z the loaded set ranks"
pass "zero kg: no entry, no record, no failed apply"

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
expect_since "${GXP}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "T8 record cards appear mid-session (D2)"
PREC="$(latest "${GXP}" record "id")"

# record_volume: the provisional record's Volume board as `value:previous`,
# then its Volume lead change's leader value (empty when it has none).
record_volume() {
  run_psql "select $(num "b ->> 'value'") || ':' || $(num "b ->> 'previous_value'") || ':'
                   || coalesce((select $(num "payload -> 'leader' ->> 'value'") from app_public.group_events
                                 where related_event_id = '${PREC}' and kind = 'lead_change' and metric = 'volume'), '')
              from jsonb_array_elements((select payload -> 'boards' from app_public.group_events where id = '${PREC}')) b
             where b ->> 'metric' = 'volume';"
}
mark
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 1000 5
drain "T8 typo up"
expect_since "${GXP}" "" "T8 an edit up while active writes no event"
[[ "$(record_volume)" == "5000:400:5000" ]] ||
  fail "T8 the same record is updated in place with its lead change, keeping its previous best: $(record_volume)"

set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 95 5
drain "T8 fixed to a value that still beats the previous best"
expect_since "${GXP}" "" "T8 a fix that still beats the previous best writes no event"
[[ "$(record_volume)" == "475:400:475" ]] ||
  fail "T8 the card stays at the corrected value, against the same previous best, and still leads: $(record_volume)"

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
expect_entry "${GXP}" A volume "400@p0" "T8 fallback"
[[ "$(latest "${GXP}" lead_change "payload -> 'leader' ->> 'member_user_id'")" == "${RIVAL_UID}" ]] ||
  fail "T8 history again ends with the rival's lead"

mark
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 100 5
drain "T8 record again"
expect_since "${GXP}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "T8 a fresh provisional record"
mark
session_row "${ATHLETE_TOKEN}" "${T}-spa" "${SPA_AT}" completed
drain "T8 complete"
expect_since "${GXP}" "" "T8 completing the session writes nothing"
set_edit "${ATHLETE_TOKEN}" "${T}-spa" pa1 0 70 5
drain "T8 edit after completion"
expect_since "${GXP}" "record_voided:edited@A,lead_change:void:volume@A,lead_change:void:e1rm@A" "T8 once complete, an edit voids"
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
expect_since "${GXQ}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" "a provisional typo record"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-sqa" q2 1 150 5
drain "a real set below the typo"
expect_since "${GXQ}" "" "a set below the typo is not a record yet"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-sqa" q1 0 200 5 "" "$(now_ms)"
drain "the typo deleted"
expect_since "${GXQ}" "record@A,lead_change:record:volume@A,lead_change:record:e1rm@A" \
  "deleting the typo makes the real set a record against the pre-session best"
[[ "$(boards_of "${GXQ}")" == "e1rm:$(e1rm 120 5):true,volume:600:true" ]] ||
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
expect_entry "${GXQ}" A volume "600@q0" "fallback after the tombstoned session"
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
# 100 × 5 → 50 × 10 keeps Volume (500) and lowers the 1RM.
mark
set_edit "${ATHLETE_TOKEN}" "${T}-ss" s1 0 50 10
drain "an edit that keeps Volume"
expect_since "${GXS}" "record_voided:edited@A,record@A" "the edit voids the card and re-records the board it still holds"
[[ "$(boards_of "${GXS}")" == "volume:null:true" ]] ||
  fail "the replacement lists the unchanged Volume board: $(boards_of "${GXS}")"
expect_entry "${GXS}" A e1rm "$(e1rm 50 10)@s1" "the e1RM entry follows the edit"
pass "voids follow values: a whitespace edit voids nothing; an edit keeping Volume keeps the Volume card"

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
expect_entry "${GXT}" A volume "500@ty1" "P7 within a member: exercise order, then set order"
board "${ATHLETE_TOKEN}" "${GXT}" volume false
expect_ok "tie board"
check_args "P7 equal values rank the earlier session first" \
  --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}" \
  '[.entries[] | [.rank, .member.user_id]] == [[1, $r], [2, $a]]'
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
expect_entry "${GXJ}" M volume "500@j1" "frozen while away"
board "${ATHLETE_TOKEN}" "${GXJ}" volume false
check "a member who left is listed as former" '.entries[0].former == true and .entries[0].rank == 1'
rpc "${AWAY_TOKEN}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
expect_ok "M rejoins"
# A new membership period hides the old period's entry until its catch-up
# publishes, so #1 has already moved when the catch-up runs: it writes the
# unlink item and no lead change.
board "${ATHLETE_TOKEN}" "${GXJ}" volume false
check "a rejoin hides the old period's entry until the catch-up" '.entries == [] and .entry_count == 0'
drain "rejoin catch-up"
expect_since "${GXJ}" "unlink@M" "rejoin applies the unlink made while away"
expect_entry "${GXJ}" M volume "" "rejoin catch-up"
pass "rejoin: changes made while away are applied with normal attribution"

# =============================================================================
echo "[${LANE_LABEL}] serialization"
# =============================================================================

# A comparison publication takes the group's advisory lock before it reads its
# claimed job. The holder sleeps far longer than the check needs and is ended
# explicitly once the blocked publication has timed out, so the lane never
# waits out the sleep. The claimed job is rolled back with the publication.
run_psql_once "begin; select pg_advisory_xact_lock(${BOARD_LOCK_KEY}, hashtext('${GID}')); select pg_sleep(30); commit;" \
  >/dev/null 2>&1 &
LOCK_PID=$!
release_lock_holder() {
  run_psql "select count(*) filter (where pg_terminate_backend(pid)) from pg_locks
             where locktype = 'advisory' and classid = ${BOARD_LOCK_KEY} and granted;"
}
for _ in $(seq 1 50); do
  [[ "$(run_psql "select exists (select 1 from pg_locks where locktype = 'advisory' and classid = ${BOARD_LOCK_KEY} and granted);")" == "t" ]] && break
  sleep 0.1
done
if OUT="$(run_psql_once "set lock_timeout = '500ms';
                         begin;
                         select app_public.group_metric_eval_enqueue('${GID}', '${GX1}', 'set');
                         update app_public.group_metric_eval_queue
                            set claim_id = gen_random_uuid(), claimed_until = now() + interval '1 minute'
                          where group_exercise_id = '${GX1}';
                         select app_public.group_metric_eval_publish(id, generation, claim_id, '{}'::jsonb)
                           from app_public.group_metric_eval_queue where group_exercise_id = '${GX1}';
                         rollback;" 2>&1)"; then
  release_lock_holder >/dev/null
  wait "${LOCK_PID}" || true
  fail "a publication must wait for the group's advisory lock"
fi
[[ "$(release_lock_holder)" == "1" ]] || fail "the advisory lock holder must still hold the lock when the publication times out"
wait "${LOCK_PID}" || true
[[ "${OUT}" == *"lock timeout"* ]] || fail "the blocked publication must fail with a lock timeout (55P03): ${OUT}"
expect_sql "the blocked publication left no comparison job" \
  "select count(*) from app_public.group_metric_eval_queue where group_exercise_id = '${GX1}';" "0"
pass "every publication in a group takes the group's advisory lock"

# =============================================================================
echo "[${LANE_LABEL}] board reads"
# =============================================================================

# An archived comparison has no podium.
GXA="$(gx "archived" total_load)"
gx_archive "${GXA}" true
expect_ok "archive GXA"
rpc "${ATHLETE_TOKEN}" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_certified: false}')"
expect_ok "podiums All"
check_args "podium rows, me, and entry count on the default metric" --arg x "${GX1}" --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}" \
  '([.podiums[] | select(.exercise.group_exercise_id == $x)][0].board) as $b
   | $b.metric == "volume" and $b.certified == false
   and [$b.entries[].member.user_id] == [$r, $a] and $b.me.rank == 2 and $b.me.member.user_id == $a
   and $b.entry_count == 2
   and $b.entries[0].value == 550 and $b.entries[0].unit == "kg_reps" and $b.entries[0].performance.reps == 5
   and $b.entries[0].certification == null'
check_args "podiums: active comparisons only, by name" --arg z "${GXA}" \
  '([.podiums[].exercise.group_exercise_id] | index($z)) == null
   and all(.podiums[]; .exercise.archived_at_ms == null)
   and [.podiums[].exercise.name] == ([.podiums[].exercise.name] | sort)'

board "${ATHLETE_TOKEN}" "${GX1}" volume false 1
expect_ok "board page 1"
check_args "board page 1" --arg r "${RIVAL_UID}" \
  '(.entries | length) == 1 and .entries[0].member.user_id == $r and .entry_count == 2 and (.next_cursor | type) == "string"'
BOARD_CURSOR="$(jq -er '.next_cursor' <<<"${BODY}")"
board "${ATHLETE_TOKEN}" "${GX1}" volume false 1 "${BOARD_CURSOR}"
expect_ok "board page 2"
check_args "board page 2 continues with absolute ranks" --arg a "${ATHLETE_UID}" \
  '(.entries | length) == 1 and .entries[0].member.user_id == $a and .entries[0].rank == 2 and .next_cursor == null'

HIST_KEYS=()
HIST_CURSOR=""
while :; do
  history "${ATHLETE_TOKEN}" "${GX2}" volume false 1 "${HIST_CURSOR}"
  expect_ok "history page"
  check "history page of one" '(.events | length) == 1'
  HIST_KEYS+=("$(jq -r '.events[0].event_id' <<<"${BODY}")")
  [[ "$(jq -r '.next_cursor' <<<"${BODY}")" != "null" ]] || break
  HIST_CURSOR="$(jq -er '.next_cursor' <<<"${BODY}")"
done
expect_sql "history pages walk the revision's lead changes and rules changes, newest first, without duplicates" \
  "select string_agg(id::text, ',' order by seq desc) from app_public.group_events
    where group_exercise_id = '${GX2}' and contract_version = 2 and rules_revision = $(rev "${GX2}")
      and ((kind = 'lead_change' and metric = 'volume' and not certified) or kind = 'rules_change');" \
  "$(IFS=,; echo "${HIST_KEYS[*]}")"
GX2_VOID="$(run_psql "select id from app_public.group_events where group_exercise_id = '${GX2}' and kind = 'record_voided'
                       and reason = 'deleted';")"
GX2_RECORD="$(run_psql "select lc.related_event_id from app_public.group_events lc
                          join app_public.group_events r on r.id = lc.related_event_id and r.kind = 'record'
                         where lc.group_exercise_id = '${GX2}' and lc.kind = 'lead_change' and lc.metric = 'volume'
                           and not lc.certified and lc.reason = 'record'
                         order by lc.seq desc limit 1;")"
[[ -n "${GX2_VOID}" && -n "${GX2_RECORD}" ]] || fail "history fixture: GX2's deleted void and a record-reason lead change"
history "${ATHLETE_TOKEN}" "${GX2}" volume false
expect_ok "history, one page"
check_args "history: reasons, related events, holders with members" \
  --arg r "${RIVAL_UID}" --arg v "${GX2_VOID}" --arg rec "${GX2_RECORD}" \
  '.events[0].kind == "lead_change" and .events[0].reason == "void" and .events[0].related_event_id == $v
   and ([.events[0].values[] | select(.role == "leader")][0].member.user_id == $r)
   and ([.events[] | select(.reason == "record")][0].related_event_id == $rec)'

for call in \
  "group_competition_podiums|$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_certified: false}')" \
  "group_competition_board|$(jq -nc --arg g "${GID}" --arg x "${GX1}" '{p_group_id: $g, p_group_exercise_id: $x, p_metric: "volume", p_certified: false}')" \
  "group_competition_history|$(jq -nc --arg g "${GID}" --arg x "${GX1}" '{p_group_id: $g, p_group_exercise_id: $x, p_metric: "volume", p_certified: false}')"; do
  name="${call%%|*}"; args="${call#*|}"
  if [[ "${name}" != group_competition_podiums ]]; then
    rpc "${ATHLETE_TOKEN}" "${name}" "$(jq -c '. + {p_metric: "x"}' <<<"${args}")"
    expect_error VALIDATION "${name} bad metric"
  fi
  rpc "${ATHLETE_TOKEN}" "${name}" "$(jq -c '. + {p_certified: null}' <<<"${args}")"
  expect_error VALIDATION "${name} null certified"
done
HX="$(gx "Foreign" total_load "${HID}" "${OUTSIDER_TOKEN}")"
board "${ATHLETE_TOKEN}" "${HX}" volume false
expect_error NOT_FOUND "board of another group's exercise"
check "foreign exercise body" '.message == "NOT_FOUND: group exercise not found"'
history "${ATHLETE_TOKEN}" "${HX}" volume false
expect_error NOT_FOUND "history of another group's exercise"
for bad in 0 101; do
  board "${ATHLETE_TOKEN}" "${GX1}" volume false "${bad}"; expect_error VALIDATION "board p_limit ${bad}"
  history "${ATHLETE_TOKEN}" "${GX1}" volume false "${bad}"; expect_error VALIDATION "history p_limit ${bad}"
done
for bad in x "$(b64 '"x"')" "$(b64 '{}')" \
           "$(cursor_with "${BOARD_CURSOR}" '.after_rank = -1')" "$(cursor_with "${BOARD_CURSOR}" '.after_rank = 1.5')" \
           "$(cursor_with "${BOARD_CURSOR}" '.after_rank = "1"')" "$(cursor_with "${BOARD_CURSOR}" '.rules_revision = 999')" \
           "$(cursor_with "${BOARD_CURSOR}" '.metric = "e1rm"')"; do
  board "${ATHLETE_TOKEN}" "${GX1}" volume false 1 "${bad}"; expect_error VALIDATION "board cursor ${bad}"
done
history "${ATHLETE_TOKEN}" "${GX2}" volume false 1
expect_ok "GX2 history page 1"
HIST_CURSOR="$(jq -er '.next_cursor' <<<"${BODY}")"
for bad in x "$(b64 '{}')" \
           "$(cursor_with "${HIST_CURSOR}" '.seq = -1')" "$(cursor_with "${HIST_CURSOR}" '.seq = 1.5')" \
           "$(cursor_with "${HIST_CURSOR}" '.seq = "1"')" "$(cursor_with "${HIST_CURSOR}" '. + {x: 1}')" \
           "$(cursor_with "${HIST_CURSOR}" '.revision = 2')"; do
  history "${ATHLETE_TOKEN}" "${GX2}" volume false 1 "${bad}"; expect_error VALIDATION "history cursor ${bad}"
done
pass "reads: podiums, board and history paging, NOT_FOUND / VALIDATION"

# =============================================================================
echo "[${LANE_LABEL}] group_competition_stream: record, record_voided, link, unlink events"
# =============================================================================

stream_items "${ATHLETE_TOKEN}"
check "only the three item kinds; lead and rules changes are never stream events" \
  'all(.[]; .kind as $k | ["competition","membership","session"] | index($k))
   and all(.[] | select(.kind == "competition"); .event.kind as $k | ["link","record","record_voided","unlink"] | index($k))'
check "the board event kinds are present" \
  '([.[] | select(.kind == "competition") | .event.kind] | unique) == ["link","record","record_voided","unlink"]'
S1A_AT="$(run_psql "select started_at from app_public.sessions where owner_user_id = '${ATHLETE_UID}' and id = '${T}-s1a';")"
R1_FIRST="$(run_psql "select id from app_public.group_events where group_exercise_id = '${GX1}' and kind = 'record'
                       and set_id = '${T}-r1a1';")"
check_args "a record sorts at its session start" --arg k "${R1_FIRST}" \
  "[.[] | select(.kind == \"competition\" and .key == \$k)][0].sort_at_ms == ${S1A_AT}"

# walk <limit>: every key of the athlete's G stream, paging by next_cursor.
walk() {
  local cursor=null keys=""
  while :; do
    rpc "${ATHLETE_TOKEN}" group_competition_stream \
      "$(jq -nc --arg g "${GID}" --argjson b "${cursor}" --argjson l "$1" '{p_group_id: $g, p_before: $b, p_limit: $l}')"
    expect_ok "stream walk ($1)"
    keys+="$(jq -r '[.items[] | .kind + ":" + (if .kind == "competition" then .event.kind + ":" else "" end) + .key]
                    | join("\n")' <<<"${BODY}")"$'\n'
    [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
  done
  printf '%s' "${keys}" | sed '/^$/d'
}
WALK7="$(walk 7)"
WALK13="$(walk 13)"
[[ "${WALK7}" == "${WALK13}" ]] || fail "stream paging must not depend on the page size"
[[ "$(sort <<<"${WALK7}" | uniq -d)" == "" ]] || fail "stream paging must not repeat an item"
grep -q '^competition:record:' <<<"${WALK7}" || fail "the walk must reach record events"
pass "group_competition_stream: board event kinds, record sort, cursor paging across all kinds"

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
expect_entry "${GX1}" R volume "550@r1r1" "R8 a former member's entries stay"
board "${ATHLETE_TOKEN}" "${GX1}" volume false
check_args "R8 a former member stays ranked, marked former" --arg r "${RIVAL_UID}" \
  '.entries[0].member.user_id == $r and .entries[0].former == true and .entries[1].former == false'
rpc "${RIVAL_TOKEN}" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_error NOT_FOUND "a former member cannot read the boards"

rpc "${OWNER_TOKEN}" group_remove_member "$(jq -nc --arg g "${GID}" --arg u "${AWAY_UID}" '{p_group_id: $g, p_user_id: $u}')"
expect_ok "owner removes M"
board "${AWAY_TOKEN}" "${GX1}" volume false
expect_error NOT_FOUND "a removed member cannot read a board"
history "${AWAY_TOKEN}" "${GX1}" volume false
expect_error NOT_FOUND "a removed member cannot read history"
pass "R8: leaving freezes entries (former, still ranked); removed and former members get NOT_FOUND"

COMPLETED=1
echo "[${LANE_LABEL}] passed (run ${RUN_TAG})"
