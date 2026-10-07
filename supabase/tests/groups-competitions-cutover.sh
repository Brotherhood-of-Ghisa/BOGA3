#!/usr/bin/env bash
# Protocol-4 populated upgrade: a pre-cutover stack holding protocol-3 and legacy
# data is upgraded and activated, then read: the activation fence, witness
# aliases, frozen former/archived scores, old readers denied, and the deferred
# catch-up of frozen witnesses. Steady-state protocol-4 behaviour is
# groups-competitions.sh's. Uses only this lane's slot-local
# stack. The reset to a pre-cutover migration
# and the activation are one-way: the stack is marked before either, and the
# next baseline preflight restores it (ensure-local-runtime-baseline.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL=groups-competitions-cutover
FIXTURE_EMAIL_PREFIX=groups-competition
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"
RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="Competition!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
COMPLETED=0
WIRE_PID=""
cleanup() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then status=1; fi
  if [[ -n "${WIRE_PID}" ]]; then exec 7>&- 8<&-; kill "${WIRE_PID}" 2>/dev/null || true; fi
  rm -rf "${RESET_LOG}" "${UPGRADE_LOG}" "${WIRE_DIR}"
  exit "${status}"
}
RESET_LOG="$(mktemp)"; UPGRADE_LOG="$(mktemp)"; WIRE_DIR="$(mktemp -d)"
trap cleanup EXIT
mark_stack_needs_reset 'groups-competitions-cutover.sh reset to a pre-cutover migration and activated protocol 4'
# A real populated migration, not a synthetic post-install pin backfill.
run_supabase db reset --local --version 20261004225853 --yes >"${RESET_LOG}" 2>&1 || { cat "${RESET_LOG}" >&2; fail 'pre-cutover reset'; }
refresh_edge_proxy_after_reset >/dev/null || fail 'Edge Function routing after the pre-cutover reset'
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
run_psql "select app_public.group_eval_set_url(''); select cron.alter_job(jobid,active:=false) from cron.job where jobname='group-eval-sweep';" >/dev/null
rpc4() {
  local token="$1" name="$2" args="$3" protocol="${4-4}" out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${token}" \
    -H 'Content-Profile: app_public' -H 'Content-Type: application/json' -H "x-boga-group-contract: ${protocol}" \
    -H 'x-boga-sync-protocol: 3' --data "${args}" -o "${out}" -w '%{http_code}' "${API_URL}/rest/v1/rpc/${name}")"
  BODY="$(cat "${out}")"; rm -f "${out}"
}
# One decoder process for the whole body (a node start per call was ~70 ms, over
# 200 calls). Each call writes "<guard>\t<compact JSON>" and blocks on its own
# verdict line, so a failure stops the body at the call that caused it; a dead
# decoder reads as EOF, which fails too.
mkfifo "${WIRE_DIR}/in" "${WIRE_DIR}/out"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
  import readline from "node:readline"; import {pathToFileURL} from "node:url";
  const dir=process.argv[1];
  const base=await import(pathToFileURL(`${dir}/competition-wire-guards.ts`));
  const readers=await import(pathToFileURL(`${dir}/competition-reader-guards.ts`));
  for await (const line of readline.createInterface({input:process.stdin})) {
    const tab=line.indexOf("\t"),kind=line.slice(0,tab);
    let verdict;
    try { verdict=(base[kind]??readers[kind])?.(JSON.parse(line.slice(tab+1))) ? "ok" : `rejected ${line.slice(tab+1)}`; }
    catch (error) { verdict=`threw ${error.message}`; }
    process.stdout.write(`${verdict}\n`);
  }
