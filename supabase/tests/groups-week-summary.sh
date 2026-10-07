#!/usr/bin/env bash

# groups-week-summary.sh — the group week summary read (a body of the
# groups-leaderboards lane: it needs the evaluator's set facts and records).
#
# Contract: docs/specs/tech/groups-contract.md (the facts' `working`, the week summary).
# Proves, against the real local stack (sync_push, group-eval, PostgREST):
#
#   - posture: the RPC is the only client-executable function; preamble,
#     membership and validation errors, in that order;
#   - the evaluator stores the app's working-set rule (every set but a warm-up);
#     an exercise counts once it has a working set (warm-up-only adds none);
#   - the board: working sets (working, performed, live, rows present)
#     and group records (non-voided, one per board taken #1) over completed, live,
#     shared sessions started in [start, end); every current member ranked,
#     ties sharing a rank; provisional, voided, own-best-only and out-of-window
#     records excluded; a record on an unlinked exercise kept;
#   - training now: active sessions whose latest write (any row) is under 2 h
#     old, newest start first; a stale one excluded;
#   - the latest completed session and its group records, from either
#     pipeline (contract-1 `value_kg`, contract-2 `value` + `unit`);
#   - a removed member leaves the board, training now and the latest session,
#     and reads NOT_FOUND.
#
# Direct-drain mode as groups-boards.sh: the kick URL is unset and the sweep
# paused for the run; the lane POSTs group-eval itself. Hermetic: per-run
# users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-week-summary"
FIXTURE_EMAIL_PREFIX="groups-ws"
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

RUN_TAG="${GROUPS_WEEK_SUMMARY_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsWeek!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

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

# check_args <context> [--arg name value | --argjson name value]... <filter>: `check` with its jq args first.
check_args() {
  local context="$1"
  shift
  local -a args=()
  while [[ "${1:-}" == --arg* ]]; do args+=("$1" "$2" "$3"); shift 3; done
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
# Session jobs enqueue comparison (contract-2) jobs; a second drain runs any
# the first one queued after its own claim.
drain2() { drain "$1"; drain "$1 (follow-up)"; }

# e_set2 <id> <session_exercise> <order> <weight> <reps> <set_type|""> <status|""> <cuam> [deleted]
e_set2() {
  jq -nc --arg id "$1" --arg se "$2" --argjson o "$3" --arg w "$4" --arg r "$5" --arg t "$6" --arg ps "$7" \
    --argjson c "$8" --argjson del "${9:-null}" \
    '{type: "exercise_sets", id: $id, client_updated_at_ms: $c,
      fields: {session_exercise_id: $se, order_index: $o, weight_value: $w, reps_value: $r,
               set_type: (if $t == "" then null else $t end),
               planned_weight_value: null, planned_reps_value: null, planned_set_type: null,
               performance_status: (if $ps == "" then null else $ps end),
               created_at: $c, updated_at: $c, deleted_at: $del}}'
}

# sess <token> <session> <active|completed> <started_ms> <definition> <set-spec>... [-- gym]
#   set-spec = <set-suffix>:<weight>:<reps>:<set_type>[:<status>[:<deleted>]] on one
#   exercise `<session>-se`; a completed session ends an hour after it starts.
sess() {
  local token="$1" sid="$2" status="$3" started="$4" def="$5"
  shift 5
  next_cuam
  local done=null dur=null
  if [[ "${status}" == "completed" ]]; then done=$(( started + 3600000 )); dur=3600; fi
  local -a rows=("$(e_session "${sid}" "${started}" "${status}" "${done}" "${dur}" null "${CUAM}" "${SESSION_GYM:-}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r t st del
  for spec in "$@"; do
    IFS=: read -r id w r t st del <<<"${spec}"
    rows+=("$(e_set2 "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "${t}" "${st:-}" "${CUAM}" "${del:-null}")")
    order=$(( order + 1 ))
  done
  push "${token}" "session ${sid}" "${rows[@]}"
}

# def <token> <id>: a total-load definition. link <token> <definition> <gx> [unlink]
def() { next_cuam; push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}")"; }
link() {
  next_cuam
  local del=null
  [[ -z "${4:-}" ]] || del="${CUAM}"
  push "$1" "link $2 → $3" "$(e_link "$2" "${GID}" "$3" "${CUAM}" "${del}")"
}

