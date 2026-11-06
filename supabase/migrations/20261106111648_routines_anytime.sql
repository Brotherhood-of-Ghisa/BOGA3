-- Reusable standalone intent and immutable per-use provenance. Protocol 6 is a
-- coordinated backend/app cutover; never apply to hosted before that release.
alter table app_public.session_plans add column is_routine boolean default false;
alter table app_public.session_plans add constraint session_plans_routine_standalone
  check (not coalesce(is_routine, false) or programme_id is null);

create table app_public.session_plan_uses (
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  session_plan_id text,
  slot_index integer,
  kind text,
  skipped_at bigint,
  deleted_at bigint,
  created_at bigint,
  updated_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  primary key (owner_user_id, id),
  constraint session_plan_uses_plan_fk foreign key (owner_user_id, session_plan_id)
    references app_public.session_plans(owner_user_id,id) on delete cascade deferrable initially deferred
);
create index session_plan_uses_owner_received_idx on app_public.session_plan_uses(owner_user_id,server_received_at);
create index session_plan_uses_session_plan_id_idx on app_public.session_plan_uses(session_plan_id);
create index session_plan_uses_deleted_at_idx on app_public.session_plan_uses(deleted_at);
create unique index session_plan_uses_owner_slot_unique
  on app_public.session_plan_uses(owner_user_id,session_plan_id,slot_index) where deleted_at is null;
create trigger session_plan_uses_touch_server_received_at before update on app_public.session_plan_uses
  for each row when (new is distinct from old) execute function app_public.touch_server_received_at();
create trigger session_plan_uses_owner_user_id_immutable before update on app_public.session_plan_uses
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.session_plan_uses enable row level security;
create policy session_plan_uses_owner_select on app_public.session_plan_uses
  for select to authenticated using (owner_user_id=auth.uid());
create policy session_plan_uses_owner_insert on app_public.session_plan_uses
  for insert to authenticated with check (owner_user_id=auth.uid());
create policy session_plan_uses_owner_update on app_public.session_plan_uses
  for update to authenticated using (owner_user_id=auth.uid()) with check (owner_user_id=auth.uid());
create policy session_plan_uses_owner_delete on app_public.session_plan_uses
  for delete to authenticated using (owner_user_id=auth.uid());
create policy session_plan_uses_direct_app_only on app_public.session_plan_uses
  as restrictive for all to authenticated
  using (((select auth.jwt())->>'client_id') is null)
  with check (((select auth.jwt())->>'client_id') is null);
