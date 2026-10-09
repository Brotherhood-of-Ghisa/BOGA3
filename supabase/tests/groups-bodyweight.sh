#!/usr/bin/env bash
# groups-bodyweight.sh — optional bodyweight calculations in group competitions
# (protocol 4) on an active stack. Proves, against the real local stack
# (sync_push, group-eval, PostgREST):
#
#   - the group policy: Off ranks ordinary Volume (kg × reps) and 1RM (kg); On
#     rebuilds a positive-contribution comparison atomically and normalizes it,
#     with no private reading context on the wire; a zero-contribution
#     comparison never queues, rebuilds or changes across toggles;
#   - the SQL as-of bodyweight resolver matches the device's;
#   - witnesses keep their certification and audit at the current score across
#     rule and source changes; a retry returns the original; the forward data
#     migration re-pins under the observed rules and keeps a pending reading
#     correction; a reading-free witness survives temporary ineligibility;
#   - the personal preference never changes a group score or queues evaluation;
#   - only Volume and 1RM are read and stored, in their units;
#   - working sets only: a warm-up never ranks, records or certifies, and a
#     stored warm-up record stands while its board falls silently;
#   - zero-contribution rule metadata canonicalizes without touching clocks and
#     the history reports effective zero use; an equal-score raw edit voids its
#     witness;
#   - a source-mode rescore keeps a historic record and its witness through
#     later certification and performance jobs.
#
# Contract: docs/specs/tech/group-competition-contract.md. Board, certify and
# stream payloads go through the app's
# competition wire guards. Direct-drain mode: the kick URL is unset and the
# sweep paused for the run, both restored on exit. Hermetic: per-run users,
# deleted on exit with everything they own. Execute only through its Boga lane.
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
psql_session_start

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
WIRE_PID=""
WIRE_DIR="$(mktemp -d)"
# Metric jobs cascade from their group; comparison-job log rows carry no user,
# so they are matched by the run's groups.
cleanup() {
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"; ids="${ids%,}"
  run_psql "begin;
    delete from public.app_logs where event like 'group.%' and (user_id in (${ids})
      or context->>'group_id' in (select id::text from app_public.groups where created_by in (${ids})));
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
  if [[ -n "${WIRE_PID}" ]]; then
    exec 5>&- 6<&-; kill "${WIRE_PID}" 2>/dev/null || true; wait "${WIRE_PID}" 2>/dev/null || true
  fi
  rm -rf "${WIRE_DIR}"
  psql_session_stop
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

# One competition wire decoder for the whole body, as groups-competitions.sh:
# each call writes "<guard>\t<compact JSON>" and blocks on its verdict line; a
# dead decoder reads as EOF and fails. Its fds are 5/6 (psql holds 7/8).
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
wire_verdict() {
  local verdict="" wrote=0
  trap '' PIPE
  (printf '%s\t%s\n' "$1" "${BODY//$'\n'/}") >&5 2>/dev/null && wrote=1
  [[ ${wrote} -eq 1 ]] && read -r verdict <&6 || true
  printf '%s' "${verdict:-decoder exited}"
}
# assert_wire <guard>: BODY decodes with that competition wire guard.
assert_wire() {
  local verdict
  verdict="$(wire_verdict "$1")"
  [[ "${verdict}" == ok ]] || fail "actual $1 decoder: ${verdict}"
}
# Canary: the decoder must be able to say no, or every assert_wire is a no-op.
BODY='{}'; [[ "$(wire_verdict isCompetitionBoardWire)" == 'rejected {}' ]] || fail 'decoder accepted an empty board'
BODY=''

now_ms() { run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;"; }
expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}
drain() {
  eval_drain
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
  rpc "$1" group_competition_exercise_create "$(jq -nc --arg g "$2" --argjson c "$3" '
    {p_group_id:$g,p_name:"Pull-up",p_load_input_mode:"total_load",p_source_exercise_id:null,
      p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'create comparison'; assert_wire isCompetitionExerciseWriteWire
  check 'comparison uses current contract' '.contract_version==4 and .exercise.rules.default_metric=="e1rm"'
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}
# competition_board <metric> [certified]: GX's board read, any state or error.
competition_board() {
  rpc "${OWNER_TOKEN}" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$1" --argjson c "${2:-false}" '
    {p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
}
metric_board() {
  competition_board "$1" "${2:-false}"
  expect_ok "board $1"; assert_wire isCompetitionBoardWire
  check "board $1 ready" '.state=="ready"'
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
# certify_token <member> <set> <metric> <revision> <write-token> [bearer]: BODY holds the reply.
certify_token() {
  rpc "${6:-${OWNER_TOKEN}}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg u "$1" \
    --arg s "$2" --arg m "$3" --argjson r "$4" --arg t "$5" '
    {p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:$m,
      p_expected_revision:$r,p_write_token:$t}')"
}
# certify <member> <set> <metric>: the owner certifies that board entry with its write token.
certify() {
  local token revision
  metric_board "$3"
  token="$(jq -er --arg u "$1" --arg s "$2" '.entries[]|select(.member.user_id==$u and .performance.set_id==$s)|.write_token' <<<"${BODY}")"
  revision="$(jq -er '.rules.rules_revision' <<<"${BODY}")"
  certify_token "$1" "$2" "$3" "${revision}" "${token}"
  expect_ok "certify $3"; assert_wire isCompetitionCertifyResultWire
}
# certify_metric <member> <session> <metric> [set]: echoes the public certification ID.
certify_metric() {
  certify "$1" "${4:-$2-set}" "$3"
  jq -er '.certification.certification_id' <<<"${BODY}"
}
set_group_policy() {
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${GID}" --arg n "Bodyweight ${RUN_TAG}" --argjson enabled "$1" '
    {p_group_id:$g,p_name:$n,p_description:null,p_bodyweight_calculations_enabled:$enabled}')"
  expect_ok 'update group calculation policy'
  check 'group policy response' '.group.bodyweight_calculations_enabled==$enabled' --argjson enabled "$1"
}
# stream_record <set>: that set's record event from the group stream (paged), in RECORD.
stream_record() {
  local cursor=null page
  RECORD=""
  for page in 1 2 3 4 5; do
    rpc "${OWNER_TOKEN}" group_competition_stream "$(jq -nc --arg g "${GID}" --argjson c "${cursor}" '{p_group_id:$g,p_before:$c,p_limit:50}')"
    expect_ok "stream page ${page}"; assert_wire isCompetitionStreamWire
    RECORD="$(jq -c --arg s "$1" 'first(.items[]|select(.kind=="competition")|.event|select(.kind=="record" and .set_id==$s)) // empty' <<<"${BODY}")"
    [[ -z "${RECORD}" ]] || return 0
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
    [[ "${cursor}" != null ]] || break
  done
  fail "no record event for $1 in the stream"
}

# Capture every comparison projection and public history row, not just its
# current best. A no-op must leave the metric stores alone.
comparison_snapshot() {
  run_psql "select md5(jsonb_build_object(
    'exercise',(select to_jsonb(e) from app_public.group_exercises e where id='${GX}'),
    'revisions',(select jsonb_agg(to_jsonb(r) order by revision) from app_public.group_rule_revisions r where group_exercise_id='${GX}'),
    'scores',(select jsonb_agg(to_jsonb(s) order by rules_revision,member_user_id,set_id,metric) from app_public.group_metric_set_scores s where group_exercise_id='${GX}'),
    'entries',(select jsonb_agg(to_jsonb(b) order by rules_revision,member_user_id,metric,certified) from app_public.group_metric_board_entries b where group_exercise_id='${GX}'),
    'state',(select jsonb_agg(to_jsonb(b) order by rules_revision,member_user_id) from app_public.group_metric_board_state b where group_exercise_id='${GX}'),
    'certifications',(select jsonb_agg(to_jsonb(c) order by id) from app_public.group_metric_certifications c where group_exercise_id='${GX}'),
    'events',(select jsonb_agg(to_jsonb(e) order by seq) from app_public.group_events e where group_exercise_id='${GX}')
  )::text);"
}
assert_zero_toggles() {
  local before
  before="$(comparison_snapshot)"
  for enabled in true true false false; do
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
node "${SUPABASE_DIR}/tests/bodyweight-as-of-parity.mjs" "${DB_CONTAINER}" "${OWNER_UID}"
for pair in OWNER:owner ATHLETE:athlete RIVAL:rival; do
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

metric_board volume
check 'policy-off Volume is the raw entered load × reps' '
  .metric=="volume" and (.entries[]|select(.member.user_id==$u)|.value==100 and .unit=="kg_reps")' --arg u "${ATHLETE_UID}"
check 'public Volume payload contains no private reading context' '
  [..|objects|keys[]|select(startswith("body_weight_") or .=="body_weight_dependency_digest")]|length==0'
metric_board e1rm
check 'policy-off 1RM uses the ordinary load' '
  .metric=="e1rm" and (.entries[]|select(.member.user_id==$u)|.value>20 and .unit=="kg")' --arg u "${ATHLETE_UID}"

set_group_policy true
competition_board e1rm
expect_ok 'rebuilding response'; assert_wire isCompetitionBoardWire
check 'toggle rebuild is atomic' '.state=="rebuilding" and .entries==[]'
drain 'policy-on rebuild'
metric_board e1rm
check 'enabled 1RM is normalized' '(.entries[]|select(.member.user_id==$u)|.unit=="percent_bw")' --arg u "${ATHLETE_UID}"
check 'public 1RM payload contains no private reading context' '
  [..|objects|keys[]|select(startswith("body_weight_") or .=="body_weight_dependency_digest")]|length==0'
pass 'group toggle rebuilds atomically: Off ranks ordinary kg, On normalizes without private reading context'

# A rival without a reading: its later witness has no reading dependency.
performance "${RIVAL_TOKEN}" "${T}-rival" "${DR}" null 30 5
drain 'missing-reading rival'

VOLUME_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-athlete" volume)"
E1RM_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-athlete" e1rm)"
# A rules-only change projects the SAME witnessed observation at a new score.
# Exact audit equality catches accidental replacement or silent audit rewriting.
# cert_audit <public-id> <metric>: one witness has a row per metric under one public id.
cert_audit() {
  run_psql "select (to_jsonb(c)-'observed_set_pin'-'reading_pin'-'current_fingerprint')::text
    from app_public.group_metric_certifications c
    where coalesce(c.legacy_certification_id,c.witness_certification_id,c.id)='$1' and c.metric='$2';"
}
drain 'publish original Certified entries'
VOLUME_AUDIT="$(cert_audit "${VOLUME_CERT}" volume)"
E1RM_AUDIT="$(cert_audit "${E1RM_CERT}" e1rm)"
assert_retained() {
  [[ "$(cert_audit "${VOLUME_CERT}" volume)" == "${VOLUME_AUDIT}" ]] || fail "$1: Volume audit changed"
  [[ "$(cert_audit "${E1RM_CERT}" e1rm)" == "${E1RM_AUDIT}" ]] || fail "$1: 1RM audit changed"
  for metric in volume e1rm; do
    metric_board "${metric}" true
    check "$1: same set remains Certified at its CURRENT score" '
      [.entries[]|select(.member.user_id==$u and .performance.set_id==$s and .certification.certification_id==$id
        and .value==$value)]|length==1' --arg u "${ATHLETE_UID}" --arg s "${T}-athlete-set" \
      --arg id "$(if [[ "${metric}" == volume ]]; then echo "${VOLUME_CERT}"; else echo "${E1RM_CERT}"; fi)" \
      --argjson value "$(run_psql "select value from app_public.group_metric_set_scores
        where group_exercise_id='${GX}' and member_user_id='${ATHLETE_UID}' and set_id='${T}-athlete-set'
          and metric='${metric}' and rules_revision=(select rules_revision from app_public.group_exercises where id='${GX}');")"
  done
}
update_comparison() {
  local revision
  revision="$(run_psql "select rules_revision from app_public.group_exercises where id='${GX}';")"
  rpc "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${GID}" --arg x "${GX}" \
    --argjson r "${revision}" --argjson c "$1" --arg mode "$2" '
    {p_group_id:$g,p_exercise_id:$x,p_expected_revision:$r,p_name:"Pull-up",
      p_load_input_mode:$mode,p_bodyweight_contribution:$c,p_default_metric:"e1rm"}')"
  expect_ok 'update comparison rules'; assert_wire isCompetitionExerciseWriteWire
}
# Move the rules on (contribution 0.5, then back to 1), so the witnesses'
# observed revision is retired below. Retention under each policy, contribution
# and distribution change is groups-competitions.sh's correction matrix.
for contribution in 0.5 1; do
  update_comparison "${contribution}" total_load; drain 'contribution rule change'
done
SOURCE_EVENT_COUNT="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');")"
for mode in per_side_load total_load; do
  next_cuam
  push "${ATHLETE_TOKEN}" 'source distribution rule change' \
    "$(e_def "${DA}" 'Pull-up' "${CUAM}" "${mode}" | jq '.fields.bodyweight_contribution=0.25')"
  drain 'source distribution rule change'
  expect_sql 'source rules are not a newly performed record or correction' \
    "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${SOURCE_EVENT_COUNT}"
done
expect_sql 'record baseline reconstruction matches current ordinary and private-dependent scoring pins' \
  "with g as (select app_public.group_metric_eval_source_graph('${GID}','${GX}') graph)
   select bool_and(app_public.group_metric_graph_fingerprint(r,graph->'rules',m,r->>'source_load_input_mode')=r->'fingerprints'->>m)
   from g cross join lateral jsonb_array_elements(graph->'sets') r
   cross join lateral unnest(array['volume','e1rm']) m where (r->>'live')::boolean;" t
# Retry with today's revision and write token returns the original certificate.
certify "${ATHLETE_UID}" "${T}-athlete-set" e1rm
check 'rules rescore must not recertify' '.created==false and .certification.certification_id==$id' --arg id "${E1RM_CERT}"
assert_retained 'idempotent witness retry'
pass 'rule changes retain exact witness audits and recalculate Certified entries'
# Exercise the ACTUAL forward data migration on populated active rows after
# rules have moved. A pending reading correction must not be blessed at cutover.
MIGRATION_SQL="$(sed -n '/^-- Establish/,/^-- One legacy witness/p' "${SUPABASE_DIR}"/migrations/*_group_certification_observations.sql)"
expect_sql 'active pins migrate under observed rules, with their audit intact' "begin;
  update app_public.group_metric_certifications set observed_set_pin=null,reading_pin=null,current_fingerprint=null
    where coalesce(witness_certification_id,id) in ('${VOLUME_CERT}','${E1RM_CERT}');
  ${MIGRATION_SQL}
  select observed_set_pin is not null and reading_pin<>'pending-correction'
    and current_fingerprint=pinned_fingerprint from app_public.group_metric_certifications
    where coalesce(witness_certification_id,id)='${E1RM_CERT}' and metric='e1rm';
  rollback;" t
expect_sql 'migration preserves a pending relevant reading correction for invalidation' "begin;
  set local request.jwt.claims='{\"sub\":\"${ATHLETE_UID}\",\"role\":\"authenticated\"}';
  update app_public.body_weight_measurements set weight_kg=81
    where owner_user_id='${ATHLETE_UID}' and id='${T}-athlete-reading';
  update app_public.group_metric_certifications set observed_set_pin=null,reading_pin=null,current_fingerprint=null
    where coalesce(witness_certification_id,id)='${E1RM_CERT}' and metric='e1rm';
  ${MIGRATION_SQL}
  select reading_pin='pending-correction' from app_public.group_metric_certifications
    where coalesce(witness_certification_id,id)='${E1RM_CERT}' and metric='e1rm';
  rollback;" t
assert_retained 'forward migration audit preservation'

# A certificate with no reading dependency can become temporarily ineligible
# because of a RULE change; returning to ordinary rules restores its entry.
set_group_policy false; drain 'ordinary rival certification'
RIVAL_CERT="$(certify_metric "${RIVAL_UID}" "${T}-rival" e1rm)"
RIVAL_AUDIT="$(cert_audit "${RIVAL_CERT}" e1rm)"
set_group_policy true; drain 'ineligible rival under bodyweight rules'
[[ "$(cert_audit "${RIVAL_CERT}" e1rm)" == "${RIVAL_AUDIT}" ]] || fail 'ineligible observation lost its certification'
metric_board e1rm true
check 'missing reading omits Certified entry without ending its witness' '[.entries[]|select(.member.user_id==$u)]|length==0' --arg u "${RIVAL_UID}"
update_comparison 0 total_load; drain 'rival eligible again through rules'
metric_board e1rm true
check 'eligible again uses the same witness' '[.entries[]|select(.member.user_id==$u and .certification.certification_id==$id)]|length==1' \
  --arg u "${RIVAL_UID}" --arg id "${RIVAL_CERT}"
update_comparison 1 total_load; drain 'restore bodyweight contribution'
assert_retained 'after temporary ineligibility'
pass 'a reading-free witness survives temporary ineligibility under the rules'

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
  [.entries[]|select(.member.user_id==$r and .unit=="kg")]|length==1' --arg r "${RIVAL_UID}"
pass 'personal and group calculation policies remain independent'

# Only Volume and 1RM are accepted by current readers and storage.
for metric in weight reps relative absolute; do
  competition_board "${metric}"
  expect_error VALIDATION "unsupported metric ${metric}"
  check "unsupported metric ${metric}" '.message=="VALIDATION: invalid competition board dimensions"'
done
# Stored pre-protocol-4 rows keep Weight in kg; a Volume alias of a Weight witness has no
# observed value of its own (its kg audit is the referenced Weight witness).
COMPETITION_VALUE="(metric='volume' and unit in ('kg_reps','percent_bw_reps')) or (metric='e1rm' and unit in ('kg','percent_bw'))
  or (metric='weight' and unit='kg')"
expect_sql 'score storage accepts only Volume/1RM units (and stored Weight)' \
  "select count(*) from app_public.group_metric_set_scores where (${COMPETITION_VALUE}) is not true;" 0
expect_sql 'board storage accepts only Volume/1RM units (and stored Weight)' \
  "select count(*) from app_public.group_metric_board_entries where (${COMPETITION_VALUE}) is not true;" 0
expect_sql 'certification storage accepts only Volume/1RM units (and stored Weight)' \
  "select count(*) from app_public.group_metric_certifications where (${COMPETITION_VALUE}
    or (witness_certification_id is not null and metric='volume' and unit is null)) is not true;" 0

rpc "${OWNER_TOKEN}" group_competition_stream "$(jq -nc --arg g "${GID}" '{p_group_id:$g,p_limit:50}')"
expect_ok 'current stream'; assert_wire isCompetitionStreamWire
check 'ordinary stream exposes only Volume/1RM and no private reading fields' '
  ([..|objects|.metric?|select(.!=null)]|length>0 and all(.=="volume" or .=="e1rm")) and
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
metric_board volume
check 'a warm-up heavier than every working set never ranks' '
  (.entries[]|select(.member.user_id==$a)|.value==100 and .performance.set_id==$s)
  and .entries[0].member.user_id==$r and .entries[0].value==150' \
  --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-ca1"
REVISION="$(jq -er '.rules.rules_revision' <<<"${BODY}")"
expect_sql 'the warm-up made no record' "select count(*) from app_public.group_events where set_id='${T}-ca2';" 0
expect_sql 'the warm-up keeps a score row that does not count' \
  "select string_agg(metric||':'||counting,',' order by metric) from app_public.group_metric_set_scores
    where group_exercise_id='${GX}' and set_id='${T}-ca2';" 'e1rm:false,volume:false'
# certify_warm_up <bearer> <context>: certify the warm-up with its real write token.
certify_warm_up() {
  certify_token "${ATHLETE_UID}" "${T}-ca2" volume "${REVISION}" "$(run_psql "select write_token from
    app_public.group_metric_set_scores where group_exercise_id='${GX}' and set_id='${T}-ca2'
      and metric='volume' and rules_revision=${REVISION};")" "$1"
  expect_error NOT_FOUND "$2"
  check "$2: not a record set" '.message=="NOT_FOUND: record set not found for this metric"'
}
# With no readings for these sessions and independent personal contributions,
# ordinary 1RM still ranks. Witness both metrics before repeated policy writes.
lifts "${RIVAL_TOKEN}" "${T}-row-r2" "${DRW}" czero:35:5:rir_1
drain 'zero contribution performed record'
ZERO_VOLUME_CERT="$(certify_metric "${RIVAL_UID}" "${T}-row-r2" volume "${T}-czero")"
ZERO_E1RM_CERT="$(certify_metric "${RIVAL_UID}" "${T}-row-r2" e1rm "${T}-czero")"
drain 'zero contribution Certified baseline'
metric_board e1rm
check 'zero contribution retains ordinary 1RM without a reading' '[.entries[]|select(.member.user_id==$r and .unit=="kg")]|length==1' --arg r "${RIVAL_UID}"
ZERO_BOARD="${BODY}"
assert_zero_toggles
metric_board e1rm
[[ "${BODY}" == "${ZERO_BOARD}" ]] || fail 'zero contribution public board changed across toggles'
for metric in volume e1rm; do
  metric_board "${metric}" true
  check 'unchanged zero score keeps its original witness' '[.entries[]|select(.certification.certification_id==$id)]|length==1' \
    --arg id "$(if [[ "${metric}" == volume ]]; then echo "${ZERO_VOLUME_CERT}"; else echo "${ZERO_E1RM_CERT}"; fi)"
done
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
metric_board volume
check 'the board falls to the best working set' '
  (.entries[]|select(.member.user_id==$a)|.value==125 and .performance.set_id==$s) and .entries[0].member.user_id==$r' \
  --arg a "${ATHLETE_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-ca3"
pass 'comparisons count working sets only; a stored warm-up record stands and its board moves silently'

# A zero-contribution comparison with a retired revision: the metadata upgrade
# canonicalizes current and retired zero rules without altering clocks.
GX="$(create_comparison "${OWNER_TOKEN}" "${GID}" 0)"
WITNESS_DEF="${T}-witness-def"
next_cuam
push "${ATHLETE_TOKEN}" 'witnessed lift link' "$(e_def "${WITNESS_DEF}" 'Witnessed lift' "${CUAM}" total_load)" \
  "$(e_link "${WITNESS_DEF}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-witness" "${WITNESS_DEF}" null 35 5
drain 'witnessed lift board'
update_comparison 0 per_side_load; drain 'retire the initial zero revision'
ZERO_METADATA_SQL="$(sed -n '1,/^-- Live rule/p' "${SUPABASE_DIR}"/migrations/*_zero_contribution_group_toggle.sql)"
expect_sql 'metadata upgrade canonicalizes current and retired zero rules without altering clocks' "begin;
  update app_public.group_rule_revisions set rules=jsonb_set(rules,'{bodyweight_calculations_enabled}','true')
    where group_exercise_id='${GX}';
  create temporary table prior_zero_revision_clocks as select revision,created_at,published_at,retired_at
    from app_public.group_rule_revisions where group_exercise_id='${GX}';
  ${ZERO_METADATA_SQL}
  select bool_and(r.rules->>'bodyweight_calculations_enabled'='false'
    and row(r.created_at,r.published_at,r.retired_at) is not distinct from row(p.created_at,p.published_at,p.retired_at))
    and count(*)=2 and count(r.retired_at)=1
    from app_public.group_rule_revisions r join prior_zero_revision_clocks p using(revision)
    where r.group_exercise_id='${GX}'; rollback;" t

# Simulate an old event whose audit captured the global On preference at zero.
# Its stored audit stays intact while the history reports effective Off.
run_psql "update app_public.group_events set payload=jsonb_set(payload,'{rules,bodyweight_calculations_enabled}','true')
  where group_exercise_id='${GX}' and kind='rules_change';" >/dev/null
rpc "${OWNER_TOKEN}" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" '
  {p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false,p_limit:100}')"
expect_ok 'upgraded zero history'; assert_wire isCompetitionHistoryWire
check 'history exercise and revision agree on effective zero use beside the old rule event' '
  .exercise.rules.bodyweight_calculations_enabled==false and .revision.rules.bodyweight_calculations_enabled==false
  and ([.events[]|select(.kind=="rules_change")]|length==1)'
expect_sql 'public event normalization preserves the old stored rule audit' \
  "select bool_and(payload->'rules'->>'bodyweight_calculations_enabled'='true')
    from app_public.group_events where group_exercise_id='${GX}' and kind='rules_change';" t

# An equal numeric score cannot conceal a changed logged observation.
NEW_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-witness" e1rm)"
drain 'new metric witness'
next_cuam
push "${ATHLETE_TOKEN}" 'equal-value raw edit' "$(e_set "${T}-witness-set" "${T}-witness-se" 0 35.0 5 '' "${CUAM}")"
drain 'equal-value raw edit'
expect_sql 'raw spelling edit voids the observed set despite equal score' \
  "select end_reason from app_public.group_metric_certifications where id='${NEW_CERT}';" voided
pass 'zero rule metadata canonicalizes; a raw observation edit voids its witness despite an equal score'

# A silent source-mode rescore also preserves the original record's witness
# annotation, even though that historic event keeps its original score pin.
GX="$(create_comparison "${OWNER_TOKEN}" "${GID}" 0)"
next_cuam
push "${ATHLETE_TOKEN}" 'stream witness link' "$(e_link "${WITNESS_DEF}" "${GID}" "${GX}" "${CUAM}")"
performance "${ATHLETE_TOKEN}" "${T}-stream" "${WITNESS_DEF}" null 50 5
drain 'new witnessed stream record'
STREAM_AUDIT="$(run_psql "select payload::text from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';")"
STREAM_EVENT_COUNT="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');")"
STREAM_CERT="$(certify_metric "${ATHLETE_UID}" "${T}-stream" e1rm)"
# Leave certification queued so the same publication handles both changes.
next_cuam
push "${ATHLETE_TOKEN}" 'stream source-mode edit' "$(e_def "${WITNESS_DEF}" 'Witnessed lift' "${CUAM}" per_side_load)"
drain 'stream source-rule rescore'
expect_sql 'coalesced certification and source rules emit no performed record or correction' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
expect_sql 'coalesced source rules still publish the certification lead change' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind='lead_change' and certified and reason='certification' and payload->>'certification_id'='${STREAM_CERT}';" 1
stream_record "${T}-stream-set"
jq -e --arg id "${STREAM_CERT}" '[.record_context.metrics[]|select(.metric=="e1rm" and .certification.certification_id==$id)]|length==1' \
  <<<"${RECORD}" >/dev/null || fail 'old record context keeps its unchanged performance witness'
