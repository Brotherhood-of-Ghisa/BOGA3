-- Workout set planned-vs-performed targets in sync scope.

alter table app_public.exercise_sets

  add column if not exists planned_weight_value text,

  add column if not exists planned_reps_value text,

  add column if not exists planned_set_type text,

  add column if not exists performance_status text;

-- =============================================================================
-- Sync v2: sync_push RPC.
--
-- Authoritative reference: docs/specs/tech/sync-v2-server-contract.md (Part B,
-- push/pull protocol, plus Part A server schema). Stacks on top of the
-- clean-room migration (20260525120000_sync_v2_clean_room.sql).
--
-- Endpoint: POST /rest/v1/rpc/sync_push
-- Body:     {"entities": Entity[]}                       (per §B.3.1)
-- Returns:  {"ok": true, "server_received_at": <iso>}    (per §B.3.5)
--
-- Semantics (load-bearing per the contract):
--   - security invoker: RLS evaluates as the caller (§A.6.2). NOT definer.
--   - Structural validation only (§A.1, §B.2.2): array shape, length 1..200,
--     auth.uid() non-null. No type/range/enum checks.
--   - Single transaction with SET CONSTRAINTS ALL DEFERRED (§B.3.2). Per-row
--     LWW upsert into app_public.<entity>; FK closure re-checked at
--     SET CONSTRAINTS ALL IMMEDIATE before function return so we can raise a
--     FK_VIOLATION-shaped error inside the function body (PostgREST surfaces
--     errcode P0001 + message verbatim — see error-envelope notes below).
--   - LWW predicate (§A.1.1.1): ON CONFLICT (owner_user_id, id) DO UPDATE
--     WHERE excluded.client_updated_at_ms > <table>.client_updated_at_ms.
--   - Future-clock clamp (§A.1): least(incoming_cuam, now_ms() + 5*60*1000).
--   - Every typed column from `fields` is written verbatim on overwrite,
--     including deleted_at (§A.1.1).
--   - Single now() per transaction (§B.3.5): captured once at function entry
--     and re-used for server_received_at on every row in the batch.
--
-- Error envelope on failure:
--   PostgREST surfaces a raise exception as a JSON body with shape
--   {"code": "<errcode>", "message": "<msg>", "details": ..., "hint": ...}.
--   We don't write our own wrapper — the §B.2.2 envelope ({"error":{"code","message"}})
--   is the client-side contract; the message string carries the literal
--   "AUTH_REQUIRED" / "FK_VIOLATION" / "INTERNAL" token so the client can
--   pattern-match. Structural failures use errcode P0001 + an "INTERNAL: ..."
--   message. AUTH_REQUIRED uses P0001 + "AUTH_REQUIRED" message. FK closure
--   failures are caught from foreign_key_violation and re-raised as P0001 +
--   "FK_VIOLATION: ..." so the wire token is stable regardless of which FK
--   triggered.
--
-- Note on bigint serialization (§B.1):
--   PostgREST (the Supabase-bundled version in this repo's CLI pin
--   2.76.x ships PostgREST >= 12) returns Postgres bigint values as JSON
--   integers, not strings, by default. epoch-ms < 2^53 fits safely in
--   JavaScript Number. No role-config change is required; we verify this in
--   the contract tests by asserting that client_updated_at_ms returns as a
--   number (jq's `type == "number"`) from a service-role SELECT of a stored
--   row, and that the sync_push response's server_received_at is a string
--   (the function explicitly returns an ISO-8601 string for that field per
--   §B.3.5 "iso8601 with ms").
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The dispatch helper.
--
-- One private function per entity would balloon the migration without
-- meaningful benefit; instead the dispatch lives inside the main RPC as an
-- IF/ELSIF chain. The per-entity column lists below are the exact typed
-- columns from the server contract §A.2 as built by the clean-room migration
-- (20260525120000_sync_v2_clean_room.sql) — the `gyms` branch includes
-- latitude/longitude/coordinate_accuracy_m/coordinates_updated_at because the
-- v1 m15 migration added them and the client Drizzle schema continues to carry
-- them, so the v2 server mirror keeps them (§A.1 "server schema mirrors
-- client").
-- ---------------------------------------------------------------------------

-- PostgREST dispatches RPC calls by mapping top-level JSON body keys to
-- named function parameters. The wire shape (§B.3.1) is
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
$func$;

comment on function app_public.sync_push(jsonb) is
  'Sync v2 push RPC. POST /rest/v1/rpc/sync_push. Batched LWW upsert with deferrable FKs. security invoker — RLS applies. See the server contract §A.1.1 and §B.3.';

-- ---------------------------------------------------------------------------
-- 2. Grants. authenticated may call; service_role bypasses RLS naturally.
-- anon is granted execute so that an unauthenticated caller surfaces the
-- function-body AUTH_REQUIRED token (§B.2.2 wire contract) rather than a
-- PostgREST-layer "permission denied for function" 42501. RLS still blocks
-- any actual writes from anon — and the function body short-circuits on
-- auth.uid() IS NULL before reaching the upsert loop.
-- ---------------------------------------------------------------------------

revoke all on function app_public.sync_push(jsonb) from public;
grant execute on function app_public.sync_push(jsonb) to anon;
grant execute on function app_public.sync_push(jsonb) to authenticated;
grant execute on function app_public.sync_push(jsonb) to service_role;

-- =============================================================================
-- Sync v2: sync_pull RPC.
--
-- Authoritative reference: docs/specs/tech/sync-v2-server-contract.md — §B.4
-- (request/response shape, cursor pagination, layer→type mapping) and §A.2
-- (per-entity column projections + the universal (owner_user_id,
-- server_received_at) index that the query is planned against).
--
-- Wire shape (per §B.4.1 / §B.4.2):
--
--   Request:  { layer: 0..3, cursor: null | <cursor object>, limit: 1..200 }
--   Response: { entities: Entity[], next_cursor: <cursor>, has_more: bool }
--
-- The function is `security invoker` so RLS applies — a caller can only ever
-- see rows where owner_user_id = auth.uid(). The explicit WHERE predicate is
-- belt-and-braces and pins the planner on <table>_owner_received_idx.
--
-- Layer→type mapping (the §A.7.7 "no intra-layer FK" invariant precludes
-- exercise_tag_definitions from sharing Layer 0 with exercise_definitions
-- because exercise_tag_definitions(exercise_definition_id) →
-- exercise_definitions(id) is a cross-entity FK):
--   0: gyms, exercise_definitions, muscle_groups
--   1: sessions, exercise_muscle_mappings, exercise_tag_definitions
--   2: session_exercises
--   3: exercise_sets, session_exercise_tags
--
-- Cursor semantics (§B.4.3): the eight-byte cursor `(server_received_at,
-- owner_user_id, type, id)` is used as a row-value `>` predicate so the next
-- pull strictly advances past the last-emitted row. Same-millisecond rows
-- inside one transaction share `server_received_at`; the lexicographic
-- tiebreak on `(owner_user_id, type, id)` gives every row a unique sort key.
--
-- KNOWN LIMITATION (acknowledged per §B.4.3): `server_received_at` is
-- stamped at INSERT/UPDATE time via the touch trigger or the column default,
-- which is BEFORE COMMIT. Two concurrent writes for the same owner can
-- commit in inverted order vs their `server_received_at` values; a pull
-- landing between the two commits can advance past the later-committed
-- value and skip the earlier one. The skip is self-healing — any subsequent
-- write to the missed row bumps `server_received_at` past the cursor. A
-- future hardening pass may switch the cursor axis to
-- `pg_xact_commit_timestamp(xmin)` (requires `track_commit_timestamp = on`).
-- This RPC does NOT solve that race.
-- =============================================================================

-- The parameter is intentionally UNNAMED. PostgREST's "single jsonb fallback"
-- (https://docs.postgrest.org/en/v14/references/api/functions.html) routes a
-- raw JSON body to a function with a single unnamed jsonb param when none of
-- the body's top-level keys match a named parameter. With a named param the
-- client would have to wrap the body as `{"<param-name>": {...}}`, which is
-- ergonomically painful for callers. Inside the body we refer to the param
-- as `_payload` via a `declare` alias.
create or replace function app_public.sync_pull(jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
  if v_layer < 0 or v_layer > 3 then
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
      'session_exercises', 'exercise_sets', 'session_exercise_tags'
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
    when 1 then v_types := array['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions'];
    when 2 then v_types := array['session_exercises'];
    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];
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
$$;

comment on function app_public.sync_pull(jsonb) is
  'Sync v2: per-layer cursor-paged pull. See the server contract §B.4. Returns up to `limit` typed rows from the requested topological layer ordered by (server_received_at, owner_user_id, type, id). security invoker so RLS scopes results to auth.uid().';

revoke all on function app_public.sync_pull(jsonb) from public;
grant execute on function app_public.sync_pull(jsonb) to authenticated;
grant execute on function app_public.sync_pull(jsonb) to service_role;
-- Grant to anon so the function is reachable for an unauthenticated request
-- and can emit the AUTH_REQUIRED error envelope (§B.2.2). Without this grant
-- PostgREST short-circuits with a generic 401/403; the v2 wire contract
-- requires the structured `{error:{code:"AUTH_REQUIRED"}}` body. RLS and the
-- explicit auth.uid()-is-null guard inside the function body together ensure
-- anon callers see zero rows even if they bypass the AUTH_REQUIRED check.
grant execute on function app_public.sync_pull(jsonb) to anon;
