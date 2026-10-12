#!/usr/bin/env bash
# groups-competitions.sh — group competitions (protocol 4) on an active stack:
# actual Sync/Edge publication, reader and write authorization, the contract
# header, payload privacy with bodyweight calculations enabled, the both-metric
# correction matrix, write tokens, publication fences and fault isolation, the
# week summary's record values, and stored protocol-3-era history read through
# the protocol-4 readers (an SQL-seeded fixture).
#
# Contract: docs/specs/tech/group-competition-contract.md.
# Direct-drain mode: the kick URL is unset and the sweep paused for the run,
# both restored on exit. Hermetic: per-run users, deleted on exit with
# everything they own.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL=groups-competitions
FIXTURE_EMAIL_PREFIX=groups-competition
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done
load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1
psql_session_start

RUN_TAG="$(date +%s)-$$-${RANDOM}"
PASSWORD="Competition!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RUN_USER_IDS=()
FAULT_CONSTRAINT=cp_publication_fault
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"
set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

WIRE_PID=""
WIRE_DIR="$(mktemp -d)"
MODE_RACE_DIR=""
MODE_WRITER_PID=""
MODE_CERT_PID=""
cleanup() {
  run_psql "set client_min_messages = warning;
            alter table app_public.group_metric_board_entries drop constraint if exists ${FAULT_CONSTRAINT};
            alter table app_public.group_metric_certifications drop constraint if exists cp_source_mode_fault;
            alter table app_public.group_certifications drop constraint if exists cp_legacy_mode_fault;
            alter table app_public.group_source_mode_generations drop constraint if exists cp_mode_marker_fault;" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event like 'group.%'
         and (user_id in (${ids})
              -- Comparison-job rows carry no user; they name the group.
              or context ->> 'group_id' in (select id::text from app_public.groups where created_by in (${ids})));
      delete from app_public.group_eval_queue where member_user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;" >/dev/null
}
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -n "${MODE_RACE_DIR}" ]]; then
    exec 9>&-
    run_psql_once "select pg_terminate_backend(pid) from pg_stat_activity
      where application_name in ('mode-cert-${RUN_TAG}','mode-write-${RUN_TAG}');" >/dev/null 2>&1 || true
    [[ -z "${MODE_CERT_PID}" ]] || wait "${MODE_CERT_PID}" 2>/dev/null || true
    [[ -z "${MODE_WRITER_PID}" ]] || wait "${MODE_WRITER_PID}" 2>/dev/null || true
    rm -rf "${MODE_RACE_DIR}"
  fi
  if [[ -n "${WIRE_PID}" ]]; then exec 5>&- 6<&-; kill "${WIRE_PID}" 2>/dev/null || true; fi
  rm -rf "${WIRE_DIR}"
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
  psql_session_stop
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

# Direct-drain mode for the run, with the sweep paused so it never races a
# manual drain; the exit trap restores both.
set_kick_url ""
set_sweep_active false

# rpc_with_contract <contract-header|""> <bearer> <function> <json-body>: an rpc
# that sends another x-boga-group-contract value, or none.
rpc_with_contract() {
  local -a contract=()
  [[ -z "$1" ]] || contract=(-H "x-boga-group-contract: $1")
  http_call -X POST -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer $2" ${contract[@]+"${contract[@]}"} \
    -H "Content-Type: application/json" -H "Content-Profile: app_public" --data "$4" "${API_URL}/rest/v1/rpc/$3"
}
# One decoder process for the whole body (a node start per call was ~70 ms, over
# 200 calls). Each call writes "<guard>\t<compact JSON>" and blocks on its own
# verdict line, so a failure stops the body at the call that caused it; a dead
# decoder reads as EOF, which fails too. Its fds are 5/6 (the psql session
# holds 7/8).
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
exec 5>"${WIRE_DIR}/in" 6<"${WIRE_DIR}/out"
# wire_verdict <guard>: the decoder's verdict on BODY, run in a subshell that
# ignores SIGPIPE, so a decoder that has exited fails the write instead of
# killing bash. The write gets its own subshell so a failed write's buffered
# line cannot leak into the verdict.
wire_verdict() {
  local verdict="" wrote=0
  trap '' PIPE
  (printf '%s\t%s\n' "$1" "${BODY//$'\n'/}") >&5 2>/dev/null && wrote=1
  [[ ${wrote} -eq 1 ]] && read -r verdict <&6 || true
  printf '%s' "${verdict:-decoder exited}"
}
assert_wire() {
  local verdict
  verdict="$(wire_verdict "$1")"
  [[ "${verdict}" == ok ]] || fail "actual $1 decoder: ${verdict}"
}
# Canary: the decoder must be able to say no, or every assert_wire is a no-op.
BODY='{}'; [[ "$(wire_verdict isCompetitionBoardWire)" == 'rejected {}' ]] || fail 'decoder accepted an empty board'
BODY=''
expect_sql() { local actual; actual="$(run_psql "$2")"; [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '$actual'"; }
drain() {
  eval_drain
  expect_ok "drain $1"; check "drain $1" '.failed==$n' --argjson n "${2:-0}"
}
now_ms() { run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;"; }
e_reading() { jq -nc --arg id "$1" --argjson at "$2" --argjson kg "$3" --argjson c "${CUAM}" --argjson del "${4:-null}" \
  '{type:"body_weight_measurements",id:$id,client_updated_at_ms:$c,fields:{weight_kg:$kg,measured_at:$at,created_at:$c,updated_at:$c,deleted_at:$del}}'; }
# comparison <name> <contribution> <default metric>: a protocol-4 comparison in G; echoes its id.
comparison() {
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GID}" --arg n "$1" --argjson c "$2" --arg m "$3" \
    '{p_group_id:$g,p_name:$n,p_load_input_mode:"total_load",p_source_exercise_id:null,p_bodyweight_contribution:$c,p_default_metric:$m}')"
  expect_ok "comparison $1"; assert_wire isCompetitionExerciseWriteWire; jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
policy() {
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${GID}" --argjson e "$1" \
    '{p_group_id:$g,p_name:"Competition fixture",p_description:null,p_bodyweight_calculations_enabled:$e}')"
  expect_ok 'group policy'
}
board() {
  rpc "${OWNER_TOKEN}" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$1" --argjson c "${2:-false}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
  expect_ok 'competition board'; assert_wire isCompetitionBoardWire
}
certify() {
  local member="$1" set="$2" metric="$3" token rev
  board "${metric}"
  token="$(jq -er --arg u "${member}" --arg s "${set}" '.entries[]|select(.member.user_id==$u and .performance.set_id==$s)|.write_token' <<<"${BODY}")"
  rev="$(jq -er .rules.rules_revision <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${member}" --arg s "${set}" \
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

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: fixture"
# =============================================================================

# Six users: the owner; three members with bodyweight-normalized pull-ups (the
# athlete and the rival with a reading, `never` with none); an outsider; and a
# former member who joined and left. GX normalizes (contribution 1, default
# Volume); ZERO_GX is an ordinary comparison the athlete's pull-up also links to.
provision OWNER owner; provision ATHLETE athlete; provision RIVAL rival; provision NEVER never; provision OUTSIDER outsider; provision FROZEN frozen
for prefix in OWNER ATHLETE RIVAL NEVER OUTSIDER FROZEN; do uid="${prefix}_UID"; set_username "${!uid}" "cp_${prefix}_${RUN_TAG//-/_}"; done
rpc "${OWNER_TOKEN}" group_create '{"p_name":"Competition fixture","p_description":null}'; expect_ok 'create'
GID="$(jq -er .group_id <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'invite'; INVITE="$(jq -er .code <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${NEVER_TOKEN}" "${FROZEN_TOKEN}"; do rpc "${token}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"; expect_ok 'join'; done
GX="$(comparison 'Pull-up' 1 volume)"; MAIN_GX="${GX}"
ZERO_GX="$(comparison 'Ordinary' 0 e1rm)"
ARCHIVE_GX="$(comparison 'Archived' 0 e1rm)"
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${ARCHIVE_GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:true}')"; expect_ok 'archive'; assert_wire isCompetitionExerciseWriteWire
CUAM="$(now_ms)"; START=$((CUAM+1000)); T="cp-${RUN_TAG}"
for prefix in ATHLETE RIVAL NEVER; do
  token="${prefix}_TOKEN"; kg=null
  [[ "${prefix}" != ATHLETE ]] || kg=90; [[ "${prefix}" != RIVAL ]] || kg=120
  next_cuam
  push "${!token}" 'shared source' "$(e_def "${T}-${prefix}-def" 'Pull-up' "${CUAM}")" \
    "$(e_link "${T}-${prefix}-def" "${GID}" "${GX}" "${CUAM}")" \
    "$(e_session "${T}-${prefix}" "${START}" completed "$((START+30000))" 30 null "${CUAM}")" \
    "$(e_se "${T}-${prefix}-se" "${T}-${prefix}" "${T}-${prefix}-def" 0 'Pull-up' "${CUAM}")" \
    "$(e_set "${T}-${prefix}-set" "${T}-${prefix}-se" 0 20 5 '' "${CUAM}" null rir_0)"
  if [[ "${kg}" != null ]]; then next_cuam; push "${!token}" 'reading' "$(e_reading "${T}-${prefix}-reading" "${START}" "${kg}")"; fi
done
next_cuam
push "${ATHLETE_TOKEN}" 'same-group secondary comparison and permitted ordinary context' \
  "$(e_link "${T}-ATHLETE-def" "${GID}" "${ZERO_GX}" "${CUAM}" null "${T}-secondary-link")" \
  "$(e_def "${T}-ordinary-def" 'Ordinary unrelated' "${CUAM}")" \
  "$(e_se "${T}-ordinary-se" "${T}-ATHLETE" "${T}-ordinary-def" 1 'Ordinary unrelated' "${CUAM}")" \
  "$(e_set "${T}-ordinary-set" "${T}-ordinary-se" 0 50 8 '' "${CUAM}" null rir_0)"
drain 'ordinary baseline'
rpc "${FROZEN_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'former member leaves'
# Turning bodyweight calculations on changes GX's rules: one rules_change event.
policy true; drain 'bodyweight calculations on'
rpc "${OWNER_TOKEN}" group_competition_contract "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok contract
# No client decodes the contract; its shape stays frozen and activation_state reads active.
check 'contract shape' '. == {contract_version:4,activation_state:"active",cache_version:5,metrics:["volume","e1rm"],
  ordinary_units:{volume:"kg_reps",e1rm:"kg"},normalized_units:{volume:"percent_bw_reps",e1rm:"percent_bw"},default_metric:"e1rm"}'
board volume; check 'best single-set normalized Volume' \
  '.state=="ready" and .rules.default_metric=="volume" and .entry_count==2 and all(.entries[];.unit=="percent_bw_reps" and .performance.visibility=="normalized")'
check 'normalized values use the private as-of reading' \
  '(.entries[]|select(.member.user_id==$a)|(.value-611.1111111111111|fabs)<0.000000001) and
   (.entries[]|select(.member.user_id==$r)|(.value-583.3333333333334|fabs)<0.000000001)' --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}"
pass 'fixture: comparisons, readings, normalized Volume from the private as-of reading'

# =============================================================================
echo "[${LANE_LABEL}] header, authorization, private helpers"
# =============================================================================

# Every group RPC requires the current contract header.
for protocol in '' 3 invalid 04 4.0; do
  rpc_with_contract "${protocol}" "${OWNER_TOKEN}" group_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"
  expect_error UPDATE_REQUIRED "group read with contract header '${protocol}'"
done
rpc "${OUTSIDER_TOKEN}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_error NOT_FOUND outsider
OUTSIDER_ERROR="$(jq -er .message <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_competition_exercise_list "$(jq -nc --arg g "$(run_psql "select gen_random_uuid();")" '{p_group_id:$g}')"
expect_error NOT_FOUND 'nonexistent group'
[[ "$(jq -er .message <<<"${BODY}")" == "${OUTSIDER_ERROR}" ]] || fail 'a nonexistent group must read exactly like an outsider (no existence disclosure)'
rpc "$(mint_token "${OWNER_TOKEN}" competition-agent)" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_error AGENT_FORBIDDEN OAuth
rpc "${ANON_KEY}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; [[ ! "${STATUS}" =~ ^2 ]] || fail 'anonymous data read'
rest GET "${OWNER_TOKEN}" group_metric_set_scores 'select=*'; [[ ! "${STATUS}" =~ ^2 ]] || fail 'direct score table exposed'
expect_sql 'private helpers are not callable by clients/service' \
  "select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public' and
      p.proname in ('group_competition_event_json','group_competition_history_value','group_competition_session_json',
        'group_competition_session_record_boards');" t
pass 'contract header, private helper/direct table and app authorization denial'

# Protocol 4 is the only group representation: no old public RPC (legacy kg
# boards, protocol 3, *_v2), private pre-competition body or activation object
# exists, so none can be granted or reached with a forged header.
expect_sql 'no pre-V4 group function or activation object exists' \
  "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app_public' and (p.proname like '%\\_pre\\_competition' or p.proname like 'group\\_competition\\_activ%'
        or p.proname in ('group_board','group_board_podiums','group_board_history','group_certify',
          'group_certification_withdraw','group_certification_cancel','group_exercise_list','group_exercise_create',
          'group_exercise_update','group_exercise_archive','group_exercise_unarchive','group_exercise_list_v2',
          'group_exercise_create_v2','group_exercise_update_v2','group_exercise_archive_v2','group_exercise_unarchive_v2',
          'group_metric_board','group_metric_podiums','group_metric_history','group_metric_revisions','group_metric_certify',
          'group_metric_certification_get','group_metric_certification_end','group_stream','group_stream_v2',
          'group_session_detail','group_week_summary','group_metric_is_legacy','group_metric_eval_source_graph_v3')))
    + (select count(*) from pg_class where relnamespace='app_public'::regnamespace and relname='group_competition_activation');" 0
pass 'no pre-V4 group function or activation object'

while IFS=$'\t' read -r name args; do
  rpc "${OUTSIDER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "outsider ${name}"
  rpc "$(mint_token "${OWNER_TOKEN}" competition-agent)" "${name}" "${args}"; expect_error AGENT_FORBIDDEN "OAuth ${name}"
  rpc "${ANON_KEY}" "${name}" "${args}"; [[ ! "${STATUS}" =~ ^2 ]] || fail "anonymous ${name}"
done < <(run_psql "select p.proname||E'\\t'||coalesce((select jsonb_object_agg(a.name,case format_type(p.proargtypes[a.n-1],null)
  when 'uuid' then to_jsonb('${GID}'::text) when 'text' then to_jsonb('sample'::text) when 'boolean' then 'true'::jsonb
  when 'jsonb' then 'null'::jsonb else '1'::jsonb end)::text from unnest(p.proargnames) with ordinality a(name,n)), '{}')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_public'
    and p.proname like 'group_competition_%' and has_function_privilege('authenticated',p.oid,'execute') order by p.proname;")
