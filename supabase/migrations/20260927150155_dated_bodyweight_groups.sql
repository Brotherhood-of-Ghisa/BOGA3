-- Coordinated breaking cutover. Release the compatibility client first.
-- This transaction guards old sync calls BEFORE removing stored session weight.
-- Readings remain private synced data; session weight is now a read projection.
create function app_public.require_dated_weight_protocol()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-sync-protocol','1');
begin
  if protocol !~ '^[0-9]{1,6}$' then
    raise exception 'UPDATE_REQUIRED: Update BoGa to continue syncing.' using errcode='P0001';
  end if;
  if protocol::integer < 2 then
    raise exception 'UPDATE_REQUIRED: Update BoGa to continue syncing.' using errcode='P0001';
  end if;
end;
$$;
revoke all on function app_public.require_dated_weight_protocol() from public;
grant execute on function app_public.require_dated_weight_protocol() to authenticated,service_role;

-- Latest nondeleted reading at the exact recorded start instant. The ID tie
-- uses binary/code-point order, independent of database or device locale.
create index body_weight_measurements_owner_as_of_idx on app_public.body_weight_measurements
  (owner_user_id, measured_at desc, id collate "C") where deleted_at is null;
create function app_public.session_weight_as_of(p_owner uuid,p_started_at bigint)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  reading app_public.body_weight_measurements;
  trim_chars constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  kg double precision;
  valid boolean := false;
  empty_context jsonb := jsonb_build_object('body_weight_kg',null,'body_weight_source',null,
    'body_weight_measurement_id',null,'body_weight_measured_at',null);
begin
  if p_started_at is null or abs(p_started_at::numeric)>8640000000000000 then return empty_context; end if;
  select * into reading from app_public.body_weight_measurements
    where owner_user_id=p_owner and deleted_at is null and measured_at<=p_started_at
    order by measured_at desc,id collate "C" asc limit 1;
  if not found then return empty_context; end if;
  -- Validation happens after selection. Never fall back past malformed context.
  begin
    if btrim(reading.id,trim_chars)<>'' and abs(reading.measured_at::numeric)<=8640000000000000
       and btrim(reading.weight_value,trim_chars) ~ '^[0-9]*[.]?[0-9]*$'
       and reading.weight_unit in ('kg','lb') then
      kg := btrim(reading.weight_value,trim_chars)::double precision * case when reading.weight_unit='lb' then 0.45359237 else 1 end;
      valid := kg>0 and kg<'Infinity'::double precision and reading.weight_kg>0
        and reading.weight_kg<'Infinity'::double precision
        and abs(kg-reading.weight_kg)<=3.552713678800501e-15*greatest(1,kg);
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then valid:=false;
  end;
  return jsonb_build_object('body_weight_kg',case when valid then reading.weight_kg else null end,
    'body_weight_source','reading','body_weight_measurement_id',reading.id,
    'body_weight_measured_at',reading.measured_at);
end;
$$;
revoke all on function app_public.session_weight_as_of(uuid,bigint) from public,anon,authenticated;
grant execute on function app_public.session_weight_as_of(uuid,bigint) to service_role;

-- The coaching API supplies only its already-authorized owner and selected
-- session IDs. No timeline or unrelated readings cross this service-only seam.
create function app_public.session_weight_contexts(p_owner uuid,p_session_ids text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id',s.id)||
    app_public.session_weight_as_of(s.owner_user_id,s.started_at) order by s.id),'[]'::jsonb)
  from app_public.sessions s where s.owner_user_id=p_owner and s.id=any(p_session_ids);
