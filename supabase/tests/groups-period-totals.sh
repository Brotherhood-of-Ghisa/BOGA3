#!/usr/bin/env bash

# groups-period-totals.sh — the Groups screen's At a glance read,
# group_competition_period_totals (a body of the groups-leaderboards lane: it
# needs the evaluator's set facts and records).
#
# Contract: docs/specs/tech/groups-contract.md ("Week summary and period totals"). Proves,
# against the real local stack (sync_push, group-eval, PostgREST):
#
#   - posture: executable by signed-in users only; NOT_FOUND before
#     VALIDATION; every malformed window list rejected (the anon, OAuth and
#     outsider denials of every group_competition_* RPC: groups-competitions.sh);
#   - each window answers on its own, in request order, echoing its bounds:
#     working sets and group records (one per board taken #1) over completed,
#     live, shared sessions started in [start, end); overlapping windows each
#     count a session; active and tombstoned sessions count nothing;
#   - every current member is listed in every window, zeros included, ordered
#     by username; no rank, no volume, no session context;
#   - a removed member leaves every window and reads NOT_FOUND.
#
# The working-set and record rules themselves are the week summary's
# (groups-week-summary.sh): the same helpers count both. Direct-drain mode: the
# kick URL is unset and the sweep paused for the run; the lane POSTs group-eval
# itself. Hermetic: per-run users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-period-totals"
FIXTURE_EMAIL_PREFIX="groups-pt"
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
PASSWORD="GroupsPeriod!${RUN_TAG}"
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
# Session jobs enqueue comparison jobs; a second drain runs any the first one
# queued after its own claim.
drain2() { drain "$1"; drain "$1 (follow-up)"; }

# sess <token> <session> <active|completed> <started_ms> <definition> <set-spec>...
#   set-spec = <set-suffix>:<weight>:<reps>:<set_type> on one exercise
#   `<session>-se`; a completed session ends an hour after it starts.
sess() {
  local token="$1" sid="$2" status="$3" started="$4" def="$5"
  shift 5
  next_cuam
  local done=null dur=null
  if [[ "${status}" == "completed" ]]; then done=$(( started + 3600000 )); dur=3600; fi
  local -a rows=("$(e_session "${sid}" "${started}" "${status}" "${done}" "${dur}" null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r t
  for spec in "$@"; do
    IFS=: read -r id w r t <<<"${spec}"
    rows+=("$(e_set "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "" "${CUAM}" null "${t}")")
    order=$(( order + 1 ))
  done
  push "${token}" "session ${sid}" "${rows[@]}"
}

def() { next_cuam; push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}")"; }
link() { next_cuam; push "$1" "link $2 → $3" "$(e_link "$2" "${GID}" "$3" "${CUAM}")"; }

# totals <token> <windows-json> [group]: group_competition_period_totals into BODY.
totals() {
  rpc "$1" group_competition_period_totals "$(jq -nc --arg g "${3:-${GID}}" --argjson w "$2" '{p_group_id: $g, p_windows: $w}')"
}
# win <start> <end>: one window object.
win() { jq -nc --argjson s "$1" --argjson e "$2" '{start_ms: $s, end_ms: $e}'; }
windows() { printf '%s\n' "$@" | jq -sc '.'; }

# Every period as `label=working_sets/group_records` in returned order, periods
# joined by `|`.
periods_line() {
  jq -r --argjson L "${LABELS}" \
    '[.periods[] | [.members[] | "\($L[.member.user_id] // "?")=\(.working_sets)/\(.group_records)"] | join(",")] | join("|")' <<<"${BODY}"
}
expect_periods() {
  local actual
  actual="$(periods_line)"
  [[ "${actual}" == "$1" ]] || fail "$2: periods expected '$1', got '${actual}'"
}

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
provision ATHLETE athlete
provision RIVAL rival
provision MEMBER member
provision LEAVER leaver
for pair in "OWNER:owner" "ATHLETE:athlete" "RIVAL:rival" "MEMBER:member" "LEAVER:leaver"; do
  uid_var="${pair%%:*}_UID"
  set_username "${!uid_var}" "pt_${pair##*:}_${RUN_TAG//-/_}"
done
LABELS="$(jq -nc --arg o "${OWNER_UID}" --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg m "${MEMBER_UID}" \
  --arg x "${LEAVER_UID}" '{($o): "O", ($a): "A", ($r): "R", ($m): "M", ($x): "X"}')"

