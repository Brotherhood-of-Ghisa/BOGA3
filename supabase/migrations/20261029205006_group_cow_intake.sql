-- A deferred seal observes the final coherent transaction, never a sync cursor.
create table app_public.group_cow_pending (
  id bigint generated always as identity primary key,
  group_id uuid not null,
  source_xid bigint not null
);
create index group_cow_pending_transaction on app_public.group_cow_pending(source_xid,group_id,id);
alter table app_public.group_cow_pending enable row level security;
revoke all on app_public.group_cow_pending from public,anon,authenticated,service_role;

create function app_public.group_cow_context(p_cow app_public.group_cows) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare ge app_public.group_exercises; enabled boolean; version integer;
begin
  perform app_public.group_cow_reject_agent();
  select * into ge from app_public.group_exercises where id=p_cow.group_exercise_id and group_id=p_cow.group_id;
  select bodyweight_calculations_enabled into enabled from app_public.groups where id=p_cow.group_id and deleted_at is null;
  select rules_version into version from app_public.group_eval_rules_state where singleton;
  return jsonb_build_object('group_exercise_id',p_cow.group_exercise_id,'rules_revision',ge.rules_revision,
    'scorer_version',version,'load_input_mode',ge.load_input_mode,'bodyweight_contribution',ge.bodyweight_contribution,
    'bodyweight_calculations_enabled',coalesce(enabled and ge.bodyweight_contribution>0,false),
    'normalized',coalesce(enabled and ge.bodyweight_contribution>0,false),
    'available',ge.id is not null and ge.archived_at is null and enabled is not null and version is not null);
end $$;