' "${SUPABASE_DIR}/../apps/mobile/src/groups" <"${WIRE_DIR}/in" >"${WIRE_DIR}/out" &
WIRE_PID=$!
exec 7>"${WIRE_DIR}/in" 8<"${WIRE_DIR}/out"
# wire_verdict <guard>: the decoder's verdict on BODY, run in a subshell that
# ignores SIGPIPE, so a decoder that has exited fails the write instead of
# killing bash. The write gets its own subshell so a failed write's buffered
# line cannot leak into the verdict.
wire_verdict() {
  local verdict="" wrote=0
  trap '' PIPE
  (printf '%s\t%s\n' "$1" "${BODY//$'\n'/}") >&7 2>/dev/null && wrote=1
  [[ ${wrote} -eq 1 ]] && read -r verdict <&8 || true
  printf '%s' "${verdict:-decoder exited}"
}
assert_wire() {
  local verdict
  verdict="$(wire_verdict "$1")"
  [[ "${verdict}" == ok ]] || fail "actual $1 decoder: ${verdict}"
}
# Canary: the decoder must be able to say no, or every assert_wire is a no-op.
BODY='{}'; [[ "$(wire_verdict isCompetitionContractWire)" == 'rejected {}' ]] || fail 'decoder accepted an empty contract'
BODY=''
expect_sql() { local actual; actual="$(run_psql "$2")"; [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '$actual'"; }
drain() {
  local out; out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST -H 'Content-Type: application/json' -H 'x-boga-sync-protocol: 3' \
    -H "x-group-eval-secret: ${EVAL_SECRET}" --data '{}' -o "${out}" -w '%{http_code}' "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "${out}")"; rm -f "${out}"; expect_ok "drain $1"; check "drain $1" '.failed==$n' --argjson n "${2:-0}"
}
now_ms() { run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;"; }
e_reading() { jq -nc --arg id "$1" --argjson at "$2" --argjson kg "$3" --argjson c "${CUAM}" --argjson del "${4:-null}" \
  '{type:"body_weight_measurements",id:$id,client_updated_at_ms:$c,fields:{weight_kg:$kg,measured_at:$at,created_at:$c,updated_at:$c,deleted_at:$del}}'; }
create_old() {
  rpc "${OWNER_TOKEN}" group_exercise_create_v2 "$(jq -nc --arg g "${GID}" --arg n "$1" --argjson c "$2" --arg m "${3:-e1rm}" \
    '{p_group_id:$g,p_name:$n,p_load_input_mode:"total_load",p_source_exercise_id:null,p_bodyweight_contribution:$c,p_default_metric:$m}')"
  expect_ok 'old comparison'; jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
old_board() {
  rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$1" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:false}')"; expect_ok 'old board'
}
old_certify() {
  local member="$1" set="$2" metric="$3" pin rev
  old_board "${metric}"
  pin="$(jq -er --arg u "${member}" --arg s "${set}" '.entries[]|select(.member.user_id==$u and .set_id==$s)|.fingerprint' <<<"${BODY}")" || fail 'old fixture must have a shared ranked set'
  rev="$(jq -er .rules_revision <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_metric_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${member}" --arg s "${set}" \
    --arg m "${metric}" --arg f "${pin}" --argjson r "${rev}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:$m,p_expected_revision:$r,p_expected_fingerprint:$f}')"
  if [[ "${STATUS}" != 200 ]]; then
    run_psql "select jsonb_build_object('legacy',app_public.group_metric_is_legacy(id),'revision',rules_revision,
      'published',published_rules_revision,'member', '${member}','set','${set}') from app_public.group_exercises where id='${GX}';
      select s.metric,s.counting,app_public.group_set_is_warm_up(s.member_user_id,s.set_id),
      exists(select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=s.group_exercise_id
        and e.rules_revision=s.rules_revision and e.member_user_id=s.member_user_id and e.set_id=s.set_id and e.metric=s.metric and not e.certified)
      from app_public.group_metric_set_scores s where s.group_exercise_id='${GX}' and s.member_user_id='${member}' and s.set_id='${set}';" >&2
  fi
  expect_ok "old certification ${metric} of ${set}"; jq -er '.certification.certification_id' <<<"${BODY}"
}
policy() {
  rpc4 "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${GID}" --argjson e "$1" \
    '{p_group_id:$g,p_name:"Competition fixture",p_description:null,p_bodyweight_calculations_enabled:$e}')"
  expect_ok 'group policy'
}
board() {
  rpc4 "${OWNER_TOKEN}" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$1" --argjson c "${2:-false}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
  expect_ok 'competition board'; assert_wire isCompetitionBoardWire
}
audit() {
  run_psql "select jsonb_build_object('id',id,'observed_value',observed_value,'unit',unit,'performance',performance,
    'certified_by',certified_by,'certified_at',certified_at,'observed_rules_revision',observed_rules_revision,
    'observed_set_pin',observed_set_pin,'legacy_certification_id',legacy_certification_id)::text
    from app_public.group_metric_certifications where id='$1';"
}
provision OWNER owner; provision ATHLETE athlete; provision RIVAL rival; provision NEVER never; provision OUTSIDER outsider; provision FROZEN frozen
for prefix in OWNER ATHLETE RIVAL NEVER OUTSIDER FROZEN; do uid="${prefix}_UID"; set_username "${!uid}" "cp_${prefix}_${RUN_TAG//-/_}"; done
rpc "${OWNER_TOKEN}" group_create '{"p_name":"Competition fixture","p_description":null}'; expect_ok 'create'
GID="$(jq -er .group_id <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'invite'; INVITE="$(jq -er .code <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${NEVER_TOKEN}" "${FROZEN_TOKEN}"; do rpc "${token}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"; expect_ok 'join'; done
GX="$(create_old 'Pull-up' 1 weight)"; MAIN_GX="${GX}"
ZERO_GX="$(create_old 'Ordinary' 0)"
CUAM="$(now_ms)"; START=$((CUAM+1000)); T="cp-${RUN_TAG}"
for prefix in ATHLETE RIVAL NEVER; do
  token="${prefix}_TOKEN"; weight=20; kg=null
  [[ "${prefix}" != ATHLETE ]] || kg=80; [[ "${prefix}" != RIVAL ]] || kg=120
  next_cuam
  push "${!token}" 'shared source' "$(e_def "${T}-${prefix}-def" 'Pull-up' "${CUAM}")" \
    "$(e_link "${T}-${prefix}-def" "${GID}" "${GX}" "${CUAM}")" \
    "$(e_session "${T}-${prefix}" "${START}" completed "$((START+30000))" 30 null "${CUAM}")" \
    "$(e_se "${T}-${prefix}-se" "${T}-${prefix}" "${T}-${prefix}-def" 0 'Pull-up' "${CUAM}")" \
    "$(e_set "${T}-${prefix}-set" "${T}-${prefix}-se" 0 "${weight}" 5 '' "${CUAM}" null rir_0)"
  if [[ "${kg}" != null ]]; then next_cuam; push "${!token}" 'reading' "$(e_reading "${T}-${prefix}-reading" "${START}" "${kg}")"; fi
done
next_cuam
push "${ATHLETE_TOKEN}" 'same-group secondary comparison and permitted ordinary context' \
  "$(e_link "${T}-ATHLETE-def" "${GID}" "${ZERO_GX}" "${CUAM}" null "${T}-secondary-link")" \
  "$(e_def "${T}-ordinary-def" 'Ordinary unrelated' "${CUAM}")" \
  "$(e_se "${T}-ordinary-se" "${T}-ATHLETE" "${T}-ordinary-def" 1 'Ordinary unrelated' "${CUAM}")" \
  "$(e_set "${T}-ordinary-set" "${T}-ordinary-se" 0 50 8 '' "${CUAM}" null rir_0)"
drain 'old ordinary baseline'
WEIGHT_CERT="$(old_certify "${ATHLETE_UID}" "${T}-ATHLETE-set" weight)"
E1RM_CERT="$(old_certify "${ATHLETE_UID}" "${T}-ATHLETE-set" e1rm)"
NEVER_CERT="$(old_certify "${NEVER_UID}" "${T}-NEVER-set" e1rm)"
WEIGHT_AUDIT="$(audit "${WEIGHT_CERT}")"; E1RM_AUDIT="$(audit "${E1RM_CERT}")"; NEVER_AUDIT="$(audit "${NEVER_CERT}")"
# Keep actual pre-metric raw witnesses, an archived legacy board and a former
# membership period populated across installation and the one-way activation.
for suffix in legacy archived; do
  rpc "${OWNER_TOKEN}" group_exercise_create "$(jq -nc --arg g "${GID}" --arg n "${suffix}" \
    '{p_group_id:$g,p_name:$n,p_load_input_mode:"total_load",p_source_exercise_id:null}')"
  expect_ok 'legacy comparison'; x="$(jq -er .exercise.group_exercise_id <<<"${BODY}")"
  if [[ "${suffix}" == legacy ]]; then LEGACY_GX="${x}"; else ARCHIVE_GX="${x}"; fi
  for prefix in ATHLETE FROZEN; do
    token="${prefix}_TOKEN"; uid="${prefix}_UID"; sid="${T}-${suffix}-${prefix}"
    next_cuam
    push "${!token}" 'legacy shared performance' "$(e_def "${sid}-def" 'Legacy lift' "${CUAM}")" \
      "$(e_link "${sid}-def" "${GID}" "${x}" "${CUAM}")" \
      "$(e_session "${sid}" "${START}" completed "$((START+30000))" 30 null "${CUAM}")" \
      "$(e_se "${sid}-se" "${sid}" "${sid}-def" 0 'Legacy lift' "${CUAM}")" \
      "$(e_set "${sid}-set" "${sid}-se" 0 35 5 '' "${CUAM}" null rir_0)"
    drain 'legacy publication'
    rpc "${OWNER_TOKEN}" group_certify "$(jq -nc --arg g "${GID}" --arg x "${x}" --arg u "${!uid}" --arg s "${sid}-set" \
      '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s}')"
    expect_ok 'legacy raw witness'
    if [[ "${suffix}-${prefix}" == legacy-ATHLETE ]]; then
      LEGACY_CERT="$(jq -er .certification.certification_id <<<"${BODY}")"
      LEGACY_AUDIT="$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${LEGACY_CERT}';")"
    fi
    if [[ "${suffix}-${prefix}" == legacy-FROZEN ]]; then
      FORMER_CERT="$(jq -er .certification.certification_id <<<"${BODY}")"
      FORMER_AUDIT="$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${FORMER_CERT}';")"
    fi
    if [[ "${suffix}-${prefix}" == archived-ATHLETE ]]; then
      ARCHIVE_CERT="$(jq -er .certification.certification_id <<<"${BODY}")"
      ARCHIVE_AUDIT="$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${ARCHIVE_CERT}';")"
    fi
  done
  drain 'legacy Certified publication'
