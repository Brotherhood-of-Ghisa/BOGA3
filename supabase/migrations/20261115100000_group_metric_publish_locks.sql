-- Comparison publication's group-row lock, and the screen readers' hold on it.
--
-- Before: both publish paths took the group row FOR UPDATE, and every
-- protocol-4 reader held it FOR SHARE for its whole call
-- (group_competition_require_member). FOR UPDATE conflicts with the KEY SHARE
-- that every insert referencing the group takes through its foreign key, so
-- group_eval_complete, holding one comparison's queue row while it queued the
-- next, deadlocked against a publisher waiting for that row; and a publisher
-- waited for every reader in flight.
--
-- Now publishers take the row FOR NO KEY UPDATE: they still serialize with
-- each other, with rule changes and with management (FOR UPDATE), and with
-- the notification fences (FOR SHARE), but no longer with foreign-key checks
-- or CoW publication's KEY SHARE. CoW publication still waits for a manager's
-- FOR UPDATE before its fence. Readers hold KEY SHARE: they still wait for
-- rule changes and management, never for a publisher, and never block one.
-- Each statement of a reader sees its own snapshot, so a publication that
-- commits during a multi-statement read shows only in its later statements
-- (a board's count or own row one publication ahead of its page). Every
-- statement still reads the one rules revision the read began with, so
-- revisions never mix, and the next refresh agrees.

-- The comparison's source graph, found from its reach. Before, it joined
-- every shared session's every set of every current member and kept the
-- reached ones, probing each set's session, session exercise and definition
-- (prepare built it once per evaluation, publish twice). It now starts from
-- the reached definitions and set ids, carries the rows it found, and reads
-- the group's shares and the members' sessions once each. The graph is the
-- same, row for row and in the same order, so its source token and every
-- digest stay what they were.
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
  ), reached_by_definition as materialized (
    -- Reached sets, found from the reach itself rather than from every shared
    -- set: a reached definition's session exercises and their sets, then each
    -- set referenced by id that those do not already hold. A row carries its
    -- session exercise and set rows, so neither is read twice.
    select se.owner_user_id as member_user_id,se,es
    from reach_definitions r
    join app_public.session_exercises se on se.exercise_definition_id=r.exercise_definition_id
      and se.owner_user_id=r.member_user_id
    join app_public.exercise_sets es on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
  ), reached as materialized (
    select d.member_user_id,d.se,d.es from reached_by_definition d
    union all
    select es.owner_user_id,se,es
    from (select distinct member_user_id,set_id from reach_set_ids) r
    join app_public.exercise_sets es on es.owner_user_id=r.member_user_id and es.id=r.set_id
    join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
    where not exists(select 1 from reached_by_definition d
      where d.member_user_id=r.member_user_id and (d.es).id=r.set_id)
  ), shares as materialized (
    -- The group's shares by current members, read once as a set.
    select sh.member_user_id,sh.session_id
    from target t
    join app_public.group_session_shares sh on sh.group_id=t.group_id
    join members m on m.member_user_id=sh.member_user_id
  ), reached_sessions as materialized (
    -- Each reached session once, if it is shared into the group. The
    -- members' sessions are read as one range per member (offset 0 keeps
    -- that scan), not probed once per reached session.
    select x.s
    from (select distinct member_user_id,(se).session_id as session_id from reached) k
    join shares sh on sh.member_user_id=k.member_user_id and sh.session_id=k.session_id
    join (select s from members m join app_public.sessions s on s.owner_user_id=m.member_user_id offset 0) x
      on (x.s).owner_user_id=k.member_user_id and (x.s).id=k.session_id
  ), reached_definitions as materialized (
    select ed
    from (select distinct member_user_id,(se).exercise_definition_id as definition_id from reached) k
    join app_public.exercise_definitions ed on ed.owner_user_id=k.member_user_id and ed.id=k.definition_id
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
          app_public.group_metric_performance_pin('weight',x.es,x.se,rs.s,rd.ed),
          t.rules_revision,t.load_input_mode
        )::text,'sha256'),'hex'),
        'e1rm',encode(extensions.digest(jsonb_build_array(
          app_public.group_metric_performance_pin('e1rm',x.es,x.se,rs.s,rd.ed),
          t.rules_revision,t.load_input_mode,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then t.bodyweight_contribution end,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then coalesce(bw.context,jsonb_build_object('body_weight_kg',null)) end
        )::text,'sha256'),'hex'))
    ) as row,s.owner_user_id as member_user_id,es.id as set_id
    from reached x
    join reached_sessions rs on (rs.s).owner_user_id=x.member_user_id and (rs.s).id=(x.se).session_id
    left join reached_definitions rd on (rd.ed).owner_user_id=x.member_user_id and (rd.ed).id=(x.se).exercise_definition_id
    cross join target t
    cross join lateral (select (x.es).*) es
    cross join lateral (select (x.se).*) se
    cross join lateral (select (rs.s).*) s
    cross join lateral (select (rd.ed).*) ed
    left join lateral (
      select case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
        then coalesce((select b.context from app_public.group_set_body_weight_bindings b
          where b.member_user_id=s.owner_user_id and b.set_id=es.id
            and b.source_key=app_public.group_set_body_weight_key(x.es,s.started_at)),
          app_public.session_weight_as_of(s.owner_user_id,s.started_at)) end as context
    ) bw on true
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

