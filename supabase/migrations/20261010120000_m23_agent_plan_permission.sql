-- =============================================================================
-- Agent plan permission and atomic plan-write API.
--
-- Adds two app-owned, non-sync control tables and the service-role-only atomic
-- functions the agent API uses to create plans and programmes:
--
--   public.agent_plan_permissions   default-denied, current-grant-bound,
--                                   per-connected-client plan permission.
--   public.agent_plan_write_receipts  idempotency receipts for agent plan
--                                   writes (hash + emitted IDs, no payload).
--
-- The base OAuth grant stays read-only. A coaching client may read the
-- upcoming plan queue and create new plans/programmes only while an explicit
-- permission row matches the live grant. Agents can never edit/delete plans,
-- start workouts, or mutate performed history.
--
-- Authoritative references:
--   docs/specs/tech/session-planning-contract.md §2.3, §6
--   docs/specs/10-api-authn-authz-guidelines.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permission table. One row per connected coaching client; the app owns it.
-- -----------------------------------------------------------------------------

create table if not exists public.agent_plan_permissions (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  plan_access_enabled boolean not null default false,
  granted_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_plan_permissions_pkey primary key (owner_user_id, client_id),
  constraint agent_plan_permissions_client_non_empty
    check (length(btrim(client_id)) between 1 and 200)
);

comment on table public.agent_plan_permissions is
  'App-owned, default-denied plan permission for one connected OAuth client. A request is allowed only when plan_access_enabled is true and granted_at matches the live OAuth grant timestamp.';
comment on column public.agent_plan_permissions.granted_at is
  'The OAuth grant granted_at the enable belongs to. Re-authorizing a client yields a new value, so an old enable never revives.';

create or replace function public.agent_plan_permissions_touch_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$func$;
revoke all on function public.agent_plan_permissions_touch_updated_at() from public, anon, authenticated;

drop trigger if exists agent_plan_permissions_touch_updated_at on public.agent_plan_permissions;
create trigger agent_plan_permissions_touch_updated_at
  before update on public.agent_plan_permissions
  for each row when (new is distinct from old)
  execute function public.agent_plan_permissions_touch_updated_at();

alter table public.agent_plan_permissions enable row level security;

revoke all on table public.agent_plan_permissions from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_plan_permissions to authenticated, service_role;

-- Normal app sessions (no client_id) read/write only their own rows; an OAuth
-- agent token is denied by the restrictive companion policy.
create policy agent_plan_permissions_owner_select on public.agent_plan_permissions
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy agent_plan_permissions_owner_insert on public.agent_plan_permissions
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy agent_plan_permissions_owner_update on public.agent_plan_permissions
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy agent_plan_permissions_owner_delete on public.agent_plan_permissions
  for delete to authenticated using (owner_user_id = (select auth.uid()));
create policy agent_plan_permissions_direct_app_only on public.agent_plan_permissions
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

-- -----------------------------------------------------------------------------
-- 2. Idempotency receipts. Service-role only; never stores a training payload.
-- -----------------------------------------------------------------------------

create table if not exists public.agent_plan_write_receipts (
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  operation text not null,
  idempotency_key text not null,
  payload_sha256 text not null,
  result_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_plan_write_receipts_pkey
    primary key (owner_user_id, client_id, operation, idempotency_key),
  constraint agent_plan_write_receipts_operation_valid
    check (operation in ('create_session_plan', 'create_training_programme')),
  constraint agent_plan_write_receipts_client_non_empty
    check (length(btrim(client_id)) between 1 and 200),
  constraint agent_plan_write_receipts_key_length
    check (length(idempotency_key) between 1 and 128),
  constraint agent_plan_write_receipts_hash_length
    check (length(payload_sha256) = 64)
);

comment on table public.agent_plan_write_receipts is
  'Service-role-only idempotency receipts for agent plan writes: a payload hash and the emitted entity IDs, never the training payload.';
comment on column public.agent_plan_write_receipts.payload_sha256 is
  'Lowercase SHA-256 of the normalized request payload. Same key + same hash replays the original result; a different hash is IDEMPOTENCY_CONFLICT.';

alter table public.agent_plan_write_receipts enable row level security;

revoke all on table public.agent_plan_write_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_plan_write_receipts to service_role;