$$;
revoke all on function app_public.session_weight_contexts(uuid,text[]) from public,anon,authenticated;
grant execute on function app_public.session_weight_contexts(uuid,text[]) to service_role;


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
    perform app_public.require_dated_weight_protocol();
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
        owner_user_id, id,
        name, load_input_mode, bodyweight_coefficient, movement_standard, loading_method, created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        coalesce(_fields ->> 'load_input_mode', 'total_load'),
        case when _fields ? 'bodyweight_coefficient' then (_fields ->> 'bodyweight_coefficient')::double precision else 0 end,
        _fields ->> 'movement_standard',
        _fields ->> 'loading_method',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                 = excluded.name,
            bodyweight_coefficient = case when _fields ? 'bodyweight_coefficient' then excluded.bodyweight_coefficient
              else app_public.exercise_definitions.bodyweight_coefficient end,
            movement_standard = case when _fields ? 'movement_standard' then excluded.movement_standard
              else app_public.exercise_definitions.movement_standard end,
            loading_method = case when _fields ? 'loading_method' then excluded.loading_method
              else app_public.exercise_definitions.loading_method end,
            load_input_mode      = case
              when _fields ? 'load_input_mode' then excluded.load_input_mode
              else app_public.exercise_definitions.load_input_mode
            end,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_definitions.client_updated_at_ms;

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
        gym_id, status, started_at, completed_at, duration_sec,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'gym_id',
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
        session_id, exercise_definition_id, order_index, name, machine_name,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_id',
        _fields ->> 'exercise_definition_id',
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
        owner_user_id, id,
        session_exercise_id, order_index, weight_value, reps_value, set_type,
        planned_weight_value, planned_reps_value, planned_set_type, performance_status,
        weight_unit, external_load_mode, planned_weight_unit, planned_external_load_mode,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_exercise_id',
        (_fields ->> 'order_index')::integer,
        coalesce(_fields ->> 'weight_value', ''),
        coalesce(_fields ->> 'reps_value', ''),
        _fields ->> 'set_type',
        _fields ->> 'planned_weight_value',
        _fields ->> 'planned_reps_value',
        _fields ->> 'planned_set_type',
        _fields ->> 'performance_status',
        case when _fields ? 'weight_unit' then _fields ->> 'weight_unit' else 'kg' end,
        _fields ->> 'external_load_mode',
        _fields ->> 'planned_weight_unit',
        _fields ->> 'planned_external_load_mode',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_exercise_id  = excluded.session_exercise_id,
            order_index          = excluded.order_index,
            weight_value         = excluded.weight_value,
            reps_value           = excluded.reps_value,
            set_type             = excluded.set_type,
            planned_weight_value = excluded.planned_weight_value,
            planned_reps_value   = excluded.planned_reps_value,
            planned_set_type     = excluded.planned_set_type,
            weight_unit = case when _fields ? 'weight_unit' then excluded.weight_unit
              else app_public.exercise_sets.weight_unit end,
            external_load_mode = case when _fields ? 'external_load_mode' then excluded.external_load_mode
              else app_public.exercise_sets.external_load_mode end,
            planned_weight_unit = case when _fields ? 'planned_weight_unit' then excluded.planned_weight_unit
              else app_public.exercise_sets.planned_weight_unit end,
            planned_external_load_mode = case when _fields ? 'planned_external_load_mode' then excluded.planned_external_load_mode
              else app_public.exercise_sets.planned_external_load_mode end,
            performance_status   = excluded.performance_status,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_sets.client_updated_at_ms;

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

    elsif _type = 'body_weight_measurements' then
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
        'INTERNAL: sync_push unknown entity type %', coalesce(_type, '<null>')
        using errcode = 'P0001';
    end if;
  end loop;

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
$function$;


