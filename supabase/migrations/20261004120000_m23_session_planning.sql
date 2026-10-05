-- =============================================================================
-- Session planning: synced session-plan schema and server contract.
--
-- Adds four synced planning entities (training_programmes, session_plans,
-- session_plan_exercises, session_plan_sets) and three performed-domain
-- provenance columns (sessions.source_plan_id,
-- session_exercises.source_plan_exercise_id, exercise_sets.source_plan_set_id),
-- expanding Sync v2 from twelve to sixteen entities across five layers.
--
-- Authoritative references:
--   docs/specs/tech/session-planning-contract.md §2, §3
--   docs/specs/tech/sync-v2-server-contract.md §A (server schema), §B (RPCs)
--
-- Decisions carried by this migration:
--   - No server CHECK constraints (v2 §A.1). The value/range/enum guards live
--     client-side in the Drizzle schema; the server enforces ownership (RLS),
--     referential integrity (deferrable FKs) and the cross-level provenance
--     invariant (deferred constraint trigger).
--   - `require_sync_protocol()` moves to protocol 4. An un-upgraded client
--     (protocol 3) is rejected with UPDATE_REQUIRED before any row moves, which
--     is required because the layer→type mapping changed (sessions L1->L2,
--     session_exercises L2->L3, exercise_sets L3->L4).
--   - The live sync functions are rewritten in place via guarded
--     `pg_get_functiondef` + `replace` so the historical migrations stay
--     immutable; each replacement raises if its anchor disappears.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New synced planning tables (parent -> child order).
-- -----------------------------------------------------------------------------

-- 1.1 training_programmes ---------------------------------------------------

create table app_public.training_programmes (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  description text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint training_programmes_pkey primary key (owner_user_id, id)
);
create index training_programmes_owner_received_idx
  on app_public.training_programmes (owner_user_id, server_received_at);
create index training_programmes_deleted_at_idx
  on app_public.training_programmes (deleted_at);
create trigger training_programmes_touch_server_received_at
  before update on app_public.training_programmes
  for each row when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger training_programmes_owner_user_id_immutable
  before update on app_public.training_programmes
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.training_programmes enable row level security;
create policy training_programmes_owner_select on app_public.training_programmes
  for select to authenticated using (owner_user_id = auth.uid());
create policy training_programmes_owner_insert on app_public.training_programmes
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy training_programmes_owner_update on app_public.training_programmes
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy training_programmes_owner_delete on app_public.training_programmes
  for delete to authenticated using (owner_user_id = auth.uid());
create policy training_programmes_direct_app_only on app_public.training_programmes
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);
grant select, insert, update, delete on app_public.training_programmes to authenticated, service_role;

-- 1.2 session_plans ---------------------------------------------------------

create table app_public.session_plans (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  programme_id text,
  programme_order_index integer,
  gym_id text,
  title text not null,
  scheduled_for bigint,
  provenance text not null default 'human',
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_plans_pkey primary key (owner_user_id, id),
  constraint session_plans_programme_fk
    foreign key (owner_user_id, programme_id)
    references app_public.training_programmes (owner_user_id, id)
    on delete set null (programme_id)
    deferrable initially deferred,
  constraint session_plans_gym_fk
    foreign key (owner_user_id, gym_id)
    references app_public.gyms (owner_user_id, id)
    on delete set null (gym_id)
    deferrable initially deferred
);
create index session_plans_owner_received_idx
  on app_public.session_plans (owner_user_id, server_received_at);
create index session_plans_programme_id_idx
  on app_public.session_plans (programme_id);
create index session_plans_gym_id_idx
  on app_public.session_plans (gym_id);
create index session_plans_scheduled_for_idx
  on app_public.session_plans (scheduled_for);
create index session_plans_deleted_at_idx
  on app_public.session_plans (deleted_at);
create index session_plans_programme_order_active_idx
  on app_public.session_plans (owner_user_id, programme_id, programme_order_index)
  where deleted_at is null;
