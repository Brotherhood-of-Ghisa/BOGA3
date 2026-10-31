-- Sets keep the existing secondary switch; Volume gains its own choice.
-- Nullable keeps older writers compatible. Null/omitted pushes preserve a
-- stored choice, and readers default the new Volume choice to false.
alter table app_public.user_settings add column volume_primary_only boolean;
-- Metadata only: old NULL remains legacy provenance; future direct inserts use
-- the new Sets default without rewriting an existing row or its edit clock.
alter table app_public.user_settings alter column count_secondary_muscles set default false;

-- Leave legacy Sets nulls and edit clocks intact. A synthesized legacy default
-- must not override an unuploaded KV choice or an offline target edit. The app
-- initializes missing choices through adoption. Do not seed empty accounts:
-- creating settings rows there would change first-sign-in bootstrap.

create function pg_temp.replace_once(definition text, old text, new text, label text)
returns text language plpgsql as $fn$
begin
  if (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 then
    raise exception 'independent muscle counting failed to patch %', label;
  end if;
  return replace(definition, old, new);
end
$fn$;

do $migration$
declare definition text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    'weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,',
    'weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,volume_primary_only,',
    'sync_push columns');
  definition := pg_temp.replace_once(definition,
    $old$        (_fields->>'count_secondary_muscles')::boolean,$old$,
    $new$        case when _fields ? 'count_secondary_muscles' then (_fields->>'count_secondary_muscles')::boolean else false end,
        (_fields->>'volume_primary_only')::boolean,$new$,
    'sync_push values');
  definition := pg_temp.replace_once(definition,
    $old$        count_secondary_muscles=coalesce(excluded.count_secondary_muscles,
          app_public.user_settings.count_secondary_muscles),$old$,
    $new$        count_secondary_muscles=case when _fields ? 'count_secondary_muscles'
          then coalesce(excluded.count_secondary_muscles,app_public.user_settings.count_secondary_muscles)
          else app_public.user_settings.count_secondary_muscles end,
        volume_primary_only=coalesce(excluded.volume_primary_only,
          app_public.user_settings.volume_primary_only),$new$,
    'sync_push preservation');
  execute definition;

  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    $old$             'count_secondary_muscles',us.count_secondary_muscles,$old$,
    $new$             'count_secondary_muscles',us.count_secondary_muscles,
             'volume_primary_only',us.volume_primary_only,$new$,
    'sync_pull fields');
  execute definition;

  -- Target-only coaching writes preserve both independent settings, including
  -- a choice made before the first target upload. Fresh rows use new defaults.
  select pg_get_functiondef('app_public.agent_set_muscle_targets(uuid,text,text,text,bigint,text,jsonb)'::regprocedure)
    into definition;
  definition := pg_temp.replace_once(definition,
    'count_secondary_muscles, created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at',
    'count_secondary_muscles, volume_primary_only, created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at',
    'target RPC columns');
  definition := pg_temp.replace_once(definition,
    'case when _uploaded then coalesce(_row.count_secondary_muscles, true) else true end,',
    'coalesce(_row.count_secondary_muscles, case when _row.id is not null and _row.deleted_at is null then true else false end), coalesce(_row.volume_primary_only, false),',
    'target RPC defaults');
  definition := pg_temp.replace_once(definition,
    'count_secondary_muscles = excluded.count_secondary_muscles,',
    E'count_secondary_muscles = excluded.count_secondary_muscles,\n        volume_primary_only = excluded.volume_primary_only,',
    'target RPC preservation');
  execute definition;
end
$migration$;

drop function pg_temp.replace_once(text, text, text, text);
