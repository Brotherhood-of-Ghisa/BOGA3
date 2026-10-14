#!/usr/bin/env bash
# Real app/service role, installation, queue and deterministic Edge provider contract.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL=notification-delivery
FIXTURE_EMAIL_PREFIX=notification
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"
# Prepared responses contain installation secrets; failure context/status suffice.
fail() { echo "[${LANE_LABEL}] FAIL: $* (HTTP ${STATUS})" >&2; exit 1; }
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"
RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="NotificationContract!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
psql_session_start
GROUP_ID=""
RACE_DIR=""
cleanup() {
  [[ -z "${GROUP_ID}" ]] || run_psql_once "delete from app_public.groups where id='${GROUP_ID}';" >/dev/null
  for uid in "${RUN_USER_IDS[@]}"; do run_psql_once "delete from auth.users where id='${uid}';" >/dev/null; done
  run_psql_once "delete from app_public.notification_config;" >/dev/null
  [[ -z "${RACE_DIR}" ]] || rm -rf "${RACE_DIR}"
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

# Runtime-native tests require no DB, network permission or provider credentials.
npx -y deno@2.9.6 test "${SUPABASE_DIR}/functions/notification-worker/handler.test.ts"
provision A recipient
provision B lifter
provision C outsider
set_username "${A_UID}" Recipient
set_username "${B_UID}" Lifter
rpc "${A_TOKEN}" group_create '{"p_name":"Notification contract","p_description":""}'
expect_ok 'create group'
GROUP_ID="$(jq -r '.group_id' <<<"${BODY}")"
# Seed memberships/source graph directly: intake is owned by the producer task.
run_psql "set request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}'; insert into app_public.group_memberships(group_id,user_id,role,joined_at)
  values('${GROUP_ID}','${B_UID}','member',now()-interval '1 hour');
  insert into app_public.notification_config(environment,project_id,bundle_id,sending_enabled,provider)
  values('local','3c00cd23-0946-4eb6-bbf0-4542879cd314','com.phano.boga3.dev',false,'local');
  insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
  values('${B_UID}','notification-${RUN_TAG}','active',floor(extract(epoch from now())*1000),1,1,1);" >/dev/null
INSTALL_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
CAPABILITY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
REGISTER="$(jq -nc --arg i "${INSTALL_ID}" --arg c "${CAPABILITY}" --arg k "${KEY}" \
  '{p_installation_id:$i,p_capability:$c,p_encryption_key:$k,p_token:"LocalPushToken[ok]",p_environment:"local",
    p_project_id:"3c00cd23-0946-4eb6-bbf0-4542879cd314",p_bundle_id:"com.phano.boga3.dev",p_permission:true,p_opted_in:true}')"
AGENT="$(mint_token "${A_TOKEN}" notification-probe)"
RPC_BODIES=("${REGISTER}" '{"p_installation_id":"00000000-0000-0000-0000-000000000001","p_binding_id":"00000000-0000-0000-0000-000000000001"}'
  '{}' '{"p_activity":true,"p_bests":true,"p_ranks":true}' "{\"p_group_id\":\"${GROUP_ID}\",\"p_muted\":true}")
RPC_NAMES=(notification_register notification_unregister notification_preferences_get notification_preferences_set notification_group_mute)
for idx in "${!RPC_NAMES[@]}"; do
  rpc "${ANON_KEY}" "${RPC_NAMES[$idx]}" "${RPC_BODIES[$idx]}"; expect_error AUTH_REQUIRED "anon ${RPC_NAMES[$idx]}"
  rpc "${AGENT}" "${RPC_NAMES[$idx]}" "${RPC_BODIES[$idx]}"; expect_error AGENT_FORBIDDEN "OAuth ${RPC_NAMES[$idx]}"