CREATE OR REPLACE FUNCTION app_public.sync_pull(jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  payload        jsonb := $1;
  v_layer        int;
  v_limit        int;
  v_cursor       jsonb;
  v_has_cursor   boolean;
  v_cursor_sra   timestamptz;
  v_cursor_owner uuid;
  v_cursor_type  text;
  v_cursor_id    text;
  v_types        text[];
  v_rows         jsonb;
  v_count        int;
  v_has_more     boolean;
  v_next_cursor  jsonb;
begin
  if auth.uid() is not null and (auth.jwt()->>'client_id') is null then
    perform app_public.require_dated_weight_protocol();
  end if;
  -- ---------------------------------------------------------------------------
  -- 1. Auth precondition.
  --
  -- security invoker + RLS would already deny the rows, but we want the
  -- AUTH_REQUIRED envelope (§B.2.2) rather than a silent empty response. An
  -- unauthenticated request still reaches this RPC body because the function
  -- is granted to `authenticated` AND the wider `anon` role talks to PostgREST
  -- with a no-JWT bearer; sub-claim absence shows up here as a NULL.
  -- ---------------------------------------------------------------------------
  if auth.uid() is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'AUTH_REQUIRED',
        'message', 'sync_pull requires an authenticated JWT'
      )
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- 2. Structural validation of `layer` and `limit`.
  --
  -- Per §B.2.2, the only error codes pull can emit are AUTH_REQUIRED and
  -- INTERNAL. Malformed payloads collapse to INTERNAL.
  -- ---------------------------------------------------------------------------
  if payload is null or jsonb_typeof(payload) <> 'object' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL',
        'message', 'sync_pull payload must be a JSON object'
      )
    );
  end if;

  -- layer: required integer in 0..3.
  if jsonb_typeof(payload->'layer') is distinct from 'number' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL',
        'message', 'sync_pull payload.layer must be an integer 0..3'
      )
    );
  end if;
  begin
    v_layer := (payload->>'layer')::int;
  exception when others then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL',
        'message', 'sync_pull payload.layer must be an integer 0..3'
      )
    );
  end;
  -- New entity types must never reach a legacy reader or its existing cursor.
  if v_layer < 0 or v_layer > 4 or
     (v_layer = 4 and not coalesce(
       jsonb_typeof(payload->'capabilities') = 'array' and
       (payload->'capabilities') ? 'bodyweight_v1', false
     )) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL',
        'message', 'sync_pull payload.layer must be an integer 0..3'
      )
    );
  end if;

  -- limit: optional integer in 1..200, defaults to 200.
  if (payload ? 'limit') and jsonb_typeof(payload->'limit') is not null
     and jsonb_typeof(payload->'limit') <> 'null' then
    if jsonb_typeof(payload->'limit') <> 'number' then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.limit must be an integer 1..200'
        )
      );
    end if;
    begin
      v_limit := (payload->>'limit')::int;
    exception when others then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.limit must be an integer 1..200'
        )
      );
    end;
    if v_limit < 1 or v_limit > 200 then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.limit must be an integer 1..200'
        )
      );
    end if;
  else
    v_limit := 200;
  end if;

  -- ---------------------------------------------------------------------------
  -- 3. Cursor validation.
  --
  -- Either JSON null / absent (snapshot pull) or an object with all four of
  -- (server_received_at, owner_user_id, type, id). `type` must be one of the
  -- entity-type strings — invalid types short-circuit with INTERNAL.
  -- ---------------------------------------------------------------------------
  v_cursor := payload->'cursor';
  if v_cursor is null or jsonb_typeof(v_cursor) = 'null' then
    v_has_cursor := false;
  elsif jsonb_typeof(v_cursor) = 'object' then
    if not (v_cursor ? 'server_received_at')
       or not (v_cursor ? 'owner_user_id')
       or not (v_cursor ? 'type')
       or not (v_cursor ? 'id') then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.cursor must contain server_received_at, owner_user_id, type, id'
        )
      );
    end if;
    begin
      v_cursor_sra   := (v_cursor->>'server_received_at')::timestamptz;
      v_cursor_owner := (v_cursor->>'owner_user_id')::uuid;
    exception when others then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.cursor has malformed server_received_at or owner_user_id'
        )
      );
    end;
    v_cursor_type := v_cursor->>'type';
    v_cursor_id   := v_cursor->>'id';
    if v_cursor_type is null or v_cursor_id is null then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.cursor.type and cursor.id must be strings'
        )
      );
    end if;
    if v_cursor_type not in (
      'gyms', 'exercise_definitions', 'muscle_groups',
      'exercise_tag_definitions', 'sessions', 'exercise_muscle_mappings',
      'session_exercises', 'exercise_sets', 'session_exercise_tags',
      'exercise_group_links', 'body_weight_measurements'
    ) then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'code', 'INTERNAL',
          'message', 'sync_pull payload.cursor.type is not a valid entity type'
        )
      );
    end if;
    v_has_cursor := true;
  else
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL',
        'message', 'sync_pull payload.cursor must be a JSON object or null'
      )
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- 4. Layer → entity types. Hardcoded per the topological partition in the
  -- server contract §B.4.4: exercise_tag_definitions lives in Layer 1, not
  -- Layer 0, because it FKs into exercise_definitions which is itself a Layer-0
  -- entity and §A.7.7 forbids intra-layer FKs.
  -- ---------------------------------------------------------------------------
  case v_layer
    when 0 then v_types := array['gyms', 'exercise_definitions', 'muscle_groups'];
    when 1 then v_types := array['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'];
    when 2 then v_types := array['session_exercises'];
    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];
    when 4 then v_types := array['body_weight_measurements'];
  end case;

  -- ---------------------------------------------------------------------------
  -- 5. Pull. One static UNION ALL spanning all entity tables, scoped to the
  -- requested layer by a literal-set `type IN (...)` filter realized via the
  -- `where type = any(v_types)` outer predicate. Per-entity SELECTs project
  -- the wire envelope shape directly (§B.2.1):
  --
  --   { type, id, client_updated_at_ms, fields, server_received_at,
  --     owner_user_id }
  --
  -- `server_received_at` and `owner_user_id` are kept on the projected row
  -- so the cursor logic at the bottom has access to them (the wire envelope
  -- drops `owner_user_id` and stitches `server_received_at` only into
  -- `next_cursor`).
  --
  -- The explicit `where owner_user_id = auth.uid()` on every leg keeps the
  -- planner on `<table>_owner_received_idx` per §A.2; RLS also enforces it.
  --
  -- `gyms` projects the four M15 carry-over coordinate columns
  -- (`latitude`, `longitude`, `coordinate_accuracy_m`, `coordinates_updated_at`)
  -- in addition to the §A.2.1 enumerated columns. These four are on the
  -- as-built `app_public.gyms` table because the client
  -- `apps/mobile/src/data/schema/gyms.ts` schema carries them and `sync_push`
  -- writes them, so pull must round-trip all four for symmetric behaviour.
  -- ---------------------------------------------------------------------------
  with all_rows as (
    select 'gyms'::text as type, g.id, g.client_updated_at_ms,
           g.server_received_at, g.owner_user_id,
           jsonb_build_object(
             'name', g.name,
             'latitude', g.latitude,
             'longitude', g.longitude,
             'coordinate_accuracy_m', g.coordinate_accuracy_m,
             'coordinates_updated_at', g.coordinates_updated_at,
             'created_at', g.created_at,
             'updated_at', g.updated_at,
             'deleted_at', g.deleted_at
           ) as fields
      from app_public.gyms g
     where g.owner_user_id = auth.uid()
       and 'gyms' = any(v_types)
    union all
    select 'exercise_definitions'::text, ed.id, ed.client_updated_at_ms,
           ed.server_received_at, ed.owner_user_id,
           jsonb_build_object(
             'name', ed.name,
             'load_input_mode', ed.load_input_mode,
             'bodyweight_coefficient', ed.bodyweight_coefficient,
             'movement_standard', ed.movement_standard,
             'loading_method', ed.loading_method,
             'created_at', ed.created_at,
             'updated_at', ed.updated_at,
             'deleted_at', ed.deleted_at
           )
      from app_public.exercise_definitions ed
     where ed.owner_user_id = auth.uid()
       and 'exercise_definitions' = any(v_types)
    union all
    select 'muscle_groups'::text, mg.id, mg.client_updated_at_ms,
           mg.server_received_at, mg.owner_user_id,
           jsonb_build_object(
             'display_name', mg.display_name,
             'family_name', mg.family_name,
             'sort_order', mg.sort_order,
             'is_editable', mg.is_editable,
             'created_at', mg.created_at,
             'updated_at', mg.updated_at,
             'deleted_at', mg.deleted_at
           )
      from app_public.muscle_groups mg
     where mg.owner_user_id = auth.uid()
       and 'muscle_groups' = any(v_types)
    union all
    select 'exercise_tag_definitions'::text, etd.id, etd.client_updated_at_ms,
           etd.server_received_at, etd.owner_user_id,
           jsonb_build_object(
             'exercise_definition_id', etd.exercise_definition_id,
             'name', etd.name,
             'normalized_name', etd.normalized_name,
             'created_at', etd.created_at,
             'updated_at', etd.updated_at,
             'deleted_at', etd.deleted_at
           )
      from app_public.exercise_tag_definitions etd
     where etd.owner_user_id = auth.uid()
       and 'exercise_tag_definitions' = any(v_types)
    union all
    select 'sessions'::text, s.id, s.client_updated_at_ms,
           s.server_received_at, s.owner_user_id,
           jsonb_build_object(
             'gym_id', s.gym_id,
             'status', s.status,
             'started_at', s.started_at,
             'completed_at', s.completed_at,
             'duration_sec', s.duration_sec,
             'created_at', s.created_at,
             'updated_at', s.updated_at,
             'deleted_at', s.deleted_at
           )
      from app_public.sessions s
     where s.owner_user_id = auth.uid()
       and 'sessions' = any(v_types)
    union all
    select 'exercise_muscle_mappings'::text, emm.id, emm.client_updated_at_ms,
           emm.server_received_at, emm.owner_user_id,
           jsonb_build_object(
             'exercise_definition_id', emm.exercise_definition_id,
             'muscle_group_id', emm.muscle_group_id,
             'weight', emm.weight,
             'role', emm.role,
             'created_at', emm.created_at,
             'updated_at', emm.updated_at,
             'deleted_at', emm.deleted_at
           )
      from app_public.exercise_muscle_mappings emm
     where emm.owner_user_id = auth.uid()
       and 'exercise_muscle_mappings' = any(v_types)
    union all
    select 'session_exercises'::text, sx.id, sx.client_updated_at_ms,
           sx.server_received_at, sx.owner_user_id,
           jsonb_build_object(
             'session_id', sx.session_id,
             'exercise_definition_id', sx.exercise_definition_id,
             'order_index', sx.order_index,
             'name', sx.name,
             'machine_name', sx.machine_name,
             'created_at', sx.created_at,
             'updated_at', sx.updated_at,
             'deleted_at', sx.deleted_at
           )
      from app_public.session_exercises sx
     where sx.owner_user_id = auth.uid()
       and 'session_exercises' = any(v_types)
    union all
    select 'exercise_sets'::text, es.id, es.client_updated_at_ms,
           es.server_received_at, es.owner_user_id,
           jsonb_build_object(
             'session_exercise_id', es.session_exercise_id,
             'order_index', es.order_index,
             'weight_value', es.weight_value,
             'reps_value', es.reps_value,
             'set_type', es.set_type,
             'planned_weight_value', es.planned_weight_value,
             'planned_reps_value', es.planned_reps_value,
             'planned_set_type', es.planned_set_type,
             'performance_status', es.performance_status,
             'weight_unit', es.weight_unit,
             'external_load_mode', es.external_load_mode,
             'planned_weight_unit', es.planned_weight_unit,
             'planned_external_load_mode', es.planned_external_load_mode,
             'created_at', es.created_at,
             'updated_at', es.updated_at,
             'deleted_at', es.deleted_at
           )
      from app_public.exercise_sets es
     where es.owner_user_id = auth.uid()
       and 'exercise_sets' = any(v_types)
    union all
    select 'session_exercise_tags'::text, st.id, st.client_updated_at_ms,
           st.server_received_at, st.owner_user_id,
           jsonb_build_object(
             'session_exercise_id', st.session_exercise_id,
             'exercise_tag_definition_id', st.exercise_tag_definition_id,
             'created_at', st.created_at,
             'deleted_at', st.deleted_at
           )
      from app_public.session_exercise_tags st
     where st.owner_user_id = auth.uid()
       and 'session_exercise_tags' = any(v_types)
    union all
    select 'exercise_group_links'::text, egl.id, egl.client_updated_at_ms,
           egl.server_received_at, egl.owner_user_id,
           jsonb_build_object(
             'exercise_definition_id', egl.exercise_definition_id,
             'group_id', egl.group_id,
             'group_exercise_id', egl.group_exercise_id,
             'created_at', egl.created_at,
             'updated_at', egl.updated_at,
             'deleted_at', egl.deleted_at
           )
      from app_public.exercise_group_links egl
     where egl.owner_user_id = auth.uid()
       and 'exercise_group_links' = any(v_types)
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
  ),
  paged as (
    select *
      from all_rows
     where (not v_has_cursor)
        or (server_received_at, owner_user_id, type, id)
           > (v_cursor_sra, v_cursor_owner, v_cursor_type, v_cursor_id)
     order by server_received_at asc,
              owner_user_id asc,
              type asc,
              id asc
     limit (v_limit + 1)
  )
  select coalesce(
           jsonb_agg(
             to_jsonb(p)
             order by p.server_received_at asc,
                      p.owner_user_id asc,
                      p.type asc,
                      p.id asc
           ),
           '[]'::jsonb
         ),
         count(*)::int
    into v_rows, v_count
    from paged p;

  -- ---------------------------------------------------------------------------
  -- 6. Compose response. Trim the (limit+1)th row when present, set has_more,
  -- compute next_cursor per §B.4.2.
  --
  -- v_rows currently holds up to (v_limit + 1) raw rows, each as a JSONB
  -- object with keys {type, id, client_updated_at_ms, server_received_at,
  -- owner_user_id, fields}. The cursor sort key fields are present on each
  -- row so we don't need to re-query the union after the LIMIT+1 sweep.
  --
  -- The emitted entity envelope (§B.2.1) strips owner_user_id and
  -- server_received_at (both are cursor concerns, not entity data).
  -- ---------------------------------------------------------------------------
  v_has_more := v_count > v_limit;

  -- v_keep_count: number of rows we actually emit (drop the (limit+1)th
  -- overshoot row when present). v_last_elem: the raw row at position
  -- v_keep_count in the union — its sort-key fields populate next_cursor.
  declare
    v_keep_count int := least(v_count, v_limit);
    v_last_elem  jsonb;
  begin
    -- Pull `next_cursor`'s source row (the last kept row in the v_rows array,
    -- 1-indexed at v_keep_count). We grab it BEFORE we strip the sort-key
    -- fields off the emitted entities.
    if v_keep_count > 0 then
      v_last_elem := (
        select elem
          from jsonb_array_elements(v_rows) with ordinality as t(elem, ord)
         where ord = v_keep_count
         limit 1
      );
      v_next_cursor := jsonb_build_object(
        'server_received_at', v_last_elem->'server_received_at',
        'owner_user_id', v_last_elem->'owner_user_id',
        'type', v_last_elem->'type',
        'id', v_last_elem->'id'
      );
    elsif v_has_cursor then
      -- Empty page on a cursored pull — echo input cursor unchanged per §B.4.2.
      -- We re-emit the parsed-cursor object (v_cursor) verbatim rather than
      -- rebuilding from its components so the client gets the same string
      -- back it sent in (no timezone-formatting drift).
      v_next_cursor := v_cursor;
    else
      -- Empty snapshot pull of a layer that holds no rows for this owner.
      -- The protocol treats this as "no cursor yet"; emit JSON null.
      v_next_cursor := 'null'::jsonb;
    end if;

    -- Strip sort-key fields off each emitted entity (§B.2.1: wire envelope
    -- carries type/id/client_updated_at_ms/fields only) and trim to
    -- v_keep_count.
    v_rows := (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'type', elem->'type',
          'id', elem->'id',
          'client_updated_at_ms', elem->'client_updated_at_ms',
          'fields', elem->'fields'
        ) order by ord
      ), '[]'::jsonb)
        from jsonb_array_elements(v_rows) with ordinality as t(elem, ord)
       where ord <= v_keep_count
    );
  end;

  return jsonb_build_object(
    'entities', v_rows,
    'next_cursor', coalesce(v_next_cursor, 'null'::jsonb),
    'has_more', v_has_more
  );
