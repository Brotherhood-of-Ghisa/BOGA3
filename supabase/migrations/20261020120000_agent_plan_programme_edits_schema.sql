-- Migration: 20261020120000_agent_plan_programme_edits_schema.sql
-- Agent programme and plan edit permissions, receipt operations, and attribution schema.

-- -----------------------------------------------------------------------------
-- 1. Agent plan permissions: plan_edit_enabled toggle
-- -----------------------------------------------------------------------------

alter table public.agent_plan_permissions
  add column plan_edit_enabled boolean not null default false;

comment on column public.agent_plan_permissions.plan_edit_enabled is
  'Explicit opt-in permission allowing coaching agents to mutate authored plans and programmes.';

-- -----------------------------------------------------------------------------
-- 2. Receipts operation CHECK constraint widening
-- -----------------------------------------------------------------------------

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
      'tombstone_plan', 'tombstone_programme'
    ));

-- -----------------------------------------------------------------------------
-- 3. Authored plan entity attribution: last_modified_by
-- -----------------------------------------------------------------------------

alter table app_public.training_programmes
  add column last_modified_by text not null default 'human';

alter table app_public.session_plans
  add column last_modified_by text not null default 'human';

alter table app_public.session_plan_exercises
  add column last_modified_by text not null default 'human';

alter table app_public.session_plan_sets
  add column last_modified_by text not null default 'human';

