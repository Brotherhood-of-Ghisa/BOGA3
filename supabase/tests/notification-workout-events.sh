#!/usr/bin/env bash
# Real sync intake, exact graph proof, atomic competition publication and encrypted local-sink lifecycle.
set -eEuo pipefail
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
SWEEP_ACTIVE="$(run_psql "select active::text from cron.job where jobname='group-eval-sweep';")"
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
trap 'echo "[${LANE_LABEL}] command failed at line ${LINENO}" >&2' ERR
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
  check 'worker jobs omit private source baselines and controls' '[..|objects|(has("baseline_scores") or has("baselineScores") or has("admission_scores") or has("admissionScores") or has("source_controls") or has("sourceControls"))]|any|not'
  TARGETS="$(jq --arg u "$1" --arg s "$2" '.jobs[]|select(.member_user_id==$u and .session_id==$s)' <<<"${BODY}")"
  if [[ -z "${TARGETS}" ]]; then
    run_psql "select jsonb_build_object('eligible',w.eligible,'confirmed',w.confirmed_at is not null,
      'completion',w.completion_at is not null,'unexpired',w.completion_at+interval '24 hours'>now(),
      'after_cutover',w.completion_at>=(select started_at from app_public.notification_workout_epoch),
      'manifest_matches',w.manifest_digest=app_public.notification_manifest_digest(w.member_user_id,w.session_id),
      'context_matches',w.context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id),
      'generation',w.generation,'enqueued_generation',w.enqueued_generation,
      'ready',app_public.notification_workout_ready(w.member_user_id,w.session_id),
      'session_queue',exists(select 1 from app_public.group_eval_queue q where q.kind='session' and q.member_user_id=w.member_user_id and q.session_id=w.session_id),
      'targets',(select coalesce(jsonb_agg(jsonb_build_object('evaluated',t.evaluated,'baseline_known',t.baseline_known,
        'revision_matches',t.rules_revision=ge.rules_revision and ge.published_rules_revision=ge.rules_revision,
        'metric_queue',exists(select 1 from app_public.group_metric_eval_queue q where q.group_exercise_id=t.group_exercise_id),
        'final_matches',t.final_ranks=app_public.notification_ranks(t.group_id,t.group_exercise_id,t.rules_revision),
        'without_matches',t.without_workout=app_public.notification_ranks(t.group_id,t.group_exercise_id,t.rules_revision,t),
        'publication_matches',p.source_digest=app_public.notification_comparison_digest(t.group_id,t.group_exercise_id))),'[]'::jsonb)
        from app_public.notification_workout_targets t join app_public.group_exercises ge on ge.id=t.group_exercise_id
        left join app_public.notification_comparison_publications p using(group_exercise_id)
        where t.member_user_id=w.member_user_id and t.session_id=w.session_id))
      from app_public.notification_workouts w where w.member_user_id='$1' and w.session_id='$2';" >&2
    fail "ready workout missing from prepare: $2"
  fi
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
# Rollback isolates scheduling from other fixtures and prevents real pg_net dispatch.
CUTOVER_SEED_SQL="$(sed -n '/^insert into app_public.notification_moment_queue/,/;/p' "${SUPABASE_DIR}/migrations/20261022201529_notification_moment_admission.sql")"
run_psql "begin;
  truncate app_public.notification_moment_queue,app_public.notification_workout_moments,
    app_public.notification_workouts,app_public.notification_intents cascade;
  update app_public.notification_workout_epoch set started_at=now()-interval '26 hours';
  set local request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}';
  insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
    values('${B_UID}','cutover-scheduling-${RUN_TAG}','active',floor(extract(epoch from now()-interval '23 hours 50 minutes')*1000),1,1,1);
  select app_public.notification_track_workout('${B_UID}','cutover-scheduling-${RUN_TAG}');
  update app_public.sessions set status='completed',completed_at=floor(extract(epoch from now()+interval '30 minutes')*1000)
    where owner_user_id='${B_UID}' and id='cutover-scheduling-${RUN_TAG}';
  delete from app_public.notification_moment_queue;
  ${CUTOVER_SEED_SQL}
  do \$\$ begin
    if not exists(select 1 from app_public.notification_moment_queue where session_id='cutover-scheduling-${RUN_TAG}'
      and available_at<=now()) then raise exception 'cutover postponed an expiring start behind a future completion'; end if;
    perform app_public.notification_admit_moments(20);
    if not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}'
      and session_id='cutover-scheduling-${RUN_TAG}' and kind='start'
      and expires_at>now() and expires_at<now()+interval '11 minutes') then
      raise exception 'cutover lost the captured start or renewed its deadline'; end if;
  end \$\$;
  rollback;" >/dev/null
pass 'cutover admits an expiring start before its future completion'
run_psql "begin;
  truncate app_public.notification_moment_queue,app_public.notification_workout_moments,
    app_public.notification_workouts,app_public.notification_intents cascade;
  delete from vault.secrets where name in ('notification_worker_url','notification_worker_key');
  select vault.create_secret('http://127.0.0.1:9/functions/v1/notification-worker','notification_worker_url');
  select vault.create_secret('fixture-only','notification_worker_key');
  set local request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}';
  set local boga.notification_kicked='false';
  insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
    values('${B_UID}','future-kick-${RUN_TAG}','active',floor(extract(epoch from now()+interval '30 minutes')*1000),1,1,1);
  do \$\$ declare requests bigint; begin
    if app_public.notification_work_pending() or current_setting('boga.notification_kicked')='true' then
      raise exception 'future-only intake consumed the transaction kick'; end if;
    select count(*) into requests from net.http_request_queue;
    insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
      values('${B_UID}','due-kick-${RUN_TAG}','active',floor(extract(epoch from now())*1000),1,1,1);
    if current_setting('boga.notification_kicked')<>'true' or (select count(*) from net.http_request_queue)<>requests+1 then
      raise exception 'due second row did not dispatch'; end if;
    perform app_public.notification_kick_once();
    if (select count(*) from net.http_request_queue)<>requests+1 then raise exception 'transaction dispatched twice'; end if;
  end \$\$;
  rollback;" >/dev/null
pass 'future then due intake dispatches exactly once in one transaction'
HISTORY_ENTITIES=()
for number in {1..200}; do
  next_cuam
  HISTORY_ENTITIES+=("$(e_session "old-admission-${number}-${RUN_TAG}" "$((NOW_MS-180000000))" completed "$((NOW_MS-172800000))" 7200 null "${CUAM}")")
done
push "${B_TOKEN}" '200 expired historical sessions' "${HISTORY_ENTITIES[@]}"
assert_sql 'expired history preserves moments without filling the admission queue' "select count(*)=200
  and not exists(select 1 from app_public.notification_moment_queue where session_id like 'old-admission-%-${RUN_TAG}')
  from app_public.notification_workout_moments where member_user_id='${B_UID}' and session_id like 'old-admission-%-${RUN_TAG}';"
next_cuam
push "${B_TOKEN}" 'live start behind historical batch' "$(e_session "history-live-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")"
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
assert_sql 'one admission pass reaches the live start after historical intake' "select exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and recipient_user_id='${A_UID}' and session_id='history-live-${RUN_TAG}' and kind='start')
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id='${B_UID}' and session_id='history-live-${RUN_TAG}');"
pass '200 expired sessions preserve moments without delaying a live start'
# The upload also queues group evaluation; keep that bulk fixture out of later readiness probes.
run_psql "delete from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='history-live-${RUN_TAG}';
  delete from app_public.group_eval_queue where member_user_id='${B_UID}'
    and (session_id like 'old-admission-%-${RUN_TAG}' or session_id='history-live-${RUN_TAG}');
  delete from app_public.sessions where owner_user_id='${B_UID}'
    and (id like 'old-admission-%-${RUN_TAG}' or id='history-live-${RUN_TAG}');" >/dev/null
DELAYED_INSTALL="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
DELAYED_CAPABILITY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
DELAYED_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
rpc "${A_TOKEN}" notification_register "$(jq -nc --arg i "${DELAYED_INSTALL}" --arg c "${DELAYED_CAPABILITY}" --arg k "${DELAYED_KEY}" \
  '{p_installation_id:$i,p_capability:$c,p_encryption_key:$k,p_token:"LocalPushToken[delayed-second]",p_environment:"local",
    p_project_id:"3c00cd23-0946-4eb6-bbf0-4542879cd314",p_bundle_id:"com.phano.boga3.dev",p_permission:true,p_opted_in:true}')"
expect_ok 'register temporary delayed-admission installation'; DELAYED_BINDING="$(jq -er '.binding_id' <<<"${BODY}")"
# Both uploads commit before any admission; the immutable active moment must still produce its start.
DELAYED="delayed-recovery-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'capture active upload without admitting its producer' "$(e_session "${DELAYED}" "${NOW_MS}" active null null null "${CUAM}")"
assert_sql 'active upload captures its start before any workout ledger exists' "select exists(select 1 from app_public.notification_workout_moments
  where member_user_id='${B_UID}' and session_id='${DELAYED}' and kind='start' and event_at=to_timestamp(${NOW_MS}/1000.0))
  and not exists(select 1 from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${DELAYED}')
  and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${DELAYED}');"
next_cuam
push "${B_TOKEN}" 'complete before first admission or evaluation' "$(e_session "${DELAYED}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
assert_sql 'completed upload still has no producer ledger and retains both original moments' "select
  not exists(select 1 from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${DELAYED}')
  and (select count(*)=2 from app_public.notification_workout_moments where member_user_id='${B_UID}' and session_id='${DELAYED}');"
confirm "${B_TOKEN}" "${DELAYED}" "$(manifest "${B_UID}" "${DELAYED}")"; check 'delayed completed graph confirmed' '.confirmed==true'
drain_eval
# An already-applied producer could have persisted can_start=false before admission; the original moment repairs it.
run_psql "update app_public.notification_workouts set can_start=false where member_user_id='${B_UID}' and session_id='${DELAYED}';" >/dev/null
prepare_outcome "${B_UID}" "${DELAYED}"; enqueue_outcome "${B_UID}" "${DELAYED}"
assert_sql 'admission repairs old can_start from the immutable original active moment' "select can_start from app_public.notification_workouts
  where member_user_id='${B_UID}' and session_id='${DELAYED}';"
assert_sql 'first admission produces two overlap-deduplicated logical alerts with original expiry' "select count(*)=2
  and count(distinct kind)=2 and bool_and(expires_at=event_at+interval '24 hours')
  and bool_and(event_at=case kind when 'start' then to_timestamp(${NOW_MS}/1000.0) else to_timestamp($((NOW_MS+1000))/1000.0) end)
  from app_public.notification_intents where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${DELAYED}';"
DELAYED_START="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${DELAYED}' and kind='start';")"
DELAYED_COMPLETION="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${DELAYED}' and kind='completion';")"
DELAYED_START_DELIVERY="$(run_psql "select id from app_public.notification_deliveries where intent_id=${DELAYED_START} and installation_id='${INSTALL_ID}';")"
DELAYED_COMPLETION_DELIVERY="$(run_psql "select id from app_public.notification_deliveries where intent_id=${DELAYED_COMPLETION} and installation_id='${INSTALL_ID}';")"
DELAYED_SECOND_START="$(run_psql "select id from app_public.notification_deliveries where intent_id=${DELAYED_START} and installation_id='${DELAYED_INSTALL}';")"
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${DELAYED_START}}"; expect_ok 'captured start projects after raw completion'
check 'delayed start keeps activity copy and overlap projection' '.kind=="start" and .heading=="Started a workout at a secret location" and .identity=="MemberB · 2 groups" and .bestCount==0 and .rankCount==0'
run_psql 'update app_public.notification_config set sending_enabled=true;' >/dev/null
for held_state in pending retry disabled; do
  run_psql "update app_public.notification_deliveries set state='${held_state}',available_at=now()+interval '1 hour',claim_id=null,lease_until=null
      where intent_id=${DELAYED_START};
    update app_public.notification_deliveries set available_at=now()+interval '1 hour' where intent_id=${DELAYED_COMPLETION};
    update app_public.notification_deliveries set available_at=now() where id=${DELAYED_COMPLETION_DELIVERY};" >/dev/null
  rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok 'claim completion before its captured start'
  DELAYED_JOB="$(jq --argjson id "${DELAYED_COMPLETION_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
  [[ -n "${DELAYED_JOB}" ]] || fail 'delayed completion was not claimed'
  rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${DELAYED_JOB}")"
  expect_ok 'completion waits for captured start'; [[ "${BODY}" == null ]] || fail 'completion overtook its unsent captured start'
  assert_sql 'completion defers without cancelling its captured start' "select state='${held_state}' from app_public.notification_deliveries
    where id=${DELAYED_START_DELIVERY};"
done
run_psql "update app_public.notification_deliveries set state='pending',available_at=now() where intent_id=${DELAYED_START};
  update app_public.notification_deliveries set available_at=now() where id=${DELAYED_COMPLETION_DELIVERY};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok 'claim both delayed alerts concurrently'
DELAYED_START_JOB="$(jq --argjson id "${DELAYED_START_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
DELAYED_JOB="$(jq --argjson id "${DELAYED_COMPLETION_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
[[ -n "${DELAYED_START_JOB}" && -n "${DELAYED_JOB}" ]] || fail 'both delayed alerts were not leased'
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${DELAYED_JOB}")"
expect_ok 'completion waits for already leased start'; [[ "${BODY}" == null ]] || fail 'completion cancelled a concurrently leased start'
assert_sql 'leased captured start retains its claim' "select state='leased' and claim_id='$(jq -r '.claim_id' <<<"${DELAYED_START_JOB}")'
  from app_public.notification_deliveries where id=${DELAYED_START_DELIVERY};"
assert_sql 'both installation starts survive the completion-first leased probe' "select count(*)=2 and bool_and(state='leased')
  from app_public.notification_deliveries where intent_id=${DELAYED_START};"
# Release the probe's lease so the actual encrypted worker can send the start to the local sink.
run_psql "update app_public.notification_deliveries set state='pending',available_at=now()+interval '1 hour',claim_id=null,lease_until=null where intent_id=${DELAYED_START};
  update app_public.notification_deliveries set available_at=now() where id=${DELAYED_START_DELIVERY};
  update app_public.notification_deliveries set available_at=now()+interval '1 hour' where intent_id=${DELAYED_COMPLETION};" >/dev/null
drain_worker
check 'actual local sink accepts delayed start first' '.outcomes.ticket==1'
assert_sql 'delayed start has a real local ticket before completion' "select state='ticket' and provider='local' and ticket_id like 'local:ok:%'
  from app_public.notification_deliveries where id=${DELAYED_START_DELIVERY};"
run_psql "update app_public.notification_deliveries set available_at=now() where id=${DELAYED_COMPLETION_DELIVERY};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok 'claim completion after only its own installation start settles'
DELAYED_JOB="$(jq --argjson id "${DELAYED_COMPLETION_DELIVERY}" '.jobs[]|select(.id==$id)' <<<"${BODY}")"
[[ -n "${DELAYED_JOB}" ]] || fail 'sibling-start completion probe was not claimed'
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "$(jq '{p_delivery_id:.id,p_claim_id:.claim_id,p_generation:.generation}' <<<"${DELAYED_JOB}")"
expect_ok 'completion waits for other live installation start'; [[ "${BODY}" == null ]] || fail 'completion cancelled the sibling installation pending start'
assert_sql 'sibling pending start survives after the first installation has a ticket' "select state='pending' from app_public.notification_deliveries
  where id=${DELAYED_SECOND_START};"
run_psql "update app_public.notification_deliveries set available_at=now()+interval '1 hour' where intent_id=${DELAYED_COMPLETION};
  update app_public.notification_deliveries set available_at=now() where id=${DELAYED_SECOND_START};" >/dev/null
drain_worker
check 'actual local sink accepts sibling start before either completion' '.outcomes.ticket==1'
assert_sql 'both installation starts settle before any completion handoff' "select count(*)=2 and bool_and(state='ticket')
  from app_public.notification_deliveries where intent_id=${DELAYED_START};"
run_psql "update app_public.notification_deliveries set available_at=now() where intent_id=${DELAYED_COMPLETION};" >/dev/null
drain_worker
check 'actual local sink accepts both delayed completions after both starts' '.outcomes.ticket==2'
assert_sql 'both delayed alerts reach each installation once and keep original deadlines' "select count(*)=4 and count(distinct d.installation_id)=2 and bool_and(d.state='ticket'
  and d.provider='local' and d.ticket_id like 'local:ok:%' and d.attempts=1 and n.expires_at=n.event_at+interval '24 hours')
  from app_public.notification_deliveries d join app_public.notification_intents n on n.id=d.intent_id
  where n.recipient_user_id='${A_UID}' and n.lifter_user_id='${B_UID}' and n.session_id='${DELAYED}';"
drain_worker; check 'accepted delayed alerts never replay' '.claimed==0'
rpc "${A_TOKEN}" notification_unregister "$(jq -nc --arg i "${DELAYED_INSTALL}" --arg b "${DELAYED_BINDING}" '{p_installation_id:$i,p_binding_id:$b}')"
expect_ok 'unregister temporary delayed-admission installation'
assert_sql 'downstream fixture retains only its original active installation' "select count(*)=1 from app_public.notification_installations
  where user_id='${A_UID}' and active and permission and opted_in;"
next_cuam
push "${B_TOKEN}" 'delete admitted completed source' "$(e_session "${DELAYED}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 "${NOW_MS}" "${CUAM}")"
for intent_id in "${DELAYED_START}" "${DELAYED_COMPLETION}"; do
  rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${intent_id}}"; expect_ok 'deleted source projection'
  [[ "${BODY}" == null ]] || fail 'deleted source projected a captured activity alert'
