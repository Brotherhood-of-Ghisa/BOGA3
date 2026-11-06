#!/usr/bin/env bash
# Sourced by sync-push-contract.sh: real owner-scoped repeat claims, immutable
# history, first-commit Start/Skip arbitration, and standalone-only storage.

ROUTINE_PREFIX="push-routine-${RUN_TAG}"
ROUTINE_GRAPH="$(jq -nc --arg p "${ROUTINE_PREFIX}" --argjson ts "${BASE_MS}" '
  {entities:[
    {type:"session_plans",id:($p+"-plan"),client_updated_at_ms:$ts,fields:{
      title:"Routine",is_routine:true,programme_id:null,programme_order_index:null,gym_id:null,
      scheduled_for:$ts,provenance:"human",last_modified_by:"human",created_at:$ts,updated_at:$ts,deleted_at:null}},
    {type:"session_plan_exercises",id:($p+"-block"),client_updated_at_ms:$ts,fields:{
      session_plan_id:($p+"-plan"),exercise_definition_id:null,order_index:0,name:"Squat",
      progress_status:"pending",resolved_at:null,last_modified_by:"human",created_at:$ts,updated_at:$ts,deleted_at:null}},
    {type:"session_plan_sets",id:($p+"-target"),client_updated_at_ms:$ts,fields:{
      session_plan_exercise_id:($p+"-block"),order_index:0,target_weight_value:"60",target_reps:5,
      target_set_type:null,last_modified_by:"human",created_at:$ts,updated_at:$ts,deleted_at:null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${ROUTINE_GRAPH}"
assert_status 200 "standalone Routine graph accepted"

routine_action_body() {
  jq -nc --arg p "${ROUTINE_PREFIX}" --arg action "$1" --argjson slot "$2" --arg kind "$3" --argjson ts "$((BASE_MS + 1000))" '
    ($p+"-"+$action) as $a |
    {entities: ([{type:"session_plan_uses",id:($a+"-use"),client_updated_at_ms:$ts,fields:{
      session_plan_id:($p+"-plan"),slot_index:$slot,kind:$kind,skipped_at:(if $kind=="skip" then $ts else null end),
      created_at:$ts,updated_at:$ts,deleted_at:null}}] +
    (if $kind=="workout" then [
      {type:"sessions",id:($a+"-session"),client_updated_at_ms:$ts,fields:{
        source_plan_id:($p+"-plan"),source_plan_use_id:($a+"-use"),gym_id:null,status:"completed",
        started_at:$ts,completed_at:($ts+100),duration_sec:0,created_at:$ts,updated_at:$ts,deleted_at:null}},
      {type:"session_exercises",id:($a+"-card"),client_updated_at_ms:$ts,fields:{
        session_id:($a+"-session"),source_plan_exercise_id:($p+"-block"),source_plan_use_id:($a+"-use"),
        exercise_definition_id:null,order_index:0,name:"Squat",machine_name:null,merge_revision:0,
        created_at:$ts,updated_at:$ts,deleted_at:null}},
      {type:"exercise_sets",id:($a+"-set"),client_updated_at_ms:$ts,fields:{
        session_exercise_id:($a+"-card"),source_plan_set_id:($p+"-target"),source_plan_use_id:($a+"-use"),
        order_index:0,weight_value:"60",reps_value:"5",set_type:null,planned_weight_value:"60",planned_reps_value:"5",
        planned_set_type:null,performance_status:null,merge_revision:0,created_at:$ts,updated_at:$ts,deleted_at:null}}
    ] else [] end))}'
}

ROUTINE_FIRST="$(routine_action_body first 1 workout)"
ROUTINE_SECOND="$(routine_action_body second 2 workout)"
sync_push "${USER_A_TOKEN}" "${ROUTINE_FIRST}"
assert_status 200 "first Routine use accepted"
sync_push "${USER_A_TOKEN}" "${ROUTINE_SECOND}"
assert_status 200 "same authored blocks and targets accepted in a second use"
sync_push "${USER_A_TOKEN}" "${ROUTINE_SECOND}"
assert_status 200 "same action retry accepted idempotently"
user_select sessions "source_plan_id=eq.${ROUTINE_PREFIX}-plan&select=id,source_plan_use_id" "${USER_A_TOKEN}"
assert_json_expr 'length==2 and (map(.source_plan_use_id)|unique|length)==2' "two immutable workout identities"

sync_push "${USER_A_TOKEN}" "$(routine_action_body stale 1 workout)"
assert_non_2xx "delayed offline Start cannot reuse a completed reservation"
assert_body_contains BLOCK_ALREADY_ATTACHED "Start race uses recoverable arbitration token"
user_select sessions "id=eq.${ROUTINE_PREFIX}-stale-session&select=id" "${USER_A_TOKEN}"
assert_json_expr 'length==0' "losing batch creates no partial workout"

ROUTINE_SKIP="$(routine_action_body skip 3 skip)"
sync_push "${USER_A_TOKEN}" "${ROUTINE_SKIP}"
assert_status 200 "explicit Routine Skip accepted"
sync_push "${USER_A_TOKEN}" "${ROUTINE_SKIP}"
assert_status 200 "same Skip retry accepted idempotently"
sync_push "${USER_A_TOKEN}" "$(routine_action_body raced-start 3 workout)"
assert_non_2xx "Skip winning a Start race retains its reservation"
assert_body_contains BLOCK_ALREADY_ATTACHED "Start/Skip race is recoverable"
user_select sessions "source_plan_id=eq.${ROUTINE_PREFIX}-plan&select=id" "${USER_A_TOKEN}"
assert_json_expr 'length==2' "Skip and rejected Start add no performed workout"

ROUTINE_MUTATION="$(printf '%s' "${ROUTINE_SECOND}" | jq '{entities:[.entities[]|select(.type=="session_plan_uses")|.client_updated_at_ms+=100|.fields.slot_index=9]}')"
sync_push "${USER_A_TOKEN}" "${ROUTINE_MUTATION}"
assert_non_2xx "a use identity cannot move to another slot"
assert_body_contains PROVENANCE_VIOLATION "immutable action provenance guard"

ROUTINE_MISMATCH="$(printf '%s' "${ROUTINE_SECOND}" | jq --arg use "${ROUTINE_PREFIX}-skip-use" '
  {entities:[.entities[]|select(.type=="session_exercises")|.client_updated_at_ms+=200|.fields.source_plan_use_id=$use]}')"
sync_push "${USER_A_TOKEN}" "${ROUTINE_MISMATCH}"
assert_non_2xx "parent-only source-use mismatch rejected"
assert_body_contains PROVENANCE_VIOLATION "cross-level use guard"

ROUTINE_PROGRAMME="$(printf '%s' "${ROUTINE_GRAPH}" | jq --arg p "${ROUTINE_PREFIX}" --argjson ts "$((BASE_MS + 2000))" '
  {entities:[{type:"training_programmes",id:($p+"-programme"),client_updated_at_ms:$ts,
    fields:{name:"Programme",description:null,last_modified_by:"human",created_at:$ts,updated_at:$ts,deleted_at:null}},
    (.entities[]|select(.type=="session_plans")|.client_updated_at_ms=$ts|.fields.programme_id=($p+"-programme"))]}')"
sync_push "${USER_A_TOKEN}" "${ROUTINE_PROGRAMME}"
assert_non_2xx "Routine plus programme membership rejected atomically"
user_select session_plans "id=eq.${ROUTINE_PREFIX}-plan&select=programme_id,is_routine,scheduled_for" "${USER_A_TOKEN}"
assert_json_expr --argjson ts "${BASE_MS}" '.[0]=={programme_id:null,is_routine:true,scheduled_for:$ts}' "refused conversion preserves intent"
user_select training_programmes "id=eq.${ROUTINE_PREFIX}-programme&select=id" "${USER_A_TOKEN}"
assert_json_expr 'length==0' "refused conversion leaves no partial programme"

user_select session_plan_uses "session_plan_id=eq.${ROUTINE_PREFIX}-plan&select=id" "${USER_B_TOKEN}"
assert_json_expr 'length==0' "another owner cannot read Routine uses"
sync_push "${USER_B_TOKEN}" "$(routine_action_body cross-owner 4 skip)"
assert_non_2xx "another owner cannot reference the Routine"
assert_body_contains FK_VIOLATION "Routine use ownership enforced by composite FK"
user_select exercise_sets "id=in.(${ROUTINE_PREFIX}-first-set,${ROUTINE_PREFIX}-second-set)&select=weight_value,reps_value,source_plan_use_id" "${USER_A_TOKEN}"
assert_json_expr 'length==2 and all(.[];.weight_value=="60" and .reps_value=="5" and .source_plan_use_id!=null)' "failed races and writes preserve earlier actuals and links"

# Delete performed rows before use reservations and authored intent.
for routine_table in exercise_sets session_exercises sessions session_plan_uses session_plan_sets session_plan_exercises session_plans; do
  service_delete "${routine_table}" "owner_user_id=eq.${USER_A_UUID}&id=like.${ROUTINE_PREFIX}*"
done
echo '[sync-push] Routine repeat-use contract passed'
