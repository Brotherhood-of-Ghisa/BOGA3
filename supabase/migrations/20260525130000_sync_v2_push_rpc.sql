-- =============================================================================
-- Sync v2: sync_push RPC.
--
-- Implements t3 of docs/plans/sync-v2-server/plan.md, per the authoritative
-- designs at docs/plans/sync-v2/designs/{t1,t2}.md. Stack on top of t1's
-- clean-room migration (20260525120000_sync_v2_clean_room.sql).
--
-- Endpoint: POST /rest/v1/rpc/sync_push
-- Body:     {"entities": Entity[]}                       (per t2 §3.1)
-- Returns:  {"ok": true, "server_received_at": <iso>}    (per t2 §3.5)
--
-- Semantics (load-bearing per the designs):
--   - security invoker: RLS evaluates as the caller (t1 §6.2). NOT definer.
--   - Structural validation only (t1 §1, t2 §2.2): array shape, length 1..200,
--     auth.uid() non-null. No type/range/enum checks.
--   - Single transaction with SET CONSTRAINTS ALL DEFERRED (t2 §3.2). Per-row
--     LWW upsert into app_public.<entity>; FK closure re-checked at
--     SET CONSTRAINTS ALL IMMEDIATE before function return so we can raise a
--     FK_VIOLATION-shaped error inside the function body (PostgREST surfaces
--     errcode P0001 + message verbatim — see error-envelope notes below).
--   - LWW predicate (t1 §1.1.1): ON CONFLICT (owner_user_id, id) DO UPDATE
--     WHERE excluded.client_updated_at_ms > <table>.client_updated_at_ms.
--   - Future-clock clamp (t1 §1): least(incoming_cuam, now_ms() + 5*60*1000).
--   - Every typed column from `fields` is written verbatim on overwrite,
--     including deleted_at (t1 §1.1).
--   - Single now() per transaction (t2 §3.5): captured once at function entry
--     and re-used for server_received_at on every row in the batch.
--
-- Error envelope on failure:
--   PostgREST surfaces a raise exception as a JSON body with shape
--   {"code": "<errcode>", "message": "<msg>", "details": ..., "hint": ...}.
--   We don't write our own wrapper — t2 §2.2's envelope ({"error":{"code","message"}})
--   is the client-side contract; the message string carries the literal
--   "AUTH_REQUIRED" / "FK_VIOLATION" / "INTERNAL" token so the client can
--   pattern-match. Structural failures use errcode P0001 + an "INTERNAL: ..."
--   message. AUTH_REQUIRED uses P0001 + "AUTH_REQUIRED" message. FK closure
--   failures are caught from foreign_key_violation and re-raised as P0001 +
--   "FK_VIOLATION: ..." so the wire token is stable regardless of which FK
--   triggered.
--
-- Note on bigint serialization (t2 §1):
--   PostgREST (the Supabase-bundled version in this repo's CLI pin
--   2.76.x ships PostgREST >= 12) returns Postgres bigint values as JSON
--   integers, not strings, by default. epoch-ms < 2^53 fits safely in
--   JavaScript Number. No role-config change is required; we verify this in
--   the contract tests by asserting that client_updated_at_ms returns as a
--   number (jq's `type == "number"`) from a service-role SELECT of a stored
--   row, and that the sync_push response's server_received_at is a string
--   (the function explicitly returns an ISO-8601 string for that field per
--   t2 §3.5 "iso8601 with ms").
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The dispatch helper.
--
-- One private function per entity would balloon the migration without
-- meaningful benefit; instead the dispatch lives inside the main RPC as an
-- IF/ELSIF chain. The per-entity column lists below are the exact typed
-- columns from designs/t1.md §2 as built by the clean-room migration
-- (20260525120000_sync_v2_clean_room.sql) — the `gyms` branch includes
-- latitude/longitude/coordinate_accuracy_m/coordinates_updated_at per the
-- t1 PR's "Deviations from card" note (the v1 m15 migration added them and
-- the client Drizzle schema continues to carry them, so the v2 server
-- mirror keeps them; t1 §1 "server schema mirrors client").
-- ---------------------------------------------------------------------------

