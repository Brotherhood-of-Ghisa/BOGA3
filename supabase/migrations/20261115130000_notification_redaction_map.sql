-- Notification readiness and the publication captures asked the redaction
-- function (group_competition_redacts_exercise, ~370 pages a call) for the same
-- (member, definition) pairs over and over: board_rows once per ranked entry in
-- every ranks call, and readiness ranks twice, a capture twice per workout
-- target. One change, which changes no answer:
--
--  * A proof asks each distinct pair once, as a map (group_competition_redaction_key,
--    as the history readers do), and hands it to the ranks and the board rows
--    it runs. A pair the map lacks is asked live, so a missing key can cost
--    pages but never change an answer. Readiness is one statement-snapshot
--    function, so the map is the per-row answer. A capture builds its map
--    before its own disclosure baseline; the live check at its end still
--    compares against the live function, so a change in between that alters the
--    common board still aborts the publication. A change that only alters a
--    target's own without-workout ranks fails closed: readiness recomputes
--    from a fresh map, the comparison no longer holds, and nothing is sent.

-- Board rows: the redaction check reads the map first.
create function pg_temp.patch(p_definition text,p_anchor text,p_replacement text,p_count integer,p_label text)
returns text language plpgsql as $$
begin
  if (length(p_definition)-length(replace(p_definition,p_anchor,'')))<>p_count*length(p_anchor) then
    raise exception 'notification redaction map: % anchor not found % time(s)',p_label,p_count;
  end if;
  return replace(p_definition,p_anchor,p_replacement);
end $$;

do $boards$
declare _definition text;
begin
  _definition:=pg_get_functiondef(
    'app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean)'::regprocedure);
  _definition:=pg_temp.patch(_definition,'p_metric text, p_certified boolean)','p_metric text, p_certified boolean, p_redactions jsonb)',1,'board signature');
  _definition:=pg_temp.patch(_definition,
    $a$not app_public.group_competition_redacts_exercise(array[p_group],e.member_user_id,
        e.performance->>'exercise_definition_id')$a$,
    $r$not coalesce((p_redactions->>app_public.group_competition_redaction_key(e.member_user_id,e.performance->>'exercise_definition_id'))::boolean,
        app_public.group_competition_redacts_exercise(array[p_group],e.member_user_id,e.performance->>'exercise_definition_id'))$r$,
    1,'board redaction');
  execute _definition;
end
$boards$;
revoke all on function app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean,jsonb) from public,anon,authenticated,service_role;

create or replace function app_public.group_competition_board_rows(p_group uuid, p_exercise uuid, p_revision bigint, p_metric text, p_certified boolean)
returns table(rank integer, member_user_id uuid, row_json jsonb)
language sql stable set search_path=app_public,pg_temp as $$
  select * from app_public.group_competition_board_rows(p_group,p_exercise,p_revision,p_metric,p_certified,null::jsonb);
$$;

-- The redaction answers a readiness proof or capture of one exercise asks:
-- every (member, definition) its boards rank, and the target member's own
-- definitions. One answer per distinct pair.
create function app_public.notification_redaction_map(p_group uuid,p_exercise uuid,p_revision bigint,
  p_target app_public.notification_workout_targets) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with pairs as materialized (
    select e.member_user_id as member,e.performance->>'exercise_definition_id' as definition
    from (values ('volume'),('e1rm')) m(metric) cross join (values (false),(true)) c(certified)
    cross join lateral app_public.group_metric_entries(p_exercise,p_revision,m.metric,c.certified) e
    union
    select (p_target).member_user_id,s.exercise_definition_id from app_public.group_metric_set_scores s
      where (p_target).member_user_id is not null and s.group_exercise_id=p_exercise and s.rules_revision=p_revision
        and s.member_user_id=(p_target).member_user_id and s.counting
    union
    select (p_target).member_user_id,b->>'exercise_definition_id'
      from jsonb_array_elements(coalesce((p_target).baseline_scores,'[]'::jsonb)||coalesce((p_target).admission_scores,'[]'::jsonb)) b
      where (p_target).member_user_id is not null
  ), packed as (select array_agg(member) as members,array_agg(definition) as definitions from pairs)
  select coalesce(jsonb_object_agg(app_public.group_competition_redaction_key(r.member_user_id,r.definition_id),r.redacted),'{}'::jsonb)
  from packed cross join lateral app_public.group_competition_redactions(p_group,packed.members,packed.definitions) r;
$$;
revoke all on function app_public.notification_redaction_map(uuid,uuid,bigint,app_public.notification_workout_targets)
  from public,anon,authenticated,service_role;

-- Ranks: the map feeds the board rows and the target member's definitions.
do $ranks$
declare _definition text;
begin
  _definition:=pg_get_functiondef(
    'app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb)'::regprocedure);
  _definition:=pg_temp.patch(_definition,'p_target app_public.notification_workout_targets, p_graph jsonb)',
    'p_target app_public.notification_workout_targets, p_graph jsonb, p_redactions jsonb)',1,'ranks signature');
  _definition:=pg_temp.patch(_definition,'group_competition_board_rows(p_group,p_exercise,p_revision,d.metric,d.certified)',
    'group_competition_board_rows(p_group,p_exercise,p_revision,d.metric,d.certified,p_redactions)',1,'ranks board rows');
  _definition:=pg_temp.patch(_definition,
    'group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,d.definition) as redacted',
    $r$coalesce((p_redactions->>group_competition_redaction_key((p_target).member_user_id,d.definition))::boolean,
      group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,d.definition)) as redacted$r$,1,'ranks redaction cte');
  execute _definition;
