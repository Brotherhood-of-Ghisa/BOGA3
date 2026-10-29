-- Server-only CoW definitions and lifecycle; product rules: docs/product/groups.md.
alter table app_public.groups add column cow_time_zone text,
  add column cow_calendar_revision bigint not null default 1;

create table app_public.group_cows (
  id uuid primary key,
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null,
  week_start date not null,
  time_zone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  metrics text[] not null,
  revision bigint not null default 1 check(revision>0),
  create_key text not null,
  last_write_key text,
  definition_xid bigint not null default txid_current(),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  start_context jsonb,
  start_high_water bigint,
  end_high_water bigint,
  context_changed_at timestamptz,
  finalized_at timestamptz,
  final_outcome text check(final_outcome in ('ready','unavailable')),
  final_rankings jsonb,
  generation bigint not null default 1,
  available_at timestamptz not null,
  claim_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  check(ends_at>starts_at),
  check(cardinality(metrics) between 1 and 3 and metrics<@array['e1rm','volume','improvement']::text[]),
  check((finalized_at is null)=(final_outcome is null)),
  check((finalized_at is null)=(final_rankings is null))
);
create unique index group_cows_week on app_public.group_cows(group_id,week_start) where cancelled_at is null;
create index group_cows_work on app_public.group_cows(available_at,id) where cancelled_at is null and finalized_at is null;
create index group_cows_history on app_public.group_cows(group_id,starts_at desc,id desc) where cancelled_at is null;

-- All candidate membership periods are admitted on server receipts; the worker
-- selects and freezes the start roster into group_cow_participants.
create table app_public.group_cow_admissions (
  cow_id uuid not null references app_public.group_cows(id) on delete cascade,
  membership_id uuid not null,
  member_user_id uuid not null,
  joined_at timestamptz not null,
  ended_at timestamptz,
  joined_xid bigint not null,
  ended_xid bigint,
  primary key(cow_id,membership_id)
);
create table app_public.group_cow_participants (
  cow_id uuid not null references app_public.group_cows(id) on delete cascade,
  member_user_id uuid not null,
  membership_id uuid not null,
  ended_at timestamptz,
  primary key(cow_id,member_user_id)
);
create table app_public.group_cow_contexts (
  id bigint generated always as identity primary key,
  cow_id uuid not null references app_public.group_cows(id) on delete cascade,
  received_at timestamptz not null,
  source_xid bigint not null,
  context jsonb not null
);
create index group_cow_contexts_boundary on app_public.group_cow_contexts(cow_id,received_at,id);
create index group_cow_contexts_transaction on app_public.group_cow_contexts(cow_id,source_xid);
create table app_public.group_cow_sources (
  id bigint generated always as identity primary key,
  cow_id uuid not null references app_public.group_cows(id) on delete cascade,
  member_user_id uuid not null,
  set_id text not null,
  received_at timestamptz not null,
  source_xid bigint not null,
  input jsonb not null,
  input_key text not null
);
create index group_cow_sources_boundary on app_public.group_cow_sources(cow_id,member_user_id,set_id,received_at desc,id desc);
create index group_cow_sources_transaction on app_public.group_cow_sources(cow_id,source_xid);
-- No FK: failure recording must never wait on the group lock it failed to get.
create table app_public.group_cow_intake_failures (
  id bigint generated always as identity primary key,
  cow_id uuid,
  group_id uuid,
  member_user_id uuid,
  source_xid bigint not null,
  failed_at timestamptz not null default clock_timestamp(),
  sqlstate text not null
);
create index group_cow_intake_failures_cow on app_public.group_cow_intake_failures(cow_id,failed_at);

create function app_public.group_cow_reject_agent() returns void
language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if auth.jwt()->>'client_id' is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot access groups' using errcode='P0001';
  end if;
end $$;

create function app_public.group_cow_zone(p_zone text) returns text
language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if p_zone is null or p_zone<>btrim(p_zone) or
    (p_zone<>'UTC' and p_zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$') or
    not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone and name !~ '^(posix|right)/') then
    raise exception 'VALIDATION: choose a valid IANA time zone' using errcode='P0001';
  end if;
  return p_zone;
end $$;

create function app_public.group_cow_week(p_zone text,p_now timestamptz) returns date
language sql stable set search_path=app_public,pg_temp as $$
  select date_trunc('week',p_now at time zone app_public.group_cow_zone(p_zone))::date;
