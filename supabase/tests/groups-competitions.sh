#!/usr/bin/env bash
# Protocol-4 populated upgrade, actual Sync/Edge publication and public privacy.
# Uses only this lane's slot-local stack; restores latest pending schema on exit.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL=groups-competitions
FIXTURE_EMAIL_PREFIX=groups-competition
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"
RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="Competition!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
COMPLETED=0
RESET_NEEDED=0
cleanup() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then status=1; fi
  if [[ ${RESET_NEEDED} -eq 1 ]]; then
    # Activation has no production rollback API. The isolated test stack is
    # rebuilt so every later lane runs the installed, pending representation.
    if ! "${SUPABASE_DIR}/../boga" db reset >"${RESET_LOG}" 2>&1; then
      cat "${RESET_LOG}" >&2; status=1
    fi
  fi
  rm -f "${RESET_LOG}" "${UPGRADE_LOG}"
  exit "${status}"
}
RESET_LOG="$(mktemp)"; UPGRADE_LOG="$(mktemp)"
trap cleanup EXIT
RESET_NEEDED=1
# A real populated migration, not a synthetic post-install pin backfill.
run_supabase db reset --local --version 20261004225853 --yes >"${RESET_LOG}" 2>&1 || { cat "${RESET_LOG}" >&2; fail 'pre-cutover reset'; }
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"
KONG_CONTAINER="$(resolve_worktree_container kong "$(worktree_project_id)" "$(worktree_config_port api)")"
docker restart "${KONG_CONTAINER}" >/dev/null
for attempt in $(seq 1 45); do
  if curl_health --max-time 2 >/dev/null 2>&1; then break; fi
  sleep 1
done
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
assert_wire() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    import fs from "node:fs"; import {pathToFileURL} from "node:url";
    const dir=process.argv[1],kind=process.argv[2],body=JSON.parse(fs.readFileSync(0,"utf8"));
    const base=await import(pathToFileURL(`${dir}/competition-wire-guards.ts`));
    const readers=await import(pathToFileURL(`${dir}/competition-reader-guards.ts`));
    if (!(base[kind]??readers[kind])?.(body)) throw new Error(`Actual RPC failed ${kind}: ${JSON.stringify(body)}`);
  ' "${SUPABASE_DIR}/../apps/mobile/src/groups" "$1" <<<"${BODY}" || fail "actual $1 decoder"
}
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
certify() {
  local member="$1" set="$2" metric="$3" token rev
  board "${metric}"
  token="$(jq -er --arg u "${member}" --arg s "${set}" '.entries[]|select(.member.user_id==$u and .performance.set_id==$s)|.write_token' <<<"${BODY}")"
  rev="$(jq -er .rules.rules_revision <<<"${BODY}")"
  rpc4 "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${member}" --arg s "${set}" \
    --arg m "${metric}" --arg t "${token}" --argjson r "${rev}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:$m,p_expected_revision:$r,p_write_token:$t}')"
  expect_ok 'competition certify'; assert_wire isCompetitionCertifyResultWire; jq -er '.certification.certification_id' <<<"${BODY}"
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
for protocol in '' 3 invalid 04; do
  rpc4 "${OWNER_TOKEN}" group_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')" "${protocol}"; expect_error UPDATE_REQUIRED 'old capability group read'
done
rpc4 "${OUTSIDER_TOKEN}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_error NOT_FOUND outsider
rpc4 "$(mint_token "${OWNER_TOKEN}" competition-agent)" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_error AGENT_FORBIDDEN OAuth
rpc4 "${ANON_KEY}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; [[ ! "${STATUS}" =~ ^2 ]] || fail 'anonymous data read'
rest GET "${OWNER_TOKEN}" group_metric_set_scores 'select=*'; [[ ! "${STATUS}" =~ ^2 ]] || fail 'direct score table exposed'
expect_sql 'private helpers are not callable by clients/service' \
  "select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public' and
      (p.proname like '%_pre_competition' or p.proname in ('group_competition_event_json','group_competition_history_value','group_competition_session_json'));" t
pass 'old reader/header forgery, private helper/direct table and app authorization denial'

while IFS=$'\t' read -r name args; do
  rpc4 "${OUTSIDER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "outsider ${name}"
  rpc4 "$(mint_token "${OWNER_TOKEN}" competition-agent)" "${name}" "${args}"; expect_error AGENT_FORBIDDEN "OAuth ${name}"
  rpc4 "${ANON_KEY}" "${name}" "${args}"; [[ ! "${STATUS}" =~ ^2 ]] || fail "anonymous ${name}"
done < <(run_psql "select p.proname||E'\\t'||coalesce((select jsonb_object_agg(a.name,case format_type(p.proargtypes[a.n-1],null)
  when 'uuid' then to_jsonb('${GID}'::text) when 'text' then to_jsonb('sample'::text) when 'boolean' then 'true'::jsonb
  when 'jsonb' then 'null'::jsonb else '1'::jsonb end)::text from unnest(p.proargnames) with ordinality a(name,n)), '{}')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public'
    and p.proname like 'group_competition_%' and has_function_privilege('authenticated',p.oid,'execute') order by p.proname;")
