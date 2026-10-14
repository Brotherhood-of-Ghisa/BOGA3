#!/usr/bin/env bash
# Real sync intake, exact graph proof, atomic competition publication and encrypted local-sink lifecycle.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL=notification-workout-events
FIXTURE_EMAIL_PREFIX=notification-workouts
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"
fail() { echo "[${LANE_LABEL}] FAIL: $* (HTTP ${STATUS})" >&2; exit 1; }
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"
RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="WorkoutContract!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
GROUP_IDS=()
RACE_DIR=""
HOLDER_PID=""
HANDOFF_PID=""
psql_session_start
EPOCH_AT="$(run_psql 'select started_at from app_public.notification_workout_epoch;')"
KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'),'');")"
SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname='group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
cleanup() {
  if [[ -n "${HOLDER_PID}" ]]; then
    printf 'rollback;\n\\q\n' >&9 || true
    exec 9>&- 10<&-
    wait "${HOLDER_PID}" || true
  fi
  [[ -z "${HANDOFF_PID}" ]] || wait "${HANDOFF_PID}" || true
  [[ -z "${RACE_DIR}" ]] || rm -rf "${RACE_DIR}"
  run_psql_once "alter table app_public.notification_workout_targets drop constraint if exists notification_test_capture;
    alter table app_public.notification_workout_moments drop constraint if exists notification_test_intake;
    alter table app_public.group_session_shares drop constraint if exists notification_test_share;
    alter table app_public.group_eval_queue drop constraint if exists notification_test_disclosure;
    update app_public.notification_workout_epoch set started_at='${EPOCH_AT}';
    select app_public.group_eval_set_url('${KICK_URL}');
    select cron.alter_job(jobid,active:=${SWEEP_ACTIVE}) from cron.job where jobname='group-eval-sweep';
    delete from app_public.notification_config;" >/dev/null
  for gid in "${GROUP_IDS[@]}"; do run_psql_once "delete from app_public.groups where id='${gid}';" >/dev/null; done
  for uid in "${RUN_USER_IDS[@]}"; do run_psql_once "delete from public.app_logs where user_id='${uid}'; delete from auth.users where id='${uid}';" >/dev/null; done
  psql_session_stop
}
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then status=1; fi
  if ! cleanup; then status=1; fi
  exit "${status}"
}
trap cleanup_on_exit EXIT
assert_sql() { [[ "$(run_psql "$2")" == t ]] || fail "$1"; }
manifest() { run_psql "select app_public.notification_source_manifest('$1','$2');"; }
confirm() {
  rpc "$1" notification_confirm_completion "$(jq -nc --arg s "$2" --argjson e "$3" '{p_session_id:$s,p_entities:$e}')"
  expect_ok 'completion confirmation'
}
bounded_rpc() {
  http_call --max-time 12 -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $1" \
    -H "${GROUP_CONTRACT_HEADER}" -H 'x-boga-sync-protocol: 4' -H 'Content-Type: application/json' \
    -H 'Content-Profile: app_public' --data "$3" "${API_URL}/rest/v1/rpc/$2"
}
drain_eval() { eval_drain; expect_ok 'comparison evaluator'; }
drain_worker() {
  http_call -X POST -H "apikey: ${SERVICE_ROLE_KEY}" -H 'Content-Type: application/json' --data '{}' "${API_URL}/functions/v1/notification-worker"
  expect_ok 'local notification worker'
}
prepare_outcome() {
  rpc "${SERVICE_ROLE_KEY}" notification_workout_prepare '{"p_limit":20}'; expect_ok 'prepare source outcomes'
  check 'worker jobs omit private baseline scores' '[..|objects|(has("baseline_scores") or has("baselineScores"))]|any|not'
  TARGETS="$(jq --arg u "$1" --arg s "$2" '.jobs[]|select(.member_user_id==$u and .session_id==$s)' <<<"${BODY}")"
  [[ -n "${TARGETS}" ]] || fail 'ready workout missing from prepare'
  COUNTS="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    const { workoutContributions } = await import(process.argv[2]);
    const job=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(workoutContributions(job.targets,job.member_user_id)));
  ' "${TARGETS}" "${SUPABASE_DIR}/../apps/mobile/src/notifications/workout-events.ts")"
  GEN="$(jq -r '.generation' <<<"${TARGETS}")"
}
enqueue_outcome() {
  rpc "${SERVICE_ROLE_KEY}" notification_workout_enqueue "$(jq -nc --arg m "$1" --arg s "$2" --argjson g "${GEN}" --argjson c "${COUNTS}" \
    '{p_member:$m,p_session:$s,p_generation:$g,p_contributions:$c}')"
  expect_ok 'enqueue final counts'; [[ "${BODY}" == true ]] || fail 'ready generation rejected'
}
run_psql "select app_public.group_eval_set_url('');
  select cron.alter_job(jobid,active:=false) from cron.job where jobname='group-eval-sweep';
  update app_public.notification_workout_epoch set started_at=now()-interval '2 hours';" >/dev/null
provision A recipient
provision B lifter
provision C leader
provision D middle
for label in A B C D; do uid_var="${label}_UID"; set_username "${!uid_var}" "Member${label}"; done
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
CUAM="${NOW_MS}"
G1=""; G2=""; X1=""; X2=""
for number in 1 2; do
  rpc "${A_TOKEN}" group_create "{\"p_name\":\"Workout group ${number}\",\"p_description\":\"\"}"; expect_ok 'create overlap group'
  gid="$(jq -r '.group_id' <<<"${BODY}")"; GROUP_IDS+=("${gid}")
  run_psql "insert into app_public.group_memberships(group_id,user_id,role,joined_at) values
    ('${gid}','${B_UID}','member',now()-interval '3 days'),('${gid}','${C_UID}','member',now()-interval '3 days'),
    ('${gid}','${D_UID}','member',now()-interval '3 days');" >/dev/null
  rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${gid}" \
    '{p_group_id:$g,p_name:"Bench",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
  expect_ok 'create comparison'; exercise="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
  if [[ ${number} == 1 ]]; then G1="${gid}"; X1="${exercise}"; else G2="${gid}"; X2="${exercise}"; fi
done
for label in B C D; do
  token_var="${label}_TOKEN"; uid_var="${label}_UID"; uid="${!uid_var}"
  def="def-${label}-${RUN_TAG}"; session="baseline-${label}-${RUN_TAG}"; block="block-${label}-${RUN_TAG}"; set_id="set-${label}-${RUN_TAG}"
  case "${label}" in B) weight=100;; C) weight=200;; D) weight=120;; esac
  next_cuam
  push "${!token_var}" 'shared baseline graph' "$(e_def "${def}" Bench "${CUAM}")" \
    "$(e_link "${def}" "${G1}" "${X1}" "${CUAM}")" "$(e_link "${def}" "${G2}" "${X2}" "${CUAM}")" \
    "$(e_session "${session}" "$((NOW_MS-18000000))" completed "$((NOW_MS-14400000))" 3600 null "${CUAM}")" \
    "$(e_se "${block}" "${session}" "${def}" 0 Bench "${CUAM}")" "$(e_set "${set_id}" "${block}" 0 "${weight}" 1 '' "${CUAM}")"
done
drain_eval
assert_sql 'pre-cutover completed history never replays' "select not exists(select 1 from app_public.notification_intents
  where lifter_user_id in('${B_UID}','${C_UID}','${D_UID}') and session_id like 'baseline-%-${RUN_TAG}');"
run_psql "insert into app_public.notification_config(environment,project_id,bundle_id,sending_enabled,provider)
  values('local','3c00cd23-0946-4eb6-bbf0-4542879cd314','com.phano.boga3.dev',false,'local');" >/dev/null
INSTALL_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
CAPABILITY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
rpc "${A_TOKEN}" notification_register "$(jq -nc --arg i "${INSTALL_ID}" --arg c "${CAPABILITY}" --arg k "${KEY}" \
  '{p_installation_id:$i,p_capability:$c,p_encryption_key:$k,p_token:"LocalPushToken[ok]",p_environment:"local",
    p_project_id:"3c00cd23-0946-4eb6-bbf0-4542879cd314",p_bundle_id:"com.phano.boga3.dev",p_permission:true,p_opted_in:true}')"