-- This is only the minimal scorer envelope. No workout names, orders, gyms,
-- whole sessions or private reading history are copied into CoW storage.
create function app_public.group_cow_source_snapshot(p_cow app_public.group_cows,p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  return (with candidates as (
    select s.owner_user_id as member_user_id,es.id as set_id,s.id as session_id,s.started_at,
      s.status='completed' and s.completed_at is not null as completed,
      s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null
        and ed.deleted_at is null and exists(select 1 from app_public.exercise_group_links l
          where l.owner_user_id=s.owner_user_id and l.exercise_definition_id=se.exercise_definition_id
            and l.deleted_at is null and app_public.group_eval_try_uuid(l.group_id)=p_cow.group_id
            and app_public.group_eval_try_uuid(l.group_exercise_id)=p_cow.group_exercise_id) as eligible,
      es.weight_value,es.reps_value,es.set_type,es.performance_status,ed.load_input_mode,
      app_public.group_set_body_weight_key(es,s.started_at) as binding_key,
      case when (p_context->>'normalized')::boolean then
        coalesce(case when clock_timestamp()>=p_cow.starts_at then
            (select x.input->'body_weight_context' from app_public.group_cow_sources x
              where x.cow_id=p_cow.id and x.member_user_id=s.owner_user_id and x.set_id=es.id
                and x.input->>'binding_key'=app_public.group_set_body_weight_key(es,s.started_at)
                and x.input->'eligible'='true'::jsonb and x.input->'completed'='true'::jsonb
                and x.input->'context'=p_context order by x.received_at desc,x.id desc limit 1) end,
          (select b.context from app_public.group_set_body_weight_bindings b
            where b.member_user_id=s.owner_user_id and b.set_id=es.id
              and b.source_key=app_public.group_set_body_weight_key(es,s.started_at)),
          app_public.session_weight_as_of(s.owner_user_id,s.started_at)) end as body_weight_context
    from app_public.group_session_shares sh
    join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id
    join app_public.session_exercises se on se.owner_user_id=s.owner_user_id and se.session_id=s.id
    join app_public.exercise_sets es on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    where sh.group_id=p_cow.group_id
      and (exists(select 1 from app_public.group_memberships m where m.group_id=p_cow.group_id
             and m.user_id=s.owner_user_id and m.ended_at is null)
        or exists(select 1 from app_public.group_cow_admissions a where a.cow_id=p_cow.id and a.member_user_id=s.owner_user_id))
      and (exists(select 1 from app_public.exercise_group_links l where l.owner_user_id=s.owner_user_id
             and l.exercise_definition_id=se.exercise_definition_id and app_public.group_eval_try_uuid(l.group_id)=p_cow.group_id
             and app_public.group_eval_try_uuid(l.group_exercise_id)=p_cow.group_exercise_id)
        or exists(select 1 from app_public.group_cow_sources x where x.cow_id=p_cow.id and x.member_user_id=s.owner_user_id and x.set_id=es.id))
  ) select coalesce(jsonb_agg(jsonb_build_object('member_user_id',member_user_id,'set_id',set_id,'input',
    jsonb_build_object('session_id',session_id,'session_started_at_ms',started_at,'completed',completed,
      'shared',true,'eligible',eligible,'weight_value',weight_value,'reps_value',reps_value,'set_type',set_type,
      'performance_status',performance_status,'source_load_input_mode',load_input_mode,
      'binding_key',binding_key,'body_weight_context',body_weight_context,'context',p_context))
    order by member_user_id,set_id),'[]'::jsonb) from candidates
  );
end $$;

create function app_public.group_cow_capture(p_cow_id uuid) returns void
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare c app_public.group_cows; ctx jsonb; graph jsonb; people jsonb; receipt timestamptz; xid bigint:=txid_current();
  row jsonb; old app_public.group_cow_sources; person jsonb; prior_context jsonb; changed boolean:=false; written_rows integer;
begin
  perform app_public.group_cow_reject_agent();
  -- Exclude management/barriers without blocking ordinary group readers.
  -- The CoW row serializes captures after the final dependency validations.
  perform 1 from app_public.groups g join app_public.group_cows x on x.group_id=g.id where x.id=p_cow_id for key share of g;
  select * into c from app_public.group_cows where id=p_cow_id for update;
  if not found or c.cancelled_at is not null or c.finalized_at is not null then return; end if;
  delete from app_public.group_cow_sources where cow_id=c.id and source_xid=xid;
  delete from app_public.group_cow_contexts where cow_id=c.id and source_xid=xid;
  ctx:=app_public.group_cow_context(c);
  graph:=app_public.group_cow_source_snapshot(c,ctx);
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'member_user_id',m.user_id,
    'active',m.ended_at is null)),'[]'::jsonb) into people from app_public.group_memberships m
    where m.group_id=c.group_id and (m.ended_at is null or exists(select 1 from app_public.group_cow_admissions a
      where a.cow_id=c.id and a.membership_id=m.id));
  -- Missing/deleted periods end here too; the admission itself has no auth FK.
  select people||coalesce(jsonb_agg(jsonb_build_object('membership_id',a.membership_id,
    'member_user_id',a.member_user_id,'active',false)),'[]'::jsonb) into people
    from app_public.group_cow_admissions a where a.cow_id=c.id and not exists(
      select 1 from app_public.group_memberships m where m.id=a.membership_id);
  receipt:=clock_timestamp();
  for person in select value from jsonb_array_elements(people) loop
    insert into app_public.group_cow_admissions as a(cow_id,membership_id,member_user_id,joined_at,ended_at,joined_xid,ended_xid)
      values(c.id,(person->>'membership_id')::uuid,(person->>'member_user_id')::uuid,receipt,
        case when not (person->>'active')::boolean then receipt end,xid,
        case when not (person->>'active')::boolean then xid end)
      on conflict(cow_id,membership_id) do update set
        joined_at=case when a.joined_xid=xid then receipt else a.joined_at end,
        ended_at=case when a.ended_at is not null and a.ended_xid<>xid then a.ended_at
          when not (person->>'active')::boolean then receipt else null end,
        ended_xid=case when a.ended_at is not null and a.ended_xid<>xid then a.ended_xid
          when not (person->>'active')::boolean then xid else null end
      where a.joined_xid=xid or a.ended_xid=xid or
        (a.ended_at is null) is distinct from (person->>'active')::boolean;
    get diagnostics written_rows=row_count;
    changed:=changed or written_rows>0;
  end loop;
  select context into prior_context from app_public.group_cow_contexts where cow_id=c.id order by received_at desc,id desc limit 1;
  if prior_context is distinct from ctx then
    insert into app_public.group_cow_contexts(cow_id,received_at,source_xid,context) values(c.id,receipt,xid,ctx);
    changed:=true;
  end if;
  -- Restore explicit non-counting states when a source or its share disappears.
  with present as materialized (
    select n->>'member_user_id' as member_user_id,n->>'set_id' as set_id from jsonb_array_elements(graph) n
  ) select graph||coalesce(jsonb_agg(jsonb_build_object('member_user_id',x.member_user_id,'set_id',x.set_id,
      'input',x.input||jsonb_build_object('shared',false,'eligible',false,'context',ctx))),'[]'::jsonb) into graph
    from (select distinct on(member_user_id,set_id) * from app_public.group_cow_sources where cow_id=c.id
      order by member_user_id,set_id,received_at desc,id desc) x
    where not exists(select 1 from present n where n.member_user_id=x.member_user_id::text and n.set_id=x.set_id);
  for row in select value from jsonb_array_elements(graph) loop
    select * into old from app_public.group_cow_sources where cow_id=c.id and member_user_id=(row->>'member_user_id')::uuid
      and set_id=row->>'set_id' order by received_at desc,id desc limit 1;
    if not found or old.input is distinct from row->'input' then
      insert into app_public.group_cow_sources(cow_id,member_user_id,set_id,received_at,source_xid,input,input_key)
        values(c.id,(row->>'member_user_id')::uuid,row->>'set_id',receipt,xid,row->'input',
          encode(extensions.digest((row->'input')::text,'sha256'),'hex'));
      changed:=true;
    end if;
  end loop;
  if changed then
    update app_public.group_cows set generation=generation+1,
      available_at=case when receipt>=starts_at then least(available_at,receipt) else available_at end where id=c.id;
  end if;
