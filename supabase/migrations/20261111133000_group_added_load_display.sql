-- Added-load figures are opt-in reader projections. Stored scores, rank,
-- certification and frozen CoW arithmetic retain their original meaning.
create function app_public.group_competition_added_load_enabled()
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-added-load','')='1';
$$;

create function app_public.group_competition_added_e1rm_json(p_metric text,p_unit text,p_value jsonb,p_contribution numeric)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select case when app_public.group_competition_added_load_enabled() and p_metric='e1rm' and p_unit='percent_bw'
    then jsonb_build_object('added_e1rm_percent_bw',case when jsonb_typeof(p_value)='number'
      and p_contribution between 0 and 1 then greatest(0,(p_value#>>'{}')::numeric-100*p_contribution) end)
    else '{}'::jsonb end;
$$;

create function app_public.group_competition_history_display(p_value jsonb,p_normalized boolean,p_role text,
  p_metric text,p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select v.value || app_public.group_competition_added_e1rm_json(v.value->>'metric',v.value->>'unit',v.value->'value',
    (select (r.rules->>'bodyweight_contribution')::numeric from app_public.group_rule_revisions r
      where r.group_exercise_id=p_event.group_exercise_id
        and r.revision=coalesce((p_value->>'rules_revision')::bigint,p_event.rules_revision)
        and r.representation_version=4 and (r.rules->>'bodyweight_calculations_enabled')::boolean))
  from (select app_public.group_competition_history_value(p_value,p_normalized,p_role,p_metric) as value) v;
$$;

revoke all on function app_public.group_competition_added_load_enabled(),
  app_public.group_competition_added_e1rm_json(text,text,jsonb,numeric),
  app_public.group_competition_history_display(jsonb,boolean,text,text,app_public.group_events)
  from public,anon,authenticated,service_role;

-- Keep each reader's existing authorization, disclosure and publication fences;
-- extend only its closed public figure shape when this request opts in.
do $display$
declare definition text; patch record;
begin
  for patch in select * from (values
    ('app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)',1,
      $old$'write_token',e.write_token,'certification',app_public.group_competition_certification_json(e.certificate))$old$,
      $new$'write_token',e.write_token,'certification',app_public.group_competition_certification_json(e.certificate))
        ||app_public.group_competition_added_e1rm_json(e.metric,e.unit,to_jsonb(e.value),
          (select (r.rules->>'bodyweight_contribution')::numeric from app_public.group_rule_revisions r
            where r.group_exercise_id=p_exercise and r.revision=p_revision
              and r.representation_version=4 and (r.rules->>'bodyweight_calculations_enabled')::boolean))$new$),
    ('app_public.group_competition_set_display(uuid[],uuid,text)',1,
      $old$'volume_percent_bw_reps',max(value) filter(where metric='volume')) end from scores;$old$,
      $new$'volume_percent_bw_reps',max(value) filter(where metric='volume'))
        ||app_public.group_competition_added_e1rm_json('e1rm','percent_bw',
          to_jsonb(max(value) filter(where metric='e1rm')),max(bodyweight_contribution)::numeric) end from scores;$new$),
    ('app_public.group_competition_event_json(app_public.group_events)',1,
      $old$app_public.group_competition_history_value(v,d.normalized,role,metric)$old$,
      $new$app_public.group_competition_history_display(v,d.normalized,role,metric,p_event)$new$),
    ('app_public.group_competition_stream_record(app_public.group_events)',2,
      $old$app_public.group_competition_history_value(p.holder,p.normalized,'previous',p.metric)$old$,
      $new$app_public.group_competition_history_display(p.holder,p.normalized,'previous',p.metric,p_event)$new$),
    ('app_public.group_cow_result_rows(app_public.group_cows,text)',1,
      $old$'state',case when m.suppressed or m.arithmetic_unavailable then 'unavailable' when m.entry is null then 'unranked' else 'ranked' end)$old$,
      $new$'state',case when m.suppressed or m.arithmetic_unavailable then 'unavailable' when m.entry is null then 'unranked' else 'ranked' end)
        ||app_public.group_competition_added_e1rm_json(p_metric,
          app_public.group_competition_unit(p_metric,(p_cow.start_context->>'normalized')::boolean),
          case when not m.suppressed and not m.arithmetic_unavailable then m.entry->'value' end,
          (p_cow.start_context->>'bodyweight_contribution')::numeric)$new$)
  ) as patches(fn,occurrences,old,new)
  loop
    definition:=pg_get_functiondef(patch.fn::regprocedure);
    if (length(definition)-length(replace(definition,patch.old,'')))<>patch.occurrences*length(patch.old) then
      raise exception '%: added-load display anchor count mismatch',patch.fn;
    end if;
    execute replace(definition,patch.old,patch.new);
  end loop;
end
$display$;
