#!/usr/bin/env bash

# groups-meet-scoring.sh — meet scoring, the cutoff snapshot, Refresh results
# and the Meets leaderboard (a body of the groups-competitions lane).
#
# Contract: docs/specs/tech/group-meet-contract.md ("Scoring, snapshot and
# refresh", "Meets leaderboard"); product fact [[meets.results]]. Members push
# real sessions through sync_push and the evaluator publishes their scores
# (direct-drain mode: the kick URL is unset and the sweep paused for the run,
# both restored on exit). Meet times are set by direct SQL (the server is the
# only writer). Proves:
#
#   - live standings for every metric (1RM, Weight, max reps, Volume, Hold
#     seconds), per-side Weight in the comparison's mode, warm-ups excluded;
#     a session outside the window, an unshared one and a tombstoned link do
#     not count; full-precision ties share a place and the next skips;
#   - `on` and `results` stream items fire once each; a cancelled meet fires
#     nothing;
#   - the cutoff snapshot is written once (a retry, a concurrent advance, a
#     failed attempt and a deferred one while the evaluator is behind), copies
#     every set of every counting link (unlinked exercises too), and results
#     then come only from it: a set edit changes nothing until Refresh, which
#     re-snapshots, reranks and writes one stream item per call;
#   - a challenge added, edited or removed after the cutoff rescores from the
#     snapshot; a challenge on an exercise nobody linked is empty;
#   - the Meets leaderboard across final meets, a former member kept and
#     marked; account deletion and dev_wipe_my_data remove a member's snapshot
#     rows and trophies and rerank;
#   - reads and Refresh deny outsiders, anon and old clients; kg disclosure
#     hides kg figures and raw weights on live and final reads, keeping places.
#
# Hermetic: per-run users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-meet-scoring"
FIXTURE_EMAIL_PREFIX="groups-meet-scoring"
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

RUN_TAG="$(printf '%s' "$(date +%s)-$$-${RANDOM}" | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsMeetScoring!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
FAULT_CONSTRAINT=ms_snapshot_fault
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
    alter table app_public.group_meet_snapshot_scores drop constraint if exists ${FAULT_CONSTRAINT};" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and (user_id in (${ids})
      or context ->> 'group_id' in (select id::text from app_public.groups where created_by in (${ids})));
    delete from app_public.group_eval_queue where member_user_id in (${ids});
    delete from app_public.groups where created_by in (${ids})
      or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
    delete from auth.users where id in (${ids});
    commit;" >/dev/null
}
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

set_kick_url ""
set_sweep_active false

# The current app's group calls: protocol 4, Hold support and the sync protocol.
rpc() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H "${GROUP_CONTRACT_HEADER}" \
    -H 'x-boga-group-seconds: 1' -H "x-boga-sync-protocol: ${BOGA_TEST_SYNC_PROTOCOL:-8}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
rpc_no_hold() {
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" -H "${GROUP_CONTRACT_HEADER}" \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" \
    --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
expect_sql() {
  local got
  got="$(run_psql "$2")"
  [[ "${got}" == "$3" ]] || fail "$1: expected '$3', got '${got}'"
}
drain() {
  eval_drain
  expect_ok "drain: $1"
  check "drain: $1 (no failed job)" '.failed == 0'
}
new_uuid() { run_psql "select gen_random_uuid();"; }

HOUR=3600000
NOW="$(run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;")"
CUAM="${NOW}"
T="ms-${RUN_TAG}"

# --- envelopes ---------------------------------------------------------------------

e_hold_def() {
  jq -nc --arg id "$1" --arg name "$2" --argjson c "$3" \
    '{type: "exercise_definitions", id: $id, client_updated_at_ms: $c,
      fields: {name: $name, recording_mode: "hold", load_input_mode: "total_load", bodyweight_contribution: 0,
               created_at: $c, updated_at: $c, deleted_at: null}}'
}
e_hold() {
  jq -nc --arg id "$1" --arg se "$2" --argjson o "$3" --argjson d "$4" --argjson c "$5" \
    '{type: "exercise_sets", id: $id, client_updated_at_ms: $c,
      fields: {session_exercise_id: $se, order_index: $o, weight_value: "", reps_value: "", recording_mode: "hold",
               duration_sec: $d, set_type: "working", planned_weight_value: null, planned_reps_value: null,
               planned_set_type: null, performance_status: null, created_at: $c, updated_at: $c, deleted_at: null}}'
}
e_mlink() {
  jq -nc --arg m "$1" --arg s "$2" --argjson c "$3" --argjson del "${4:-null}" \
    '{type: "session_meet_links", id: ($m + ":" + $s), client_updated_at_ms: $c,
      fields: {session_id: $s, meet_id: $m, created_at: $c, updated_at: $c, deleted_at: $del}}'
}
e_reading() {
  jq -nc --arg id "$1" --argjson at "$2" --argjson kg "$3" --argjson c "$4" \
    '{type: "body_weight_measurements", id: $id, client_updated_at_ms: $c,
      fields: {weight_kg: $kg, measured_at: $at, created_at: $c, updated_at: $c, deleted_at: null}}'
}
link_meet() {
  next_cuam
  push "$1" "link $3 → $2" "$(e_mlink "$2" "$3" "${CUAM}" "${4:-null}")"
}

# --- fixture ---------------------------------------------------------------------

echo "[${LANE_LABEL}] run ${RUN_TAG}: provisioning"
for who in OWNER A B C D OUTSIDER; do
  provision "${who}" "$(printf '%s' "${who}" | tr 'A-Z' 'a-z')"
  uid_var="${who}_UID"
  set_username "${!uid_var}" "ms-$(printf '%s' "${who}" | tr 'A-Z' 'a-z')-${RUN_TAG}"
done
rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Meet scoring ${RUN_TAG}" '{p_name:$n, p_description:null, p_time_zone:"Europe/London"}')"
expect_ok "create group"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
INVITE="$(jq -er '.code' <<<"${BODY}")"
for who in A B C D; do
  token_var="${who}_TOKEN"
  rpc "${!token_var}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"
  expect_ok "${who} joins"
done
# Everyone has been a member for a month, but D only since two hours into
# the meet: D's earlier session is never shared.
run_psql "update app_public.group_memberships set joined_at = clock_timestamp() - interval '30 days'
  where group_id = '${GID}';" >/dev/null

comparison() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GID}" --arg n "$1" --arg m "$2" \
    --argjson c "$3" --arg d "$4" '{p_group_id:$g, p_name:$n, p_load_input_mode:$m, p_source_exercise_id:null,
      p_bodyweight_contribution:$c, p_default_metric:$d}')"
  expect_ok "comparison $1"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