rpc "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${OUTSIDER_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_error NOT_FOUND 'unshared member/session pair'
rpc "${OWNER_TOKEN}" group_competition_session_records "$(jq -nc --arg g "${GID}" --arg u "${OUTSIDER_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_error NOT_FOUND 'unshared member/session pair records'
pass 'every current reader/write denies anonymous, OAuth and outsider before payload validation'

rpc "${OWNER_TOKEN}" group_competition_exercise_list "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok catalog; assert_wire isCompetitionExerciseListWire
rpc "${OWNER_TOKEN}" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_certified:false}')"; expect_ok podiums; assert_wire isCompetitionPodiumsWire
rpc "${OWNER_TOKEN}" group_competition_revisions "$(jq -nc --arg g "${GID}" --arg x "${GX}" '{p_group_id:$g,p_group_exercise_id:$x}')"; expect_ok revisions; assert_wire isCompetitionRevisionsWire
REVISION="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
for metric in volume e1rm; do
  rpc "${OWNER_TOKEN}" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "${metric}" --argjson r "${REVISION}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:false,p_revision:$r}')"; expect_ok history; assert_wire isCompetitionHistoryWire
  check 'enabled historical absolute scores unavailable' 'all(.events[].values[]; .value==null or (.unit=="percent_bw" or .unit=="percent_bw_reps"))'
done
for group in "\"${GID}\"" null; do
  rpc "${OWNER_TOKEN}" group_competition_stream "{\"p_group_id\":${group},\"p_limit\":50}"; expect_ok stream; assert_wire isCompetitionStreamWire
  check 'enabled stream has no private reading/hash/audit and normalized sessions have no kg' \
    '([paths|select(.[-1]|IN("weight_kg","body_weight_kg","fingerprint","write_fingerprint","observed_value","reading_pin"))]|length==0)
     and all(.items[]|select(.kind=="session")|.session.exercises[]|select(.visibility=="normalized");all(.sets[];has("weight_value")|not))
     and all(.items[]|select(.kind=="competition")|.event|select(.visibility=="normalized")|.values[];.value==null or (.unit=="percent_bw" or .unit=="percent_bw_reps"))'
  check 'stream omits rules changes' 'all(.items[]|select(.kind=="competition"); .event.kind!="rules_change")'
done
expect_sql 'rules changes the stream omits still exist' "select count(*)>0 from app_public.group_events where group_id='${GID}' and kind='rules_change';" t
rpc "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${ATHLETE_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"; expect_ok session; assert_wire isCompetitionSessionDetailWire
check 'full session redacts normalized sets, retains unrelated ordinary context and excludes subtraction total' \
  'all(.session.exercises[]|select(.visibility=="normalized");all(.sets[];has("weight_value")|not))
   and any(.session.exercises[]|select(.visibility=="ordinary")|.sets[];.weight_value=="50")
   and (.session|has("volume_kg_reps")|not)'
rpc "${OWNER_TOKEN}" group_competition_week_summary "$(jq -nc --arg g "${GID}" --argjson s "$((START-1000))" --argjson e "$((START+86400000))" \
  '{p_group_id:$g,p_window_start_ms:$s,p_window_end_ms:$e}')"; expect_ok week; assert_wire isCompetitionWeekSummaryWire
check 'week scores redacted, counts retained, no subtraction total' '.members|length==4'
rpc "${OWNER_TOKEN}" group_competition_period_totals "$(jq -nc --arg g "${GID}" --argjson s "$((START-1000))" --argjson e "$((START+86400000))" \
  '{p_group_id:$g,p_windows:[{start_ms:$s,end_ms:$e}]}')"; expect_ok period; assert_wire isCompetitionPeriodTotalsWire
check 'period totals carry counts only: no kg, volume or score' \
  '([paths|select(.[-1]|IN("weight_kg","weight_value","volume_kg_reps","value","unit"))]|length==0) and (.periods[0].members|length==4)'
