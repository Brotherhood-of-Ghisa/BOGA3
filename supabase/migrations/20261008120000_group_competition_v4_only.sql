-- Group competition protocol 4 is the only group representation.
--
-- Removes the pending/protocol-3 server: the 27 old public RPCs and their
-- private *_pre_competition bodies, the activation flag and cutover, the legacy
-- kg board engine (group_eval_apply_legacy and its helpers) and every helper only
-- they reached. The V4 entrypoints absorb the private bodies they called; the
-- shared helpers keep only their active branch. Wire shapes are unchanged:
-- group_competition_contract still reports activation_state, now always
-- 'active'. Tables and stored history (rev-3 revisions, legacy certifications,
-- witness aliases, contract-version-1 events) stay.

-- A pending database holding groups has not run the cutover (frozen imports,
-- revision bumps). Refuse rather than skip it.
do $$
begin
  if not exists(select 1 from app_public.group_competition_activation where activated_at is not null)
    and exists(select 1 from app_public.groups) then
    raise exception 'group competitions are pending on a database that holds groups: run app_public.group_competition_activate(4) before this migration';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Shared helpers: the active branch only.
-- ---------------------------------------------------------------------------

create or replace function app_public.group_require_app_user()
returns uuid language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=auth.uid();
begin
  if _uid is null then raise exception 'AUTH_REQUIRED: group access requires an authenticated user' using errcode='P0001'; end if;
  if auth.jwt()->>'client_id' is not null then raise exception 'AGENT_FORBIDDEN: OAuth clients cannot access groups' using errcode='P0001'; end if;
  perform app_public.group_competition_require_capability();
  return _uid;
end;
$$;

create or replace function app_public.group_competition_contract(p_group_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user();
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  return jsonb_build_object('contract_version',4,'activation_state','active',
    'cache_version',5,'metrics',jsonb_build_array('volume','e1rm'),'default_metric','e1rm',
    'ordinary_units',jsonb_build_object('volume','kg_reps','e1rm','kg'),
    'normalized_units',jsonb_build_object('volume','percent_bw_reps','e1rm','percent_bw'));
end;
$$;

create or replace function app_public.group_exercise_validate_rules(p_enabled boolean,p_contribution double precision,p_default_metric text)
returns jsonb language plpgsql volatile set search_path=app_public,pg_temp as $$
begin
  if p_enabled is null then raise exception 'VALIDATION: bodyweight calculations state is required' using errcode='P0001'; end if;
  if p_contribution is null or not(p_contribution between 0 and 1) then
    raise exception 'VALIDATION: bodyweight contribution must be between 0 and 1' using errcode='P0001';
  end if;
  if p_default_metric is null or p_default_metric not in ('volume','e1rm') then
    raise exception 'VALIDATION: unsupported default competition metric' using errcode='P0001';
  end if;
  return jsonb_build_object('bodyweight_calculations_enabled',p_enabled,'bodyweight_contribution',p_contribution,'default_metric',p_default_metric);
end;
$$;

create or replace function app_public.group_metric_initial_revision()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,reason,legacy,created_by,published_at)
  values(new.group_id,new.id,1,app_public.group_exercise_rules_json(new),'initial',false,new.created_by,now());
  return null;
end;
$$;

-- New revisions are protocol 4; stored protocol-3 revisions keep their 3.
drop trigger group_rule_revisions_competition_version on app_public.group_rule_revisions;
alter table app_public.group_rule_revisions alter column representation_version set default 4;

create or replace function app_public.group_eval_apply(p_group_id uuid,p_member_user_id uuid,p_group_exercise_id uuid,p_causes text[])
returns void language plpgsql security definer set search_path=app_public,pg_temp as $$
declare _cause text;
begin
  foreach _cause in array p_causes loop
    perform app_public.group_metric_eval_enqueue(p_group_id,p_group_exercise_id,_cause);
  end loop;
end;
$$;

create or replace function app_public.group_metric_on_unarchive()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  update app_public.group_exercises set published_rules_revision=null where id=new.id;
  perform app_public.group_metric_eval_enqueue(new.group_id,new.id,'membership');
  perform app_public.group_eval_kick_once(null);
  return null;