done
rpc "${OWNER_TOKEN}" group_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${ARCHIVE_GX}" '{p_group_id:$g,p_exercise_id:$x}')"; expect_ok 'archive before install'
rpc "${FROZEN_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'leave before install'; drain 'former membership freeze'
next_cuam
push "${FROZEN_TOKEN}" 'raw correction while former' "$(e_set "${T}-legacy-FROZEN-set" "${T}-legacy-FROZEN-se" 0 36 5 '' "${CUAM}" null rir_0)"
next_cuam
push "${ATHLETE_TOKEN}" 'raw deletion while archived' "$(e_set "${T}-archived-ATHLETE-set" "${T}-archived-ATHLETE-se" 0 35 5 '' "${CUAM}" "${CUAM}" rir_0)"
drain 'frozen raw edits before installation'
policy true; drain 'old On binding and missing context'
expect_sql 'old never-bound sentinel exists before install' "select reading_pin=encode(extensions.digest(jsonb_build_object('body_weight_kg',null,'body_weight_source',null,'body_weight_measurement_id',null,'body_weight_measured_at',null)::text,'sha256'),'hex') from app_public.group_metric_certifications where id='${NEVER_CERT}';" t
next_cuam; push "${ATHLETE_TOKEN}" 'pending reading correction at cutover' "$(e_reading "${T}-ATHLETE-reading" "${START}" 90)"
# Upgrade with active certificates, original audit and pending queue work intact.
run_supabase db push --local --include-all --yes >"${UPGRADE_LOG}" 2>&1 || { cat "${UPGRADE_LOG}" >&2; fail 'populated upgrade'; }
expect_sql 'never-bound active pin cleared only by actual migration' "select reading_pin is null and ended_at is null from app_public.group_metric_certifications where id='${NEVER_CERT}';" t
rpc4 "${OWNER_TOKEN}" group_competition_contract "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'pending'; assert_wire isCompetitionContractWire; check pending '.activation_state=="pending"'
rpc4 "${OWNER_TOKEN}" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm"}')"; expect_error UPDATE_REQUIRED 'pending board'
rpc4 "${OWNER_TOKEN}" group_competition_activate '{"p_expected_contract":4}'; [[ ! "${STATUS}" =~ ^2 ]] || fail 'app activated server'
docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq \
  <<<"begin; select pg_advisory_xact_lock_shared(25006,0); select pg_sleep(3); commit;" >/dev/null 2>&1 &
