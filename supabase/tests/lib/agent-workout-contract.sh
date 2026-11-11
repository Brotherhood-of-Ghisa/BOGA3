#!/usr/bin/env bash
# Sourced by agent-api-contract.sh with its real OAuth identities and HTTP helpers.
# Proves atomic logging/replay and bounded authority; mobile handoff has separate sync proof.

echo '[agent-api-test] verifying the independent workout permission and logging lifecycle'
agent_get 'workouts/active'
assert_status 403 'workout permission defaults off independently of plan access'
agent_post 'workouts/start' '{}' "${RUN_TAG}-workout-denied"
assert_status 403 'plan access cannot start a workout'
agent_post 'workouts/create' '{"started_at":"2000-01-01T00:00:00Z","completed_at":"2000-01-01T01:00:00Z"}' "${RUN_TAG}-dated-denied"
assert_status 403 'dated creation requires the separate workout grant'

# The owner app controls this permission; OAuth clients cannot grant themselves access.
WORKOUT_GRANT="$(fetch_grant_granted_at)"
public_request GET 'agent_workout_permissions?select=client_id' "${AGENT_ACCESS_TOKEN}"
assert_status 200 'OAuth permission query stays RLS filtered'
[[ "${RESPONSE_BODY}" == '[]' ]] || fail 'OAuth inspected workout permissions'
public_request POST 'agent_workout_permissions' "${AGENT_ACCESS_TOKEN}" \
  "$(jq -nc --arg owner "${USER_A_UUID}" --arg cid "${AGENT_CLIENT_ID}" --arg at "${WORKOUT_GRANT}" \
    '{owner_user_id:$owner,client_id:$cid,workout_logging_enabled:true,granted_at:$at}')"
assert_non_2xx 'OAuth cannot enable its workout permission'
public_request POST 'agent_workout_permissions' "${APP_ACCESS_TOKEN}" \
  "$(jq -nc --arg owner "${USER_A_UUID}" --arg cid "${AGENT_CLIENT_ID}" --arg at "${WORKOUT_GRANT}" \
    '{owner_user_id:$owner,client_id:$cid,workout_logging_enabled:true,granted_at:$at}')"
assert_status 201 'owner app enables independent workout logging'

# Older switches updating their grant cannot re-enable an unrelated workout grant.
run_psql "update public.agent_workout_permissions set granted_at='2000-01-01' where owner_user_id='${USER_A_UUID}';
  update public.agent_plan_permissions set granted_at='${WORKOUT_GRANT}' where owner_user_id='${USER_A_UUID}';" >/dev/null
agent_get 'workouts/active'
assert_status 403 'workout permission is bound to its own live grant'
run_psql "update public.agent_workout_permissions set granted_at='${WORKOUT_GRANT}' where owner_user_id='${USER_A_UUID}';" >/dev/null

# Existing fixture active sessions are retained and restored after this isolated lifecycle.
WORKOUT_ACTIVE_IDS="$(run_psql "select coalesce(json_agg(id),'[]') from app_public.sessions
  where owner_user_id='${USER_A_UUID}' and status='active' and deleted_at is null;")"
if [[ "${WORKOUT_ACTIVE_IDS}" != '[]' ]]; then
  agent_post 'workouts/start' '{}' "${RUN_TAG}-workout-existing"
  assert_status 409 'start requires an explicit choice when another workout is active'
fi
run_psql "begin; set local request.jwt.claim.sub='${USER_A_UUID}'; set local boga.exercise_merge_internal='on'; set local boga.workout_control_write='on';
  update app_public.sessions set status='completed' where owner_user_id='${USER_A_UUID}'
    and id in(select json_array_elements_text('${WORKOUT_ACTIVE_IDS}'::json)); commit;" >/dev/null

