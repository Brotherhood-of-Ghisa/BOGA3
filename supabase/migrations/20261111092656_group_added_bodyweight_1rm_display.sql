-- Presentation only: scores, ranking, certification and immutable audits stay intact.
create function app_public.group_added_1rm_display(p_metric text,p_unit text,p_value numeric,p_contribution numeric)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select case when coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-added-1rm','')='1'
    and p_metric='e1rm' and p_unit='percent_bw' then jsonb_build_object('display_value',
      case when p_value is not null and p_contribution between 0 and 1 then greatest(0,p_value-100*p_contribution) end)
    else '{}'::jsonb end;
$$;
revoke all on function app_public.group_added_1rm_display(text,text,numeric,numeric) from public,anon,authenticated,service_role;

create function app_public.group_competition_revision_contribution(p_exercise uuid,p_revision bigint)
returns numeric language sql stable set search_path=app_public,pg_temp as $$
  select (rules->>'bodyweight_contribution')::numeric from app_public.group_rule_revisions
    where group_exercise_id=p_exercise and revision=p_revision;
$$;
revoke all on function app_public.group_competition_revision_contribution(uuid,bigint) from public,anon,authenticated,service_role;

create function app_public.group_competition_history_display(p_value jsonb,p_normalized boolean,p_role text,p_metric text,p_contribution numeric)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select v||app_public.group_added_1rm_display(v->>'metric',v->>'unit',(v->>'value')::numeric,p_contribution)
    from (select app_public.group_competition_history_value(p_value,p_normalized,p_role,p_metric) as v) safe;
$$;
revoke all on function app_public.group_competition_history_display(jsonb,boolean,text,text,numeric) from public,anon,authenticated,service_role;

-- Preserve access/disclosure checks. Old leaders use their event revision;
-- final CoWs use the context pinned at their start.
do $display$
declare definition text; current_fn text; patch record;
begin
  for patch in select * from (values
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',
      'jsonb_build_object(''metric'',e.metric,''value'',e.value,''unit'',e.unit,',
      'app_public.group_added_1rm_display(e.metric,e.unit,e.value,app_public.group_competition_revision_contribution(p_exercise,p_revision))||jsonb_build_object(''metric'',e.metric,''value'',e.value,''unit'',e.unit,'),
    ('app_public.group_competition_event_json(app_public.group_events)',
      'app_public.group_competition_history_value(v,d.normalized,role,metric)',
      'app_public.group_competition_history_display(v,d.normalized,role,metric,app_public.group_competition_revision_contribution(p_event.group_exercise_id,coalesce(p_event.rules_revision,1)))'),
    ('app_public.group_competition_stream_record(app_public.group_events)',
      '(app_public.group_competition_event_json(l)->>''visibility'')=''normalized'' as normalized',
      '(app_public.group_competition_event_json(l)->>''visibility'')=''normalized'' as normalized,l.rules_revision as rules_revision'),
    ('app_public.group_competition_stream_record(app_public.group_events)',
      '''unit'',b->''unit'',''value'',b->''previous_value''),v.normalized',
      '''unit'',b->''unit'',''value'',b->''previous_value''),v.normalized,p_event.rules_revision'),
    ('app_public.group_competition_stream_record(app_public.group_events)',
      '''value'',app_public.group_competition_history_value(p.holder,p.normalized,''previous'',p.metric)',
      '''value'',app_public.group_competition_history_display(p.holder,p.normalized,''previous'',p.metric,app_public.group_competition_revision_contribution(p_event.group_exercise_id,coalesce(p.rules_revision,1)))'),
    ('app_public.group_competition_set_display(uuid[],uuid,text)',
      '''volume_percent_bw_reps'',max(value) filter(where metric=''volume'')) end from scores',
      '''volume_percent_bw_reps'',max(value) filter(where metric=''volume''))||case when coalesce(nullif(current_setting(''request.headers'',true),'''')::jsonb->>''x-boga-group-added-1rm'','''')=''1'' then jsonb_build_object(''e1rm_added_load_percent_bw'',app_public.group_added_1rm_display(''e1rm'',''percent_bw'',max(value) filter(where metric=''e1rm''),max(bodyweight_contribution)::numeric)->''display_value'') else ''{}''::jsonb end end from scores'),
    ('app_public.group_cow_result_rows(app_public.group_cows,text)',
      'else ''ranked'' end)',
      'else ''ranked'' end)||app_public.group_added_1rm_display(p_metric,case when (p_cow.start_context->>''normalized'')::boolean then ''percent_bw'' end,case when not m.suppressed then (m.entry->>''value'')::numeric end,(p_cow.start_context->>''bodyweight_contribution'')::numeric)')
  ) as patches(fn,old,new)
  loop
    if current_fn is distinct from patch.fn then
      if current_fn is not null then execute definition; end if;
      definition:=pg_get_functiondef(patch.fn::regprocedure);
      current_fn:=patch.fn;
    end if;
    if (length(definition)-length(replace(definition,patch.old,'')))<>length(patch.old) then
      raise exception '%: added 1RM display anchor not found exactly once',patch.fn;
    end if;
    definition:=replace(definition,patch.old,patch.new);
  end loop;
  execute definition;
end
$display$;