create trigger session_plans_touch_server_received_at
  before update on app_public.session_plans
  for each row when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_plans_owner_user_id_immutable
  before update on app_public.session_plans
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.session_plans enable row level security;
create policy session_plans_owner_select on app_public.session_plans
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_plans_owner_insert on app_public.session_plans
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_plans_owner_update on app_public.session_plans
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_plans_owner_delete on app_public.session_plans
  for delete to authenticated using (owner_user_id = auth.uid());
create policy session_plans_direct_app_only on app_public.session_plans
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);
grant select, insert, update, delete on app_public.session_plans to authenticated, service_role;

-- 1.3 session_plan_exercises ------------------------------------------------

create table app_public.session_plan_exercises (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_plan_id text not null,
  exercise_definition_id text,
  order_index integer not null,
  name text not null,
  machine_name text,
  progress_status text not null default 'pending',
  resolved_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_plan_exercises_pkey primary key (owner_user_id, id),
  constraint session_plan_exercises_session_plan_fk
    foreign key (owner_user_id, session_plan_id)
    references app_public.session_plans (owner_user_id, id)
    on delete cascade
    deferrable initially deferred,
  constraint session_plan_exercises_exercise_definition_fk
    foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions (owner_user_id, id)
    on delete set null (exercise_definition_id)
    deferrable initially deferred
);
create index session_plan_exercises_owner_received_idx
  on app_public.session_plan_exercises (owner_user_id, server_received_at);
create index session_plan_exercises_session_plan_id_idx
  on app_public.session_plan_exercises (session_plan_id);
create index session_plan_exercises_exercise_definition_id_idx
  on app_public.session_plan_exercises (exercise_definition_id);
create index session_plan_exercises_deleted_at_idx
  on app_public.session_plan_exercises (deleted_at);
create index session_plan_exercises_plan_order_active_idx
  on app_public.session_plan_exercises (owner_user_id, session_plan_id, order_index)
  where deleted_at is null;
create trigger session_plan_exercises_touch_server_received_at
  before update on app_public.session_plan_exercises
  for each row when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_plan_exercises_owner_user_id_immutable
  before update on app_public.session_plan_exercises
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.session_plan_exercises enable row level security;
create policy session_plan_exercises_owner_select on app_public.session_plan_exercises
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_plan_exercises_owner_insert on app_public.session_plan_exercises
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_plan_exercises_owner_update on app_public.session_plan_exercises
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_plan_exercises_owner_delete on app_public.session_plan_exercises
  for delete to authenticated using (owner_user_id = auth.uid());
create policy session_plan_exercises_direct_app_only on app_public.session_plan_exercises
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);
grant select, insert, update, delete on app_public.session_plan_exercises to authenticated, service_role;

-- 1.4 session_plan_sets -----------------------------------------------------

create table app_public.session_plan_sets (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_plan_exercise_id text not null,
  order_index integer not null,
  target_weight_value text,
  target_reps integer not null,
  target_set_type text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_plan_sets_pkey primary key (owner_user_id, id),
  constraint session_plan_sets_session_plan_exercise_fk
    foreign key (owner_user_id, session_plan_exercise_id)
    references app_public.session_plan_exercises (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);
create index session_plan_sets_owner_received_idx
  on app_public.session_plan_sets (owner_user_id, server_received_at);
create index session_plan_sets_session_plan_exercise_id_idx
  on app_public.session_plan_sets (session_plan_exercise_id);
create index session_plan_sets_deleted_at_idx
  on app_public.session_plan_sets (deleted_at);
create index session_plan_sets_exercise_order_active_idx
  on app_public.session_plan_sets (owner_user_id, session_plan_exercise_id, order_index)
  where deleted_at is null;
create trigger session_plan_sets_touch_server_received_at
  before update on app_public.session_plan_sets
  for each row when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_plan_sets_owner_user_id_immutable
  before update on app_public.session_plan_sets
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.session_plan_sets enable row level security;
create policy session_plan_sets_owner_select on app_public.session_plan_sets
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_plan_sets_owner_insert on app_public.session_plan_sets
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_plan_sets_owner_update on app_public.session_plan_sets
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_plan_sets_owner_delete on app_public.session_plan_sets
  for delete to authenticated using (owner_user_id = auth.uid());
create policy session_plan_sets_direct_app_only on app_public.session_plan_sets
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);
grant select, insert, update, delete on app_public.session_plan_sets to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Performed-domain provenance columns, owner-scoped FKs and partial
--    uniqueness guards. Composite FKs keep every reference owner-scoped.
-- -----------------------------------------------------------------------------

