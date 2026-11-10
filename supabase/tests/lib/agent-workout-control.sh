#!/usr/bin/env bash
# Sourced by the real OAuth contract. Proves controller binding, app write
# fencing, bidirectional same-ID transfer, recovery locks and immutable replay.
echo '[agent-api-test] verifying exclusive workout control and handoffs'
CONTROL_EPOCH="$(run_psql "select merge_revision from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")"
agent_get "workouts/active?session_id=${WORKOUT_ID}"
jq -e --arg client "${AGENT_CLIENT_ID}" '.data.workout.control=={owner:"mcp",client_id:$client,can_edit:true}' <<<"${RESPONSE_BODY}" >/dev/null || fail 'MCP start did not bind its controller'

app_public_request PATCH "sessions?id=eq.${WORKOUT_ID}" "${APP_ACCESS_TOKEN}" '{"gym_id":null}'
assert_non_2xx 'AI-owned session metadata is locked'
app_public_request PATCH "exercise_sets?id=eq.${WORKOUT_SET}" "${APP_ACCESS_TOKEN}" '{"weight_value":"999"}'
assert_non_2xx 'AI-owned set is locked'
CONTROL_SET="$(run_psql "select (to_jsonb(e)-'owner_user_id'-'server_received_at')||jsonb_build_object('merge_revision',0,'weight_value','71') from app_public.exercise_sets e where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_SET}';")"
app_public_request POST 'rpc/exercise_merge_save_conflict' "${APP_ACCESS_TOKEN}" "$(jq -nc --argjson row "${CONTROL_SET}" '{p_type:"exercise_sets",p_row:$row}')"
assert_status 200 'old input is retained for review while AI is logging'
CONTROL_CONFLICT="$(jq -er '.' <<<"${RESPONSE_BODY}")"
app_public_request POST 'rpc/exercise_merge_review' "${APP_ACCESS_TOKEN}" '{"p_offset":0}'
assert_status 200 'owner reads preserved input'
CONTROL_REVIEW="$(jq -ec --arg id "${CONTROL_CONFLICT}" '.items[]|select(.id==$id)' <<<"${RESPONSE_BODY}")"
jq -e '.invalid and (.notice|contains("Take over logging"))' <<<"${CONTROL_REVIEW}" >/dev/null || fail 'review Apply did not explain AI lock'
app_public_request POST 'rpc/exercise_merge_resolve' "${APP_ACCESS_TOKEN}" "$(jq -nc --arg id "${CONTROL_CONFLICT}" --arg token "$(jq -r '.token' <<<"${CONTROL_REVIEW}")" '{p_id:$id,p_keep:false,p_token:$token}')"
assert_non_2xx 'recovery Apply cannot bypass AI control'

CONTROL_TAKEOVER="$(jq -nc --arg id "control:${RUN_TAG}-takeover" --arg sid "${WORKOUT_ID}" --argjson rev "${CONTROL_EPOCH}" '{p_id:$id,p_session_id:$sid,p_base_revision:$rev}')"
app_public_request POST 'rpc/workout_set_control' "${AGENT_ACCESS_TOKEN}" "${CONTROL_TAKEOVER}"
assert_non_2xx 'MCP cannot assign or reclaim session control'
CONTROL_OTHER_APP="$(sign_in_password "${USER_B_EMAIL}" "${USER_B_PASSWORD}")"
app_public_request POST 'rpc/workout_set_control' "${CONTROL_OTHER_APP}" "${CONTROL_TAKEOVER}"
assert_non_2xx 'another person cannot take control of this workout'
[[ "${RESPONSE_BODY}" == *NOT_FOUND* ]] || fail 'foreign control exposed another person’s workout'
unset CONTROL_OTHER_APP
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_TAKEOVER}"
assert_status 200 'human takes over the same workout'
jq -e --arg sid "${WORKOUT_ID}" '.session_id==$sid and .logging_client_id==null' <<<"${RESPONSE_BODY}" >/dev/null || fail 'takeover changed session identity'
agent_get "workouts/active?session_id=${WORKOUT_ID}"
assert_status 200 'next MCP read reports human takeover'
jq -e '.data.workout.control.owner=="human" and .data.workout.control.can_edit==false' <<<"${RESPONSE_BODY}" >/dev/null || fail 'client was not informed of takeover'
WORKOUT_REV="$(jq -er '.data.workout.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/log-sets' "$(workout_log_body)" "${RUN_TAG}-control-denied"
assert_status 409 'old controller cannot log after takeover'
jq -e '.error.code=="WORKOUT_CONTROL_REQUIRED"' <<<"${RESPONSE_BODY}" >/dev/null || fail 'ownership denial was not actionable'
agent_post 'workouts/log-sets' "${WORKOUT_LOG_BODY}" "${RUN_TAG}-workout-log"
assert_status 409 'old accepted receipt cannot imply continued control'
agent_post 'workouts/start' "${WORKOUT_START_BODY}" "${RUN_TAG}-workout-start"
assert_status 409 'old start receipt cannot imply continued control'