end
$ranks$;
revoke all on function app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function app_public.notification_ranks_from_graph(p_group uuid,p_exercise uuid,p_revision bigint,
  p_target app_public.notification_workout_targets,p_graph jsonb) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  select notification_ranks_from_graph(p_group,p_exercise,p_revision,p_target,p_graph,null::jsonb);
$$;

-- Target capture: the map reaches both rank checks.
do $capture$
declare _definition text;
begin
  _definition:=pg_get_functiondef(
    'app_public.notification_target_capture_from_graph(app_public.notification_workout_targets,jsonb,boolean)'::regprocedure);
  _definition:=pg_temp.patch(_definition,'p_graph jsonb, p_after boolean DEFAULT false)',
    'p_graph jsonb, p_after boolean, p_redactions jsonb)',1,'capture signature');
  _definition:=pg_temp.patch(_definition,'target.rules_revision,null,p_graph)','target.rules_revision,null,p_graph,p_redactions)',1,'capture actual');
  _definition:=pg_temp.patch(_definition,'target.rules_revision,target,p_graph)','target.rules_revision,target,p_graph,p_redactions)',1,'capture without');
  execute _definition;
end
$capture$;
revoke all on function app_public.notification_target_capture_from_graph(app_public.notification_workout_targets,jsonb,boolean,jsonb)
  from public,anon,authenticated,service_role;

create or replace function app_public.notification_target_capture_from_graph(p_target app_public.notification_workout_targets,
  p_graph jsonb,p_after boolean default false) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  select notification_target_capture_from_graph(p_target,p_graph,p_after,null::jsonb);
$$;

-- The comparison capture: the map is built once for the exercise and shared by
-- every target's captures and the disclosure baseline. The boundary check at
-- the end stays live.
do $comparison$
declare _definition text;
begin
  _definition:=pg_get_functiondef(
    'app_public.notification_capture_comparison_from_graph(uuid,uuid,bigint,boolean,jsonb)'::regprocedure);
  _definition:=pg_temp.patch(_definition,'target_exists boolean; common_actual jsonb;','target_exists boolean; common_actual jsonb; redactions jsonb;',1,'comparison declare');
  _definition:=pg_temp.patch(_definition,'  common_actual:=notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g);',
    $r$  redactions:=notification_redaction_map(p_group,p_exercise,p_revision,null);
  common_actual:=notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g,redactions);$r$,1,'comparison baseline');
  _definition:=pg_temp.patch(_definition,'capture:=notification_target_capture_from_graph(probe,g,p_after);',
    'capture:=notification_target_capture_from_graph(probe,g,p_after,redactions);',1,'comparison capture');
  execute _definition;
end
$comparison$;

-- Readiness: one map per target, shared by both rank checks.
create or replace function app_public.notification_workout_ready(p_member uuid,p_session text)
returns boolean language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare w notification_workouts; target jsonb; t notification_workout_targets; published text; graph jsonb; redactions jsonb;
begin
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session;
  if not found or not w.eligible or w.confirmed_at is null or w.completion_at is null or w.completion_at+interval '24 hours'<=now()
    or w.completion_at<(select started_at from notification_workout_epoch) or w.completion_at>now()+interval '5 minutes'
    or w.manifest_digest is distinct from notification_manifest_digest(p_member,p_session)
    or w.context_digest is distinct from notification_context_digest(p_member,p_session) then return false; end if;
  if not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='completed' and deleted_at is null) or
    exists(select 1 from group_eval_queue where kind='session' and member_user_id=p_member and session_id=p_session) then return false; end if;
  for target in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    if exists(select 1 from group_metric_eval_queue where group_exercise_id=(target->>'group_exercise_id')::uuid) then return false; end if;
    select t2.* into t from notification_workout_targets t2
      join notification_comparison_publications p using(group_exercise_id)
      join group_exercises ge on ge.id=t2.group_exercise_id
      where t2.member_user_id=p_member and t2.session_id=p_session and t2.group_exercise_id=(target->>'group_exercise_id')::uuid
        and t2.evaluated and t2.baseline_known and t2.rules_revision=ge.rules_revision and ge.published_rules_revision=ge.rules_revision;
    if not found then return false; end if;
    select source_digest into published from notification_comparison_publications where group_exercise_id=t.group_exercise_id;
    graph:=group_metric_eval_source_graph(t.group_id,t.group_exercise_id);
    redactions:=notification_redaction_map(t.group_id,t.group_exercise_id,t.rules_revision,t);
    if not coalesce(t.final_ranks=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,null,graph,redactions),false)
      or not coalesce(t.without_workout=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,t,graph,redactions),false)
      or not coalesce(published=notification_comparison_digest(graph),false) then return false; end if;
  end loop;
  return true;
end $$;

drop function pg_temp.patch(text,text,text,integer,text);