end;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_metric_performance_pin(p_metric text, p_set app_public.exercise_sets, p_session_exercise app_public.session_exercises, p_session app_public.sessions, p_definition app_public.exercise_definitions)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select case when p_metric in ('weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength')
    then encode(extensions.digest(jsonb_build_object(
      'pin_version', case when p_metric in ('relative_strength','absolute_strength') then 3 else 2 end, 'metric', p_metric,
      'source', jsonb_build_array(p_set.owner_user_id, p_set.id,
        p_session_exercise.id, p_session.id, p_definition.id),
      'external', jsonb_build_array(p_set.weight_value, p_set.weight_unit, p_set.external_load_mode),
      'performance', jsonb_build_array(p_set.reps_value, p_set.performance_status),
      'presence', jsonb_build_array(p_set.deleted_at, p_session_exercise.deleted_at, p_session.deleted_at),
      'convention', jsonb_build_array(p_definition.load_input_mode,
        p_definition.movement_standard, p_definition.loading_method),
      'body_weight', case when p_metric in ('relative_strength', 'absolute_strength')
        then app_public.session_weight_as_of(p_session.owner_user_id,p_session.started_at)
        else 'null'::jsonb end
    )::text,'sha256'),'hex') end;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_metric_eval_source_graph(p_group_id uuid, p_group_exercise_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with target as (
    select ge.* from app_public.group_exercises ge
    join app_public.groups g on g.id = ge.group_id
    where ge.id = p_group_exercise_id and ge.group_id = p_group_id
      and g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  ), members as (
    select gm.user_id as member_user_id, gm.id as membership_id
    from app_public.group_memberships gm, target t
    where gm.group_id = t.group_id and gm.ended_at is null
  ), links as (
    select l.owner_user_id as member_user_id, l.exercise_definition_id, l.updated_at
    from app_public.exercise_group_links l, target t
    where l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id) = t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id) = t.id
      and exists (select 1 from members m where m.member_user_id = l.owner_user_id)
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id', s.owner_user_id, 'session_id', s.id,
      'session_exercise_id', se.id, 'exercise_definition_id', se.exercise_definition_id,
      'set_id', es.id, 'weight_value', es.weight_value, 'weight_unit', es.weight_unit,
      'external_load_mode', es.external_load_mode, 'reps_value', es.reps_value,
      'performance_status', es.performance_status,
      'live', s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null,
      'counting', exists (select 1 from links l where l.member_user_id = s.owner_user_id
        and l.exercise_definition_id = se.exercise_definition_id),
      'source_load_input_mode', ed.load_input_mode,
      'movement_standard', ed.movement_standard, 'loading_method', ed.loading_method,
      'body_weight_kg', bw.context->'body_weight_kg', 'body_weight_source', bw.context->'body_weight_source',
      'body_weight_measurement_id', bw.context->'body_weight_measurement_id',
      'body_weight_measured_at_ms', bw.context->'body_weight_measured_at',
      'achieved_at_ms', s.started_at, 'exercise_order_index', se.order_index,
      'set_order_index', es.order_index, 'set_created_at_ms', es.created_at,
      -- Publication/event reconciliation also needs active/completed transitions
      -- in its source token, even though scoring does not depend on that status.
      'session_status', s.status,
      'fingerprints', jsonb_build_object(
        'weight', app_public.group_metric_performance_pin('weight', es, se, s, ed),
        'e1rm', app_public.group_metric_performance_pin('e1rm', es, se, s, ed),
        'bodyweight_reps', app_public.group_metric_performance_pin('bodyweight_reps', es, se, s, ed),
        'relative_strength', app_public.group_metric_performance_pin('relative_strength', es, se, s, ed),
        'absolute_strength', app_public.group_metric_performance_pin('absolute_strength', es, se, s, ed))
      ) as row, s.owner_user_id as member_user_id, es.id as set_id
    from target t
    join app_public.group_session_shares sh on sh.group_id = t.group_id
    join members m on m.member_user_id = sh.member_user_id
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
    cross join lateral (select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context) bw
    join app_public.session_exercises se on se.owner_user_id = s.owner_user_id and se.session_id = s.id
    join app_public.exercise_sets es on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id = se.owner_user_id and ed.id = se.exercise_definition_id
    -- Include unlinked shared sets: unlinking affects counting, not whether the
    -- observed set still stands for final-record/certification reconciliation.
  ), graph as (
    select jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.id,
      'calculation_revision','dated_readings_v2', 'name', t.name, 'rules', app_public.group_exercise_rules_json(row(t.*)::app_public.group_exercises),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
        'member_user_id', m.member_user_id, 'membership_id', m.membership_id,
        'links', coalesce((select jsonb_agg(jsonb_build_object(
          'exercise_definition_id', l.exercise_definition_id, 'updated_at_ms', l.updated_at)
          order by l.exercise_definition_id) from links l where l.member_user_id = m.member_user_id), '[]'::jsonb))
        order by m.member_user_id) from members m), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(ss.row order by ss.member_user_id, ss.set_id)
        from source_sets ss), '[]'::jsonb)) as value
    from target t
  ) select value || jsonb_build_object('source_token', encode(extensions.digest(value::text,'sha256'),'hex')) from graph;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_session_card_json(p_member uuid, p_session_id text, p_groups jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'kind', 'session',
    'key', p_member::text || ':' || p_session_id,
    'sort_at_ms', s.started_at,
    'member', app_public.group_member_ref_json(p_member),
    'session_id', p_session_id,
    'groups', p_groups,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member and g.id = s.gym_id and g.deleted_at is null
    ),
    'status', s.status,
    'started_at_ms', s.started_at,
    'completed_at_ms', s.completed_at,
    'duration_sec', s.duration_sec,
    'metric_scope','personal','metric_revision','dated_readings_v2',
    'body_weight_kg',bw.context->'body_weight_kg','body_weight_source',bw.context->'body_weight_source',
    'body_weight_measurement_id',bw.context->'body_weight_measurement_id',
    'body_weight_measured_at_ms',bw.context->'body_weight_measured_at',
    'exercises', app_public.group_session_exercises_json(p_member, p_session_id)
  )
  from app_public.sessions s
  cross join lateral (select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context) bw
  where s.owner_user_id = p_member and s.id = p_session_id;