done
rpc "${A_TOKEN}" notification_register "${REGISTER}"; expect_ok register
BINDING="$(jq -r '.binding_id' <<<"${BODY}")"
check 'register response contains no token/key/account' 'keys|sort == ["binding_id","opted_in","payload_version","permission"]'
rpc "${A_TOKEN}" notification_register "${REGISTER}"; expect_ok 'idempotent registration'
check 'same binding on unchanged register' '.binding_id==$b' --arg b "${BINDING}"
rpc "${C_TOKEN}" notification_register "$(jq '.p_capability="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="' <<<"${REGISTER}")"
expect_error NOT_FOUND 'wrong installation capability'
rpc "${A_TOKEN}" notification_register "$(jq '.p_environment="production"|.p_token="ExpoPushToken[prod]"' <<<"${REGISTER}")"
expect_error VALIDATION 'local rejects production binding/token'
rpc "${A_TOKEN}" notification_register "$(jq '.p_encryption_key="bad"' <<<"${REGISTER}")"
expect_error VALIDATION 'malformed key'
rpc "${C_TOKEN}" notification_unregister "$(jq -nc --arg i "${INSTALL_ID}" --arg b "${BINDING}" '{p_installation_id:$i,p_binding_id:$b}')"
expect_ok 'cross-account unregister is indistinguishable no-op'
[[ "$(run_psql "select active from app_public.notification_installations where id='${INSTALL_ID}';")" == t ]] || fail 'cross-account unregister changed binding'
rpc "${A_TOKEN}" notification_preferences_get '{}'; expect_ok defaults
check 'all categories default on' '.activity and .bests and .ranks and (.muted|not)'
rpc "${C_TOKEN}" notification_group_mute "{\"p_group_id\":\"${GROUP_ID}\",\"p_muted\":true}"; expect_error NOT_FOUND outsider
OUTSIDER_BODY="${BODY}"
rpc "${C_TOKEN}" notification_group_mute '{"p_group_id":"00000000-0000-0000-0000-000000000001","p_muted":true}'
expect_error NOT_FOUND missing
[[ "${BODY}" == "${OUTSIDER_BODY}" ]] || fail 'membership boundary differs'
for table in notification_config notification_installations notification_preferences notification_group_preferences notification_intents notification_deliveries; do
  for method in GET POST PATCH DELETE; do
    rest "${method}" "${A_TOKEN}" "${table}" '' '{}'
    [[ ! "${STATUS}" =~ ^2 ]] || fail "direct ${method} ${table} exposed"
  done
done
rpc "${A_TOKEN}" notification_claim '{}'; [[ ! "${STATUS}" =~ ^2 ]] || fail 'app can invoke worker RPC'

EVENT_AT="$(run_psql "select now()::text;")"
CONTRIBUTIONS="[{\"group_id\":\"${GROUP_ID}\",\"best_count\":2,\"rank_count\":3}]"
enqueue() {
  local kind="$1" generation="${2:-1}"
  rpc "${SERVICE_ROLE_KEY}" notification_enqueue "$(jq -nc --arg r "${A_UID}" --arg l "${B_UID}" --arg s "notification-${RUN_TAG}" \
    --arg k "${kind}" --arg at "${EVENT_AT}" --argjson g "${generation}" --argjson c "${CONTRIBUTIONS}" \
    '{p_recipient:$r,p_lifter:$l,p_session:$s,p_kind:$k,p_event_at:$at,p_generation:$g,p_contributions:$c}')"
  expect_ok enqueue
}
for invalid in '[{"group_id":null,"best_count":null,"rank_count":null}]' '[{"group_id":"------------------------------------","best_count":1,"rank_count":1}]' "[${CONTRIBUTIONS:1:${#CONTRIBUTIONS}-2},${CONTRIBUTIONS:1:${#CONTRIBUTIONS}-2}]"; do
  rpc "${SERVICE_ROLE_KEY}" notification_enqueue "$(jq -nc --arg r "${A_UID}" --arg l "${B_UID}" --arg s "invalid-${RUN_TAG}" \
    --arg at "${EVENT_AT}" --argjson c "${invalid}" \
    '{p_recipient:$r,p_lifter:$l,p_session:$s,p_kind:"start",p_event_at:$at,p_generation:1,p_contributions:$c}')"
  expect_error VALIDATION 'malformed/duplicate contribution'