end $$;

create function app_public.group_cow_pending_seal() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare code text; c app_public.group_cows;
begin
  perform app_public.group_cow_reject_agent();
  if new.id is distinct from (select max(id) from app_public.group_cow_pending where group_id=new.group_id and source_xid=new.source_xid) then return null; end if;
  begin
    -- Discover after acquiring the lock: a concurrent first definition may
    -- have been invisible when this source transaction queued its group.
    perform 1 from app_public.groups where id=new.group_id for key share;
    for c in select * from app_public.group_cows where group_id=new.group_id and finalized_at is null
      and (cancelled_at is null or definition_xid=new.source_xid) order by id loop
      if c.definition_xid=new.source_xid then
        begin
          perform app_public.group_cow_capture(c.id);
        exception when others then
          -- PostgreSQL row-error details can contain another member's private inputs.
          raise exception 'INTERNAL: CoW intake could not be validated' using errcode='P0001';
        end;
        if clock_timestamp()>=c.starts_at then
          raise exception 'VALIDATION: finish scheduling, editing or cancelling before the CoW starts' using errcode='P0001';
        end if;
      else
        begin
          perform app_public.group_cow_capture(c.id);
        exception when others then
          get stacked diagnostics code=returned_sqlstate;
          insert into app_public.group_cow_intake_failures(cow_id,group_id,source_xid,sqlstate) values(c.id,new.group_id,new.source_xid,code);
        end;
      end if;
    end loop;
  exception when others then
    if exists(select 1 from app_public.group_cows where group_id=new.group_id and definition_xid=new.source_xid) then raise; end if;
    get stacked diagnostics code=returned_sqlstate;
    insert into app_public.group_cow_intake_failures(group_id,source_xid,sqlstate) values(new.group_id,new.source_xid,code);
  end;
  delete from app_public.group_cow_pending where group_id=new.group_id and source_xid=new.source_xid;
  return null;
end $$;
create constraint trigger group_cow_pending_seal after insert on app_public.group_cow_pending
  deferrable initially deferred for each row execute function app_public.group_cow_pending_seal();

create function app_public.group_cow_mark(p_group uuid) returns void
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare xid bigint:=txid_current(); code text;
begin
  perform app_public.group_cow_reject_agent();
  begin
    -- Early SET CONSTRAINTS can already have sealed this transaction. A later
    -- relevant write invalidates that receipt even if its replacement fails.
    delete from app_public.group_cow_sources s using app_public.group_cows c
      where c.id=s.cow_id and c.group_id=p_group and s.source_xid=xid;
    delete from app_public.group_cow_contexts s using app_public.group_cows c
      where c.id=s.cow_id and c.group_id=p_group and s.source_xid=xid;
    insert into app_public.group_cow_pending(group_id,source_xid) values(p_group,xid);
  exception when others then
    if exists(select 1 from app_public.group_cows where definition_xid=xid) then raise; end if;
    get stacked diagnostics code=returned_sqlstate;
    insert into app_public.group_cow_intake_failures(group_id,source_xid,sqlstate) values(p_group,xid,code);
  end;
end $$;

