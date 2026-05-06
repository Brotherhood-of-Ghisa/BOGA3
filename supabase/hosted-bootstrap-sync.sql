-- Hosted sync bootstrap for Supabase Dashboard SQL Editor.
-- Generated from repo migrations; excludes local-only fixture setup.
-- Safe to rerun: migrations use create-if-not-exists, add-if-not-exists, and replace functions.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_public;
grant usage on schema app_public to anon, authenticated, service_role;

-- Source: 20260225143000_m5_auth_authz_security_baseline.sql
-- M5 auth/authz/security baseline:
-- - user-owned sync-domain tables in app_public
-- - ownership integrity constraints
-- - RLS deny-by-default with owner policies
-- - local fixture table service-role update grant for auth fixture provisioning


create table if not exists app_public.gyms (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  origin_scope_id text not null default 'private',
  origin_source_id text not null default 'local',
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint gyms_id_owner_unique unique (id, owner_user_id)
);

create index if not exists gyms_owner_user_id_idx on app_public.gyms (owner_user_id);
create index if not exists gyms_name_idx on app_public.gyms (name);
create index if not exists gyms_origin_scope_id_idx on app_public.gyms (origin_scope_id);

create table if not exists app_public.sessions (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  gym_id text,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  started_at bigint not null check (started_at >= 0),
  completed_at bigint check (completed_at is null or completed_at >= 0),
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  deleted_at bigint check (deleted_at is null or deleted_at >= 0),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint sessions_id_owner_unique unique (id, owner_user_id),
  constraint sessions_gym_owner_fk
    foreign key (gym_id, owner_user_id)
    references app_public.gyms (id, owner_user_id)
    on delete no action
);

create index if not exists sessions_owner_user_id_idx on app_public.sessions (owner_user_id);
create index if not exists sessions_status_idx on app_public.sessions (status);
create index if not exists sessions_completed_at_idx on app_public.sessions (completed_at);
create index if not exists sessions_deleted_at_idx on app_public.sessions (deleted_at);

create table if not exists app_public.session_exercises (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id text not null,
  order_index integer not null check (order_index >= 0),
  name text not null check (length(btrim(name)) > 0),
  machine_name text,
  origin_scope_id text not null default 'private',
  origin_source_id text not null default 'local',
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint session_exercises_id_owner_unique unique (id, owner_user_id),
  constraint session_exercises_session_owner_fk
    foreign key (session_id, owner_user_id)
    references app_public.sessions (id, owner_user_id)
    on delete cascade,
  constraint session_exercises_session_order_unique unique (session_id, order_index)
);

create index if not exists session_exercises_owner_user_id_idx on app_public.session_exercises (owner_user_id);
create index if not exists session_exercises_session_id_idx on app_public.session_exercises (session_id);

create table if not exists app_public.exercise_sets (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_exercise_id text not null,
  order_index integer not null check (order_index >= 0),
  weight_value text not null default '',
  reps_value text not null default '',
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint exercise_sets_id_owner_unique unique (id, owner_user_id),
  constraint exercise_sets_session_exercise_owner_fk
    foreign key (session_exercise_id, owner_user_id)
    references app_public.session_exercises (id, owner_user_id)
    on delete cascade,
  constraint exercise_sets_session_exercise_order_unique unique (session_exercise_id, order_index)
);

create index if not exists exercise_sets_owner_user_id_idx on app_public.exercise_sets (owner_user_id);
create index if not exists exercise_sets_session_exercise_id_idx on app_public.exercise_sets (session_exercise_id);

grant usage on schema app_public to anon, authenticated, service_role;
grant select, insert, update, delete on table app_public.gyms to authenticated;
grant select, insert, update, delete on table app_public.sessions to authenticated;
grant select, insert, update, delete on table app_public.session_exercises to authenticated;
grant select, insert, update, delete on table app_public.exercise_sets to authenticated;
grant select, insert, update, delete on table app_public.gyms to service_role;
grant select, insert, update, delete on table app_public.sessions to service_role;
grant select, insert, update, delete on table app_public.session_exercises to service_role;
grant select, insert, update, delete on table app_public.exercise_sets to service_role;

create or replace function app_public.enforce_owner_user_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists gyms_owner_user_id_immutable on app_public.gyms;
create trigger gyms_owner_user_id_immutable
before update on app_public.gyms
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists sessions_owner_user_id_immutable on app_public.sessions;
create trigger sessions_owner_user_id_immutable
before update on app_public.sessions
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists session_exercises_owner_user_id_immutable on app_public.session_exercises;
create trigger session_exercises_owner_user_id_immutable
before update on app_public.session_exercises
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists exercise_sets_owner_user_id_immutable on app_public.exercise_sets;
create trigger exercise_sets_owner_user_id_immutable
before update on app_public.exercise_sets
for each row
execute function app_public.enforce_owner_user_id_immutable();

alter table app_public.gyms enable row level security;
alter table app_public.sessions enable row level security;
alter table app_public.session_exercises enable row level security;
alter table app_public.exercise_sets enable row level security;

drop policy if exists gyms_owner_select on app_public.gyms;
create policy gyms_owner_select
on app_public.gyms
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists gyms_owner_insert on app_public.gyms;
create policy gyms_owner_insert
on app_public.gyms
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists gyms_owner_update on app_public.gyms;
create policy gyms_owner_update
on app_public.gyms
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists gyms_owner_delete on app_public.gyms;
create policy gyms_owner_delete
on app_public.gyms
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists sessions_owner_select on app_public.sessions;
create policy sessions_owner_select
on app_public.sessions
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists sessions_owner_insert on app_public.sessions;
create policy sessions_owner_insert
on app_public.sessions
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists sessions_owner_update on app_public.sessions;
create policy sessions_owner_update
on app_public.sessions
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists sessions_owner_delete on app_public.sessions;
create policy sessions_owner_delete
on app_public.sessions
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists session_exercises_owner_select on app_public.session_exercises;
create policy session_exercises_owner_select
on app_public.session_exercises
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists session_exercises_owner_insert on app_public.session_exercises;
create policy session_exercises_owner_insert
on app_public.session_exercises
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists session_exercises_owner_update on app_public.session_exercises;
create policy session_exercises_owner_update
on app_public.session_exercises
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists session_exercises_owner_delete on app_public.session_exercises;
create policy session_exercises_owner_delete
on app_public.session_exercises
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_sets_owner_select on app_public.exercise_sets;
create policy exercise_sets_owner_select
on app_public.exercise_sets
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_sets_owner_insert on app_public.exercise_sets;
create policy exercise_sets_owner_insert
on app_public.exercise_sets
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists exercise_sets_owner_update on app_public.exercise_sets;
create policy exercise_sets_owner_update
on app_public.exercise_sets
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists exercise_sets_owner_delete on app_public.exercise_sets;
create policy exercise_sets_owner_delete
on app_public.exercise_sets
for delete
to authenticated
using (owner_user_id = auth.uid());

comment on schema app_public is
  'App-owned API schema. M5 introduces user-scoped sync tables protected by RLS.';

-- Source: 20260306120000_m12_sync_metadata_parity.sql
-- M12 sync metadata parity:
-- Keep server-side sync tables aligned with local/mobile session metadata fields.

alter table app_public.session_exercises
  add column if not exists exercise_definition_id text;

create index if not exists session_exercises_exercise_definition_id_idx
  on app_public.session_exercises (exercise_definition_id);

alter table app_public.exercise_sets
  add column if not exists set_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercise_sets_set_type_guard'
  ) then
    alter table app_public.exercise_sets
      add constraint exercise_sets_set_type_guard
      check (
        set_type is null
        or set_type in ('warm_up', 'rir_0', 'rir_1', 'rir_2')
      );
  end if;
end
$$;

-- Source: 20260306170000_m13_sync_events_ingest_projection.sql
-- M13 backend sync ingest + projection baseline.
-- Implements:
-- - batched ingest RPC with strict request-order processing,
-- - per-device idempotency + sequence tracking,
-- - projection coverage for the full M13 user-owned entity scope.

-- Expand existing projection tables for M13 semantics.
alter table app_public.gyms
  add column if not exists deleted_at bigint check (deleted_at is null or deleted_at >= 0);