done
run_psql "select app_public.notification_start_workout('${B_UID}','${DELAYED}');" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_workout_enqueue "$(jq -nc --arg m "${B_UID}" --arg s "${DELAYED}" --argjson g "${GEN}" \
  '{p_member:$m,p_session:$s,p_generation:$g,p_contributions:[]}')"; expect_ok 'deleted source producer rejects new completion'
[[ "${BODY}" == false ]] || fail 'deleted source completion remained ready'
assert_sql 'deleted source producer retains only the two existing identities' "select count(*)=2 from app_public.notification_intents
  where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${DELAYED}';"
# An expired captured start never renews its clock or delays a newly completed source.
EXPIRED_START="expired-start-${RUN_TAG}"; EXPIRED_START_MS="$((NOW_MS-90000000))"
EXPIRY_EPOCH="$(run_psql 'select started_at from app_public.notification_workout_epoch;')"
run_psql "update app_public.notification_workout_epoch set started_at=now()-interval '26 hours';" >/dev/null
next_cuam
push "${B_TOKEN}" 'capture already expired active start' "$(e_session "${EXPIRED_START}" "${EXPIRED_START_MS}" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'fresh completion follows the expired original start' "$(e_session "${EXPIRED_START}" "${EXPIRED_START_MS}" completed "${NOW_MS}" 90000 null "${CUAM}")"
confirm "${B_TOKEN}" "${EXPIRED_START}" "$(manifest "${B_UID}" "${EXPIRED_START}")"; check 'fresh completion with expired start confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${EXPIRED_START}"; enqueue_outcome "${B_UID}" "${EXPIRED_START}"
assert_sql 'expired original start is unchanged and produces no renewed start alert' "select w.start_at=to_timestamp(${EXPIRED_START_MS}/1000.0)
  and m.event_at=w.start_at and w.start_at>=(select started_at from app_public.notification_workout_epoch)
  and w.can_start and w.start_at+interval '24 hours'<=now()
  and not app_public.notification_start_ready(w.member_user_id,w.session_id,w.start_at)
  and not exists(select 1 from app_public.notification_intents n where n.lifter_user_id=w.member_user_id and n.session_id=w.session_id and n.kind='start')
  from app_public.notification_workouts w join app_public.notification_workout_moments m
    on m.member_user_id=w.member_user_id and m.session_id=w.session_id and m.kind='start'
  where w.member_user_id='${B_UID}' and w.session_id='${EXPIRED_START}';"
drain_worker
assert_sql 'fresh completion reaches the local sink without its expired start' "select count(*)=1 and bool_and(n.kind='completion'
  and n.event_at=to_timestamp(${NOW_MS}/1000.0) and n.expires_at=to_timestamp(${NOW_MS}/1000.0)+interval '24 hours'
  and d.state='ticket' and d.provider='local' and d.ticket_id like 'local:ok:%')
  from app_public.notification_intents n join app_public.notification_deliveries d on d.intent_id=n.id
  where n.recipient_user_id='${A_UID}' and n.lifter_user_id='${B_UID}' and n.session_id='${EXPIRED_START}';"
EXPIRED_AUTOSAVE="expired-autosave-${RUN_TAG}"
next_cuam; EXPIRED_AUTOSAVE_CREATED="${CUAM}"
push "${B_TOKEN}" 'expired original moment before a newer raw autosave' "$(e_session "${EXPIRED_AUTOSAVE}" "${EXPIRED_START_MS}" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'new raw start cannot renew expired captured timing' \
  "$(e_session "${EXPIRED_AUTOSAVE}" "${NOW_MS}" active null null null "${CUAM}" | jq --argjson c "${EXPIRED_AUTOSAVE_CREATED}" '.fields.created_at=$c')"
rpc "${SERVICE_ROLE_KEY}" notification_admit_moments '{"p_limit":20}'; [[ "${STATUS}" == 204 && -z "${BODY}" ]] || fail 'expired-timing admission expected HTTP 204 with no body'
assert_sql 'newer raw timestamp never queues or renews its expired original event' "select s.started_at=${NOW_MS}
  and m.event_at=to_timestamp(${EXPIRED_START_MS}/1000.0)
  and not exists(select 1 from app_public.notification_workouts where member_user_id=m.member_user_id and session_id=m.session_id)
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id=m.member_user_id and session_id=m.session_id)
  and not exists(select 1 from app_public.notification_intents where lifter_user_id=m.member_user_id and session_id=m.session_id)
  from app_public.sessions s join app_public.notification_workout_moments m
    on m.member_user_id=s.owner_user_id and m.session_id=s.id and m.kind='start'
  where s.owner_user_id='${B_UID}' and s.id='${EXPIRED_AUTOSAVE}';"
next_cuam
push "${B_TOKEN}" 'delete expired autosave control' \
  "$(e_session "${EXPIRED_AUTOSAVE}" "${NOW_MS}" active null null "${NOW_MS}" "${CUAM}" | jq --argjson c "${EXPIRED_AUTOSAVE_CREATED}" '.fields.created_at=$c')"
run_psql "update app_public.notification_workout_epoch set started_at='${EXPIRY_EPOCH}';" >/dev/null
# Admission follows a fresh captured moment even after a higher-LWW raw timestamp moves outside the window.
BACKDATED="backdated-recovery-${RUN_TAG}"
next_cuam; BACKDATED_CREATED="${CUAM}"
push "${B_TOKEN}" 'capture fresh active start before raw backdating' "$(e_session "${BACKDATED}" "${NOW_MS}" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'higher-LWW active autosave backdates raw start beyond one day' \
  "$(e_session "${BACKDATED}" "${EXPIRED_START_MS}" active null null null "${CUAM}" | jq --argjson c "${BACKDATED_CREATED}" '.fields.created_at=$c')"
assert_sql 'backdated active source still has its recent original moment and no ledger' "select s.status='active' and s.started_at=${EXPIRED_START_MS}
  and s.client_updated_at_ms=${CUAM} and m.event_at=to_timestamp(${NOW_MS}/1000.0)
  and not exists(select 1 from app_public.notification_workouts w where w.member_user_id=s.owner_user_id and w.session_id=s.id)
  and not exists(select 1 from app_public.notification_intents n where n.lifter_user_id=s.owner_user_id and n.session_id=s.id)
  from app_public.sessions s join app_public.notification_workout_moments m
    on m.member_user_id=s.owner_user_id and m.session_id=s.id and m.kind='start'
  where s.owner_user_id='${B_UID}' and s.id='${BACKDATED}';"
rpc "${SERVICE_ROLE_KEY}" notification_admit_moments '{"p_limit":20}'; [[ "${STATUS}" == 204 && -z "${BODY}" ]] || fail 'captured-time admission expected HTTP 204 with no body'
assert_sql 'captured timing creates one start with its original deadline across overlapping groups' "select count(*)=1 and bool_and(kind='start'
  and event_at=to_timestamp(${NOW_MS}/1000.0) and expires_at=to_timestamp(${NOW_MS}/1000.0)+interval '24 hours')
  from app_public.notification_intents where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${BACKDATED}';"
drain_worker; check 'actual local sink accepts admitted backdated source' '.outcomes.ticket==1'
next_cuam
push "${B_TOKEN}" 'repeat backdated autosave after accepted admitted start' \
  "$(e_session "${BACKDATED}" "${EXPIRED_START_MS}" active null null null "${CUAM}" | jq --argjson c "${BACKDATED_CREATED}" '.fields.created_at=$c')"
# An autosave appends no moment; queue the source again, as the cutover seed or a duplicate append would.
run_psql "insert into app_public.notification_moment_queue(member_user_id,session_id) values('${B_UID}','${BACKDATED}');" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_admit_moments '{"p_limit":20}'; [[ "${STATUS}" == 204 && -z "${BODY}" ]] || fail 'repeat admission expected HTTP 204 with no body'
drain_worker; check 'backdated autosave and admission never replay the accepted start' '.claimed==0'
assert_sql 'backdated source retains one real local ticket and its immutable original clock' "select count(*)=1 and bool_and(n.kind='start'
  and n.event_at=to_timestamp(${NOW_MS}/1000.0) and n.expires_at=to_timestamp(${NOW_MS}/1000.0)+interval '24 hours'
  and d.state='ticket' and d.provider='local' and d.ticket_id like 'local:ok:%' and d.attempts=1)
  from app_public.notification_intents n join app_public.notification_deliveries d on d.intent_id=n.id
  where n.recipient_user_id='${A_UID}' and n.lifter_user_id='${B_UID}' and n.session_id='${BACKDATED}';"
BACKDATED_INTENT="$(run_psql "select id from app_public.notification_intents where recipient_user_id='${A_UID}' and session_id='${BACKDATED}' and kind='start';")"
BACKDATED_RECOVERY_AT="$(run_psql "select updated_at from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${BACKDATED}';")"
next_cuam
push "${B_TOKEN}" 'delete backdated source whose captured moment remains fresh' \
  "$(e_session "${BACKDATED}" "${EXPIRED_START_MS}" active null null "${NOW_MS}" "${CUAM}" | jq --argjson c "${BACKDATED_CREATED}" '.fields.created_at=$c')"