end;
$$;

create or replace function app_public.group_metric_compute(p_exercise uuid,p_revision bigint,p_member uuid,p_certification_ids uuid[])
returns setof app_public.group_metric_board_entries language sql stable set search_path=app_public,pg_temp as $$
  with candidates as (
    select s.*,c.id as certification_id,
      row_number() over (partition by s.metric order by s.value desc,s.achieved_at_ms,
        s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id collate "C") as n
    from app_public.group_metric_set_scores s
    left join app_public.group_metric_certifications c on c.group_exercise_id = s.group_exercise_id
      and c.member_user_id = s.member_user_id and c.set_id = s.set_id and c.metric = s.metric
      and c.current_fingerprint = s.fingerprint and c.ended_at is null
    where s.group_exercise_id = p_exercise and s.rules_revision = p_revision
      and s.member_user_id = p_member and s.counting
      and (p_certification_ids is null or c.id = any(p_certification_ids))
  ) select (jsonb_populate_record(null::app_public.group_metric_board_entries,
      to_jsonb(c) || jsonb_build_object('certified',p_certification_ids is not null,'updated_at',now()))).*
    from candidates c where c.n = 1;
$$;

-- The protocol-3 source graph plus the protocol-4 Volume dependency pin, one
-- function. CASE guarantees lazy resolution of the as-of reading; a WHERE on a
-- lateral scalar expression does not stop the planner evaluating it while Off.
create or replace function app_public.group_metric_eval_source_graph(p_group_id uuid,p_group_exercise_id uuid)
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
        then app_public.session_weight_as_of(s.owner_user_id,s.started_at) end as context
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
  _graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets);
  return _graph||jsonb_build_object('source_token',encode(extensions.digest(_graph::text,'sha256'),'hex'));