alter table app_public.sessions add column source_plan_id text;
alter table app_public.sessions add constraint sessions_source_plan_fk
  foreign key (owner_user_id, source_plan_id)
  references app_public.session_plans (owner_user_id, id)
  on delete set null (source_plan_id)
  deferrable initially deferred;
create index sessions_source_plan_id_idx on app_public.sessions (source_plan_id);
create unique index sessions_owner_source_plan_unique
  on app_public.sessions (owner_user_id, source_plan_id)
  where deleted_at is null and source_plan_id is not null;

alter table app_public.session_exercises add column source_plan_exercise_id text;
alter table app_public.session_exercises add constraint session_exercises_source_plan_exercise_fk
  foreign key (owner_user_id, source_plan_exercise_id)
  references app_public.session_plan_exercises (owner_user_id, id)
  on delete set null (source_plan_exercise_id)
  deferrable initially deferred;
create index session_exercises_source_plan_exercise_id_idx
  on app_public.session_exercises (source_plan_exercise_id);
create unique index session_exercises_owner_source_block_unique
  on app_public.session_exercises (owner_user_id, source_plan_exercise_id)
  where deleted_at is null and source_plan_exercise_id is not null;

alter table app_public.exercise_sets add column source_plan_set_id text;
alter table app_public.exercise_sets add constraint exercise_sets_source_plan_set_fk
  foreign key (owner_user_id, source_plan_set_id)
  references app_public.session_plan_sets (owner_user_id, id)
  on delete set null (source_plan_set_id)
  deferrable initially deferred;
create index exercise_sets_source_plan_set_id_idx
  on app_public.exercise_sets (source_plan_set_id);
create unique index exercise_sets_owner_source_set_unique
  on app_public.exercise_sets (owner_user_id, source_plan_set_id)
  where deleted_at is null and source_plan_set_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Cross-level provenance invariant.
--
-- A performed set with source_plan_set_id IS NOT NULL must sit under the card
-- sourced from that plan set's parent block. Deferred so a sync_push batch may
-- land the set, its card and the plan graph in any order inside one
-- transaction; the check runs at SET CONSTRAINTS ALL IMMEDIATE. Rejects direct
-- writes and sync alike, atomically.
-- -----------------------------------------------------------------------------

create or replace function app_public.enforce_source_plan_set_provenance()
returns trigger
language plpgsql
set search_path = app_public, pg_temp
as $func$
declare
  _set_block   text;
  _card_source text;
begin
  if new.source_plan_set_id is null then
    return null;
  end if;

  select sps.session_plan_exercise_id
    into _set_block
    from app_public.session_plan_sets sps
   where sps.owner_user_id = new.owner_user_id
     and sps.id = new.source_plan_set_id;

  select se.source_plan_exercise_id
    into _card_source
    from app_public.session_exercises se
   where se.owner_user_id = new.owner_user_id
     and se.id = new.session_exercise_id;

  if _set_block is null or _card_source is null or _card_source is distinct from _set_block then
    raise exception
      'PROVENANCE_VIOLATION: exercise_sets.source_plan_set_id % is not under the source block of its session_exercise card',
      coalesce(new.source_plan_set_id, '<null>')
      using errcode = 'P0001';
  end if;

  return null;
end;
$func$;

comment on function app_public.enforce_source_plan_set_provenance() is
  'Sync v2 session planning: deferred constraint trigger body rejecting a performed set whose source_plan_set_id is not under its card''s source block. See docs/specs/tech/session-planning-contract.md §2.2.';

create constraint trigger exercise_sets_source_plan_provenance
  after insert or update on app_public.exercise_sets
  deferrable initially deferred
  for each row
  execute function app_public.enforce_source_plan_set_provenance();

