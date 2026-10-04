-- Witnessed facts and calculated scores have separate lifecycles. Original
-- certification audit fields never change; these pins are server-only.
alter table app_public.group_metric_certifications
  add column observed_set_pin text,
  add column reading_pin text,
  add column current_fingerprint text;

create function app_public.group_metric_observed_set_pin(p_member uuid,p_performance jsonb,p_set_type text)
returns text language sql immutable set search_path=app_public,pg_temp as $$
  select encode(extensions.digest(jsonb_build_array(1,p_member,
    p_performance->>'set_id',p_performance->>'session_exercise_id',
    p_performance->>'session_id',p_performance->>'exercise_definition_id',
    p_performance->>'weight_value',p_performance->>'reps_value',
    p_performance->>'performance_status',p_set_type
  )::text,'sha256'),'hex');
$$;
revoke all on function app_public.group_metric_observed_set_pin(uuid,jsonb,text)
  from public,anon,authenticated,service_role;

-- Historic record values remain public audit; subsequent reconciliation uses
-- a private baseline after a source rule rescore. Reconstructing its previous
-- source mode detects pending raw/reading corrections before advancing it.
alter table app_public.group_events add column rule_rescore_baseline jsonb;
create function app_public.group_metric_graph_fingerprint(
  p_source jsonb,p_rules jsonb,p_metric text,p_source_mode text
)
returns text language sql immutable set search_path=app_public,pg_temp as $$
  with pin as (select encode(extensions.digest(jsonb_build_object(
    'pin_version',3,'metric',p_metric,
    'source',jsonb_build_array((p_source->>'member_user_id')::uuid,p_source->>'set_id',
      p_source->>'session_exercise_id',p_source->>'session_id',p_source->>'exercise_definition_id'),
    'performance',jsonb_build_array(p_source->>'weight_value',p_source->>'reps_value',
      p_source->>'performance_status'),
    'presence',jsonb_build_array(null,null,null),'source_load_input_mode',p_source_mode
  )::text,'sha256'),'hex') as value), dependency as (
    select (p_rules->>'bodyweight_calculations_enabled')::boolean
      and (p_rules->>'bodyweight_contribution')::double precision>0 as enabled
  ) select encode(extensions.digest((case p_metric when 'weight' then
    jsonb_build_array(pin.value,(p_rules->>'rules_revision')::bigint,p_rules->>'load_input_mode')
  else jsonb_build_array(pin.value,(p_rules->>'rules_revision')::bigint,p_rules->>'load_input_mode',
    case when dependency.enabled then (p_rules->>'bodyweight_contribution')::double precision end,
    case when dependency.enabled then jsonb_build_object(
      'body_weight_kg',p_source->'body_weight_kg','body_weight_source',p_source->'body_weight_source',
      'body_weight_measurement_id',p_source->'body_weight_measurement_id',
      'body_weight_measured_at',p_source->'body_weight_measured_at_ms') end)
  end)::text,'sha256'),'hex') from pin,dependency;
$$;
revoke all on function app_public.group_metric_graph_fingerprint(jsonb,jsonb,text,text)
  from public,anon,authenticated,service_role;

-- Establish the witnessed raw pin from stored audit values, never from today's
-- weight/reps. Legacy pins predate effort coverage; adopt the current effort
-- once, then subsequent effort edits invalidate like other set edits.
update app_public.group_metric_certifications c set
  observed_set_pin=app_public.group_metric_observed_set_pin(c.member_user_id,c.performance,es.set_type),
  current_fingerprint=c.pinned_fingerprint
from app_public.exercise_sets es
where es.owner_user_id=c.member_user_id and es.id=c.set_id and c.ended_at is null;