create index if not exists gyms_deleted_at_idx on app_public.gyms (deleted_at);

alter table app_public.session_exercises
  add column if not exists exercise_definition_id text,
  add column if not exists deleted_at bigint check (deleted_at is null or deleted_at >= 0);

alter table app_public.session_exercises
  drop constraint if exists session_exercises_session_order_unique;

drop index if exists app_public.session_exercises_session_order_unique;

create index if not exists session_exercises_exercise_definition_id_idx
  on app_public.session_exercises (exercise_definition_id);

create index if not exists session_exercises_deleted_at_idx
  on app_public.session_exercises (deleted_at);

create unique index if not exists session_exercises_session_order_active_unique
  on app_public.session_exercises (session_id, order_index)
  where deleted_at is null;

alter table app_public.exercise_sets
  add column if not exists deleted_at bigint check (deleted_at is null or deleted_at >= 0);

alter table app_public.exercise_sets
  drop constraint if exists exercise_sets_session_exercise_order_unique;

drop index if exists app_public.exercise_sets_session_exercise_order_unique;

create index if not exists exercise_sets_deleted_at_idx
  on app_public.exercise_sets (deleted_at);

create unique index if not exists exercise_sets_session_exercise_order_active_unique
  on app_public.exercise_sets (session_exercise_id, order_index)
  where deleted_at is null;

-- Full M13 projection tables beyond M5 baseline.
create table if not exists app_public.exercise_definitions (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  deleted_at bigint check (deleted_at is null or deleted_at >= 0),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint exercise_definitions_id_owner_unique unique (id, owner_user_id)
);

create index if not exists exercise_definitions_owner_user_id_idx
  on app_public.exercise_definitions (owner_user_id);

create index if not exists exercise_definitions_name_idx
  on app_public.exercise_definitions (name);

create index if not exists exercise_definitions_deleted_at_idx
  on app_public.exercise_definitions (deleted_at);

create table if not exists app_public.exercise_muscle_mappings (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_definition_id text not null,
  muscle_group_id text not null check (length(btrim(muscle_group_id)) > 0),
  weight double precision not null check (weight > 0),
  role text check (role is null or role in ('primary', 'secondary', 'stabilizer')),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint exercise_muscle_mappings_id_owner_unique unique (id, owner_user_id),
  constraint exercise_muscle_mappings_exercise_muscle_owner_unique unique (exercise_definition_id, muscle_group_id, owner_user_id),
  constraint exercise_muscle_mappings_exercise_definition_owner_fk
    foreign key (exercise_definition_id, owner_user_id)
    references app_public.exercise_definitions (id, owner_user_id)
    on delete cascade
);

create index if not exists exercise_muscle_mappings_owner_user_id_idx
  on app_public.exercise_muscle_mappings (owner_user_id);

create index if not exists exercise_muscle_mappings_exercise_definition_id_idx
  on app_public.exercise_muscle_mappings (exercise_definition_id);

create index if not exists exercise_muscle_mappings_muscle_group_id_idx
  on app_public.exercise_muscle_mappings (muscle_group_id);

create table if not exists app_public.exercise_tag_definitions (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_definition_id text not null,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  deleted_at bigint check (deleted_at is null or deleted_at >= 0),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  constraint exercise_tag_definitions_id_owner_unique unique (id, owner_user_id),
  constraint exercise_tag_definitions_exercise_id_normalized_name_owner_unique unique (exercise_definition_id, normalized_name, owner_user_id),
  constraint exercise_tag_definitions_exercise_definition_owner_fk
    foreign key (exercise_definition_id, owner_user_id)
    references app_public.exercise_definitions (id, owner_user_id)
    on delete cascade
);

create index if not exists exercise_tag_definitions_owner_user_id_idx
  on app_public.exercise_tag_definitions (owner_user_id);

create index if not exists exercise_tag_definitions_exercise_definition_id_idx
  on app_public.exercise_tag_definitions (exercise_definition_id);

create index if not exists exercise_tag_definitions_deleted_at_idx
  on app_public.exercise_tag_definitions (deleted_at);

create table if not exists app_public.session_exercise_tags (
  id text primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_exercise_id text not null,
  exercise_tag_definition_id text not null,
  created_at bigint not null check (created_at >= 0),
  constraint session_exercise_tags_id_owner_unique unique (id, owner_user_id),
  constraint session_exercise_tags_session_exercise_tag_owner_unique unique (session_exercise_id, exercise_tag_definition_id, owner_user_id),
  constraint session_exercise_tags_session_exercise_owner_fk
    foreign key (session_exercise_id, owner_user_id)
    references app_public.session_exercises (id, owner_user_id)
    on delete cascade,
  constraint session_exercise_tags_exercise_tag_definition_owner_fk
    foreign key (exercise_tag_definition_id, owner_user_id)
    references app_public.exercise_tag_definitions (id, owner_user_id)
    on delete cascade
);

create index if not exists session_exercise_tags_owner_user_id_idx
  on app_public.session_exercise_tags (owner_user_id);

create index if not exists session_exercise_tags_session_exercise_id_idx
  on app_public.session_exercise_tags (session_exercise_id);

create index if not exists session_exercise_tags_exercise_tag_definition_id_idx
  on app_public.session_exercise_tags (exercise_tag_definition_id);

-- Link session exercises to M13 exercise definitions when populated.
alter table app_public.session_exercises
  drop constraint if exists session_exercises_exercise_definition_owner_fk;

alter table app_public.session_exercises
  add constraint session_exercises_exercise_definition_owner_fk
    foreign key (exercise_definition_id, owner_user_id)
    references app_public.exercise_definitions (id, owner_user_id)
    on delete no action;

