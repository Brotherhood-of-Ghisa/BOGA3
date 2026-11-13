#!/usr/bin/env bash
# Sourced by agent-api-contract.sh with its real OAuth identities and HTTP helpers.
# Proves atomic injury logging, status updates, replay, and bounded owner authority.

echo '[agent-api-test] verifying injuries: list, filter, log, update, resolution, and idempotency'

# Clean any existing run-tagged injuries from fixture runs
run_psql "delete from app_public.injuries where owner_user_id = '${USER_A_UUID}'::uuid and label like 'agent-api-${RUN_TAG} %';" >/dev/null

# Ensure canonical muscle groups exist for USER_A_UUID
run_psql "
  insert into app_public.muscle_groups (owner_user_id, id, display_name, family_name, sort_order, is_editable, tracked, created_at, updated_at, client_updated_at_ms)
  values
    ('${USER_A_UUID}'::uuid, 'quads', 'Quads', 'Legs', 13, 0, 1, ${NOW_MS}, ${NOW_MS}, ${NOW_MS}),
    ('${USER_A_UUID}'::uuid, 'rotator_cuff', 'Rotator Cuff', 'Shoulders', 3, 0, 1, ${NOW_MS}, ${NOW_MS}, ${NOW_MS}),
    ('${USER_A_UUID}'::uuid, 'spinal_erectors', 'Spinal Erectors', 'Back', 7, 0, 1, ${NOW_MS}, ${NOW_MS}, ${NOW_MS})
  on conflict (owner_user_id, id) do nothing;
" >/dev/null

# 1. Base list read
agent_get "injuries"
assert_status 200 "list injuries default"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data | (has("injuries") and has("next_cursor") and (.injuries | type == "array"))
' >/dev/null || fail "injuries list response does not match envelope shape"

# 2. Query param validation
agent_get "injuries?status=nonexistent_status"
assert_status 400 "invalid injury status query"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "invalid status query did not return INVALID_ARGUMENT"

agent_get "injuries?unsupported_field=1"
assert_status 400 "unsupported query parameter"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "unsupported query parameter did not return INVALID_ARGUMENT"

# 3. Write validation errors
agent_post "injuries" '{"label":"test without key"}' ""
assert_status 400 "injury add without idempotency key"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "missing idempotency key did not return INVALID_ARGUMENT"

agent_post "injuries" '{"label":"   "}' "agent-api-${RUN_TAG}-inj-blank-label"
assert_status 400 "injury add with blank label"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "blank label did not return INVALID_ARGUMENT"

agent_post "injuries" '{"label":"Invalid muscle","muscle_group_id":"not_a_canonical_muscle"}' "agent-api-${RUN_TAG}-inj-bad-muscle"
assert_status 400 "injury add with invalid canonical muscle"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ANATOMY_REFERENCE" ]] ||
  fail "invalid muscle did not return INVALID_ANATOMY_REFERENCE"

agent_post "injuries" '{"label":"Bad pain rating","pain_score":25}' "agent-api-${RUN_TAG}-inj-bad-pain"
assert_status 400 "injury add with pain rating > 10"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "bad pain rating did not return INVALID_ARGUMENT"

agent_post "injuries" '{"label":"Future injury","started_at":"2099-01-01T00:00:00Z"}' "agent-api-${RUN_TAG}-inj-future"
assert_status 400 "injury add with future started_at"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INVALID_ARGUMENT" ]] ||
  fail "future started_at did not return INVALID_ARGUMENT"

# 4. Successful injury log
INJURY_KEY_1="agent-api-${RUN_TAG}-inj-1"
INJURY_BODY_1="$(jq -nc --arg label "agent-api-${RUN_TAG} Patellar tendon irritation" '
  {
    label: $label,
    muscle_group_id: "quads",
    side: "right",
    status: "acute",
    pain_score: 7,
    notes: "Sharp pain on deep knee flexion",
    contraindications: "Deep back squats, leg extensions past 60 deg"
  }
')"

agent_post "injuries" "${INJURY_BODY_1}" "${INJURY_KEY_1}"
assert_status 200 "agent logs new injury"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.idempotent_replay == false
  and .data.injury.muscle_group_id == "quads"
  and .data.injury.muscle_group_name == "Quads"
  and .data.injury.side == "right"
  and .data.injury.status == "acute"
  and .data.injury.pain_score == 7
  and .data.injury.resolved_at == null
  and (.data.injury.started_at | type == "string")
  and (.data.injury.created_at | type == "string")
  and (.data.injury.updated_at | type == "string")
' >/dev/null || fail "created injury projection does not match contract"

INJURY_ID_1="$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.injury.id')"

# 5. Idempotent replay
agent_post "injuries" "${INJURY_BODY_1}" "${INJURY_KEY_1}"
assert_status 200 "agent logs injury replay"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.idempotent_replay == true
  and .data.injury.id == $id
