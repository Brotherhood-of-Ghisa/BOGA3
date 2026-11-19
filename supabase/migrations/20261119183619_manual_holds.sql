-- Coordinate protocol activation with the app release; do not deploy this cutover alone.
-- Saved measurement identity follows [[exercise.recording-mode]]; clocks stay intact.
-- Preserve valid pending confirmations across the source-shape upgrade.
create temporary table manual_hold_current_contexts as
select w.member_user_id,w.session_id from app_public.notification_workouts w
where w.eligible and w.confirmed_at is not null
  and w.completion_at+interval '24 hours'>now()
  and (w.enqueued_generation<w.generation or exists(
    select 1 from app_public.notification_intents n
    join app_public.notification_deliveries d on d.intent_id=n.id
    where n.lifter_user_id=w.member_user_id and n.session_id=w.session_id and n.kind='completion'
      and d.state in ('pending','retry','disabled','leased','sending')))
  and w.manifest_digest=app_public.notification_manifest_digest(w.member_user_id,w.session_id)
  and w.context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id);
-- End pending-confirmation capture.

alter table app_public.exercise_definitions add column recording_mode text not null default 'reps'
  check (recording_mode in ('reps','hold'));
alter table app_public.exercise_sets add column recording_mode text not null default 'reps'
  check (recording_mode in ('reps','hold'));
alter table app_public.exercise_sets add column duration_sec integer;
alter table app_public.session_plan_sets add column recording_mode text not null default 'reps'
  check (recording_mode in ('reps','hold'));
alter table app_public.session_plan_sets add column target_duration_sec integer;
alter table app_public.session_plan_sets alter column target_reps drop not null;
alter table app_public.session_plan_sets add constraint session_plan_sets_target_measurement_valid check (
  (recording_mode='reps' and target_reps is not null and target_duration_sec is null) or
  (recording_mode='hold' and target_reps is null and target_duration_sec between 1 and 300 and target_duration_sec is not null)
);

-- A performed hold fact counts activity without fabricating reps or strength.
alter table app_public.group_set_facts drop constraint group_set_facts_performed_values;
alter table app_public.group_set_facts add constraint group_set_facts_performed_values check (
  (performed and weight_kg is not null and weight_kg >= 0 and
    ((reps is not null and reps > 0) or (reps is null and e1rm_kg is null)))
  or (not performed and weight_kg is null and reps is null and e1rm_kg is null)
);

