#!/usr/bin/env bash
# Current optional-bodyweight group contract. Execute only through its Boga lane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-bodyweight"
FIXTURE_EMAIL_PREFIX="groups-bw"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1

RUN_TAG="${GROUPS_BODYWEIGHT_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsBodyweight!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"

set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}
cleanup() {
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"; ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and user_id in (${ids});
    delete from app_public.group_eval_queue where member_user_id in (${ids});
    delete from app_public.groups where created_by in (${ids})
      or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
    delete from auth.users where id in (${ids});
    commit;" >/dev/null
}
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

now_ms() { run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;"; }
expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}
assert_wire() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { pathToFileURL } from "node:url";
    const guards=await import(pathToFileURL(process.argv[1]).href);
    const body=JSON.parse(fs.readFileSync(0,"utf8"));
    const kind=process.argv[2];
    const ok=kind==="board" ? guards.isGroupMetricBoardWire(body) :
      kind==="certification" ? body.contract_version===3 && guards.isGroupMetricCertificationWire(body.certification) :
      kind==="stream" ? body.contract_version===3 && guards.isGroupMetricStreamCursor(body.next_cursor) &&
        body.items.every(item=>guards.isGroupMetricStreamItem(item)) : false;
    if (!ok) throw new Error(`Actual ${kind} response failed mobile decoding`);
  ' "${SUPABASE_DIR}/../apps/mobile/src/groups/metric-wire-guards.ts" "$1" <<<"${BODY}" ||
    fail "actual $1 wire contract"
}
drain() {
  local out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "x-boga-sync-protocol: ${BOGA_TEST_SYNC_PROTOCOL:-3}" -H 'Content-Type: application/json' \
    -H "x-group-eval-secret: ${EVAL_SECRET}" -o "${out}" -w '%{http_code}' --data '{}' \
    "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "${out}")"; rm -f "${out}"
  expect_ok "drain: $1"; check "drain: $1" '.failed == 0'
}
e_reading() {
  jq -nc --arg id "$1" --argjson at "$2" --argjson kg "$3" --argjson c "${CUAM}" '
    {type:"body_weight_measurements",id:$id,client_updated_at_ms:$c,
      fields:{weight_kg:$kg,measured_at:$at,created_at:$c,updated_at:$c,deleted_at:null}}'
}
e_setting() {
  jq -nc --argjson enabled "$1" --argjson c "${CUAM}" '
    {type:"user_settings",id:"settings",client_updated_at_ms:$c,
      fields:{bodyweight_calculations_enabled:$enabled,created_at:$c,updated_at:$c,deleted_at:null}}'
}
create_comparison() {
  rpc "$1" group_exercise_create_v2 "$(jq -nc --arg g "$2" --argjson c "$3" '
    {p_group_id:$g,p_name:"Pull-up",p_load_input_mode:"total_load",p_source_exercise_id:null,
      p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'create comparison'
  check 'comparison uses current contract' '.contract_version==3 and .exercise.default_metric=="e1rm"'
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
metric_board() {
  rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$1" --argjson c "${2:-false}" '
    {p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
  expect_ok "board $1"
  check "board $1 current contract" '.contract_version==3 and .state=="ready" and .unit==null'
  assert_wire board
}
performance() {
  local token="$1" sid="$2" def="$3" bodyweight="$4" weight="$5" reps="$6" at clock_at
  next_cuam
  clock_at="$(now_ms)"; START=$((START+1000)); (( START > clock_at )) || START=$((clock_at+1000)); at="${START}"
  push "${token}" "performance ${sid}" \
    "$(e_session "${sid}" "${at}" completed "$((at+60000))" 60 null "${CUAM}")" \
    "$(e_se "${sid}-se" "${sid}" "${def}" 0 'Pull-up' "${CUAM}")" \
    "$(e_set "${sid}-set" "${sid}-se" 0 "${weight}" "${reps}" '' "${CUAM}")"
  if [[ "${bodyweight}" != null ]]; then
    next_cuam; push "${token}" "dated reading ${sid}" "$(e_reading "${sid}-reading" "${at}" "${bodyweight}")"
  fi
}
set_body_weight() {
  local at
  at="$(run_psql "select started_at from app_public.sessions where id='$2';")"
  next_cuam; push "$1" 'edit dated reading' "$(e_reading "$2-reading" "${at}" "$3")"
}
certify_metric() {
  local uid="$1" sid="$2" metric="$3" pin revision
  metric_board "${metric}"
  pin="$(jq -er --arg u "${uid}" --arg s "${sid}-set" '.entries[]|select(.member.user_id==$u and .set_id==$s)|.fingerprint' <<<"${BODY}")"
  revision="$(jq -er '.rules_revision' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_metric_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${uid}" \
    --arg s "${sid}-set" --arg m "${metric}" --arg f "${pin}" --argjson r "${revision}" '
    {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:$m,
      p_expected_revision:$r,p_expected_fingerprint:$f}')"
  expect_ok "certify ${metric}"; assert_wire certification
  jq -er '.certification.certification_id' <<<"${BODY}"
}
set_group_policy() {
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${GID}" --arg n "Bodyweight ${RUN_TAG}" --argjson enabled "$1" '
    {p_group_id:$g,p_name:$n,p_description:null,p_bodyweight_calculations_enabled:$enabled}')"
  expect_ok 'update group calculation policy'
  check 'group policy response' '.group.bodyweight_calculations_enabled==$enabled' --argjson enabled "$1"
}

provision OWNER owner
provision ATHLETE athlete
provision RIVAL rival
provision OUTSIDER outsider
node "${SUPABASE_DIR}/tests/bodyweight-as-of-parity.mjs" "${DB_CONTAINER}" "${OWNER_UID}"
for pair in OWNER:owner ATHLETE:athlete RIVAL:rival OUTSIDER:outsider; do
  uid_var="${pair%%:*}_UID"; set_username "${!uid_var}" "bw_${pair##*:}_${RUN_TAG//-/_}"
done
set_kick_url ''; set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Bodyweight ${RUN_TAG}" '{p_name:$n,p_description:null}')"
expect_ok 'group create'; GID="$(jq -er .group_id <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
expect_ok 'invite'; INVITE="$(jq -er .code <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"; expect_ok 'join'
done

GX="$(create_comparison "${OWNER_TOKEN}" "${GID}" 1)"
CUAM="$(now_ms)"; START=$((CUAM+1000)); T="bw-${RUN_TAG}"; DA="${T}-athlete-def"; DR="${T}-rival-def"
next_cuam
push "${ATHLETE_TOKEN}" 'athlete definition and link' \
  "$(e_def "${DA}" 'Pull-up' "${CUAM}" total_load | jq '.fields.bodyweight_contribution=0.25')" \
  "$(e_link "${DA}" "${GID}" "${GX}" "${CUAM}")"
next_cuam
push "${RIVAL_TOKEN}" 'rival definition and link' \
  "$(e_def "${DR}" 'Pull-up' "${CUAM}" total_load | jq '.fields.bodyweight_contribution=0')" \
  "$(e_link "${DR}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-athlete" "${DA}" 80 20 5
drain 'policy-off baseline'

metric_board weight
check 'Weight is the raw entered value' '
  .metric=="weight" and (.entries[]|select(.member.user_id==$u)|.value==20 and .unit=="kg")' --arg u "${ATHLETE_UID}"
check 'public Weight payload contains no private reading context' '
  [..|objects|keys[]|select(startswith("body_weight_") or .=="body_weight_dependency_digest")]|length==0'
metric_board e1rm
OFF_E1RM="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.value' <<<"${BODY}")"
check 'policy-off 1RM uses the ordinary load' '.metric=="e1rm" and $baseline>20' --argjson baseline "${OFF_E1RM}"

set_group_policy true
rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" '
  {p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false}')"
expect_ok 'rebuilding response'; check 'toggle rebuild is atomic' '.contract_version==3 and .state=="rebuilding" and .entries==[]'
drain 'policy-on rebuild'
metric_board weight
check 'Weight presentation does not change with bodyweight math' '
  (.entries[]|select(.member.user_id==$u)|.value==20 and .unit=="kg")' --arg u "${ATHLETE_UID}"
metric_board e1rm
ON_E1RM="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.value' <<<"${BODY}")"
jq -en --argjson off "${OFF_E1RM}" --argjson on "${ON_E1RM}" '$on>$off' >/dev/null ||
  fail 'enabling group bodyweight calculations must change only the 1RM math'
check 'public 1RM payload contains no private reading context' '
  [..|objects|keys[]|select(startswith("body_weight_") or .=="body_weight_dependency_digest")]|length==0'
pass 'group toggle changes 1RM math while Weight and public presentation stay ordinary'

# Strict group calculations omit 1RM without an applicable reading, while the
# raw Weight score remains available.
performance "${RIVAL_TOKEN}" "${T}-rival" "${DR}" null 30 5
drain 'missing-reading rival'
metric_board weight
check 'missing reading still ranks Weight' '[.entries[]|select(.member.user_id==$r and .value==30)]|length==1' --arg r "${RIVAL_UID}"
metric_board e1rm
check 'missing reading omits only 1RM' '[.entries[]|select(.member.user_id==$r)]|length==0' --arg r "${RIVAL_UID}"

WEIGHT_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-athlete" weight)"
E1RM_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-athlete" e1rm)"
set_body_weight "${ATHLETE_TOKEN}" "${T}-athlete" 90
drain 'reading correction'
expect_sql 'Weight certification ignores private reading changes' \
  "select ended_at is null from app_public.group_metric_certifications where id='${WEIGHT_CERT}';" t
expect_sql '1RM certification pins applicable private reading changes' \
  "select end_reason from app_public.group_metric_certifications where id='${E1RM_CERT}';" voided
pass 'metric-specific pins keep private readings out of Weight and bind 1RM only'

# The personal preference syncs independently and never overrides group policy.
metric_board e1rm
GROUP_SCORE="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.value' <<<"${BODY}")"
next_cuam; push "${ATHLETE_TOKEN}" 'personal preference off' "$(e_setting false)"
expect_sql 'personal preference does not enqueue group evaluation' \
  "select count(*) from app_public.group_metric_eval_queue where group_id='${GID}';" 0
metric_board e1rm
check 'personal preference cannot change group score' '
  .entries[]|select(.member.user_id==$u)|.value==$score' --arg u "${ATHLETE_UID}" --argjson score "${GROUP_SCORE}"

set_group_policy false
drain 'policy-off rebuild'
metric_board e1rm
check 'group policy off restores ordinary 1RM even without a reading' '
  [.entries[]|select(.member.user_id==$r)]|length==1' --arg r "${RIVAL_UID}"
next_cuam; push "${ATHLETE_TOKEN}" 'reading while group policy off' "$(e_reading "${T}-athlete-reading" "${START}" 95)"
expect_sql 'reading changes do not enqueue a disabled group' \
  "select count(*) from app_public.group_metric_eval_queue where group_id='${GID}';" 0
pass 'personal and group calculation policies remain independent'

# Only Weight and 1RM are accepted by current readers and storage.
for metric in reps relative absolute; do
  rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "${metric}" '
    {p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:false}')"
  expect_error VALIDATION "unsupported metric ${metric}"
done
expect_sql 'score storage accepts only Weight/1RM' \
  "select count(*) from app_public.group_metric_set_scores where metric not in ('weight','e1rm') or unit<>'kg';" 0
expect_sql 'board storage accepts only Weight/1RM' \
  "select count(*) from app_public.group_metric_board_entries where metric not in ('weight','e1rm') or unit<>'kg';" 0
expect_sql 'certification storage accepts only Weight/1RM' \
  "select count(*) from app_public.group_metric_certifications where metric not in ('weight','e1rm') or unit<>'kg';" 0

rpc "${OWNER_TOKEN}" group_stream_v2 "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'current stream'; assert_wire stream
check 'stream exposes only ordinary metric names and no private reading fields' '
  ([..|objects|.metric?|select(.!=null)]|all(.=="weight" or .=="e1rm")) and
  ([..|objects|keys[]|select(startswith("body_weight_") or .=="body_weight_dependency_digest")]|length==0)'
pass 'current board, certification and stream wire contracts are private and two-metric only'

# The cutover schema and function signatures are complete on the backend.
expect_sql 'final exercise definition columns exist' \
  "select count(*) from information_schema.columns where table_schema='app_public' and table_name='exercise_definitions' and column_name in ('load_input_mode','bodyweight_contribution');" 2
expect_sql 'superseded exercise definition columns are gone' \
  "select count(*) from information_schema.columns where table_schema='app_public' and table_name='exercise_definitions' and column_name in ('bodyweight_coefficient','movement_standard','loading_method');" 0
expect_sql 'superseded set columns are gone' \
  "select count(*) from information_schema.columns where table_schema='app_public' and table_name='exercise_sets' and column_name in ('weight_unit','external_load_mode','planned_weight_unit','planned_external_load_mode');" 0
expect_sql 'kg-only reading schema is final' \
  "select count(*) from information_schema.columns where table_schema='app_public' and table_name='body_weight_measurements' and column_name in ('weight_value','weight_unit');" 0
expect_sql 'private settings table has one current preference field' \
  "select count(*) from information_schema.columns where table_schema='app_public' and table_name='user_settings' and column_name='bodyweight_calculations_enabled';" 1
pass 'backend schema, settings, group policy and wire contract match the final model'

COMPLETED=1
pass 'optional bodyweight backend vectors passed'
