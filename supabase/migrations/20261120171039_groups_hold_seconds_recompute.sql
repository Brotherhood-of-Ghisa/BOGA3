-- Apply after deploying notification-worker and kicking group-eval rules 9. Rebuild live projections
-- silently; preserve raw workouts and immutable record/certification audits.
do $rebuild$
declare e record; evaluator_rules integer;
begin
  select rules_version into evaluator_rules from app_public.group_eval_rules_state;
  for e in select ge.group_id,ge.id from app_public.group_exercises ge
    join app_public.groups g on g.id=ge.group_id
    where g.deleted_at is null and ge.archived_at is null
  loop
    if coalesce(evaluator_rules,0)<9 then
      raise exception 'Hold board recompute: deploy and kick group-eval rules 9 before enqueueing';
    end if;
    perform app_public.group_metric_enqueue_isolated(e.group_id,e.id,'rules',null);
  end loop;
end $rebuild$;