# summary <token> [start] [end] [group]: group_week_summary into BODY.
summary() {
  rpc "$1" group_week_summary "$(jq -nc --arg g "${4:-${GID}}" --argjson s "${2:-${WS}}" --argjson e "${3:-${WE}}" \
      '{p_group_id: $g, p_window_start_ms: $s, p_window_end_ms: $e}')"
}

# The board as `label=rank/working_sets/group_records`, in returned order.
board_line() {
  jq -r --argjson L "${LABELS}" \
    '[.members[] | "\($L[.member.user_id] // "?")=\(.rank)/\(.working_sets)/\(.group_records)"] | join(",")' <<<"${BODY}"
}
expect_board() {
  local actual
  actual="$(board_line)"
  [[ "${actual}" == "$1" ]] || fail "$2: board expected '$1', got '${actual}'"
}
# Training now as `label:session-suffix:working_sets:exercise_count`, in order.
training_line() {
  jq -r --argjson L "${LABELS}" --arg t "${T}-" \
    '[.training_now[] | "\($L[.member.user_id] // "?"):\(.session_id | ltrimstr($t)):\(.working_sets):\(.exercise_count)"]
     | join(",")' <<<"${BODY}"
}
expect_training() {
  local actual
  actual="$(training_line)"
  [[ "${actual}" == "$1" ]] || fail "$2: training now expected '$1', got '${actual}'"
}
expect_latest() {
  local actual
  actual="$(jq -r --arg t "${T}-" '.latest_completed.session_id // "none" | ltrimstr($t)' <<<"${BODY}")"
  [[ "${actual}" == "$1" ]] || fail "$2: latest completed expected '$1', got '${actual}'"
}

# backdate <member-uid> <session> <rows>: move the last accepted write of the
# session's `session`, `exercises` and/or `sets` rows three hours back. The
# Sync v2 BEFORE UPDATE trigger would re-stamp it, so triggers are off for
# this one transaction.
backdate() {
  local uid="$1" sid="$2" rows="$3" sql=""
  [[ "${rows}" != *session* ]] || sql+="update app_public.sessions set server_received_at = now() - interval '3 hours'
      where owner_user_id = '${uid}' and id = '${sid}';"
  [[ "${rows}" != *exercises* ]] || sql+="update app_public.session_exercises set server_received_at = now() - interval '3 hours'
      where owner_user_id = '${uid}' and session_id = '${sid}';"
  [[ "${rows}" != *sets* ]] || sql+="update app_public.exercise_sets es set server_received_at = now() - interval '3 hours'
      from app_public.session_exercises se
      where se.owner_user_id = '${uid}' and se.session_id = '${sid}'
        and es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id;"
  run_psql "begin; set local session_replication_role = replica; ${sql} commit;" >/dev/null
}

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
provision ATHLETE athlete
provision RIVAL rival
provision MEMBER member
provision LEAVER leaver
provision LATE late
provision OUTSIDER outsider
for pair in "OWNER:owner" "ATHLETE:athlete" "RIVAL:rival" "MEMBER:member" "LEAVER:leaver" "LATE:late" "OUTSIDER:outsider"; do
  uid_var="${pair%%:*}_UID"
  set_username "${!uid_var}" "ws_${pair##*:}_${RUN_TAG//-/_}"
done
LABELS="$(jq -nc --arg o "${OWNER_UID}" --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg m "${MEMBER_UID}" \
  --arg x "${LEAVER_UID}" --arg l "${LATE_UID}" --arg z "${OUTSIDER_UID}" \
  '{($o): "O", ($a): "A", ($r): "R", ($m): "M", ($x): "X", ($l): "L", ($z): "Z"}')"