GX="${ZERO_GX}"; board e1rm; check 'ordinary counterpart from normalized source cannot bypass same-group boundary' '.entries==[]'
GX="${MAIN_GX}"
pass 'actual catalog/podium/revision/history/stream/session/week/period payloads decode with enabled privacy'

# A published percentage remains joinable by set ID while source work is
# queued. Moving that source to an ordinary definition cannot reveal its kg.
next_cuam
push "${RIVAL_TOKEN}" 'source identity move before publication' \
  "$(e_def "${T}-moved-def" 'Moved ordinary' "${CUAM}")" \
  "$(e_se "${T}-RIVAL-se" "${T}-RIVAL" "${T}-moved-def" 0 'Moved ordinary' "${CUAM}")"
rpc "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${RIVAL_UID}" --arg s "${T}-RIVAL" \
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
rpc "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${GID}" --arg u "${ATHLETE_UID}" --arg s "${T}-ATHLETE" \
  '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"
expect_ok 'unknown exercise session'; assert_wire isCompetitionSessionDetailWire
check 'unknown exercise retains reps and omits kg' 'any(.session.exercises[]; .exercise_definition_id==null and .load_input_mode==null and
  .visibility=="normalized" and .sets[0].reps_value=="7" and (.sets[0]|has("weight_value")|not))'
pass 'queued identity and unbound exercise privacy with permitted reps retained'

# Run every selected-reading transition against BOTH dependent metrics. Public
# IDs and immutable observed audit are checked separately from private bindings.
update_rules() {
  local rev; rev="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
  rpc "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${GID}" --arg x "${GX}" --argjson r "${rev}" \
    --argjson c "$1" --arg m "${2:-total_load}" '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:$r,p_name:"Pull-up",
      p_load_input_mode:$m,p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'competition rule update'; assert_wire isCompetitionExerciseWriteWire
}
pair() {
  local set="${1:-${T}-ATHLETE-set}"
  V_PUBLIC="$(certify "${ATHLETE_UID}" "${set}" volume)"
  R_PUBLIC="$(certify "${ATHLETE_UID}" "${set}" e1rm)"
  V_ID="$(run_psql "select id from app_public.group_metric_certifications where group_exercise_id='${GX}'
    and member_user_id='${ATHLETE_UID}' and set_id='${set}' and metric='volume' and ended_at is null;")"
  R_ID="$(run_psql "select id from app_public.group_metric_certifications where group_exercise_id='${GX}'
    and member_user_id='${ATHLETE_UID}' and set_id='${set}' and metric='e1rm' and ended_at is null;")"
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
    rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${GID}" --arg c "${id}" --arg m "${metric}" \
      '{p_group_id:$g,p_certification_id:$c,p_metric:$m}')"
    expect_ok 'ended safe metadata'; assert_wire isCompetitionCertificationResultWire
    check 'public terminal state is generic and same ID' '.certification.certification_id==$id and .certification.end_reason=="voided"' --arg id "${id}"
    board "${metric}" true; check 'ended projection no longer Certified' 'all(.entries[];.certification.certification_id!=$id)' --arg id "${id}"
  done
}
reading() { next_cuam; push "${ATHLETE_TOKEN}" "$1" "$(e_reading "$2" "$3" "$4" "${5:-null}")"; }
MAIN_READING="${T}-ATHLETE-reading"
pair
for enabled in false true; do policy "${enabled}"; drain 'rule-only switch'; retained "switch ${enabled}"; done
for c in 0 0.5 1; do update_rules "${c}"; drain contribution; retained "contribution ${c}"; done
for mode in per_side_load total_load; do update_rules 1 "${mode}"; drain 'target distribution'; retained "target ${mode}"; done
next_cuam; push "${ATHLETE_TOKEN}" 'private contribution and a no-op source mode preserve the witness' \
  "$(e_def "${T}-ATHLETE-def" 'Pull-up' "${CUAM}" total_load | jq '.fields.bodyweight_contribution=0.25')"
