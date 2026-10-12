-- Deploy after group-eval with GROUP_EVAL_RULES_VERSION 7 is live: an older
-- worker must not consume this recompute with the previous Volume formula.
-- Only current projections are replaced; raw sets, records and immutable
-- certification audits retain their original values and revisions.
do $rebuild$
declare e record; evaluator_rules integer;
begin
  select rules_version into evaluator_rules from app_public.group_eval_rules_state;
  for e in select ge.group_id,ge.id from app_public.group_exercises ge
    join app_public.groups g on g.id=ge.group_id
    where g.deleted_at is null and ge.archived_at is null
  loop
    if coalesce(evaluator_rules,0)<7 then
      raise exception 'total load recompute: deploy and kick group-eval rules 7 before enqueueing';
    end if;
    perform app_public.group_metric_enqueue_isolated(e.group_id,e.id,'rules',null);
  end loop;
end
$rebuild$;