rpc4 "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${OUTSIDER_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_error NOT_FOUND 'unshared member/session pair'
pass 'every current reader/write denies anonymous, OAuth and outsider before payload validation'

rpc4 "${OWNER_TOKEN}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok catalog; assert_wire isCompetitionExerciseListWire
rpc4 "${OWNER_TOKEN}" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_certified:false}')"; expect_ok podiums; assert_wire isCompetitionPodiumsWire
rpc4 "${OWNER_TOKEN}" group_competition_revisions "$(jq -nc --arg g "${GID}" --arg x "${GX}" '{p_group_id:$g,p_group_exercise_id:$x}')"; expect_ok revisions; assert_wire isCompetitionRevisionsWire
for metric in weight volume e1rm; do
  rpc4 "${OWNER_TOKEN}" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "${metric}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:false,p_revision:2}')"; expect_ok history; assert_wire isCompetitionHistoryWire
  check 'enabled historical absolute scores unavailable' 'all(.events[].values[]; .value==null or (.unit=="percent_bw" or .unit=="percent_bw_reps"))'
done
for group in "\"${GID}\"" null; do
  rpc4 "${OWNER_TOKEN}" group_competition_stream "{\"p_group_id\":${group},\"p_limit\":50}"; expect_ok stream; assert_wire isCompetitionStreamWire
  check 'enabled stream has no private reading/hash/audit and normalized sessions have no kg' \
    '([paths|select(.[-1]|IN("weight_kg","body_weight_kg","fingerprint","write_fingerprint","observed_value","reading_pin"))]|length==0)
     and all(.items[]|select(.kind=="session")|.session.exercises[]|select(.visibility=="normalized");all(.sets[];has("weight_value")|not))
     and all(.items[]|select(.kind=="competition")|.event|select(.visibility=="normalized")|.values[];.value==null or (.unit=="percent_bw" or .unit=="percent_bw_reps"))'
  check 'stream omits rules changes' 'all(.items[]|select(.kind=="competition"); .event.kind!="rules_change")'
done
expect_sql 'rules changes the stream omits still exist' "select count(*)>0 from app_public.group_events where group_id='${GID}' and kind='rules_change';" t
rpc4 "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${ATHLETE_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_ok session; assert_wire isCompetitionSessionDetailWire
check 'full session redacts normalized sets, retains unrelated ordinary context and excludes subtraction total' \
  'all(.session.exercises[]|select(.visibility=="normalized");all(.sets[];has("weight_value")|not))
   and any(.session.exercises[]|select(.visibility=="ordinary")|.sets[];.weight_value=="50")
   and (.session|has("volume_kg_reps")|not)'
rpc4 "${OWNER_TOKEN}" group_competition_week_summary "$(jq -nc --arg g "${GID}" --argjson s "$((START-1000))" --argjson e "$((START+86400000))" \
  '{p_group_id:$g,p_window_start_ms:$s,p_window_end_ms:$e}')"; expect_ok week; assert_wire isCompetitionWeekSummaryWire
