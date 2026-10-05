-- Additive server installation. Hosted activation is a separate, service-only
-- operation after the compatible reader/worker/client release is authorized.
create table app_public.group_competition_activation (
  singleton boolean primary key default true check(singleton),
  activated_at timestamptz
);
insert into app_public.group_competition_activation(singleton) values(true);
alter table app_public.group_competition_activation enable row level security;
revoke all on app_public.group_competition_activation from public,anon,authenticated,service_role;

create function app_public.group_competition_active()
returns boolean language sql volatile security definer set search_path=app_public,pg_temp as $$
  select activated_at is not null from app_public.group_competition_activation where singleton;
$$;
revoke all on function app_public.group_competition_active() from public,anon,authenticated,service_role;

create function app_public.group_competition_unit(p_metric text,p_normalized boolean)
returns text language sql immutable set search_path=app_public,pg_temp as $$
  select case p_metric when 'volume' then case when p_normalized then 'percent_bw_reps' else 'kg_reps' end
    when 'e1rm' then case when p_normalized then 'percent_bw' else 'kg' end end;
$$;
revoke all on function app_public.group_competition_unit(text,boolean) from public,anon,authenticated,service_role;

alter table app_public.group_rule_revisions add column representation_version smallint not null default 3
  check(representation_version in (3,4));
alter table app_public.group_metric_set_scores add column write_token uuid not null default gen_random_uuid();
alter table app_public.group_metric_certifications add column witness_certification_id uuid
  references app_public.group_metric_certifications(id) on delete cascade check(witness_certification_id<>id);
create unique index group_metric_certifications_witness_metric
  on app_public.group_metric_certifications(witness_certification_id,metric) where witness_certification_id is not null;
-- Aliases carry original witness metadata and pins, not a fabricated observed
-- Volume score. Their immutable original kg audit lives at the referenced row.
alter table app_public.group_metric_certifications alter column observed_value drop not null,
  alter column unit drop not null;

alter table app_public.group_exercises drop constraint group_exercises_default_metric_valid,
  add constraint group_exercises_default_metric_valid check(default_metric in ('weight','volume','e1rm'));
alter table app_public.group_metric_set_scores drop constraint group_metric_set_scores_check,
  drop constraint group_metric_set_scores_current_metric,drop constraint group_metric_set_scores_current_unit,
  add constraint group_metric_set_scores_competition_value check(
    (metric='weight' and unit='kg') or (metric='volume' and unit in ('kg_reps','percent_bw_reps'))
    or (metric='e1rm' and unit in ('kg','percent_bw')));
alter table app_public.group_metric_board_entries drop constraint group_metric_board_entries_check,
  drop constraint group_metric_board_entries_current_metric,drop constraint group_metric_board_entries_current_unit,
  add constraint group_metric_board_entries_competition_value check(
    (metric='weight' and unit='kg') or (metric='volume' and unit in ('kg_reps','percent_bw_reps'))
    or (metric='e1rm' and unit in ('kg','percent_bw')));
alter table app_public.group_metric_certifications drop constraint group_metric_certifications_check1,
  drop constraint group_metric_certifications_current_metric,drop constraint group_metric_certifications_current_unit,
  add constraint group_metric_certifications_competition_audit check(
    (witness_certification_id is not null and metric='volume' and observed_value is null and unit is null)
    or (witness_certification_id is null and observed_value is not null and unit is not null and (
      (metric='weight' and unit='kg') or (metric='volume' and unit in ('kg_reps','percent_bw_reps'))
      or (metric='e1rm' and unit in ('kg','percent_bw')))));

-- Preserve all historic event identities and audit keys; only extend the
-- already-versioned event metric domain for the new publication.
alter table app_public.group_events drop constraint group_events_lead_change_shape_check,
  add constraint group_events_lead_change_shape_check check (
    kind <> 'lead_change' or (group_exercise_id is not null
      and ((contract_version=1 and metric in ('weight','e1rm')) or
        (contract_version=2 and metric in ('weight','volume','e1rm','bodyweight_reps','relative_strength','absolute_strength')))
      and certified is not null and reason in ('record','void','link','certification') and payload is not null
      and set_id is null and session_id is null and membership_id is null and actor_user_id is null));

-- Protocol 3 could bind an Off witness to this missing-context sentinel.
-- It has never selected a reading: clear only that exact active sentinel, not
-- genuine dependency pins, pending-correction sentinels or terminal audit.
update app_public.group_metric_certifications set reading_pin=null
  where metric='e1rm' and ended_at is null and reading_pin in (
    encode(extensions.digest(jsonb_build_object('body_weight_kg',null)::text,'sha256'),'hex'),
    encode(extensions.digest(jsonb_build_object('body_weight_kg',null,'body_weight_source',null,
      'body_weight_measurement_id',null,'body_weight_measured_at',null)::text,'sha256'),'hex'));

create or replace function app_public.group_metric_names()
returns text[] language sql stable set search_path=app_public,pg_temp as $$
  select case when app_public.group_competition_active() then array['volume','e1rm'] else array['weight','e1rm'] end;
$$;

-- Preserve the old graph verbatim while pending. The activated graph uses the
-- same authorized source/as-of lookup and adds a private Volume dependency pin.
alter function app_public.group_metric_eval_source_graph(uuid,uuid) rename to group_metric_eval_source_graph_v3;
revoke all on function app_public.group_metric_eval_source_graph_v3(uuid,uuid) from public,anon,authenticated,service_role;
-- CASE guarantees lazy resolution; a WHERE on a lateral scalar expression
-- does not prevent the planner from evaluating that expression while Off.
do $$
declare _definition text; _before text:=$old$select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context
      where t.bodyweight_calculations_enabled and t.bodyweight_contribution>0$old$;
begin
  select pg_get_functiondef('app_public.group_metric_eval_source_graph_v3(uuid,uuid)'::regprocedure) into _definition;
  if strpos(_definition,_before)=0 then raise exception 'competition source resolver anchor changed'; end if;
  execute replace(_definition,_before,$new$select case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
        then app_public.session_weight_as_of(s.owner_user_id,s.started_at) end as context$new$);
end;
$$;
create function app_public.group_metric_eval_source_graph(p_group_id uuid,p_group_exercise_id uuid)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare _graph jsonb; _sets jsonb;
begin
  _graph:=app_public.group_metric_eval_source_graph_v3(p_group_id,p_group_exercise_id);
  if _graph is null or not app_public.group_competition_active() then return _graph; end if;
  select coalesce(jsonb_agg(r||jsonb_build_object('fingerprints',(r->'fingerprints')||jsonb_build_object(
    'volume',app_public.group_metric_graph_fingerprint(r,_graph->'rules','volume',r->>'source_load_input_mode')))
    order by r->>'member_user_id',r->>'set_id'),'[]'::jsonb) into _sets
    from jsonb_array_elements(_graph->'sets') r;
  _graph:=(_graph-'source_token')||jsonb_build_object('contract_version',4,'sets',_sets);
  return _graph||jsonb_build_object('source_token',encode(extensions.digest(_graph::text,'sha256'),'hex'));
end;
$$;
revoke all on function app_public.group_metric_eval_source_graph(uuid,uuid) from public,anon,authenticated,service_role;

create function app_public.group_competition_import_witnesses(p_group uuid,p_exercise uuid,p_member uuid,p_graph jsonb)
returns void language sql volatile security definer set search_path=app_public,pg_temp as $$
  insert into app_public.group_metric_certifications(group_id,group_exercise_id,member_user_id,set_id,session_id,metric,
    observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by,certified_at,
    observed_set_pin,legacy_certification_id,witness_certification_id)
  select c.group_id,c.group_exercise_id,c.member_user_id,c.set_id,c.session_id,'volume',
    c.observed_rules_revision,null,null,c.pinned_fingerprint,c.performance,c.certified_by,c.certified_at,
    c.observed_set_pin,c.legacy_certification_id,c.id
  from app_public.group_metric_certifications c
  where c.group_id=p_group and c.group_exercise_id=p_exercise and c.member_user_id=p_member
    and c.metric='weight' and c.ended_at is null
    and (p_graph->>'contract_version')='4'
    and exists(select 1 from jsonb_array_elements(p_graph->'sets') r
      where r->>'member_user_id'=c.member_user_id::text and r->>'set_id'=c.set_id
        and (r->>'live')::boolean and r->>'observed_set_pin'=c.observed_set_pin)
    and not exists(select 1 from app_public.group_metric_certifications v
      where v.group_exercise_id=c.group_exercise_id and v.member_user_id=c.member_user_id
        and v.set_id=c.set_id and v.metric='volume' and v.ended_at is null)
  on conflict do nothing;
