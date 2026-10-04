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
  local uid="$1" sid="$2" metric="$3" set_id="${4:-$2-set}" pin revision
  metric_board "${metric}"
  pin="$(jq -er --arg u "${uid}" --arg s "${set_id}" '.entries[]|select(.member.user_id==$u and .set_id==$s)|.fingerprint' <<<"${BODY}")"
  revision="$(jq -er '.rules_revision' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_metric_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${uid}" \
    --arg s "${set_id}" --arg m "${metric}" --arg f "${pin}" --argjson r "${revision}" '
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

# Capture every comparison projection and public history row, not just its
# current best. A no-op must leave both metric and retained legacy stores alone.
comparison_snapshot() {
  run_psql "select md5(jsonb_build_object(
    'exercise',(select to_jsonb(e) from app_public.group_exercises e where id='${GX}'),
    'revisions',(select jsonb_agg(to_jsonb(r) order by revision) from app_public.group_rule_revisions r where group_exercise_id='${GX}'),
    'scores',(select jsonb_agg(to_jsonb(s) order by rules_revision,member_user_id,set_id,metric) from app_public.group_metric_set_scores s where group_exercise_id='${GX}'),
    'entries',(select jsonb_agg(to_jsonb(b) order by rules_revision,member_user_id,metric,certified) from app_public.group_metric_board_entries b where group_exercise_id='${GX}'),
    'state',(select jsonb_agg(to_jsonb(b) order by rules_revision,member_user_id) from app_public.group_metric_board_state b where group_exercise_id='${GX}'),
    'certifications',(select jsonb_agg(to_jsonb(c) order by id) from app_public.group_metric_certifications c where group_exercise_id='${GX}'),
    'legacy_entries',(select jsonb_agg(to_jsonb(b) order by member_user_id,metric,certified) from app_public.group_board_entries b where group_exercise_id='${GX}'),
    'legacy_state',(select jsonb_agg(to_jsonb(b) order by member_user_id) from app_public.group_board_state b where group_exercise_id='${GX}'),
    'legacy_certifications',(select jsonb_agg(to_jsonb(c) order by id) from app_public.group_certifications c where group_exercise_id='${GX}'),
    'events',(select jsonb_agg(to_jsonb(e) order by seq) from app_public.group_events e where group_exercise_id='${GX}')
  )::text);"
}
assert_zero_toggles() {
  local before
  before="$(comparison_snapshot)"
  for enabled in true false true true false false; do
    set_group_policy "${enabled}"
    expect_sql 'zero contribution never queues a rules rebuild' \
      "select count(*) from app_public.group_metric_eval_queue where group_exercise_id='${GX}';" 0
    [[ "$(comparison_snapshot)" == "${before}" ]] || fail 'zero toggle changed revision, publication, board, certificate or history'
    expect_sql 'live and stored zero rules have the same effective flag' \
      "select app_public.group_exercise_rules_json(e)->>'bodyweight_calculations_enabled'='false'
        and not exists(select 1 from app_public.group_rule_revisions r where r.group_exercise_id=e.id
          and r.rules->>'bodyweight_calculations_enabled'<>'false')
        from app_public.group_exercises e where id='${GX}';" t
    drain 'only positive-contribution comparisons rebuild'
    [[ "$(comparison_snapshot)" == "${before}" ]] || fail 'positive comparison publication affected zero comparison'
  done
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
# Additive protocol-4 negotiation stays pending until scorer/readers/UI cut over.
competition_contract() {
  local token="$1" protocol="$2" group="${3:-${GID}}" out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${token}" -H 'Content-Profile: app_public' \
    -H 'Content-Type: application/json' -H "x-boga-group-contract: ${protocol}" \
    --data "$(jq -nc --arg g "${group}" '{p_group_id:$g}')" -o "${out}" -w '%{http_code}' \
    "${API_URL}/rest/v1/rpc/group_competition_contract")"
  BODY="$(cat "${out}")"; rm -f "${out}"
}
competition_contract "${OWNER_TOKEN}" 4; expect_ok 'competition negotiation'
node --input-type=module -e '
  import fs from "node:fs";
  import { pathToFileURL } from "node:url";
  const {isCompetitionContractWire}=await import(pathToFileURL(process.argv[1]).href);
  const body=JSON.parse(fs.readFileSync(0,"utf8"));
  if (!isCompetitionContractWire(body) || body.activation_state!=="pending")
    throw new Error("Actual negotiation must decode and remain pending");
' "${SUPABASE_DIR}/../apps/mobile/src/groups/competition-wire-guards.ts" <<<"${BODY}"
for protocol in '' 3 04 4.0 invalid; do
  competition_contract "${OWNER_TOKEN}" "${protocol}"; expect_error UPDATE_REQUIRED 'unsupported competition protocol'
done
competition_contract "${OUTSIDER_TOKEN}" 4; expect_error NOT_FOUND 'competition outsider'
OUTSIDER_ERROR="$(jq -er .message <<<"${BODY}")"
competition_contract "${OWNER_TOKEN}" 4 "$(run_psql "select gen_random_uuid();")"; expect_error NOT_FOUND 'competition nonexistent group'
[[ "$(jq -er .message <<<"${BODY}")" == "${OUTSIDER_ERROR}" ]] || fail 'competition existence disclosure'
competition_contract "$(mint_token "${OWNER_TOKEN}" competition-agent)" 4; expect_error AGENT_FORBIDDEN 'competition OAuth denial'
competition_contract "${ANON_KEY}" 4
[[ ! "${STATUS}" =~ ^2 ]] || fail 'anonymous competition negotiation allowed'
pass 'competition negotiation: exact version/units, pending activation, membership/OAuth/anonymous denial'
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
# A rules-only change projects the SAME witnessed observation at a new score.
# Exact audit equality catches accidental replacement or silent audit rewriting.
cert_audit() {
  run_psql "select (to_jsonb(c)-'observed_set_pin'-'reading_pin'-'current_fingerprint')::text
    from app_public.group_metric_certifications c where id='$1';"
}
drain 'publish original Certified entries'
OBSERVED_REVISION="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
WEIGHT_AUDIT="$(cert_audit "${WEIGHT_CERT}")"
E1RM_AUDIT="$(cert_audit "${E1RM_CERT}")"
assert_retained() {
  [[ "$(cert_audit "${WEIGHT_CERT}")" == "${WEIGHT_AUDIT}" ]] || fail "$1: Weight audit changed"
  [[ "$(cert_audit "${E1RM_CERT}")" == "${E1RM_AUDIT}" ]] || fail "$1: 1RM audit changed"
  for metric in weight e1rm; do
    metric_board "${metric}" true
    check "$1: same set remains Certified at its CURRENT score" '
      [.entries[]|select(.member.user_id==$u and .set_id==$s and .certification_id==$id
        and .value==$value)]|length==1' --arg u "${ATHLETE_UID}" --arg s "${T}-athlete-set" \
      --arg id "$(if [[ "${metric}" == weight ]]; then echo "${WEIGHT_CERT}"; else echo "${E1RM_CERT}"; fi)" \
      --argjson value "$(run_psql "select value from app_public.group_metric_set_scores
        where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and set_id='${T}-athlete-set'
          and metric='${metric}' and rules_revision=(select rules_revision from app_public.group_exercises where id='${GX}');")"
  done
}
update_comparison() {
  local revision
  revision="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
  rpc "${OWNER_TOKEN}" group_exercise_update_v2 "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
    --argjson r "${revision}" --argjson c "$1" --arg mode "$2" '
    {p_group_id:$g,p_exercise_id:$x,p_expected_revision:$r,p_name:"Pull-up",
      p_load_input_mode:$mode,p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'update comparison rules'
}
for enabled in false true false true; do
  set_group_policy "${enabled}"; drain 'repeat policy rule change'
  assert_retained "policy ${enabled}"
done
for contribution in 0 0.5 1; do
  update_comparison "${contribution}" total_load; drain 'contribution rule change'
  assert_retained "contribution ${contribution}"
done
for mode in per_side_load total_load; do
  update_comparison 1 "${mode}"; drain 'target distribution rule change'
  assert_retained "target ${mode}"
done
SOURCE_EVENT_COUNT="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');")"
for mode in per_side_load total_load; do
  next_cuam
  push "${ATHLETE_TOKEN}" 'source distribution rule change' \
    "$(e_def "${DA}" 'Pull-up' "${CUAM}" "${mode}" | jq '.fields.bodyweight_contribution=0.25')"
  drain 'source distribution rule change'; assert_retained "source ${mode}"
  expect_sql 'source rules are not a newly performed record or correction' \
    "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${SOURCE_EVENT_COUNT}"
done
expect_sql 'record baseline reconstruction matches current ordinary and private-dependent scoring pins' \
  "with g as (select app_public.group_metric_eval_source_graph('${GID}','${GX}') graph)
   select bool_and(app_public.group_metric_graph_fingerprint(r,graph->'rules',m,r->>'source_load_input_mode')=r->'fingerprints'->>m)
   from g cross join lateral jsonb_array_elements(graph->'sets') r
   cross join lateral unnest(array['weight','e1rm']) m where (r->>'live')::boolean;" t
# Retry with today's revision/fingerprint returns the original certificate.
[[ "$(certify_metric "${ATHLETE_UID}" "${T}-athlete" e1rm)" == "${E1RM_CERT}" ]] || fail 'rules rescore must not recertify'
assert_retained 'idempotent witness retry'
for scope in false true; do
  rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
    --argjson r "${OBSERVED_REVISION}" --argjson c "${scope}" '
    {p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:$c,p_revision:$r}')"
  expect_ok 'historical board after rescoring'
  check 'historical All and Certified keep original score and witness' '
    [.entries[]|select(.member.user_id==$u and .certification_id==$id and .value==$value)]|length==1' \
    --arg u "${ATHLETE_UID}" --arg id "${E1RM_CERT}" --argjson value "${ON_E1RM}"
done
# A later/no-op reading leaves the same as-of dependency and both audits intact.
next_cuam
push "${ATHLETE_TOKEN}" 'irrelevant future reading' "$(e_reading "${T}-later" "$((START+60000))" 85)"
drain 'later reading'; assert_retained 'irrelevant reading'
set_body_weight "${ATHLETE_TOKEN}" "${T}-athlete" 80
drain 'no-op reading'; assert_retained 'unchanged reading'
pass 'rule changes retain exact witness audits and recalculate Certified entries'
# Exercise the ACTUAL forward data migration on populated active rows after
# rules have moved. A pending reading correction must not be blessed at cutover.
MIGRATION_SQL="$(sed -n '/^-- Establish/,/^-- One legacy witness/p' "${SUPABASE_DIR}"/migrations/*_group_certification_observations.sql)"
expect_sql 'active legacy pins migrate under observed rules, with their audit intact' "begin;
  update app_public.group_metric_certifications set observed_set_pin=null,reading_pin=null,current_fingerprint=null
    where id in ('${WEIGHT_CERT}','${E1RM_CERT}');
  ${MIGRATION_SQL}
  select observed_set_pin is not null and reading_pin<>'pending-correction'
    and current_fingerprint=pinned_fingerprint from app_public.group_metric_certifications where id='${E1RM_CERT}';
  rollback;" t
expect_sql 'migration preserves a pending relevant reading correction for invalidation' "begin;
  set local request.jwt.claims='{\"sub\":\"${ATHLETE_UID}\",\"role\":\"authenticated\"}';
  update app_public.body_weight_measurements set weight_kg=81
    where owner_user_id='${ATHLETE_UID}' and id='${T}-athlete-reading';
  update app_public.group_metric_certifications set observed_set_pin=null,reading_pin=null,current_fingerprint=null
    where id='${E1RM_CERT}';
  ${MIGRATION_SQL}
  select reading_pin='pending-correction' from app_public.group_metric_certifications where id='${E1RM_CERT}';
  rollback;" t
assert_retained 'forward migration audit preservation'


# A certificate with no reading dependency can become temporarily ineligible
# because of a RULE change; returning to ordinary rules restores its entry.
set_group_policy false; drain 'ordinary rival certification'
RIVAL_CERT="$(certify_metric "${RIVAL_UID}" "${T}-rival" e1rm)"
RIVAL_AUDIT="$(cert_audit "${RIVAL_CERT}")"
set_group_policy true; drain 'ineligible rival under bodyweight rules'
[[ "$(cert_audit "${RIVAL_CERT}")" == "${RIVAL_AUDIT}" ]] || fail 'ineligible observation lost its certification'
metric_board e1rm true
check 'missing reading omits Certified entry without ending its witness' '[.entries[]|select(.member.user_id==$u)]|length==0' --arg u "${RIVAL_UID}"
update_comparison 0 total_load; drain 'rival eligible again through rules'
metric_board e1rm true
check 'eligible again uses the same witness' '[.entries[]|select(.member.user_id==$u and .certification_id==$id)]|length==1' \
  --arg u "${RIVAL_UID}" --arg id "${RIVAL_CERT}"
update_comparison 1 total_load; drain 'restore bodyweight contribution'
assert_retained 'after temporary ineligibility'

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

# Working sets only: a warm-up keeps its score row (a stored warm-up record is
# checked against it and stands) but never counts, records or certifies.
lifts() { # lifts <token> <session> <definition> <set-suffix>:<weight>:<reps>:<set_type>...
  local token="$1" sid="$2" def="$3" clock_at at order=0 spec id w r ty
  shift 3
  next_cuam
  clock_at="$(now_ms)"; START=$((START+1000)); (( START > clock_at )) || START=$((clock_at+1000)); at="${START}"
  local -a rows=("$(e_session "${sid}" "${at}" completed "$((at+60000))" 60 null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 'Row' "${CUAM}")")
  for spec in "$@"; do
    IFS=: read -r id w r ty <<<"${spec}"
    rows+=("$(e_set "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" '' "${CUAM}" null "${ty}")")
    order=$((order+1))
  done
  push "${token}" "lifts ${sid}" "${rows[@]}"
}
GX="$(create_comparison "${OWNER_TOKEN}" "${GID}" 0)"
DAW="${T}-athlete-row"; DRW="${T}-rival-row"
next_cuam
push "${ATHLETE_TOKEN}" 'athlete row definition and link' \
  "$(e_def "${DAW}" 'Row' "${CUAM}" total_load)" "$(e_link "${DAW}" "${GID}" "${GX}" "${CUAM}")"
next_cuam
push "${RIVAL_TOKEN}" 'rival row definition and link' \
  "$(e_def "${DRW}" 'Row' "${CUAM}" total_load)" "$(e_link "${DRW}" "${GID}" "${GX}" "${CUAM}")"
lifts "${RIVAL_TOKEN}" "${T}-row-r1" "${DRW}" cr1:30:5:rir_1
lifts "${ATHLETE_TOKEN}" "${T}-row-a1" "${DAW}" ca1:20:5:rir_1 ca2:40:5:warm_up
drain 'working sets only'
metric_board weight
check 'a warm-up heavier than every working set never ranks' '
  (.entries[]|select(.member.user_id==$a)|.value==20 and .set_id==$s) and .entries[0].member.user_id==$r' \
  --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-ca1"
REVISION="$(jq -er '.rules_revision' <<<"${BODY}")"
expect_sql 'the warm-up made no record' "select count(*) from app_public.group_events where set_id='${T}-ca2';" 0
expect_sql 'the warm-up keeps a score row that does not count' \
  "select string_agg(metric||':'||counting,',' order by metric) from app_public.group_metric_set_scores
    where group_exercise_id='${GX}' and set_id='${T}-ca2';" 'e1rm:false,weight:false'
certify_warm_up() {
  rpc "$1" group_metric_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
    --arg s "${T}-ca2" --argjson r "${REVISION}" --arg f "$(run_psql "select fingerprint from
      app_public.group_metric_set_scores where group_exercise_id='${GX}' and set_id='${T}-ca2'
      and metric='weight';")" '
    {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"weight",
      p_expected_revision:$r,p_expected_fingerprint:$f}')"
  expect_error NOT_FOUND "$2"
  check "$2: not a record set" '.message=="NOT_FOUND: record set not found for this metric"'
}
# With no readings for these sessions and independent personal contributions,
# ordinary 1RM still ranks. Witness both metrics before repeated policy writes.
lifts "${RIVAL_TOKEN}" "${T}-row-r2" "${DRW}" czero:35:5:rir_1
drain 'zero contribution performed record'
ZERO_WEIGHT_CERT="$(certify_metric "${RIVAL_UID}" "${T}-row-r2" weight "${T}-czero")"
ZERO_E1RM_CERT="$(certify_metric "${RIVAL_UID}" "${T}-row-r2" e1rm "${T}-czero")"
drain 'zero contribution Certified baseline'
metric_board e1rm
check 'zero contribution retains ordinary 1RM without a reading' '[.entries[]|select(.member.user_id==$r)]|length==1' --arg r "${RIVAL_UID}"
ZERO_BOARD="${BODY}"
assert_zero_toggles
metric_board e1rm
[[ "${BODY}" == "${ZERO_BOARD}" ]] || fail 'zero contribution public board changed across toggles'
for metric in weight e1rm; do
  metric_board "${metric}" true
  check 'unchanged zero score keeps its original witness' '[.entries[]|select(.certification_id==$id)]|length==1' \
    --arg id "$(if [[ "${metric}" == weight ]]; then echo "${ZERO_WEIGHT_CERT}"; else echo "${ZERO_E1RM_CERT}"; fi)"
done
# Later reading edits cannot schedule the zero comparison even with the switch On.
set_group_policy true; drain 'positive comparison policy-on'
next_cuam; push "${RIVAL_TOKEN}" 'reading for a zero-contribution session' "$(e_reading "${T}-zero-reading" 0 100)"
expect_sql 'zero reading edit never queues a comparison' \
  "select count(*) from app_public.group_metric_eval_queue where group_exercise_id='${GX}';" 0
set_group_policy false; drain 'positive comparison policy-off'
pass 'repeated zero contribution toggles preserve ready boards, witnesses, complete audit and history'

certify_warm_up "${RIVAL_TOKEN}" 'a warm-up cannot be certified'

# A result stored before the rule: the same apply with the warm-up counted.
run_psql "update app_public.group_metric_set_scores set counting=true
    where group_exercise_id='${GX}' and set_id='${T}-ca2';
  select app_public.group_metric_apply_member('${GID}','${ATHLETE_UID}','${GX}',${REVISION},
    app_public.group_metric_eval_source_graph('${GID}','${GX}'),false);" >/dev/null
WARM_RECORD="$(run_psql "select id from app_public.group_events where kind='record' and set_id='${T}-ca2';")"
[[ -n "${WARM_RECORD}" ]] || fail 'the stored warm-up record exists'
certify_warm_up "${RIVAL_TOKEN}" 'a stored warm-up record cannot be certified'
WARM_MARK="$(run_psql "select max(seq) from app_public.group_events;")"
lifts "${ATHLETE_TOKEN}" "${T}-row-a2" "${DAW}" ca3:25:5:rir_1
drain 'rebuild after a stored warm-up record'
expect_sql 'the warm-up best falls silently: no lead change, void or record' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and seq>${WARM_MARK};" 0
expect_sql 'the stored warm-up record stands (forward only)' \
  "select count(*) from app_public.group_events where kind='record_voided' and related_event_id='${WARM_RECORD}';" 0
metric_board weight
check 'the board falls to the best working set' '
  (.entries[]|select(.member.user_id==$a)|.value==25 and .set_id==$s) and .entries[0].member.user_id==$r' \
  --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-ca3"
pass 'comparisons count working sets only; a stored warm-up record stands and its board moves silently'

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

# D6 load factor: the shared vectors the mobile groupEnteredWeightFactor runs
# (apps/mobile/src/groups/load-factor-vectors.json), against the SQL.
LOAD_FACTOR_VECTORS="${SUPABASE_DIR}/../apps/mobile/src/groups/load-factor-vectors.json"
[[ -f "${LOAD_FACTOR_VECTORS}" ]] || fail "shared load-factor vectors missing: ${LOAD_FACTOR_VECTORS}"
LOAD_FACTOR_COUNT=0
while IFS=$'\t' read -r source target factor; do
  expect_sql "group_board_load_factor ${source} → ${target}" \
    "select app_public.group_board_load_factor('${source}', '${target}') = ${factor};" t
  LOAD_FACTOR_COUNT=$(( LOAD_FACTOR_COUNT + 1 ))
done < <(jq -r '.cases[] | [.source, .target, .factor] | @tsv' "${LOAD_FACTOR_VECTORS}")
[[ ${LOAD_FACTOR_COUNT} -eq 4 ]] || fail "expected 4 load-factor vectors, ran ${LOAD_FACTOR_COUNT}"
pass 'D6 load factor matches the shared TS vectors'

# Old clients certified one raw witness covering both ordinary kg metrics.
# Rule activation retains that PUBLIC ID and original audit for both projections.
rpc "${OWNER_TOKEN}" group_exercise_create "$(jq -nc --arg g "${GID}" '
  {p_group_id:$g,p_name:"Legacy witnessed lift",p_load_input_mode:"total_load",p_source_exercise_id:null}')"
expect_ok 'legacy exercise'; GX="$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"
LEGACY_DEF="${T}-legacy-def"
next_cuam
push "${ATHLETE_TOKEN}" 'legacy link' "$(e_def "${LEGACY_DEF}" 'Legacy lift' "${CUAM}" total_load)" \
  "$(e_link "${LEGACY_DEF}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-legacy" "${LEGACY_DEF}" 80 35 5
drain 'legacy board'
rpc "${OWNER_TOKEN}" group_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" --arg s "${T}-legacy-set" '
  {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s}')"
expect_ok 'legacy certify'; LEGACY_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
LEGACY_AUDIT="$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${LEGACY_CERT}';")"
drain 'legacy Certified board'
assert_zero_toggles
expect_sql 'zero toggles never activate a legacy revision' \
  "select legacy from app_public.group_rule_revisions where group_exercise_id='${GX}' and revision=1;" t