-- -----------------------------------------------------------------------------
-- 3. Service-role-only atomic graph writer.
--
-- The Edge Function validates the strict wire schema and owner identity before
-- calling this. The function re-checks every referenced owner row, inserts the
-- whole plan graph (all blocks pending, provenance agent), and never touches
-- the performed session/exercise/set graph.
-- -----------------------------------------------------------------------------

create function app_public.agent_insert_plan_graph(
  p_owner uuid,
  p_plan_id text,
  p_programme_id text,
  p_programme_order_index integer,
  p_plan jsonb,
  p_now_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _gym_id         text;
  _exercise       jsonb;
  _set            jsonb;
  _exercise_def   text;
  _exercise_id    text;
  _set_id         text;
  _exercise_ids   jsonb := '[]'::jsonb;
  _set_ids        jsonb := '[]'::jsonb;
  _exercise_index integer := 0;
  _set_index      integer;
begin
  _gym_id := nullif(p_plan ->> 'gym_id', '');
  if _gym_id is not null and not exists (
    select 1 from app_public.gyms g
     where g.owner_user_id = p_owner and g.id = _gym_id and g.deleted_at is null
  ) then
    raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
  end if;

  insert into app_public.session_plans (
    owner_user_id, id, programme_id, programme_order_index, gym_id, title,
    scheduled_for, provenance,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, p_plan_id, p_programme_id, p_programme_order_index, _gym_id,
    p_plan ->> 'title',
    nullif(p_plan ->> 'scheduled_for', '')::bigint,
    'agent',
    p_now_ms, p_now_ms, null, p_now_ms, timezone('utc', now())
  );

  for _exercise in select value from jsonb_array_elements(coalesce(p_plan -> 'exercises', '[]'::jsonb)) loop
    _exercise_def := nullif(_exercise ->> 'exercise_definition_id', '');
    if _exercise_def is not null and not exists (
      select 1 from app_public.exercise_definitions d
       where d.owner_user_id = p_owner and d.id = _exercise_def and d.deleted_at is null
    ) then
      raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
    end if;

    _exercise_id := gen_random_uuid()::text;
    insert into app_public.session_plan_exercises (
      owner_user_id, id, session_plan_id, exercise_definition_id, order_index, name,
      progress_status, resolved_at,
      created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
    ) values (
      p_owner, _exercise_id, p_plan_id, _exercise_def, _exercise_index,
      _exercise ->> 'name',
      'pending', null,
      p_now_ms, p_now_ms, null, p_now_ms, timezone('utc', now())
    );
    _exercise_ids := _exercise_ids || to_jsonb(_exercise_id);
    _exercise_index := _exercise_index + 1;

    _set_index := 0;
    for _set in select value from jsonb_array_elements(coalesce(_exercise -> 'sets', '[]'::jsonb)) loop
      _set_id := gen_random_uuid()::text;
      insert into app_public.session_plan_sets (
        owner_user_id, id, session_plan_exercise_id, order_index,
        target_weight_value, target_reps, target_set_type,
        created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
      ) values (
        p_owner, _set_id, _exercise_id, _set_index,
        nullif(_set ->> 'target_weight_value', ''),
        (_set ->> 'target_reps')::integer,
        nullif(_set ->> 'target_set_type', ''),
        p_now_ms, p_now_ms, null, p_now_ms, timezone('utc', now())
      );
      _set_ids := _set_ids || to_jsonb(_set_id);
      _set_index := _set_index + 1;
    end loop;
  end loop;

  return jsonb_build_object('exercise_ids', _exercise_ids, 'set_ids', _set_ids);
end;
$func$;

revoke all on function app_public.agent_insert_plan_graph(uuid, text, text, integer, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function app_public.agent_insert_plan_graph(uuid, text, text, integer, jsonb, bigint)
  to service_role;

-- -----------------------------------------------------------------------------
-- 4. create_session_plan.
-- -----------------------------------------------------------------------------

create function app_public.agent_create_session_plan(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation     text := 'create_session_plan';
  _now_ms        bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  _existing_hash text;
  _existing      jsonb;
  _plan_id       text := gen_random_uuid()::text;
  _graph         jsonb;
  _result        jsonb;
begin
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 1
     or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  -- Claim the key first. A concurrent same-key call waits here, then replays.
  insert into public.agent_plan_write_receipts (
    owner_user_id, client_id, operation, idempotency_key, payload_sha256, result_ids
  ) values (
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256, '{}'::jsonb
  )
  on conflict (owner_user_id, client_id, operation, idempotency_key) do nothing;

  if not found then
    select r.payload_sha256, r.result_ids
      into _existing_hash, _existing
      from public.agent_plan_write_receipts r
     where r.owner_user_id = p_owner
       and r.client_id = p_client_id
       and r.operation = _operation
       and r.idempotency_key = p_idempotency_key;
    if _existing_hash is distinct from p_payload_sha256 then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return _existing || jsonb_build_object('idempotent_replay', true);
  end if;

  _graph := app_public.agent_insert_plan_graph(
    p_owner, _plan_id, null, null, p_plan, _now_ms
  );

  _result := jsonb_build_object(
    'plan_id', _plan_id,
    'programme_id', null,
    'exercise_ids', _graph -> 'exercise_ids',
    'set_ids', _graph -> 'set_ids',
    'idempotent_replay', false
  );

  update public.agent_plan_write_receipts
     set result_ids = _result
   where owner_user_id = p_owner
     and client_id = p_client_id
     and operation = _operation
     and idempotency_key = p_idempotency_key;

  return _result;
end;
$func$;

revoke all on function app_public.agent_create_session_plan(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function app_public.agent_create_session_plan(uuid, text, text, text, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- 5. create_training_programme.
-- -----------------------------------------------------------------------------

create function app_public.agent_create_training_programme(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_programme jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation     text := 'create_training_programme';
  _now_ms        bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  _existing_hash text;
  _existing      jsonb;
  _programme_id  text := gen_random_uuid()::text;
  _plan          jsonb;
  _plan_id       text;
  _plan_ids      jsonb := '[]'::jsonb;
  _exercise_ids  jsonb := '[]'::jsonb;
  _set_ids       jsonb := '[]'::jsonb;
  _graph         jsonb;
  _plan_index    integer := 0;
  _result        jsonb;
begin
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 1
     or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  insert into public.agent_plan_write_receipts (
    owner_user_id, client_id, operation, idempotency_key, payload_sha256, result_ids
  ) values (
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256, '{}'::jsonb
  )
  on conflict (owner_user_id, client_id, operation, idempotency_key) do nothing;

  if not found then
    select r.payload_sha256, r.result_ids
      into _existing_hash, _existing
      from public.agent_plan_write_receipts r
     where r.owner_user_id = p_owner
       and r.client_id = p_client_id
       and r.operation = _operation
       and r.idempotency_key = p_idempotency_key;
    if _existing_hash is distinct from p_payload_sha256 then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return _existing || jsonb_build_object('idempotent_replay', true);
  end if;

  insert into app_public.training_programmes (
    owner_user_id, id, name, description,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, _programme_id, p_programme ->> 'name', nullif(p_programme ->> 'description', ''),
    _now_ms, _now_ms, null, _now_ms, timezone('utc', now())
  );

  for _plan in select value from jsonb_array_elements(coalesce(p_programme -> 'plans', '[]'::jsonb)) loop
    _plan_id := gen_random_uuid()::text;
    _graph := app_public.agent_insert_plan_graph(
      p_owner, _plan_id, _programme_id, _plan_index, _plan, _now_ms
    );
    _plan_ids := _plan_ids || to_jsonb(_plan_id);
    _exercise_ids := _exercise_ids || (_graph -> 'exercise_ids');
    _set_ids := _set_ids || (_graph -> 'set_ids');
    _plan_index := _plan_index + 1;
  end loop;

  _result := jsonb_build_object(
    'programme_id', _programme_id,
    'plan_ids', _plan_ids,
    'exercise_ids', _exercise_ids,
    'set_ids', _set_ids,
    'idempotent_replay', false
  );

  update public.agent_plan_write_receipts
     set result_ids = _result
   where owner_user_id = p_owner
     and client_id = p_client_id
     and operation = _operation
     and idempotency_key = p_idempotency_key;

  return _result;
end;
$func$;

revoke all on function app_public.agent_create_training_programme(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function app_public.agent_create_training_programme(uuid, text, text, text, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- 6. Developer wipe parity: control rows are owner-private and app-only.
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised    text;
begin
  select pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure) into definition;

  revised := replace(definition,
    $anchor$  delete from app_public.training_programmes where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.user_settings where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.training_programmes where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from public.agent_plan_permissions where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from public.agent_plan_write_receipts where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.user_settings where owner_user_id = _uid;$patch$);
  if revised = definition then
    raise exception 'The agent plan permission migration failed to patch dev_wipe_my_data';
  end if;

  execute revised;
end
$migration$;