set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "WS ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create G"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OUTSIDER_TOKEN}" group_create "$(jq -nc --arg n "WS other ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create H"
HID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "group_invite_get"
INVITE_CODE="$(jq -er '.code' <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${MEMBER_TOKEN}" "${LEAVER_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
  expect_ok "join G"
done

# Group exercises: Bench, Row and Edge on the contract-1 pipeline; Squat a
# contract-2 comparison.
gx() {
  rpc "${OWNER_TOKEN}" group_exercise_create \
    "$(jq -nc --arg g "${GID}" --arg n "$1" '{p_group_id: $g, p_name: $n, p_load_input_mode: "total_load", p_source_exercise_id: null}')"
  expect_ok "group_exercise_create $1"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
GX_BENCH="$(gx Bench)"
GX_ROW="$(gx Row)"
GX_EDGE="$(gx Edge)"
rpc "${OWNER_TOKEN}" group_exercise_create_v2 "$(jq -nc --arg g "${GID}" '
  {p_group_id: $g, p_name: "Squat", p_load_input_mode: "total_load", p_source_exercise_id: null,
   p_bodyweight_contribution: 0, p_default_metric: "weight"}')"
expect_ok "group_exercise_create_v2 Squat"
GX_SQUAT="$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"

T="ws-${RUN_TAG}"
CUAM="$(now_ms)"
# Every session but the late member's pre-join one starts after every join.
WS=$(( CUAM + 1000 ))
WE=$(( WS + 7 * 86400000 ))
at() { echo $(( WS + $1 * 60000 )); }

# Definitions and links before any set, so every new best is a record (a set
# created after its link's update is logging, not a link effect).
def "${RIVAL_TOKEN}" "${T}-r-bench"; link "${RIVAL_TOKEN}" "${T}-r-bench" "${GX_BENCH}"
def "${RIVAL_TOKEN}" "${T}-r-squat"; link "${RIVAL_TOKEN}" "${T}-r-squat" "${GX_SQUAT}"
def "${RIVAL_TOKEN}" "${T}-r-free"
def "${ATHLETE_TOKEN}" "${T}-a-bench"; link "${ATHLETE_TOKEN}" "${T}-a-bench" "${GX_BENCH}"
def "${ATHLETE_TOKEN}" "${T}-a-row"; link "${ATHLETE_TOKEN}" "${T}-a-row" "${GX_ROW}"
def "${MEMBER_TOKEN}" "${T}-m-bench"; link "${MEMBER_TOKEN}" "${T}-m-bench" "${GX_BENCH}"
def "${MEMBER_TOKEN}" "${T}-m-edge"; link "${MEMBER_TOKEN}" "${T}-m-edge" "${GX_EDGE}"
def "${LEAVER_TOKEN}" "${T}-x-free"
def "${LATE_TOKEN}" "${T}-l-free"
drain "setup"
pass "users, group G (O owner; A, R, M, X members), outsider group H, Bench/Row/Edge (contract 1), Squat (contract 2)"

# =============================================================================
echo "[${LANE_LABEL}] posture and errors"
# =============================================================================

expect_sql "the RPC is security definer with a pinned search_path" \
  "select p.prosecdef and coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname = 'group_week_summary';" "t"
expect_sql "clients execute only group_week_summary of the group_week_* functions" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname like 'group\\_week\\_%'
      and has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute');" "group_week_summary"
expect_sql "the helpers pin search_path and are not security definer" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname like 'group\\_week\\_%' and p.proname <> 'group_week_summary'
      and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false));" "0"

