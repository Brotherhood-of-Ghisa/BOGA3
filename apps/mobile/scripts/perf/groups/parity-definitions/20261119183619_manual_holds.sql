-- Retained pre-optimization graph algorithm, adapted only to the additive timed-set fields.
-- Current worker source tokens include these fields; all graph reach and publication guards stay under parity.
create or replace function app_public.group_metric_eval_source_graph(p_group_id uuid, p_group_exercise_id uuid)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare _graph jsonb; _sets jsonb;
begin
  with target as (
    select ge.*,g.bodyweight_calculations_enabled
    from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
    where ge.id=p_group_exercise_id and ge.group_id=p_group_id
      and g.deleted_at is null and ge.archived_at is null
  ), members as (
    select gm.user_id as member_user_id,gm.id as membership_id
    from app_public.group_memberships gm,target t
    where gm.group_id=t.group_id and gm.ended_at is null
  ), links as (
    select l.owner_user_id as member_user_id,l.exercise_definition_id,l.updated_at
    from app_public.exercise_group_links l,target t
    where l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id)=t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id)=t.id
      and exists(select 1 from members m where m.member_user_id=l.owner_user_id)
  ), reach_definitions as (
    select l.member_user_id,l.exercise_definition_id from links l
    union
    select st.member_user_id,d.exercise_definition_id
    from target t
    join app_public.group_metric_board_state st on st.group_exercise_id=t.id and st.rules_revision=t.rules_revision
    join members m on m.member_user_id=st.member_user_id
    cross join lateral unnest(st.linked_definition_ids) d(exercise_definition_id)
  ), reach_set_ids as (
    select c.member_user_id,c.set_id from target t
    join app_public.group_metric_certifications c on c.group_exercise_id=t.id and c.ended_at is null
    union
    select c.member_user_id,c.set_id from target t
    join app_public.group_certifications c on c.group_exercise_id=t.id and c.ended_at is null
    union
    select e.member_user_id,e.set_id from target t
    join app_public.group_events e on e.group_exercise_id=t.id and e.kind='record'
    where e.set_id is not null and not exists(select 1 from app_public.group_events v
      where v.kind='record_voided' and v.related_event_id=e.id)
    union
    select e.member_user_id,e.set_id from target t
    join app_public.group_metric_board_entries e on e.group_exercise_id=t.id and e.rules_revision=t.rules_revision
    union
    select s.member_user_id,s.set_id from target t
    join app_public.group_metric_set_scores s on s.group_exercise_id=t.id and s.rules_revision=t.rules_revision
      and s.counting
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id',s.owner_user_id,'session_id',s.id,
      'session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
      'set_id',es.id,'weight_value',es.weight_value,'reps_value',es.reps_value,'recording_mode',es.recording_mode,'duration_sec',es.duration_sec,
      'performance_status',es.performance_status,'set_type',es.set_type,
      'live',s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null,
      'counting',exists(select 1 from links l where l.member_user_id=s.owner_user_id
        and l.exercise_definition_id=se.exercise_definition_id),
      'source_load_input_mode',ed.load_input_mode,
      'body_weight_kg',bw.context->'body_weight_kg',
      'body_weight_source',bw.context->'body_weight_source',
      'body_weight_measurement_id',bw.context->'body_weight_measurement_id',
      'body_weight_measured_at_ms',bw.context->'body_weight_measured_at',
      'achieved_at_ms',s.started_at,'exercise_order_index',se.order_index,
      'set_order_index',es.order_index,'set_created_at_ms',es.created_at,
      'session_status',s.status,
      'observed_set_pin',app_public.group_metric_observed_set_pin(s.owner_user_id,
        jsonb_build_object('set_id',es.id,'session_exercise_id',se.id,'session_id',s.id,
          'exercise_definition_id',se.exercise_definition_id,'weight_value',es.weight_value,
          'reps_value',es.reps_value,'performance_status',es.performance_status),es.set_type),
      'reading_pin',case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
        then encode(extensions.digest(coalesce(bw.context,jsonb_build_object('body_weight_kg',null))::text,'sha256'),'hex') end,
      'fingerprints',jsonb_build_object(
        'weight',encode(extensions.digest(jsonb_build_array(
          app_public.group_metric_performance_pin('weight',es,se,s,ed),
          t.rules_revision,t.load_input_mode
        )::text,'sha256'),'hex'),
        'e1rm',encode(extensions.digest(jsonb_build_array(
          app_public.group_metric_performance_pin('e1rm',es,se,s,ed),
          t.rules_revision,t.load_input_mode,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then t.bodyweight_contribution end,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then coalesce(bw.context,jsonb_build_object('body_weight_kg',null)) end
        )::text,'sha256'),'hex'))
    ) as row,s.owner_user_id as member_user_id,es.id as set_id
    from target t
    join app_public.group_session_shares sh on sh.group_id=t.group_id
    join members m on m.member_user_id=sh.member_user_id
    join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id
    join app_public.session_exercises se on se.owner_user_id=s.owner_user_id and se.session_id=s.id
    join app_public.exercise_sets es on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id
      and ed.id=se.exercise_definition_id
    left join lateral (
      select case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
        then coalesce((select b.context from app_public.group_set_body_weight_bindings b
          where b.member_user_id=s.owner_user_id and b.set_id=es.id
            and b.source_key=app_public.group_set_body_weight_key(es,s.started_at)),
          app_public.session_weight_as_of(s.owner_user_id,s.started_at)) end as context
    ) bw on true
    -- The shares-driven join is the plan the full graph always had; only
    -- reached rows are built. Uncorrelated IN lists plan as hashed subplans.
    where (s.owner_user_id,se.exercise_definition_id) in (select member_user_id,exercise_definition_id from reach_definitions)
      or (es.owner_user_id,es.id) in (select member_user_id,set_id from reach_set_ids)
  )
  select jsonb_build_object(
    'group_id',t.group_id,'group_exercise_id',t.id,'name',t.name,
    'rules',app_public.group_exercise_rules_json((select ge from app_public.group_exercises ge where ge.id=t.id)),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'member_user_id',m.member_user_id,'membership_id',m.membership_id,
      'links',coalesce((select jsonb_agg(jsonb_build_object(
        'exercise_definition_id',l.exercise_definition_id,'updated_at_ms',l.updated_at)
        order by l.exercise_definition_id) from links l
        where l.member_user_id=m.member_user_id),'[]'::jsonb))
      order by m.member_user_id) from members m),'[]'::jsonb),
    'sets',coalesce((select jsonb_agg(ss.row order by ss.member_user_id,ss.set_id)
      from source_sets ss),'[]'::jsonb)) into _graph
  from target t;
  if _graph is null then return null; end if;
  select coalesce(jsonb_agg(r||jsonb_build_object('fingerprints',(r->'fingerprints')||jsonb_build_object(
    'volume',app_public.group_metric_graph_fingerprint(r,_graph->'rules','volume',r->>'source_load_input_mode')))
    order by r->>'member_user_id',r->>'set_id'),'[]'::jsonb) into _sets
    from jsonb_array_elements(_graph->'sets') r;
  select coalesce(jsonb_agg(r||jsonb_build_object('source_mode_generation',
      app_public.group_source_mode_generation((r->>'member_user_id')::uuid,r->>'exercise_definition_id'))
      order by r->>'member_user_id',r->>'set_id'),'[]'::jsonb) into _sets
      from jsonb_array_elements(_sets) r;
  _graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets,
    'ordinary_baselines',coalesce((select jsonb_agg(jsonb_build_object(
      'member_user_id',e.member_user_id,'set_id',e.set_id,'metric',e.metric,'fingerprint',e.fingerprint,'performance',e.performance)
      order by e.member_user_id,e.set_id,e.metric)
      from app_public.group_metric_board_entries e
      where e.group_exercise_id=p_group_exercise_id and e.rules_revision=(_graph->'rules'->>'rules_revision')::bigint
        and not e.certified and e.metric in ('volume','e1rm')
        and e.unit=case e.metric when 'volume' then 'kg_reps' else 'kg' end
        and exists(select 1 from jsonb_array_elements(_graph->'members') m
          where m->>'member_user_id'=e.member_user_id::text)),'[]'::jsonb));
  return _graph||jsonb_build_object('source_token',encode(extensions.digest(_graph::text,'sha256'),'hex'));
end;
$$;