end;
$$;
revoke all on function app_public.group_metric_eval_source_graph(uuid,uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- V4 entrypoints absorb the private bodies they called.
-- ---------------------------------------------------------------------------

create or replace function app_public.group_competition_exercise_create(p_group_id uuid,p_name text,p_load_input_mode text,
  p_source_exercise_id text default null,p_bodyweight_contribution double precision default 0,p_default_metric text default 'e1rm')
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _name text; _mode text; _source text; _enabled boolean;
  _row app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_exercise_require_manager(p_group_id,_uid);
  _name:=app_public.group_exercise_validate_name(p_name);
  _mode:=app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _source:=app_public.group_exercise_validate_source_id(p_source_exercise_id);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _enabled from app_public.groups where id=p_group_id;
  perform app_public.group_exercise_validate_rules(_enabled,p_bodyweight_contribution,p_default_metric);
  -- Revision 1 comes from the group_exercises_metric_initial_revision trigger.
  insert into app_public.group_exercises(group_id,name,load_input_mode,source_exercise_id,
    bodyweight_contribution,default_metric,created_by)
  values(p_group_id,_name,_mode,_source,p_bodyweight_contribution,p_default_metric,_uid)
  returning * into _row;
  select * into strict _row from app_public.group_exercises where id=_row.id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;

create or replace function app_public.group_competition_exercise_update(p_group_id uuid,p_exercise_id uuid,p_expected_revision bigint,
  p_name text,p_load_input_mode text,p_bodyweight_contribution double precision,p_default_metric text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _name text; _mode text; _enabled boolean;
  _old app_public.group_exercises; _row app_public.group_exercises; _rebuild boolean;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_exercise_require_manager(p_group_id,_uid);
  _name:=app_public.group_exercise_validate_name(p_name);
  _mode:=app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _enabled from app_public.groups where id=p_group_id for update;
  perform app_public.group_exercise_validate_rules(_enabled,p_bodyweight_contribution,p_default_metric);
  select * into _old from app_public.group_exercises where id=p_exercise_id and group_id=p_group_id for update;
  if not found then raise exception 'NOT_FOUND: group exercise not found' using errcode='P0001'; end if;
  if _old.archived_at is not null then
    raise exception 'VALIDATION: unarchive the group exercise before editing its rules' using errcode='P0001';
  end if;
  if p_expected_revision is distinct from _old.rules_revision then
    raise exception 'CONFLICT: group exercise rules changed; reload before saving' using errcode='P0001';
  end if;
  _rebuild:=row(_old.load_input_mode,_old.bodyweight_contribution) is distinct from row(_mode,p_bodyweight_contribution);
  if _rebuild then perform app_public.group_retire_current_revision(_old); end if;
  update app_public.group_exercises set name=_name,load_input_mode=_mode,
    bodyweight_contribution=p_bodyweight_contribution,default_metric=p_default_metric,
    rules_revision=_old.rules_revision+case when _rebuild then 1 else 0 end,
    published_rules_revision=case when _rebuild then null else _old.published_rules_revision end,
    updated_at=now() where id=_old.id returning * into _row;
  if _rebuild then
    insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,reason,legacy,created_by)
    values(p_group_id,_row.id,_row.rules_revision,app_public.group_exercise_rules_json(_row),
      case when _old.bodyweight_contribution=0 and p_bodyweight_contribution>0 then 'activation' else 'rules_change' end,false,_uid);
    perform app_public.group_metric_eval_enqueue(p_group_id,_row.id,'rules');
    perform app_public.group_eval_kick_once(_uid);
  else
    update app_public.group_rule_revisions set rules=app_public.group_exercise_rules_json(_row)
      where group_exercise_id=_row.id and revision=_row.rules_revision;
  end if;
  select * into strict _row from app_public.group_exercises where id=p_exercise_id and group_id=p_group_id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;

create or replace function app_public.group_competition_exercise_archive(p_group_id uuid,p_exercise_id uuid,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  if p_archived is null then raise exception 'VALIDATION: archive state is required' using errcode='P0001'; end if;
  perform app_public.group_exercise_require_manager(p_group_id,_uid);
  _row:=app_public.group_exercise_require(p_group_id,p_exercise_id);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  -- Unarchive catch-up is queued by the group_exercises_metric_unarchive trigger.
  if p_archived and _row.archived_at is null then
    update app_public.group_exercises set archived_at=now(),updated_at=now() where id=_row.id;
  elsif not p_archived and _row.archived_at is not null then
    update app_public.group_exercises set archived_at=null,updated_at=now() where id=_row.id;
  end if;
  select * into strict _row from app_public.group_exercises where id=p_exercise_id and group_id=p_group_id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;

create or replace function app_public.group_competition_certify(p_group_id uuid,p_group_exercise_id uuid,p_member_user_id uuid,
  p_set_id text,p_metric text,p_expected_revision bigint,p_write_token uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises; _score app_public.group_metric_set_scores;
  _row app_public.group_metric_certifications; _source jsonb; _created boolean:=true;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if p_metric is null or p_metric not in ('volume','e1rm') then raise exception 'VALIDATION: unsupported competition metric' using errcode='P0001'; end if;
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_member_user_id is null or p_set_id is null or p_set_id='' or p_member_user_id=_uid then
    raise exception 'VALIDATION: a different member and set are required' using errcode='P0001';
  end if;
  if _ge.archived_at is not null then raise exception 'VALIDATION: archived comparisons are read-only' using errcode='P0001'; end if;
  if _ge.rules_revision is distinct from p_expected_revision or _ge.published_rules_revision is distinct from _ge.rules_revision then
    raise exception 'CONFLICT: comparison rules changed; refresh before certifying' using errcode='P0001';
  end if;
  if app_public.group_active_role(p_group_id,p_member_user_id) is null then
    raise exception 'NOT_FOUND: member not found' using errcode='P0001';
  end if;
  select s.* into _score from app_public.group_metric_set_scores s
    where s.group_id=p_group_id and s.group_exercise_id=p_group_exercise_id and s.rules_revision=p_expected_revision
      and s.member_user_id=p_member_user_id and s.set_id=p_set_id and s.metric=p_metric and s.write_token=p_write_token;
  if not found then raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001'; end if;
  if app_public.group_set_is_warm_up(p_member_user_id,p_set_id) or not (
    exists (select 1 from app_public.group_metric_board_entries e
      where e.group_exercise_id=_ge.id and e.rules_revision=_ge.rules_revision
        and e.member_user_id=p_member_user_id and e.set_id=p_set_id and e.metric=p_metric and not e.certified)
    or exists (select 1 from app_public.group_events e
      where e.contract_version=2 and e.kind='record' and e.group_exercise_id=_ge.id
        and e.rules_revision=_ge.rules_revision and e.member_user_id=p_member_user_id and e.set_id=p_set_id
        and not exists (select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=e.id)
        and exists (select 1 from jsonb_array_elements(e.payload -> 'boards') b
          where b ->> 'metric'=p_metric and coalesce(
        e.rule_rescore_baseline->p_metric->>'fingerprint',b->>'fingerprint')=_score.fingerprint))) then
    raise exception 'NOT_FOUND: record set not found for this metric' using errcode='P0001';
  end if;
  select r into _source from jsonb_array_elements(app_public.group_metric_eval_source_graph(p_group_id,_ge.id) -> 'sets') r
    where r ->> 'member_user_id'=p_member_user_id::text and r ->> 'set_id'=p_set_id;
  if _source is null or not (_source ->> 'live')::boolean
    or _source -> 'fingerprints' ->> p_metric is distinct from _score.fingerprint then
    raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001';
  end if;
  select c.* into _row from app_public.group_metric_certifications c
    where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id
      and c.set_id=p_set_id and c.metric=p_metric and c.ended_at is null for update;
  if found and _row.observed_set_pin=_source->>'observed_set_pin'
    and (_source->>'reading_pin' is null or _row.reading_pin is null or _row.reading_pin=_source->>'reading_pin') then
    _created:=false;
  else
    if found then
      -- The display was already refreshed, but a prior pin still awaited the
      -- evaluator. End that observation explicitly before accepting a new one.
      update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),end_reason='voided'
        where id=_row.id;
    end if;
    insert into app_public.group_metric_certifications (group_id,group_exercise_id,member_user_id,
      set_id,session_id,metric,observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by,
      observed_set_pin,reading_pin,current_fingerprint)
    values (p_group_id,_ge.id,p_member_user_id,p_set_id,_score.session_id,p_metric,_ge.rules_revision,
      _score.value,_score.unit,_score.fingerprint,_score.performance,_uid,
      _source->>'observed_set_pin',_source->>'reading_pin',_score.fingerprint) returning * into _row;
    perform app_public.group_metric_enqueue_isolated(p_group_id,_ge.id,'certification',_uid);
  end if;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row),'created',_created);