do $locks$
declare
  _definition text;
  _anchor text;
  _fn regprocedure;
begin
  foreach _fn in array array[
    'app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure,
    'app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)'::regprocedure]
  loop
    _definition := pg_get_functiondef(_fn);
    _anchor := case _fn
      when 'app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure
        then 'perform 1 from groups where id=q.group_id for update;'
      else 'perform 1 from app_public.groups where id=_group_id for update;' end;
    if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
      raise exception '%: group lock anchor not found exactly once', _fn;
    end if;
    execute replace(_definition, _anchor, replace(_anchor, 'for update;', 'for no key update;'));
  end loop;

  _definition := pg_get_functiondef('app_public.group_competition_require_member(uuid,uuid)'::regprocedure);
  _anchor := $a$  -- Concurrent readers share this lock; rule changes/publication use FOR UPDATE.
  perform 1 from app_public.groups where id=p_group and deleted_at is null for share;$a$;
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_competition_require_member: reader lock anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor, $r$  -- Readers wait for rule changes and management (FOR UPDATE), never for a
  -- publisher (FOR NO KEY UPDATE), and never block one.
  perform 1 from app_public.groups where id=p_group and deleted_at is null for key share;$r$);
end
$locks$;

-- Readers no longer hold publication off, so a reader that reads published
-- rows in more than one statement must still return a shape its client
-- accepts (the board already reads its count, page and own row in one). A
-- stream record card's event, record and group records are rebuilt together
-- from the record's row as it stands (a publication can rewrite a kept
-- record's boards between the page and its decoration); a card whose record a
-- publication retracted meanwhile drops its record, as the earlier
-- decoration does.
do $readers$
declare
  _definition text;
  _anchor text;
  _replacement text;
begin
  _definition := pg_get_functiondef('app_public.group_competition_stream_v4(uuid,text,integer)'::regprocedure);
  _anchor := $a$    select jsonb_agg(case when e.id is not null and e.kind='record' and jsonb_typeof(i->'record')='object'
      then jsonb_set(i,'{record,group_record_metrics}',app_public.group_competition_stream_group_record_metrics(e)) else i end$a$;
  _replacement := $r$    select jsonb_agg(case when e.id is not null and e.kind='record' and jsonb_typeof(i->'record')='object'
      then app_public.group_competition_stream_event(e.id,(i->>'sort_at_ms')::bigint)
        ||jsonb_build_object('record',app_public.group_competition_stream_record(e)
          ||jsonb_build_object('group_record_metrics',app_public.group_competition_stream_group_record_metrics(e)))
      when jsonb_typeof(i->'record')='object' then i-'record' else i end$r$;
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_competition_stream_v4: record anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor, _replacement);
end
$readers$;
