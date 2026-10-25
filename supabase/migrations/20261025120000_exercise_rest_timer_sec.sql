-- Per-exercise rest timer default: a synced, user-owned, nullable whole number
-- of seconds on the definition. Null means the exercise uses the device's
-- global rest timer, so existing rows need no backfill. The 15-600 range is
-- enforced by the app and the agent API, never by a server CHECK (a range
-- rejection would wedge a client's push backlog); readers ignore a value outside it.
--
-- The column is additive, so the sync protocol does not move (see
-- docs/specs/05-data-model.md, "Client schema drift rule"). This migration
-- deploys before the agent-api Edge Function that selects the column and
-- before the app release that writes it.

alter table app_public.exercise_definitions
  add column rest_timer_sec integer;

-- Patch the installed sync and agent functions in place so historical
-- migrations stay immutable. Each replacement must match exactly once, so a
-- future baseline edit fails this migration instead of silently leaving an
-- asymmetric wire contract.
create function pg_temp.replace_once(definition text, old text, new text, label text)
returns text
language plpgsql
as $fn$
begin
  if (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 then
    raise exception 'rest_timer_sec failed to patch %', label;
  end if;
  return replace(definition, old, new);
end
$fn$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  definition := pg_temp.replace_once(definition,
    $old$        owner_user_id,id,name,load_input_mode,bodyweight_contribution,split_by_gym,$old$,
    $new$        owner_user_id,id,name,load_input_mode,bodyweight_contribution,split_by_gym,rest_timer_sec,$new$,
    'sync_push: exercise_definitions insert columns');

  -- A writer that omits the key inserts null (the global timer).
  definition := pg_temp.replace_once(definition,
    $old$        coalesce((_fields->>'split_by_gym')::boolean,false),$old$,
    $new$        coalesce((_fields->>'split_by_gym')::boolean,false),
        (_fields->>'rest_timer_sec')::integer,$new$,
    'sync_push: exercise_definitions insert values');

  -- Omitted-field preservation: only a payload that carried the key may replace
  -- a stored value, so a writer predating the field cannot clear it for a
  -- device that set it.
  definition := pg_temp.replace_once(definition,
    $old$          else app_public.exercise_definitions.split_by_gym end,$old$,
    $new$          else app_public.exercise_definitions.split_by_gym end,
        rest_timer_sec=case when _fields ? 'rest_timer_sec' then excluded.rest_timer_sec
          else app_public.exercise_definitions.rest_timer_sec end,$new$,
    'sync_push: exercise_definitions omitted-field preservation');

  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    $old$             'split_by_gym', ed.split_by_gym,$old$,
    $new$             'split_by_gym', ed.split_by_gym,
             'rest_timer_sec', ed.rest_timer_sec,$new$,
    'sync_pull: exercise_definitions pull fields');
  execute definition;
end
$migration$;

-- Agent exercise writes: create stores the normalized value (null when the
-- agent sent none); update replaces it only when the change carries the key,
-- and an explicit null clears it back to the global timer.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(
    'app_public.agent_create_exercise(uuid,text,text,text,jsonb)'::regprocedure
  ) into definition;

  definition := pg_temp.replace_once(definition,
    $old$    owner_user_id, id, name, load_input_mode, bodyweight_contribution, split_by_gym,$old$,
    $new$    owner_user_id, id, name, load_input_mode, bodyweight_contribution, split_by_gym, rest_timer_sec,$new$,
    'agent_create_exercise: insert columns');

  definition := pg_temp.replace_once(definition,
    $old$    (p_exercise ->> 'split_by_gym')::boolean,$old$,
    $new$    (p_exercise ->> 'split_by_gym')::boolean,
    (p_exercise ->> 'rest_timer_sec')::integer,$new$,
    'agent_create_exercise: insert values');

  execute definition;

  select pg_get_functiondef(
    'app_public.agent_update_exercise(uuid,text,text,text,text,bigint,jsonb)'::regprocedure
  ) into definition;

  definition := pg_temp.replace_once(definition,
    $old$         split_by_gym = coalesce((p_changes ->> 'split_by_gym')::boolean, d.split_by_gym),$old$,
    $new$         split_by_gym = coalesce((p_changes ->> 'split_by_gym')::boolean, d.split_by_gym),
         rest_timer_sec = case when p_changes ? 'rest_timer_sec'
                               then (p_changes ->> 'rest_timer_sec')::integer
                               else d.rest_timer_sec end,$new$,
    'agent_update_exercise: rest_timer_sec');

  execute definition;
end
$migration$;

drop function pg_temp.replace_once(text, text, text, text);