done
enqueue start
START_INTENT="${BODY}"
enqueue start
[[ "${BODY}" == "${START_INTENT}" ]] || fail 'replay duplicated intent'
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok 'disabled claim'
check 'disabled provider explicit state' '.disabled and (.jobs|length)==0'
[[ "$(run_psql "select state from app_public.notification_deliveries where intent_id=${START_INTENT};")" == disabled ]] || fail 'missing disabled state'
run_psql "update app_public.notification_config set sending_enabled=true;" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; expect_ok claim
DELIVERY="$(jq -r '.jobs[0].id' <<<"${BODY}")"; CLAIM="$(jq -r '.jobs[0].claim_id' <<<"${BODY}")"
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; check 'concurrent active lease cannot be reclaimed' '.jobs|length==0'
enqueue start 2
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "{\"p_delivery_id\":${DELIVERY},\"p_claim_id\":\"${CLAIM}\",\"p_generation\":1}"
expect_ok 'stale generation begin'; [[ "${BODY}" == null ]] || fail 'stale claim can send'
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; CLAIM="$(jq -r '.jobs[0].claim_id' <<<"${BODY}")"
# Permission/category/mute checks occur at handoff, after claim.
rpc "${A_TOKEN}" notification_group_mute "{\"p_group_id\":\"${GROUP_ID}\",\"p_muted\":true}"; expect_ok mute
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "{\"p_delivery_id\":${DELIVERY},\"p_claim_id\":\"${CLAIM}\",\"p_generation\":2}"
[[ "${BODY}" == null ]] || fail 'muted group sent'
rpc "${A_TOKEN}" notification_group_mute "{\"p_group_id\":\"${GROUP_ID}\",\"p_muted\":false}"; expect_ok unmute
run_psql "update app_public.notification_deliveries set state='pending' where id=${DELIVERY};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; CLAIM="$(jq -r '.jobs[0].claim_id' <<<"${BODY}")"
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "{\"p_delivery_id\":${DELIVERY},\"p_claim_id\":\"${CLAIM}\",\"p_generation\":2}"
expect_ok 'authorized begin'
check 'public projection allowlist and zero start counts' '.projection.bestCount==0 and .projection.rankCount==0 and
  (.projection|keys|sort)==["bestCount","bindingId","expiresAt","heading","identity","kind","notificationId","rankCount","recipientUserId","route","v"]'
run_psql "set request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}'; update app_public.sessions set status='completed',completed_at=started_at+60000 where owner_user_id='${B_UID}' and id='notification-${RUN_TAG}';" >/dev/null
enqueue completion
COMPLETION="${BODY}"
run_psql "set request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}'; update app_public.sessions set status='active',completed_at=null where owner_user_id='${B_UID}' and id='notification-${RUN_TAG}';" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${COMPLETION}}"; expect_ok 'reopened completion projection'
[[ "${BODY}" == null ]] || fail 'reopened workout projected a completed alert'
run_psql "set request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}'; update app_public.sessions set status='completed',completed_at=started_at+60000 where owner_user_id='${B_UID}' and id='notification-${RUN_TAG}';" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'
CD="$(jq -r '.jobs[0].id' <<<"${BODY}")"; CC="$(jq -r '.jobs[0].claim_id' <<<"${BODY}")"
rpc "${SERVICE_ROLE_KEY}" notification_begin_send "{\"p_delivery_id\":${CD},\"p_claim_id\":\"${CC}\",\"p_generation\":1}"
[[ "${BODY}" == null ]] || fail 'completion overtook in-flight start'
run_psql "update app_public.notification_deliveries set lease_until=now()-interval '1 second' where id=${DELIVERY};
  update app_public.notification_deliveries set available_at=now() where id=${CD};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_claim '{}'; check 'crashed handoff recovers safely' '.jobs|length==1'