-- Ingest metadata tables.
create table if not exists app_public.sync_device_ingest_state (
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id text not null check (length(btrim(device_id)) > 0),
  last_sequence_in_device bigint not null default 0 check (last_sequence_in_device >= 0),
  last_batch_id text,
  last_sent_at_ms bigint check (last_sent_at_ms is null or last_sent_at_ms >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (owner_user_id, device_id)
);

create table if not exists app_public.sync_ingested_events (
  owner_user_id uuid not null,
  device_id text not null check (length(btrim(device_id)) > 0),
  event_id text not null check (length(btrim(event_id)) > 0),
  sequence_in_device bigint not null check (sequence_in_device >= 1),
  occurred_at_ms bigint not null check (occurred_at_ms >= 0),
  entity_type text not null check (
    entity_type in (
      'gyms',
      'sessions',
      'session_exercises',
      'exercise_sets',
      'exercise_definitions',
      'exercise_muscle_mappings',
      'exercise_tag_definitions',
      'session_exercise_tags'
    )
  ),
  entity_id text not null check (length(btrim(entity_id)) > 0),
  event_type text not null check (event_type in ('upsert', 'delete', 'attach', 'detach', 'reorder', 'complete')),
  schema_version integer not null default 1 check (schema_version >= 1),
  trace_id text,
  payload jsonb not null,
  canonical_event jsonb not null,
  event_payload_hash text not null check (length(event_payload_hash) = 64),
  batch_id text not null check (length(btrim(batch_id)) > 0),
  sent_at_ms bigint not null check (sent_at_ms >= 0),
  ingested_at timestamptz not null default timezone('utc', now()),
  primary key (owner_user_id, device_id, event_id),
  constraint sync_ingested_events_owner_device_fk
    foreign key (owner_user_id, device_id)
    references app_public.sync_device_ingest_state (owner_user_id, device_id)
    on delete cascade,
  constraint sync_ingested_events_sequence_unique unique (owner_user_id, device_id, sequence_in_device)
);

create index if not exists sync_ingested_events_owner_user_id_idx
  on app_public.sync_ingested_events (owner_user_id);

create index if not exists sync_ingested_events_entity_lookup_idx
  on app_public.sync_ingested_events (owner_user_id, entity_type, entity_id);

create index if not exists sync_ingested_events_ingested_at_idx
  on app_public.sync_ingested_events (ingested_at);

-- Grants for new tables.
grant select, insert, update, delete on table app_public.exercise_definitions to authenticated;
grant select, insert, update, delete on table app_public.exercise_muscle_mappings to authenticated;
grant select, insert, update, delete on table app_public.exercise_tag_definitions to authenticated;
grant select, insert, update, delete on table app_public.session_exercise_tags to authenticated;
grant select, insert, update on table app_public.sync_device_ingest_state to authenticated;
grant select, insert on table app_public.sync_ingested_events to authenticated;

grant select, insert, update, delete on table app_public.exercise_definitions to service_role;
grant select, insert, update, delete on table app_public.exercise_muscle_mappings to service_role;
grant select, insert, update, delete on table app_public.exercise_tag_definitions to service_role;
grant select, insert, update, delete on table app_public.session_exercise_tags to service_role;
grant select, insert, update, delete on table app_public.sync_device_ingest_state to service_role;
grant select, insert, update, delete on table app_public.sync_ingested_events to service_role;

-- Owner immutability triggers on new owner-scoped tables.
drop trigger if exists exercise_definitions_owner_user_id_immutable on app_public.exercise_definitions;
create trigger exercise_definitions_owner_user_id_immutable
before update on app_public.exercise_definitions
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists exercise_muscle_mappings_owner_user_id_immutable on app_public.exercise_muscle_mappings;
create trigger exercise_muscle_mappings_owner_user_id_immutable
before update on app_public.exercise_muscle_mappings
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists exercise_tag_definitions_owner_user_id_immutable on app_public.exercise_tag_definitions;
create trigger exercise_tag_definitions_owner_user_id_immutable
before update on app_public.exercise_tag_definitions
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists session_exercise_tags_owner_user_id_immutable on app_public.session_exercise_tags;
create trigger session_exercise_tags_owner_user_id_immutable
before update on app_public.session_exercise_tags
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists sync_device_ingest_state_owner_user_id_immutable on app_public.sync_device_ingest_state;
create trigger sync_device_ingest_state_owner_user_id_immutable
before update on app_public.sync_device_ingest_state
for each row
execute function app_public.enforce_owner_user_id_immutable();

drop trigger if exists sync_ingested_events_owner_user_id_immutable on app_public.sync_ingested_events;
create trigger sync_ingested_events_owner_user_id_immutable
before update on app_public.sync_ingested_events
for each row
execute function app_public.enforce_owner_user_id_immutable();

-- RLS policies for new tables.
alter table app_public.exercise_definitions enable row level security;
alter table app_public.exercise_muscle_mappings enable row level security;
alter table app_public.exercise_tag_definitions enable row level security;
alter table app_public.session_exercise_tags enable row level security;
alter table app_public.sync_device_ingest_state enable row level security;
alter table app_public.sync_ingested_events enable row level security;

drop policy if exists exercise_definitions_owner_select on app_public.exercise_definitions;
create policy exercise_definitions_owner_select
on app_public.exercise_definitions
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_definitions_owner_insert on app_public.exercise_definitions;
create policy exercise_definitions_owner_insert
on app_public.exercise_definitions
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists exercise_definitions_owner_update on app_public.exercise_definitions;
create policy exercise_definitions_owner_update
on app_public.exercise_definitions
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists exercise_definitions_owner_delete on app_public.exercise_definitions;
create policy exercise_definitions_owner_delete
on app_public.exercise_definitions
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_muscle_mappings_owner_select on app_public.exercise_muscle_mappings;
create policy exercise_muscle_mappings_owner_select
on app_public.exercise_muscle_mappings
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_muscle_mappings_owner_insert on app_public.exercise_muscle_mappings;
create policy exercise_muscle_mappings_owner_insert
on app_public.exercise_muscle_mappings
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists exercise_muscle_mappings_owner_update on app_public.exercise_muscle_mappings;
create policy exercise_muscle_mappings_owner_update
on app_public.exercise_muscle_mappings
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists exercise_muscle_mappings_owner_delete on app_public.exercise_muscle_mappings;
create policy exercise_muscle_mappings_owner_delete
on app_public.exercise_muscle_mappings
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_tag_definitions_owner_select on app_public.exercise_tag_definitions;
create policy exercise_tag_definitions_owner_select
on app_public.exercise_tag_definitions
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists exercise_tag_definitions_owner_insert on app_public.exercise_tag_definitions;
create policy exercise_tag_definitions_owner_insert
on app_public.exercise_tag_definitions
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists exercise_tag_definitions_owner_update on app_public.exercise_tag_definitions;
create policy exercise_tag_definitions_owner_update
on app_public.exercise_tag_definitions
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists exercise_tag_definitions_owner_delete on app_public.exercise_tag_definitions;
create policy exercise_tag_definitions_owner_delete
on app_public.exercise_tag_definitions
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists session_exercise_tags_owner_select on app_public.session_exercise_tags;
create policy session_exercise_tags_owner_select
on app_public.session_exercise_tags
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists session_exercise_tags_owner_insert on app_public.session_exercise_tags;
create policy session_exercise_tags_owner_insert
on app_public.session_exercise_tags
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists session_exercise_tags_owner_update on app_public.session_exercise_tags;
create policy session_exercise_tags_owner_update
on app_public.session_exercise_tags
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists session_exercise_tags_owner_delete on app_public.session_exercise_tags;
create policy session_exercise_tags_owner_delete
on app_public.session_exercise_tags
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists sync_device_ingest_state_owner_select on app_public.sync_device_ingest_state;
create policy sync_device_ingest_state_owner_select
on app_public.sync_device_ingest_state
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists sync_device_ingest_state_owner_insert on app_public.sync_device_ingest_state;
create policy sync_device_ingest_state_owner_insert
on app_public.sync_device_ingest_state
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists sync_device_ingest_state_owner_update on app_public.sync_device_ingest_state;
create policy sync_device_ingest_state_owner_update
on app_public.sync_device_ingest_state
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists sync_ingested_events_owner_select on app_public.sync_ingested_events;
create policy sync_ingested_events_owner_select
on app_public.sync_ingested_events
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists sync_ingested_events_owner_insert on app_public.sync_ingested_events;
create policy sync_ingested_events_owner_insert
on app_public.sync_ingested_events
for insert
to authenticated
with check (owner_user_id = auth.uid());

-- Shared helper for FAILURE envelope shape.
create or replace function app_public.sync_ingest_failure(
  p_error_index integer,
  p_should_retry boolean,
  p_message text,
  p_error_event_id text default null
)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'status', 'FAILURE',
      'error_index', p_error_index,
      'error_event_id', p_error_event_id,
      'should_retry', p_should_retry,
      'message', p_message
    )
  );
$$;

-- Projection apply dispatcher.
create or replace function app_public.sync_apply_projection_event(
  p_owner_user_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_event_type text,
  p_occurred_at_ms bigint,
  p_payload jsonb
)
returns void
language plpgsql
set search_path = app_public, public, extensions
as $$
declare
  v_row_count bigint;
  v_id text;
  v_name text;
  v_origin_scope_id text;
  v_origin_source_id text;
  v_gym_id text;
  v_status text;
  v_started_at_ms bigint;
  v_completed_at_ms bigint;
  v_duration_sec integer;
  v_deleted_at_ms bigint;
  v_created_at_ms bigint;
  v_updated_at_ms bigint;
  v_session_id text;
  v_session_exercise_id text;
  v_exercise_definition_id text;
  v_order_index integer;
  v_machine_name text;
  v_weight_value text;
  v_reps_value text;
  v_normalized_name text;
  v_row_id text;
  v_muscle_group_id text;
  v_weight double precision;
  v_role text;
  v_exercise_tag_definition_id text;