$function$;


CREATE OR REPLACE FUNCTION app_public.group_session_detail(p_member_user_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _uid uuid := app_public.group_require_app_user();
  _s   record;
begin
  if not exists (
    select 1
      from app_public.group_session_shares sh
      join app_public.sessions s
        on s.owner_user_id = sh.member_user_id
       and s.id = sh.session_id
       and s.deleted_at is null
     where sh.member_user_id = p_member_user_id
       and sh.session_id = p_session_id
       and app_public.group_active_role(sh.group_id, _uid) is not null
  ) then
    raise exception 'NOT_FOUND: session not found'
      using errcode = 'P0001';
  end if;

  select x.gym_id,x.status,x.started_at,x.completed_at,x.duration_sec,
         app_public.session_weight_as_of(p_member_user_id,x.started_at) as body_weight
    into _s
    from app_public.sessions x
   where x.owner_user_id = p_member_user_id and x.id = p_session_id;

  return jsonb_build_object('session', jsonb_build_object(
    'member', app_public.group_member_ref_json(p_member_user_id),
    'session_id', p_session_id,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member_user_id and g.id = _s.gym_id and g.deleted_at is null
    ),
    'status', _s.status,
    'started_at_ms', _s.started_at,
    'completed_at_ms', _s.completed_at,
    'duration_sec', _s.duration_sec,
    'metric_scope','personal','metric_revision','dated_readings_v2',
    'body_weight_kg',_s.body_weight->'body_weight_kg','body_weight_source',_s.body_weight->'body_weight_source',
    'body_weight_measurement_id',_s.body_weight->'body_weight_measurement_id',
    'body_weight_measured_at_ms',_s.body_weight->'body_weight_measured_at',
    'exercises', app_public.group_session_exercises_json(p_member_user_id, p_session_id)
  ));