expect_sql 'source rescore keeps original record audit and a private current baseline' \
  "select payload::text='${STREAM_AUDIT}' and rule_rescore_baseline->'e1rm'->>'fingerprint' is not null from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';" t
rpc "${OWNER_TOKEN}" group_competition_certification_end "$(jq -nc --arg g "${GID}" --arg id "${STREAM_CERT}" '
  {p_group_id:$g,p_certification_id:$id,p_metric:"e1rm",p_action:"withdraw"}')"
expect_ok 'withdraw after source rules'; assert_wire isCompetitionCertificationResultWire
check 'withdrawal ends the same witness' '.certification.certification_id==$id and .certification.end_reason=="withdrawn"' --arg id "${STREAM_CERT}"
drain 'certification-only publication after source rules'
expect_sql 'later certification job cannot defer a false record correction' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
expect_sql 'later publication preserves original public record audit' \
  "select payload::text from app_public.group_events where group_exercise_id='${GX}' and kind='record' and set_id='${T}-stream-set';" "${STREAM_AUDIT}"
next_cuam
push "${ATHLETE_TOKEN}" 'equal numeric spelling after source rescore' "$(e_set "${T}-stream-set" "${T}-stream-se" 0 50.0 5 '' "${CUAM}")"
drain 'equivalent raw correction after source rules'
expect_sql 'equivalent numeric correction still preserves the standing record' \
  "select count(*) from app_public.group_events where group_exercise_id='${GX}' and kind in ('record','record_voided');" "${STREAM_EVENT_COUNT}"