create function app_public.group_cow_on_source() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare member uuid; members uuid[]; c record; current_row jsonb; previous_row jsonb;
begin
  perform app_public.group_cow_reject_agent();
  begin
  current_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op='UPDATE' then
    previous_row:=to_jsonb(old);
    -- Only scoring/eligibility dependencies matter; presentation/cursor writes
    -- do not produce a new submission or reset receipt priority.
    case tg_table_name
      when 'sessions' then
        if current_row->'started_at'=previous_row->'started_at' and current_row->'status'=previous_row->'status'
          and current_row->'completed_at'=previous_row->'completed_at' and current_row->'deleted_at'=previous_row->'deleted_at' then return null; end if;
      when 'session_exercises' then
        if current_row->'session_id'=previous_row->'session_id' and current_row->'exercise_definition_id'=previous_row->'exercise_definition_id'
          and current_row->'deleted_at'=previous_row->'deleted_at' then return null; end if;
      when 'exercise_sets' then
        if current_row-array['client_updated_at_ms','server_received_at','updated_at','created_at','order_index','planned_weight_value',
          'planned_reps_value','planned_set_type','planned_weight_unit','weight_unit']=previous_row-array['client_updated_at_ms',
          'server_received_at','updated_at','created_at','order_index','planned_weight_value','planned_reps_value','planned_set_type',
          'planned_weight_unit','weight_unit'] then return null; end if;
      when 'exercise_definitions' then
        if current_row->'load_input_mode'=previous_row->'load_input_mode' and current_row->'deleted_at'=previous_row->'deleted_at' then return null; end if;
      else
        if current_row-array['client_updated_at_ms','server_received_at','updated_at','created_at']=
          previous_row-array['client_updated_at_ms','server_received_at','updated_at','created_at'] then return null; end if;
    end case;
  end if;
  member:=coalesce(current_row->>'owner_user_id',current_row->>'member_user_id')::uuid;
  members:=array[member,coalesce(previous_row->>'owner_user_id',previous_row->>'member_user_id')::uuid];
  -- Do not join through a child parent here: Sync v2 defers its FKs and may
  -- deliver a child before the parent. Graph resolution belongs to the seal.
  for c in select m.group_id from app_public.group_memberships m where m.user_id=any(members)
    union select x.group_id from app_public.group_cow_admissions a join app_public.group_cows x on x.id=a.cow_id
      where a.member_user_id=any(members) order by group_id loop
    perform app_public.group_cow_mark(c.group_id);
  end loop;
  exception when others then
    if exists(select 1 from app_public.group_cows where definition_xid=txid_current()) then raise; end if;
    insert into app_public.group_cow_intake_failures(member_user_id,source_xid,sqlstate) values(member,txid_current(),sqlstate);
  end;
  return null;
end $$;

create function app_public.group_cow_on_group() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare g uuid; c record;
begin
  perform app_public.group_cow_reject_agent();
  begin
  if tg_table_name='group_cows' then
    g:=case when tg_op='DELETE' then old.group_id else new.group_id end;
    if tg_op='DELETE' then
      delete from app_public.group_cow_intake_failures where cow_id=old.id;
      return null;
    end if;
    if tg_op='UPDATE' and row(new.group_exercise_id,new.metrics,new.revision,new.cancelled_at) is not distinct from
      row(old.group_exercise_id,old.metrics,old.revision,old.cancelled_at) then return null; end if;
    if new.finalized_at is null then perform app_public.group_cow_mark(new.group_id); end if;
  else
    if tg_table_name='group_eval_rules_state' then
      if tg_op='UPDATE' and new.rules_version=old.rules_version then return null; end if;
      g:=null;
    elsif tg_table_name='groups' then
      if tg_op='UPDATE' and row(new.bodyweight_calculations_enabled,new.deleted_at) is not distinct from row(old.bodyweight_calculations_enabled,old.deleted_at) then return null; end if;
      g:=case when tg_op='DELETE' then old.id else new.id end;
    elsif tg_table_name='group_exercises' then
      if tg_op='UPDATE' and row(new.rules_revision,new.archived_at) is not distinct from row(old.rules_revision,old.archived_at) then return null; end if;
      g:=case when tg_op='DELETE' then old.group_id else new.group_id end;
    else
      if tg_op='UPDATE' and row(new.ended_at,new.joined_at) is not distinct from row(old.ended_at,old.joined_at) then return null; end if;
      g:=case when tg_op='DELETE' then old.group_id else new.group_id end;
    end if;
    if g is not null then
      perform app_public.group_cow_mark(g);
    else
      -- A global scorer change must also meet a concurrently created first CoW.
      for c in select id from app_public.groups where deleted_at is null order by id loop
        perform app_public.group_cow_mark(c.id);
      end loop;
    end if;
  end if;
  exception when others then
    if exists(select 1 from app_public.group_cows where definition_xid=txid_current()) then raise; end if;
    insert into app_public.group_cow_intake_failures(group_id,source_xid,sqlstate) values(g,txid_current(),sqlstate);
  end;
  return null;
end $$;

-- FK constraint events use RI_ names; these AFTER marks sort last, so the
-- final pending event follows every relevant dependency's queued FK check.
do $$
declare t text; f record;
begin
  foreach t in array array['sessions','session_exercises','exercise_sets','exercise_definitions','exercise_group_links','body_weight_measurements','group_session_shares'] loop
    execute format('create trigger zz_group_cow_intake after insert or update or delete on app_public.%I for each row execute function app_public.group_cow_on_source()',t);
  end loop;
  foreach t in array array['groups','group_exercises','group_memberships','group_eval_rules_state','group_cows'] loop
    execute format('create trigger zz_group_cow_intake after insert or update or delete on app_public.%I for each row execute function app_public.group_cow_on_group()',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname in ('group_cow_context','group_cow_source_snapshot','group_cow_capture',
      'group_cow_pending_seal','group_cow_mark','group_cow_on_source','group_cow_on_group') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