grant select,insert,update,delete on app_public.session_plan_uses to authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array['sessions','session_exercises','exercise_sets'] loop
    execute format('alter table app_public.%I add column source_plan_use_id text',t);
    execute format('alter table app_public.%I add constraint %I foreign key (owner_user_id,source_plan_use_id)
      references app_public.session_plan_uses(owner_user_id,id) on delete set null (source_plan_use_id)
      deferrable initially deferred',t,t||'_source_plan_use_fk');
  end loop;
end $$;

drop index app_public.sessions_owner_source_plan_unique;
create unique index sessions_owner_source_plan_unique on app_public.sessions(owner_user_id,source_plan_id)
  where deleted_at is null and source_plan_id is not null and source_plan_use_id is null;
create unique index sessions_owner_source_use_unique on app_public.sessions(owner_user_id,source_plan_use_id)
  where deleted_at is null and source_plan_use_id is not null;
drop index app_public.session_exercises_owner_source_block_unique;
create unique index session_exercises_owner_source_block_unique
  on app_public.session_exercises(owner_user_id,source_plan_exercise_id)
  where deleted_at is null and source_plan_exercise_id is not null and source_plan_use_id is null;
create unique index session_exercises_owner_use_block_unique
  on app_public.session_exercises(owner_user_id,source_plan_use_id,source_plan_exercise_id)
  where deleted_at is null and source_plan_exercise_id is not null and source_plan_use_id is not null;
drop index app_public.exercise_sets_owner_source_set_unique;
create unique index exercise_sets_owner_source_set_unique on app_public.exercise_sets(owner_user_id,source_plan_set_id)
  where deleted_at is null and source_plan_set_id is not null and source_plan_use_id is null;
create unique index exercise_sets_owner_use_set_unique on app_public.exercise_sets(owner_user_id,source_plan_use_id,source_plan_set_id)
  where deleted_at is null and source_plan_set_id is not null and source_plan_use_id is not null;

-- A reusable snapshot cannot consume the ordinary block or freeze future intent.
do $migration$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('app_public.agent_block_is_immutable(uuid,text)'::regprocedure);
  revised:=replace(definition,
    'and sx.source_plan_exercise_id = spe.id',
    'and sx.source_plan_exercise_id = spe.id and sx.source_plan_use_id is null');
  if revised=definition then raise exception 'Routine agent immutability patch anchor missing'; end if;
  execute revised;
end $migration$;

create function app_public.enforce_plan_use_identity() returns trigger
language plpgsql set search_path=app_public,pg_temp as $$
begin
  if (new.session_plan_id,new.slot_index,new.kind,new.skipped_at,new.created_at)
    is distinct from (old.session_plan_id,old.slot_index,old.kind,old.skipped_at,old.created_at) then
    raise exception 'PROVENANCE_VIOLATION: Routine use identity is immutable' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger session_plan_uses_identity_immutable before update on app_public.session_plan_uses
  for each row execute function app_public.enforce_plan_use_identity();

-- Recheck affected workouts at commit, including parent-only changes; a
-- repaired loser clears all levels in the same atomic push.
create function app_public.enforce_plan_use_provenance() returns trigger
language plpgsql set search_path=app_public,pg_temp as $$
declare affected text[];
begin
  case tg_table_name
    when 'sessions' then affected:=array[new.id];
    when 'session_plan_uses' then
      select array_agg(id) into affected from app_public.sessions
        where owner_user_id=new.owner_user_id and source_plan_use_id=new.id;
    when 'session_exercises' then affected:=array[new.session_id];
    when 'exercise_sets' then
      select array[session_id] into affected from app_public.session_exercises
        where owner_user_id=new.owner_user_id and id=new.session_exercise_id;
    when 'session_plan_exercises' then
      select array_agg(session_id) into affected from app_public.session_exercises
        where owner_user_id=new.owner_user_id and source_plan_exercise_id=new.id;
  end case;
  if exists (
    select 1 from app_public.sessions s
    join app_public.session_plan_uses u on (u.owner_user_id,u.id)=(s.owner_user_id,s.source_plan_use_id)
    where s.owner_user_id=new.owner_user_id and s.id=any(affected) and s.deleted_at is null
      and (u.kind is distinct from 'workout' or u.session_plan_id is distinct from s.source_plan_id or u.deleted_at is not null)
  ) or exists (
    select 1 from app_public.session_exercises c
    join app_public.sessions s on (s.owner_user_id,s.id)=(c.owner_user_id,c.session_id)
    left join app_public.session_plan_uses u on (u.owner_user_id,u.id)=(s.owner_user_id,s.source_plan_use_id)
    left join app_public.session_plan_exercises b on (b.owner_user_id,b.id)=(c.owner_user_id,c.source_plan_exercise_id)
    where c.owner_user_id=new.owner_user_id and c.session_id=any(affected) and c.deleted_at is null and s.deleted_at is null
      and ((c.source_plan_use_id is not null and (c.source_plan_use_id is distinct from s.source_plan_use_id
        or b.session_plan_id is distinct from u.session_plan_id))
        or (u.id is not null and b.session_plan_id=u.session_plan_id and c.source_plan_use_id is null))
  ) or exists (
    select 1 from app_public.exercise_sets e
    join app_public.session_exercises c on (c.owner_user_id,c.id)=(e.owner_user_id,e.session_exercise_id)
    where e.owner_user_id=new.owner_user_id and c.session_id=any(affected) and e.deleted_at is null and c.deleted_at is null
      and ((e.source_plan_use_id is not null and e.source_plan_set_id is null)
        or (e.source_plan_set_id is not null and e.source_plan_use_id is distinct from c.source_plan_use_id))
  ) then
    raise exception 'PROVENANCE_VIOLATION: Routine use does not match its performed graph' using errcode='P0001';
  end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['session_plan_uses','sessions','session_exercises','exercise_sets'] loop
    execute format('create constraint trigger %I after insert or update on app_public.%I
      deferrable initially deferred for each row execute function app_public.enforce_plan_use_provenance()',t||'_use_provenance',t);
  end loop;
end $$;
create constraint trigger session_plan_exercises_use_provenance after update on app_public.session_plan_exercises
  deferrable initially deferred for each row when (old.session_plan_id is distinct from new.session_plan_id)
  execute function app_public.enforce_plan_use_provenance();

create or replace function app_public.require_sync_protocol()
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if headers->>'x-boga-sync-protocol' is distinct from '6' then
    raise exception 'UPDATE_REQUIRED: sync protocol 6 is required' using errcode='P0001';
  end if;
end $$;

-- Guarded in-place patches retain the existing sync/merge and auth boundaries.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$gym_id, source_plan_id, status$anchor$, $replacement$gym_id, source_plan_id, source_plan_use_id, status$replacement$),
    ($anchor$        _fields ->> 'source_plan_id',$anchor$, $replacement$        _fields ->> 'source_plan_id',
        _fields ->> 'source_plan_use_id',$replacement$),
    ($anchor$source_plan_id       = excluded.source_plan_id,$anchor$, $replacement$source_plan_id       = excluded.source_plan_id,
            source_plan_use_id   = case when _fields ? 'source_plan_use_id' then excluded.source_plan_use_id else app_public.sessions.source_plan_use_id end,$replacement$),
    ($anchor$exercise_definition_id, source_plan_exercise_id, order_index$anchor$, $replacement$exercise_definition_id, source_plan_exercise_id, source_plan_use_id, order_index$replacement$),
    ($anchor$        _fields ->> 'source_plan_exercise_id',$anchor$, $replacement$        _fields ->> 'source_plan_exercise_id',
        _fields ->> 'source_plan_use_id',$replacement$),
    ($anchor$source_plan_exercise_id = excluded.source_plan_exercise_id,$anchor$, $replacement$source_plan_exercise_id = excluded.source_plan_exercise_id,
            source_plan_use_id = case when _fields ? 'source_plan_use_id' then excluded.source_plan_use_id else app_public.session_exercises.source_plan_use_id end,$replacement$),
    ($anchor$session_exercise_id,source_plan_set_id,order_index$anchor$, $replacement$session_exercise_id,source_plan_set_id,source_plan_use_id,order_index$replacement$),
    ($anchor$_fields->>'source_plan_set_id',(_fields->>'order_index')$anchor$, $replacement$_fields->>'source_plan_set_id',_fields->>'source_plan_use_id',(_fields->>'order_index')$replacement$),
    ($anchor$source_plan_set_id=excluded.source_plan_set_id,order_index$anchor$, $replacement$source_plan_set_id=excluded.source_plan_set_id,source_plan_use_id=case when _fields ? 'source_plan_use_id' then excluded.source_plan_use_id else app_public.exercise_sets.source_plan_use_id end,order_index$replacement$),
    ($anchor$title, scheduled_for, provenance, last_modified_by,$anchor$, $replacement$title, scheduled_for, is_routine, provenance, last_modified_by,$replacement$),
    ($anchor$        (_fields ->> 'scheduled_for')::bigint,$anchor$, $replacement$        (_fields ->> 'scheduled_for')::bigint,
        coalesce((_fields ->> 'is_routine')::boolean,false),$replacement$),
    ($anchor$scheduled_for         = excluded.scheduled_for,$anchor$, $replacement$scheduled_for         = excluded.scheduled_for,
            is_routine            = case when _fields ? 'is_routine' then excluded.is_routine else app_public.session_plans.is_routine end,$replacement$),
    ($anchor$         or sqlerrm like '%owner_source_plan_unique%' then$anchor$, $replacement$         or sqlerrm like '%owner_source_plan_unique%'
         or sqlerrm like '%owner_slot_unique%'
         or sqlerrm like '%owner_source_use_unique%'
         or sqlerrm like '%owner_use_block_unique%'
         or sqlerrm like '%owner_use_set_unique%' then$replacement$),
    ($anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$, $replacement$    elsif _type = 'session_plan_uses' then
      insert into app_public.session_plan_uses (
        owner_user_id,id,session_plan_id,slot_index,kind,skipped_at,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'session_plan_id',(_fields->>'slot_index')::integer,
        _fields->>'kind',(_fields->>'skipped_at')::bigint,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        session_plan_id=excluded.session_plan_id,slot_index=excluded.slot_index,kind=excluded.kind,
        skipped_at=excluded.skipped_at,created_at=excluded.created_at,updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at,client_updated_at_ms=excluded.client_updated_at_ms,
        server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms > app_public.session_plan_uses.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Routine RPC patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

-- Guarded in-place patches retain the existing sync/merge and auth boundaries.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$v_layer > 4$anchor$, $replacement$v_layer > 5$replacement$),
    ($anchor$'session_plan_exercises', 'session_plan_sets'
    ) then$anchor$, $replacement$'session_plan_exercises', 'session_plan_sets', 'session_plan_uses'
    ) then$replacement$),
    ($anchor$    when 2 then v_types := array['sessions', 'session_plan_exercises'];
    when 3 then v_types := array['session_exercises', 'session_plan_sets'];
    when 4 then v_types := array['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'];$anchor$, $replacement$    when 2 then v_types := array['session_plan_exercises', 'session_plan_uses'];
    when 3 then v_types := array['sessions', 'session_plan_sets'];
    when 4 then v_types := array['session_exercises'];
    when 5 then v_types := array['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'];$replacement$),
    ($anchor$'source_plan_id', s.source_plan_id,$anchor$, $replacement$'source_plan_id', s.source_plan_id, 'source_plan_use_id', s.source_plan_use_id,$replacement$),
    ($anchor$'source_plan_exercise_id', sx.source_plan_exercise_id,$anchor$, $replacement$'source_plan_exercise_id', sx.source_plan_exercise_id, 'source_plan_use_id', sx.source_plan_use_id,$replacement$),
    ($anchor$'source_plan_set_id', es.source_plan_set_id,$anchor$, $replacement$'source_plan_set_id', es.source_plan_set_id, 'source_plan_use_id', es.source_plan_use_id,$replacement$),
    ($anchor$'scheduled_for', sp.scheduled_for,$anchor$, $replacement$'scheduled_for', sp.scheduled_for, 'is_routine', sp.is_routine,$replacement$),
    ($anchor$    union all
    select 'session_plans'::text$anchor$, $replacement$    union all
    select 'session_plan_uses'::text, u.id, u.client_updated_at_ms,
           u.server_received_at, u.owner_user_id,
           jsonb_build_object(
             'session_plan_id',u.session_plan_id,'slot_index',u.slot_index,'kind',u.kind,
             'skipped_at',u.skipped_at,'created_at',u.created_at,'updated_at',u.updated_at,'deleted_at',u.deleted_at)
      from app_public.session_plan_uses u
      where u.owner_user_id=auth.uid() and 'session_plan_uses'=any(v_types)
    union all
    select 'session_plans'::text$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Routine RPC patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

-- Guarded in-place patches retain the existing sync/merge and auth boundaries.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$  delete from app_public.sessions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

$anchor$, $replacement$$replacement$),
    ($anchor$  delete from app_public.session_plan_sets where owner_user_id = _uid;$anchor$, $replacement$  delete from app_public.sessions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_plan_uses where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_plan_sets where owner_user_id = _uid;$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Routine RPC patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

-- Recovery snapshots must restore use ancestors before the performed graph.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.exercise_merge_snapshot(bigint,integer,text)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$  ), plan_block_ids as ($anchor$, $replacement$  ), uses as (
    select * from app_public.session_plan_uses where owner_user_id=u and id in (
      select source_plan_use_id from app_public.sessions where owner_user_id=u and id in(select id from session_ids)
      union select source_plan_use_id from blocks union select source_plan_use_id from sets)
  ), plan_block_ids as ($replacement$),
    ($anchor$    select session_plan_id id from plan_blocks union$anchor$, $replacement$    select session_plan_id id from uses union
    select session_plan_id id from plan_blocks union$replacement$),
    ($anchor$    union all select 2,'sessions'$anchor$, $replacement$    union all select 2,'session_plan_uses',to_jsonb(x) from uses x
    union all select 3,'sessions'$replacement$),
    ($anchor$    union all select 3,'session_exercises'$anchor$, $replacement$    union all select 4,'session_exercises'$replacement$),
    ($anchor$    union all select 4,'exercise_sets'$anchor$, $replacement$    union all select 5,'exercise_sets'$replacement$),
    ($anchor$    union all select 4,'session_exercise_tags'$anchor$, $replacement$    union all select 5,'session_exercise_tags'$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Routine recovery patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;