drain 'private contribution'; retained 'private contribution/no-op mode'
for mode in per_side_load total_load; do
  board e1rm; MODE_TOKEN="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.write_token' <<<"${BODY}")"
  MODE_REV="$(jq -er .rules.rules_revision <<<"${BODY}")"
  next_cuam; push "${ATHLETE_TOKEN}" 'source distribution corrects the witnessed interpretation' \
    "$(e_def "${T}-ATHLETE-def" 'Pull-up' "${CUAM}" "${mode}" | jq '.fields.bodyweight_contribution=0.25')"
  ended "immediate source ${mode}"
  rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
    --arg s "${T}-ATHLETE-set" --arg t "${MODE_TOKEN}" --argjson r "${MODE_REV}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
  expect_error CONFLICT 'the previous-mode token cannot certify'
  drain 'source distribution'
  OLD_WITNESS="${V_PUBLIC}"; pair
  [[ "${V_PUBLIC}" != "${OLD_WITNESS}" ]] || fail 'a source correction revived its previous witness'
  retained "fresh witness for source ${mode}"
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
rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${T}-ATHLETE-set" --arg t "${OLD_TOKEN}" --argjson r "${REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'old random token after rescore'
reading reset-token-baseline "${MAIN_READING}" "${START}" 90; drain reset-token-baseline; pair
board e1rm; OLD_TOKEN="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.write_token' <<<"${BODY}")"
next_cuam; push "${ATHLETE_TOKEN}" 'pending raw correction' "$(e_set "${T}-ATHLETE-set" "${T}-ATHLETE-se" 0 21 5 '' "${CUAM}" null rir_0)"
rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${T}-ATHLETE-set" --arg t "${OLD_TOKEN}" --argjson r "${REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"e1rm",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'queued correction token'
drain 'raw correction'; ended 'raw correction'
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
rpc "${RIVAL_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${V_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"; expect_error FORBIDDEN 'non-witness withdrawal'
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${V_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"; expect_ok 'witness withdrawal'; assert_wire isCompetitionCertificationResultWire
check 'safe withdrawal metadata' '.certification.certification_id==$c and .certification.end_reason=="withdrawn"' --arg c "${V_PUBLIC}"
# One witness per set: the 1RM projection ended with it.
[[ "${R_PUBLIC}" == "${V_PUBLIC}" ]] || fail 'one public certification id per set'
rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${GID}" --arg c "${R_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm"}')"; expect_ok 'read the 1RM projection'
check 'a withdrawal through Volume ends 1RM too' '.certification.metric=="e1rm" and .certification.end_reason=="withdrawn"'
drain 'manual withdrawal'
pair
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${R_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:"cancel"}')"; expect_ok 'admin cancellation'; assert_wire isCompetitionCertificationResultWire
check 'safe cancellation metadata' '.certification.certification_id==$c and .certification.end_reason=="cancelled"' --arg c "${R_PUBLIC}"
rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${GID}" --arg c "${V_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume"}')"; expect_ok 'read the Volume projection'
check 'a cancellation through 1RM ends Volume too' '.certification.metric=="volume" and .certification.end_reason=="cancelled"'
drain 'manual certification ends'
pass 'stale random tokens, raw correction/deletion, full-precision ranking, unweighted eligibility and manual witness lifecycle'

rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${ARCHIVE_GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:false}')"; expect_ok 'unarchive'; assert_wire isCompetitionExerciseWriteWire
drain unarchive
pass "an archived comparison unarchives and catches up"

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
pass 'metric stale-result/lease fences and publication/Sync/certification failure isolation'

# Week summary: the latest session's records carry only the `record`
# values of the boards they took #1 on, one group record each. On a fresh
# ordinary comparison R's 100 × 5 takes #1 on Volume and 1RM; A's later
# 60 × 12 is A's own record on both, but #1 on Volume only (720 > 500;
# 1RM 84.0 < 116.7).
rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(jq -nc --arg g "${GID}" \
  '{p_group_id:$g,p_name:"Week press",p_load_input_mode:"total_load",p_source_exercise_id:null,p_bodyweight_contribution:0,p_default_metric:"volume"}')"
expect_ok 'week comparison'; WEEK_GX="$(jq -er .exercise.group_exercise_id <<<"${BODY}")"
WEEK_START="$(( $(now_ms) + 1000 ))"
for spec in RIVAL:100:5:0 ATHLETE:60:12:60000; do
  IFS=: read -r prefix w r offset <<<"${spec}"; token="${prefix}_TOKEN"; sid="${T}-week-${prefix}"
  next_cuam
  push "${!token}" 'week record' "$(e_def "${sid}-def" 'Week press' "${CUAM}")" \
    "$(e_link "${sid}-def" "${GID}" "${WEEK_GX}" "${CUAM}")" \
    "$(e_session "${sid}" "$((WEEK_START+offset))" completed "$((WEEK_START+offset+30000))" 30 null "${CUAM}")" \
    "$(e_se "${sid}-se" "${sid}" "${sid}-def" 0 'Week press' "${CUAM}")" \
    "$(e_set "${sid}-set" "${sid}-se" 0 "${w}" "${r}" '' "${CUAM}" null rir_0)"
  drain "week ${prefix}"; drain "week ${prefix} comparison"
done
expect_sql "A's week record lists both boards, #1 on Volume only" \
  "select string_agg((b->>'metric')||'='||(b->>'group_record'),',' order by b->>'metric')
     from app_public.group_events e, jsonb_array_elements(e.payload->'boards') b
    where e.kind='record' and e.set_id='${T}-week-ATHLETE-set';" "e1rm=false,volume=true"
rpc "${OWNER_TOKEN}" group_competition_week_summary "$(jq -nc --arg g "${GID}" --argjson s "$((WEEK_START-1000))" \
  --argjson e "$((WEEK_START+86400000))" '{p_group_id:$g,p_window_start_ms:$s,p_window_end_ms:$e}')"
expect_ok 'week records'; assert_wire isCompetitionWeekSummaryWire
check "the latest session's group records are its #1 boards only" \
  '.latest_completed.session_id==$s and [.latest_completed.group_records[].values[]|select(.role=="record")|.metric]==["volume"]' \
  --arg s "${T}-week-ATHLETE"
pass 'week summary: a record keeps only the record values of the boards it took #1 on'

# Session records: each #1 record of one session with its boards' current
# leaders. R's 100 x 5 still leads 1RM but A's 60 x 12 passed it on Volume;
# A's record took #1 on Volume only and still leads it.
session_records() {
  rpc "${OWNER_TOKEN}" group_competition_session_records "$(jq -nc --arg g "${GID}" --arg u "$1" --arg s "$2" \
    '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"
  expect_ok "session records $2"; assert_wire isCompetitionSessionRecordsWire
}
session_records "${RIVAL_UID}" "${T}-week-RIVAL"
check "R's record: 1RM still held, Volume passed by A, both record values kept" \
  '(.records|length)==1 and (.records[0].event.set_id==$set) and
   ([.records[0].boards[]|[.metric,.leads,.leader.user_id]]==[["e1rm",true,$r],["volume",false,$a]]) and
   ([.records[0].event.values[]|select(.role=="record")|.metric]|sort)==["e1rm","volume"]' \
  --arg set "${T}-week-RIVAL-set" --arg r "${RIVAL_UID}" --arg a "${ATHLETE_UID}"
session_records "${ATHLETE_UID}" "${T}-week-ATHLETE"
check "A's record: only its #1 board, still held" \
  '(.records|length)==1 and ([.records[0].boards[]|[.metric,.leads]]==[["volume",true]]) and
   [.records[0].event.values[]|select(.role=="record")|.metric]==["volume"]'
GX="${WEEK_GX}"; WEEK_CERT="$(certify "${RIVAL_UID}" "${T}-week-RIVAL-set" e1rm)"; GX="${MAIN_GX}"
session_records "${RIVAL_UID}" "${T}-week-RIVAL"
check 'a record carries its live certification and write tokens' \
  '(.records[0].event.record_context.metrics[]|select(.metric=="e1rm")|.certification.certification_id)==$c and
   all(.records[0].event.record_context.metrics[];.write_token|length>0)' --arg c "${WEEK_CERT}"
# R's precision set took #1 on the normalized Pull-up.
session_records "${RIVAL_UID}" "${T}-RIVAL"
check 'enabled-group session records are normalized and expose no absolute counterpart' \
  '(.records|length)>0 and all(.records[].event;.visibility=="normalized") and
   all(.records[].event.values[];.value==null or (.unit=="percent_bw" or .unit=="percent_bw_reps"))'
pass "session records: a session's #1 boards with each board's current leader and live certification"

# =============================================================================
echo "[${LANE_LABEL}] stored pre-protocol-4 history through the protocol-4 readers"
# =============================================================================

# Production keeps every row the earlier representations stored and presents it
# through the protocol-4 readers: legacy and protocol-3 rule revisions
# with their events, legacy certifications with the metric projections and Volume
# witness alias activation gave them, and the frozen scores of a former member
# and of an archived comparison. No current RPC writes such rows, so they are
# inserted as activation left them (triggers off: no live writer made them).
# Group H: the owner, the athlete, and a former member. HX is ordinary
# (contribution 0) at revision 3: 1 is legacy, 2 protocol 3, 3 current.
# HA is an archived comparison at revision 2.
rpc "${OWNER_TOKEN}" group_create '{"p_name":"History fixture","p_description":null}'; expect_ok 'history group'
HG="$(jq -er .group_id <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${HG}" '{p_group_id:$g}')"; expect_ok 'history invite'
H_INVITE="$(jq -er .code <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${FROZEN_TOKEN}"; do rpc "${token}" group_join "$(jq -nc --arg c "${H_INVITE}" '{p_code:$c}')"; expect_ok 'history join'; done
rpc "${FROZEN_TOKEN}" group_leave "$(jq -nc --arg g "${HG}" '{p_group_id:$g}')"; expect_ok 'history former member leaves'
read -r HX HA R1 R2 W1 E1 V1 <<<"$(run_psql "select string_agg(gen_random_uuid()::text, ' ') from generate_series(1, 7);")"
H="${T}-h"
H_AT="$(( START - 86400000 ))"
run_psql "begin;
  set local session_replication_role = replica;
  insert into app_public.group_exercises(id,group_id,name,load_input_mode,created_by,default_metric,
      rules_revision,published_rules_revision,bodyweight_contribution,archived_at)
    values ('${HX}','${HG}','History','total_load','${OWNER_UID}','e1rm',3,3,0,null),
           ('${HA}','${HG}','History archived','total_load','${OWNER_UID}','e1rm',2,2,0,now());
  insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,reason,legacy,created_by,
      published_at,retired_at,representation_version)
    select '${HG}',x.id,r.revision,jsonb_build_object('name',x.name,'rules_revision',r.revision,'load_input_mode','total_load',
        'bodyweight_contribution',0,'bodyweight_calculations_enabled',false,'default_metric',r.metric),
      case when r.revision=1 then 'initial' else 'rules_change' end,r.revision=1,null,
      now()-interval '2 days',case when r.revision<x.rules_revision then now()-interval '1 day' end,r.representation
    from (values ('${HX}'::uuid,'History',3),('${HA}'::uuid,'History archived',2)) x(id,name,rules_revision)
    join (values (1,'e1rm',3),(2,'weight',3),(3,'e1rm',4)) r(revision,metric,representation) on r.revision<=x.rules_revision;
  insert into app_public.group_certifications(id,group_id,group_exercise_id,member_user_id,set_id,session_id,certified_by,
      pinned_fingerprint,pinned_weight_value,pinned_reps_value,weight_kg,reps,e1rm_kg,certified_at)
    values ('${R1}','${HG}','${HX}','${ATHLETE_UID}','${H}-x-set','${H}-x','${OWNER_UID}','legacy-pin','35','5',35,5,40.803877,now()-interval '2 days'),
           ('${R2}','${HG}','${HA}','${ATHLETE_UID}','${H}-a-set','${H}-a','${OWNER_UID}','legacy-pin','35','5',35,5,40.803877,now()-interval '2 days');
  create temp table h_rows(member uuid,membership uuid,exercise uuid,revision bigint,set_id text,metric text,value numeric,unit text,
    certification uuid) on commit drop;
  insert into h_rows
    select m.user_id,m.id,r.exercise,r.revision,r.set_id,r.metric,r.value,r.unit,r.certification
    from (values ('${ATHLETE_UID}'::uuid,'${HX}'::uuid,3,'${H}-x-set','e1rm',40.803877,'kg','${E1}'::uuid),
                 ('${ATHLETE_UID}'::uuid,'${HX}'::uuid,3,'${H}-x-set','volume',175,'kg_reps','${V1}'::uuid),
                 ('${FROZEN_UID}'::uuid,'${HX}'::uuid,3,'${H}-f-set','e1rm',41.969702,'kg',null),
                 ('${ATHLETE_UID}'::uuid,'${HA}'::uuid,2,'${H}-a-set','e1rm',40.803877,'kg',null),
                 ('${FROZEN_UID}'::uuid,'${HA}'::uuid,2,'${H}-g-set','e1rm',41.969702,'kg',null))
      r(member,exercise,revision,set_id,metric,value,unit,certification)
    join app_public.group_memberships m on m.group_id='${HG}' and m.user_id=r.member;
  insert into app_public.group_metric_set_scores(group_id,group_exercise_id,rules_revision,member_user_id,membership_id,set_id,
      session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,achieved_at_ms,exercise_order_index,
      set_order_index,set_created_at_ms,fingerprint,performance)
    select '${HG}',exercise,revision,member,membership,set_id,replace(set_id,'-set',''),replace(set_id,'-set','-se'),
      replace(set_id,'-set','-def'),metric,value,unit,true,${H_AT},0,0,${H_AT},set_id||':'||metric,
      jsonb_build_object('session_id',replace(set_id,'-set',''),'session_exercise_id',replace(set_id,'-set','-se'),
        'exercise_definition_id',replace(set_id,'-set','-def'),'set_id',set_id,'weight_value','35','reps_value','5','reps',5,
        'performance_status',null,'source_load_input_mode','total_load','achieved_at_ms',${H_AT},
        'exercise_order_index',0,'set_order_index',0)
    from h_rows;
  insert into app_public.group_metric_board_entries(group_id,group_exercise_id,rules_revision,member_user_id,membership_id,metric,
      certified,value,unit,set_id,session_id,session_exercise_id,exercise_definition_id,achieved_at_ms,exercise_order_index,
      set_order_index,set_created_at_ms,fingerprint,performance,certification_id)
    select s.group_id,s.group_exercise_id,s.rules_revision,s.member_user_id,s.membership_id,s.metric,c.certified,s.value,s.unit,
      s.set_id,s.session_id,s.session_exercise_id,s.exercise_definition_id,s.achieved_at_ms,0,0,s.set_created_at_ms,s.fingerprint,
      s.performance,case when c.certified then h.certification end
    from app_public.group_metric_set_scores s
    join h_rows h on h.exercise=s.group_exercise_id and h.member=s.member_user_id and h.metric=s.metric
    cross join (values (false),(true)) c(certified)
    where not c.certified or h.certification is not null;
  insert into app_public.group_metric_certifications(id,group_id,group_exercise_id,member_user_id,set_id,session_id,metric,
      observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by,certified_at,current_fingerprint,
      legacy_certification_id,witness_certification_id)
    select id,'${HG}','${HX}','${ATHLETE_UID}','${H}-x-set','${H}-x',metric,1,observed,unit,'legacy-pin',
      (select performance from app_public.group_metric_set_scores where group_exercise_id='${HX}' and set_id='${H}-x-set' limit 1),
      '${OWNER_UID}',now()-interval '2 days','${H}-x-set:'||metric,'${R1}',witness
    from (values ('${W1}'::uuid,'weight',35,'kg',null::uuid),('${E1}'::uuid,'e1rm',40.803877,'kg',null),
                 ('${V1}'::uuid,'volume',null,null,'${W1}'::uuid)) c(id,metric,observed,unit,witness);
  insert into app_public.group_events(group_id,kind,member_user_id,session_id,sort_at_ms,group_exercise_id,set_id,metric,
      certified,reason,payload,contract_version,rules_revision)
    values ('${HG}','record','${ATHLETE_UID}','${H}-x',${H_AT},'${HX}','${H}-x-set',null,null,null,
        jsonb_build_object('reps',5,'weight_kg',35,'e1rm_kg',40.803877,'achieved_at_ms',${H_AT},
          'session_exercise_id','${H}-x-se','exercise_definition_id','${H}-x-def','boards',jsonb_build_array(
            jsonb_build_object('metric','weight','value_kg',35,'group_record',true,'previous_value_kg',null),
            jsonb_build_object('metric','e1rm','value_kg',40.803877,'group_record',true,'previous_value_kg',null))),1,null),
      ('${HG}','lead_change','${ATHLETE_UID}',null,${H_AT},'${HX}',null,'weight',false,'record',
        jsonb_build_object('leader',jsonb_build_object('member_user_id','${ATHLETE_UID}','set_id','${H}-x-set',
          'session_id','${H}-x','reps',5,'weight_kg',35,'e1rm_kg',40.803877,'value_kg',35,'achieved_at_ms',${H_AT}),'previous',null),1,null),
      ('${HG}','lead_change','${ATHLETE_UID}',null,${H_AT}+1,'${HX}',null,'weight',false,'record',
        jsonb_build_object('leader',jsonb_build_object('member_user_id','${ATHLETE_UID}','value',36,'unit','kg'),'previous',null),2,2);
  commit;" >/dev/null

rpc "${OWNER_TOKEN}" group_competition_revisions "$(jq -nc --arg g "${HG}" --arg x "${HX}" '{p_group_id:$g,p_group_exercise_id:$x}')"
expect_ok 'stored revisions'; assert_wire isCompetitionRevisionsWire
check 'legacy and protocol-3 revisions keep their representation' \
  '[.revisions[]|[.rules_revision,.representation_version,.legacy]]|sort==[[1,3,true],[2,3,false],[3,4,false]]'
history() {
  rpc "${OWNER_TOKEN}" group_competition_history "$(jq -nc --arg g "${HG}" --arg x "${HX}" --arg m "$1" --argjson r "$2" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:false,p_revision:$r}')"
  expect_ok "history $1 at revision $2"; assert_wire isCompetitionHistoryWire
}
history weight 1
check 'a legacy revision reads its legacy lead change in exact kg' \
  '.revision.legacy and ([.events[]|[.kind,.representation_version,(.values[]|select(.role=="leader")|[.metric,.unit,.value])]]
     ==[["lead_change",1,["weight","kg",35]]])'
history weight 2
check 'a protocol-3 revision reads its own Weight lead change' \
  '.revision.representation_version==3 and ([.events[]|[.kind,.representation_version,(.values[]|select(.role=="leader")|[.unit,.value])]]
     ==[["lead_change",3,["kg",36]]])'
h_board() {
  rpc "${OWNER_TOKEN}" group_competition_board "$(jq -nc --arg g "${HG}" --arg x "$1" --arg m "$2" --argjson c "$3" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
  expect_ok "stored board $2"; assert_wire isCompetitionBoardWire
}
for metric in e1rm volume; do
  h_board "${HX}" "${metric}" true
  check "a legacy witness keeps its public ID on the Certified ${metric} board" \
    '[.entries[]|[.member.user_id,.certification.certification_id,.certification.observed_rules_revision]]==[[$a,$id,1]]' \
    --arg a "${ATHLETE_UID}" --arg id "${R1}"
done
h_board "${HX}" e1rm false
check "a former member's frozen 1RM keeps its exact kg score" \
  'any(.entries[];.member.user_id==$f and .former and .unit=="kg" and .value==41.969702)' --arg f "${FROZEN_UID}"
h_board "${HX}" volume false
check 'a frozen 1RM-only score invents no Volume' 'all(.entries[];.member.user_id!=$f)' --arg f "${FROZEN_UID}"
h_board "${HA}" e1rm false
check 'an archived comparison keeps its frozen kg scores' '.state=="archived" and .entry_count==2 and all(.entries[];.unit=="kg")'
for id in "${R1}" "${R2}"; do
  rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${HG}" --arg c "${id}" '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm"}')"
  expect_ok 'stored certification'; assert_wire isCompetitionCertificationResultWire
  check 'a legacy certification reads by its own ID, observed under the legacy revision' \
    '.certification.certification_id==$id and .certification.observed_rules_revision==1 and .certification.ended_at_ms==null' --arg id "${id}"