LOCK_PID=$!
for attempt in $(seq 1 50); do
  [[ "$(run_psql "select exists(select 1 from pg_locks where locktype='advisory' and classid=25006 and granted and mode='ShareLock');")" == t ]] && break
  sleep 0.05
done
if blocked="$(run_psql "set lock_timeout='500ms'; select app_public.group_competition_activate(4);" 2>&1)"; then
  wait "${LOCK_PID}"; fail 'activation crossed an in-flight shared fence'
fi
[[ "${blocked}" == *'lock timeout'* ]] || fail 'activation must wait on the shared fence'
wait "${LOCK_PID}"
expect_sql 'failed activation leaves capability pending' 'select not app_public.group_competition_active();' t
rpc4 "${SERVICE_ROLE_KEY}" group_competition_activate '{"p_expected_contract":4}'; expect_ok activation; check activation '.activated==true and .comparisons==4'
rpc4 "${SERVICE_ROLE_KEY}" group_competition_activate '{"p_expected_contract":4}'; expect_ok 'idempotent activation'; check idempotent '.activated==false'
rpc4 "${OWNER_TOKEN}" group_competition_contract "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok active; assert_wire isCompetitionContractWire; check active '.activation_state=="active"'
board volume; check rebuilding '.state=="rebuilding" and .entries==[]'
drain 'activated representation'
board volume; check 'best single-set normalized Volume, not kg fallback' \
  '.state=="ready" and .rules.default_metric=="volume" and .entry_count==2 and all(.entries[];.unit=="percent_bw_reps" and .performance.visibility=="normalized")'
