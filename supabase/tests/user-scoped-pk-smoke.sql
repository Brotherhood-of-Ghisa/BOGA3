-- User-scoped composite-PK smoke test: prove that the user-scoped composite PK
-- lets two distinct users own a row with the same `id` in every sync-domain
-- table.
--
-- Run with the service-role connection (RLS bypass):
--   psql "postgresql://postgres:postgres@127.0.0.1:55522/postgres" \
--     -v ON_ERROR_STOP=1 \
--     -f supabase/tests/user-scoped-pk-smoke.sql
--
-- The script wraps everything in a transaction and rolls back at the end so it
-- leaves no residual fixture data behind. It uses two synthetic auth.users
-- ids; we insert them into auth.users directly because the only goal is to
-- exercise the FK + PK shape.

\set ON_ERROR_STOP on

begin;

-- Two distinct synthetic users.
do $$
declare
  v_user_a uuid := '00000000-0000-0000-0000-00000000aaaa';
  v_user_b uuid := '00000000-0000-0000-0000-00000000bbbb';
  v_shared_id text := 'pk-smoke-shared-id';
  v_now bigint := 1700000000000;
  v_count integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pk-smoke-a@example.com', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pk-smoke-b@example.com', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now())
  on conflict (id) do nothing;

  -- gyms: same shared id under two owners.
  insert into app_public.gyms (id, owner_user_id, name, created_at, updated_at)
  values (v_shared_id, v_user_a, 'Gym A', v_now, v_now);
  insert into app_public.gyms (id, owner_user_id, name, created_at, updated_at)
  values (v_shared_id, v_user_b, 'Gym B', v_now, v_now);

  -- exercise_definitions: same shared id under two owners.
  insert into app_public.exercise_definitions (id, owner_user_id, name, created_at, updated_at)
  values (v_shared_id, v_user_a, 'Squat A', v_now, v_now);
  insert into app_public.exercise_definitions (id, owner_user_id, name, created_at, updated_at)
  values (v_shared_id, v_user_b, 'Squat B', v_now, v_now);

  -- muscle_groups: same shared id under two owners (parent of the mapping below).
  insert into app_public.muscle_groups (id, owner_user_id, display_name, family_name, sort_order, is_editable, created_at, updated_at)
  values (v_shared_id, v_user_a, 'Quadriceps A', 'legs', 0, 0, v_now, v_now);
  insert into app_public.muscle_groups (id, owner_user_id, display_name, family_name, sort_order, is_editable, created_at, updated_at)
  values (v_shared_id, v_user_b, 'Quadriceps B', 'legs', 0, 0, v_now, v_now);

  -- sessions: same shared id under two owners.
  insert into app_public.sessions (id, owner_user_id, status, started_at, created_at, updated_at)
  values (v_shared_id, v_user_a, 'draft', v_now, v_now, v_now);
  insert into app_public.sessions (id, owner_user_id, status, started_at, created_at, updated_at)
  values (v_shared_id, v_user_b, 'draft', v_now, v_now, v_now);

  -- session_exercises: same shared id under two owners.
  insert into app_public.session_exercises (
    id, owner_user_id, session_id, exercise_definition_id, order_index, name, created_at, updated_at
  ) values
    (v_shared_id, v_user_a, v_shared_id, v_shared_id, 0, 'Set A', v_now, v_now),
    (v_shared_id, v_user_b, v_shared_id, v_shared_id, 0, 'Set B', v_now, v_now);

  -- exercise_sets: same shared id under two owners.
  insert into app_public.exercise_sets (
    id, owner_user_id, session_exercise_id, order_index, weight_value, reps_value, created_at, updated_at
  ) values
    (v_shared_id, v_user_a, v_shared_id, 0, '100', '10', v_now, v_now),
    (v_shared_id, v_user_b, v_shared_id, 0, '110', '8', v_now, v_now);

  -- exercise_muscle_mappings: same shared id under two owners.
  insert into app_public.exercise_muscle_mappings (
    id, owner_user_id, exercise_definition_id, muscle_group_id, weight, role, created_at, updated_at
  ) values
    (v_shared_id, v_user_a, v_shared_id, v_shared_id, 1.0, 'primary', v_now, v_now),
    (v_shared_id, v_user_b, v_shared_id, v_shared_id, 1.0, 'primary', v_now, v_now);

  -- exercise_tag_definitions: same shared id under two owners.
  insert into app_public.exercise_tag_definitions (
    id, owner_user_id, exercise_definition_id, name, normalized_name, created_at, updated_at
  ) values
    (v_shared_id, v_user_a, v_shared_id, 'Heavy', 'heavy', v_now, v_now),
    (v_shared_id, v_user_b, v_shared_id, 'Heavy', 'heavy', v_now, v_now);

  -- session_exercise_tags: same shared id under two owners.
  insert into app_public.session_exercise_tags (
    id, owner_user_id, session_exercise_id, exercise_tag_definition_id, created_at
  ) values
    (v_shared_id, v_user_a, v_shared_id, v_shared_id, v_now),
    (v_shared_id, v_user_b, v_shared_id, v_shared_id, v_now);

  -- Sanity: each table has exactly two rows with the shared id.
  for v_count in
    select count(*) from app_public.gyms where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'gyms: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.exercise_definitions where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'exercise_definitions: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.sessions where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'sessions: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.session_exercises where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'session_exercises: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.exercise_sets where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'exercise_sets: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.muscle_groups where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'muscle_groups: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.exercise_muscle_mappings where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'exercise_muscle_mappings: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.exercise_tag_definitions where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'exercise_tag_definitions: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  for v_count in
    select count(*) from app_public.session_exercise_tags where id = v_shared_id
  loop
    if v_count <> 2 then
      raise exception 'session_exercise_tags: expected 2 rows for shared id, got %', v_count;
    end if;
  end loop;

  raise notice 'T1 smoke: all nine sync tables accept shared id across two owners.';
end
$$;

rollback;