done
rpc "${OWNER_TOKEN}" group_competition_stream "$(jq -nc --arg g "${HG}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'stored stream'; assert_wire isCompetitionStreamWire
check 'the legacy record reads as a competition event in exact kg' \
  'any(.items[]|select(.kind=="competition")|.event;.kind=="record" and .set_id==$s and .representation_version==1
     and ([.values[]|select(.role=="record")|[.metric,.unit,.value]]|sort)==[["e1rm","kg",40.803877],["weight","kg",35]])' \
  --arg s "${H}-x-set"
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${HG}" --arg c "${R1}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"
expect_ok 'withdraw a legacy certification'; assert_wire isCompetitionCertificationResultWire
check 'the withdrawal answers with the legacy ID' '.certification.certification_id==$c and .certification.end_reason=="withdrawn"' --arg c "${R1}"
expect_sql 'withdrawing a legacy ID closes its root and every projection' "select
  (select end_reason='withdrawn' from app_public.group_certifications where id='${R1}') and
  (select bool_and(ended_at is not null) from app_public.group_metric_certifications where legacy_certification_id='${R1}');" t
pass 'stored legacy/protocol-3 revisions, legacy witnesses and aliases, frozen former/archived scores read through protocol 4'

# An archived legacy root has no metric alias yet. Its live private source still
# participates in the correction boundary and safe fallback detail reader.
next_cuam
push "${ATHLETE_TOKEN}" 'private source behind an unimported legacy root' \
  "$(e_def "${H}-a-def" 'Legacy source' "${CUAM}")" \
  "$(e_session "${H}-a" "${H_AT}" completed "$((H_AT+30000))" 30 null "${CUAM}")" \
  "$(e_se "${H}-a-se" "${H}-a" "${H}-a-def" 0 'Legacy source' "${CUAM}")" \
  "$(e_set "${H}-a-set" "${H}-a-se" 0 35 5 '' "${CUAM}" null rir_0)"
run_psql "update app_public.group_certifications set pinned_fingerprint=(
  select app_public.group_legacy_set_fingerprint(es) from app_public.exercise_sets es
  where es.owner_user_id='${ATHLETE_UID}' and es.id='${H}-a-set') where id='${R2}';
  alter table app_public.group_certifications add constraint cp_legacy_mode_fault
    check(id<>'${R2}'::uuid or ended_at is null) not valid;" >/dev/null
LEGACY_MODE_AUDIT="$(run_psql "select (to_jsonb(c)-array['ended_at','end_reason','ended_by','source_exercise_definition_id'])::text from app_public.group_certifications c where id='${R2}';")"
next_cuam; push "${ATHLETE_TOKEN}" 'archived legacy correction under eager fault' "$(e_def "${H}-a-def" 'Legacy source' "${CUAM}" per_side_load)"
rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${HG}" --arg c "${R2}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume"}')"
expect_ok 'unimported legacy effective state'; assert_wire isCompetitionCertificationResultWire
check 'unimported legacy state is generically terminal' '.certification.end_reason=="voided" and .certification.ended_at_ms!=null'
run_psql "alter table app_public.group_certifications drop constraint cp_legacy_mode_fault;" >/dev/null
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${HG}" --arg x "${HA}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:false}')"; expect_ok 'legacy source unarchive'
drain 'legacy source recovery'
expect_sql 'a corrected legacy root never imports an active projection' "select count(*) from app_public.group_metric_certifications
  where legacy_certification_id='${R2}' and ended_at is null;" 0
[[ "$(run_psql "select (to_jsonb(c)-array['ended_at','end_reason','ended_by','source_exercise_definition_id'])::text from app_public.group_certifications c where id='${R2}';")" == "${LEGACY_MODE_AUDIT}" ]] || fail 'legacy mode correction rewrote its audit'