end;
$$;

-- Legacy group_certifications (stored history) end through their original lifecycle:
-- group_certification_end voids the row and re-queues its board.
create or replace function app_public.group_competition_certification_end(p_group_id uuid,p_certification_id uuid,p_metric text,p_action text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _role text; _row app_public.group_metric_certifications;
  _origin app_public.group_metric_certifications; _legacy app_public.group_certifications;
begin
  _role:=app_public.group_require_member(p_group_id,_uid,true);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if p_metric is null or p_metric not in ('volume','e1rm') or p_action is null or p_action not in ('withdraw','cancel') then
    raise exception 'VALIDATION: invalid certification action' using errcode='P0001';
  end if;
  select * into _row from app_public.group_metric_certifications c where c.group_id=p_group_id and c.metric=p_metric
    and (c.id=p_certification_id or c.legacy_certification_id=p_certification_id or c.witness_certification_id=p_certification_id)
    order by c.certified_at desc,c.id limit 1 for update;
  if not found then
    select * into _legacy from app_public.group_certifications where group_id=p_group_id and id=p_certification_id for update;
    if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
  elsif (p_action='withdraw' and _row.certified_by is distinct from _uid) or (p_action='cancel' and _role not in ('owner','admin')) then
    raise exception 'FORBIDDEN: certification action is not allowed' using errcode='P0001';
  elsif _row.legacy_certification_id is not null then
    _legacy:=app_public.group_certification_require(p_group_id,_row.legacy_certification_id);
  end if;
  if _legacy.id is not null then
    if p_action='withdraw' and _legacy.certified_by is distinct from _uid then
      raise exception 'FORBIDDEN: only the certifier can withdraw a certification' using errcode='P0001';
    end if;
    if p_action='cancel' and _role not in ('owner','admin') then
      raise exception 'FORBIDDEN: only the owner or an admin can cancel a certification' using errcode='P0001';
    end if;
    perform app_public.group_certification_end(_legacy,case p_action when 'withdraw' then 'withdrawn' else 'cancelled' end,_uid);
    if _row.id is null then
      select * into strict _legacy from app_public.group_certifications where id=_legacy.id;
      return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_legacy_certification_json(_legacy,p_metric));
    end if;
  else
    select * into strict _origin from app_public.group_metric_certifications where id=coalesce(_row.witness_certification_id,_row.id) for update;
    if _origin.ended_at is null then
      update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),
        end_reason=case p_action when 'withdraw' then 'withdrawn' else 'cancelled' end,ended_by=_uid where id=_origin.id;
      perform app_public.group_metric_enqueue_isolated(p_group_id,_row.group_exercise_id,'certification',_uid);
    end if;
  end if;
  select * into strict _row from app_public.group_metric_certifications where id=_row.id;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row));
