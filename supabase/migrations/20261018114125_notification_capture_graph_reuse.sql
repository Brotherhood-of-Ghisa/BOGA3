-- A capture pass shares one evaluated source graph across its workouts. Recheck
-- raw source and live disclosure at the boundary before any snapshots can commit.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('app_public.notification_ranks(uuid,uuid,bigint,app_public.notification_workout_targets)'::regprocedure);
  anchor:='p_target app_public.notification_workout_targets DEFAULT NULL::app_public.notification_workout_targets';
  if strpos(definition,anchor)=0 then raise exception 'notification ranks signature changed'; end if;
  definition:=replace(definition,anchor,'p_target app_public.notification_workout_targets, p_graph jsonb');
  definition:=replace(definition,'FUNCTION app_public.notification_ranks(',
    'FUNCTION app_public.notification_ranks_from_graph(');
  anchor:='source as materialized(select group_metric_eval_source_graph(p_group,p_exercise) as graph)';
  if strpos(definition,anchor)=0 then raise exception 'notification ranks source changed'; end if;
  execute replace(definition,anchor,'source as materialized(select p_graph as graph)');
  revoke all on function app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb)
    from public,anon,authenticated,service_role;

  definition:=pg_get_functiondef('app_public.notification_target_capture(app_public.notification_workout_targets,jsonb,boolean)'::regprocedure);
  definition:=replace(definition,'FUNCTION app_public.notification_target_capture(',
    'FUNCTION app_public.notification_target_capture_from_graph(');
  anchor:=$old$  if notification_comparison_digest(p_graph) is distinct from
    notification_comparison_digest(p_target.group_id,p_target.group_exercise_id) then return null; end if;
$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification target source guard changed'; end if;
  definition:=replace(definition,anchor,'');
  definition:=replace(definition,'notification_ranks(target.group_id,target.group_exercise_id,target.rules_revision)',
    'notification_ranks_from_graph(target.group_id,target.group_exercise_id,target.rules_revision,null,p_graph)');
  definition:=replace(definition,'notification_ranks(target.group_id,target.group_exercise_id,target.rules_revision,target)',
    'notification_ranks_from_graph(target.group_id,target.group_exercise_id,target.rules_revision,target,p_graph)');
  execute definition;
  revoke all on function app_public.notification_target_capture_from_graph(app_public.notification_workout_targets,jsonb,boolean)
    from public,anon,authenticated,service_role;

  definition:=pg_get_functiondef('app_public.notification_capture_comparison(uuid,uuid,bigint,boolean,jsonb)'::regprocedure);
  anchor:='  common_actual:=notification_ranks(p_group,p_exercise,p_revision);';
  if strpos(definition,anchor)=0 then raise exception 'notification common ranks changed'; end if;
  definition:=replace(definition,anchor,$new$  if notification_comparison_digest(g) is distinct from notification_comparison_digest(p_group,p_exercise) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
  common_actual:=notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g);$new$);
  anchor:='    capture:=notification_target_capture(probe,g,p_after);';
  if strpos(definition,anchor)=0 then raise exception 'notification capture call changed'; end if;
  definition:=replace(definition,anchor,'    capture:=notification_target_capture_from_graph(probe,g,p_after);');
  anchor:=$old$  end loop;
  if p_after then$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification capture boundary changed'; end if;
  execute replace(definition,anchor,$new$  end loop;
  if notification_comparison_digest(g) is distinct from notification_comparison_digest(p_group,p_exercise) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
  if common_actual is distinct from notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g) then
    raise exception 'notification capture disclosure moved' using errcode='P0001'; end if;
  if p_after then$new$);
end $$;

-- Standalone callers still resolve and validate current sources themselves.
create or replace function app_public.notification_ranks(p_group uuid,p_exercise uuid,p_revision bigint,
  p_target app_public.notification_workout_targets default null) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  select notification_ranks_from_graph(p_group,p_exercise,p_revision,p_target,
    group_metric_eval_source_graph(p_group,p_exercise));
$$;

create or replace function app_public.notification_target_capture(p_target app_public.notification_workout_targets,
  p_graph jsonb,p_after boolean default false) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  if notification_comparison_digest(p_graph) is distinct from
    notification_comparison_digest(p_target.group_id,p_target.group_exercise_id) then return null; end if;
  return notification_target_capture_from_graph(p_target,p_graph,p_after);
end $$;
