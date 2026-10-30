#!/usr/bin/env bash
# Sourced by groups-contract: real lifecycle writes, opaque pages and disclosure.
cow_stream_events() {
  run_psql "select string_agg(payload->>'event',',' order by seq) from app_public.group_events
    where kind='cow' and payload->'definition'->>'cow_id'='$1';"
}

run_cow_stream_management_cases() {
  local group="$1" cow="$2" cursor page items='[]' before='' old_header token missing rollback_id
  [[ "$(cow_stream_events "${cow}")" == scheduled,updated,cancelled ]] || fail 'CoW management retries duplicated events'
  [[ "$(run_psql "select payload->'previous'->'metrics'<>payload->'definition'->'metrics'
    from app_public.group_events where kind='cow' and payload->'definition'->>'cow_id'='${cow}' and payload->>'event'='updated';")" == t ]] || fail 'CoW edit lost before snapshot'
  rollback_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  run_psql "begin; insert into app_public.group_cows select (jsonb_populate_record(null::app_public.group_cows,to_jsonb(c)||
    jsonb_build_object('id','${rollback_id}','cancelled_at',null))).* from app_public.group_cows c where id='${cow}'; rollback;" >/dev/null
  [[ "$(cow_stream_events "${rollback_id}")" == '' ]] || fail 'rolled-back schedule emitted an event'
  while true; do
    rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" --arg b "${before}" '{p_group_id:$g,p_before:(if $b=="" then null else $b end),p_limit:2}')"
    expect_ok 'CoW stream page'; page="${BODY}"
    items="$(jq -nc --argjson a "${items}" --argjson b "${page}" '$a+$b.items')"
    [[ "$(jq -r '.has_more' <<<"${page}")" == true ]] || break
    before="$(jq -r '.next_cursor' <<<"${page}")"
  done
  [[ "$(jq --arg c "${cow}" '[.[]|select(.kind=="cow" and .definition.cow_id==$c)]|length' <<<"${items}")" == 3 ]] || fail 'CoW pagination lost or duplicated events'
  [[ "$(jq '[.[].key]|length== (unique|length)' <<<"${items}")" == true ]] || fail 'CoW event keys collided'
  rpc "${OWNER_TOKEN}" group_competition_stream_v2 "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_limit:50}')"
  check 'old exact reader never receives a CoW variant' 'all(.items[];.kind!="cow")'
  rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_limit:1}')"
  cursor="$(jq -r '.next_cursor' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_competition_stream_v2 "$(jq -nc --arg g "${group}" --arg c "${cursor}" '{p_group_id:$g,p_before:$c}')"
  expect_error VALIDATION 'v3 cursor cannot enter v2'
  rpc "${OWNER_TOKEN}" group_competition_stream_v2 "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_limit:1}')"
  cursor="$(jq -r '.next_cursor' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" --arg c "${cursor}" '{p_group_id:$g,p_before:$c}')"
  expect_error VALIDATION 'v2 cursor cannot enter v3'
  rpc "${ANON_KEY}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g}')"
  expect_error AUTH_REQUIRED 'anonymous CoW stream'
  token="$(mint_token "${OWNER_TOKEN}" cow-stream)"
  rpc "${token}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g}')"
  expect_error AGENT_FORBIDDEN 'OAuth CoW stream'
  rpc "${OUTSIDER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g}')"
  expect_error NOT_FOUND 'outsider CoW stream'; missing="${BODY}"
  rpc "${OUTSIDER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${MISSING_GROUP}" '{p_group_id:$g}')"
  [[ "${BODY}" == "${missing}" ]] || fail 'CoW stream leaks group existence'
  old_header="${GROUP_CONTRACT_HEADER}"; GROUP_CONTRACT_HEADER='x-boga-group-contract: 3'
  rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g}')"
  expect_error UPDATE_REQUIRED 'old protocol CoW stream'; GROUP_CONTRACT_HEADER="${old_header}"
  pass 'CoW Stream management snapshots, retries, rollback, compatibility, authorization and pages'
}