BENCH="$(comparison Bench total_load 0 e1rm)"
PRESS="$(comparison 'DB press' per_side_load 0 e1rm)"
PLANK="$(comparison Plank total_load 0 seconds)"
PULL="$(comparison Pull-up total_load 1 volume)"
SQUAT="$(comparison Squat total_load 0 e1rm)"

# Every member links Bench, DB press, Plank and Pull-up. A logs DB press per
# side; B logs it as a total.
for who in A B C D; do
  token_var="${who}_TOKEN"
  mode=total_load
  [[ "${who}" != A ]] || mode=per_side_load
  next_cuam
  push "${!token_var}" "${who} exercises" \
    "$(e_def "${T}-${who}-bench" Bench "${CUAM}")" "$(e_link "${T}-${who}-bench" "${GID}" "${BENCH}" "${CUAM}")" \
    "$(e_def "${T}-${who}-press" 'DB press' "${CUAM}" "${mode}")" "$(e_link "${T}-${who}-press" "${GID}" "${PRESS}" "${CUAM}")" \
    "$(e_hold_def "${T}-${who}-plank" Plank "${CUAM}")" "$(e_link "${T}-${who}-plank" "${GID}" "${PLANK}" "${CUAM}")" \
    "$(e_def "${T}-${who}-pull" Pull-up "${CUAM}" total_load 1)" "$(e_link "${T}-${who}-pull" "${GID}" "${PULL}" "${CUAM}")" \
    "$(e_def "${T}-${who}-curl" Curl "${CUAM}")"
done

S=$((NOW - 3 * HOUR))
E=$((NOW - HOUR))
new_meet() {
  local meet
  meet="$(new_uuid)"
  rpc "${OWNER_TOKEN}" group_meet_create "$(jq -nc --arg g "${GID}" --arg m "${meet}" --argjson s "$((NOW + HOUR))" \
    '{p_group_id:$g, p_meet_id:$m, p_title:null, p_starts_at_ms:$s, p_ends_at_ms:null, p_venue_name:"Iron Temple",
      p_address:null, p_latitude:null, p_longitude:null, p_entry_note:null}')"
  expect_ok "create meet"
  run_psql "update app_public.group_meets set starts_at = app_public.group_meet_at($1),
    ends_at = app_public.group_meet_at($2) where id = '${meet}';" >/dev/null
  printf '%s' "${meet}"
}
challenge() {
  local id
  id="$(new_uuid)"
  rpc "${A_TOKEN}" group_meet_challenge_add "$(jq -nc --arg g "${GID}" --arg m "$1" --arg c "${id}" --arg x "$2" --arg k "$3" \
    '{p_group_id:$g, p_meet_id:$m, p_challenge_id:$c, p_group_exercise_id:$x, p_metric:$k}')"
  expect_ok "challenge $3"
  printf '%s' "${id}"
}
results() {
  rpc "${1:-${A_TOKEN}}" group_meet_results "$(jq -nc --arg g "${GID}" --arg m "$2" '{p_group_id:$g, p_meet_id:$m}')"
}
# places <challenge>: "<member-label>=<place>" for its rows, in reading order.
places() {
  jq -r --arg c "$1" --argjson who "${WHO}" \
    '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | "\($who[.member.user_id] // "?")=\(.place)"] | join(",")' \
    <<<"${BODY}"
}
expect_places() {
  local got
  got="$(places "$1")"
  [[ "${got}" == "$2" ]] || fail "$3: expected [$2], got [${got}]"
}
value_of() {
  jq -r --arg c "$1" --arg u "$2" '.challenges[] | select(.challenge.challenge_id == $c) | .standings[]
    | select(.member.user_id == $u) | "\(.value) \(.unit)"' <<<"${BODY}"
}
meet_items() {
  run_psql "select count(*) from app_public.group_events where kind = 'meet'
    and payload->'meet'->>'meet_id' = '$1' and payload->>'event' = '$2';"
}

MEET="$(new_meet "${S}" "${E}")"
CH_E1RM="$(challenge "${MEET}" "${BENCH}" e1rm)"
CH_WEIGHT="$(challenge "${MEET}" "${BENCH}" weight)"
CH_REPS="$(challenge "${MEET}" "${BENCH}" reps)"
CH_VOLUME="$(challenge "${MEET}" "${BENCH}" volume)"
CH_PRESS="$(challenge "${MEET}" "${PRESS}" weight)"
CH_PLANK="$(challenge "${MEET}" "${PLANK}" seconds)"
CH_PULL="$(challenge "${MEET}" "${PULL}" reps)"
CH_PULL_WEIGHT="$(challenge "${MEET}" "${PULL}" weight)"
CH_SQUAT="$(challenge "${MEET}" "${SQUAT}" e1rm)"

# workout <who> <session> <started> <entity...>: a completed one-hour session.
workout() {
  local who="$1" sid="$2" started="$3" token_var="$1_TOKEN"
  shift 3
  next_cuam
  push "${!token_var}" "${who} session ${sid}" \
    "$(e_session "${sid}" "${started}" completed "$((started + HOUR))" 3600 null "${CUAM}")" "$@"
}
se() { e_se "$1-$2" "$1" "${T}-$3-$2" "$4" "$2" "${CUAM}"; }

A_MAIN="${T}-a-main"
next_cuam
workout A "${A_MAIN}" "$((S + HOUR))" \
  "$(se "${A_MAIN}" bench A 0)" "$(e_set "${A_MAIN}-bench-1" "${A_MAIN}-bench" 0 100 5 '' "${CUAM}" null rir_0)" \
  "$(e_set "${A_MAIN}-bench-warm" "${A_MAIN}-bench" 1 60 12 '' "${CUAM}" null warm_up)" \
  "$(se "${A_MAIN}" press A 1)" "$(e_set "${A_MAIN}-press-1" "${A_MAIN}-press" 0 20 8 '' "${CUAM}" null rir_0)" \
  "$(se "${A_MAIN}" plank A 2)" "$(e_hold "${A_MAIN}-plank-1" "${A_MAIN}-plank" 0 60 "${CUAM}")" \
  "$(se "${A_MAIN}" pull A 3)" "$(e_set "${A_MAIN}-pull-1" "${A_MAIN}-pull" 0 0 12 '' "${CUAM}" null rir_0)" \
  "$(e_set "${A_MAIN}-pull-2" "${A_MAIN}-pull" 1 10 8 '' "${CUAM}" null rir_0)" \
  "$(se "${A_MAIN}" curl A 4)" "$(e_set "${A_MAIN}-curl-1" "${A_MAIN}-curl" 0 15 10 '' "${CUAM}" null rir_0)"