[[ "$(run_psql "select state from app_public.notification_deliveries where id=${DELIVERY};")" == uncertain ]] || fail 'unknown handoff retried blindly'
# The actual Edge worker sends only to the deterministic sink and persists provider tickets.
run_psql "update app_public.notification_deliveries set lease_until=now()-interval '1 second' where id=${CD};" >/dev/null
http_call -X POST -H "apikey: ${ANON_KEY}" --data '{}' "${API_URL}/functions/v1/notification-worker"
[[ "${STATUS}" == 401 ]] || fail 'worker accepted anon'
http_call -X POST -H "apikey: ${SERVICE_ROLE_KEY}" --data '{}' "${API_URL}/functions/v1/notification-worker"
expect_ok 'local worker drain'
check 'worker sink ticket' '.outcomes.ticket==1'
[[ "$(run_psql "select state from app_public.notification_deliveries where id=${CD};")" == ticket ]] || fail 'ticket not durable'
http_call -X POST -H "apikey: ${SERVICE_ROLE_KEY}" --data '{}' "${API_URL}/functions/v1/notification-worker"
check 'accepted send never repeated' '.claimed==0'
run_psql "update app_public.notification_deliveries set receipt_available_at=now() where id=${CD};
  update app_public.notification_config set sending_enabled=false,provider='disabled';" >/dev/null
http_call -X POST -H "apikey: ${SERVICE_ROLE_KEY}" --data '{}' "${API_URL}/functions/v1/notification-worker"
check 'receipt persisted without new send' '.outcomes.receipt_ok==1 and .claimed==0'
# A competing collector cannot revoke the twentieth in-flight receipt lease.
run_psql "update app_public.notification_deliveries set state='ticket',receipt_attempts=19,receipt_available_at=now(),
  receipt_claim_id=null,receipt_lease_until=null where id=${CD};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_receipt_claim '{}'; expect_ok 'twentieth receipt claim'
FINAL_RC="$(jq -r '.jobs[0].receipt_claim_id' <<<"${BODY}")"
rpc "${SERVICE_ROLE_KEY}" notification_receipt_claim '{}'; expect_ok 'competing receipt claim'
check 'active final lease preserved' '.jobs|length==0'
[[ "$(run_psql "select state from app_public.notification_deliveries where id=${CD};")" == ticket ]] || fail 'competing worker revoked final lease'
rpc "${SERVICE_ROLE_KEY}" notification_receipt_result "{\"p_delivery_id\":${CD},\"p_claim_id\":\"${FINAL_RC}\",\"p_outcome\":\"receipt_ok\"}"
[[ "${BODY}" == true ]] || fail 'twentieth result discarded'
run_psql "update app_public.notification_deliveries set state='ticket',receipt_attempts=20,receipt_available_at=now(),
  receipt_lease_until=now()-interval '1 second' where id=${CD};" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_receipt_claim '{}'; expect_ok 'exhausted receipt recovery'
[[ "$(run_psql "select state='failed' and error_code='RECEIPT_UNKNOWN' from app_public.notification_deliveries where id=${CD};")" == t ]] || fail 'exhausted receipt did not park'
# Configured sweep keeps receipt/prune processing alive with new sending disabled.
# Rollback prevents pg_net from actually issuing this fixture request.
[[ "$(run_psql "begin;
  do \$\$ begin
    perform vault.create_secret('http://127.0.0.1:9/functions/v1/notification-worker','notification_worker_url');
    perform vault.create_secret('fixture-only','notification_worker_key');
  end \$\$;
  select app_public.notification_sweep() is not null;
  rollback;")" == t ]] || fail 'disabled sending stopped receipt/prune sweep'
