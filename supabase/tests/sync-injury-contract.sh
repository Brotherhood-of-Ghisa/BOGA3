#!/usr/bin/env bash
# Sourced by sync-push-contract.sh: injury lifecycle states, soft-delete,
# anatomical linkage, and strict owner privacy under Sync v2.

echo "[sync-push] injury contract: push, pull, LWW, soft-delete, and owner isolation"

INJ_PREFIX="push-injury-${RUN_TAG}"
INJ_ID="${INJ_PREFIX}-1"
INJ_MG_ID="${INJ_PREFIX}-mg"

# Create a muscle group for user A to anchor the injury
MG_BODY="$(jq -nc --arg id "${INJ_MG_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "muscle_groups", id: $id, client_updated_at_ms: $ts,
     fields: {display_name: "Knee Extensors", family_name: "Legs", sort_order: 10, is_editable: 0,
              report_group: null, tracked: 1, created_at: $ts, updated_at: $ts}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${MG_BODY}"
assert_status 200 "muscle group seeded for injury contract"

# 1. Push an acute injury record
INJ_BODY="$(jq -nc --arg id "${INJ_ID}" --arg mg "${INJ_MG_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "injuries", id: $id, client_updated_at_ms: $ts,
     fields: {muscle_group_id: $mg, side: "left", status: "acute", pain_score: 7,
              label: "Left Patellar Tendonitis", notes: "Pain on deep knee flexion",
              contraindications: "Heavy squats", started_at: $ts, resolved_at: null,
              created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${INJ_BODY}"
assert_status 200 "acute injury pushed successfully"

user_select injuries "id=eq.${INJ_ID}&select=id,muscle_group_id,side,status,pain_score,label,notes,contraindications,started_at,resolved_at,deleted_at" "${USER_A_TOKEN}"
assert_json_expr --arg mg "${INJ_MG_ID}" --argjson ts "${BASE_MS}" '
  .[0] == {
    id: .[0].id,
    muscle_group_id: $mg,
    side: "left",
    status: "acute",
    pain_score: 7,
    label: "Left Patellar Tendonitis",
    notes: "Pain on deep knee flexion",
    contraindications: "Heavy squats",
    started_at: $ts,
    resolved_at: null,
    deleted_at: null
  }
' "user A reads back the pushed injury fields"

# 2. LWW update: update lifecycle state to managing with decreased pain score
INJ_UPDATE_BODY="$(jq -nc --arg id "${INJ_ID}" --arg mg "${INJ_MG_ID}" --argjson ts "$((BASE_MS + 1000))" '
  {entities: [
    {type: "injuries", id: $id, client_updated_at_ms: $ts,
     fields: {muscle_group_id: $mg, side: "left", status: "managing", pain_score: 3,
              label: "Left Patellar Tendonitis", notes: "Improving with box squats",
              contraindications: "Full ATG squats", started_at: ($ts - 1000), resolved_at: null,
              created_at: ($ts - 1000), updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${INJ_UPDATE_BODY}"
assert_status 200 "injury updated to managing state"

user_select injuries "id=eq.${INJ_ID}&select=status,pain_score,notes" "${USER_A_TOKEN}"
assert_json_expr '.[0] == {status: "managing", pain_score: 3, notes: "Improving with box squats"}' \
  "LWW update reflected in stored row"

# 3. Pull projection: verify sync_pull layer 1 includes injuries
PULL_BODY="$(jq -nc '{layer: 1, cursor: null, limit: 100}')"
http_request POST "${API_URL}/rest/v1/rpc/sync_pull" "${USER_A_TOKEN}" "${ANON_KEY}" "app_public" "${PULL_BODY}"
assert_status 200 "sync_pull layer 1 returns 200"
assert_json_expr --arg id "${INJ_ID}" '
  [.entities[] | select(.type == "injuries" and .id == $id)] | length == 1
' "sync_pull layer 1 contains the injury envelope"

# 4. Soft delete via tombstone
INJ_DELETE_BODY="$(jq -nc --arg id "${INJ_ID}" --arg mg "${INJ_MG_ID}" --argjson ts "$((BASE_MS + 2000))" '
  {entities: [
    {type: "injuries", id: $id, client_updated_at_ms: $ts,
     fields: {muscle_group_id: $mg, side: "left", status: "resolved", pain_score: 0,
              label: "Left Patellar Tendonitis", notes: "Resolved",
              contraindications: null, started_at: ($ts - 2000), resolved_at: $ts,
              created_at: ($ts - 2000), updated_at: $ts, deleted_at: $ts}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${INJ_DELETE_BODY}"
assert_status 200 "soft deletion tombstone pushed"

user_select injuries "id=eq.${INJ_ID}&select=status,deleted_at,resolved_at" "${USER_A_TOKEN}"
assert_json_expr --argjson ts "$((BASE_MS + 2000))" '
  .[0] == {status: "resolved", deleted_at: $ts, resolved_at: $ts}
' "tombstone recorded in database"

# 5. Owner privacy: User B cannot select User A's injury
user_select injuries "id=eq.${INJ_ID}&select=id" "${USER_B_TOKEN}"
assert_json_expr 'length == 0' "User B cannot read User A's injury"

# 6. Behavioral parent delete: deleting the referenced muscle_group clears ONLY muscle_group_id
# while retaining the injury record and its owner_user_id (ON DELETE SET NULL (muscle_group_id)).
INJ_PARENT_DEL_MG_ID="${INJ_PREFIX}-mg-del"
INJ_PARENT_DEL_ID="${INJ_PREFIX}-inj-del"
MG_PARENT_DEL_BODY="$(jq -nc --arg id "${INJ_PARENT_DEL_MG_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "muscle_groups", id: $id, client_updated_at_ms: $ts,
     fields: {display_name: "Deletable Muscle", family_name: "Legs", sort_order: 12, is_editable: 1,
              report_group: null, tracked: 1, created_at: $ts, updated_at: $ts}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${MG_PARENT_DEL_BODY}"
assert_status 200 "seed deletable muscle group"

INJ_PARENT_DEL_BODY="$(jq -nc --arg id "${INJ_PARENT_DEL_ID}" --arg mg "${INJ_PARENT_DEL_MG_ID}" --argjson ts "${BASE_MS}" '
  {entities: [
    {type: "injuries", id: $id, client_updated_at_ms: $ts,
     fields: {muscle_group_id: $mg, side: "both", status: "acute", pain_score: 5,
              label: "Bilateral Strain", notes: null, contraindications: null,
              started_at: $ts, resolved_at: null, created_at: $ts, updated_at: $ts, deleted_at: null}}
  ]}')"
sync_push "${USER_A_TOKEN}" "${INJ_PARENT_DEL_BODY}"
assert_status 200 "seed injury linked to deletable muscle group"

# Authenticated delete of the referenced muscle group
http_request DELETE "${API_URL}/rest/v1/muscle_groups?id=eq.${INJ_PARENT_DEL_MG_ID}" "${USER_A_TOKEN}" "${ANON_KEY}" "app_public"
assert_status 204 "authenticated delete of referenced muscle group succeeds without owner immutability error"

# Verify injury survives and has muscle_group_id set to null, with owner_user_id intact
user_select injuries "id=eq.${INJ_PARENT_DEL_ID}&select=id,muscle_group_id,owner_user_id" "${USER_A_TOKEN}"
assert_json_expr --arg inj_id "${INJ_PARENT_DEL_ID}" --arg owner "${USER_A_UUID}" '
  .[0] == {id: $inj_id, muscle_group_id: null, owner_user_id: $owner}
' "injury survived with muscle_group_id set to null and owner_user_id unchanged"

service_delete injuries "id=eq.${INJ_PARENT_DEL_ID}"

# Cleanup
service_delete injuries "id=eq.${INJ_ID}"
service_delete muscle_groups "id=eq.${INJ_MG_ID}"
echo "[sync-push] injury contract passed"