run_psql "insert into app_public.notification_moment_queue(member_user_id,session_id) values('${B_UID}','${BACKDATED}');" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_admit_moments '{"p_limit":20}'; [[ "${STATUS}" == 204 && -z "${BODY}" ]] || fail 'deleted-source admission expected HTTP 204 with no body'
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${BACKDATED_INTENT}}"; expect_ok 'deleted captured-start projection'
[[ "${BODY}" == null ]] || fail 'deleted backdated source projected its captured start'
assert_sql 'deleted source is excluded from admission and retains one immutable identity' "select updated_at='${BACKDATED_RECOVERY_AT}'
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id='${B_UID}' and session_id='${BACKDATED}')
  and (select count(*)=1 from app_public.notification_intents where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${BACKDATED}')
  from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${BACKDATED}';"
run_psql 'update app_public.notification_config set sending_enabled=false;' >/dev/null
SESSION="fresh-${RUN_TAG}"; BLOCK="fresh-block-${RUN_TAG}"; SET="fresh-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'active session' "$(e_session "${SESSION}" "${NOW_MS}" active null null null "${CUAM}")"
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
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
IDLE_VERSION="$(run_psql "select xmin::text from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${SESSION}';")"
confirm "${B_TOKEN}" "${SESSION}" "$(manifest "${B_UID}" "${SESSION}")"; check 'unchanged settled confirmation retains success' '.confirmed==true'
assert_sql 'unchanged confirmation does not rewrite its workout tuple' "select xmin::text='${IDLE_VERSION}' from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${SESSION}';"
# The no-op shortcut must still adopt a captured start and reject a forfeited completion.
run_psql "begin;
  set local track_functions='all';
  set local client_min_messages=notice;
  select set_config('request.jwt.claims',jsonb_build_object('sub','${B_UID}','role','authenticated',
    'session_id',(select id from auth.sessions where user_id='${B_UID}' limit 1))::text,true);
  update app_public.notification_workouts set can_start=false where member_user_id='${B_UID}' and session_id='${SESSION}';
  do \$\$ declare proof jsonb; answer jsonb; calls_before bigint; tuple_before tid; begin
    proof:=app_public.notification_source_manifest('${B_UID}','${SESSION}');
    answer:=app_public.notification_confirm_completion('${SESSION}',proof);
    if not (answer->>'confirmed')::boolean or not exists(select 1 from app_public.notification_workouts
      where member_user_id='${B_UID}' and session_id='${SESSION}' and can_start) then raise exception 'captured start was not repaired'; end if;
    select coalesce(sum(calls),0) into calls_before from pg_stat_xact_user_functions where funcid='app_public.notification_track_workout(uuid,text)'::regprocedure;
    select ctid into tuple_before from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${SESSION}';
    answer:=app_public.notification_confirm_completion('${SESSION}',proof);
    if not (answer->>'confirmed')::boolean or (select coalesce(sum(calls),0) from pg_stat_xact_user_functions
        where funcid='app_public.notification_track_workout(uuid,text)'::regprocedure)<>calls_before or not exists(
        select 1 from app_public.notification_workouts where member_user_id='${B_UID}' and session_id='${SESSION}' and ctid=tuple_before) then
      raise exception 'unchanged confirmation repeated its tracker or row write'; end if;
    update app_public.notification_workout_moments set event_at=null where member_user_id='${B_UID}' and session_id='${SESSION}' and kind='completion';
    answer:=app_public.notification_confirm_completion('${SESSION}',proof);
    if (answer->>'confirmed')::boolean or exists(select 1 from app_public.notification_workouts
      where member_user_id='${B_UID}' and session_id='${SESSION}' and eligible) then raise exception 'forfeited completion was not rejected'; end if;
  end \$\$;
  rollback;" >/dev/null
rpc "${B_TOKEN}" notification_pending_completions '{}'; expect_ok 'settled completion polling'
check 'settled summaries leave the proof polling backlog' '(.session_ids|index($s))==null' --arg s "${SESSION}"
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
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
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
push "${B_TOKEN}" 'inert foreign-group link cannot target an unrelated comparison' \
  "$(e_link "cold-def-B-${RUN_TAG}" "${G2}" "${X1}" "${CUAM}")"
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
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
next_cuam
push "${B_TOKEN}" 'complete before rebuilt revision publishes' \
  "$(e_session "${COLD_SESSION}" "$((NOW_MS+120000))" completed "$((NOW_MS+130000))" 10 null "${CUAM}")"
confirm "${B_TOKEN}" "${COLD_SESSION}" "$(manifest "${B_UID}" "${COLD_SESSION}")"; check 'cold graph confirmed' '.confirmed==true'
drain_eval
assert_sql 'unlinked shared evaluator inputs never expand the confirmed workout target context' "select
  w.context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id)
  and (select count(*)=1 and bool_and(group_exercise_id='${COLD_EXERCISE}') from app_public.notification_workout_targets t
    where t.member_user_id=w.member_user_id and t.session_id=w.session_id)
  and jsonb_array_length(app_public.notification_session_targets(w.member_user_id,w.session_id))=1
  from app_public.notification_workouts w where w.member_user_id='${B_UID}' and w.session_id='${COLD_SESSION}';"
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
# Missing original moments fail closed; a missed share loses its alert, never repaired.
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
  select app_public.notification_admit_moments(20);' >/dev/null
assert_sql 'missing start timing does not manufacture an admitted alert' "select exists(select 1 from app_public.sessions
  where owner_user_id='${B_UID}' and id='recovery-${RUN_TAG}' and status='active') and not exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}');"
next_cuam
push "${B_TOKEN}" 'forfeit missed start on later autosave' "$(e_session "recovery-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")"
assert_sql 'missed start stays an immutable forfeited moment' "select event_at is null from app_public.notification_workout_moments
  where member_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}' and kind='start';"
rpc "${SERVICE_ROLE_KEY}" notification_admit_moments '{"p_limit":20}'; [[ "${STATUS}" == 204 && -z "${BODY}" ]] || fail 'forfeited-source admission expected HTTP 204 with no body'
assert_sql 'recent raw fallback never queues a null forfeited start' "select m.event_at is null
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id=m.member_user_id and session_id=m.session_id)
  and not exists(select 1 from app_public.notification_intents where lifter_user_id=m.member_user_id and session_id=m.session_id)
  from app_public.notification_workout_moments m
  where m.member_user_id='${B_UID}' and m.session_id='recovery-${RUN_TAG}' and m.kind='start';"
next_cuam
push "${B_TOKEN}" 'reopen workout whose first completion capture failed' \
  "$(e_session "${LOST_COMPLETION}" "$((NOW_MS-90001000))" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'later completion cannot replace missing original timing' \
  "$(e_session "${LOST_COMPLETION}" "$((NOW_MS-90001000))" completed "$((NOW_MS+1000))" 90002 null "${CUAM}")"
confirm "${B_TOKEN}" "${LOST_COMPLETION}" "$(manifest "${B_UID}" "${LOST_COMPLETION}")"; check 'missing first completion proof rejected' '.confirmed==false'
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
assert_sql 'lost first completion never produces a current replay' "select event_at is null
  and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${LOST_COMPLETION}')
  from app_public.notification_workout_moments where member_user_id='${B_UID}' and session_id='${LOST_COMPLETION}' and kind='completion';"
MISSED_SHARE="missed-share-${RUN_TAG}"
run_psql 'alter table app_public.group_session_shares add constraint notification_test_share check(false) not valid;' >/dev/null
next_cuam
push "${B_TOKEN}" 'missed share keeps private sync' "$(e_session "${MISSED_SHARE}" "${NOW_MS}" active null null null "${CUAM}")"
run_psql 'alter table app_public.group_session_shares drop constraint notification_test_share;
  select app_public.notification_admit_moments(20);' >/dev/null
# Nothing repairs a failed trigger later: that start alert is lost, and admission keeps nothing to retry.
assert_sql 'missed share loses only its start alert' "select exists(select 1 from app_public.notification_workout_moments
    where member_user_id='${B_UID}' and session_id='${MISSED_SHARE}' and kind='start' and event_at is not null)
  and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${MISSED_SHARE}')
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id='${B_UID}' and session_id='${MISSED_SHARE}');"
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
assert_sql 'a later admission pass never repairs the missed share' "select not exists(select 1 from app_public.group_session_shares
    where member_user_id='${B_UID}' and session_id='${MISSED_SHARE}')
  and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${MISSED_SHARE}');"
# The start moment queues its source once; descendant writes queue nothing; a plain worker run admits it.
WORKER_START="worker-start-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'start queued for the worker' "$(e_session "${WORKER_START}" "${NOW_MS}" active null null null "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'set during the queued workout' "$(e_se "${WORKER_START}-block" "${WORKER_START}" "def-B-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${WORKER_START}-set" "${WORKER_START}-block" 0 100 1 '' "${CUAM}")"
assert_sql 'a start moment queues its source once, sets queue nothing' "select count(*)=1 from app_public.notification_moment_queue
  where member_user_id='${B_UID}' and session_id='${WORKER_START}';"
drain_worker
assert_sql 'one worker run admits the queued start and forgets it' "select exists(select 1 from app_public.notification_intents
    where recipient_user_id='${A_UID}' and lifter_user_id='${B_UID}' and session_id='${WORKER_START}' and kind='start')
  and not exists(select 1 from app_public.notification_moment_queue where member_user_id='${B_UID}' and session_id='${WORKER_START}');"
# A device clock more than 5 minutes fast: the start waits in the queue until it is admissible.
AHEAD_START="ahead-start-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'start from a fast device clock' "$(e_session "${AHEAD_START}" "$((NOW_MS+1800000))" active null null null "${CUAM}")"
run_psql 'select app_public.notification_admit_moments(20);' >/dev/null
assert_sql 'a future start stays queued until five minutes before it, unsent' "select count(*)=1
    and bool_and(q.available_at=to_timestamp(${NOW_MS}/1000.0)+interval '25 minutes')
    and not exists(select 1 from app_public.notification_intents where lifter_user_id='${B_UID}' and session_id='${AHEAD_START}')
  from app_public.notification_moment_queue q where q.member_user_id='${B_UID}' and q.session_id='${AHEAD_START}';"
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
# Source and unrelated disclosure changes between two captures must abort the whole publication.
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
run_psql "select app_public.notification_admit_moments(20);
  update app_public.group_eval_queue set available_at=now()+interval '1 hour'
    where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}');
  select app_public.group_metric_eval_enqueue('${G1}','${X1}','set');
  update app_public.group_metric_eval_queue set available_at=now()+interval '1 hour' where group_exercise_id='${X2}';
  alter table app_public.group_eval_queue add constraint notification_test_disclosure check(member_user_id<>'${C_UID}'::uuid) not valid;" >/dev/null
for race_kind in disclosure source; do
run_psql "update app_public.group_metric_eval_queue set available_at=now(),claimed_until=null,claim_id=null
  where group_exercise_id='${X1}';" >/dev/null
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
if [[ "${race_kind}" == disclosure ]]; then
next_cuam
bounded_rpc "${C_TOKEN}" sync_push "$(e_link "def-C-${RUN_TAG}" "${G1}" "${NORMALIZED_EXERCISE}" "${CUAM}" null "${NORMALIZED_LINK}" | jq '{entities:[.]}')"
expect_ok 'normalized link commits between common-board captures'; check 'normalized link acknowledged' '.ok==true'
assert_sql 'normalized link changed disclosure without changing the accepted ordinary graph' "select
  app_public.notification_comparison_digest('${G1}','${X1}')='${BENCH_DIGEST}'
  and app_public.group_competition_redacts_exercise(array['${G1}'::uuid],'${C_UID}','def-C-${RUN_TAG}');"
else
run_psql "begin; select set_config('request.jwt.claim.sub','${C_UID}',true);
  update app_public.exercise_sets set weight_value='201' where owner_user_id='${C_UID}' and id='set-C-${RUN_TAG}'; commit;" >/dev/null
assert_sql 'raw source commits while the second capture is blocked' "select
  app_public.notification_comparison_digest('${G1}','${X1}')<>'${BENCH_DIGEST}';"
fi
printf 'rollback;\n\\q\n' >&9
exec 9>&- 10<&-
wait "${HOLDER_PID}"; HOLDER_PID=""
wait "${HANDOFF_PID}"; HANDOFF_PID=""
IFS= read -r STATUS <"${RACE_DIR}/result"
BODY="$(tail -n +2 "${RACE_DIR}/result")"
expect_ok "${race_kind}-raced evaluator returns safely"; check "${race_kind} race publication fails atomically" '.failed>=1'
assert_sql 'no divergent ordinary baselines escaped the failed publication' "select not exists(select 1 from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}') and group_exercise_id='${X1}')
  and exists(select 1 from app_public.group_metric_eval_queue where group_exercise_id='${X1}' and last_sqlstate='P0001');"
run_psql "delete from app_public.exercise_group_links where owner_user_id='${C_UID}' and id='${NORMALIZED_LINK}';
  begin; select set_config('request.jwt.claim.sub','${C_UID}',true);
  update app_public.exercise_sets set weight_value='200' where owner_user_id='${C_UID}' and id='set-C-${RUN_TAG}'; commit;" >/dev/null
done
run_psql "alter table app_public.group_eval_queue drop constraint notification_test_disclosure;
  delete from app_public.exercise_group_links where owner_user_id='${C_UID}' and id='${NORMALIZED_LINK}';
  update app_public.group_eval_queue set available_at=now() where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}');
  update app_public.group_metric_eval_queue set available_at=now(),claimed_until=null,claim_id=null where group_exercise_id in('${X1}','${X2}');" >/dev/null
drain_eval
assert_sql 'retry captures one coherent actual board for both workouts' "select count(*)=2 and count(distinct before_ranks)=1
  and count(distinct final_ranks)=1 and bool_and(evaluated) from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id in('${COMMON_A}','${COMMON_B}') and group_exercise_id='${X1}';"
# A publication builds its source graph twice: once before its writes and once
# for the final source check, which still rejects a source moved after the first.
# Next to a bodyweight-aware comparison, capture asks disclosure once per
# definition per statement (32 calls a publish), never once per score row: the
# per-row form made 20,824 calls over this 1,300-set history.
PUBLISH_SAMPLES="$(docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -f - \
  <"${SUPABASE_DIR}/tests/group-metric-publish-benchmark.sql" | grep '^\[')" || fail 'publish benchmark fixture failed'
jq -e 'length==5 and all(.[];.graph_calls==2) and all(.[0:3][],.[4];.completed==true and .rejected==null)
  and .[3].rejected=="P0001 notification capture source moved" and .[4].step=="disclosure"
  and all(.[];.redaction_calls<=40)' <<<"${PUBLISH_SAMPLES}" >/dev/null ||
  fail "publish graph reuse, late source check or disclosure reuse regressed: ${PUBLISH_SAMPLES}"