# Ordinary total/per-side entries share one physical Volume. Seed the old
# target-per-side projections to exercise a real rules upgrade, not a raw edit.
rpc "${OWNER_TOKEN}" group_create '{"p_name":"Total load fixture","p_description":null}'; expect_ok 'total-load group'
GID="$(jq -er .group_id <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'total-load invite'
INVITE="$(jq -er .code <<<"${BODY}")"
for token in "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE}" '{p_code:$c}')"; expect_ok 'total-load join'
done
GX="$(comparison 'Total load' 0 volume)"; update_rules 0 per_side_load
START=$(($(now_ms)+1000)); T="total-${RUN_TAG}"
for prefix in ATHLETE RIVAL; do
  token="${prefix}_TOKEN"; mode=total_load; weight=20
  if [[ "${prefix}" == RIVAL ]]; then mode=per_side_load; weight=10; fi
  next_cuam
  push "${!token}" 'equivalent source link' \
    "$(e_def "${T}-${prefix}-def" 'Total load' "${CUAM}" "${mode}")" \
    "$(e_link "${T}-${prefix}-def" "${GID}" "${GX}" "${CUAM}")"
done
drain 'total-load links before performed records'
for prefix in ATHLETE RIVAL; do
  token="${prefix}_TOKEN"; weight=20
  if [[ "${prefix}" == RIVAL ]]; then weight=10; fi
  next_cuam
  push "${!token}" 'equivalent external load' \
    "$(e_session "${T}-${prefix}" "${START}" completed "$((START+30000))" 30 null "${CUAM}")" \
    "$(e_se "${T}-${prefix}-se" "${T}-${prefix}" "${T}-${prefix}-def" 0 'Total load' "${CUAM}")" \
    "$(e_set "${T}-${prefix}-set" "${T}-${prefix}-se" 0 "${weight}" 8 '' "${CUAM}" null rir_0)"
done
drain 'total-load comparison'
board volume; check 'both source modes have total Volume in per-side target' '.entry_count==2 and all(.entries[];.value==160 and .unit=="kg_reps")'
board e1rm; check 'per-side target 1RM remains per-side external kg' '.entry_count==2 and all(.entries[];.value>12.76 and .value<12.78)'
TOTAL_CERT="$(certify "${ATHLETE_UID}" "${T}-ATHLETE-set" volume)"; drain 'total-load certificate'
run_psql "
  update app_public.group_metric_set_scores set value=80 where group_exercise_id='${GX}' and metric='volume';
  update app_public.group_metric_board_entries set value=80 where group_exercise_id='${GX}' and metric='volume';
  update app_public.group_metric_certifications set observed_value=80 where group_exercise_id='${GX}' and metric='volume';
  update app_public.group_events e set payload=jsonb_set(payload,'{boards}',(
    select jsonb_agg(case when b->>'metric'='volume' then jsonb_set(b,'{value}','80') else b end)
    from jsonb_array_elements(e.payload->'boards') b))
    where group_exercise_id='${GX}' and kind='record';
  update app_public.group_events set rule_rescore_baseline=null where group_exercise_id='${GX}' and kind='record';" >/dev/null
TOTAL_AUDIT="$(audit "${TOTAL_CERT}")"
TOTAL_EVENT_IDS="$(run_psql "select string_agg(quote_literal(id::text),',') from app_public.group_events
  where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}';")"
[[ -n "${TOTAL_EVENT_IDS}" ]] || fail 'total-load fixture has no historical events'
RECORD_AUDIT_SQL="select coalesce(jsonb_agg(to_jsonb(e)-'rule_rescore_baseline' order by id),'[]'::jsonb)::text
  from app_public.group_events e where id in (${TOTAL_EVENT_IDS});"
TOTAL_RECORD_AUDIT="$(run_psql "${RECORD_AUDIT_SQL}")"
TOTAL_RAW="$(run_psql "select jsonb_agg(to_jsonb(s) order by id)::text from app_public.exercise_sets s where id='${T}-ATHLETE-set';")"
RECOMPUTE_SQL="$(cat "${SUPABASE_DIR}/migrations/20261011224403_total_load_recompute.sql")"
expect_sql 'an old evaluator cannot consume the recompute migration' "begin;
  update app_public.group_eval_rules_state set rules_version=6;
  do \$guard\$ begin
    begin
      execute \$recompute_sql\$${RECOMPUTE_SQL}\$recompute_sql\$;
      raise exception 'old evaluator guard did not reject recompute';
    exception when raise_exception then
      if sqlerrm not like 'total load recompute: deploy and kick%' then raise; end if;
    end;
  end \$guard\$;
  rollback; select 'guarded';" guarded
run_psql "${RECOMPUTE_SQL}" >/dev/null
run_psql "select app_public.group_metric_enqueue_isolated('${GID}','${GX}','session',null);" >/dev/null
next_cuam
push "${RIVAL_TOKEN}" 'real decrease coalesced with kernel upgrade' \
  "$(e_set "${T}-RIVAL-set" "${T}-RIVAL-se" 0 9 8 '' "${CUAM}" null rir_0)"
drain 'total-load rules upgrade coalesced with a real decrease'
board volume true; check 'Certified Volume refreshes without changing the witness' \
  'any(.entries[];.value==160 and .certification.certification_id==$id)' --arg id "${TOTAL_CERT}"
expect_sql 'historical certification keeps its exact audit' "select observed_value from app_public.group_metric_certifications where id='${TOTAL_CERT}';" 80
[[ "$(audit "${TOTAL_CERT}")" == "${TOTAL_AUDIT}" ]] || fail 'total-load certification audit changed'
[[ "$(run_psql "${RECORD_AUDIT_SQL}")" == "${TOTAL_RECORD_AUDIT}" ]] || fail 'total-load record audit changed'
expect_sql 'record baseline advances to current total Volume' "select bool_and((rule_rescore_baseline->'volume'->>'value')::numeric=160)
  from app_public.group_events where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and kind='record';" t
expect_sql 'kernel refresh creates no performed record or correction for the unchanged source' "select count(*)=1
  from app_public.group_events where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and kind in ('record','record_voided');" t
expect_sql 'genuine decrease voids the old record without creating an improvement' "select
  count(*) filter(where kind='record')=1 and count(*) filter(where kind='record_voided')=1
  from app_public.group_events where group_exercise_id='${GX}' and member_user_id='${RIVAL_UID}';" t
run_psql "select app_public.group_metric_enqueue_isolated('${GID}','${GX}','session',null);" >/dev/null
drain 'activity after total-load rules upgrade'
[[ "$(run_psql "${RECORD_AUDIT_SQL}")" == "${TOTAL_RECORD_AUDIT}" ]] || fail 'later activity voided a historical total-load record'
[[ "$(run_psql "select jsonb_agg(to_jsonb(s) order by id)::text from app_public.exercise_sets s where id='${T}-ATHLETE-set';")" == "${TOTAL_RAW}" ]] || fail 'total-load recompute rewrote raw sets'
# Catch-up needs no rules cause: frozen audit survives the first new-kernel read.
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:true}')"; expect_ok 'archive total load'
run_psql "update app_public.group_metric_set_scores set value=80 where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and metric='volume';
  update app_public.group_metric_board_entries set value=80 where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and metric='volume';
  update app_public.group_events set rule_rescore_baseline=null where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and kind='record';" >/dev/null
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:false}')"; expect_ok 'unarchive total load'
drain 'deferred total-load catch-up'
[[ "$(run_psql "${RECORD_AUDIT_SQL}")" == "${TOTAL_RECORD_AUDIT}" ]] || fail 'unarchive rewrote historical record audit'
expect_sql 'unarchive creates no performed record or correction for the unchanged source' "select count(*)=1
  from app_public.group_events where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and kind in ('record','record_voided');" t
[[ "$(audit "${TOTAL_CERT}")" == "${TOTAL_AUDIT}" ]] || fail 'unarchive rewrote historical certification audit'
next_cuam
push "${RIVAL_TOKEN}" 'restore equivalent load' \
  "$(e_set "${T}-RIVAL-set" "${T}-RIVAL-se" 0 10 8 '' "${CUAM}" null rir_0)"
drain 'restore equivalent total load'
update_rules 0 total_load; drain 'total target'
board volume; check 'target-mode change preserves total Volume' '.entry_count==2 and all(.entries[];.value==160)'
board e1rm; check 'total target converts 1RM exactly once' '.entry_count==2 and all(.entries[];.value>25.53 and .value<25.54)'
next_cuam
push "${RIVAL_TOKEN}" 'source mode change coalesced with a genuine new lift' \
  "$(e_def "${T}-RIVAL-def" 'Total load' "${CUAM}" total_load)" \
  "$(e_set "${T}-RIVAL-new" "${T}-RIVAL-se" 1 11 8 '' "${CUAM}" null rir_0)"
drain 'source mode and new lift'
board volume; check 'new total-entry lift beats the reinterpreted prior raw Weight' \
  'any(.entries[];.member.user_id==$u and .performance.set_id==$s and .value==88)' --arg u "${RIVAL_UID}" --arg s "${T}-RIVAL-new"
expect_sql 'the real improvement takes both metrics after source-mode change' "select
  count(*)=1 and bool_and(jsonb_array_length(payload->'boards')=2)
  from app_public.group_events where group_exercise_id='${GX}' and set_id='${T}-RIVAL-new' and kind='record';" t
pass 'equivalent total load, current scores, unchanged logged kg and immutable historical audits'

