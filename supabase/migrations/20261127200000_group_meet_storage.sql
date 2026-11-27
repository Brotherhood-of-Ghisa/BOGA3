-- Server-only group meets: definitions, challenges, the online roster and the
-- meet stream kind. Rules: docs/specs/tech/group-meet-contract.md; product
-- facts: docs/product/meets.md. Group storage rules 1-4 apply: no owner column,
-- no FK into Sync v2 tables, RLS on with no policies and nothing granted.

create table app_public.group_meets (
  id uuid primary key,
  group_id uuid not null references app_public.groups(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  venue_name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  entry_note text,
  version bigint not null default 1 check (version > 0),
  create_key text not null,
  last_write_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  constraint group_meets_window check (ends_at > starts_at and ends_at - starts_at <= interval '7 days'),
  constraint group_meets_title check (title is null or (char_length(title) between 1 and 80 and title = app_public.group_exercise_trim(title))),
  constraint group_meets_venue check (char_length(venue_name) between 1 and 80 and venue_name = app_public.group_exercise_trim(venue_name)),
  constraint group_meets_address check (address is null or (char_length(address) between 1 and 200 and address = app_public.group_exercise_trim(address))),
  constraint group_meets_entry_note check (entry_note is null or (char_length(entry_note) between 1 and 1000 and entry_note = app_public.group_exercise_trim(entry_note))),
  constraint group_meets_coordinates check ((latitude is null) = (longitude is null)
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))),
  constraint group_meets_cancel_before_start check (cancelled_at is null or cancelled_at < starts_at)
);
create index group_meets_by_start on app_public.group_meets(group_id, starts_at, id) where cancelled_at is null;

create table app_public.group_meet_challenges (
  id uuid primary key,
  meet_id uuid not null references app_public.group_meets(id) on delete cascade,
  group_exercise_id uuid not null references app_public.group_exercises(id) on delete cascade,
  metric text not null check (metric in ('e1rm', 'weight', 'reps', 'volume', 'seconds')),
  version bigint not null default 1 check (version > 0),
  create_key text not null,
  last_write_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);
-- A removed challenge frees its exercise + metric for a re-add.
create unique index group_meet_challenges_live on app_public.group_meet_challenges(meet_id, group_exercise_id, metric)
  where removed_at is null;

create table app_public.group_meet_roster (
  meet_id uuid not null references app_public.group_meets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key (meet_id, user_id)
);
create index group_meet_roster_user on app_public.group_meet_roster(user_id);

-- ---------------------------------------------------------------------------
-- Helpers (no client execute)
-- ---------------------------------------------------------------------------

create function app_public.group_meet_ms(p_at timestamptz) returns bigint
language sql immutable set search_path = app_public, pg_temp as $$
  select floor(extract(epoch from p_at) * 1000)::bigint;
$$;

create function app_public.group_meet_at(p_ms bigint) returns timestamptz
language sql immutable set search_path = app_public, pg_temp as $$
  select timestamptz 'epoch' + p_ms * interval '1 millisecond';
$$;

-- Results stay live until this instant ([[meets.results]]); joins close with it.
create function app_public.group_meet_cutoff(p_meet app_public.group_meets) returns timestamptz
language sql immutable set search_path = app_public, pg_temp as $$
  select p_meet.ends_at + interval '24 hours';
$$;

create function app_public.group_meet_state(p_meet app_public.group_meets, p_now timestamptz) returns text
language sql immutable set search_path = app_public, pg_temp as $$
  select case when p_meet.cancelled_at is not null then 'cancelled'
    when p_now < p_meet.starts_at then 'scheduled'
    when p_now < p_meet.ends_at then 'live'
    when p_now < app_public.group_meet_cutoff(p_meet) then 'finalizing'
    else 'final' end;
$$;