check 'week scores redacted, counts retained, no subtraction total' '.members|length==4'
GX="${ZERO_GX}"; board e1rm; check 'ordinary counterpart from normalized source cannot bypass same-group boundary' '.entries==[]'
rpc4 "${OWNER_TOKEN}" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false,p_revision:1}')"
expect_ok 'secondary ordinary history'; assert_wire isCompetitionHistoryWire
check 'old same-group kg event is unavailable, not relabeled' 'all(.events[].values[];.unit!="kg" or (.value==null and .unavailable==true))'
GX="${MAIN_GX}"
pass 'actual catalog/podium/revision/history/stream/session/week payloads decode with enabled privacy'

# A published percentage remains joinable by set ID while source work is
# queued. Moving that source to an ordinary definition cannot reveal its kg.
next_cuam
push "${RIVAL_TOKEN}" 'source identity move before publication' \
  "$(e_def "${T}-moved-def" 'Moved ordinary' "${CUAM}")" \
  "$(e_se "${T}-RIVAL-se" "${T}-RIVAL" "${T}-moved-def" 0 'Moved ordinary' "${CUAM}")"
rpc4 "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${RIVAL_UID}" --arg s "${T}-RIVAL" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"
expect_ok 'queued source move session'; assert_wire isCompetitionSessionDetailWire
check 'queued source move hides kg counterpart' '.session.exercises[0].visibility=="normalized" and (.session.exercises[0].sets[0]|has("weight_value")|not)'
next_cuam
push "${RIVAL_TOKEN}" 'restore source identity' "$(e_se "${T}-RIVAL-se" "${T}-RIVAL" "${T}-RIVAL-def" 0 'Pull-up' "${CUAM}")"
drain 'coalesced source identity move'
# Preserve raw reps even when an exercise has no definition. Unknown identity
# cannot establish that an absolute counterpart is unrelated.
next_cuam
push "${ATHLETE_TOKEN}" 'unbound exercise raw context' \
  "$(e_se "${T}-unknown-se" "${T}-ATHLETE" '' 2 'Unknown exercise' "${CUAM}")" \
  "$(e_set "${T}-unknown-set" "${T}-unknown-se" 0 40 7 '' "${CUAM}" null rir_0)"
rpc4 "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${ATHLETE_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"
expect_ok 'unknown exercise session'; assert_wire isCompetitionSessionDetailWire
check 'unknown exercise retains reps and omits kg' 'any(.session.exercises[]; .exercise_definition_id==null and .load_input_mode==null and
  .visibility=="normalized" and .sets[0].reps_value=="7" and (.sets[0]|has("weight_value")|not))'
pass 'queued identity and unbound exercise privacy with permitted reps retained'