# With nobody training, a sweep writes nothing and calls no worker, and worker
# preparation reads the same few pages however many workouts, sessions and
# accepted pushes exist.
IDLE_SAMPLES="$(docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -f - \
  <"${SUPABASE_DIR}/tests/notification-idle-benchmark.sql" | grep '^\[')" || fail 'idle benchmark fixture failed'
jq -e 'length==9 and all(.[0:8][];.rows_written==0 and .proof_calls==0 and .graph_calls==0 and .worker_posts==0 and .temp_pages==0)
  and all(.[]|select(.step=="prepare");.pages<=20) and all(.[]|select(.step|test("sweep$"));.pages<=1000)
  and .[4].sessions>2*.[2].sessions and .[4].pages<=.[2].pages*1.25
  and ([.[]|select(.step=="receipts_sweep")]|length==2 and .[1].pages<=.[0].pages+5) and .[8].worker_posts==1' <<<"${IDLE_SAMPLES}" >/dev/null ||
  fail "idle notification background regressed: ${IDLE_SAMPLES}"
printf '[notification-workout-events] idle benchmark (server-wide WAL is diagnostic): %s\n' "${IDLE_SAMPLES}"
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
  drain_eval
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
assert_sql 'mode round trip starts from a known published baseline' "select baseline_known from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'source mode moves away from its original interpretation' "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
next_cuam
push "${B_TOKEN}" 'source mode returns with a newly performed improvement' \
  "$(e_def "attr-def-B-${RUN_TAG}" Bench "${CUAM}" total_load)" "$(e_attr_set 105)"
assert_attribution_count 0 'mode round trip erased the incompatible source epoch'
assert_sql 'newer source epoch uses the actual board as its counterfactual' "select without_workout=final_ranks
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${ATTR_SESSION}' and group_exercise_id='${ATTR_EXERCISE}';"
assert_sql 'same literal mode has a newer epoch than the captured baseline' "select exists(
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
check 'completion activity and bests remain available when ranks fail closed' '.kind=="completion" and .heading=="Finished a workout at a secret location" and .bestCount==2 and .rankCount==0'
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
seed_published_workout_baseline
certify_attribution_set
assert_attribution_count 0 'standalone first Certified admission claimed an unchanged performed source'
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
seed_published_workout_baseline
next_cuam
push "${B_TOKEN}" 'genuine improved source precedes its new witness' "$(e_attr_set 107)"
drain_eval
certify_attribution_set
assert_attribution_count 2 'qualifying witness suppressed Certified admission of a genuinely improved source'
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
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Independent board context",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create independent board context comparison'; INDEP_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
INDEP_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${INDEP_EXERCISE}';")"
next_cuam
push "${B_TOKEN}" 'independent Volume and 1RM definitions' \
  "$(e_def "indep-volume-${RUN_TAG}" Bench "${CUAM}" per_side_load)" \
  "$(e_link "indep-volume-${RUN_TAG}" "${G2}" "${INDEP_EXERCISE}" "${CUAM}")" \
  "$(e_def "indep-e1rm-${RUN_TAG}" Bench "${CUAM}" total_load)" \
  "$(e_link "indep-e1rm-${RUN_TAG}" "${G2}" "${INDEP_EXERCISE}" "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'independent comparison peer definition' "$(e_def "indep-peer-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "indep-peer-${RUN_TAG}" "${G2}" "${INDEP_EXERCISE}" "${CUAM}")"
INDEP_SESSION="indep-workout-${RUN_TAG}"; INDEP_VOLUME_BLOCK="indep-volume-block-${RUN_TAG}"; INDEP_E1RM_BLOCK="indep-e1rm-block-${RUN_TAG}"
INDEP_VOLUME_SET="indep-volume-set-${RUN_TAG}"; INDEP_E1RM_SET="indep-e1rm-set-${RUN_TAG}"
next_cuam; INDEP_CREATED="${CUAM}"
push "${B_TOKEN}" 'separate published Volume and 1RM winners' "$(e_session "${INDEP_SESSION}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "${INDEP_VOLUME_BLOCK}" "${INDEP_SESSION}" "indep-volume-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "${INDEP_VOLUME_SET}" "${INDEP_VOLUME_BLOCK}" 0 20 10 '' "${CUAM}")" \
  "$(e_se "${INDEP_E1RM_BLOCK}" "${INDEP_SESSION}" "indep-e1rm-${RUN_TAG}" 1 Bench "${CUAM}")" \
  "$(e_set "${INDEP_E1RM_SET}" "${INDEP_E1RM_BLOCK}" 0 100 1 '' "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'peer sits between old and final independent outcomes' \
  "$(e_session "indep-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "indep-peer-block-${RUN_TAG}" "indep-peer-session-${RUN_TAG}" "indep-peer-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "indep-peer-volume-set-${RUN_TAG}" "indep-peer-block-${RUN_TAG}" 0 30 10 '' "${CUAM}")" \
  "$(e_set "indep-peer-e1rm-set-${RUN_TAG}" "indep-peer-block-${RUN_TAG}" 1 105 1 '' "${CUAM}")"
drain_eval
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}';
  select app_public.notification_capture_comparison('${G2}','${INDEP_EXERCISE}',${INDEP_REV},false);" >/dev/null
assert_sql 'the two metric baselines use independent source contexts' "select jsonb_array_length(baseline_scores)=2
  and baseline_scores@>jsonb_build_array(jsonb_build_object('metric','volume','certified',false,'set_id','${INDEP_VOLUME_SET}',
    'source_load_input_mode','per_side_load','value',400))
  and baseline_scores@>jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,'set_id','${INDEP_E1RM_SET}',
    'source_load_input_mode','total_load','value',100)) from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}' and group_exercise_id='${INDEP_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'Volume context changes while independent 1RM improves' \
  "$(e_def "indep-volume-${RUN_TAG}" Bench "${CUAM}" total_load)" \
  "$(e_set "${INDEP_E1RM_SET}" "${INDEP_E1RM_BLOCK}" 0 110 1 '' "${CUAM}" | jq --argjson c "${INDEP_CREATED}" '.fields.created_at=$c')" \
  "$(e_session "${INDEP_SESSION}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "${INDEP_SESSION}" "$(manifest "${B_UID}" "${INDEP_SESSION}")"; check 'independent context graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${INDEP_SESSION}"
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==2' <<<"${COUNTS}" >/dev/null || fail 'Volume context suppressed independent 1RM movements'
assert_sql 'fallback is keyed by metric and board scope and remains ready' "select app_public.notification_workout_ready(member_user_id,session_id)
  and (select jsonb_agg(r order by r->>'rank') from jsonb_array_elements(without_workout) r where r->>'metric'='volume')=
    (select jsonb_agg(r order by r->>'rank') from jsonb_array_elements(final_ranks) r where r->>'metric'='volume')
  and (select jsonb_agg(r order by r->>'rank') from jsonb_array_elements(without_workout) r where r->>'metric'='e1rm')=
    (select jsonb_agg(r order by r->>'rank') from jsonb_array_elements(before_ranks) r where r->>'metric'='e1rm')
  and before_ranks<>final_ranks from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}' and group_exercise_id='${INDEP_EXERCISE}';"
INDEP_PEER_VOLUME_CREATED="$(run_psql "select created_at from app_public.exercise_sets where owner_user_id='${C_UID}' and id='indep-peer-volume-set-${RUN_TAG}';")"
INDEP_PEER_E1RM_CREATED="$(run_psql "select created_at from app_public.exercise_sets where owner_user_id='${C_UID}' and id='indep-peer-e1rm-set-${RUN_TAG}';")"
next_cuam
push "${B_TOKEN}" 'prepare mode-only winner promotion sources' \
  "$(e_set "${INDEP_VOLUME_SET}" "${INDEP_VOLUME_BLOCK}" 0 60 2 '' "${CUAM}" | jq --argjson c "${INDEP_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "${INDEP_E1RM_SET}" "${INDEP_E1RM_BLOCK}" 0 100 1 '' "${CUAM}" | jq --argjson c "${INDEP_CREATED}" '.fields.created_at=$c')" \
  "$(e_def "indep-nonwinner-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "indep-nonwinner-${RUN_TAG}" "${G2}" "${INDEP_EXERCISE}" "${CUAM}")"
next_cuam; NONWINNER_CREATED="${CUAM}"
NONWINNER_BLOCK="indep-nonwinner-block-${RUN_TAG}"; NONWINNER_SET="indep-nonwinner-set-${RUN_TAG}"
push "${B_TOKEN}" 'publish a source absent from every original numeric winner' \
  "$(e_se "${NONWINNER_BLOCK}" "${INDEP_SESSION}" "indep-nonwinner-${RUN_TAG}" 2 Bench "${CUAM}")" \
  "$(e_set "${NONWINNER_SET}" "${NONWINNER_BLOCK}" 0 60 1 '' "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'one peer threshold for mode-only promotions' \
  "$(e_set "indep-peer-volume-set-${RUN_TAG}" "indep-peer-block-${RUN_TAG}" 0 30 10 '' "${CUAM}" "${NOW_MS}" | jq --argjson c "${INDEP_PEER_VOLUME_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "indep-peer-e1rm-set-${RUN_TAG}" "indep-peer-block-${RUN_TAG}" 1 110 1 '' "${CUAM}" | jq --argjson c "${INDEP_PEER_E1RM_CREATED}" '.fields.created_at=$c')"
drain_eval
seed_independent_baseline() {
  run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}';
    delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}';
    select app_public.notification_capture_comparison('${G2}','${INDEP_EXERCISE}',${INDEP_REV},false);" >/dev/null
}
check_independent_origin() {
  confirm "${B_TOKEN}" "${INDEP_SESSION}" "$(manifest "${B_UID}" "${INDEP_SESSION}")"; check 'origin graph confirmed' '.confirmed==true'
  drain_eval
  prepare_outcome "${B_UID}" "${INDEP_SESSION}"
  jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail "$1"
}
seed_independent_baseline
assert_sql 'original numeric winners differ from the latent promoted source' "select jsonb_array_length(baseline_scores)=2
  and baseline_scores@>jsonb_build_array(jsonb_build_object('metric','volume','set_id','${INDEP_VOLUME_SET}','value',120),
    jsonb_build_object('metric','e1rm','set_id','${INDEP_E1RM_SET}','value',100))
  and not exists(select 1 from jsonb_array_elements(baseline_scores) b where b->>'set_id'='${NONWINNER_SET}')
  and source_controls?'${NONWINNER_SET}' from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}' and group_exercise_id='${INDEP_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'mode-only Volume source becomes the final 1RM winner' "$(e_def "indep-volume-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
check_independent_origin 'a changed final winning source manufactured 1RM rank origins'
assert_sql 'mode promotion really crossed the peer and substituted the 1RM winner' "select before_ranks<>final_ranks
  and exists(select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=t.group_exercise_id
    and e.member_user_id=t.member_user_id and e.metric='e1rm' and not e.certified and e.set_id='${INDEP_VOLUME_SET}' and e.value>110)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}' and group_exercise_id='${INDEP_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'restore original Volume interpretation for latent-source baseline' "$(e_def "indep-volume-${RUN_TAG}" Bench "${CUAM}" total_load)"
drain_eval
seed_independent_baseline
next_cuam
push "${B_TOKEN}" 'mode alone promotes the formerly nonwinning source' "$(e_def "indep-nonwinner-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
check_independent_origin 'a source absent from the four numeric baselines manufactured rank origins'
assert_sql 'the formerly nonwinning set is now the final 1RM winner' "select exists(select 1 from app_public.group_metric_board_entries
  where group_exercise_id='${INDEP_EXERCISE}' and member_user_id='${B_UID}' and metric='e1rm' and not certified
    and set_id='${NONWINNER_SET}' and value>110);"
next_cuam; MODE_FRESH_CREATED="${CUAM}"
push "${B_TOKEN}" 'fresh winner stays above a peer already crossed by metadata' \
  "$(e_set "mode-fresh-set-${RUN_TAG}" "${INDEP_E1RM_BLOCK}" 1 130 1 '' "${CUAM}")"
check_independent_origin 'a fresh winner claimed the earlier metadata-only crossing'
assert_sql 'metadata-promoted source still supports the current counterfactual placement' "select
  (select jsonb_agg(r order by r->>'member_user_id') from jsonb_array_elements(without_workout) r where r->>'metric'='e1rm')=
  (select jsonb_agg(r order by r->>'member_user_id') from jsonb_array_elements(final_ranks) r where r->>'metric'='e1rm')
  and exists(select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=t.group_exercise_id
    and e.member_user_id=t.member_user_id and e.metric='e1rm' and not e.certified and e.set_id='mode-fresh-set-${RUN_TAG}' and e.value=130)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='${INDEP_SESSION}' and group_exercise_id='${INDEP_EXERCISE}';"
next_cuam
push "${C_TOKEN}" 'peer rises above the unchanged metadata-promoted source' \
  "$(e_set "indep-peer-e1rm-set-${RUN_TAG}" "indep-peer-block-${RUN_TAG}" 1 135 1 '' "${CUAM}" | jq --argjson c "${INDEP_PEER_E1RM_CREATED}" '.fields.created_at=$c')"
next_cuam
push "${B_TOKEN}" 'performed improvement crosses the higher peer threshold' \
  "$(e_set "mode-fresh-set-${RUN_TAG}" "${INDEP_E1RM_BLOCK}" 1 140 1 '' "${CUAM}" | jq --argjson c "${MODE_FRESH_CREATED}" '.fields.created_at=$c')"
