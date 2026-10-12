-- Advance private baselines before reconciliation, including coalesced edits
-- and catch-up after unarchive/rejoin. Unchanged dependency fingerprints can
-- gain new calculated values without rewriting their original record audit.
do $migration$
declare
  definition text;
  anchor text := $old$'load_mode'=any(_job.causes)
    and _job.causes<@array['load_mode','rules','certification']::text[]$old$;
  block_start integer;
  block_end integer;
  baseline_block text;
  block_header text := E'  if _source_rules_only then\n';
  block_footer text := E'  end if;\n\n';
  reconcile_anchor text := '  if not p_silent and not _source_rules_only then';
begin
  definition := pg_get_functiondef('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'total load refresh: publication anchor not found exactly once';
  end if;
  execute replace(definition,anchor,$new$(_job.causes && array['load_mode','rules']::text[])
    and _job.causes<@array['load_mode','rules','certification']::text[]$new$);

  -- Include prior ordinary winners in the graph before its existing token hash.
  definition := pg_get_functiondef('app_public.group_metric_eval_source_graph(uuid,uuid)'::regprocedure);
  anchor := $old$_graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets);$old$;
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'total load refresh: source graph anchor not found exactly once';
  end if;
  execute replace(definition,anchor,$new$_graph:=_graph||jsonb_build_object('contract_version',4,'sets',_sets,
    'ordinary_baselines',coalesce((select jsonb_agg(jsonb_build_object(
      'member_user_id',e.member_user_id,'set_id',e.set_id,'metric',e.metric,'fingerprint',e.fingerprint,'performance',e.performance)
      order by e.member_user_id,e.set_id,e.metric)
      from app_public.group_metric_board_entries e
      where e.group_exercise_id=p_group_exercise_id and e.rules_revision=(_graph->'rules'->>'rules_revision')::bigint
        and not e.certified and e.metric in ('volume','e1rm')
        and e.unit=case e.metric when 'volume' then 'kg_reps' else 'kg' end
        and exists(select 1 from jsonb_array_elements(_graph->'members') m
          where m->>'member_user_id'=e.member_user_id::text)),'[]'::jsonb));$new$);

  -- Baseline scores cannot replace current performance scores. Validate their
  -- old winner identity/pin inside the same source-token and publication fence.
  definition := pg_get_functiondef('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure);
  anchor := $old$  for _member in select m from jsonb_array_elements(_graph->'members') m$old$;
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
    raise exception 'total load refresh: baseline publication anchor not found exactly once';
  end if;
  execute replace(definition,anchor,$new$  if jsonb_typeof(coalesce(p_evaluation->'baseline_scores','[]'::jsonb))<>'array' then
    raise exception 'VALIDATION: invalid baseline scores' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_evaluation->'baseline_scores','[]'::jsonb)) x
    where x->>'metric' not in ('volume','e1rm')
      or x->>'unit' is distinct from case x->>'metric' when 'volume' then 'kg_reps' when 'e1rm' then 'kg' end
      or jsonb_typeof(x->'value') is distinct from 'number'
      or not ((x->>'value')::double precision>0 and (x->>'value')::double precision<'Infinity'::double precision)
      or not exists(select 1 from jsonb_array_elements(_graph->'ordinary_baselines') b
        where b->>'member_user_id'=x->>'member_user_id' and b->>'set_id'=x->>'set_id'
          and b->>'metric'=x->>'metric' and b->>'fingerprint'=x->>'fingerprint'))
    or exists(select 1 from jsonb_array_elements(coalesce(p_evaluation->'baseline_scores','[]'::jsonb)) x
      group by x->>'member_user_id',x->>'set_id',x->>'metric' having count(*)>1) then
    raise exception 'VALIDATION: baseline does not match previous winner' using errcode='P0001';
  end if;
  _graph:=_graph||jsonb_build_object('baseline_scores',coalesce(p_evaluation->'baseline_scores','[]'::jsonb));
  for _member in select m from jsonb_array_elements(_graph->'members') m$new$);

  definition := pg_get_functiondef('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)'::regprocedure);
  anchor := block_header || E'    for _rec in select e.* from app_public.group_events e\n';
  block_start := strpos(definition,anchor);
  block_end := strpos(substr(definition,block_start),E'  if p_silent then\n');
  if block_start=0 or block_end=0
    or (length(definition)-length(replace(definition,anchor,'')))<>length(anchor)
    or (length(definition)-length(replace(definition,reconcile_anchor,'')))<>length(reconcile_anchor) then
    raise exception 'total load refresh: record baseline anchors not found exactly once';
  end if;
  baseline_block := substr(definition,block_start,block_end-1);
  if right(baseline_block,length(block_footer))<>block_footer then
    raise exception 'total load refresh: unexpected record baseline block';
  end if;
  definition := replace(definition,baseline_block,'');
  -- Reuse the existing per-record dependency check, without a queue-cause gate.
  baseline_block := substr(baseline_block,length(block_header)+1,
    length(baseline_block)-length(block_header)-length(block_footer));
  execute replace(definition,reconcile_anchor,baseline_block || $new$
  -- Old ordinary winners are rescored by the TS kernel even when their raw
  -- set has since changed. This stops a decrease appearing to beat an old-unit baseline.
  foreach _metric in array _metrics loop
    _o := _old_by->_metric;
    select b into _prior from jsonb_array_elements(p_graph->'baseline_scores') b
      where b->>'member_user_id'=p_member_user_id::text and b->>'set_id'=_o->>'set_id'
        and b->>'metric'=_metric and b->>'fingerprint'=_o->>'fingerprint';
    if _prior is not null then
      _old_by := jsonb_set(_old_by,array[_metric],_o||jsonb_build_object('value',_prior->'value'));
    end if;
  end loop;

$new$ || reconcile_anchor);
end
$migration$;