WORKOUT_START_BODY="$(jq -nc --arg gym "${GYM_A}" '{gym_id:$gym}')"
agent_post 'workouts/start' "${WORKOUT_START_BODY}" "${RUN_TAG}-workout-start"
assert_status 200 'start workout'
WORKOUT_ID="$(jq -er '.data.session_id' <<<"${RESPONSE_BODY}")"
WORKOUT_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
run_psql "begin; set local request.jwt.claim.sub='${USER_A_UUID}'; set local boga.exercise_merge_internal='on'; set local boga.workout_control_write='on';
  insert into app_public.session_plans(owner_user_id,id,title,created_at,updated_at,client_updated_at_ms)
    values('${USER_A_UUID}','agent-api-${RUN_TAG}-workout-source','Scope boundary',${NOW_MS},${NOW_MS},${NOW_MS});
  update app_public.sessions set source_plan_id='agent-api-${RUN_TAG}-workout-source'
    where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}'; commit;" >/dev/null
agent_post 'workouts/finish' "$(jq -nc --arg sid "${WORKOUT_ID}" --arg rev "${WORKOUT_REV}" '{session_id:$sid,expected_revision:$rev}')" "${RUN_TAG}-workout-plan"
assert_status 409 'plan execution remains an app operation'
jq -e '.error.code=="WORKOUT_REQUIRES_APP"' <<<"${RESPONSE_BODY}" >/dev/null || fail 'sourced workout was not identified'
agent_get "workouts/active?session_id=${WORKOUT_ID}"
assert_status 200 'plan-backed workout remains discoverable'
jq -e '.data.workout.requires_app' <<<"${RESPONSE_BODY}" >/dev/null || fail 'plan-backed recovery omitted the app handoff'
run_psql "begin; set local request.jwt.claim.sub='${USER_A_UUID}'; set local boga.exercise_merge_internal='on'; set local boga.workout_control_write='on';
  update app_public.sessions set source_plan_id=null where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}'; commit;" >/dev/null
agent_get "workouts/active?session_id=${WORKOUT_ID}"
WORKOUT_REV="$(jq -er '.data.workout.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/start' "${WORKOUT_START_BODY}" "${RUN_TAG}-workout-start"
assert_status 200 'lost start response retry'
jq -e --arg id "${WORKOUT_ID}" '.data.session_id==$id and .data.idempotent_replay' <<<"${RESPONSE_BODY}" >/dev/null || fail 'start retry changed identity'
agent_post 'workouts/start' '{}' "${RUN_TAG}-workout-start"
assert_status 409 'start retry with changed input conflicts'
agent_post 'workouts/start' '{}' "${RUN_TAG}-workout-second"
assert_status 409 'second deliberate concurrent start is refused'

workout_log_body() {
  jq -nc --arg sid "${WORKOUT_ID}" --arg rev "${WORKOUT_REV}" --arg ex "${1:-${EXERCISE_A}}" \
    '{session_id:$sid,expected_revision:$rev,exercise_id:$ex,sets:[{weight_kg:"80",reps:8},{weight_kg:"80",reps:7,set_type:"rir_2"}]}'
}
WORKOUT_LOG_BODY="$(workout_log_body)"
agent_post 'workouts/log-sets' "${WORKOUT_LOG_BODY}" "${RUN_TAG}-workout-log"
assert_status 200 'batch logs performed sets'
WORKOUT_SET="$(jq -er '.data.set_ids[1]' <<<"${RESPONSE_BODY}")"
WORKOUT_BLOCK="$(jq -er '.data.session_exercise_id' <<<"${RESPONSE_BODY}")"
WORKOUT_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/log-sets' "${WORKOUT_LOG_BODY}" "${RUN_TAG}-workout-log"
assert_status 200 'retry replay after a lost response'
jq -e --arg id "${WORKOUT_SET}" '.data.set_ids[1]==$id and .data.idempotent_replay' <<<"${RESPONSE_BODY}" >/dev/null || fail 'set retry duplicated IDs'
agent_post 'workouts/log-sets' "$(workout_log_body)" "${RUN_TAG}-workout-identical"
assert_status 200 'intentional identical performance with a fresh key'
WORKOUT_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
[[ "$(run_psql "select count(*) from app_public.exercise_sets where owner_user_id='${USER_A_UUID}' and session_exercise_id='${WORKOUT_BLOCK}';")" == 4 ]] || fail 'retry or intentional repetition had wrong row count'