B_MAIN="${T}-b-main"
workout B "${B_MAIN}" "$((S + HOUR))" \
  "$(se "${B_MAIN}" bench B 0)" "$(e_set "${B_MAIN}-bench-1" "${B_MAIN}-bench" 0 100 5 '' "${CUAM}" null rir_0)" \
  "$(se "${B_MAIN}" press B 1)" "$(e_set "${B_MAIN}-press-1" "${B_MAIN}-press" 0 50 8 '' "${CUAM}" null rir_0)" \
  "$(se "${B_MAIN}" plank B 2)" "$(e_hold "${B_MAIN}-plank-1" "${B_MAIN}-plank" 0 45 "${CUAM}")" \
  "$(se "${B_MAIN}" pull B 3)" "$(e_set "${B_MAIN}-pull-1" "${B_MAIN}-pull" 0 0 10 '' "${CUAM}" null rir_0)"
C_MAIN="${T}-c-main"
workout C "${C_MAIN}" "$((S + HOUR))" \
  "$(se "${C_MAIN}" bench C 0)" "$(e_set "${C_MAIN}-bench-1" "${C_MAIN}-bench" 0 90 6 '' "${CUAM}" null rir_0)" \
  "$(se "${C_MAIN}" plank C 1)" "$(e_hold "${C_MAIN}-plank-1" "${C_MAIN}-plank" 0 90 "${CUAM}")"
D_MAIN="${T}-d-main"
workout D "${D_MAIN}" "$((S + 2 * HOUR - HOUR / 2))" \
  "$(se "${D_MAIN}" bench D 0)" "$(e_set "${D_MAIN}-bench-1" "${D_MAIN}-bench" 0 80 10 '' "${CUAM}" null rir_0)"
# Sessions that must not count: A's outside the window, C's whose link is
# tombstoned, D's started before D joined (unshared).
A_OUT="${T}-a-out"
workout A "${A_OUT}" "$((E + HOUR))" \
  "$(se "${A_OUT}" bench A 0)" "$(e_set "${A_OUT}-bench-1" "${A_OUT}-bench" 0 200 5 '' "${CUAM}" null rir_0)"
C_GONE="${T}-c-gone"
workout C "${C_GONE}" "$((S + HOUR))" \
  "$(se "${C_GONE}" bench C 0)" "$(e_set "${C_GONE}-bench-1" "${C_GONE}-bench" 0 300 1 '' "${CUAM}" null rir_0)"
D_EARLY="${T}-d-early"
run_psql "update app_public.group_memberships set joined_at = app_public.group_meet_at($((S + 2 * HOUR - HOUR)))
  where group_id = '${GID}' and user_id = '${D_UID}';" >/dev/null
workout D "${D_EARLY}" "$((S + HOUR / 2))" \
  "$(se "${D_EARLY}" bench D 0)" "$(e_set "${D_EARLY}-bench-1" "${D_EARLY}-bench" 0 150 5 '' "${CUAM}" null rir_0)"
for pair in "A ${A_MAIN}" "B ${B_MAIN}" "C ${C_MAIN}" "D ${D_MAIN}" "A ${A_OUT}" "C ${C_GONE}" "D ${D_EARLY}"; do
  read -r who sid <<<"${pair}"
  token_var="${who}_TOKEN"
  link_meet "${!token_var}" "${MEET}" "${sid}"
done
link_meet "${C_TOKEN}" "${MEET}" "${C_GONE}" "${NOW}"
[[ "$(run_psql "select count(*) from app_public.group_session_shares where session_id = '${D_EARLY}';")" == 0 ]] ||
  fail "D's pre-membership session must not be shared"
drain "the fixture's sessions"

WHO="$(jq -nc --arg a "${A_UID}" --arg b "${B_UID}" --arg c "${C_UID}" --arg d "${D_UID}" '{($a):"A",($b):"B",($c):"C",($d):"D"}')"

# --- live standings ---------------------------------------------------------------

results "${A_TOKEN}" "${MEET}"
expect_ok "live results"
check "live caption: standings so far, final at the cutoff" \
  '.results.state == "so_far" and .results.final_at_ms == .meet.cutoff_at_ms and .results.refreshed_at_ms == null'
# Wathan: 100×5 ≈ 116.6 (A and B, tied), 90×6 ≈ 108.3 (C), 80×10 ≈ 107.8 (D).
expect_places "${CH_E1RM}" "A=1,B=1,C=3,D=4" "1RM: a full-precision tie shares a place and the next skips"
expect_places "${CH_WEIGHT}" "A=1,B=1,C=3,D=4" "Weight"
# A's 12-rep warm-up is not a working set, so A's best is 5.
expect_places "${CH_REPS}" "D=1,C=2,A=3,B=3" "max reps: working sets only"
expect_places "${CH_VOLUME}" "D=1,C=2,A=3,B=3" "Volume: best single working set"
[[ "$(value_of "${CH_VOLUME}" "${A_UID}")" == "500 kg_reps" ]] || fail "A's Volume is 100×5, not the warm-up"
# DB press ranks in the comparison's per-side mode: A's 20 per side is 20;
# B's 50 total is 25 per side.
expect_places "${CH_PRESS}" "B=1,A=2" "Weight in the comparison's entry mode"
[[ "$(value_of "${CH_PRESS}" "${B_UID}")" == "25 kg" && "$(value_of "${CH_PRESS}" "${A_UID}")" == "20 kg" ]] ||
  fail "per-side Weight: ${BODY}"
expect_places "${CH_PLANK}" "C=1,A=2,B=3" "Hold seconds"
[[ "$(value_of "${CH_PLANK}" "${C_UID}")" == "90 seconds" ]] || fail "Hold seconds value"
# Bodyweight-only pull-ups score no load, but their reps rank.
expect_places "${CH_PULL}" "A=1,B=2" "max reps on a bodyweight exercise"
expect_places "${CH_PULL_WEIGHT}" "A=1" "only a loaded pull-up has a Weight"
expect_places "${CH_SQUAT}" "" "a challenge on an exercise nobody linked is empty"
check "the counting sessions: inside the window, shared, live link" \
  '[.sessions[].session_id] | sort == ([$a, $b, $c, $d] | sort)' \
  --arg a "${A_MAIN}" --arg b "${B_MAIN}" --arg c "${C_MAIN}" --arg d "${D_MAIN}"
check "a standings row carries its set" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | select(.member.user_id == $u)][0]
     | .set == {set_id: $s, session_id: $m, recording_mode: "reps", reps_value: "5", duration_sec: null, weight_value: "100"}
       and .current_member and .certified == false and .unavailable == false' \
  --arg c "${CH_E1RM}" --arg u "${A_UID}" --arg s "${A_MAIN}-bench-1" --arg m "${A_MAIN}"