pass 'legacy zero-contribution witnesses and boards stay in their original revision across toggles'

# A distribution edit activates the current engine, independent of the switch.
update_comparison 0 per_side_load; drain 'legacy witness activated'
for metric in weight e1rm; do
  metric_board "${metric}" true
  check 'legacy witness ID remains public on both metrics' '[.entries[]|select(.certification_id==$id)]|length==1' --arg id "${LEGACY_CERT}"
  rpc "${OWNER_TOKEN}" group_metric_certification_get "$(jq -nc --arg g "${GID}" --arg id "${LEGACY_CERT}" --arg m "${metric}" '
    {p_group_id:$g,p_certification_id:$id,p_metric:$m}')"
  expect_ok 'read legacy witness projection'; assert_wire certification
  check 'legacy witness preserves metric context and identity' '.certification.metric==$m and .certification.certification_id==$id' \
    --arg m "${metric}" --arg id "${LEGACY_CERT}"
done
[[ "$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${LEGACY_CERT}';")" == "${LEGACY_AUDIT}" ]] || fail 'legacy rule migration rewrote its audit'
ZERO_METADATA_SQL="$(sed -n '1,/^-- Live rule/p' "${SUPABASE_DIR}"/migrations/*_zero_contribution_group_toggle.sql)"
expect_sql 'metadata upgrade canonicalizes current and retired zero rules without altering clocks' "begin;
  update app_public.group_rule_revisions set rules=jsonb_set(rules,'{bodyweight_calculations_enabled}','true')
    where group_exercise_id='${GX}';
  create temporary table prior_zero_revision_clocks as select revision,created_at,published_at,retired_at
    from app_public.group_rule_revisions where group_exercise_id='${GX}';
  ${ZERO_METADATA_SQL}
  select bool_and(r.rules->>'bodyweight_calculations_enabled'='false'
    and row(r.created_at,r.published_at,r.retired_at) is not distinct from row(p.created_at,p.published_at,p.retired_at))
    from app_public.group_rule_revisions r join prior_zero_revision_clocks p using(revision)
    where r.group_exercise_id='${GX}'; rollback;" t

# Simulate an old event whose audit captured the global On preference at zero.
# Its stored audit stays intact while both public readers report effective Off.
run_psql "update app_public.group_events set payload=jsonb_set(payload,'{rules,bodyweight_calculations_enabled}','true')
  where group_exercise_id='${GX}' and kind='rules_change';" >/dev/null
rpc "${OWNER_TOKEN}" group_metric_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" '
  {p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false,p_limit:100}')"
expect_ok 'upgraded zero history'
check 'history exercise, revision and old rule event agree on effective zero use' '
  .exercise.bodyweight_calculations_enabled==false and .revision.rules.bodyweight_calculations_enabled==false
  and ([.events[]|select(.kind=="rules_change")]|length==1)
  and all(.events[]|select(.kind=="rules_change"); .rules.bodyweight_calculations_enabled==false)'
ZERO_STREAM_CURSOR=null
ZERO_STREAM_FOUND=false
for page in {1..5}; do
  rpc "${OWNER_TOKEN}" group_stream_v2 "$(jq -nc --arg g "${GID}" --argjson cursor "${ZERO_STREAM_CURSOR}" '
    {p_group_id:$g,p_before:$cursor,p_limit:50}')"
  expect_ok 'upgraded zero stream'; assert_wire stream
  if jq -e --arg x "${GX}" 'any(.items[]; .kind=="rules_change" and .group_exercise_id==$x)' <<<"${BODY}" >/dev/null; then
    check 'stream canonicalizes the old zero rule event' '
      all(.items[]|select(.kind=="rules_change" and .group_exercise_id==$x); .rules.bodyweight_calculations_enabled==false)' --arg x "${GX}"
    ZERO_STREAM_FOUND=true; break
  fi
  ZERO_STREAM_CURSOR="$(jq -c '.next_cursor' <<<"${BODY}")"
  [[ "${ZERO_STREAM_CURSOR}" != null ]] || break
done
[[ "${ZERO_STREAM_FOUND}" == true ]] || fail 'old zero rule event missing from stream'
expect_sql 'public event normalization preserves the old stored rule audit' \
  "select bool_and(payload->'rules'->>'bodyweight_calculations_enabled'='true')
    from app_public.group_events where group_exercise_id='${GX}' and kind='rules_change';" t

set_group_policy true; drain 'legacy dependency activation'
update_comparison 1 per_side_load; drain 'legacy bodyweight dependency'
set_body_weight "${ATHLETE_TOKEN}" "${T}-legacy" 90; drain 'legacy 1RM reading correction'
expect_sql 'legacy reading correction ends only 1RM projection' \
  "select end_reason from app_public.group_metric_certifications where legacy_certification_id='${LEGACY_CERT}' and metric='e1rm';" voided
expect_sql 'legacy raw witness remains active after reading correction' \
  "select ended_at is null from app_public.group_certifications where id='${LEGACY_CERT}';" t
rpc "${OWNER_TOKEN}" group_metric_certification_end "$(jq -nc --arg g "${GID}" --arg id "${LEGACY_CERT}" '
  {p_group_id:$g,p_certification_id:$id,p_action:"withdraw"}')"
expect_ok 'withdraw original legacy witness'
check 'withdrawal returns the remaining active Weight projection' '.certification.metric=="weight" and .certification.end_reason=="withdrawn"'
expect_sql 'original witness and both projections end together' \
  "select count(*) from app_public.group_metric_certifications where legacy_certification_id='${LEGACY_CERT}' and ended_at is not null;" 2
expect_sql 'original legacy end state is preserved' \
  "select end_reason from app_public.group_certifications where id='${LEGACY_CERT}';" withdrawn
drain 'legacy withdrawal publication'
rpc "${OWNER_TOKEN}" group_metric_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" '
  {p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:true}')"
expect_ok 'legacy history'
check 'legacy history exposes original witness IDs, including end events' '
  [.events[]|.certification_id?|select(.!=null)]|length>0 and all(.==$id)' --arg id "${LEGACY_CERT}"
pass 'legacy activation preserves public witness IDs/audits and end routing'

# An equal numeric score cannot conceal a changed logged observation.
NEW_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-legacy" e1rm)"
drain 'new metric witness'
next_cuam
push "${ATHLETE_TOKEN}" 'equal-value raw edit' "$(e_set "${T}-legacy-set" "${T}-legacy-se" 0 35.0 5 '' "${CUAM}")"
drain 'equal-value raw edit'
expect_sql 'raw spelling edit voids the observed set despite equal score' \
  "select end_reason from app_public.group_metric_certifications where id='${NEW_CERT}';" voided
NEW_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-legacy" e1rm)"
next_cuam
push "${ATHLETE_TOKEN}" 'observed set tombstone' "$(e_set "${T}-legacy-set" "${T}-legacy-se" 0 35.0 5 '' "${CUAM}" "${CUAM}")"
drain 'observed set deleted'
expect_sql 'set tombstone voids its witness' \
  "select end_reason from app_public.group_metric_certifications where id='${NEW_CERT}';" voided
next_cuam
push "${ATHLETE_TOKEN}" 'observed set restored' "$(e_set "${T}-legacy-set" "${T}-legacy-se" 0 35.0 5 '' "${CUAM}")"
drain 'observed set restored'
expect_sql 'restoration never revives ended witnesses' \
  "select count(*) from app_public.group_metric_certifications where group_exercise_id='${GX}' and ended_at is null;" 0
pass 'metric observation edits/deletes remain terminal across restoration'

# A tombstone waiting for evaluation at retirement must end the original
# witness now; a later undelete and rule edit cannot import it again.
rpc "${OWNER_TOKEN}" group_exercise_create "$(jq -nc --arg g "${GID}" '
  {p_group_id:$g,p_name:"Pending deletion",p_load_input_mode:"total_load",p_source_exercise_id:null}')"
expect_ok 'pending-deletion legacy exercise'; GX="$(jq -er '.exercise.group_exercise_id' <<<"${BODY}")"
next_cuam
push "${ATHLETE_TOKEN}" 'pending-deletion link' "$(e_link "${LEGACY_DEF}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-pending" "${LEGACY_DEF}" null 40 5
drain 'pending-deletion legacy board'
rpc "${OWNER_TOKEN}" group_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" --arg s "${T}-pending-set" '
  {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s}')"
expect_ok 'pending-deletion legacy certify'; STALE_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
next_cuam
push "${ATHLETE_TOKEN}" 'tombstone before retirement' "$(e_set "${T}-pending-set" "${T}-pending-se" 0 40 5 '' "${CUAM}" "${CUAM}")"
update_comparison 0 per_side_load
expect_sql 'retirement ends stale original before the evaluator runs' \
  "select end_reason from app_public.group_certifications where id='${STALE_CERT}';" voided
drain 'retired tombstoned observation'
next_cuam
push "${ATHLETE_TOKEN}" 'restore after retirement' "$(e_set "${T}-pending-set" "${T}-pending-se" 0 40 5 '' "${CUAM}")"
update_comparison 0 total_load; drain 'later rule after restore'
expect_sql 'ended legacy observation is never imported after restoration' \
  "select count(*) from app_public.group_metric_certifications where legacy_certification_id='${STALE_CERT}';" 0
pass 'legacy retirement cannot strand or resurrect stale witnesses'

# A silent source-mode rescore also preserves the original record's witness
# annotation, even though that historic event keeps its original score pin.
GX="$(create_comparison "${OWNER_TOKEN}" "${GID}" 0)"
next_cuam
push "${ATHLETE_TOKEN}" 'stream witness link' "$(e_link "${LEGACY_DEF}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-stream" "${LEGACY_DEF}" null 50 5
drain 'new witnessed stream record'
STREAM_AUDIT="$(run_psql "select payload::text from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';")"
STREAM_EVENT_COUNT="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');")"
STREAM_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-stream" e1rm)"
# Leave certification queued so the same publication handles both changes.
next_cuam
push "${ATHLETE_TOKEN}" 'stream source-mode edit' "$(e_def "${LEGACY_DEF}" 'Legacy lift' "${CUAM}" per_side_load)"
drain 'stream source-rule rescore'
expect_sql 'coalesced certification and source rules emit no performed record or correction' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
expect_sql 'coalesced source rules still publish the certification lead change' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind='lead_change' and certified and reason='certification' and payload->>'certification_id'='${STREAM_CERT}';" 1
rpc "${OWNER_TOKEN}" group_stream_v2 "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'stream after source-mode rescore'; assert_wire stream
check 'old record context keeps its unchanged performance witness' '
  [.items[]|select(.kind=="record" and .set_id==$s)|.record_context.metrics[]|
    select(.metric=="e1rm" and .certification.certification_id==$id)]|length==1' \
  --arg s "${T}-stream-set" --arg id "${STREAM_CERT}"
