-- =============================================================================
-- Sync v2: sync_pull RPC.
--
-- Implements t4 of docs/plans/sync-v2-server/plan.md, per the authoritative
-- design at docs/plans/sync-v2/designs/t2.md §4 (request/response shape,
-- cursor pagination, layer→type mapping) and t1.md §2 (per-entity column
-- projections + the universal (owner_user_id, server_received_at) index that
-- the query is planned against).
--
-- Wire shape (per t2 §4.1 / §4.2):
--
--   Request:  { layer: 0..3, cursor: null | <cursor object>, limit: 1..200 }
--   Response: { entities: Entity[], next_cursor: <cursor>, has_more: bool }
--
-- The function is `security invoker` so RLS applies — a caller can only ever
-- see rows where owner_user_id = auth.uid(). The explicit WHERE predicate is
-- belt-and-braces and pins the planner on <table>_owner_received_idx.
--
-- Layer→type mapping (t2 §4.4):
--   0: gyms, exercise_definitions, exercise_tag_definitions
--   1: sessions, exercise_muscle_mappings
--   2: session_exercises
--   3: exercise_sets, session_exercise_tags
--
-- Cursor semantics (t2 §4.3): the eight-byte cursor `(server_received_at,
-- owner_user_id, type, id)` is used as a row-value `>` predicate so the next
-- pull strictly advances past the last-emitted row. Same-millisecond rows
-- inside one transaction share `server_received_at`; the lexicographic
-- tiebreak on `(owner_user_id, type, id)` gives every row a unique sort key.
--
-- KNOWN LIMITATION (acknowledged per t2 §4.3): `server_received_at` is
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
  -- AUTH_REQUIRED envelope (t2 §2.2) rather than a silent empty response. An
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
  -- Per t2 §2.2, the only error codes pull can emit are AUTH_REQUIRED and
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
  -- eight entity-type strings — invalid types short-circuit with INTERNAL.
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
      'gyms', 'exercise_definitions', 'exercise_tag_definitions',
      'sessions', 'exercise_muscle_mappings', 'session_exercises',
      'exercise_sets', 'session_exercise_tags'
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
  -- 4. Layer → entity types (hardcoded, matches t2 §4.4 verbatim).
  -- ---------------------------------------------------------------------------
  case v_layer
    when 0 then v_types := array['gyms', 'exercise_definitions', 'exercise_tag_definitions'];
    when 1 then v_types := array['sessions', 'exercise_muscle_mappings'];
    when 2 then v_types := array['session_exercises'];
    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];
  end case;

  -- ---------------------------------------------------------------------------
  -- 5. Pull. One static UNION ALL spanning all eight tables, scoped to the
  -- requested layer by a literal-set `type IN (...)` filter realized via the
  -- `where type = any(v_types)` outer predicate. Per-entity SELECTs project
  -- the wire envelope shape directly (t2 §2.1):
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
  -- planner on `<table>_owner_received_idx` per t1 §2; RLS also enforces it.
  --
  -- `gyms` projects the four M15 carry-over coordinate columns
  -- (`latitude`, `longitude`, `coordinate_accuracy_m`, `coordinates_updated_at`)
  -- in addition to the t1 §2.1 enumerated columns. These four are on the
  -- as-built `app_public.gyms` table per the t1 PR #69 "Deviations from card"
  -- (the client `apps/mobile/src/data/schema/gyms.ts` schema carries them and
  -- t3's `sync_push` writes them, so pull must round-trip all four for
  -- symmetric behaviour). See plan.md "Deviations log".
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
  -- compute next_cursor per t2 §4.2.
  --
  -- v_rows currently holds up to (v_limit + 1) raw rows, each as a JSONB
  -- object with keys {type, id, client_updated_at_ms, server_received_at,
  -- owner_user_id, fields}. The cursor sort key fields are present on each
  -- row so we don't need to re-query the union after the LIMIT+1 sweep.
  --
  -- The emitted entity envelope (t2 §2.1) strips owner_user_id and
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
      -- Empty page on a cursored pull — echo input cursor unchanged per t2 §4.2.
      -- We re-emit the parsed-cursor object (v_cursor) verbatim rather than
      -- rebuilding from its components so the client gets the same string
      -- back it sent in (no timezone-formatting drift).
      v_next_cursor := v_cursor;
    else
      -- Empty snapshot pull of a layer that holds no rows for this owner.
      -- The protocol treats this as "no cursor yet"; emit JSON null.
      v_next_cursor := 'null'::jsonb;
    end if;

    -- Strip sort-key fields off each emitted entity (t2 §2.1: wire envelope
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
  'Sync v2: per-layer cursor-paged pull. See docs/plans/sync-v2/designs/t2.md §4. Returns up to `limit` typed rows from the requested topological layer ordered by (server_received_at, owner_user_id, type, id). security invoker so RLS scopes results to auth.uid().';

revoke all on function app_public.sync_pull(jsonb) from public;
grant execute on function app_public.sync_pull(jsonb) to authenticated;
grant execute on function app_public.sync_pull(jsonb) to service_role;
-- Grant to anon so the function is reachable for an unauthenticated request
-- and can emit the AUTH_REQUIRED error envelope (t2 §2.2). Without this grant
-- PostgREST short-circuits with a generic 401/403; the v2 wire contract
-- requires the structured `{error:{code:"AUTH_REQUIRED"}}` body. RLS and the
-- explicit auth.uid()-is-null guard inside the function body together ensure
-- anon callers see zero rows even if they bypass the AUTH_REQUIRED check.
grant execute on function app_public.sync_pull(jsonb) to anon;