end;
$$;

create or replace function app_public.group_competition_week_summary(p_group_id uuid,p_window_start_ms bigint,p_window_end_ms bigint)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _members jsonb; _training jsonb; _latest jsonb; _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  if p_window_start_ms is null or p_window_end_ms is null or p_window_start_ms < 0
     or p_window_end_ms <= p_window_start_ms or p_window_end_ms - p_window_start_ms > 8 * 86400000 then
    raise exception 'VALIDATION: the window must be 0 <= p_window_start_ms < p_window_end_ms, at most 8 days long'
      using errcode = 'P0001';
  end if;

  -- The board: every current member, ranked by working sets then group
  -- records (one per board taken) over their completed, live sessions shared
  -- to this group and started in the window. Equal figures share a rank.
  with members as (
    select m.user_id, nullif(btrim(p.username), '') as username
      from app_public.group_memberships m
      left join app_public.user_profiles p on p.id = m.user_id
     where m.group_id = p_group_id and m.ended_at is null
  ),
  week_sessions as (
    select s.owner_user_id as member_user_id, s.id as session_id
      from app_public.group_session_shares sh
      join members mb on mb.user_id = sh.member_user_id
      join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
     where sh.group_id = p_group_id
       and s.deleted_at is null and s.status = 'completed'
       and s.started_at >= p_window_start_ms and s.started_at < p_window_end_ms
  ),
  totals as (
    select mb.user_id, mb.username,
           coalesce((select sum(c.working_sets) from week_sessions ws
                      cross join lateral app_public.group_week_session_counts(ws.member_user_id, ws.session_id) c
                     where ws.member_user_id = mb.user_id), 0)::integer as working_sets,
           -- One per board taken: a set #1 on Volume and on 1RM is two.
           coalesce((select sum(jsonb_array_length(r.record_json -> 'boards')) from week_sessions ws
              cross join lateral app_public.group_week_session_records(p_group_id, ws.member_user_id, ws.session_id) r
             where ws.member_user_id = mb.user_id), 0)::integer as group_records
      from members mb
  ),
  ranked as (
    select t.*, rank() over (order by t.working_sets desc, t.group_records desc) as rank
      from totals t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rank,
           'member', jsonb_build_object('user_id', r.user_id, 'username', r.username),
           'working_sets', r.working_sets,
           'group_records', r.group_records)
         order by r.rank, lower(r.username) nulls last, r.user_id), '[]'::jsonb)
    into _members
    from ranked r;

  -- Training now: current members' active, live sessions shared to this
  -- group whose latest accepted write (session, exercise or set row) is
  -- under 2 hours old. Not windowed: a session spanning midnight Sunday
  -- still trains now.
  select coalesce(jsonb_agg(jsonb_build_object(
           'member', app_public.group_member_ref_json(s.owner_user_id),
           'session_id', s.id,
           'started_at_ms', s.started_at,
           'gym_name', app_public.group_week_gym_name(s.owner_user_id, s.gym_id),
           'working_sets', c.working_sets,
           'exercise_count', c.exercise_count)
         order by s.started_at desc, s.owner_user_id, s.id), '[]'::jsonb)
    into _training
    from app_public.group_session_shares sh
    join app_public.group_memberships m
      on m.group_id = sh.group_id and m.user_id = sh.member_user_id and m.ended_at is null
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
    cross join lateral app_public.group_week_session_counts(s.owner_user_id, s.id) c
   where sh.group_id = p_group_id
     and s.deleted_at is null and s.status = 'active'
     and greatest(
           s.server_received_at,
           (select max(se.server_received_at) from app_public.session_exercises se
             where se.owner_user_id = s.owner_user_id and se.session_id = s.id),
           (select max(es.server_received_at) from app_public.session_exercises se
              join app_public.exercise_sets es
                on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
             where se.owner_user_id = s.owner_user_id and se.session_id = s.id)
         ) >= now() - interval '2 hours';

  -- The latest completed session: a current member's completed, live session
  -- shared to this group with the latest completed_at, at any time. Chosen
  -- first, so only that session's facts are counted.
  select jsonb_build_object(
           'member', app_public.group_member_ref_json(l.owner_user_id),
           'session_id', l.id,
           'started_at_ms', l.started_at,
           'completed_at_ms', l.completed_at,
           'duration_sec', l.duration_sec,
           'gym_name', app_public.group_week_gym_name(l.owner_user_id, l.gym_id),
           'working_sets', c.working_sets,
           'exercise_count', c.exercise_count,
           'group_records', coalesce((
             select jsonb_agg(r.record_json order by r.seq)
               from app_public.group_week_session_records(p_group_id, l.owner_user_id, l.id) r),
             '[]'::jsonb))
    into _latest
    from (
      select s.*
        from app_public.group_session_shares sh
        join app_public.group_memberships m
          on m.group_id = sh.group_id and m.user_id = sh.member_user_id and m.ended_at is null
        join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
       where sh.group_id = p_group_id
         and s.deleted_at is null and s.status = 'completed'
       order by s.completed_at desc nulls last, s.started_at desc, s.owner_user_id, s.id
       limit 1
    ) l
    cross join lateral app_public.group_week_session_counts(l.owner_user_id, l.id) c;

  if jsonb_typeof(_latest)='object' then
    -- `r.boards` holds only the boards the record took #1 on; a record value
    -- of any other board is the member's own best, not a group record.
    select coalesce(jsonb_agg(jsonb_set(x.event,'{values}',coalesce((
             select jsonb_agg(v.value order by v.ordinality)
               from jsonb_array_elements(x.event->'values') with ordinality v(value,ordinality)
              where v.value->>'role'<>'record'
                 or v.value->>'metric' in (select b->>'metric' from jsonb_array_elements(r->'boards') b)),'[]'::jsonb))
           order by e.seq),'[]') into _records
      from jsonb_array_elements(_latest->'group_records') r
      join app_public.group_events e on e.id=(r->>'key')::uuid and e.group_id=p_group_id
      cross join lateral (select app_public.group_competition_event_json(e) as event) x;
    _latest:=jsonb_build_object('member',_latest->'member','session_id',_latest->'session_id',
      'started_at_ms',_latest->'started_at_ms','completed_at_ms',_latest->'completed_at_ms',
      'duration_sec',_latest->'duration_sec','gym_name',_latest->'gym_name','working_sets',_latest->'working_sets',
      'exercise_count',_latest->'exercise_count','group_records',_records);
  end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'members',_members,
    'training_now',_training,'latest_completed',_latest);
