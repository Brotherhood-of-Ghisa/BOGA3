#!/usr/bin/env bash
# M27 real backend contract. Execute only through the registered Boga lane.
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
FORCE_ENQUEUE_CONSTRAINT="groups_bw_force_enqueue_failure"

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
  run_psql "set client_min_messages = warning;
            alter table app_public.group_metric_eval_queue drop constraint if exists ${FORCE_ENQUEUE_CONSTRAINT};
            alter table app_public.group_metric_board_entries drop constraint if exists groups_bw_force_publish_failure;" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event like 'group.%' and (user_id in (${ids}) or context ->> 'group_id' in
         (select id::text from app_public.groups where created_by in (${ids})));
      delete from app_public.group_eval_queue where member_user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

# Bash 3.2 hands the EXIT trap status 0 after an unbound-variable abort, so a
# run that never reached its last line fails here instead of passing.
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
  [[ "$actual" == "$3" ]] || fail "$1: expected '$3', got '$actual'"
}
# Cross the actual SQL -> TypeScript boundary, rather than comparing two
# independently authored JSON fixtures. No network/client credentials in Node.
assert_wire() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { pathToFileURL } from "node:url";
    const g=await import(pathToFileURL(process.argv[1]).href);
    const body=JSON.parse(fs.readFileSync(0,"utf8"));
    const kind=process.argv[2];
    const ok=kind==="board" ? g.isGroupMetricBoardWire(body) :
      kind==="podiums" ? g.isGroupMetricPodiumWire(body) :
      kind==="history" ? g.isGroupMetricHistoryWire(body) :
      kind==="certification" ? g.isGroupMetricCertificationWire(body.certification) :
      kind==="revisions" ? body.contract_version===2 && body.revisions.every(g.isGroupMetricRevisionWire) :
      kind==="stream" ? body.contract_version===2 && g.isGroupMetricStreamCursor(body.next_cursor) &&
        body.items.every(item=>{ const valid=g.isGroupMetricStreamItem(item);
          if (!valid) console.error("Rejected actual stream kind:",item?.kind); return valid; }) : false;
    if (!ok) throw new Error(`Actual ${kind} response failed mobile decoding`);
  ' "$SUPABASE_DIR/../apps/mobile/src/groups/metric-wire-guards.ts" "$1" <<<"$BODY" || fail "actual $1 wire contract"
}
drain() {
  local out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST -H "Content-Type: application/json" \
    -H "x-group-eval-secret: ${EVAL_SECRET}" -o "$out" -w "%{http_code}" --data '{}' \
    "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "$out")"; rm -f "$out"
  expect_ok "drain: $1"; check "drain: $1" '.failed == 0'
}
create_comparison() {
  rpc "$1" group_exercise_create_v2 "$(jq -nc --arg g "$2" --argjson c "$3" \
    '{p_group_id:$g,p_name:"Strict pull-up",p_load_input_mode:"total_load",p_source_exercise_id:null,
      p_bodyweight_coefficient:$c,p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
  expect_ok 'create comparison'
  jq -er '.exercise.group_exercise_id' <<<"$BODY"
}
metric_board() {
  rpc "${OWNER_TOKEN}" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" --arg m "$1" --argjson c "${2:-false}" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_metric:$m,p_certified:$c}')"
  expect_ok "board $1"; check "board $1 revision" '.contract_version==2 and .state=="ready"'
  assert_wire board
}
performance() {
  local token="$1" sid="$2" def="$3" b="$4" amount="$5" reps="$6" mode="${7:-added}" unit="${8:-kg}"
  next_cuam
  push "$token" "performance $sid" \
    "$(e_session "$sid" "$START" completed "$((START+60000))" 60 null "$CUAM" | jq --argjson b "$b" '.fields += {
      body_weight_kg:$b,body_weight_source:(if $b==null then null else "manual" end),
      body_weight_measurement_id:null,body_weight_measured_at:null}')" \
    "$(e_se "$sid-se" "$sid" "$def" 0 'Strict pull-up' "$CUAM")" \
    "$(e_set "$sid-set" "$sid-se" 0 "$amount" "$reps" '' "$CUAM" | jq --arg m "$mode" --arg u "$unit" \
      '.fields += {weight_unit:$u,external_load_mode:$m}')"
}
set_body_weight() {
  next_cuam
  push "$1" 'correct saved session weight' "$(e_session "$2" "$START" completed "$((START+60000))" 60 null "$CUAM" | \
    jq --argjson b "$3" '.fields += {body_weight_kg:$b,body_weight_source:"manual",body_weight_measurement_id:null,body_weight_measured_at:null}')"
}
certify_metric() {
  local uid="$1" sid="$2" metric="$3" pin revision
  metric_board "$metric"
  pin="$(jq -er --arg u "$uid" --arg s "$sid-set" '.entries[]|select(.member.user_id==$u and .set_id==$s)|.fingerprint' <<<"$BODY")"
  revision="$(jq -er '.rules_revision' <<<"$BODY")"
  rpc "${OWNER_TOKEN}" group_metric_certify "$(jq -nc --arg g "$GID" --arg x "$GX" --arg u "$uid" \
    --arg s "$sid-set" --arg m "$metric" --arg f "$pin" --argjson r "$revision" \
    '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:$m,p_expected_revision:$r,p_expected_fingerprint:$f}')"
  expect_ok "certify $metric"
  assert_wire certification
  jq -er '.certification.certification_id' <<<"$BODY"
}

provision OWNER owner
provision ATHLETE athlete
provision RIVAL rival
provision OUTSIDER outsider
for pair in OWNER:owner ATHLETE:athlete RIVAL:rival OUTSIDER:outsider; do
  uid_var="${pair%%:*}_UID"
  set_username "${!uid_var}" "bw_${pair##*:}_${RUN_TAG//-/_}"
done
set_kick_url '';set_sweep_active false
rpc "$OWNER_TOKEN" group_create "$(jq -nc --arg n "BW $RUN_TAG" '{p_name:$n,p_description:null}')"
expect_ok 'group create';GID="$(jq -er .group_id <<<"$BODY")"
rpc "$OWNER_TOKEN" group_invite_get "$(jq -nc --arg g "$GID" '{p_group_id:$g}')"
expect_ok 'invite';INVITE="$(jq -er .code <<<"$BODY")"
for token in "$ATHLETE_TOKEN" "$RIVAL_TOKEN"; do
  rpc "$token" group_join "$(jq -nc --arg c "$INVITE" '{p_code:$c}')";expect_ok 'join'