check "group records set in the counting sessions" \
  '(.records | length) > 0 and all(.records[]; .session_id as $s | [$a, $b, $c, $d] | index($s))' \
  --arg a "${A_MAIN}" --arg b "${B_MAIN}" --arg c "${C_MAIN}" --arg d "${D_MAIN}"
pass "live: every metric, entry modes, effort, ties, window, sharing and tombstones"

# ✓ certified: the owner certifies B's 1RM set, B's board entry.
TOKEN="$(run_psql "select write_token from app_public.group_metric_set_scores
  where group_exercise_id = '${BENCH}' and set_id = '${B_MAIN}-bench-1' and metric = 'e1rm';")"
REV="$(run_psql "select rules_revision from app_public.group_exercises where id = '${BENCH}';")"
rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${BENCH}" --arg u "${B_UID}" \
  --arg s "${B_MAIN}-bench-1" --arg t "${TOKEN}" --argjson r "${REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
expect_ok "certify B's set"
results "${A_TOKEN}" "${MEET}"
check "a certified set shows ✓ on every challenge of its exercise, and only there" \
  '[.challenges[] | .standings[] | select(.member.user_id == $u) | .certified] == [true, true, true, true, false, false, false]' \
  --arg u "${B_UID}"
pass "live: certified sets"

# --- timed transitions -----------------------------------------------------------

[[ "$(meet_items "${MEET}" on)" == 1 && "$(meet_items "${MEET}" results)" == 1 ]] ||
  fail "a started and ended meet has one on and one results item"
drain "again"
[[ "$(meet_items "${MEET}" on)" == 1 && "$(meet_items "${MEET}" results)" == 1 ]] ||
  fail "on and results fire once each"
expect_sql "the on item sorts at the start and results at the end" \
  "select string_agg(payload->>'event' || '@' || (sort_at_ms - app_public.group_meet_ms(m.starts_at))::text, ',' order by payload->>'event')
     from app_public.group_events e join app_public.group_meets m on m.id = '${MEET}'
    where e.kind = 'meet' and e.payload->'meet'->>'meet_id' = '${MEET}' and e.payload->>'event' in ('on', 'results');" \
  "on@0,results@$((E - S))"
expect_sql "no snapshot before the cutoff" \
  "select count(*) from app_public.group_meet_snapshots where meet_id = '${MEET}';" 0

LIVE_MEET="$(new_meet "$((NOW - HOUR))" "$((NOW + HOUR))")"
SCHEDULED_MEET="$(new_meet "$((NOW + 2 * HOUR))" "$((NOW + 3 * HOUR))")"
drain "a live and a scheduled meet"
results "${A_TOKEN}" "${LIVE_MEET}"
check "a meet in its window reads Live" '.results.state == "live"'
[[ "$(meet_items "${LIVE_MEET}" on)" == 1 && "$(meet_items "${LIVE_MEET}" results)" == 0 ]] ||
  fail "a live meet has its on item and no results item yet"
results "${A_TOKEN}" "${SCHEDULED_MEET}"
check "a scheduled meet reads Scheduled with no standings" '.results.state == "scheduled" and .sessions == []'
[[ "$(meet_items "${SCHEDULED_MEET}" on)" == 0 ]] || fail "a scheduled meet has no on item"

# A cancelled meet fires nothing, even long past its cutoff.
CANCELLED="$(new_meet "$((NOW + 2 * HOUR))" "$((NOW + 3 * HOUR))")"
rpc "${OWNER_TOKEN}" group_meet_cancel "$(jq -nc --arg g "${GID}" --arg m "${CANCELLED}" '{p_group_id:$g,p_meet_id:$m,p_expected_version:1}')"
expect_ok "cancel"
run_psql "update app_public.group_meets set starts_at = app_public.group_meet_at($((NOW - 50 * HOUR))),
  ends_at = app_public.group_meet_at($((NOW - 49 * HOUR))), cancelled_at = app_public.group_meet_at($((NOW - 51 * HOUR)))
  where id = '${CANCELLED}';" >/dev/null
link_meet "${A_TOKEN}" "${CANCELLED}" "${A_MAIN}"
drain "a cancelled meet past its cutoff"
expect_sql "a cancelled meet fires no transition" \
  "select (select count(*) from app_public.group_events where kind = 'meet' and payload->'meet'->>'meet_id' = '${CANCELLED}'
      and payload->>'event' in ('on','results')) || '|' || (select count(*) from app_public.group_meet_snapshots
      where meet_id = '${CANCELLED}') || '|' || (finalized_at is null) from app_public.group_meets where id = '${CANCELLED}';" \
  "0|0|true"
results "${A_TOKEN}" "${CANCELLED}"
check "a cancelled meet reads Cancelled with no standings" \
  '.results.state == "cancelled" and all(.challenges[]; .standings == []) and .sessions == [] and .records == []'
rpc "${OWNER_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${CANCELLED}" '{p_group_id:$g,p_meet_id:$m}')"
expect_error CONFLICT "a cancelled meet refuses Refresh"
pass "transitions: on and results once each, live and scheduled captions, cancelled fires nothing"

# --- the cutoff snapshot ------------------------------------------------------------

rpc "${OWNER_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
expect_error CONFLICT "Refresh before the cutoff (results are still live)"

# Three more past meets over the same window, each with A's session: one
# snapshotted by two concurrent advances, one whose first attempt fails, one
# that waits for the evaluator.
RACE="$(new_meet "${S}" "${E}")"
FAULT="$(new_meet "${S}" "${E}")"
BEHIND="$(new_meet "${S}" "${E}")"
for m in "${RACE}" "${FAULT}" "${BEHIND}"; do link_meet "${A_TOKEN}" "${m}" "${A_MAIN}"; done
drain "the extra meets' links"
LIVE_BODY="$(results "${A_TOKEN}" "${MEET}"; printf '%s' "${BODY}")"
past_cutoff() {
  run_psql "update app_public.group_meets set starts_at = starts_at - interval '26 hours',
    ends_at = ends_at - interval '26 hours' where id in ($1);" >/dev/null
}
# The sessions move with their meets. Triggers are off for that one update
# (a test-only clock shift, not a member's edit), so nothing is re-queued.
past_cutoff "'${MEET}', '${RACE}', '${FAULT}', '${BEHIND}'"
run_psql "begin; set local session_replication_role = replica;
  update app_public.sessions set started_at = started_at - 26 * ${HOUR}, completed_at = completed_at - 26 * ${HOUR}
   where id in ('${A_MAIN}', '${B_MAIN}', '${C_MAIN}', '${D_MAIN}', '${A_OUT}', '${C_GONE}', '${D_EARLY}');
  commit;" >/dev/null