run_psql "update app_public.notification_config set sending_enabled=true,provider='local';" >/dev/null
# Enqueue and handoff take the workout lock before the installation FK/row lock.
QUEUE_SESSION="enqueue-race-${RUN_TAG}"
run_psql "set request.jwt.claims='{\"sub\":\"${B_UID}\",\"role\":\"authenticated\"}'; insert into app_public.sessions(owner_user_id,id,status,started_at,created_at,updated_at,client_updated_at_ms)
  values('${B_UID}','${QUEUE_SESSION}','active',floor(extract(epoch from now())*1000),1,1,1);
  select app_public.notification_enqueue('${A_UID}','${B_UID}','${QUEUE_SESSION}','start','${EVENT_AT}',1,'${CONTRIBUTIONS}'::jsonb);" >/dev/null
QID="$(run_psql "select d.id from app_public.notification_deliveries d join app_public.notification_intents n on n.id=d.intent_id where n.session_id='${QUEUE_SESSION}';")"
QCLAIM="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
run_psql "update app_public.notification_deliveries set state='leased',claim_id='${QCLAIM}',lease_until=now()+interval '60 seconds' where id=${QID};" >/dev/null
RACE_DIR="$(mktemp -d)"
run_psql_once "begin;
  select pg_advisory_xact_lock(hashtextextended('${A_UID}:${B_UID}:${QUEUE_SESSION}',0));
  \\echo locked
  select pg_sleep(1);
  select app_public.notification_enqueue('${A_UID}','${B_UID}','${QUEUE_SESSION}','completion','${EVENT_AT}',1,'${CONTRIBUTIONS}'::jsonb);
  commit;" >"${RACE_DIR}/enqueue" &
ENQUEUE_PID=$!
for attempt in {1..100}; do
  rg -q '^locked$' "${RACE_DIR}/enqueue" && break
  sleep 0.01
done
rg -q '^locked$' "${RACE_DIR}/enqueue" || fail 'enqueue barrier was not acquired'
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "{\"p_delivery_id\":${QID},\"p_claim_id\":\"${QCLAIM}\",\"p_generation\":1}" \
  "${API_URL}/rest/v1/rpc/notification_begin_send" >"${RACE_DIR}/handoff" &
HANDOFF_PID=$!
wait "${ENQUEUE_PID}"; wait "${HANDOFF_PID}"
jq -e '.binding_id' "${RACE_DIR}/handoff" >/dev/null || fail 'enqueue/handoff concurrency did not prepare'
run_psql "delete from app_public.notification_intents where session_id='${QUEUE_SESSION}';" >/dev/null
rm -rf "${RACE_DIR}"; RACE_DIR=""
# Actual concurrent rotation/handoff uses separate HTTP transactions, under one held installation lock.
run_psql "update app_public.notification_config set sending_enabled=true,provider='local';" >/dev/null
RACE_DIR="$(mktemp -d)"
RACE_CLAIM="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
run_psql "update app_public.notification_deliveries set state='leased',claim_id='${RACE_CLAIM}',lease_until=now()+interval '60 seconds' where id=${CD};" >/dev/null
run_psql_once "begin; select 1 from app_public.notification_installations where id='${INSTALL_ID}' for update;
\\echo locked
  select pg_sleep(1); commit;" >"${RACE_DIR}/lock" &
LOCK_PID=$!
for attempt in {1..100}; do
  rg -q '^locked$' "${RACE_DIR}/lock" && break
  sleep 0.01
done
rg -q '^locked$' "${RACE_DIR}/lock" || fail 'concurrency barrier was not acquired'
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "{\"p_delivery_id\":${CD},\"p_claim_id\":\"${RACE_CLAIM}\",\"p_generation\":1}" \
  "${API_URL}/rest/v1/rpc/notification_begin_send" >"${RACE_DIR}/send" &
SEND_PID=$!
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${A_TOKEN}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "$(jq '.p_token="LocalPushToken[concurrent]"' <<<"${REGISTER}")" \
  "${API_URL}/rest/v1/rpc/notification_register" >"${RACE_DIR}/register" &