-- Reconstruct the original scoring pin under the OBSERVED rule revision and
-- source mode. This detects a pending reading correction even when today's
-- rules differ; it does not adopt a corrected reading as the witnessed input.
-- Only certificates observed with a reading dependency perform this lookup.
with dependencies as (
  select c.id,bw.context,
    encode(extensions.digest(jsonb_build_array(
      encode(extensions.digest(jsonb_build_object(
        'pin_version',3,'metric',c.metric,
        'source',jsonb_build_array(c.member_user_id,c.set_id,
          c.performance->>'session_exercise_id',c.session_id,c.performance->>'exercise_definition_id'),
        'performance',jsonb_build_array(c.performance->>'weight_value',c.performance->>'reps_value',
          c.performance->>'performance_status'),
        'presence',jsonb_build_array(null,null,null),
        'source_load_input_mode',c.performance->>'source_load_input_mode'
      )::text,'sha256'),'hex'),
      c.observed_rules_revision,r.rules->>'load_input_mode',
      (r.rules->>'bodyweight_contribution')::double precision,
      coalesce(bw.context,jsonb_build_object('body_weight_kg',null))
    )::text,'sha256'),'hex') as original_fingerprint
  from app_public.group_metric_certifications c
  join app_public.group_rule_revisions r on r.group_exercise_id=c.group_exercise_id
    and r.revision=c.observed_rules_revision
  left join app_public.sessions s on s.owner_user_id=c.member_user_id and s.id=c.session_id
  cross join lateral (select app_public.session_weight_as_of(c.member_user_id,s.started_at) as context) bw
  where c.ended_at is null and c.metric='e1rm'
    and (r.rules->>'bodyweight_calculations_enabled')::boolean
    and (r.rules->>'bodyweight_contribution')::double precision>0
)
update app_public.group_metric_certifications c set reading_pin=
  case when c.pinned_fingerprint=d.original_fingerprint
    then encode(extensions.digest(coalesce(d.context,jsonb_build_object('body_weight_kg',null))::text,'sha256'),'hex')
    else 'pending-correction' end
from dependencies d where c.id=d.id;

-- One legacy witness covered both kg metrics. Keep its audit/ID in its
-- original table; metric rows are private projections of that same witness.
alter table app_public.group_metric_certifications
  add column legacy_certification_id uuid references app_public.group_certifications(id) on delete cascade;
create unique index group_metric_certifications_legacy_metric
  on app_public.group_metric_certifications(legacy_certification_id,metric)
  where legacy_certification_id is not null;

create function app_public.group_metric_import_legacy_certifications(p_exercise app_public.group_exercises)
returns void language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  -- Do not strand a pending deletion/edit outside the new engine: it must end
  -- before retirement, so restoration cannot silently import it later.
  update app_public.group_certifications c set ended_at=greatest(now(),c.certified_at),end_reason='voided'
  where c.group_exercise_id=p_exercise.id and c.ended_at is null and not exists (
    select 1 from app_public.exercise_sets es
    join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
    join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id
    join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    where es.owner_user_id=c.member_user_id and es.id=c.set_id and s.id=c.session_id
      and es.deleted_at is null and se.deleted_at is null and s.deleted_at is null
      and app_public.group_legacy_set_fingerprint(es)=c.pinned_fingerprint);
  insert into app_public.group_metric_certifications(
    group_id,group_exercise_id,member_user_id,set_id,session_id,metric,
    observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,
    certified_by,certified_at,observed_set_pin,legacy_certification_id)
  select c.group_id,c.group_exercise_id,c.member_user_id,c.set_id,c.session_id,m.metric,
    origin.revision,case m.metric when 'weight' then c.weight_kg else c.e1rm_kg end,
    'kg',c.pinned_fingerprint,p.snapshot,c.certified_by,c.certified_at,
    app_public.group_metric_observed_set_pin(c.member_user_id,p.snapshot,es.set_type),c.id
  from app_public.group_certifications c
  join lateral (select r.revision from app_public.group_rule_revisions r
    where r.group_exercise_id=c.group_exercise_id and r.legacy
    order by r.revision limit 1) origin on true
  join app_public.exercise_sets es on es.owner_user_id=c.member_user_id and es.id=c.set_id
  join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
  join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id
  join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
  cross join (values ('weight'),('e1rm')) m(metric)
  cross join lateral (select jsonb_build_object(
    'session_id',s.id,'session_exercise_id',se.id,'exercise_definition_id',ed.id,'set_id',es.id,
    'weight_value',c.pinned_weight_value,'reps_value',c.pinned_reps_value,'reps',c.reps,
    'performance_status',c.pinned_performance_status,'source_load_input_mode',ed.load_input_mode,
    'achieved_at_ms',s.started_at,'exercise_order_index',se.order_index,'set_order_index',es.order_index) as snapshot) p
  where c.group_exercise_id=p_exercise.id and c.ended_at is null and s.id=c.session_id
    and es.deleted_at is null and se.deleted_at is null and s.deleted_at is null
    and app_public.group_legacy_set_fingerprint(es)=c.pinned_fingerprint
    and (case m.metric when 'weight' then c.weight_kg else c.e1rm_kg end)>0
  on conflict do nothing;