$$;
revoke all on function app_public.group_competition_import_witnesses(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function app_public.group_competition_witness_ended()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  update app_public.group_metric_certifications set ended_at=new.ended_at,end_reason=new.end_reason,ended_by=new.ended_by
    where witness_certification_id=new.id and ended_at is null;
  return null;
end;
$$;
revoke all on function app_public.group_competition_witness_ended() from public,anon,authenticated,service_role;
create trigger group_metric_certifications_witness_end_sync after update of ended_at on app_public.group_metric_certifications
  for each row when(old.ended_at is null and new.ended_at is not null)
  execute function app_public.group_competition_witness_ended();

-- Exact-anchor patches retain the existing generation/lease/revision locks and
-- failure isolation. No arithmetic kernel is duplicated in PostgreSQL.
do $publication$
declare _patch record; _definition text; _definitions jsonb:='{}';
begin
  for _patch in select * from (values
    ('app_public.group_metric_eval_enqueue(uuid,uuid,text)',
      $old$  if p_cause is null or not (p_cause = any(array[$old$,
      $new$  perform pg_advisory_xact_lock_shared(25006,0);
  if p_cause is null or not (p_cause = any(array[$new$),
    ('app_public.group_eval_complete(bigint,bigint,jsonb)',
      $old$  select q.* into _job from app_public.group_eval_queue$old$,
      $new$  perform pg_advisory_xact_lock_shared(25006,0);
  select q.* into _job from app_public.group_eval_queue$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$  select group_id into _group_id from app_public.group_metric_eval_queue$old$,
      $new$  perform pg_advisory_xact_lock_shared(25006,0);
  select group_id into _group_id from app_public.group_metric_eval_queue$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$  for _member in select m from jsonb_array_elements(_graph->'members') m$old$,
      $new$  if app_public.group_competition_active() then
    perform app_public.group_metric_import_legacy_certifications(_exercise);
  end if;
  for _member in select m from jsonb_array_elements(_graph->'members') m$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$  if p_evaluation->>'source_token' is distinct from _graph->>'source_token'$old$,
      $new$  if p_evaluation->>'contract_version' is distinct from _graph->>'contract_version'
    or p_evaluation->>'source_token' is distinct from _graph->>'source_token'$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$x->>'unit' is distinct from app_public.group_metric_unit(x->>'metric')$old$,
      $new$x->>'unit' is distinct from case when _graph->>'contract_version'='4'
        then app_public.group_competition_unit(x->>'metric',
          (_graph->'rules'->>'bodyweight_calculations_enabled')::boolean
          and (_graph->'rules'->>'bodyweight_contribution')::double precision>0)
        else app_public.group_metric_unit(x->>'metric') end$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$    app_public.group_metric_rank_value((x->>'value')::double precision),x->>'unit',$old$,
      $new$    case when _graph->>'contract_version'='4' then (x->>'value')::numeric
      else app_public.group_metric_rank_value((x->>'value')::double precision) end,x->>'unit',$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$where app_public.group_metric_rank_value((x->>'value')::double precision) is not null;$old$,
      $new$where _graph->>'contract_version'='4' or app_public.group_metric_rank_value((x->>'value')::double precision) is not null;$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$c.metric <> 'e1rm'$old$,$new$c.metric not in ('e1rm','volume')$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  -- Rescore surviving observations, without changing their original audit.$old$,
      $new$  perform app_public.group_competition_import_witnesses(p_group_id,p_group_exercise_id,p_member_user_id,p_graph);

  -- Rescore surviving observations, without changing their original audit.$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$reading_pin=case when c.metric='e1rm' then coalesce(c.reading_pin,r ->> 'reading_pin') end$old$,
      $new$reading_pin=case when c.metric in ('e1rm','volume') then coalesce(c.reading_pin,
      case when r->>'body_weight_source'='reading' then r->>'reading_pin' end) end$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$'metric',m,'unit',app_public.group_metric_unit(m),'rules_revision',p_rules_revision$old$,
      $new$'metric',m,'unit',_old_by -> m -> 'unit','rules_revision',p_rules_revision$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$'unit',app_public.group_metric_unit(m),'rules_revision',p_rules_revision) end)$old$,
      $new$'unit',_new_by -> m -> 'unit','rules_revision',p_rules_revision) end)$new$),
    ('app_public.group_metric_compute(uuid,bigint,uuid,uuid[])',
      $old$s.exercise_order_index,s.set_order_index,s.set_id collate "C"$old$,
      $new$s.exercise_order_index,s.set_order_index,
        case when app_public.group_competition_active() then s.set_created_at_ms end,s.set_id collate "C"$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$_row.metric<>'e1rm'$old$,$new$_row.metric not in ('e1rm','volume')$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$case when p_metric='e1rm' then _source->>'reading_pin' end$old$,
      $new$case when p_metric in ('e1rm','volume') then _source->>'reading_pin' end$new$)
    ,('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$where c.group_exercise_id=p_exercise.id and c.ended_at is null and not exists ($old$,
      $new$where c.group_exercise_id=p_exercise.id and c.ended_at is null
    and (not app_public.group_competition_active() or (p_exercise.archived_at is null
      and app_public.group_active_role(p_exercise.group_id,c.member_user_id) is not null)) and not exists ($new$)
    ,('app_public.group_metric_import_legacy_certifications(app_public.group_exercises)',
      $old$where c.group_exercise_id=p_exercise.id and c.ended_at is null and s.id=c.session_id$old$,
      $new$where c.group_exercise_id=p_exercise.id and c.ended_at is null and s.id=c.session_id
    and (not app_public.group_competition_active() or (p_exercise.archived_at is null
      and app_public.group_active_role(p_exercise.group_id,c.member_user_id) is not null))$new$)
  ) p(fn,anchor,replacement) loop
    _definition:=coalesce(_definitions->>_patch.fn,pg_get_functiondef(_patch.fn::regprocedure));
    if (length(_definition)-length(replace(_definition,_patch.anchor,'')))<>length(_patch.anchor) then
      raise exception 'competition publication patch: anchor not found exactly once in %',_patch.fn;
    end if;
    _definitions:=jsonb_set(_definitions,array[_patch.fn],to_jsonb(replace(_definition,_patch.anchor,_patch.replacement)));
  end loop;
  for _patch in select value as definition from jsonb_each_text(_definitions) loop execute _patch.definition; end loop;
end
$publication$;

create function app_public.group_competition_require_capability()
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-group-contract','')<>'4' then
    raise exception 'UPDATE_REQUIRED: Update BoGa to use group competitions.' using errcode='P0001';
  end if;
end;
$$;
revoke all on function app_public.group_competition_require_capability() from public,anon,authenticated,service_role;

create function app_public.group_competition_require_active()
returns void language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_competition_require_capability();
  if not app_public.group_competition_active() then
    raise exception 'UPDATE_REQUIRED: Group competitions are not available yet.' using errcode='P0001';
  end if;
end;
$$;
revoke all on function app_public.group_competition_require_active() from public,anon,authenticated,service_role;

create function app_public.group_competition_require_member(p_group uuid,p_user uuid)
returns text language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  -- Concurrent readers share this lock; rule changes/publication use FOR UPDATE.
  perform 1 from app_public.groups where id=p_group and deleted_at is null for share;
  return app_public.group_require_member(p_group,p_user,false);
end;
$$;
revoke all on function app_public.group_competition_require_member(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function app_public.group_require_app_user()
returns uuid language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=auth.uid();
begin
  if _uid is null then raise exception 'AUTH_REQUIRED: group access requires an authenticated user' using errcode='P0001'; end if;
  if auth.jwt()->>'client_id' is not null then raise exception 'AGENT_FORBIDDEN: OAuth clients cannot access groups' using errcode='P0001'; end if;
  -- Activation takes the exclusive counterpart and waits for prior app reads.
  -- The volatile flag lookup gets a fresh snapshot after any lock wait.
  perform pg_advisory_xact_lock_shared(25006,0);
  if app_public.group_competition_active() then perform app_public.group_competition_require_capability(); end if;
  return _uid;
end;
$$;

-- Every old data route fails closed after activation, including a caller who
-- forges capability 4. Private implementations remain usable by checked new
-- entrypoints; they have no client/service execute grants.
do $legacy_readers$
declare _fn record; _args text; _volatility text;
begin
  for _fn in select p.*,pg_get_function_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname=any(array[
      'group_board','group_board_podiums','group_board_history',
      'group_certify','group_certification_withdraw','group_certification_cancel',
      'group_exercise_list','group_exercise_create','group_exercise_update','group_exercise_archive','group_exercise_unarchive',
      'group_exercise_list_v2','group_exercise_create_v2','group_exercise_update_v2','group_exercise_archive_v2','group_exercise_unarchive_v2',
      'group_metric_board','group_metric_podiums','group_metric_history','group_metric_revisions',
      'group_metric_certify','group_metric_certification_get','group_metric_certification_end',
      'group_stream','group_stream_v2','group_session_detail','group_week_summary'])
    order by p.proname,p.oid
  loop
    if _fn.prorettype<>'jsonb'::regtype or _fn.proargnames is null then
      raise exception 'Unexpected legacy competition RPC signature: %',_fn.proname;
    end if;
    select string_agg(quote_ident(a),',') into _args from unnest(_fn.proargnames) a;
    execute format('alter function app_public.%I(%s) rename to %I',
      _fn.proname,pg_get_function_identity_arguments(_fn.oid),_fn.proname||'_pre_competition');
    execute format('revoke all on function app_public.%I(%s) from public,anon,authenticated,service_role',
      _fn.proname||'_pre_competition',pg_get_function_identity_arguments(_fn.oid));
    _volatility:=case _fn.provolatile when 's' then 'stable' else 'volatile' end;
    execute format($definition$create function app_public.%I(%s) returns jsonb
      language plpgsql %s security definer set search_path=app_public,pg_temp as $body$
      begin
        perform app_public.group_require_app_user();
        if app_public.group_competition_active() then
          raise exception 'UPDATE_REQUIRED: Use the current group competition endpoint.' using errcode='P0001';
        end if;
        return app_public.%I(%s);
      end;
      $body$$definition$,_fn.proname,_fn.args,_volatility,_fn.proname||'_pre_competition',_args);
    execute format('revoke all on function app_public.%I(%s) from public',_fn.proname,pg_get_function_identity_arguments(_fn.oid));
    execute format('grant execute on function app_public.%I(%s) to anon,authenticated,service_role',
      _fn.proname,pg_get_function_identity_arguments(_fn.oid));
  end loop;
end
$legacy_readers$;

-- The private week implementation inherits its checked entrypoint's owner
-- context, like the other week helpers; it needs no independent elevation.
alter function app_public.group_week_summary_pre_competition(uuid,bigint,bigint) security invoker;

create function app_public.group_competition_certification_json(p_row app_public.group_metric_certifications)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('certification_id',coalesce(p_row.legacy_certification_id,p_row.witness_certification_id,p_row.id),
    'metric',p_row.metric,'certified_by',case when p_row.certified_by is not null then app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms',floor(extract(epoch from p_row.certified_at)*1000)::bigint,
    'observed_rules_revision',p_row.observed_rules_revision,
    'ended_at_ms',floor(extract(epoch from p_row.ended_at)*1000)::bigint,'end_reason',p_row.end_reason)
  where p_row.id is not null and p_row.metric in ('volume','e1rm');
$$;
revoke all on function app_public.group_competition_certification_json(app_public.group_metric_certifications)
  from public,anon,authenticated,service_role;

create function app_public.group_competition_performance_json(p_performance jsonb,p_normalized boolean)
returns jsonb language sql immutable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('visibility',case when p_normalized then 'normalized' else 'ordinary' end,
    'session_id',p_performance->'session_id','session_exercise_id',p_performance->'session_exercise_id',
    'exercise_definition_id',p_performance->'exercise_definition_id','set_id',p_performance->'set_id',
    'reps',p_performance->'reps','performance_status',p_performance->'performance_status',
    'source_load_input_mode',p_performance->'source_load_input_mode','achieved_at_ms',p_performance->'achieved_at_ms',
    'exercise_order_index',p_performance->'exercise_order_index','set_order_index',p_performance->'set_order_index')
    ||case when p_normalized then '{}'::jsonb else jsonb_build_object('weight_value',p_performance->'weight_value') end;
$$;
revoke all on function app_public.group_competition_performance_json(jsonb,boolean) from public,anon,authenticated,service_role;

-- Internal revision/graph rules also retain the display name and legacy
-- defaults. Public competition rules are a separate five-field allowlist.
create or replace function app_public.group_exercise_rules_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('name',p_row.name,'load_input_mode',p_row.load_input_mode,
    'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled and p_row.bodyweight_contribution>0,
    'bodyweight_contribution',p_row.bodyweight_contribution,
    'default_metric',case when p_row.default_metric in ('weight','volume','e1rm') then p_row.default_metric else 'e1rm' end,
    'rules_revision',p_row.rules_revision) from app_public.groups g where g.id=p_row.group_id;
$$;
create function app_public.group_competition_rules_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('load_input_mode',p_row.load_input_mode,
    'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled and p_row.bodyweight_contribution>0,
    'bodyweight_contribution',p_row.bodyweight_contribution,'default_metric',p_row.default_metric,
    'rules_revision',p_row.rules_revision) from app_public.groups g where g.id=p_row.group_id;
$$;
revoke all on function app_public.group_competition_rules_json(app_public.group_exercises) from public,anon,authenticated,service_role;

-- Retain historical associations as privacy evidence even after unlink/archive.
-- This only chooses disclosure; it never resolves a reading or computes a score.
create function app_public.group_competition_redacts_exercise(p_groups uuid[],p_member uuid,p_definition text)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select exists(select 1 from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
    where ge.group_id=any(p_groups) and g.deleted_at is null and g.bodyweight_calculations_enabled
      and ge.bodyweight_contribution>0 and (p_definition is null or
        exists(select 1 from app_public.exercise_group_links l where l.owner_user_id=p_member
          and l.exercise_definition_id=p_definition and app_public.group_eval_try_uuid(l.group_id)=ge.group_id
          and app_public.group_eval_try_uuid(l.group_exercise_id)=ge.id)
        or exists(select 1 from app_public.group_metric_set_scores s where s.group_exercise_id=ge.id and s.counting
          and s.member_user_id=p_member and (s.performance->>'exercise_definition_id'=p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=s.set_id and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_metric_certifications c where c.group_exercise_id=ge.id
          and c.member_user_id=p_member and (c.performance->>'exercise_definition_id'=p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=c.set_id and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_rule_revisions r cross join lateral jsonb_array_elements(r.legacy_entries) b
          where r.group_exercise_id=ge.id and b->>'member_user_id'=p_member::text and
            (b->>'exercise_definition_id'=p_definition or exists(
              select 1 from app_public.exercise_sets es join app_public.session_exercises se
                on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
                where es.owner_user_id=p_member and es.id=b->>'set_id' and se.exercise_definition_id=p_definition)))
        or exists(select 1 from app_public.group_events e where e.group_exercise_id=ge.id and e.member_user_id=p_member
          and (e.payload->'performance'->>'exercise_definition_id'=p_definition
            or e.payload->>'exercise_definition_id'=p_definition
            or e.payload->'exercise_definition_ids' ? p_definition
            or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
              on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
              where es.owner_user_id=p_member and es.id=e.set_id and se.exercise_definition_id=p_definition)))))
$$;
revoke all on function app_public.group_competition_redacts_exercise(uuid[],uuid,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_board_rows(p_group uuid,p_exercise uuid,p_revision bigint,p_metric text,p_certified boolean)
returns table(rank integer,member_user_id uuid,row_json jsonb)
language sql stable set search_path=app_public,pg_temp as $$
  with disclosure as (
    select g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 as normalized
    from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
    where g.id=p_group and ge.id=p_exercise
  ), visible as (
    select e.*,c as certificate,s.write_token,
      row_number() over(order by e.value desc,e.achieved_at_ms,e.member_user_id)::integer as rank
    from app_public.group_metric_entries(p_exercise,p_revision,p_metric,p_certified) e
    cross join disclosure d
    join app_public.group_metric_set_scores s on s.group_exercise_id=e.group_exercise_id and s.rules_revision=e.rules_revision
      and s.member_user_id=e.member_user_id and s.set_id=e.set_id and s.metric=e.metric and s.fingerprint=e.fingerprint
    left join app_public.group_metric_certifications c on c.group_exercise_id=e.group_exercise_id
      and c.member_user_id=e.member_user_id and c.set_id=e.set_id and c.metric=e.metric
      and c.ended_at is null and (c.current_fingerprint=e.fingerprint or c.id=e.certification_id)
    where e.unit=app_public.group_competition_unit(p_metric,d.normalized) and (not p_certified or c.id is not null)
      and (d.normalized or not app_public.group_competition_redacts_exercise(array[p_group],e.member_user_id,
        e.performance->>'exercise_definition_id'))
  ) select e.rank,e.member_user_id,jsonb_build_object('metric',e.metric,'value',e.value,'unit',e.unit,
    'rank',e.rank,'member',app_public.group_member_ref_json(e.member_user_id),
    'former',not exists(select 1 from app_public.group_memberships m where m.group_id=p_group and m.user_id=e.member_user_id and m.ended_at is null),
    'performance',app_public.group_competition_performance_json(e.performance,d.normalized),
    'write_token',e.write_token,'certification',app_public.group_competition_certification_json(e.certificate))
  from visible e cross join disclosure d order by e.rank;
$$;
revoke all on function app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean) from public,anon,authenticated,service_role;

create function app_public.group_competition_board(p_group_id uuid,p_group_exercise_id uuid,p_metric text,
  p_certified boolean default true,p_limit integer default 50,p_cursor text default null)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _rules jsonb; _state text; _cursor jsonb; _after integer:=0; _entries jsonb; _me jsonb; _count integer; _last integer; _next text;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_metric is null or p_metric not in ('volume','e1rm') or p_certified is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid competition board dimensions' using errcode='P0001';
  end if;
  _rules:=app_public.group_competition_rules_json(_ge);
  _state:=case when _ge.archived_at is not null then 'archived'
    when _ge.published_rules_revision is distinct from _ge.rules_revision then 'rebuilding' else 'ready' end;
  _cursor:=app_public.group_metric_cursor_decode(p_cursor);
  if _cursor is not null then
    if _cursor->>'group_id' is distinct from p_group_id::text or _cursor->>'group_exercise_id' is distinct from _ge.id::text
      or _cursor->>'metric' is distinct from p_metric or _cursor->>'certified' is distinct from p_certified::text
      or _cursor->>'rules_revision' is distinct from _ge.rules_revision::text
      or jsonb_typeof(_cursor->'after_rank') is distinct from 'number' then
      raise exception 'VALIDATION: competition cursor scope mismatch' using errcode='P0001';
    end if;
    begin _after:=(_cursor->>'after_rank')::integer;
    exception when others then raise exception 'VALIDATION: invalid competition cursor rank' using errcode='P0001'; end;
    if _after<0 then raise exception 'VALIDATION: invalid competition cursor rank' using errcode='P0001'; end if;
  end if;
  if _state='rebuilding' then _entries:='[]'; _count:=0;
  else
    select count(*) into _count from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified);
    select coalesce(jsonb_agg(r.row_json order by r.rank),'[]'),max(r.rank) into _entries,_last from (
      select * from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified)
      where rank>_after order by rank limit p_limit) r;
    select row_json into _me from app_public.group_competition_board_rows(p_group_id,_ge.id,_ge.rules_revision,p_metric,p_certified) where member_user_id=_uid;
    if _last<_count then _next:=app_public.group_metric_cursor_encode(jsonb_build_object('group_id',p_group_id,'group_exercise_id',_ge.id,
      'metric',p_metric,'certified',p_certified,'rules_revision',_ge.rules_revision,'after_rank',_last)); end if;
  end if;
  return jsonb_build_object('contract_version',4,'group_exercise_id',_ge.id,'rules',_rules,'metric',p_metric,
    'certified',p_certified,'state',_state,'entries',_entries,'entry_count',_count,'me',_me,'next_cursor',_next);
end;
$$;
revoke all on function app_public.group_competition_board(uuid,uuid,text,boolean,integer,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_board(uuid,uuid,text,boolean,integer,text) to authenticated;

create function app_public.group_competition_exercise_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('group_exercise_id',p_row.id,'name',p_row.name,'source_exercise_id',p_row.source_exercise_id,
    'archived_at_ms',floor(extract(epoch from p_row.archived_at)*1000)::bigint,'rules',app_public.group_competition_rules_json(p_row),
    'published_revision',p_row.published_rules_revision,'rebuilding',p_row.archived_at is null
      and p_row.published_rules_revision is distinct from p_row.rules_revision);
$$;
revoke all on function app_public.group_competition_exercise_json(app_public.group_exercises) from public,anon,authenticated,service_role;

create function app_public.group_competition_exercise_list(p_group_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _rows jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  select coalesce(jsonb_agg(app_public.group_competition_exercise_json(ge) order by ge.name collate "C",ge.id),'[]') into _rows
    from app_public.group_exercises ge where ge.group_id=p_group_id;
  return jsonb_build_object('contract_version',4,'exercises',_rows);
end;
$$;
revoke all on function app_public.group_competition_exercise_list(uuid) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_exercise_list(uuid) to authenticated;

create or replace function app_public.group_exercise_validate_rules(p_enabled boolean,p_contribution double precision,p_default_metric text)
returns jsonb language plpgsql volatile set search_path=app_public,pg_temp as $$
begin
  if p_enabled is null then raise exception 'VALIDATION: bodyweight calculations state is required' using errcode='P0001'; end if;
  if p_contribution is null or not(p_contribution between 0 and 1) then
    raise exception 'VALIDATION: bodyweight contribution must be between 0 and 1' using errcode='P0001';
  end if;
  if p_default_metric is null or not(p_default_metric=any(app_public.group_metric_names())) then
    raise exception 'VALIDATION: unsupported default competition metric' using errcode='P0001';
  end if;
  return jsonb_build_object('bodyweight_calculations_enabled',p_enabled,'bodyweight_contribution',p_contribution,'default_metric',p_default_metric);
end;
$$;

create function app_public.group_competition_revision_version()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  new.representation_version:=case when app_public.group_competition_active() then 4 else 3 end;
  return new;
end;
$$;
revoke all on function app_public.group_competition_revision_version() from public,anon,authenticated,service_role;
create trigger group_rule_revisions_competition_version before insert on app_public.group_rule_revisions
  for each row execute function app_public.group_competition_revision_version();

create or replace function app_public.group_metric_initial_revision()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,reason,legacy,created_by,published_at)
  values(new.group_id,new.id,1,app_public.group_exercise_rules_json(new),'initial',not app_public.group_competition_active(),new.created_by,now());
  return null;
end;
$$;

create function app_public.group_competition_exercise_create(p_group_id uuid,p_name text,p_load_input_mode text,
  p_source_exercise_id text default null,p_bodyweight_contribution double precision default 0,p_default_metric text default 'e1rm')
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _created jsonb; _row app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_active();
  _created:=app_public.group_exercise_create_v2_pre_competition(p_group_id,p_name,p_load_input_mode,
    p_source_exercise_id,p_bodyweight_contribution,p_default_metric);
  select * into strict _row from app_public.group_exercises where id=(_created->'exercise'->>'group_exercise_id')::uuid;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;
revoke all on function app_public.group_competition_exercise_create(uuid,text,text,text,double precision,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_exercise_create(uuid,text,text,text,double precision,text) to authenticated;

create function app_public.group_competition_exercise_update(p_group_id uuid,p_exercise_id uuid,p_expected_revision bigint,
  p_name text,p_load_input_mode text,p_bodyweight_contribution double precision,p_default_metric text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_active();
  perform app_public.group_exercise_update_v2_pre_competition(p_group_id,p_exercise_id,p_expected_revision,p_name,
    p_load_input_mode,p_bodyweight_contribution,p_default_metric);
  select * into strict _row from app_public.group_exercises where id=p_exercise_id and group_id=p_group_id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;
revoke all on function app_public.group_competition_exercise_update(uuid,uuid,bigint,text,text,double precision,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_exercise_update(uuid,uuid,bigint,text,text,double precision,text) to authenticated;

create function app_public.group_competition_exercise_archive(p_group_id uuid,p_exercise_id uuid,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_active();
  if p_archived is null then raise exception 'VALIDATION: archive state is required' using errcode='P0001'; end if;
  if p_archived then perform app_public.group_exercise_archive_v2_pre_competition(p_group_id,p_exercise_id);
  else perform app_public.group_exercise_unarchive_v2_pre_competition(p_group_id,p_exercise_id); end if;
  select * into strict _row from app_public.group_exercises where id=p_exercise_id and group_id=p_group_id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_row));
end;
$$;
revoke all on function app_public.group_competition_exercise_archive(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_exercise_archive(uuid,uuid,boolean) to authenticated;

create function app_public.group_competition_certify(p_group_id uuid,p_group_exercise_id uuid,p_member_user_id uuid,
  p_set_id text,p_metric text,p_expected_revision bigint,p_write_token uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _fingerprint text; _result jsonb; _row app_public.group_metric_certifications; _ge app_public.group_exercises;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_active();
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if p_metric is null or p_metric not in ('volume','e1rm') then raise exception 'VALIDATION: unsupported competition metric' using errcode='P0001'; end if;
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_member_user_id is null or p_set_id is null or p_set_id='' or p_member_user_id=_uid then
    raise exception 'VALIDATION: a different member and set are required' using errcode='P0001';
  end if;
  if _ge.archived_at is not null then raise exception 'VALIDATION: archived comparisons are read-only' using errcode='P0001'; end if;
  if _ge.rules_revision is distinct from p_expected_revision or _ge.published_rules_revision is distinct from _ge.rules_revision then
    raise exception 'CONFLICT: comparison rules changed; refresh before certifying' using errcode='P0001';
  end if;
  if app_public.group_active_role(p_group_id,p_member_user_id) is null then
    raise exception 'NOT_FOUND: member not found' using errcode='P0001';
  end if;
  select s.fingerprint into _fingerprint from app_public.group_metric_set_scores s
    where s.group_id=p_group_id and s.group_exercise_id=p_group_exercise_id and s.rules_revision=p_expected_revision
      and s.member_user_id=p_member_user_id and s.set_id=p_set_id and s.metric=p_metric and s.write_token=p_write_token;
  if not found then raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001'; end if;
  _result:=app_public.group_metric_certify_pre_competition(p_group_id,p_group_exercise_id,p_member_user_id,p_set_id,p_metric,p_expected_revision,_fingerprint);
  select * into strict _row from app_public.group_metric_certifications c
    where c.group_id=p_group_id and c.group_exercise_id=p_group_exercise_id and c.member_user_id=p_member_user_id
      and c.set_id=p_set_id and c.metric=p_metric and c.ended_at is null;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row),'created',_result->'created');
end;
$$;
revoke all on function app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_certify(uuid,uuid,uuid,text,text,bigint,uuid) to authenticated;

create function app_public.group_competition_legacy_certification_json(p_row app_public.group_certifications,p_metric text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('certification_id',p_row.id,'metric',p_metric,
    'certified_by',case when p_row.certified_by is not null then app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms',floor(extract(epoch from p_row.certified_at)*1000)::bigint,
    'observed_rules_revision',coalesce((select min(revision) from app_public.group_rule_revisions where group_exercise_id=p_row.group_exercise_id and legacy),1),
    'ended_at_ms',case when p_row.ended_at is not null then floor(extract(epoch from p_row.ended_at)*1000)::bigint end,
    'end_reason',p_row.end_reason);
$$;
revoke all on function app_public.group_competition_legacy_certification_json(app_public.group_certifications,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_certification_get(p_group_id uuid,p_certification_id uuid,p_metric text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_metric_certifications; _legacy app_public.group_certifications;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  if p_metric is null or p_metric not in ('volume','e1rm') then raise exception 'VALIDATION: unsupported competition metric' using errcode='P0001'; end if;
  select * into _row from app_public.group_metric_certifications c
    where c.group_id=p_group_id and c.metric=p_metric and
      (c.id=p_certification_id or c.legacy_certification_id=p_certification_id or c.witness_certification_id=p_certification_id)
    order by c.certified_at desc,c.id limit 1;
  if not found then
    select * into _legacy from app_public.group_certifications where group_id=p_group_id and id=p_certification_id;
    if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
    return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_legacy_certification_json(_legacy,p_metric));
  end if;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row));
end;
$$;
revoke all on function app_public.group_competition_certification_get(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_certification_get(uuid,uuid,text) to authenticated;

create function app_public.group_competition_certification_end(p_group_id uuid,p_certification_id uuid,p_metric text,p_action text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _role text; _row app_public.group_metric_certifications; _origin app_public.group_metric_certifications; _legacy app_public.group_certifications;
begin
  _role:=app_public.group_require_member(p_group_id,_uid,true);
  perform app_public.group_competition_require_active();
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  if p_metric is null or p_metric not in ('volume','e1rm') or p_action is null or p_action not in ('withdraw','cancel') then
    raise exception 'VALIDATION: invalid certification action' using errcode='P0001';
  end if;
  select * into _row from app_public.group_metric_certifications c where c.group_id=p_group_id and c.metric=p_metric
    and (c.id=p_certification_id or c.legacy_certification_id=p_certification_id or c.witness_certification_id=p_certification_id)
    order by c.certified_at desc,c.id limit 1 for update;
  if not found then
    select * into _legacy from app_public.group_certifications where group_id=p_group_id and id=p_certification_id for update;
    if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
    if p_action='withdraw' then perform app_public.group_certification_withdraw_pre_competition(p_group_id,_legacy.id);
    else perform app_public.group_certification_cancel_pre_competition(p_group_id,_legacy.id); end if;
    select * into strict _legacy from app_public.group_certifications where id=_legacy.id;
    return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_legacy_certification_json(_legacy,p_metric));
  end if;
  if (p_action='withdraw' and _row.certified_by is distinct from _uid) or (p_action='cancel' and _role not in ('owner','admin')) then
    raise exception 'FORBIDDEN: certification action is not allowed' using errcode='P0001';
  end if;
  if _row.legacy_certification_id is not null then
    if p_action='withdraw' then perform app_public.group_certification_withdraw_pre_competition(p_group_id,_row.legacy_certification_id);
    else perform app_public.group_certification_cancel_pre_competition(p_group_id,_row.legacy_certification_id); end if;
  else
    select * into strict _origin from app_public.group_metric_certifications where id=coalesce(_row.witness_certification_id,_row.id) for update;
    if _origin.ended_at is null then
      update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),
        end_reason=case p_action when 'withdraw' then 'withdrawn' else 'cancelled' end,ended_by=_uid where id=_origin.id;
      perform app_public.group_metric_enqueue_isolated(p_group_id,_row.group_exercise_id,'certification',_uid);
    end if;
  end if;
  select * into strict _row from app_public.group_metric_certifications where id=_row.id;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row));
end;
$$;
revoke all on function app_public.group_competition_certification_end(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_certification_end(uuid,uuid,text,text) to authenticated;

-- Historic values keep their metric/unit. Current enabled disclosure suppresses
-- every absolute counterpart, regardless of the event's original rules.
create function app_public.group_competition_history_value(p_value jsonb,p_normalized boolean,p_role text,p_metric text default null)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  with v as (select coalesce(p_value->>'metric',p_metric) as metric,
    coalesce(p_value->>'unit','kg') as unit,coalesce(p_value->'value',p_value->'value_kg') as value)
  select jsonb_build_object('role',p_role,'metric',v.metric,'unit',v.unit,
    'value',case when jsonb_typeof(v.value)='number' and (v.unit in ('percent_bw','percent_bw_reps') or
      (not p_normalized and v.unit in ('kg','kg_reps'))) then v.value else null end,
    'unavailable',not(coalesce(jsonb_typeof(v.value)='number',false) and
      (v.unit in ('percent_bw','percent_bw_reps') or (not p_normalized and v.unit in ('kg','kg_reps')))),
    'member',case when p_value->>'member_user_id' is not null then
      app_public.group_member_ref_json(app_public.group_eval_try_uuid(p_value->>'member_user_id')) end)
  from v where jsonb_typeof(p_value)='object' and v.metric is not null;
$$;
revoke all on function app_public.group_competition_history_value(jsonb,boolean,text,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_record_context(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('exercise',app_public.group_competition_exercise_json(ge),
    'former',app_public.group_active_role(p_event.group_id,p_event.member_user_id) is null,
    'metrics',coalesce((select jsonb_agg(jsonb_build_object('metric',s.metric,
      'write_token',s.write_token,'eligible',ge.archived_at is null and ge.rules_revision=ge.published_rules_revision
        and app_public.group_active_role(p_event.group_id,p_event.member_user_id) is not null
        and not app_public.group_set_is_warm_up(p_event.member_user_id,p_event.set_id)
        and not exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=p_event.id)
        and (exists(select 1 from app_public.group_metric_board_entries be
          where be.group_exercise_id=ge.id and be.rules_revision=ge.rules_revision and be.member_user_id=s.member_user_id
            and be.set_id=s.set_id and be.metric=s.metric and not be.certified)
          or (p_event.contract_version=2 and p_event.rules_revision=ge.rules_revision and exists(
            select 1 from jsonb_array_elements(p_event.payload->'boards') b where b->>'metric'=s.metric
              and coalesce(p_event.rule_rescore_baseline->s.metric->>'fingerprint',b->>'fingerprint')=s.fingerprint))),
      'certification',app_public.group_competition_certification_json(c)) order by s.metric)
      from app_public.group_metric_set_scores s
      left join lateral app_public.group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
      where s.group_exercise_id=ge.id and s.rules_revision=ge.rules_revision
        and s.member_user_id=p_event.member_user_id and s.set_id=p_event.set_id and s.metric in ('volume','e1rm')),'[]'::jsonb))
  from app_public.group_exercises ge where ge.id=p_event.group_exercise_id;
$$;
revoke all on function app_public.group_competition_record_context(app_public.group_events) from public,anon,authenticated,service_role;

create function app_public.group_competition_event_json(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  with holders as (
    select h from jsonb_array_elements(jsonb_build_array(p_event.payload->'leader',p_event.payload->'previous')) h
      where jsonb_typeof(h)='object'
    union all select x->'leader' from jsonb_array_elements(coalesce(p_event.payload->'leaders','[]')) x
      where jsonb_typeof(x->'leader')='object'
  ), holder_identities as (
    select app_public.group_eval_try_uuid(h->>'member_user_id') as member,
      h->'performance'->>'exercise_definition_id' as definition
      from holders
  ), identities as (
    select p_event.member_user_id as member,coalesce(p_event.payload->'performance'->>'exercise_definition_id',p_event.payload->>'exercise_definition_id') as definition
    union all select member,definition from holder_identities
    union all select p_event.member_user_id,d from jsonb_array_elements_text(coalesce(p_event.payload->'exercise_definition_ids','[]')) d
  ), disclosure as (select g.bodyweight_calculations_enabled and (ge.bodyweight_contribution>0
      or exists(select 1 from identities i where app_public.group_competition_redacts_exercise(array[p_event.group_id],i.member,i.definition))
      -- Unknown historical source identities cannot exempt an absolute holder
      -- from the enabled group's privacy boundary.
      or (exists(select 1 from app_public.group_exercises x where x.group_id=g.id and x.bodyweight_contribution>0) and (
        exists(select 1 from holder_identities i where i.member is null or i.definition is null)
        or (p_event.kind='record' and not exists(select 1 from identities i where i.member=p_event.member_user_id and i.definition is not null))
        or p_event.kind in ('link','unlink')))) as normalized,
    ge.name,r.representation_version from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
    left join app_public.group_rule_revisions r on r.group_exercise_id=ge.id and r.revision=coalesce(p_event.rules_revision,1)
    where g.id=p_event.group_id and ge.id=p_event.group_exercise_id), values_to_project as (
    select b as v,'record'::text as role,b->>'metric' as metric from jsonb_array_elements(coalesce(p_event.payload->'boards','[]')) b
    union all select p_event.payload->'leader','leader',p_event.metric where p_event.kind='lead_change'
    union all select p_event.payload->'previous','previous',p_event.metric where p_event.kind='lead_change'
    union all select b->'before','before',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'effects','[]')) b
    union all select b->'after','after',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'effects','[]')) b
    union all select b->'leader','leader',b->>'metric' from jsonb_array_elements(coalesce(p_event.payload->'leaders','[]')) b
  ) select jsonb_build_object('event_id',p_event.id,'sequence',p_event.seq,'kind',p_event.kind,
    'group',jsonb_build_object('group_id',p_event.group_id,'name',(select name from app_public.groups where id=p_event.group_id)),
    'group_exercise',jsonb_build_object('group_exercise_id',p_event.group_exercise_id,'name',d.name),
    'rules_revision',coalesce(p_event.rules_revision,1),'representation_version',case when p_event.contract_version=1 then 1 else d.representation_version end,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'sort_at_ms',p_event.sort_at_ms,'member',case when p_event.member_user_id is not null then app_public.group_member_ref_json(p_event.member_user_id) end,
    'metric',p_event.metric,'certified',p_event.certified,'reason',p_event.reason,'related_event_id',p_event.related_event_id,
    'session_id',p_event.session_id,'set_id',p_event.set_id,
    'reps',coalesce(p_event.payload->'performance'->'reps',p_event.payload->'reps'),
    'provisional',exists(select 1 from app_public.sessions s where s.owner_user_id=p_event.member_user_id and s.id=p_event.session_id and s.status='active'),
    'voided',exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=p_event.id),
    'values',coalesce((select jsonb_agg(app_public.group_competition_history_value(v,d.normalized,role,metric) order by role,metric)
      filter(where jsonb_typeof(v)='object') from values_to_project),'[]'::jsonb),
    'record_context',case when p_event.kind='record' then app_public.group_competition_record_context(p_event) end)
  from disclosure d;
$$;
revoke all on function app_public.group_competition_event_json(app_public.group_events) from public,anon,authenticated,service_role;

create function app_public.group_competition_revision_json(p_row app_public.group_rule_revisions)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('rules_revision',p_row.revision,'representation_version',p_row.representation_version,
    'rules',jsonb_build_object('load_input_mode',p_row.rules->'load_input_mode',
      'bodyweight_calculations_enabled',coalesce((p_row.rules->>'bodyweight_calculations_enabled')::boolean,false)
        and coalesce((p_row.rules->>'bodyweight_contribution')::double precision,0)>0,
      'bodyweight_contribution',coalesce(p_row.rules->'bodyweight_contribution','0'),
      'default_metric',p_row.rules->'default_metric'),
    'reason',p_row.reason,'legacy',p_row.legacy,
    'published_at_ms',floor(extract(epoch from p_row.published_at)*1000)::bigint,
    'retired_at_ms',floor(extract(epoch from p_row.retired_at)*1000)::bigint);
$$;
revoke all on function app_public.group_competition_revision_json(app_public.group_rule_revisions) from public,anon,authenticated,service_role;

create function app_public.group_competition_revisions(p_group_id uuid,p_group_exercise_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises; _rows jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  select coalesce(jsonb_agg(app_public.group_competition_revision_json(r) order by r.revision desc),'[]') into _rows
    from app_public.group_rule_revisions r where r.group_exercise_id=_ge.id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_ge),'revisions',_rows);
end;
$$;
revoke all on function app_public.group_competition_revisions(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_revisions(uuid,uuid) to authenticated;

create function app_public.group_competition_history(p_group_id uuid,p_group_exercise_id uuid,p_metric text,
  p_certified boolean,p_revision bigint default null,p_before text default null,p_limit integer default 50)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises; _revision app_public.group_rule_revisions;
  _cursor jsonb; _binding jsonb; _rows jsonb; _more boolean; _last bigint;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  select * into _revision from app_public.group_rule_revisions where group_exercise_id=_ge.id and revision=coalesce(p_revision,_ge.rules_revision);
  if not found then raise exception 'NOT_FOUND: rules revision not found' using errcode='P0001'; end if;
  if p_metric is null or p_metric not in ('weight','volume','e1rm','bodyweight_reps','relative_strength','absolute_strength')
    or p_certified is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid history dimensions' using errcode='P0001';
  end if;
  _binding:=jsonb_build_object('kind','competition_history','group',p_group_id,'exercise',_ge.id,'revision',_revision.revision,'metric',p_metric,'certified',p_certified);
  _cursor:=app_public.group_metric_cursor_decode(p_before);
  if _cursor is not null and ((_cursor-'seq') is distinct from _binding or jsonb_typeof(_cursor->'seq') is distinct from 'number'
    or (_cursor->>'seq') !~ '^[0-9]{1,18}$') then raise exception 'VALIDATION: history cursor scope mismatch' using errcode='P0001'; end if;
  with page as (select e.*,row_number() over(order by e.seq desc) as n from app_public.group_events e
    where e.group_exercise_id=_ge.id and ((e.kind='lead_change' and e.metric=p_metric and e.certified=p_certified) or e.kind='rules_change')
      and ((_revision.legacy and e.contract_version=1) or (not _revision.legacy and e.contract_version=2 and e.rules_revision=_revision.revision))
      and (_cursor is null or e.seq<(_cursor->>'seq')::bigint) order by e.seq desc limit p_limit+1)
  select coalesce(jsonb_agg(app_public.group_competition_event_json((select e from app_public.group_events e where e.id=p.id)) order by p.seq desc)
    filter(where n<=p_limit),'[]'),count(*)>p_limit,min(p.seq) filter(where n<=p_limit) into _rows,_more,_last from page p;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_ge),
    'revision',app_public.group_competition_revision_json(_revision),'metric',p_metric,'certified',p_certified,
    'events',_rows,'next_cursor',case when _more then app_public.group_metric_cursor_encode(_binding||jsonb_build_object('seq',_last)) end);
end;
$$;
revoke all on function app_public.group_competition_history(uuid,uuid,text,boolean,bigint,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_history(uuid,uuid,text,boolean,bigint,text,integer) to authenticated;

create function app_public.group_competition_podiums(p_group_id uuid,p_certified boolean default true)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _rows jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  if p_certified is null then raise exception 'VALIDATION: scope is required' using errcode='P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('exercise',app_public.group_competition_exercise_json(ge),
    'board',app_public.group_competition_board(p_group_id,ge.id,ge.default_metric,p_certified,3,null)) order by ge.name collate "C",ge.id),'[]') into _rows
    from app_public.group_exercises ge where ge.group_id=p_group_id and ge.archived_at is null;
  return jsonb_build_object('contract_version',4,'certified',p_certified,'podiums',_rows);