end;
$function$;


-- A reading mutation invalidates every shared session at/after either its old
-- or new timestamp. Conservatively including later-reading intervals is safe;
-- unchanged source pins and the existing recompute/diff path suppress events.
create function app_public.group_eval_on_body_weight_reading()
returns trigger language plpgsql security definer set search_path = app_public,pg_temp as $$
declare
  owner_id uuid;
  from_at bigint;
  target record;
  queued boolean := false;
  failure_code text;
begin
  owner_id := case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end;
  from_at := case when tg_op='INSERT' then new.measured_at when tg_op='DELETE' then old.measured_at
    else least(old.measured_at,new.measured_at) end;
  begin
    for target in select distinct s.id from app_public.sessions s
      join app_public.group_session_shares sh on sh.member_user_id=s.owner_user_id and sh.session_id=s.id
      where s.owner_user_id=owner_id and s.started_at>=from_at
    loop
      queued := app_public.group_eval_enqueue_session(owner_id,target.id,'set') or queued;
    end loop;
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed',owner_id,
      jsonb_build_object('table','body_weight_measurements','sqlstate',failure_code));
  end;
  if queued then perform app_public.group_eval_kick_once(owner_id); end if;
  return null;
end;
$$;
revoke all on function app_public.group_eval_on_body_weight_reading() from public,anon,authenticated,service_role;
create trigger body_weight_readings_group_eval_insert after insert or delete on app_public.body_weight_measurements
  for each row execute function app_public.group_eval_on_body_weight_reading();
create trigger body_weight_readings_group_eval_update after update on app_public.body_weight_measurements
  for each row when ((old.weight_value,old.weight_unit,old.weight_kg,old.measured_at,old.deleted_at)
    is distinct from (new.weight_value,new.weight_unit,new.weight_kg,new.measured_at,new.deleted_at))
  execute function app_public.group_eval_on_body_weight_reading();

alter table app_public.sessions drop column body_weight_kg, drop column body_weight_source,
  drop column body_weight_measurement_id, drop column body_weight_measured_at;

-- Rebuild active generic comparisons under the new source-token semantics.
-- Pins for reps/conventional metrics retain version 2; strength pins move to 3.
do $$ declare target record; begin
  for target in select ge.group_id,ge.id from app_public.group_exercises ge
    where ge.archived_at is null and not app_public.group_metric_is_legacy(ge.id)
  loop
    perform app_public.group_metric_eval_enqueue(target.group_id,target.id,'set');
  end loop;
end $$;
notify pgrst,'reload schema';
