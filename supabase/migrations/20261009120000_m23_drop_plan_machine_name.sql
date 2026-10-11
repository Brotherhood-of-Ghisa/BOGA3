-- Drop the plan-level machine snapshot (`session_plan_exercises.machine_name`).
--
-- The machine/equipment note belongs to the exercise definition, not to a plan
-- block, so the plan domain no longer authors or stores it. The performed
-- `session_exercises.machine_name` is untouched: it predates the planner (it
-- is part of the original auth/authz baseline schema) and is out of scope.
--
-- `sync_push` and `sync_pull` are patched in place via `pg_get_functiondef` +
-- `replace` — the pattern the planning migration established — so the
-- historical migrations stay untouched. Every patch is guarded: a baseline
-- change fails loudly rather than silently leaving the column on the wire.

do $migration$
declare
  definition text;
  revised    text;
begin
  -- sync_push: session_plan_exercises insert columns
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  revised := replace(definition,
    $anchor$        session_plan_id, exercise_definition_id, order_index, name, machine_name,$anchor$,
    $patch$        session_plan_id, exercise_definition_id, order_index, name,$patch$);
  if revised = definition then
    raise exception 'drop-plan-machine migration failed to patch sync_push: session_plan_exercises insert columns';
  end if;
  definition := revised;

  -- sync_push: session_plan_exercises insert values
  revised := replace(definition,
    $anchor$        _fields ->> 'session_plan_id',
        _fields ->> 'exercise_definition_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'name',
        _fields ->> 'machine_name',$anchor$,
    $patch$        _fields ->> 'session_plan_id',
        _fields ->> 'exercise_definition_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'name',$patch$);
  if revised = definition then
    raise exception 'drop-plan-machine migration failed to patch sync_push: session_plan_exercises insert values';
  end if;
  definition := revised;

  -- sync_push: session_plan_exercises conflict update
  revised := replace(definition,
    $anchor$        set session_plan_id        = excluded.session_plan_id,
            exercise_definition_id = excluded.exercise_definition_id,
            order_index            = excluded.order_index,
            name                   = excluded.name,
            machine_name           = excluded.machine_name,$anchor$,
    $patch$        set session_plan_id        = excluded.session_plan_id,
            exercise_definition_id = excluded.exercise_definition_id,
            order_index            = excluded.order_index,
            name                   = excluded.name,$patch$);
  if revised = definition then
    raise exception 'drop-plan-machine migration failed to patch sync_push: session_plan_exercises conflict update';
  end if;
  execute revised;

  -- sync_pull: session_plan_exercises projection
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  revised := replace(definition,
    $anchor$             'name', spe.name,
             'machine_name', spe.machine_name,$anchor$,
    $patch$             'name', spe.name,$patch$);
  if revised = definition then
    raise exception 'drop-plan-machine migration failed to patch sync_pull: session_plan_exercises projection';
  end if;
  execute revised;
end
$migration$;

alter table app_public.session_plan_exercises drop column machine_name;