confirm "${B_TOKEN}" "${INDEP_SESSION}" "$(manifest "${B_UID}" "${INDEP_SESSION}")"; check 'higher peer crossing graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${INDEP_SESSION}"
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==2' <<<"${COUNTS}" >/dev/null || fail 'metadata-promoted old source suppressed a later performed 1RM crossing'
# Linking already-performed activity admits a comparison, without inventing a newly performed origin.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"First-link origin",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create first-link comparison'; LINK_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
next_cuam; LINK_OLD_CREATED="${CUAM}"
push "${B_TOKEN}" 'already performed active source before its first link' \
  "$(e_def "first-link-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_session "first-link-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "first-link-block-${RUN_TAG}" "first-link-session-${RUN_TAG}" "first-link-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "first-link-old-set-${RUN_TAG}" "first-link-block-${RUN_TAG}" 0 80 1 '' "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'first-link peer publishes before retroactive admission' \
  "$(e_def "first-link-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "first-link-peer-def-${RUN_TAG}" "${G2}" "${LINK_EXERCISE}" "${CUAM}")" \
  "$(e_session "first-link-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "first-link-peer-block-${RUN_TAG}" "first-link-peer-session-${RUN_TAG}" "first-link-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "first-link-peer-set-${RUN_TAG}" "first-link-peer-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
drain_eval
next_cuam
push "${B_TOKEN}" 'retroactive first link of the already-performed source' \
  "$(e_link "first-link-def-${RUN_TAG}" "${G2}" "${LINK_EXERCISE}" "${CUAM}")" \
  "$(e_session "first-link-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "first-link-session-${RUN_TAG}" "$(manifest "${B_UID}" "first-link-session-${RUN_TAG}")"; check 'retroactive first-link graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "first-link-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'retroactive first link invented performed rank origins'
next_cuam
push "${B_TOKEN}" 'old admitted source improves but stays below the peer' \
  "$(e_set "first-link-old-set-${RUN_TAG}" "first-link-block-${RUN_TAG}" 0 100 1 '' "${CUAM}" | jq --argjson c "${LINK_OLD_CREATED}" '.fields.created_at=$c')"
confirm "${B_TOKEN}" "first-link-session-${RUN_TAG}" "$(manifest "${B_UID}" "first-link-session-${RUN_TAG}")"; check 'below-threshold edited graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "first-link-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'admitted source improvement below the peer invented rank movement'
next_cuam
push "${B_TOKEN}" 'new performed source remains below the admitted peer threshold' "$(e_set "first-link-below-set-${RUN_TAG}" "first-link-block-${RUN_TAG}" 1 100 1 '' "${CUAM}")"
confirm "${B_TOKEN}" "first-link-session-${RUN_TAG}" "$(manifest "${B_UID}" "first-link-session-${RUN_TAG}")"; check 'new below-threshold graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "first-link-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'new below-peer source invented rank movement after admission'
next_cuam
push "${B_TOKEN}" 'new performed source after its valid link boundary' "$(e_set "first-link-new-set-${RUN_TAG}" "first-link-block-${RUN_TAG}" 2 130 1 '' "${CUAM}")"
confirm "${B_TOKEN}" "first-link-session-${RUN_TAG}" "$(manifest "${B_UID}" "first-link-session-${RUN_TAG}")"; check 'new linked performed graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "first-link-session-${RUN_TAG}"
jq -e '[.[]|.rank_count]|add>0' <<<"${COUNTS}" >/dev/null || fail 'genuinely performed linked source lost its valid rank origin'
assert_sql 'the new performed source satisfies the existing link boundary' "select s.created_at>=l.updated_at from app_public.exercise_sets s
  join app_public.exercise_group_links l on l.owner_user_id=s.owner_user_id and l.exercise_definition_id='first-link-def-${RUN_TAG}'
  where s.owner_user_id='${B_UID}' and s.id='first-link-new-set-${RUN_TAG}' and l.group_id='${G2}' and l.deleted_at is null;"
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Admission threshold",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create admitted threshold comparison'; ADMIT_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
next_cuam; ADMIT_CREATED="${CUAM}"
push "${B_TOKEN}" 'already-performed above-peer source before its control admission' \
  "$(e_def "admit-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_session "admit-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "admit-block-${RUN_TAG}" "admit-session-${RUN_TAG}" "admit-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "admit-old-set-${RUN_TAG}" "admit-block-${RUN_TAG}" 0 120 1 '' "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'admission peer threshold' "$(e_def "admit-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "admit-peer-def-${RUN_TAG}" "${G2}" "${ADMIT_EXERCISE}" "${CUAM}")" \
  "$(e_session "admit-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "admit-peer-block-${RUN_TAG}" "admit-peer-session-${RUN_TAG}" "admit-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "admit-peer-set-${RUN_TAG}" "admit-peer-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
drain_eval
next_cuam
push "${B_TOKEN}" 'metadata alone admits an already above-peer source' \
  "$(e_link "admit-def-${RUN_TAG}" "${G2}" "${ADMIT_EXERCISE}" "${CUAM}")" \
  "$(e_session "admit-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "admit-session-${RUN_TAG}" "$(manifest "${B_UID}" "admit-session-${RUN_TAG}")"; check 'above-peer admission confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "admit-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'control admission of an above-peer source created rank origins'
next_cuam
push "${B_TOKEN}" 'new source replaces corrected admission without a further crossing' \
  "$(e_set "admit-old-set-${RUN_TAG}" "admit-block-${RUN_TAG}" 0 80 1 '' "${CUAM}" | jq --argjson c "${ADMIT_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "admit-new-set-${RUN_TAG}" "admit-block-${RUN_TAG}" 1 130 1 '' "${CUAM}")"
confirm "${B_TOKEN}" "admit-session-${RUN_TAG}" "$(manifest "${B_UID}" "admit-session-${RUN_TAG}")"; check 'replacement admission graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "admit-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'replacement of an already above-peer admission invented a crossing'
assert_sql 'original admitted threshold remains frozen below the fresh replacement' "select admission_scores@>
  jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,'value',120)) and exists(
    select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=t.group_exercise_id and e.member_user_id=t.member_user_id
      and e.metric='e1rm' and not e.certified and e.set_id='admit-new-set-${RUN_TAG}' and e.value=130)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='admit-session-${RUN_TAG}' and group_exercise_id='${ADMIT_EXERCISE}';"
# Ended original witnesses do not veto a fresh performed and qualified Certified crossing.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Qualified source threshold",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create qualified source comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in original peer; do
  if [[ "${source}" == original ]]; then QUAL_USER="${B_UID}"; QUAL_TOKEN="${B_TOKEN}"; QUAL_WEIGHT=100; else QUAL_USER="${C_UID}"; QUAL_TOKEN="${C_TOKEN}"; QUAL_WEIGHT=110; fi
  next_cuam
  push "${QUAL_TOKEN}" 'publish original and peer witness thresholds' "$(e_def "qual-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "qual-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == original ]]; then QUAL_LOWER_CREATED="${CUAM}"; QUAL_FIRST_SET="qual-lower-set-${RUN_TAG}"; QUAL_WEIGHT=90; else QUAL_FIRST_SET="qual-peer-set-${RUN_TAG}"; fi
  push "${QUAL_TOKEN}" 'completed source retains its historical witness threshold' "$(e_session "qual-${source}-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
    "$(e_se "qual-${source}-block-${RUN_TAG}" "qual-${source}-session-${RUN_TAG}" "qual-${source}-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "${QUAL_FIRST_SET}" "qual-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
  drain_eval
done
next_cuam
push "${B_TOKEN}" 'higher original source replaces the lower published record' \
  "$(e_set "qual-original-set-${RUN_TAG}" "qual-original-block-${RUN_TAG}" 1 100 1 '' "${CUAM}")"
drain_eval
qualify_source_set() {
  if [[ -n "${3:-}" ]]; then
    rpc "${A_TOKEN}" group_competition_session_records "$(jq -nc --arg g "${G2}" --arg u "$1" --arg s "$3" \
      '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_ok 'read historical qualifying write token'
    QUAL_WRITE="$(jq -er --arg s "$2" '[.records[]|select(.event.set_id==$s)|.event.record_context.metrics[]|select(.metric=="e1rm")|.write_token][0]' <<<"${BODY}")"
  else
    rpc "${A_TOKEN}" group_competition_board "$(jq -nc --arg g "${G2}" --arg x "${QUAL_EXERCISE}" \
      '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false}')"; expect_ok 'read qualifying write token'
    QUAL_WRITE="$(jq -er --arg u "$1" --arg s "$2" '.entries[]|select(.member.user_id==$u and .performance.set_id==$s)|.write_token' <<<"${BODY}")"
  fi
  rpc "${A_TOKEN}" group_competition_certify "$(jq -nc --arg g "${G2}" --arg x "${QUAL_EXERCISE}" --arg u "$1" --arg s "$2" \
    --arg t "${QUAL_WRITE}" --argjson r "${QUAL_REV}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
  expect_ok 'real qualifying whole-set witness'; QUAL_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"; drain_eval
}
qualify_source_set "${B_UID}" "qual-lower-set-${RUN_TAG}" "qual-original-session-${RUN_TAG}"; QUAL_LOWER_CERT="${QUAL_CERT}"
qualify_source_set "${B_UID}" "qual-original-set-${RUN_TAG}"; QUAL_ORIGINAL_CERT="${QUAL_CERT}"
qualify_source_set "${C_UID}" "qual-peer-set-${RUN_TAG}"
qualified_certified_count() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    const { countWorkoutRankChanges } = await import(process.argv[3]);
    const job=JSON.parse(process.argv[1]), target=job.targets.find(t=>t.group_exercise_id===process.argv[2]);
    process.stdout.write(String(countWorkoutRankChanges(...[target.before,target.final,target.without_workout].map(rows=>rows.filter(r=>r.certified)),job.member_user_id)));
  ' "${TARGETS}" "${QUAL_EXERCISE}" "${SUPABASE_DIR}/../apps/mobile/src/notifications/workout-events.ts"
}
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='qual-original-session-${RUN_TAG}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='qual-original-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
for ended_cert in "${QUAL_ORIGINAL_CERT}" "${QUAL_LOWER_CERT}"; do
  rpc "${A_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${G2}" --arg c "${ended_cert}" \
    '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:"withdraw"}')"; expect_ok 'withdraw original whole-set witness'
done
next_cuam
push "${B_TOKEN}" 'lower performed edit after both original witnesses end' \
  "$(e_set "qual-lower-set-${RUN_TAG}" "qual-original-block-${RUN_TAG}" 0 95 1 '' "${CUAM}" | jq --argjson c "${QUAL_LOWER_CREATED}" '.fields.created_at=$c')" \
  "$(e_session "qual-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "qual-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "qual-original-session-${RUN_TAG}")"; check 'lower edit with ended witnesses confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "qual-original-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 0 ]] || fail 'lower edit after witness withdrawal invented Certified movement'