summary "${ANON_KEY}"
expect_error AUTH_REQUIRED "anon"
OAUTH_TOKEN="$(mint_token "${ATHLETE_TOKEN}" "ws-agent-client")"
summary "${OAUTH_TOKEN}"
expect_error AGENT_FORBIDDEN "OAuth client token"
summary "${OUTSIDER_TOKEN}"
expect_error NOT_FOUND "outsider"
summary "${OUTSIDER_TOKEN}" 0 0
expect_error NOT_FOUND "outsider with a bad window (membership before validation)"
summary "${ATHLETE_TOKEN}" "${WS}" "${WE}" "$(run_psql "select gen_random_uuid();")"
expect_error NOT_FOUND "nonexistent group"
summary "${ATHLETE_TOKEN}" "${WS}" "${WS}"
expect_error VALIDATION "empty window"
summary "${ATHLETE_TOKEN}" "${WE}" "${WS}"
expect_error VALIDATION "reversed window"
summary "${ATHLETE_TOKEN}" "${WS}" "$(( WS + 8 * 86400000 + 1 ))"
expect_error VALIDATION "window over 8 days"
summary "${ATHLETE_TOKEN}" -1 "${WS}"
expect_error VALIDATION "negative start"
summary "${ATHLETE_TOKEN}" null "${WE}"
expect_error VALIDATION "null start"
summary "${ATHLETE_TOKEN}" "${WS}" "$(( WS + 8 * 86400000 ))"
expect_ok "an 8-day window (a DST week fits)"
summary "${ATHLETE_TOKEN}"
expect_ok "an empty week"
check "an empty week: exact top-level keys" 'keys == ["latest_completed", "members", "training_now"]'
check "an empty week: no training, no latest" '.training_now == [] and .latest_completed == null'
# Equal rows order by username: ws_athlete, ws_late, ws_leaver, ws_member, ws_owner, ws_rival.
expect_board "A=1/0/0,X=1/0/0,M=1/0/0,O=1/0/0,R=1/0/0" "an empty week"
pass "posture; AUTH_REQUIRED, AGENT_FORBIDDEN, NOT_FOUND before VALIDATION; every member ranked with nothing"

# =============================================================================
echo "[${LANE_LABEL}] the board"
# =============================================================================

# R1: #1 on Bench (record). Working: every set but the warm-up, a set with
# no effort included.
sess "${RIVAL_TOKEN}" "${T}-r1" completed "$(at 1)" "${T}-r-bench" \
  r1a:100:5:rir_1 r1b:90:5:rir_2 r1c:60:10:warm_up r1d:80:5: r1e:80:5:rir_0
drain "R1"
# A1: an own best behind R (record, not a group record). Working: rir_0,
# rir_3, a6 (hard-deleted below), a legacy `working` value and a huge RIR; not
# a planned set, a tombstoned set or a warm-up.
sess "${ATHLETE_TOKEN}" "${T}-a1" completed "$(at 2)" "${T}-a-bench" \
  a1:90:5:rir_0 a2:90:5:rir_3 a4:90:5:rir_1:planned "a5:90:5:rir_2::$(at 2)" \
  a6:90:5:rir_0 a7:60:10:warm_up a8:90:5:working a9:90:5:rir_3000000000
drain "A1"
# Each label's working/performed fact is the TS rule (groups-set-facts.test.ts);
# the counts below prove the summary reads it.
# One predicate for `working`: a fact the evaluator has not re-normalized yet
# (working null) counts as working in the week counts and on the boards, and
# is never a warm-up. R1's warm-up r1c, read as such a fact, in a rolled-back
# transaction: `sets/exercises|counting on Bench|warm-up`.
expect_sql "a fact with working null counts as working everywhere, and is not a warm-up" \
  "begin;
   select concat_ws('|',
     (select working_sets || '/' || exercise_count from app_public.group_week_session_counts('${RIVAL_UID}', '${T}-r1')),
     (select count(*) from app_public.group_board_counting('${GID}', '${RIVAL_UID}', '${GX_BENCH}')
       where session_id = '${T}-r1'),
     app_public.group_set_is_warm_up('${RIVAL_UID}', '${T}-r1c'));
   update app_public.group_set_facts set working = null where member_user_id = '${RIVAL_UID}' and set_id = '${T}-r1c';
   select concat_ws('|',
     (select working_sets || '/' || exercise_count from app_public.group_week_session_counts('${RIVAL_UID}', '${T}-r1')),
     (select count(*) from app_public.group_board_counting('${GID}', '${RIVAL_UID}', '${GX_BENCH}')
       where session_id = '${T}-r1'),
     app_public.group_set_is_warm_up('${RIVAL_UID}', '${T}-r1c'));
   rollback;" \
  "4/1|4|t