end;
$$;
revoke all on function app_public.group_metric_import_legacy_certifications(app_public.group_exercises)
  from public,anon,authenticated,service_role;

-- Old and current end APIs address the same witness. A reading correction may
-- end only its 1RM projection; a raw-set void (Weight pin) ends the witness too.
create function app_public.group_metric_legacy_end_sync()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if tg_table_name='group_certifications' then
    update app_public.group_metric_certifications set ended_at=new.ended_at,
      end_reason=new.end_reason,ended_by=new.ended_by
    where legacy_certification_id=new.id and ended_at is null;
  elsif new.legacy_certification_id is not null and new.metric='weight' then
    update app_public.group_certifications set ended_at=new.ended_at,
      end_reason=new.end_reason,ended_by=new.ended_by
    where id=new.legacy_certification_id and ended_at is null;
  end if;
  return null;
end;
$$;
revoke all on function app_public.group_metric_legacy_end_sync()
  from public,anon,authenticated,service_role;
create trigger group_certifications_metric_end_sync after update of ended_at on app_public.group_certifications
  for each row when (old.ended_at is null and new.ended_at is not null)
  execute function app_public.group_metric_legacy_end_sync();
create trigger group_metric_certifications_legacy_end_sync after update of ended_at on app_public.group_metric_certifications
  for each row when (old.ended_at is null and new.ended_at is not null)
  execute function app_public.group_metric_legacy_end_sync();

