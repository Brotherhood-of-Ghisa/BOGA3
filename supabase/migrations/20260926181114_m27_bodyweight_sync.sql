-- Owner-private readings and reproducible bodyweight load inputs.
-- Additive/server-first. Existing clients retain layers 0..3; bodyweight_v1
-- readers drain a fresh layer-4 cursor. Omitted new columns preserve stored
-- values on LWW updates; explicit null clears nullable columns. No snapshot
-- source FK: changing or removing a reading never changes a saved session.

create table app_public.body_weight_measurements (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  weight_value text not null,
  weight_unit text not null,
  weight_kg double precision not null,
  measured_at bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint body_weight_measurements_pkey primary key (owner_user_id, id)
);
create index body_weight_measurements_owner_received_idx
  on app_public.body_weight_measurements (owner_user_id, server_received_at);
create index body_weight_measurements_measured_at_idx
  on app_public.body_weight_measurements (measured_at);
create index body_weight_measurements_deleted_at_idx
  on app_public.body_weight_measurements (deleted_at);
create trigger body_weight_measurements_touch_server_received_at
  before update on app_public.body_weight_measurements
  for each row when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger body_weight_measurements_owner_user_id_immutable
  before update on app_public.body_weight_measurements
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.body_weight_measurements enable row level security;
create policy body_weight_measurements_owner_select on app_public.body_weight_measurements
  for select to authenticated using (owner_user_id = auth.uid());
create policy body_weight_measurements_owner_insert on app_public.body_weight_measurements
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy body_weight_measurements_owner_update on app_public.body_weight_measurements
  for update to authenticated using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy body_weight_measurements_owner_delete on app_public.body_weight_measurements
  for delete to authenticated using (owner_user_id = auth.uid());
create policy body_weight_measurements_direct_app_only on app_public.body_weight_measurements
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);
grant select, insert, update, delete on app_public.body_weight_measurements to authenticated, service_role;

alter table app_public.sessions
  add column body_weight_kg double precision,
  add column body_weight_source text,
  add column body_weight_measurement_id text,
  add column body_weight_measured_at bigint;
alter table app_public.exercise_definitions
  add column bodyweight_coefficient double precision not null default 0,
  add column movement_standard text,
  add column loading_method text;