run_psql "alter table app_public.group_meet_snapshot_scores add constraint ${FAULT_CONSTRAINT}
  check (meet_id <> '${FAULT}') not valid;" >/dev/null
# advance_all [n]: the worker's loop, n calls in one SQL statement; prints one
# compact result per call that advanced a meet.
advance_all() {
  run_psql "select coalesce(string_agg(r::text, ' ' order by i), '') from (
    select i, app_public.group_meet_eval_advance() as r from generate_series(1, ${1:-10}) i) x
    where (r->>'advanced')::boolean;"
}
# The evaluator is behind while its queue holds an unparked job for a counting
# session: A's main session is queued, unclaimed.
run_psql "insert into app_public.group_eval_queue(kind, member_user_id, session_id, causes)
  values ('session', '${A_UID}', '${A_MAIN}', array['set']) on conflict do nothing;" >/dev/null
STEPS="$(advance_all)"
[[ "$(jq -s 'map(select(.done == ["deferred"])) | length' <<<"${STEPS}")" == 4 &&
   "$(jq -s 'length' <<<"${STEPS}")" == 4 ]] ||
  fail "every cutoff waits while a counting session's evaluation is queued, each meet once: ${STEPS}"
expect_sql "no snapshot while the evaluator is behind; each deferred meet backs off" \
  "select (select count(*) from app_public.group_meet_snapshots where meet_id in ('${MEET}','${RACE}','${FAULT}','${BEHIND}'))
     || '|' || (select count(*) from app_public.group_meets where id in ('${MEET}','${RACE}','${FAULT}','${BEHIND}')
       and transition_available_at > clock_timestamp());" "0|4"
[[ -z "$(advance_all)" ]] || fail "a deferred meet is not retried before its backoff"
rpc "${OWNER_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
expect_error CONFLICT "Refresh while the evaluator is behind"
run_psql "delete from app_public.group_eval_queue where member_user_id = '${A_UID}' and session_id = '${A_MAIN}';
  update app_public.group_meets set transition_available_at = null where id in ('${MEET}','${RACE}','${FAULT}','${BEHIND}');" >/dev/null

# Two worker loops at once: each meet is snapshotted by exactly one, each in
# its own transaction; the faulted meet fails alone and backs off.
PIDS=()
for i in 1 2; do
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "select app_public.group_meet_eval_advance()::text from generate_series(1, 10);" \
    >"${TMPDIR:-/tmp}/ms-${RUN_TAG}-${i}.out" 2>&1 &
  PIDS+=("$!")
done
for pid in "${PIDS[@]}"; do wait "${pid}" || fail "a concurrent advance failed"; done
SUM="$(cat "${TMPDIR:-/tmp}/ms-${RUN_TAG}-1.out" "${TMPDIR:-/tmp}/ms-${RUN_TAG}-2.out" | jq -sc \
  '{snapshots: map(select(.done // [] | index("snapshot"))) | length, failed: map(select(.failed == true)) | length}')"
rm -f "${TMPDIR:-/tmp}/ms-${RUN_TAG}-1.out" "${TMPDIR:-/tmp}/ms-${RUN_TAG}-2.out"
[[ "${SUM}" == "$(jq -nc '{snapshots: 3, failed: 1}')" ]] ||
  fail "concurrent advances snapshot each meet once and the faulted one fails once: ${SUM}"
expect_sql "one snapshot per meet; the failed attempt left nothing behind and backs off" \
  "select string_agg(case when m.id = '${FAULT}' then 'fault' else 'ok' end || ':' || (select count(*) from app_public.group_meet_snapshots s
      where s.meet_id = m.id) || ':' || (m.finalized_at is not null) || ':' || m.transition_attempts,
      ',' order by m.id = '${FAULT}', m.id)
     from app_public.group_meets m where m.id in ('${MEET}','${RACE}','${FAULT}','${BEHIND}');" \
  "ok:1:true:0,ok:1:true:0,ok:1:true:0,fault:0:false:1"
expect_sql "the failure logged ids and sqlstate only" \
  "select count(*) = 1 and bool_and(context ? 'sqlstate' and not (context ? 'message')) from public.app_logs
    where event = 'group.meet_advance_failed' and context->>'meet_id' = '${FAULT}';" t
run_psql "alter table app_public.group_meet_snapshot_scores drop constraint ${FAULT_CONSTRAINT};
  update app_public.group_meets set transition_available_at = null where id = '${FAULT}';" >/dev/null
TAKEN="$(run_psql "select taken_at from app_public.group_meet_snapshots where meet_id = '${MEET}';")"
drain "a retry after the failure"
check "the retry snapshots the failed meet" '.meets.snapshots == 1 and .meets.failed == 0'
expect_sql "a success clears the backoff" \
  "select transition_attempts || '|' || (transition_available_at is null) from app_public.group_meets where id = '${FAULT}';" "0|true"
drain "a second retry"
check "nothing is due any more" '.meets == {on: 0, results: 0, snapshots: 0, deferred: 0, failed: 0}'
# A meet that failed up to the evaluator's attempt cap is parked: neither the
# worker nor the sweep picks it up again.
PARKED="$(new_meet "$((S - 26 * HOUR))" "$((E - 26 * HOUR))")"
run_psql "update app_public.group_meets set transition_attempts = app_public.group_eval_max_attempts() where id = '${PARKED}';" >/dev/null
[[ -z "$(advance_all)" ]] || fail "a parked meet is not advanced"
expect_sql "a parked meet fires nothing and the sweep sees no meet work" \
  "select (on_at is null and finalized_at is null) || '|' || not exists (select 1 from app_public.group_meets m
     where m.cancelled_at is null and m.finalized_at is null and m.starts_at <= now()
       and m.transition_attempts < app_public.group_eval_max_attempts() and app_public.group_meet_transition_due(m, now())
       and m.group_id = '${GID}')
   from app_public.group_meets where id = '${PARKED}';" "true|true"
expect_sql "the snapshot is written once: a retry never rewrites it" \
  "select (taken_at = '${TAKEN}'::timestamptz) || '|' || refresh_count from app_public.group_meet_snapshots where meet_id = '${MEET}';" \
  "true|0"
expect_sql "every set of every counting link, unlinked exercises included, nothing else" \
  "select string_agg(member || ':' || n || ':' || unlinked, ',' order by member) from (
     select case s.member_user_id when '${A_UID}' then 'A' when '${B_UID}' then 'B' when '${C_UID}' then 'C' else 'D' end as member,
       count(*) as n, count(*) filter (where s.group_exercise_id is null) as unlinked
       from app_public.group_meet_snapshot_sets s where s.meet_id = '${MEET}' group by s.member_user_id) x;" \
  "A:7:1,B:4:0,C:2:0,D:1:0"