begin
  if p_owner_user_id is null then
    raise exception 'owner_user_id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;

  case p_entity_type
    when 'gyms' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for gyms events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for gyms events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_name := p_payload ->> 'name';
        v_origin_scope_id := coalesce(p_payload ->> 'origin_scope_id', 'private');
        v_origin_source_id := coalesce(p_payload ->> 'origin_source_id', 'local');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for gyms upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.gyms (
          id,
          owner_user_id,
          name,
          origin_scope_id,
          origin_source_id,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_name,
          v_origin_scope_id,
          v_origin_source_id,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set name = excluded.name,
              origin_scope_id = excluded.origin_scope_id,
              origin_source_id = excluded.origin_source_id,
              deleted_at = null,
              created_at = least(app_public.gyms.created_at, excluded.created_at),
              updated_at = greatest(app_public.gyms.updated_at, excluded.updated_at)
          where app_public.gyms.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'gyms id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.gyms
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing gym %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported gyms event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'sessions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for sessions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for sessions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_gym_id := nullif(btrim(coalesce(p_payload ->> 'gym_id', '')), '');
        v_status := p_payload ->> 'status';
        v_started_at_ms := (p_payload ->> 'started_at_ms')::bigint;
        v_completed_at_ms := (p_payload ->> 'completed_at_ms')::bigint;
        v_duration_sec := (p_payload ->> 'duration_sec')::integer;
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_status not in ('draft', 'active', 'completed') then
          raise exception 'payload.status must be draft|active|completed for sessions upsert' using errcode = '22023';
        end if;

        if v_started_at_ms < 0 or coalesce(v_completed_at_ms, 0) < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'session timestamps must be >= 0' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        if v_duration_sec is not null and v_duration_sec < 0 then
          raise exception 'duration_sec must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.sessions (
          id,
          owner_user_id,
          gym_id,
          status,
          started_at,
          completed_at,
          duration_sec,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_gym_id,
          v_status,
          v_started_at_ms,
          v_completed_at_ms,
          v_duration_sec,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set gym_id = excluded.gym_id,
              status = excluded.status,
              started_at = excluded.started_at,
              completed_at = excluded.completed_at,
              duration_sec = excluded.duration_sec,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.sessions.created_at, excluded.created_at),
              updated_at = greatest(app_public.sessions.updated_at, excluded.updated_at)
          where app_public.sessions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'sessions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.sessions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing session %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'complete' then
        v_completed_at_ms := (p_payload ->> 'completed_at_ms')::bigint;
        v_duration_sec := (p_payload ->> 'duration_sec')::integer;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_completed_at_ms < 0 or v_duration_sec < 0 or v_updated_at_ms < 0 then
          raise exception 'completed_at_ms, duration_sec, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.sessions
          set status = 'completed',
              completed_at = v_completed_at_ms,
              duration_sec = v_duration_sec,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot complete missing session %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported sessions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'session_exercises' then
      if not (p_payload ? 'id') and p_event_type <> 'reorder' then
        raise exception 'payload.id is required for session_exercises events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for session_exercises upsert' using errcode = '22023';
        end if;

        v_session_id := btrim(p_payload ->> 'session_id');
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_name := p_payload ->> 'name';
        v_machine_name := p_payload ->> 'machine_name';
        v_origin_scope_id := coalesce(p_payload ->> 'origin_scope_id', 'private');
        v_origin_source_id := coalesce(p_payload ->> 'origin_source_id', 'local');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_session_id = '' or v_exercise_definition_id = '' then
          raise exception 'session_id and exercise_definition_id are required for session_exercises upsert' using errcode = '22023';
        end if;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for session_exercises upsert' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index, created_at_ms, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.session_exercises
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_id = v_session_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        insert into app_public.session_exercises (
          id,
          owner_user_id,
          session_id,
          exercise_definition_id,
          order_index,
          name,
          machine_name,
          origin_scope_id,
          origin_source_id,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_session_id,
          v_exercise_definition_id,
          v_order_index,
          v_name,
          nullif(v_machine_name, ''),
          v_origin_scope_id,
          v_origin_source_id,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set session_id = excluded.session_id,
              exercise_definition_id = excluded.exercise_definition_id,
              order_index = excluded.order_index,
              name = excluded.name,
              machine_name = excluded.machine_name,
              origin_scope_id = excluded.origin_scope_id,
              origin_source_id = excluded.origin_source_id,
              deleted_at = null,
              created_at = least(app_public.session_exercises.created_at, excluded.created_at),
              updated_at = greatest(app_public.session_exercises.updated_at, excluded.updated_at)
          where app_public.session_exercises.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'session_exercises id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for session_exercises delete' using errcode = '22023';
        end if;

        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.session_exercises
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing session_exercise %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'reorder' then
        v_id := p_entity_id;
        v_session_id := btrim(p_payload ->> 'session_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, p_occurred_at_ms);

        if v_id = '' or v_session_id = '' then
          raise exception 'entity_id and payload.session_id are required for session_exercises reorder' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.session_exercises
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_id = v_session_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        update app_public.session_exercises
          set session_id = v_session_id,
              order_index = v_order_index,
              deleted_at = null,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot reorder missing session_exercise %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported session_exercises event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_sets' then
      if not (p_payload ? 'id') and p_event_type <> 'reorder' then
        raise exception 'payload.id is required for exercise_sets events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for exercise_sets upsert' using errcode = '22023';
        end if;

        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_weight_value := coalesce(p_payload ->> 'weight_value', '');
        v_reps_value := coalesce(p_payload ->> 'reps_value', '');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_session_exercise_id = '' then
          raise exception 'payload.session_exercise_id is required for exercise_sets upsert' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index, created_at_ms, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.exercise_sets
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        insert into app_public.exercise_sets (
          id,
          owner_user_id,
          session_exercise_id,
          order_index,
          weight_value,
          reps_value,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_session_exercise_id,
          v_order_index,
          v_weight_value,
          v_reps_value,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set session_exercise_id = excluded.session_exercise_id,
              order_index = excluded.order_index,
              weight_value = excluded.weight_value,
              reps_value = excluded.reps_value,
              deleted_at = null,
              created_at = least(app_public.exercise_sets.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_sets.updated_at, excluded.updated_at)
          where app_public.exercise_sets.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_sets id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for exercise_sets delete' using errcode = '22023';
        end if;

        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_sets
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_set %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'reorder' then
        v_id := p_entity_id;
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, p_occurred_at_ms);

        if v_id = '' or v_session_exercise_id = '' then
          raise exception 'entity_id and payload.session_exercise_id are required for exercise_sets reorder' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.exercise_sets
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        update app_public.exercise_sets
          set session_exercise_id = v_session_exercise_id,
              order_index = v_order_index,
              deleted_at = null,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot reorder missing exercise_set %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_sets event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_definitions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for exercise_definitions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for exercise_definitions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_name := p_payload ->> 'name';
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for exercise_definitions upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'exercise_definitions timestamps must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.exercise_definitions (
          id,
          owner_user_id,
          name,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_name,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set name = excluded.name,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.exercise_definitions.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_definitions.updated_at, excluded.updated_at)
          where app_public.exercise_definitions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_definitions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_definitions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_definition %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_definitions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_muscle_mappings' then
      if p_event_type = 'attach' then
        v_row_id := btrim(p_payload ->> 'row_id');
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_muscle_group_id := btrim(p_payload ->> 'muscle_group_id');
        v_weight := (p_payload ->> 'weight')::double precision;
        v_role := p_payload ->> 'role';
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_row_id = '' or v_exercise_definition_id = '' or v_muscle_group_id = '' then
          raise exception 'row_id, exercise_definition_id, and muscle_group_id are required for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_weight <= 0 then
          raise exception 'payload.weight must be > 0 for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_role is not null and v_role not in ('primary', 'secondary', 'stabilizer') then
          raise exception 'payload.role must be primary|secondary|stabilizer|null for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        delete from app_public.exercise_muscle_mappings
          where owner_user_id = p_owner_user_id
            and (
              id = v_row_id
              or (
                exercise_definition_id = v_exercise_definition_id
                and muscle_group_id = v_muscle_group_id
              )
            );

        insert into app_public.exercise_muscle_mappings (
          id,
          owner_user_id,
          exercise_definition_id,
          muscle_group_id,
          weight,
          role,
          created_at,
          updated_at
        )
        values (
          v_row_id,
          p_owner_user_id,
          v_exercise_definition_id,
          v_muscle_group_id,
          v_weight,
          v_role,
          v_created_at_ms,
          v_updated_at_ms
        );
      elsif p_event_type = 'detach' then
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_muscle_group_id := btrim(p_payload ->> 'muscle_group_id');

        if v_exercise_definition_id = '' or v_muscle_group_id = '' then
          raise exception 'exercise_definition_id and muscle_group_id are required for exercise_muscle_mappings detach' using errcode = '22023';
        end if;

        delete from app_public.exercise_muscle_mappings
          where owner_user_id = p_owner_user_id
            and exercise_definition_id = v_exercise_definition_id
            and muscle_group_id = v_muscle_group_id;
      else
        raise exception 'unsupported exercise_muscle_mappings event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_tag_definitions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for exercise_tag_definitions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for exercise_tag_definitions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_name := p_payload ->> 'name';
        v_normalized_name := p_payload ->> 'normalized_name';
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_exercise_definition_id = '' then
          raise exception 'payload.exercise_definition_id is required for exercise_tag_definitions upsert' using errcode = '22023';
        end if;

        if length(btrim(v_name)) = 0 or length(btrim(v_normalized_name)) = 0 then
          raise exception 'payload.name and payload.normalized_name are required for exercise_tag_definitions upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'exercise_tag_definitions timestamps must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.exercise_tag_definitions (
          id,
          owner_user_id,
          exercise_definition_id,
          name,
          normalized_name,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_exercise_definition_id,
          v_name,
          v_normalized_name,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set exercise_definition_id = excluded.exercise_definition_id,
              name = excluded.name,
              normalized_name = excluded.normalized_name,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.exercise_tag_definitions.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_tag_definitions.updated_at, excluded.updated_at)
          where app_public.exercise_tag_definitions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_tag_definitions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_tag_definitions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_tag_definition %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_tag_definitions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'session_exercise_tags' then
      if p_event_type = 'attach' then
        v_row_id := btrim(p_payload ->> 'row_id');
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_exercise_tag_definition_id := btrim(p_payload ->> 'exercise_tag_definition_id');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;

        if v_row_id = '' or v_session_exercise_id = '' or v_exercise_tag_definition_id = '' then
          raise exception 'row_id, session_exercise_id, and exercise_tag_definition_id are required for session_exercise_tags attach' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 then
          raise exception 'payload.created_at_ms must be >= 0 for session_exercise_tags attach' using errcode = '22023';
        end if;

        delete from app_public.session_exercise_tags
          where owner_user_id = p_owner_user_id
            and (
              id = v_row_id
              or (
                session_exercise_id = v_session_exercise_id
                and exercise_tag_definition_id = v_exercise_tag_definition_id
              )
            );

        insert into app_public.session_exercise_tags (
          id,
          owner_user_id,
          session_exercise_id,
          exercise_tag_definition_id,
          created_at
        )
        values (
          v_row_id,
          p_owner_user_id,
          v_session_exercise_id,
          v_exercise_tag_definition_id,
          v_created_at_ms
        );
      elsif p_event_type = 'detach' then
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_exercise_tag_definition_id := btrim(p_payload ->> 'exercise_tag_definition_id');

        if v_session_exercise_id = '' or v_exercise_tag_definition_id = '' then
          raise exception 'session_exercise_id and exercise_tag_definition_id are required for session_exercise_tags detach' using errcode = '22023';
        end if;

        delete from app_public.session_exercise_tags
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and exercise_tag_definition_id = v_exercise_tag_definition_id;
      else
        raise exception 'unsupported session_exercise_tags event_type: %', p_event_type using errcode = '22023';
      end if;

    else
      raise exception 'unsupported entity_type: %', p_entity_type using errcode = '22023';
  end case;
end;
$$;

-- Ingest RPC implementation.
create or replace function app_public.sync_events_ingest_impl(
  p_device_id text,
  p_batch_id text,
  p_sent_at_ms bigint,
  p_events jsonb
)
returns jsonb
language plpgsql
set search_path = app_public, public, extensions
as $$
declare
  v_owner_user_id uuid;
  v_device_id text;
  v_batch_id text;
  v_events_count integer;
  v_last_sequence_in_device bigint;
  v_expected_sequence bigint;
  v_event jsonb;
  v_event_id text;
  v_sequence_in_device bigint;
  v_occurred_at_ms bigint;
  v_entity_type text;
  v_entity_id text;
  v_event_type text;
  v_payload jsonb;
  v_schema_version integer;
  v_trace_id text;
  v_canonical_event jsonb;
  v_event_payload_hash text;
  v_existing_event_payload_hash text;
  v_now timestamptz;
begin
  v_owner_user_id := auth.uid();
  if v_owner_user_id is null then
    raise exception 'Authentication is required for sync ingest' using errcode = '42501';
  end if;

  v_device_id := btrim(coalesce(p_device_id, ''));
  if v_device_id = '' then
    return app_public.sync_ingest_failure(0, false, 'device_id is required');
  end if;

  v_batch_id := btrim(coalesce(p_batch_id, ''));
  if v_batch_id = '' then
    return app_public.sync_ingest_failure(0, false, 'batch_id is required');
  end if;

  if p_sent_at_ms is null or p_sent_at_ms < 0 then
    return app_public.sync_ingest_failure(0, false, 'sent_at_ms must be >= 0');
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return app_public.sync_ingest_failure(0, false, 'events must be an array');
  end if;

  v_events_count := jsonb_array_length(p_events);
  if v_events_count < 1 or v_events_count > 100 then
    return app_public.sync_ingest_failure(0, false, 'events must contain between 1 and 100 entries');
  end if;

  v_now := timezone('utc', now());

  insert into app_public.sync_device_ingest_state (
    owner_user_id,
    device_id,
    last_sequence_in_device,
    last_batch_id,
    last_sent_at_ms,
    created_at,
    updated_at
  )
  values (
    v_owner_user_id,
    v_device_id,
    0,
    null,
    null,
    v_now,
    v_now
  )
  on conflict (owner_user_id, device_id)
  do nothing;

  select s.last_sequence_in_device
    into v_last_sequence_in_device
    from app_public.sync_device_ingest_state s
   where s.owner_user_id = v_owner_user_id
     and s.device_id = v_device_id
   for update;

  if v_last_sequence_in_device is null then
    v_last_sequence_in_device := 0;
  end if;

  for v_event_index in 0..(v_events_count - 1) loop
    v_event := p_events -> v_event_index;

    if jsonb_typeof(v_event) <> 'object' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s] must be an object', v_event_index));
    end if;

    v_event_id := btrim(coalesce(v_event ->> 'event_id', ''));
    if v_event_id = '' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].event_id is required', v_event_index));
    end if;

    begin
      v_sequence_in_device := (v_event ->> 'sequence_in_device')::bigint;
    exception
      when others then
        return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].sequence_in_device must be an integer', v_event_index), v_event_id);
    end;

    if v_sequence_in_device < 1 then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].sequence_in_device must be >= 1', v_event_index), v_event_id);
    end if;

    begin
      v_occurred_at_ms := (v_event ->> 'occurred_at_ms')::bigint;
    exception
      when others then
        return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].occurred_at_ms must be an integer', v_event_index), v_event_id);
    end;

    if v_occurred_at_ms < 0 then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].occurred_at_ms must be >= 0', v_event_index), v_event_id);
    end if;

    v_entity_type := btrim(coalesce(v_event ->> 'entity_type', ''));
    if v_entity_type = '' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].entity_type is required', v_event_index), v_event_id);
    end if;

    v_entity_id := btrim(coalesce(v_event ->> 'entity_id', ''));
    if v_entity_id = '' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].entity_id is required', v_event_index), v_event_id);
    end if;

    v_event_type := btrim(coalesce(v_event ->> 'event_type', ''));
    if v_event_type = '' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].event_type is required', v_event_index), v_event_id);
    end if;

    v_payload := v_event -> 'payload';
    if jsonb_typeof(v_payload) <> 'object' then
      return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].payload must be an object', v_event_index), v_event_id);
    end if;

    if v_event ? 'schema_version' and jsonb_typeof(v_event -> 'schema_version') <> 'null' then
      begin
        v_schema_version := (v_event ->> 'schema_version')::integer;
      exception
        when others then
          return app_public.sync_ingest_failure(v_event_index, false, format('events[%s].schema_version must be an integer', v_event_index), v_event_id);
      end;
    else
      v_schema_version := 1;
    end if;

    if v_schema_version <> 1 then
      return app_public.sync_ingest_failure(
        v_event_index,
        false,
        format('events[%s].schema_version %s is not supported', v_event_index, v_schema_version),
        v_event_id
      );
    end if;

    if v_event ? 'trace_id' and jsonb_typeof(v_event -> 'trace_id') <> 'null' then
      v_trace_id := nullif(btrim(v_event ->> 'trace_id'), '');
    else
      v_trace_id := null;
    end if;

    if not (
      (v_entity_type = 'gyms' and v_event_type in ('upsert', 'delete')) or
      (v_entity_type = 'sessions' and v_event_type in ('upsert', 'delete', 'complete')) or
      (v_entity_type = 'session_exercises' and v_event_type in ('upsert', 'delete', 'reorder')) or
      (v_entity_type = 'exercise_sets' and v_event_type in ('upsert', 'delete', 'reorder')) or
      (v_entity_type = 'exercise_definitions' and v_event_type in ('upsert', 'delete')) or
      (v_entity_type = 'exercise_muscle_mappings' and v_event_type in ('attach', 'detach')) or
      (v_entity_type = 'exercise_tag_definitions' and v_event_type in ('upsert', 'delete')) or
      (v_entity_type = 'session_exercise_tags' and v_event_type in ('attach', 'detach'))
    ) then
      return app_public.sync_ingest_failure(
        v_event_index,
        false,
        format('Unsupported event_type %s for entity_type %s', v_event_type, v_entity_type),
        v_event_id
      );
    end if;

    v_canonical_event := jsonb_build_object(
      'event_id', v_event_id,
      'sequence_in_device', v_sequence_in_device,
      'occurred_at_ms', v_occurred_at_ms,
      'entity_type', v_entity_type,
      'entity_id', v_entity_id,
      'event_type', v_event_type,
      'payload', v_payload,
      'schema_version', v_schema_version
    );

    if v_trace_id is not null then
      v_canonical_event := v_canonical_event || jsonb_build_object('trace_id', v_trace_id);
    end if;

    v_event_payload_hash := encode(digest(v_canonical_event::text, 'sha256'), 'hex');

    select e.event_payload_hash
      into v_existing_event_payload_hash
      from app_public.sync_ingested_events e
     where e.owner_user_id = v_owner_user_id
       and e.device_id = v_device_id
       and e.event_id = v_event_id;

    if found then
      if v_existing_event_payload_hash = v_event_payload_hash then
        continue;
      end if;

      return app_public.sync_ingest_failure(
        v_event_index,
        false,
        format('event_id %s was already used with a different event body', v_event_id),
        v_event_id
      );
    end if;

    v_expected_sequence := v_last_sequence_in_device + 1;
    if v_sequence_in_device <> v_expected_sequence then
      if v_sequence_in_device > v_expected_sequence then
        return app_public.sync_ingest_failure(
          v_event_index,
          true,
          format('Expected sequence %s but got %s.', v_expected_sequence, v_sequence_in_device),
          v_event_id
        );
      end if;

      return app_public.sync_ingest_failure(
        v_event_index,
        false,
        format('Sequence %s is stale; expected %s.', v_sequence_in_device, v_expected_sequence),
        v_event_id
      );
    end if;

    begin
      perform app_public.sync_apply_projection_event(
        v_owner_user_id,
        v_entity_type,
        v_entity_id,
        v_event_type,
        v_occurred_at_ms,
        v_payload
      );

      insert into app_public.sync_ingested_events (
        owner_user_id,
        device_id,
        event_id,
        sequence_in_device,
        occurred_at_ms,
        entity_type,
        entity_id,
        event_type,
        schema_version,
        trace_id,
        payload,
        canonical_event,
        event_payload_hash,
        batch_id,
        sent_at_ms,
        ingested_at
      )
      values (
        v_owner_user_id,
        v_device_id,
        v_event_id,
        v_sequence_in_device,
        v_occurred_at_ms,
        v_entity_type,
        v_entity_id,
        v_event_type,
        v_schema_version,
        v_trace_id,
        v_payload,
        v_canonical_event,
        v_event_payload_hash,
        v_batch_id,
        p_sent_at_ms,
        v_now
      );

      update app_public.sync_device_ingest_state as state
        set last_sequence_in_device = v_sequence_in_device,
            last_batch_id = v_batch_id,
            last_sent_at_ms = p_sent_at_ms,
            updated_at = v_now
        where state.owner_user_id = v_owner_user_id
          and state.device_id = v_device_id;

      v_last_sequence_in_device := v_sequence_in_device;
    exception
      when others then
        return app_public.sync_ingest_failure(
          v_event_index,
          false,
          format('Projection apply failed: %s', sqlerrm),
          v_event_id
        );
    end;
  end loop;

  update app_public.sync_device_ingest_state as state
    set last_batch_id = v_batch_id,
        last_sent_at_ms = p_sent_at_ms,
        updated_at = v_now
    where state.owner_user_id = v_owner_user_id
      and state.device_id = v_device_id;

  return jsonb_build_object('status', 'SUCCESS');