expect_ok 'register local recipient'
SESSION="fresh-${RUN_TAG}"; BLOCK="fresh-block-${RUN_TAG}"; SET="fresh-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'active session' "$(e_session "${SESSION}" "${NOW_MS}" active null null null "${CUAM}")"
run_psql 'select app_public.notification_recover_workouts(20);' >/dev/null
assert_sql 'overlap creates one recipient start and excludes lifter' "select count(*)=1 from app_public.notification_intents
  where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${SESSION}' and kind='start';"
run_psql 'update app_public.notification_config set sending_enabled=true;' >/dev/null
drain_worker
assert_sql 'sink accepts one start' "select count(*)=1 from app_public.notification_deliveries d join app_public.notification_intents n on n.id=d.intent_id
  where n.recipient_user_id='${A_UID}' and n.session_id='${SESSION}' and n.kind='start' and d.state='ticket';"
# Intake and an asynchronous capture fault both leave accepted private sync committed.
run_psql "alter table app_public.notification_workout_targets add constraint notification_test_capture
  check(session_id<>'${SESSION}' or group_exercise_id<>'${X1}') not valid;" >/dev/null
next_cuam
push "${B_TOKEN}" 'performed graph' "$(e_se "${BLOCK}" "${SESSION}" "def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${SET}" "${BLOCK}" 0 150 1 '' "${CUAM}")"
drain_eval
assert_sql 'capture fault preserves pre-publication board' "select value=100 from app_public.group_metric_board_entries
  where group_exercise_id='${X1}' and member_user_id='${B_UID}' and metric='e1rm' and not certified;"
run_psql "alter table app_public.notification_workout_targets drop constraint notification_test_capture;
  update app_public.group_metric_eval_queue set available_at=now(),claimed_until=null,claim_id=null where group_exercise_id='${X1}';" >/dev/null
drain_eval
assert_sql 'publication retries without losing actual before ranks' "select before_ranks@>jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,
  'member_user_id','${B_UID}'::uuid,'rank',3)) from app_public.notification_workout_targets where member_user_id='${B_UID}'
  and session_id='${SESSION}' and group_exercise_id='${X1}';"
next_cuam
push "${B_TOKEN}" 'complete before confirmation' "$(e_session "${SESSION}" "${NOW_MS}" completed "$((NOW_MS+60000))" 60 null "${CUAM}")"
drain_worker
assert_sql 'legacy/unconfirmed writer creates no completion' "select not exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and session_id='${SESSION}' and kind='completion');"
MANIFEST="$(manifest "${B_UID}" "${SESSION}")"
AGENT="$(mint_token "${B_TOKEN}" notification-completion-probe)"
for token in "${ANON_KEY}" "${AGENT}"; do
  rpc "${token}" notification_confirm_completion "$(jq -nc --arg s "${SESSION}" --argjson e "${MANIFEST}" '{p_session_id:$s,p_entities:$e}')"
  if [[ "${token}" == "${ANON_KEY}" ]]; then expect_error AUTH_REQUIRED 'anonymous confirmation'; else expect_error AGENT_FORBIDDEN 'OAuth confirmation'; fi
done
rpc "${A_TOKEN}" notification_confirm_completion "$(jq -nc --arg s "${SESSION}" --argjson e "${MANIFEST}" '{p_session_id:$s,p_entities:$e}')"
expect_error NOT_FOUND 'cross-account confirmation'
for malformed in '{}' "$(jq '.+[.[0]]' <<<"${MANIFEST}")" "$(jq '.[0].fields=[]' <<<"${MANIFEST}")"; do
  rpc "${B_TOKEN}" notification_confirm_completion "$(jq -nc --arg s "${SESSION}" --argjson e "${malformed}" '{p_session_id:$s,p_entities:$e}')"
  expect_error VALIDATION 'malformed completion graph'
done
for bad in "$(jq 'map(select(.type!="exercise_sets"))' <<<"${MANIFEST}")" \
    "$(jq 'map(if .type=="exercise_sets" then .fields.weight_value="999" else . end)' <<<"${MANIFEST}")" \
    "$(jq '.[0].id="extra-row"' <<<"${MANIFEST}")"; do
  confirm "${B_TOKEN}" "${SESSION}" "${bad}"; check 'inexact graph remains pending' '.confirmed==false'
done
confirm "${B_TOKEN}" "${SESSION}" "${MANIFEST}"; check 'exact graph confirmed' '.confirmed==true'
assert_sql 'pending evaluator is not zero achievements' "select not app_public.notification_workout_ready('${B_UID}','${SESSION}');"
drain_eval
assert_sql 'matching publications ready' "select app_public.notification_workout_ready('${B_UID}','${SESSION}');"
# Presentation-only comparison changes do not strand the scoring fence.
run_psql "update app_public.group_exercises set name='Renamed bench',default_metric='volume' where id='${X1}';
  update app_public.groups set name='Current group name' where id='${G1}';" >/dev/null
assert_sql 'name/default-tab metadata preserves readiness' "select app_public.notification_workout_ready('${B_UID}','${SESSION}');"
# Claim first, then mutate a descendant: preparation must defer, never permanently cancel or send stale counts.
prepare_outcome "${B_UID}" "${SESSION}"
enqueue_outcome "${B_UID}" "${SESSION}"
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok 'claim summary'
JOB="$(jq '.jobs[0]' <<<"${BODY}")"
next_cuam
push "${B_TOKEN}" 'late set invalidates seal' "$(e_set "${SET}" "${BLOCK}" 0 151 1 '' "${CUAM}")"
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${JOB}")"
expect_ok 'deferred summary'; [[ "${BODY}" == null ]] || fail 'changed graph reached provider handoff'
assert_sql 'unready summary retries rather than cancelling' "select state='retry' from app_public.notification_deliveries where id=$(jq -r '.id' <<<"${JOB}");"
confirm "${B_TOKEN}" "${SESSION}" "$(manifest "${B_UID}" "${SESSION}")"; check 'late graph reconfirmed' '.confirmed==true'
drain_eval
drain_worker
assert_sql 'one accepted completion across overlapping groups' "select count(*)=1 from app_public.notification_deliveries d join app_public.notification_intents n on n.id=d.intent_id
  where n.recipient_user_id='${A_UID}' and n.session_id='${SESSION}' and n.kind='completion' and d.state='ticket';"
INTENT="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${SESSION}' and kind='completion';")"
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${INTENT}}"; expect_ok 'narrow authorized projection'
check 'below-first own bests and both-metric full-rank movement' '.bestCount==4 and .rankCount==8 and (.identity|contains("2 groups"))'
check 'no privileged source fields or extra section route' 'has("weight_value")|not'
rpc "${A_TOKEN}" notification_group_mute "{\"p_group_id\":\"${G2}\",\"p_muted\":true}"; expect_ok 'mute overlap group'
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${INTENT}}"; expect_ok 'muted projection'
check 'one group contributes without silencing the other' '.bestCount==2 and .rankCount==4 and .identity=="MemberB · Current group name"'
# A completed upload skips start. Its historical rank returns after another workout, so its net movement is zero.
run_psql 'update app_public.notification_config set sending_enabled=false;' >/dev/null
next_cuam
push "${D_TOKEN}" 'prepare third-place baseline' "$(e_set "set-D-${RUN_TAG}" "block-D-${RUN_TAG}" 0 180 1 '' "${CUAM}")"
drain_eval
OFFLINE="offline-${RUN_TAG}"; OFFLINE_BLOCK="offline-block-${RUN_TAG}"; OFFLINE_SET="offline-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'completed first upload' \
  "$(e_session "${OFFLINE}" "$((NOW_MS+70000))" completed "$((NOW_MS+80000))" 10 null "${CUAM}")" \
  "$(e_se "${OFFLINE_BLOCK}" "${OFFLINE}" "def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${OFFLINE_SET}" "${OFFLINE_BLOCK}" 0 190 1 '' "${CUAM}")"
