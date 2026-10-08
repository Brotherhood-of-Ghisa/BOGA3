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
cleanup() {
  run_psql "set client_min_messages = warning;
            alter table app_public.group_metric_board_entries drop constraint if exists ${FAULT_CONSTRAINT};" >/dev/null
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
BODY='{}'; [[ "$(wire_verdict isCompetitionContractWire)" == 'rejected {}' ]] || fail 'decoder accepted an empty contract'
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
assert_wire isCompetitionContractWire; check active '.activation_state=="active"'
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
GX="${ZERO_GX}"; board e1rm; check 'ordinary counterpart from normalized source cannot bypass same-group boundary' '.entries==[]'
GX="${MAIN_GX}"
pass 'actual catalog/podium/revision/history/stream/session/week payloads decode with enabled privacy'

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
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg c "${R_PUBLIC}" \
  '{p_group_id:$g,p_certification_id:$c,p_metric:"e1rm",p_action:"cancel"}')"; expect_ok 'admin cancellation'; assert_wire isCompetitionCertificationResultWire
check 'safe cancellation metadata' '.certification.certification_id==$c and .certification.end_reason=="cancelled"' --arg c "${R_PUBLIC}"
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

COMPLETED=1
pass "group competition vectors passed (run ${RUN_TAG})"