-- Guard every patch against migration drift; ownership, LWW and revision fences remain in their existing bodies.
do $migration$
declare target text; anchor text; replacement text; definition text;
begin
  for target,anchor,replacement in select * from (values
    ('app_public.sync_push(jsonb)',$anchor$owner_user_id,id,name,load_input_mode,$anchor$,$replacement$owner_user_id,id,name,recording_mode,load_input_mode,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$_uid,_id,_fields->>'name',_fields->>'load_input_mode',$anchor$,$replacement$_uid,_id,_fields->>'name',coalesce(_fields->>'recording_mode','reps'),_fields->>'load_input_mode',$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$name=excluded.name,load_input_mode=excluded.load_input_mode,$anchor$,$replacement$name=excluded.name,recording_mode=case when _fields ? 'recording_mode' then excluded.recording_mode else app_public.exercise_definitions.recording_mode end,load_input_mode=excluded.load_input_mode,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$order_index,weight_value,reps_value,set_type,$anchor$,$replacement$order_index,weight_value,reps_value,recording_mode,duration_sec,set_type,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$coalesce(_fields->>'reps_value',''),_fields->>'set_type',$anchor$,$replacement$coalesce(_fields->>'reps_value',''),coalesce(_fields->>'recording_mode','reps'),(_fields->>'duration_sec')::integer,_fields->>'set_type',$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$reps_value=excluded.reps_value,set_type=excluded.set_type,$anchor$,$replacement$reps_value=excluded.reps_value,recording_mode=case when _fields ? 'recording_mode' then excluded.recording_mode else app_public.exercise_sets.recording_mode end,duration_sec=case when _fields ? 'duration_sec' then excluded.duration_sec else app_public.exercise_sets.duration_sec end,set_type=excluded.set_type,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$target_weight_value, target_reps, target_set_type,$anchor$,$replacement$target_weight_value, target_reps, recording_mode, target_duration_sec, target_set_type,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$(_fields ->> 'target_reps')::integer,$anchor$,$replacement$(_fields ->> 'target_reps')::integer,
        coalesce(_fields ->> 'recording_mode','reps'), (_fields ->> 'target_duration_sec')::integer,$replacement$),
    ('app_public.sync_push(jsonb)',$anchor$target_reps              = excluded.target_reps,$anchor$,$replacement$target_reps              = excluded.target_reps,
            recording_mode = excluded.recording_mode, target_duration_sec = excluded.target_duration_sec,$replacement$),
    ('app_public.sync_pull(jsonb)',$anchor$'load_input_mode', ed.load_input_mode,$anchor$,$replacement$'recording_mode', ed.recording_mode, 'load_input_mode', ed.load_input_mode,$replacement$),
    ('app_public.sync_pull(jsonb)',$anchor$'reps_value', es.reps_value,$anchor$,$replacement$'reps_value', es.reps_value, 'recording_mode', es.recording_mode, 'duration_sec', es.duration_sec,$replacement$),
    ('app_public.sync_pull(jsonb)',$anchor$'target_reps', sps.target_reps,$anchor$,$replacement$'target_reps', sps.target_reps, 'recording_mode', sps.recording_mode, 'target_duration_sec', sps.target_duration_sec,$replacement$),
    ('app_public.exercise_merge_resolve(text,boolean,text)',$anchor$array['weight_value','reps_value','planned_weight_value'$anchor$,$replacement$array['weight_value','reps_value','recording_mode','duration_sec','planned_weight_value'$replacement$),
    ('app_public.exercise_merge_resolve(text,boolean,text)',$anchor$candidate:=app_public.exercise_merge_place_row(c.entity_type,candidate,stamp);$anchor$,$replacement$if c.entity_type='exercise_sets' then candidate:=candidate||jsonb_build_object('recording_mode',coalesce(candidate->>'recording_mode','reps')); end if;
    candidate:=app_public.exercise_merge_place_row(c.entity_type,candidate,stamp);$replacement$),
    ('app_public.agent_create_exercise(uuid,text,text,text,jsonb)',$anchor$owner_user_id, id, name, load_input_mode,$anchor$,$replacement$owner_user_id, id, name, recording_mode, load_input_mode,$replacement$),
    ('app_public.agent_create_exercise(uuid,text,text,text,jsonb)',$anchor$p_owner, _id, p_exercise ->> 'name', p_exercise ->> 'load_input_mode',$anchor$,$replacement$p_owner, _id, p_exercise ->> 'name', coalesce(p_exercise ->> 'recording_mode','reps'), p_exercise ->> 'load_input_mode',$replacement$),
    ('app_public.agent_update_exercise(uuid,text,text,text,text,bigint,jsonb)',$anchor$load_input_mode = coalesce(p_changes ->> 'load_input_mode', d.load_input_mode),$anchor$,$replacement$load_input_mode = coalesce(p_changes ->> 'load_input_mode', d.load_input_mode),
         recording_mode = coalesce(p_changes ->> 'recording_mode', d.recording_mode),$replacement$),
    ('app_public.agent_workout_log(uuid,text,jsonb,bigint)',$anchor$weight_value,reps_value,
      set_type$anchor$,$replacement$weight_value,reps_value,recording_mode,duration_sec,
      set_type$replacement$),
    ('app_public.agent_workout_log(uuid,text,jsonb,bigint)',$anchor$item->>'weight_kg',item->>'reps',item->>'set_type',null,$anchor$,$replacement$item->>'weight_kg',coalesce(item->>'reps',''),coalesce(item->>'recording_mode','reps'),(item->>'duration_sec')::integer,item->>'set_type',null,$replacement$),
    ('app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb)',$anchor$reps_value=case when p_operation='update_set' then p_input->'set'->>'reps' else reps_value end,$anchor$,$replacement$reps_value=case when p_operation='update_set' then coalesce(p_input->'set'->>'reps','') else reps_value end,
        recording_mode=case when p_operation='update_set' then coalesce(p_input->'set'->>'recording_mode','reps') else recording_mode end,
        duration_sec=case when p_operation='update_set' then (p_input->'set'->>'duration_sec')::integer else duration_sec end,$replacement$),
    ('app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb)',$anchor$set_type=case when p_operation='update_set' then p_input->'set'->>'set_type' else set_type end,$anchor$,$replacement$set_type=case when p_operation='update_set' and (p_input->'set' ? 'set_type') then p_input->'set'->>'set_type' else set_type end,$replacement$),
    ('app_public.agent_workout_read(uuid,text,timestamptz,text,text,integer,text)',$anchor$'weight_kg',e.weight_value,'reps',e.reps_value,$anchor$,$replacement$'weight_kg',e.weight_value,'reps',e.reps_value,'recording_mode',e.recording_mode,'duration_sec',e.duration_sec,$replacement$),
    ('app_public.agent_insert_plan_graph(uuid,text,text,integer,jsonb,bigint)',$anchor$target_weight_value, target_reps, target_set_type,$anchor$,$replacement$target_weight_value, target_reps, recording_mode, target_duration_sec, target_set_type,$replacement$),
    ('app_public.agent_insert_plan_graph(uuid,text,text,integer,jsonb,bigint)',$anchor$(_set ->> 'target_reps')::integer,$anchor$,$replacement$(_set ->> 'target_reps')::integer,
        coalesce(_set ->> 'recording_mode','reps'), (_set ->> 'target_duration_sec')::integer,$replacement$),
    ('app_public.agent_insert_plan_block(uuid,text,text,text,text,text,jsonb,bigint)',$anchor$target_weight_value, target_reps, target_set_type,$anchor$,$replacement$target_weight_value, target_reps, recording_mode, target_duration_sec, target_set_type,$replacement$),
    ('app_public.agent_insert_plan_block(uuid,text,text,text,text,text,jsonb,bigint)',$anchor$if _reps is null or _reps < 1 or _reps > 999 then$anchor$,$replacement$if coalesce(_set ->> 'recording_mode','reps') <> 'hold' and (_reps is null or _reps < 1 or _reps > 999) then$replacement$),
    ('app_public.agent_insert_plan_block(uuid,text,text,text,text,text,jsonb,bigint)',$anchor$      _reps,$anchor$,$replacement$      _reps, coalesce(_set ->> 'recording_mode','reps'), (_set ->> 'target_duration_sec')::integer,$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$target_weight_value, target_reps, target_set_type,$anchor$,$replacement$target_weight_value, target_reps, recording_mode, target_duration_sec, target_set_type,$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$if _reps is null or _reps < 1 or _reps > 999 then$anchor$,$replacement$if coalesce(_set ->> 'recording_mode','reps') <> 'hold' and (_reps is null or _reps < 1 or _reps > 999) then$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$      _reps,$anchor$,$replacement$      _reps, coalesce(_set ->> 'recording_mode','reps'), (_set ->> 'target_duration_sec')::integer,$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$target_reps = _reps,$anchor$,$replacement$target_reps = _reps,
               recording_mode = coalesce(_set ->> 'recording_mode','reps'), target_duration_sec = (_set ->> 'target_duration_sec')::integer,$replacement$),
    ('app_public.agent_insert_plan_graph(uuid,text,text,integer,jsonb,bigint)',$anchor$nullif(_set ->> 'target_set_type', ''),$anchor$,$replacement$case when coalesce(_set ->> 'recording_mode','reps')='hold' and not (_set ? 'target_set_type') then 'rir_0' else nullif(btrim(_set ->> 'target_set_type'), '') end,$replacement$),
    ('app_public.agent_insert_plan_block(uuid,text,text,text,text,text,jsonb,bigint)',$anchor$nullif(btrim(_set ->> 'target_set_type'), ''),$anchor$,$replacement$case when coalesce(_set ->> 'recording_mode','reps')='hold' and not (_set ? 'target_set_type') then 'rir_0' else nullif(btrim(_set ->> 'target_set_type'), '') end,$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$target_set_type = nullif(btrim(_set ->> 'target_set_type'), ''),$anchor$,$replacement$target_set_type = case when coalesce(_set ->> 'recording_mode','reps')='hold' and not (_set ? 'target_set_type') then target_set_type else nullif(btrim(_set ->> 'target_set_type'), '') end,$replacement$),
    ('app_public.agent_update_plan_block(uuid,text,text,text,text,text,text,jsonb,bigint)',$anchor$nullif(btrim(_set ->> 'target_set_type'), ''),$anchor$,$replacement$case when coalesce(_set ->> 'recording_mode','reps')='hold' and not (_set ? 'target_set_type') then 'rir_0' else nullif(btrim(_set ->> 'target_set_type'), '') end,$replacement$)
  ) changes(target,anchor,replacement) loop
    definition:=pg_get_functiondef(target::regprocedure);
    if strpos(definition,anchor)=0 then raise exception 'Manual hold patch missing in %',target; end if;
    execute replace(definition,anchor,replacement);
  end loop;
end $migration$;

create or replace function app_public.require_sync_protocol()
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if headers->>'x-boga-sync-protocol' is distinct from '8' then
    raise exception 'UPDATE_REQUIRED: sync protocol 8 is required' using errcode='P0001';
  end if;
end $$;

-- Duration-aware group readers are new endpoints; earlier exact wire shapes stay intact.

CREATE OR REPLACE FUNCTION app_public.group_competition_session_exercises_v2(p_groups uuid[], p_member uuid, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with blocks as (
    select se.*, ed.id as ed_id, ed.load_input_mode as ed_load_input_mode,
      case when ed.id is not null then se.exercise_definition_id end as redaction_definition
    from app_public.session_exercises se
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null
  ), redaction as materialized (
    select x.definition, app_public.group_competition_redacts_exercise(p_groups,p_member,x.definition) as normalized
    from (select distinct b.redaction_definition as definition from blocks b) x
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',se.ed_load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status,
      'recording_mode',es.recording_mode,'duration_sec',es.duration_sec,
      'performed',exists(select 1 from app_public.group_set_facts f where f.member_user_id=es.owner_user_id
        and f.set_id=es.id and f.performed and f.live and f.rules_version>=8
        and f.fingerprint=app_public.group_legacy_set_fingerprint(es)))
      ||case when not d.normalized then jsonb_build_object('weight_value',es.weight_value)
        when es.recording_mode='reps' and es.duration_sec is null and app_public.group_competition_set_display_enabled() then
          jsonb_build_object('normalized_metrics',app_public.group_competition_set_display(p_groups,p_member,es.id))
        else '{}'::jsonb end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from blocks se
  join redaction d on d.definition is not distinct from se.redaction_definition;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_json_v2(p_groups uuid[], p_member uuid, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object('member',app_public.group_member_ref_json(p_member),'session_id',s.id,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member and g.id=s.gym_id and g.deleted_at is null),
    'status',s.status,'started_at_ms',s.started_at,'completed_at_ms',s.completed_at,'duration_sec',s.duration_sec,
    'exercises',app_public.group_competition_session_exercises_v2(p_groups,p_member,p_session))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_detail_v2(p_group_id uuid, p_member_user_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _session jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  if not exists(select 1 from app_public.group_session_shares sh where sh.group_id=p_group_id
    and sh.member_user_id=p_member_user_id and sh.session_id=p_session_id) then
    raise exception 'NOT_FOUND: session not found' using errcode='P0001';
  end if;
  _session:=app_public.group_competition_session_json_v2(array[p_group_id],p_member_user_id,p_session_id);
  if _session is null then raise exception 'NOT_FOUND: session not found' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'session',_session);
end;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_card_v2(p_member uuid, p_session text, p_groups jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object('kind','session','key',p_member::text||':'||p_session,'sort_at_ms',s.started_at,
    'groups',p_groups,'session',app_public.group_competition_session_json_v2(
      array(select (g->>'group_id')::uuid from jsonb_array_elements(p_groups) g),p_member,p_session))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_stream_v6(p_group_id uuid DEFAULT NULL::uuid, p_before text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
begin
  return app_public.group_competition_stream_v3_level(p_group_id,p_before,p_limit,6);
end $function$;

revoke all on function app_public.group_competition_session_exercises_v2(uuid[],uuid,text),
 app_public.group_competition_session_json_v2(uuid[],uuid,text),
 app_public.group_competition_session_card_v2(uuid,text,jsonb),
 app_public.group_competition_session_detail_v2(uuid,uuid,text),
 app_public.group_competition_stream_v6(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_session_detail_v2(uuid,uuid,text),
 app_public.group_competition_stream_v6(uuid,text,integer) to authenticated;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_card_level(p_member uuid, p_session text, p_groups jsonb, p_level integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
 select case when p_level>=6 then app_public.group_competition_session_card_v2(p_member,p_session,p_groups)
 else app_public.group_competition_session_card(p_member,p_session,p_groups) end;
$function$;
revoke all on function app_public.group_competition_session_card_level(uuid,text,jsonb,integer) from public,anon,authenticated,service_role;

do $migration$
declare target text; anchor text; replacement text; definition text;
begin
 for target,anchor,replacement in select * from (values
 ('app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer)',$anchor$app_public.group_competition_session_card(s.user_id, s.session_id, ($anchor$,$replacement$app_public.group_competition_session_card_level(s.user_id, s.session_id, ($replacement$),
 ('app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer)',$anchor$and e.group_id = any(_scope)))$anchor$,$replacement$and e.group_id = any(_scope)),p_level)$replacement$),
 ('app_public.group_competition_stream_v3_level(uuid,text,integer,integer)',$anchor$'kind','competition_stream_v3'$anchor$,$replacement$'kind',case when p_level>=6 then 'competition_stream_v6' else 'competition_stream_v3' end$replacement$),
 ('app_public.group_eval_session_rows(uuid,text)',$anchor$'weight_value',es.weight_value,'reps_value',es.reps_value,$anchor$,$replacement$'weight_value',es.weight_value,'reps_value',es.reps_value,'recording_mode',es.recording_mode,'duration_sec',es.duration_sec,$replacement$),
 ('app_public.group_metric_eval_source_graph(uuid,uuid)',$anchor$'weight_value',es.weight_value,'reps_value',es.reps_value,$anchor$,$replacement$'weight_value',es.weight_value,'reps_value',es.reps_value,'recording_mode',es.recording_mode,'duration_sec',es.duration_sec,$replacement$),
 ('app_public.notification_context_source(uuid,uuid,uuid,text)',$anchor$'weight_value',es.weight_value,'reps_value',es.reps_value,$anchor$,$replacement$'weight_value',es.weight_value,'reps_value',es.reps_value,'recording_mode',es.recording_mode,'duration_sec',es.duration_sec,$replacement$),
 ('app_public.group_legacy_set_fingerprint(app_public.exercise_sets)',$anchor$select app_public.group_set_fingerprint(
    p_set.weight_value,p_set.reps_value,p_set.performance_status,p_set.deleted_at);$anchor$,$replacement$select case when p_set.recording_mode='reps' and p_set.duration_sec is null then
    app_public.group_set_fingerprint(p_set.weight_value,p_set.reps_value,p_set.performance_status,p_set.deleted_at)
  else md5(jsonb_build_array(p_set.weight_value,p_set.reps_value,p_set.performance_status,p_set.deleted_at,
    p_set.recording_mode,p_set.duration_sec)::text) end;$replacement$),
 ('app_public.group_cow_source_snapshot(app_public.group_cows,jsonb)',$anchor$s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null$anchor$,$replacement$s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null
        and es.recording_mode='reps' and es.duration_sec is null$replacement$),
 ('app_public.group_cow_source_snapshot(app_public.group_cows,jsonb)',$anchor$es.weight_value,es.reps_value,es.set_type,$anchor$,$replacement$es.weight_value,es.reps_value,es.recording_mode,es.duration_sec,es.set_type,$replacement$),
 ('app_public.group_cow_source_snapshot(app_public.group_cows,jsonb)',$anchor$'binding_key',binding_key,'body_weight_context',body_weight_context,'context',p_context))$anchor$,$replacement$'binding_key',binding_key,'body_weight_context',body_weight_context,'context',p_context)
      ||case when recording_mode='hold' or duration_sec is not null then jsonb_build_object('recording_mode',recording_mode,'duration_sec',duration_sec) else '{}'::jsonb end)$replacement$),
 ('app_public.group_cow_context(app_public.group_cows)',$anchor$select rules_version into version from app_public.group_eval_rules_state where singleton;$anchor$,$replacement$version:=7;$replacement$)
 ) changes(target,anchor,replacement) loop
  definition:=pg_get_functiondef(target::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'Manual hold group patch missing in %',target; end if;
  execute replace(definition,anchor,replacement);
 end loop;
end $migration$;

-- Re-stamp only confirmations that were valid before the source-shape upgrade.
update app_public.notification_workouts w
  set manifest_digest=app_public.notification_manifest_digest(w.member_user_id,w.session_id),
      context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id)
  from manual_hold_current_contexts c
  where w.member_user_id=c.member_user_id and w.session_id=c.session_id;
drop table manual_hold_current_contexts;
-- End pending-confirmation restamp.