done
GX="$(create_comparison "$OWNER_TOKEN" "$GID" 1)"
RULE_VALIDATION_ARGS="$(jq -nc --arg g "$GID" '{p_group_id:$g,p_name:"Validation probe",
  p_load_input_mode:"total_load",p_source_exercise_id:null,p_bodyweight_coefficient:1,
  p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
for field in p_movement_standard p_loading_method; do
  for invalid in long astral multiline control; do
    rpc "$OWNER_TOKEN" group_exercise_create_v2 "$(jq --arg f "$field" --arg v "$invalid" \
      '.[$f]=(if $v=="long" then ("a"*121) elif $v=="astral" then ("😀"*61) elif $v=="multiline" then "two\nlines" else "bad\u007fdescription" end)' <<<"$RULE_VALIDATION_ARGS")"
    expect_error VALIDATION "$field rejects $invalid description"
  done
done

# Every newly public RPC rejects anonymous/OAuth requests before its body and
# hides this group's existence from an outsider. Use well-typed parameters so
# PostgREST signature or JSON failures cannot masquerade as authorization.
AGENT_TOKEN="$(mint_token "$OWNER_TOKEN" "m27-agent-$RUN_TAG")"
AUTH_PROBES="$(jq -nc --arg g "$GID" --arg x "$GX" --arg u "$ATHLETE_UID" --argjson create "$RULE_VALIDATION_ARGS" '
  {p_group_id:$g,p_group_exercise_id:$x} as $target |
  [
    ["group_exercise_list_v2",{p_group_id:$g}],
    ["group_exercise_create_v2",$create],
    ["group_exercise_update_v2",(($create|del(.p_source_exercise_id)) + {p_exercise_id:$x,p_expected_revision:1})],
    ["group_exercise_archive_v2",{p_group_id:$g,p_exercise_id:$x}],
    ["group_exercise_unarchive_v2",{p_group_id:$g,p_exercise_id:$x}],
    ["group_metric_board",$target+{p_metric:"relative_strength",p_certified:false}],
    ["group_metric_history",$target+{p_metric:"relative_strength",p_certified:false}],
    ["group_metric_revisions",$target],
    ["group_metric_podiums",{p_group_id:$g,p_certified:false}],
    ["group_metric_certify",$target+{p_member_user_id:$u,p_set_id:"probe",p_metric:"relative_strength",p_expected_revision:1,p_expected_fingerprint:"probe"}],
    ["group_metric_certification_get",{p_group_id:$g,p_certification_id:$x}],
    ["group_metric_certification_end",{p_group_id:$g,p_certification_id:$x,p_action:"withdraw"}],
    ["group_stream_v2",{p_group_id:$g}]
  ]')"
while IFS= read -r probe; do
  name="$(jq -r '.[0]' <<<"$probe")"; args="$(jq -c '.[1]' <<<"$probe")"
  rpc "$ANON_KEY" "$name" "$args";expect_error AUTH_REQUIRED "$name anonymous"
  rpc "$AGENT_TOKEN" "$name" "$args";expect_error AGENT_FORBIDDEN "$name OAuth"
  rpc "$OUTSIDER_TOKEN" "$name" "$args";expect_error NOT_FOUND "$name outsider"
done < <(jq -c '.[]' <<<"$AUTH_PROBES")
for table in group_rule_revisions group_metric_eval_queue group_metric_set_scores group_metric_certifications group_metric_board_entries group_metric_board_state; do
  expect_sql "$table RLS enabled" "select relrowsecurity from pg_class where oid='app_public.$table'::regclass;" t
  expect_sql "$table no client privileges" "select count(*) from (values ('anon'),('authenticated')) r(role)
    where has_table_privilege(r.role,'app_public.$table','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');" 0
  rest GET "$OWNER_TOKEN" "$table" 'select=*&limit=1'
  [[ "$STATUS" == 403 ]] || fail "$table direct read must be denied"
  check "$table denied by privilege" '.code=="42501"'
done
pass 'new RPC authorization, private projection tables and shared description validation'
CUAM="$(now_ms)";START=$((CUAM+1000));T="bw-$RUN_TAG";DA="$T-da";DR="$T-dr"
next_cuam
push "$ATHLETE_TOKEN" 'athlete definition and link' \
  "$(e_def "$DA" 'Personal coefficient 0.4' "$CUAM" per_side_load | jq '.fields += {
    bodyweight_coefficient:0.4,movement_standard:"strict_pullup",loading_method:"belt"}')" \
  "$(e_link "$DA" "$GID" "$GX" "$CUAM")"
next_cuam
push "$RIVAL_TOKEN" 'rival definition and link' \
  "$(e_def "$DR" 'Personal coefficient 0.7' "$CUAM" total_load | jq '.fields += {
    bodyweight_coefficient:0.7,movement_standard:"strict_pullup",loading_method:"belt"}')" \
  "$(e_link "$DR" "$GID" "$GX" "$CUAM")"
performance "$ATHLETE_TOKEN" "$T-a" "$DA" 60 10 5
performance "$RIVAL_TOKEN" "$T-r" "$DR" 90 20 5
drain 'two target-specific performances'
metric_board relative_strength
check 'lighter athlete leads relative strength' '.entries|length==2' 
check 'relative member and unit' '.entries[0].member.user_id==$a and .entries[0].unit=="x_bw" and .entries[0].performance.weight_value=="10" and .entries[0].effective_resistance_kg==80' --arg a "$ATHLETE_UID"
metric_board absolute_strength
check 'heavier athlete leads absolute strength' '.entries[0].member.user_id==$r and .entries[0].unit=="kg" and .entries[0].effective_resistance_kg==110' --arg r "$RIVAL_UID"
metric_board bodyweight_reps
check 'weighted sets never rank as unweighted reps' '.entries==[]'
pass '60+20 versus 90+20 reversal; per-side external conversion counts B once'

rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"relative_strength",p_certified:false,p_limit:1}')"
expect_ok 'one-row comparison page';PAGE_CURSOR="$(jq -er .next_cursor <<<"$BODY")"
check 'page contains one coherent row' '.entries|length==1'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" --arg c "$PAGE_CURSOR" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false,p_after:$c}')"
expect_error VALIDATION 'cursor cannot cross metric units'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" --arg c "$PAGE_CURSOR" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"relative_strength",p_certified:false,p_after:$c,p_limit:1}')"
expect_ok 'second comparison page';check 'second member exactly once' '.entries[0].member.user_id==$r and .next_cursor==null' --arg r "$RIVAL_UID"


