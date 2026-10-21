-- A comparison publication wrote every live member's score rows on every job:
-- it deleted them, inserted them again, then updated each one's
-- source_mode_generation. On hosted BOGA_DEV that was ~4,900 row writes and
-- ~3 MB of WAL per job even when nothing changed, the main disk-IO consumer.
-- Publish now writes only the difference: rows the evaluation no longer
-- scores are deleted, new rows are inserted, and an existing row is updated
-- only when one of its values changed. A changed row gets a new write_token
-- (certify's "performance changed" guard) and evaluated_at; an unchanged row
-- keeps both, so a republish no longer invalidates a certifier's token.
-- Patched on the final definition, as 20261004233855 patches its anchors.
do $patch$
declare
  _definition text;
  _writes_anchor text := $a$  delete from app_public.group_metric_set_scores s
    where s.group_exercise_id=_job.group_exercise_id and s.rules_revision=_revision
      and exists(select 1 from jsonb_array_elements(_graph->'members') m
        where m->>'member_user_id'=s.member_user_id::text);
  insert into app_public.group_metric_set_scores(
    group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance)
  select _job.group_id,_job.group_exercise_id,_revision,(x->>'member_user_id')::uuid,$a$;
  _writes_tail_anchor text := $a$  join jsonb_array_elements(_graph->'members') m on m->>'member_user_id'=x->>'member_user_id';
  get diagnostics _count=row_count;
$a$;
  _select_tail_anchor text := $a$      'set_order_index',(r->>'set_order_index')::integer)
  from jsonb_array_elements(p_evaluation->'scores') x$a$;
  _generation_anchor text := $a$      and s.member_user_id::text=r->>'member_user_id' and s.set_id=r->>'set_id';
  for _member in select m from jsonb_array_elements(_graph->'members') m$a$;
begin
  _definition := pg_get_functiondef(
    'app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb)'::regprocedure);
  if (length(_definition) - length(replace(_definition, _writes_anchor, ''))) <> length(_writes_anchor)
    or (length(_definition) - length(replace(_definition, _writes_tail_anchor, ''))) <> length(_writes_tail_anchor)
    or (length(_definition) - length(replace(_definition, _select_tail_anchor, ''))) <> length(_select_tail_anchor)
    or (length(_definition) - length(replace(_definition, _generation_anchor, ''))) <> length(_generation_anchor) then
    raise exception 'group_metric_eval_publish: score write anchors not found exactly once';
  end if;
  _definition := replace(_definition, _writes_anchor, $new$  -- The replaced insert rejected a repeated key (23505); an upsert would
  -- silently keep one copy, so reject it before writing.
  if exists(select 1 from jsonb_array_elements(p_evaluation->'scores') x
    group by x->>'member_user_id',x->>'set_id',x->>'metric' having count(*)>1) then
    raise exception 'VALIDATION: duplicate evaluation scores' using errcode='P0001';
  end if;
  -- Live members' scores become exactly the evaluation's; frozen rows stay.
  with fresh(group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance,
    source_mode_generation) as materialized (
  select _job.group_id,_job.group_exercise_id,_revision,(x->>'member_user_id')::uuid,$new$);
  _definition := replace(_definition, _writes_tail_anchor, $new$  join jsonb_array_elements(_graph->'members') m on m->>'member_user_id'=x->>'member_user_id'),
  stale as (
    delete from app_public.group_metric_set_scores s
      where s.group_exercise_id=_job.group_exercise_id and s.rules_revision=_revision
        and exists(select 1 from jsonb_array_elements(_graph->'members') m
          where m->>'member_user_id'=s.member_user_id::text)
        -- NOT IN plans as one hashed subplan; NOT EXISTS became a nested loop
        -- (rows x scores) because jsonb_array_elements is estimated at one row.
        -- No key column of fresh or of the table is null.
        and (s.member_user_id,s.set_id,s.metric) not in (select member_user_id,set_id,metric from fresh)),
  -- Unchanged rows are filtered here, not by an ON CONFLICT ... WHERE, which
  -- would still lock (and so write) every existing row.
  changed as (
    select f.* from fresh f
    left join app_public.group_metric_set_scores s on s.group_exercise_id=f.group_exercise_id
      and s.rules_revision=f.rules_revision and s.member_user_id=f.member_user_id
      and s.set_id=f.set_id and s.metric=f.metric
    where (s.group_id,s.membership_id,s.session_id,s.session_exercise_id,s.exercise_definition_id,
        s.value,s.unit,s.counting,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,
        s.set_created_at_ms,s.fingerprint,s.performance,s.source_mode_generation)
      is distinct from (f.group_id,f.membership_id,f.session_id,f.session_exercise_id,
        f.exercise_definition_id,f.value,f.unit,f.counting,f.achieved_at_ms,f.exercise_order_index,
        f.set_order_index,f.set_created_at_ms,f.fingerprint,f.performance,f.source_mode_generation)),
  written as (
    insert into app_public.group_metric_set_scores(
      group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
      set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
      achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance,
      source_mode_generation)
    select * from changed
    on conflict(group_exercise_id,rules_revision,member_user_id,set_id,metric) do update set
      group_id=excluded.group_id,membership_id=excluded.membership_id,session_id=excluded.session_id,
      session_exercise_id=excluded.session_exercise_id,exercise_definition_id=excluded.exercise_definition_id,
      value=excluded.value,unit=excluded.unit,counting=excluded.counting,achieved_at_ms=excluded.achieved_at_ms,
      exercise_order_index=excluded.exercise_order_index,set_order_index=excluded.set_order_index,
      set_created_at_ms=excluded.set_created_at_ms,fingerprint=excluded.fingerprint,
      performance=excluded.performance,source_mode_generation=excluded.source_mode_generation,
      evaluated_at=now(),write_token=gen_random_uuid())
  select count(*) into _count from fresh;
$new$);
  -- The original select list, plus the trusted graph's generation.
  _definition := replace(_definition, _select_tail_anchor, $new$      'set_order_index',(r->>'set_order_index')::integer),
    (r->>'source_mode_generation')::bigint
  from jsonb_array_elements(p_evaluation->'scores') x$new$);
  -- Rows written above already carry the graph's generation; this now only
  -- touches a score whose generation moved without a new evaluation row.
  _definition := replace(_definition, _generation_anchor, $new$      and s.member_user_id::text=r->>'member_user_id' and s.set_id=r->>'set_id'
      and s.source_mode_generation is distinct from (r->>'source_mode_generation')::bigint;
  for _member in select m from jsonb_array_elements(_graph->'members') m$new$);
  execute _definition;
end
$patch$;