results "${A_TOKEN}" "${MEET}"
check "final caption" '.results.state == "final" and .results.refreshed_at_ms == null'
[[ "$(jq -c '[.challenges[] | {c: .challenge.challenge_id, s: [.standings[] | [.member.user_id, .place, .value, .unit, .set.set_id]]}]' <<<"${BODY}")" == \
   "$(jq -c '[.challenges[] | {c: .challenge.challenge_id, s: [.standings[] | [.member.user_id, .place, .value, .unit, .set.set_id]]}]' <<<"${LIVE_BODY}")" ]] ||
  fail "the snapshot ranks exactly what the live standings showed"
check "the snapshot keeps the ✓ it saw" \
  '[.challenges[] | .standings[] | select(.member.user_id == $u) | .certified] == [true, true, true, true, false, false, false]' \
  --arg u "${B_UID}"
check "final sessions come from the snapshot" '[.sessions[].session_id] | length == 4'
pass "snapshot: once at the cutoff (retry, concurrent advance, failure, evaluator fence), every set, same standings"

# --- after the cutoff: edits, Refresh, rescoring ------------------------------------

# After the cutoff: A's bench goes up; B re-enters the certified set's weight
# (same value, new raw text, so its certification ends); A links Curl, which
# the snapshot holds unlinked, to Squat.
next_cuam
push "${A_TOKEN}" "A's bench edited and Curl linked after the cutoff" \
  "$(e_set "${A_MAIN}-bench-1" "${A_MAIN}-bench" 0 120 5 '' "${CUAM}" null rir_0)" \
  "$(e_link "${T}-A-curl" "${GID}" "${SQUAT}" "${CUAM}")"
next_cuam
push "${B_TOKEN}" "B's certified set edited after the cutoff" \
  "$(e_set "${B_MAIN}-bench-1" "${B_MAIN}-bench" 0 100.0 5 '' "${CUAM}" null rir_0)"
drain "the edits"
expect_sql "the edit ended B's certification" \
  "select count(*) from app_public.group_metric_certifications where set_id = '${B_MAIN}-bench-1' and ended_at is null;" 0
results "${A_TOKEN}" "${MEET}"
expect_places "${CH_E1RM}" "A=1,B=1,C=3,D=4" "a set edit after the cutoff changes nothing until Refresh"
check "the final ✓ stays on the figures it witnessed" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | select(.member.user_id == $u)
     | [.certified, .set.weight_value]] == [[true, "100"]]' --arg c "${CH_E1RM}" --arg u "${B_UID}"
expect_places "${CH_SQUAT}" "" "the snapshot keeps the mapping it took: a later link changes nothing until Refresh"

rpc "${B_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
expect_error FORBIDDEN "a member cannot refresh results"
rpc "${OWNER_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
expect_ok "Refresh results"
check "refreshed caption" '.results.state == "refreshed" and .results.refreshed_at_ms != null
  and .results.refreshed_by.user_id == $o' --arg o "${OWNER_UID}"
expect_places "${CH_E1RM}" "A=1,B=2,C=3,D=4" "Refresh re-snapshots the sessions as they stand now"
expect_places "${CH_VOLUME}" "D=1,A=2,C=3,B=4" "Refresh reranks every challenge"
expect_places "${CH_SQUAT}" "A=1" "Refresh takes the mapping as it stands now"
check "Refresh takes the ✓ as it stands now" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | select(.member.user_id == $u)
     | [.certified, .set.weight_value]] == [[false, "100.0"]]' --arg c "${CH_E1RM}" --arg u "${B_UID}"
[[ "$(meet_items "${MEET}" results_refreshed)" == 1 ]] || fail "Refresh writes one stream item"
rpc "${OWNER_TOKEN}" group_meet_refresh_results "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
expect_ok "Refresh again"
[[ "$(meet_items "${MEET}" results_refreshed)" == 2 ]] || fail "each Refresh writes its own item"
expect_sql "Refresh counts" "select refresh_count from app_public.group_meet_snapshots where meet_id = '${MEET}';" 2
pass "after the cutoff: edits wait for Refresh, which re-snapshots, reranks and writes one item per call"

leaderboard() {
  rpc "${1:-${A_TOKEN}}" group_meet_leaderboard "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
}
# tally: "<label>:<rank>:<gold>/<silver>/<bronze>:<current>" in reading order.
tally() {
  jq -r --argjson who "${WHO}" '[.rows[] | "\($who[.member.user_id]):\(.rank):\(.gold)/\(.silver)/\(.bronze):\(.current_member)"] | join(",")' <<<"${BODY}"
}
expect_tally() {
  local got
  got="$(tally)"
  [[ "${got}" == "$1" ]] || fail "$2: expected [$1], got [${got}]"
}
# A challenge added, edited or removed after the cutoff rescores from the snapshot.
CH_NEW="$(challenge "${MEET}" "${PRESS}" e1rm)"
results "${A_TOKEN}" "${MEET}"
expect_places "${CH_NEW}" "B=1,A=2" "an added challenge ranks from the snapshot"
leaderboard
expect_tally "A:1:5/4/1:true,B:2:2/3/2:true,D:3:2/0/0:true,C:4:1/1/3:true" "an added challenge's trophies count at once"
rpc "${A_TOKEN}" group_meet_challenge_update "$(jq -nc --arg g "${GID}" --arg m "${MEET}" --arg c "${CH_NEW}" --arg x "${BENCH}" \
  '{p_group_id:$g,p_meet_id:$m,p_challenge_id:$c,p_expected_version:1,p_group_exercise_id:$x,p_metric:"weight"}')"
expect_error DUPLICATE "an edit onto an existing pair"
rpc "${A_TOKEN}" group_meet_challenge_update "$(jq -nc --arg g "${GID}" --arg m "${MEET}" --arg c "${CH_NEW}" --arg x "${PRESS}" \
  '{p_group_id:$g,p_meet_id:$m,p_challenge_id:$c,p_expected_version:1,p_group_exercise_id:$x,p_metric:"volume"}')"
expect_ok "edit the challenge"
results "${A_TOKEN}" "${MEET}"
# Volume is total work: A 2×20×8 = 320, B 50×8 = 400.
expect_places "${CH_NEW}" "B=1,A=2" "an edited challenge reranks"
[[ "$(value_of "${CH_NEW}" "${A_UID}")" == "320 kg_reps" ]] || fail "edited challenge values come from the snapshot"
rpc "${A_TOKEN}" group_meet_challenge_remove "$(jq -nc --arg g "${GID}" --arg m "${MEET}" --arg c "${CH_NEW}" \
  '{p_group_id:$g,p_meet_id:$m,p_challenge_id:$c,p_expected_version:2}')"
