-- Imported health activities (Apple Health workouts today; any source later).
--
-- The phone is the bridge: it reads its health store and writes summaries here
-- through app_public.health_activities_apply. The coach reads them only
-- through the agent API (service role, owner-filtered). Rows are owner-private,
-- never synced to devices, never shared with groups, and feed no set, volume,
-- record or competition figure. Contract: docs/specs/tech/health-activities-contract.md.

-- The owner column is `user_id`, not `owner_user_id`: every app_public table
-- with `owner_user_id` is a Sync v2 entity to the drift checker, and this is not one.
create table app_public.health_activities (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('apple_health')),
  external_id text not null check (length(external_id) between 1 and 200),
  activity_type text not null check (activity_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_sec integer not null check (duration_sec between 0 and 2592000),
  distance_m double precision check (distance_m between 0 and 10000000),
  active_energy_kcal double precision check (active_energy_kcal between 0 and 100000),
  avg_heart_rate_bpm double precision check (avg_heart_rate_bpm > 0 and avg_heart_rate_bpm <= 300),
  max_heart_rate_bpm double precision check (max_heart_rate_bpm > 0 and max_heart_rate_bpm <= 300),
  elevation_gain_m double precision check (elevation_gain_m between 0 and 100000),
  source_name text check (length(source_name) between 1 and 200),
  device_name text check (length(device_name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source, external_id),
  constraint health_activities_time_order check (
    ended_at >= started_at and ended_at - started_at <= interval '30 days'
  )
);

comment on table app_public.health_activities is
  'Owner-private imported workout summaries (no routes, no samples). Written only by health_activities_apply; read by the owner app and the agent API. Not a Sync v2 entity.';

create index health_activities_owner_started
  on app_public.health_activities (user_id, started_at desc);

alter table app_public.health_activities enable row level security;
revoke all on app_public.health_activities from public, anon, authenticated;
grant select on app_public.health_activities to authenticated;
grant all on app_public.health_activities to service_role;

-- Owner app sessions may read their own rows; OAuth (agent) tokens may not.
create policy health_activities_owner_select
on app_public.health_activities
for select
to authenticated
using (
  user_id = (select auth.uid())
  and ((select auth.jwt()) ->> 'client_id') is null
);

-- The agent boundary's restrictive companion: no future permissive policy can
-- open the table to an OAuth token.
create policy health_activities_direct_app_only
on app_public.health_activities
as restrictive
for all
to authenticated
using (((select auth.jwt()) ->> 'client_id') is null)
with check (((select auth.jwt()) ->> 'client_id') is null);

-- One validated row from an upload element. Unknown keys, wrong types, bad
-- timestamps and out-of-range figures fail loud: the app must fix its mapping,
-- never have a summary silently dropped or clamped.
create function app_public.health_activity_row(p_owner uuid, p_source text, p_item jsonb)
returns app_public.health_activities
language plpgsql
stable
set search_path = ''
as $$
declare
  r app_public.health_activities;
  allowed constant text[] := array[
    'external_id', 'activity_type', 'started_at', 'ended_at', 'duration_sec', 'distance_m',
    'active_energy_kcal', 'avg_heart_rate_bpm', 'max_heart_rate_bpm', 'elevation_gain_m',
    'source_name', 'device_name'
  ];
  iso constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$';
  key text;
  field text;
begin
  if jsonb_typeof(p_item) is distinct from 'object' then
    raise exception 'INVALID_ARGUMENT: each upsert must be an object' using errcode = 'P0001';
  end if;
  for key in select jsonb_object_keys(p_item) loop
    if not key = any(allowed) then
      raise exception 'INVALID_ARGUMENT: unknown activity field %', key using errcode = 'P0001';
    end if;
  end loop;
  foreach field in array array['external_id', 'activity_type', 'started_at', 'ended_at'] loop
    if jsonb_typeof(p_item -> field) is distinct from 'string' then
      raise exception 'INVALID_ARGUMENT: % must be a string', field using errcode = 'P0001';
    end if;
  end loop;
  foreach field in array array['started_at', 'ended_at'] loop
    if (p_item ->> field) !~ iso then
      raise exception 'INVALID_ARGUMENT: % must be an ISO 8601 instant', field using errcode = 'P0001';
    end if;
  end loop;
  if jsonb_typeof(p_item -> 'duration_sec') is distinct from 'number'
     or (p_item ->> 'duration_sec')::numeric <> trunc((p_item ->> 'duration_sec')::numeric) then
    raise exception 'INVALID_ARGUMENT: duration_sec must be a whole number' using errcode = 'P0001';
  end if;
  foreach field in array array['distance_m', 'active_energy_kcal', 'avg_heart_rate_bpm', 'max_heart_rate_bpm', 'elevation_gain_m'] loop
    if p_item ? field and jsonb_typeof(p_item -> field) not in ('number', 'null') then
      raise exception 'INVALID_ARGUMENT: % must be a number or null', field using errcode = 'P0001';
    end if;
  end loop;
  foreach field in array array['source_name', 'device_name'] loop
    if p_item ? field and jsonb_typeof(p_item -> field) not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT: % must be a string or null', field using errcode = 'P0001';
    end if;
  end loop;

  begin
    r.user_id := p_owner;
    r.source := p_source;
    r.external_id := p_item ->> 'external_id';
    r.activity_type := p_item ->> 'activity_type';
    r.started_at := (p_item ->> 'started_at')::timestamptz;
    r.ended_at := (p_item ->> 'ended_at')::timestamptz;
    r.duration_sec := (p_item ->> 'duration_sec')::integer;
    r.distance_m := (p_item ->> 'distance_m')::double precision;
    r.active_energy_kcal := (p_item ->> 'active_energy_kcal')::double precision;
    r.avg_heart_rate_bpm := (p_item ->> 'avg_heart_rate_bpm')::double precision;
    r.max_heart_rate_bpm := (p_item ->> 'max_heart_rate_bpm')::double precision;
    r.elevation_gain_m := (p_item ->> 'elevation_gain_m')::double precision;
    r.source_name := p_item ->> 'source_name';
    r.device_name := p_item ->> 'device_name';
  exception when others then
    raise exception 'INVALID_ARGUMENT: activity % is malformed', coalesce(p_item ->> 'external_id', '?')
      using errcode = 'P0001';
  end;
  return r;
end $$;

revoke all on function app_public.health_activity_row(uuid, text, jsonb) from public, anon, authenticated;

-- The app's only write path. One call applies a batch from the health store's
-- change feed: deletes, then upserts keyed by (owner, source, external_id), so
-- a re-import is idempotent. A fresh backfill may span several batches; its
-- last call passes p_complete_since with p_complete_ids, every external id the
-- store still has from that instant on, and rows in that window outside the
-- list are pruned. The prune never relies on one batch's upserts being whole.
create function app_public.health_activities_apply(
  p_source text,
  p_upserts jsonb default '[]'::jsonb,
  p_deletes jsonb default '[]'::jsonb,
  p_complete_since timestamptz default null,
  p_complete_ids jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _rows app_public.health_activities[];
  _ids text[];
  _delete_ids text[];
  _keep_ids text[];
  _deleted integer := 0;
  _pruned integer := 0;
  _upserted integer := 0;
begin
  if _uid is null then
    raise exception 'AUTH_REQUIRED: sign in to import activities' using errcode = 'P0001';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot import activities' using errcode = 'P0001';
  end if;
  if p_source is null or p_source not in ('apple_health') then
    raise exception 'INVALID_ARGUMENT: unknown source' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_upserts) is distinct from 'array' or jsonb_array_length(p_upserts) > 1000 then
    raise exception 'INVALID_ARGUMENT: upserts must be an array of at most 1000' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_deletes) is distinct from 'array' or jsonb_array_length(p_deletes) > 1000 then
    raise exception 'INVALID_ARGUMENT: deletes must be an array of at most 1000' using errcode = 'P0001';
  end if;
  if (p_complete_since is null) <> (p_complete_ids is null) then
    raise exception 'INVALID_ARGUMENT: complete_since and complete_ids go together' using errcode = 'P0001';
  end if;
  if p_complete_ids is not null and (
    jsonb_typeof(p_complete_ids) <> 'array' or jsonb_array_length(p_complete_ids) > 20000
    or exists (select 1 from jsonb_array_elements(p_complete_ids) k
      where jsonb_typeof(k) <> 'string' or length(k #>> '{}') not between 1 and 200)
  ) then
    raise exception 'INVALID_ARGUMENT: complete_ids must be at most 20000 external ids' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_deletes) d
    where jsonb_typeof(d) <> 'string' or length(d #>> '{}') not between 1 and 200
  ) then
    raise exception 'INVALID_ARGUMENT: deletes must be external ids' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(app_public.health_activity_row(_uid, p_source, item)), '{}')
    into _rows from jsonb_array_elements(p_upserts) item;
  select coalesce(array_agg(r.external_id), '{}') into _ids from unnest(_rows) r;
  select coalesce(array_agg(d #>> '{}'), '{}') into _delete_ids from jsonb_array_elements(p_deletes) d;
  if cardinality(_ids) <> (select count(distinct id) from unnest(_ids) id) then
    raise exception 'INVALID_ARGUMENT: duplicate external_id in upserts' using errcode = 'P0001';
  end if;
  if _ids && _delete_ids then
    raise exception 'INVALID_ARGUMENT: an external_id is both upserted and deleted' using errcode = 'P0001';
  end if;

  -- Two devices reading one health store must not interleave a prune with an upsert.
  perform pg_advisory_xact_lock(hashtextextended('health-activities:' || _uid::text || ':' || p_source, 0));

  delete from app_public.health_activities
   where user_id = _uid and source = p_source and external_id = any(_delete_ids);
  get diagnostics _deleted = row_count;

  begin
  insert into app_public.health_activities as a (
    user_id, source, external_id, activity_type, started_at, ended_at, duration_sec, distance_m,
    active_energy_kcal, avg_heart_rate_bpm, max_heart_rate_bpm, elevation_gain_m, source_name, device_name
  )
  select r.user_id, r.source, r.external_id, r.activity_type, r.started_at, r.ended_at, r.duration_sec,
    r.distance_m, r.active_energy_kcal, r.avg_heart_rate_bpm, r.max_heart_rate_bpm, r.elevation_gain_m,
    r.source_name, r.device_name
  from unnest(_rows) r
  on conflict (user_id, source, external_id) do update set
    activity_type = excluded.activity_type,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_sec = excluded.duration_sec,
    distance_m = excluded.distance_m,
    active_energy_kcal = excluded.active_energy_kcal,
    avg_heart_rate_bpm = excluded.avg_heart_rate_bpm,
    max_heart_rate_bpm = excluded.max_heart_rate_bpm,
    elevation_gain_m = excluded.elevation_gain_m,
    source_name = excluded.source_name,
    device_name = excluded.device_name,
    updated_at = now();
  get diagnostics _upserted = row_count;
  exception when check_violation or not_null_violation then
    raise exception 'INVALID_ARGUMENT: %', sqlerrm using errcode = 'P0001';
  end;

  if p_complete_since is not null then
    select coalesce(array_agg(k #>> '{}'), '{}') into _keep_ids from jsonb_array_elements(p_complete_ids) k;
    delete from app_public.health_activities
     where user_id = _uid and source = p_source and started_at >= p_complete_since
       and not (external_id = any(_ids || _keep_ids));
    get diagnostics _pruned = row_count;
  end if;

  return jsonb_build_object('upserted', _upserted, 'deleted', _deleted, 'pruned', _pruned);
end $$;

revoke all on function app_public.health_activities_apply(text, jsonb, jsonb, timestamptz, jsonb) from public, anon;
grant execute on function app_public.health_activities_apply(text, jsonb, jsonb, timestamptz, jsonb) to authenticated;