confirm "${B_TOKEN}" "${OFFLINE}" "$(manifest "${B_UID}" "${OFFLINE}")"; check 'offline graph confirmed' '.confirmed==true'
drain_eval
assert_sql 'offline lifter reaches second place' "select value=190 from app_public.group_metric_board_entries
  where group_exercise_id='${X1}' and member_user_id='${B_UID}' and metric='e1rm' and not certified;"
next_cuam
push "${D_TOKEN}" 'peer workout returns original rank' \
  "$(e_session "peer-${RUN_TAG}" "$((NOW_MS+90000))" completed "$((NOW_MS+100000))" 10 null "${CUAM}")" \
  "$(e_se "peer-block-${RUN_TAG}" "peer-${RUN_TAG}" "def-D-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "peer-set-${RUN_TAG}" "peer-block-${RUN_TAG}" 0 195 1 '' "${CUAM}")"
drain_eval
prepare_outcome "${B_UID}" "${OFFLINE}"
jq -e 'length==2 and all(.[];.best_count==2 and .rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'returned ranks counted intermediate hops'
enqueue_outcome "${B_UID}" "${OFFLINE}"
enqueue_outcome "${B_UID}" "${OFFLINE}"
assert_sql 'completed first upload has exactly one completion and no start' "select count(*)=1 and bool_and(kind='completion')
  from app_public.notification_intents where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${OFFLINE}';"
OFFLINE_DEADLINE="$(run_psql "select expires_at from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${OFFLINE}';")"
next_cuam
push "${B_TOKEN}" 'reopen same workout' "$(e_session "${OFFLINE}" "$((NOW_MS+70000))" active null null null "${CUAM}")"
run_psql 'select app_public.notification_recover_workouts(20);' >/dev/null
next_cuam
push "${B_TOKEN}" 'complete reopened workout' "$(e_session "${OFFLINE}" "$((NOW_MS+70000))" completed "$((NOW_MS+110000))" 40 null "${CUAM}")"
confirm "${B_TOKEN}" "${OFFLINE}" "$(manifest "${B_UID}" "${OFFLINE}")"; check 'reopened graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${OFFLINE}"; enqueue_outcome "${B_UID}" "${OFFLINE}"
assert_sql 'recompletion preserves the logical identity and original expiry' "select count(*)=1 and bool_and(expires_at='${OFFLINE_DEADLINE}'::timestamptz)
  and bool_and(kind='completion') from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${OFFLINE}';"
OFFLINE_BEFORE="$(run_psql "select jsonb_agg(jsonb_build_object('target',group_exercise_id,'before',before_ranks) order by group_exercise_id)
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${OFFLINE}';")"
next_cuam
push "${B_TOKEN}" 'delete completed workout' "$(e_session "${OFFLINE}" "$((NOW_MS+70000))" completed "$((NOW_MS+110000))" 40 "${NOW_MS}" "${CUAM}")"
drain_eval
run_psql 'select app_public.notification_prune();' >/dev/null
assert_sql 'deletion prune preserves the historical comparison baseline' "select jsonb_agg(jsonb_build_object('target',group_exercise_id,'before',before_ranks)
  order by group_exercise_id)='${OFFLINE_BEFORE}'::jsonb from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${OFFLINE}';"
next_cuam
push "${B_TOKEN}" 'restore deleted workout' "$(e_session "${OFFLINE}" "$((NOW_MS+70000))" completed "$((NOW_MS+110000))" 40 null "${CUAM}")"
confirm "${B_TOKEN}" "${OFFLINE}" "$(manifest "${B_UID}" "${OFFLINE}")"; check 'restored graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${OFFLINE}"
jq -e 'length==2 and all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'restoring deleted source lost its original rank baseline'
assert_sql 'restored targets keep actual historical before ranks' "select jsonb_agg(jsonb_build_object('target',group_exercise_id,'before',before_ranks)
  order by group_exercise_id)='${OFFLINE_BEFORE}'::jsonb from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${OFFLINE}';"
run_psql "update app_public.notification_workouts set completion_at=now()-interval '24 hours' where member_user_id='${B_UID}' and session_id='${OFFLINE}';
  select app_public.notification_prune();" >/dev/null
assert_sql 'expired producer retains only its no-replay identity' "select not eligible and manifest_digest is null and context_digest is null
  and not exists(select 1 from app_public.notification_workout_targets t where t.member_user_id=w.member_user_id and t.session_id=w.session_id)
  from app_public.notification_workouts w where member_user_id='${B_UID}' and session_id='${OFFLINE}';"
# First publication is silent in the activity feed, but a fresh own best below first place still contributes.
rpc "${A_TOKEN}" group_create '{"p_name":"Cold publication","p_description":""}'; expect_ok 'create cold group'
COLD_GROUP="$(jq -r '.group_id' <<<"${BODY}")"; GROUP_IDS+=("${COLD_GROUP}")
run_psql "insert into app_public.group_memberships(group_id,user_id,role,joined_at) values
  ('${COLD_GROUP}','${B_UID}','member',now()-interval '3 days'),('${COLD_GROUP}','${C_UID}','member',now()-interval '3 days');" >/dev/null
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${COLD_GROUP}" \
  '{p_group_id:$g,p_name:"Cold bench",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create comparison'; COLD_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
for label in B C; do
  token_var="${label}_TOKEN"; next_cuam
  push "${!token_var}" 'cold link' "$(e_def "cold-def-${label}-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "cold-def-${label}-${RUN_TAG}" "${COLD_GROUP}" "${COLD_EXERCISE}" "${CUAM}")"
done
next_cuam
push "${C_TOKEN}" 'cold leader history' \
  "$(e_session "cold-leader-${RUN_TAG}" "$((NOW_MS-18000000))" completed "$((NOW_MS-14400000))" 3600 null "${CUAM}")" \
  "$(e_se "cold-leader-block-${RUN_TAG}" "cold-leader-${RUN_TAG}" "cold-def-C-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "cold-leader-set-${RUN_TAG}" "cold-leader-block-${RUN_TAG}" 0 200 1 '' "${CUAM}")"
COLD_OLD_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${COLD_EXERCISE}';")"
rpc "${A_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${COLD_GROUP}" --arg x "${COLD_EXERCISE}" --argjson r "${COLD_OLD_REV}" \
  '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:$r,p_name:"Cold bench",p_load_input_mode:"per_side_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create unpublished rebuilt revision'
assert_sql 'rebuilt revision has not been published' "select r.published_at is null from app_public.group_rule_revisions r
  join app_public.group_exercises x on x.id=r.group_exercise_id and x.rules_revision=r.revision where x.id='${COLD_EXERCISE}';"
COLD_SESSION="cold-fresh-${RUN_TAG}"; COLD_BLOCK="cold-fresh-block-${RUN_TAG}"; COLD_SET="cold-fresh-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'cold fresh own best' \
  "$(e_session "${COLD_SESSION}" "$((NOW_MS+120000))" active null null null "${CUAM}")" \
  "$(e_se "${COLD_BLOCK}" "${COLD_SESSION}" "cold-def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${COLD_SET}" "${COLD_BLOCK}" 0 150 1 '' "${CUAM}")"
run_psql 'select app_public.notification_recover_workouts(20);' >/dev/null
next_cuam
push "${B_TOKEN}" 'complete before rebuilt revision publishes' \
  "$(e_session "${COLD_SESSION}" "$((NOW_MS+120000))" completed "$((NOW_MS+130000))" 10 null "${CUAM}")"
confirm "${B_TOKEN}" "${COLD_SESSION}" "$(manifest "${B_UID}" "${COLD_SESSION}")"; check 'cold graph confirmed' '.confirmed==true'
drain_eval
assert_sql 'cold board own best is below first without a record event' "select value=75 and not exists(select 1 from app_public.group_events
  where group_exercise_id='${COLD_EXERCISE}' and member_user_id='${B_UID}' and session_id='${COLD_SESSION}' and kind='record')
  from app_public.group_metric_board_entries where group_exercise_id='${COLD_EXERCISE}' and member_user_id='${B_UID}' and metric='e1rm' and not certified;"
