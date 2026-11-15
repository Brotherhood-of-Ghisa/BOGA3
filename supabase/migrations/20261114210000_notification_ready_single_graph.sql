-- Notification readiness proved the same facts several times over, and each
-- proof rebuilt the group's whole source graph (every shared set of the
-- exercise, a cost that grows with the group's history):
--   * notification_context_digest built the graph of every target of a workout
--     to digest only that one member's sets of that one session;
--   * notification_workout_ready then built it again for the capture's final
--     ranks, again for the without-workout ranks and again, twice, for the
--     comparison digest.
-- notification_workout_enqueue, notification_workout_prepare and
-- notification_begin_send each call readiness, and notification_confirm_completion
-- the context digest, so each of them paid several graph builds.
--
-- Now the context digest reads a slice of the graph (notification_context_source:
-- the member's rows of the session only, the same JSON for those rows), and
-- readiness builds each target's graph once and gives it to the rank checks
-- and the digest. Every check, its order per target and its outcome are
-- unchanged: the same conditions are tested, each against the same data in
-- the same statement snapshot.

-- The part of group_metric_eval_source_graph the context digest reads: the
-- rules, the member's own row and the member's sets of one session. A set is
-- reached when the graph would reach it (a counting link, or an active
-- certification, a live record, a board entry or a counting score), tested
-- per set instead of by listing the group's reach sets.
create function app_public.notification_context_source(p_group_id uuid,p_group_exercise_id uuid,p_member uuid,p_session text)
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
    where gm.group_id=t.group_id and gm.ended_at is null and gm.user_id=p_member
  ), links as (
    select l.owner_user_id as member_user_id,l.exercise_definition_id,l.updated_at
    from app_public.exercise_group_links l,target t
    where l.owner_user_id=p_member and l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id)=t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id)=t.id
      and exists(select 1 from members m where m.member_user_id=l.owner_user_id)
  ), reach_definitions as (
    select l.member_user_id,l.exercise_definition_id from links l
    union
    select st.member_user_id,d.exercise_definition_id
    from target t
    join app_public.group_metric_board_state st on st.group_exercise_id=t.id and st.rules_revision=t.rules_revision
      and st.member_user_id=p_member
    join members m on m.member_user_id=st.member_user_id
    cross join lateral unnest(st.linked_definition_ids) d(exercise_definition_id)
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id',s.owner_user_id,'session_id',s.id,
      'session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
      'set_id',es.id,'weight_value',es.weight_value,'reps_value',es.reps_value,
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
    join app_public.group_session_shares sh on sh.group_id=t.group_id and sh.member_user_id=p_member and sh.session_id=p_session
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
    where (s.owner_user_id,se.exercise_definition_id) in (select member_user_id,exercise_definition_id from reach_definitions)
      or exists(select 1 from app_public.group_metric_certifications c where c.group_exercise_id=t.id
        and c.ended_at is null and c.member_user_id=es.owner_user_id and c.set_id=es.id)
      or exists(select 1 from app_public.group_certifications c where c.group_exercise_id=t.id
        and c.ended_at is null and c.member_user_id=es.owner_user_id and c.set_id=es.id)
      or exists(select 1 from app_public.group_events e where e.group_exercise_id=t.id and e.kind='record'
        and e.member_user_id=es.owner_user_id and e.set_id=es.id
        and not exists(select 1 from app_public.group_events v
          where v.kind='record_voided' and v.related_event_id=e.id))
      or exists(select 1 from app_public.group_metric_board_entries e where e.group_exercise_id=t.id
        and e.rules_revision=t.rules_revision and e.member_user_id=es.owner_user_id and e.set_id=es.id)
      or exists(select 1 from app_public.group_metric_set_scores sc where sc.group_exercise_id=t.id
        and sc.rules_revision=t.rules_revision and sc.counting
        and sc.member_user_id=es.owner_user_id and sc.set_id=es.id)
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
  return jsonb_build_object('rules',_graph->'rules','members',_graph->'members','sets',_sets);
end;
$$;
-- An internal proof input, like the graph it slices: only the definer's own functions read it.
revoke all on function app_public.notification_context_source(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function app_public.notification_context_digest(p_member uuid,p_session text)
returns text language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare t jsonb; g jsonb; contexts jsonb:='[]'::jsonb;
begin
  for t in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    g:=notification_context_source((t->>'group_id')::uuid,(t->>'group_exercise_id')::uuid,p_member,p_session);
    contexts:=contexts||jsonb_build_array(jsonb_build_object('target',t,'rules',(g->'rules')-array['name','default_metric','description'],
      'sets',coalesce((select jsonb_agg(x order by x->>'set_id') from jsonb_array_elements(g->'sets') x
        where x->>'member_user_id'=p_member::text and x->>'session_id'=p_session),'[]'::jsonb),
      'member',coalesce((select x from jsonb_array_elements(g->'members') x where x->>'member_user_id'=p_member::text),'{}'::jsonb)));
  end loop;
  return encode(extensions.digest(contexts::text,'sha256'),'hex');
end $$;

-- The same conditions as before. Per target, cheap conditions first, then one
-- graph build shared by the two rank comparisons and the digest comparison.
create or replace function app_public.notification_workout_ready(p_member uuid,p_session text)
returns boolean language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare w notification_workouts; target jsonb; t notification_workout_targets; published text; graph jsonb;
begin
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session;
  if not found or not w.eligible or w.confirmed_at is null or w.completion_at is null or w.completion_at+interval '24 hours'<=now()
    or w.completion_at<(select started_at from notification_workout_epoch) or w.completion_at>now()+interval '5 minutes'
    or w.manifest_digest is distinct from notification_manifest_digest(p_member,p_session)
    or w.context_digest is distinct from notification_context_digest(p_member,p_session) then return false; end if;
  if not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='completed' and deleted_at is null) or
    exists(select 1 from group_eval_queue where kind='session' and member_user_id=p_member and session_id=p_session) then return false; end if;
  for target in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    if exists(select 1 from group_metric_eval_queue where group_exercise_id=(target->>'group_exercise_id')::uuid) then return false; end if;
    select t2.* into t from notification_workout_targets t2
      join notification_comparison_publications p using(group_exercise_id)
      join group_exercises ge on ge.id=t2.group_exercise_id
      where t2.member_user_id=p_member and t2.session_id=p_session and t2.group_exercise_id=(target->>'group_exercise_id')::uuid
        and t2.evaluated and t2.baseline_known and t2.rules_revision=ge.rules_revision and ge.published_rules_revision=ge.rules_revision;
    if not found then return false; end if;
    select source_digest into published from notification_comparison_publications where group_exercise_id=t.group_exercise_id;
    graph:=group_metric_eval_source_graph(t.group_id,t.group_exercise_id);
    if not coalesce(t.final_ranks=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,null,graph),false)
      or not coalesce(t.without_workout=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,t,graph),false)
      or not coalesce(published=notification_comparison_digest(graph),false) then return false; end if;
  end loop;
  return true;
end $$;
