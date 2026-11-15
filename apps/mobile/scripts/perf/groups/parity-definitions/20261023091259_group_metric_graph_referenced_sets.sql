CREATE OR REPLACE FUNCTION app_public.group_metric_eval_publish_without_notifications(p_job_id bigint, p_generation bigint, p_claim_id uuid, p_evaluation jsonb, p_graph jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _job app_public.group_metric_eval_queue;
  _exercise app_public.group_exercises;
  _group_id uuid;
  _graph jsonb;
  _member jsonb;
  _revision bigint;
  _silent boolean;
  _count integer;
  _sources jsonb;
begin
  select group_id into _group_id from app_public.group_metric_eval_queue where id=p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from app_public.groups where id=_group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(_group_id::text));
  select * into _job from app_public.group_metric_eval_queue where id=p_job_id for update;
  if not found or p_claim_id is null or _job.claim_id is distinct from p_claim_id then
    return jsonb_build_object('completed',false);
  end if;
  if _job.generation is distinct from p_generation then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  _graph:=coalesce(p_graph,app_public.group_metric_eval_source_graph(_job.group_id,_job.group_exercise_id));
  if _graph is null then
    delete from app_public.group_metric_eval_queue where id=_job.id;
    return jsonb_build_object('completed',true,'frozen',true);
  end if;
  select * into strict _exercise from app_public.group_exercises where id=_job.group_exercise_id;
  _revision:=_exercise.rules_revision;
  if p_evaluation->>'contract_version' is distinct from _graph->>'contract_version'
    or p_evaluation->>'source_token' is distinct from _graph->>'source_token'
    or p_evaluation->>'rules_revision' is distinct from _revision::text
    or p_evaluation->>'group_id' is distinct from _job.group_id::text
    or p_evaluation->>'group_exercise_id' is distinct from _job.group_exercise_id::text then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  select coalesce(jsonb_object_agg((r->>'member_user_id')||'/'||(r->>'set_id'),r),'{}'::jsonb) into _sources
    from jsonb_array_elements(_graph->'sets') r;
  if jsonb_typeof(p_evaluation->'scores') is distinct from 'array' then
    raise exception 'VALIDATION: missing evaluation scores' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_evaluation->'scores') x
    where not(x->>'metric' in ('volume','e1rm'))
      or x->>'unit' is distinct from app_public.group_competition_unit(x->>'metric',
          (_graph->'rules'->>'bodyweight_calculations_enabled')::boolean
          and (_graph->'rules'->>'bodyweight_contribution')::double precision>0)
      or jsonb_typeof(x->'working') is distinct from 'boolean'
      or jsonb_typeof(x->'value') is distinct from 'number'
      or not((x->>'value')::double precision>0 and (x->>'value')::double precision<'Infinity'::double precision)
      or not exists(select 1 from (select _sources->((x->>'member_user_id')||'/'||(x->>'set_id')) as r) k
        where (r->>'live')::boolean
          and r->'fingerprints'->>(x->>'metric')=x->>'fingerprint'
          and r->>'session_id'=x->>'session_id'
          and r->>'session_exercise_id'=x->>'session_exercise_id'
          and r->>'exercise_definition_id'=x->>'exercise_definition_id')) then
    raise exception 'VALIDATION: evaluation does not match source graph' using errcode='P0001';
  end if;
  -- The replaced insert rejected a repeated key (23505); an upsert would
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
  select _job.group_id,_job.group_exercise_id,_revision,(x->>'member_user_id')::uuid,
    (m->>'membership_id')::uuid,x->>'set_id',r->>'session_id',r->>'session_exercise_id',
    r->>'exercise_definition_id',x->>'metric',
    (x->>'value')::numeric,x->>'unit',
    (r->>'counting')::boolean and (x->>'working')::boolean,(r->>'achieved_at_ms')::bigint,
    (r->>'exercise_order_index')::integer,(r->>'set_order_index')::integer,
    (r->>'set_created_at_ms')::bigint,x->>'fingerprint',jsonb_build_object(
      'session_id',r->>'session_id','session_exercise_id',r->>'session_exercise_id',
      'exercise_definition_id',r->>'exercise_definition_id','set_id',r->>'set_id',
      'weight_value',r->>'weight_value','reps_value',r->>'reps_value',
      'reps',(r->>'reps_value')::numeric,'performance_status',r->'performance_status',
      'source_load_input_mode',r->>'source_load_input_mode',
      'achieved_at_ms',(r->>'achieved_at_ms')::bigint,
      'exercise_order_index',(r->>'exercise_order_index')::integer,
      'set_order_index',(r->>'set_order_index')::integer),
    (r->>'source_mode_generation')::bigint
  from jsonb_array_elements(p_evaluation->'scores') x
  join lateral (select _sources->((x->>'member_user_id')||'/'||(x->>'set_id')) as r) k on k.r is not null
  join jsonb_array_elements(_graph->'members') m on m->>'member_user_id'=x->>'member_user_id'),
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
  _silent:=not exists(select 1 from app_public.group_rule_revisions r
    where r.group_exercise_id=_job.group_exercise_id and r.revision=_revision
      and r.published_at is not null);
  -- A source distribution edit is a rules rescore, not a lift. Mixed
  -- performance/correction jobs keep the ordinary event reconciliation.
  _graph:=_graph || jsonb_build_object('source_rules_only',
    (_job.causes && array['load_mode','rules']::text[])
    and _job.causes<@array['load_mode','rules','certification']::text[]);
  perform app_public.group_metric_import_legacy_certifications(_exercise);
  if jsonb_typeof(coalesce(p_evaluation->'baseline_scores','[]'::jsonb))<>'array' then
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
  -- Bind the trusted graph, not a generation supplied by the worker.
  update app_public.group_metric_set_scores s set source_mode_generation=(r->>'source_mode_generation')::bigint
    from jsonb_array_elements(_graph->'sets') r
    where s.group_exercise_id=_exercise.id and s.rules_revision=_revision
      and s.member_user_id::text=r->>'member_user_id' and s.set_id=r->>'set_id'
      and s.source_mode_generation is distinct from (r->>'source_mode_generation')::bigint;
  for _member in select m from jsonb_array_elements(_graph->'members') m
    order by m->>'member_user_id'
  loop
    perform app_public.group_metric_apply_member(_job.group_id,(_member->>'member_user_id')::uuid,
      _job.group_exercise_id,_revision,_graph,_silent);
  end loop;
  update app_public.group_exercises set published_rules_revision=_revision
    where id=_job.group_exercise_id;
  update app_public.group_rule_revisions set published_at=coalesce(published_at,now())
    where group_exercise_id=_job.group_exercise_id and revision=_revision;
  if _silent and _revision>1 then
    insert into app_public.group_events(contract_version,rules_revision,group_id,kind,
      group_exercise_id,sort_at_ms,payload)
    values(2,_revision,_job.group_id,'rules_change',_job.group_exercise_id,
      floor(extract(epoch from now())*1000)::bigint,
      jsonb_build_object('previous_revision',_revision-1,'rules',_graph->'rules'))
    on conflict(group_exercise_id,rules_revision) where kind='rules_change' do nothing;
  end if;
  delete from app_public.group_metric_eval_queue where id=_job.id;
  return jsonb_build_object('completed',true,'rules_revision',_revision,'scores',_count);
end;
$function$

