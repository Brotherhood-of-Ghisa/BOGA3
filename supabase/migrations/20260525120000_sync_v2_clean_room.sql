-- =============================================================================
-- Sync v2 clean-room migration.
--
-- Authoritative reference: docs/specs/tech/sync-v2-server-contract.md (Part A,
-- server schema). This single migration:
--
--   1. Drops every v1 sync server object — the M13/M14 projection function
--      family, the sync-events ingest RPC + impl, the in-flight strict variant
--      from M15-era idempotency patch, the M15 gym-coordinates trigger and
--      validation helper, the device/ingested-events tables, and the eight
--      legacy entity tables from the user-scoped PK redesign.
--   2. Recreates the per-user app_public.<entity> tables with composite
--      (owner_user_id, id) PKs, universal sync columns (client_updated_at_ms,
--      server_received_at, deleted_at), and zero CHECK constraints (§A.1).
--   3. Declares the cross-entity FKs as composite, DEFERRABLE INITIALLY
--      DEFERRED references per §A.5.
--   4. Adds universal owner/received-at indexes plus per-entity btree and
--      partial WHERE-deleted_at-IS-NULL indexes per §A.2.
--   5. Installs the two universal triggers per entity (touch-server-received-at,
--      owner-immutability) and redefines the immutability function body to the
--      NULL-safe canonical form in §A.6.3.
--   6. Enables RLS and creates the four owner-scoped policies per §A.6.1.
--   7. Grants select/insert/update/delete on every entity table to
--      authenticated and service_role.
--
-- There is no rollback path: the hosted DB is wiped post-merge (§A.1, "Hard
-- cut from v1"). Reverting this migration is not a supported operation; reset
-- the local stack and re-apply the migration tree from scratch instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Drop v1 sync server objects.
--
-- Order: triggers first (they hold references to functions), then projection
-- functions, then the sync-state tables, then the eight legacy entity tables.
-- `cascade` is used on tables so any lingering policy / FK / trigger drops too.
-- `if exists` keeps the migration idempotent on a fresh DB that never had v1.
-- -----------------------------------------------------------------------------

-- M15 trigger on sync_ingested_events (would block dropping the table without
-- cascade, but spelled explicitly for clarity).
drop trigger if exists sync_ingested_events_apply_gym_coordinates
  on app_public.sync_ingested_events;
drop function if exists app_public.sync_apply_gym_coordinates_from_ingested_event();

-- M13/M14/M15-era projection wrappers and impl.
drop function if exists app_public.sync_events_ingest(text, text, bigint, jsonb);
drop function if exists app_public.sync_events_ingest_impl(text, text, bigint, jsonb);
drop function if exists app_public.sync_apply_projection_event(uuid, text, text, text, bigint, jsonb);
drop function if exists app_public.sync_apply_projection_event_strict_20260515190609(uuid, text, text, text, bigint, jsonb);
drop function if exists app_public.sync_ingest_failure(integer, boolean, text, text);

-- Sync-state tables (M13).
drop table if exists app_public.sync_ingested_events cascade;
drop table if exists app_public.sync_device_ingest_state cascade;

-- The legacy entity tables (M5/M13/M14/M15/user-scoped-PK redesign).
-- Drop child-first to make the intent readable; `cascade` covers FKs in any
-- order regardless. muscle_groups is dropped after its child
-- exercise_muscle_mappings (the mappings row references a muscle_groups parent).
drop table if exists app_public.session_exercise_tags cascade;
drop table if exists app_public.exercise_tag_definitions cascade;
drop table if exists app_public.exercise_muscle_mappings cascade;
drop table if exists app_public.muscle_groups cascade;
drop table if exists app_public.exercise_sets cascade;
drop table if exists app_public.session_exercises cascade;
drop table if exists app_public.sessions cascade;
drop table if exists app_public.exercise_definitions cascade;
drop table if exists app_public.gyms cascade;

-- -----------------------------------------------------------------------------
-- 2. Redefine the owner-immutability function to the canonical §A.6.3 body.
--
-- The pre-existing body in M5 used `<>` and had no auth.uid()-is-null guard,
-- which left a silent RLS-bypass path open under three-valued logic. The v2
-- body uses IS DISTINCT FROM and refuses the write outright when auth.uid()
-- is NULL. Verbatim from §A.6.3 of the server contract.
-- -----------------------------------------------------------------------------

create or replace function app_public.enforce_owner_user_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'auth.uid() is NULL; owner_user_id check cannot proceed';
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id is immutable';
  end if;
  return new;
end;
$$;

comment on function app_public.enforce_owner_user_id_immutable() is
  'Sync v2: BEFORE UPDATE trigger guarding owner_user_id against silent re-homing. NULL-safe per the server contract §A.6.3.';

-- Shared touch-server-received-at trigger function. Stamps now() onto every
-- non-no-op UPDATE so the pull cursor (server_received_at) advances. INSERT
-- is covered by the column default; this function is only attached to UPDATE.
-- The WHEN clause on the per-table trigger declarations below filters no-op
-- UPDATEs (NEW IS NOT DISTINCT FROM OLD) so a defensive same-row UPDATE never
-- bumps the cursor.
create or replace function app_public.touch_server_received_at()
returns trigger
language plpgsql
as $$
begin
  new.server_received_at := now();
  return new;
end;
$$;

comment on function app_public.touch_server_received_at() is
  'Sync v2: BEFORE UPDATE trigger stamping server_received_at = now() on every cursor-affecting change. Paired with a NEW IS DISTINCT FROM OLD WHEN clause per the server contract §A.2.';

-- -----------------------------------------------------------------------------
-- 3. Create the v2 entity tables (parent -> child order). All FKs are
--    composite, DEFERRABLE INITIALLY DEFERRED per §A.5. No CHECK
--    constraints anywhere (§A.1, "no server validation").
--
-- Note on gyms latitude/longitude/coordinate columns: the canonical §A.2.1
-- mapping carries them because the v1 m15 migration added them and the client
-- Drizzle schema (apps/mobile/src/data/schema/gyms.ts) carries them. To keep
-- the v2 server aligned with the client (§A.1, "Server schema mirrors client"),
-- the columns are preserved here as typed nullable columns with no CHECK
-- constraints (per the v2 no-server-validation rule).
-- -----------------------------------------------------------------------------

-- 3.1 gyms ------------------------------------------------------------------

create table app_public.gyms (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  latitude double precision,
  longitude double precision,
  coordinate_accuracy_m double precision,
  coordinates_updated_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint gyms_pkey primary key (owner_user_id, id)
);

create index gyms_owner_received_idx
  on app_public.gyms (owner_user_id, server_received_at);
create index gyms_name_idx on app_public.gyms (name);
create index gyms_deleted_at_idx on app_public.gyms (deleted_at);

-- 3.2 exercise_definitions --------------------------------------------------

create table app_public.exercise_definitions (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint exercise_definitions_pkey primary key (owner_user_id, id)
);

create index exercise_definitions_owner_received_idx
  on app_public.exercise_definitions (owner_user_id, server_received_at);
create index exercise_definitions_name_idx
  on app_public.exercise_definitions (name);
create index exercise_definitions_deleted_at_idx
  on app_public.exercise_definitions (deleted_at);

-- 3.2b muscle_groups --------------------------------------------------------
-- Per-user synced taxonomy, structurally a clone of exercise_definitions with
-- the taxonomy scalars (display_name/family_name/sort_order/is_editable). It is
-- a Layer-0 parent (no FK dependencies) and is the FK target of
-- exercise_muscle_mappings.muscle_group_id (created below, so this table must
-- precede it). Zero CHECK constraints (the no-server-validation rule); the
-- sort-order and is_editable guards are client-side only.

create table app_public.muscle_groups (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  display_name text not null,
  family_name text not null,
  sort_order integer not null,
  is_editable integer not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint muscle_groups_pkey primary key (owner_user_id, id)
);

create index muscle_groups_owner_received_idx
  on app_public.muscle_groups (owner_user_id, server_received_at);
create index muscle_groups_family_name_idx
  on app_public.muscle_groups (family_name);
create index muscle_groups_sort_order_idx
  on app_public.muscle_groups (sort_order);
create index muscle_groups_display_name_idx
  on app_public.muscle_groups (display_name);
create index muscle_groups_deleted_at_idx
  on app_public.muscle_groups (deleted_at);

-- 3.3 exercise_tag_definitions ----------------------------------------------

create table app_public.exercise_tag_definitions (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  exercise_definition_id text not null,
  name text not null,
  normalized_name text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint exercise_tag_definitions_pkey primary key (owner_user_id, id),
  constraint exercise_tag_definitions_exercise_definition_fk
    foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);

create index exercise_tag_definitions_owner_received_idx
  on app_public.exercise_tag_definitions (owner_user_id, server_received_at);
create index exercise_tag_definitions_exercise_definition_id_idx
  on app_public.exercise_tag_definitions (exercise_definition_id);
create index exercise_tag_definitions_deleted_at_idx
  on app_public.exercise_tag_definitions (deleted_at);
create index exercise_tag_definitions_exercise_normalized_active_idx
  on app_public.exercise_tag_definitions
    (owner_user_id, exercise_definition_id, normalized_name)
  where deleted_at is null;

-- 3.4 sessions --------------------------------------------------------------

create table app_public.sessions (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  gym_id text,
  status text not null default 'active',
  started_at bigint not null,
  completed_at bigint,
  duration_sec integer,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint sessions_pkey primary key (owner_user_id, id),
  constraint sessions_gym_fk
    foreign key (owner_user_id, gym_id)
    references app_public.gyms (owner_user_id, id)
    on delete set null
    deferrable initially deferred
);

create index sessions_owner_received_idx
  on app_public.sessions (owner_user_id, server_received_at);
create index sessions_gym_id_idx on app_public.sessions (gym_id);
create index sessions_status_idx on app_public.sessions (status);
create index sessions_completed_at_idx on app_public.sessions (completed_at);
create index sessions_deleted_at_idx on app_public.sessions (deleted_at);

-- 3.5 exercise_muscle_mappings ----------------------------------------------
-- muscle_group_id is a real composite FK into the per-user muscle_groups
-- taxonomy (owner_user_id, muscle_group_id) -> muscle_groups(owner_user_id, id).
-- muscle_groups is a synced Layer-0 entity, so this is a legitimate
-- synced-parent FK, not opaque text.

create table app_public.exercise_muscle_mappings (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  exercise_definition_id text not null,
  muscle_group_id text not null,
  weight double precision not null,
  role text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint exercise_muscle_mappings_pkey primary key (owner_user_id, id),
  constraint exercise_muscle_mappings_exercise_definition_fk
    foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions (owner_user_id, id)
    on delete cascade
    deferrable initially deferred,
  constraint exercise_muscle_mappings_muscle_group_fk
    foreign key (owner_user_id, muscle_group_id)
    references app_public.muscle_groups (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);

create index exercise_muscle_mappings_owner_received_idx
  on app_public.exercise_muscle_mappings (owner_user_id, server_received_at);
create index exercise_muscle_mappings_exercise_definition_id_idx
  on app_public.exercise_muscle_mappings (exercise_definition_id);
create index exercise_muscle_mappings_muscle_group_id_idx
  on app_public.exercise_muscle_mappings (muscle_group_id);
create index exercise_muscle_mappings_deleted_at_idx
  on app_public.exercise_muscle_mappings (deleted_at);
create index exercise_muscle_mappings_exercise_muscle_idx
  on app_public.exercise_muscle_mappings
    (owner_user_id, exercise_definition_id, muscle_group_id);

-- 3.6 session_exercises -----------------------------------------------------

create table app_public.session_exercises (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_id text not null,
  exercise_definition_id text,
  order_index integer not null,
  name text not null,
  machine_name text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_exercises_pkey primary key (owner_user_id, id),
  constraint session_exercises_session_fk
    foreign key (owner_user_id, session_id)
    references app_public.sessions (owner_user_id, id)
    on delete cascade
    deferrable initially deferred,
  constraint session_exercises_exercise_definition_fk
    foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions (owner_user_id, id)
    on delete no action
    deferrable initially deferred
);

create index session_exercises_owner_received_idx
  on app_public.session_exercises (owner_user_id, server_received_at);
create index session_exercises_session_id_idx
  on app_public.session_exercises (session_id);
create index session_exercises_exercise_definition_id_idx
  on app_public.session_exercises (exercise_definition_id);
create index session_exercises_deleted_at_idx
  on app_public.session_exercises (deleted_at);
create index session_exercises_session_order_active_idx
  on app_public.session_exercises
    (owner_user_id, session_id, order_index)
  where deleted_at is null;

-- 3.7 exercise_sets ---------------------------------------------------------

create table app_public.exercise_sets (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_exercise_id text not null,
  order_index integer not null,
  weight_value text not null default '',
  reps_value text not null default '',
  set_type text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint exercise_sets_pkey primary key (owner_user_id, id),
  constraint exercise_sets_session_exercise_fk
    foreign key (owner_user_id, session_exercise_id)
    references app_public.session_exercises (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);

create index exercise_sets_owner_received_idx
  on app_public.exercise_sets (owner_user_id, server_received_at);
create index exercise_sets_session_exercise_id_idx
  on app_public.exercise_sets (session_exercise_id);
create index exercise_sets_deleted_at_idx
  on app_public.exercise_sets (deleted_at);
create index exercise_sets_session_exercise_order_active_idx
  on app_public.exercise_sets
    (owner_user_id, session_exercise_id, order_index)
  where deleted_at is null;

-- 3.8 session_exercise_tags -------------------------------------------------

create table app_public.session_exercise_tags (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_exercise_id text not null,
  exercise_tag_definition_id text not null,
  created_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_exercise_tags_pkey primary key (owner_user_id, id),
  constraint session_exercise_tags_session_exercise_fk
    foreign key (owner_user_id, session_exercise_id)
    references app_public.session_exercises (owner_user_id, id)
    on delete cascade
    deferrable initially deferred,
  constraint session_exercise_tags_exercise_tag_definition_fk
    foreign key (owner_user_id, exercise_tag_definition_id)
    references app_public.exercise_tag_definitions (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);

create index session_exercise_tags_owner_received_idx
  on app_public.session_exercise_tags (owner_user_id, server_received_at);
create index session_exercise_tags_session_exercise_id_idx
  on app_public.session_exercise_tags (session_exercise_id);
create index session_exercise_tags_exercise_tag_definition_id_idx
  on app_public.session_exercise_tags (exercise_tag_definition_id);
create index session_exercise_tags_deleted_at_idx
  on app_public.session_exercise_tags (deleted_at);
create index session_exercise_tags_pair_idx
  on app_public.session_exercise_tags
    (owner_user_id, session_exercise_id, exercise_tag_definition_id);

-- -----------------------------------------------------------------------------
-- 4. Universal triggers per entity: touch-server-received-at + owner-immutable.
--    Defense-in-depth WHEN (NEW IS DISTINCT FROM OLD) on the touch trigger
--    per the server contract §A.2.
-- -----------------------------------------------------------------------------

create trigger gyms_touch_server_received_at
  before update on app_public.gyms
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger gyms_owner_user_id_immutable
  before update on app_public.gyms
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger exercise_definitions_touch_server_received_at
  before update on app_public.exercise_definitions
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger exercise_definitions_owner_user_id_immutable
  before update on app_public.exercise_definitions
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger muscle_groups_touch_server_received_at
  before update on app_public.muscle_groups
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger muscle_groups_owner_user_id_immutable
  before update on app_public.muscle_groups
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger exercise_tag_definitions_touch_server_received_at
  before update on app_public.exercise_tag_definitions
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger exercise_tag_definitions_owner_user_id_immutable
  before update on app_public.exercise_tag_definitions
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger sessions_touch_server_received_at
  before update on app_public.sessions
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger sessions_owner_user_id_immutable
  before update on app_public.sessions
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger exercise_muscle_mappings_touch_server_received_at
  before update on app_public.exercise_muscle_mappings
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger exercise_muscle_mappings_owner_user_id_immutable
  before update on app_public.exercise_muscle_mappings
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger session_exercises_touch_server_received_at
  before update on app_public.session_exercises
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_exercises_owner_user_id_immutable
  before update on app_public.session_exercises
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger exercise_sets_touch_server_received_at
  before update on app_public.exercise_sets
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger exercise_sets_owner_user_id_immutable
  before update on app_public.exercise_sets
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

create trigger session_exercise_tags_touch_server_received_at
  before update on app_public.session_exercise_tags
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_exercise_tags_owner_user_id_immutable
  before update on app_public.session_exercise_tags
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

-- -----------------------------------------------------------------------------
-- 5. RLS policies. Identical shape per the server contract §A.6.1. All four
--    operations gated on owner_user_id = auth.uid().
-- -----------------------------------------------------------------------------

alter table app_public.gyms enable row level security;
create policy gyms_owner_select on app_public.gyms
  for select to authenticated using (owner_user_id = auth.uid());
create policy gyms_owner_insert on app_public.gyms
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy gyms_owner_update on app_public.gyms
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy gyms_owner_delete on app_public.gyms
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.exercise_definitions enable row level security;
create policy exercise_definitions_owner_select on app_public.exercise_definitions
  for select to authenticated using (owner_user_id = auth.uid());
create policy exercise_definitions_owner_insert on app_public.exercise_definitions
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy exercise_definitions_owner_update on app_public.exercise_definitions
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy exercise_definitions_owner_delete on app_public.exercise_definitions
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.muscle_groups enable row level security;
create policy muscle_groups_owner_select on app_public.muscle_groups
  for select to authenticated using (owner_user_id = auth.uid());
create policy muscle_groups_owner_insert on app_public.muscle_groups
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy muscle_groups_owner_update on app_public.muscle_groups
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy muscle_groups_owner_delete on app_public.muscle_groups
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.exercise_tag_definitions enable row level security;
create policy exercise_tag_definitions_owner_select on app_public.exercise_tag_definitions
  for select to authenticated using (owner_user_id = auth.uid());
create policy exercise_tag_definitions_owner_insert on app_public.exercise_tag_definitions
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy exercise_tag_definitions_owner_update on app_public.exercise_tag_definitions
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy exercise_tag_definitions_owner_delete on app_public.exercise_tag_definitions
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.sessions enable row level security;
create policy sessions_owner_select on app_public.sessions
  for select to authenticated using (owner_user_id = auth.uid());
create policy sessions_owner_insert on app_public.sessions
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy sessions_owner_update on app_public.sessions
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy sessions_owner_delete on app_public.sessions
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.exercise_muscle_mappings enable row level security;
create policy exercise_muscle_mappings_owner_select on app_public.exercise_muscle_mappings
  for select to authenticated using (owner_user_id = auth.uid());
create policy exercise_muscle_mappings_owner_insert on app_public.exercise_muscle_mappings
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy exercise_muscle_mappings_owner_update on app_public.exercise_muscle_mappings
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy exercise_muscle_mappings_owner_delete on app_public.exercise_muscle_mappings
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.session_exercises enable row level security;
create policy session_exercises_owner_select on app_public.session_exercises
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_exercises_owner_insert on app_public.session_exercises
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_exercises_owner_update on app_public.session_exercises
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_exercises_owner_delete on app_public.session_exercises
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.exercise_sets enable row level security;
create policy exercise_sets_owner_select on app_public.exercise_sets
  for select to authenticated using (owner_user_id = auth.uid());
create policy exercise_sets_owner_insert on app_public.exercise_sets
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy exercise_sets_owner_update on app_public.exercise_sets
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy exercise_sets_owner_delete on app_public.exercise_sets
  for delete to authenticated using (owner_user_id = auth.uid());

alter table app_public.session_exercise_tags enable row level security;
create policy session_exercise_tags_owner_select on app_public.session_exercise_tags
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_exercise_tags_owner_insert on app_public.session_exercise_tags
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_exercise_tags_owner_update on app_public.session_exercise_tags
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_exercise_tags_owner_delete on app_public.session_exercise_tags
  for delete to authenticated using (owner_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. Grants: select/insert/update/delete to authenticated and service_role.
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on table app_public.gyms to authenticated;
grant select, insert, update, delete on table app_public.exercise_definitions to authenticated;
grant select, insert, update, delete on table app_public.muscle_groups to authenticated;
grant select, insert, update, delete on table app_public.exercise_tag_definitions to authenticated;
grant select, insert, update, delete on table app_public.sessions to authenticated;
grant select, insert, update, delete on table app_public.exercise_muscle_mappings to authenticated;
grant select, insert, update, delete on table app_public.session_exercises to authenticated;
grant select, insert, update, delete on table app_public.exercise_sets to authenticated;
grant select, insert, update, delete on table app_public.session_exercise_tags to authenticated;

grant select, insert, update, delete on table app_public.gyms to service_role;
grant select, insert, update, delete on table app_public.exercise_definitions to service_role;
grant select, insert, update, delete on table app_public.muscle_groups to service_role;
grant select, insert, update, delete on table app_public.exercise_tag_definitions to service_role;
grant select, insert, update, delete on table app_public.sessions to service_role;
grant select, insert, update, delete on table app_public.exercise_muscle_mappings to service_role;
grant select, insert, update, delete on table app_public.session_exercises to service_role;
grant select, insert, update, delete on table app_public.exercise_sets to service_role;
grant select, insert, update, delete on table app_public.session_exercise_tags to service_role;