# Run every selected-reading transition against BOTH dependent metrics. Public
# IDs and immutable observed audit are checked separately from private bindings.
update_rules() {
  local rev; rev="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
  rpc4 "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${GID}" --arg x "${GX}" --argjson r "${rev}" \
    --argjson c "$1" --arg m "${2:-total_load}" '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:$r,p_name:"Pull-up",
      p_load_input_mode:$m,p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'competition rule update'; assert_wire isCompetitionExerciseWriteWire
}
pair() {
  V_PUBLIC="$(certify "${ATHLETE_UID}" "${T}-ATHLETE-set" volume)"
  R_PUBLIC="$(certify "${ATHLETE_UID}" "${T}-ATHLETE-set" e1rm)"
  V_ID="$(run_psql "select id from app_public.group_metric_certifications where group_exercise_id='${GX}'
    and member_user_id='${ATHLETE_UID}' and set_id='${T}-ATHLETE-set' and metric='volume' and ended_at is null;")"
  R_ID="$(run_psql "select id from app_public.group_metric_certifications where group_exercise_id='${GX}'
    and member_user_id='${ATHLETE_UID}' and set_id='${T}-ATHLETE-set' and metric='e1rm' and ended_at is null;")"
  V_AUDIT="$(audit "${V_ID}")"; R_AUDIT="$(audit "${R_ID}")"
  drain 'publish paired certification'
}
pair_audit() {
  [[ "$(audit "${V_ID}")" == "${V_AUDIT}" && "$(audit "${R_ID}")" == "${R_AUDIT}" ]] || fail "$1: original audit changed"
}
retained() {
  pair_audit "$1"
  expect_sql "$1 keeps both projections active" "select bool_and(ended_at is null) from app_public.group_metric_certifications where id in ('${V_ID}','${R_ID}');" t
  for metric in volume e1rm; do
    board "${metric}" true
    id="${V_PUBLIC}"; [[ "${metric}" == volume ]] || id="${R_PUBLIC}"
    check "$1 restores exact witness on current Certified board" 'any(.entries[];.member.user_id==$u and .certification.certification_id==$id)' --arg u "${ATHLETE_UID}" --arg id "${id}"
  done
}
ended() {
  pair_audit "$1"
  expect_sql "$1 ends both bound projections" "select bool_and(ended_at is not null and end_reason='voided')
    from app_public.group_metric_certifications where id in ('${V_ID}','${R_ID}');" t
  for metric in volume e1rm; do
    id="${V_PUBLIC}"; [[ "${metric}" == volume ]] || id="${R_PUBLIC}"
    rpc4 "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${GID}" --arg c "${id}" --arg m "${metric}" \
      '{p_group_id:$g,p_certification_id:$c,p_metric:$m}')"
    expect_ok 'ended safe metadata'; assert_wire isCompetitionCertificationResultWire
    check 'public terminal state is generic and same ID' '.certification.certification_id==$id and .certification.end_reason=="voided"' --arg id "${id}"
    board "${metric}" true; check 'ended projection no longer Certified' 'all(.entries[];.certification.certification_id!=$id)' --arg id "${id}"
  done
}
reading() { next_cuam; push "${ATHLETE_TOKEN}" "$1" "$(e_reading "$2" "$3" "$4" "${5:-null}")"; }
MAIN_READING="${T}-ATHLETE-reading"
pair
for enabled in false true false true; do policy "${enabled}"; drain 'rule-only switch'; retained "switch ${enabled}"; done
for c in 0 0.5 1; do update_rules "${c}"; drain contribution; retained "contribution ${c}"; done
for mode in per_side_load total_load; do update_rules 1 "${mode}"; drain 'target distribution'; retained "target ${mode}"; done
for mode in per_side_load total_load; do
  next_cuam; push "${ATHLETE_TOKEN}" 'source distribution, private personal contribution is irrelevant' \
    "$(e_def "${T}-ATHLETE-def" 'Pull-up' "${CUAM}" "${mode}" | jq '.fields.bodyweight_contribution=0.25')"
  drain 'source distribution'; retained "source ${mode}"
done
for metric in volume e1rm; do
  board "${metric}"; check 'source restored to normalized units' 'all(.entries[];.unit=="percent_bw_reps" or .unit=="percent_bw")'