# Unknown B still permits unweighted reps, with no fabricated strength.
performance "$ATHLETE_TOKEN" "$T-reps" "$DA" null 0 8
drain 'unweighted reps without B'
metric_board bodyweight_reps
check 'reps without B' '.entries[0].value==8 and .entries[0].unit=="reps" and .entries[0].performance.body_weight_status=="missing"'
REPS_CERT="$(certify_metric "$ATHLETE_UID" "$T-reps" bodyweight_reps)"
set_body_weight "$ATHLETE_TOKEN" "$T-reps" 60
drain 'fill B leaves reps attestation intact'
expect_sql 'reps pin ignores B' "select ended_at is null from app_public.group_metric_certifications where id='$REPS_CERT';" t
ABS_CERT="$(certify_metric "$RIVAL_UID" "$T-r" absolute_strength)"
set_body_weight "$RIVAL_TOKEN" "$T-r" 92
drain 'correct B voids affected strength attestation'
expect_sql 'strength pin contains B' "select end_reason from app_public.group_metric_certifications where id='$ABS_CERT';" voided
pass 'metric-specific certification dependencies'

# Permissions stay at each RPC entrypoint; group membership reveals no private
# measurement history, and OAuth coaching credentials cannot mutate group rules.
rpc "$OUTSIDER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"relative_strength",p_certified:false}')"
expect_error NOT_FOUND 'outsider board'
rpc "$ATHLETE_TOKEN" group_exercise_update_v2 "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:1,p_name:"Strict pull-up",p_load_input_mode:"total_load",
    p_bodyweight_coefficient:0.7,p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
expect_error FORBIDDEN 'member cannot set comparison coefficient'
rpc "$OWNER_TOKEN" group_exercise_list "$(jq -nc --arg g "$GID" '{p_group_id:$g}')"
expect_ok 'legacy list';check 'old reader cannot mistake a bodyweight identity for kg-only' '.exercises==[]'
rpc "$OWNER_TOKEN" group_board "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"e1rm",p_certified:false}')"
expect_error VALIDATION 'old direct board requires compatible reader'
pass 'group permissions and old-reader guards'

# A personal coefficient has no authority over the target group's comparison.
expect_sql 'queue starts drained' "select count(*) from app_public.group_metric_eval_queue where group_id='$GID';" 0
next_cuam
push "$ATHLETE_TOKEN" 'personal coefficient only' \
  "$(e_def "$DA" 'Personal coefficient 0.1' "$CUAM" per_side_load | jq '.fields += {
    bodyweight_coefficient:0.1,movement_standard:"strict_pullup",loading_method:"belt"}')"
expect_sql 'personal coefficient does not enqueue' "select count(*) from app_public.group_eval_queue where member_user_id='$ATHLETE_UID';" 0
metric_board relative_strength
check 'personal coefficient cannot improve group score' '.entries[]|select(.member.user_id==$a)|.effective_resistance_kg==80' --arg a "$ATHLETE_UID"

# Publish one coherent revision; a rule change is not a performed record.
RULE_CERT="$(certify_metric "$RIVAL_UID" "$T-r" absolute_strength)"
drain 'recertified corrected performance'
MARK="$(run_psql "select coalesce(max(seq),0) from app_public.group_events where group_id='$GID';")"
RULE_ARGS="$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:1,p_name:"Strict pull-up",p_load_input_mode:"total_load",
    p_bodyweight_coefficient:0.7,p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
rpc "$OWNER_TOKEN" group_exercise_update_v2 "$RULE_ARGS"
expect_ok 'rule revision';check 'revision pending publication' '.exercise.rules_revision==2 and .exercise.rebuilding'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false}')"
expect_ok 'rebuilding board';check 'no mixed-revision ranking' '.state=="rebuilding" and .entries==[] and .rules_revision==2'
rpc "$OWNER_TOKEN" group_exercise_update_v2 "$RULE_ARGS"
expect_error CONFLICT 'stale rule editor'
drain 'whole-board rules publication'
metric_board absolute_strength
check 'every current row uses revision two' '.rules_revision==2 and ([.entries[].rules_revision]|all(.==2))'
expect_sql 'rule change is not a performed PR' "select count(*) from app_public.group_events where group_id='$GID' and seq>$MARK and kind in ('record','record_voided');" 0
expect_sql 'one explicit rules change' "select count(*) from app_public.group_events where group_exercise_id='$GX' and rules_revision=2 and kind='rules_change';" 1
expect_sql 'same raw observation stays certified across rules' "select ended_at is null from app_public.group_metric_certifications where id='$RULE_CERT';" t
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false,p_revision:1}')"
expect_ok 'old revision';check 'retired original scores are retained' '.state=="archived" and .rules_revision==1 and .exercise.rules_revision==1 and .exercise.published_revision==1 and (.exercise.rebuilding|not) and .entries[0].effective_resistance_kg==112'
pass 'coherent publication, original history and unchanged observation pins'

rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" --arg c "$PAGE_CURSOR" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"relative_strength",p_certified:false,p_after:$c}')"
expect_error VALIDATION 'cursor cannot cross rules revisions'


# Unlinking changes counting. A later correction still validates the retained
# observation and ends its affected certification through the ordinary queue.
next_cuam
push "$RIVAL_TOKEN" 'unlink rival' "$(e_link "$DR" "$GID" "$GX" "$CUAM" "$CUAM")"
drain 'unlink preserves observed performance'
expect_sql 'unlink does not falsify observation' "select ended_at is null from app_public.group_metric_certifications where id='$RULE_CERT';" t
set_body_weight "$RIVAL_TOKEN" "$T-r" 94
drain 'correction after unlink'
expect_sql 'unlinked correction still voids strength' "select end_reason from app_public.group_metric_certifications where id='$RULE_CERT';" voided
pass 'unlinked observation revalidation'