' >/dev/null || fail "injury add replay failed"

# 6. Idempotency conflict
INJURY_BODY_CONFLICT="$(jq -nc --arg label "agent-api-${RUN_TAG} Different conflict" '{label:$label}')"
agent_post "injuries" "${INJURY_BODY_CONFLICT}" "${INJURY_KEY_1}"
assert_status 409 "injury add idempotency conflict"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "IDEMPOTENCY_CONFLICT" ]] ||
  fail "idempotency conflict did not return IDEMPOTENCY_CONFLICT"

# 7. Unmapped regional injury (null muscle_group_id)
INJURY_KEY_UNMAPPED="agent-api-${RUN_TAG}-inj-unmapped"
INJURY_BODY_UNMAPPED="$(jq -nc --arg label "agent-api-${RUN_TAG} Rib bruise" '
  {
    label: $label,
    muscle_group_id: null,
    side: "left",
    status: "managing",
    pain_score: 4,
    notes: "Blunt impact"
  }
')"
agent_post "injuries" "${INJURY_BODY_UNMAPPED}" "${INJURY_KEY_UNMAPPED}"
assert_status 200 "agent logs unmapped regional injury"
printf '%s' "${RESPONSE_BODY}" | jq -e '
  .data.injury.muscle_group_id == null
  and .data.injury.muscle_group_name == null
  and .data.injury.status == "managing"
' >/dev/null || fail "unmapped regional injury projection failed"

INJURY_ID_UNMAPPED="$(printf '%s' "${RESPONSE_BODY}" | jq -r '.data.injury.id')"

# 8. List filter checks
agent_get "injuries?status=acute"
assert_status 200 "list acute injuries"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.injuries | map(.id) | index($id) != null
' >/dev/null || fail "acute injury list did not contain newly logged acute injury"

# 9. Injury update (transition to managing and reduce pain score)
UPDATE_KEY_1="agent-api-${RUN_TAG}-inj-upd-1"
UPDATE_BODY_1='{"status":"managing","pain_score":3,"notes":"Improving with box squats"}'
agent_patch "injuries/${INJURY_ID_1}" "${UPDATE_BODY_1}" "${UPDATE_KEY_1}"
assert_status 200 "agent updates injury status"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.idempotent_replay == false
  and .data.injury.id == $id
  and .data.injury.status == "managing"
  and .data.injury.pain_score == 3
  and .data.injury.notes == "Improving with box squats"
  and .data.injury.resolved_at == null
' >/dev/null || fail "updated injury projection does not match"

# 10. Update replay
agent_patch "injuries/${INJURY_ID_1}" "${UPDATE_BODY_1}" "${UPDATE_KEY_1}"
assert_status 200 "agent updates injury replay"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.idempotent_replay == true
  and .data.injury.id == $id
' >/dev/null || fail "injury update replay failed"

# 11. Update conflict
agent_patch "injuries/${INJURY_ID_1}" '{"status":"acute"}' "${UPDATE_KEY_1}"
assert_status 409 "injury update conflict"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "IDEMPOTENCY_CONFLICT" ]] ||
  fail "update idempotency conflict did not return IDEMPOTENCY_CONFLICT"

# 12. Transition to resolved sets resolved_at
RESOLVE_KEY="agent-api-${RUN_TAG}-inj-resolve"
agent_patch "injuries/${INJURY_ID_1}" '{"status":"resolved"}' "${RESOLVE_KEY}"
assert_status 200 "agent marks injury resolved"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.injury.id == $id
  and .data.injury.status == "resolved"
  and (.data.injury.resolved_at | type == "string")
' >/dev/null || fail "resolving injury did not populate resolved_at ISO string"

# 13. Resolved injury excluded by default, included with include_resolved=true
agent_get "injuries"
assert_status 200 "list injuries excludes resolved by default"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.injuries | map(.id) | index($id) == null
' >/dev/null || fail "resolved injury was not excluded from default list"

agent_get "injuries?include_resolved=true"
assert_status 200 "list injuries with include_resolved=true"
printf '%s' "${RESPONSE_BODY}" | jq -e --arg id "${INJURY_ID_1}" '
  .data.injuries | map(.id) | index($id) != null
' >/dev/null || fail "resolved injury was not included when include_resolved=true"

# 14. Nonexistent / foreign injury returns 404 INJURY_NOT_FOUND
agent_patch "injuries/nonexistent-injury-uuid" '{"status":"resolved"}' "agent-api-${RUN_TAG}-inj-missing"
assert_status 404 "update nonexistent injury"
[[ "$(printf '%s' "${RESPONSE_BODY}" | jq -r '.error.code')" == "INJURY_NOT_FOUND" ]] ||
  fail "updating nonexistent injury did not return INJURY_NOT_FOUND"

echo '[agent-api-test] injury lifecycle and contract tests passed'