set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "PT ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create G"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "group_invite_get"
INVITE_CODE="$(jq -er '.code' <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${MEMBER_TOKEN}" "${LEAVER_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
  expect_ok "join G"
done

rpc "${OWNER_TOKEN}" group_competition_exercise_create \
  "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_name: "Bench", p_load_input_mode: "total_load", p_source_exercise_id: null}')"
expect_ok "group_competition_exercise_create Bench"
GX_BENCH="$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"

T="pt-${RUN_TAG}"
CUAM="$(now_ms)"
# Every session starts after every join. Two weeks, and a 30-day window over both.
DAY=86400000
S=$(( CUAM + 1000 ))
W1="$(win "${S}" $(( S + 7 * DAY )))"
W2="$(win $(( S + 7 * DAY )) $(( S + 14 * DAY )))"
W3="$(win "${S}" $(( S + 30 * DAY )))"
at() { echo $(( S + $1 * 60000 )); }

# Links before any set, so every new best is a record.
for pair in "ATHLETE:a" "RIVAL:r" "MEMBER:m"; do
  token_var="${pair%%:*}_TOKEN"
  def "${!token_var}" "${T}-${pair##*:}-bench"; link "${!token_var}" "${T}-${pair##*:}-bench" "${GX_BENCH}"
done
def "${LEAVER_TOKEN}" "${T}-x-free"
drain "setup"
pass "users, group G (O owner; A, R, M, X members), comparison Bench"

# =============================================================================
echo "[${LANE_LABEL}] posture and errors"
# =============================================================================

expect_sql "the RPC is security definer with a pinned search_path, executable by signed-in users only" \
  "select p.prosecdef and coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false)
          and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
          and not has_function_privilege('service_role', p.oid, 'execute')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname = 'group_competition_period_totals';" "t"

totals "${ATHLETE_TOKEN}" '"not windows"' "$(run_psql "select gen_random_uuid();")"
expect_error NOT_FOUND "nonexistent group, before the window check"
TOO_MANY="$(for _ in $(seq 1 13); do win "${S}" $(( S + DAY )); done | jq -sc '.')"
TWELVE="$(for _ in $(seq 1 12); do win "${S}" $(( S + DAY )); done | jq -sc '.')"
while IFS='|' read -r label body; do
  totals "${ATHLETE_TOKEN}" "${body}"
  expect_error VALIDATION "${label}"
done <<EOF
null|null
an object|{"start_ms": 0, "end_ms": 1}
no windows|[]
thirteen windows|${TOO_MANY}
a number|[1]
an extra key|[{"start_ms": 0, "end_ms": 1, "tz": "UTC"}]
a missing end|[{"start_ms": 0}]
a string start|[{"start_ms": "0", "end_ms": 1}]
a fractional start|[{"start_ms": 0.5, "end_ms": 1}]
a negative start|[{"start_ms": -1, "end_ms": 1}]
an empty window|[{"start_ms": 5, "end_ms": 5}]
a reversed window|[{"start_ms": 5, "end_ms": 4}]
a window over 32 days|[{"start_ms": 0, "end_ms": $(( 32 * DAY + 1 ))}]
an end past the safe integers|[{"start_ms": 9007199254740990, "end_ms": 9007199254740992}]
EOF
totals "${ATHLETE_TOKEN}" '[{"start_ms": 0.0, "end_ms": 1.50e1}]'
expect_ok "whole numbers written with a scale"
check "a scaled whole number is echoed as an integer" '.periods[0] | .start_ms == 0 and .end_ms == 15'
totals "${ATHLETE_TOKEN}" "${TWELVE}"
expect_ok "twelve windows"
totals "${ATHLETE_TOKEN}" "[$(win 0 $(( 32 * DAY )))]"
expect_ok "a 32-day window (a month across a DST change fits)"
totals "${ATHLETE_TOKEN}" "$(windows "${W1}" "${W2}")"
expect_ok "an empty fortnight"
check "exact top-level keys" 'keys == ["contract_version", "group_id", "periods"] and .contract_version == 4 and .group_id == $g' \
  --arg g "${GID}"
check "a period's exact keys and echoed bounds, in request order" \
  '[.periods[] | keys] == [["end_ms", "members", "start_ms"], ["end_ms", "members", "start_ms"]]
   and [.periods[] | {start_ms, end_ms}] == $w' --argjson w "$(windows "${W1}" "${W2}")"