# One source can be judged by two independent group standards. Joining after
# the first sessions requires new shared performances for this second group.
rpc "$OWNER_TOKEN" group_create "$(jq -nc --arg n "BW alternate $RUN_TAG" '{p_name:$n,p_description:null}')"
expect_ok 'second group';GID2="$(jq -er .group_id <<<"$BODY")"
rpc "$OWNER_TOKEN" group_invite_get "$(jq -nc --arg g "$GID2" '{p_group_id:$g}')"
expect_ok 'second invite';INVITE2="$(jq -er .code <<<"$BODY")"
rpc "$ATHLETE_TOKEN" group_join "$(jq -nc --arg c "$INVITE2" '{p_code:$c}')";expect_ok 'second join'
GX2="$(create_comparison "$OWNER_TOKEN" "$GID2" 0.5)"
START=$(( $(now_ms) + 1000 ))
next_cuam
push "$ATHLETE_TOKEN" 'same source linked to second group' "$(e_link "$DA" "$GID2" "$GX2" "$CUAM")"
performance "$ATHLETE_TOKEN" "$T-two" "$DA" 60 15 5
drain 'same shared set under different group coefficients'
metric_board absolute_strength
check 'first group c0.7' '.entries[]|select(.member.user_id==$a)|.effective_resistance_kg==72' --arg a "$ATHLETE_UID"
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID2" --arg x "$GX2" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false}')"
expect_ok 'second group score';check 'second group c0.5' '.entries[0].effective_resistance_kg==60 and .entries[0].performance.weight_value=="15"'
pass 'two target groups use independent rules for the same raw source'

# Private owner readings never leak into shared readers or change frozen B.
next_cuam
push "$ATHLETE_TOKEN" 'new private reading' "$(jq -nc --arg id "$T-private-reading" --argjson c "$CUAM" \
  '{type:"body_weight_measurements",id:$id,client_updated_at_ms:$c,fields:{weight_value:"200",weight_unit:"kg",
    weight_kg:200,measured_at:$c,created_at:$c,updated_at:$c,deleted_at:null}}')"
expect_sql 'reading never queues group work' "select count(*) from app_public.group_eval_queue where member_user_id='$ATHLETE_UID';" 0
expect_sql 'reading never queues metric work' "select count(*) from app_public.group_metric_eval_queue where group_id in ('$GID','$GID2');" 0
rest GET "$OWNER_TOKEN" body_weight_measurements "owner_user_id=eq.${ATHLETE_UID}&select=id"
expect_ok 'group member reading privacy';check 'no private reading rows' '.==[]'
rpc "$OWNER_TOKEN" group_session_detail "$(jq -nc --arg u "$ATHLETE_UID" --arg s "$T-two" '{p_member_user_id:$u,p_session_id:$s}')"
expect_ok 'shared session context';check 'saved tuple and personal scope' '.session.body_weight_kg==60 and .session.body_weight_source=="manual" and .session.metric_scope=="personal" and .session.metric_revision=="effective_load_v1" and .session.exercises[0].bodyweight_coefficient==0.1'
check 'no private timeline object' '([..|objects|keys[]|select(.=="body_weight_measurements" or .=="readings")]|length)==0'
AGENT_TOKEN="$(mint_token "$OWNER_TOKEN" 'm27-agent-client')"
rpc "$AGENT_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false}')"
expect_error AGENT_FORBIDDEN 'OAuth group board denied'
rpc "$AGENT_TOKEN" group_exercise_update_v2 "$RULE_ARGS"
expect_error AGENT_FORBIDDEN 'OAuth comparison write denied'
rpc "$AGENT_TOKEN" group_session_detail "$(jq -nc --arg u "$ATHLETE_UID" --arg s "$T-two" '{p_member_user_id:$u,p_session_id:$s}')"
expect_error AGENT_FORBIDDEN 'OAuth shared-session reader denied'
pass 'frozen B, personal summary scope, private reading and OAuth boundaries'

# Lease UUID and source-generation fences reject old workers before projection
# writes. Direct owner SQL controls interleaving; the actual Edge scorer repairs.
run_psql "select app_public.group_metric_eval_enqueue('$GID','$GX','set');" >/dev/null
JOB="$(run_psql "select app_public.group_metric_eval_claim(20)->'jobs'->0;")"
JOB_ID="$(jq -er .job_id <<<"$JOB")";GEN="$(jq -er .generation <<<"$JOB")";CLAIM="$(jq -er .claim_id <<<"$JOB")"
run_psql "select app_public.group_metric_eval_enqueue('$GID','$GX','set');" >/dev/null
expect_sql 'stale source generation not prepared' "select app_public.group_metric_eval_prepare($JOB_ID,$GEN,'$CLAIM')->>'prepared';" false
expect_sql 'stale source generation not published' "select app_public.group_metric_eval_publish($JOB_ID,$GEN,'$CLAIM','{}')->>'completed';" false
expect_sql 'stale source lease released for retry' "select claim_id is null from app_public.group_metric_eval_queue where id=$JOB_ID;" t
JOB2="$(run_psql "select app_public.group_metric_eval_claim(20)->'jobs'->0;")"
GEN2="$(jq -er .generation <<<"$JOB2")";CLAIM2="$(jq -er .claim_id <<<"$JOB2")"
expect_sql 'old failure cannot release a new lease' "select app_public.group_metric_eval_fail($JOB_ID,$GEN,'$CLAIM','XXXXX')->>'accepted';" false
expect_sql 'new lease survives old failure' "select claim_id='$CLAIM2'::uuid from app_public.group_metric_eval_queue where id=$JOB_ID;" t
run_psql "update app_public.group_metric_eval_queue set claimed_until=now()-interval '1 second' where id=$JOB_ID;" >/dev/null
JOB3="$(run_psql "select app_public.group_metric_eval_claim(20)->'jobs'->0;")";CLAIM3="$(jq -er .claim_id <<<"$JOB3")"
[[ "$CLAIM3" != "$CLAIM2" ]] || fail 'expired lease must get a different UUID'
expect_sql 'expired worker cannot publish into new lease' "select app_public.group_metric_eval_publish($JOB_ID,$GEN2,'$CLAIM2','{}')->>'completed';" false
expect_sql 'source token mismatch does not publish' "select app_public.group_metric_eval_publish($JOB_ID,$GEN2,'$CLAIM3','{}')->>'completed';" false
drain 'fresh graph after stale generations and leases'
pass 'source generation, lease UUID and full-graph token fences'

# A certification must commit even if scheduling fails. The next source push
# repairs its projection and the error log contains only whitelisted metadata.
run_psql "alter table app_public.group_metric_eval_queue add constraint ${FORCE_ENQUEUE_CONSTRAINT} check(false) not valid;" >/dev/null
FAIL_CERT="$(certify_metric "$ATHLETE_UID" "$T-two" absolute_strength)"
run_psql "alter table app_public.group_metric_eval_queue drop constraint ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
expect_sql 'certification survives failed enqueue' "select ended_at is null from app_public.group_metric_certifications where id='$FAIL_CERT';" t
expect_sql 'sanitized enqueue failure recorded' "select count(*) from public.app_logs where event='group.eval_enqueue_failed' and context->>'group_exercise_id'='$GX' and context->>'sqlstate'='23514' and not(context ? 'message');" 1
next_cuam
push "$ATHLETE_TOKEN" 'repair certification scheduling' "$(e_set "$T-two-set" "$T-two-se" 0 15 5 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'repair failed certification enqueue'
metric_board absolute_strength true
check 'repaired certified entry' '.entries[]|select(.member.user_id==$a)|.certification_id==$c' --arg a "$ATHLETE_UID" --arg c "$FAIL_CERT"
pass 'failed scheduling preserves attestation; next source job repairs projection'