-- PostgREST dispatches RPC calls by mapping top-level JSON body keys to
-- named function parameters. The wire shape (t2 §3.1) is
-- {"entities": [...]} — so the parameter is named `entities`, and the body
-- key feeds directly into it. Default to '[]'::jsonb so a malformed call
-- with no `entities` key surfaces the structural error inside this body
-- (rather than a PostgREST "function not found" 404).
create or replace function app_public.sync_push(entities jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = app_public, public, extensions
as $func$
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
  -- 1a. Auth precondition. RLS would block the writes regardless, but
  -- without auth.uid() the row-default for owner_user_id resolves to NULL
  -- and the immutability trigger explicitly refuses NULL auth (t1 §6.3).
  -- Short-circuit here so the client gets a clear AUTH_REQUIRED token
  -- rather than a downstream NOT NULL / RLS message.
  _uid := auth.uid();
  if _uid is null then
    raise exception 'AUTH_REQUIRED: sync_push requires an authenticated user'
      using errcode = 'P0001';
  end if;

  -- 1b. Structural validation only (t1 §1, t2 §2.2). The drift checker (t2)
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

  -- 1c. Capture a single now() for the entire transaction (t2 §3.5).
  -- server_received_at on every upserted row uses this same value, and the
  -- success response echoes it back to the client.
  _now_tstz   := now();
  _now_ms_max := (extract(epoch from _now_tstz) * 1000)::bigint + 5 * 60 * 1000;

  -- 1d. Defer all FKs for the duration of this transaction (t2 §3.2). The
  -- caller may push a child row before its parent inside the same batch;
  -- closure is checked at SET CONSTRAINTS ALL IMMEDIATE below.
  set constraints all deferred;

  -- 1e. Dispatch per entity. Per t1 §1.1.1: LWW upsert on (owner_user_id,
  -- id) — overwrite every column in `fields` (including deleted_at) when
  -- incoming.client_updated_at_ms > stored.client_updated_at_ms; no-op
  -- otherwise. Future-clock clamp on client_updated_at_ms per t1 §1.
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
        name, created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                 = excluded.name,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_definitions.client_updated_at_ms;

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
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_exercise_id',
        (_fields ->> 'order_index')::integer,
        coalesce(_fields ->> 'weight_value', ''),
        coalesce(_fields ->> 'reps_value', ''),
        _fields ->> 'set_type',
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

  -- 1g. Success ack (t2 §3.5). server_received_at is the ISO-8601 string of
  -- the captured _now_tstz; the client uses it for observability only.
  _ok_payload := jsonb_build_object(
    'ok', true,
    'server_received_at', to_char(_now_tstz at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return _ok_payload;
end;
$func$;

comment on function app_public.sync_push(jsonb) is
  'Sync v2 push RPC. POST /rest/v1/rpc/sync_push. Batched LWW upsert with deferrable FKs. security invoker — RLS applies. See designs/t1.md §1.1 and designs/t2.md §3.';

-- ---------------------------------------------------------------------------
-- 2. Grants. authenticated may call; service_role bypasses RLS naturally.
-- anon is granted execute so that an unauthenticated caller surfaces the
-- function-body AUTH_REQUIRED token (t2 §2.2 wire contract) rather than a
-- PostgREST-layer "permission denied for function" 42501. RLS still blocks
-- any actual writes from anon — and the function body short-circuits on
-- auth.uid() IS NULL before reaching the upsert loop.
-- ---------------------------------------------------------------------------

revoke all on function app_public.sync_push(jsonb) from public;
grant execute on function app_public.sync_push(jsonb) to anon;
grant execute on function app_public.sync_push(jsonb) to authenticated;
grant execute on function app_public.sync_push(jsonb) to service_role;
