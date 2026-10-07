-- Block-attachment arbitration for the planning provenance columns
-- (session-planning contract 4.5). Replaces sync_push with its deployed
-- definition (pg_get_functiondef at authoring time) plus one wrapper: the
-- upsert loop is inside an exception block that maps a unique violation on
-- the three provenance partial unique indexes (
-- session_exercises_owner_source_block_unique, exercise_sets_owner_source_set_unique,
-- sessions_owner_source_plan_unique) to the wire-stable BLOCK_ALREADY_ATTACHED
-- token. The batch remains atomic (single ack, full rollback), so server
-- commit order stays the only tiebreak between two offline devices
-- attaching the same plan block.

CREATE OR REPLACE FUNCTION app_public.sync_push(entities jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'app_public', 'public', 'extensions'
AS $function$
declare
  _uid              uuid;
  _entities         jsonb := entities;
  _now_tstz         timestamptz;
  _now_ms_max       bigint;
  _len              integer;
  _idx              integer;
  _entity           jsonb;
  _type             text;
  _id               text;
  _cuam             bigint;
  _fields           jsonb;
  _ok_payload       jsonb;
begin
  if auth.uid() is not null and (auth.jwt()->>'client_id') is null then
    perform app_public.require_sync_protocol();
  end if;
  -- 1a. Auth precondition. RLS would block the writes regardless, but
  -- without auth.uid() the row-default for owner_user_id resolves to NULL
  -- and the immutability trigger explicitly refuses NULL auth (§A.6.3).
  -- Short-circuit here so the client gets a clear AUTH_REQUIRED token
  -- rather than a downstream NOT NULL / RLS message.
  _uid := auth.uid();
  if _uid is null then
    raise exception 'AUTH_REQUIRED: sync_push requires an authenticated user'
      using errcode = 'P0001';
  end if;

  -- 1b. Structural validation only (§A.1, §B.2.2). The schema-drift checker
  -- catches schema-level malformation at PR time.
  if _entities is null or jsonb_typeof(_entities) <> 'array' then
    raise exception 'INTERNAL: sync_push entities must be a JSON array'
      using errcode = 'P0001';
  end if;

  _len := jsonb_array_length(_entities);
  if _len < 1 or _len > 200 then
    raise exception
      'INTERNAL: sync_push entities length must be 1..200, got %', _len
      using errcode = 'P0001';
  end if;

  -- 1c. Capture a single now() for the entire transaction (§B.3.5).
  -- server_received_at on every upserted row uses this same value, and the
  -- success response echoes it back to the client.
  _now_tstz   := now();
  _now_ms_max := (extract(epoch from _now_tstz) * 1000)::bigint + 5 * 60 * 1000;

  -- 1d. Defer all FKs for the duration of this transaction (§B.3.2). The
  -- caller may push a child row before its parent inside the same batch;
  -- closure is checked at SET CONSTRAINTS ALL IMMEDIATE below.
  set constraints all deferred;

  -- 1e. Dispatch per entity. Per §A.1.1.1: LWW upsert on (owner_user_id,
  -- id) — overwrite every column in `fields` (including deleted_at) when
  -- incoming.client_updated_at_ms > stored.client_updated_at_ms; no-op
  -- otherwise. Future-clock clamp on client_updated_at_ms per §A.1.
  -- Block-attachment arbitration (session-planning contract 4.5): a unique
  -- violation on a provenance partial unique index is a competing claim the
  -- server already committed first. Fail the whole atomic batch with the
  -- wire-stable BLOCK_ALREADY_ATTACHED token (P0001) instead of a bare 23505,
  -- so the loser device can classify it, pull the winner, clear its losing
  -- provenance deterministically, and re-push. Server commit order is the
  -- only tiebreak; any other unique violation re-raises unchanged.
  begin
  for _idx in 0 .. _len - 1 loop
    _entity := _entities -> _idx;

    -- structural extraction; missing keys come out as NULL and the per-type
    -- typed INSERTs will surface the appropriate not-null / FK error.
    _type   := _entity ->> 'type';
    _id     := _entity ->> 'id';
    _cuam   := least(
                 (_entity ->> 'client_updated_at_ms')::bigint,
                 _now_ms_max
               );
    _fields := _entity -> 'fields';

    if _type = 'gyms' then
      insert into app_public.gyms (
        owner_user_id, id,
        name, latitude, longitude, coordinate_accuracy_m, coordinates_updated_at,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        (_fields ->> 'latitude')::double precision,
        (_fields ->> 'longitude')::double precision,
        (_fields ->> 'coordinate_accuracy_m')::double precision,
        (_fields ->> 'coordinates_updated_at')::bigint,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                   = excluded.name,
            latitude               = excluded.latitude,
            longitude              = excluded.longitude,
            coordinate_accuracy_m  = excluded.coordinate_accuracy_m,
            coordinates_updated_at = excluded.coordinates_updated_at,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.gyms.client_updated_at_ms;

    elsif _type = 'exercise_definitions' then
      insert into app_public.exercise_definitions (
        owner_user_id,id,name,load_input_mode,bodyweight_contribution,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'name',_fields->>'load_input_mode',
        (_fields->>'bodyweight_contribution')::double precision,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        name=excluded.name,load_input_mode=excluded.load_input_mode,
        bodyweight_contribution=excluded.bodyweight_contribution,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.exercise_definitions.client_updated_at_ms;

    elsif _type = 'muscle_groups' then
      insert into app_public.muscle_groups (
        owner_user_id, id,
        display_name, family_name, sort_order, is_editable,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'display_name',
        _fields ->> 'family_name',
        (_fields ->> 'sort_order')::integer,
        (_fields ->> 'is_editable')::integer,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set display_name         = excluded.display_name,
            family_name          = excluded.family_name,
            sort_order           = excluded.sort_order,
            is_editable          = excluded.is_editable,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.muscle_groups.client_updated_at_ms;

    elsif _type = 'exercise_tag_definitions' then
      insert into app_public.exercise_tag_definitions (
        owner_user_id, id,
        exercise_definition_id, name, normalized_name,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'exercise_definition_id',
        _fields ->> 'name',
        _fields ->> 'normalized_name',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set exercise_definition_id = excluded.exercise_definition_id,
            name                   = excluded.name,
            normalized_name        = excluded.normalized_name,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_tag_definitions.client_updated_at_ms;

    elsif _type = 'sessions' then
      insert into app_public.sessions (
        owner_user_id, id,
        gym_id, source_plan_id, status, started_at, completed_at, duration_sec,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'gym_id',
        _fields ->> 'source_plan_id',
        _fields ->> 'status',
        (_fields ->> 'started_at')::bigint,
        (_fields ->> 'completed_at')::bigint,
        (_fields ->> 'duration_sec')::integer,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set gym_id               = excluded.gym_id,
            source_plan_id       = excluded.source_plan_id,
            status               = excluded.status,
            started_at           = excluded.started_at,
            completed_at         = excluded.completed_at,
            duration_sec         = excluded.duration_sec,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.sessions.client_updated_at_ms;

    elsif _type = 'exercise_muscle_mappings' then
      insert into app_public.exercise_muscle_mappings (
        owner_user_id, id,
        exercise_definition_id, muscle_group_id, weight, role,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'exercise_definition_id',
        _fields ->> 'muscle_group_id',
        (_fields ->> 'weight')::double precision,
        _fields ->> 'role',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set exercise_definition_id = excluded.exercise_definition_id,
            muscle_group_id        = excluded.muscle_group_id,
            weight                 = excluded.weight,
            role                   = excluded.role,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_muscle_mappings.client_updated_at_ms;

    elsif _type = 'session_exercises' then
      insert into app_public.session_exercises (
        owner_user_id, id,
        session_id, exercise_definition_id, source_plan_exercise_id, order_index, name, machine_name,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_id',
        _fields ->> 'exercise_definition_id',
        _fields ->> 'source_plan_exercise_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'name',
        _fields ->> 'machine_name',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_id             = excluded.session_id,
            exercise_definition_id = excluded.exercise_definition_id,
            source_plan_exercise_id = excluded.source_plan_exercise_id,
            order_index            = excluded.order_index,
            name                   = excluded.name,
            machine_name           = excluded.machine_name,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_exercises.client_updated_at_ms;

    elsif _type = 'exercise_sets' then
      insert into app_public.exercise_sets (
        owner_user_id,id,session_exercise_id,source_plan_set_id,order_index,weight_value,reps_value,set_type,
        planned_weight_value,planned_reps_value,planned_set_type,performance_status,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'session_exercise_id',_fields->>'source_plan_set_id',(_fields->>'order_index')::integer,
        coalesce(_fields->>'weight_value',''),coalesce(_fields->>'reps_value',''),_fields->>'set_type',
        _fields->>'planned_weight_value',_fields->>'planned_reps_value',_fields->>'planned_set_type',
        _fields->>'performance_status',(_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        session_exercise_id=excluded.session_exercise_id,source_plan_set_id=excluded.source_plan_set_id,order_index=excluded.order_index,
        weight_value=excluded.weight_value,reps_value=excluded.reps_value,set_type=excluded.set_type,
        planned_weight_value=excluded.planned_weight_value,planned_reps_value=excluded.planned_reps_value,
        planned_set_type=excluded.planned_set_type,performance_status=excluded.performance_status,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.exercise_sets.client_updated_at_ms;

    elsif _type = 'session_exercise_tags' then
      insert into app_public.session_exercise_tags (
        owner_user_id, id,
        session_exercise_id, exercise_tag_definition_id,
        created_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_exercise_id',
        _fields ->> 'exercise_tag_definition_id',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_exercise_id        = excluded.session_exercise_id,
            exercise_tag_definition_id = excluded.exercise_tag_definition_id,
            created_at                 = excluded.created_at,
            deleted_at                 = excluded.deleted_at,
            client_updated_at_ms       = excluded.client_updated_at_ms,
            server_received_at         = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_exercise_tags.client_updated_at_ms;

    elsif _type = 'exercise_group_links' then
      insert into app_public.exercise_group_links (
        owner_user_id, id,
        exercise_definition_id, group_id, group_exercise_id,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'exercise_definition_id',
        _fields ->> 'group_id',
        _fields ->> 'group_exercise_id',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set exercise_definition_id = excluded.exercise_definition_id,
            group_id               = excluded.group_id,
            group_exercise_id      = excluded.group_exercise_id,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_group_links.client_updated_at_ms;

    elsif _type = 'user_settings' then
      insert into app_public.user_settings(
        owner_user_id,id,bodyweight_calculations_enabled,created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,(_fields->>'bodyweight_calculations_enabled')::boolean,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        bodyweight_calculations_enabled=excluded.bodyweight_calculations_enabled,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.user_settings.client_updated_at_ms;

    elsif _type = 'body_weight_measurements' then
      insert into app_public.body_weight_measurements (
        owner_user_id,id,weight_kg,measured_at,created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,(_fields->>'weight_kg')::double precision,(_fields->>'measured_at')::bigint,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        weight_kg=excluded.weight_kg,measured_at=excluded.measured_at,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.body_weight_measurements.client_updated_at_ms;

    elsif _type = 'training_programmes' then
      insert into app_public.training_programmes (
        owner_user_id, id, name, description,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        _fields ->> 'description',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                 = excluded.name,
            description          = excluded.description,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.training_programmes.client_updated_at_ms;

    elsif _type = 'session_plans' then
      insert into app_public.session_plans (
        owner_user_id, id,
        programme_id, programme_order_index, gym_id, title, scheduled_for, provenance,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'programme_id',
        (_fields ->> 'programme_order_index')::integer,
        _fields ->> 'gym_id',
        _fields ->> 'title',
        (_fields ->> 'scheduled_for')::bigint,
        coalesce(_fields ->> 'provenance', 'human'),
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set programme_id          = excluded.programme_id,
            programme_order_index = excluded.programme_order_index,
            gym_id                = excluded.gym_id,
            title                 = excluded.title,
            scheduled_for         = excluded.scheduled_for,
            provenance            = excluded.provenance,
            created_at            = excluded.created_at,
            updated_at            = excluded.updated_at,
            deleted_at            = excluded.deleted_at,
            client_updated_at_ms  = excluded.client_updated_at_ms,
            server_received_at    = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plans.client_updated_at_ms;

    elsif _type = 'session_plan_exercises' then
      insert into app_public.session_plan_exercises (
        owner_user_id, id,
        session_plan_id, exercise_definition_id, order_index, name, machine_name,
        progress_status, resolved_at,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_plan_id',
        _fields ->> 'exercise_definition_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'name',
        _fields ->> 'machine_name',
        coalesce(_fields ->> 'progress_status', 'pending'),
        (_fields ->> 'resolved_at')::bigint,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_plan_id        = excluded.session_plan_id,
            exercise_definition_id = excluded.exercise_definition_id,
            order_index            = excluded.order_index,
            name                   = excluded.name,
            machine_name           = excluded.machine_name,
            progress_status        = excluded.progress_status,
            resolved_at            = excluded.resolved_at,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plan_exercises.client_updated_at_ms;

    elsif _type = 'session_plan_sets' then
      insert into app_public.session_plan_sets (
        owner_user_id, id,
        session_plan_exercise_id, order_index, target_weight_value, target_reps, target_set_type,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_plan_exercise_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'target_weight_value',
        (_fields ->> 'target_reps')::integer,
        _fields ->> 'target_set_type',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_plan_exercise_id = excluded.session_plan_exercise_id,
            order_index              = excluded.order_index,
            target_weight_value      = excluded.target_weight_value,
            target_reps              = excluded.target_reps,
            target_set_type          = excluded.target_set_type,
            created_at               = excluded.created_at,
            updated_at               = excluded.updated_at,
            deleted_at               = excluded.deleted_at,
            client_updated_at_ms     = excluded.client_updated_at_ms,
            server_received_at       = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plan_sets.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %', coalesce(_type, '<null>')
        using errcode = 'P0001';
    end if;
  end loop;
  exception
    when unique_violation then
      if sqlerrm like '%owner_source_block_unique%'
         or sqlerrm like '%owner_source_set_unique%'
         or sqlerrm like '%owner_source_plan_unique%' then
        raise exception 'BLOCK_ALREADY_ATTACHED: %', sqlerrm using errcode = 'P0001';
      end if;
      raise;
  end;

  -- 1f. Force FK closure check before function return so we can re-raise as
  -- FK_VIOLATION. Without this, FK failures surface at the post-function
  -- COMMIT and the message would carry the native 23503 sqlstate without
  -- our FK_VIOLATION token. The transaction still rolls back end-to-end on
  -- failure — IMMEDIATE checks every deferred constraint right here.
  begin
    set constraints all immediate;
  exception
    when foreign_key_violation then
      raise exception 'FK_VIOLATION: %', sqlerrm using errcode = 'P0001';
  end;

  -- 1g. Success ack (§B.3.5). server_received_at is the ISO-8601 string of
  -- the captured _now_tstz; the client uses it for observability only.
  _ok_payload := jsonb_build_object(
    'ok', true,
    'server_received_at', to_char(_now_tstz at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return _ok_payload;
end;
$function$