# Exercise an independent identity so lifecycle assertions have a stable baseline.
MAIN_GX="$GX";GX="$(create_comparison "$OWNER_TOKEN" "$GID" 1)";DP="$T-provisional-def"
next_cuam
push "$ATHLETE_TOKEN" 'provisional comparison source' \
  "$(e_def "$DP" 'Lifecycle pull-up' "$CUAM" total_load | jq '.fields += {bodyweight_coefficient:1,movement_standard:"strict_pullup",loading_method:"belt"}')" \
  "$(e_link "$DP" "$GID" "$GX" "$CUAM")"
performance "$ATHLETE_TOKEN" "$T-base" "$DP" 80 0 5
drain 'initial baseline record'
performance "$ATHLETE_TOKEN" "$T-live" "$DP" 80 10 5
next_cuam
push "$ATHLETE_TOKEN" 'active provisional session' "$(e_session "$T-live" "$START" active null null null "$CUAM")"
drain 'provisional improvement'
LIVE_RECORD="$(run_psql "select id from app_public.group_events where group_exercise_id='$GX' and kind='record' and set_id='$T-live-set';")"
[[ "$LIVE_RECORD" =~ $UUID_RE ]] || fail 'active improvement needs a provisional record'
next_cuam
push "$ATHLETE_TOKEN" 'provisional retraction' "$(e_set "$T-live-set" "$T-live-se" 0 0 5 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'provisional retraction'
expect_sql 'provisional record disappears without void' "select count(*) from app_public.group_events where id='$LIVE_RECORD' or related_event_id='$LIVE_RECORD';" 0
next_cuam
push "$ATHLETE_TOKEN" 'new active improvement' "$(e_set "$T-live-set" "$T-live-se" 0 20 5 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'new active improvement'
LIVE_RECORD="$(run_psql "select id from app_public.group_events where group_exercise_id='$GX' and kind='record' and set_id='$T-live-set';")"
[[ "$LIVE_RECORD" =~ $UUID_RE ]] || fail 'replacement active improvement needs a record'
next_cuam
push "$ATHLETE_TOKEN" 'complete provisional session' "$(e_session "$T-live" "$START" completed "$((START+60000))" 60 null "$CUAM")"
drain 'complete active record'
expect_sql 'completion keeps event identity' "select count(*) from app_public.group_events where id='$LIVE_RECORD';" 1
LIFE_CERT="$(certify_metric "$ATHLETE_UID" "$T-live" absolute_strength)"
drain 'certify before archival'
rpc "$OWNER_TOKEN" group_exercise_archive_v2 "$(jq -nc --arg g "$GID" --arg x "$GX" '{p_group_id:$g,p_exercise_id:$x}')";expect_ok 'archive comparison'
next_cuam
push "$ATHLETE_TOKEN" 'edit while frozen' "$(e_set "$T-live-set" "$T-live-se" 0 0 5 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'archived target stays frozen'
expect_sql 'archive retains observed pin until catch-up' "select ended_at is null from app_public.group_metric_certifications where id='$LIFE_CERT';" t
expect_sql 'archive does not rewrite history' "select count(*) from app_public.group_events where related_event_id='$LIVE_RECORD' and kind='record_voided';" 0
rpc "$OWNER_TOKEN" group_exercise_unarchive_v2 "$(jq -nc --arg g "$GID" --arg x "$GX" '{p_group_id:$g,p_exercise_id:$x}')";expect_ok 'unarchive comparison'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false}')"
expect_ok 'unarchive waits for publication';check 'unarchive shows coherent rebuilding state' '.state=="rebuilding" and .entries==[]'
drain 'unarchive reconciles same-revision history'
expect_sql 'unarchive voids changed observation' "select end_reason from app_public.group_metric_certifications where id='$LIFE_CERT';" voided
expect_sql 'unarchive retains final event and appends void' "select count(*) from app_public.group_events where related_event_id='$LIVE_RECORD' and kind='record_voided';" 1
expect_sql 'unarchive is not a rules revision' "select rules_revision from app_public.group_exercises where id='$GX';" 1
pass 'provisional retraction, completion identity, archived freeze and unarchive reconciliation'

# Assistance never enters the reps board, even at zero; lb conversion and
# malformed provenance remain shared-kernel decisions, not SQL formulas.
performance "$ATHLETE_TOKEN" "$T-zero-assist" "$DP" 80 0 20 assistance
performance "$ATHLETE_TOKEN" "$T-lb" "$DP" 80 100 5 added lb
performance "$ATHLETE_TOKEN" "$T-invalid-b" "$DP" 1000 1000 5 added kg
run_psql "begin;
  select set_config('request.jwt.claims',json_build_object('sub','$ATHLETE_UID','role','authenticated')::text,true);
  update app_public.sessions set body_weight_source=null where owner_user_id='$ATHLETE_UID' and id='$T-invalid-b';
  commit;" >/dev/null
drain 'assistance, lb and malformed tuple'
metric_board bodyweight_reps
check 'zero assistance is not unweighted reps' '.entries[0].value==5'
metric_board absolute_strength
check 'lb normalized with bodyweight once' '.entries[0].set_id==$s and ((.entries[0].effective_resistance_kg-125.359237)|fabs)<0.000001' --arg s "$T-lb-set"
expect_sql 'invalid B cannot rank as strength' "select count(*) from app_public.group_metric_set_scores where group_exercise_id='$GX' and set_id='$T-invalid-b-set' and metric in ('relative_strength','absolute_strength');" 0
pass 'actual units, assistance eligibility and invalid-provenance refusal'
GX="$MAIN_GX"

# Retire a live legacy comparison without silently widening its attestation.
rpc "$OWNER_TOKEN" group_exercise_create "$(jq -nc --arg g "$GID" '{p_group_id:$g,p_name:"Legacy pull-up",p_load_input_mode:"total_load",p_source_exercise_id:null}')"
expect_ok 'old client creates legacy identity';LEGACY_GX="$(jq -er .exercise.group_exercise_id <<<"$BODY")";DL="$T-legacy-def"
next_cuam
push "$ATHLETE_TOKEN" 'legacy source and link' \
  "$(e_def "$DL" 'Legacy pull-up' "$CUAM" total_load | jq '.fields += {bodyweight_coefficient:1,movement_standard:"strict_pullup",loading_method:"belt"}')" \
  "$(e_link "$DL" "$GID" "$LEGACY_GX" "$CUAM")"