assert_sql 'both original witnesses ended and the lower-only control remains ready' "select
  (select count(*)=4 and bool_and(ended_at is not null and end_reason='withdrawn') from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id) in ('${QUAL_ORIGINAL_CERT}','${QUAL_LOWER_CERT}'))
  and app_public.notification_workout_ready(member_user_id,session_id)
  and not exists(select 1 from jsonb_array_elements(final_ranks) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='qual-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'fresh performed source crosses the peer after original withdrawal' \
  "$(e_set "qual-fresh-set-${RUN_TAG}" "qual-original-block-${RUN_TAG}" 2 130 1 '' "${CUAM}")" \
  "$(e_session "qual-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "qual-fresh-set-${RUN_TAG}"
confirm "${B_TOKEN}" "qual-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "qual-original-session-${RUN_TAG}")"; check 'fresh qualified graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "qual-original-session-${RUN_TAG}"
jq -e --arg g "${G2}" 'any(.[];.group_id==$g and .rank_count==8)' <<<"${COUNTS}" >/dev/null || fail 'withdrawn original witness vetoed a fresh qualified crossing'
QUAL_CERTIFIED_COUNT="$(qualified_certified_count)"
[[ "${QUAL_CERTIFIED_COUNT}" == 4 ]] || fail 'fresh qualified source did not retain both members Certified movements'
assert_sql 'fresh Certified crossing remains ready after both original witnesses end' "select without_workout<>final_ranks
  and app_public.notification_workout_ready(member_user_id,session_id)
  and not exists(select 1 from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='qual-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
assert_sql 'the original performed source is unchanged and its old witness withdrawn' "select s.weight_value='100' and s.reps_value='1' and
  (select count(*)=2 and bool_and(end_reason='withdrawn') from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${QUAL_ORIGINAL_CERT}')
  from app_public.exercise_sets s where owner_user_id='${B_UID}' and id='qual-original-set-${RUN_TAG}';"
# A new witness for the same old pin can require restoring an unrecorded lower source after its physical edit.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Same-pin lower recertification",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create same-pin recertification comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in original peer; do
  if [[ "${source}" == original ]]; then QUAL_TOKEN="${B_TOKEN}"; REQUAL_SET="requal-lower-set-${RUN_TAG}"; QUAL_WEIGHT=90;
  else QUAL_TOKEN="${C_TOKEN}"; REQUAL_SET="requal-peer-set-${RUN_TAG}"; QUAL_WEIGHT=110; fi
  next_cuam
  push "${QUAL_TOKEN}" 'same-pin comparison definitions' "$(e_def "requal-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "requal-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == original ]]; then REQUAL_LOWER_CREATED="${CUAM}"; else REQUAL_PEER_CREATED="${CUAM}"; fi
  push "${QUAL_TOKEN}" 'publish durable lower record before peer threshold' "$(e_session "requal-${source}-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
    "$(e_se "requal-${source}-block-${RUN_TAG}" "requal-${source}-session-${RUN_TAG}" "requal-${source}-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "${REQUAL_SET}" "requal-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
  drain_eval
done
next_cuam
push "${B_TOKEN}" 'published winner masks the original lower source' \
  "$(e_set "requal-original-set-${RUN_TAG}" "requal-original-block-${RUN_TAG}" 1 100 1 '' "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "requal-lower-set-${RUN_TAG}" "requal-original-session-${RUN_TAG}"; REQUAL_LOWER_CERT="${QUAL_CERT}"
qualify_source_set "${B_UID}" "requal-original-set-${RUN_TAG}"; REQUAL_ORIGINAL_CERT="${QUAL_CERT}"
qualify_source_set "${C_UID}" "requal-peer-set-${RUN_TAG}"
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='requal-original-session-${RUN_TAG}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='requal-original-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
assert_sql 'only the original winner has frozen numeric scores' "select jsonb_array_length(baseline_scores)=4 and
  not exists(select 1 from jsonb_array_elements(baseline_scores) b where b->>'set_id'='requal-lower-set-${RUN_TAG}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='requal-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
for ended_cert in "${REQUAL_ORIGINAL_CERT}" "${REQUAL_LOWER_CERT}"; do
  rpc "${A_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${G2}" --arg c "${ended_cert}" \
    '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:"withdraw"}')"; expect_ok 'withdraw same-pin original witness'
done
qualify_source_set "${B_UID}" "requal-lower-set-${RUN_TAG}" "requal-original-session-${RUN_TAG}"; REQUAL_NEW_CERT="${QUAL_CERT}"
[[ "${REQUAL_NEW_CERT}" != "${REQUAL_LOWER_CERT}" ]] || fail 'same-pin recertification reused the withdrawn witness'
assert_sql 'replacement witness retains the original performed pin' "select count(*)=2 and bool_and(ended_at is null and observed_set_pin in
  (select observed_set_pin from app_public.group_metric_certifications where coalesce(legacy_certification_id,witness_certification_id,id)='${REQUAL_LOWER_CERT}'))
  from app_public.group_metric_certifications where coalesce(legacy_certification_id,witness_certification_id,id)='${REQUAL_NEW_CERT}';"
next_cuam
push "${B_TOKEN}" 'physical edit voids replacement witness while a fresh source arrives' \
  "$(e_set "requal-lower-set-${RUN_TAG}" "requal-original-block-${RUN_TAG}" 0 95 1 '' "${CUAM}" | jq --argjson c "${REQUAL_LOWER_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "requal-fresh-set-${RUN_TAG}" "requal-original-block-${RUN_TAG}" 2 130 1 '' "${CUAM}")" \
  "$(e_session "requal-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'peer independently falls below the original lower source' \
  "$(e_set "requal-peer-set-${RUN_TAG}" "requal-peer-block-${RUN_TAG}" 0 85 1 '' "${CUAM}" | jq --argjson c "${REQUAL_PEER_CREATED}" '.fields.created_at=$c')"
drain_eval
qualify_source_set "${C_UID}" "requal-peer-set-${RUN_TAG}"
qualify_source_set "${B_UID}" "requal-fresh-set-${RUN_TAG}"
confirm "${B_TOKEN}" "requal-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "requal-original-session-${RUN_TAG}")"; check 'same-pin recertified graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "requal-original-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 0 ]] || fail 'same-pin physically voided lower witness manufactured Certified crossing'
assert_sql 'replacement witness is physically voided and scoped Certified attribution fails closed' "select
  (select count(*)=2 and bool_and(end_reason='voided' and ended_at is not null) from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${REQUAL_NEW_CERT}')
  and app_public.notification_workout_ready(member_user_id,session_id)
  and (select jsonb_agg(r order by r->>'metric',r->>'member_user_id') from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean)=
    (select jsonb_agg(r order by r->>'metric',r->>'member_user_id') from jsonb_array_elements(final_ranks) r where (r->>'certified')::boolean)
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='requal-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
# Current qualification can promote an original All-only scalar into the Certified counterfactual.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"All-only original qualification",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create All-only original comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in original peer; do
  if [[ "${source}" == original ]]; then QUAL_TOKEN="${B_TOKEN}"; QUAL_WEIGHT=90; else QUAL_TOKEN="${C_TOKEN}"; QUAL_WEIGHT=110; fi
  next_cuam
  push "${QUAL_TOKEN}" 'All-only original comparison definitions' "$(e_def "allonly-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "allonly-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == original ]]; then ALLONLY_CREATED="${CUAM}"; fi
  push "${QUAL_TOKEN}" 'publish All-only original and peer' "$(e_session "allonly-${source}-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
    "$(e_se "allonly-${source}-block-${RUN_TAG}" "allonly-${source}-session-${RUN_TAG}" "allonly-${source}-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "allonly-${source}-set-${RUN_TAG}" "allonly-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
done
drain_eval
qualify_source_set "${C_UID}" "allonly-peer-set-${RUN_TAG}"
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='allonly-original-session-${RUN_TAG}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='allonly-original-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
ALLONLY_CAPTURE_AT="$(run_psql 'select clock_timestamp();')"
assert_sql 'original source has only two All scalar baselines and no old qualification' "select jsonb_array_length(baseline_scores)=2
  and not exists(select 1 from jsonb_array_elements(baseline_scores) b where (b->>'certified')::boolean or (b->>'value')::numeric<>90)
  and source_controls->'allonly-original-set-${RUN_TAG}'->'certified_metrics'='[]'::jsonb
  and not exists(select 1 from jsonb_array_elements(before_ranks) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='allonly-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
qualify_source_set "${B_UID}" "allonly-original-set-${RUN_TAG}"; ALLONLY_CERT="${QUAL_CERT}"
assert_sql 'unchanged original qualification is created after the frozen All-only capture' "select
  (select count(*)=2 and bool_and(certified_at>='${ALLONLY_CAPTURE_AT}' and ended_at is null) from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${ALLONLY_CERT}')
  and source_controls->'allonly-original-set-${RUN_TAG}'->'certified_metrics'='[]'::jsonb
  and (select count(*)=2 and bool_and((r->>'rank')::int=2) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='allonly-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'physical edit voids new qualification while a fresh source crosses' \
  "$(e_set "allonly-original-set-${RUN_TAG}" "allonly-original-block-${RUN_TAG}" 0 95 1 '' "${CUAM}" | jq --argjson c "${ALLONLY_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "allonly-fresh-set-${RUN_TAG}" "allonly-original-block-${RUN_TAG}" 1 130 1 '' "${CUAM}")" \
  "$(e_session "allonly-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "allonly-fresh-set-${RUN_TAG}"
confirm "${B_TOKEN}" "allonly-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "allonly-original-session-${RUN_TAG}")"; check 'All-only current-qualification graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "allonly-original-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 2 ]] || fail 'current qualification lost the old All scalar or invented an initial own Certified placement'
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==6' <<<"${COUNTS}" >/dev/null || fail 'All-only original qualification suppressed valid All and peer Certified crossings'
assert_sql 'newly voided witness restores the original All scalar to Certified rank two' "select
  (select count(*)=2 and bool_and(end_reason='voided' and ended_at is not null) from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${ALLONLY_CERT}')
  and app_public.notification_workout_ready(member_user_id,session_id)
  and (select count(*)=2 and bool_and((r->>'rank')::int=2) from jsonb_array_elements(without_workout) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='allonly-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
# An originally Certified lower scalar also restores All placement after its higher All source loses its link.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Certified scalar restores All",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create Certified-to-All comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in original peer; do
  if [[ "${source}" == original ]]; then QUAL_TOKEN="${B_TOKEN}"; QUAL_WEIGHT=100; else QUAL_TOKEN="${C_TOKEN}"; QUAL_WEIGHT=95; fi
  next_cuam
  push "${QUAL_TOKEN}" 'Certified-to-All comparison definitions' "$(e_def "symmetry-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "symmetry-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == original ]]; then SYMMETRY_CREATED="${CUAM}"; fi
  push "${QUAL_TOKEN}" 'publish durable lower original record and All-only peer' "$(e_session "symmetry-${source}-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
    "$(e_se "symmetry-${source}-block-${RUN_TAG}" "symmetry-${source}-session-${RUN_TAG}" "symmetry-${source}-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "symmetry-${source}-set-${RUN_TAG}" "symmetry-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
  drain_eval
done
next_cuam
push "${B_TOKEN}" 'higher All-only source wins above the lower original record' \
  "$(e_def "symmetry-winner-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "symmetry-winner-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
next_cuam
push "${B_TOKEN}" 'publish the higher All-only source' \
  "$(e_se "symmetry-winner-block-${RUN_TAG}" "symmetry-original-session-${RUN_TAG}" "symmetry-winner-def-${RUN_TAG}" 1 Bench "${CUAM}")" \
  "$(e_set "symmetry-winner-set-${RUN_TAG}" "symmetry-winner-block-${RUN_TAG}" 0 120 1 '' "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "symmetry-original-set-${RUN_TAG}" "symmetry-original-session-${RUN_TAG}"; SYMMETRY_CERT="${QUAL_CERT}"
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='symmetry-original-session-${RUN_TAG}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='symmetry-original-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
SYMMETRY_BASELINE="$(run_psql "select baseline_scores from app_public.notification_workout_targets where member_user_id='${B_UID}'
  and session_id='symmetry-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';")"
assert_sql 'All and Certified retain different original scalar winners' "select jsonb_array_length(baseline_scores)=4
  and (select count(*)=2 and bool_and((b->>'certified')::boolean and (b->>'value')::numeric=100)
    from jsonb_array_elements(baseline_scores) b where b->>'set_id'='symmetry-original-set-${RUN_TAG}')
  and (select count(*)=2 and bool_and(not (b->>'certified')::boolean and (b->>'value')::numeric=120)
    from jsonb_array_elements(baseline_scores) b where b->>'set_id'='symmetry-winner-set-${RUN_TAG}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='symmetry-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'unlink higher All source and physically edit Certified lower source' \
  "$(e_link "symmetry-winner-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}" "${NOW_MS}")" \
  "$(e_set "symmetry-original-set-${RUN_TAG}" "symmetry-original-block-${RUN_TAG}" 0 90 1 '' "${CUAM}" | jq --argjson c "${SYMMETRY_CREATED}" '.fields.created_at=$c')" \
  "$(e_session "symmetry-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "symmetry-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "symmetry-original-session-${RUN_TAG}")"; check 'Certified-to-All graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "symmetry-original-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 2 ]] || fail 'Certified-to-All restoration lost the physically voided own Certified placements'
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==6' <<<"${COUNTS}" >/dev/null || fail 'frozen Certified scalar did not restore four causal All movements'
assert_sql 'frozen Certified scalar restores All without adding stored numeric history' "select baseline_scores='${SYMMETRY_BASELINE}'::jsonb
  and app_public.notification_workout_ready(member_user_id,session_id)
  and (select count(*)=2 and bool_and(ended_at is not null and end_reason='voided') from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${SYMMETRY_CERT}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(without_workout) r
    where not (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=2) from jsonb_array_elements(final_ranks) r
    where not (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(without_workout) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and not exists(select 1 from jsonb_array_elements(final_ranks) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='symmetry-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
# A same-pin witness voided by a source-mode round trip cannot qualify the subsequently captured All-only baseline.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Mode-invalid original qualification",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create mode-invalid witness comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in original peer; do
  if [[ "${source}" == original ]]; then QUAL_TOKEN="${B_TOKEN}"; QUAL_WEIGHT=100; else QUAL_TOKEN="${C_TOKEN}"; QUAL_WEIGHT=90; fi
  next_cuam
  push "${QUAL_TOKEN}" 'mode-invalid original comparison definitions' "$(e_def "modecert-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "modecert-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == original ]]; then MODECERT_CREATED="${CUAM}"; fi
  push "${QUAL_TOKEN}" 'publish original and Certified peer sources' "$(e_session "modecert-${source}-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
    "$(e_se "modecert-${source}-block-${RUN_TAG}" "modecert-${source}-session-${RUN_TAG}" "modecert-${source}-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
    "$(e_set "modecert-${source}-set-${RUN_TAG}" "modecert-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
done
drain_eval
qualify_source_set "${B_UID}" "modecert-original-set-${RUN_TAG}"; MODECERT_OLD_CERT="${QUAL_CERT}"
qualify_source_set "${C_UID}" "modecert-peer-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'source mode leaves the witnessed interpretation' "$(e_def "modecert-original-def-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
drain_eval
next_cuam
push "${B_TOKEN}" 'source mode returns without a new witness' "$(e_def "modecert-original-def-${RUN_TAG}" Bench "${CUAM}" total_load)"
drain_eval
assert_sql 'old same-pin witness is invalid specifically because its source epoch changed' "select count(*)=2 and bool_and(
  c.end_reason='voided' and c.ended_at is not null and c.observed_set_pin=x->>'observed_set_pin'
  and (c.pinned_fingerprint=s.fingerprint or c.current_fingerprint=s.fingerprint)
  and not app_public.group_metric_certification_mode_matches(c) and c.source_mode_generation=0 and s.source_mode_generation=2)
  from app_public.group_metric_certifications c join app_public.group_metric_set_scores s
    on s.group_exercise_id=c.group_exercise_id and s.member_user_id=c.member_user_id and s.set_id=c.set_id and s.metric=c.metric
  cross join lateral jsonb_array_elements(app_public.group_metric_eval_source_graph('${G2}','${QUAL_EXERCISE}')->'sets') x
  where coalesce(c.legacy_certification_id,c.witness_certification_id,c.id)='${MODECERT_OLD_CERT}'
    and x->>'set_id'=c.set_id and x->>'member_user_id'=c.member_user_id::text;"
run_psql "update app_public.notification_workouts set cutover_active=true where member_user_id='${B_UID}' and session_id='modecert-original-session-${RUN_TAG}';
  delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='modecert-original-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
assert_sql 'round-trip capture has only the current All100 baseline' "select jsonb_array_length(baseline_scores)=2
  and not exists(select 1 from jsonb_array_elements(baseline_scores) b where (b->>'certified')::boolean or (b->>'value')::numeric<>100)
  and not exists(select 1 from jsonb_array_elements(before_ranks) r where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='modecert-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'physical edit and fresh performed source follow the mode-invalid baseline' \
  "$(e_set "modecert-original-set-${RUN_TAG}" "modecert-original-block-${RUN_TAG}" 0 101 1 '' "${CUAM}" | jq --argjson c "${MODECERT_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "modecert-fresh-set-${RUN_TAG}" "modecert-original-block-${RUN_TAG}" 1 130 1 '' "${CUAM}")" \
  "$(e_session "modecert-original-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "modecert-fresh-set-${RUN_TAG}"
confirm "${B_TOKEN}" "modecert-original-session-${RUN_TAG}" "$(manifest "${B_UID}" "modecert-original-session-${RUN_TAG}")"; check 'mode-invalid current-qualification graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "modecert-original-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 4 ]] || fail 'mode-invalid old witness suppressed a fresh initial Certified crossing'
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==4' <<<"${COUNTS}" >/dev/null || fail 'mode-invalid witness manufactured All movement or lost fresh Certified movement'
assert_sql 'mode-invalid old witness cannot enter the Certified counterfactual' "select app_public.notification_workout_ready(member_user_id,session_id)
  and (select count(*)=2 and bool_and(r->>'member_user_id'='${C_UID}' and (r->>'rank')::int=1)
    from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean)
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=2) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${C_UID}')
  and (select count(*)=2 and bool_and(c.observed_set_pin=b->>'observed_set_pin'
      and (c.pinned_fingerprint=b->>'fingerprint' or c.current_fingerprint=b->>'fingerprint')
      and not app_public.group_metric_certification_mode_matches(c))
    from jsonb_array_elements(baseline_scores) b join app_public.group_metric_certifications c on c.metric=b->>'metric'
    where coalesce(c.legacy_certification_id,c.witness_certification_id,c.id)='${MODECERT_OLD_CERT}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='modecert-original-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
# First capture derives the original Certified cohort from current qualification even while the publisher cache is stale.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Stale original witness cohort",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create stale original-cohort comparison'; QUAL_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
QUAL_REV="$(run_psql "select rules_revision from app_public.group_exercises where id='${QUAL_EXERCISE}';")"
for source in stable obsolete high; do
  case "${source}" in stable) QUAL_WEIGHT=100; SOURCE_ORDER=0;; obsolete) QUAL_WEIGHT=110; SOURCE_ORDER=1;; high) QUAL_WEIGHT=120; SOURCE_ORDER=2;; esac
  next_cuam
  push "${B_TOKEN}" 'stale-cohort source definitions' "$(e_def "cohort-${source}-def-${RUN_TAG}" Bench "${CUAM}")" \
    "$(e_link "cohort-${source}-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")"
  next_cuam
  if [[ "${source}" == obsolete ]]; then COHORT_OBSOLETE_CREATED="${CUAM}"; fi
  push "${B_TOKEN}" 'publish successive real records before the All winner' \
    "$(e_session "cohort-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
    "$(e_se "cohort-${source}-block-${RUN_TAG}" "cohort-session-${RUN_TAG}" "cohort-${source}-def-${RUN_TAG}" "${SOURCE_ORDER}" Bench "${CUAM}")" \
    "$(e_set "cohort-${source}-set-${RUN_TAG}" "cohort-${source}-block-${RUN_TAG}" 0 "${QUAL_WEIGHT}" 1 '' "${CUAM}")"
  drain_eval
done
next_cuam
push "${C_TOKEN}" 'publish peer inside the two original Certified thresholds' \
  "$(e_def "cohort-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "cohort-peer-def-${RUN_TAG}" "${G2}" "${QUAL_EXERCISE}" "${CUAM}")" \
  "$(e_session "cohort-peer-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "cohort-peer-block-${RUN_TAG}" "cohort-peer-session-${RUN_TAG}" "cohort-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "cohort-peer-set-${RUN_TAG}" "cohort-peer-block-${RUN_TAG}" 0 105 1 '' "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "cohort-stable-set-${RUN_TAG}" "cohort-session-${RUN_TAG}"
qualify_source_set "${B_UID}" "cohort-obsolete-set-${RUN_TAG}" "cohort-session-${RUN_TAG}"; COHORT_OLD_CERT="${QUAL_CERT}"
qualify_source_set "${C_UID}" "cohort-peer-set-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'obsolete witness mode changes before the publisher can catch up' "$(e_def "cohort-obsolete-def-${RUN_TAG}" Bench "${CUAM}" per_side_load)"
next_cuam
push "${B_TOKEN}" 'obsolete mode returns with the old publication cache retained' "$(e_def "cohort-obsolete-def-${RUN_TAG}" Bench "${CUAM}" total_load)"
assert_sql 'cached original cohort still names the now mode-invalid witness' "select exists(select 1 from app_public.group_metric_board_state s
  join app_public.group_metric_certifications c on c.id=any(s.certification_ids)
  where s.group_exercise_id='${QUAL_EXERCISE}' and s.member_user_id='${B_UID}'
    and coalesce(c.legacy_certification_id,c.witness_certification_id,c.id)='${COHORT_OLD_CERT}'
    and not app_public.group_metric_certification_mode_matches(c)) and exists(select 1 from app_public.notification_workouts
      where member_user_id='${B_UID}' and session_id='cohort-session-${RUN_TAG}' and eligible and not cutover_active);"
run_psql "delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='cohort-session-${RUN_TAG}';
  select app_public.notification_capture_comparison('${G2}','${QUAL_EXERCISE}',${QUAL_REV},false);" >/dev/null
assert_sql 'first capture labels only the coherent original Certified source' "select baseline_known and not w.cutover_active
  and jsonb_array_length(t.baseline_scores)=4
  and (select count(*)=2 and bool_and((b->>'certified')::boolean and (b->>'value')::numeric=100)
    from jsonb_array_elements(t.baseline_scores) b where b->>'set_id'='cohort-stable-set-${RUN_TAG}')
  and (select count(*)=2 and bool_and(not (b->>'certified')::boolean and (b->>'value')::numeric=120)
    from jsonb_array_elements(t.baseline_scores) b where b->>'set_id'='cohort-high-set-${RUN_TAG}')
  and t.source_controls->'cohort-obsolete-set-${RUN_TAG}'->'certified_metrics'='[]'::jsonb
  from app_public.notification_workout_targets t join app_public.notification_workouts w
    on w.member_user_id=t.member_user_id and w.session_id=t.session_id
  where t.member_user_id='${B_UID}' and t.session_id='cohort-session-${RUN_TAG}' and t.group_exercise_id='${QUAL_EXERCISE}';"
drain_eval
qualify_source_set "${B_UID}" "cohort-obsolete-set-${RUN_TAG}" "cohort-session-${RUN_TAG}"; COHORT_NEW_CERT="${QUAL_CERT}"
[[ "${COHORT_NEW_CERT}" != "${COHORT_OLD_CERT}" ]] || fail 'obsolete source reused its mode-invalid witness'
assert_sql 'replacement unchanged witness belongs to the current source epoch' "select count(*)=2 and bool_and(ended_at is null
  and app_public.group_metric_certification_mode_matches(c)) from app_public.group_metric_certifications c
  where coalesce(legacy_certification_id,witness_certification_id,id)='${COHORT_NEW_CERT}';"
next_cuam
push "${B_TOKEN}" 'edit requalified old source while a fresh qualified crossing arrives' \
  "$(e_set "cohort-obsolete-set-${RUN_TAG}" "cohort-obsolete-block-${RUN_TAG}" 0 95 1 '' "${CUAM}" | jq --argjson c "${COHORT_OBSOLETE_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "cohort-fresh-set-${RUN_TAG}" "cohort-high-block-${RUN_TAG}" 1 130 1 '' "${CUAM}")" \
  "$(e_session "cohort-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
drain_eval
qualify_source_set "${B_UID}" "cohort-fresh-set-${RUN_TAG}"
confirm "${B_TOKEN}" "cohort-session-${RUN_TAG}" "$(manifest "${B_UID}" "cohort-session-${RUN_TAG}")"; check 'stale original-cohort graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "cohort-session-${RUN_TAG}"
[[ "$(qualified_certified_count)" == 0 ]] || fail 'stale original cohort label manufactured a peer Certified crossing'
assert_sql 'current original cohort keeps Certified attribution scoped and completion ready' "select
  app_public.notification_workout_ready(member_user_id,session_id)
  and source_controls->'cohort-obsolete-set-${RUN_TAG}'->'certified_metrics'='[]'::jsonb
  and (select count(*)=2 and bool_and(end_reason='voided' and ended_at is not null) from app_public.group_metric_certifications
    where coalesce(legacy_certification_id,witness_certification_id,id)='${COHORT_NEW_CERT}')
  and (select jsonb_agg(r order by r->>'metric',r->>'member_user_id') from jsonb_array_elements(without_workout) r where (r->>'certified')::boolean)=
    (select jsonb_agg(r order by r->>'metric',r->>'member_user_id') from jsonb_array_elements(final_ranks) r where (r->>'certified')::boolean)
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where (r->>'certified')::boolean and r->>'member_user_id'='${B_UID}')
  from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='cohort-session-${RUN_TAG}' and group_exercise_id='${QUAL_EXERCISE}';"
# A link admitted while the source is still planned does not establish a performed score threshold.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Planned first admission",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create planned first-admission comparison'; PLANNED_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
next_cuam; PLANNED_CREATED="${CUAM}"
push "${B_TOKEN}" 'old planned source predates its first comparison link' \
  "$(e_def "planned-admit-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_session "planned-admit-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "planned-admit-block-${RUN_TAG}" "planned-admit-session-${RUN_TAG}" "planned-admit-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "planned-admit-set-${RUN_TAG}" "planned-admit-block-${RUN_TAG}" 0 130 1 planned "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'publish peer before the planned-source admission' \
  "$(e_def "planned-admit-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "planned-admit-peer-def-${RUN_TAG}" "${G2}" "${PLANNED_EXERCISE}" "${CUAM}")" \
  "$(e_session "planned-admit-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "planned-admit-peer-block-${RUN_TAG}" "planned-admit-peer-session-${RUN_TAG}" "planned-admit-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "planned-admit-peer-set-${RUN_TAG}" "planned-admit-peer-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
drain_eval
next_cuam
push "${B_TOKEN}" 'first coherent link publication keeps the source planned' \
  "$(e_link "planned-admit-def-${RUN_TAG}" "${G2}" "${PLANNED_EXERCISE}" "${CUAM}")"
drain_eval
assert_sql 'planned admission freezes no counting metric or scalar threshold' "select evaluated and admission_scores='[]'::jsonb
  and source_controls->'planned-admit-set-${RUN_TAG}'->>'admission_pin' is not null
  and source_controls->'planned-admit-set-${RUN_TAG}'->'admission_metrics'='[]'::jsonb
  and not exists(select 1 from app_public.group_metric_set_scores s where s.group_exercise_id=t.group_exercise_id
    and s.member_user_id=t.member_user_id and s.set_id='planned-admit-set-${RUN_TAG}' and s.counting)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='planned-admit-session-${RUN_TAG}' and group_exercise_id='${PLANNED_EXERCISE}';"
next_cuam
push "${B_TOKEN}" 'perform the previously planned working source and complete' \
  "$(e_set "planned-admit-set-${RUN_TAG}" "planned-admit-block-${RUN_TAG}" 0 130 1 '' "${CUAM}" | jq --argjson c "${PLANNED_CREATED}" '.fields.created_at=$c')" \
  "$(e_session "planned-admit-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "planned-admit-session-${RUN_TAG}" "$(manifest "${B_UID}" "planned-admit-session-${RUN_TAG}")"; check 'newly performed admission graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "planned-admit-session-${RUN_TAG}"
jq -e --arg g "${G2}" 'length==1 and .[0].group_id==$g and .[0].rank_count==4' <<<"${COUNTS}" >/dev/null || fail 'planned admission suppressed its later first performed placement'
assert_sql 'first performed source crosses the published peer on both metrics' "select app_public.notification_workout_ready(member_user_id,session_id)
  and admission_scores='[]'::jsonb and source_controls->'planned-admit-set-${RUN_TAG}'->'admission_metrics'='[]'::jsonb
  and not exists(select 1 from jsonb_array_elements(before_ranks) r where r->>'member_user_id'='${B_UID}')
  and (select count(*)=2 and bool_and((r->>'rank')::int=1) from jsonb_array_elements(final_ranks) r
    where r->>'member_user_id'='${B_UID}' and not (r->>'certified')::boolean)
  and (select count(*)=2 from app_public.group_metric_board_entries e where e.group_exercise_id=t.group_exercise_id
    and e.member_user_id=t.member_user_id and not e.certified and e.set_id='planned-admit-set-${RUN_TAG}' and e.value=130)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='planned-admit-session-${RUN_TAG}' and group_exercise_id='${PLANNED_EXERCISE}';"
# First capture must not infer an old lower working score from its current warm-up effort.
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"First-capture effort",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create first-capture effort comparison'; EFFORT_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
next_cuam
push "${B_TOKEN}" 'first-capture original definitions and links' \
  "$(e_def "effort-winner-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "effort-winner-def-${RUN_TAG}" "${G2}" "${EFFORT_EXERCISE}" "${CUAM}")" \
  "$(e_def "effort-lower-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "effort-lower-def-${RUN_TAG}" "${G2}" "${EFFORT_EXERCISE}" "${CUAM}")"
next_cuam; EFFORT_CREATED="${CUAM}"
push "${B_TOKEN}" 'publish original working winner and lower source' \
  "$(e_session "effort-session-${RUN_TAG}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "effort-winner-block-${RUN_TAG}" "effort-session-${RUN_TAG}" "effort-winner-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "effort-winner-set-${RUN_TAG}" "effort-winner-block-${RUN_TAG}" 0 120 1 '' "${CUAM}")" \
  "$(e_se "effort-lower-block-${RUN_TAG}" "effort-session-${RUN_TAG}" "effort-lower-def-${RUN_TAG}" 1 Bench "${CUAM}")" \
  "$(e_set "effort-lower-set-${RUN_TAG}" "effort-lower-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
next_cuam; EFFORT_PEER_CREATED="${CUAM}"
push "${C_TOKEN}" 'publish original first-capture peer threshold' \
  "$(e_def "effort-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "effort-peer-def-${RUN_TAG}" "${G2}" "${EFFORT_EXERCISE}" "${CUAM}")" \
  "$(e_session "effort-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "effort-peer-block-${RUN_TAG}" "effort-peer-session-${RUN_TAG}" "effort-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "effort-peer-set-${RUN_TAG}" "effort-peer-block-${RUN_TAG}" 0 130 1 '' "${CUAM}")"
drain_eval
assert_sql 'first-capture source is eligible with old published lower working scores' "select w.eligible and not w.cutover_active and
  (select count(*)=2 and bool_and(counting) from app_public.group_metric_set_scores
    where group_exercise_id='${EFFORT_EXERCISE}' and member_user_id='${B_UID}' and set_id='effort-lower-set-${RUN_TAG}' and value=110)
  and exists(select 1 from app_public.group_metric_board_entries where group_exercise_id='${EFFORT_EXERCISE}'
    and member_user_id='${B_UID}' and metric='e1rm' and not certified and set_id='effort-winner-set-${RUN_TAG}' and value=120)
  from app_public.notification_workouts w where member_user_id='${B_UID}' and session_id='effort-session-${RUN_TAG}';"
run_psql "delete from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='effort-session-${RUN_TAG}';" >/dev/null
next_cuam
push "${B_TOKEN}" 'unlink winner and change lower effort before first notification capture' \
  "$(e_link "effort-winner-def-${RUN_TAG}" "${G2}" "${EFFORT_EXERCISE}" "${CUAM}" "${NOW_MS}")" \
  "$(e_set "effort-lower-set-${RUN_TAG}" "effort-lower-block-${RUN_TAG}" 0 110 1 '' "${CUAM}" null warm_up | jq --argjson c "${EFFORT_CREATED}" '.fields.created_at=$c')" \
  "$(e_set "effort-fresh-set-${RUN_TAG}" "effort-lower-block-${RUN_TAG}" 1 115 1 '' "${CUAM}")" \
  "$(e_session "effort-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'peer independently falls below the original lower source' \
  "$(e_set "effort-peer-set-${RUN_TAG}" "effort-peer-block-${RUN_TAG}" 0 105 1 '' "${CUAM}" | jq --argjson c "${EFFORT_PEER_CREATED}" '.fields.created_at=$c')"
confirm "${B_TOKEN}" "effort-session-${RUN_TAG}" "$(manifest "${B_UID}" "effort-session-${RUN_TAG}")"; check 'first-capture effort graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "effort-session-${RUN_TAG}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'unproved first-capture lower effort manufactured rank origins'
assert_sql 'first-capture old placement and lost effort remain private and completion ready' "select baseline_known
  and app_public.notification_workout_ready(member_user_id,session_id) and without_workout=final_ranks
  and before_ranks@>jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,'member_user_id','${B_UID}','rank',2))
  and final_ranks@>jsonb_build_array(jsonb_build_object('metric','e1rm','certified',false,'member_user_id','${B_UID}','rank',1))
  and (source_controls->'effort-lower-set-${RUN_TAG}'->>'counted')::boolean
  and exists(select 1 from app_public.group_metric_set_scores s where s.group_exercise_id=t.group_exercise_id
    and s.member_user_id=t.member_user_id and s.set_id='effort-lower-set-${RUN_TAG}' and not s.counting)
  from app_public.notification_workout_targets t where member_user_id='${B_UID}' and session_id='effort-session-${RUN_TAG}' and group_exercise_id='${EFFORT_EXERCISE}';"
rpc "${A_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${G2}" \
  '{p_group_id:$g,p_name:"Previously unscored rejoin",p_load_input_mode:"total_load",p_bodyweight_contribution:0,p_default_metric:"e1rm"}')"
expect_ok 'create first-admission rejoin comparison'; REJOIN_EXERCISE="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
REJOIN_SESSION="rejoin-unscored-${RUN_TAG}"
next_cuam
push "${B_TOKEN}" 'share active unlinked performance before leaving' "$(e_def "rejoin-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_session "${REJOIN_SESSION}" "${NOW_MS}" active null null null "${CUAM}")" \
  "$(e_se "rejoin-block-${RUN_TAG}" "${REJOIN_SESSION}" "rejoin-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "rejoin-set-${RUN_TAG}" "rejoin-block-${RUN_TAG}" 0 120 1 '' "${CUAM}")"
next_cuam
push "${C_TOKEN}" 'publish peer while the future rejoin source is uncounted' "$(e_def "rejoin-peer-def-${RUN_TAG}" Bench "${CUAM}")" \
  "$(e_link "rejoin-peer-def-${RUN_TAG}" "${G2}" "${REJOIN_EXERCISE}" "${CUAM}")" \
  "$(e_session "rejoin-peer-session-${RUN_TAG}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")" \
  "$(e_se "rejoin-peer-block-${RUN_TAG}" "rejoin-peer-session-${RUN_TAG}" "rejoin-peer-def-${RUN_TAG}" 0 Bench "${CUAM}")" \
  "$(e_set "rejoin-peer-set-${RUN_TAG}" "rejoin-peer-block-${RUN_TAG}" 0 110 1 '' "${CUAM}")"
drain_eval
rpc "${A_TOKEN}" group_invite_get "{\"p_group_id\":\"${G2}\"}"; expect_ok 'read real rejoin invitation'
REJOIN_CODE="$(jq -er '.code' <<<"${BODY}")"
rpc "${B_TOKEN}" group_leave "{\"p_group_id\":\"${G2}\"}"; expect_ok 'leave previously shared source group'
drain_eval
next_cuam
push "${B_TOKEN}" 'add old performance link while outside the group' "$(e_link "rejoin-def-${RUN_TAG}" "${G2}" "${REJOIN_EXERCISE}" "${CUAM}")"
assert_sql 'readmission has no prior accepted source score or notification target' "select exists(
  select 1 from app_public.group_session_shares where group_id='${G2}' and member_user_id='${B_UID}' and session_id='${REJOIN_SESSION}')
  and not exists(select 1 from app_public.group_metric_set_scores where group_exercise_id='${REJOIN_EXERCISE}' and member_user_id='${B_UID}' and counting)
  and not exists(select 1 from app_public.notification_workout_targets where member_user_id='${B_UID}' and session_id='${REJOIN_SESSION}');"
rpc "${B_TOKEN}" group_join "$(jq -nc --arg c "${REJOIN_CODE}" '{p_code:$c}')"; expect_ok 'rejoin previously shared source group'
next_cuam
push "${B_TOKEN}" 'finish the unchanged newly admitted old source' "$(e_session "${REJOIN_SESSION}" "${NOW_MS}" completed "$((NOW_MS+1000))" 1 null "${CUAM}")"
confirm "${B_TOKEN}" "${REJOIN_SESSION}" "$(manifest "${B_UID}" "${REJOIN_SESSION}")"; check 'old shared rejoin graph confirmed' '.confirmed==true'
drain_eval
prepare_outcome "${B_UID}" "${REJOIN_SESSION}"
jq -e 'all(.[];.rank_count==0)' <<<"${COUNTS}" >/dev/null || fail 'rejoining old unscored shared activity invented performed rank origins'
assert_sql 'rejoined admission predates no original workout performance' "select exists(select 1 from app_public.group_session_shares sh
  where sh.group_id='${G2}' and sh.member_user_id='${B_UID}' and sh.session_id='${REJOIN_SESSION}') and s.started_at<floor(extract(epoch from m.joined_at)*1000)
  from app_public.sessions s join app_public.group_memberships m on m.user_id=s.owner_user_id and m.group_id='${G2}' and m.ended_at is null
  where s.owner_user_id='${B_UID}' and s.id='${REJOIN_SESSION}';"
assert_sql 'the unchanged old shared source gains placement without a performed rank cause' "select
  not exists(select 1 from jsonb_array_elements(before_ranks) r where r->>'member_user_id'='${B_UID}')
  and exists(select 1 from jsonb_array_elements(final_ranks) r where r->>'member_user_id'='${B_UID}')
  and before_ranks<>final_ranks and without_workout=final_ranks from app_public.notification_workout_targets
  where member_user_id='${B_UID}' and session_id='${REJOIN_SESSION}' and group_exercise_id='${REJOIN_EXERCISE}';"
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${INTENT}}"; expect_ok 'public preview after private baseline capture'
check 'public preview omits private source baselines and controls' '[..|objects|(has("baseline_scores") or has("baselineScores") or has("admission_scores") or has("admissionScores") or has("source_controls") or has("sourceControls"))]|any|not'
assert_sql 'forfeited start remains absent after later admission and worker preparation' "select not exists(select 1 from app_public.notification_intents
  where lifter_user_id='${B_UID}' and session_id='recovery-${RUN_TAG}');"
assert_sql 'diagnostic is sanitized' "select exists(select 1 from public.app_logs where event='notification.intake_failed'
  and user_id='${B_UID}' and context? 'sqlstate' and not context? 'error');"