CONTROL_GIVE="$(jq -nc --arg id "control:${RUN_TAG}-give" --arg sid "${WORKOUT_ID}" --arg client "${AGENT_CLIENT_ID}" --arg at "${WORKOUT_GRANT}" --argjson rev "$(run_psql "select merge_revision from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")" '{p_id:$id,p_session_id:$sid,p_base_revision:$rev,p_client_id:$client,p_granted_at:$at}')"
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_GIVE}"
assert_non_2xx 'unresolved input blocks human-to-AI transfer'
[[ "${RESPONSE_BODY}" == *WORKOUT_REVIEW_REQUIRED* ]] || fail 'saved changes were silently ignored at transfer'
app_public_request POST 'rpc/exercise_merge_review' "${APP_ACCESS_TOKEN}" '{"p_offset":0}'
CONTROL_REVIEW="$(jq -ec --arg id "${CONTROL_CONFLICT}" '.items[]|select(.id==$id)' <<<"${RESPONSE_BODY}")"
app_public_request POST 'rpc/exercise_merge_resolve' "${APP_ACCESS_TOKEN}" "$(jq -nc --arg id "${CONTROL_CONFLICT}" --arg token "$(jq -r '.token' <<<"${CONTROL_REVIEW}")" '{p_id:$id,p_keep:true,p_token:$token}')"
assert_status 204 'human explicitly declines preserved input'

app_public_request PATCH "sessions?id=eq.${WORKOUT_ID}" "${APP_ACCESS_TOKEN}" "$(jq -nc --arg client "${AGENT_CLIENT_ID}" --arg at "${WORKOUT_GRANT}" '{logging_client_id:$client,logging_granted_at:$at}')"
assert_non_2xx 'direct app writes cannot forge controller metadata'
CONTROL_HEADER="$(run_psql "select to_jsonb(s)-'owner_user_id'-'server_received_at'-'client_updated_at_ms'-'id' from app_public.sessions s where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")"
CONTROL_PUSH="$(jq -nc --arg sid "${WORKOUT_ID}" --arg client "${AGENT_CLIENT_ID}" --argjson fields "${CONTROL_HEADER}" --argjson clock "$(( $(date +%s) * 1000 + 5000 ))" '{entities:[{type:"sessions",id:$sid,client_updated_at_ms:$clock,fields:($fields+{logging_client_id:$client})}]}')"
app_public_request POST 'rpc/sync_push' "${APP_ACCESS_TOKEN}" "${CONTROL_PUSH}"
assert_status 200 'human-owned workout still accepts ordinary sync'
[[ "$(run_psql "select logging_client_id is null from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")" == t ]] || fail 'sync assigned AI control'

