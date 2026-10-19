-- =============================================================================
-- Agent exercise editing.
--
-- A connected coaching client with write access (the app-owned
-- public.agent_plan_permissions switch, unchanged) may create, edit, soft
-- delete and restore the owner's exercise definitions and their muscle links.
-- Every write goes through one of the service-role-only functions below; the
-- agent token itself stays denied from every domain table.
--
-- Rows written here reach devices through the ordinary Sync v2 pull:
--   * the stamp is greatest(now, every stamp the exercise graph holds + 1), so
--     the write wins the server's LWW and every device's pull apply;
--   * a revived muscle link keeps its row; a new one takes the pair-derived id
--     map_<exercise>__<muscle>, the shape devices use, so two writers adding
--     the same link converge on one row.
-- Updates are revision-checked: the caller passes the exercise's
-- client_updated_at_ms as it read it, so an agent never overwrites an edit it
-- did not see.
--
-- Authoritative references:
--   docs/specs/10-api-authn-authz-guidelines.md ("Agent writes")
--   supabase/functions/agent-api/README.md ("Exercise editing")
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Idempotency receipts accept the exercise operations.
-- -----------------------------------------------------------------------------

alter table public.agent_plan_write_receipts
  drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts
  add constraint agent_plan_write_receipts_operation_valid
    check (operation in (
      'create_session_plan', 'create_training_programme',
      'create_exercise', 'update_exercise', 'delete_exercise', 'restore_exercise'
    ));

-- -----------------------------------------------------------------------------
-- 2. Internal helpers (service-role only).
-- -----------------------------------------------------------------------------

