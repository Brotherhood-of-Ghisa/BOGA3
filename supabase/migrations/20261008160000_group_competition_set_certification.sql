-- Certification attests a set, not one of its scores (groups contract P10:
-- "another current member certifies a record set; one suffices").
--
-- Storage keeps one row per (set, metric): each Certified board still reads
-- its own pinned, rescored projection. A set's rows are one witness, linked
-- the way protocol 4 already links a Volume alias to its Weight origin
-- (witness_certification_id), and they share one public certification id:
--
--   * certify creates the origin row for the metric it was called with and an
--     alias for every other current score of the set, all by the same member
--     at the same instant; a set that already has an active witness is
--     returned as it is (created: false) and gains any missing alias;
--   * ending any row (withdraw, cancel, an edit's void, a reading
--     correction) ends every active row of the same witness;
--   * existing data: where one set has several active witnesses the earliest
--     wins and the others end (cancelled, no actor); every surviving witness
--     gains an alias on each current score it lacks; affected comparisons are
--     re-queued so both Certified boards pick it up.
--
-- The RPC signatures and payload shapes are unchanged, so installed builds
-- keep working: their per-metric Certify now certifies the set.
--
-- group_competition_stream_v2 is a new reader beside group_competition_stream
-- (installed builds decode the stream against an exact key allowlist): each
-- record item also carries `record` — the set as performed, and for each board
-- the record took #1 on, the group's previous #1 (holder, value and set).

-- 1. An alias may be any competition metric and carry its own observed score.
alter table app_public.group_metric_certifications drop constraint group_metric_certifications_competition_audit,
  add constraint group_metric_certifications_competition_audit check(
    (witness_certification_id is not null and metric in ('volume','e1rm') and (
      (observed_value is null and unit is null)
      or (metric='volume' and unit in ('kg_reps','percent_bw_reps') and observed_value is not null)
      or (metric='e1rm' and unit in ('kg','percent_bw') and observed_value is not null)))
    or (witness_certification_id is null and observed_value is not null and unit is not null and (
      (metric='weight' and unit='kg') or (metric='volume' and unit in ('kg_reps','percent_bw_reps'))
      or (metric='e1rm' and unit in ('kg','percent_bw')))));

-- 2. One witness ends as a whole, whichever of its rows ends first.
create function app_public.group_competition_set_witness_ended()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  update app_public.group_metric_certifications c set ended_at=greatest(new.ended_at,c.certified_at),
      end_reason=new.end_reason,ended_by=new.ended_by
    where c.ended_at is null and c.id<>new.id
      and c.group_exercise_id=new.group_exercise_id and c.member_user_id=new.member_user_id and c.set_id=new.set_id
      and coalesce(c.legacy_certification_id,c.witness_certification_id,c.id)
        =coalesce(new.legacy_certification_id,new.witness_certification_id,new.id);
  return null;
end;
$$;
revoke all on function app_public.group_competition_set_witness_ended() from public,anon,authenticated,service_role;
create trigger group_metric_certifications_set_witness_end after update of ended_at on app_public.group_metric_certifications
  for each row when(old.ended_at is null and new.ended_at is not null)
  execute function app_public.group_competition_set_witness_ended();

-- Every current Volume/1RM score of a witnessed set that has no active row
-- gains an alias of the witness's origin. Returns the number inserted.
create function app_public.group_competition_complete_witness(p_origin app_public.group_metric_certifications)
returns integer language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _count integer;
begin
  insert into app_public.group_metric_certifications(group_id,group_exercise_id,member_user_id,set_id,session_id,metric,
    observed_rules_revision,observed_value,unit,pinned_fingerprint,current_fingerprint,performance,certified_by,certified_at,
    observed_set_pin,reading_pin,legacy_certification_id,witness_certification_id)
  select s.group_id,s.group_exercise_id,s.member_user_id,s.set_id,s.session_id,s.metric,
    ge.rules_revision,s.value,s.unit,s.fingerprint,s.fingerprint,s.performance,p_origin.certified_by,p_origin.certified_at,
    p_origin.observed_set_pin,case when p_origin.metric in ('volume','e1rm') then p_origin.reading_pin end,
    p_origin.legacy_certification_id,p_origin.id
  from app_public.group_metric_set_scores s
  join app_public.group_exercises ge on ge.id=s.group_exercise_id and ge.rules_revision=s.rules_revision
  where s.group_exercise_id=p_origin.group_exercise_id and s.member_user_id=p_origin.member_user_id
    and s.set_id=p_origin.set_id and s.metric in ('volume','e1rm') and s.metric<>p_origin.metric
    and not exists(select 1 from app_public.group_metric_certifications c
      where c.group_exercise_id=s.group_exercise_id and c.member_user_id=s.member_user_id
        and c.set_id=s.set_id and c.metric=s.metric and c.ended_at is null)
  on conflict do nothing;
  get diagnostics _count=row_count;
  return _count;