run_psql "update public.agent_workout_permissions set workout_logging_enabled=false where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';" >/dev/null
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_GIVE}"
assert_non_2xx 'handover cannot enable a disabled logging permission'
run_psql "update public.agent_workout_permissions set workout_logging_enabled=true where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';
  update auth.oauth_consents set revoked_at=now() where user_id='${USER_A_UUID}' and client_id::text='${AGENT_CLIENT_ID}';" >/dev/null
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_GIVE}"
assert_non_2xx 'handover rejects a revoked live consent'
run_psql "update auth.oauth_consents set revoked_at=null where user_id='${USER_A_UUID}' and client_id::text='${AGENT_CLIENT_ID}';" >/dev/null
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_GIVE}"
assert_status 200 'human gives this authorised MCP client the same workout'
jq -e --arg sid "${WORKOUT_ID}" --arg client "${AGENT_CLIENT_ID}" '.session_id==$sid and .logging_client_id==$client' <<<"${RESPONSE_BODY}" >/dev/null || fail 'handover lost the controller or ID'
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "${CONTROL_TAKEOVER}"
assert_status 200 'delayed takeover receipt is readable'
jq -e --arg client "${AGENT_CLIENT_ID}" '.idempotent_replay and .logging_client_id==$client' <<<"${RESPONSE_BODY}" >/dev/null || fail 'old takeover replay reversed a newer transfer'
app_public_request POST 'rpc/workout_set_control' "${APP_ACCESS_TOKEN}" "$(jq -c '.p_base_revision+=1' <<<"${CONTROL_TAKEOVER}")"
assert_non_2xx 'changed control payload cannot reuse an operation ID'
CONTROL_PUSH="$(jq -nc --arg sid "${WORKOUT_ID}" --argjson fields "$(run_psql "select to_jsonb(s)-'owner_user_id'-'server_received_at'-'client_updated_at_ms'-'id' from app_public.sessions s where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")" --argjson clock "$(( $(date +%s) * 1000 + 10000 ))" '{entities:[{type:"sessions",id:$sid,client_updated_at_ms:$clock,fields:($fields+{gym_id:null})}]}')"
app_public_request POST 'rpc/sync_push' "${APP_ACCESS_TOKEN}" "${CONTROL_PUSH}"
assert_non_2xx 'current-epoch app sync cannot edit an AI-owned session'

CONTROL_WIPED="$(run_psql "begin; set local request.jwt.claim.sub='${USER_A_UUID}';
  set local request.jwt.claims='{}'; set local app.env='local';
  select app_public.dev_wipe_my_data(); rollback;")"
[[ "${CONTROL_WIPED}" =~ ^[1-9][0-9]*$ ]] || fail 'owner-authorized reset could not remove an active AI workout'
[[ "$(run_psql "select count(*) from app_public.sessions where owner_user_id='${USER_A_UUID}' and id='${WORKOUT_ID}';")" == 1 ]] || fail 'reset rollback lost the control fixture'

run_psql "update auth.oauth_consents set granted_at=granted_at+interval '1 second' where user_id='${USER_A_UUID}' and client_id::text='${AGENT_CLIENT_ID}';
  update public.agent_workout_permissions set granted_at=granted_at+interval '1 second' where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';" >/dev/null
agent_get "workouts/active?session_id=${WORKOUT_ID}"
assert_status 200 'reauthorised client can read current control'
jq -e '.data.workout.control.can_edit==false' <<<"${RESPONSE_BODY}" >/dev/null || fail 'new grant revived old session control'
WORKOUT_REV="$(jq -er '.data.workout.revision' <<<"${RESPONSE_BODY}")"
agent_post 'workouts/log-sets' "$(workout_log_body)" "${RUN_TAG}-new-grant-control"
assert_status 409 'reauthorisation cannot revive session control'
run_psql "update auth.oauth_consents set granted_at='${WORKOUT_GRANT}' where user_id='${USER_A_UUID}' and client_id::text='${AGENT_CLIENT_ID}';
  update public.agent_workout_permissions set granted_at='${WORKOUT_GRANT}' where owner_user_id='${USER_A_UUID}' and client_id='${AGENT_CLIENT_ID}';" >/dev/null
agent_get "workouts/active?session_id=${WORKOUT_ID}"
WORKOUT_REV="$(jq -er '.data.workout.revision' <<<"${RESPONSE_BODY}")"
[[ "$(run_psql "select count(*) from app_public.exercise_sets where owner_user_id='${USER_A_UUID}' and session_exercise_id='${WORKOUT_BLOCK}';")" == 4 ]] || fail 'handoff duplicated or lost existing sets'
echo '[agent-api-test] workout control PASS'