# The compatible client pages original captured completions, even after raw backdating.
provision E completion-reader
provision F other-completion-reader
READER_PREFIX="reader-${RUN_TAG}"
run_psql "begin;
  select set_config('request.jwt.claims','{\"sub\":\"${E_UID}\",\"role\":\"authenticated\"}',true);
  insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,created_at,updated_at,client_updated_at_ms)
  select '${E_UID}','${READER_PREFIX}-'||lpad(n::text,2,'0'),'completed',${NOW_MS},${NOW_MS}+1000,1,1,1
  from generate_series(1,21) n;
  insert into app_public.notification_workout_moments(member_user_id,session_id,kind,event_at)
    select '${E_UID}',id,'completion',now() from app_public.sessions where owner_user_id='${E_UID}'
    on conflict(member_user_id,session_id,kind) do update set event_at=excluded.event_at;
  insert into app_public.notification_workouts(member_user_id,session_id,completion_at,eligible)
    select '${E_UID}',id,now(),true from app_public.sessions where owner_user_id='${E_UID}'
    on conflict(member_user_id,session_id) do update set completion_at=excluded.completion_at,eligible=true;
  update app_public.sessions set completed_at=${NOW_MS}-172800000 where owner_user_id='${E_UID}';
  update app_public.notification_workout_moments set event_at=null
    where member_user_id='${E_UID}' and session_id='${READER_PREFIX}-14' and kind='completion';
  update app_public.notification_workouts set eligible=false
    where member_user_id='${E_UID}' and session_id='${READER_PREFIX}-15';
  update app_public.notification_workout_moments set event_at=now()-interval '25 hours'
    where member_user_id='${E_UID}' and session_id='${READER_PREFIX}-16' and kind='completion';
  update app_public.notification_workouts set completion_at=now()-interval '25 hours'
    where member_user_id='${E_UID}' and session_id in ('${READER_PREFIX}-16','${READER_PREFIX}-20');
  update app_public.notification_workout_moments set event_at=now()-interval '90 minutes'
    where member_user_id='${E_UID}' and session_id='${READER_PREFIX}-17' and kind='completion';
  update app_public.sessions set deleted_at=${NOW_MS} where owner_user_id='${E_UID}' and id='${READER_PREFIX}-18';
  update app_public.sessions set status='active' where owner_user_id='${E_UID}' and id='${READER_PREFIX}-19';
  update app_public.notification_workout_moments set event_at=now()+interval '6 minutes'
    where member_user_id='${E_UID}' and session_id='${READER_PREFIX}-21' and kind='completion';
  update app_public.notification_workout_epoch set started_at=now()-interval '1 hour';
  select set_config('request.jwt.claims','{\"sub\":\"${F_UID}\",\"role\":\"authenticated\"}',true);
  insert into app_public.sessions(owner_user_id,id,status,started_at,completed_at,created_at,updated_at,client_updated_at_ms)
    values('${F_UID}','${READER_PREFIX}-01','completed',${NOW_MS},${NOW_MS}+1000,1,1,1);
  commit;" >/dev/null