WORKOUT_EDIT_BODY="$(jq -nc --arg sid "${WORKOUT_ID}" --arg rev "${WORKOUT_REV}" --arg set "${WORKOUT_SET}" \
  '{session_id:$sid,expected_revision:$rev,set_id:$set,set:{weight_kg:"75",reps:7,set_type:"rir_2"}}')"
agent_post 'workouts/update-set' "${WORKOUT_EDIT_BODY}" "${RUN_TAG}-workout-edit"
assert_status 200 'correct one stable set ID'
WORKOUT_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/update-set' "${WORKOUT_EDIT_BODY}" "${RUN_TAG}-workout-stale-edit"
assert_status 409 'stale corrections cannot overwrite newer state'
agent_get "workouts/active?session_id=${WORKOUT_ID}&limit=1"
assert_status 200 'fresh conversation can recover persisted workout'
jq -e '.data.workout.status=="active" and (.data.rows|length)==1 and .data.next_cursor!=null' <<<"${RESPONSE_BODY}" >/dev/null || fail 'active read is not bounded'
WORKOUT_CURSOR="$(jq -er '.data.next_cursor' <<<"${RESPONSE_BODY}")"
agent_get "workouts/active?session_id=${WORKOUT_ID}&limit=100&cursor=${WORKOUT_CURSOR}&revision=${WORKOUT_REV}"
assert_status 200 'revision-fenced next page'
jq -e --arg set "${WORKOUT_SET}" '[.data.rows[]|select(.id==$set)][0].weight_kg=="75"' <<<"${RESPONSE_BODY}" >/dev/null || fail 'correction was not persisted'
WORKOUT_FOREIGN_ID="agent-api-${RUN_TAG}-workout-b"
run_psql "insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
  values('${USER_B_UUID}','${WORKOUT_FOREIGN_ID}','active',${NOW_MS},${NOW_MS},${NOW_MS},${NOW_MS});" >/dev/null
agent_get "workouts/active?session_id=${WORKOUT_FOREIGN_ID}"
assert_status 404 'foreign and missing session reads are indistinguishable'
agent_get 'workouts/active?session_id=missing-session'
assert_status 404 'missing session read'
agent_post 'workouts/finish' "$(jq -nc --arg sid "${WORKOUT_FOREIGN_ID}" --arg rev "${WORKOUT_REV}" '{session_id:$sid,expected_revision:$rev}')" "${RUN_TAG}-workout-cross-owner"
assert_status 404 'cross-owner lifecycle mutation'
agent_post 'workouts/log-sets' "$(workout_log_body "${EXERCISE_B}")" "${RUN_TAG}-workout-foreign"
assert_status 400 'foreign exercise cannot be logged'

# A failure after the first insert must roll back both that insert and its receipt.
WORKOUT_ATOMIC_RESULT="$(run_psql "do \$\$ begin
  begin
    perform app_public.agent_workout_mutate('${USER_A_UUID}','${AGENT_CLIENT_ID}','${WORKOUT_GRANT}','log_sets',
      '${RUN_TAG}-workout-atomic',repeat('a',64),jsonb_build_object('session_id','${WORKOUT_ID}',
        'expected_revision','${WORKOUT_REV}','session_exercise_id','${WORKOUT_BLOCK}',
        'sets',jsonb_build_array(jsonb_build_object('weight_kg','1','reps',1),jsonb_build_object('reps',1))));
    raise exception 'expected not-null failure';
  exception when not_null_violation then null; end;
end \$\$;
select (select count(*) from public.agent_plan_write_receipts where idempotency_key='${RUN_TAG}-workout-atomic')||':'||
  (select count(*) from app_public.exercise_sets where owner_user_id='${USER_A_UUID}' and session_exercise_id='${WORKOUT_BLOCK}');")"
[[ "${WORKOUT_ATOMIC_RESULT}" == '0:4' ]] || fail 'failed batch left partial sets or a success receipt'

source "${SUPABASE_DIR}/tests/lib/agent-workout-control.sh"
source "${SUPABASE_DIR}/tests/lib/agent-dated-workout-contract.sh"

WORKOUT_DELETE_BODY="$(jq -nc --arg sid "${WORKOUT_ID}" --arg rev "${WORKOUT_REV}" --arg set "${WORKOUT_SET}" \
  '{session_id:$sid,expected_revision:$rev,set_id:$set}')"
