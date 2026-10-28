-- =============================================================================
-- Agent weekly muscle targets.
--
-- A connected coaching client with write access (the app-owned
-- public.agent_plan_permissions switch, unchanged) may set the owner's default
-- weekly target, the target mode and per-muscle overrides on the synced
-- settings singleton. The single service-role-only function below does it; the
-- agent token itself stays denied from every domain table.
--
-- The row reaches devices through the ordinary Sync v2 pull: the stamp is
-- greatest(now, the row's own stamp + 1), so the write wins the server's LWW
-- and every device's pull apply. The write is revision-checked: the caller
-- passes the row's client_updated_at_ms as get_training_status read it (0 with
-- no row), so an agent never overwrites a change it did not see.
--
-- Authoritative references:
--   docs/specs/10-api-authn-authz-guidelines.md ("Agent writes")
--   supabase/functions/agent-api/README.md ("Muscle targets")
-- =============================================================================

alter table public.agent_plan_write_receipts
  drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts
  add constraint agent_plan_write_receipts_operation_valid
    check (operation in (
      'create_session_plan', 'create_training_programme',
      'create_exercise', 'update_exercise', 'delete_exercise', 'restore_exercise',
      'update_plan_meta', 'update_programme_meta',
      'insert_plan_block', 'update_plan_block',
      'reorder_plan_blocks', 'reorder_programme_plans', 'reorder_block_sets',
      'tombstone_plan_block', 'detach_programme_plan',
      'tombstone_plan', 'tombstone_programme',
      'set_muscle_targets'
    ));

-- p_scope is the muscle setup the owner currently reports under (detailed,
-- broad or custom); p_changes holds only what to change, already validated by
-- the Edge Function: default_weekly_sets (positive integer), mode (single |
-- per_muscle) and overrides ({muscle_id: positive integer | null}, null clears
-- the override). Overrides merge into p_scope's map; the other scopes stay.
-- A row no device has uploaded to yet takes the app's defaults for whatever
-- the call leaves out (8 sets, single mode, secondary sets counted), so the
-- four columns are always written together, as the app writes them.
create function app_public.agent_set_muscle_targets(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_expected_revision bigint,
  p_scope text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'set_muscle_targets';
  _replay    jsonb;
  _row       app_public.user_settings;
  _revision  bigint;
  _stamp     bigint;
  _target    bigint;
  _mode      text;
  _overrides jsonb;
  _scoped    jsonb;
  _entry     record;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  if p_scope is null or p_scope not in ('detailed', 'broad', 'custom') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  perform app_public.agent_exercise_act_as_owner(p_owner);
  -- The singleton may not exist yet, so a row lock cannot serialise two first
  -- writers; this one can.
  perform pg_advisory_xact_lock(hashtextextended('agent_set_muscle_targets:' || p_owner::text, 0));
  select * into _row
    from app_public.user_settings s
   where s.owner_user_id = p_owner and s.id = 'settings'
   for update;
  _revision := case when found and _row.deleted_at is null then _row.client_updated_at_ms else 0 end;
  if p_expected_revision is not null and p_expected_revision is distinct from _revision then
    raise exception 'REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  _target := coalesce((p_changes ->> 'default_weekly_sets')::bigint, _row.weekly_working_set_target, 8);
  _mode := coalesce(p_changes ->> 'mode', _row.muscle_target_mode, 'single');
  _overrides := coalesce(_row.muscle_target_overrides, '{}'::jsonb);
  _scoped := coalesce(_overrides -> p_scope, '{}'::jsonb);
  for _entry in select e.key, e.value from jsonb_each(coalesce(p_changes -> 'overrides', '{}'::jsonb)) e loop
    if jsonb_typeof(_entry.value) = 'null' then
      _scoped := _scoped - _entry.key;
    else
      _scoped := _scoped || jsonb_build_object(_entry.key, _entry.value);
    end if;
  end loop;
  _overrides := case when _scoped = '{}'::jsonb then _overrides - p_scope
                     else _overrides || jsonb_build_object(p_scope, _scoped) end;

  _stamp := greatest(
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    coalesce(_row.client_updated_at_ms + 1, 0)
  );
  insert into app_public.user_settings (
    owner_user_id, id, weekly_working_set_target, muscle_target_mode, muscle_target_overrides,
    count_secondary_muscles, created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, 'settings', _target, _mode, _overrides,
    coalesce(_row.count_secondary_muscles, true), _stamp, _stamp, null, _stamp, now()
  )
  on conflict (owner_user_id, id) do update
    set weekly_working_set_target = excluded.weekly_working_set_target,
        muscle_target_mode = excluded.muscle_target_mode,
        muscle_target_overrides = excluded.muscle_target_overrides,
        count_secondary_muscles = excluded.count_secondary_muscles,
        updated_at = excluded.updated_at,
        deleted_at = null,
        client_updated_at_ms = excluded.client_updated_at_ms;

  _result := jsonb_build_object(
    'scope', p_scope,
    'targets', jsonb_build_object(
      'mode', _mode, 'default_weekly_sets', _target, 'uploaded', true, 'revision', _stamp
    ),
    'overrides', _scoped,
    'idempotent_replay', false
  );
  perform app_public.agent_exercise_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

revoke all on function app_public.agent_set_muscle_targets(uuid, text, text, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function app_public.agent_set_muscle_targets(uuid, text, text, text, bigint, text, jsonb)
  to service_role;