check "a member row's exact keys" \
  '.periods[0].members[0] | keys == ["group_records", "member", "working_sets"] and (.member | keys == ["user_id", "username"])'
# Every current member, zeros included, by username: athlete, leaver, member, owner, rival.
expect_periods "A=0/0,X=0/0,M=0/0,O=0/0,R=0/0|A=0/0,X=0/0,M=0/0,O=0/0,R=0/0" "an empty fortnight"
pass "posture; NOT_FOUND before VALIDATION; malformed windows rejected; every member listed with nothing"

# =============================================================================
echo "[${LANE_LABEL}] the windows"
# =============================================================================

# A1 (week 1): 100 × 5 takes #1 on Volume and 1RM (two group records); 90 × 5
# is a working set and no record; the warm-up is neither.
sess "${ATHLETE_TOKEN}" "${T}-a1" completed "$(at 1)" "${T}-a-bench" a1a:100:5:rir_1 a1b:90:5:rir_2 a1c:60:10:warm_up
drain2 "A1"
# R1 at week 2's first instant (in week 2, not week 1): 120 × 5 beats A1 on both boards.
sess "${RIVAL_TOKEN}" "${T}-r1" completed $(( S + 7 * DAY )) "${T}-r-bench" r1:120:5:rir_0
drain2 "R1"
# M's session at week 2's end (outside it, inside the 30 days): an own first best, no group record.
sess "${MEMBER_TOKEN}" "${T}-mb" completed $(( S + 14 * DAY )) "${T}-m-bench" mb:50:5:rir_0
drain2 "M session"
# A2 (week 2) is still active: nothing counts until it completes.
sess "${ATHLETE_TOKEN}" "${T}-a2" active "$(at $(( 7 * 24 * 60 + 5 )))" "${T}-a-bench" a2:130:5:rir_0
drain2 "A2"
# A tombstoned completed session in week 1: nothing counts.
sess "${ATHLETE_TOKEN}" "${T}-adel" completed "$(at 2)" "${T}-a-bench" ad1:40:5:rir_0
next_cuam
push "${ATHLETE_TOKEN}" "tombstone adel" "$(e_session "${T}-adel" "$(at 2)" completed "$(( $(at 2) + 3600000 ))" 3600 "${CUAM}" "${CUAM}")"
# X (week 1): one working set on an unlinked exercise.
sess "${LEAVER_TOKEN}" "${T}-x1" completed "$(at 3)" "${T}-x-free" x1:60:5:rir_2
drain2 "X1"

totals "${OWNER_TOKEN}" "$(windows "${W1}" "${W2}" "${W3}")"
expect_ok "three windows"
expect_periods "A=2/2,X=1/0,M=0/0,O=0/0,R=0/0|A=0/0,X=0/0,M=0/0,O=0/0,R=1/2|A=2/2,X=1/0,M=1/0,O=0/0,R=1/2" \
  "per-window totals; [start, end); overlapping windows; active and tombstoned sessions excluded"
check "no rank, volume or session context anywhere" \
  '[paths | .[-1] | select(type == "string") | select(IN("rank", "volume", "volume_kg_reps", "weight_kg", "session_id", "training_now"))] | length == 0'
totals "${OWNER_TOKEN}" "$(windows "${W3}" "${W1}")"
expect_ok "the same windows, reordered"
expect_periods "A=2/2,X=1/0,M=1/0,O=0/0,R=1/2|A=2/2,X=1/0,M=0/0,O=0/0,R=0/0" "periods answer in request order"
pass "working sets and group records per window, in request order"

# =============================================================================
echo "[${LANE_LABEL}] a removed member"
# =============================================================================

rpc "${OWNER_TOKEN}" group_remove_member "$(jq -nc --arg g "${GID}" --arg u "${LEAVER_UID}" '{p_group_id: $g, p_user_id: $u}')"
expect_ok "remove X"
totals "${ATHLETE_TOKEN}" "$(windows "${W1}" "${W3}")"
expect_ok "after removal"
expect_periods "A=2/2,M=0/0,O=0/0,R=0/0|A=2/2,M=1/0,O=0/0,R=1/2" "a removed member leaves every window"
totals "${LEAVER_TOKEN}" "$(windows "${W1}")"
expect_error NOT_FOUND "the removed member"
pass "a removed member leaves every window and reads NOT_FOUND"

COMPLETED=1
pass "group period totals (run ${RUN_TAG})"