-- Missing source rows remain unpinned and are voided on reconciliation. No
-- ended row is reactivated. Keep all publication/claim/revision fences intact.
do $migration$
declare _patch record; _definition text; _definitions jsonb:='{}';
begin
  for _patch in select * from (values
    ('app_public.group_retire_current_revision(app_public.group_exercises)',
      $old$  update app_public.group_rule_revisions r set$old$,
      $new$  select app_public.group_metric_import_legacy_certifications(p_exercise);
  update app_public.group_rule_revisions r set$new$),
    ('app_public.group_metric_certification_json(app_public.group_metric_certifications)',
      $old$'certification_id',p_row.id$old$,
      $new$'certification_id',coalesce(p_row.legacy_certification_id,p_row.id)$new$),
    ('app_public.group_metric_board_ranked(uuid,uuid,bigint,text,boolean)',
      $old$c.id as active_certification_id$old$,
      $new$coalesce(c.legacy_certification_id,c.id) as active_certification_id$new$),
    ('app_public.group_metric_eval_source_graph(uuid,uuid)',
      $old$      'fingerprints',jsonb_build_object($old$,
      $new$      'observed_set_pin',app_public.group_metric_observed_set_pin(s.owner_user_id,
        jsonb_build_object('set_id',es.id,'session_exercise_id',se.id,'session_id',s.id,
          'exercise_definition_id',se.exercise_definition_id,'weight_value',es.weight_value,
          'reps_value',es.reps_value,'performance_status',es.performance_status),es.set_type),
      'reading_pin',case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
        then encode(extensions.digest(coalesce(bw.context,jsonb_build_object('body_weight_kg',null))::text,'sha256'),'hex') end,
      'fingerprints',jsonb_build_object($new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$and (r ->> 'live')::boolean and r -> 'fingerprints' ->> c.metric = c.pinned_fingerprint);$old$,
      $new$and (r ->> 'live')::boolean and r ->> 'observed_set_pin' = c.observed_set_pin
          and (c.metric <> 'e1rm' or r ->> 'reading_pin' is null or c.reading_pin is null
            or r ->> 'reading_pin' = c.reading_pin));

  -- Rescore surviving observations, without changing their original audit.
  -- First activation of a reading dependency establishes a baseline; disabling
  -- it preserves that baseline without resolving a private reading while Off.
  update app_public.group_metric_certifications c set
    current_fingerprint=r -> 'fingerprints' ->> c.metric,
    reading_pin=case when c.metric='e1rm' then coalesce(c.reading_pin,r ->> 'reading_pin') end
  from jsonb_array_elements(p_graph -> 'sets') r
  where c.group_exercise_id=p_group_exercise_id and c.member_user_id=p_member_user_id
    and c.ended_at is null and r ->> 'member_user_id'=c.member_user_id::text
    and r ->> 'set_id'=c.set_id;$new$),
    ('app_public.group_metric_certification_matching(uuid,uuid,text,text,text)',
      $old$c.pinned_fingerprint = p_fingerprint$old$,$new$(c.current_fingerprint = p_fingerprint or c.pinned_fingerprint = p_fingerprint or exists (
      select 1 from app_public.group_metric_board_entries e where e.certification_id=c.id
        and e.fingerprint=p_fingerprint))$new$),
    ('app_public.group_metric_compute(uuid,bigint,uuid,uuid[])',
      $old$c.pinned_fingerprint = s.fingerprint$old$,$new$c.current_fingerprint = s.fingerprint$new$),
    ('app_public.group_metric_certified_leader(uuid,bigint,text,uuid)',
      $old$c.pinned_fingerprint = e.fingerprint$old$,$new$c.current_fingerprint = e.fingerprint$new$),
    ('app_public.group_metric_board_ranked(uuid,uuid,bigint,text,boolean)',
      $old$c.pinned_fingerprint=e.fingerprint$old$,$new$(c.current_fingerprint=e.fingerprint or c.id=e.certification_id or c.legacy_certification_id=e.certification_id)$new$),
    ('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)',
      $old$  for _member in select m from jsonb_array_elements(_graph->'members') m$old$,
      $new$  -- A source distribution edit is a rules rescore, not a lift. Mixed
  -- performance/correction jobs keep the ordinary event reconciliation.
  _graph:=_graph || jsonb_build_object('source_rules_only',
    'load_mode'=any(_job.causes)
    and _job.causes<@array['load_mode','rules','certification']::text[]);
  for _member in select m from jsonb_array_elements(_graph->'members') m$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  _source jsonb;$old$,
      $new$  _source jsonb;
  _source_rules_only boolean:=coalesce((p_graph->>'source_rules_only')::boolean,false);
  _baseline jsonb;
  _prior jsonb;
  _board jsonb;$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  if not p_silent then$old$,
      $new$  if not p_silent and not _source_rules_only then$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  if p_silent then$old$,
      $new$  if _source_rules_only then
    for _rec in select e.* from app_public.group_events e
      where e.kind='record' and e.contract_version=2
        and e.group_exercise_id=p_group_exercise_id and e.rules_revision=p_rules_revision
        and e.member_user_id=p_member_user_id
        and not exists(select 1 from app_public.group_events v
          where v.kind='record_voided' and v.related_event_id=e.id)
    loop
      select r into _source from jsonb_array_elements(p_graph->'sets') r
        where r->>'member_user_id'=p_member_user_id::text and r->>'set_id'=_rec.set_id;
      if _source is null or not (_source->>'live')::boolean then continue; end if;
      _baseline:='{}';
      for _board in select b from jsonb_array_elements(_rec.payload->'boards') b loop
        _metric:=_board->>'metric';
        _prior:=coalesce(_rec.rule_rescore_baseline->_metric,jsonb_build_object(
          'value',_board->'value','fingerprint',_board->>'fingerprint',
          'source_load_input_mode',_rec.payload->'performance'->>'source_load_input_mode'));
        if app_public.group_metric_graph_fingerprint(_source,p_graph->'rules',_metric,
          _prior->>'source_load_input_mode') is distinct from _prior->>'fingerprint' then continue; end if;
        _baseline:=_baseline || jsonb_build_object(_metric,jsonb_build_object(
          'value',(select s.value from app_public.group_metric_set_scores s
            where s.group_exercise_id=p_group_exercise_id and s.rules_revision=p_rules_revision
              and s.member_user_id=p_member_user_id and s.set_id=_rec.set_id and s.metric=_metric),
          'fingerprint',_source->'fingerprints'->>_metric,
          'source_load_input_mode',_source->>'source_load_input_mode'));
      end loop;
      if _baseline<>'{}'::jsonb then
        update app_public.group_events set rule_rescore_baseline=
          coalesce(rule_rescore_baseline,'{}'::jsonb) || _baseline where id=_rec.id;
      end if;
    end loop;
  end if;

  if p_silent then$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$          where not exists (select 1 from app_public.group_metric_set_scores s
            where s.group_exercise_id = p_group_exercise_id and s.rules_revision = p_rules_revision
              and s.member_user_id = p_member_user_id and s.set_id = _rec.set_id
              and s.metric = b ->> 'metric' and s.value = (b ->> 'value')::numeric))$old$,
      $new$          where (select s.value from app_public.group_metric_set_scores s
            where s.group_exercise_id=p_group_exercise_id and s.rules_revision=p_rules_revision
              and s.member_user_id=p_member_user_id and s.set_id=_rec.set_id and s.metric=b->>'metric')
            is distinct from case when _rec.rule_rescore_baseline ? (b->>'metric')
              then (_rec.rule_rescore_baseline->(b->>'metric')->>'value')::numeric
              else (b->>'value')::numeric end)$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$      else
        select s.* into _c from app_public.group_metric_set_scores s$old$,
      $new$      elsif _rec.rule_rescore_baseline is not null then
        update app_public.group_events set rule_rescore_baseline=(
          select jsonb_object_agg(b->>'metric',jsonb_build_object(
            'value',s.value,'fingerprint',_source->'fingerprints'->>(b->>'metric'),
            'source_load_input_mode',_source->>'source_load_input_mode'))
          from jsonb_array_elements(_rec.payload->'boards') b
          left join app_public.group_metric_set_scores s on s.group_exercise_id=p_group_exercise_id
            and s.rules_revision=p_rules_revision and s.member_user_id=p_member_user_id
            and s.set_id=_rec.set_id and s.metric=b->>'metric') where id=_rec.id;
      else
        select s.* into _c from app_public.group_metric_set_scores s$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  -- Voids, with the leaders each voided record's boards now have.$old$,
      $new$  if not _source_rules_only then
  -- Voids, with the leaders each voided record's boards now have.$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$  -- T06: lead changes on the Certified boards.$old$,
      $new$  end if;

  -- T06: lead changes on the Certified boards.$new$),
    ('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)',
      $old$    _before := _old_c_leader_by -> _metric;$old$,
      $new$    -- Coalesced certification writes still own their metric's history;
    -- a source rules rescore alone must not be attributed to a witness change.
    if _source_rules_only and not exists (
      select 1 from app_public.group_metric_certifications c
      where c.metric=_metric and c.id=any(_prev_certs || _cur_certs)
        and (c.id=any(_prev_certs)) is distinct from (c.id=any(_cur_certs))) then
      continue;
    end if;
    _before := _old_c_leader_by -> _metric;$new$),
    ('app_public.group_metric_certification_end(uuid,uuid,text)',
      $old$where group_id=p_group_id and id=p_certification_id for update;$old$,
      $new$where group_id=p_group_id and (id=p_certification_id or legacy_certification_id=p_certification_id)
    order by (ended_at is null) desc,metric limit 1 for update;$new$),
    ('app_public.group_metric_certification_end(uuid,uuid,text)',
      $old$  if _row.ended_at is null then
    update app_public.group_metric_certifications$old$,
      $new$  if _row.legacy_certification_id is not null then
    if p_action='withdraw' then
      perform app_public.group_certification_withdraw(p_group_id,_row.legacy_certification_id);
    else
      perform app_public.group_certification_cancel(p_group_id,_row.legacy_certification_id);
    end if;
    select * into _row from app_public.group_metric_certifications where id=_row.id;
  elsif _row.ended_at is null then
    update app_public.group_metric_certifications$new$),
    ('app_public.group_metric_event_json(app_public.group_events)',
      $old$'certification_id',p_row.payload -> 'certification_id'$old$,
      $new$'certification_id',coalesce(to_jsonb((select c.legacy_certification_id
        from app_public.group_metric_certifications c
        where c.id=app_public.group_eval_try_uuid(p_row.payload->>'certification_id'))),
        p_row.payload->'certification_id')$new$),
    ('app_public.group_metric_public_holder(jsonb,uuid)',
      $old$(p_holder - 'member_user_id' - 'performance' - 'session_id') || jsonb_build_object($old$,
      $new$(p_holder - 'member_user_id' - 'performance' - 'session_id') || jsonb_build_object(
      'certification_id',coalesce((select c.legacy_certification_id from app_public.group_metric_certifications c
        where c.id=app_public.group_eval_try_uuid(p_holder->>'certification_id')),
        app_public.group_eval_try_uuid(p_holder->>'certification_id')),$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$b ->> 'metric'=p_metric and b ->> 'fingerprint'=_score.fingerprint$old$,
      $new$b ->> 'metric'=p_metric and coalesce(
        e.rule_rescore_baseline->p_metric->>'fingerprint',b->>'fingerprint')=_score.fingerprint$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$if found and _row.pinned_fingerprint=_score.fingerprint then$old$,
      $new$if found and _row.observed_set_pin=_source->>'observed_set_pin'
    and (_row.metric<>'e1rm' or _source->>'reading_pin' is null or _row.reading_pin is null
      or _row.reading_pin=_source->>'reading_pin') then$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$observed_value,unit,pinned_fingerprint,performance,certified_by)$old$,
      $new$observed_value,unit,pinned_fingerprint,performance,certified_by,
    observed_set_pin,reading_pin,current_fingerprint)$new$),
    ('app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
      $old$_score.value,_score.unit,_score.fingerprint,_score.performance,_uid) returning * into _row;$old$,
      $new$_score.value,_score.unit,_score.fingerprint,_score.performance,_uid,
    _source->>'observed_set_pin',case when p_metric='e1rm' then _source->>'reading_pin' end,
    _score.fingerprint) returning * into _row;$new$),
    ('app_public.group_metric_stream_record_context(app_public.group_events)',
      $old$'metric',b->>'metric','fingerprint',b->>'fingerprint'$old$,
      $new$'metric',b->>'metric','fingerprint',b->>'fingerprint',
      'write_fingerprint',coalesce(
        p_event.rule_rescore_baseline->(b->>'metric')->>'fingerprint',b->>'fingerprint')$new$),
    ('app_public.group_metric_stream_record_context(app_public.group_events)',
      $old$s.fingerprint=b->>'fingerprint'$old$,
      $new$s.fingerprint=coalesce(p_event.rule_rescore_baseline->(b->>'metric')->>'fingerprint',b->>'fingerprint')$new$),
    ('app_public.group_metric_stream_record_context(app_public.group_events)',
      $old$p_event.set_id,b->>'metric',b->>'fingerprint'$old$,
      $new$p_event.set_id,b->>'metric',coalesce(
        p_event.rule_rescore_baseline->(b->>'metric')->>'fingerprint',b->>'fingerprint')$new$)
  ) p(fn,anchor,replacement) loop
    _definition:=coalesce(_definitions->>_patch.fn,pg_get_functiondef(_patch.fn::regprocedure));
    if (length(_definition)-length(replace(_definition,_patch.anchor,'')))<>length(_patch.anchor) then
      raise exception 'certification observation patch: anchor not found exactly once in %',_patch.fn;
    end if;
    _definitions:=jsonb_set(_definitions,array[_patch.fn],
      to_jsonb(replace(_definition,_patch.anchor,_patch.replacement)));
  end loop;
  -- Compile only complete function bodies, including paired control blocks.
  for _patch in select value as definition from jsonb_each_text(_definitions) loop
    execute _patch.definition;
  end loop;
