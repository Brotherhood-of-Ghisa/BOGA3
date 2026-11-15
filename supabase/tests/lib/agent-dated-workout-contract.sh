#!/usr/bin/env bash
# Sourced while the real OAuth fixture has logging permission and a live workout.
# Proves dated incremental entry, revision/control fences and fixed historical times.
echo '[agent-api-test] verifying dated workout entry'
# The live lifecycle/control cases share this client's independent write window.
# Give dated entry its own window without relaxing the production rate limit.
sleep 60
DATED_START_MS=$((NOW_MS - 7200000))
DATED_END_MS=$((NOW_MS - 3600000))
DATED_START="$(jq -nr --argjson n "$((DATED_START_MS / 1000))" '$n|todateiso8601')"
DATED_END="$(jq -nr --argjson n "$((DATED_END_MS / 1000))" '$n|todateiso8601')"
DATED_BODY="$(jq -nc --arg start "${DATED_START}" --arg end "${DATED_END}" --arg gym "${GYM_A}" '{started_at:$start,completed_at:$end,gym_id:$gym}')"
agent_post 'workouts/create' "$(jq -c '.started_at="2026-02-30T00:00:00Z"' <<<"${DATED_BODY}")" "${RUN_TAG}-dated-invalid"
assert_status 400 'impossible historical dates are rejected'
agent_post 'workouts/create' "$(jq -c '.completed_at=.started_at|.started_at="9999-01-01T00:00:00Z"' <<<"${DATED_BODY}")" "${RUN_TAG}-dated-reversed"
assert_status 400 'historical start must not follow its end'
agent_post 'workouts/create' "$(jq -c '.completed_at="9999-01-01T00:00:00Z"' <<<"${DATED_BODY}")" "${RUN_TAG}-dated-future"
assert_status 400 'historical completion cannot be in the future'
agent_post 'workouts/create' "$(jq -c '.gym_id="foreign-or-missing"' <<<"${DATED_BODY}")" "${RUN_TAG}-dated-foreign"
assert_status 400 'historical creation checks gym ownership'
agent_post 'workouts/create' "${DATED_BODY}" "${RUN_TAG}-dated-create"
assert_status 200 'historical creation coexists with a live workout'
DATED_ID="$(jq -er '.data.session_id' <<<"${RESPONSE_BODY}")"
DATED_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
jq -e --arg start "${DATED_START%.000Z}" --arg end "${DATED_END%.000Z}" '.data.status=="completed" and .data.control.can_edit and .data.duration_seconds==3600' <<<"${RESPONSE_BODY}" >/dev/null || fail 'dated creation lost lifecycle or control'
agent_post 'workouts/create' "${DATED_BODY}" "${RUN_TAG}-dated-create"
assert_status 200 'dated creation lost-response replay'
jq -e --arg id "${DATED_ID}" '.data.session_id==$id and .data.idempotent_replay and .data.control.can_edit' <<<"${RESPONSE_BODY}" >/dev/null || fail 'dated replay duplicated a session'
agent_post 'workouts/create' "$(jq -c '.gym_id=null' <<<"${DATED_BODY}")" "${RUN_TAG}-dated-create"
assert_status 409 'changed dated creation payload conflicts'
agent_get 'workouts/active'
jq -e --arg dated "${DATED_ID}" --arg live "${WORKOUT_ID}" '(.data.workouts|map(.id)|index($dated))==null and (.data.workouts|map(.id)|index($live))!=null' <<<"${RESPONSE_BODY}" >/dev/null || fail 'dated entry occupied or replaced live training'
DATED_LOG="$(jq -nc --arg id "${DATED_ID}" --arg rev "${DATED_REV}" --arg ex "${EXERCISE_A}" '{session_id:$id,expected_revision:$rev,exercise_id:$ex,sets:[{weight_kg:"81",reps:8}]}')"
agent_post 'workouts/log-sets' "${DATED_LOG}" "${RUN_TAG}-dated-log"
assert_status 200 'incrementally log dated performance'
DATED_SET="$(jq -er '.data.set_ids[0]' <<<"${RESPONSE_BODY}")"
DATED_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/log-sets' "${DATED_LOG}" "${RUN_TAG}-dated-log"
assert_status 200 'dated set replay'
jq -e --arg set "${DATED_SET}" '.data.idempotent_replay and .data.set_ids==[$set]' <<<"${RESPONSE_BODY}" >/dev/null || fail 'dated set replay duplicated performance'
agent_post 'workouts/log-sets' "${DATED_LOG}" "${RUN_TAG}-dated-stale"
assert_status 409 'stale dated graph revision is rejected'
app_public_request PATCH "exercise_sets?id=eq.${DATED_SET}" "${APP_ACCESS_TOKEN}" '{"weight_value":"999"}'
assert_non_2xx 'completed AI-owned graph is locked against app writes'
DATED_MANIFEST="$(run_psql "select app_public.notification_source_manifest('${USER_A_UUID}','${DATED_ID}');")"
app_public_request POST 'rpc/notification_confirm_completion' "${APP_ACCESS_TOKEN}" "$(jq -nc --arg id "${DATED_ID}" --argjson graph "${DATED_MANIFEST}" '{p_session_id:$id,p_entities:$graph}')"
assert_status 200 'app may attempt exact dated completion proof'
jq -e '.confirmed==false' <<<"${RESPONSE_BODY}" >/dev/null || fail 'partial dated entry was confirmed for notifications'
agent_post 'workouts/update-set' "$(jq -nc --arg id "${DATED_ID}" --arg rev "${DATED_REV}" --arg set "${DATED_SET}" '{session_id:$id,expected_revision:$rev,set_id:$set,set:{weight_kg:"82",reps:7,set_type:"rir_2"}}')" "${RUN_TAG}-dated-edit"
assert_status 200 'correct dated performance'
DATED_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/log-sets' "$(jq -c --arg rev "${DATED_REV}" '.expected_revision=$rev' <<<"${DATED_LOG}")" "${RUN_TAG}-dated-extra"
assert_status 200 'append another dated set'
DATED_EXTRA="$(jq -er '.data.set_ids[0]' <<<"${RESPONSE_BODY}")"
DATED_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/delete-set' "$(jq -nc --arg id "${DATED_ID}" --arg rev "${DATED_REV}" --arg set "${DATED_EXTRA}" '{session_id:$id,expected_revision:$rev,set_id:$set}')" "${RUN_TAG}-dated-delete"
assert_status 200 'remove a dated set without reopening the workout'
DATED_REV="$(jq -er '.data.revision' <<<"${RESPONSE_BODY}")"
agent_get "workouts/active?session_id=${DATED_ID}"
assert_status 200 'resume dated entry by stable session ID'
jq -e '.data.workout.status=="completed" and .data.workout.control.can_edit and (.data.rows|map(select(.type=="set"))|.[0].weight_kg)=="82"' <<<"${RESPONSE_BODY}" >/dev/null || fail 'resumed historical graph lost edits'
DATED_FINISH="$(jq -nc --arg id "${DATED_ID}" --arg rev "${DATED_REV}" '{session_id:$id,expected_revision:$rev}')"
agent_post 'workouts/finish' "${DATED_FINISH}" "${RUN_TAG}-dated-finish"
assert_status 200 'finish entering dated workout'
jq -e '.data.status=="completed" and .data.control.owner=="human" and (.data.control.can_edit|not) and .data.duration_seconds==3600' <<<"${RESPONSE_BODY}" >/dev/null || fail 'dated finish failed to release control'
agent_post 'workouts/finish' "${DATED_FINISH}" "${RUN_TAG}-dated-finish"
assert_status 200 'dated finish lost-response replay'
[[ "$(run_psql "select started_at||':'||completed_at||':'||duration_sec from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${DATED_ID}';")" == "$((DATED_START_MS / 1000 * 1000)):$((DATED_END_MS / 1000 * 1000)):3600" ]] || fail 'historical times changed during incremental entry'
agent_post 'workouts/log-sets' "${DATED_LOG}" "${RUN_TAG}-dated-closed"
assert_status 409 'explicitly finished dated entry cannot receive new sets'

agent_post 'workouts/log-sets' "${DATED_LOG}" "${RUN_TAG}-dated-log"
assert_status 200 'accepted dated set receipt remains recoverable after finish'
jq -e '(.data.control.can_edit|not) and .data.idempotent_replay' <<<"${RESPONSE_BODY}" >/dev/null || fail 'closed receipt implied editing authority'

# A second dated entry exercises human takeover and displaced receipt replay.
agent_post 'workouts/create' "${DATED_BODY}" "${RUN_TAG}-dated-takeover-create"
assert_status 200 'create dated takeover fixture'
DATED_TAKE_ID="$(jq -er '.data.session_id' <<<"${RESPONSE_BODY}")"
DATED_TAKE_REV="$(run_psql "select merge_revision from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${DATED_TAKE_ID}';")"
run_psql "update public.agent_workout_permissions set workout_logging_enabled=false where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';" >/dev/null
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "$(jq -nc --arg id "control:${RUN_TAG}-dated-takeover" --arg sid "${DATED_TAKE_ID}" --argjson rev "${DATED_TAKE_REV}" '{p_id:$id,p_session_id:$sid,p_base_revision:$rev}')"
assert_status 200 'human takes over dated history without remaining agent permission'
run_psql "update public.agent_workout_permissions set workout_logging_enabled=true where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';" >/dev/null
agent_post 'workouts/create' "${DATED_BODY}" "${RUN_TAG}-dated-takeover-create"
assert_status 200 'historical creation receipt remains recoverable after takeover'
jq -e '(.data.control.can_edit|not) and .data.control.owner=="human"' <<<"${RESPONSE_BODY}" >/dev/null || fail 'historical receipt replay revived MCP control'
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "$(jq -nc --arg id "control:${RUN_TAG}-dated-reclaim" --arg sid "${DATED_TAKE_ID}" --arg client "${AGENT_CLIENT_ID}" --arg at "${WORKOUT_GRANT}" --argjson rev "$((DATED_TAKE_REV+1))" '{p_id:$id,p_session_id:$sid,p_base_revision:$rev,p_client_id:$client,p_granted_at:$at}')"
assert_non_2xx 'completed app history cannot be reassigned to an agent'
echo '[agent-api-test] dated workout PASS'