-- The set-side check above only fires when the set changes. A newer push can
-- instead change a parent — the card's source block, or a plan set's parent
-- block — and leave an existing source-derived set across two different blocks.
-- These two deferred triggers re-check the dependents on such a parent change,
-- so an invalid graph can never commit.

create or replace function app_public.enforce_card_source_plan_provenance()
returns trigger
language plpgsql
set search_path = app_public, pg_temp
as $func$
declare
  _orphan text;
begin
  select es.id
    into _orphan
    from app_public.exercise_sets es
    join app_public.session_plan_sets sps
      on sps.owner_user_id = es.owner_user_id
     and sps.id = es.source_plan_set_id
   where es.owner_user_id = new.owner_user_id
     and es.session_exercise_id = new.id
     and es.deleted_at is null
     and es.source_plan_set_id is not null
     and sps.session_plan_exercise_id is distinct from new.source_plan_exercise_id
   limit 1;

  if _orphan is not null then
    raise exception
      'PROVENANCE_VIOLATION: session_exercises.source_plan_exercise_id % would orphan source-derived set %',
      coalesce(new.source_plan_exercise_id, '<null>'), _orphan
      using errcode = 'P0001';
  end if;

  return null;
end;
$func$;

comment on function app_public.enforce_card_source_plan_provenance() is
  'Sync v2 session planning: deferred constraint trigger rejecting a card source-block change that would leave an existing source-derived set across two blocks.';

create constraint trigger session_exercises_source_plan_provenance
  after update on app_public.session_exercises
  deferrable initially deferred
  for each row
  when (old.source_plan_exercise_id is distinct from new.source_plan_exercise_id)
  execute function app_public.enforce_card_source_plan_provenance();

create or replace function app_public.enforce_plan_set_source_plan_provenance()
returns trigger
language plpgsql
set search_path = app_public, pg_temp
as $func$
declare
  _orphan text;
begin
  select es.id
    into _orphan
    from app_public.exercise_sets es
    join app_public.session_exercises se
      on se.owner_user_id = es.owner_user_id
     and se.id = es.session_exercise_id
   where es.owner_user_id = new.owner_user_id
     and es.source_plan_set_id = new.id
     and es.deleted_at is null
     and se.source_plan_exercise_id is distinct from new.session_plan_exercise_id
   limit 1;

  if _orphan is not null then
    raise exception
      'PROVENANCE_VIOLATION: session_plan_sets.session_plan_exercise_id change would orphan source-derived set %',
      _orphan
      using errcode = 'P0001';
  end if;

  return null;
end;
$func$;

comment on function app_public.enforce_plan_set_source_plan_provenance() is
  'Sync v2 session planning: deferred constraint trigger rejecting a plan-set reparent that would leave an existing source-derived set across two blocks.';

create constraint trigger session_plan_sets_source_plan_provenance
  after update on app_public.session_plan_sets
  deferrable initially deferred
  for each row
  when (old.session_plan_exercise_id is distinct from new.session_plan_exercise_id)
  execute function app_public.enforce_plan_set_source_plan_provenance();

-- -----------------------------------------------------------------------------
-- 4. Protocol 4. The layer→type mapping changed, so an un-upgraded client must
--    stop before it pulls the wrong types per layer.
-- -----------------------------------------------------------------------------

create or replace function app_public.require_sync_protocol()
returns void
language plpgsql
stable
set search_path = ''
as $func$
declare
  protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-sync-protocol','');
begin
  if protocol !~ '^[0-9]{1,6}$' or protocol::integer <> 4 then
    raise exception 'UPDATE_REQUIRED: Update BoGa to continue syncing.' using errcode='P0001';
  end if;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 5. Patch sync_push: new columns on the three performed tables and four new
