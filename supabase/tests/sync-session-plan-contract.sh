#!/usr/bin/env bash
# Sourced by sync-push-contract.sh: the session planning entities
# (training_programmes, session_plans, session_plan_exercises,
# session_plan_sets) and the three performed-domain provenance links
# (sessions.source_plan_id, session_exercises.source_plan_exercise_id,
# exercise_sets.source_plan_set_id) share the normal Sync v4 LWW contract, land
# in the correct topological layers, enforce the partial-unique retry guards,
# and reject a cross-level provenance mismatch. Reuses the parent lane's
# isolated owners, helpers and cleanup.

echo "[sync-push] session planning graph, provenance, uniqueness and protocol v4"

TP_ID="push-tp-${RUN_TAG}"
SP_ID="push-sp-${RUN_TAG}"
SPE_ID="push-spe-${RUN_TAG}"
SPE2_ID="push-spe2-${RUN_TAG}"
SPS_ID="push-sps-${RUN_TAG}"
SPS2_ID="push-sps2-${RUN_TAG}"
PLAN_SESSION_ID="push-plansess-${RUN_TAG}"
PLAN_SX_ID="push-plansx-${RUN_TAG}"
PLAN_SET_ID="push-planset-${RUN_TAG}"

PLAN_BODY="$(jq -nc \
  --arg tp "${TP_ID}" --arg sp "${SP_ID}" --arg spe "${SPE_ID}" --arg spe2 "${SPE2_ID}" \
  --arg sps "${SPS_ID}" --arg sps2 "${SPS2_ID}" \
  --arg session "${PLAN_SESSION_ID}" --arg sx "${PLAN_SX_ID}" --arg set "${PLAN_SET_ID}" \
  --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "training_programmes", id: $tp, client_updated_at_ms: $ts,
     fields: {name: "Squat Wave", description: "Six weeks",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_plans", id: $sp, client_updated_at_ms: $ts,
     fields: {programme_id: $tp, programme_order_index: 0, gym_id: null,
              title: "Day 1", scheduled_for: null, provenance: "human",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_plan_exercises", id: $spe, client_updated_at_ms: $ts,
     fields: {session_plan_id: $sp, exercise_definition_id: null, order_index: 0,
              name: "Squat", machine_name: "Rack", progress_status: "pending",
              resolved_at: null, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_plan_exercises", id: $spe2, client_updated_at_ms: $ts,
     fields: {session_plan_id: $sp, exercise_definition_id: null, order_index: 1,
              name: "Bench", machine_name: null, progress_status: "pending",
              resolved_at: null, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_plan_sets", id: $sps, client_updated_at_ms: $ts,
     fields: {session_plan_exercise_id: $spe, order_index: 0,
              target_weight_value: "100", target_reps: 5, target_set_type: "rir_4",
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_plan_sets", id: $sps2, client_updated_at_ms: $ts,
     fields: {session_plan_exercise_id: $spe2, order_index: 0,
              target_weight_value: "80", target_reps: 8, target_set_type: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "sessions", id: $session, client_updated_at_ms: $ts,
     fields: {gym_id: null, source_plan_id: $sp, status: "active", started_at: $ts,
              completed_at: null, duration_sec: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "session_exercises", id: $sx, client_updated_at_ms: $ts,
     fields: {session_id: $session, exercise_definition_id: null,
              source_plan_exercise_id: $spe, order_index: 0, name: "Squat",
              machine_name: null, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $set, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $sx, source_plan_set_id: $sps, order_index: 0,
              weight_value: "", reps_value: "", set_type: null,
              planned_weight_value: "100", planned_reps_value: "5",
              planned_set_type: "rir_4", performance_status: "planned",
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"

sync_push "${USER_A_TOKEN}" "${PLAN_BODY}"
assert_status "200" "planning graph initial push"
assert_json_expr '.ok == true' "planning graph initial ack"

# Every planning row landed with its typed fields.
service_select "training_programmes" "owner_user_id=eq.${USER_A_UUID}&id=eq.${TP_ID}&select=id,name,description"
assert_json_expr 'length == 1 and .[0].name == "Squat Wave" and .[0].description == "Six weeks"' "training_programme landed"
service_select "session_plans" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SP_ID}&select=id,programme_id,provenance"
assert_json_expr --arg tp "${TP_ID}" 'length == 1 and .[0].programme_id == $tp and .[0].provenance == "human"' "session_plan landed"
service_select "session_plan_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPE_ID}&select=id,progress_status,name"
assert_json_expr 'length == 1 and .[0].progress_status == "pending" and .[0].name == "Squat"' "session_plan_exercise landed"
service_select "session_plan_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPS_ID}&select=id,target_weight_value,target_reps,target_set_type"
assert_json_expr 'length == 1 and .[0].target_weight_value == "100" and .[0].target_reps == 5 and .[0].target_set_type == "rir_4"' "session_plan_set landed"

# Provenance links landed on the performed graph.
service_select "sessions" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SESSION_ID}&select=source_plan_id"
assert_json_expr --arg sp "${SP_ID}" 'length == 1 and .[0].source_plan_id == $sp' "sessions.source_plan_id landed"
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SX_ID}&select=source_plan_exercise_id"
assert_json_expr --arg spe "${SPE_ID}" 'length == 1 and .[0].source_plan_exercise_id == $spe' "session_exercises.source_plan_exercise_id landed"
service_select "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SET_ID}&select=source_plan_set_id,planned_weight_value,performance_status"
assert_json_expr --arg sps "${SPS_ID}" 'length == 1 and .[0].source_plan_set_id == $sps and .[0].planned_weight_value == "100" and .[0].performance_status == "planned"' "exercise_sets.source_plan_set_id landed"

# Layer mapping: each planning type drains in its planning layer. The parent push
# lane has no sync_pull helper, so post the pull RPC directly.
plan_sync_pull() {
  http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" "app_public" "$1"
}
plan_pull_has_id() {
  # Drain the whole layer (the shared fixture account can carry many rows ahead
  # of ours) and assert our id appears somewhere in it.
  local layer="$1" id="$2" label="$3" cursor=null found=0 guard=0
  while (( guard < 1000 )); do
    guard=$((guard + 1))
    plan_sync_pull "$(jq -nc --argjson layer "${layer}" --argjson cursor "${cursor}" '{layer: $layer, cursor: $cursor, limit: 200}')"
    assert_status "200" "${label} pull layer ${layer}"
    if [[ "$(printf '%s' "${REQUEST_BODY}" | jq -r --arg id "${id}" 'any(.entities[]; .id == $id)')" == true ]]; then
      found=1
    fi
    [[ "$(printf '%s' "${REQUEST_BODY}" | jq -r '.has_more')" == true ]] || break
    cursor="$(printf '%s' "${REQUEST_BODY}" | jq -c '.next_cursor')"
  done
  if [[ "${found}" != 1 ]]; then
    echo "[fail] ${label} (${id}) did not appear anywhere in layer ${layer}" >&2
    exit 1
  fi
}
plan_pull_has_id 1 "${SP_ID}" "session_plans"
plan_pull_has_id 2 "${PLAN_SESSION_ID}" "sessions"
plan_pull_has_id 2 "${SPE_ID}" "session_plan_exercises"
plan_pull_has_id 3 "${PLAN_SX_ID}" "session_exercises"
plan_pull_has_id 3 "${SPS_ID}" "session_plan_sets"
plan_pull_has_id 4 "${PLAN_SET_ID}" "exercise_sets"
plan_pull_has_id 0 "${TP_ID}" "training_programmes"

# Partial-unique retry guard: a second live session for the same whole-plan
# start is rejected.
DUP_SESSION_BODY="$(jq -nc \
  --arg id "push-plansess2-${RUN_TAG}" --arg sp "${SP_ID}" --argjson ts "$((BASE_MS + 1))" '
  {entities: [{type: "sessions", id: $id, client_updated_at_ms: $ts,
    fields: {gym_id: null, source_plan_id: $sp, status: "active", started_at: $ts,
             completed_at: null, duration_sec: null,
             created_at: $ts, updated_at: $ts, deleted_at: null}}]}')"
sync_push "${USER_A_TOKEN}" "${DUP_SESSION_BODY}"
assert_non_2xx "second live session for the same plan rejected"
assert_body_contains "BLOCK_ALREADY_ATTACHED" "second live session carries the arbitration token"
assert_body_contains "sessions_owner_source_plan_unique" "second live session hits the partial-unique guard"

# Partial-unique retry guard: a second live performed set for the same target
# is rejected.
DUP_SET_BODY="$(jq -nc \
  --arg id "push-planset2-${RUN_TAG}" --arg sx "${PLAN_SX_ID}" --arg sps "${SPS_ID}" --argjson ts "$((BASE_MS + 2))" '
  {entities: [{type: "exercise_sets", id: $id, client_updated_at_ms: $ts,
    fields: {session_exercise_id: $sx, source_plan_set_id: $sps, order_index: 1,
             weight_value: "", reps_value: "", set_type: null,
             planned_weight_value: null, planned_reps_value: null,
             planned_set_type: null, performance_status: "planned",
             created_at: $ts, updated_at: $ts, deleted_at: null}}]}')"
sync_push "${USER_A_TOKEN}" "${DUP_SET_BODY}"
assert_non_2xx "second live performed set for the same target rejected"
assert_body_contains "BLOCK_ALREADY_ATTACHED" "second live set carries the arbitration token"
assert_body_contains "exercise_sets_owner_source_set_unique" "second live performed set hits the partial-unique guard"

# §4.5 arbitration: a second live performed card claiming the same plan block
# is rejected with the wire-stable BLOCK_ALREADY_ATTACHED token, and the batch
# rolls back atomically — the losing card and the work-carrying set inside it
# write nothing. Server commit order is the only tiebreak; the loser device's
# client pulls the winner and clears its losing provenance deterministically.
DUP_CARD_BODY="$(jq -nc \
  --arg id "push-plansx2-${RUN_TAG}" --arg setid "push-planset3-${RUN_TAG}" \
  --arg session "${PLAN_SESSION_ID}" --arg spe "${SPE_ID}" --argjson ts "$((BASE_MS + 6))" '
  {entities: [
    {type: "session_exercises", id: $id, client_updated_at_ms: $ts,
     fields: {session_id: $session, exercise_definition_id: null,
              source_plan_exercise_id: $spe, order_index: 1, name: "Squat Copy",
              machine_name: null, created_at: $ts, updated_at: $ts, deleted_at: null}},
    {type: "exercise_sets", id: $setid, client_updated_at_ms: $ts,
     fields: {session_exercise_id: $id, source_plan_set_id: null, order_index: 0,
              weight_value: "55", reps_value: "7", set_type: null,
              planned_weight_value: null, planned_reps_value: null,
              planned_set_type: null, performance_status: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${DUP_CARD_BODY}"
assert_non_2xx "second live card for the same plan block rejected"
assert_body_contains "BLOCK_ALREADY_ATTACHED" "competing card carries the arbitration token"
assert_body_contains "session_exercises_owner_source_block_unique" "competing card hits the partial-unique guard"
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.push-plansx2-${RUN_TAG}&select=id"
assert_json_expr 'length == 0' "competing card wrote no row"
service_select "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.push-planset3-${RUN_TAG}&select=id"
assert_json_expr 'length == 0' "competing card's set wrote no row"

# Cross-level provenance: a source-derived set must sit under the card sourced
# from its plan set's parent block. PLAN_SX_ID is sourced from SPE_ID, so a set
# claiming SPS2_ID (under SPE2_ID) must be rejected atomically.
MISMATCH_BODY="$(jq -nc \
  --arg id "push-planset-mismatch-${RUN_TAG}" --arg sx "${PLAN_SX_ID}" --arg sps "${SPS2_ID}" --argjson ts "$((BASE_MS + 3))" '
  {entities: [{type: "exercise_sets", id: $id, client_updated_at_ms: $ts,
    fields: {session_exercise_id: $sx, source_plan_set_id: $sps, order_index: 2,
             weight_value: "", reps_value: "", set_type: null,
             planned_weight_value: null, planned_reps_value: null,
             planned_set_type: null, performance_status: "planned",
             created_at: $ts, updated_at: $ts, deleted_at: null}}]}')"
sync_push "${USER_A_TOKEN}" "${MISMATCH_BODY}"
assert_non_2xx "cross-level provenance mismatch rejected"
assert_body_contains "PROVENANCE_VIOLATION" "cross-level mismatch carries the PROVENANCE_VIOLATION token"
service_select "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.push-planset-mismatch-${RUN_TAG}&select=id"
assert_json_expr 'length == 0' "cross-level mismatch wrote no row"

# A parent-only change must re-validate dependents too. Reparenting the plan set
# that a performed set already references (to the other block) leaves the set
# across two blocks and must be rejected.
REPARENT_SET_BODY="$(jq -nc \
  --arg id "${SPS_ID}" --arg spe2 "${SPE2_ID}" --argjson ts "$((BASE_MS + 4))" '
  {entities: [{type: "session_plan_sets", id: $id, client_updated_at_ms: $ts,
    fields: {session_plan_exercise_id: $spe2, order_index: 0,
             target_weight_value: "100", target_reps: 5, target_set_type: "rir_4",
             created_at: $ts, updated_at: $ts, deleted_at: null}}]}')"
sync_push "${USER_A_TOKEN}" "${REPARENT_SET_BODY}"
assert_non_2xx "reparenting a referenced plan set rejected"
assert_body_contains "PROVENANCE_VIOLATION" "reparent carries the PROVENANCE_VIOLATION token"
service_select "session_plan_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPS_ID}&select=session_plan_exercise_id"
assert_json_expr --arg spe "${SPE_ID}" 'length == 1 and .[0].session_plan_exercise_id == $spe' "reparent wrote no change"

# Changing a card's source block while it still carries a source-derived set is
# likewise rejected.
CHANGE_CARD_BODY="$(jq -nc \
  --arg id "${PLAN_SX_ID}" --arg session "${PLAN_SESSION_ID}" --arg spe2 "${SPE2_ID}" --argjson ts "$((BASE_MS + 5))" '
  {entities: [{type: "session_exercises", id: $id, client_updated_at_ms: $ts,
    fields: {session_id: $session, exercise_definition_id: null, source_plan_exercise_id: $spe2,
             order_index: 0, name: "Squat", machine_name: null,
             created_at: $ts, updated_at: $ts, deleted_at: null}}]}')"
sync_push "${USER_A_TOKEN}" "${CHANGE_CARD_BODY}"
assert_non_2xx "changing a sourced card's block rejected"
assert_body_contains "PROVENANCE_VIOLATION" "card source change carries the PROVENANCE_VIOLATION token"
service_select "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SX_ID}&select=source_plan_exercise_id"
assert_json_expr --arg spe "${SPE_ID}" 'length == 1 and .[0].source_plan_exercise_id == $spe' "card source change wrote no change"

# The update-required cutoff for every old/malformed protocol value is covered
# once by sync-bodyweight-contract.sh (sourced immediately before this suite).

# Cleanup this suite's rows (the parent's cleanup does not know these ids).
service_delete "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.push-planset-mismatch-${RUN_TAG}" >/dev/null 2>&1 || true
service_delete "exercise_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SET_ID}" >/dev/null 2>&1 || true
service_delete "session_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SX_ID}" >/dev/null 2>&1 || true
service_delete "sessions" "owner_user_id=eq.${USER_A_UUID}&id=eq.${PLAN_SESSION_ID}" >/dev/null 2>&1 || true
service_delete "session_plan_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPS_ID}" >/dev/null 2>&1 || true
service_delete "session_plan_sets" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPS2_ID}" >/dev/null 2>&1 || true
service_delete "session_plan_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPE_ID}" >/dev/null 2>&1 || true
service_delete "session_plan_exercises" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SPE2_ID}" >/dev/null 2>&1 || true
service_delete "session_plans" "owner_user_id=eq.${USER_A_UUID}&id=eq.${SP_ID}" >/dev/null 2>&1 || true
service_delete "training_programmes" "owner_user_id=eq.${USER_A_UUID}&id=eq.${TP_ID}" >/dev/null 2>&1 || true

echo "[sync-push] session planning graph contract passed"