prepare_outcome "${B_UID}" "${COLD_SESSION}"
jq -e --arg g "${COLD_GROUP}" 'map(select(.group_id==$g))==[{group_id:$g,best_count:2,rank_count:2}]' <<<"${COUNTS}" >/dev/null || fail 'cold own best was omitted'
enqueue_outcome "${B_UID}" "${COLD_SESSION}"
# A label autosave plus correction/control recompute cannot invent performed bests for an unchanged workout.
METADATA="metadata-${RUN_TAG}"; METADATA_BLOCK="metadata-block-${RUN_TAG}"; METADATA_LOSER="metadata-loser-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'workout below current own best' \
  "$(e_session "${METADATA}" "$((NOW_MS+140000))" active null null null "${CUAM}")" \
  "$(e_se "${METADATA_BLOCK}" "${METADATA}" "cold-def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "metadata-set-${RUN_TAG}" "${METADATA_BLOCK}" 0 140 1 '' "${CUAM}")" \
  "$(e_set "${METADATA_LOSER}" "${METADATA_BLOCK}" 1 80 1 '' "${CUAM}")"
drain_eval
assert_sql 'unchanged lower workout has no own best' "select best_metrics='[]'::jsonb from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${METADATA}' and group_exercise_id='${COLD_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'label autosave, losing set edit and historical correction' \
  "$(e_se "${METADATA_BLOCK}" "${METADATA}" "cold-def-B-${RUN_TAG}" 0 'Bench label only' "${CUAM}")" \
  "$(e_set "${METADATA_LOSER}" "${METADATA_BLOCK}" 1 90 1 '' "${CUAM}")" \
  "$(e_set "${COLD_SET}" "${COLD_BLOCK}" 0 130 1 '' "${CUAM}")"
run_psql "select app_public.group_metric_eval_enqueue('${COLD_GROUP}','${COLD_EXERCISE}','certification');" >/dev/null
drain_eval
assert_sql 'unrelated losing-set edit cannot authorize the unchanged winner as a new best' "select best_metrics='[]'::jsonb from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${METADATA}' and group_exercise_id='${COLD_EXERCISE}';"
# Replacing a valid record with identical metric/set/fingerprint is new evidence, not a newly performed workout best.
EVIDENCE_SESSION="evidence-${RUN_TAG}"; EVIDENCE_BLOCK="evidence-block-${RUN_TAG}"; EVIDENCE_SET="evidence-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'performed own-best evidence' \
  "$(e_session "${EVIDENCE_SESSION}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "${EVIDENCE_BLOCK}" "${EVIDENCE_SESSION}" "def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${EVIDENCE_SET}" "${EVIDENCE_BLOCK}" 0 196 1 '' "${CUAM}")"
drain_eval
assert_sql 'real performed improvement retains its concrete evidence' "select best_metrics='[\"e1rm\",\"volume\"]'::jsonb
  and jsonb_array_length(best_evidence)=2 from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${EVIDENCE_SESSION}' and group_exercise_id='${X1}';"
RAW_INPUTS="$(run_psql "select performance_inputs::text from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${EVIDENCE_SESSION}' and group_exercise_id='${X1}';")"
RECORD_ID="$(run_psql "select e.id from app_public.group_events e where e.kind='record' and e.member_user_id='${B_UID}'
  and e.session_id='${EVIDENCE_SESSION}' and e.group_exercise_id='${X1}' and not exists(select 1 from app_public.group_events v
    where v.kind='record_voided' and v.related_event_id=e.id) order by e.seq desc limit 1;")"
[[ "${RECORD_ID}" =~ ${UUID_RE} ]] || fail 'performed own-best record unavailable'
run_psql "insert into app_public.group_events(contract_version,rules_revision,group_id,kind,member_user_id,session_id,set_id,
    group_exercise_id,reason,related_event_id,sort_at_ms,payload)
  select contract_version,rules_revision,group_id,'record_voided',member_user_id,session_id,set_id,group_exercise_id,'edited',id,
    sort_at_ms,jsonb_build_object('performance',payload->'performance','leaders','[]'::jsonb)
    from app_public.group_events where id='${RECORD_ID}';
  insert into app_public.group_events(contract_version,rules_revision,group_id,kind,member_user_id,session_id,set_id,group_exercise_id,sort_at_ms,payload)
  select contract_version,rules_revision,group_id,'record',member_user_id,session_id,set_id,group_exercise_id,sort_at_ms,payload
    from app_public.group_events where id='${RECORD_ID}';
  select app_public.group_metric_eval_enqueue('${G1}','${X1}','certification');" >/dev/null
drain_eval
assert_sql 'replacement evidence with unchanged raw inputs does not retain a new best' "select best_metrics='[]'::jsonb and best_evidence='[]'::jsonb
  and performance_inputs='${RAW_INPUTS}'::jsonb
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${EVIDENCE_SESSION}' and group_exercise_id='${X1}';"
# The actual input clock may clamp; canonical domain contents still confirm exactly.
CLAMP="$(e_session "clamped-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "$((NOW_MS+21600000))" | jq '.fields.source_plan_id=null')"
push "${A_TOKEN}" 'future clock clamp' "${CLAMP}"
confirm "${A_TOKEN}" "clamped-${RUN_TAG}" "$(jq '[{type,id,fields}]' <<<"${CLAMP}")"; check 'clamped clock does not prevent canonical confirmation' '.confirmed==true'
# One accepted installation freezes the logical content; an explicit rejected handoff can still adopt a newer generation.
INSTALL_TWO="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
CAPABILITY_TWO="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
KEY_TWO="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
rpc "${A_TOKEN}" notification_register "$(jq -nc --arg i "${INSTALL_TWO}" --arg c "${CAPABILITY_TWO}" --arg k "${KEY_TWO}" \
  '{p_installation_id:$i,p_capability:$c,p_encryption_key:$k,p_token:"LocalPushToken[second]",p_environment:"local",
    p_project_id:"3c00cd23-0946-4eb6-bbf0-4542879cd314",p_bundle_id:"com.phano.boga3.dev",p_permission:true,p_opted_in:true}')"
