-- A comparison's source graph holds only the sets the comparison can reach.
--
-- Before: group_metric_eval_source_graph carried every set of every shared
-- session of every current member, linked or not, so a graph grew 2x per
-- doubling of history or members however few sets were linked: 8.8 MB per
-- evaluation at 10 members x 3 months, and past a 120 s call at 10 members x
-- 1 year. Each publish builds it twice, prepare once, and readiness twice per
-- target.
--
-- Now a member's set is in the graph when the comparison reaches it, the
-- reach group_eval_complete (20261022090000) already queues by:
--   - its exercise definition is linked to the target, or was linked at the
--     member's last apply (board state's linked_definition_ids), so the
--     first publish after an unlink still sees what it unlinked;
--   - or, by set id (a set can be retargeted to another definition), it
--     carries an active certification (protocol 4 or legacy), an unvoided
--     record, a current board entry or a counting score.
-- Unlinking still voids nothing: a record or certification keeps its set in
-- the graph until it ends. A set enters the graph, is scored and has its
-- bodyweight bound at its first publish after a link.
--
-- A publication's own writes can end a reference (board state drops an
-- unlinked definition; a record or certification is voided), so the graph
-- rebuilt for its final source check can hold fewer sets than the one it
-- published from. That check now compares the published graph over the sets
-- the rebuilt graph still reaches (linked rows, or rows it still holds) and
-- persists the rebuilt graph's digest, which later readiness checks rebuild.
--
-- Publish also validated each score with a scan of the whole graph array
-- (scores x sets). It now looks each source up in one keyed index.
--
-- Every live comparison is queued once (a silent 'rules' cause) so its score
-- rows outside the reach are deleted and its persisted digest is refreshed.
-- Confirmed workouts awaiting their summary keep a current context digest.

-- A confirmed workout still awaiting its summary is ready only while its
-- stored context digest (hashing its sessions' graph rows) is current. The
-- graph's shape changes below, so the digests current now are re-stamped
-- after it; others still wait for the app to confirm again.
create temporary table graph_reach_current_contexts as
select w.member_user_id,w.session_id from app_public.notification_workouts w
where w.eligible and w.confirmed_at is not null and w.enqueued_generation<w.generation
  and w.completion_at+interval '24 hours'>now()
  and w.context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id);

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
revoke all on function app_public.group_metric_eval_source_graph(uuid,uuid) from public,anon,authenticated,service_role;

update app_public.notification_workouts w
   set context_digest=app_public.notification_context_digest(w.member_user_id,w.session_id)
  from graph_reach_current_contexts c
 where c.member_user_id=w.member_user_id and c.session_id=w.session_id;
drop table graph_reach_current_contexts;

