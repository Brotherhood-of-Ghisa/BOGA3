-- All numeric bodyweight loads mean added weight. Raw amounts and units remain intact.
-- Re-version calculated results and strength attestations; zero-added reps pins stay stable.
CREATE OR REPLACE FUNCTION app_public.group_metric_performance_pin(p_metric text, p_set app_public.exercise_sets, p_session_exercise app_public.session_exercises, p_session app_public.sessions, p_definition app_public.exercise_definitions)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select case when p_metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')
    then encode(extensions.digest(jsonb_build_object(
      'pin_version', case when p_metric in ('relative_strength','absolute_strength') then 4 else 2 end, 'metric', p_metric,
      'source', jsonb_build_array(p_set.owner_user_id, p_set.id,
        p_session_exercise.id, p_session.id, p_definition.id),
      'external', jsonb_build_array(p_set.weight_value, p_set.weight_unit, case when p_metric in ('bodyweight_reps','relative_strength','absolute_strength') then 'added' else p_set.external_load_mode end),
      'performance', jsonb_build_array(p_set.reps_value, p_set.performance_status),
      'presence', jsonb_build_array(p_set.deleted_at, p_session_exercise.deleted_at, p_session.deleted_at),
      'convention', jsonb_build_array(p_definition.load_input_mode,
        p_definition.movement_standard, p_definition.loading_method),
      'body_weight', case when p_metric in ('relative_strength', 'absolute_strength')
        then app_public.session_weight_as_of(p_session.owner_user_id,p_session.started_at)
        else 'null'::jsonb end
    )::text,'sha256'),'hex') end;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_metric_eval_source_graph(p_group_id uuid, p_group_exercise_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with target as (
    select ge.* from app_public.group_exercises ge
    join app_public.groups g on g.id = ge.group_id
    where ge.id = p_group_exercise_id and ge.group_id = p_group_id
      and g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  ), members as (
    select gm.user_id as member_user_id, gm.id as membership_id
    from app_public.group_memberships gm, target t
    where gm.group_id = t.group_id and gm.ended_at is null
  ), links as (
    select l.owner_user_id as member_user_id, l.exercise_definition_id, l.updated_at
    from app_public.exercise_group_links l, target t
    where l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id) = t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id) = t.id
      and exists (select 1 from members m where m.member_user_id = l.owner_user_id)
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id', s.owner_user_id, 'session_id', s.id,
      'session_exercise_id', se.id, 'exercise_definition_id', se.exercise_definition_id,
      'set_id', es.id, 'weight_value', es.weight_value, 'weight_unit', es.weight_unit,
      'external_load_mode', 'added', 'reps_value', es.reps_value,
      'performance_status', es.performance_status,
      'live', s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null,
      'counting', exists (select 1 from links l where l.member_user_id = s.owner_user_id
        and l.exercise_definition_id = se.exercise_definition_id),
      'source_load_input_mode', ed.load_input_mode,
      'movement_standard', ed.movement_standard, 'loading_method', ed.loading_method,
      'body_weight_kg', bw.context->'body_weight_kg', 'body_weight_source', bw.context->'body_weight_source',
      'body_weight_measurement_id', bw.context->'body_weight_measurement_id',
      'body_weight_measured_at_ms', bw.context->'body_weight_measured_at',
      'achieved_at_ms', s.started_at, 'exercise_order_index', se.order_index,
      'set_order_index', es.order_index, 'set_created_at_ms', es.created_at,
      -- Publication/event reconciliation also needs active/completed transitions
      -- in its source token, even though scoring does not depend on that status.
      'session_status', s.status,
      'fingerprints', jsonb_build_object(
        'weight', app_public.group_metric_performance_pin('weight', es, se, s, ed),
        'e1rm', app_public.group_metric_performance_pin('e1rm', es, se, s, ed),
        'bodyweight_reps', app_public.group_metric_performance_pin('bodyweight_reps', es, se, s, ed),
        'relative_strength', app_public.group_metric_performance_pin('relative_strength', es, se, s, ed),
        'absolute_strength', app_public.group_metric_performance_pin('absolute_strength', es, se, s, ed))
      ) as row, s.owner_user_id as member_user_id, es.id as set_id
    from target t
    join app_public.group_session_shares sh on sh.group_id = t.group_id
    join members m on m.member_user_id = sh.member_user_id
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
    cross join lateral (select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context) bw
    join app_public.session_exercises se on se.owner_user_id = s.owner_user_id and se.session_id = s.id
    join app_public.exercise_sets es on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id = se.owner_user_id and ed.id = se.exercise_definition_id
    -- Include unlinked shared sets: unlinking affects counting, not whether the
    -- observed set still stands for final-record/certification reconciliation.
  ), graph as (
    select jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.id,
      'calculation_revision','dated_added_load_v3', 'name', t.name, 'rules', app_public.group_exercise_rules_json(row(t.*)::app_public.group_exercises),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
        'member_user_id', m.member_user_id, 'membership_id', m.membership_id,
        'links', coalesce((select jsonb_agg(jsonb_build_object(
          'exercise_definition_id', l.exercise_definition_id, 'updated_at_ms', l.updated_at)
          order by l.exercise_definition_id) from links l where l.member_user_id = m.member_user_id), '[]'::jsonb))
        order by m.member_user_id) from members m), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(ss.row order by ss.member_user_id, ss.set_id)
        from source_sets ss), '[]'::jsonb)) as value
    from target t
  ) select value || jsonb_build_object('source_token', encode(extensions.digest(value::text,'sha256'),'hex')) from graph;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_session_card_json(p_member uuid, p_session_id text, p_groups jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'kind', 'session',
    'key', p_member::text || ':' || p_session_id,
    'sort_at_ms', s.started_at,
    'member', app_public.group_member_ref_json(p_member),
    'session_id', p_session_id,
    'groups', p_groups,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member and g.id = s.gym_id and g.deleted_at is null
    ),
    'status', s.status,
    'started_at_ms', s.started_at,
    'completed_at_ms', s.completed_at,
    'duration_sec', s.duration_sec,
    'metric_scope','personal','metric_revision','dated_added_load_v3',
    'body_weight_kg',bw.context->'body_weight_kg','body_weight_source',bw.context->'body_weight_source',
    'body_weight_measurement_id',bw.context->'body_weight_measurement_id',
    'body_weight_measured_at_ms',bw.context->'body_weight_measured_at',
    'exercises', app_public.group_session_exercises_json(p_member, p_session_id)
  )
  from app_public.sessions s
  cross join lateral (select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context) bw
  where s.owner_user_id = p_member and s.id = p_session_id;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_session_detail(p_member_user_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _uid uuid := app_public.group_require_app_user();
  _s   record;
begin
  if not exists (
    select 1
      from app_public.group_session_shares sh
      join app_public.sessions s
        on s.owner_user_id = sh.member_user_id
       and s.id = sh.session_id
       and s.deleted_at is null
     where sh.member_user_id = p_member_user_id
       and sh.session_id = p_session_id
       and app_public.group_active_role(sh.group_id, _uid) is not null
  ) then
    raise exception 'NOT_FOUND: session not found'
      using errcode = 'P0001';
  end if;

  select x.gym_id,x.status,x.started_at,x.completed_at,x.duration_sec,
         app_public.session_weight_as_of(p_member_user_id,x.started_at) as body_weight
    into _s
    from app_public.sessions x
   where x.owner_user_id = p_member_user_id and x.id = p_session_id;

  return jsonb_build_object('session', jsonb_build_object(
    'member', app_public.group_member_ref_json(p_member_user_id),
    'session_id', p_session_id,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member_user_id and g.id = _s.gym_id and g.deleted_at is null
    ),
    'status', _s.status,
    'started_at_ms', _s.started_at,
    'completed_at_ms', _s.completed_at,
    'duration_sec', _s.duration_sec,
    'metric_scope','personal','metric_revision','dated_added_load_v3',
    'body_weight_kg',_s.body_weight->'body_weight_kg','body_weight_source',_s.body_weight->'body_weight_source',
    'body_weight_measurement_id',_s.body_weight->'body_weight_measurement_id',
    'body_weight_measured_at_ms',_s.body_weight->'body_weight_measured_at',
    'exercises', app_public.group_session_exercises_json(p_member_user_id, p_session_id)
  ));
end;
$function$;



-- Recompute active comparisons under the added-RM convention.
do $$ declare target record; begin
  for target in select ge.group_id,ge.id from app_public.group_exercises ge
    where ge.archived_at is null and not app_public.group_metric_is_legacy(ge.id)
  loop
    perform app_public.group_metric_eval_enqueue(target.group_id,target.id,'set');
  end loop;
end $$;
notify pgrst,'reload schema';