--    entity branches. Guarded so a baseline change fails loudly.
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised    text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  -- sessions insert columns
  revised := replace(definition,
    $anchor$        gym_id, status, started_at, completed_at, duration_sec,$anchor$,
    $patch$        gym_id, source_plan_id, status, started_at, completed_at, duration_sec,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: sessions insert columns'; end if;
  definition := revised;

  -- sessions insert values
  revised := replace(definition,
    $anchor$        _fields ->> 'gym_id',
        _fields ->> 'status',$anchor$,
    $patch$        _fields ->> 'gym_id',
        _fields ->> 'source_plan_id',
        _fields ->> 'status',$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: sessions insert values'; end if;
  definition := revised;

  -- sessions conflict update
  revised := replace(definition,
    $anchor$        set gym_id               = excluded.gym_id,
            status               = excluded.status,$anchor$,
    $patch$        set gym_id               = excluded.gym_id,
            source_plan_id       = excluded.source_plan_id,
            status               = excluded.status,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: sessions conflict update'; end if;
  definition := revised;

  -- session_exercises insert columns
  revised := replace(definition,
    $anchor$        session_id, exercise_definition_id, order_index, name, machine_name,$anchor$,
    $patch$        session_id, exercise_definition_id, source_plan_exercise_id, order_index, name, machine_name,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: session_exercises insert columns'; end if;
  definition := revised;

  -- session_exercises insert values
  revised := replace(definition,
    $anchor$        _fields ->> 'session_id',
        _fields ->> 'exercise_definition_id',
        (_fields ->> 'order_index')::integer,$anchor$,
    $patch$        _fields ->> 'session_id',
        _fields ->> 'exercise_definition_id',
        _fields ->> 'source_plan_exercise_id',
        (_fields ->> 'order_index')::integer,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: session_exercises insert values'; end if;
  definition := revised;

  -- session_exercises conflict update
  revised := replace(definition,
    $anchor$        set session_id             = excluded.session_id,
            exercise_definition_id = excluded.exercise_definition_id,
            order_index            = excluded.order_index,$anchor$,
    $patch$        set session_id             = excluded.session_id,
            exercise_definition_id = excluded.exercise_definition_id,
            source_plan_exercise_id = excluded.source_plan_exercise_id,
            order_index            = excluded.order_index,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: session_exercises conflict update'; end if;
  definition := revised;

  -- exercise_sets insert columns
  revised := replace(definition,
    $anchor$        owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,$anchor$,
    $patch$        owner_user_id,id,session_exercise_id,source_plan_set_id,order_index,weight_value,reps_value,set_type,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: exercise_sets insert columns'; end if;
  definition := revised;

  -- exercise_sets insert values
  revised := replace(definition,
    $anchor$        _uid,_id,_fields->>'session_exercise_id',(_fields->>'order_index')::integer,$anchor$,
    $patch$        _uid,_id,_fields->>'session_exercise_id',_fields->>'source_plan_set_id',(_fields->>'order_index')::integer,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: exercise_sets insert values'; end if;
  definition := revised;

  -- exercise_sets conflict update
  revised := replace(definition,
    $anchor$        session_exercise_id=excluded.session_exercise_id,order_index=excluded.order_index,$anchor$,
    $patch$        session_exercise_id=excluded.session_exercise_id,source_plan_set_id=excluded.source_plan_set_id,order_index=excluded.order_index,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: exercise_sets conflict update'; end if;
  definition := revised;

  -- four new entity branches, before the unknown-type else
  revised := replace(definition,
    $anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$,
    $patch$    elsif _type = 'training_programmes' then
      insert into app_public.training_programmes (
        owner_user_id, id, name, description,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        _fields ->> 'description',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                 = excluded.name,
            description          = excluded.description,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.training_programmes.client_updated_at_ms;

    elsif _type = 'session_plans' then
      insert into app_public.session_plans (
        owner_user_id, id,
        programme_id, programme_order_index, gym_id, title, scheduled_for, provenance,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'programme_id',
        (_fields ->> 'programme_order_index')::integer,
        _fields ->> 'gym_id',
        _fields ->> 'title',
        (_fields ->> 'scheduled_for')::bigint,
        coalesce(_fields ->> 'provenance', 'human'),
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set programme_id          = excluded.programme_id,
            programme_order_index = excluded.programme_order_index,
            gym_id                = excluded.gym_id,
            title                 = excluded.title,
            scheduled_for         = excluded.scheduled_for,
            provenance            = excluded.provenance,
            created_at            = excluded.created_at,
            updated_at            = excluded.updated_at,
            deleted_at            = excluded.deleted_at,
            client_updated_at_ms  = excluded.client_updated_at_ms,
            server_received_at    = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plans.client_updated_at_ms;

    elsif _type = 'session_plan_exercises' then
      insert into app_public.session_plan_exercises (
        owner_user_id, id,
        session_plan_id, exercise_definition_id, order_index, name, machine_name,
        progress_status, resolved_at,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_plan_id',
        _fields ->> 'exercise_definition_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'name',
        _fields ->> 'machine_name',
        coalesce(_fields ->> 'progress_status', 'pending'),
        (_fields ->> 'resolved_at')::bigint,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_plan_id        = excluded.session_plan_id,
            exercise_definition_id = excluded.exercise_definition_id,
            order_index            = excluded.order_index,
            name                   = excluded.name,
            machine_name           = excluded.machine_name,
            progress_status        = excluded.progress_status,
            resolved_at            = excluded.resolved_at,
            created_at             = excluded.created_at,
            updated_at             = excluded.updated_at,
            deleted_at             = excluded.deleted_at,
            client_updated_at_ms   = excluded.client_updated_at_ms,
            server_received_at     = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plan_exercises.client_updated_at_ms;

    elsif _type = 'session_plan_sets' then
      insert into app_public.session_plan_sets (
        owner_user_id, id,
        session_plan_exercise_id, order_index, target_weight_value, target_reps, target_set_type,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_plan_exercise_id',
        (_fields ->> 'order_index')::integer,
        _fields ->> 'target_weight_value',
        (_fields ->> 'target_reps')::integer,
        _fields ->> 'target_set_type',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_plan_exercise_id = excluded.session_plan_exercise_id,
            order_index              = excluded.order_index,
            target_weight_value      = excluded.target_weight_value,
            target_reps              = excluded.target_reps,
            target_set_type          = excluded.target_set_type,
            created_at               = excluded.created_at,
            updated_at               = excluded.updated_at,
            deleted_at               = excluded.deleted_at,
            client_updated_at_ms     = excluded.client_updated_at_ms,
            server_received_at       = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.session_plan_sets.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_push: new entity branches'; end if;

  execute revised;
end
$migration$;

-- -----------------------------------------------------------------------------
-- 6. Patch sync_pull: layer→type mapping, cursor type list, new columns and
--    four new projections.
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised    text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;

  -- cursor valid-type list
  revised := replace(definition,
    $anchor$      'exercise_group_links', 'user_settings', 'body_weight_measurements'
    ) then$anchor$,
    $patch$      'exercise_group_links', 'user_settings', 'body_weight_measurements',
      'training_programmes', 'session_plans', 'session_plan_exercises', 'session_plan_sets'
    ) then$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: cursor type list'; end if;
  definition := revised;

  -- layer → types
  revised := replace(definition,
    $anchor$  case v_layer
    when 0 then v_types := array['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings'];
    when 1 then v_types := array['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'];
    when 2 then v_types := array['session_exercises'];
    when 3 then v_types := array['exercise_sets', 'session_exercise_tags'];
    when 4 then v_types := array['body_weight_measurements'];
  end case;$anchor$,
    $patch$  case v_layer
    when 0 then v_types := array['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings', 'training_programmes'];
    when 1 then v_types := array['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'];
    when 2 then v_types := array['sessions', 'session_plan_exercises'];
    when 3 then v_types := array['session_exercises', 'session_plan_sets'];
    when 4 then v_types := array['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'];
  end case;$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: layer types'; end if;
  definition := revised;

  -- sessions projection
  revised := replace(definition,
    $anchor$             'gym_id', s.gym_id,
             'status', s.status,$anchor$,
    $patch$             'gym_id', s.gym_id,
             'source_plan_id', s.source_plan_id,
             'status', s.status,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: sessions projection'; end if;
  definition := revised;

  -- session_exercises projection
  revised := replace(definition,
    $anchor$             'session_id', sx.session_id,
             'exercise_definition_id', sx.exercise_definition_id,
             'order_index', sx.order_index,$anchor$,
    $patch$             'session_id', sx.session_id,
             'exercise_definition_id', sx.exercise_definition_id,
             'source_plan_exercise_id', sx.source_plan_exercise_id,
             'order_index', sx.order_index,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: session_exercises projection'; end if;
  definition := revised;

  -- exercise_sets projection
  revised := replace(definition,
    $anchor$             'session_exercise_id', es.session_exercise_id,
             'order_index', es.order_index,$anchor$,
    $patch$             'session_exercise_id', es.session_exercise_id,
             'source_plan_set_id', es.source_plan_set_id,
             'order_index', es.order_index,$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: exercise_sets projection'; end if;
  definition := revised;

  -- four new projections before the closing of all_rows
  revised := replace(definition,
    $anchor$     where bw.owner_user_id = auth.uid()
       and 'body_weight_measurements' = any(v_types)
  ),$anchor$,
    $patch$     where bw.owner_user_id = auth.uid()
       and 'body_weight_measurements' = any(v_types)
    union all
    select 'training_programmes'::text, tp.id, tp.client_updated_at_ms,
           tp.server_received_at, tp.owner_user_id,
           jsonb_build_object(
             'name', tp.name,
             'description', tp.description,
             'created_at', tp.created_at,
             'updated_at', tp.updated_at,
             'deleted_at', tp.deleted_at
           )
      from app_public.training_programmes tp
     where tp.owner_user_id = auth.uid()
       and 'training_programmes' = any(v_types)
    union all
    select 'session_plans'::text, sp.id, sp.client_updated_at_ms,
           sp.server_received_at, sp.owner_user_id,
           jsonb_build_object(
             'programme_id', sp.programme_id,
             'programme_order_index', sp.programme_order_index,
             'gym_id', sp.gym_id,
             'title', sp.title,
             'scheduled_for', sp.scheduled_for,
             'provenance', sp.provenance,
             'created_at', sp.created_at,
             'updated_at', sp.updated_at,
             'deleted_at', sp.deleted_at
           )
      from app_public.session_plans sp
     where sp.owner_user_id = auth.uid()
       and 'session_plans' = any(v_types)
    union all
    select 'session_plan_exercises'::text, spe.id, spe.client_updated_at_ms,
           spe.server_received_at, spe.owner_user_id,
           jsonb_build_object(
             'session_plan_id', spe.session_plan_id,
             'exercise_definition_id', spe.exercise_definition_id,
             'order_index', spe.order_index,
             'name', spe.name,
             'machine_name', spe.machine_name,
             'progress_status', spe.progress_status,
             'resolved_at', spe.resolved_at,
             'created_at', spe.created_at,
             'updated_at', spe.updated_at,
             'deleted_at', spe.deleted_at
           )
      from app_public.session_plan_exercises spe
     where spe.owner_user_id = auth.uid()
       and 'session_plan_exercises' = any(v_types)
    union all
    select 'session_plan_sets'::text, sps.id, sps.client_updated_at_ms,
           sps.server_received_at, sps.owner_user_id,
           jsonb_build_object(
             'session_plan_exercise_id', sps.session_plan_exercise_id,
             'order_index', sps.order_index,
             'target_weight_value', sps.target_weight_value,
             'target_reps', sps.target_reps,
             'target_set_type', sps.target_set_type,
             'created_at', sps.created_at,
             'updated_at', sps.updated_at,
             'deleted_at', sps.deleted_at
           )
      from app_public.session_plan_sets sps
     where sps.owner_user_id = auth.uid()
       and 'session_plan_sets' = any(v_types)
  ),$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch sync_pull: new projections'; end if;

  execute revised;
end
$migration$;

-- -----------------------------------------------------------------------------
-- 7. Patch dev_wipe_my_data: add the four planning tables (child-first).
-- -----------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised    text;
begin
  select pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure) into definition;

  revised := replace(definition,
    $anchor$  delete from app_public.session_exercises where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.user_settings where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.session_exercises where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_plan_sets where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_plan_exercises where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_plans where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.training_programmes where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.user_settings where owner_user_id = _uid;$patch$);
  if revised = definition then raise exception 'The planning migration failed to patch dev_wipe_my_data: planning tables'; end if;

  execute revised;
end
$migration$;