5/1|5|f"
# m1: 105 × 1 takes #1 on Weight only (one group record): heavier than R1's
# 100, but its 1RM stays under R1's 100 × 5.
sess "${MEMBER_TOKEN}" "${T}-m1" completed "$(at 3)" "${T}-m-bench" m1:105:1:rir_0
drain "m1"
# R2: a group record whose set is then deleted: voided.
sess "${RIVAL_TOKEN}" "${T}-r2" completed "$(at 4)" "${T}-r-bench" r2:140:1:rir_0
drain "R2"
next_cuam
push "${RIVAL_TOKEN}" "delete r2" "$(e_set2 "${T}-r2" "${T}-r2-se" 0 140 1 rir_0 "" "${CUAM}" "${CUAM}")"
drain "R2 deleted"
expect_sql "R2's record is voided" \
  "select count(*) from app_public.group_events e
    where e.kind = 'record' and e.set_id = '${T}-r2'
      and exists (select 1 from app_public.group_events v where v.kind = 'record_voided' and v.related_event_id = e.id);" "1"
# A3: a group record on Row, whose exercise is then unlinked (never voids).
sess "${ATHLETE_TOKEN}" "${T}-a3" completed "$(at 5)" "${T}-a-row" a3r:80:5:rir_2
drain "A3"
link "${ATHLETE_TOKEN}" "${T}-a-row" "${GX_ROW}" unlink
drain "A3 unlinked"
# R3: a contract-2 group record on Squat.
sess "${RIVAL_TOKEN}" "${T}-r3" completed "$(at 6)" "${T}-r-squat" r3:150:3:rir_1
drain2 "R3"
# A tombstoned completed session: nothing counts.
SESSION_GYM="" sess "${ATHLETE_TOKEN}" "${T}-adel" completed "$(at 7)" "${T}-a-bench" ad1:50:5:rir_0 ad2:50:5:rir_0
next_cuam
push "${ATHLETE_TOKEN}" "tombstone adel" \
  "$(e_session "${T}-adel" "$(at 7)" completed "$(( $(at 7) + 3600000 ))" 3600 "${CUAM}" "${CUAM}")"
# Window edges: M's Edge records at exactly the start (in) and the end (out).
sess "${MEMBER_TOKEN}" "${T}-edge-in" completed "${WS}" "${T}-m-edge" ei:50:1:rir_0
drain "edge in"
sess "${MEMBER_TOKEN}" "${T}-edge-out" completed "${WE}" "${T}-m-edge" eo:60:1:rir_0
drain "edge out"
# A2: a provisional group record (active session, 120 × 5 leads 1RM and
# Weight: two boards).
sess "${ATHLETE_TOKEN}" "${T}-a2" active "$(at 10)" "${T}-a-bench" a2s:120:5:rir_0
drain "A2"
expect_sql "A2's record is provisional and a group record" \
  "select count(*) from app_public.group_events e, jsonb_array_elements(e.payload -> 'boards') b
    where e.kind = 'record' and e.set_id = '${T}-a2s' and (b ->> 'group_record')::boolean;" "2"
for spec in "r1a:${RIVAL_UID}:1" "a1:${ATHLETE_UID}:0" "m1:${MEMBER_UID}:1" "a3r:${ATHLETE_UID}:1" "r3:${RIVAL_UID}:1" \
            "ei:${MEMBER_UID}:1" "eo:${MEMBER_UID}:1"; do
  IFS=: read -r set uid want <<<"${spec}"
  expect_sql "the record of ${set} is a group record: ${want}" \
    "select count(*) from app_public.group_events e
      where e.kind = 'record' and e.member_user_id = '${uid}' and e.set_id = '${T}-${set}'
        and exists (select 1 from jsonb_array_elements(e.payload -> 'boards') b where (b ->> 'group_record')::boolean);" "${want}"
done

expect_sql "m1 takes #1 on Weight only; R1 on both boards" \
  "select string_agg(replace(e.set_id, '${T}-', '') || '=' || b.metric, ',' order by e.set_id, b.metric)
     from app_public.group_events e,
          lateral (select x ->> 'metric' as metric from jsonb_array_elements(e.payload -> 'boards') x
                    where (x ->> 'group_record')::boolean) b
    where e.kind = 'record' and e.set_id in ('${T}-m1', '${T}-r1a');" "m1=weight,r1a=e1rm,r1a=weight"