$$;
create function app_public.group_cow_us(p_time timestamptz) returns bigint
language sql immutable set search_path=app_public,pg_temp as $$ select (extract(epoch from p_time)*1000000)::bigint; $$;
create function app_public.group_cow_bounds(p_zone text,p_week date) returns tstzrange
language sql stable set search_path=app_public,pg_temp as $$
  select tstzrange(p_week::timestamp at time zone app_public.group_cow_zone(p_zone),
    (p_week+7)::timestamp at time zone p_zone,'[)');
$$;

create function app_public.group_cow_calendar_json(p_group uuid) returns jsonb
language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('time_zone',g.cow_time_zone,'revision',g.cow_calendar_revision,
    'next_week_start',case when g.cow_time_zone is not null
      then (app_public.group_cow_week(g.cow_time_zone,clock_timestamp())+7)::text end)
    from app_public.groups g where g.id=p_group;
$$;
create function app_public.group_cow_json(p_cow app_public.group_cows) returns jsonb
language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('cow_id',p_cow.id,'group_id',p_cow.group_id,'group_exercise_id',p_cow.group_exercise_id,
    'week_start',p_cow.week_start::text,'time_zone',p_cow.time_zone,
    'starts_at_us',app_public.group_cow_us(p_cow.starts_at),'ends_at_us',app_public.group_cow_us(p_cow.ends_at),
    'metrics',to_jsonb(p_cow.metrics),'revision',p_cow.revision,
    'state',case when p_cow.cancelled_at is not null then 'cancelled'
      when p_cow.finalized_at is not null then case when p_cow.final_outcome='unavailable' then 'unavailable' else 'final' end
      when clock_timestamp()<p_cow.starts_at then 'scheduled'
      when clock_timestamp()<p_cow.ends_at then 'active' else 'finalizing' end);
$$;

create function app_public.group_cow_calendar_get(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user();
begin
  perform app_public.group_competition_require_capability();
  perform app_public.group_require_member(p_group_id,u,false);
  return app_public.group_cow_calendar_json(p_group_id);
end $$;
create function app_public.group_cow_calendar_set(p_group_id uuid,p_expected_revision bigint,p_time_zone text) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); r text; g app_public.groups;
begin
  perform app_public.group_competition_require_capability();
  r:=app_public.group_require_member(p_group_id,u,true);
  if r not in ('owner','admin') then raise exception 'FORBIDDEN: only managers can set the group calendar' using errcode='P0001'; end if;
  perform app_public.group_cow_zone(p_time_zone);
  select * into strict g from app_public.groups where id=p_group_id;
  if g.cow_time_zone is not distinct from p_time_zone then return app_public.group_cow_calendar_json(p_group_id); end if;
  if p_expected_revision is distinct from g.cow_calendar_revision then
    raise exception 'CONFLICT: group calendar changed; refresh before saving' using errcode='P0001';
  end if;
  update app_public.groups set cow_time_zone=p_time_zone,cow_calendar_revision=cow_calendar_revision+1 where id=p_group_id;
  return app_public.group_cow_calendar_json(p_group_id);
end $$;

-- One defaulted signature preserves old two-argument clients without ambiguous overloads.
drop function app_public.group_create(text,text);
create function app_public.group_create(p_name text,p_description text,p_time_zone text default null) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); g uuid; n text; d text;
begin
  perform app_public.group_competition_require_capability();
  perform app_public.group_require_username(u);
  n:=app_public.group_validate_name(p_name); d:=app_public.group_validate_description(p_description);
  if p_time_zone is not null then perform app_public.group_cow_zone(p_time_zone); end if;
  insert into app_public.groups(name,description,created_by,cow_time_zone) values(n,d,u,p_time_zone) returning id into g;
  insert into app_public.group_memberships(group_id,user_id,role) values(g,u,'owner');
  perform app_public.group_write_invite_code(g,u,false);
  return jsonb_build_object('group_id',g);
end $$;

create function app_public.group_cow_validate(p_group uuid,p_exercise uuid,p_metrics text[]) returns text[]
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare result text[];
begin
  perform app_public.group_cow_reject_agent();
  if p_metrics is null or cardinality(p_metrics) not between 1 and 3 or
    array_position(p_metrics,null) is not null or not p_metrics<@array['e1rm','volume','improvement']::text[] then
    raise exception 'VALIDATION: choose one or more CoW metrics' using errcode='P0001';
  end if;
  select array_agg(m order by case m when 'e1rm' then 1 when 'improvement' then 2 else 3 end) into result
    from (select distinct unnest(p_metrics) as m) x;
  if cardinality(result)<>cardinality(p_metrics) then raise exception 'VALIDATION: repeated CoW metric' using errcode='P0001'; end if;
  if not exists(select 1 from app_public.group_exercises where id=p_exercise and group_id=p_group and archived_at is null) then
    raise exception 'VALIDATION: choose a live group exercise' using errcode='P0001';
  end if;
  return result;