agent_post 'workouts/delete-set' "${WORKOUT_DELETE_BODY}" "${RUN_TAG}-workout-delete"
assert_status 200 'remove an active set'
WORKOUT_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
WORKOUT_FINISH_BODY="$(jq -nc --arg sid "${WORKOUT_ID}" --arg rev "${WORKOUT_REV}" '{session_id:$sid,expected_revision:$rev}')"
agent_post 'workouts/finish' "${WORKOUT_FINISH_BODY}" "${RUN_TAG}-workout-finish"
assert_status 200 'finish workout'
jq -e '.data.status=="completed" and (.data.completed_at|type)=="string" and .data.duration_seconds>=0' <<<"${RESPONSE_BODY}" >/dev/null || fail 'finish did not store time/duration'
agent_post 'workouts/finish' "${WORKOUT_FINISH_BODY}" "${RUN_TAG}-workout-finish"
assert_status 200 'finish replay'
jq -e '.data.idempotent_replay' <<<"${RESPONSE_BODY}" >/dev/null || fail 'finish replay was not identified'
agent_post 'workouts/log-sets' "$(workout_log_body)" "${RUN_TAG}-workout-finished-log"
assert_status 409 'finished history cannot receive new sets'
agent_post 'workouts/update-set' "${WORKOUT_EDIT_BODY}" "${RUN_TAG}-workout-finished-edit"
assert_status 409 'finished history cannot be corrected'
agent_post 'workouts/start' "${WORKOUT_START_BODY}" "${RUN_TAG}-workout-start"
assert_status 200 'accepted live start receipt remains recoverable after finish'
jq -e '(.data.control.can_edit|not) and .data.idempotent_replay' <<<"${RESPONSE_BODY}" >/dev/null || fail 'live finish replay revived control'

