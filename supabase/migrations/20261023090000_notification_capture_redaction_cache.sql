-- Notification capture checked bodyweight disclosure once per score row: each
-- ranks call scanned the target member's whole counting history and called
-- group_competition_redacts_exercise (about 500 pages, not inlined) for every
-- row, so publish pages grew with history while the distinct answers are only
-- members x definitions. Each capture statement now asks once per distinct
-- (group, member, definition) in a materialized CTE and looks the answer up.
-- One statement sees one snapshot, so the cached answer is the per-row answer;
-- the boundary rechecks between statements still run live. A lookup that
-- misses the CTE falls back to the live call, so results stay identical.
-- Patched on the final definitions, as 20261018114125 patches its anchors.
create function pg_temp.redaction_calls(p_definition text,p_expected integer,p_label text) returns void
language plpgsql as $$
declare _calls integer:=(length(p_definition)-length(replace(p_definition,'group_competition_redacts_exercise(','')))
  /length('group_competition_redacts_exercise(');
begin
  if _calls<>p_expected then
    raise exception 'notification redaction cache: % has % redaction calls, expected %',p_label,_calls,p_expected;
  end if;
end $$;

create function pg_temp.redaction_patch(p_definition text,p_anchor text,p_replacement text,p_count integer,p_label text)
returns text language plpgsql as $$
begin
  if (length(p_definition)-length(replace(p_definition,p_anchor,'')))<>p_count*length(p_anchor) then
    raise exception 'notification redaction cache: % anchor not found % time(s)',p_label,p_count;
  end if;
  return replace(p_definition,p_anchor,p_replacement);
end $$;

do $patch$
declare
  _definition text;
begin
  -- Ranks: every redaction is for the target member in p_group; only the
  -- definition varies, across its counting score rows and saved scores.
  _definition:=pg_get_functiondef(
    'app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb)'::regprocedure);
  _definition:=pg_temp.redaction_patch(_definition,$a$  qualified_saved as (
$a$,$r$  redaction as materialized(
    select d.definition,group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,d.definition) as redacted
    from (select s.exercise_definition_id as definition from group_metric_set_scores s
        where s.group_exercise_id=p_exercise and s.rules_revision=p_revision
          and s.member_user_id=(p_target).member_user_id and s.counting
      union select b->>'exercise_definition_id' from saved_sources) d
    where (p_target).member_user_id is not null
  ),
  qualified_saved as (
$r$,1,'ranks cte');
  _definition:=pg_temp.redaction_patch(_definition,
    $a$not group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,b->>'exercise_definition_id')$a$,
    $r$not coalesce((select r.redacted from redaction r where r.definition is not distinct from b->>'exercise_definition_id'),
          group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,b->>'exercise_definition_id'))$r$,
    1,'ranks saved');
  _definition:=pg_temp.redaction_patch(_definition,
    $a$not group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,s.exercise_definition_id)$a$,
    $r$not coalesce((select r.redacted from redaction r where r.definition is not distinct from s.exercise_definition_id),
          group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,s.exercise_definition_id))$r$,
    2,'ranks eligible');
  -- The CTE plus one fallback per lookup: no per-row call is left unpatched.
  perform pg_temp.redaction_calls(_definition,4,'ranks');
  execute _definition;

  -- Baseline: one member and session; group and definition come from its rows.
  _definition:=pg_get_functiondef(
    'app_public.notification_baseline_scores(uuid,text,uuid,bigint,jsonb)'::regprocedure);
  _definition:=pg_temp.redaction_patch(_definition,$a$  winners as (
$a$,$r$  redaction as materialized(
    select d.group_id,d.definition,group_competition_redacts_exercise(array[d.group_id],p_member,d.definition) as redacted
    from (select distinct ge.group_id,s.exercise_definition_id as definition from group_metric_set_scores s
      join group_exercises ge on ge.id=s.group_exercise_id
      where s.member_user_id=p_member and s.session_id=p_session and s.group_exercise_id=p_exercise
        and s.rules_revision=p_revision and s.counting) d
  ),
  winners as (
$r$,1,'baseline cte');
  _definition:=pg_temp.redaction_patch(_definition,
    $a$not group_competition_redacts_exercise(array[ge.group_id],p_member,s.exercise_definition_id)$a$,
    $r$not coalesce((select r.redacted from redaction r where r.group_id=ge.group_id
            and r.definition is not distinct from s.exercise_definition_id),
            group_competition_redacts_exercise(array[ge.group_id],p_member,s.exercise_definition_id))$r$,
    1,'baseline winners');
  perform pg_temp.redaction_calls(_definition,2,'baseline');
  execute _definition;

  -- Controls: one target member and session, one lookup per scored set.
  _definition:=pg_get_functiondef(
    'app_public.notification_source_controls(app_public.notification_workout_targets,jsonb)'::regprocedure);
  _definition:=pg_temp.redaction_patch(_definition,$a$  state as (select s.* from group_metric_board_state s$a$,
    $r$  redaction as materialized(
    select d.group_id,d.member_user_id,d.definition,
      group_competition_redacts_exercise(array[d.group_id],d.member_user_id,d.definition) as redacted
    from (select distinct ge.group_id,s.member_user_id,s.exercise_definition_id as definition from group_metric_set_scores s
      join group_exercises ge on ge.id=s.group_exercise_id
      where s.group_exercise_id=(p_target).group_exercise_id and s.rules_revision=(p_target).rules_revision
        and s.member_user_id=(p_target).member_user_id and s.session_id=(p_target).session_id and s.counting) d
  ),
  state as (select s.* from group_metric_board_state s$r$,1,'controls cte');
  _definition:=pg_temp.redaction_patch(_definition,
    $a$not group_competition_redacts_exercise(array[ge.group_id],s.member_user_id,s.exercise_definition_id)$a$,
    $r$not coalesce((select r.redacted from redaction r where r.group_id=ge.group_id
              and r.member_user_id=s.member_user_id and r.definition is not distinct from s.exercise_definition_id),
              group_competition_redacts_exercise(array[ge.group_id],s.member_user_id,s.exercise_definition_id))$r$,
    1,'controls certified');
  perform pg_temp.redaction_calls(_definition,2,'controls');
  execute _definition;
end
$patch$;

drop function pg_temp.redaction_patch(text,text,text,integer,text);
drop function pg_temp.redaction_calls(text,integer,text);