alter table app_public.exercise_sets
  add column weight_unit text not null default 'kg',
  add column external_load_mode text,
  add column planned_weight_unit text,
  add column planned_external_load_mode text;

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  -- exercise_definitions insert columns
  revised := replace(definition, $anchor$name, load_input_mode, created_at, updated_at, deleted_at,$anchor$, $patch$name, load_input_mode, bodyweight_coefficient, movement_standard, loading_method, created_at, updated_at, deleted_at,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_definitions insert columns';
  end if;
  definition := revised;

  -- exercise_definitions insert values
  revised := replace(definition, $anchor$        coalesce(_fields ->> 'load_input_mode', 'total_load'),$anchor$, $patch$        coalesce(_fields ->> 'load_input_mode', 'total_load'),
        case when _fields ? 'bodyweight_coefficient' then (_fields ->> 'bodyweight_coefficient')::double precision else 0 end,
        _fields ->> 'movement_standard',
        _fields ->> 'loading_method',$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_definitions insert values';
  end if;
  definition := revised;

  -- exercise_definitions omitted-field preservation
  revised := replace(definition, $anchor$            load_input_mode      = case$anchor$, $patch$            bodyweight_coefficient = case when _fields ? 'bodyweight_coefficient' then excluded.bodyweight_coefficient
              else app_public.exercise_definitions.bodyweight_coefficient end,
            movement_standard = case when _fields ? 'movement_standard' then excluded.movement_standard
              else app_public.exercise_definitions.movement_standard end,
            loading_method = case when _fields ? 'loading_method' then excluded.loading_method
              else app_public.exercise_definitions.loading_method end,
            load_input_mode      = case$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_definitions omitted-field preservation';
  end if;
  definition := revised;

  -- sessions insert columns
  revised := replace(definition, $anchor$gym_id, status, started_at, completed_at, duration_sec,$anchor$, $patch$gym_id, status, started_at, completed_at, duration_sec,
        body_weight_kg, body_weight_source, body_weight_measurement_id, body_weight_measured_at,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: sessions insert columns';
  end if;
  definition := revised;

  -- sessions insert values
  revised := replace(definition, $anchor$        (_fields ->> 'duration_sec')::integer,$anchor$, $patch$        (_fields ->> 'duration_sec')::integer,
        (_fields ->> 'body_weight_kg')::double precision,
        _fields ->> 'body_weight_source',
        _fields ->> 'body_weight_measurement_id',
        (_fields ->> 'body_weight_measured_at')::bigint,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: sessions insert values';
  end if;
  definition := revised;

  -- sessions omitted-field preservation
  revised := replace(definition, $anchor$            duration_sec         = excluded.duration_sec,$anchor$, $patch$            body_weight_kg = case when _fields ? 'body_weight_kg' then excluded.body_weight_kg
              else app_public.sessions.body_weight_kg end,
            body_weight_source = case when _fields ? 'body_weight_source' then excluded.body_weight_source
              else app_public.sessions.body_weight_source end,
            body_weight_measurement_id = case when _fields ? 'body_weight_measurement_id' then excluded.body_weight_measurement_id
              else app_public.sessions.body_weight_measurement_id end,
            body_weight_measured_at = case when _fields ? 'body_weight_measured_at' then excluded.body_weight_measured_at
              else app_public.sessions.body_weight_measured_at end,
            duration_sec         = excluded.duration_sec,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: sessions omitted-field preservation';
  end if;
  definition := revised;

  -- exercise_sets insert columns
  revised := replace(definition, $anchor$planned_weight_value, planned_reps_value, planned_set_type, performance_status,$anchor$, $patch$planned_weight_value, planned_reps_value, planned_set_type, performance_status,
        weight_unit, external_load_mode, planned_weight_unit, planned_external_load_mode,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_sets insert columns';
  end if;
  definition := revised;

  -- exercise_sets insert values
  revised := replace(definition, $anchor$        _fields ->> 'performance_status',$anchor$, $patch$        _fields ->> 'performance_status',
        case when _fields ? 'weight_unit' then _fields ->> 'weight_unit' else 'kg' end,
        _fields ->> 'external_load_mode',
        _fields ->> 'planned_weight_unit',
        _fields ->> 'planned_external_load_mode',$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_sets insert values';
  end if;
  definition := revised;

  -- exercise_sets omitted-field preservation
  revised := replace(definition, $anchor$            performance_status   = excluded.performance_status,$anchor$, $patch$            weight_unit = case when _fields ? 'weight_unit' then excluded.weight_unit
              else app_public.exercise_sets.weight_unit end,
            external_load_mode = case when _fields ? 'external_load_mode' then excluded.external_load_mode
              else app_public.exercise_sets.external_load_mode end,
            planned_weight_unit = case when _fields ? 'planned_weight_unit' then excluded.planned_weight_unit
              else app_public.exercise_sets.planned_weight_unit end,
            planned_external_load_mode = case when _fields ? 'planned_external_load_mode' then excluded.planned_external_load_mode
              else app_public.exercise_sets.planned_external_load_mode end,
            performance_status   = excluded.performance_status,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: exercise_sets omitted-field preservation';
  end if;
  definition := revised;

  -- reading entity dispatch
  revised := replace(definition, $anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$, $patch$    elsif _type = 'body_weight_measurements' then
      insert into app_public.body_weight_measurements (
        owner_user_id, id, weight_value, weight_unit, weight_kg, measured_at,
        created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'weight_value',
        _fields ->> 'weight_unit',
        (_fields ->> 'weight_kg')::double precision,
        (_fields ->> 'measured_at')::bigint,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      ) on conflict (owner_user_id, id) do update
        set weight_value = excluded.weight_value,
            weight_unit = excluded.weight_unit,
            weight_kg = excluded.weight_kg,
            measured_at = excluded.measured_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.body_weight_measurements.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_push: reading entity dispatch';
  end if;
  definition := revised;
  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;

  -- capability-gated layer 4
  revised := replace(definition, $anchor$  if v_layer < 0 or v_layer > 3 then$anchor$, $patch$  -- New entity types must never reach a legacy reader or its existing cursor.
  if v_layer < 0 or v_layer > 4 or
     (v_layer = 4 and not coalesce(
       jsonb_typeof(payload->'capabilities') = 'array' and
       (payload->'capabilities') ? 'bodyweight_v1', false
     )) then$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: capability-gated layer 4';
  end if;
  definition := revised;

  -- cursor reading type
  revised := replace(definition, $anchor$      'exercise_group_links'
    ) then$anchor$, $patch$      'exercise_group_links', 'body_weight_measurements'
    ) then$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: cursor reading type';
  end if;
  definition := revised;

  -- fresh measurement cursor layer
  revised := replace(definition, $anchor$    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];$anchor$, $patch$    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];
    when 4 then v_types := array['body_weight_measurements'];$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: fresh measurement cursor layer';
  end if;
  definition := revised;

  -- exercise_definitions pull fields
  revised := replace(definition, $anchor$             'load_input_mode', ed.load_input_mode,$anchor$, $patch$             'load_input_mode', ed.load_input_mode,
             'bodyweight_coefficient', ed.bodyweight_coefficient,
             'movement_standard', ed.movement_standard,
             'loading_method', ed.loading_method,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: exercise_definitions pull fields';
  end if;
  definition := revised;

  -- sessions pull fields
  revised := replace(definition, $anchor$             'duration_sec', s.duration_sec,$anchor$, $patch$             'duration_sec', s.duration_sec,
             'body_weight_kg', s.body_weight_kg,
             'body_weight_source', s.body_weight_source,
             'body_weight_measurement_id', s.body_weight_measurement_id,
             'body_weight_measured_at', s.body_weight_measured_at,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: sessions pull fields';
  end if;
  definition := revised;

  -- exercise_sets pull fields
  revised := replace(definition, $anchor$             'performance_status', es.performance_status,$anchor$, $patch$             'performance_status', es.performance_status,
             'weight_unit', es.weight_unit,
             'external_load_mode', es.external_load_mode,
             'planned_weight_unit', es.planned_weight_unit,
             'planned_external_load_mode', es.planned_external_load_mode,$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: exercise_sets pull fields';
  end if;
  definition := revised;

  -- reading pull projection
  revised := replace(definition, $anchor$       and 'exercise_group_links' = any(v_types)
  ),$anchor$, $patch$       and 'exercise_group_links' = any(v_types)
    union all
    select 'body_weight_measurements'::text, bw.id, bw.client_updated_at_ms,
           bw.server_received_at, bw.owner_user_id,
           jsonb_build_object(
             'weight_value', bw.weight_value,
             'weight_unit', bw.weight_unit,
             'weight_kg', bw.weight_kg,
             'measured_at', bw.measured_at,
             'created_at', bw.created_at,
             'updated_at', bw.updated_at,
             'deleted_at', bw.deleted_at
           )
      from app_public.body_weight_measurements bw
     where bw.owner_user_id = auth.uid()
       and 'body_weight_measurements' = any(v_types)
  ),$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch sync_pull: reading pull projection';
  end if;
  definition := revised;
  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure) into definition;

  -- reading wipe
  revised := replace(definition, $anchor$  delete from app_public.exercise_group_links where owner_user_id = _uid;$anchor$, $patch$  delete from app_public.body_weight_measurements where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_group_links where owner_user_id = _uid;$patch$);
  if revised = definition then
    raise exception 'M27 failed to patch dev_wipe_my_data: reading wipe';
  end if;
  definition := revised;
  execute definition;
end
$migration$;