end;
$$;

-- Public RPC wrapper using contract field names.
create or replace function app_public.sync_events_ingest(
  device_id text,
  batch_id text,
  sent_at_ms bigint,
  events jsonb
)
returns jsonb
language sql
set search_path = app_public, public, extensions
as $$
  select app_public.sync_events_ingest_impl(device_id, batch_id, sent_at_ms, events);
$$;

comment on function app_public.sync_events_ingest(text, text, bigint, jsonb) is
  'M13 batched sync ingest endpoint with idempotency by (owner_user_id, device_id, event_id) and strict per-device sequence ordering.';

revoke all on function app_public.sync_events_ingest(text, text, bigint, jsonb) from public;
revoke all on function app_public.sync_events_ingest(text, text, bigint, jsonb) from anon;
grant execute on function app_public.sync_events_ingest(text, text, bigint, jsonb) to authenticated, service_role;

-- Internal helper functions are not part of the public API contract.
revoke all on function app_public.sync_ingest_failure(integer, boolean, text, text) from public;
revoke all on function app_public.sync_apply_projection_event(uuid, text, text, text, bigint, jsonb) from public;
revoke all on function app_public.sync_events_ingest_impl(text, text, bigint, jsonb) from public;
grant execute on function app_public.sync_ingest_failure(integer, boolean, text, text) to authenticated, service_role;
grant execute on function app_public.sync_apply_projection_event(uuid, text, text, text, bigint, jsonb) to authenticated, service_role;
grant execute on function app_public.sync_events_ingest_impl(text, text, bigint, jsonb) to authenticated, service_role;

