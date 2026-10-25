-- Group shared exercises: in-app sharing of exercise templates across group members.
-- Allows all group members to share custom exercises directly into the group stream
-- and a persistent group shared exercise library, linking to group competitions where available.

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------

create table app_public.group_shared_exercises (
  id                        uuid primary key default gen_random_uuid(),
  group_id                  uuid not null references app_public.groups (id) on delete cascade,
  shared_by_user_id         uuid not null references auth.users (id) on delete cascade,
  group_exercise_id         uuid null references app_public.group_exercises (id) on delete set null,
  name                      text not null,
  load_input_mode           text not null,
  bodyweight_contribution   numeric not null default 0,
  mappings                  jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz null,
  constraint group_shared_exercises_name_trimmed
    check (name <> '' and name = app_public.group_exercise_trim(name)),
  constraint group_shared_exercises_load_input_mode_valid
    check (load_input_mode in ('total_load', 'per_side_load')),
  constraint group_shared_exercises_bw_valid
    check (bodyweight_contribution >= 0 and bodyweight_contribution <= 1)
);

create index group_shared_exercises_group_id on app_public.group_shared_exercises (group_id) where deleted_at is null;
create index group_shared_exercises_shared_by on app_public.group_shared_exercises (shared_by_user_id);

alter table app_public.group_shared_exercises enable row level security;
revoke all on table app_public.group_shared_exercises from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_shared_exercises to service_role;

-- -----------------------------------------------------------------------------
-- 2. Allow 'shared_exercise' on group_events
-- -----------------------------------------------------------------------------

alter table app_public.group_events drop constraint group_events_kind_check;
alter table app_public.group_events add constraint group_events_kind_check check (kind in (
  'session', 'joined', 'left', 'removed', 'record', 'record_voided', 'link', 'unlink',
  'lead_change', 'rules_change', 'shared_exercise'
));

-- -----------------------------------------------------------------------------
-- 3. Projection helpers
-- -----------------------------------------------------------------------------

create function app_public.group_shared_exercise_json(p_row app_public.group_shared_exercises)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'name', p_row.name,
    'load_input_mode', p_row.load_input_mode,
    'bodyweight_contribution', p_row.bodyweight_contribution,
    'mappings', p_row.mappings,
    'group_exercise_id', p_row.group_exercise_id,
    'group_exercise_name', (
      select ge.name from app_public.group_exercises ge where ge.id = p_row.group_exercise_id
    ),
    'created_at_ms', floor(extract(epoch from p_row.created_at) * 1000)::bigint
  );
$$;
revoke all on function app_public.group_shared_exercise_json(app_public.group_shared_exercises) from public, anon, authenticated, service_role;

create function app_public.group_shared_exercise_stream_card(p_event_id uuid, p_sort_at_ms bigint)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'kind', 'shared_exercise',
    'key', e.id::text,
    'sort_at_ms', p_sort_at_ms,
    'group', (
      select jsonb_build_object('group_id', g.id, 'name', g.name)
        from app_public.groups g
       where g.id = e.group_id
    ),
    'member', app_public.group_member_ref_json(e.member_user_id),
    'exercise', app_public.group_shared_exercise_json(se)
  )
  from app_public.group_events e
  join app_public.group_shared_exercises se
    on se.id = (e.payload->>'shared_exercise_id')::uuid
   and se.deleted_at is null
 where e.id = p_event_id;
$$;
revoke all on function app_public.group_shared_exercise_stream_card(uuid, bigint) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Stream function update
-- -----------------------------------------------------------------------------