check 'normalized values use private as-of B' \
  '(.entries[]|select(.member.user_id==$a)|(.value-611.1111111111111|fabs)<0.000000001) and
   (.entries[]|select(.member.user_id==$r)|(.value-583.3333333333334|fabs)<0.000000001)' --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}"
expect_sql 'pending correction ends dependent 1RM, keeps Weight origin' \
  "select (select end_reason='voided' from app_public.group_metric_certifications where id='${E1RM_CERT}')
    and (select ended_at is null from app_public.group_metric_certifications where id='${WEIGHT_CERT}');" t
[[ "$(audit "${WEIGHT_CERT}")" == "${WEIGHT_AUDIT}" && "$(audit "${E1RM_CERT}")" == "${E1RM_AUDIT}" ]] || fail 'original audit changed at cutover'
board volume true; check 'Weight witness aliased into Volume without changing public identity' '.entries|length==1 and .[0].certification.certification_id==$id' --arg id "${WEIGHT_CERT}"
expect_sql 'distinct Volume origin with immutable original kg audit' \
  "select metric='volume' and witness_certification_id='${WEIGHT_CERT}' and observed_value is null and unit is null
    from app_public.group_metric_certifications where witness_certification_id='${WEIGHT_CERT}';" t
next_cuam; push "${NEVER_TOKEN}" 'first valid context after actual sentinel upgrade' "$(e_reading "${T}-NEVER-reading" "${START}" 100)"; drain first-binding
[[ "$(audit "${NEVER_CERT}")" == "${NEVER_AUDIT}" ]] || fail 'first binding changed audit'
expect_sql 'first valid binding preserves witness and restores Certified' \
  "select ended_at is null and reading_pin is not null from app_public.group_metric_certifications where id='${NEVER_CERT}';" t