performance "$ATHLETE_TOKEN" "$T-legacy" "$DL" 80 20 5
drain 'legacy kg-only score'
rpc "$OWNER_TOKEN" group_certify "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" --arg u "$ATHLETE_UID" --arg s "$T-legacy-set" \
  '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s}')"
expect_ok 'legacy narrow attestation';LEGACY_CERT="$(jq -er .certification.certification_id <<<"$BODY")"
drain 'legacy certified projection'
rpc "$OWNER_TOKEN" group_exercise_update "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" '{p_group_id:$g,p_exercise_id:$x,p_name:"Legacy pull-up",p_load_input_mode:"per_side_load"}')"
expect_error VALIDATION 'old rule writer must upgrade for calculation changes'
rpc "$OWNER_TOKEN" group_exercise_update_v2 "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" \
  '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:1,p_name:"Legacy pull-up",p_load_input_mode:"total_load",p_bodyweight_coefficient:1,p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
expect_ok 'explicit legacy activation';drain 'activate new bodyweight rules'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:true}')"
expect_ok 'activated certified board';check 'legacy certificate never attests bodyweight' '.entries==[]'
expect_sql 'original narrow attestation retained' "select ended_at is null from app_public.group_certifications where id='$LEGACY_CERT';" t
rpc "$OWNER_TOKEN" group_metric_revisions "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" '{p_group_id:$g,p_group_exercise_id:$x}')"
expect_ok 'original rules history';check 'original kg-only entries retain meaning' '.revisions[]|select(.legacy)|.rules.bodyweight_coefficient==0 and (.legacy_entries|length)>0'
pass 'legacy activation preserves old scores and does not migrate unpinned B'

# A departed member keeps the old revision, but never enters a new rule
# revision with a frozen score. Rejoin catches up the original shared sessions.
rpc "$OWNER_TOKEN" group_remove_member "$(jq -nc --arg g "$GID" --arg u "$ATHLETE_UID" '{p_group_id:$g,p_user_id:$u}')"
expect_ok 'remove athlete'
set_body_weight "$ATHLETE_TOKEN" "$T-two" 100
drain 'former member edit stays frozen'
metric_board absolute_strength
check 'former current revision retains old score' '.entries[]|select(.member.user_id==$a)|.former and .effective_resistance_kg==72' --arg a "$ATHLETE_UID"
rpc "$OWNER_TOKEN" group_exercise_update_v2 "$(jq -nc --arg g "$GID" --arg x "$GX" \
  '{p_group_id:$g,p_exercise_id:$x,p_expected_revision:2,p_name:"Strict pull-up",p_load_input_mode:"total_load",p_bodyweight_coefficient:0.8,p_movement_standard:"strict_pullup",p_loading_method:"belt",p_default_metric:"relative_strength"}')"
expect_ok 'rules with a former member';drain 'new revision excludes frozen former score'
metric_board absolute_strength
check 'no frozen score in new revision' '.rules_revision==3 and .entries==[]'
rpc "$OWNER_TOKEN" group_metric_board "$(jq -nc --arg g "$GID" --arg x "$GX" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false,p_revision:2}')"
expect_ok 'former archived revision';check 'original score remains in prior revision' '.entries[]|select(.member.user_id==$a)|.effective_resistance_kg==72' --arg a "$ATHLETE_UID"
rpc "$ATHLETE_TOKEN" group_join "$(jq -nc --arg c "$INVITE" '{p_code:$c}')";expect_ok 'athlete rejoins'
drain 'rejoin refreshes source and membership period'
metric_board absolute_strength
check 'new membership gets corrected score under current rules' '.entries[0].member.user_id==$a and (.entries[0].former|not) and .entries[0].effective_resistance_kg==110 and .entries[0].rules_revision==3' --arg a "$ATHLETE_UID"
expect_sql 'rejoin invalidates corrected old strength pin' "select end_reason from app_public.group_metric_certifications where id='$FAIL_CERT';" voided
pass 'former revision freeze and rejoin catch-up do not mix standards'

# Publication errors roll back every target row and event together. Retrying
# the queued generation publishes the complete graph after the fault is removed.
PUB_CONSTRAINT='groups_bw_force_publish_failure'
run_psql "alter table app_public.group_metric_board_entries add constraint ${PUB_CONSTRAINT} check(false) not valid;" >/dev/null
BEFORE_EVENT="$(run_psql "select coalesce(max(seq),0) from app_public.group_events where group_exercise_id='$GX';")"
next_cuam
push "$ATHLETE_TOKEN" 'performance during publication failure' "$(e_set "$T-two-set" "$T-two-se" 0 20 5 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
FAULT_OUT="$(mktemp)"
STATUS="$(curl --silent --show-error -X POST -H 'Content-Type: application/json' -H "x-group-eval-secret: ${EVAL_SECRET}" \
  -o "$FAULT_OUT" -w '%{http_code}' --data '{}' "${API_URL}/functions/v1/group-eval")"
BODY="$(cat "$FAULT_OUT")";rm -f "$FAULT_OUT"
expect_ok 'faulted publisher still reports drain result';check 'publication failed explicitly' '.failed>0 and ([.metric_jobs[]|select(.outcome=="failed" and .sqlstate=="23514")]|length)>0'
metric_board absolute_strength
check 'failed transaction retained previous complete score' '.entries[0].effective_resistance_kg==110'
expect_sql 'failed transaction wrote no events' "select count(*) from app_public.group_events where group_exercise_id='$GX' and seq>$BEFORE_EVENT;" 0
expect_sql 'failure queued bounded retry' "select attempts>0 and claim_id is null and available_at>now() from app_public.group_metric_eval_queue where group_exercise_id='$GX';" t
run_psql "alter table app_public.group_metric_board_entries drop constraint ${PUB_CONSTRAINT};
  update app_public.group_metric_eval_queue set available_at=now() where group_id in ('$GID','$GID2');" >/dev/null
drain 'retry failed atomic publication'
metric_board absolute_strength
check 'retry publishes fresh graph' '.entries[0].effective_resistance_kg==120'
pass 'personal sync commits; failed publisher rolls back and retries atomically'