-- -----------------------------------------------------------------------------
-- 4. Patch sync_push: project and preserve last_modified_by on the four tables
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  -- 4.1 training_programmes insert columns
  revised := replace(definition,
    $old$        owner_user_id, id, name, description,
        created_at, updated_at, deleted_at,$old$,
    $new$        owner_user_id, id, name, description, last_modified_by,
        created_at, updated_at, deleted_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: training_programmes insert columns';
  end if;
  definition := revised;

  -- 4.2 training_programmes insert values
  revised := replace(definition,
    $old$        _fields ->> 'name',
        _fields ->> 'description',
        (_fields ->> 'created_at')::bigint,$old$,
    $new$        _fields ->> 'name',
        _fields ->> 'description',
        coalesce(_fields ->> 'last_modified_by', 'human'),
        (_fields ->> 'created_at')::bigint,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: training_programmes insert values';
  end if;
  definition := revised;

  -- 4.3 training_programmes update set
  revised := replace(definition,
    $old$        set name                 = excluded.name,
            description          = excluded.description,
            created_at           = excluded.created_at,$old$,
    $new$        set name                 = excluded.name,
            description          = excluded.description,
            last_modified_by     = case when _fields ? 'last_modified_by' then excluded.last_modified_by
                                     else app_public.training_programmes.last_modified_by end,
            created_at           = excluded.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: training_programmes update set';
  end if;
  definition := revised;

  -- 4.4 session_plans insert columns
  revised := replace(definition,
    $old$        programme_id, programme_order_index, gym_id, title, scheduled_for, provenance,
        created_at, updated_at, deleted_at,$old$,
    $new$        programme_id, programme_order_index, gym_id, title, scheduled_for, provenance, last_modified_by,
        created_at, updated_at, deleted_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plans insert columns';
  end if;
  definition := revised;

  -- 4.5 session_plans insert values
  revised := replace(definition,
    $old$        coalesce(_fields ->> 'provenance', 'human'),
        (_fields ->> 'created_at')::bigint,$old$,
    $new$        coalesce(_fields ->> 'provenance', 'human'),
        coalesce(_fields ->> 'last_modified_by', 'human'),
        (_fields ->> 'created_at')::bigint,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plans insert values';
  end if;
  definition := revised;

  -- 4.6 session_plans update set
  revised := replace(definition,
    $old$            provenance            = excluded.provenance,
            created_at            = excluded.created_at,$old$,
    $new$            provenance            = excluded.provenance,
            last_modified_by     = case when _fields ? 'last_modified_by' then excluded.last_modified_by
                                     else app_public.session_plans.last_modified_by end,
            created_at            = excluded.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plans update set';
  end if;
  definition := revised;

  -- 4.7 session_plan_exercises insert columns
  revised := replace(definition,
    $old$        session_plan_id, exercise_definition_id, order_index, name,
        progress_status, resolved_at,
        created_at, updated_at, deleted_at,$old$,
    $new$        session_plan_id, exercise_definition_id, order_index, name,
        progress_status, resolved_at, last_modified_by,
        created_at, updated_at, deleted_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_exercises insert columns';
  end if;
  definition := revised;

  -- 4.8 session_plan_exercises insert values
  revised := replace(definition,
    $old$        coalesce(_fields ->> 'progress_status', 'pending'),
        (_fields ->> 'resolved_at')::bigint,
        (_fields ->> 'created_at')::bigint,$old$,
    $new$        coalesce(_fields ->> 'progress_status', 'pending'),
        (_fields ->> 'resolved_at')::bigint,
        coalesce(_fields ->> 'last_modified_by', 'human'),
        (_fields ->> 'created_at')::bigint,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_exercises insert values';
  end if;
  definition := revised;

  -- 4.9 session_plan_exercises update set
  revised := replace(definition,
    $old$            resolved_at            = excluded.resolved_at,
            created_at             = excluded.created_at,$old$,
    $new$            resolved_at            = excluded.resolved_at,
            last_modified_by     = case when _fields ? 'last_modified_by' then excluded.last_modified_by
                                     else app_public.session_plan_exercises.last_modified_by end,
            created_at             = excluded.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_exercises update set';
  end if;
  definition := revised;

  -- 4.10 session_plan_sets insert columns
  revised := replace(definition,
    $old$        session_plan_exercise_id, order_index, target_weight_value, target_reps, target_set_type,
        created_at, updated_at, deleted_at,$old$,
    $new$        session_plan_exercise_id, order_index, target_weight_value, target_reps, target_set_type, last_modified_by,
        created_at, updated_at, deleted_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_sets insert columns';
  end if;
  definition := revised;

  -- 4.11 session_plan_sets insert values
  revised := replace(definition,
    $old$        _fields ->> 'target_set_type',
        (_fields ->> 'created_at')::bigint,$old$,
    $new$        _fields ->> 'target_set_type',
        coalesce(_fields ->> 'last_modified_by', 'human'),
        (_fields ->> 'created_at')::bigint,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_sets insert values';
  end if;
  definition := revised;

  -- 4.12 session_plan_sets update set
  revised := replace(definition,
    $old$            target_set_type          = excluded.target_set_type,
            created_at               = excluded.created_at,$old$,
    $new$            target_set_type          = excluded.target_set_type,
            last_modified_by         = case when _fields ? 'last_modified_by' then excluded.last_modified_by
                                         else app_public.session_plan_sets.last_modified_by end,
            created_at               = excluded.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_push: session_plan_sets update set';
  end if;

  execute revised;
end
$migration$;

-- -----------------------------------------------------------------------------
-- 5. Patch sync_pull: project last_modified_by on the four tables
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;

  -- 5.1 training_programmes pull projection
  revised := replace(definition,
    $old$             'name', tp.name,
             'description', tp.description,
             'created_at', tp.created_at,$old$,
    $new$             'name', tp.name,
             'description', tp.description,
             'last_modified_by', tp.last_modified_by,
             'created_at', tp.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_pull: training_programmes pull fields';
  end if;
  definition := revised;

  -- 5.2 session_plans pull projection
  revised := replace(definition,
    $old$             'provenance', sp.provenance,
             'created_at', sp.created_at,$old$,
    $new$             'provenance', sp.provenance,
             'last_modified_by', sp.last_modified_by,
             'created_at', sp.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_pull: session_plans pull fields';
  end if;
  definition := revised;

  -- 5.3 session_plan_exercises pull projection
  revised := replace(definition,
    $old$             'resolved_at', spe.resolved_at,
             'created_at', spe.created_at,$old$,
    $new$             'resolved_at', spe.resolved_at,
             'last_modified_by', spe.last_modified_by,
             'created_at', spe.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_pull: session_plan_exercises pull fields';
  end if;
  definition := revised;

  -- 5.4 session_plan_sets pull projection
  revised := replace(definition,
    $old$             'target_set_type', sps.target_set_type,
             'created_at', sps.created_at,$old$,
    $new$             'target_set_type', sps.target_set_type,
             'last_modified_by', sps.last_modified_by,
             'created_at', sps.created_at,$new$);
  if revised = definition then
    raise exception 'failed to patch sync_pull: session_plan_sets pull fields';
  end if;

  execute revised;
end
$migration$;