end;
$$;
revoke all on function app_public.group_competition_complete_witness(app_public.group_metric_certifications)
  from public,anon,authenticated,service_role;

-- 3. Certify the set. p_metric and p_write_token name the score the caller saw;
-- every current score of the set must still match the live source.
create or replace function app_public.group_competition_certify(p_group_id uuid,p_group_exercise_id uuid,p_member_user_id uuid,
  p_set_id text,p_metric text,p_expected_revision bigint,p_write_token uuid)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises; _score app_public.group_metric_set_scores;
  _row app_public.group_metric_certifications; _origin app_public.group_metric_certifications; _source jsonb; _created boolean:=true;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
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
  select s.* into _score from app_public.group_metric_set_scores s
    where s.group_id=p_group_id and s.group_exercise_id=p_group_exercise_id and s.rules_revision=p_expected_revision
      and s.member_user_id=p_member_user_id and s.set_id=p_set_id and s.metric=p_metric and s.write_token=p_write_token;
  if not found then raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001'; end if;
  -- A record set: a current All entry, or a non-voided record, on any board.
  if app_public.group_set_is_warm_up(p_member_user_id,p_set_id) or not (
    exists (select 1 from app_public.group_metric_board_entries e
      where e.group_exercise_id=_ge.id and e.rules_revision=_ge.rules_revision
        and e.member_user_id=p_member_user_id and e.set_id=p_set_id and e.metric in ('volume','e1rm') and not e.certified)
    or exists (select 1 from app_public.group_events e
      join lateral jsonb_array_elements(e.payload -> 'boards') b on true
      join app_public.group_metric_set_scores s on s.group_exercise_id=_ge.id and s.rules_revision=_ge.rules_revision
        and s.member_user_id=p_member_user_id and s.set_id=p_set_id and s.metric=b ->> 'metric'
      where e.contract_version=2 and e.kind='record' and e.group_exercise_id=_ge.id
        and e.rules_revision=_ge.rules_revision and e.member_user_id=p_member_user_id and e.set_id=p_set_id
        and not exists (select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=e.id)
        and coalesce(e.rule_rescore_baseline->(b->>'metric')->>'fingerprint',b->>'fingerprint')=s.fingerprint)) then
    raise exception 'NOT_FOUND: record set not found for this metric' using errcode='P0001';
  end if;
  select r into _source from jsonb_array_elements(app_public.group_metric_eval_source_graph(p_group_id,_ge.id) -> 'sets') r
    where r ->> 'member_user_id'=p_member_user_id::text and r ->> 'set_id'=p_set_id;
  if _source is null or not (_source ->> 'live')::boolean or exists(select 1 from app_public.group_metric_set_scores s
      where s.group_exercise_id=_ge.id and s.rules_revision=_ge.rules_revision and s.member_user_id=p_member_user_id
        and s.set_id=p_set_id and s.metric in ('volume','e1rm') and _source -> 'fingerprints' ->> s.metric is distinct from s.fingerprint) then
    raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001';
  end if;
  perform 1 from app_public.group_metric_certifications c
    where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id and c.set_id=p_set_id and c.ended_at is null for update;
  if found then
    if exists(select 1 from app_public.group_metric_certifications c
        where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id and c.set_id=p_set_id and c.ended_at is null
          and (c.observed_set_pin is distinct from _source->>'observed_set_pin'
            or (c.metric in ('volume','e1rm') and _source->>'reading_pin' is not null and c.reading_pin is not null
              and c.reading_pin<>_source->>'reading_pin'))) then
      -- A prior observation still awaited the evaluator. End it explicitly
      -- (its whole witness) before accepting a new one.
      update app_public.group_metric_certifications set ended_at=greatest(now(),certified_at),end_reason='voided'
        where group_exercise_id=_ge.id and member_user_id=p_member_user_id and set_id=p_set_id and ended_at is null;
    else
      _created:=false;
      select c.* into _origin from app_public.group_metric_certifications c
        where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id and c.set_id=p_set_id and c.ended_at is null
        order by (c.witness_certification_id is null) desc,c.certified_at,c.id limit 1;
      if app_public.group_competition_complete_witness(_origin)>0 then
        perform app_public.group_metric_enqueue_isolated(p_group_id,_ge.id,'certification',_uid);
      end if;
    end if;
  end if;
  if _created then
    insert into app_public.group_metric_certifications (group_id,group_exercise_id,member_user_id,
      set_id,session_id,metric,observed_rules_revision,observed_value,unit,pinned_fingerprint,performance,certified_by,
      observed_set_pin,reading_pin,current_fingerprint)
    values (p_group_id,_ge.id,p_member_user_id,p_set_id,_score.session_id,p_metric,_ge.rules_revision,
      _score.value,_score.unit,_score.fingerprint,_score.performance,_uid,
      _source->>'observed_set_pin',_source->>'reading_pin',_score.fingerprint) returning * into _origin;
    perform app_public.group_competition_complete_witness(_origin);
    perform app_public.group_metric_enqueue_isolated(p_group_id,_ge.id,'certification',_uid);
  end if;
  select c.* into _row from app_public.group_metric_certifications c
    where c.group_exercise_id=_ge.id and c.member_user_id=p_member_user_id and c.set_id=p_set_id
      and c.metric=p_metric and c.ended_at is null;
  if not found then raise exception 'CONFLICT: performance changed; refresh before certifying' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',4,'certification',app_public.group_competition_certification_json(_row),'created',_created);