expect_ok 'register second local installation'
run_psql 'update app_public.notification_config set sending_enabled=true;' >/dev/null
for outcome in ticket retry; do
  DUAL="dual-${outcome}-${RUN_TAG}"
  next_cuam
  push "${B_TOKEN}" 'two-installation completed graph' "$(e_session "${DUAL}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
  confirm "${B_TOKEN}" "${DUAL}" "$(manifest "${B_UID}" "${DUAL}")"; check 'two-installation graph confirmed' '.confirmed==true'
  drain_eval
  assert_sql 'empty workout ignores unrelated historical comparison state' "select app_public.notification_session_targets('${B_UID}','${DUAL}')='[]'::jsonb
    and app_public.notification_workout_ready('${B_UID}','${DUAL}');"
  prepare_outcome "${B_UID}" "${DUAL}"; enqueue_outcome "${B_UID}" "${DUAL}"
  jq -e '.targets==[]' <<<"${TARGETS}" >/dev/null || fail 'empty workout prepared unrelated comparison targets'
  OLD_GEN="${GEN}"
  DUAL_INTENT="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${DUAL}' and kind='completion';")"
  FIRST_DELIVERY="$(run_psql "select id from app_public.notification_deliveries where intent_id=${DUAL_INTENT} and installation_id='${INSTALL_ID}';")"
  run_psql "update app_public.notification_deliveries set available_at=now()+interval '1 hour'
    where intent_id=${DUAL_INTENT} and installation_id='${INSTALL_TWO}';" >/dev/null
  rpc "${SERVICE_ROLE_KEY}" notification_claim '{"p_limit":20}'; expect_ok 'claim first installation'
  DUAL_JOB="$(jq --argjson id "${FIRST_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
  [[ -n "${DUAL_JOB}" ]] || fail 'first installation not claimed'
  rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${DUAL_JOB}")"
  expect_ok 'first installation provider handoff'; [[ "${BODY}" != null ]] || fail 'ready installation handoff deferred'
  if [[ "${outcome}" == ticket ]]; then
    rpc "${SERVICE_ROLE_KEY}" notification_send_result "$(jq --arg t "local-ticket-${RUN_TAG}" \
      '{p_delivery_id:.id,p_claim_id:.claim_id,p_outcome:"ticket",p_ticket_id:$t}' <<<"${DUAL_JOB}")"
    expect_ok 'accepted first installation'
  fi
  next_cuam
  push "${B_TOKEN}" 'newer two-installation graph' "$(e_session "${DUAL}" "${NOW_MS}" completed "$((NOW_MS+1000))" 2 null "${CUAM}")"
  confirm "${B_TOKEN}" "${DUAL}" "$(manifest "${B_UID}" "${DUAL}")"; check 'newer two-installation graph confirmed' '.confirmed==true'
  drain_eval
  prepare_outcome "${B_UID}" "${DUAL}"
  [[ ${GEN} -gt ${OLD_GEN} ]] || fail 'changed source generation did not advance'
  rpc "${SERVICE_ROLE_KEY}" notification_workout_enqueue "$(jq -nc --arg m "${B_UID}" --arg s "${DUAL}" --argjson g "${GEN}" --argjson c "${COUNTS}" \
    '{p_member:$m,p_session:$s,p_generation:$g,p_contributions:$c}')"; expect_ok 'newer generation result'
  if [[ "${outcome}" == ticket ]]; then
    [[ "${BODY}" == true ]] || fail 'accepted generation failed to settle'
    assert_sql 'accepted content freezes generation and cancels the unsent installation' "select n.generation=${OLD_GEN} and n.workout_generation=${OLD_GEN}
      and exists(select 1 from app_public.notification_deliveries d where d.intent_id=n.id and d.installation_id='${INSTALL_ID}' and d.state='ticket')
      and exists(select 1 from app_public.notification_deliveries d where d.intent_id=n.id and d.installation_id='${INSTALL_TWO}' and d.state='cancelled')
      from app_public.notification_intents n where id=${DUAL_INTENT};"
  else
    [[ "${BODY}" == false ]] || fail 'unresolved handoff incorrectly adopted newer generation'
    assert_sql 'unresolved handoff keeps the producer pending' "select enqueued_generation<generation from app_public.notification_workouts
      where member_user_id='${B_UID}' and session_id='${DUAL}';"
    rpc "${SERVICE_ROLE_KEY}" notification_send_result "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_outcome:"retry",p_code:"RATE_LIMIT"}' <<<"${DUAL_JOB}")"
    expect_ok 'explicit rate-limit rejection'; [[ "${BODY}" == true ]] || fail 'handoff rejection not recorded'
    prepare_outcome "${B_UID}" "${DUAL}"; enqueue_outcome "${B_UID}" "${DUAL}"
    assert_sql 'explicit rejection adopts the newest generation for both installations' "select n.generation=${GEN} and n.workout_generation=${GEN}
      and (select count(*)=2 and bool_and(d.generation=${GEN} and d.state='pending' and d.available_at<=now())
        from app_public.notification_deliveries d where d.intent_id=n.id) from app_public.notification_intents n where id=${DUAL_INTENT};"
  fi
done
run_psql 'update app_public.notification_config set sending_enabled=false;' >/dev/null
# Missing original moments fail closed; a missed share with a valid moment remains repairable.
SEALED_GEN="$(run_psql "select generation from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='dual-retry-${RUN_TAG}';")"
run_psql 'alter table app_public.notification_workout_moments add constraint notification_test_intake check(false) not valid;
  alter table app_public.group_session_shares add constraint notification_test_share check(false) not valid;' >/dev/null
next_cuam
push "${B_TOKEN}" 'failed intake cannot preserve a valid old seal' "$(e_session "dual-retry-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 3 null "${CUAM}")"
assert_sql 'raw graph change cannot keep the old source proof valid' "select generation=${SEALED_GEN} and not app_public.notification_workout_ready(member_user_id,session_id)
  from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='dual-retry-${RUN_TAG}';"
next_cuam
push "${B_TOKEN}" 'fault isolated from private sync' "$(e_session "recovery-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")"
LOST_COMPLETION="lost-completion-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'failed capture of old first completion' \
  "$(e_session "${LOST_COMPLETION}" "$((NOW_MS-90001000))" completed "$((NOW_MS-90000000))" 1 null "${CUAM}")"
run_psql 'alter table app_public.notification_workout_moments drop constraint notification_test_intake;
  alter table app_public.group_session_shares drop constraint notification_test_share;
  select app_public.notification_recover_workouts(20);' >/dev/null
assert_sql 'missing start timing does not manufacture a recovered alert' "select exists(select 1 from app_public.sessions
  where owner_user_id='${B_UID}' and id='recovery-${RUN_TAG}' and status='active') and not exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}');"
next_cuam
push "${B_TOKEN}" 'forfeit missed start on later autosave' "$(e_session "recovery-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")"
assert_sql 'missed start stays an immutable forfeited moment' "select event_at is null from app_public.notification_workout_moments
  where member_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}' and kind='start';"
next_cuam
push "${B_TOKEN}" 'reopen workout whose first completion capture failed' \
  "$(e_session "${LOST_COMPLETION}" "$((NOW_MS-90001000))" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'later completion cannot replace missing original timing' \
  "$(e_session "${LOST_COMPLETION}" "$((NOW_MS-90001000))" completed "$((NOW_MS+1000))" 90002 null "${CUAM}")"
confirm "${B_TOKEN}" "${LOST_COMPLETION}" "$(manifest "${B_UID}" "${LOST_COMPLETION}")"; check 'missing first completion proof rejected' '.confirmed==false'
run_psql 'select app_public.notification_recover_workouts(20);' >/dev/null
assert_sql 'lost first completion never produces a current replay' "select event_at is null
  and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${LOST_COMPLETION}')
  from app_public.notification_workout_moments where member_user_id='${B_UID}' and session_id='${LOST_COMPLETION}' and kind='completion';"
SHARE_RECOVERY="share-recovery-${RUN_TAG}"
run_psql 'alter table app_public.group_session_shares add constraint notification_test_share check(false) not valid;' >/dev/null
next_cuam
push "${B_TOKEN}" 'missed share retains valid start moment' "$(e_session "${SHARE_RECOVERY}" "${NOW_MS}" active null null null "${CUAM}")"
run_psql 'alter table app_public.group_session_shares drop constraint notification_test_share;
  select app_public.notification_recover_workouts(20);' >/dev/null
assert_sql 'missed share alone recovers the captured start identity' "select count(*)=1 from app_public.notification_intents
  where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${SHARE_RECOVERY}' and kind='start';"
confirm "${B_TOKEN}" "dual-retry-${RUN_TAG}" "$(manifest "${B_UID}" "dual-retry-${RUN_TAG}")"; check 'missed intake graph reconfirmed' '.confirmed==true'
drain_eval
assert_sql 'source proof recovers after failed intake' "select app_public.notification_workout_ready('${B_UID}','dual-retry-${RUN_TAG}');"
prepare_outcome "${B_UID}" "dual-retry-${RUN_TAG}"; enqueue_outcome "${B_UID}" "dual-retry-${RUN_TAG}"
# Admission uses the clock after waiting for the group fence, not the transaction-start clock.
run_psql 'update app_public.notification_config set sending_enabled=true;' >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{"p_limit":20}'; expect_ok 'claim lease-expiry probe'
LEASE_JOB="$(jq --argjson id "${FIRST_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
[[ -n "${LEASE_JOB}" ]] || fail 'lease-expiry delivery missing'
RACE_DIR="$(mktemp -d)"
mkfifo "${RACE_DIR}/in" "${RACE_DIR}/out"
docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 \
  <"${RACE_DIR}/in" >"${RACE_DIR}/out" &
HOLDER_PID=$!
exec 9>"${RACE_DIR}/in" 10<"${RACE_DIR}/out"
printf 'begin; select id from app_public.groups where id=\047%s\047 for update;\n\\echo held\n' "${G1}" >&9
while IFS= read -r line <&10; do [[ "${line}" != held ]] || break; done
[[ "${line}" == held ]] || fail 'group fence holder did not acknowledge its lock'
(
  trap - EXIT
  rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${LEASE_JOB}")"
  printf '%s\n%s\n' "${STATUS}" "${BODY}" >"${RACE_DIR}/result"
) &
HANDOFF_PID=$!
BARRIER_DEADLINE=$((SECONDS+8))
while [[ "$(run_psql "select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active'
  and wait_event_type='Lock' and query like '%notification_begin_send%');")" != t ]]; do
  [[ ${SECONDS} -lt ${BARRIER_DEADLINE} ]] || fail 'handoff did not reach held group fence'