expect_sql "both record pipelines are covered (Edge contract 1, Squat contract 2)" \
  "select string_agg(distinct replace(set_id, '${T}-', '') || '=' || contract_version, ',')
     from app_public.group_events where kind = 'record' and set_id in ('${T}-ei', '${T}-r3');" "ei=1,r3=2"

summary "${OWNER_TOKEN}"
expect_ok "the board"
# Group records count one per board taken (#1 on Weight and on 1RM is two).
# R 5 W/S (r1a, r1b, r1d, r1e, r3), 4 records (R1 and R3 each #1 on both
# boards; R2 voided). A 6 W/S (a1, a2, a6, a8, a9, a3r), 2 records (A3 on both,
# unlinked; A1 an own best only, A2 provisional). M 2 W/S (m1, ei), 3 records
# (m1 on Weight only, edge in on both; edge out is outside). O, X nothing; L
# has not joined yet.
expect_board "A=1/6/2,R=2/5/4,M=3/2/3,X=4/0/0,O=4/0/0" "the board"
check "a board row's exact keys" '.members[0] | keys == ["group_records", "member", "rank", "working_sets"]'
check "a board member's exact keys" '.members[0].member | keys == ["user_id", "username"]'

# A hard-deleted set (no DELETE trigger, so its fact remains) stops counting at once.
run_psql "delete from app_public.exercise_sets where owner_user_id = '${ATHLETE_UID}' and id = '${T}-a6';" >/dev/null
summary "${ATHLETE_TOKEN}"
expect_ok "after a hard delete"
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,X=4/0/0,O=4/0/0" "a hard-deleted set; A and R tie on W/S, records break it"
# A tombstone counts at once, before any drain: the Row record set leaves A's
# working sets and group records; restoring it brings both back.
next_cuam
push "${ATHLETE_TOKEN}" "tombstone a3r" "$(e_set2 "${T}-a3r" "${T}-a3-se" 0 80 5 rir_2 "" "${CUAM}" "${CUAM}")"
summary "${ATHLETE_TOKEN}"
expect_ok "after a tombstone, undrained"
expect_board "R=1/5/4,A=2/4/0,M=3/2/3,X=4/0/0,O=4/0/0" "a tombstoned set and its record stop counting before the evaluator runs"
next_cuam
push "${ATHLETE_TOKEN}" "restore a3r" "$(e_set2 "${T}-a3r" "${T}-a3-se" 0 80 5 rir_2 "" "${CUAM}")"
summary "${ATHLETE_TOKEN}"
expect_ok "after the restore"
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,X=4/0/0,O=4/0/0" "a restored set counts again"
drain "a3r tombstone and restore"
summary "${ATHLETE_TOKEN}" "$(( WS + 1 ))" "${WE}"
expect_ok "a window starting after the edge session"
expect_board "R=1/5/4,A=2/5/2,M=3/1/1,X=4/0/0,O=4/0/0" "the start is inclusive"
summary "${ATHLETE_TOKEN}" "${WS}" "$(( WE + 1 ))"
expect_ok "a window ending after the edge-out session"
expect_board "R=1/5/4,A=2/5/2,M=3/3/5,X=4/0/0,O=4/0/0" "the end is exclusive"
pass "working sets by the app rule, performed, live and present; group records non-voided, one per #1 board, completed; ranks, ties, edges"

# The late member: a session that started before their join is never shared.
# The join must land inside the window, which opened 1 s after setup began.
for _ in $(seq 1 30); do (( $(now_ms) > WS + 1 )) && break; sleep 0.1; done
(( $(now_ms) > WS + 1 )) || fail "the server clock did not pass the window start ${WS}"
rpc "${LATE_TOKEN}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
expect_ok "late join"
LATE_JOINED="$(run_psql "select floor(extract(epoch from joined_at) * 1000)::bigint from app_public.group_memberships
                          where group_id = '${GID}' and user_id = '${LATE_UID}' and ended_at is null;")"