done
reading future "${T}-future" "$((START+1))" 88; drain future; retained future
reading invalid "${T}-invalid" "${START}" 0; drain invalid; retained invalid
reading losing "${T}-losing" "$((START-1000))" 75; drain losing; retained losing
reading noop "${MAIN_READING}" "${START}" 90; drain noop; retained noop
reading coalesced-first "${MAIN_READING}" "${START}" 91
reading coalesced-restored "${MAIN_READING}" "${START}" 90
drain coalesced; retained 'coalesced unchanged tuple'
reading value "${MAIN_READING}" "${START}" 91; drain value; ended value
expect_sql 'raw Weight witness ignores dependent correction' "select ended_at is null from app_public.group_metric_certifications where id='${WEIGHT_CERT}';" t
reading restored "${MAIN_READING}" "${START}" 90; drain restored; ended 'restoration never reopens'
pair
reading date "${MAIN_READING}" "$((START-1))" 90; drain date; ended 'date changed with same kg'
pair
reading future-date "${MAIN_READING}" "$((START+100))" 90; drain 'date moved beyond session'; ended 'date leaves session interval'
reading restore-date "${MAIN_READING}" "$((START-1))" 90; drain 'restore date'; ended 'date restoration remains terminal'
pair
reading fallback "${T}-fallback" "$((START-100))" 85; drain 'losing fallback'; retained 'losing fallback'
reading invalid-selected "${MAIN_READING}" "$((START-1))" 0; drain 'invalid selected reading'; ended 'invalid selected input falls back'
reading valid-restored "${MAIN_READING}" "$((START-1))" 90; drain 'valid input restored'; ended 'valid restoration stays terminal'
pair
reading deletion "${MAIN_READING}" "$((START-1))" 90 "${CUAM}"; drain deletion; ended 'deletion selects fallback'
pair
reading restored-winner "${MAIN_READING}" "$((START-1))" 90; drain 'restored winner'; ended 'restoration changes selected tuple'
pair
reading winning-backdate "${T}-backdated" "${START}" 90; drain 'winning backdate'; ended 'same-score new dependency'
pair
reading equal-time-winner "a-${T}" "${START}" 90; drain 'equal-time winner'; ended 'binary tie winner with equal score'
pair
reading equal-time-loser "z-${T}" "${START}" 90; drain 'equal-time loser'; retained 'losing equal-time ID'
# Drop every valid applicable candidate in one Sync transaction: missing input
# omits All and ends bound Certified, rather than substituting kg or zero.
next_cuam
push "${ATHLETE_TOKEN}" 'delete all applicable context' \
  "$(e_reading "${MAIN_READING}" "$((START-1))" 90 "${CUAM}")" \
  "$(e_reading "${T}-backdated" "${START}" 90 "${CUAM}")" \
  "$(e_reading "a-${T}" "${START}" 90 "${CUAM}")" \
  "$(e_reading "z-${T}" "${START}" 90 "${CUAM}")" \
  "$(e_reading "${T}-fallback" "$((START-100))" 85 "${CUAM}")" \
  "$(e_reading "${T}-losing" "$((START-1000))" 75 "${CUAM}")"
drain missing; ended 'delete without fallback'
for metric in volume e1rm; do board "${metric}"; check 'missing context omits All' 'all(.entries[];.member.user_id!=$u)' --arg u "${ATHLETE_UID}"; done
reading restore-after-missing "${MAIN_READING}" "${START}" 90; drain restore; ended 'restore after missing stays terminal'
pair
for inactive in off zero; do
  if [[ "${inactive}" == off ]]; then policy false; else update_rules 0; fi
  drain "${inactive}"; retained "${inactive}"
  expect_sql "${inactive} source graph never invokes private resolver" "begin;
    create or replace function app_public.session_weight_as_of(p_owner uuid,p_started_at bigint)
    returns jsonb language plpgsql stable security invoker set search_path='' as \$\$ begin raise exception 'private resolver called'; end; \$\$;
    select bool_and(r->>'body_weight_kg' is null and r->>'reading_pin' is null)
      from jsonb_array_elements(app_public.group_metric_eval_source_graph('${GID}','${GX}')->'sets') r;
    rollback;" t
  before="$(run_psql "select count(*) from app_public.group_metric_eval_queue where group_id='${GID}';")"
  reading "${inactive} correction" "${MAIN_READING}" "${START}" 92
  expect_sql "${inactive} reading edit does not enqueue" "select count(*) from app_public.group_metric_eval_queue where group_id='${GID}';" "${before}"
  retained "${inactive} retained pin"
  if [[ "${inactive}" == off ]]; then policy true; else update_rules 1; fi
  drain reactivation; ended "${inactive} intervening correction detected"
  reading baseline "${MAIN_READING}" "${START}" 90; drain baseline; pair
done
pass 'both-metric correction matrix, exact witness audit, rules/distribution retention and inactive lookup isolation'

