-- Seconds is a separate Hold comparison domain. Weight never affects its score or ordering.
-- Retained repetition scores, witnesses and CoW arithmetic keep their existing meaning.
create or replace function app_public.group_competition_require_seconds(p_group uuid)
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-seconds','')<>'1'
    and (p_group is null or exists(select 1 from app_public.group_rule_revisions r
      where r.group_id=p_group and r.rules->>'default_metric'='seconds')) then
    raise exception 'UPDATE_REQUIRED: Update BoGa to use Hold leaderboards.' using errcode='P0001';
  end if;
end $$;
revoke all on function app_public.group_competition_require_seconds(uuid) from public,anon,authenticated,service_role;

alter table app_public.group_exercises drop constraint group_exercises_default_metric_valid,
  add constraint group_exercises_default_metric_valid check(default_metric in ('weight','volume','e1rm','seconds'));

-- Keep historical audit alternatives and add the explicitly typed, bounded duration score.
do $constraints$
declare target regclass; name text; definition text;
begin
  for target,name in select * from (values
    ('app_public.group_metric_set_scores'::regclass,'group_metric_set_scores_competition_value'),
    ('app_public.group_metric_board_entries'::regclass,'group_metric_board_entries_competition_value'),
    ('app_public.group_metric_certifications'::regclass,'group_metric_certifications_competition_audit')
  ) c(target,name) loop
    select pg_get_constraintdef(oid) into strict definition from pg_constraint where conrelid=target and conname=name;
    execute format('alter table %s drop constraint %I, add constraint %I check ((%s) or (metric=''seconds'' and unit=''seconds'' and %I between 1 and 300 and %I=trunc(%I)))',
      target,name,name,substring(definition from 8 for length(definition)-8),
      case when name='group_metric_certifications_competition_audit' then 'observed_value' else 'value' end,
      case when name='group_metric_certifications_competition_audit' then 'observed_value' else 'value' end,
      case when name='group_metric_certifications_competition_audit' then 'observed_value' else 'value' end);
  end loop;
  target:='app_public.group_events'::regclass; name:='group_events_lead_change_shape_check';
  select pg_get_constraintdef(oid) into strict definition from pg_constraint where conrelid=target and conname=name;
  if position($anchor$'absolute_strength'::text]$anchor$ in definition)=0 then
    raise exception 'Hold lead-change constraint anchor missing';
  end if;
  definition:=replace(definition,$anchor$'absolute_strength'::text]$anchor$,$replacement$'absolute_strength'::text, 'seconds'::text]$replacement$);
  execute format('alter table %s drop constraint %I, add constraint %I %s',target,name,name,definition);
end $constraints$;