-- Source: 20260307120000_m14_sync_set_type_projection_patch.sql
-- M14 set-type sync projection patch:
-- ensure exercise_sets.set_type exists/validated and ingest projection applies set_type on upsert.

alter table app_public.exercise_sets
  add column if not exists set_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercise_sets_set_type_guard'
  ) then
    alter table app_public.exercise_sets
      add constraint exercise_sets_set_type_guard
      check (
        set_type is null
        or set_type in ('warm_up', 'rir_0', 'rir_1', 'rir_2')
      );
  end if;
end
$$;

create or replace function app_public.sync_apply_projection_event(
  p_owner_user_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_event_type text,
  p_occurred_at_ms bigint,
  p_payload jsonb
)
returns void
language plpgsql
set search_path = app_public, public, extensions
as $$
declare
  v_row_count bigint;
  v_id text;
  v_name text;
  v_origin_scope_id text;
  v_origin_source_id text;
  v_gym_id text;
  v_status text;
  v_started_at_ms bigint;
  v_completed_at_ms bigint;
  v_duration_sec integer;
  v_deleted_at_ms bigint;
  v_created_at_ms bigint;
  v_updated_at_ms bigint;
  v_session_id text;
  v_session_exercise_id text;
  v_exercise_definition_id text;
  v_order_index integer;
  v_machine_name text;
  v_weight_value text;
  v_reps_value text;
  v_set_type text;
  v_normalized_name text;
  v_row_id text;
  v_muscle_group_id text;
  v_weight double precision;
  v_role text;
  v_exercise_tag_definition_id text;