expect_ok "remove the challenge"
expect_sql "a removed challenge keeps no standings" \
  "select count(*) from app_public.group_meet_standings where challenge_id = '${CH_NEW}';" 0
results "${A_TOKEN}" "${MEET}"
check "a removed challenge leaves the results" '[.challenges[].challenge.challenge_id] | index($c) == null' --arg c "${CH_NEW}"
leaderboard
expect_tally "A:1:5/3/1:true,D:2:2/0/0:true,B:3:1/3/2:true,C:4:1/1/3:true" "a removed challenge's trophies leave"
pass "rescoring: add, edit and remove after the cutoff, and the leaderboard with them"

# --- the Meets leaderboard ------------------------------------------------------------

# After Refresh: 1RM A B C D · Weight A B C D · reps D C A=B · Volume D A C B ·
# press Weight B A · Plank C A B · pull-up reps A B · pull-up Weight A · Squat A.
leaderboard
expect_ok "leaderboard"
expect_tally "A:1:5/3/1:true,D:2:2/0/0:true,B:3:1/3/2:true,C:4:1/1/3:true" "medal tally across final meets"
check "the leaderboard holds counts only" 'all(.rows[]; (keys | sort) == ["bronze","current_member","gold","member","rank","silver"])'
trophies() {
  rpc "${A_TOKEN}" group_meet_trophies "$(jq -nc --arg g "${GID}" --arg u "$1" --argjson l "$2" --arg c "${3:-}" \
    '{p_group_id:$g, p_member_user_id:$u, p_limit:$l, p_before:(if $c == "" then null else $c end)}')"
  expect_ok "trophies"
}
trophies "${D_UID}" 20
check "a member's trophies link their meets and challenges" \
  '([.trophies[] | [.meet_id, .place, .metric, .exercise_name]] | sort) == [[$m, 1, "reps", "Bench"], [$m, 1, "volume", "Bench"]]
   and .next_cursor == null' --arg m "${MEET}"
trophies "${A_UID}" 20
ALL_A="$(jq -c '[.trophies[] | .challenge_id]' <<<"${BODY}")"
[[ "$(jq 'length' <<<"${ALL_A}")" == 9 ]] || fail "A holds nine trophies: ${ALL_A}"
PAGED="[]"
trophies "${A_UID}" 4
while :; do
  PAGED="$(jq -c --argjson acc "${PAGED}" '$acc + [.trophies[] | .challenge_id]' <<<"${BODY}")"
  CURSOR="$(jq -r '.next_cursor // empty' <<<"${BODY}")"
  [[ -n "${CURSOR}" ]] || break
  trophies "${A_UID}" 4 "${CURSOR}"
done
[[ "${PAGED}" == "${ALL_A}" ]] || fail "trophy pages of 4 give the same trophies as one page: ${PAGED} vs ${ALL_A}"
rpc "${A_TOKEN}" group_meet_trophies "$(jq -nc --arg g "${GID}" --arg u "${A_UID}" '{p_group_id:$g, p_member_user_id:$u, p_before:"{}"}')"
expect_error VALIDATION "a malformed trophy cursor"
rpc "${A_TOKEN}" group_meet_trophies "$(jq -nc --arg g "${GID}" --arg u "${A_UID}" --arg c "${CURSOR:-}" \
  '{p_group_id:$g, p_member_user_id:$u, p_before:("{\"group_id\":\"" + $g + "\",\"member_user_id\":\"" + $u + "\",\"starts_at_ms\":1,\"meet_id\":\"x\",\"challenge_id\":\"y\"}")}')"
expect_error VALIDATION "a trophy cursor with bad ids"

# A former member keeps their trophies, marked.
rpc "${D_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
expect_ok "D leaves the group"
leaderboard
expect_tally "A:1:5/3/1:true,D:2:2/0/0:false,B:3:1/3/2:true,C:4:1/1/3:true" "a former member is kept and marked"
results "${A_TOKEN}" "${MEET}"
check "final standings mark a former member" \
  '[.challenges[] | .standings[] | select(.member.user_id == $d) | .current_member] | all(. == false) and length == 4' --arg d "${D_UID}"
pass "leaderboard: medals across final meets, ties, trophies, former members"

# --- reads and access ------------------------------------------------------------

trophies_body="$(jq -nc --arg g "${GID}" --arg u "${A_UID}" '{p_group_id:$g, p_member_user_id:$u}')"
rpc "${OUTSIDER_TOKEN}" group_meet_trophies "${trophies_body}"; expect_error NOT_FOUND "trophies: a non-member"
rpc "${ANON_KEY}" group_meet_trophies "${trophies_body}"; expect_error AUTH_REQUIRED "trophies: anon"
for fn in group_meet_results group_meet_refresh_results; do
  rpc "${OUTSIDER_TOKEN}" "${fn}" "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
  expect_error NOT_FOUND "${fn}: a non-member"
  rpc "${ANON_KEY}" "${fn}" "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
  expect_error AUTH_REQUIRED "${fn}: anon"
  rpc_no_hold "${A_TOKEN}" "${fn}" "$(jq -nc --arg g "${GID}" --arg m "${MEET}" '{p_group_id:$g,p_meet_id:$m}')"
  expect_error UPDATE_REQUIRED "${fn}: a client without Hold support"
done
leaderboard "${OUTSIDER_TOKEN}"; expect_error NOT_FOUND "leaderboard: a non-member"
leaderboard "${ANON_KEY}"; expect_error AUTH_REQUIRED "leaderboard: anon"
rpc "${A_TOKEN}" group_meet_eval_advance '{}'
[[ "${STATUS}" != 200 ]] || fail "the worker's entry point is not client-executable"
expect_sql "the worker's entry point refuses an OAuth agent's claims" \
  "do \$\$ begin
     perform set_config('request.jwt.claims', json_build_object('sub', '${A_UID}', 'client_id', 'probe')::text, true);
     perform app_public.group_meet_eval_advance();
     raise exception 'not refused';
   exception when others then
     if sqlerrm not like 'AGENT_FORBIDDEN:%' then raise; end if;
   end \$\$; select 'refused';" refused
expect_sql "snapshot tables are closed to clients" \
  "select count(*) from information_schema.role_table_grants where table_schema = 'app_public'
     and table_name like 'group_meet_s%' and grantee in ('anon','authenticated','service_role');" 0

# kg disclosure. With bodyweight calculations on, Pull-up counts bodyweight:
# its stored kg Weight is hidden on the final read, places kept, raw weight
# hidden; live, its normalized Weight shows as %BW without the raw kg.
rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${GID}" --arg n "Meet scoring ${RUN_TAG}" \
  '{p_group_id:$g,p_name:$n,p_description:null,p_bodyweight_calculations_enabled:true}')"