REGISTER_PID=$!
wait "${LOCK_PID}"; wait "${SEND_PID}"; wait "${REGISTER_PID}"
jq -e '.binding_id' "${RACE_DIR}/register" >/dev/null || fail 'concurrent rotation failed'
jq -e --arg b "${BINDING}" --arg k "${KEY}" '(.==null) or
  (.binding_id==$b and .encryption_key==$k and .token=="LocalPushToken[ok]" and .provider=="local")' \
  "${RACE_DIR}/send" >/dev/null || fail 'handoff mixed old/new binding state'
[[ "$(jq -r '.binding_id' "${RACE_DIR}/register")" != "${BINDING}" ]] || fail 'concurrent rotation preserved old binding'
[[ "$(run_psql "select token from app_public.notification_installations where id='${INSTALL_ID}';")" == 'LocalPushToken[concurrent]' ]] || fail 'concurrent rotation lost token'
rm -rf "${RACE_DIR}"; RACE_DIR=""
# Reassignment requires capability, rotates binding; stale unregister cannot revoke the new user.
rpc "${C_TOKEN}" notification_register "${REGISTER}"; expect_ok reassign
NEW_BINDING="$(jq -r '.binding_id' <<<"${BODY}")"
[[ "${NEW_BINDING}" != "${BINDING}" ]] || fail 'account switch preserved binding'
rpc "${A_TOKEN}" notification_unregister "$(jq -nc --arg i "${INSTALL_ID}" --arg b "${BINDING}" '{p_installation_id:$i,p_binding_id:$b}')"
[[ "$(run_psql "select active and user_id='${C_UID}' from app_public.notification_installations where id='${INSTALL_ID}';")" == t ]] || fail 'stale account unregister revoked new binding'
# A stale DeviceNotRegistered receipt cannot deactivate a newly rotated binding.
run_psql "update app_public.notification_deliveries set state='ticket',receipt_claim_id=gen_random_uuid() where id=${CD};" >/dev/null
RC="$(run_psql "select receipt_claim_id from app_public.notification_deliveries where id=${CD};")"
rpc "${SERVICE_ROLE_KEY}" notification_receipt_result "{\"p_delivery_id\":${CD},\"p_claim_id\":\"${RC}\",\"p_outcome\":\"device_unregistered\",\"p_code\":\"DEVICE_NOT_REGISTERED\"}"
expect_ok 'old receipt applied'
[[ "$(run_psql "select active from app_public.notification_installations where id='${INSTALL_ID}';")" == t ]] || fail 'old receipt disabled new binding'
# The share ledger survives a lifter's departure; current recipients retain authorized projection.
run_psql "update app_public.group_memberships set ended_at=now() where group_id='${GROUP_ID}' and user_id='${B_UID}' and ended_at is null;" >/dev/null
rpc "${SERVICE_ROLE_KEY}" notification_projection "{\"p_intent_id\":${COMPLETION}}"
expect_ok 'departed lifter projection'
check 'durable share remains visible to live recipient' '.route.groupId==$g and (.identity|type)=="string"' --arg g "${GROUP_ID}"
# Purging an inactive installation removes its provider token, retaining only the rebind capability digest.
run_psql "update app_public.notification_installations set active=false,updated_at=now()-interval '31 days' where id='${INSTALL_ID}';
  update app_public.notification_intents set event_at=now()-interval '32 days',expires_at=now()-interval '31 days' where id=${COMPLETION};
  select app_public.notification_prune();" >/dev/null