begin
  if p_owner_user_id is null then
    raise exception 'owner_user_id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;

  case p_entity_type
    when 'gyms' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for gyms events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for gyms events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_name := p_payload ->> 'name';
        v_origin_scope_id := coalesce(p_payload ->> 'origin_scope_id', 'private');
        v_origin_source_id := coalesce(p_payload ->> 'origin_source_id', 'local');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for gyms upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.gyms (
          id,
          owner_user_id,
          name,
          origin_scope_id,
          origin_source_id,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_name,
          v_origin_scope_id,
          v_origin_source_id,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set name = excluded.name,
              origin_scope_id = excluded.origin_scope_id,
              origin_source_id = excluded.origin_source_id,
              deleted_at = null,
              created_at = least(app_public.gyms.created_at, excluded.created_at),
              updated_at = greatest(app_public.gyms.updated_at, excluded.updated_at)
          where app_public.gyms.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'gyms id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.gyms
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing gym %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported gyms event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'sessions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for sessions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for sessions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_gym_id := nullif(btrim(coalesce(p_payload ->> 'gym_id', '')), '');
        v_status := p_payload ->> 'status';
        v_started_at_ms := (p_payload ->> 'started_at_ms')::bigint;
        v_completed_at_ms := (p_payload ->> 'completed_at_ms')::bigint;
        v_duration_sec := (p_payload ->> 'duration_sec')::integer;
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_status not in ('draft', 'active', 'completed') then
          raise exception 'payload.status must be draft|active|completed for sessions upsert' using errcode = '22023';
        end if;

        if v_started_at_ms < 0 or coalesce(v_completed_at_ms, 0) < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'session timestamps must be >= 0' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        if v_duration_sec is not null and v_duration_sec < 0 then
          raise exception 'duration_sec must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.sessions (
          id,
          owner_user_id,
          gym_id,
          status,
          started_at,
          completed_at,
          duration_sec,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_gym_id,
          v_status,
          v_started_at_ms,
          v_completed_at_ms,
          v_duration_sec,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set gym_id = excluded.gym_id,
              status = excluded.status,
              started_at = excluded.started_at,
              completed_at = excluded.completed_at,
              duration_sec = excluded.duration_sec,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.sessions.created_at, excluded.created_at),
              updated_at = greatest(app_public.sessions.updated_at, excluded.updated_at)
          where app_public.sessions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'sessions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.sessions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing session %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'complete' then
        v_completed_at_ms := (p_payload ->> 'completed_at_ms')::bigint;
        v_duration_sec := (p_payload ->> 'duration_sec')::integer;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_completed_at_ms < 0 or v_duration_sec < 0 or v_updated_at_ms < 0 then
          raise exception 'completed_at_ms, duration_sec, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.sessions
          set status = 'completed',
              completed_at = v_completed_at_ms,
              duration_sec = v_duration_sec,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot complete missing session %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported sessions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'session_exercises' then
      if not (p_payload ? 'id') and p_event_type <> 'reorder' then
        raise exception 'payload.id is required for session_exercises events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for session_exercises upsert' using errcode = '22023';
        end if;

        v_session_id := btrim(p_payload ->> 'session_id');
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_name := p_payload ->> 'name';
        v_machine_name := p_payload ->> 'machine_name';
        v_origin_scope_id := coalesce(p_payload ->> 'origin_scope_id', 'private');
        v_origin_source_id := coalesce(p_payload ->> 'origin_source_id', 'local');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_session_id = '' or v_exercise_definition_id = '' then
          raise exception 'session_id and exercise_definition_id are required for session_exercises upsert' using errcode = '22023';
        end if;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for session_exercises upsert' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index, created_at_ms, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.session_exercises
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_id = v_session_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        insert into app_public.session_exercises (
          id,
          owner_user_id,
          session_id,
          exercise_definition_id,
          order_index,
          name,
          machine_name,
          origin_scope_id,
          origin_source_id,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_session_id,
          v_exercise_definition_id,
          v_order_index,
          v_name,
          nullif(v_machine_name, ''),
          v_origin_scope_id,
          v_origin_source_id,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set session_id = excluded.session_id,
              exercise_definition_id = excluded.exercise_definition_id,
              order_index = excluded.order_index,
              name = excluded.name,
              machine_name = excluded.machine_name,
              origin_scope_id = excluded.origin_scope_id,
              origin_source_id = excluded.origin_source_id,
              deleted_at = null,
              created_at = least(app_public.session_exercises.created_at, excluded.created_at),
              updated_at = greatest(app_public.session_exercises.updated_at, excluded.updated_at)
          where app_public.session_exercises.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'session_exercises id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for session_exercises delete' using errcode = '22023';
        end if;

        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.session_exercises
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing session_exercise %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'reorder' then
        v_id := p_entity_id;
        v_session_id := btrim(p_payload ->> 'session_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, p_occurred_at_ms);

        if v_id = '' or v_session_id = '' then
          raise exception 'entity_id and payload.session_id are required for session_exercises reorder' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.session_exercises
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_id = v_session_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        update app_public.session_exercises
          set session_id = v_session_id,
              order_index = v_order_index,
              deleted_at = null,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot reorder missing session_exercise %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported session_exercises event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_sets' then
      if not (p_payload ? 'id') and p_event_type <> 'reorder' then
        raise exception 'payload.id is required for exercise_sets events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for exercise_sets upsert' using errcode = '22023';
        end if;

        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_weight_value := coalesce(p_payload ->> 'weight_value', '');
        v_reps_value := coalesce(p_payload ->> 'reps_value', '');
        v_set_type := nullif(btrim(coalesce(p_payload ->> 'set_type', '')), '');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_session_exercise_id = '' then
          raise exception 'payload.session_exercise_id is required for exercise_sets upsert' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index, created_at_ms, and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        if v_set_type is not null and v_set_type not in ('warm_up', 'rir_0', 'rir_1', 'rir_2') then
          raise exception 'payload.set_type must be warm_up|rir_0|rir_1|rir_2|null for exercise_sets upsert' using errcode = '22023';
        end if;

        update app_public.exercise_sets
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        insert into app_public.exercise_sets (
          id,
          owner_user_id,
          session_exercise_id,
          order_index,
          weight_value,
          reps_value,
          set_type,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_session_exercise_id,
          v_order_index,
          v_weight_value,
          v_reps_value,
          v_set_type,
          null,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set session_exercise_id = excluded.session_exercise_id,
              order_index = excluded.order_index,
              weight_value = excluded.weight_value,
              reps_value = excluded.reps_value,
              set_type = excluded.set_type,
              deleted_at = null,
              created_at = least(app_public.exercise_sets.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_sets.updated_at, excluded.updated_at)
          where app_public.exercise_sets.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_sets id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_id := btrim(p_payload ->> 'id');
        if v_id = '' or v_id <> p_entity_id then
          raise exception 'payload.id must match entity_id for exercise_sets delete' using errcode = '22023';
        end if;

        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_sets
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_set %', v_id using errcode = 'P0002';
        end if;
      elsif p_event_type = 'reorder' then
        v_id := p_entity_id;
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_order_index := (p_payload ->> 'order_index')::integer;
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, p_occurred_at_ms);

        if v_id = '' or v_session_exercise_id = '' then
          raise exception 'entity_id and payload.session_exercise_id are required for exercise_sets reorder' using errcode = '22023';
        end if;

        if v_order_index < 0 or v_updated_at_ms < 0 then
          raise exception 'order_index and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        update app_public.exercise_sets
          set deleted_at = coalesce(deleted_at, v_updated_at_ms),
              updated_at = greatest(updated_at, v_updated_at_ms)
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and order_index = v_order_index
            and id <> v_id
            and deleted_at is null;

        update app_public.exercise_sets
          set session_exercise_id = v_session_exercise_id,
              order_index = v_order_index,
              deleted_at = null,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot reorder missing exercise_set %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_sets event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_definitions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for exercise_definitions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for exercise_definitions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_name := p_payload ->> 'name';
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if length(btrim(v_name)) = 0 then
          raise exception 'payload.name is required for exercise_definitions upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'exercise_definitions timestamps must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.exercise_definitions (
          id,
          owner_user_id,
          name,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_name,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set name = excluded.name,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.exercise_definitions.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_definitions.updated_at, excluded.updated_at)
          where app_public.exercise_definitions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_definitions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_definitions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_definition %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_definitions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_muscle_mappings' then
      if p_event_type = 'attach' then
        v_row_id := btrim(p_payload ->> 'row_id');
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_muscle_group_id := btrim(p_payload ->> 'muscle_group_id');
        v_weight := (p_payload ->> 'weight')::double precision;
        v_role := p_payload ->> 'role';
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_row_id = '' or v_exercise_definition_id = '' or v_muscle_group_id = '' then
          raise exception 'row_id, exercise_definition_id, and muscle_group_id are required for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_weight <= 0 then
          raise exception 'payload.weight must be > 0 for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_role is not null and v_role not in ('primary', 'secondary', 'stabilizer') then
          raise exception 'payload.role must be primary|secondary|stabilizer|null for exercise_muscle_mappings attach' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 then
          raise exception 'created_at_ms and updated_at_ms must be >= 0' using errcode = '22023';
        end if;

        delete from app_public.exercise_muscle_mappings
          where owner_user_id = p_owner_user_id
            and (
              id = v_row_id
              or (
                exercise_definition_id = v_exercise_definition_id
                and muscle_group_id = v_muscle_group_id
              )
            );

        insert into app_public.exercise_muscle_mappings (
          id,
          owner_user_id,
          exercise_definition_id,
          muscle_group_id,
          weight,
          role,
          created_at,
          updated_at
        )
        values (
          v_row_id,
          p_owner_user_id,
          v_exercise_definition_id,
          v_muscle_group_id,
          v_weight,
          v_role,
          v_created_at_ms,
          v_updated_at_ms
        );
      elsif p_event_type = 'detach' then
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_muscle_group_id := btrim(p_payload ->> 'muscle_group_id');

        if v_exercise_definition_id = '' or v_muscle_group_id = '' then
          raise exception 'exercise_definition_id and muscle_group_id are required for exercise_muscle_mappings detach' using errcode = '22023';
        end if;

        delete from app_public.exercise_muscle_mappings
          where owner_user_id = p_owner_user_id
            and exercise_definition_id = v_exercise_definition_id
            and muscle_group_id = v_muscle_group_id;
      else
        raise exception 'unsupported exercise_muscle_mappings event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'exercise_tag_definitions' then
      if not (p_payload ? 'id') then
        raise exception 'payload.id is required for exercise_tag_definitions events' using errcode = '22023';
      end if;

      v_id := btrim(p_payload ->> 'id');
      if v_id = '' or v_id <> p_entity_id then
        raise exception 'payload.id must match entity_id for exercise_tag_definitions events' using errcode = '22023';
      end if;

      if p_event_type = 'upsert' then
        v_exercise_definition_id := btrim(p_payload ->> 'exercise_definition_id');
        v_name := p_payload ->> 'name';
        v_normalized_name := p_payload ->> 'normalized_name';
        v_deleted_at_ms := (p_payload ->> 'deleted_at_ms')::bigint;
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;
        v_updated_at_ms := (p_payload ->> 'updated_at_ms')::bigint;

        if v_exercise_definition_id = '' then
          raise exception 'payload.exercise_definition_id is required for exercise_tag_definitions upsert' using errcode = '22023';
        end if;

        if length(btrim(v_name)) = 0 or length(btrim(v_normalized_name)) = 0 then
          raise exception 'payload.name and payload.normalized_name are required for exercise_tag_definitions upsert' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 or v_updated_at_ms < 0 or coalesce(v_deleted_at_ms, 0) < 0 then
          raise exception 'exercise_tag_definitions timestamps must be >= 0' using errcode = '22023';
        end if;

        insert into app_public.exercise_tag_definitions (
          id,
          owner_user_id,
          exercise_definition_id,
          name,
          normalized_name,
          deleted_at,
          created_at,
          updated_at
        )
        values (
          v_id,
          p_owner_user_id,
          v_exercise_definition_id,
          v_name,
          v_normalized_name,
          v_deleted_at_ms,
          v_created_at_ms,
          v_updated_at_ms
        )
        on conflict (id)
        do update
          set exercise_definition_id = excluded.exercise_definition_id,
              name = excluded.name,
              normalized_name = excluded.normalized_name,
              deleted_at = excluded.deleted_at,
              created_at = least(app_public.exercise_tag_definitions.created_at, excluded.created_at),
              updated_at = greatest(app_public.exercise_tag_definitions.updated_at, excluded.updated_at)
          where app_public.exercise_tag_definitions.owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'exercise_tag_definitions id % belongs to a different owner', v_id using errcode = '42501';
        end if;
      elsif p_event_type = 'delete' then
        v_deleted_at_ms := coalesce((p_payload ->> 'deleted_at_ms')::bigint, p_occurred_at_ms);
        v_updated_at_ms := coalesce((p_payload ->> 'updated_at_ms')::bigint, v_deleted_at_ms);

        update app_public.exercise_tag_definitions
          set deleted_at = v_deleted_at_ms,
              updated_at = greatest(updated_at, v_updated_at_ms)
          where id = v_id
            and owner_user_id = p_owner_user_id;

        get diagnostics v_row_count = row_count;
        if v_row_count = 0 then
          raise exception 'cannot delete missing exercise_tag_definition %', v_id using errcode = 'P0002';
        end if;
      else
        raise exception 'unsupported exercise_tag_definitions event_type: %', p_event_type using errcode = '22023';
      end if;

    when 'session_exercise_tags' then
      if p_event_type = 'attach' then
        v_row_id := btrim(p_payload ->> 'row_id');
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_exercise_tag_definition_id := btrim(p_payload ->> 'exercise_tag_definition_id');
        v_created_at_ms := (p_payload ->> 'created_at_ms')::bigint;

        if v_row_id = '' or v_session_exercise_id = '' or v_exercise_tag_definition_id = '' then
          raise exception 'row_id, session_exercise_id, and exercise_tag_definition_id are required for session_exercise_tags attach' using errcode = '22023';
        end if;

        if v_created_at_ms < 0 then
          raise exception 'payload.created_at_ms must be >= 0 for session_exercise_tags attach' using errcode = '22023';
        end if;

        delete from app_public.session_exercise_tags
          where owner_user_id = p_owner_user_id
            and (
              id = v_row_id
              or (
                session_exercise_id = v_session_exercise_id
                and exercise_tag_definition_id = v_exercise_tag_definition_id
              )
            );

        insert into app_public.session_exercise_tags (
          id,
          owner_user_id,
          session_exercise_id,
          exercise_tag_definition_id,
          created_at
        )
        values (
          v_row_id,
          p_owner_user_id,
          v_session_exercise_id,
          v_exercise_tag_definition_id,
          v_created_at_ms
        );
      elsif p_event_type = 'detach' then
        v_session_exercise_id := btrim(p_payload ->> 'session_exercise_id');
        v_exercise_tag_definition_id := btrim(p_payload ->> 'exercise_tag_definition_id');

        if v_session_exercise_id = '' or v_exercise_tag_definition_id = '' then
          raise exception 'session_exercise_id and exercise_tag_definition_id are required for session_exercise_tags detach' using errcode = '22023';
        end if;

        delete from app_public.session_exercise_tags
          where owner_user_id = p_owner_user_id
            and session_exercise_id = v_session_exercise_id
            and exercise_tag_definition_id = v_exercise_tag_definition_id;
      else
        raise exception 'unsupported session_exercise_tags event_type: %', p_event_type using errcode = '22023';
      end if;

    else
      raise exception 'unsupported entity_type: %', p_entity_type using errcode = '22023';
  end case;
end;
$$;

-- Hosted ordering hotfix: session exercise definition references are durable
-- metadata and may point at seeded/local definitions or rows that sync later.
alter table app_public.session_exercises
  drop constraint if exists session_exercises_exercise_definition_owner_fk;

comment on column app_public.session_exercises.exercise_definition_id is
  'Durable exercise definition reference carried for history/sync metadata. The referenced definition may be seeded/local or arrive later via sync.';

-- Refresh hosted PostgREST schema cache after creating tables/functions.
notify pgrst, 'reload schema';