# The same source is certified in two groups, including a normalized zero-added
# set whose score cannot change when the source distribution changes.
MODE_G1="${GID}"; MODE_X1="${GX}"; MODE_T="${T}"; MODE_INVITE1="${INVITE}"
MODE_OTHER="$(certify "${RIVAL_UID}" "${MODE_T}-RIVAL-new" e1rm)"; drain 'unrelated member witness'
rpc "${OWNER_TOKEN}" group_create '{"p_name":"Source mode witness fixture","p_description":null}'; expect_ok 'mode group'
GID="$(jq -er .group_id <<<"${BODY}")"; MODE_G2="${GID}"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'mode invite'
MODE_INVITE2="$(jq -er .code <<<"${BODY}")"
rpc "${ATHLETE_TOKEN}" group_join "$(jq -nc --arg c "${MODE_INVITE2}" '{p_code:$c}')"; expect_ok 'mode join'
GX="$(comparison 'Zero added' 1 volume)"; MODE_X2="${GX}"; policy true
START=$(($(now_ms)+1000)); next_cuam
push "${ATHLETE_TOKEN}" 'one source shared into two groups' \
  "$(e_def "${MODE_T}-unrelated" 'Unrelated' "${CUAM}")" \
  "$(e_link "${MODE_T}-ATHLETE-def" "${MODE_G2}" "${MODE_X2}" "${CUAM}")" \
  "$(e_session "${MODE_T}-mode" "${START}" completed "$((START+30000))" 30 null "${CUAM}")" \
  "$(e_se "${MODE_T}-mode-se" "${MODE_T}-mode" "${MODE_T}-ATHLETE-def" 0 'Source mode' "${CUAM}")" \
  "$(e_set "${MODE_T}-mode-set" "${MODE_T}-mode-se" 0 '' 5 '' "${CUAM}" null rir_0)"
drain 'two-group source'; pair "${MODE_T}-mode-set"
MODE_C2="${V_PUBLIC}"; MODE_AUDIT2="${V_AUDIT}"
board volume; MODE_VALUE="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.value' <<<"${BODY}")"
MODE_TOKEN="$(jq -er --arg u "${ATHLETE_UID}" '.entries[]|select(.member.user_id==$u)|.write_token' <<<"${BODY}")"
MODE_REV="$(jq -er .rules.rules_revision <<<"${BODY}")"
GID="${MODE_G1}"; GX="${MODE_X1}"; MODE_C1="${TOTAL_CERT}"
MODE_AUDIT1="$(audit "${MODE_C1}")"; MODE_RAW="$(run_psql "select weight_value from app_public.exercise_sets where owner_user_id='${ATHLETE_UID}' and id='${MODE_T}-ATHLETE-set';")"
expect_sql 'generation-zero witnesses preserve even a historical source-mode mismatch' "begin;
  set local request.jwt.claims='{\"sub\":\"${ATHLETE_UID}\",\"role\":\"authenticated\"}';
  alter table app_public.exercise_definitions disable trigger exercise_definitions_group_eval_enqueue;
  update app_public.exercise_definitions set load_input_mode='per_side_load' where owner_user_id='${ATHLETE_UID}' and id='${MODE_T}-ATHLETE-def';
  select source_mode_generation=0 and ended_at is null and app_public.group_metric_certification_mode_matches(c)
    from app_public.group_metric_certifications c where id='${MODE_C1}';
  rollback;" t
expect_sql 'mode markers and helpers have no client privileges' "select
  (select relrowsecurity from pg_class where oid='app_public.group_source_mode_generations'::regclass)
  and not has_table_privilege('authenticated','app_public.group_source_mode_generations','SELECT')
  and not has_table_privilege('anon','app_public.group_source_mode_generations','SELECT')
  and not has_function_privilege('authenticated','app_public.group_source_mode_generation(uuid,text)','EXECUTE');" t
next_cuam; push "${ATHLETE_TOKEN}" 'unrelated source edit' "$(e_def "${MODE_T}-unrelated" 'Unrelated' "${CUAM}" per_side_load)"
[[ "$(audit "${MODE_C1}")" == "${MODE_AUDIT1}" ]] || fail 'unrelated source changed audit'
expect_sql 'unrelated source preserves the witness' "select ended_at is null from app_public.group_metric_certifications where id='${MODE_C1}';" t

# Fail eager ending while retaining the independently committed generation.
# Public readers must already treat it as terminal before any worker runs.
run_psql "alter table app_public.group_metric_certifications add constraint cp_source_mode_fault
  check(member_user_id<>'${ATHLETE_UID}'::uuid or ended_at is null) not valid;" >/dev/null
next_cuam; push "${ATHLETE_TOKEN}" 'source mode commits despite eager termination fault' \
  "$(e_def "${MODE_T}-ATHLETE-def" 'Total load' "${CUAM}" per_side_load)"
next_cuam; push "${ATHLETE_TOKEN}" 'source mode switches back before evaluation' \
  "$(e_def "${MODE_T}-ATHLETE-def" 'Total load' "${CUAM}" total_load)"
expect_sql 'both committed transitions remain remembered' "select generation from app_public.group_source_mode_generations
  where member_user_id='${ATHLETE_UID}' and exercise_definition_id='${MODE_T}-ATHLETE-def';" 2
for group in "${MODE_G1}" "${MODE_G2}"; do
  GID="${group}"; GX="${MODE_X1}"; certificate="${MODE_C1}"
  if [[ "${group}" == "${MODE_G2}" ]]; then GX="${MODE_X2}"; certificate="${MODE_C2}"; fi
  for metric in volume e1rm; do
    board "${metric}" true; check 'failed eager ending never leaves a Certified entry' 'all(.entries[];.member.user_id!=$u)' --arg u "${ATHLETE_UID}"
    rpc "${OWNER_TOKEN}" group_competition_certification_get "$(jq -nc --arg g "${GID}" --arg c "${certificate}" --arg m "${metric}" \
      '{p_group_id:$g,p_certification_id:$c,p_metric:$m}')"; expect_ok 'effective terminal state'; assert_wire isCompetitionCertificationResultWire
    check 'effective state stays generic with its original ID' '.certification.certification_id==$c and .certification.end_reason=="voided" and .certification.ended_at_ms!=null' --arg c "${certificate}"
  done
done
rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${MODE_G2}" --arg x "${MODE_X2}" --arg u "${ATHLETE_UID}" \
  --arg s "${MODE_T}-mode-set" --arg t "${MODE_TOKEN}" --argjson r "${MODE_REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"volume",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'a token from before a toggle back cannot create a new witness'
[[ "$(audit "${MODE_C1}")" == "${MODE_AUDIT1}" && "$(audit "${MODE_C2}")" == "${MODE_AUDIT2}" ]] || fail 'mode fault rewrote observed audit'
expect_sql 'only sanitized invalidation diagnostics are stored' "select bool_and(
  (select array_agg(k order by k) from jsonb_object_keys(context) k)=array['row_id','sqlstate','table'])
  from public.app_logs where event='group.source_mode_invalidation_failed' and user_id='${ATHLETE_UID}';" t
run_psql "alter table app_public.group_metric_certifications drop constraint cp_source_mode_fault;" >/dev/null
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${MODE_G2}" --arg c "${MODE_C2}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"volume",p_action:"withdraw"}')"
expect_ok 'manual action after source correction'; assert_wire isCompetitionCertificationResultWire
check 'manual action keeps the prior source correction terminal reason' '.certification.end_reason=="voided"'
drain 'source generation recovery'
GID="${MODE_G2}"; GX="${MODE_X2}"
board volume; check 'zero-added normalized score is unchanged' '.entries[0].value==$v' --argjson v "${MODE_VALUE}"
pair "${MODE_T}-mode-set"; [[ "${V_PUBLIC}" != "${MODE_C2}" ]] || fail 'fresh generation reused the ended witness'
expect_sql 'every new metric alias binds the current generation' "select count(*)=2 and bool_and(source_mode_generation=2 and ended_at is null)
  from app_public.group_metric_certifications where group_exercise_id='${MODE_X2}' and member_user_id='${ATHLETE_UID}' and set_id='${MODE_T}-mode-set' and ended_at is null;" t

# Archived comparisons and departed members are corrected while inactive.
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:true}')"; expect_ok 'archive mode comparison'
rpc "${ATHLETE_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id:$g}')"; expect_ok 'leave mode group'
next_cuam; push "${ATHLETE_TOKEN}" 'inactive source-mode correction' "$(e_def "${MODE_T}-ATHLETE-def" 'Total load' "${CUAM}" per_side_load)"
ended 'archived/former witness ends immediately'
rpc "${ATHLETE_TOKEN}" group_join "$(jq -nc --arg c "${MODE_INVITE2}" '{p_code:$c}')"; expect_ok 'rejoin mode group'
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
  '{p_group_id:$g,p_exercise_id:$x,p_archived:false}')"; expect_ok 'unarchive mode comparison'
drain 'rejoin/unarchive'; ended 'reactivation cannot restore the old witness'
GID="${MODE_G1}"; GX="${MODE_X1}"
expect_sql 'another member witness remains active' "select ended_at is null from app_public.group_metric_certifications where id='${MODE_OTHER}';" t
expect_sql 'source-mode corrections keep logged weights' "select weight_value from app_public.exercise_sets
  where owner_user_id='${ATHLETE_UID}' and id='${MODE_T}-ATHLETE-set';" "${MODE_RAW}"
[[ "$(audit "${MODE_C1}")" == "${MODE_AUDIT1}" && "$(audit "${MODE_C2}")" == "${MODE_AUDIT2}" ]] || fail 'mode recovery rewrote observed audit'
pass 'prospective source-mode termination, durable toggle-back fence, both groups/metrics, zero-added equivalence, inactive recovery and immutable audits'

