-- A comparison publication built group_metric_eval_source_graph six times:
-- once in this wrapper, once in the inner publish, and twice in each capture
-- pass (its start and end source digests). On hosted BOGA_DEV publish averaged
-- 5.1 s against the 8 s statement_timeout. Publish now builds the
-- graph once, under the group lock, and passes it to the inner publish and
-- both capture passes. One source digest after every write replaces the four
-- boundary digests: a source that moved since the graph was built still
-- raises and rolls back the whole publication, including its captures.
-- Standalone capture callers keep both boundary digests.
-- Patched on the final definitions, as 20261018114125 patches its anchors.
do $patch$
declare
  _definition text;
  _anchor text;
  _source_check text := $a$  if notification_comparison_digest(g) is distinct from notification_comparison_digest(p_group,p_exercise) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
$a$;
begin
  -- The inner publish takes a graph its caller built under the same locks.
  _definition := pg_get_functiondef(
    'app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb)'::regprocedure);
  _anchor := 'p_claim_id uuid, p_evaluation jsonb)';
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_metric_eval_publish: signature anchor not found exactly once';
  end if;
  _definition := replace(_definition, _anchor, 'p_claim_id uuid, p_evaluation jsonb, p_graph jsonb DEFAULT NULL::jsonb)');
  _anchor := '  _graph:=app_public.group_metric_eval_source_graph(_job.group_id,_job.group_exercise_id);';
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_metric_eval_publish: graph anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor,
    '  _graph:=coalesce(p_graph,app_public.group_metric_eval_source_graph(_job.group_id,_job.group_exercise_id));');
  drop function app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb);
  revoke all on function app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb,jsonb)
    from public,anon,authenticated,service_role;

  -- The capture pass without its own boundary digests; its caller checks them.
  _definition := pg_get_functiondef(
    'app_public.notification_capture_comparison(uuid,uuid,bigint,boolean,jsonb)'::regprocedure);
  _anchor := 'p_after boolean, p_graph jsonb DEFAULT NULL::jsonb)';
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'notification capture signature changed';
  end if;
  _definition := replace(_definition, _anchor, 'p_after boolean, p_graph jsonb)');
  _definition := replace(_definition, 'FUNCTION app_public.notification_capture_comparison(',
    'FUNCTION app_public.notification_capture_comparison_from_graph(');
  _anchor := '  g:=coalesce(p_graph,group_metric_eval_source_graph(p_group,p_exercise));';
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'notification capture graph changed';
  end if;
  _definition := replace(_definition, _anchor, '  g:=p_graph;');
  if (length(_definition) - length(replace(_definition, _source_check, ''))) <> 2 * length(_source_check) then
    raise exception 'notification capture boundaries changed';
  end if;
  execute replace(_definition, _source_check, '');
  revoke all on function app_public.notification_capture_comparison_from_graph(uuid,uuid,bigint,boolean,jsonb)
    from public,anon,authenticated,service_role;
end
$patch$;

-- Standalone callers still check current sources at both boundaries. The
-- final one now follows a publication's own digest row and kick, which the
-- raise rolls back with it.
create or replace function app_public.notification_capture_comparison(p_group uuid,p_exercise uuid,p_revision bigint,
  p_after boolean,p_graph jsonb default null) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare g jsonb;
begin
  g:=coalesce(p_graph,group_metric_eval_source_graph(p_group,p_exercise));
  if g is null then return; end if;
  if notification_comparison_digest(g) is distinct from notification_comparison_digest(p_group,p_exercise) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
  perform notification_capture_comparison_from_graph(p_group,p_exercise,p_revision,p_after,g);
  if notification_comparison_digest(g) is distinct from notification_comparison_digest(p_group,p_exercise) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
end $$;

create or replace function app_public.group_metric_eval_publish(p_job_id bigint,p_generation bigint,p_claim_id uuid,p_evaluation jsonb) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare q group_metric_eval_queue; g jsonb; result jsonb; captured boolean:=false;
begin
  select * into q from group_metric_eval_queue where id=p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from groups where id=q.group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(q.group_id::text));
  select * into q from group_metric_eval_queue where id=p_job_id for update;
  if q.claim_id is distinct from p_claim_id or q.generation is distinct from p_generation or p_claim_id is null then
    return group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation); end if;
  -- The only graph built before the writes. A null graph (frozen) is resolved
  -- again by the inner publish.
  g:=group_metric_eval_source_graph(q.group_id,q.group_exercise_id);
  if g is not null and p_evaluation->>'source_token'=g->>'source_token' then
    perform notification_capture_comparison_from_graph(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,false,g);
    captured:=true;
  end if;
  result:=group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation,g);
  if (result->>'completed')::boolean and g is not null then
    perform notification_capture_comparison_from_graph(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,true,g);
    captured:=true;
  end if;
  -- Every capture and score row came from g: a source that moved since it was
  -- built rolls the publication back, as the passes' own boundaries did.
  if captured and notification_comparison_digest(g) is distinct from
    notification_comparison_digest(q.group_id,q.group_exercise_id) then
    raise exception 'notification capture source moved' using errcode='P0001'; end if;
  return result;
end $$;