# Random write tokens must reject both a published rescore and a queued source
# edit, even when the revision stays unchanged. No private hash is sent back.
board e1rm
OLD_TOKEN="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.write_token' <<<"${BODY}")"
REV="$(jq -er .rules.rules_revision <<<"${BODY}")"
reading token-correction "${MAIN_READING}" "${START}" 91; drain token-correction
rpc4 "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${T}-ATHLETE-set" --arg t "${OLD_TOKEN}" --argjson r "${REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'old random token after rescore'
reading reset-token-baseline "${MAIN_READING}" "${START}" 90; drain reset-token-baseline; pair
board e1rm; OLD_TOKEN="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.write_token' <<<"${BODY}")"
next_cuam; push "${ATHLETE_TOKEN}" 'pending raw correction' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 21 5 '' "${CUAM}" null rir_0)"
rpc4 "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${T}-ATHLETE-set" --arg t "${OLD_TOKEN}" --argjson r "${REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'queued correction token'
drain 'raw correction'; ended 'raw correction'
expect_sql 'raw correction also ends original Weight witness' "select end_reason='voided' from app_public.group_metric_certifications where id='${WEIGHT_CERT}';" t
next_cuam; push "${ATHLETE_TOKEN}" 'raw restoration' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 20 5 '' "${CUAM}" null rir_0)"
drain 'raw restoration'; ended 'raw restoration'; pair
next_cuam; push "${ATHLETE_TOKEN}" 'delete raw set' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 20 5 '' "${CUAM}" "${CUAM}" rir_0)"
drain 'raw deletion'; ended 'raw deletion'
next_cuam; push "${ATHLETE_TOKEN}" 'restore raw set' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 20 5 '' "${CUAM}" null rir_0)"
drain 'raw set restoration'; ended 'raw set restoration'
# Scores that round to the same six-decimal display must still rank exactly.
next_cuam; push "${RIVAL_TOKEN}" 'precision rival' "$(e_reading "${T}-RIVAL-reading" "${START}" 90)" \
  "$(e_set "${T}-RIVAL-set" "${T}-RIVAL-se" 0 20.000000001 5 '' "${CUAM}" null rir_0)"
drain precision
board volume
check 'full precision ranks unequal values ahead of UUID/time tie breakers' \
  '(.entries[]|select(.member.user_id==$r)|.rank==1) and
   ((.entries[]|select(.member.user_id==$r)|.value)>(.entries[]|select(.member.user_id==$a)|.value)) and
   ((.entries[]|select(.member.user_id==$r)|(.value*1000000|round))==(.entries[]|select(.member.user_id==$a)|(.value*1000000|round)))' \
  --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}"
for weight in 0 ''; do
  next_cuam; push "${ATHLETE_TOKEN}" 'unweighted normalized performed set' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 "${weight}" 5 '' "${CUAM}" null rir_0)"
  drain unweighted; board volume; check 'unweighted bodyweight Volume is eligible' 'any(.entries[];.member.user_id==$u and .value==500)' --arg u "${ATHLETE_UID}"
done
pair
# Manual lifecycle permissions and original IDs stay exact through the safe API.
rpc4 "${RIVAL_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${V_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"; expect_error FORBIDDEN 'non-witness withdrawal'
rpc4 "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${V_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"; expect_ok 'witness withdrawal'; assert_wire isCompetitionCertificationResultWire
check 'safe withdrawal metadata' '.certification.certification_id==$c and .certification.end_reason=="withdrawn"' --arg c "${V_PUBLIC}"
rpc4 "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${R_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:"cancel"}')"; expect_ok 'admin cancellation'; assert_wire isCompetitionCertificationResultWire
check 'safe cancellation metadata' '.certification.certification_id==$c and .certification.end_reason=="cancelled"' --arg c "${R_PUBLIC}"
drain 'manual certification ends'
# A reused old public legacy ID closes every attached projection and original
# witness, without changing its observed kg audit.
rpc4 "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${LEGACY_CERT}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"; expect_ok 'legacy alias withdrawal'; assert_wire isCompetitionCertificationResultWire
expect_sql 'legacy withdrawal closes root and both active projections' "select
  (select end_reason='withdrawn' from app_public.group_certifications where id='${LEGACY_CERT}') and
  (select bool_and(ended_at is not null) from app_public.group_metric_certifications where legacy_certification_id='${LEGACY_CERT}');" t
pass 'stale random tokens, raw correction/deletion, full-precision ranking, unweighted eligibility and manual witness lifecycle'

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