done
run_psql "update app_public.notification_deliveries set lease_until=clock_timestamp()+interval '150 milliseconds' where id=${FIRST_DELIVERY};" >/dev/null
while [[ "$(run_psql "select clock_timestamp()>lease_until+interval '100 milliseconds' from app_public.notification_deliveries where id=${FIRST_DELIVERY};")" != t ]]; do
  [[ ${SECONDS} -lt ${BARRIER_DEADLINE} ]] || fail 'claim did not reach expiry boundary'
done
printf 'rollback;\n\\q\n' >&9
exec 9>&- 10<&-
wait "${HOLDER_PID}"; HOLDER_PID=""
wait "${HANDOFF_PID}"; HANDOFF_PID=""
[[ "$(cat "${RACE_DIR}/result")" == $'200\nnull' ]] || fail 'expired claim reached provider after lock wait'
assert_sql 'wait-expired lease never enters sending' "select state<>'sending' from app_public.notification_deliveries where id=${FIRST_DELIVERY};"
rpc "${SERVICE_ROLE_KEY}" notification_claim '{"p_limit":20}'; expect_ok 'reclaim expired probe'
LEASE_JOB="$(jq --argjson id "${FIRST_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
[[ -n "${LEASE_JOB}" ]] || fail 'expired probe not reclaimed'
HANDOFF_START="$(run_psql 'select clock_timestamp();')"
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${LEASE_JOB}")"
expect_ok 'fresh probe handoff'; [[ "${BODY}" != null ]] || fail 'fresh probe unexpectedly rejected'
assert_sql 'fresh provider handoff receives a full lease' "select state='sending' and lease_until>='${HANDOFF_START}'::timestamptz+interval '59 seconds'
  from app_public.notification_deliveries where id=${FIRST_DELIVERY};"
run_psql 'update app_public.notification_config set sending_enabled=false;' >/dev/null
# The proof belongs to the declared graph even when another private row commits while confirmation waits.
RACE_MANIFEST="$(manifest "${B_UID}" "${EVIDENCE_SESSION}")"
rm -rf "${RACE_DIR}"
RACE_DIR="$(mktemp -d)"
mkfifo "${RACE_DIR}/in" "${RACE_DIR}/out"
docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 \
  <"${RACE_DIR}/in" >"${RACE_DIR}/out" &
HOLDER_PID=$!
exec 9>"${RACE_DIR}/in" 10<"${RACE_DIR}/out"
printf 'begin; set local statement_timeout=\0478s\047; select session_id from app_public.notification_workouts where member_user_id=\047%s\047 and session_id=\047%s\047 for update;\n\\echo held\n' \
  "${B_UID}" "${EVIDENCE_SESSION}" >&9
while IFS= read -r line <&10; do [[ "${line}" != held ]] || break; done
[[ "${line}" == held ]] || fail 'source-proof row holder did not acknowledge its lock'
(
  trap - EXIT
  bounded_rpc "${B_TOKEN}" notification_confirm_completion "$(jq -nc --arg s "${EVIDENCE_SESSION}" --argjson e "${RACE_MANIFEST}" \
    '{p_session_id:$s,p_entities:$e}')"
  printf '%s\n%s\n' "${STATUS}" "${BODY}" >"${RACE_DIR}/result"
) &
HANDOFF_PID=$!
BARRIER_DEADLINE=$((SECONDS+8))
while [[ "$(run_psql "select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active'
  and wait_event_type='Lock' and query like '%notification_confirm_completion%');")" != t ]]; do
  [[ ${SECONDS} -lt ${BARRIER_DEADLINE} ]] || fail 'confirmation did not reach held workout row'
done
next_cuam
bounded_rpc "${B_TOKEN}" sync_push "$(e_set "evidence-late-set-${RUN_TAG}" "${EVIDENCE_BLOCK}" 1 80 1 '' "${CUAM}" | jq '{entities:[.]}')"
expect_ok 'new private row commits while confirmation waits'; check 'late row sync acknowledged' '.ok==true'
assert_sql 'late private set committed before source-proof fence released' "select exists(select 1 from app_public.exercise_sets
  where owner_user_id='${B_UID}' and id='evidence-late-set-${RUN_TAG}');"
printf 'rollback;\n\\q\n' >&9
exec 9>&- 10<&-
wait "${HOLDER_PID}"; HOLDER_PID=""
wait "${HANDOFF_PID}"; HANDOFF_PID=""
IFS= read -r STATUS <"${RACE_DIR}/result"
BODY="$(tail -n +2 "${RACE_DIR}/result")"
expect_ok 'declared graph confirmation resumes'; check 'declared graph acknowledged' '.confirmed==true'
assert_sql 'raced confirmation seals only declared rows and remains unready for the added set' "select manifest_digest=
  encode(extensions.digest('${RACE_MANIFEST}'::jsonb::text,'sha256'),'hex')
  and manifest_digest<>app_public.notification_manifest_digest(member_user_id,session_id)
  and not app_public.notification_workout_ready(member_user_id,session_id) from app_public.notification_workouts
  where member_user_id='${B_UID}' and session_id='${EVIDENCE_SESSION}';"
confirm "${B_TOKEN}" "${EVIDENCE_SESSION}" "$(manifest "${B_UID}" "${EVIDENCE_SESSION}")"; check 'full graph reconfirmed' '.confirmed==true'
drain_eval
assert_sql 'client proof and evaluation of the full added-set graph become ready' "select app_public.notification_workout_ready('${B_UID}','${EVIDENCE_SESSION}');"
# One publication cannot capture different safe actual boards for two workouts when unrelated normalized-link disclosure moves.
rpc "${A_TOKEN}" group_update "$(jq -nc --arg g "${G1}" \
  '{p_group_id:$g,p_name:"Current group name",p_description:null,p_bodyweight_calculations_enabled:true}')"
expect_ok 'enable bodyweight disclosure fixture'
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G1}" \
  '{p_group_id:$g,p_name:"Normalized disclosure",p_load_input_mode:"total_load",p_bodyweight_contribution:1,p_default_metric:"e1rm"}')"
expect_ok 'create normalized disclosure target'; NORMALIZED_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
drain_eval
assert_sql 'ordinary board initially discloses the peer' "select app_public.notification_ranks('${G1}','${X1}',rules_revision)
  @>jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,'member_user_id','${C_UID}'::uuid,'rank',1))
  from app_public.group_exercises where id='${X1}';"
COMMON_A="000-common-a-${RUN_TAG}"; COMMON_B="000-common-b-${RUN_TAG}"
for source in "${COMMON_A}" "${COMMON_B}"; do
  next_cuam
  push "${B_TOKEN}" 'two active common-board captures' "$(e_session "${source}" "${NOW_MS}" active null null null "${CUAM}")" \
    "$(e_se "${source}-block" "${source}" "def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "${source}-set" "${source}-block" 0 80 1 '' "${CUAM}")"
done
run_psql "select app_public.notification_recover_workouts(20);
  update app_public.group_eval_queue set available_at=now()+interval '1 hour'
    where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}');
  select app_public.group_metric_eval_enqueue('${G1}','${X1}','set');
  update app_public.group_metric_eval_queue set available_at=now()+interval '1 hour' where group_exercise_id='${X2}';
  alter table app_public.group_eval_queue add constraint notification_test_disclosure check(member_user_id<>'${C_UID}'::uuid) not valid;" >/dev/null