create function app_public.group_meet_member_ref(p_user uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select case when p_user is not null then app_public.group_member_ref_json(p_user) end;
$$;

create function app_public.group_meet_json(p_meet app_public.group_meets) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object(
    'meet_id', p_meet.id, 'group_id', p_meet.group_id, 'title', p_meet.title,
    'starts_at_ms', app_public.group_meet_ms(p_meet.starts_at),
    'ends_at_ms', app_public.group_meet_ms(p_meet.ends_at),
    'cutoff_at_ms', app_public.group_meet_ms(app_public.group_meet_cutoff(p_meet)),
    'time_zone', (select g.cow_time_zone from app_public.groups g where g.id = p_meet.group_id),
    'venue_name', p_meet.venue_name, 'address', p_meet.address,
    'latitude', p_meet.latitude, 'longitude', p_meet.longitude, 'entry_note', p_meet.entry_note,
    'version', p_meet.version, 'state', app_public.group_meet_state(p_meet, clock_timestamp()),
    'created_by', app_public.group_meet_member_ref(p_meet.created_by),
    'created_at_ms', app_public.group_meet_ms(p_meet.created_at),
    'cancelled_at_ms', app_public.group_meet_ms(p_meet.cancelled_at),
    'cancelled_by', app_public.group_meet_member_ref(p_meet.cancelled_by));
$$;

create function app_public.group_meet_challenge_json(p_challenge app_public.group_meet_challenges) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object(
    'challenge_id', p_challenge.id, 'meet_id', p_challenge.meet_id,
    'group_exercise_id', p_challenge.group_exercise_id,
    'exercise_name', ge.name, 'exercise_archived', ge.archived_at is not null,
    'metric', p_challenge.metric, 'version', p_challenge.version,
    'author', app_public.group_meet_member_ref(p_challenge.created_by),
    'created_at_ms', app_public.group_meet_ms(p_challenge.created_at))
  from app_public.group_exercises ge where ge.id = p_challenge.group_exercise_id;
$$;

-- Normalizes and validates a meet's fields (VALIDATION); time-relative checks
-- are group_meet_check_window's. The result is also the create/edit request key.
create function app_public.group_meet_fields(p_title text, p_starts_at_ms bigint, p_ends_at_ms bigint,
  p_venue_name text, p_address text, p_latitude double precision, p_longitude double precision, p_entry_note text)
returns jsonb language plpgsql immutable set search_path = app_public, pg_temp as $$
declare
  _title text := nullif(app_public.group_exercise_trim(p_title), '');
  _venue text := nullif(app_public.group_exercise_trim(p_venue_name), '');
  _address text := nullif(app_public.group_exercise_trim(p_address), '');
  _note text := nullif(app_public.group_exercise_trim(p_entry_note), '');
  _ends bigint := coalesce(p_ends_at_ms, p_starts_at_ms + 3 * 3600 * 1000);
begin
  if p_starts_at_ms is null then
    raise exception 'VALIDATION: a meet needs a start time' using errcode = 'P0001';
  end if;
  if _ends <= p_starts_at_ms then
    raise exception 'VALIDATION: a meet must end after it starts' using errcode = 'P0001';
  end if;
  if _ends - p_starts_at_ms > 7 * 24 * 3600 * 1000::bigint then
    raise exception 'VALIDATION: a meet can last at most 7 days' using errcode = 'P0001';
  end if;
  if _title is not null and char_length(_title) > 80 then
    raise exception 'VALIDATION: meet title must be at most 80 characters' using errcode = 'P0001';
  end if;
  if _venue is null or char_length(_venue) > 80 then
    raise exception 'VALIDATION: venue name must be 1-80 characters' using errcode = 'P0001';
  end if;
  if _address is not null and char_length(_address) > 200 then
    raise exception 'VALIDATION: address must be at most 200 characters' using errcode = 'P0001';
  end if;
  if _note is not null and char_length(_note) > 1000 then
    raise exception 'VALIDATION: entry note must be at most 1000 characters' using errcode = 'P0001';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or (p_latitude is not null and not (p_latitude between -90 and 90 and p_longitude between -180 and 180)) then
    raise exception 'VALIDATION: coordinates need a valid latitude and longitude' using errcode = 'P0001';
  end if;
  return jsonb_build_object('title', _title, 'starts_at_ms', p_starts_at_ms, 'ends_at_ms', _ends,
    'venue_name', _venue, 'address', _address, 'latitude', p_latitude, 'longitude', p_longitude, 'entry_note', _note);
end $$;

create function app_public.group_meet_check_window(p_fields jsonb, p_now timestamptz) returns void
language plpgsql immutable set search_path = app_public, pg_temp as $$
begin
  if app_public.group_meet_at((p_fields->>'ends_at_ms')::bigint) <= p_now then
    raise exception 'VALIDATION: a meet must end in the future' using errcode = 'P0001';
  end if;
  if app_public.group_meet_at((p_fields->>'starts_at_ms')::bigint) > p_now + interval '400 days' then
    raise exception 'VALIDATION: a meet must start within 400 days' using errcode = 'P0001';
  end if;
end $$;

-- Challenge metrics are those the group scorer can rank for the exercise: a
-- Hold exercise ranks seconds; any other exercise ranks the repetition metrics.
create function app_public.group_meet_challenge_validate(p_group uuid, p_exercise uuid, p_metric text) returns void
language plpgsql stable set search_path = app_public, pg_temp as $$
declare _default text;
begin
  if p_metric is null or p_metric not in ('e1rm', 'weight', 'reps', 'volume', 'seconds') then
    raise exception 'VALIDATION: choose a challenge metric' using errcode = 'P0001';
  end if;
  select ge.default_metric into _default from app_public.group_exercises ge
   where ge.id = p_exercise and ge.group_id = p_group and ge.archived_at is null;
  if not found then
    raise exception 'VALIDATION: choose a live group exercise' using errcode = 'P0001';
  end if;
  if (_default = 'seconds') <> (p_metric = 'seconds') then
    raise exception 'VALIDATION: this metric does not apply to that exercise' using errcode = 'P0001';
  end if;
end $$;

create function app_public.group_meet_stream_definition(p_meet app_public.group_meets) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('meet_id', p_meet.id, 'title', p_meet.title, 'venue_name', p_meet.venue_name,
    'starts_at_ms', app_public.group_meet_ms(p_meet.starts_at), 'ends_at_ms', app_public.group_meet_ms(p_meet.ends_at),
    'version', p_meet.version);
$$;

create function app_public.group_meet_challenge_snapshot(p_challenge app_public.group_meet_challenges) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('challenge_id', p_challenge.id, 'group_exercise_id', p_challenge.group_exercise_id,
    'exercise_name', coalesce((select ge.name from app_public.group_exercises ge where ge.id = p_challenge.group_exercise_id),
      'Exercise unavailable'),
    'metric', p_challenge.metric);
$$;

-- One stream item, in the writer's transaction. `scheduled`, `cancelled`,
-- `on` and `results` are written once per meet (a unique index);
-- `results_refreshed` and `challenge_changed` once per write. Payloads hold
-- definition snapshots only, never scores or private context.
create function app_public.group_meet_stream_write(p_meet app_public.group_meets, p_event text,
  p_occurred_at timestamptz, p_actor uuid, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  insert into app_public.group_events(group_id, kind, member_user_id, actor_user_id, sort_at_ms, payload)
  values (p_meet.group_id, 'meet', null, p_actor, app_public.group_meet_ms(p_occurred_at),
    jsonb_build_object('event', p_event, 'meet', app_public.group_meet_stream_definition(p_meet))
      || coalesce(p_detail, '{}'::jsonb))
  on conflict do nothing;
end $$;

create function app_public.group_meet_challenge_changed(p_meet app_public.group_meets, p_change text,
  p_challenge jsonb, p_previous jsonb, p_actor uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  if p_now >= app_public.group_meet_cutoff(p_meet) then
    perform app_public.group_meet_stream_write(p_meet, 'challenge_changed', p_now, p_actor,
      jsonb_build_object('change', p_change, 'challenge', p_challenge, 'previous', p_previous));
  end if;
end $$;

alter table app_public.group_events drop constraint group_events_kind_check,
  add constraint group_events_kind_check check (kind in (
    'session','joined','left','removed','record','record_voided','link','unlink',
    'lead_change','rules_change','shared_exercise','cow','meet')),
  drop constraint group_events_subject_shape,
  add constraint group_events_subject_shape check (kind in ('rules_change','cow','meet') or member_user_id is not null),
  add constraint group_events_meet_shape check (kind <> 'meet' or (
    contract_version = 1 and rules_revision is null and group_exercise_id is null and member_user_id is null
    and session_id is null and set_id is null and membership_id is null
    and metric is null and certified is null and reason is null and related_event_id is null
    and payload is not null and payload ?& array['event','meet'] and payload->'meet' ? 'meet_id'
    and payload->>'event' in ('scheduled','cancelled','on','results','results_refreshed','challenge_changed')
    and (payload->>'event' <> 'challenge_changed' or (payload ?& array['change','challenge','previous']
      and payload->>'change' in ('added','edited','removed')))));
create unique index group_events_meet_transition on app_public.group_events
  ((payload->'meet'->>'meet_id'), (payload->>'event'))
  where kind = 'meet' and payload->>'event' in ('scheduled','cancelled','on','results');

-- ---------------------------------------------------------------------------
-- Meet RPCs. Mutations lock the group row FOR UPDATE (group_require_member
-- with p_lock) before the role check; reads take KEY SHARE.
-- ---------------------------------------------------------------------------

create function app_public.group_meet_require_manager(p_group uuid, p_user uuid) returns void
language plpgsql set search_path = app_public, pg_temp as $$
begin
  if app_public.group_require_member(p_group, p_user, true) not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only owners and admins can manage meets' using errcode = 'P0001';
  end if;
end $$;

create function app_public.group_meet_require_reader(p_group uuid, p_user uuid) returns text
language plpgsql set search_path = app_public, pg_temp as $$
begin
  perform 1 from app_public.groups where id = p_group and deleted_at is null for key share;
  return app_public.group_require_member(p_group, p_user, false);
end $$;

create function app_public.group_meet_create(p_group_id uuid, p_meet_id uuid, p_title text,
  p_starts_at_ms bigint, p_ends_at_ms bigint, p_venue_name text, p_address text,
  p_latitude double precision, p_longitude double precision, p_entry_note text) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _fields jsonb; _key text; _meet app_public.group_meets;
begin
  perform app_public.group_meet_require_manager(p_group_id, _uid);
  if p_meet_id is null then
    raise exception 'VALIDATION: a meet needs a request id' using errcode = 'P0001';
  end if;
  _fields := app_public.group_meet_fields(p_title, p_starts_at_ms, p_ends_at_ms, p_venue_name, p_address,
    p_latitude, p_longitude, p_entry_note);
  _key := _fields::text;
  select * into _meet from app_public.group_meets where id = p_meet_id;
  if found then
    if _meet.group_id = p_group_id and _meet.create_key = _key then
      return jsonb_build_object('meet', app_public.group_meet_json(_meet));
    end if;
    raise exception 'CONFLICT: this meet request already exists' using errcode = 'P0001';
  end if;
  perform app_public.group_meet_check_window(_fields, clock_timestamp());
  insert into app_public.group_meets(id, group_id, title, starts_at, ends_at, venue_name, address,
    latitude, longitude, entry_note, create_key, created_by, updated_by)
  values (p_meet_id, p_group_id, _fields->>'title',
    app_public.group_meet_at((_fields->>'starts_at_ms')::bigint), app_public.group_meet_at((_fields->>'ends_at_ms')::bigint),
    _fields->>'venue_name', _fields->>'address', (_fields->>'latitude')::double precision,
    (_fields->>'longitude')::double precision, _fields->>'entry_note', _key, _uid, _uid)
  on conflict (id) do nothing
  returning * into _meet;
  if not found then
    raise exception 'CONFLICT: this meet request already exists' using errcode = 'P0001';
  end if;
  perform app_public.group_meet_stream_write(_meet, 'scheduled', _meet.created_at, _uid);
  return jsonb_build_object('meet', app_public.group_meet_json(_meet));
end $$;

create function app_public.group_meet_update(p_group_id uuid, p_meet_id uuid, p_expected_version bigint,
  p_title text, p_starts_at_ms bigint, p_ends_at_ms bigint, p_venue_name text, p_address text,
  p_latitude double precision, p_longitude double precision, p_entry_note text) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _fields jsonb; _key text; _meet app_public.group_meets;
  _now timestamptz;
begin
  perform app_public.group_meet_require_manager(p_group_id, _uid);
  _fields := app_public.group_meet_fields(p_title, p_starts_at_ms, p_ends_at_ms, p_venue_name, p_address,
    p_latitude, p_longitude, p_entry_note);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id for update;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  _key := jsonb_build_array('edit', p_expected_version, _fields)::text;
  if _meet.last_write_key = _key then
    return jsonb_build_object('meet', app_public.group_meet_json(_meet));
  end if;
  if _meet.version is distinct from p_expected_version then
    raise exception 'CONFLICT: this meet changed; refresh before saving' using errcode = 'P0001';
  end if;
  _now := clock_timestamp();
  if _meet.cancelled_at is not null then
    raise exception 'CONFLICT: this meet was cancelled' using errcode = 'P0001';
  end if;
  if _meet.ends_at <= _now then
    raise exception 'CONFLICT: this meet has ended; only its challenges can change' using errcode = 'P0001';
  end if;
  perform app_public.group_meet_check_window(_fields, _now);
  update app_public.group_meets set title = _fields->>'title',
    starts_at = app_public.group_meet_at((_fields->>'starts_at_ms')::bigint),
    ends_at = app_public.group_meet_at((_fields->>'ends_at_ms')::bigint),
    venue_name = _fields->>'venue_name', address = _fields->>'address',
    latitude = (_fields->>'latitude')::double precision, longitude = (_fields->>'longitude')::double precision,
    entry_note = _fields->>'entry_note', version = version + 1, last_write_key = _key,
    updated_by = _uid, updated_at = _now
  where id = _meet.id returning * into _meet;
  return jsonb_build_object('meet', app_public.group_meet_json(_meet));
end $$;

create function app_public.group_meet_cancel(p_group_id uuid, p_meet_id uuid, p_expected_version bigint) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _key text; _meet app_public.group_meets; _now timestamptz;
begin
  perform app_public.group_meet_require_manager(p_group_id, _uid);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id for update;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  _key := jsonb_build_array('cancel', p_expected_version)::text;
  if _meet.last_write_key = _key then
    return jsonb_build_object('meet', app_public.group_meet_json(_meet));
  end if;
  if _meet.version is distinct from p_expected_version then
    raise exception 'CONFLICT: this meet changed; refresh before cancelling' using errcode = 'P0001';
  end if;
  if _meet.cancelled_at is not null then
    raise exception 'CONFLICT: this meet was cancelled' using errcode = 'P0001';
  end if;
  _now := clock_timestamp();
  if _meet.starts_at <= _now then
    raise exception 'CONFLICT: this meet has started; it can no longer be cancelled' using errcode = 'P0001';
  end if;
  update app_public.group_meets set cancelled_at = _now, cancelled_by = _uid, version = version + 1,
    last_write_key = _key, updated_by = _uid, updated_at = _now
  where id = _meet.id returning * into _meet;
  perform app_public.group_meet_stream_write(_meet, 'cancelled', _now, _uid);
  return jsonb_build_object('meet', app_public.group_meet_json(_meet));
end $$;

-- Challenge writes need a live (not cancelled) meet of the group; a member
-- may write before, during and after it.
create function app_public.group_meet_for_challenge(p_group uuid, p_meet uuid) returns app_public.group_meets
language plpgsql set search_path = app_public, pg_temp as $$
declare _meet app_public.group_meets;
begin
  select * into _meet from app_public.group_meets where id = p_meet and group_id = p_group;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  if _meet.cancelled_at is not null then
    raise exception 'CONFLICT: this meet was cancelled' using errcode = 'P0001';
  end if;
  return _meet;
end $$;

create function app_public.group_meet_challenge_add(p_group_id uuid, p_meet_id uuid, p_challenge_id uuid,
  p_group_exercise_id uuid, p_metric text) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _meet app_public.group_meets;
  _challenge app_public.group_meet_challenges; _key text; _now timestamptz;
begin
  perform app_public.group_require_member(p_group_id, _uid, true);
  if p_challenge_id is null then
    raise exception 'VALIDATION: a challenge needs a request id' using errcode = 'P0001';
  end if;
  perform app_public.group_meet_challenge_validate(p_group_id, p_group_exercise_id, p_metric);
  _key := jsonb_build_array(p_meet_id, p_group_exercise_id, p_metric)::text;
  select * into _challenge from app_public.group_meet_challenges where id = p_challenge_id;
  if found then
    if _challenge.create_key = _key and _challenge.removed_at is null
       and exists (select 1 from app_public.group_meets m where m.id = _challenge.meet_id and m.group_id = p_group_id) then
      return jsonb_build_object('challenge', app_public.group_meet_challenge_json(_challenge));
    end if;
    raise exception 'CONFLICT: this challenge request already exists' using errcode = 'P0001';
  end if;
  _meet := app_public.group_meet_for_challenge(p_group_id, p_meet_id);
  if exists (select 1 from app_public.group_meet_challenges c where c.meet_id = _meet.id
      and c.group_exercise_id = p_group_exercise_id and c.metric = p_metric and c.removed_at is null) then
    raise exception 'DUPLICATE: this meet already has that challenge' using errcode = 'P0001';
  end if;
  if (select count(*) from app_public.group_meet_challenges c where c.meet_id = _meet.id and c.removed_at is null) >= 20 then
    raise exception 'VALIDATION: a meet can have at most 20 challenges' using errcode = 'P0001';
  end if;
  _now := clock_timestamp();
  insert into app_public.group_meet_challenges(id, meet_id, group_exercise_id, metric, create_key,
    created_by, created_at, updated_by, updated_at)
  values (p_challenge_id, _meet.id, p_group_exercise_id, p_metric, _key, _uid, _now, _uid, _now)
  on conflict (id) do nothing
  returning * into _challenge;
  if not found then
    raise exception 'CONFLICT: this challenge request already exists' using errcode = 'P0001';
  end if;
  perform app_public.group_meet_challenge_changed(_meet, 'added',
    app_public.group_meet_challenge_snapshot(_challenge), null, _uid, _now);
  return jsonb_build_object('challenge', app_public.group_meet_challenge_json(_challenge));
end $$;

-- The challenge for an edit or removal by its author or an owner/admin.
create function app_public.group_meet_challenge_for_write(p_group uuid, p_meet uuid, p_challenge uuid,
  p_user uuid, p_role text) returns app_public.group_meet_challenges
language plpgsql set search_path = app_public, pg_temp as $$
declare _challenge app_public.group_meet_challenges;
begin
  perform app_public.group_meet_for_challenge(p_group, p_meet);
  select * into _challenge from app_public.group_meet_challenges where id = p_challenge and meet_id = p_meet for update;
  if not found then
    raise exception 'NOT_FOUND: challenge not found' using errcode = 'P0001';
  end if;
  if p_role not in ('owner', 'admin') and _challenge.created_by is distinct from p_user then
    raise exception 'FORBIDDEN: only its author or an admin can change a challenge' using errcode = 'P0001';
  end if;
  return _challenge;
end $$;

create function app_public.group_meet_challenge_update(p_group_id uuid, p_meet_id uuid, p_challenge_id uuid,
  p_expected_version bigint, p_group_exercise_id uuid, p_metric text) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _role text; _meet app_public.group_meets;
  _challenge app_public.group_meet_challenges; _previous jsonb; _key text; _now timestamptz;
begin
  _role := app_public.group_require_member(p_group_id, _uid, true);
  perform app_public.group_meet_challenge_validate(p_group_id, p_group_exercise_id, p_metric);
  _challenge := app_public.group_meet_challenge_for_write(p_group_id, p_meet_id, p_challenge_id, _uid, _role);
  _key := jsonb_build_array('edit', p_expected_version, p_group_exercise_id, p_metric)::text;
  if _challenge.last_write_key = _key and _challenge.removed_at is null then
    return jsonb_build_object('challenge', app_public.group_meet_challenge_json(_challenge));
  end if;
  if _challenge.removed_at is not null then
    raise exception 'CONFLICT: this challenge was removed' using errcode = 'P0001';
  end if;
  if _challenge.version is distinct from p_expected_version then
    raise exception 'CONFLICT: this challenge changed; refresh before saving' using errcode = 'P0001';
  end if;
  if exists (select 1 from app_public.group_meet_challenges c where c.meet_id = p_meet_id and c.id <> _challenge.id
      and c.group_exercise_id = p_group_exercise_id and c.metric = p_metric and c.removed_at is null) then
    raise exception 'DUPLICATE: this meet already has that challenge' using errcode = 'P0001';
  end if;
  _previous := app_public.group_meet_challenge_snapshot(_challenge);
  _now := clock_timestamp();
  update app_public.group_meet_challenges set group_exercise_id = p_group_exercise_id, metric = p_metric,
    version = version + 1, last_write_key = _key, updated_by = _uid, updated_at = _now
  where id = _challenge.id returning * into _challenge;
  select * into _meet from app_public.group_meets where id = p_meet_id;
  perform app_public.group_meet_challenge_changed(_meet, 'edited',
    app_public.group_meet_challenge_snapshot(_challenge), _previous, _uid, _now);
  return jsonb_build_object('challenge', app_public.group_meet_challenge_json(_challenge));
end $$;

create function app_public.group_meet_challenge_remove(p_group_id uuid, p_meet_id uuid, p_challenge_id uuid,
  p_expected_version bigint) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _role text; _meet app_public.group_meets;
  _challenge app_public.group_meet_challenges; _now timestamptz;
begin
  _role := app_public.group_require_member(p_group_id, _uid, true);
  _challenge := app_public.group_meet_challenge_for_write(p_group_id, p_meet_id, p_challenge_id, _uid, _role);
  if _challenge.removed_at is not null then
    return jsonb_build_object('challenge_id', _challenge.id, 'removed', true);
  end if;
  if _challenge.version is distinct from p_expected_version then
    raise exception 'CONFLICT: this challenge changed; refresh before removing' using errcode = 'P0001';
  end if;
  _now := clock_timestamp();
  update app_public.group_meet_challenges set removed_at = _now, removed_by = _uid, version = version + 1,
    updated_by = _uid, updated_at = _now
  where id = _challenge.id returning * into _challenge;
  select * into _meet from app_public.group_meets where id = p_meet_id;
  perform app_public.group_meet_challenge_changed(_meet, 'removed',
    app_public.group_meet_challenge_snapshot(_challenge), null, _uid, _now);
  return jsonb_build_object('challenge_id', _challenge.id, 'removed', true);
end $$;

-- Join and Leave are open to any current member until the cutoff; a
-- cancelled meet refuses joins.
create function app_public.group_meet_for_roster(p_group uuid, p_meet uuid, p_now timestamptz) returns app_public.group_meets
language plpgsql set search_path = app_public, pg_temp as $$
declare _meet app_public.group_meets;
begin
  select * into _meet from app_public.group_meets where id = p_meet and group_id = p_group;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  if p_now >= app_public.group_meet_cutoff(_meet) then
    raise exception 'CONFLICT: this meet has closed' using errcode = 'P0001';
  end if;
  return _meet;
end $$;

create function app_public.group_meet_join(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _meet app_public.group_meets; _now timestamptz;
begin
  perform app_public.group_require_member(p_group_id, _uid, true);
  _now := clock_timestamp();
  _meet := app_public.group_meet_for_roster(p_group_id, p_meet_id, _now);
  if _meet.cancelled_at is not null then
    raise exception 'CONFLICT: this meet was cancelled' using errcode = 'P0001';
  end if;
  insert into app_public.group_meet_roster(meet_id, user_id, joined_at) values (_meet.id, _uid, _now)
  on conflict do nothing;
  return jsonb_build_object('meet_id', _meet.id, 'joined', true);
end $$;

create function app_public.group_meet_leave(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _meet app_public.group_meets;
begin
  perform app_public.group_require_member(p_group_id, _uid, true);
  _meet := app_public.group_meet_for_roster(p_group_id, p_meet_id, clock_timestamp());
  delete from app_public.group_meet_roster where meet_id = _meet.id and user_id = _uid;
  return jsonb_build_object('meet_id', _meet.id, 'joined', false);
end $$;

-- One meet with its live challenges and joined roster, to current members.
create function app_public.group_meet_get(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _role text; _meet app_public.group_meets;
begin
  _role := app_public.group_meet_require_reader(p_group_id, _uid);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  return jsonb_build_object('meet', app_public.group_meet_json(_meet),
    'challenges', coalesce((select jsonb_agg(app_public.group_meet_challenge_json(c) order by c.created_at, c.id)
      from app_public.group_meet_challenges c where c.meet_id = _meet.id and c.removed_at is null), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(r.user_id),
        'joined_at_ms', app_public.group_meet_ms(r.joined_at),
        'current_member', exists (select 1 from app_public.group_memberships m
          where m.group_id = p_group_id and m.user_id = r.user_id and m.ended_at is null))
        order by r.joined_at, r.user_id)
      from app_public.group_meet_roster r where r.meet_id = _meet.id), '[]'::jsonb),
    'viewer', jsonb_build_object('role', _role,
      'joined', exists (select 1 from app_public.group_meet_roster r where r.meet_id = _meet.id and r.user_id = _uid)));
end $$;

-- A group's meets: `upcoming` (scheduled or live, soonest first, first page
-- only) and a keyset page of `past` ones (ended, latest first). Cancelled
-- meets are left out; group_meet_get still reads them.
create function app_public.group_meet_list(p_group_id uuid, p_before text default null, p_limit integer default 20)
returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _cursor jsonb; _edge timestamptz; _edge_id uuid;
  _now timestamptz; _upcoming jsonb := '[]'::jsonb; _past jsonb; _more boolean; _last jsonb;
begin
  perform app_public.group_meet_require_reader(p_group_id, _uid);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'VALIDATION: invalid meet page size' using errcode = 'P0001';
  end if;
  if p_before is not null then
    begin
      _cursor := p_before::jsonb;
      if jsonb_typeof(_cursor) <> 'object' or (select count(*) from jsonb_object_keys(_cursor)) <> 3
         or _cursor->>'group_id' is distinct from p_group_id::text
         or jsonb_typeof(_cursor->'starts_at_ms') <> 'number' then
        raise exception 'bad cursor';
      end if;
      _edge := app_public.group_meet_at((_cursor->>'starts_at_ms')::bigint);
      _edge_id := (_cursor->>'meet_id')::uuid;
      if _edge_id is null then raise exception 'bad cursor'; end if;
    exception when others then
      raise exception 'VALIDATION: invalid meet cursor' using errcode = 'P0001';
    end;
  end if;
  _now := clock_timestamp();
  if p_before is null then
    select coalesce(jsonb_agg(app_public.group_meet_json(m) order by m.starts_at, m.id), '[]'::jsonb) into _upcoming
      from (select * from app_public.group_meets x where x.group_id = p_group_id and x.cancelled_at is null
              and x.ends_at > _now order by x.starts_at, x.id limit 50) m;
  end if;
  select coalesce(jsonb_agg(app_public.group_meet_json(m) order by m.starts_at desc, m.id desc), '[]'::jsonb),
         count(*) > p_limit
    into _past, _more
    from (select * from app_public.group_meets x where x.group_id = p_group_id and x.cancelled_at is null
            and x.ends_at <= _now and (_edge is null or (x.starts_at, x.id) < (_edge, _edge_id))
          order by x.starts_at desc, x.id desc limit p_limit + 1) m;
  if _more then _past := _past - (jsonb_array_length(_past) - 1); end if;
  _last := _past -> (jsonb_array_length(_past) - 1);
  return jsonb_build_object('upcoming', _upcoming, 'past', _past, 'next_cursor', case when _more then
    jsonb_build_object('group_id', p_group_id, 'starts_at_ms', _last->'starts_at_ms', 'meet_id', _last->'meet_id')::text end);
end $$;

-- ---------------------------------------------------------------------------
-- Stream: an opt-in v7 page lists meet items; v2-v6 responses are unchanged.
-- ---------------------------------------------------------------------------

create function app_public.group_meet_stream_item(p_event_id uuid, p_sort bigint) returns jsonb
language sql stable security definer set search_path = app_public, pg_temp as $$
  select jsonb_build_object('kind', 'meet', 'key', lpad(e.seq::text, 20, '0'), 'sort_at_ms', p_sort,
    'event', e.payload->'event', 'meet', e.payload->'meet', 'change', e.payload->'change',
    'challenge', e.payload->'challenge', 'previous', e.payload->'previous',
    'actor', app_public.group_meet_member_ref(e.actor_user_id))
  from app_public.group_events e where e.id = p_event_id and e.kind = 'meet';
$$;

do $migration$
declare target text; anchor text; replacement text; definition text;
begin
  for target, anchor, replacement in select * from (values
    ('app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer)',
     $anchor$and not (p_cow and (p_before ->> 'kind') = 'cow')$anchor$,
     $replacement$and not (p_cow and (p_before ->> 'kind') = 'cow')
          and not (p_level >= 7 and (p_before ->> 'kind') = 'meet')$replacement$),
    ('app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer)',
     $anchor$      (select 'shared_exercise', e.id::text, e.sort_at_ms,$anchor$,
     $replacement$      (select 'meet', lpad(e.seq::text,20,'0'), e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
        where p_level >= 7 and e.group_id = sg.gid and e.kind = 'meet'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('meet' collate "C" > _c_kind
               or ('meet' = _c_kind and lpad(e.seq::text,20,'0') collate "C" < _c_key))))
        order by e.sort_at_ms desc, lpad(e.seq::text,20,'0') collate "C" desc
        limit _limit + 1)
      union all
      (select 'shared_exercise', e.id::text, e.sort_at_ms,$replacement$),
    ('app_public.group_competition_stream_page_core(uuid,jsonb,integer,boolean,integer)',
     $anchor$when s.kind = 'shared_exercise' then$anchor$,
     $replacement$when s.kind = 'meet' then
               app_public.group_meet_stream_item(s.event_id, s.sort_at_ms)
             when s.kind = 'shared_exercise' then$replacement$),
    ('app_public.group_competition_stream_v3_level(uuid,text,integer,integer)',
     $anchor$case when p_level>=6 then 'competition_stream_v6'$anchor$,
     $replacement$case when p_level>=7 then 'competition_stream_v7' when p_level>=6 then 'competition_stream_v6'$replacement$)
  ) changes(target, anchor, replacement) loop
    definition := pg_get_functiondef(target::regprocedure);
    if strpos(definition, anchor) = 0 then raise exception 'meet stream patch anchor missing in %', target; end if;
    if strpos(substr(definition, strpos(definition, anchor) + length(anchor)), anchor) <> 0 then
      raise exception 'meet stream patch anchor repeats in %', target;
    end if;
    execute replace(definition, anchor, replacement);
  end loop;
end $migration$;

create function app_public.group_competition_stream_v7(p_group_id uuid default null, p_before text default null,
  p_limit integer default 20) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  return app_public.group_competition_stream_v3_level(p_group_id, p_before, p_limit, 7);
end $$;

-- ---------------------------------------------------------------------------
-- Posture: tables closed to clients; only the RPCs are client-executable.
-- ---------------------------------------------------------------------------

do $$
declare t text; f record;
begin
  foreach t in array array['group_meets', 'group_meet_challenges', 'group_meet_roster'] loop
    execute format('alter table app_public.%I enable row level security', t);
    execute format('revoke all on app_public.%I from public, anon, authenticated, service_role', t);
  end loop;
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and (p.proname like 'group\_meet\_%' or p.proname = 'group_competition_stream_v7') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('group_meet_create', 'group_meet_update', 'group_meet_cancel', 'group_meet_get', 'group_meet_list',
        'group_meet_challenge_add', 'group_meet_challenge_update', 'group_meet_challenge_remove',
        'group_meet_join', 'group_meet_leave', 'group_competition_stream_v7') then
      execute format('grant execute on function %s to anon, authenticated', f.signature);
    end if;
  end loop;
end $$;