# The marker and eager ending are independent safety paths.
GID="${MODE_G2}"; GX="${MODE_X2}"; pair "${MODE_T}-mode-set"
run_psql "alter table app_public.group_source_mode_generations add constraint cp_mode_marker_fault
  check(exercise_definition_id<>'${MODE_T}-ATHLETE-def' or generation<=3) not valid;" >/dev/null
board volume; MODE_TOKEN="$(jq -er '.entries[0].write_token' <<<"${BODY}")"; MODE_REV="$(jq -er .rules.rules_revision <<<"${BODY}")"
next_cuam; push "${ATHLETE_TOKEN}" 'eager termination survives marker failure' "$(e_def "${MODE_T}-ATHLETE-def" 'Total load' "${CUAM}" total_load)"
ended 'marker failure still ends both projections'
next_cuam; push "${ATHLETE_TOKEN}" 'marker failure and source toggle back' "$(e_def "${MODE_T}-ATHLETE-def" 'Total load' "${CUAM}" per_side_load)"
rpc "${OWNER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "${ATHLETE_UID}" \
  --arg s "${MODE_T}-mode-set" --arg t "${MODE_TOKEN}" --argjson r "${MODE_REV}" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"volume",p_expected_revision:$r,p_write_token:$t}')"
expect_error CONFLICT 'token rotation survives marker failure and toggle back'
run_psql "alter table app_public.group_source_mode_generations drop constraint cp_mode_marker_fault;" >/dev/null
drain 'marker fault recovery'; ended 'marker fault cannot restore a witness'

# Keep a real certification transaction open after its RPC returns. The source
# writer must wait for its row lock, then end the newly committed witness.
board volume; MODE_TOKEN="$(jq -er '.entries[0].write_token' <<<"${BODY}")"; MODE_REV="$(jq -er .rules.rules_revision <<<"${BODY}")"
MODE_RACE_AT="$(run_psql "select clock_timestamp();")"
MODE_RACE_DIR="$(mktemp -d)"; mkfifo "${MODE_RACE_DIR}/in"
docker exec -i "${DB_CONTAINER}" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq \
  <"${MODE_RACE_DIR}/in" >"${MODE_RACE_DIR}/cert.log" 2>&1 &
MODE_CERT_PID=$!; exec 9>"${MODE_RACE_DIR}/in"
printf '%s\n' "set application_name='mode-cert-${RUN_TAG}'; begin; set local role authenticated;
  select set_config('request.jwt.claims','{\"sub\":\"${OWNER_UID}\",\"role\":\"authenticated\"}',true);
  select set_config('request.headers','{\"x-boga-group-contract\":\"4\"}',true);
  do \$\$ begin perform app_public.group_competition_certify('${GID}','${GX}','${ATHLETE_UID}',
    '${MODE_T}-mode-set','volume',${MODE_REV},'${MODE_TOKEN}'); end; \$\$;
  select 'mode-cert-ready';" >&9
mode_race_deadline=$((SECONDS+10)); mode_race_ready=f
while [[ ${SECONDS} -lt ${mode_race_deadline} ]]; do
  mode_race_ready="$(run_psql "select exists(select 1 from pg_stat_activity where application_name='mode-cert-${RUN_TAG}'
    and state='idle in transaction' and query like '%mode-cert-ready%');")"
  [[ "${mode_race_ready}" != t ]] || break
  kill -0 "${MODE_CERT_PID}" 2>/dev/null || { cat "${MODE_RACE_DIR}/cert.log" >&2; fail 'certification race RPC failed'; }
  sleep 0.05
done
[[ "${mode_race_ready}" == t ]] || fail 'certification transaction did not become ready'
run_psql_once "set application_name='mode-write-${RUN_TAG}';
  set request.jwt.claims='{\"sub\":\"${ATHLETE_UID}\",\"role\":\"authenticated\"}';
  update app_public.exercise_definitions set load_input_mode='total_load'
  where owner_user_id='${ATHLETE_UID}' and id='${MODE_T}-ATHLETE-def';" >"${MODE_RACE_DIR}/writer.log" 2>&1 &
MODE_WRITER_PID=$!; mode_race_deadline=$((SECONDS+10)); mode_race_waiting=f
while [[ ${SECONDS} -lt ${mode_race_deadline} ]]; do
  mode_race_waiting="$(run_psql "select exists(select 1 from pg_stat_activity where application_name='mode-write-${RUN_TAG}' and wait_event_type='Lock');")"
  [[ "${mode_race_waiting}" != t ]] || break
  sleep 0.05
done
[[ "${mode_race_waiting}" == t ]] || fail 'source edit did not wait for the certification source lock'
printf '%s\n' 'commit;' '\q' >&9; exec 9>&-
wait "${MODE_CERT_PID}" || { cat "${MODE_RACE_DIR}/cert.log" >&2; fail 'certification race commit failed'; }
wait "${MODE_WRITER_PID}" || { cat "${MODE_RACE_DIR}/writer.log" >&2; fail 'source edit after certification failed'; }
MODE_CERT_PID=""; MODE_WRITER_PID=""; rm -rf "${MODE_RACE_DIR}"; MODE_RACE_DIR=""
expect_sql 'the waiting mode writer ends both newly committed projections' "select count(*)=2 and bool_and(ended_at is not null and end_reason='voided')
  from app_public.group_metric_certifications where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}'
    and set_id='${MODE_T}-mode-set' and certified_at>='${MODE_RACE_AT}'::timestamptz;" t
drain 'concurrent source/certification'

# Exercise the actual data-changing statements against populated old
# table shapes, comparing every existing field rather than selected audit pins.
MODE_ALTERS=""
while IFS= read -r line; do
  if [[ "${line}" == 'alter table app_public.group_'*' add column source_'* ]]; then
    MODE_ALTERS+="${line//app_public./pg_temp.}"$'\n'
  fi
done <"${SUPABASE_DIR}/migrations/20261012085818_group_certification_source_entry_mode.sql"
[[ -n "${MODE_ALTERS}" ]] || fail 'mode migration ALTER statements missing'
expect_sql 'populated migration preserves every old score/certification field' "begin;
  create temp table group_metric_set_scores (like app_public.group_metric_set_scores including all);
  create temp table group_metric_certifications (like app_public.group_metric_certifications including all);
  create temp table group_certifications (like app_public.group_certifications including all);
  insert into pg_temp.group_metric_set_scores select * from app_public.group_metric_set_scores;
  insert into pg_temp.group_metric_certifications select * from app_public.group_metric_certifications;
  insert into pg_temp.group_certifications select * from app_public.group_certifications;
  alter table pg_temp.group_metric_set_scores drop column source_mode_generation;
  alter table pg_temp.group_metric_certifications drop column source_mode_generation;
  alter table pg_temp.group_certifications drop column source_mode_generation;
  alter table pg_temp.group_certifications drop column source_exercise_definition_id;
  -- The earlier kernel refresh can remove active members' unlinked scores;
  -- use the former member's retained score for the old frozen-source row.
  update pg_temp.group_certifications set member_user_id='${FROZEN_UID}',set_id='${H}-f-set',session_id='${H}-f'
    where id='${R1}';
  create temp table mode_migration_audit as select jsonb_build_array(
    (select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from pg_temp.group_metric_set_scores c),
    (select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from pg_temp.group_metric_certifications c),
    (select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from pg_temp.group_certifications c)) as snapshot;
  ${MODE_ALTERS}
  update pg_temp.group_certifications c set source_exercise_definition_id=app_public.group_legacy_certification_definition(
    jsonb_populate_record(null::app_public.group_certifications,to_jsonb(c))) where c.source_exercise_definition_id is null;
  select snapshot=jsonb_build_array(
    (select jsonb_agg(to_jsonb(c)-'source_mode_generation' order by (to_jsonb(c)-'source_mode_generation')::text) from pg_temp.group_metric_set_scores c),
    (select jsonb_agg(to_jsonb(c)-'source_mode_generation' order by (to_jsonb(c)-'source_mode_generation')::text) from pg_temp.group_metric_certifications c),
    (select jsonb_agg(to_jsonb(c)-array['source_mode_generation','source_exercise_definition_id']
      order by (to_jsonb(c)-array['source_mode_generation','source_exercise_definition_id'])::text) from pg_temp.group_certifications c))
    and (select bool_and(source_mode_generation=0) from pg_temp.group_metric_set_scores)
    and (select bool_and(source_mode_generation=0) from pg_temp.group_metric_certifications)
    and (select bool_and(source_mode_generation=0) from pg_temp.group_certifications)
    and exists(select 1 from app_public.exercise_sets where owner_user_id='${ATHLETE_UID}' and id='${H}-a-set')
    and (select source_exercise_definition_id='${H}-a-def' from pg_temp.group_certifications where id='${R2}')
    and not exists(select 1 from app_public.exercise_sets where owner_user_id='${FROZEN_UID}' and id='${H}-f-set')
    and exists(select 1 from app_public.group_metric_set_scores where group_exercise_id='${HX}'
      and member_user_id='${FROZEN_UID}' and set_id='${H}-f-set' and exercise_definition_id='${H}-f-def')
    and (select source_exercise_definition_id='${H}-f-def' from pg_temp.group_certifications where id='${R1}')
  from mode_migration_audit; rollback;" t
pass 'marker-write isolation, legacy fallback/import safety and populated generation-zero migration'

COMPLETED=1
pass "group competition vectors passed (run ${RUN_TAG})"