run_cow_stream_final_cases() {
  local group="$1" cow="$2" secret="$3" empty items cursor before='' page node_guard
  [[ "$(cow_stream_events "${cow}")" == scheduled,started,ended,results ]] || fail 'worker-only CoW lifecycle missing or duplicated'
  empty="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  cow_worker_fixture "${cow}" "${empty}" 80
  run_psql "delete from app_public.group_cow_sources where cow_id='${empty}';" >/dev/null
  cow_run "${empty}" "${secret}"
  [[ "$(cow_stream_events "${empty}")" == started,ended,results ]] || fail 'empty final lifecycle'
  [[ "$(run_psql "select count(*) from app_public.group_events where group_id='${group}' and kind='cow' and payload->>'event'='unavailable';")" -gt 0 ]] || fail 'terminal unavailable event missing'
  [[ "$(run_psql "select count(*) from app_public.group_cows c join app_public.group_events e
    on e.payload->'definition'->>'cow_id'=c.id::text where c.group_id='${group}' and c.finalized_at is null
    and e.kind='cow' and e.payload->>'event' in ('results','unavailable');")" == 0 ]] || fail 'uncertainty emitted a terminal event'
  items='[]'
  while true; do
    rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" --arg b "${before}" '{p_group_id:$g,p_limit:50,p_before:(if $b=="" then null else $b end)}')"
    expect_ok 'final CoW Stream'; page="${BODY}"
    node_guard="$(printf '%s' "${BODY}" | node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
      import {isCompetitionStreamWire} from "./apps/mobile/src/groups/competition-reader-guards.ts";
      let data=""; for await (const chunk of process.stdin) data+=chunk;
      process.stdout.write(String(isCompetitionStreamWire(JSON.parse(data))));')"
    [[ "${node_guard}" == true ]] || fail 'real CoW Stream failed mobile decoder'
    items="$(jq -nc --argjson a "${items}" --argjson b "${page}" '$a+$b.items')"
    [[ "$(jq -r '.has_more' <<<"${page}")" == true ]] || break
    before="$(jq -r '.next_cursor' <<<"${page}")"
  done
  BODY="$(jq -nc --argjson i "${items}" '{items:$i}')"; STATUS=200
  check 'final event projections preserve original first places and suppress every unsafe kg figure' \
    'all(.items[]|select(.kind=="cow" and .result!=null and .result.normalized==false)|.result.rankings[].entries[];.value==null and .rank==1)'
  check 'valid empty final is not terminal unavailable' \
    'any(.items[];.kind=="cow" and .definition.cow_id==$c and .event=="results" and .result.state=="ready" and all(.result.rankings[];.entries==[]))' --arg c "${empty}"
  check 'Stream carries no private receipt or scoring context' \
    '([paths|select(.[-1]|IN("receivedAtUs","sourceToken","reading_pin","start_context","body_weight_kg","weight_kg"))]|length)==0'
  # Force a shared millisecond only in this fixture: causal sequence remains the
  # tie key even when a result and its cutoff have identical display timestamps.
  run_psql "update app_public.group_events set sort_at_ms=1 where kind='cow' and payload->'definition'->>'cow_id'='${empty}';" >/dev/null
  rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_limit:50}')"
  before="$(jq -r '.next_cursor // ""' <<<"${BODY}")"; items="$(jq '.items' <<<"${BODY}")"
  while [[ -n "${before}" ]]; do
    rpc "${OWNER_TOKEN}" group_competition_stream_v3 "$(jq -nc --arg g "${group}" --arg b "${before}" '{p_group_id:$g,p_limit:2,p_before:$b}')"
    expect_ok 'equal-time page'; items="$(jq -nc --argjson a "${items}" --argjson b "${BODY}" '$a+$b.items')"
    before="$(jq -r '.next_cursor // ""' <<<"${BODY}")"
  done
  [[ "$(jq -r --arg c "${empty}" '[.[]|select(.kind=="cow" and .definition.cow_id==$c)|.event]|join(",")' <<<"${items}")" == results,ended,started ]] || fail 'equal-millisecond causal order lost'
  pass 'CoW worker-only Stream, empty/unavailable finals, current disclosure, exact decoding and equal-time ordering'
  run_cow_stream_lock_case "${group}" "${cow}" "${secret}"
}

run_cow_stream_lock_case() {
  local group="$1" template="$2" secret="$3" id holder holder_pid claim deadline log_dir
  id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  cow_worker_fixture "${template}" "${id}" 81
  run_psql "update app_public.group_cows set available_at=clock_timestamp() where id='${id}';" >/dev/null
  holder="cow-row-lock-${RUN_TAG}"; log_dir="$(mktemp -d)"
  (run_psql_once "select set_config('application_name','${holder}',false); begin;
    select id from app_public.groups where id='${group}' for update;
    select pg_sleep(2);
    select pg_advisory_xact_lock(hashtextextended('group-cow:'||'${group}',0)); commit;") >"${log_dir}/holder" 2>&1 & holder_pid=$!
  deadline=$((SECONDS+10))
  until [[ "$(run_psql "select exists(select 1 from pg_stat_activity where application_name='${holder}' and wait_event='PgSleep');")" == t ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || { wait "${holder_pid}" || true; fail 'management lock fixture did not start'; }
    sleep 0.02
  done
  claim="$(run_psql 'select app_public.group_cow_eval_claim(20);')"
  wait "${holder_pid}" || fail 'CoW worker inverted the management lock order'
  [[ "$(jq --arg c "${id}" 'all(.jobs[];.cow_id!=$c)' <<<"${claim}")" == true ]] || fail 'claim took the fence before a locked group row'
  [[ "$(cow_stream_events "${id}")" == '' ]] || fail 'skipped claim emitted start'
  cow_run "${id}" "${secret}"
  [[ "$(cow_stream_events "${id}")" == started,ended,results ]] || fail 'claim failed after management released the row'
  rm -rf "${log_dir}"
  pass 'CoW claim takes the group FK row lock before the intake fence, without management deadlocks'
}