LATE_BEFORE=$(( LATE_JOINED - 1 ))
(( LATE_BEFORE >= WS )) || fail "the late member's pre-join start ${LATE_BEFORE} must be inside the window"
sess "${LATE_TOKEN}" "${T}-l0" completed "${LATE_BEFORE}" "${T}-l-free" l0a:50:5:rir_0 l0b:50:5:rir_0
drain "late pre-join"
expect_sql "the pre-join session is not shared" \
  "select count(*) from app_public.group_session_shares where member_user_id = '${LATE_UID}';" "0"
summary "${OWNER_TOKEN}"
expect_ok "after the late member's pre-join session"
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,L=4/0/0,X=4/0/0,O=4/0/0" "an unshared session counts nothing"
pass "only sessions shared to the group count"

# =============================================================================
echo "[${LANE_LABEL}] training now"
# =============================================================================

# R4: active at a gym, two working sets on an unlinked exercise, and a second
# exercise with only a warm-up, which adds no exercise. Its session and
# exercise rows are backdated, but its sets are fresh: still training.
next_cuam
push "${RIVAL_TOKEN}" "gym" "$(e_gym "${T}-gym" "Iron Temple" "${CUAM}")"
SESSION_GYM="${T}-gym" sess "${RIVAL_TOKEN}" "${T}-r4" active "$(at 11)" "${T}-r-free" r4a:70:5:rir_1 r4b:70:5:rir_1 r4c:40:8:warm_up
next_cuam
push "${RIVAL_TOKEN}" "R4 warm-up-only exercise" \
  "$(e_se "${T}-r4-se2" "${T}-r4" "${T}-r-free" 1 "Lift" "${CUAM}")" \
  "$(e_set2 "${T}-r4w" "${T}-r4-se2" 0 40 8 warm_up "" "${CUAM}")"
# M stale: active, every row last written three hours ago.
sess "${MEMBER_TOKEN}" "${T}-mst" active "$(at 12)" "${T}-m-bench" ms1:20:5:rir_0
# X: active and fresh (until removed below).
sess "${LEAVER_TOKEN}" "${T}-x1" active "$(at 13)" "${T}-x-free" x1:60:5:rir_2
drain "training"
backdate "${RIVAL_UID}" "${T}-r4" "session exercises"
backdate "${MEMBER_UID}" "${T}-mst" "session exercises sets"

summary "${ATHLETE_TOKEN}"
expect_ok "training now"
expect_training "X:x1:1:1,R:r4:2:1,A:a2:1:1" "training now: fresh active sessions, newest start first"
check "a training row's exact keys" \
  '.training_now[0] | keys == ["exercise_count", "gym_name", "member", "session_id", "started_at_ms", "working_sets"]'
check_args "R4's gym" --arg s "${T}-r4" '.training_now[] | select(.session_id == $s) | .gym_name == "Iron Temple"'
check_args "A2 has no gym" --arg s "${T}-a2" '.training_now[] | select(.session_id == $s) | .gym_name == null'
check_args "started_at_ms is the live start" --arg s "${T}-r4" --argjson t "$(at 11)" \
  '.training_now[] | select(.session_id == $s) | .started_at_ms == $t'
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,L=4/0/0,X=4/0/0,O=4/0/0" "active sessions add nothing to the board"

# A fresh set write brings the stale session back.
next_cuam
push "${MEMBER_TOKEN}" "stale set edit" "$(e_set2 "${T}-ms1" "${T}-mst-se" 0 25 5 rir_0 "" "${CUAM}")"
summary "${ATHLETE_TOKEN}"
expect_ok "training now after a fresh write"
expect_training "X:x1:1:1,M:mst:1:1,R:r4:2:1,A:a2:1:1" "a fresh write makes a stale session train now"
pass "training now: latest write of any row under 2 h; stale excluded; counts and gym"

# =============================================================================
echo "[${LANE_LABEL}] the latest completed session"
# =============================================================================