expect_ok "bodyweight calculations on"
next_cuam
push "${A_TOKEN}" "A's reading" "$(e_reading "${T}-a-reading" "$((S - 30 * HOUR))" 80 "${CUAM}")"
drain "bodyweight calculations on"
results "${A_TOKEN}" "${MEET}"
check "final: a kg score on an exercise that now counts bodyweight is hidden, its place kept" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[]
     | [.place, .value, .unit, .unavailable, .set.weight_value]] == [[1, null, "kg", true, null]]' --arg c "${CH_PULL_WEIGHT}"
check "final: reps stay public, the raw weight does not" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | [.value, .unavailable, .set.weight_value]]
     == [[12, false, null], [10, false, null]]' --arg c "${CH_PULL}"
check "final: other exercises keep their kg" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | .unavailable] | all(. == false)' --arg c "${CH_E1RM}"
# D moves the snapshotted Bench set onto their Pull-up, which counts
# bodyweight: the set's current exercise hides its kg too, place kept.
next_cuam
push "${D_TOKEN}" "D's bench block moved onto the pull-up" \
  "$(e_se "${D_MAIN}-bench" "${D_MAIN}" "${T}-D-pull" 0 Pull-up "${CUAM}")"
drain "the moved set"
results "${A_TOKEN}" "${MEET}"
check "final: a set moved onto an exercise that counts bodyweight hides its kg, place kept" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | select(.member.user_id == $d)
     | [.place, .value, .unavailable, .set.weight_value]] == [[4, null, true, null]]' --arg c "${CH_E1RM}" --arg d "${D_UID}"
check "final: record figures follow the same rule" \
  '[.records[] | select(.group_exercise_id == $x) | .boards[] | select(.unit == "kg" or .unit == "kg_reps") | .value] | all(. == null)' \
  --arg x "${PULL}"

PULL_LIVE="$(new_meet "$((NOW - 2 * HOUR))" "$((NOW + HOUR))")"
CH_LIVE_PULL="$(challenge "${PULL_LIVE}" "${PULL}" weight)"
A_LIVE="${T}-a-live"
next_cuam
workout A "${A_LIVE}" "$((NOW - HOUR))" \
  "$(se "${A_LIVE}" pull A 0)" "$(e_set "${A_LIVE}-pull-1" "${A_LIVE}-pull" 0 10 8 '' "${CUAM}" null rir_0)"
link_meet "${A_TOKEN}" "${PULL_LIVE}" "${A_LIVE}"
drain "a live pull-up"
results "${A_TOKEN}" "${PULL_LIVE}"
# 100 × (10 + 80) × 8 / 80 per rep, minus the 100% bodyweight part: 12.5 %BW.
check "live: normalized Weight is the added load %BW, without the raw kg" \
  '[.challenges[] | select(.challenge.challenge_id == $c) | .standings[] | [.value, .unit, .unavailable, .set.weight_value]]
     == [[12.5, "percent_bw", false, null]]' --arg c "${CH_LIVE_PULL}"
pass "access: outsiders, anon, old clients and clients denied; kg disclosure on live and final reads"

# --- deletion ------------------------------------------------------------------

# Account deletion removes the member's snapshot rows and trophies and reranks.
run_psql "delete from auth.users where id = '${C_UID}';" >/dev/null
expect_sql "C's snapshot rows and standings are gone" \
  "select (select count(*) from app_public.group_meet_snapshot_sets where member_user_id = '${C_UID}')
     + (select count(*) from app_public.group_meet_snapshot_sessions where member_user_id = '${C_UID}')
     + (select count(*) from app_public.group_meet_standings where member_user_id = '${C_UID}');" 0
results "${A_TOKEN}" "${MEET}"
expect_places "${CH_PLANK}" "A=1,B=2" "the remaining members rerank"
expect_places "${CH_E1RM}" "A=1,B=2,D=3" "a deleted member's place is freed"
leaderboard
# Now 1RM A B D · Weight A B D · reps D A=B · Volume D A B · press Weight B A ·
# Plank A B · pull-up reps A B · pull-up Weight A · Squat A.
expect_tally "A:1:6/3/0:true,D:2:2/0/2:false,B:3:1/5/1:true" "the leaderboard after an account deletion"

# dev_wipe_my_data removes B's the same way.
run_psql "begin;
  select set_config('app.env', 'local', true);
  select set_config('request.jwt.claims', json_build_object('sub', '${B_UID}', 'role', 'authenticated')::text, true);
  select app_public.dev_wipe_my_data();
  commit;" >/dev/null
expect_sql "B's snapshot rows and standings are gone" \
  "select (select count(*) from app_public.group_meet_snapshot_sets where member_user_id = '${B_UID}')
     + (select count(*) from app_public.group_meet_standings where member_user_id = '${B_UID}');" 0
results "${A_TOKEN}" "${MEET}"
expect_places "${CH_PRESS}" "A=1" "a wiped member's places are freed"

# Removing A's five sole golds leaves A and D on 2/2/0: an equal tuple shares
# a rank, ordered by name then ID.
for ch in "${CH_PRESS}" "${CH_PLANK}" "${CH_PULL}" "${CH_PULL_WEIGHT}" "${CH_SQUAT}"; do
  rpc "${A_TOKEN}" group_meet_challenge_remove "$(jq -nc --arg g "${GID}" --arg m "${MEET}" --arg c "${ch}" \
    '{p_group_id:$g,p_meet_id:$m,p_challenge_id:$c,p_expected_version:1}')"
  expect_ok "remove challenge ${ch}"
done
leaderboard
expect_tally "A:1:2/2/0:true,D:1:2/2/0:false" "an equal tuple shares a rank, ordered by name"
expect_sql "the tallies equal the standings' places 1-3" \
  "select count(*) from app_public.group_meet_trophy_tallies t full join (
     select st.group_id, st.member_user_id, count(*) filter (where place = 1) g, count(*) filter (where place = 2) s,
       count(*) filter (where place = 3) b from app_public.group_meet_standings st where st.place <= 3
       group by st.group_id, st.member_user_id) x using (group_id, member_user_id)
   where (t.group_id = '${GID}' or x.group_id = '${GID}')
     and (coalesce(t.gold, 0), coalesce(t.silver, 0), coalesce(t.bronze, 0)) is distinct from (coalesce(x.g, 0), coalesce(x.s, 0), coalesce(x.b, 0));" 0
pass "deletion: account deletion and dev_wipe_my_data remove snapshot rows and trophies"

COMPLETED=1
echo "[${LANE_LABEL}] PASS"
