-- M25-T03: exercise_group_links — the tenth Sync v2 entity.
--
-- Authoritative reference: docs/specs/tech/sync-v2-server-contract.md §A.2.10.
-- A member's link from one of their own exercise_definitions rows to a group
-- exercise. It is the member's own data, so it mirrors the other nine entities
-- exactly: composite PK (owner_user_id, id), owner-only RLS plus the restrictive
-- direct-app-only policy, the two structural triggers, and sync_push/sync_pull
-- wiring.
--
--   - exercise_definition_id is a composite FK into exercise_definitions (a
--     synced Layer-0 parent), `on delete no action` — the same rule as
--     session_exercises.exercise_definition_id.
--   - group_id / group_exercise_id are plain text with NO FK: group tables are
--     not synced parents, and Sync v2 must not depend on them.
--   - The client derives the id as `<group_id>:<exercise_definition_id>`, so
--     "one group exercise per personal exercise per group" holds without a
--     server constraint. Unlink is a tombstone; relink undeletes the same id
--     (§A.1.1.3).
--   - Pull layer 1 (after exercise_definitions). No server reaction yet: the
--     evaluator enqueue trigger lands with M25-T04.

-- -----------------------------------------------------------------------------
-- 1. Table, indexes, structural triggers.
-- -----------------------------------------------------------------------------

create table app_public.exercise_group_links (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  exercise_definition_id text not null,
  group_id text not null,
  group_exercise_id text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint exercise_group_links_pkey primary key (owner_user_id, id),
  constraint exercise_group_links_exercise_definition_fk
    foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions (owner_user_id, id)
    on delete no action
    deferrable initially deferred
);

create index exercise_group_links_owner_received_idx
  on app_public.exercise_group_links (owner_user_id, server_received_at);
create index exercise_group_links_exercise_definition_id_idx
  on app_public.exercise_group_links (exercise_definition_id);
create index exercise_group_links_group_exercise_id_idx
  on app_public.exercise_group_links (group_exercise_id);
create index exercise_group_links_deleted_at_idx
  on app_public.exercise_group_links (deleted_at);

create trigger exercise_group_links_touch_server_received_at
  before update on app_public.exercise_group_links
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger exercise_group_links_owner_user_id_immutable
  before update on app_public.exercise_group_links
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

-- -----------------------------------------------------------------------------
-- 2. RLS (§A.6.1 universal shape) and grants.
-- -----------------------------------------------------------------------------

alter table app_public.exercise_group_links enable row level security;
create policy exercise_group_links_owner_select on app_public.exercise_group_links
  for select to authenticated using (owner_user_id = auth.uid());
create policy exercise_group_links_owner_insert on app_public.exercise_group_links
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy exercise_group_links_owner_update on app_public.exercise_group_links
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy exercise_group_links_owner_delete on app_public.exercise_group_links
  for delete to authenticated using (owner_user_id = auth.uid());
create policy exercise_group_links_direct_app_only on app_public.exercise_group_links
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

grant select, insert, update, delete on table app_public.exercise_group_links to authenticated;
grant select, insert, update, delete on table app_public.exercise_group_links to service_role;

-- -----------------------------------------------------------------------------
-- 3. Wire the entity into sync_push, sync_pull, and dev_wipe_my_data.
--
-- Same compact, guarded-patch approach as M19: each replacement targets text
-- installed by the latest baseline, and a no-op replacement fails the migration
-- instead of silently leaving an asymmetric wire contract.
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  revised := replace(
    definition,
    $anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$,
    $branch$    elsif _type = 'exercise_group_links' then
      insert into app_public.exercise_group_links (
        owner_user_id, id,
        exercise_definition_id, group_id, group_exercise_id,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'exercise_definition_id',
        _fields ->> 'group_id',
        _fields ->> 'group_exercise_id',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set exercise_definition_id = excluded.exercise_definition_id,
            group_id               = excluded.group_id,
            group_exercise_id      = excluded.group_exercise_id,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_group_links.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$branch$
  );
  if revised = definition then
    raise exception 'M25-T03 failed to patch sync_push with the exercise_group_links branch';
  end if;
  execute revised;
end
$migration$;

do $migration$
declare
  definition text;
  revised text;
  step text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  revised := definition;

  -- 3a. The cursor `type` allow-list.
  step := replace(
    revised,
    $anchor$'session_exercises', 'exercise_sets', 'session_exercise_tags'
    ) then$anchor$,
    $patch$'session_exercises', 'exercise_sets', 'session_exercise_tags',
      'exercise_group_links'
    ) then$patch$
  );
  if step = revised then
    raise exception 'M25-T03 failed to patch sync_pull cursor type allow-list';
  end if;
  revised := step;

  -- 3b. Layer 1 gains exercise_group_links (its only FK parent,
  -- exercise_definitions, is Layer 0).
  step := replace(
    revised,
    $anchor$when 1 then v_types := array['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions'];$anchor$,
    $patch$when 1 then v_types := array['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'];$patch$
  );
  if step = revised then
    raise exception 'M25-T03 failed to patch sync_pull layer 1 type set';
  end if;
  revised := step;

  -- 3c. The UNION ALL leg projecting the wire envelope (§B.2.1).
  step := replace(
    revised,
    $anchor$       and 'session_exercise_tags' = any(v_types)
  ),$anchor$,
    $patch$       and 'session_exercise_tags' = any(v_types)
    union all
    select 'exercise_group_links'::text, egl.id, egl.client_updated_at_ms,
           egl.server_received_at, egl.owner_user_id,
           jsonb_build_object(
             'exercise_definition_id', egl.exercise_definition_id,
             'group_id', egl.group_id,
             'group_exercise_id', egl.group_exercise_id,
             'created_at', egl.created_at,
             'updated_at', egl.updated_at,
             'deleted_at', egl.deleted_at
           )
      from app_public.exercise_group_links egl
     where egl.owner_user_id = auth.uid()
       and 'exercise_group_links' = any(v_types)
  ),$patch$
  );
  if step = revised then
    raise exception 'M25-T03 failed to patch sync_pull union with exercise_group_links';
  end if;
  execute step;
end
$migration$;

-- dev_wipe_my_data deletes child-before-parent; links must go before
-- exercise_definitions, whose `no action` FK would otherwise block the wipe.
do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure) into definition;
  revised := replace(
    definition,
    $anchor$  delete from app_public.exercise_muscle_mappings where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.exercise_group_links where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_muscle_mappings where owner_user_id = _uid;$patch$
  );
  if revised = definition then
    raise exception 'M25-T03 failed to patch dev_wipe_my_data with exercise_group_links';
  end if;
  execute revised;
end
$migration$;