[[ "$(run_psql "select token='retired:'||id::text and encryption_key='' from app_public.notification_installations where id='${INSTALL_ID}';")" == t ]] || fail 'retention preserved token/key'
PRUNED_XMIN="$(run_psql "select xmin::text from app_public.notification_deliveries where id=${CD};")"
PRUNED_INSTALL_XMIN="$(run_psql "select xmin::text from app_public.notification_installations where id='${INSTALL_ID}';")"
run_psql "select app_public.notification_prune();" >/dev/null
[[ "$(run_psql "select xmin::text from app_public.notification_deliveries where id=${CD};")" == "${PRUNED_XMIN}" ]] || fail 'repeat prune rewrote empty tombstone'
[[ "$(run_psql "select xmin::text from app_public.notification_installations where id='${INSTALL_ID}';")" == "${PRUNED_INSTALL_XMIN}" ]] || fail 'repeat prune rewrote cleared installation'
# Two installations can swap token ownership concurrently without opposite row-lock order.
SWAP_A="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SWAP_B="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SWAP_CAP_A="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
SWAP_CAP_B="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
SWAP_REG_A="$(jq --arg i "${SWAP_A}" --arg c "${SWAP_CAP_A}" '.p_installation_id=$i|.p_capability=$c|.p_token="LocalPushToken[swap-a]"' <<<"${REGISTER}")"
SWAP_REG_B="$(jq --arg i "${SWAP_B}" --arg c "${SWAP_CAP_B}" '.p_installation_id=$i|.p_capability=$c|.p_token="LocalPushToken[swap-b]"' <<<"${REGISTER}")"
rpc "${A_TOKEN}" notification_register "${SWAP_REG_A}"; expect_ok 'swap installation A'
rpc "${C_TOKEN}" notification_register "${SWAP_REG_B}"; expect_ok 'swap installation B'
RACE_DIR="$(mktemp -d)"
run_psql_once "begin;
  select pg_advisory_xact_lock(hashtextextended('notification-registration',0));
  \\echo locked
  select pg_sleep(1); commit;" >"${RACE_DIR}/lock" &
LOCK_PID=$!
for attempt in {1..100}; do
  rg -q '^locked$' "${RACE_DIR}/lock" && break
  sleep 0.01
done
rg -q '^locked$' "${RACE_DIR}/lock" || fail 'swap allocator barrier was not acquired'
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${A_TOKEN}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "$(jq '.p_token="LocalPushToken[swap-b]"' <<<"${SWAP_REG_A}")" \
  "${API_URL}/rest/v1/rpc/notification_register" >"${RACE_DIR}/a" &
SWAP_PID_A=$!
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${C_TOKEN}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "$(jq '.p_token="LocalPushToken[swap-a]"' <<<"${SWAP_REG_B}")" \
  "${API_URL}/rest/v1/rpc/notification_register" >"${RACE_DIR}/b" &
SWAP_PID_B=$!
BLOCKED=0
for attempt in {1..20}; do
  BLOCKED="$(run_psql "select count(*) from pg_locks where locktype='advisory' and not granted
    and classid::bigint=((hashtextextended('notification-registration',0)>>32)&4294967295)
    and objid::bigint=(hashtextextended('notification-registration',0)&4294967295);")"
  [[ "${BLOCKED}" == 2 ]] && break
  sleep 0.01
done
[[ "${BLOCKED}" == 2 ]] || fail 'concurrent swaps bypassed the registration allocator'
wait "${LOCK_PID}"; wait "${SWAP_PID_A}"; wait "${SWAP_PID_B}"
jq -e '.binding_id' "${RACE_DIR}/a" >/dev/null; jq -e '.binding_id' "${RACE_DIR}/b" >/dev/null
[[ "$(run_psql "select count(*) from app_public.notification_installations where active and
  ((id='${SWAP_A}' and token='LocalPushToken[swap-b]') or (id='${SWAP_B}' and token='LocalPushToken[swap-a]'));")" == 2 ]] || fail 'concurrent token swap lost an installation'
rm -rf "${RACE_DIR}"; RACE_DIR=""
# Enqueue's multi-installation FK pass and token rotation share the allocator before row locks.
rpc "${A_TOKEN}" notification_register "$(jq '.p_token="LocalPushToken[swap-a]"' <<<"${SWAP_REG_B}")"; expect_ok 'second recipient installation'
RACE_DIR="$(mktemp -d)"
run_psql_once "begin;
  select pg_advisory_xact_lock(hashtextextended('notification-registration',0));
  \\echo locked
  select pg_sleep(1); commit;" >"${RACE_DIR}/lock" &