end;
$$;

-- 4. Existing data: one witness per set, earliest first, on every current
-- score. A function so the lane can replay it on seeded conflicts.
create function app_public.group_competition_merge_set_witnesses()
returns void language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _origin app_public.group_metric_certifications; _changed uuid[]:='{}'; _exercise record;
begin
  with active as (
    select c.id,c.group_exercise_id,c.member_user_id,c.set_id,c.certified_at,
      coalesce(c.legacy_certification_id,c.witness_certification_id,c.id) as witness
    from app_public.group_metric_certifications c where c.ended_at is null
  ), ranked as (
    select a.*,dense_rank() over (partition by a.group_exercise_id,a.member_user_id,a.set_id
      order by w.first_at,a.witness) as place
    from active a
    join (select witness,min(certified_at) as first_at from active group by witness) w on w.witness=a.witness
  ), ended as (
    update app_public.group_metric_certifications c set ended_at=greatest(now(),c.certified_at),end_reason='cancelled'
      from ranked r where r.id=c.id and r.place>1 and c.ended_at is null
      returning c.group_exercise_id
  ) select coalesce(array_agg(distinct group_exercise_id),'{}') into _changed from ended;

  for _origin in
    select distinct on (c.group_exercise_id,c.member_user_id,c.set_id) c.*
    from app_public.group_metric_certifications c
    join app_public.group_exercises ge on ge.id=c.group_exercise_id
    where c.ended_at is null and ge.archived_at is null
    order by c.group_exercise_id,c.member_user_id,c.set_id,(c.witness_certification_id is null) desc,c.certified_at,c.id
  loop
    if app_public.group_competition_complete_witness(_origin)>0 then _changed:=_changed||_origin.group_exercise_id; end if;
  end loop;

  -- Only the comparisons whose witnesses changed rebuild their Certified boards.
  for _exercise in
    select distinct ge.group_id,ge.id from app_public.group_exercises ge
    where ge.id=any(_changed) and ge.archived_at is null
  loop
    perform app_public.group_metric_eval_enqueue(_exercise.group_id,_exercise.id,'certification');
  end loop;