-- Claims an idempotency key. Returns null when the caller now owns the key, or
-- the stored result (with idempotent_replay) when the same payload was already
-- written. A different payload under the same key is IDEMPOTENCY_CONFLICT.
create function app_public.agent_exercise_claim_receipt(
  p_owner uuid,
  p_client_id text,
  p_operation text,
  p_idempotency_key text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _existing_hash text;
  _existing      jsonb;
begin
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 1
     or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  insert into public.agent_plan_write_receipts (
    owner_user_id, client_id, operation, idempotency_key, payload_sha256, result_ids
  ) values (
    p_owner, p_client_id, p_operation, p_idempotency_key, p_payload_sha256, '{}'::jsonb
  )
  on conflict (owner_user_id, client_id, operation, idempotency_key) do nothing;

  if found then
    return null;
  end if;

  select r.payload_sha256, r.result_ids
    into _existing_hash, _existing
    from public.agent_plan_write_receipts r
   where r.owner_user_id = p_owner
     and r.client_id = p_client_id
     and r.operation = p_operation
     and r.idempotency_key = p_idempotency_key;
  if _existing_hash is distinct from p_payload_sha256 then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  return _existing || jsonb_build_object('idempotent_replay', true);
end;
$func$;

create function app_public.agent_exercise_store_receipt(
  p_owner uuid,
  p_client_id text,
  p_operation text,
  p_idempotency_key text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $func$
  update public.agent_plan_write_receipts
     set result_ids = p_result
   where owner_user_id = p_owner
     and client_id = p_client_id
     and operation = p_operation
     and idempotency_key = p_idempotency_key;
$func$;

-- The stamp one agent write uses for every row it touches: past the wall clock
-- and past every stamp the exercise's graph already holds, so it wins LWW.
create function app_public.agent_exercise_write_stamp(p_owner uuid, p_exercise_id text)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $func$
  select greatest(
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    coalesce((
      select max(d.client_updated_at_ms) + 1
        from app_public.exercise_definitions d
       where d.owner_user_id = p_owner and d.id = p_exercise_id
    ), 0),
    coalesce((
      select max(m.client_updated_at_ms) + 1
        from app_public.exercise_muscle_mappings m
       where m.owner_user_id = p_owner and m.exercise_definition_id = p_exercise_id
    ), 0)
  );
$func$;

-- Replaces the exercise's live muscle links with p_muscles
-- ([{muscle_id, role, weight}], already validated by the Edge Function).
-- Every referenced muscle must be a live owner row. Links to the same muscle
-- are revived in place; dropped links become tombstones; unchanged links are
-- left untouched so they do not re-sync.
create function app_public.agent_exercise_replace_muscles(
  p_owner uuid,
  p_exercise_id text,
  p_muscles jsonb,
  p_stamp bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _muscle jsonb;
  _muscle_id text;
  _role text;
  _weight double precision;
begin
  for _muscle in select value from jsonb_array_elements(p_muscles) loop
    _muscle_id := _muscle ->> 'muscle_id';
    if not exists (
      select 1 from app_public.muscle_groups g
       where g.owner_user_id = p_owner and g.id = _muscle_id and g.deleted_at is null
    ) then
      raise exception 'UNKNOWN_MUSCLE' using errcode = 'P0001';
    end if;
  end loop;

  -- Tombstone live links the new set drops.
  update app_public.exercise_muscle_mappings m
     set deleted_at = p_stamp,
         updated_at = p_stamp,
         client_updated_at_ms = p_stamp
   where m.owner_user_id = p_owner
     and m.exercise_definition_id = p_exercise_id
     and m.deleted_at is null
     and not exists (
       select 1 from jsonb_array_elements(p_muscles) wanted
        where wanted.value ->> 'muscle_id' = m.muscle_group_id
     );

  for _muscle in select value from jsonb_array_elements(p_muscles) loop
    _muscle_id := _muscle ->> 'muscle_id';
    _role := _muscle ->> 'role';
    _weight := (_muscle ->> 'weight')::double precision;

    -- Revive or retune any row the pair already has (live or tombstoned).
    update app_public.exercise_muscle_mappings m
       set role = _role,
           weight = _weight,
           deleted_at = null,
           updated_at = p_stamp,
           client_updated_at_ms = p_stamp
     where m.owner_user_id = p_owner
       and m.exercise_definition_id = p_exercise_id
       and m.muscle_group_id = _muscle_id
       and (m.deleted_at is not null or m.role is distinct from _role or m.weight is distinct from _weight);

    if not exists (
      select 1 from app_public.exercise_muscle_mappings m
       where m.owner_user_id = p_owner
         and m.exercise_definition_id = p_exercise_id
         and m.muscle_group_id = _muscle_id
    ) then
      insert into app_public.exercise_muscle_mappings (
        owner_user_id, id, exercise_definition_id, muscle_group_id, weight, role,
        created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
      ) values (
        p_owner, 'map_' || p_exercise_id || '__' || _muscle_id, p_exercise_id, _muscle_id,
        _weight, _role, p_stamp, p_stamp, null, p_stamp, now()
      );
    end if;
  end loop;
end;
$func$;

-- Sync v2's owner guard (enforce_owner_user_id_immutable) refuses an UPDATE
-- while auth.uid() is null, which it is for the service role. The writers below
-- already scope every statement to p_owner, so they act as that owner for the
-- rest of their own transaction; the guard itself is unchanged.
create function app_public.agent_exercise_act_as_owner(p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $func$
  select set_config('request.jwt.claim.sub', p_owner::text, true);
$func$;

-- Locks one owner exercise and checks the caller's revision. Raises NOT_FOUND
-- for a missing or foreign id and REVISION_CONFLICT for a stale revision.
create function app_public.agent_exercise_lock(
  p_owner uuid,
  p_exercise_id text,
  p_expected_revision bigint
)
returns app_public.exercise_definitions
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _row app_public.exercise_definitions;
begin
  select * into _row
    from app_public.exercise_definitions d
   where d.owner_user_id = p_owner and d.id = p_exercise_id
   for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if _row.client_updated_at_ms is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  return _row;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 3. create_exercise.
--
-- p_exercise: {name, load_input_mode, bodyweight_contribution, split_by_gym,
-- muscles: [{muscle_id, role, weight}]}, normalized by the Edge Function.
-- -----------------------------------------------------------------------------

create function app_public.agent_create_exercise(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_exercise jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'create_exercise';
  _replay    jsonb;
  _id        text := gen_random_uuid()::text;
  _stamp     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  insert into app_public.exercise_definitions (
    owner_user_id, id, name, load_input_mode, bodyweight_contribution, split_by_gym,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, _id, p_exercise ->> 'name', p_exercise ->> 'load_input_mode',
    (p_exercise ->> 'bodyweight_contribution')::double precision,
    (p_exercise ->> 'split_by_gym')::boolean,
    _stamp, _stamp, null, _stamp, now()
  );
  perform app_public.agent_exercise_replace_muscles(p_owner, _id, p_exercise -> 'muscles', _stamp);

  _result := jsonb_build_object(
    'exercise_id', _id, 'revision', _stamp, 'idempotent_replay', false
  );
  perform app_public.agent_exercise_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 4. update_exercise.
--
-- p_changes holds only the fields to change (any of name, load_input_mode,
-- bodyweight_contribution, split_by_gym, muscles). A deleted exercise must be
-- restored first. A load_input_mode change re-scores linked group exercises
-- through the existing exercise_definitions_group_eval_enqueue trigger.
-- -----------------------------------------------------------------------------

create function app_public.agent_update_exercise(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_exercise_id text,
  p_expected_revision bigint,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'update_exercise';
  _replay    jsonb;
  _row       app_public.exercise_definitions;
  _stamp     bigint;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_exercise_act_as_owner(p_owner);
  _row := app_public.agent_exercise_lock(p_owner, p_exercise_id, p_expected_revision);
  if _row.deleted_at is not null then
    raise exception 'EXERCISE_DELETED' using errcode = 'P0001';
  end if;
  _stamp := app_public.agent_exercise_write_stamp(p_owner, p_exercise_id);

  update app_public.exercise_definitions d
     set name = coalesce(p_changes ->> 'name', d.name),
         load_input_mode = coalesce(p_changes ->> 'load_input_mode', d.load_input_mode),
         bodyweight_contribution = coalesce(
           (p_changes ->> 'bodyweight_contribution')::double precision, d.bodyweight_contribution),
         split_by_gym = coalesce((p_changes ->> 'split_by_gym')::boolean, d.split_by_gym),
         updated_at = _stamp,
         client_updated_at_ms = _stamp
   where d.owner_user_id = p_owner and d.id = p_exercise_id;

  if p_changes ? 'muscles' then
    perform app_public.agent_exercise_replace_muscles(p_owner, p_exercise_id, p_changes -> 'muscles', _stamp);
  end if;

  _result := jsonb_build_object(
    'exercise_id', p_exercise_id, 'revision', _stamp, 'idempotent_replay', false
  );
  perform app_public.agent_exercise_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 5. delete_exercise / restore_exercise (soft delete only).
--
-- Logged history keeps referencing the definition; restore reverses delete.
-- Muscle links are left as they are, as the app does. Deleting a deleted
-- exercise or restoring a live one changes nothing and reports changed=false,
-- whatever revision it quotes.
-- -----------------------------------------------------------------------------

create function app_public.agent_set_exercise_deleted(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_exercise_id text,
  p_expected_revision bigint,
  p_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := case when p_deleted then 'delete_exercise' else 'restore_exercise' end;
  _replay    jsonb;
  _row       app_public.exercise_definitions;
  _stamp     bigint;
  _changed   boolean;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_exercise_act_as_owner(p_owner);
  -- Already in the asked state: nothing to overwrite, so no revision to check.
  select * into _row
    from app_public.exercise_definitions d
   where d.owner_user_id = p_owner and d.id = p_exercise_id
   for update;
  if found and (_row.deleted_at is not null) = p_deleted then
    _changed := false;
  else
    _row := app_public.agent_exercise_lock(p_owner, p_exercise_id, p_expected_revision);
    _changed := true;
  end if;
  _stamp := _row.client_updated_at_ms;

  if _changed then
    _stamp := app_public.agent_exercise_write_stamp(p_owner, p_exercise_id);
    update app_public.exercise_definitions d
       set deleted_at = case when p_deleted then _stamp else null end,
           updated_at = _stamp,
           client_updated_at_ms = _stamp
     where d.owner_user_id = p_owner and d.id = p_exercise_id;
  end if;

  _result := jsonb_build_object(
    'exercise_id', p_exercise_id, 'revision', _stamp, 'deleted', p_deleted,
    'changed', _changed, 'idempotent_replay', false
  );
  perform app_public.agent_exercise_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 6. Grants: service role only.
-- -----------------------------------------------------------------------------

revoke all on function app_public.agent_exercise_claim_receipt(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function app_public.agent_exercise_store_receipt(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function app_public.agent_exercise_write_stamp(uuid, text)
  from public, anon, authenticated;
revoke all on function app_public.agent_exercise_replace_muscles(uuid, text, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function app_public.agent_exercise_act_as_owner(uuid)
  from public, anon, authenticated;
revoke all on function app_public.agent_exercise_lock(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function app_public.agent_create_exercise(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function app_public.agent_update_exercise(uuid, text, text, text, text, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function app_public.agent_set_exercise_deleted(uuid, text, text, text, text, bigint, boolean)
  from public, anon, authenticated;

grant execute on function app_public.agent_create_exercise(uuid, text, text, text, jsonb)
  to service_role;
grant execute on function app_public.agent_update_exercise(uuid, text, text, text, text, bigint, jsonb)
  to service_role;
grant execute on function app_public.agent_set_exercise_deleted(uuid, text, text, text, text, bigint, boolean)
  to service_role;