# The v2 conventional family uses the generic reconciler too. Preserve Weight
# carry-forward, link attribution and final delete/undelete semantics there.
PARITY_RETURN_GX="$GX"
rpc "$OWNER_TOKEN" group_exercise_create_v2 "$(jq -nc --arg g "$GID" '{p_group_id:$g,p_name:"Conventional parity",p_load_input_mode:"total_load",p_source_exercise_id:null,p_bodyweight_coefficient:0,p_movement_standard:null,p_loading_method:null,p_default_metric:"e1rm"}')"
expect_ok 'new conventional comparison';GX="$(jq -er .exercise.group_exercise_id <<<"$BODY")"
DC="$T-carry-def";DC2="$T-carry-link-def"
next_cuam
push "$ATHLETE_TOKEN" 'conventional definitions' \
  "$(e_def "$DC" 'Conventional' "$CUAM" total_load)" \
  "$(e_def "$DC2" 'Second conventional' "$CUAM" total_load)" \
  "$(e_link "$DC" "$GID" "$GX" "$CUAM")"
performance "$ATHLETE_TOKEN" "$T-carry-base" "$DC" null 100 1
drain 'publish conventional baseline'
performance "$ATHLETE_TOKEN" "$T-carry-record" "$DC" null 120 5
drain 'new conventional record'
CARRY_EVENT="$(run_psql "select id from app_public.group_events where group_exercise_id='$GX' and kind='record' and set_id='$T-carry-record-set' order by seq desc limit 1;")"
[[ "$CARRY_EVENT" =~ $UUID_RE ]] || fail 'generic conventional improvement needs a record'
next_cuam
push "$ATHLETE_TOKEN" 'change reps at same weight' "$(e_set "$T-carry-record-set" "$T-carry-record-se" 0 120 8 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'same Weight carry and improved 1RM'
expect_sql 'old completed record remains with a void' "select count(*) from app_public.group_events where kind='record_voided' and related_event_id='$CARRY_EVENT';" 1
expect_sql 'replacement carries Weight and improved 1RM' "select count(distinct b ->> 'metric') from app_public.group_events e cross join lateral jsonb_array_elements(e.payload -> 'boards') b where e.group_exercise_id='$GX' and e.kind='record' and e.set_id='$T-carry-record-set' and not exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=e.id) and b ->> 'metric' in ('weight','e1rm') and b ->> 'unit'='kg';" 2
metric_board weight
check 'unchanged Weight is still 120 kg' '.entries[0].value==120 and .entries[0].performance.reps==8'
# Materializing unlinked observations must not celebrate them as counting PRs.
performance "$ATHLETE_TOKEN" "$T-retrolink" "$DC2" null 130 5
drain 'unlinked source before retroactive link'
BEFORE_LINK_RECORDS="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='record';")"
next_cuam
push "$ATHLETE_TOKEN" 'retroactive compatible link' "$(e_link "$DC2" "$GID" "$GX" "$CUAM")"
drain 'link attribution'
expect_sql 'link emits no performed record' "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='record';" "$BEFORE_LINK_RECORDS"
expect_sql 'link carries metric units' "select count(*) from app_public.group_events e where e.group_exercise_id='$GX' and e.kind='link' and exists(select 1 from jsonb_array_elements(e.payload -> 'effects') x where x ->> 'metric'='weight' and x -> 'after' ->> 'unit'='kg');" 1
metric_board weight
check 'linked higher set leads' '.entries[0].value==130'
next_cuam
push "$ATHLETE_TOKEN" 'unlink comparison' "$(e_link "$DC2" "$GID" "$GX" "$CUAM" | jq --argjson t "$CUAM" '.fields.deleted_at=$t')"
drain 'unlink attribution'
metric_board weight
check 'unlink reveals previous record' '.entries[0].value==120'
expect_sql 'unlink emits no performed record' "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='record';" "$BEFORE_LINK_RECORDS"
expect_sql 'unlink is attributed separately' "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='unlink';" 1

# All certification entrypoints retain subject/role checks and immediate reads.
metric_board weight
PARITY_PIN="$(jq -er '.entries[0].fingerprint' <<<"$BODY")"
PARITY_ARGS="$(jq -nc --arg g "$GID" --arg x "$GX" --arg u "$ATHLETE_UID" --arg s "$T-carry-record-set" --arg f "$PARITY_PIN" '{p_group_id:$g,p_group_exercise_id:$x,p_member_user_id:$u,p_set_id:$s,p_metric:"weight",p_expected_revision:1,p_expected_fingerprint:$f}')"
rpc "$ATHLETE_TOKEN" group_metric_certify "$PARITY_ARGS";expect_error VALIDATION 'self certification refused'
rpc "$OWNER_TOKEN" group_metric_certify "$(jq '.p_expected_fingerprint="stale"' <<<"$PARITY_ARGS")";expect_error CONFLICT 'stale performance refused'
PARITY_CERT="$(certify_metric "$ATHLETE_UID" "$T-carry-record" weight)";drain 'conventional certification'
END_ARGS="$(jq -nc --arg g "$GID" --arg c "$PARITY_CERT" '{p_group_id:$g,p_certification_id:$c,p_action:"withdraw"}')"
rpc "$RIVAL_TOKEN" group_metric_certification_end "$END_ARGS";expect_error FORBIDDEN 'another member cannot withdraw attestation'
rpc "$OWNER_TOKEN" group_metric_certification_end "$END_ARGS";expect_ok 'witness withdraws'
metric_board weight true
check 'withdrawal is hidden immediately before drain' '.entries==[]'
rpc "$OWNER_TOKEN" group_metric_certification_end "$END_ARGS";expect_ok 'withdrawal retry is idempotent'
PARITY_CERT="$(certify_metric "$ATHLETE_UID" "$T-carry-record" weight)";drain 'fresh attestation'
END_ARGS="$(jq -nc --arg g "$GID" --arg c "$PARITY_CERT" '{p_group_id:$g,p_certification_id:$c,p_action:"cancel"}')"
rpc "$RIVAL_TOKEN" group_metric_certification_end "$END_ARGS";expect_error FORBIDDEN 'member cannot cancel another attestation'
rpc "$OWNER_TOKEN" group_metric_certification_end "$END_ARGS";expect_ok 'owner cancels'
PARITY_CERT="$(certify_metric "$ATHLETE_UID" "$T-carry-record" weight)";drain 'fresh attestation before delete'
next_cuam
push "$ATHLETE_TOKEN" 'delete final record set' "$(e_set "$T-carry-record-set" "$T-carry-record-se" 0 120 8 '' "$CUAM" | jq --argjson t "$CUAM" '.fields += {weight_unit:"kg",external_load_mode:"added",deleted_at:$t}')"
drain 'final deletion'
metric_board weight
check 'deleted record reveals baseline' '.entries[0].value==100'
expect_sql 'deletion invalidates latest certificate' "select end_reason from app_public.group_metric_certifications where id='$PARITY_CERT';" voided
next_cuam
push "$ATHLETE_TOKEN" 'restore final record set' "$(e_set "$T-carry-record-set" "$T-carry-record-se" 0 120 8 '' "$CUAM" | jq '.fields += {weight_unit:"kg",external_load_mode:"added"}')"
drain 'restored performance'
metric_board weight
check 'undelete restores score without resurrecting attestation' '.entries[0].value==120 and (.entries[0].certified|not)'
GX="$PARITY_RETURN_GX"
pass 'generic conventional carry, link/unlink, certificate roles and final delete/undelete'