LOCK_PID=$!
for attempt in {1..100}; do
  rg -q '^locked$' "${RACE_DIR}/lock" && break
  sleep 0.01
done
rg -q '^locked$' "${RACE_DIR}/lock" || fail 'multi-installation barrier was not acquired'
run_psql_once "select app_public.notification_enqueue('${A_UID}','${B_UID}','multi-${RUN_TAG}','start','${EVENT_AT}',1,'${CONTRIBUTIONS}'::jsonb);" \
  >"${RACE_DIR}/enqueue" &
ENQUEUE_PID=$!
curl --silent --show-error --fail -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${A_TOKEN}" \
  -H 'Content-Profile: app_public' -H 'Content-Type: application/json' \
  --data "$(jq '.p_token="LocalPushToken[swap-rotated]"' <<<"${SWAP_REG_A}")" \
  "${API_URL}/rest/v1/rpc/notification_register" >"${RACE_DIR}/rotate" &
ROTATE_PID=$!
BLOCKED=0
for attempt in {1..20}; do
  BLOCKED="$(run_psql "select count(*) from pg_locks where locktype='advisory' and not granted
    and classid::bigint=((hashtextextended('notification-registration',0)>>32)&4294967295)
    and objid::bigint=(hashtextextended('notification-registration',0)&4294967295);")"
  [[ "${BLOCKED}" == 2 ]] && break
  sleep 0.01
done
[[ "${BLOCKED}" == 2 ]] || fail 'enqueue/registration did not share allocator'
wait "${LOCK_PID}"; wait "${ENQUEUE_PID}"; wait "${ROTATE_PID}"
[[ "$(run_psql "select count(*) from app_public.notification_deliveries d join app_public.notification_intents n on n.id=d.intent_id where n.session_id='multi-${RUN_TAG}';")" == 2 ]] || fail 'multi-installation capture was incomplete'
jq -e '.binding_id' "${RACE_DIR}/rotate" >/dev/null || fail 'multi-installation rotation failed'
rm -rf "${RACE_DIR}"; RACE_DIR=""
# Retiring a token cancels only its concrete old queue, preserving drain capacity for live installations.
for index in {1..4}; do
  run_psql "select app_public.notification_enqueue('${A_UID}','${B_UID}','retirement-${RUN_TAG}-${index}','start','${EVENT_AT}',1,'${CONTRIBUTIONS}'::jsonb);" >/dev/null
done
RETIRE_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
RETIRE_CAP="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
rpc "${C_TOKEN}" notification_register "$(jq --arg i "${RETIRE_ID}" --arg c "${RETIRE_CAP}" \
  '.p_installation_id=$i|.p_capability=$c|.p_token="LocalPushToken[swap-rotated]"' <<<"${REGISTER}")"
expect_ok 'token reassignment to new installation'
[[ "$(run_psql "select count(*) from app_public.notification_deliveries where installation_id='${SWAP_A}' and state in ('pending','retry','leased','disabled');")" == 0 ]] || fail 'retired installation kept claimable work'
rpc "${SERVICE_ROLE_KEY}" notification_claim '{"p_limit":4}'; expect_ok 'live drain budget'
check 'live jobs retain the complete claim budget' '.jobs|length==4'
[[ "$(run_psql "select count(*) from app_public.notification_deliveries d join app_public.notification_installations i on i.id=d.installation_id
  where d.state='leased' and (not i.active or d.binding_id<>i.binding_id);")" == 0 ]] || fail 'retired binding consumed claim capacity'
# Server session revocation invalidates an otherwise well-formed app JWT immediately.
run_psql "delete from auth.sessions where user_id='${C_UID}';" >/dev/null
rpc "${C_TOKEN}" notification_preferences_get '{}'; expect_error AUTH_REQUIRED 'revoked session'
COMPLETED=1
pass 'registration, role matrix, prefs, binding rotation, generation fencing, order, recovery, encrypted sink tickets and receipts'
