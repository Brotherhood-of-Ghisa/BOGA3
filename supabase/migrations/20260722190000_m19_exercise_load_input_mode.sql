-- M19: exercise load-entry semantics are user-owned metadata and therefore
-- mirror the local exercise_definitions column through Sync v2.

alter table app_public.exercise_definitions
  add column load_input_mode text not null default 'total_load',
  add constraint exercise_definitions_load_input_mode_valid
    check (load_input_mode in ('total_load', 'per_side_load'));

-- Keep this forward migration compact while preserving the canonical Sync v2
-- functions installed by the latest baseline migration. Each replacement is
-- guarded so a future baseline edit fails the migration instead of silently
-- leaving an asymmetric wire contract.
do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  revised := replace(
    definition,
    'name, created_at, updated_at, deleted_at,',
    'name, load_input_mode, created_at, updated_at, deleted_at,'
  );
  revised := replace(
    revised,
    '_fields ->> ''name'',
        (_fields ->> ''created_at'')::bigint,',
    '_fields ->> ''name'',
        coalesce(_fields ->> ''load_input_mode'', ''total_load''),
        (_fields ->> ''created_at'')::bigint,'
  );
  revised := replace(
    revised,
    'set name                 = excluded.name,
            created_at',
    'set name                 = excluded.name,
            load_input_mode      = excluded.load_input_mode,
            created_at'
  );
  if revised = definition then
    raise exception 'M19 failed to patch sync_push exercise_definitions projection';
  end if;
  execute revised;
end
$migration$;
do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  revised := replace(
    definition,
    '''name'', ed.name,
             ''created_at'', ed.created_at,',
    '''name'', ed.name,
             ''load_input_mode'', ed.load_input_mode,
             ''created_at'', ed.created_at,'
  );
  if revised = definition then
    raise exception 'M19 failed to patch sync_pull exercise_definitions projection';
  end if;
  execute revised;
end
$migration$;