end $$;

create function app_public.group_cow_create(p_group_id uuid,p_cow_id uuid,p_group_exercise_id uuid,
  p_metrics text[],p_calendar_revision bigint,p_week_start date) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); role text; g app_public.groups; c app_public.group_cows;
  key text; chosen text[]; expected date; begin_at timestamptz; end_at timestamptz;
begin
  perform app_public.group_competition_require_capability();
  role:=app_public.group_require_member(p_group_id,u,true);
  if role not in ('owner','admin') then raise exception 'FORBIDDEN: only managers can schedule CoWs' using errcode='P0001'; end if;
  key:=jsonb_build_array(p_group_exercise_id,p_metrics,p_calendar_revision,p_week_start)::text;
  select * into c from app_public.group_cows where id=p_cow_id;
  if found then
    if c.group_id=p_group_id and c.create_key=key then return jsonb_build_object('cow',app_public.group_cow_json(c)); end if;
    raise exception 'CONFLICT: this CoW request already exists' using errcode='P0001';
  end if;
  if p_cow_id is null then raise exception 'VALIDATION: CoW identity is required' using errcode='P0001'; end if;
  chosen:=app_public.group_cow_validate(p_group_id,p_group_exercise_id,p_metrics);
  select * into strict g from app_public.groups where id=p_group_id;
  if g.cow_time_zone is null then raise exception 'VALIDATION: set the group time zone before scheduling' using errcode='P0001'; end if;
  if p_calendar_revision is distinct from g.cow_calendar_revision then raise exception 'CONFLICT: group calendar changed' using errcode='P0001'; end if;
  expected:=app_public.group_cow_week(g.cow_time_zone,clock_timestamp())+7;
  if p_week_start is distinct from expected then raise exception 'VALIDATION: schedule next week only' using errcode='P0001'; end if;
  begin_at:=lower(app_public.group_cow_bounds(g.cow_time_zone,expected));
  end_at:=upper(app_public.group_cow_bounds(g.cow_time_zone,expected));
  if begin_at<=clock_timestamp() then raise exception 'VALIDATION: this CoW has already started' using errcode='P0001'; end if;
  if exists(select 1 from app_public.group_cows x where x.group_id=p_group_id and x.cancelled_at is null
      and (x.week_start=expected or tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(begin_at,end_at,'[)'))) then
    raise exception 'CONFLICT: this group already has a CoW in that week' using errcode='P0001';
  end if;
  insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at)
    values(p_cow_id,p_group_id,p_group_exercise_id,expected,g.cow_time_zone,begin_at,end_at,chosen,key,u,begin_at)
    on conflict(id) do nothing returning * into c;
  if not found then raise exception 'CONFLICT: this CoW request already exists' using errcode='P0001'; end if;
  return jsonb_build_object('cow',app_public.group_cow_json(c));
end $$;

create function app_public.group_cow_update(p_group_id uuid,p_cow_id uuid,p_expected_revision bigint,
  p_group_exercise_id uuid,p_metrics text[]) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); role text; c app_public.group_cows; chosen text[]; key text;
begin
  perform app_public.group_competition_require_capability();
  role:=app_public.group_require_member(p_group_id,u,true);
  if role not in ('owner','admin') then raise exception 'FORBIDDEN: only managers can edit CoWs' using errcode='P0001'; end if;
  select * into c from app_public.group_cows where id=p_cow_id and group_id=p_group_id for update;
  if not found then raise exception 'NOT_FOUND: CoW not found' using errcode='P0001'; end if;
  key:=jsonb_build_array('edit',p_expected_revision,p_group_exercise_id,p_metrics)::text;
  if c.last_write_key=key then return jsonb_build_object('cow',app_public.group_cow_json(c)); end if;
  if c.revision is distinct from p_expected_revision then raise exception 'CONFLICT: CoW changed; refresh before saving' using errcode='P0001'; end if;
  if c.cancelled_at is not null or c.finalized_at is not null or c.starts_at<=clock_timestamp() then raise exception 'VALIDATION: only a scheduled CoW can be edited' using errcode='P0001'; end if;
  chosen:=app_public.group_cow_validate(p_group_id,p_group_exercise_id,p_metrics);
  update app_public.group_cows set group_exercise_id=p_group_exercise_id,metrics=chosen,revision=revision+1,
    last_write_key=key,definition_xid=txid_current(),generation=generation+1 where id=c.id returning * into c;
  return jsonb_build_object('cow',app_public.group_cow_json(c));
