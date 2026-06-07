-- =============================================================================
-- Developer-only helper: dev_wipe_my_data().
--
-- Deletes every row owned by the calling user across all eight synced entity
-- tables, in a single transaction, and returns the total number of rows
-- removed. It backs the in-app "Wipe remote (my data)" developer affordance,
-- which exists so a developer can test the full bootstrap-from-empty-server
-- flow without standing up a fresh account.
--
-- Endpoint: POST /rest/v1/rpc/dev_wipe_my_data   (no arguments)
-- Returns:  bigint  (rows deleted across all entity tables)
--
-- Safety model (load-bearing):
--   - security definer + a fixed search_path so it runs with the owner's rights
--     and cannot be hijacked by a caller-set search_path. Unlike the
--     sync_push / sync_pull RPCs (which are security invoker so RLS scopes the
--     caller to their own rows), this helper bypasses RLS by design — so it
--     must scope the deletes itself with an explicit `owner_user_id = auth.uid()`
--     predicate on every table.
--   - Environment guard: refuses to run unless `app.env` is one of the
--     non-production values. If the setting is 'production', is unset, or is
--     any other value, the function raises a structured error and deletes
--     nothing. This is the hard stop that keeps a destructive developer tool
--     from ever firing against the production database.
--   - Auth guard: an unauthenticated caller (auth.uid() IS NULL) is refused
--     with the same AUTH_REQUIRED token shape the sync RPCs use, so the client
--     can pattern-match consistently.
--
-- The deletes run child-first to read cleanly; FKs are DEFERRABLE INITIALLY
-- DEFERRED so closure is only checked at the end of the function's
-- transaction, making the ordering a readability choice rather than a
-- correctness requirement.
-- =============================================================================

create or replace function app_public.dev_wipe_my_data()
returns bigint
language plpgsql
security definer
set search_path = app_public
as $func$
declare
  _uid     uuid;
  _env     text;
  _total   bigint := 0;
  _deleted bigint;
begin
  -- 1. Auth precondition. Without an authenticated user there is no owner to
  -- scope the deletes to; refuse loudly rather than silently delete nothing.
  _uid := auth.uid();
  if _uid is null then
    raise exception 'AUTH_REQUIRED: dev_wipe_my_data requires an authenticated user'
      using errcode = 'P0001';
  end if;

  -- 2. Environment guard. `current_setting('app.env', true)` returns NULL when
  -- the setting is absent; NULL is not in the permitted list, so an unset
  -- environment is treated as production and refused.
  _env := current_setting('app.env', true);
  if _env is null or _env not in ('local', 'staging', 'dev') then
    raise exception
      'FORBIDDEN_ENV: dev_wipe_my_data is disabled outside local/staging/dev (app.env=%)',
      coalesce(_env, '<unset>')
      using errcode = 'P0001';
  end if;

  -- 3. Delete every owned row, child tables first. Each statement's row count
  -- is summed so the caller learns exactly how many rows were removed.
  delete from app_public.session_exercise_tags where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_sets where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_exercises where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_muscle_mappings where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  -- muscle_groups after its child exercise_muscle_mappings (the mapping carries
  -- the composite FK into this table).
  delete from app_public.muscle_groups where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_tag_definitions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.sessions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_definitions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.gyms where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  return _total;
end;
$func$;

comment on function app_public.dev_wipe_my_data() is
  'Developer-only helper. Deletes every row owned by the caller across all entity tables in one transaction and returns the count. security definer; refuses to run unless app.env is local/staging/dev.';

-- -----------------------------------------------------------------------------
-- Grants. authenticated may call (the function body scopes deletes to the
-- caller's own rows and refuses outside non-production environments). anon is
-- granted so an unauthenticated caller surfaces the function-body
-- AUTH_REQUIRED token rather than a PostgREST-layer 42501. service_role keeps
-- execute for parity with the sync RPCs and for test setup.
-- -----------------------------------------------------------------------------
revoke all on function app_public.dev_wipe_my_data() from public;
grant execute on function app_public.dev_wipe_my_data() to anon;
grant execute on function app_public.dev_wipe_my_data() to authenticated;
grant execute on function app_public.dev_wipe_my_data() to service_role;