# Publication rejects stale claim, generation, source token and protocol before
# replacing any entries. Expired metric leases remain reclaimable.
expect_sql 'protocol-4 publication fences and lease reclaim' "begin;
  do \$\$ declare q app_public.group_metric_eval_queue; graph jsonb; evaluation jsonb; before_rows jsonb; result jsonb; variant text;
  begin
    perform app_public.group_metric_eval_enqueue('${GID}','${GX}','set');
    select * into strict q from app_public.group_metric_eval_queue where group_exercise_id='${GX}';
    q.claim_id:=gen_random_uuid();
    graph:=app_public.group_metric_eval_source_graph('${GID}','${GX}');
    evaluation:=jsonb_build_object('contract_version',4,'group_id','${GID}','group_exercise_id','${GX}',
      'rules_revision',graph->'rules'->'rules_revision','source_token',graph->'source_token','scores','[]'::jsonb);
    select jsonb_agg(to_jsonb(e) order by member_user_id,metric,certified) into before_rows
      from app_public.group_metric_board_entries e where group_exercise_id='${GX}';
    foreach variant in array array['claim','generation','source','protocol'] loop
      update app_public.group_metric_eval_queue set claim_id=q.claim_id,claimed_until=now()+interval '1 minute' where id=q.id;
      result:=app_public.group_metric_eval_publish(q.id,case when variant='generation' then q.generation-1 else q.generation end,
        case when variant='claim' then gen_random_uuid() else q.claim_id end,
        evaluation||case variant when 'source' then '{\"source_token\":\"stale\"}'::jsonb
          when 'protocol' then '{\"contract_version\":3}'::jsonb else '{}'::jsonb end);
      if (result->>'completed')::boolean or before_rows is distinct from
        (select jsonb_agg(to_jsonb(e) order by member_user_id,metric,certified) from app_public.group_metric_board_entries e where group_exercise_id='${GX}') then
        raise exception 'stale % publication changed entries',variant;
      end if;
    end loop;
    update app_public.group_metric_eval_queue set claim_id=q.claim_id,claimed_until=now()-interval '1 second' where id=q.id;
    if not exists(select 1 from jsonb_array_elements(app_public.group_metric_eval_claim(20)->'jobs') j where (j->>'job_id')::bigint=q.id) then
      raise exception 'expired metric lease not reclaimed';
    end if;
  end; \$\$;
  select true; rollback;" t
# A real publication fault rolls back the comparison, while Sync and an
# independent certification commit and the job remains retryable/sanitized.
run_psql "alter table app_public.group_metric_board_entries add constraint cp_publication_fault
  check(group_exercise_id<>'${GX}'::uuid) not valid;" >/dev/null
next_cuam; push "${ATHLETE_TOKEN}" 'personal Sync commits under publication fault' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 '' 6 '' "${CUAM}" null rir_0)"
rest GET "${ATHLETE_TOKEN}" exercise_sets "select=reps_value&id=eq.${T}-ATHLETE-set"; expect_ok 'owner read after fault'; check 'personal write committed' '.[0].reps_value=="6"'
drain 'injected publication fault' 1
expect_sql 'metric job retained with sanitized SQLSTATE and retry budget' "select attempts=1 and last_sqlstate='23514' and claim_id is null
  from app_public.group_metric_eval_queue where group_exercise_id='${GX}';" t
RIVAL_NEW_CERT="$(certify "${RIVAL_UID}" "${T}-RIVAL-set" e1rm)"
expect_sql 'certification committed independently of failed publication' "select ended_at is null from app_public.group_metric_certifications where id='${RIVAL_NEW_CERT}';" t
run_psql "alter table app_public.group_metric_board_entries drop constraint cp_publication_fault;
  update app_public.group_metric_eval_queue set available_at=now() where group_exercise_id='${GX}';" >/dev/null
next_cuam; push "${ATHLETE_TOKEN}" 'restore raw reps before retry' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 '' 5 '' "${CUAM}" null rir_0)"
drain retry
board e1rm true; check 'retried publication includes committed witness' 'any(.entries[];.certification.certification_id==$c)' --arg c "${RIVAL_NEW_CERT}"
expect_sql 'publication log contains only sanitized identifiers/SQLSTATE' "select bool_and(
  (select array_agg(k order by k) from jsonb_object_keys(context) k)=array['group_exercise_id','group_id','job_id','kind','sqlstate'])
  from public.app_logs where event='group.eval_failed' and context->>'group_exercise_id'='${GX}';" t
pass 'activation fence, metric stale-result/lease fences and publication/Sync/certification failure isolation'

COMPLETED=1
pass 'competition publication vectors passed'