# Snapshot provenance is part of a strength attestation even when the numeric
# score is unchanged. Historical estimates remain explicitly visible.
EST_RETURN_GX="$GX";GX="$(create_comparison "$OWNER_TOKEN" "$GID" 1)";DE="$T-estimate-def"
next_cuam
push "$ATHLETE_TOKEN" 'estimated comparison definition' \
  "$(e_def "$DE" 'Estimate provenance' "$CUAM" total_load | jq '.fields += {bodyweight_coefficient:1,movement_standard:"strict_pullup",loading_method:"belt"}')" \
  "$(e_link "$DE" "$GID" "$GX" "$CUAM")"
# Establish publication before the completed improvement, to exercise records.
performance "$ATHLETE_TOKEN" "$T-est-base" "$DE" 80 0 5
drain 'estimate baseline'
performance "$ATHLETE_TOKEN" "$T-est-record" "$DE" 80 20 5
next_cuam
push "$ATHLETE_TOKEN" 'explicit estimated provenance' "$(e_session "$T-est-record" "$START" completed "$((START+60000))" 60 null "$CUAM" | jq --arg m "$T-est-reading" --argjson t "$((START+86400000))" '.fields += {body_weight_kg:80,body_weight_source:"historical_estimate",body_weight_measurement_id:$m,body_weight_measured_at:$t}')"
drain 'estimated strength result'
metric_board absolute_strength
check 'estimate is visible in ranked performance' '.entries[0].performance.body_weight_source=="historical_estimate" and .entries[0].performance.body_weight_measurement_id==$m' --arg m "$T-est-reading"
EST_CERT="$(certify_metric "$ATHLETE_UID" "$T-est-record" absolute_strength)"
rpc "$OWNER_TOKEN" group_metric_certification_get "$(jq -nc --arg g "$GID" --arg c "$EST_CERT" '{p_group_id:$g,p_certification_id:$c}')"
expect_ok 'estimated attestation detail';check 'certification retains estimate provenance' '.certification.includes_body_weight and .certification.performance.body_weight_source=="historical_estimate"'
drain 'estimated attestation'
EST_RECORDS="$(run_psql "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='record';")"
set_body_weight "$ATHLETE_TOKEN" "$T-est-record" 80
drain 'same amount, corrected provenance'
expect_sql 'provenance correction invalidates strength attestation' "select end_reason from app_public.group_metric_certifications where id='$EST_CERT';" voided
expect_sql 'equal numeric score is not a new performed record' "select count(*) from app_public.group_events where group_exercise_id='$GX' and kind='record';" "$EST_RECORDS"
metric_board absolute_strength
check 'current score retains amount with corrected provenance' '.entries[0].effective_resistance_kg==100 and .entries[0].performance.body_weight_source=="manual" and (.entries[0].certified|not)'
GX="$EST_RETURN_GX"
pass 'estimated provenance is visible and dependency-specific attestations follow corrections'

# Mixed legacy/generic readers must decode in the app and page without loss.
rpc "$OWNER_TOKEN" group_exercise_create "$(jq -nc --arg g "$GID" '{p_group_id:$g,p_name:"Still legacy",p_load_input_mode:"total_load",p_source_exercise_id:null}')"
expect_ok 'legacy identity beside generic comparisons'
for certified in true false; do
  rpc "$OWNER_TOKEN" group_metric_podiums "$(jq -nc --arg g "$GID" --argjson c "$certified" '{p_group_id:$g,p_certified:$c}')"
  expect_ok 'mixed podiums';assert_wire podiums
  check 'mixed podium types retain their own contracts' '([.exercises[]|select(.legacy)]|length)>0 and ([.exercises[]|select(.legacy|not)]|length)>0'
done
rpc "$OWNER_TOKEN" group_metric_revisions "$(jq -nc --arg g "$GID" --arg x "$LEGACY_GX" '{p_group_id:$g,p_group_exercise_id:$x}')"
expect_ok 'revision decoding';assert_wire revisions
for revision in 1 3; do
  rpc "$OWNER_TOKEN" group_metric_history "$(jq -nc --arg g "$GID" --arg x "$GX" --argjson r "$revision" '{p_group_id:$g,p_group_exercise_id:$x,p_metric:"absolute_strength",p_certified:false,p_revision:$r}')"
  expect_ok 'history decoding';assert_wire history
done
STREAM_CURSOR=null;STREAM_KEYS='[]';STREAM_PAGES=0
while :; do
  rpc "$OWNER_TOKEN" group_stream_v2 "$(jq -nc --arg g "$GID" --argjson c "$STREAM_CURSOR" '{p_group_id:$g,p_before:$c,p_limit:17}')"
  expect_ok 'mixed stream page';assert_wire stream
  STREAM_KEYS="$(jq -c --argjson old "$STREAM_KEYS" '$old+[.items[]|.kind+":"+.key]' <<<"$BODY")"
  jq -e 'length==(unique|length)' <<<"$STREAM_KEYS" >/dev/null || fail 'stream cursor duplicated an item'
  STREAM_CURSOR="$(jq -c .next_cursor <<<"$BODY")"
  STREAM_PAGES=$((STREAM_PAGES+1))
  [[ "$STREAM_CURSOR" != null ]] || break
  [[ $STREAM_PAGES -lt 100 ]] || fail 'stream cursor did not terminate'
done
jq -e 'map(split(":")[0])|unique|contains(["session","membership","record","record_voided","link","rules_change"])' <<<"$STREAM_KEYS" >/dev/null || fail 'mixed stream omitted an event family'
pass 'actual boards, podiums, revisions, history, attestations and paged stream decode in the mobile boundary'

COMPLETED=1
pass 'bodyweight backend vectors passed'