# Both SQL sessions contend for the same owner lock. Exactly one operation may commit.
WORKOUT_RACE_DIR="$(mktemp -d)"
workout_race_call() {
  run_psql "select app_public.agent_workout_mutate('${USER_A_UUID}','${AGENT_CLIENT_ID}','${WORKOUT_GRANT}',
    '$1','${RUN_TAG}-$2',repeat('b',64),'$3'::jsonb);"
}
workout_hold_owner() {
  run_psql "set application_name='workout-barrier-${RUN_TAG}';
    select pg_advisory_lock(hashtextextended('exercise-merge:'||'${USER_A_UUID}',0));
    select pg_sleep(30);" >"${WORKOUT_RACE_DIR}/holder" 2>&1 &
  WORKOUT_HOLDER_JOB=$!
  for _ in $(seq 1 100); do
    WORKOUT_HOLDER_PID="$(run_psql "select a.pid from pg_stat_activity a join pg_locks l on l.pid=a.pid
      where a.application_name='workout-barrier-${RUN_TAG}' and l.locktype='advisory' and l.granted;")"
    [[ -n "${WORKOUT_HOLDER_PID}" ]] && return
    sleep 0.1
  done
  fail 'workout race barrier did not acquire its owner lock'
}
workout_release_contenders() {
  for _ in $(seq 1 100); do
    if [[ "$(run_psql "select count(*) from pg_stat_activity where wait_event_type='Lock'
      and query like 'select app_public.agent_workout_mutate%';")" == 2 ]]; then
      run_psql "select pg_terminate_backend(${WORKOUT_HOLDER_PID});" >/dev/null
      wait "${WORKOUT_HOLDER_JOB}" || true
      return
    fi
    sleep 0.1
  done
  fail 'both workout contenders did not wait on the owner barrier'
}
workout_hold_owner
workout_race_call start_workout start-race-a '{"gym_id":null}' >"${WORKOUT_RACE_DIR}/a" 2>&1 &
WORKOUT_RACE_A=$!
workout_race_call start_workout start-race-b '{"gym_id":null}' >"${WORKOUT_RACE_DIR}/b" 2>&1 &
WORKOUT_RACE_B=$!
workout_release_contenders
WORKOUT_RACE_SUCCEEDED=0
if wait "${WORKOUT_RACE_A}"; then WORKOUT_RACE_SUCCEEDED=$((WORKOUT_RACE_SUCCEEDED+1)); fi
if wait "${WORKOUT_RACE_B}"; then WORKOUT_RACE_SUCCEEDED=$((WORKOUT_RACE_SUCCEEDED+1)); fi
[[ "${WORKOUT_RACE_SUCCEEDED}" == 1 ]] || fail 'concurrent starts did not elect one workout'
grep -Eq 'ACTIVE_WORKOUT_CONFLICT' "${WORKOUT_RACE_DIR}/a" "${WORKOUT_RACE_DIR}/b" || fail 'concurrent start loser was not actionable'
WORKOUT_RACE_ID="$(run_psql "select id from app_public.sessions where owner_user_id='${USER_A_UUID}' and status='active' and deleted_at is null;")"
WORKOUT_RACE_REV="$(run_psql "select app_public.agent_workout_revision('${USER_A_UUID}','${WORKOUT_RACE_ID}');")"
WORKOUT_RACE_BASE="$(jq -nc --arg id "${WORKOUT_RACE_ID}" --arg rev "${WORKOUT_RACE_REV}" '{session_id:$id,expected_revision:$rev}')"
WORKOUT_RACE_LOG="$(jq -c --arg ex "${EXERCISE_A}" '.+{exercise_id:$ex,sets:[{weight_kg:"1",reps:1}]}' <<<"${WORKOUT_RACE_BASE}")"
workout_hold_owner
workout_race_call finish_workout finish-race "${WORKOUT_RACE_BASE}" >"${WORKOUT_RACE_DIR}/a" 2>&1 &
WORKOUT_RACE_A=$!
workout_race_call log_sets log-race "${WORKOUT_RACE_LOG}" >"${WORKOUT_RACE_DIR}/b" 2>&1 &
WORKOUT_RACE_B=$!
workout_release_contenders
WORKOUT_RACE_SUCCEEDED=0
if wait "${WORKOUT_RACE_A}"; then WORKOUT_RACE_SUCCEEDED=$((WORKOUT_RACE_SUCCEEDED+1)); fi
if wait "${WORKOUT_RACE_B}"; then WORKOUT_RACE_SUCCEEDED=$((WORKOUT_RACE_SUCCEEDED+1)); fi
[[ "${WORKOUT_RACE_SUCCEEDED}" == 1 ]] || fail 'finish/log race did not serialize revision and lifecycle checks'
grep -Eq 'REVISION_CONFLICT|WORKOUT_NOT_ACTIVE' "${WORKOUT_RACE_DIR}/a" "${WORKOUT_RACE_DIR}/b" || fail 'finish/log loser was not actionable'
if [[ "$(run_psql "select status from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_RACE_ID}';")" == active ]]; then
  WORKOUT_RACE_REV="$(run_psql "select app_public.agent_workout_revision('${USER_A_UUID}','${WORKOUT_RACE_ID}');")"
  workout_race_call finish_workout finish-race-retry "$(jq -nc --arg id "${WORKOUT_RACE_ID}" --arg rev "${WORKOUT_RACE_REV}" '{session_id:$id,expected_revision:$rev}')" >/dev/null
fi
rm -rf "${WORKOUT_RACE_DIR}"

run_psql "begin; set local request.jwt.claim.sub='${USER_A_UUID}'; set local boga.exercise_merge_internal='on'; set local boga.workout_control_write='on';
  update public.agent_workout_permissions set workout_logging_enabled=false where owner_user_id='${USER_A_UUID}';
  update app_public.sessions set status='active' where owner_user_id='${USER_A_UUID}'
    and id in(select json_array_elements_text('${WORKOUT_ACTIVE_IDS}'::json)); commit;" >/dev/null
agent_post 'workouts/finish' "${WORKOUT_FINISH_BODY}" "${RUN_TAG}-workout-finish"
assert_status 403 'permission revocation also denies receipt replay'
app_public_request POST 'rpc/agent_workout_mutate' "${AGENT_ACCESS_TOKEN}" '{}'
assert_non_2xx 'OAuth cannot invoke service-only workout RPCs'
echo '[agent-api-test] workout lifecycle PASS'