end;
$$;

-- ---------------------------------------------------------------------------
-- Exact-anchor patches of the final definitions: each anchor must occur the
-- stated number of times, or the migration fails.
-- ---------------------------------------------------------------------------

do $v4_only$
declare _patch record; _definition text; _definitions jsonb:='{}'; _found integer;
begin
  for _patch in select * from (values
    -- The activation fence (lock 25006) has no exclusive holder any more.
    ('app_public.group_metric_eval_enqueue(uuid,uuid,text)',1,
      $old$  perform pg_advisory_xact_lock_shared(25006,0);
$old$,''),
    ('app_public.group_eval_complete(bigint,bigint,jsonb)',1,
      $old$  perform pg_advisory_xact_lock_shared(25006,0);
$old$,''),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$  perform pg_advisory_xact_lock_shared(25006,0);
$old$,''),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$x->>'metric'=any(app_public.group_metric_names())$old$,
      $new$x->>'metric' in ('volume','e1rm')$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$x->>'unit' is distinct from case when _graph->>'contract_version'='4'
        then app_public.group_competition_unit(x->>'metric',
          (_graph->'rules'->>'bodyweight_calculations_enabled')::boolean
          and (_graph->'rules'->>'bodyweight_contribution')::double precision>0)
        else app_public.group_metric_unit(x->>'metric') end$old$,
      $new$x->>'unit' is distinct from app_public.group_competition_unit(x->>'metric',
          (_graph->'rules'->>'bodyweight_calculations_enabled')::boolean
          and (_graph->'rules'->>'bodyweight_contribution')::double precision>0)$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$    case when _graph->>'contract_version'='4' then (x->>'value')::numeric
      else app_public.group_metric_rank_value((x->>'value')::double precision) end,x->>'unit',$old$,
      $new$    (x->>'value')::numeric,x->>'unit',$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$
  where _graph->>'contract_version'='4' or app_public.group_metric_rank_value((x->>'value')::double precision) is not null;$old$,
      $new$;$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',1,
      $old$  if app_public.group_competition_active() then
    perform app_public.group_metric_import_legacy_certifications(_exercise);
  end if;$old$,
      $new$  perform app_public.group_metric_import_legacy_certifications(_exercise);$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',1,
      $old$_metrics := app_public.group_metric_names();$old$,
      $new$_metrics := array['volume','e1rm'];$new$),
    -- Every source graph is contract 4.
    ('app_public.group_competition_import_witnesses(uuid,uuid,uuid,jsonb)',1,
      $old$
    and (p_graph->>'contract_version')='4'$old$,''),
    -- Archived comparisons and departed members keep their legacy witnesses for
    -- an unarchive or rejoin.
    ('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',2,
      $old$(not app_public.group_competition_active() or (p_exercise.archived_at is null
      and app_public.group_active_role(p_exercise.group_id,c.member_user_id) is not null))$old$,
      $new$p_exercise.archived_at is null
      and app_public.group_active_role(p_exercise.group_id,c.member_user_id) is not null$new$),
    -- group_require_app_user, called first by each of these, now requires the
    -- capability header itself.
    ('app_public.group_competition_board(uuid,uuid,text,boolean,integer,text)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_history(uuid,uuid,text,boolean,bigint,text,integer)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_certification_get(uuid,uuid,text)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_revisions(uuid,uuid)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_exercise_list(uuid)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_stream_page(uuid,jsonb,integer)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_podiums(uuid,boolean)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_session_detail(uuid,uuid,text)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,''),
    ('app_public.group_competition_stream(uuid,text,integer)',1,
      $old$  perform app_public.group_competition_require_active();
$old$,'')
  ) p(fn,expected,anchor,replacement) loop
    _definition:=coalesce(_definitions->>_patch.fn,pg_get_functiondef(_patch.fn::regprocedure));
    _found:=(length(_definition)-length(replace(_definition,_patch.anchor,'')))/length(_patch.anchor);
    if _found<>_patch.expected then
      raise exception 'v4-only patch: anchor found % times (expected %) in %',_found,_patch.expected,_patch.fn;
    end if;
    _definitions:=jsonb_set(_definitions,array[_patch.fn],to_jsonb(replace(_definition,_patch.anchor,_patch.replacement)));
  end loop;
  for _patch in select value as definition from jsonb_each_text(_definitions) loop execute _patch.definition; end loop;
