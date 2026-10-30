#!/usr/bin/env bash
# Real receipts and the real Edge scorer; only the test moves the fixture's window.
run_cow_publication_cases() {
  local g e c invite started baseline_ms weekly_ms next_week owner_def member_def member_id token name args normalized old_header
  local c2 saved deadline claim graph evaluation publication secret
  echo '[groups-contract] CoW publication, elected bodyweight units and final history'
  rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "CoW publication ${RUN_TAG}" '{p_name:$n,p_description:null,p_time_zone:"UTC"}')"
  expect_ok 'create CoW publication group'; g="$(jq -r '.group_id' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${g}" '{p_group_id:$g}')"; invite="$(jq -r '.code' <<<"${BODY}")"
  rpc "${MEMBER_TOKEN}" group_join "$(jq -nc --arg c "${invite}" '{p_code:$c}')"; expect_ok 'publication member joins'
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${g}" --arg n "CoW publication ${RUN_TAG}" '{p_group_id:$g,p_name:$n,p_description:null,p_bodyweight_calculations_enabled:true}')"
  expect_ok 'elect group bodyweight scoring'
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(b_gx_create "${g}" 'CoW elected comparison' total_load | jq '.p_bodyweight_contribution=1')"
  expect_ok 'create elected comparison'; e="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
  baseline_ms="$(run_psql 'select floor(extract(epoch from clock_timestamp())*1000)::bigint;')"
  owner_def="cow-pub-owner-${RUN_TAG}"; member_def="cow-pub-member-${RUN_TAG}"
  for member_id in "${OWNER_UID}" "${MEMBER_UID}"; do
    normalized=80; [[ "${member_id}" == "${OWNER_UID}" ]] || normalized=100
    run_psql "begin; select set_config('request.jwt.claims',jsonb_build_object('sub','${member_id}','role','authenticated')::text,true);
      insert into app_public.body_weight_measurements(owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
      values('${member_id}','cow-pub-reading-${RUN_TAG}',${normalized},${baseline_ms}-1,${baseline_ms},${baseline_ms},${baseline_ms}); commit;" >/dev/null
  done
  next_cuam
  push "${OWNER_TOKEN}" 'owner pre-week shared baseline' "$(e_def "${owner_def}" Owner "${CUAM}")" \
    "$(e_session "cow-pub-ob-${RUN_TAG}" "${baseline_ms}" completed "$((baseline_ms+1))" 1 null "${CUAM}")" \
    "$(e_se "cow-pub-oblock-${RUN_TAG}" "cow-pub-ob-${RUN_TAG}" "${owner_def}" 0 Owner "${CUAM}" null)" \
    "$(e_set "cow-pub-obase-${RUN_TAG}" "cow-pub-oblock-${RUN_TAG}" 0 20 1 '' "${CUAM}" null)" \
    "$(e_link "${owner_def}" "${g}" "${e}" "${CUAM}")"
  next_cuam
  push "${MEMBER_TOKEN}" 'member pre-week shared baseline' "$(e_def "${member_def}" Member "${CUAM}")" \
    "$(e_session "cow-pub-mb-${RUN_TAG}" "${baseline_ms}" completed "$((baseline_ms+1))" 1 null "${CUAM}")" \
    "$(e_se "cow-pub-mblock-${RUN_TAG}" "cow-pub-mb-${RUN_TAG}" "${member_def}" 0 Member "${CUAM}" null)" \
    "$(e_set "cow-pub-mbase-${RUN_TAG}" "cow-pub-mblock-${RUN_TAG}" 0 50 1 '' "${CUAM}" null)" \
    "$(e_link "${member_def}" "${g}" "${e}" "${CUAM}")"
  rpc "${OWNER_TOKEN}" group_cow_calendar_get "$(jq -nc --arg g "${g}" '{p_group_id:$g}')"; next_week="$(jq -r '.next_week_start' <<<"${BODY}")"
  c="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  rpc "${OWNER_TOKEN}" group_cow_create "$(jq -nc --arg g "${g}" --arg e "${e}" --arg c "${c}" --arg w "${next_week}" \
    '{p_group_id:$g,p_cow_id:$c,p_group_exercise_id:$e,p_metrics:["e1rm","improvement","volume"],p_calendar_revision:1,p_week_start:$w}')"
  expect_ok 'schedule publication fixture'
  run_psql "update app_public.group_cows set starts_at=clock_timestamp()+interval '100 milliseconds',
    ends_at=clock_timestamp()+interval '7 days',available_at=clock_timestamp(),week_start=app_public.group_cow_week('UTC',clock_timestamp()) where id='${c}';
    do \$edge\$ begin while clock_timestamp()<(select starts_at from app_public.group_cows where id='${c}') loop perform pg_sleep(0.01); end loop; end \$edge\$;" >/dev/null
  weekly_ms="$(run_psql 'select ceil(extract(epoch from clock_timestamp())*1000)::bigint;')"
  next_cuam
  push "${OWNER_TOKEN}" 'two owner weekly contributions' "$(e_session "cow-pub-ow-${RUN_TAG}" "${weekly_ms}" completed "$((weekly_ms+1))" 1 null "${CUAM}")" \
    "$(e_se "cow-pub-owblock-${RUN_TAG}" "cow-pub-ow-${RUN_TAG}" "${owner_def}" 0 Owner "${CUAM}" null)" \
    "$(e_set "cow-pub-o1-${RUN_TAG}" "cow-pub-owblock-${RUN_TAG}" 0 40 1 '' "${CUAM}" null)" \
    "$(e_set "cow-pub-o2-${RUN_TAG}" "cow-pub-owblock-${RUN_TAG}" 1 0 2 '' "${CUAM}" null)" \
    "$(e_set "cow-pub-warmup-${RUN_TAG}" "cow-pub-owblock-${RUN_TAG}" 2 999 1 '' "${CUAM}" null warm_up)"
  next_cuam
  push "${MEMBER_TOKEN}" 'two member weekly contributions' "$(e_session "cow-pub-mw-${RUN_TAG}" "${weekly_ms}" completed "$((weekly_ms+1))" 1 null "${CUAM}")" \
    "$(e_se "cow-pub-mwblock-${RUN_TAG}" "cow-pub-mw-${RUN_TAG}" "${member_def}" 0 Member "${CUAM}" null)" \
    "$(e_set "cow-pub-m1-${RUN_TAG}" "cow-pub-mwblock-${RUN_TAG}" 0 60 1 '' "${CUAM}" null)" \
    "$(e_set "cow-pub-m2-${RUN_TAG}" "cow-pub-mwblock-${RUN_TAG}" 1 0 1 '' "${CUAM}" null)"
  secret="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
  eval_drain "${secret}"; expect_ok 'real CoW worker drains'
  [[ "$(run_psql "select coalesce(last_error,'ok') from app_public.group_cows where id='${c}';")" == ok ]] || fail 'CoW publication worker failed'
  rpc "${MEMBER_TOKEN}" group_cow_results "$(jq -nc --arg g "${g}" --arg c "${c}" '{p_group_id:$g,p_cow_id:$c,p_metric:"volume"}')"
  expect_ok 'member reads normalized CoW volume'
  check 'group-elected volume sums distinct sets and excludes warmup' '.state=="ready" and .normalized==true and .rankings[0].unit=="percent_bw_reps" and [.rankings[0].entries[].value]==[350,260]'
  check 'owner wins Volume independently' '.rankings[0].entries[0].member.user_id==$u' --arg u "${OWNER_UID}"
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${g}" --arg c "${c}" '{p_group_id:$g,p_cow_id:$c,p_metric:"e1rm"}')"
  check 'bodyweight 1RM uses the normal group units' '.rankings[0].unit=="percent_bw" and [.rankings[0].entries[].value]==[160,150]'
  check 'member wins 1RM independently' '.rankings[0].entries[0].member.user_id==$u' --arg u "${MEMBER_UID}"
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${g}" --arg c "${c}" '{p_group_id:$g,p_cow_id:$c,p_metric:"improvement"}')"
  check 'improvement compares normalized baseline and weekly 1RM' '.rankings[0].unit=="percent" and (.rankings[0].entries[0].value-20|fabs)<0.000000001 and .rankings[0].entries[0].member.user_id==$u' --arg u "${OWNER_UID}"
  rpc "${OWNER_TOKEN}" group_cow_summary "$(jq -nc --arg g "${g}" '{p_group_id:$g}')"
  check 'Today serves all independent top-three metrics under one CoW and valid boundary' '.selection=="current" and .result.cow.cow_id==$c and (.result.rankings|length)==3 and .valid_until_us>.observed_at_us' --arg c "${c}"
  for name in group_cow_results group_cow_summary; do
    args="$(jq -nc --arg g "${g}" --arg c "${c}" '{p_group_id:$g,p_cow_id:$c,p_metric:"volume"}')"
    [[ "${name}" == group_cow_results ]] || args="$(jq -nc --arg g "${g}" '{p_group_id:$g}')"
    old_header="${GROUP_CONTRACT_HEADER}"; GROUP_CONTRACT_HEADER='x-boga-group-contract: 3'
    rpc "${OWNER_TOKEN}" "${name}" "${args}"; expect_error UPDATE_REQUIRED 'old CoW result protocol'; GROUP_CONTRACT_HEADER="${old_header}"
    rpc "${ANON_KEY}" "${name}" "${args}"; expect_error AUTH_REQUIRED 'anonymous CoW results'
    token="$(mint_token "${OWNER_TOKEN}" cow-results)"; rpc "${token}" "${name}" "${args}"; expect_error AGENT_FORBIDDEN 'OAuth CoW results'
    rpc "${OUTSIDER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND 'outsider CoW results'; saved="${BODY}"
    rpc "${OUTSIDER_TOKEN}" "${name}" "$(jq --arg g "${MISSING_GROUP}" '.p_group_id=$g' <<<"${args}")"
    [[ "${BODY}" == "${saved}" ]] || fail 'CoW result existence leaked'
  done
  # No app read finalizes it: the existing scheduled sweep invokes the worker.
  run_psql "update app_public.group_cows set ends_at=clock_timestamp()+interval '100 milliseconds',
    week_start=app_public.group_cow_week('UTC',clock_timestamp())-7,available_at=clock_timestamp() where id='${c}';
    do \$edge\$ begin while clock_timestamp()<(select ends_at from app_public.group_cows where id='${c}') loop perform pg_sleep(0.01); end loop; end \$edge\$;
    select app_public.group_eval_sweep();" >/dev/null
  deadline=$((SECONDS+25))
  until [[ "$(run_psql "select finalized_at is not null from app_public.group_cows where id='${c}';")" == t ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail "automatic CoW finalization failed: $(run_psql "select coalesce(last_error,'not claimed') from app_public.group_cows where id='${c}';")"
    sleep 0.1
  done
  saved="$(run_psql "select final_rankings::text from app_public.group_cows where id='${c}';")"
  next_cuam
  push "${OWNER_TOKEN}" 'post-cutoff edit cannot rerank final' "$(e_set "cow-pub-o1-${RUN_TAG}" "cow-pub-owblock-${RUN_TAG}" 0 1 1 '' "${CUAM}" null)"
  eval_drain "${secret}"; expect_ok 'worker after cutoff edit'
  [[ "$(run_psql "select final_rankings::text from app_public.group_cows where id='${c}';")" == "${saved}" ]] || fail 'stored final reranked'
  rpc "${OWNER_TOKEN}" group_cow_summary "$(jq -nc --arg g "${g}" '{p_group_id:$g}')"
  check 'exactly last-week stored final is the fallback' '.selection=="previous_final" and .result.cow.state=="final" and .result.state=="ready"'
  run_cow_worker_cases "${g}" "${c}" "${secret}"
  run_cow_priority_privacy_cases "${g}" "${c}" "${secret}"
  run_cow_stream_final_cases "${g}" "${c}" "${secret}"
  pass 'CoW elected %BW units, normalized improvement, automatic finalization, frozen results and authorization'
}

# Retained real source graphs are copied into isolated worker fixtures. These
# probes control barriers/leases, not scorer output; every score uses group-eval.
cow_worker_fixture() {
  local template="$1" id="$2" offset="$3"
  run_psql "begin; set local session_replication_role=replica; insert into app_public.group_cows select (jsonb_populate_record(null::app_public.group_cows,to_jsonb(c)||
      jsonb_build_object('id','${id}','week_start',c.week_start-${offset},'start_context',null,'start_high_water',null,
        'end_high_water',null,'context_changed_at',null,'finalized_at',null,'final_outcome',null,'final_rankings',null,
        'published_at',null,'published_generation',null,'live_rankings',null,'publication_id',null,
        'claim_id',null,'lease_until',null,'attempts',0,'last_error',null,'available_at',clock_timestamp()+interval '1 day'))).* 
    from app_public.group_cows c where id='${template}';
    insert into app_public.group_cow_admissions select '${id}',membership_id,member_user_id,joined_at,ended_at,joined_xid,ended_xid
      from app_public.group_cow_admissions where cow_id='${template}';
    insert into app_public.group_cow_contexts(cow_id,received_at,source_xid,context)
      select '${id}',received_at,source_xid,context from app_public.group_cow_contexts where cow_id='${template}';
    insert into app_public.group_cow_sources(cow_id,member_user_id,set_id,received_at,source_xid,input,input_key)
      select '${id}',member_user_id,set_id,received_at,source_xid,input,input_key from app_public.group_cow_sources where cow_id='${template}'; commit;" >/dev/null
}
cow_claim() {
  run_psql "begin; update app_public.group_cows set available_at=clock_timestamp(),lease_until=null where id='$1';
    select j from jsonb_array_elements(app_public.group_cow_eval_claim()->'jobs') j where j->>'cow_id'='$1'; commit;"
}
cow_run() {
  local deadline=$((SECONDS+25))
  run_psql "update app_public.group_cows set available_at=clock_timestamp(),lease_until=null where id='$1';" >/dev/null
  eval_drain "$2"; expect_ok 'worker fixture drains'
  # A pg_net kick can own the claim before the direct drain reaches it.
  until [[ "$(run_psql "select lease_until is null or lease_until<clock_timestamp() from app_public.group_cows where id='$1';")" == t ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail 'worker fixture claim did not settle'
    sleep 0.05
  done
}
run_cow_worker_cases() {
  local group="$1" template="$2" secret="$3" id claim generation lease prepared cursor saved row_id baseline_count
  local index=30 ids=() label
  for label in retry stale membership context_during context_after uncertainty legacy; do
    id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"; ids+=("${id}")
    cow_worker_fixture "${template}" "${id}" "${index}"; index=$((index+1))
  done
  id="${ids[0]}"; claim="$(cow_claim "${id}")"; generation="$(jq -r '.generation' <<<"${claim}")"; lease="$(jq -r '.claim_id' <<<"${claim}")"
  [[ "$(run_psql "select app_public.group_cow_eval_prepare('${id}',${generation},'${lease}')->>'prepared';")" == true ]] || fail 'worker preparation'
  run_psql "update app_public.group_cows set lease_until=clock_timestamp()-interval '1 second' where id='${id}';" >/dev/null
  eval_drain "${secret}"; expect_ok 'crashed claim recovered'
  [[ "$(run_psql "select finalized_at is not null from app_public.group_cows where id='${id}';")" == t ]] || fail 'expired claim did not finalize'
  [[ "$(run_psql "select app_public.group_cow_eval_publish('${id}',${generation},'${lease}',1,'old','{}')->>'completed';")" == false ]] || fail 'old claim overwrote final'
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${id}" '{p_group_id:$g,p_cow_id:$c,p_metric:"e1rm",p_limit:1}')"
  expect_ok 'first result page'; cursor="$(jq -r '.rankings[0].next_cursor' <<<"${BODY}")"; saved="$(jq -r '.rankings[0].entries[0].member.user_id' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${id}" --arg before "${cursor}" '{p_group_id:$g,p_cow_id:$c,p_metric:"e1rm",p_limit:1,p_before:$before}')"
  check 'second page preserves original rank and skips first member' '.rankings[0].entries[0].rank==2 and .rankings[0].entries[0].member.user_id!=$u' --arg u "${saved}"
  cursor="$(jq '.publication="stale-publication"' <<<"${cursor}")"
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${id}" --arg before "${cursor}" '{p_group_id:$g,p_cow_id:$c,p_metric:"e1rm",p_before:$before}')"
  expect_error CONFLICT 'pagination refuses a different publication'
  id="${ids[1]}"
  run_psql "update app_public.group_cows set ends_at=clock_timestamp()+interval '1 day' where id='${id}';" >/dev/null
  claim="$(cow_claim "${id}")"; generation="$(jq -r '.generation' <<<"${claim}")"; lease="$(jq -r '.claim_id' <<<"${claim}")"
  run_psql "update app_public.group_cows set generation=generation+1,available_at=clock_timestamp()+interval '1 day' where id='${id}';" >/dev/null
  [[ "$(run_psql "select app_public.group_cow_eval_prepare('${id}',${generation},'${lease}')->>'prepared';")" == false ]] || fail 'stale live generation prepared'
  [[ "$(run_psql "begin;
    update app_public.group_cows set ends_at=clock_timestamp()+interval '100 milliseconds',published_generation=generation,
      live_rankings=jsonb_build_object('state','ready','rankings','[]'::jsonb) where id='${id}';
    do \$edge\$ begin while clock_timestamp()<(select ends_at from app_public.group_cows where id='${id}') loop perform pg_sleep(0.01); end loop; end \$edge\$;
    select app_public.group_cow_public_state(c) from app_public.group_cows c where id='${id}'; rollback;")" == pending ]] || fail 'a read crossing end exposed old live scores'
  id="${ids[2]}"
  run_psql "update app_public.group_cow_admissions a set ended_at=(select max(s.received_at)+interval '1 microsecond'
      from app_public.group_cow_sources s join app_public.group_cows c on c.id=s.cow_id
      where s.cow_id=a.cow_id and s.member_user_id=a.member_user_id and s.received_at<c.ends_at)
      where cow_id='${id}' and member_user_id='${MEMBER_UID}';
    insert into app_public.group_cow_admissions select '${id}',extensions.gen_random_uuid(),'${JOINER_UID}',starts_at+interval '1 second',null,0,null
      from app_public.group_cows where id='${id}';
    insert into app_public.group_cow_admissions select '${id}',extensions.gen_random_uuid(),'${MEMBER_UID}',ends_at+interval '1 second',null,0,null
      from app_public.group_cows where id='${id}';" >/dev/null
  cow_run "${id}" "${secret}"
  [[ "$(run_psql "select count(*) from app_public.group_cow_participants where cow_id='${id}';")" == 2 ]] || fail 'delayed start admitted late join/rejoin'
  [[ "$(run_psql "select ended_at is not null from app_public.group_cow_participants where cow_id='${id}' and member_user_id='${MEMBER_UID}';")" == t ]] || fail 'first membership end lost'
  for index in 3 4; do
    id="${ids[index]}"
    run_psql "insert into app_public.group_cow_contexts(cow_id,received_at,source_xid,context)
      select id,case when ${index}=3 then starts_at+interval '1 microsecond' else ends_at end,0,
        jsonb_set((select context from app_public.group_cow_contexts where cow_id=c.id order by id limit 1),'{available}','false')
      from app_public.group_cows c where id='${id}';" >/dev/null
    cow_run "${id}" "${secret}"
    saved=ready; [[ ${index} != 3 ]] || saved=unavailable
    [[ "$(run_psql "select final_outcome from app_public.group_cows where id='${id}';")" == "${saved}" ]] || fail 'context cutoff misclassified'
  done
  id="${ids[5]}"
  run_psql "insert into app_public.group_cow_intake_failures(cow_id,source_xid,failed_at,sqlstate)
    select id,0,starts_at+interval '1 microsecond','TESTX' from app_public.group_cows where id='${id}';" >/dev/null
  cow_run "${id}" "${secret}"
  [[ "$(run_psql "select finalized_at is null and last_error='COW01' and attempts>0 from app_public.group_cows where id='${id}';")" == t ]] || fail 'uncertain intake published a final'
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${id}" '{p_group_id:$g,p_cow_id:$c,p_metric:"volume"}')"
  check 'uncertain final remains retryable pending with no partial figures' '.state=="pending" and .cow.state=="finalizing" and .rankings[0].entries==[]'
  id="${ids[6]}"
  run_psql "update app_public.group_cow_sources set input=jsonb_set(input,'{exercise_definition_id}','\"\"') where cow_id='${id}';" >/dev/null
  saved="$(run_psql "select string_agg(s.id::text||':'||s.received_at::text,',' order by s.id) from app_public.group_cow_sources s join app_public.group_cows c on c.id=s.cow_id where cow_id='${id}' and received_at<c.ends_at;")"
  run_psql "select app_public.group_cow_capture('${id}');" >/dev/null
  [[ "$(run_psql "select string_agg(s.id::text||':'||s.received_at::text,',' order by s.id) from app_public.group_cow_sources s join app_public.group_cows c on c.id=s.cow_id where cow_id='${id}' and received_at<c.ends_at;")" == "${saved}" ]] || fail 'legacy identity reset receipt priority'
  cow_run "${id}" "${secret}"
  [[ "$(run_psql "select final_outcome from app_public.group_cows where id='${id}';")" == ready ]] || fail 'legacy receipts stranded'
  pass 'CoW expired claims, immutable retries, pagination, delayed roster, context cutoffs, uncertainty and legacy priorities'
}