BENCH_DIGEST="$(run_psql "select app_public.notification_comparison_digest('${G1}','${X1}');")"
rm -rf "${RACE_DIR}"
RACE_DIR="$(mktemp -d)"
mkfifo "${RACE_DIR}/in" "${RACE_DIR}/out"
docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 \
  <"${RACE_DIR}/in" >"${RACE_DIR}/out" &
HOLDER_PID=$!
exec 9>"${RACE_DIR}/in" 10<"${RACE_DIR}/out"
printf 'begin; set local statement_timeout=\0478s\047; select session_id from app_public.notification_workouts where member_user_id=\047%s\047 and session_id=\047%s\047 for update;\n\\echo held\n' \
  "${B_UID}" "${COMMON_B}" >&9
while IFS= read -r line <&10; do [[ "${line}" != held ]] || break; done
[[ "${line}" == held ]] || fail 'common-board holder did not acknowledge its lock'
(
  trap - EXIT
  http_call --max-time 20 -X POST -H "${GROUP_CONTRACT_HEADER}" -H 'x-boga-sync-protocol: 4' -H 'Content-Type: application/json' \
    -H "x-group-eval-secret: ${EVAL_SECRET}" --data '{}' "${API_URL}/functions/v1/group-eval"
  printf '%s\n%s\n' "${STATUS}" "${BODY}" >"${RACE_DIR}/result"
) &
HANDOFF_PID=$!
BARRIER_DEADLINE=$((SECONDS+12))
while [[ "$(run_psql "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid
  where a.pid<>pg_backend_pid() and a.state='active' and a.wait_event_type='Lock' and a.query like '%group_metric_eval_publish%'
    and l.locktype='advisory' and l.granted and l.classid=25005 and l.objid::bigint=(hashtext('${G1}')::bigint & 4294967295));")" != t ]]; do
  [[ ${SECONDS} -lt ${BARRIER_DEADLINE} ]] || fail 'publication did not reach the second held workout'
done
NORMALIZED_LINK="extra-normalized-link-${RUN_TAG}"
next_cuam
bounded_rpc "${C_TOKEN}" sync_push "$(e_link "def-C-${RUN_TAG}" "${G1}" "${NORMALIZED_EXERCISE}" "${CUAM}" null "${NORMALIZED_LINK}" | jq '{entities:[.]}')"
expect_ok 'normalized link commits between common-board captures'; check 'normalized link acknowledged' '.ok==true'
assert_sql 'normalized link changed disclosure without changing the accepted ordinary graph' "select
  app_public.notification_comparison_digest('${G1}','${X1}')='${BENCH_DIGEST}'
  and app_public.group_competition_redacts_exercise(array['${G1}'::uuid],'${C_UID}','def-C-${RUN_TAG}');"
printf 'rollback;\n\\q\n' >&9
exec 9>&- 10<&-
wait "${HOLDER_PID}"; HOLDER_PID=""
wait "${HANDOFF_PID}"; HANDOFF_PID=""
IFS= read -r STATUS <"${RACE_DIR}/result"
BODY="$(tail -n +2 "${RACE_DIR}/result")"
expect_ok 'disclosure-raced evaluator returns safely'; check 'disclosure race publication fails atomically' '.failed>=1'
assert_sql 'no divergent ordinary baselines escaped the failed publication' "select not exists(select 1 from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}') and group_exercise_id='${X1}')
  and exists(select 1 from app_public.group_metric_eval_queue where group_exercise_id='${X1}' and last_sqlstate='P0001');"
run_psql "alter table app_public.group_eval_queue drop constraint notification_test_disclosure;
  delete from app_public.exercise_group_links where owner_user_id='${C_UID}' and id='${NORMALIZED_LINK}';
  update app_public.group_eval_queue set available_at=now() where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}');
  update app_public.group_metric_eval_queue set available_at=now(),claimed_until=null,claim_id=null where group_exercise_id in('${X1}','${X2}');" >/dev/null
drain_eval
assert_sql 'retry captures one coherent actual board for both workouts' "select count(*)=2 and count(distinct before_ranks)=1
  and count(distinct final_ranks)=1 and bool_and(evaluated) from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}') and group_exercise_id='${X1}';"
# Restore each workout's original published contribution when testing which movement that workout caused.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Attribution bench",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create attribution comparison'; ATTR_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
ATTR_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${ATTR_EXERCISE}';")"
for label in B C D; do
  token_var="${label}_TOKEN"; next_cuam
  push "${!token_var}" 'attribution source link' "$(e_def "attr-def-${label}-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "attr-def-${label}-${RUN_TAG}" "${G2}" "${ATTR_EXERCISE}" "${CUAM}")"
done
ATTR_SESSION="attr-workout-${RUN_TAG}"; ATTR_BLOCK="attr-workout-block-${RUN_TAG}"; ATTR_SET="attr-workout-set-${RUN_TAG}"
next_cuam
ATTR_CREATED="${CUAM}"
e_attr_set() { e_set "${ATTR_SET}" "${ATTR_BLOCK}" 0 "$1" 1 '' "${CUAM}" | jq --argjson c "${ATTR_CREATED}" '.fields.created_at=$c'; }
push "${B_TOKEN}" 'published workout before notification cutover' "$(e_session "${ATTR_SESSION}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "${ATTR_BLOCK}" "${ATTR_SESSION}" "attr-def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_attr_set 95)"
next_cuam
push "${C_TOKEN}" 'published peer before notification cutover' \
  "$(e_session "attr-peer-c-${RUN_TAG}" "$((NOW_MS-18000000))" completed "$((NOW_MS-14400000))" 3600 null "${CUAM}")" \
  "$(e_se "attr-peer-c-block-${RUN_TAG}" "attr-peer-c-${RUN_TAG}" "attr-def-C-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "attr-peer-c-set-${RUN_TAG}" "attr-peer-c-block-${RUN_TAG}" 0 100 1 '' "${CUAM}")"
drain_eval
seed_published_workout_baseline() {
  run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}';
    delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';
    select app_public.notification_capture_comparison('${G2}','${ATTR_EXERCISE}',${ATTR_REV},false);" >/dev/null
}
assert_attribution_count() {
  confirm "${B_TOKEN}" "${ATTR_SESSION}" "$(manifest "${B_UID}" "${ATTR_SESSION}")"; check 'attribution graph confirmed' '.confirmed==true'
  drain_eval
  prepare_outcome "${B_UID}" "${ATTR_SESSION}"
  jq -e --arg g "${G2}" --argjson n "$1" 'length==1 and .[0].group_id==$g and .[0].rank_count==$n' <<<"${COUNTS}" >/dev/null || fail "$2"
}
seed_published_workout_baseline
next_cuam
push "${D_TOKEN}" 'new peer moves an unchanged cutover workout' \
  "$(e_session "attr-peer-d-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "attr-peer-d-block-${RUN_TAG}" "attr-peer-d-${RUN_TAG}" "attr-def-D-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "attr-peer-d-set-${RUN_TAG}" "attr-peer-d-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'finish unchanged cutover workout' "$(e_session "${ATTR_SESSION}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
assert_attribution_count 0 'unchanged cutover workout claimed another member movement'
next_cuam
push "${D_TOKEN}" 'remove the added peer for next attribution baseline' \
  "$(e_set "attr-peer-d-set-${RUN_TAG}" "attr-peer-d-block-${RUN_TAG}" 0 110 1 '' "${CUAM}" "${NOW_MS}")"
drain_eval
seed_published_workout_baseline
next_cuam
push "${B_TOKEN}" 'improvement remains below original peer' "$(e_attr_set 99)"
next_cuam
push "${C_TOKEN}" 'peer correction independently crosses the unchanged threshold' \
  "$(e_set "attr-peer-c-set-${RUN_TAG}" "attr-peer-c-block-${RUN_TAG}" 0 90 1 '' "${CUAM}")"