end
$v4_only$;

-- ---------------------------------------------------------------------------
-- Drop the pre-V4 server. No stubs: shipped pre-V4 builds already map
-- UPDATE_REQUIRED and function-not-found to the same error.
-- ---------------------------------------------------------------------------

do $drop$
declare
  _names text[]:=array[
    -- The old public RPCs (legacy kg boards, protocol 3, *_v2).
    'group_board','group_board_podiums','group_board_history',
    'group_certify','group_certification_withdraw','group_certification_cancel',
    'group_exercise_list','group_exercise_create','group_exercise_update','group_exercise_archive','group_exercise_unarchive',
    'group_exercise_list_v2','group_exercise_create_v2','group_exercise_update_v2','group_exercise_archive_v2','group_exercise_unarchive_v2',
    'group_metric_board','group_metric_podiums','group_metric_history','group_metric_revisions',
    'group_metric_certify','group_metric_certification_get','group_metric_certification_end',
    'group_stream','group_stream_v2','group_session_detail','group_week_summary',
    -- Their private bodies.
    'group_board_pre_competition','group_board_podiums_pre_competition','group_board_history_pre_competition',
    'group_certify_pre_competition','group_certification_withdraw_pre_competition','group_certification_cancel_pre_competition',
    'group_exercise_list_pre_competition','group_exercise_create_pre_competition','group_exercise_update_pre_competition',
    'group_exercise_archive_pre_competition','group_exercise_unarchive_pre_competition',
    'group_exercise_list_v2_pre_competition','group_exercise_create_v2_pre_competition','group_exercise_update_v2_pre_competition',
    'group_exercise_archive_v2_pre_competition','group_exercise_unarchive_v2_pre_competition',
    'group_metric_board_pre_competition','group_metric_podiums_pre_competition','group_metric_history_pre_competition',
    'group_metric_revisions_pre_competition','group_metric_certify_pre_competition',
    'group_metric_certification_get_pre_competition','group_metric_certification_end_pre_competition',
    'group_stream_pre_competition','group_stream_v2_pre_competition','group_session_detail_pre_competition',
    'group_week_summary_pre_competition',
    -- Activation and the folded pending branches.
    'group_competition_active','group_competition_activate','group_competition_import_frozen_legacy',
    'group_competition_preserve_frozen','group_competition_require_active','group_competition_revision_version',
    'group_metric_eval_source_graph_v3','group_metric_names','group_metric_unit','group_metric_rank_value',
    -- Helpers only the dropped readers reached.
    'group_board_holder_with_member','group_board_link_exercises_json','group_board_related_json','group_board_validate',
    'group_board_ranked','group_certification_ref_json','group_certification_related_json','group_stream_event_json',
    'group_session_card_json','group_session_exercises_json','group_metric_board_ranked','group_metric_public_holder',
    'group_metric_event_json','group_metric_stream_event_json','group_metric_stream_record_context',
    'group_metric_revision_json','group_metric_exercise_revision_json','group_metric_require_legacy',
    'group_exercise_json_v2','group_exercise_json','group_metric_certification_json',
    -- The legacy kg board engine: no exercise has a legacy current revision.
    'group_metric_is_legacy','group_eval_apply_legacy','group_board_compute','group_board_counting',
    'group_board_certified_leader','group_board_holder_json','group_board_kg','group_board_leader',
    'group_board_load_factor','group_board_rank','group_board_weight_as_raw','group_board_weight_rule_moved',
    'group_board_would_lead','group_certification_matching'];
  _fn record; _dropped integer:=0; _bad text;
begin
  for _fn in select p.proname,pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname=any(_names)
  loop
    execute format('drop function app_public.%I(%s)',_fn.proname,_fn.args);
    _dropped:=_dropped+1;
  end loop;
  if _dropped<>cardinality(_names) then
    raise exception 'v4-only drop: dropped % functions, expected %',_dropped,cardinality(_names);
  end if;
  -- No surviving body may still call a dropped function.
  select string_agg(p.proname||' -> '||d.name,', ' order by p.proname,d.name) into _bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join unnest(_names) d(name)
    where n.nspname='app_public' and p.prosrc ~ ('\m'||d.name||'\s*\(');
  if _bad is not null then raise exception 'v4-only drop: surviving functions call dropped ones: %',_bad; end if;
end
$drop$;

drop table app_public.group_competition_activation;