run_cow_priority_privacy_cases() {
  local group="$1" template="$2" secret="$3" id index saved minimum cursor ordinary
  for index in 0 1 2; do
    id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
    cow_worker_fixture "${template}" "${id}" "$((50+index))"
    run_psql "update app_public.group_cow_sources set input=jsonb_set(input,'{weight_value}','\"48\"')
        where cow_id='${id}' and set_id='cow-pub-o1-${RUN_TAG}';
      update app_public.group_cow_sources set input=jsonb_set(input,'{reps_value}','\"1\"')
        where cow_id='${id}' and set_id='cow-pub-o2-${RUN_TAG}';" >/dev/null
    if [[ ${index} == 1 ]]; then
      # A revised equal 1RM, and a removed/replaced Volume contribution, both
      # get a later authoritative version even though attained totals tie.
      run_psql "insert into app_public.group_cow_sources(cow_id,member_user_id,set_id,received_at,source_xid,input,input_key)
        select s.cow_id,s.member_user_id,s.set_id,(select max(received_at)+interval '1 microsecond' from app_public.group_cow_sources
          where cow_id=s.cow_id and received_at<c.ends_at),0,
          case when s.set_id='cow-pub-o2-${RUN_TAG}' then jsonb_set(s.input,'{eligible}','false') else s.input end,'fixture'
        from app_public.group_cow_sources s join app_public.group_cows c on c.id=s.cow_id
        where s.cow_id='${id}' and s.set_id in ('cow-pub-o1-${RUN_TAG}','cow-pub-o2-${RUN_TAG}') and s.received_at<c.ends_at;
        insert into app_public.group_cow_sources(cow_id,member_user_id,set_id,received_at,source_xid,input,input_key)
        select s.cow_id,s.member_user_id,'replacement',(select max(received_at) from app_public.group_cow_sources
          where cow_id=s.cow_id and received_at<c.ends_at),0,s.input,'fixture'
        from app_public.group_cow_sources s join app_public.group_cows c on c.id=s.cow_id
        where s.cow_id='${id}' and s.set_id='cow-pub-o2-${RUN_TAG}' and s.input->'eligible'='true' and s.received_at<c.ends_at;" >/dev/null
    elif [[ ${index} == 2 ]]; then
      run_psql "update app_public.group_cow_sources s set received_at=(select max(received_at) from app_public.group_cow_sources
          where cow_id=s.cow_id and received_at<c.ends_at)
        from app_public.group_cows c where c.id=s.cow_id and s.cow_id='${id}' and s.received_at>=c.starts_at and s.received_at<c.ends_at;" >/dev/null
    fi
    cow_run "${id}" "${secret}"
    saved="${OWNER_UID}"; [[ ${index} != 1 ]] || saved="${MEMBER_UID}"
    if [[ ${index} == 2 ]]; then saved="$(run_psql "select least('${OWNER_UID}'::text collate \"C\",'${MEMBER_UID}'::text collate \"C\");")"; fi
    [[ "$(run_psql "select bool_and(r->'entries'->0->>'memberId'='${saved}') from app_public.group_cows,
      lateral jsonb_array_elements(final_rankings) r where id='${id}' and r->>'metric' in ('e1rm','volume');")" == t ]] || fail "receipt tie order ${index}"
  done
  # Ordinary stored results remain fixed while current disclosure can suppress
  # all their figures, even after their original source has been unlinked.
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_name:"CoW privacy",p_description:null,p_bodyweight_calculations_enabled:false}')"
  expect_ok 'ordinary CoW context'
  ordinary="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  cow_worker_fixture "${template}" "${ordinary}" 60
  run_psql "update app_public.group_cow_contexts set context=jsonb_set(jsonb_set(context,'{normalized}','false'),'{bodyweight_calculations_enabled}','false') where cow_id='${ordinary}';
    update app_public.group_cow_sources set input=jsonb_set(input,'{context}',jsonb_set(jsonb_set(input->'context','{normalized}','false'),'{bodyweight_calculations_enabled}','false')) where cow_id='${ordinary}';" >/dev/null
  cow_run "${ordinary}" "${secret}"
  [[ "$(run_psql "select finalized_at is not null from app_public.group_cows where id='${ordinary}';")" == t ]] || fail 'ordinary privacy fixture did not finalize'
  saved="$(run_psql "select md5(final_rankings::text) from app_public.group_cows where id='${ordinary}';")"
  rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${ordinary}" '{p_group_id:$g,p_cow_id:$c,p_metric:"volume"}')"
  check 'ordinary stored totals use kg units and keep all eligible members' '.state=="ready" and .normalized==false and .rankings[0].unit=="kg_reps" and all(.rankings[0].entries[];.value>0)'
  next_cuam
  push "${OWNER_TOKEN}" 'unlink original counted source after final' "$(e_link "cow-pub-owner-${RUN_TAG}" "${group}" "${e}" "${CUAM}" "${CUAM}")"
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${group}" '{p_group_id:$g,p_name:"CoW privacy",p_description:null,p_bodyweight_calculations_enabled:true}')"
  expect_ok 'enable current normalized disclosure'
  for index in e1rm volume improvement; do
    rpc "${OWNER_TOKEN}" group_cow_results "$(jq -nc --arg g "${group}" --arg c "${ordinary}" --arg m "${index}" '{p_group_id:$g,p_cow_id:$c,p_metric:$m}')"
    check 'current disclosure suppresses every unsafe historical counterpart without promoting winners' 'all(.rankings[0].entries[];.value==null and .state=="unavailable") and .rankings[0].entries[0].rank==1'
  done
  rpc "${OWNER_TOKEN}" group_competition_session_detail "$(jq -nc --arg g "${group}" --arg u "${OWNER_UID}" --arg s "cow-pub-ob-${RUN_TAG}" '{p_group_id:$g,p_member_user_id:$u,p_session_id:$s}')"
  expect_ok 'baseline endpoint under current disclosure'
  check 'a paired baseline endpoint cannot expose the source kg after unlink' 'all(.session.exercises[];.visibility=="normalized" and all(.sets[];has("weight_value")|not))'
  local actual; actual="$(run_psql "select md5(final_rankings::text) from app_public.group_cows where id='${ordinary}';")"
  [[ "${actual}" == "${saved}" ]] || fail "privacy change reranked stored outcome (expected ${saved}, got ${actual})"
  pass 'CoW input revisions/removals and UUID ties; ordinary totals and paired baseline disclosure after unlink'
}
