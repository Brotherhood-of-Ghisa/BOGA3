-- Treat session_exercises.exercise_definition_id as durable metadata, not a hard
-- backend FK, so first-sync outbox events can arrive before their definition row.

alter table app_public.session_exercises
  drop constraint if exists session_exercises_exercise_definition_owner_fk;

comment on column app_public.session_exercises.exercise_definition_id is
  'Durable exercise definition reference carried for history/sync metadata. The referenced definition may be seeded/local or arrive later via sync.';