end;
$$;
revoke all on function app_public.group_competition_merge_set_witnesses() from public,anon,authenticated,service_role;
select app_public.group_competition_merge_set_witnesses();

-- 5. The stream with each record's set and the group's previous #1.
-- Disclosure follows the record's own visibility, and for a previous holder
-- also its lead change's: either one normalized hides kg.
create function app_public.group_competition_stream_record(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  with v as (select (app_public.group_competition_event_json(p_event)->>'visibility')='normalized' as normalized),
  perf as (select p_event.payload->'performance' as p),
  boards as (select b from jsonb_array_elements(coalesce(p_event.payload->'boards','[]'::jsonb)) b
    where jsonb_typeof(b)='object' and b->>'metric' in ('volume','e1rm')),
  previous as (
    select b->>'metric' as metric,l.payload->'previous' as holder,
      v.normalized or (app_public.group_competition_event_json(l)->>'visibility')='normalized' as normalized
    from boards,v
    cross join lateral (select l.* from app_public.group_events l
      where l.kind='lead_change' and not l.certified and l.related_event_id=p_event.id and l.metric=boards.b->>'metric'
      order by l.seq desc limit 1) l
    union all
    -- No lead change: the lifter was already #1 and beat their own best.
    select b->>'metric',jsonb_build_object('member_user_id',p_event.member_user_id,'metric',b->>'metric',
        'unit',b->'unit','value',b->'previous_value'),v.normalized
    from boards,v
    where coalesce((b->>'group_record')::boolean,false) and jsonb_typeof(b->'previous_value')='number'
      and not exists(select 1 from app_public.group_events l
        where l.kind='lead_change' and not l.certified and l.related_event_id=p_event.id and l.metric=b->>'metric')
  )
  select jsonb_build_object(
    'performance',case when jsonb_typeof(perf.p)='object' and perf.p ?& array['session_id','session_exercise_id',
        'exercise_definition_id','set_id','reps','source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index']
      and (v.normalized or jsonb_typeof(perf.p->'weight_value')='string')
      then app_public.group_competition_performance_json(perf.p,v.normalized) end,
    'previous',coalesce((select jsonb_agg(jsonb_build_object(
        'value',app_public.group_competition_history_value(p.holder,p.normalized,'previous',p.metric),
        'performance',case when jsonb_typeof(p.holder->'performance')='object'
          and (p.normalized or jsonb_typeof(p.holder->'performance'->'weight_value')='string')
          and p.holder->'performance' ?& array['session_id','session_exercise_id','exercise_definition_id','set_id','reps',
            'source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index']
          then app_public.group_competition_performance_json(p.holder->'performance',p.normalized) end)
      order by case p.metric when 'e1rm' then 0 else 1 end)
      from previous p where jsonb_typeof(p.holder)='object'
        and app_public.group_competition_history_value(p.holder,p.normalized,'previous',p.metric) is not null),'[]'::jsonb))
  from v,perf;
$$;
revoke all on function app_public.group_competition_stream_record(app_public.group_events) from public,anon,authenticated,service_role;

create function app_public.group_competition_stream_v2(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _page jsonb;
begin
  _page:=app_public.group_competition_stream(p_group_id,p_before,p_limit);
  return jsonb_set(_page,'{items}',coalesce((
    select jsonb_agg(case when e.id is not null and e.kind='record'
        then i||jsonb_build_object('record',app_public.group_competition_stream_record(e)) else i end order by x.ordinality)
    from jsonb_array_elements(_page->'items') with ordinality x(i,ordinality)
    left join app_public.group_events e on i->>'kind'='competition' and e.id::text=i->>'key'),'[]'::jsonb));
end;
$$;
revoke all on function app_public.group_competition_stream_v2(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_stream_v2(uuid,text,integer) to authenticated;
