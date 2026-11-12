-- Combined muscles: the user's own merges of anatomy entries, and one weekly
-- target map for every setup. Two nullable, user-owned columns on the
-- settings singleton:
--
--   combined_muscles  [{key, name, family}]: the user's combined-muscle
--                     definitions. An entry is a member when its
--                     muscle_groups.report_group names one of these keys.
--   muscle_targets    {reported_muscle_id: int}: one map of weekly target
--                     overrides; reported ids are entry ids or combined keys.
--
-- Both travel as JSON text on the sync wire. Null means no device has written
-- them yet: readers then take the legacy Broad report_group keys as combined
-- muscles and the legacy per-setup muscle_target_overrides for the setup the
-- rows spell out (apps/mobile/src/data/combined-muscles.ts), and the app's
-- one-time migration stores both. muscle_target_overrides is no longer
-- written by current clients and stays for that migration.
--
-- A push that omits either key or sends null keeps the stored value, so an
-- app predating the columns cannot clear them. The columns are additive, so
-- the sync protocol does not move (docs/specs/05-data-model.md, "Client schema
-- drift rule"). This migration deploys before the app release that writes them.

alter table app_public.user_settings
  add column combined_muscles jsonb,
  add column muscle_targets jsonb;

-- The definitions shape the app's `isCombinedMuscleList` accepts: an array of
-- objects with a `cm_` key (lower-case letters, digits, underscores), a name of
-- 1 to 60 characters and a family of 1 to 200, not blank in ASCII whitespace;
-- keys distinct. Extra object keys are allowed for later clients.
create function app_public.combined_muscles_valid(definitions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(definitions) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(definitions) as item(value)
        where jsonb_typeof(item.value) <> 'object'
           or jsonb_typeof(item.value -> 'key') is distinct from 'string'
           or jsonb_typeof(item.value -> 'name') is distinct from 'string'
           or jsonb_typeof(item.value -> 'family') is distinct from 'string'
           or (item.value ->> 'key') !~ '^cm_[a-z0-9_]{1,64}$'
           or btrim(item.value ->> 'name', E' \t\n\r\f\v') = ''
           or length(item.value ->> 'name') > 60
           or btrim(item.value ->> 'family', E' \t\n\r\f\v') = ''
           or length(item.value ->> 'family') > 200)
     and (select count(*) from jsonb_array_elements(definitions))
       = (select count(distinct item.value ->> 'key') from jsonb_array_elements(definitions) as item(value))
$$;
revoke all on function app_public.combined_muscles_valid(jsonb) from public;
grant execute on function app_public.combined_muscles_valid(jsonb) to authenticated, service_role;

-- The single map the app's `isMuscleTargetOverrides` accepts: an object of
-- muscle id to a positive safe integer. Ids are rejected only when blank in
-- ASCII whitespace, a subset of what the app rejects.
create function app_public.muscle_targets_valid(targets jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(targets) = 'object' and not exists (
    select 1
      from jsonb_each(targets) as target(id, value),
           lateral (select case when jsonb_typeof(target.value) = 'number'
                                then (target.value)::numeric end as n) as parsed
     where btrim(target.id, E' \t\n\r\f\v') = ''
        or parsed.n is null
        or parsed.n <> trunc(parsed.n)
        or parsed.n <= 0
        or parsed.n > 9007199254740991)
$$;
revoke all on function app_public.muscle_targets_valid(jsonb) from public;
grant execute on function app_public.muscle_targets_valid(jsonb) to authenticated, service_role;

alter table app_public.user_settings
  add constraint user_settings_combined_muscles_valid
  check (combined_muscles is null or app_public.combined_muscles_valid(combined_muscles)),
  add constraint user_settings_muscle_targets_valid
  check (muscle_targets is null or app_public.muscle_targets_valid(muscle_targets));

-- Patch the installed sync functions in place so historical migrations stay
-- immutable. Each replacement must match exactly once, so a future baseline
-- edit fails this migration instead of silently leaving an asymmetric wire
-- contract.
create function pg_temp.replace_once(definition text, old text, new text, label text)
returns text
language plpgsql
as $fn$
begin
  if (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 then
    raise exception 'combined muscles failed to patch %', label;
  end if;
  return replace(definition, old, new);
end
$fn$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    'weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,volume_primary_only,',
    'weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,volume_primary_only,
        muscle_targets,combined_muscles,',
    'sync_push: user_settings insert columns');
  -- JSON text on the wire; text that is not JSON fails the push, JSON null is stored as null.
  definition := pg_temp.replace_once(definition,
    $old$        (_fields->>'volume_primary_only')::boolean,$old$,
    $new$        (_fields->>'volume_primary_only')::boolean,
        nullif((_fields->>'muscle_targets')::jsonb,'null'::jsonb),
        nullif((_fields->>'combined_muscles')::jsonb,'null'::jsonb),$new$,
    'sync_push: user_settings insert values');
  -- Omitted or null keys keep the stored value.
  definition := pg_temp.replace_once(definition,
    $old$        volume_primary_only=coalesce(excluded.volume_primary_only,
          app_public.user_settings.volume_primary_only),$old$,
    $new$        volume_primary_only=coalesce(excluded.volume_primary_only,
          app_public.user_settings.volume_primary_only),
        muscle_targets=coalesce(excluded.muscle_targets,app_public.user_settings.muscle_targets),
        combined_muscles=coalesce(excluded.combined_muscles,app_public.user_settings.combined_muscles),$new$,
    'sync_push: user_settings null and omitted-field preservation');
  execute definition;

  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    $old$             'volume_primary_only',us.volume_primary_only,$old$,
    $new$             'volume_primary_only',us.volume_primary_only,
             'muscle_targets',us.muscle_targets::text,
             'combined_muscles',us.combined_muscles::text,$new$,
    'sync_pull: user_settings pull fields');
  execute definition;
end
$migration$;

drop function pg_temp.replace_once(text, text, text, text);

-- =============================================================================
-- Agent weekly muscle targets now write the single map. Same contract as
-- 20261028170000_agent_set_muscle_targets.sql (service role only, idempotent,
-- revision-checked, stamped past the row's own clock), except:
--
--   * p_base_targets replaces p_scope: the map the coach's status showed. It
--     seeds the write only while the row holds no muscle_targets (a legacy
--     account whose devices have not migrated); a stored map always wins.
--   * Overrides merge into muscle_targets; muscle_target_overrides is left as
--     it is.
--   * combined_muscles is never touched.
--
-- The scoped function is dropped so a stale Edge Function fails loudly rather
-- than writing a map no current app reads.
-- =============================================================================
drop function app_public.agent_set_muscle_targets(uuid, text, text, text, bigint, text, jsonb);

create function app_public.agent_set_muscle_targets(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_expected_revision bigint,
  p_base_targets jsonb,
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
  _live      boolean;
  _uploaded  boolean;
  _revision  bigint;
  _stamp     bigint;
  _target    bigint;
  _mode      text;
  _targets   jsonb;
  _entry     record;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  if p_base_targets is null or not app_public.muscle_targets_valid(p_base_targets) then
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
  _live := found and _row.deleted_at is null;
  -- What get_training_status reads: no live row, or null targets, is "not uploaded".
  _uploaded := _live and _row.weekly_working_set_target is not null;
  _revision := case when _live then _row.client_updated_at_ms else 0 end;
  if p_expected_revision is distinct from _revision then
    raise exception 'REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  _target := coalesce((p_changes ->> 'default_weekly_sets')::bigint,
                      case when _uploaded then _row.weekly_working_set_target end, 8);
  _mode := coalesce(p_changes ->> 'mode', case when _uploaded then _row.muscle_target_mode end, 'single');
  _targets := coalesce(case when _live then _row.muscle_targets end, p_base_targets);
  for _entry in select e.key, e.value from jsonb_each(coalesce(p_changes -> 'overrides', '{}'::jsonb)) e loop
    if jsonb_typeof(_entry.value) = 'null' then
      _targets := _targets - _entry.key;
    else
      _targets := _targets || jsonb_build_object(_entry.key, _entry.value);
    end if;
  end loop;

  _stamp := greatest(
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    coalesce(_row.client_updated_at_ms + 1, 0)
  );
  insert into app_public.user_settings (
    owner_user_id, id, weekly_working_set_target, muscle_target_mode, muscle_targets,
    count_secondary_muscles, volume_primary_only, created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, 'settings', _target, _mode, _targets,
    coalesce(_row.count_secondary_muscles, case when _live then true else false end), coalesce(_row.volume_primary_only, false),
    _stamp, _stamp, null, _stamp, now()
  )
  on conflict (owner_user_id, id) do update
    set weekly_working_set_target = excluded.weekly_working_set_target,
        muscle_target_mode = excluded.muscle_target_mode,
        muscle_targets = excluded.muscle_targets,
        count_secondary_muscles = excluded.count_secondary_muscles,
        volume_primary_only = excluded.volume_primary_only,
        updated_at = excluded.updated_at,
        deleted_at = null,
        client_updated_at_ms = excluded.client_updated_at_ms;

  _result := jsonb_build_object(
    'targets', jsonb_build_object(
      'mode', _mode, 'default_weekly_sets', _target, 'uploaded', true, 'revision', _stamp
    ),
    'overrides', _targets,
    'idempotent_replay', false
  );
  perform app_public.agent_exercise_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

revoke all on function app_public.agent_set_muscle_targets(uuid, text, text, text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function app_public.agent_set_muscle_targets(uuid, text, text, text, bigint, jsonb, jsonb)
  to service_role;
