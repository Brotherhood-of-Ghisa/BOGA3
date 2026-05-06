-- Hosted hotfix for first-sync ordering with seeded/local exercise definitions.
-- Run in Supabase Dashboard SQL Editor after hosted-bootstrap-sync.sql.

alter table app_public.session_exercises
  drop constraint if exists session_exercises_exercise_definition_owner_fk;

comment on column app_public.session_exercises.exercise_definition_id is
  'Durable exercise definition reference carried for history/sync metadata. The referenced definition may be seeded/local or arrive later via sync.';

notify pgrst, 'reload schema';