expect_sql 'source rescore keeps original record audit and a private current baseline' \
  "select payload::text='${STREAM_AUDIT}' and rule_rescore_baseline->'e1rm'->>'fingerprint' is not null from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';" t
rpc "${OWNER_TOKEN}" group_metric_certification_end "$(jq -nc --arg g "${GID}" --arg id "${STREAM_CERT}" '
  {p_group_id:$g,p_certification_id:$id,p_action:"withdraw"}')"
expect_ok 'withdraw after source rules'; drain 'certification-only publication after source rules'
expect_sql 'later certification job cannot defer a false record correction' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
expect_sql 'later publication preserves original public record audit' \
  "select payload::text from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';" "${STREAM_AUDIT}"
next_cuam
push "${ATHLETE_TOKEN}" 'equal numeric spelling after source rescore' "$(e_set "${T}-stream-set" "${T}-stream-se" 0 50.0 5 '' "${CUAM}")"
drain 'equivalent raw correction after source rules'
expect_sql 'equivalent numeric correction still preserves the standing record' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
performance "${ATHLETE_TOKEN}" "${T}-stream-newer" "${LEGACY_DEF}" null 60 5
drain 'newer stronger record'
metric_board e1rm
check 'historic record is no longer the All-board best' '.entries[]|select(.member.user_id==$u)|.set_id==$s' \
  --arg u "${ATHLETE_UID}" --arg s "${T}-stream-newer-set"