rpc "${E_TOKEN}" notification_pending_completions '{}'; expect_ok 'page captured completion ids'
check 'completion page has only ids and cursor' 'keys|sort==["next_session_id","session_ids"]'
check 'first page is bounded and unaffected by raw backdating' \
  '.session_ids==[range(1;11)|$p+"-"+(if .<10 then "0" else "" end)+tostring] and .next_session_id==$p+"-10"' --arg p "${READER_PREFIX}"
rpc "${E_TOKEN}" notification_pending_completions "$(jq -nc --arg c "${READER_PREFIX}-10" '{p_after_session_id:$c}')"
expect_ok 'page beyond first ten completion ids'
check 'later page excludes forfeited, ineligible, old, pre-cutover, deleted, reopened and future moments' \
  '.session_ids==[$p+"-11",$p+"-12",$p+"-13"] and .next_session_id==null' --arg p "${READER_PREFIX}"
rpc "${F_TOKEN}" notification_pending_completions '{}'; expect_ok 'other account completion ids'
check 'same session id in another account cannot expose the first account backlog' \
  '.session_ids==[$p+"-01"] and .next_session_id==null' --arg p "${READER_PREFIX}"
run_psql "update app_public.notification_workout_epoch set started_at=now()-interval '3 days';" >/dev/null
rpc "${E_TOKEN}" notification_pending_completions "$(jq -nc --arg c "${READER_PREFIX}-15" '{p_after_session_id:$c}')"
expect_ok 'read captured deadline independently of cutover'
check 'expired captured moments and older workout deadlines do not renew' \
  '.session_ids==[$p+"-17"] and .next_session_id==null' --arg p "${READER_PREFIX}"
rpc "${E_TOKEN}" notification_pending_completions '{"p_after_session_id":""}'
expect_error VALIDATION 'invalid completion cursor'
COMPLETED=1
pass 'workout graph, full-rank publication, overlap, ownership, expiry, clamp, sink and admission contracts'
