-- Synced weekly muscle targets and the count-secondary switch: four nullable,
-- user-owned columns on the settings singleton.
--
--   weekly_working_set_target  positive whole number (the default target)
--   muscle_target_mode         'single' | 'per_muscle'
--   muscle_target_overrides    {detailed?, broad?, custom?: {muscle_id: int}},
--                              JSON text on the sync wire
--   count_secondary_muscles    whether secondary sets count
--
-- Null means no device has uploaded its targets yet, so existing rows need no
-- backfill. A client always writes the four together; a push that omits a key
-- or sends null keeps the stored value, so neither an app predating the
-- columns nor a device that has not adopted the server's targets yet can
-- clear them.
--
-- The columns are additive, so the sync protocol does not move (see
-- docs/specs/05-data-model.md, "Client schema drift rule"). This migration
-- deploys before the app release that writes the fields.

alter table app_public.user_settings
  add column weekly_working_set_target integer,
  add column muscle_target_mode text,
  add column muscle_target_overrides jsonb,
  add column count_secondary_muscles boolean;

-- The overrides shape the app's `isMuscleTargetOverrides` accepts: an object
-- keyed by scope, each scope an object of muscle id to a positive safe
-- integer. Ids are rejected only when blank in ASCII whitespace, a subset of
-- what the app rejects, so a value the app wrote always passes.
create function app_public.muscle_target_overrides_valid(overrides jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(overrides) = 'object' and not exists (
    select 1
      from jsonb_each(overrides) as scope(key, targets)
     where scope.key not in ('detailed', 'broad', 'custom')
        or jsonb_typeof(scope.targets) <> 'object'
        or exists (
          select 1
            from jsonb_each(case when jsonb_typeof(scope.targets) = 'object'
                                 then scope.targets else '{}'::jsonb end) as target(id, value),
                 lateral (select case when jsonb_typeof(target.value) = 'number'
                                      then (target.value)::numeric end as n) as parsed
           where btrim(target.id, E' \t\n\r\f\v') = ''
              or parsed.n is null
              or parsed.n <> trunc(parsed.n)
              or parsed.n <= 0
              or parsed.n > 9007199254740991))
$$;
revoke all on function app_public.muscle_target_overrides_valid(jsonb) from public;
grant execute on function app_public.muscle_target_overrides_valid(jsonb) to authenticated, service_role;

alter table app_public.user_settings
  add constraint user_settings_muscle_target_overrides_valid
  check (muscle_target_overrides is null or app_public.muscle_target_overrides_valid(muscle_target_overrides));

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
    raise exception 'user_settings muscle targets failed to patch %', label;
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
    $old$        owner_user_id,id,bodyweight_calculations_enabled,created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values ($old$,
    $new$        owner_user_id,id,bodyweight_calculations_enabled,
        weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,
        created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values ($new$,
    'sync_push: user_settings insert columns');

  -- The overrides travel as JSON text (the wire carries primitives only); text
  -- that is not JSON fails the push, and JSON null is stored as null.
  definition := pg_temp.replace_once(definition,
    $old$        _uid,_id,(_fields->>'bodyweight_calculations_enabled')::boolean,$old$,
    $new$        _uid,_id,(_fields->>'bodyweight_calculations_enabled')::boolean,
        (_fields->>'weekly_working_set_target')::integer,
        _fields->>'muscle_target_mode',
        nullif((_fields->>'muscle_target_overrides')::jsonb,'null'::jsonb),
        (_fields->>'count_secondary_muscles')::boolean,$new$,
    'sync_push: user_settings insert values');

  -- Omitted or null keys keep the stored value: the targets are never cleared.
  definition := pg_temp.replace_once(definition,
    $old$        bodyweight_calculations_enabled=excluded.bodyweight_calculations_enabled,$old$,
    $new$        bodyweight_calculations_enabled=excluded.bodyweight_calculations_enabled,
        weekly_working_set_target=coalesce(excluded.weekly_working_set_target,
          app_public.user_settings.weekly_working_set_target),
        muscle_target_mode=coalesce(excluded.muscle_target_mode,app_public.user_settings.muscle_target_mode),
        muscle_target_overrides=coalesce(excluded.muscle_target_overrides,
          app_public.user_settings.muscle_target_overrides),
        count_secondary_muscles=coalesce(excluded.count_secondary_muscles,
          app_public.user_settings.count_secondary_muscles),$new$,
    'sync_push: user_settings null and omitted-field preservation');

  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    $old$             'bodyweight_calculations_enabled',us.bodyweight_calculations_enabled,$old$,
    $new$             'bodyweight_calculations_enabled',us.bodyweight_calculations_enabled,
             'weekly_working_set_target',us.weekly_working_set_target,
             'muscle_target_mode',us.muscle_target_mode,
             'muscle_target_overrides',us.muscle_target_overrides::text,
             'count_secondary_muscles',us.count_secondary_muscles,$new$,
    'sync_pull: user_settings pull fields');
  execute definition;
end
$migration$;

drop function pg_temp.replace_once(text, text, text, text);
