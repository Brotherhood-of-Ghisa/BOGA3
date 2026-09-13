-- M25-T01: group exercises — a group's own catalogue of comparison exercises.
--
-- Contract: docs/specs/tech/groups-contract.md §2.6 (table), §4.4 (RPCs).
-- One domain type, two stores (M25 design T1): personal exercises stay the
-- Sync v2 `exercise_definitions`; a group exercise lives here, is written only
-- by the SECURITY DEFINER RPCs below (owner/admin), and is read by any active
-- member. Its shared fields are the TS `ExerciseCore` ({ name, loadInputMode },
-- apps/mobile/src/exercise-core), and the rules below mirror that validator:
-- the name is JS-`String#trim`med and non-empty, the load mode is exact.
--
-- Ground rules (contract §2): no `owner_user_id` column; no FK into the Sync v2
-- tables (`source_exercise_id` is a plain id from the client's seed catalogue);
-- RLS on with no policies and no anon/authenticated privileges; CHECKs on the
-- server-only columns.
--
-- Errors (contract §4): raise exception '<TOKEN>: <message>' using errcode = 'P0001'.

-- -----------------------------------------------------------------------------
-- JS `String.prototype.trim` (ECMAScript WhiteSpace + LineTerminator), so the
-- server trims exactly what `validateExerciseCore` trims. Postgres `btrim`
-- strips only spaces. Parity is proven by the shared vectors in
-- apps/mobile/src/exercise-core/exercise-core-vectors.json.
-- -----------------------------------------------------------------------------

create function app_public.group_exercise_trim(p_value text)
returns text
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select regexp_replace(
    p_value,
    '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
      || '|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g');
$$;

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------

create table app_public.group_exercises (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references app_public.groups (id) on delete cascade,
  name               text not null,
  load_input_mode    text not null,
  source_exercise_id text null,
  archived_at        timestamptz null,
  created_by         uuid null references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint group_exercises_name_trimmed_non_empty
    check (name <> '' and name = app_public.group_exercise_trim(name)),
  constraint group_exercises_load_input_mode_valid
    check (load_input_mode in ('total_load', 'per_side_load')),
  constraint group_exercises_source_exercise_id_trimmed_bounds
    check (
      source_exercise_id is null
      or (
        source_exercise_id = app_public.group_exercise_trim(source_exercise_id)
        and char_length(source_exercise_id) between 1 and 100
      )
    )
);

comment on table app_public.group_exercises is
  'M25 group exercises: a group''s comparison catalogue (name + load_input_mode, optionally copied from a standard seed id). Server-authoritative; direct client access denied (RLS, no policies, no grants). Access only via app_public.group_exercise_* RPCs.';
comment on column app_public.group_exercises.source_exercise_id is
  'The standard-catalogue id the client copied it from (e.g. seed_barbell_bench_press); null for a custom exercise. No FK: seed ids live in each user''s Sync v2 keyspace.';
comment on column app_public.group_exercises.archived_at is
  'Null = active. Archived keeps its links and a read-only board and is not offered for new links (D8).';

create index group_exercises_group_id on app_public.group_exercises (group_id);

alter table app_public.group_exercises enable row level security;
revoke all on table app_public.group_exercises from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_exercises to service_role;

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- -----------------------------------------------------------------------------

-- Trimmed, non-empty name or VALIDATION (ExerciseCore `name_required`).
create function app_public.group_exercise_validate_name(p_name text)
returns text
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
declare
  _name text := app_public.group_exercise_trim(p_name);
begin
  if _name is null or _name = '' then
    raise exception 'VALIDATION: exercise name is required'
      using errcode = 'P0001';
  end if;
  return _name;
end;
$$;

-- Exact load mode or VALIDATION (ExerciseCore `load_input_mode_invalid`).
create function app_public.group_exercise_validate_load_input_mode(p_load_input_mode text)
returns text
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
begin
  if p_load_input_mode is null or p_load_input_mode not in ('total_load', 'per_side_load') then
    raise exception 'VALIDATION: load_input_mode must be total_load or per_side_load'
      using errcode = 'P0001';
  end if;
  return p_load_input_mode;
end;
$$;

-- Null (a custom exercise) or a trimmed 1–100 character standard id, else VALIDATION.
create function app_public.group_exercise_validate_source_id(p_source_exercise_id text)
returns text
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
declare
  _source text := app_public.group_exercise_trim(p_source_exercise_id);
begin
  if p_source_exercise_id is null then
    return null;
  end if;
  if char_length(_source) not between 1 and 100 then
    raise exception 'VALIDATION: source_exercise_id must be 1–100 characters after trimming'
      using errcode = 'P0001';
  end if;
  return _source;
end;
$$;

-- The caller's role after locking the group, or NOT_FOUND / FORBIDDEN
-- (owner and admins manage the catalogue).
create function app_public.group_exercise_require_manager(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _role text := app_public.group_require_member(p_group_id, p_user_id, true);
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can manage group exercises'
      using errcode = 'P0001';
  end if;
  return _role;
end;
$$;

-- The group's exercise, locked for update, or NOT_FOUND. An exercise of
-- another group and a nonexistent id get the same body.
create function app_public.group_exercise_require(p_group_id uuid, p_exercise_id uuid)
returns app_public.group_exercises
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _row app_public.group_exercises;
begin
  select e.*
    into _row
    from app_public.group_exercises e
   where e.id = p_exercise_id
     and e.group_id = p_group_id
     for update;
  if not found then
    raise exception 'NOT_FOUND: group exercise not found'
      using errcode = 'P0001';
  end if;
  return _row;
end;
$$;

-- GroupExercise wire shape (contract §4.4).
create function app_public.group_exercise_json(p_exercise app_public.group_exercises)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'group_exercise_id', p_exercise.id,
    'name', p_exercise.name,
    'load_input_mode', p_exercise.load_input_mode,
    'source_exercise_id', p_exercise.source_exercise_id,
    'archived_at_ms', floor(extract(epoch from p_exercise.archived_at) * 1000)::bigint
  );
$$;

-- -----------------------------------------------------------------------------
-- Read
-- -----------------------------------------------------------------------------

-- Every exercise of the group, archived ones included and flagged by a
-- non-null archived_at_ms: active first, then lower(name), name, id.
create function app_public.group_exercise_list(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
begin
  perform app_public.group_require_member(p_group_id, _uid, false);
  return jsonb_build_object(
    'exercises',
    coalesce((
      select jsonb_agg(
               app_public.group_exercise_json(e)
               order by (e.archived_at is not null), lower(e.name), e.name, e.id
             )
        from app_public.group_exercises e
       where e.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Writes (owner, admin). Check order as M22: preamble → membership (NOT_FOUND)
-- → role (FORBIDDEN) → input (VALIDATION) → target (NOT_FOUND).
-- -----------------------------------------------------------------------------

-- A custom exercise (p_source_exercise_id null) or a copy of a standard one,
-- whose name and load mode the client supplies from its seed data.
create function app_public.group_exercise_create(
  p_group_id uuid,
  p_name text,
  p_load_input_mode text,
  p_source_exercise_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid    uuid := app_public.group_require_app_user();
  _role   text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _name   text := app_public.group_exercise_validate_name(p_name);
  _mode   text := app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _source text := app_public.group_exercise_validate_source_id(p_source_exercise_id);
  _row    app_public.group_exercises;
begin
  insert into app_public.group_exercises (group_id, name, load_input_mode, source_exercise_id, created_by)
  values (p_group_id, _name, _mode, _source, _uid)
  returning * into _row;

  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

-- Full replacement of the ExerciseCore fields. The source id is provenance and
-- never changes. An archived exercise is read-only (D8): unarchive it first.
create function app_public.group_exercise_update(
  p_group_id uuid,
  p_exercise_id uuid,
  p_name text,
  p_load_input_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _name text := app_public.group_exercise_validate_name(p_name);
  _mode text := app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _row  app_public.group_exercises := app_public.group_exercise_require(p_group_id, p_exercise_id);
begin
  if _row.archived_at is not null then
    raise exception 'VALIDATION: an archived group exercise is read-only; unarchive it first'
      using errcode = 'P0001';
  end if;

  update app_public.group_exercises
     set name = _name, load_input_mode = _mode, updated_at = now()
   where id = _row.id
  returning * into _row;

  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

-- Idempotent: archiving an archived exercise keeps its original archived_at.
create function app_public.group_exercise_archive(p_group_id uuid, p_exercise_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _row  app_public.group_exercises := app_public.group_exercise_require(p_group_id, p_exercise_id);
begin
  if _row.archived_at is null then
    update app_public.group_exercises
       set archived_at = now(), updated_at = now()
     where id = _row.id
    returning * into _row;
  end if;
  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

-- Idempotent: unarchiving an active exercise changes nothing.
create function app_public.group_exercise_unarchive(p_group_id uuid, p_exercise_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_exercise_require_manager(p_group_id, _uid);
  _row  app_public.group_exercises := app_public.group_exercise_require(p_group_id, p_exercise_id);
begin
  if _row.archived_at is not null then
    update app_public.group_exercises
       set archived_at = null, updated_at = now()
     where id = _row.id
    returning * into _row;
  end if;
  return jsonb_build_object('exercise', app_public.group_exercise_json(_row));
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function app_public.group_exercise_trim(text) from public, anon, authenticated;
revoke all on function app_public.group_exercise_validate_name(text) from public, anon, authenticated;
revoke all on function app_public.group_exercise_validate_load_input_mode(text) from public, anon, authenticated;
revoke all on function app_public.group_exercise_validate_source_id(text) from public, anon, authenticated;
revoke all on function app_public.group_exercise_require_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function app_public.group_exercise_require(uuid, uuid) from public, anon, authenticated;
revoke all on function app_public.group_exercise_json(app_public.group_exercises) from public, anon, authenticated;

-- Client RPCs: anon is granted so the function itself emits AUTH_REQUIRED
-- instead of PostgREST raising 42501 (same posture as the M22 RPCs).
do $grants$
declare
  _sig text;
begin
  foreach _sig in array array[
    'group_exercise_list(uuid)',
    'group_exercise_create(uuid, text, text, text)',
    'group_exercise_update(uuid, uuid, text, text)',
    'group_exercise_archive(uuid, uuid)',
    'group_exercise_unarchive(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public', _sig);
    execute format('grant execute on function app_public.%s to anon, authenticated, service_role', _sig);
  end loop;
end
$grants$;