board e1rm true; check 'same public first-binding ID restored' 'any(.entries[];.certification.certification_id==$id)' --arg id "${NEVER_CERT}"
pass 'populated migration, pending correction, Volume witness provenance and first binding'

GX="${LEGACY_GX}"
for metric in volume e1rm; do
  board "${metric}" true; check 'legacy raw witness identity remains public' 'any(.entries[];.certification.certification_id==$id)' --arg id "${LEGACY_CERT}"
done
board e1rm; check 'compatible legacy former entry preserves original period and score' 'any(.entries[];.member.user_id==$u and .former and .unit=="kg")' --arg u "${FROZEN_UID}"
board e1rm true; check 'former raw correction stays frozen Certified at cutover' 'any(.entries[];.certification.certification_id==$c)' --arg c "${FORMER_CERT}"
board volume; check 'inactive raw Weight does not invent Volume' 'all(.entries[];.member.user_id!=$u)' --arg u "${FROZEN_UID}"
[[ "$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${LEGACY_CERT}';")" == "${LEGACY_AUDIT}" ]] || fail 'legacy audit changed at cutover'
GX="${ARCHIVE_GX}"; board e1rm; check 'archived ordinary legacy score remains exact and readable' '.state=="archived" and .entry_count==2 and all(.entries[];.unit=="kg")'
board e1rm true; check 'archived raw deletion stays frozen Certified at cutover' 'any(.entries[];.certification.certification_id==$c)' --arg c "${ARCHIVE_CERT}"
[[ "$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${FORMER_CERT}';")" == "${FORMER_AUDIT}" &&
   "$(run_psql "select to_jsonb(c)::text from app_public.group_certifications c where id='${ARCHIVE_CERT}';")" == "${ARCHIVE_AUDIT}" ]] || fail 'cutover reconciled frozen raw edits early'
board volume; check 'archived raw Weight does not invent Volume' '.state=="archived" and .entries==[]'
GX="${MAIN_GX}"
pass 'legacy raw witness aliases and compatible former/archived ordinary cutover'

# Every unsafe old route denies even a forged current header, before raw data.
while IFS=$'\t' read -r name args; do
  rpc4 "${OWNER_TOKEN}" "${name}" "${args}"; expect_error UPDATE_REQUIRED "legacy ${name}"
done < <(run_psql "select p.proname||E'\\t'||coalesce((select jsonb_object_agg(a.name,case format_type(p.proargtypes[a.n-1],null)
  when 'uuid' then to_jsonb('${GID}'::text) when 'text' then to_jsonb('sample'::text) when 'boolean' then 'true'::jsonb
  when 'jsonb' then 'null'::jsonb else '1'::jsonb end)::text from unnest(p.proargnames) with ordinality a(name,n)), '{}')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public'
    and exists(select 1 from pg_proc helper where helper.pronamespace=p.pronamespace and helper.proname=p.proname||'_pre_competition') order by p.proname;")
expect_sql 'pre-competition implementations are not callable by clients/service' \
  "select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public' and p.proname like '%_pre_competition';" t
pass 'old readers deny a forged current header; pre-competition implementations stay private'

rpc4 "${FROZEN_TOKEN}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"; expect_ok 'former rejoins'
GX="${LEGACY_GX}"; board e1rm true
check 'old membership period is hidden before catch-up' 'all(.entries[];.certification.certification_id!=$c)' --arg c "${FORMER_CERT}"
drain rejoin
expect_sql 'rejoin reconciles formerly frozen raw edit' "select end_reason='voided' from app_public.group_certifications where id='${FORMER_CERT}';" t
rpc4 "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${ARCHIVE_GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:false}')"; expect_ok 'unarchive'; assert_wire isCompetitionExerciseWriteWire
drain unarchive
expect_sql 'unarchive reconciles frozen raw deletion' "select end_reason='voided' from app_public.group_certifications where id='${ARCHIVE_CERT}';" t
GX="${MAIN_GX}"
pass 'original membership-period fencing and deferred frozen witness catch-up'

COMPLETED=1
pass 'protocol-4 cutover vectors passed'