assert_attribution_count 0 'peer decrease attributed a below-threshold workout improvement'
next_cuam
push "${B_TOKEN}" 'restore original workout source' "$(e_attr_set 95)"
next_cuam
push "${C_TOKEN}" 'restore original peer source' "$(e_set "attr-peer-c-set-${RUN_TAG}" "attr-peer-c-block-${RUN_TAG}" 0 100 1 '' "${CUAM}")"
drain_eval
seed_published_workout_baseline
next_cuam
push "${B_TOKEN}" 'workout crosses an unchanged peer' "$(e_attr_set 105)"
assert_attribution_count 4 'genuine workout crossing did not count both members on both metrics'
next_cuam
push "${B_TOKEN}" 'restore source before hidden workout baseline' "$(e_attr_set 95)"
next_cuam
push "${C_TOKEN}" 'peer below hidden workout source' "$(e_set "attr-peer-c-set-${RUN_TAG}" "attr-peer-c-block-${RUN_TAG}" 0 90 1 '' "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'another own workout hides the source baseline' \
  "$(e_session "attr-other-own-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "attr-other-own-block-${RUN_TAG}" "attr-other-own-${RUN_TAG}" "attr-def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "attr-other-own-set-${RUN_TAG}" "attr-other-own-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
drain_eval
seed_published_workout_baseline
assert_sql 'baseline keeps a published workout source below the member winner' "select jsonb_array_length(t.baseline_scores)=2
  and not exists(select 1 from jsonb_array_elements(t.baseline_scores) x where (x->>'value')::numeric<>95)
  and exists(select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=t.group_exercise_id
    and e.member_user_id=t.member_user_id and e.metric='e1rm' and not e.certified and e.value=110)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'other own workout correction reveals the original source' \
  "$(e_set "attr-other-own-set-${RUN_TAG}" "attr-other-own-block-${RUN_TAG}" 0 80 1 '' "${CUAM}")"
next_cuam
push "${D_TOKEN}" 'new peer moves ranks while the original source stays unchanged' \
  "$(e_set "attr-peer-d-set-${RUN_TAG}" "attr-peer-d-block-${RUN_TAG}" 0 100 1 '' "${CUAM}")"
assert_attribution_count 0 'hidden published workout baseline was lost during another own workout correction'
next_cuam
push "${B_TOKEN}" 'publish comparable per-side original source' \
  "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" per_side_load)" "$(e_attr_set 95)"
drain_eval
seed_published_workout_baseline
assert_sql 'per-side baseline pins the published total value' "select jsonb_array_length(baseline_scores)=2 and not exists(
  select 1 from jsonb_array_elements(baseline_scores) b where (b->>'value')::numeric<>190 or b->>'source_load_input_mode'<>'per_side_load'
    or not (b->>'projection_known')::boolean) from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'mode correction coalesces with performed source edit' \
  "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" total_load)" "$(e_attr_set 99)"
assert_attribution_count 0 'incomparable source mode was admitted as rank attribution'
assert_sql 'mode-moved counterfactual equals actual while completion stays ready' "select without_workout=final_ranks
  and without_workout=app_public.notification_ranks(group_id,group_exercise_id,rules_revision,t)
  and app_public.notification_workout_ready(member_user_id,session_id) from app_public.notification_workout_targets t
  where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
seed_published_workout_baseline
next_cuam
push "${B_TOKEN}" 'source mode moves away from its original interpretation' "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
next_cuam
push "${B_TOKEN}" 'source mode returns with a newly performed improvement' \
  "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" total_load)" "$(e_attr_set 105)"
assert_attribution_count 0 'mode round trip erased the incompatible source epoch'
assert_sql 'same literal mode with a newer epoch still disables rank attribution' "select without_workout=final_ranks and exists(
  select 1 from jsonb_array_elements(t.baseline_scores) b cross join lateral
    jsonb_array_elements(app_public.group_metric_eval_source_graph(t.group_id,t.group_exercise_id)->'sets') x
  where x->>'set_id'=b->>'set_id' and x->>'source_load_input_mode'=b->>'source_load_input_mode'
    and (x->>'source_mode_generation')::bigint<>(b->>'source_mode_generation')::bigint)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
jq -e '.[0].best_count==2 and .[0].rank_count==0' <<<"${COUNTS}" >/dev/null || fail 'rank context failure suppressed a valid performed best'
rpc "${A_TOKEN}" notification_group_mute "{\"p_group_id\":\"${G2}\",\"p_muted\":false}"; expect_ok 'enable attribution group preview'
enqueue_outcome "${B_UID}" "${ATTR_SESSION}"
ATTR_INTENT="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}'
  and session_id='${ATTR_SESSION}' and kind='completion';")"
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${ATTR_INTENT}}"; expect_ok 'project incomparable-source completion'
check 'completion activity and bests remain available when ranks fail closed' '.kind=="completion" and .heading=="Finished a workout" and .bestCount==2 and .rankCount==0'
certify_attribution_set() {
  rpc "${A_TOKEN}" group_competition_board "$(jq -nc --arg g "${G2}" --arg x "${ATTR_EXERCISE}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false}')"
  expect_ok 'read real certification write token'
  CERT_TOKEN="$(jq -er --arg u "${B_UID}" --arg s "${ATTR_SET}" '.entries[]|select(.member.user_id==$u and .performance.set_id==$s)|.write_token' <<<"${BODY}")"
  CERT_REV="$(jq -er '.rules.rules_revision' <<<"${BODY}")"
  rpc "${A_TOKEN}" group_competition_certify "$(jq -nc --arg g "${G2}" --arg x "${ATTR_EXERCISE}" --arg u "${B_UID}" \
    --arg s "${ATTR_SET}" --arg t "${CERT_TOKEN}" --argjson r "${CERT_REV}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
  expect_ok 'create real whole-set witness'; ATTR_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
  drain_eval
}
certify_attribution_set
VOID_CERT="${ATTR_CERT}"
seed_published_workout_baseline
assert_sql 'published baseline retains both Certified placements' "select (select count(*) from jsonb_array_elements(baseline_scores) b
  where (b->>'certified')::boolean)=2 and (select count(*) from jsonb_array_elements(before_ranks) r
  where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')=2 from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'performed input edit voids the original witness' "$(e_attr_set 106)"
assert_attribution_count 2 'workout source edit did not attribute its own lost Certified placements'
assert_sql 'publisher voids the real whole-set witness' "select count(*)=2 and bool_and(ended_at is not null and end_reason='voided')
  from app_public.group_metric_certifications where group_exercise_id='${ATTR_EXERCISE}' and member_user_id='${B_UID}' and set_id='${ATTR_SET}'
    and coalesce(legacy_certification_id,witness_certification_id,id)='${VOID_CERT}'::uuid;"
assert_sql 'causal witness restores the voided original Certified contribution' "select
  (select count(*) from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')=2
  and not exists(select 1 from jsonb_array_elements(final_ranks) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
for end_action in withdraw cancel; do
  certify_attribution_set
  seed_published_workout_baseline
  CERT_INPUTS="$(run_psql "select performance_inputs::text from app_public.notification_workout_targets where member_user_id='${B_UID}'
    and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';")"
  rpc "${A_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${G2}" --arg c "${ATTR_CERT}" --arg a "${end_action}" \
    '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:$a}')"
  expect_ok 'standalone witness lifecycle change'
  assert_attribution_count 0 "standalone witness ${end_action} was attributed to an unchanged workout"
  assert_sql 'standalone witness ending preserves performed inputs and no causal Certified contribution' "select
    performance_inputs='${CERT_INPUTS}'::jsonb and without_workout=final_ranks
    and not exists(select 1 from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
    from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
done
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${INTENT}}"; expect_ok 'public preview after private baseline capture'
check 'public preview omits private baseline scores' '[..|objects|(has("baseline_scores") or has("baselineScores"))]|any|not'
assert_sql 'forfeited start remains absent after later recovery and worker preparation' "select not exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}');"
assert_sql 'diagnostic is sanitized' "select exists(select 1 from public.app_logs where event='notification.intake_failed'
  and user_id='${B_UID}' and context? 'sqlstate' and not context? 'error');"
COMPLETED=1
pass 'workout graph, full-rank publication, overlap, ownership, expiry, clamp, sink and recovery contracts'