end
$migration$;

-- Reconcile existing active comparisons once, so retained certificates acquire
-- their current projection before clients read them. Enqueue remains isolated.
do $rebuild$
declare e record;
begin
  for e in select ge.group_id,ge.id from app_public.group_exercises ge
    join app_public.groups g on g.id=ge.group_id
    where g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  loop
    perform app_public.group_metric_import_legacy_certifications(ge)
      from app_public.group_exercises ge where ge.id=e.id;
    perform app_public.group_metric_enqueue_isolated(e.group_id,e.id,'rules',null);
  end loop;
end
$rebuild$;

-- Context disambiguates the two metric projections of a legacy witness; the
-- original two-argument API remains available to older callers (defaults 1RM).
drop function app_public.group_metric_certification_get(uuid,uuid);
create function app_public.group_metric_certification_get(
  p_group_id uuid,p_certification_id uuid,p_metric text default null
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _row app_public.group_metric_certifications;
begin
  perform app_public.group_require_member(p_group_id,_uid,false);
  if p_metric is not null and p_metric not in ('weight','e1rm') then
    raise exception 'VALIDATION: metric must be weight or e1rm' using errcode='P0001';
  end if;
  select * into _row from app_public.group_metric_certifications
  where group_id=p_group_id and (id=p_certification_id or legacy_certification_id=p_certification_id)
    and (p_metric is null or metric=p_metric)
  order by metric limit 1;
  if not found then raise exception 'NOT_FOUND: certification not found' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',3,'certification',app_public.group_metric_certification_json(_row));
end;
$$;
revoke all on function app_public.group_metric_certification_get(uuid,uuid,text) from public;
grant execute on function app_public.group_metric_certification_get(uuid,uuid,text) to anon,authenticated,service_role;