end $$;
create function app_public.group_cow_cancel(p_group_id uuid,p_cow_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); role text; c app_public.group_cows; key text;
begin
  perform app_public.group_competition_require_capability();
  role:=app_public.group_require_member(p_group_id,u,true);
  if role not in ('owner','admin') then raise exception 'FORBIDDEN: only managers can cancel CoWs' using errcode='P0001'; end if;
  select * into c from app_public.group_cows where id=p_cow_id and group_id=p_group_id for update;
  if not found then raise exception 'NOT_FOUND: CoW not found' using errcode='P0001'; end if;
  key:=jsonb_build_array('cancel',p_expected_revision)::text;
  if c.last_write_key=key then return jsonb_build_object('cow',app_public.group_cow_json(c)); end if;
  if c.revision is distinct from p_expected_revision then raise exception 'CONFLICT: CoW changed; refresh before cancelling' using errcode='P0001'; end if;
  if c.cancelled_at is not null or c.finalized_at is not null or c.starts_at<=clock_timestamp() then raise exception 'VALIDATION: only a scheduled CoW can be cancelled' using errcode='P0001'; end if;
  update app_public.group_cows set cancelled_at=clock_timestamp(),revision=revision+1,last_write_key=key,
    definition_xid=txid_current(),generation=generation+1,claim_id=null,lease_until=null where id=c.id returning * into c;
  return jsonb_build_object('cow',app_public.group_cow_json(c));
end $$;
create function app_public.group_cow_get(p_group_id uuid,p_cow_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); c app_public.group_cows;
begin
  perform app_public.group_competition_require_capability();
  perform app_public.group_require_member(p_group_id,u,false);
  select * into c from app_public.group_cows where id=p_cow_id and group_id=p_group_id;
  if not found then raise exception 'NOT_FOUND: CoW not found' using errcode='P0001'; end if;
  return jsonb_build_object('cow',app_public.group_cow_json(c));
end $$;
create function app_public.group_cow_list(p_group_id uuid,p_before text default null,p_limit integer default 20) returns jsonb
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); cursor jsonb; edge timestamptz; edge_id uuid; rows jsonb; more boolean; last_row jsonb;
begin
  perform app_public.group_competition_require_capability();
  perform app_public.group_require_member(p_group_id,u,false);
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'VALIDATION: invalid CoW page size' using errcode='P0001'; end if;
  if p_before is not null then
    begin
      cursor:=p_before::jsonb; edge:=to_timestamp((cursor->>'starts_at_us')::numeric/1000000);
      edge_id:=(cursor->>'cow_id')::uuid;
      if edge is null or edge_id is null or cursor->>'group_id' is distinct from p_group_id::text then raise exception 'bad cursor'; end if;
    exception when others then raise exception 'VALIDATION: invalid CoW cursor' using errcode='P0001'; end;
  end if;
  select coalesce(jsonb_agg(app_public.group_cow_json(c) order by c.starts_at desc,c.id desc),'[]'::jsonb),count(*)>p_limit
    into rows,more from (select * from app_public.group_cows x where x.group_id=p_group_id and x.cancelled_at is null
      and (edge is null or (x.starts_at,x.id)<(edge,edge_id)) order by x.starts_at desc,x.id desc limit p_limit+1) c;
  if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
  last_row:=rows->(jsonb_array_length(rows)-1);
  return jsonb_build_object('cows',rows,'next_cursor',case when more then
    jsonb_build_object('group_id',p_group_id,'starts_at_us',last_row->'starts_at_us','cow_id',last_row->'cow_id')::text end);
end $$;

-- New tables stay outside Sync v2 and direct client access. Helpers deny OAuth
-- independently and have no client execute privilege.
do $$
declare t text; f record;
begin
  foreach t in array array['group_cows','group_cow_admissions','group_cow_participants','group_cow_contexts','group_cow_sources','group_cow_intake_failures'] loop
    execute format('alter table app_public.%I enable row level security',t);
    execute format('revoke all on app_public.%I from public,anon,authenticated,service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and (p.proname like 'group_cow_%' or p.proname='group_create') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('group_create','group_cow_calendar_get','group_cow_calendar_set','group_cow_create',
      'group_cow_update','group_cow_cancel','group_cow_get','group_cow_list') then
      execute format('grant execute on function %s to anon,authenticated',f.signature);
    end if;
  end loop;
end $$;