-- p_graph's sets that p_current still reaches: rows linked when p_graph was
-- built (a link change since moves p_current's members anyway), or rows
-- p_current holds. A dropped row is one whose only reference has ended.
create function app_public.group_metric_graph_within(p_graph jsonb, p_current jsonb)
returns jsonb language sql immutable set search_path=app_public,pg_temp as $$
  with current_sets as materialized (
    select coalesce(jsonb_object_agg((r->>'member_user_id')||'/'||(r->>'set_id'),true),'{}'::jsonb) as keys
    from jsonb_array_elements(p_current->'sets') r)
  select p_graph||jsonb_build_object('sets',coalesce((
    select jsonb_agg(x.r order by x.n) from current_sets c
    cross join jsonb_array_elements(p_graph->'sets') with ordinality x(r,n)
    where (x.r->>'counting')::boolean or c.keys ? ((x.r->>'member_user_id')||'/'||(x.r->>'set_id'))),'[]'::jsonb));
$$;
revoke all on function app_public.group_metric_graph_within(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function app_public.group_metric_eval_publish(p_job_id bigint,p_generation bigint,p_claim_id uuid,p_evaluation jsonb)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare q group_metric_eval_queue; g jsonb; result jsonb; captured boolean:=false; published boolean:=false;
  current_graph jsonb; current_digest text;
begin
  select * into q from group_metric_eval_queue where id=p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from groups where id=q.group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(q.group_id::text));
  select * into q from group_metric_eval_queue where id=p_job_id for update;
  if q.claim_id is distinct from p_claim_id or q.generation is distinct from p_generation or p_claim_id is null then
    return group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation); end if;
  -- The only graph built before the writes. A null graph (frozen) is resolved
  -- again by the inner publish.
  g:=group_metric_eval_source_graph(q.group_id,q.group_exercise_id);
  if g is not null and p_evaluation->>'source_token'=g->>'source_token' then
    perform notification_capture_comparison_from_graph(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,false,g);
    captured:=true;
  end if;
  result:=group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation,g);
  if (result->>'completed')::boolean and g is not null then
    perform notification_capture_comparison_from_graph(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,true,g);
    captured:=true;
    published:=true;
  end if;
  if (result->>'completed')::boolean and g is not null then
    perform group_set_body_weight_bind(g);
  end if;
  -- Every capture and score row came from g: a source that moved since it was
  -- built rolls the publication back, as the passes' own boundaries did. The
  -- writes above can end a set's only reference, so g is compared over the
  -- sets the rebuilt graph still reaches.
  if captured then
    current_graph:=group_metric_eval_source_graph(q.group_id,q.group_exercise_id);
    current_digest:=notification_comparison_digest(current_graph);
    if notification_comparison_digest(group_metric_graph_within(g,current_graph)) is distinct from current_digest then
      raise exception 'notification capture source moved' using errcode='P0001'; end if;
    -- Readiness rebuilds the graph as it stands after these writes.
    if published then
      update notification_comparison_publications set source_digest=current_digest
        where group_exercise_id=q.group_exercise_id and source_digest is distinct from current_digest;
    end if;
  end if;
  return result;
end $$;

-- The inner publish finds each score's source in one keyed index of the
-- graph's sets instead of scanning the array once per score.
do $patch$
declare
  _definition text;
  _anchor text;
  _replacement text;
begin
  _definition := pg_get_functiondef(
    'app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)'::regprocedure);
  foreach _anchor in array array[
    $a$  _count integer;
begin$a$,
    $a$  if jsonb_typeof(p_evaluation->'scores') is distinct from 'array' then$a$,
    $a$      or not exists(select 1 from jsonb_array_elements(_graph->'sets') r
        where r->>'member_user_id'=x->>'member_user_id' and r->>'set_id'=x->>'set_id'
          and (r->>'live')::boolean$a$,
    $a$  join jsonb_array_elements(_graph->'sets') r on r->>'member_user_id'=x->>'member_user_id'
    and r->>'set_id'=x->>'set_id'$a$]
  loop
    if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
      raise exception 'group_metric_eval_publish_without_notifications: anchor not found exactly once: %', left(_anchor, 60);
    end if;
    _replacement := case _anchor
      when $a$  _count integer;
begin$a$ then $a$  _count integer;
  _sources jsonb;
begin$a$
      when $a$  if jsonb_typeof(p_evaluation->'scores') is distinct from 'array' then$a$ then
        $a$  select coalesce(jsonb_object_agg((r->>'member_user_id')||'/'||(r->>'set_id'),r),'{}'::jsonb) into _sources
    from jsonb_array_elements(_graph->'sets') r;
  if jsonb_typeof(p_evaluation->'scores') is distinct from 'array' then$a$
      when $a$  join jsonb_array_elements(_graph->'sets') r on r->>'member_user_id'=x->>'member_user_id'
    and r->>'set_id'=x->>'set_id'$a$ then
        $a$  join lateral (select _sources->((x->>'member_user_id')||'/'||(x->>'set_id')) as r) k on k.r is not null$a$
      else $a$      or not exists(select 1 from (select _sources->((x->>'member_user_id')||'/'||(x->>'set_id')) as r) k
        where (r->>'live')::boolean$a$
    end;
    _definition := replace(_definition, _anchor, _replacement);
  end loop;
  execute _definition;
end
$patch$;

do $requeue$
declare e record;
begin
  for e in select ge.group_id,ge.id from app_public.group_exercises ge
    join app_public.groups g on g.id=ge.group_id
    where g.deleted_at is null and ge.archived_at is null
  loop
    perform app_public.group_metric_enqueue_isolated(e.group_id,e.id,'rules',null);
  end loop;
end
$requeue$;