# Before R5: the latest completion is edge-out (contract-1 records).
summary "${ATHLETE_TOKEN}"
expect_ok "latest (contract 1)"
expect_latest "edge-out" "the latest completion, outside the window"
check "latest's exact keys" '.latest_completed | keys ==
  ["completed_at_ms", "duration_sec", "exercise_count", "group_records", "gym_name", "member",
   "session_id", "started_at_ms", "working_sets"]'
check_args "latest's figures" --arg m "${MEMBER_UID}" --argjson s "${WE}" '.latest_completed |
  .member.user_id == $m and .started_at_ms == $s and .completed_at_ms == ($s + 3600000) and .duration_sec == 3600
  and .working_sets == 1 and .exercise_count == 1 and .gym_name == null'
check_args "latest's contract-1 group record, normalized" --arg g "${GX_EDGE}" --arg set "${T}-eo" '
  .latest_completed.group_records as $r | ($r | length) == 1 and ($r[0] | keys == ["boards", "group_exercise", "key", "set_id"])
  and $r[0].group_exercise == {group_exercise_id: $g, name: "Edge"} and $r[0].set_id == $set
  and ($r[0].key | type) == "string"
  and ($r[0].boards | map(.metric)) == ["e1rm", "weight"]
  and ($r[0].boards[] | select(.metric == "weight")) == {metric: "weight", value: 60, unit: "kg"}'

# R5: a later contract-2 group record on Squat.
sess "${RIVAL_TOKEN}" "${T}-r5" completed "$(( WE + 60000 ))" "${T}-r-squat" r5:160:3:rir_1 r5b:100:5:rir_2
drain2 "R5"
summary "${ATHLETE_TOKEN}"
expect_ok "latest (contract 2)"
expect_latest "r5" "the latest completion"
check_args "latest's contract-2 group record, normalized" --arg g "${GX_SQUAT}" '
  .latest_completed | .working_sets == 2 and (.group_records | length) == 1
  and .group_records[0].group_exercise == {group_exercise_id: $g, name: "Squat"}
  and (.group_records[0].boards | map(.metric)) == ["e1rm", "weight"]
  and (.group_records[0].boards[] | select(.metric == "weight")) == {metric: "weight", value: 160, unit: "kg"}'

# X: a later completion still, without records.
sess "${LEAVER_TOKEN}" "${T}-x2" completed "$(( WE + 120000 ))" "${T}-x-free" x2:60:5:rir_2
drain "X2"
summary "${ATHLETE_TOKEN}"
expect_ok "latest (X)"
expect_latest "x2" "the latest completion"
check "a session without group records" '.latest_completed.group_records == []'
pass "latest completed: any time, latest completed_at, both record pipelines normalized"

# =============================================================================
echo "[${LANE_LABEL}] a removed member"
# =============================================================================

# X's in-window completed session, to show it leaves the board too.
sess "${LEAVER_TOKEN}" "${T}-x3" completed "$(at 14)" "${T}-x-free" x3a:60:5:rir_2 x3b:60:5:rir_2
drain "X3"
summary "${OWNER_TOKEN}"
expect_ok "before removal"
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,X=4/2/0,L=5/0/0,O=5/0/0" "X on the board"
rpc "${OWNER_TOKEN}" group_remove_member "$(jq -nc --arg g "${GID}" --arg u "${LEAVER_UID}" '{p_group_id: $g, p_user_id: $u}')"
expect_ok "remove X"
summary "${OWNER_TOKEN}"
expect_ok "after removal"
expect_board "R=1/5/4,A=2/5/2,M=3/2/3,L=4/0/0,O=4/0/0" "a removed member leaves the board"
expect_training "M:mst:1:1,R:r4:2:1,A:a2:1:1" "a removed member stops training now"
expect_latest "r5" "a removed member's session is not the latest"
summary "${LEAVER_TOKEN}"
expect_error NOT_FOUND "the removed member"
summary "${OUTSIDER_TOKEN}" "${WS}" "${WE}" "${HID}"
expect_ok "another group's own member"
expect_board "Z=1/0/0" "group H has nothing of G's"
pass "a removed member leaves every part and reads NOT_FOUND"

COMPLETED=1
pass "group week summary (run ${RUN_TAG})"