-- Guard patches against drift; keep authorization, locks and publication fences in their owning bodies.
do $migration$
declare target text; anchor text; replacement text; definition text; definitions jsonb:='{}';
begin
  for target,anchor,replacement in select * from (values
    ('app_public.group_exercise_rules_json(app_public.group_exercises)',$anchor$('weight','volume','e1rm')$anchor$,$replacement$('weight','volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_board(uuid,uuid,text,boolean,integer,text)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certification_get(uuid,uuid,text)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certification_end(uuid,uuid,text,text)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certification_json(app_public.group_metric_certifications)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_record_context(app_public.group_events)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_records_history(uuid,uuid,text,boolean,text,integer)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_session_record_boards(app_public.group_events,jsonb)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_stream_record(app_public.group_events)',$anchor$('volume','e1rm')$anchor$,$replacement$('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',$anchor$p_metric not in ('volume','e1rm')$anchor$,$replacement$p_metric not in ('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',$anchor$e.metric in ('volume','e1rm')$anchor$,$replacement$e.metric in ('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',$anchor$s.metric in ('volume','e1rm')$anchor$,$replacement$s.metric in ('volume','e1rm','seconds')$replacement$),
    ('app_public.group_competition_complete_witness(app_public.group_metric_certifications)',$anchor$s.metric in ('volume','e1rm')$anchor$,$replacement$s.metric in ('volume','e1rm','seconds')$replacement$),
    ('app_public.group_exercise_validate_rules(boolean,double precision,text)',$anchor$p_default_metric not in ('volume','e1rm')$anchor$,$replacement$p_default_metric not in ('volume','e1rm','seconds')$replacement$),
    ('app_public.group_exercise_validate_rules(boolean,double precision,text)',$anchor$  return jsonb_build_object($anchor$,$replacement$  if p_default_metric='seconds' then perform app_public.group_competition_require_seconds(null); end if;
  return jsonb_build_object($replacement$),
    ('app_public.group_competition_history(uuid,uuid,text,boolean,bigint,text,integer)',$anchor$('weight','volume','e1rm','bodyweight_reps'$anchor$,$replacement$('weight','volume','e1rm','seconds','bodyweight_reps'$replacement$),
    ('app_public.group_competition_history_value(jsonb,boolean,text,text)',$anchor$v.unit in ('percent_bw','percent_bw_reps')$anchor$,$replacement$v.unit in ('percent_bw','percent_bw_reps','seconds')$replacement$),
    ('app_public.group_competition_unit(text,boolean)',$anchor$select case p_metric when 'volume'$anchor$,$replacement$select case p_metric when 'seconds' then 'seconds' when 'volume'$replacement$),
    ('app_public.group_competition_exercise_update(uuid,uuid,bigint,text,text,double precision,text)',$anchor$_rebuild:=row(_old.load_input_mode,_old.bodyweight_contribution) is distinct from row(_mode,p_bodyweight_contribution);$anchor$,$replacement$_rebuild:=row(_old.load_input_mode,_old.bodyweight_contribution,_old.default_metric='seconds')
    is distinct from row(_mode,p_bodyweight_contribution,p_default_metric='seconds');$replacement$),
    ('app_public.group_competition_board(uuid,uuid,text,boolean,integer,text)',$anchor$  _rules:=$anchor$,$replacement$  if (p_metric='seconds') is distinct from (_ge.default_metric='seconds') then
    raise exception 'VALIDATION: metric does not match this comparison' using errcode='P0001';
  end if;
  _rules:=$replacement$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',$anchor$_metrics := array['volume','e1rm'];$anchor$,$replacement$_metrics := case when p_graph->'rules'->>'default_metric'='seconds' then array['seconds'] else array['volume','e1rm'] end;$replacement$),
    ('app_public.group_metric_eval_source_graph(uuid,uuid)',$anchor$t.bodyweight_calculations_enabled and t.bodyweight_contribution>0$anchor$,$replacement$t.default_metric<>'seconds' and es.recording_mode='reps' and t.bodyweight_calculations_enabled and t.bodyweight_contribution>0$replacement$),
    ('app_public.group_metric_eval_source_graph(uuid,uuid)',$anchor$'reps_value',es.reps_value,'performance_status',es.performance_status),es.set_type)$anchor$,$replacement$'reps_value',es.reps_value,'performance_status',es.performance_status)
          ||case when es.recording_mode='hold' then jsonb_build_object('recording_mode','hold','duration_sec',es.duration_sec) else '{}'::jsonb end,es.set_type)$replacement$),
    ('app_public.group_metric_eval_source_graph(uuid,uuid)',$anchor$'volume',app_public.group_metric_graph_fingerprint(r,_graph->'rules','volume',r->>'source_load_input_mode')$anchor$,$replacement$'volume',app_public.group_metric_graph_fingerprint(r,_graph->'rules','volume',r->>'source_load_input_mode'),
    'seconds',app_public.group_metric_graph_fingerprint(r,_graph->'rules','seconds',r->>'source_load_input_mode')$replacement$),
    ('app_public.group_metric_observed_set_pin(uuid,jsonb,text)',$anchor$  select encode(extensions.digest(jsonb_build_array($anchor$,$replacement$  select encode(extensions.digest((jsonb_build_array($replacement$),
    ('app_public.group_metric_observed_set_pin(uuid,jsonb,text)',$anchor$  )::text,'sha256'),'hex');$anchor$,$replacement$  ) ||case when p_performance->>'recording_mode'='hold' then
    jsonb_build_array('hold',p_performance->'duration_sec') else '[]'::jsonb end)::text,'sha256'),'hex');$replacement$),
    ('app_public.group_metric_graph_fingerprint(jsonb,jsonb,text,text)',$anchor$  with pin as$anchor$,$replacement$  select case when p_metric='seconds' then encode(extensions.digest(jsonb_build_array(
    'seconds',p_source->>'member_user_id',p_source->>'set_id',p_source->>'session_id',
    p_source->>'session_exercise_id',p_source->>'exercise_definition_id',p_source->>'recording_mode',
    p_source->'duration_sec',p_source->>'weight_value',p_source->>'reps_value',
    p_source->>'performance_status',p_source_mode,p_rules->'rules_revision')::text,'sha256'),'hex') else (
  with pin as$replacement$),
    ('app_public.group_metric_graph_fingerprint(jsonb,jsonb,text,text)',$anchor$from pin,dependency;$anchor$,$replacement$from pin,dependency) end;$replacement$),
    ('app_public.group_set_body_weight_bind(jsonb)',$anchor$  if not coalesce($anchor$,$replacement$  if p_graph->'rules'->>'default_metric'='seconds' or not coalesce($replacement$),
    ('app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)',$anchor$not(x->>'metric' in ('volume','e1rm'))$anchor$,$replacement$not(x->>'metric' in ('volume','e1rm','seconds'))
      or ((x->>'metric'='seconds') is distinct from (_graph->'rules'->>'default_metric'='seconds'))
      or (x->>'metric'='seconds' and (x->'value' is distinct from _sources->((x->>'member_user_id')||'/'||(x->>'set_id'))->'duration_sec'
        or _sources->((x->>'member_user_id')||'/'||(x->>'set_id'))->>'recording_mode' is distinct from 'hold'))$replacement$),
    ('app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)',$anchor$'reps',(r->>'reps_value')::numeric$anchor$,$replacement$'reps',case when r->>'recording_mode'='hold' then null else (r->>'reps_value')::numeric end$replacement$),
    ('app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)',$anchor$'set_order_index',(r->>'set_order_index')::integer),$anchor$,$replacement$'set_order_index',(r->>'set_order_index')::integer)
      ||case when r->>'recording_mode'='hold' then jsonb_build_object('recording_mode','hold','duration_sec',r->'duration_sec') else '{}'::jsonb end,$replacement$),
    ('app_public.group_competition_performance_json(jsonb,boolean)',$anchor$    ||case when p_normalized$anchor$,$replacement$    ||case when p_performance->>'recording_mode'='hold' then
      jsonb_build_object('recording_mode','hold','duration_sec',p_performance->'duration_sec') else '{}'::jsonb end
    ||case when p_normalized$replacement$),
    ('app_public.group_competition_display_performance(jsonb,boolean,uuid[],uuid)',$anchor$case when p_normalized and app_public.group_competition_set_display_enabled()$anchor$,$replacement$case when p_normalized and coalesce(p_performance->>'recording_mode','reps')<>'hold' and app_public.group_competition_set_display_enabled()$replacement$),
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',$anchor$(d.normalized or not app_public.group_competition_redacts_exercise$anchor$,$replacement$(p_metric='seconds' or d.normalized or not app_public.group_competition_redacts_exercise$replacement$),
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',$anchor$e.performance,d.normalized,array[p_group],e.member_user_id$anchor$,$replacement$e.performance,d.normalized or (p_metric='seconds' and app_public.group_competition_redacts_exercise(array[p_group],e.member_user_id,e.performance->>'exercise_definition_id')),array[p_group],e.member_user_id$replacement$),
    ('app_public.group_competition_require_member(uuid,uuid)',$anchor$begin
$anchor$,$replacement$declare _role text;
begin
$replacement$),
    ('app_public.group_competition_require_member(uuid,uuid)',$anchor$  return app_public.group_require_member(p_group,p_user,false);$anchor$,$replacement$  _role:=app_public.group_require_member(p_group,p_user,false);
  perform app_public.group_competition_require_seconds(p_group);
  return _role;$replacement$),
    ('app_public.group_competition_exercise_create(uuid,text,text,text,double precision,text)',$anchor$  perform app_public.group_require_member(p_group_id,_uid,true);$anchor$,$replacement$  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_seconds(p_group_id);$replacement$),
    ('app_public.group_competition_exercise_update(uuid,uuid,bigint,text,text,double precision,text)',$anchor$  perform app_public.group_require_member(p_group_id,_uid,true);$anchor$,$replacement$  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_seconds(p_group_id);$replacement$),
    ('app_public.group_competition_exercise_archive(uuid,uuid,boolean)',$anchor$  perform app_public.group_require_member(p_group_id,_uid,true);$anchor$,$replacement$  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_seconds(p_group_id);$replacement$),
    ('app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid)',$anchor$  perform app_public.group_require_member(p_group_id,_uid,true);$anchor$,$replacement$  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_seconds(p_group_id);$replacement$),
    ('app_public.group_competition_certification_end(uuid,uuid,text,text)',$anchor$  _role:=app_public.group_require_member(p_group_id,_uid,true);$anchor$,$replacement$  _role:=app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_seconds(p_group_id);$replacement$),
    ('app_public.group_cow_context(app_public.group_cows)',$anchor$ge.id is not null and ge.archived_at is null$anchor$,$replacement$ge.id is not null and ge.archived_at is null and ge.default_metric<>'seconds'$replacement$),
    ('app_public.group_cow_context(app_public.group_cows)',$anchor$enabled and ge.bodyweight_contribution>0$anchor$,$replacement$ge.default_metric<>'seconds' and enabled and ge.bodyweight_contribution>0$replacement$),
    ('app_public.group_cow_validate(uuid,uuid,text[])',$anchor$where id=p_exercise and group_id=p_group and archived_at is null$anchor$,$replacement$where id=p_exercise and group_id=p_group and archived_at is null and default_metric<>'seconds'$replacement$)
  ) changes(target,anchor,replacement) loop
    definition:=coalesce(definitions->>target,pg_get_functiondef(target::regprocedure));
    if strpos(definition,anchor)=0 then raise exception 'Hold board patch missing in %: %',target,anchor; end if;
    definitions:=definitions||jsonb_build_object(target,replace(definition,anchor,replacement));
  end loop;
  for target,definition in select * from jsonb_each_text(definitions) loop execute definition; end loop;
end $migration$;
