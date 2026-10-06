-- Re-score every live comparison once under the current shared kernel: a
-- single's 1RM is its load ([[1rm.formula]]) and the fixed group effort rule
-- excludes Technique and Cooldown ([[set.eligibility]]). Comparison scores are
-- not stamped with GROUP_EVAL_RULES_VERSION, so the bump that re-normalizes set
-- facts does not reach them; a `rules` evaluation rebuilds each target silently.
-- Enqueue is isolated, as in 20261004204709_group_certification_observations.sql.
do $rescore$
declare e record;
begin
  for e in select ge.group_id,ge.id from app_public.group_exercises ge
    join app_public.groups g on g.id=ge.group_id
    where g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  loop
    perform app_public.group_metric_enqueue_isolated(e.group_id,e.id,'rules',null);
  end loop;
end
$rescore$;