do $stream$
declare
  _definition text;
  _cursor_target constant text := '''rules_change'', ''session''';
  _cursor_replacement constant text := '''rules_change'', ''session'', ''shared_exercise''';
  _items_target constant text := 'e.kind in (''record_voided'', ''link'', ''unlink'')';
  _items_replacement constant text := 'e.kind in (''record_voided'', ''link'', ''unlink'')
     union all
     select ''shared_exercise'', e.id::text, e.sort_at_ms,
            e.member_user_id, null, null, null, e.group_id, e.id
       from app_public.group_events e
       join app_public.group_shared_exercises se
         on se.id = (e.payload->>''shared_exercise_id'')::uuid
        and se.deleted_at is null
      where e.group_id = any(_scope)
        and e.kind = ''shared_exercise''';
  _case_target constant text := 'app_public.group_competition_stream_event(p.event_id,p.sort_at_ms)';
  _case_replacement constant text := 'case when p.kind = ''shared_exercise'' then app_public.group_shared_exercise_stream_card(p.event_id, p.sort_at_ms) else app_public.group_competition_stream_event(p.event_id,p.sort_at_ms) end';
begin
  _definition := pg_get_functiondef('app_public.group_competition_stream_page(uuid,jsonb,integer)'::regprocedure);
  if position(_cursor_target in _definition) = 0 then raise exception 'cursor kind target missing'; end if;
  _definition := replace(_definition, _cursor_target, _cursor_replacement);

  if position(_items_target in _definition) = 0 then raise exception 'stream items target missing'; end if;
  _definition := replace(_definition, _items_target, _items_replacement);

  if position(_case_target in _definition) = 0 then raise exception 'stream case target missing'; end if;
  _definition := replace(_definition, _case_target, _case_replacement);

  execute _definition;
end
$stream$;

-- -----------------------------------------------------------------------------
-- 5. RPCs: create, list, delete
-- -----------------------------------------------------------------------------

create function app_public.group_shared_exercise_create(
  p_group_id                 uuid,
  p_name                     text,
  p_load_input_mode          text,
  p_bodyweight_contribution numeric default 0,
  p_mappings                 jsonb default '[]'::jsonb,
  p_group_exercise_id        uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid       uuid := app_public.group_require_app_user();
  _name      text;
  _row       app_public.group_shared_exercises;
  _now_ms    bigint;
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  perform app_public.group_competition_require_capability();

  _name := app_public.group_exercise_trim(p_name);
  if _name is null or _name = '' then
    raise exception 'VALIDATION: name is required' using errcode = 'P0001';
  end if;

  if p_load_input_mode not in ('total_load', 'per_side_load') then
    raise exception 'VALIDATION: invalid load_input_mode' using errcode = 'P0001';
  end if;

  if p_bodyweight_contribution is null or p_bodyweight_contribution < 0 or p_bodyweight_contribution > 1 then
    raise exception 'VALIDATION: bodyweight_contribution must be between 0 and 1' using errcode = 'P0001';
  end if;

  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'VALIDATION: mappings must be an array' using errcode = 'P0001';
  end if;

  if p_group_exercise_id is not null then
    if not exists (
      select 1 from app_public.group_exercises
       where id = p_group_exercise_id
         and group_id = p_group_id
         and archived_at is null
    ) then
      raise exception 'NOT_FOUND: group exercise not found or archived' using errcode = 'P0001';
    end if;
  end if;

  insert into app_public.group_shared_exercises (
    group_id,
    shared_by_user_id,
    group_exercise_id,
    name,
    load_input_mode,
    bodyweight_contribution,
    mappings
  ) values (
    p_group_id,
    _uid,
    p_group_exercise_id,
    _name,
    p_load_input_mode,
    p_bodyweight_contribution,
    p_mappings
  )
  returning * into _row;

  _now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  insert into app_public.group_events (
    group_id,
    kind,
    member_user_id,
    actor_user_id,
    sort_at_ms,
    occurred_at,
    payload
  ) values (
    p_group_id,
    'shared_exercise',
    _uid,
    _uid,
    _now_ms,
    clock_timestamp(),
    jsonb_build_object('shared_exercise_id', _row.id)
  );

  return jsonb_build_object(
    'contract_version', 4,
    'group_id', p_group_id,
    'shared_exercise', jsonb_build_object(
      'id', _row.id,
      'group_id', _row.group_id,
      'shared_by', app_public.group_member_ref_json(_uid),
      'exercise', app_public.group_shared_exercise_json(_row)
    )
  );
end;
$$;
revoke all on function app_public.group_shared_exercise_create(uuid, text, text, numeric, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function app_public.group_shared_exercise_create(uuid, text, text, numeric, jsonb, uuid) to authenticated;

create function app_public.group_shared_exercises_list(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _exercises jsonb;
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  perform app_public.group_competition_require_capability();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', se.id,
        'group_id', se.group_id,
        'shared_by', app_public.group_member_ref_json(se.shared_by_user_id),
        'exercise', app_public.group_shared_exercise_json(se)
      ) order by se.created_at desc
    ),
    '[]'::jsonb
  ) into _exercises
  from app_public.group_shared_exercises se
  where se.group_id = p_group_id
    and se.deleted_at is null;

  return jsonb_build_object(
    'contract_version', 4,
    'group_id', p_group_id,
    'shared_exercises', _exercises
  );
end;
$$;
revoke all on function app_public.group_shared_exercises_list(uuid) from public, anon, authenticated, service_role;
grant execute on function app_public.group_shared_exercises_list(uuid) to authenticated;

create function app_public.group_shared_exercise_delete(p_group_id uuid, p_shared_exercise_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, true);
  _row app_public.group_shared_exercises;
begin
  perform app_public.group_competition_require_capability();

  select * into _row
    from app_public.group_shared_exercises
   where id = p_shared_exercise_id
     and group_id = p_group_id
     and deleted_at is null
     for update;

  if _row.id is null then
    raise exception 'NOT_FOUND: shared exercise not found' using errcode = 'P0001';
  end if;

  if _row.shared_by_user_id <> _uid and _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: cannot delete other members shared exercise' using errcode = 'P0001';
  end if;

  update app_public.group_shared_exercises
     set deleted_at = now(), updated_at = now()
   where id = _row.id;

  return jsonb_build_object(
    'contract_version', 4,
    'group_id', p_group_id,
    'shared_exercise_id', _row.id,
    'deleted', true
  );
end;
$$;
revoke all on function app_public.group_shared_exercise_delete(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app_public.group_shared_exercise_delete(uuid, uuid) to authenticated;
