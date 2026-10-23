-- Display existing normalized projections without resolving a private reading or
-- changing scoring. Older strict clients keep the original shapes unless opted in.
create function app_public.group_competition_set_display_enabled()
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-set-metrics','')='1';
$$;
revoke all on function app_public.group_competition_set_display_enabled() from public,anon,authenticated,service_role;

create function app_public.group_competition_set_display(p_groups uuid[],p_member uuid,p_set text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  -- A merged stream has no single contribution rule. Its group-specific full
  -- session remains the destination for figures; never choose a group's rules.
  with target as (
    select ge.*
    from app_public.exercise_sets es
    join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
    join app_public.sessions session on session.owner_user_id=se.owner_user_id and session.id=se.session_id
    join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    join app_public.exercise_group_links l on l.owner_user_id=se.owner_user_id and l.exercise_definition_id=ed.id and l.deleted_at is null
    join app_public.group_exercises ge on ge.group_id=p_groups[1] and ge.id=app_public.group_eval_try_uuid(l.group_exercise_id)
      and ge.group_id=app_public.group_eval_try_uuid(l.group_id)
    join app_public.groups g on g.id=ge.group_id and g.deleted_at is null and g.bodyweight_calculations_enabled
    join app_public.group_set_body_weight_bindings binding on binding.member_user_id=es.owner_user_id and binding.set_id=es.id
      and binding.source_key=app_public.group_set_body_weight_key(es,session.started_at)
    where cardinality(p_groups)=1 and es.owner_user_id=p_member and es.id=p_set
      and es.deleted_at is null and se.deleted_at is null and session.deleted_at is null and ed.deleted_at is null
      and es.performance_status is null and ge.archived_at is null and ge.bodyweight_contribution>0
      and ge.published_rules_revision=ge.rules_revision
      and app_public.group_active_role(ge.group_id,p_member) is not null
      and exists(select 1 from app_public.group_session_shares sh where sh.group_id=ge.group_id
        and sh.member_user_id=p_member and sh.session_id=session.id)
      and not exists(select 1 from app_public.group_metric_eval_queue q where q.group_exercise_id=ge.id)
  ), scores as (
    select score.metric,score.value,t.bodyweight_contribution,(score.performance->>'reps')::numeric as reps
    from target t
    join app_public.group_metric_set_scores score on score.group_exercise_id=t.id and score.rules_revision=t.rules_revision
      and score.member_user_id=p_member and score.set_id=p_set
    join app_public.exercise_sets es on es.owner_user_id=p_member and es.id=p_set
    join app_public.session_exercises se on se.owner_user_id=p_member and se.id=es.session_exercise_id
    join app_public.exercise_definitions ed on ed.owner_user_id=p_member and ed.id=se.exercise_definition_id
    where (select count(*) from target)=1 and score.unit=app_public.group_competition_unit(score.metric,true)
      and score.source_mode_generation=app_public.group_source_mode_generation(p_member,ed.id)
      and score.performance->>'source_load_input_mode'=ed.load_input_mode
      and score.performance->>'session_id'=se.session_id and score.performance->>'session_exercise_id'=se.id
      and score.performance->>'exercise_definition_id'=ed.id
      and score.performance->>'weight_value'=es.weight_value and score.performance->>'reps_value'=es.reps_value
  )
  select case when count(*)>0 then jsonb_build_object(
    -- Volume already contains 100*(external+c*B)*reps/B from the TS kernel.
    'added_load_percent_bw',max(greatest(0,value/nullif(reps,0)-100*bodyweight_contribution)) filter(where metric='volume'),
    'e1rm_percent_bw',max(value) filter(where metric='e1rm'),
    'volume_percent_bw_reps',max(value) filter(where metric='volume')) end from scores;
$$;
revoke all on function app_public.group_competition_set_display(uuid[],uuid,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_display_performance(p_performance jsonb,p_normalized boolean,p_groups uuid[],p_member uuid)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select app_public.group_competition_performance_json(p_performance,p_normalized)
    ||case when p_normalized and app_public.group_competition_set_display_enabled() then
      jsonb_build_object('normalized_metrics',case when
        -- Old events may reference a set whose source has since changed. Never
        -- attach today's projection to an immutable historical performance.
        exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
          on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
          join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id
          join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
          where es.owner_user_id=p_member and es.id=p_performance->>'set_id'
            and es.weight_value=p_performance->>'weight_value' and es.reps_value=p_performance->>'reps_value'
            and se.id=p_performance->>'session_exercise_id' and se.session_id=p_performance->>'session_id'
            and ed.id=p_performance->>'exercise_definition_id' and ed.load_input_mode=p_performance->>'source_load_input_mode'
            and s.started_at=(p_performance->>'achieved_at_ms')::bigint)
      then app_public.group_competition_set_display(p_groups,p_member,p_performance->>'set_id') end)
    else '{}'::jsonb end;
$$;
revoke all on function app_public.group_competition_display_performance(jsonb,boolean,uuid[],uuid) from public,anon,authenticated,service_role;

create or replace function app_public.group_competition_session_exercises(p_groups uuid[],p_member uuid,p_session text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',ed.load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status)
      ||case when not d.normalized then jsonb_build_object('weight_value',es.weight_value)
        when app_public.group_competition_set_display_enabled() then
          jsonb_build_object('normalized_metrics',app_public.group_competition_set_display(p_groups,p_member,es.id))
        else '{}'::jsonb end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from app_public.session_exercises se left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
  cross join lateral (select app_public.group_competition_redacts_exercise(p_groups,p_member,
    case when ed.id is not null then se.exercise_definition_id end) as normalized) d
  where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null;
$$;

-- Keep the existing authorization, publication and historical disclosure checks.
-- Replace only the final allowlisted performed-set projection at each reader.
do $display$
declare definition text; anchor text; replacement text; patch record;
begin
  for patch in select * from (values
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',
      'app_public.group_competition_performance_json(e.performance,d.normalized)',
      'app_public.group_competition_display_performance(e.performance,d.normalized,array[p_group],e.member_user_id)'),
    ('app_public.group_competition_stream_record(app_public.group_events)',
      'app_public.group_competition_performance_json(perf.p,v.normalized)',
      'app_public.group_competition_display_performance(perf.p,v.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,p_event.member_user_id)'),
    ('app_public.group_competition_stream_record(app_public.group_events)',
      'app_public.group_competition_performance_json(p.holder->''performance'',p.normalized)',
      'app_public.group_competition_display_performance(p.holder->''performance'',p.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,(p.holder->>''member_user_id'')::uuid)')
  ) as patches(fn,old,new)
  loop
    definition:=pg_get_functiondef(patch.fn::regprocedure);anchor:=patch.old;replacement:=patch.new;
    if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
      raise exception '%: display anchor not found exactly once',patch.fn;
    end if;
    execute replace(definition,anchor,replacement);
  end loop;
end
$display$;
