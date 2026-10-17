-- Split one exercise's reporting by gym: a synced, user-owned flag on the
-- definition. The split is read-time only — one definition plus this flag, with
-- reports keyed on (definition, gym bucket); no raw row is ever rewritten.
--
-- The column is additive, so the sync protocol does not move (see
-- docs/specs/05-data-model.md, "Client schema drift rule"). This migration
-- deploys before the app release that writes the field.

alter table app_public.exercise_definitions
  add column split_by_gym boolean not null default false;

-- Patch the installed sync functions in place so historical migrations stay
-- immutable. Each replacement is guarded, so a future baseline edit fails this
-- migration instead of silently leaving an asymmetric wire contract.
do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  -- Insert column list.
  revised := replace(definition,
    $old$        owner_user_id,id,name,load_input_mode,bodyweight_contribution,$old$,
    $new$        owner_user_id,id,name,load_input_mode,bodyweight_contribution,split_by_gym,$new$);
  if revised = definition then
    raise exception 'split_by_gym failed to patch sync_push: exercise_definitions insert columns';
  end if;
  definition := revised;

  -- Insert value. A writer that omits the key inserts the stored default.
  revised := replace(definition,
    $old$        (_fields->>'bodyweight_contribution')::double precision,$old$,
    $new$        (_fields->>'bodyweight_contribution')::double precision,
        coalesce((_fields->>'split_by_gym')::boolean,false),$new$);
  if revised = definition then
    raise exception 'split_by_gym failed to patch sync_push: exercise_definitions insert values';
  end if;
  definition := revised;

  -- Omitted-field preservation: only a payload that carried the key may replace
  -- a stored flag, so a writer predating the field cannot clear it for a device
  -- that set it.
  revised := replace(definition,
    $old$        bodyweight_contribution=excluded.bodyweight_contribution,$old$,
    $new$        bodyweight_contribution=excluded.bodyweight_contribution,
        split_by_gym=case when _fields ? 'split_by_gym' then excluded.split_by_gym
          else app_public.exercise_definitions.split_by_gym end,$new$);
  if revised = definition then
    raise exception 'split_by_gym failed to patch sync_push: exercise_definitions omitted-field preservation';
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
  revised := replace(definition,
    $old$             'bodyweight_contribution', ed.bodyweight_contribution,$old$,
    $new$             'bodyweight_contribution', ed.bodyweight_contribution,
             'split_by_gym', ed.split_by_gym,$new$);
  if revised = definition then
    raise exception 'split_by_gym failed to patch sync_pull: exercise_definitions pull fields';
  end if;
  execute revised;
end
$migration$;