end;
$$;
revoke all on function app_public.group_competition_podiums(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_podiums(uuid,boolean) to authenticated;

create function app_public.group_competition_session_exercises(p_groups uuid[],p_member uuid,p_session text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',ed.load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status)
      ||case when d.normalized then '{}'::jsonb else jsonb_build_object('weight_value',es.weight_value) end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from app_public.session_exercises se left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
  cross join lateral (select app_public.group_competition_redacts_exercise(p_groups,p_member,
    case when ed.id is not null then se.exercise_definition_id end) as normalized) d
  where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null;
$$;
revoke all on function app_public.group_competition_session_exercises(uuid[],uuid,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_session_json(p_groups uuid[],p_member uuid,p_session text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('member',app_public.group_member_ref_json(p_member),'session_id',s.id,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member and g.id=s.gym_id and g.deleted_at is null),
    'status',s.status,'started_at_ms',s.started_at,'completed_at_ms',s.completed_at,'duration_sec',s.duration_sec,
    'exercises',app_public.group_competition_session_exercises(p_groups,p_member,p_session))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$$;
revoke all on function app_public.group_competition_session_json(uuid[],uuid,text) from public,anon,authenticated,service_role;

create function app_public.group_competition_session_detail(p_group_id uuid,p_member_user_id uuid,p_session_id text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _session jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  if not exists(select 1 from app_public.group_session_shares sh where sh.group_id=p_group_id
    and sh.member_user_id=p_member_user_id and sh.session_id=p_session_id) then
    raise exception 'NOT_FOUND: session not found' using errcode='P0001';
  end if;
  _session:=app_public.group_competition_session_json(array[p_group_id],p_member_user_id,p_session_id);
  if _session is null then raise exception 'NOT_FOUND: session not found' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'session',_session);
end;
$$;
revoke all on function app_public.group_competition_session_detail(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_session_detail(uuid,uuid,text) to authenticated;

create function app_public.group_competition_session_card(p_member uuid,p_session text,p_groups jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('kind','session','key',p_member::text||':'||p_session,'sort_at_ms',s.started_at,
    'groups',p_groups,'session',app_public.group_competition_session_json(
      array(select (g->>'group_id')::uuid from jsonb_array_elements(p_groups) g),p_member,p_session))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$$;
revoke all on function app_public.group_competition_session_card(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function app_public.group_competition_stream_event(p_event uuid,p_sort bigint)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('kind','competition','key',e.id,'sort_at_ms',p_sort,'event',app_public.group_competition_event_json(e))
  from app_public.group_events e where e.id=p_event;
$$;
revoke all on function app_public.group_competition_stream_event(uuid,bigint) from public,anon,authenticated,service_role;

-- Reuse the proven stream selection/order, replacing both data projections.
-- All authorized groups are locked in UUID order before selecting any rows.
do $stream$
declare _definition text;
begin
  _definition:=pg_get_functiondef('app_public.group_stream_v2_pre_competition(uuid,jsonb,integer)'::regprocedure);
  _definition:=replace(_definition,'app_public.group_stream_v2_pre_competition(','app_public.group_competition_stream_page(');
  _definition:=replace(_definition,'_last     jsonb;','_last     jsonb; _group uuid;');
  if position('  _limit := coalesce(p_limit, 20);' in _definition)=0 then raise exception 'competition stream anchor missing'; end if;
  _definition:=replace(_definition,'  _limit := coalesce(p_limit, 20);',
    '  perform app_public.group_competition_require_active();
  for _group in select unnest(_scope) order by 1 loop
    perform app_public.group_competition_require_member(_group,_uid);
  end loop;
  _limit := coalesce(p_limit, 20);');
  _definition:=replace(_definition,'app_public.group_session_card_json(p.user_id, p.session_id, p.groups)',
    'app_public.group_competition_session_card(p.user_id, p.session_id, p.groups)');
  _definition:=replace(_definition,'app_public.group_metric_stream_event_json(p.event_id,p.sort_at_ms)',
    'app_public.group_competition_stream_event(p.event_id,p.sort_at_ms)');
  _definition:=replace(_definition,'''contract_version'',3','''contract_version'',4');
  execute _definition;
end
$stream$;
revoke all on function app_public.group_competition_stream_page(uuid,jsonb,integer) from public,anon,authenticated,service_role;

create function app_public.group_competition_stream(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _cursor jsonb; _page jsonb; _binding jsonb;
begin
  if p_group_id is not null then perform app_public.group_competition_require_member(p_group_id,_uid); end if;
  perform app_public.group_competition_require_active();
  _binding:=jsonb_build_object('kind','competition_stream','group',p_group_id);
  _cursor:=app_public.group_metric_cursor_decode(p_before);
  if _cursor is not null and (_cursor-'cursor') is distinct from _binding then
    raise exception 'VALIDATION: stream cursor scope mismatch' using errcode='P0001';
  end if;
  _page:=app_public.group_competition_stream_page(p_group_id,_cursor->'cursor',p_limit);
  return jsonb_build_object('contract_version',4,'items',_page->'items','has_more',_page->'has_more',
    'next_cursor',case when (_page->>'has_more')::boolean then
      app_public.group_metric_cursor_encode(_binding||jsonb_build_object('cursor',_page->'next_cursor')) end);
end;
$$;
revoke all on function app_public.group_competition_stream(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_stream(uuid,text,integer) to authenticated;

create function app_public.group_competition_week_summary(p_group_id uuid,p_window_start_ms bigint,p_window_end_ms bigint)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _summary jsonb; _latest jsonb; _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  _summary:=app_public.group_week_summary_pre_competition(p_group_id,p_window_start_ms,p_window_end_ms);
  _latest:=_summary->'latest_completed';
  if jsonb_typeof(_latest)='object' then
    select coalesce(jsonb_agg(app_public.group_competition_event_json(e) order by e.seq),'[]') into _records
      from jsonb_array_elements(_latest->'group_records') r
      join app_public.group_events e on e.id=(r->>'key')::uuid and e.group_id=p_group_id;
    _latest:=jsonb_build_object('member',_latest->'member','session_id',_latest->'session_id',
      'started_at_ms',_latest->'started_at_ms','completed_at_ms',_latest->'completed_at_ms',
      'duration_sec',_latest->'duration_sec','gym_name',_latest->'gym_name','working_sets',_latest->'working_sets',
      'exercise_count',_latest->'exercise_count','group_records',_records);
  end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'members',_summary->'members',
    'training_now',_summary->'training_now','latest_completed',_latest);
end;
$$;
revoke all on function app_public.group_competition_week_summary(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_week_summary(uuid,bigint,bigint) to authenticated;

create or replace function app_public.group_competition_contract(p_group_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user();
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_capability();
  return jsonb_build_object('contract_version',4,'activation_state',case when app_public.group_competition_active() then 'active' else 'pending' end,
    'cache_version',5,'metrics',jsonb_build_array('volume','e1rm'),'default_metric','e1rm',
    'ordinary_units',jsonb_build_object('volume','kg_reps','e1rm','kg'),
    'normalized_units',jsonb_build_object('volume','percent_bw_reps','e1rm','percent_bw'));
end;
$$;

-- Service-only, one-way cutover. Installation leaves it pending. A hosted call
-- requires explicit deployment authority and the compatible worker/client.
-- The exclusive global fence waits for old app reads/writes before any flag or
-- revision changes; workers are fenced independently by group/revision/token.
create function app_public.group_competition_import_frozen_legacy(p_exercise app_public.group_exercises)
returns void language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _root app_public.group_certifications; _saved jsonb; _performance jsonb; _origin bigint; _effort text;
begin
  select min(revision) into _origin from app_public.group_rule_revisions where group_exercise_id=p_exercise.id and legacy;
  if _origin is null then return; end if;
  for _root in select * from app_public.group_certifications c where c.group_exercise_id=p_exercise.id and c.ended_at is null
    and (p_exercise.archived_at is not null or app_public.group_active_role(p_exercise.group_id,c.member_user_id) is null)
  loop
    select snapshot into _saved from (
      select to_jsonb(b) as snapshot,0 as priority,b.updated_at as at from app_public.group_board_entries b
        where b.group_exercise_id=p_exercise.id and b.member_user_id=_root.member_user_id
          and b.set_id=_root.set_id and b.session_id=_root.session_id
      union all
      select e.payload||jsonb_build_object('set_id',e.set_id,'session_id',e.session_id),1,e.occurred_at
        from app_public.group_events e where e.group_exercise_id=p_exercise.id and e.member_user_id=_root.member_user_id
          and e.set_id=_root.set_id and e.session_id=_root.session_id and e.kind='record'
          and e.occurred_at<=_root.certified_at
    ) evidence where snapshot->>'session_exercise_id' is not null and snapshot->>'exercise_definition_id' is not null
      order by priority,at desc limit 1;
    -- Without immutable source identity, retain the root without a fabricated
    -- projection. Normal live import reconciles it after unarchive/rejoin.
    if _saved is null then continue; end if;
    _performance:=jsonb_build_object('session_id',_root.session_id,'set_id',_root.set_id,
      'session_exercise_id',_saved->'session_exercise_id','exercise_definition_id',_saved->'exercise_definition_id',
      'weight_value',_root.pinned_weight_value,'reps_value',_root.pinned_reps_value,'reps',_root.reps,
      'performance_status',_root.pinned_performance_status,
      'source_load_input_mode',case (_saved->>'load_factor')::numeric when 2 then 'per_side_load'
        when 0.5 then 'total_load' else p_exercise.load_input_mode end,
      'achieved_at_ms',_saved->'achieved_at_ms','exercise_order_index',_saved->'exercise_order_index','set_order_index',_saved->'set_order_index');
    -- Legacy witnesses did not attest effort; adopt it once, as the original
    -- observation migration did. Never adopt today's raw values or identities.
    select set_type into _effort from app_public.exercise_sets where owner_user_id=_root.member_user_id and id=_root.set_id;
    insert into app_public.group_metric_certifications(group_id,group_exercise_id,member_user_id,set_id,session_id,metric,
      observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by,certified_at,observed_set_pin,legacy_certification_id)
    select _root.group_id,p_exercise.id,_root.member_user_id,_root.set_id,_root.session_id,m.metric,_origin,
      case m.metric when 'weight' then _root.weight_kg else _root.e1rm_kg end,'kg',_root.pinned_fingerprint,
      _performance,_root.certified_by,_root.certified_at,
      app_public.group_metric_observed_set_pin(_root.member_user_id,_performance,_effort),_root.id
    from (values('weight'),('e1rm')) m(metric)
    where (case m.metric when 'weight' then _root.weight_kg else _root.e1rm_kg end)>0 on conflict do nothing;
  end loop;
end;
$$;
revoke all on function app_public.group_competition_import_frozen_legacy(app_public.group_exercises) from public,anon,authenticated,service_role;

create function app_public.group_competition_preserve_frozen(p_exercise app_public.group_exercises,p_previous bigint)
returns void language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _normalized boolean; _revision app_public.group_rule_revisions; _previous_dependent boolean;
begin
  select * into _revision from app_public.group_rule_revisions where group_exercise_id=p_exercise.id and revision=p_previous;
  if not found or _revision.published_at is null then return; end if;
  select bodyweight_calculations_enabled and p_exercise.bodyweight_contribution>0 into _normalized
    from app_public.groups where id=p_exercise.group_id;
  _previous_dependent:=coalesce((_revision.rules->>'bodyweight_calculations_enabled')::boolean,false)
    and coalesce((_revision.rules->>'bodyweight_contribution')::double precision,0)>0;
  if _previous_dependent is distinct from _normalized then return; end if;
  -- A pending changed rule is not the published frozen representation.
  if _revision.rules->>'load_input_mode' is distinct from p_exercise.load_input_mode then return; end if;
  if _normalized and ((coalesce((_revision.rules->>'bodyweight_contribution')::double precision,0) is distinct from p_exercise.bodyweight_contribution)
    or not coalesce((_revision.rules->>'bodyweight_calculations_enabled')::boolean,false)) then return; end if;
  insert into app_public.group_metric_set_scores
    select (jsonb_populate_record(null::app_public.group_metric_set_scores,to_jsonb(s)||jsonb_build_object(
      'rules_revision',p_exercise.rules_revision,'write_token',gen_random_uuid()))).*
    from app_public.group_metric_set_scores s where s.group_exercise_id=p_exercise.id and s.rules_revision=p_previous
      and (p_exercise.archived_at is not null or app_public.group_active_role(p_exercise.group_id,s.member_user_id) is null)
      and s.metric in ('volume','e1rm') and s.unit=app_public.group_competition_unit(s.metric,_normalized)
    on conflict do nothing;
  insert into app_public.group_metric_board_entries
    select (jsonb_populate_record(null::app_public.group_metric_board_entries,to_jsonb(e)||jsonb_build_object(
      'rules_revision',p_exercise.rules_revision))).*
    from app_public.group_metric_board_entries e where e.group_exercise_id=p_exercise.id and e.rules_revision=p_previous
      and (p_exercise.archived_at is not null or app_public.group_active_role(p_exercise.group_id,e.member_user_id) is null)
      and e.metric in ('volume','e1rm') and e.unit=app_public.group_competition_unit(e.metric,_normalized)
    on conflict do nothing;
  -- Initial legacy snapshots have no generic score row. Copy only their exact
  -- ordinary 1RM; never derive Volume/percentage from an inactive performance.
  if not _revision.legacy or _normalized then return; end if;
  with frozen as (select b,m.id as membership_id,
    jsonb_build_object('session_id',b->'session_id','session_exercise_id',b->'session_exercise_id',
      'exercise_definition_id',b->'exercise_definition_id','set_id',b->'set_id',
      'weight_value',b->>'entered_weight_kg','reps_value',b->>'reps','reps',b->'reps','performance_status',null,
      'source_load_input_mode',case (b->>'load_factor')::numeric when 2 then 'per_side_load' when 0.5 then 'total_load' else p_exercise.load_input_mode end,
      'achieved_at_ms',b->'achieved_at_ms','exercise_order_index',b->'exercise_order_index','set_order_index',b->'set_order_index') as performance,
    c.id as certificate from jsonb_array_elements(_revision.legacy_entries) b
    join lateral (select id from app_public.group_memberships m where m.group_id=p_exercise.group_id
      and m.user_id=(b->>'member_user_id')::uuid and m.joined_at<=(b->>'updated_at')::timestamptz
      and (m.ended_at is null or m.ended_at>=(b->>'updated_at')::timestamptz) order by m.joined_at desc,m.id limit 1) m on true
    left join app_public.group_metric_certifications c on c.group_exercise_id=p_exercise.id
      and c.member_user_id=(b->>'member_user_id')::uuid and c.set_id=b->>'set_id' and c.metric='e1rm' and c.ended_at is null
    where b->>'metric'='e1rm' and (p_exercise.archived_at is not null
      or app_public.group_active_role(p_exercise.group_id,(b->>'member_user_id')::uuid) is null))
  insert into app_public.group_metric_set_scores(group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance)
  select p_exercise.group_id,p_exercise.id,p_exercise.rules_revision,(b->>'member_user_id')::uuid,membership_id,
    b->>'set_id',b->>'session_id',b->>'session_exercise_id',b->>'exercise_definition_id','e1rm',(b->>'value_kg')::numeric,'kg',true,
    (b->>'achieved_at_ms')::bigint,(b->>'exercise_order_index')::integer,(b->>'set_order_index')::integer,
    (b->>'achieved_at_ms')::bigint,b->>'fingerprint',performance from frozen on conflict do nothing;
  insert into app_public.group_metric_board_entries(group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    metric,certified,value,unit,set_id,session_id,session_exercise_id,exercise_definition_id,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance,certification_id)
  select s.group_id,s.group_exercise_id,s.rules_revision,s.member_user_id,s.membership_id,s.metric,(b->>'certified')::boolean,
    (b->>'value_kg')::numeric,s.unit,s.set_id,s.session_id,s.session_exercise_id,s.exercise_definition_id,
    s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.fingerprint,s.performance,c.id
  from jsonb_array_elements(_revision.legacy_entries) b join app_public.group_metric_set_scores s
    on s.group_exercise_id=p_exercise.id and s.rules_revision=p_exercise.rules_revision and s.member_user_id=(b->>'member_user_id')::uuid
      and s.set_id=b->>'set_id' and s.metric=b->>'metric'
  left join app_public.group_metric_certifications c on c.group_exercise_id=s.group_exercise_id and c.member_user_id=s.member_user_id
    and c.set_id=s.set_id and c.metric=s.metric and c.ended_at is null
  on conflict do nothing;
end;
$$;
revoke all on function app_public.group_competition_preserve_frozen(app_public.group_exercises,bigint) from public,anon,authenticated,service_role;

create function app_public.group_competition_activate(p_expected_contract integer)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _group uuid; _exercise app_public.group_exercises; _count integer:=0; _previous bigint;
begin
  if p_expected_contract is distinct from 4 then raise exception 'VALIDATION: unsupported competition activation' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(25006,0);
  perform 1 from app_public.group_competition_activation where singleton for update;
  if app_public.group_competition_active() then return jsonb_build_object('contract_version',4,'activated',false,'comparisons',0); end if;
  for _group in select id from app_public.groups order by id for no key update loop
    perform pg_advisory_xact_lock(25005,hashtext(_group::text));
  end loop;
  update app_public.group_competition_activation set activated_at=now() where singleton;
  for _exercise in select * from app_public.group_exercises order by group_id,id for no key update loop
    select max(revision) into _previous from app_public.group_rule_revisions
      where group_exercise_id=_exercise.id and published_at is not null;
    perform app_public.group_competition_import_frozen_legacy(_exercise);
    perform app_public.group_retire_current_revision(_exercise);
    update app_public.group_exercises set rules_revision=rules_revision+1,published_rules_revision=null,
      default_metric=case when default_metric='weight' then 'volume' else default_metric end,updated_at=now()
      where id=_exercise.id returning * into _exercise;
    insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,reason,legacy,created_by)
      values(_exercise.group_id,_exercise.id,_exercise.rules_revision,app_public.group_exercise_rules_json(_exercise),'rules_change',false,null);
    perform app_public.group_competition_preserve_frozen(_exercise,_previous);
    if _exercise.archived_at is null and exists(select 1 from app_public.groups g where g.id=_exercise.group_id and g.deleted_at is null) then
      perform app_public.group_metric_eval_enqueue(_exercise.group_id,_exercise.id,'rules');
    end if;
    _count:=_count+1;
  end loop;
  return jsonb_build_object('contract_version',4,'activated',true,'comparisons',_count);
end;
$$;
revoke all on function app_public.group_competition_activate(integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_activate(integer) to service_role;