performance "${ATHLETE_TOKEN}" "${T}-stream-newer" "${WITNESS_DEF}" null 60 5
drain 'newer stronger record'
metric_board e1rm
check 'historic record is no longer the All-board best' '.entries[]|select(.member.user_id==$u)|.performance.set_id==$s' \
  --arg u "${ATHLETE_UID}" --arg s "${T}-stream-newer-set"
stream_record "${T}-stream-set"
STREAM_TOKEN="$(jq -er '.record_context.metrics[]|select(.metric=="e1rm")|.write_token' <<<"${RECORD}")"
STREAM_REVISION="$(jq -er '.rules_revision' <<<"${RECORD}")"
certify_token "${ATHLETE_UID}" "${T}-stream-set" e1rm "${STREAM_REVISION}" "${STREAM_TOKEN}"
expect_ok 'certify historic record with current context token'; assert_wire isCompetitionCertifyResultWire
STREAM_CERT_2="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain 'new witness of historic equivalent corrected raw facts'
stream_record "${T}-stream-set"
jq -e --arg id "${STREAM_CERT_2}" '[.record_context.metrics[]|select(.metric=="e1rm" and .eligible and .certification.certification_id==$id)]|length==1' \
  <<<"${RECORD}" >/dev/null || fail 'private baseline permits current witness context without rewriting historic score'
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