rpc "${OWNER_TOKEN}" group_stream_v2 "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'historic context below newer best'; assert_wire stream
STREAM_PIN="$(jq -er --arg s "${T}-stream-set" '.items[]|select(.kind=="record" and .set_id==$s)|.record_context.metrics[]|select(.metric=="e1rm")|.write_fingerprint' <<<"${BODY}")"
STREAM_REVISION="$(jq -er --arg s "${T}-stream-set" '.items[]|select(.kind=="record" and .set_id==$s)|.rules_revision' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_metric_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${T}-stream-set" --arg f "${STREAM_PIN}" --argjson r "${STREAM_REVISION}" '
  {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_expected_fingerprint:$f}')"
expect_ok 'certify historic record with current context token'; assert_wire certification
STREAM_CERT_2="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain 'new witness of historic equivalent corrected raw facts'
rpc "${OWNER_TOKEN}" group_stream_v2 "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'stream after equivalent correction'; assert_wire stream
check 'private baseline permits current witness context without rewriting historic score' '
  [.items[]|select(.kind=="record" and .set_id==$s)|.record_context.metrics[]|
    select(.metric=="e1rm" and .eligible and .certification.certification_id==$id)]|length==1' \
  --arg s "${T}-stream-set" --arg id "${STREAM_CERT_2}"
next_cuam
push "${ATHLETE_TOKEN}" 'real performance correction after source rescore' "$(e_set "${T}-stream-set" "${T}-stream-se" 0 45 5 '' "${CUAM}")"
drain 'real correction after source rules'
expect_sql 'real performance correction still voids its historic record' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind='record_voided';" 1
expect_sql 'real performance correction still voids the new witness' \
  "select end_reason from app_public.group_metric_certifications where id='${STREAM_CERT_2}';" voided
pass 'source-rule rescore preserves records and witnesses across later certification/performance jobs'

COMPLETED=1
pass 'optional bodyweight backend vectors passed'
