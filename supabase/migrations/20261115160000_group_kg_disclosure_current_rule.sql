-- Group kg disclosure follows the current setup only.
--
-- Whether a co-member sees a member's kg for an exercise is decided by the
-- group's bodyweight switch, the exercise's live link and the bodyweight
-- contribution of the group exercise it links to, or of the member's own
-- exercise when it has no live link. Retained history (unlinked links,
-- scores, certifications, legacy rule entries, events, CoW source refs) and
-- the exercise a set now sits under no longer count. A member who re-points
-- a link or moves a set chooses what that shows.
--
-- The rule is a few key lookups, so readers call it directly: the per-page,
-- per-member and per-proof answer maps, the map-taking variants of every
-- reader, the CoW evidence helper and the indexes its branches needed go.
-- Every reader keeps its signature and shape.

-- The rule. One group at a time, with bodyweight calculations on:
--  * an exercise with live links to the group's exercises hides kg when one
--    of those group exercises has a bodyweight contribution;
--  * any other exercise hides kg when the member's own exercise has one;
--  * no exercise (an unknown definition) hides nothing.
create or replace function app_public.group_competition_redacts_exercise(p_groups uuid[],p_member uuid,p_definition text)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select p_definition is not null and exists(
    select 1 from app_public.groups g
    where g.id=any(p_groups) and g.deleted_at is null and g.bodyweight_calculations_enabled
      and coalesce(
        (select bool_or(ge.bodyweight_contribution>0) from app_public.exercise_group_links l
          join app_public.group_exercises ge on ge.group_id=g.id and ge.id=app_public.group_eval_try_uuid(l.group_exercise_id)
          where l.owner_user_id=p_member and l.exercise_definition_id=p_definition
            and lower(l.group_id)=g.id::text
            and l.deleted_at is null),
        exists(select 1 from app_public.exercise_definitions ed
          where ed.owner_user_id=p_member and ed.id=p_definition and ed.bodyweight_contribution>0)));
$$;

-- Board rows: an ordinary board hides a member whose source exercise the rule hides.
CREATE OR REPLACE FUNCTION app_public.group_competition_board_rows(p_group uuid, p_exercise uuid, p_revision bigint, p_metric text, p_certified boolean)
 RETURNS TABLE(rank integer, member_user_id uuid, row_json jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
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
      and c.ended_at is null and app_public.group_metric_certification_mode_matches(c)
      and (c.current_fingerprint=e.fingerprint or c.id=e.certification_id)
    where e.unit=app_public.group_competition_unit(p_metric,d.normalized) and (not p_certified or c.id is not null)
      and (d.normalized or not app_public.group_competition_redacts_exercise(array[p_group],e.member_user_id,e.performance->>'exercise_definition_id'))
  ) select e.rank,e.member_user_id,jsonb_build_object('metric',e.metric,'value',e.value,'unit',e.unit,
    'rank',e.rank,'member',app_public.group_member_ref_json(e.member_user_id),
    'former',not exists(select 1 from app_public.group_memberships m where m.group_id=p_group and m.user_id=e.member_user_id and m.ended_at is null),
    'performance',app_public.group_competition_display_performance(e.performance,d.normalized,array[p_group],e.member_user_id),
    'write_token',e.write_token,'certification',app_public.group_competition_certification_json(e.certificate))
        ||app_public.group_competition_added_e1rm_json(e.metric,e.unit,to_jsonb(e.value),
          (select (r.rules->>'bodyweight_contribution')::numeric from app_public.group_rule_revisions r
            where r.group_exercise_id=p_exercise and r.revision=p_revision
              and r.representation_version=4 and (r.rules->>'bodyweight_calculations_enabled')::boolean))
  from visible e cross join disclosure d order by e.rank;
$function$;

-- Event visibility: the event's own exercise counts bodyweight, or the rule
-- hides a source exercise the event names (its holder's or a leader's).
create function app_public.group_competition_event_normalized(p_event app_public.group_events)
returns boolean language sql stable set search_path=app_public,pg_temp as $$
  select g.bodyweight_calculations_enabled and (ge.bodyweight_contribution>0
      or exists(select 1 from app_public.group_competition_event_identities(p_event) i
        where app_public.group_competition_redacts_exercise(array[p_event.group_id],i.member,i.definition)))
    from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
   where g.id=p_event.group_id and ge.id=p_event.group_exercise_id;
$$;
revoke all on function app_public.group_competition_event_normalized(app_public.group_events) from public,anon,authenticated,service_role;

-- Event JSON.
CREATE OR REPLACE FUNCTION app_public.group_competition_event_json(p_event app_public.group_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with disclosure as (select app_public.group_competition_event_normalized(p_event) as normalized,
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
    'values',coalesce((select jsonb_agg(app_public.group_competition_history_display(v,d.normalized,role,metric,p_event) order by role,metric)
      filter(where jsonb_typeof(v)='object') from values_to_project),'[]'::jsonb),
    'record_context',case when p_event.kind='record' then app_public.group_competition_record_context(p_event) end)
  from disclosure d;
$function$;

-- Stream record.
CREATE OR REPLACE FUNCTION app_public.group_competition_stream_record(p_event app_public.group_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with v as (select app_public.group_competition_event_normalized(p_event) as normalized),
  perf as (select p_event.payload->'performance' as p),
  boards as (select b from jsonb_array_elements(coalesce(p_event.payload->'boards','[]'::jsonb)) b
    where jsonb_typeof(b)='object' and b->>'metric' in ('volume','e1rm')),
  previous as (
    select b->>'metric' as metric,l.payload->'previous' as holder,
      v.normalized or app_public.group_competition_event_normalized(l) as normalized
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
      then app_public.group_competition_display_performance(perf.p,v.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,p_event.member_user_id) end,
    'previous',coalesce((select jsonb_agg(jsonb_build_object(
        'value',app_public.group_competition_history_display(p.holder,p.normalized,'previous',p.metric,p_event),
        'performance',case when jsonb_typeof(p.holder->'performance')='object'
          and (p.normalized or jsonb_typeof(p.holder->'performance'->'weight_value')='string')
          and p.holder->'performance' ?& array['session_id','session_exercise_id','exercise_definition_id','set_id','reps',
            'source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index']
          then app_public.group_competition_display_performance(p.holder->'performance',p.normalized,case when exists(select 1 from app_public.group_exercises ge where ge.id=p_event.group_exercise_id and ge.rules_revision=p_event.rules_revision) then array[p_event.group_id] else array[]::uuid[] end,(p.holder->>'member_user_id')::uuid) end)
      order by case p.metric when 'e1rm' then 0 else 1 end)
      from previous p where jsonb_typeof(p.holder)='object'
        and app_public.group_competition_history_display(p.holder,p.normalized,'previous',p.metric,p_event) is not null),'[]'::jsonb))
  from v,perf;
$function$;

-- Withdrawn record.
CREATE OR REPLACE FUNCTION app_public.group_competition_stream_withdrawn(p_event app_public.group_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object('event',app_public.group_competition_event_json(r),
    'record',app_public.group_competition_stream_record(r)
      ||jsonb_build_object('group_record_metrics',app_public.group_competition_stream_group_record_metrics(r)))
  from app_public.group_events r
  where r.id=p_event.related_event_id and r.kind='record' and r.group_id=p_event.group_id
    and r.group_exercise_id=p_event.group_exercise_id and r.member_user_id=p_event.member_user_id;
$function$;

-- Records history item.
CREATE OR REPLACE FUNCTION app_public.group_competition_records_history_item(p_event app_public.group_events, p_metric text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with ev as (select app_public.group_competition_event_json(p_event) as j)
  select jsonb_build_object('event',ev.j,
    'record',case when p_event.kind='record' then app_public.group_competition_stream_record(p_event)
      ||jsonb_build_object('group_record_metrics',app_public.group_competition_stream_group_record_metrics(p_event)) end,
    'previous_best',case when p_event.kind='record' then (
      select app_public.group_competition_history_display(
        jsonb_build_object('member_user_id',p_event.member_user_id,'metric',b->>'metric','unit',b->'unit','value',b->'previous_value'),
        (ev.j->>'visibility')='normalized','previous',p_metric,p_event)
      from jsonb_array_elements(coalesce(p_event.payload->'boards','[]'::jsonb)) b
      where jsonb_typeof(b)='object' and b->>'metric'=p_metric and jsonb_typeof(b->'previous_value')='number'
      limit 1) end)
  from ev;
$function$;

-- Records history.
CREATE OR REPLACE FUNCTION app_public.group_competition_records_history(p_group_id uuid, p_group_exercise_id uuid, p_metric text, p_certified boolean, p_before text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _cursor jsonb; _binding jsonb; _rows jsonb; _more boolean; _last bigint;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  _ge:=app_public.group_board_require_exercise(p_group_id,p_group_exercise_id);
  if p_metric is null or p_metric not in ('volume','e1rm') or p_certified is null
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'VALIDATION: invalid history dimensions' using errcode='P0001';
  end if;
  _binding:=jsonb_build_object('kind','competition_records_history','group',p_group_id,'exercise',_ge.id,
    'metric',p_metric,'certified',p_certified);
  _cursor:=app_public.group_metric_cursor_decode(p_before);
  if _cursor is not null and ((_cursor-'seq') is distinct from _binding or jsonb_typeof(_cursor->'seq') is distinct from 'number'
    or (_cursor->>'seq') !~ '^[0-9]{1,18}$') then
    raise exception 'VALIDATION: history cursor scope mismatch' using errcode='P0001';
  end if;
  with page as (select e.id,e.seq,row_number() over(order by e.seq desc) as n from app_public.group_events e
    where e.group_exercise_id=_ge.id and e.contract_version=2 and e.kind in ('record','lead_change','rules_change')
      and (e.kind='rules_change'
        or (not p_certified and e.kind='record'
          and exists(select 1 from jsonb_array_elements(coalesce(e.payload->'boards','[]'::jsonb)) b
            where jsonb_typeof(b)='object' and b->>'metric'=p_metric)
          and not exists(select 1 from app_public.group_events v where v.kind='record_voided' and v.related_event_id=e.id))
        or (e.kind='lead_change' and e.certified=p_certified and e.metric=p_metric
          and jsonb_typeof(e.payload->'leader')='object' and (p_certified or e.reason in ('link','void'))))
      and (_cursor is null or e.seq<(_cursor->>'seq')::bigint)
    order by e.seq desc limit p_limit+1),
  shown as materialized (select e as ev,p.n,p.seq from page p join app_public.group_events e on e.id=p.id)
  select coalesce(jsonb_agg(app_public.group_competition_records_history_item(x.ev,p_metric)
      order by x.seq desc) filter(where x.n<=p_limit),'[]'::jsonb),
    count(*)>p_limit,min(x.seq) filter(where x.n<=p_limit) into _rows,_more,_last
    from shown x;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_ge),
    'metric',p_metric,'certified',p_certified,'items',_rows,
    'next_cursor',case when _more then app_public.group_metric_cursor_encode(_binding||jsonb_build_object('seq',_last)) end);
end;
$function$;

-- Session exercises.
CREATE OR REPLACE FUNCTION app_public.group_competition_session_exercises(p_groups uuid[], p_member uuid, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with blocks as (
    select se.*, ed.id as ed_id, ed.load_input_mode as ed_load_input_mode,
      case when ed.id is not null then se.exercise_definition_id end as redaction_definition
    from app_public.session_exercises se
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
    where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null
  ), redaction as materialized (
    select x.definition, app_public.group_competition_redacts_exercise(p_groups,p_member,x.definition) as normalized
    from (select distinct b.redaction_definition as definition from blocks b) x
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',se.ed_load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status)
      ||case when not d.normalized then jsonb_build_object('weight_value',es.weight_value)
        when app_public.group_competition_set_display_enabled() then
          jsonb_build_object('normalized_metrics',app_public.group_competition_set_display(p_groups,p_member,es.id))
        else '{}'::jsonb end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from blocks se
  join redaction d on d.definition is not distinct from se.redaction_definition;
$function$;

-- Stream page.
CREATE OR REPLACE FUNCTION app_public.group_competition_stream_page_core(p_group_id uuid, p_before jsonb, p_limit integer, p_cow boolean, p_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _uid uuid := app_public.group_require_app_user();
  _scope uuid[]; _limit integer; _c_sort bigint; _c_kind text; _c_key text; _group uuid;
  _items jsonb; _has_more boolean; _last jsonb;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[]) into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid and m.ended_at is null;
  end if;
  for _group in select unnest(_scope) order by 1 loop
    perform app_public.group_competition_require_member(_group,_uid);
  end loop;
  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50' using errcode = 'P0001';
  end if;
  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'rules_change', 'session', 'shared_exercise')
          and not (p_cow and (p_before ->> 'kind') = 'cow')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor' using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  -- The first limit+1 items of each kind after the cursor, per group in
  -- scope: the page's limit+1 items are among them. A kind's own scan stops
  -- at limit+1 (the stream index orders each group's events by sort_at_ms);
  -- records, which sort at their session's live start, are ranked whole.
  with candidates as (
    select c.* from unnest(_scope) sg(gid) cross join lateral (
      (select 'session'::text as kind, e.member_user_id::text||':'||e.session_id as key, s.started_at as sort_at_ms,
              e.member_user_id as user_id, e.session_id, null::text as event, null::uuid as group_id, null::uuid as event_id
         from app_public.group_events e
         join app_public.groups g on g.id = e.group_id and g.deleted_at is null
         join app_public.sessions s on s.owner_user_id = e.member_user_id and s.id = e.session_id and s.deleted_at is null
        where e.group_id = sg.gid and e.kind = 'session'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or s.started_at < _c_sort or (s.started_at = _c_sort and ('session' collate "C" > _c_kind
               or ('session' = _c_kind and (e.member_user_id::text||':'||e.session_id) collate "C" < _c_key))))
        order by e.sort_at_ms desc, (e.member_user_id::text||':'||e.session_id) collate "C" desc
        limit _limit + 1)
      union all
      (select 'membership', x.key, e.sort_at_ms, e.member_user_id, null, e.kind, e.group_id, null
         from app_public.group_events e
         cross join lateral (select e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end as key) x
        where e.group_id = sg.gid and e.kind in ('joined', 'left', 'removed')
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('membership' collate "C" > _c_kind
               or ('membership' = _c_kind and x.key collate "C" < _c_key))))
        order by e.sort_at_ms desc, x.key collate "C" desc
        limit _limit + 1)
      union all
      (select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms), e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         left join app_public.sessions s on s.owner_user_id = e.member_user_id and s.id = e.session_id
        where e.group_id = sg.gid and e.kind = 'record'
          and (_c_sort is null or coalesce(s.started_at, e.sort_at_ms) < _c_sort or (coalesce(s.started_at, e.sort_at_ms) = _c_sort
               and ('record' collate "C" > _c_kind or ('record' = _c_kind and e.id::text collate "C" < _c_key))))
        order by coalesce(s.started_at, e.sort_at_ms) desc, e.id::text collate "C" desc
        limit _limit + 1)
      union all
      (select x.kind, e.id::text, e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         cross join lateral (select case when e.kind = 'record_voided' then 'record_voided' else 'link' end as kind) x
        where e.group_id = sg.gid and e.kind in ('record_voided', 'link', 'unlink')
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and (x.kind collate "C" > _c_kind
               or (x.kind = _c_kind and e.id::text collate "C" < _c_key))))
        order by e.sort_at_ms desc, x.kind collate "C", e.id::text collate "C" desc
        limit _limit + 1)
      union all
      (select 'cow', lpad(e.seq::text,20,'0'), e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
        where p_cow and e.group_id = sg.gid and e.kind = 'cow'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('cow' collate "C" > _c_kind
               or ('cow' = _c_kind and lpad(e.seq::text,20,'0') collate "C" < _c_key))))
        order by e.sort_at_ms desc, lpad(e.seq::text,20,'0') collate "C" desc
        limit _limit + 1)
      union all
      (select 'shared_exercise', e.id::text, e.sort_at_ms, e.member_user_id, null, null, e.group_id, e.id
         from app_public.group_events e
         join app_public.group_shared_exercises se on se.id = (e.payload->>'shared_exercise_id')::uuid and se.deleted_at is null
        where e.group_id = sg.gid and e.kind = 'shared_exercise'
          and (_c_sort is null or e.sort_at_ms <= _c_sort)
          and (_c_sort is null or e.sort_at_ms < _c_sort or (e.sort_at_ms = _c_sort and ('shared_exercise' collate "C" > _c_kind
               or ('shared_exercise' = _c_kind and e.id::text collate "C" < _c_key))))
        order by e.sort_at_ms desc, e.id::text collate "C" desc
        limit _limit + 1)
    ) c
  ),
  -- One card per (member, session) in scope, deduplicated across groups.
  distinct_candidates as (
    select distinct on (kind, key) * from candidates order by kind, key
  ),
  page as (
    select d.*, row_number() over (order by d.sort_at_ms desc, d.kind collate "C", d.key collate "C" desc) as rn
      from distinct_candidates d
     order by d.sort_at_ms desc, d.kind collate "C", d.key collate "C" desc
     limit _limit + 1
  ),
  shown as materialized (select * from page where rn <= _limit),
  items as (
    select s.rn, case
             when s.kind = 'session' then
               app_public.group_competition_session_card(s.user_id, s.session_id, (
                 select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name) order by lower(g.name), g.name, g.id)
                   from app_public.group_events e
                   join app_public.groups g on g.id = e.group_id and g.deleted_at is null
                  where e.kind = 'session' and e.member_user_id = s.user_id and e.session_id = s.session_id
                    and e.group_id = any(_scope)))
             when s.kind = 'membership' then
               jsonb_build_object('kind', 'membership', 'key', s.key, 'sort_at_ms', s.sort_at_ms, 'event', s.event,
                 'group', (select jsonb_build_object('group_id', g.id, 'name', g.name) from app_public.groups g where g.id = s.group_id),
                 'member', app_public.group_member_ref_json(s.user_id))
             when s.kind = 'cow' then
               app_public.group_cow_stream_item(s.event_id, s.sort_at_ms)
             when s.kind = 'shared_exercise' then
               app_public.group_shared_exercise_stream_card(s.event_id, s.sort_at_ms)
             else (
               select case
                   when p_level >= 2 and e.kind = 'record' then
                     case when p_level >= 4 and jsonb_typeof(i.item->'record') = 'object' then
                       jsonb_set(i.item, '{record,group_record_metrics}', app_public.group_competition_stream_group_record_metrics(e))
                     else i.item end
                   when p_level >= 5 and e.kind = 'record_voided' then
                     i.item || jsonb_build_object('withdrawn', coalesce(app_public.group_competition_stream_withdrawn(e), 'null'::jsonb))
                   else i.item end
                 from app_public.group_events e
                 -- offset 0: built once, not once per reference.
                 cross join lateral (select jsonb_build_object('kind', 'competition', 'key', e.id, 'sort_at_ms', s.sort_at_ms,
                     'event', app_public.group_competition_event_json(e))
                   || case when p_level >= 2 and e.kind = 'record' then jsonb_build_object('record',
                        app_public.group_competition_stream_record(e)) else '{}'::jsonb end
                   as item offset 0) i
                where e.id = s.event_id)
           end as item
      from shown s
  )
  select coalesce((select jsonb_agg(i.item order by i.rn) from items i), '[]'::jsonb),
         (select count(*) > _limit from page),
         (select jsonb_build_object('sort_at_ms', s.sort_at_ms, 'kind', s.kind, 'key', s.key) from shown s order by s.rn desc limit 1)
    into _items, _has_more, _last;

  return jsonb_build_object('contract_version', 4, 'items', _items,
    'next_cursor', case when _has_more then _last else null end, 'has_more', _has_more);
end $function$;

-- CoW result rows: a kg CoW hides every figure while its group exercise now
-- counts bodyweight, as a board does, and otherwise a member whose source
-- exercise the rule hides.
CREATE OR REPLACE FUNCTION app_public.group_cow_result_rows(p_cow app_public.group_cows, p_metric text)
 RETURNS TABLE(ordinal integer, member_id uuid, row_json jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
begin
  perform app_public.group_cow_reject_agent();
  if app_public.group_cow_public_state(p_cow)<>'ready' then return; end if;
  return query with ranking as (
    select r from jsonb_array_elements(case when p_cow.finalized_at is not null then p_cow.final_rankings
      else p_cow.live_rankings->'rankings' end) r where r->>'metric'=p_metric
  ), members as (
    select p.member_user_id,e.entry,r.r->'unavailableMemberIds' ? p.member_user_id::text as arithmetic_unavailable
      from app_public.group_cow_participants p cross join ranking r left join lateral (
        select v as entry from jsonb_array_elements(r.r->'entries') v where v->>'memberId'=p.member_user_id::text
      ) e on true where p.cow_id=p_cow.id
  ), disclosure as materialized (
    select m.*,not (p_cow.start_context->>'normalized')::boolean and (exists(
      select 1 from app_public.groups g join app_public.group_exercises ge on ge.group_id=g.id
        where g.id=p_cow.group_id and ge.id=p_cow.group_exercise_id and g.deleted_at is null
          and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0) or exists(
      select 1 from app_public.group_cow_source_refs refs where refs.cow_id=p_cow.id
        and refs.member_user_id=m.member_user_id and refs.metric=p_metric and
        app_public.group_competition_redacts_exercise(array[p_cow.group_id],m.member_user_id,nullif(refs.definition_id,'')))) as suppressed
      from members m
  ) select (m.entry->>'rank')::integer,m.member_user_id,jsonb_build_object('rank',(m.entry->>'rank')::integer,
      'member',app_public.group_member_ref_json(m.member_user_id),
      'former',not exists(select 1 from app_public.group_memberships p where p.group_id=p_cow.group_id and p.user_id=m.member_user_id and p.ended_at is null),
      'value',case when not m.suppressed then m.entry->'value' end,
      'state',case when m.suppressed or m.arithmetic_unavailable then 'unavailable' when m.entry is null then 'unranked' else 'ranked' end)
        ||app_public.group_competition_added_e1rm_json(p_metric,
          app_public.group_competition_unit(p_metric,(p_cow.start_context->>'normalized')::boolean),
          case when not m.suppressed and not m.arithmetic_unavailable then m.entry->'value' end,
          (p_cow.start_context->>'bodyweight_contribution')::numeric)
    from disclosure m;
end $function$;

-- CoW public result.
CREATE OR REPLACE FUNCTION app_public.group_cow_public_result(p_cow app_public.group_cows, p_metrics text[], p_before text, p_limit integer, p_top boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare metric text; state text:=app_public.group_cow_public_state(p_cow); ranks jsonb:='[]'; rows jsonb; page jsonb;
  cursor jsonb; edge integer:=0; edge_id uuid:='00000000-0000-0000-0000-000000000000'; last_row jsonb; total integer; more boolean;
  ge app_public.group_exercises; normalized boolean; unit text; publication uuid;
begin
  perform app_public.group_cow_reject_agent();
  select * into ge from app_public.group_exercises where id=p_cow.group_exercise_id and group_id=p_cow.group_id;
  normalized:=case when (p_cow.start_context->>'available')::boolean then (p_cow.start_context->>'normalized')::boolean end;
  publication:=case when state<>'pending' then p_cow.publication_id end;
  if p_before is not null then
    begin
      cursor:=p_before::jsonb;
      if cardinality(p_metrics)<>1 or not (cursor ?& array['group','cow','revision','metric','publication','rank','member']) or
        cursor-array['group','cow','revision','metric','publication','rank','member']<>'{}'::jsonb or
        cursor->>'group' is distinct from p_cow.group_id::text or cursor->>'cow' is distinct from p_cow.id::text or
        cursor->>'metric' is distinct from p_metrics[1] or (cursor->>'revision')::bigint is distinct from p_cow.revision then raise exception 'bad scope'; end if;
      edge:=(cursor->>'rank')::integer; edge_id:=(cursor->>'member')::uuid;
      if edge is null or edge<1 or edge_id is null then raise exception 'bad edge'; end if;
    exception when others then raise exception 'VALIDATION: invalid CoW cursor' using errcode='P0001'; end;
    if cursor->>'publication' is distinct from publication::text then raise exception 'CONFLICT: CoW changed; refresh results' using errcode='P0001'; end if;
  end if;
  foreach metric in array p_metrics loop
    unit:=case when normalized is null then null when metric='improvement' then 'percent'
      else app_public.group_competition_unit(metric,normalized) end;
    with r as materialized (select * from app_public.group_cow_result_rows(p_cow,metric))
    select (select count(*)::integer from r),coalesce(jsonb_agg(x.row_json order by coalesce(x.ordinal,2147483647),x.member_id),'[]'),count(*)>p_limit
      into total,rows,more
      from (select * from r where (not p_top or r.ordinal<=3) and (coalesce(r.ordinal,2147483647),r.member_id)>(edge,edge_id)
        order by coalesce(r.ordinal,2147483647),r.member_id limit p_limit+1) x;
    if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
    last_row:=rows->(jsonb_array_length(rows)-1);
    page:=jsonb_build_object('metric',metric,'unit',unit,'entries',rows,'entry_count',total,'next_cursor',case when more then
      jsonb_build_object('group',p_cow.group_id,'cow',p_cow.id,'revision',p_cow.revision,'metric',metric,'publication',publication,
        'rank',coalesce((last_row->>'rank')::integer,2147483647),'member',last_row->'member'->>'user_id')::text end);
    ranks:=ranks||jsonb_build_array(page);
  end loop;
  return jsonb_build_object('cow',app_public.group_cow_json(p_cow),'exercise',case when ge.id is not null then app_public.group_competition_exercise_json(ge) end,
    'bodyweight_calculations_enabled',(select bodyweight_calculations_enabled from app_public.groups where id=p_cow.group_id),
    'state',state,'normalized',normalized,'publication_id',publication,'rankings',ranks);
end $function$;

-- CoW stream item.
CREATE OR REPLACE FUNCTION app_public.group_cow_stream_item(p_event_id uuid, p_sort bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare e app_public.group_events; c app_public.group_cows; result jsonb;
begin
  perform app_public.group_cow_reject_agent();
  select * into strict e from app_public.group_events where id=p_event_id and kind='cow';
  if e.payload->>'event' in ('results','unavailable') then
    select * into strict c from app_public.group_cows where id=(e.payload->'definition'->>'cow_id')::uuid
      and group_id=e.group_id and finalized_at is not null and publication_id::text=e.payload->>'publication_id';
    result:=app_public.group_cow_public_result(c,c.metrics,null,1,true);
  end if;
  return jsonb_build_object('kind','cow','key',lpad(e.seq::text,20,'0'),'sort_at_ms',p_sort,
    'event',e.payload->'event','definition',e.payload->'definition','previous',e.payload->'previous',
    'actor',case when e.actor_user_id is not null then app_public.group_member_ref_json(e.actor_user_id) end,'result',result);
end $function$;

-- Notification ranks. The target member's scores span their whole history, so
-- the rule is asked once per definition they hold, not once per score row.
CREATE OR REPLACE FUNCTION app_public.notification_ranks_from_graph(p_group uuid, p_exercise uuid, p_revision bigint, p_target app_public.notification_workout_targets, p_graph jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with dimensions as (select m as metric,c as certified from unnest(array['volume','e1rm']) m cross join unnest(array[false,true]) c),
  source as materialized(select p_graph as graph),
  saved_sources as (select b,false as admitted from jsonb_array_elements((p_target).baseline_scores) b
    union all select b,true from jsonb_array_elements((p_target).admission_scores) b),
  saved as (select b,admitted,(b->>'certified')::boolean as bound_certified from saved_sources
    union all select b||jsonb_build_object('certified',true),admitted,false from saved_sources where not (b->>'certified')::boolean
    union all select b||jsonb_build_object('certified',false),admitted,true from saved_sources where (b->>'certified')::boolean),
  hidden as materialized(
    select d.definition,group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,d.definition) as redacted
    from (select s.exercise_definition_id as definition from group_metric_set_scores s
        where s.group_exercise_id=p_exercise and s.rules_revision=p_revision
          and s.member_user_id=(p_target).member_user_id and s.counting
      union select b->>'exercise_definition_id' from saved_sources) d
    where (p_target).member_user_id is not null
  ),
  qualified_saved as (
    select saved.* from saved join group_exercises ge on ge.id=p_exercise join groups g on g.id=ge.group_id
    where (p_target).rules_revision=p_revision
      and exists(select 1 from exercise_group_links l where l.owner_user_id=(p_target).member_user_id
        and l.exercise_definition_id=b->>'exercise_definition_id' and l.deleted_at is null
        and group_eval_try_uuid(l.group_id)=p_group and group_eval_try_uuid(l.group_exercise_id)=p_exercise)
      and b->>'unit'=group_competition_unit(b->>'metric',g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (not (b->>'certified')::boolean or exists(select 1 from group_metric_certifications c
        where c.group_exercise_id=p_exercise and c.member_user_id=(p_target).member_user_id
          and c.set_id=b->>'set_id' and c.metric=b->>'metric' and c.observed_set_pin=b->>'observed_set_pin'
          and group_metric_certification_mode_matches(c)
          and (c.pinned_fingerprint=b->>'fingerprint' or c.current_fingerprint=b->>'fingerprint')
          and (c.ended_at is null or (c.end_reason='voided' and exists(
            select 1 from source,jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
              and x->>'set_id'=b->>'set_id' and (x->>'observed_set_pin' is distinct from b->>'observed_set_pin' or not (x->>'live')::boolean))))))
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not (select h.redacted from hidden h where h.definition is not distinct from b->>'exercise_definition_id'))
  ), compatible_saved as (
    select q.* from qualified_saved q cross join source where coalesce((b->>'projection_known')::boolean,false) and exists(
      select 1 from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
        and x->>'set_id'=b->>'set_id' and x->>'source_load_input_mode' is not distinct from b->>'source_load_input_mode'
        and x->>'reading_pin' is not distinct from b->>'reading_pin'
        and (x->>'source_mode_generation')::bigint=(b->>'source_mode_generation')::bigint
        and (x->>'achieved_at_ms')::bigint=(b->>'achieved_at_ms')::bigint)
  ), incompatible_baseline as (select b->>'metric' as metric,(b->>'certified')::boolean as certified
    from qualified_saved q cross join source where not exists(select 1 from compatible_saved k where k.b=q.b)
      and not exists(
      select 1 from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
        and x->>'set_id'=b->>'set_id' and x->>'observed_set_pin'=coalesce(
          (p_target).source_controls->(b->>'set_id')->>'admission_pin',(p_target).source_controls->(b->>'set_id')->>'performed_pin'))),
  incompatible_final as (
    select e.metric,e.certified from group_metric_board_entries e cross join source
    left join lateral(select x from jsonb_array_elements(source.graph->'sets') x
      where x->>'member_user_id'=(p_target).member_user_id::text and x->>'set_id'=e.set_id) live on true
    cross join lateral(select (p_target).source_controls->e.set_id as origin) frozen
    where e.group_exercise_id=p_exercise and e.rules_revision=p_revision and e.member_user_id=(p_target).member_user_id
      and e.session_id=(p_target).session_id and (
        (coalesce(origin->>'admission_context',origin->>'context') is distinct from encode(extensions.digest(jsonb_build_array(x->'source_load_input_mode',
          x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex') and
          not ((coalesce(origin->'counted_metrics','[]'::jsonb) ? e.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? e.metric) and
            x->>'observed_set_pin'=coalesce(origin->>'admission_pin',origin->>'performed_pin'))) or
        ((origin->>'link_admission_pin' is not null or origin->>'member_admission_pin' is not null) and origin->>'admission_pin' is null))
  ), incompatible_changed_controls as (
    -- A lower original source can become relevant under changed metadata too; no old numeric score is reinterpreted.
    select s.metric,d.certified from group_metric_set_scores s cross join source
    join dimensions d on d.metric=s.metric
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=s.member_user_id::text
      and x->>'set_id'=s.set_id) live on true
    cross join lateral(select (p_target).source_controls->s.set_id as origin) frozen
    left join lateral group_metric_certification_matching(p_exercise,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    where s.group_exercise_id=p_exercise and s.rules_revision=p_revision and s.member_user_id=(p_target).member_user_id
      and s.session_id=(p_target).session_id and s.counting and (not d.certified or c.id is not null)
      and (coalesce(origin->'counted_metrics','[]'::jsonb) ? d.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? d.metric)
      and x->>'observed_set_pin' is distinct from coalesce(origin->>'admission_pin',origin->>'performed_pin')
      and coalesce(origin->>'admission_context',origin->>'context') is distinct from encode(extensions.digest(jsonb_build_array(
        x->'source_load_input_mode',x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex')
  ), incompatible_reselection as (
    -- If a changed lower original becomes relevant after its frozen winner loses control eligibility, its old scalar is unproved.
    select d.metric,d.certified from dimensions d cross join source
    cross join lateral jsonb_each((p_target).source_controls) origin
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
      and x->>'set_id'=origin.key) live on true
    where (x->>'counting')::boolean and (x->>'observed_set_pin' is distinct from
      coalesce(origin.value->>'admission_pin',origin.value->>'performed_pin') or not (x->>'live')::boolean or
      (coalesce(origin.value->'counted_metrics','[]'::jsonb) ? d.metric and not exists(
        select 1 from group_metric_set_scores s where s.group_exercise_id=p_exercise and s.rules_revision=p_revision
          and s.member_user_id=(p_target).member_user_id and s.set_id=origin.key and s.metric=d.metric and s.counting)))
      and (coalesce(origin.value->'counted_metrics','[]'::jsonb) ? d.metric or coalesce(origin.value->'admission_metrics','[]'::jsonb) ? d.metric)
      and (not d.certified or exists(select 1 from group_metric_certifications c
        where c.group_exercise_id=p_exercise and c.member_user_id=(p_target).member_user_id and c.set_id=origin.key and c.metric=d.metric
          and c.observed_set_pin=coalesce(origin.value->>'admission_pin',origin.value->>'performed_pin')
          and group_metric_certification_mode_matches(c)
          and (c.ended_at is null or (c.end_reason='voided' and
            (not (x->>'live')::boolean or x->>'observed_set_pin' is distinct from c.observed_set_pin)))))
      and not exists(select 1 from compatible_saved where b->>'metric'=d.metric and (b->>'certified')::boolean=d.certified and b->>'set_id'=origin.key)
      and not exists(select 1 from compatible_saved where b->>'metric'=d.metric and (b->>'certified')::boolean=d.certified
        and admitted=(coalesce(origin.value->'admission_metrics','[]'::jsonb) ? d.metric)
        and (not bound_certified or (case when admitted then coalesce(origin.value->'admission_certified_metrics','[]'::jsonb)
          else coalesce(origin.value->'certified_metrics','[]'::jsonb) end) ? d.metric))
  ), incompatible as (select * from incompatible_baseline union select * from incompatible_final
    union select * from incompatible_changed_controls union select * from incompatible_reselection),
  actual as (
    select d.metric,d.certified,r.member_user_id,(r.row_json->>'value')::numeric as value,
      (r.row_json->'performance'->>'achieved_at_ms')::bigint as achieved_at_ms
    from dimensions d cross join lateral group_competition_board_rows(p_group,p_exercise,p_revision,d.metric,d.certified) r
    where (p_target).member_user_id is null or r.member_user_id<>(p_target).member_user_id or
      exists(select 1 from incompatible i where i.metric=d.metric and i.certified=d.certified)
  ), eligible as (
    select s.metric,d.certified,s.value,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id
    from dimensions d join group_metric_set_scores s on s.metric=d.metric
    join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
    left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    where (p_target).member_user_id is not null and s.member_user_id=(p_target).member_user_id and s.session_id<>(p_target).session_id
      and s.group_exercise_id=p_exercise and s.rules_revision=p_revision and s.counting and (not d.certified or c.id is not null)
      and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not (select h.redacted from hidden h where h.definition is not distinct from s.exercise_definition_id))
    union all
    -- Unchanged original/admitted performances use current control and witness eligibility, including metadata-rescored lower sources.
    select s.metric,d.certified,s.value,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id
    from dimensions d join group_metric_set_scores s on s.metric=d.metric cross join source
    join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
    left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=s.member_user_id::text
      and x->>'set_id'=s.set_id) live on true
    cross join lateral(select (p_target).source_controls->s.set_id as origin) frozen
    where s.member_user_id=(p_target).member_user_id and s.session_id=(p_target).session_id and s.group_exercise_id=p_exercise
      and s.rules_revision=p_revision and s.counting and (not d.certified or c.id is not null)
      and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not (select h.redacted from hidden h where h.definition is not distinct from s.exercise_definition_id))
      and (coalesce(origin->'counted_metrics','[]'::jsonb) ? s.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? s.metric)
      and coalesce(origin->>'admission_pin',origin->>'performed_pin')=x->>'observed_set_pin'
    union all
    -- Restoring the original published contribution avoids attributing someone else's movement to an unchanged old workout.
    select b->>'metric',(b->>'certified')::boolean,(b->>'value')::numeric,(b->>'achieved_at_ms')::bigint,
      (b->>'exercise_order_index')::int,(b->>'set_order_index')::int,(b->>'set_created_at_ms')::bigint,b->>'set_id'
    from compatible_saved
  ), replacement as (
    select d.metric,d.certified,(p_target).member_user_id as member_user_id,w.value,w.achieved_at_ms
    from dimensions d cross join lateral (
      select * from eligible s where s.metric=d.metric and s.certified=d.certified and group_active_role(p_group,(p_target).member_user_id) is not null
      order by s.value desc,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id collate "C" limit 1
    ) w where not exists(select 1 from incompatible i where i.metric=d.metric and i.certified=d.certified)
  ), ordered as (
    select metric,certified,member_user_id,row_number() over(partition by metric,certified order by value desc,achieved_at_ms,member_user_id)::int as rank
    from (select * from actual union all select * from replacement) rows
  ) select coalesce(jsonb_agg(to_jsonb(ordered) order by metric,certified,rank),'[]'::jsonb) from ordered;
$function$;

-- Notification target capture.
CREATE OR REPLACE FUNCTION app_public.notification_target_capture_from_graph(p_target app_public.notification_workout_targets, p_graph jsonb, p_after boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare target notification_workout_targets:=p_target; baseline jsonb; admitted_graph jsonb; admission jsonb;
begin
  baseline:=notification_baseline_scores(target.member_user_id,target.session_id,target.group_exercise_id,target.rules_revision,p_graph);
  target.source_controls:=notification_source_controls(target,p_graph);
  if not coalesce(target.baseline_known,false) then target.baseline_scores:=baseline; target.admission_scores:='[]'::jsonb; end if;
  if p_after then
    -- Freeze only newly control-admitted performances after their first coherent scorer publication.
    select jsonb_set(p_graph,'{sets}',coalesce(jsonb_agg(x),'[]'::jsonb)) into admitted_graph
      from jsonb_array_elements(p_graph->'sets') x where x->>'member_user_id'=target.member_user_id::text
        and x->>'session_id'=target.session_id and target.source_controls->(x->>'set_id')->>'admission_pin' is null
        and (target.source_controls->(x->>'set_id')->>'link_admission_pin' is not null or
          target.source_controls->(x->>'set_id')->>'member_admission_pin' is not null);
    admission:=notification_baseline_scores(target.member_user_id,target.session_id,target.group_exercise_id,target.rules_revision,admitted_graph);
    select coalesce(jsonb_agg(b order by b->>'metric',b->>'certified'),'[]'::jsonb) into target.admission_scores from (
      select distinct on(b->>'metric',b->>'certified') b from jsonb_array_elements(coalesce(target.admission_scores,'[]'::jsonb)||admission) b
      order by b->>'metric',b->>'certified',(b->>'value')::numeric desc,(b->>'achieved_at_ms')::bigint,
        (b->>'exercise_order_index')::int,(b->>'set_order_index')::int,(b->>'set_created_at_ms')::bigint,b->>'set_id' collate "C"
    ) winners;
    select target.source_controls||coalesce(jsonb_object_agg(x->>'set_id',target.source_controls->(x->>'set_id')||jsonb_build_object(
      'admission_pin',x->>'observed_set_pin','admission_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        where s.group_exercise_id=target.group_exercise_id and s.rules_revision=target.rules_revision
          and s.member_user_id=target.member_user_id and s.set_id=x->>'set_id' and s.counting),'[]'::jsonb),
      'admission_certified_metrics',coalesce((
        select jsonb_agg(distinct s.metric) from group_metric_set_scores s
          cross join lateral group_metric_certification_matching(s.group_exercise_id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c
          where s.group_exercise_id=target.group_exercise_id and s.rules_revision=target.rules_revision
            and s.member_user_id=target.member_user_id and s.session_id=target.session_id and s.set_id=x->>'set_id' and s.counting
            and c.id is not null),'[]'::jsonb),
      'admission_context',encode(extensions.digest(jsonb_build_array(
        x->'source_load_input_mode',x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex'))),'{}'::jsonb)
      into target.source_controls from jsonb_array_elements(admitted_graph->'sets') x;
  end if;
  return jsonb_build_object('actual',notification_ranks_from_graph(target.group_id,target.group_exercise_id,target.rules_revision,null,p_graph),
    'without',notification_ranks_from_graph(target.group_id,target.group_exercise_id,target.rules_revision,target,p_graph),
    'evidence',notification_best_evidence(p_target.member_user_id,p_target.session_id,p_target.group_exercise_id,p_target.rules_revision,p_target.initial_publication),
    'inputs',notification_performance_inputs(p_target.member_user_id,p_target.session_id,p_graph),
    'baseline_scores',baseline,'admission_scores',coalesce(target.admission_scores,'[]'::jsonb),'source_controls',target.source_controls);
end $function$;

-- Notification capture.
CREATE OR REPLACE FUNCTION app_public.notification_capture_comparison_from_graph(p_group uuid, p_exercise uuid, p_revision bigint, p_after boolean, p_graph jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare g jsonb; source record; w notification_workouts; t notification_workout_targets; actual jsonb; without_ranks jsonb; bests jsonb; known boolean; evidence jsonb; inputs jsonb; capture jsonb; probe notification_workout_targets; target_exists boolean; common_actual jsonb;
begin
  g:=p_graph;
  if g is null then return; end if;
  common_actual:=notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g);
  for source in select distinct candidates.member,candidates.session collate "C" as session from (
      select (x->>'member_user_id')::uuid as member,x->>'session_id' as session from jsonb_array_elements(g->'sets') x
        join sessions raw on raw.owner_user_id=(x->>'member_user_id')::uuid and raw.id=x->>'session_id'
        left join notification_workouts nw on nw.member_user_id=raw.owner_user_id and nw.session_id=raw.id
        where (x->>'counting')::boolean and (nw.eligible or (nw.member_user_id is null and (raw.status='active' or
          raw.completed_at>=floor(extract(epoch from (select started_at from notification_workout_epoch))*1000))))
      union all select nw.member_user_id,nw.session_id from notification_workouts nw
        join session_exercises se on se.owner_user_id=nw.member_user_id and se.session_id=nw.session_id
        join exercise_group_links l on l.owner_user_id=se.owner_user_id and l.exercise_definition_id=se.exercise_definition_id
        join group_session_shares sh on sh.member_user_id=nw.member_user_id and sh.session_id=nw.session_id and sh.group_id=p_group
        where nw.eligible and l.deleted_at is null and group_eval_try_uuid(l.group_exercise_id)=p_exercise
          and group_eval_try_uuid(l.group_id)=p_group
          and group_active_role(p_group,nw.member_user_id) is not null
      union all select member_user_id,session_id from notification_workout_targets where group_exercise_id=p_exercise
    ) candidates left join notification_workouts present on present.member_user_id=candidates.member and present.session_id=candidates.session
    where present.member_user_id is null or (present.eligible and (present.completion_at is null or present.completion_at+interval '24 hours'>now()))
    order by candidates.member,candidates.session collate "C" loop
    perform notification_track_workout(source.member,source.session);
    select * into w from notification_workouts where member_user_id=source.member and session_id=source.session for update;
    if not w.eligible then continue; end if;
    select * into t from notification_workout_targets where member_user_id=source.member and session_id=source.session
      and group_exercise_id=p_exercise for update;
    target_exists:=found;
    probe:=t; probe.member_user_id:=source.member; probe.session_id:=source.session;
    probe.group_id:=p_group; probe.group_exercise_id:=p_exercise; probe.rules_revision:=p_revision;
    if p_after and t.rules_revision<>p_revision then probe.baseline_known:=false; end if;
    capture:=notification_target_capture_from_graph(probe,g,p_after);
    if capture is null then raise exception 'notification capture source moved' using errcode='P0001'; end if;
    if capture->'actual' is distinct from common_actual then
      raise exception 'notification capture disclosure moved' using errcode='P0001'; end if;
    actual:=common_actual;
    if not p_after then
      if not target_exists then
        select (published_rules_revision=rules_revision and (not w.cutover_active or (
          not exists(select 1 from group_metric_eval_queue where group_exercise_id=p_exercise) and
          not exists(select 1 from group_eval_queue q where q.group_exercise_id=p_exercise or exists(
            select 1 from group_session_shares sh where sh.group_id=p_group and sh.member_user_id=q.member_user_id
              and sh.session_id=q.session_id))))) or (not w.cutover_active and not exists(select 1 from group_rule_revisions r
          where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null)) into known from group_exercises where id=p_exercise;
        if w.cutover_active and exists(select 1 from jsonb_array_elements(capture->'baseline_scores') b
          where not coalesce((b->>'projection_known')::boolean,false)) then known:=false; end if;
        insert into notification_workout_targets(member_user_id,session_id,group_id,group_exercise_id,rules_revision,
          baseline_known,before_ranks,initial_publication,performance_inputs,best_evidence,baseline_scores,source_controls)
          values(source.member,source.session,p_group,p_exercise,p_revision,coalesce(known,false),
            case when known then actual else '[]'::jsonb end,
            not exists(select 1 from group_rule_revisions r where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null),
            case when w.cutover_active then notification_performance_inputs(source.member,source.session,g) else '{}'::jsonb end,
            case when w.cutover_active then notification_best_evidence(source.member,source.session,p_exercise,p_revision,false) else '[]'::jsonb end,
            capture->'baseline_scores',capture->'source_controls');
      elsif t.rules_revision<>p_revision then
        update notification_workout_targets set initial_publication=not exists(select 1 from group_rule_revisions r
          where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null)
          where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
      else
        update notification_workout_targets set source_controls=capture->'source_controls'
          where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
      end if;
      continue;
    end if;
    if not target_exists then raise exception 'notification baseline unavailable' using errcode='P0001'; end if;
    without_ranks:=capture->'without'; evidence:=capture->'evidence'; inputs:=capture->'inputs';
    if t.evaluated or w.cutover_active then
      -- A change to another set cannot authorize a recompute-created best on this unchanged evidence set.
      select coalesce(jsonb_agg(x),'[]'::jsonb) into evidence from jsonb_array_elements(evidence) x
        where t.best_evidence@>jsonb_build_array(x) or
          t.performance_inputs->>(x->>'set_id') is distinct from inputs->>(x->>'set_id');
    end if;
    select coalesce(jsonb_agg(metric order by metric),'[]'::jsonb) into bests from
      (select distinct x->>'metric' as metric from jsonb_array_elements(evidence) x) metrics;
    if t.final_ranks is distinct from actual or t.without_workout is distinct from without_ranks or t.best_metrics is distinct from bests or not t.evaluated then
      update notification_workouts set generation=generation+1,updated_at=now()
        where member_user_id=source.member and session_id=source.session;
    end if;
    update notification_workout_targets set
      before_ranks=case when not baseline_known or rules_revision<>p_revision then actual else before_ranks end,
      baseline_scores=case when not baseline_known or rules_revision<>p_revision then capture->'baseline_scores' else baseline_scores end,
      admission_scores=capture->'admission_scores',
      source_controls=capture->'source_controls',
      baseline_known=true,rules_revision=p_revision,final_ranks=actual,without_workout=without_ranks,best_metrics=bests,evaluated=true,performance_inputs=inputs,best_evidence=evidence
      where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
  end loop;
  if common_actual is distinct from notification_ranks_from_graph(p_group,p_exercise,p_revision,null,g) then
    raise exception 'notification capture disclosure moved' using errcode='P0001'; end if;
  if p_after then
    insert into notification_comparison_publications(group_exercise_id,source_digest,published_at)
      values(p_exercise,notification_comparison_digest(g),now())
      on conflict(group_exercise_id) do update set source_digest=excluded.source_digest,published_at=excluded.published_at;
    perform notification_kick_once();
  end if;
end $function$;

-- Notification readiness.
CREATE OR REPLACE FUNCTION app_public.notification_workout_ready(p_member uuid, p_session text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare w notification_workouts; target jsonb; t notification_workout_targets; published text; graph jsonb;
begin
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session;
  if not found or not w.eligible or w.confirmed_at is null or w.completion_at is null or w.completion_at+interval '24 hours'<=now()
    or w.completion_at<(select started_at from notification_workout_epoch) or w.completion_at>now()+interval '5 minutes'
    or w.manifest_digest is distinct from notification_manifest_digest(p_member,p_session)
    or w.context_digest is distinct from notification_context_digest(p_member,p_session) then return false; end if;
  if not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='completed' and deleted_at is null) or
    exists(select 1 from group_eval_queue where kind='session' and member_user_id=p_member and session_id=p_session) then return false; end if;
  for target in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    if exists(select 1 from group_metric_eval_queue where group_exercise_id=(target->>'group_exercise_id')::uuid) then return false; end if;
    select t2.* into t from notification_workout_targets t2
      join notification_comparison_publications p using(group_exercise_id)
      join group_exercises ge on ge.id=t2.group_exercise_id
      where t2.member_user_id=p_member and t2.session_id=p_session and t2.group_exercise_id=(target->>'group_exercise_id')::uuid
        and t2.evaluated and t2.baseline_known and t2.rules_revision=ge.rules_revision and ge.published_rules_revision=ge.rules_revision;
    if not found then return false; end if;
    select source_digest into published from notification_comparison_publications where group_exercise_id=t.group_exercise_id;
    graph:=group_metric_eval_source_graph(t.group_id,t.group_exercise_id);
    if not coalesce(t.final_ranks=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,null,graph),false)
      or not coalesce(t.without_workout=notification_ranks_from_graph(t.group_id,t.group_exercise_id,t.rules_revision,t,graph),false)
      or not coalesce(published=notification_comparison_digest(graph),false) then return false; end if;
  end loop;
  return true;
end $function$;

-- Notification baseline scores.
CREATE OR REPLACE FUNCTION app_public.notification_baseline_scores(p_member uuid, p_session text, p_exercise uuid, p_revision bigint, p_graph jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with dimensions as (select m as metric,c as certified from unnest(array['volume','e1rm']) m cross join unnest(array[false,true]) c),
  winners as (
    select d.metric,d.certified,w.value,w.unit,w.achieved_at_ms,w.exercise_order_index,w.set_order_index,w.set_created_at_ms,
      w.set_id,w.exercise_definition_id,w.fingerprint,w.certification_id,w.source_mode_generation,
      w.performance->>'source_load_input_mode' as source_load_input_mode,w.source->>'reading_pin' as reading_pin,
      coalesce((select c.observed_set_pin from group_metric_certifications c where c.id=w.certification_id),
        group_metric_observed_set_pin(p_member,w.performance,w.source->>'set_type')) as observed_set_pin,
      w.fingerprint=group_metric_graph_fingerprint(w.source||w.performance,p_graph->'rules',w.metric,
        w.performance->>'source_load_input_mode') and
        w.source_mode_generation=(w.source->>'source_mode_generation')::bigint as projection_known
    from dimensions d cross join lateral (
      select s.*,c.id as certification_id,r.x as source from group_metric_set_scores s
      join lateral(select x from jsonb_array_elements(p_graph->'sets') x where x->>'member_user_id'=p_member::text and x->>'set_id'=s.set_id) r on true
      join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
      left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
      where s.member_user_id=p_member and s.session_id=p_session and s.group_exercise_id=p_exercise
        and s.rules_revision=p_revision and s.metric=d.metric and s.counting and (not d.certified or c.id is not null)
        and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
        and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
          not group_competition_redacts_exercise(array[ge.group_id],p_member,s.exercise_definition_id))
      order by s.value desc,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id collate "C" limit 1
    ) w
  ) select coalesce(jsonb_agg(to_jsonb(winners) order by metric,certified),'[]'::jsonb) from winners;
$function$;

-- Notification source controls.
CREATE OR REPLACE FUNCTION app_public.notification_source_controls(p_target app_public.notification_workout_targets, p_graph jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  with previous as (select case when coalesce((p_target).baseline_known,true) then coalesce((p_target).source_controls,'{}'::jsonb)
      else '{}'::jsonb end as controls),
  state as (select s.* from group_metric_board_state s where s.group_exercise_id=(p_target).group_exercise_id
    and s.rules_revision=(p_target).rules_revision and s.member_user_id=(p_target).member_user_id),
  member as (select m,gm.joined_at from jsonb_array_elements(p_graph->'members') m
    join group_memberships gm on gm.id=(m->>'membership_id')::uuid where m->>'member_user_id'=(p_target).member_user_id::text),
  sources as (
    select x,old,link_time,member.m,member.joined_at,state.membership_id,state.linked_definition_ids,state.certification_ids,
      previous.controls->(x->>'set_id') as prior
    from jsonb_array_elements(p_graph->'sets') x cross join previous cross join member left join state on true
    left join lateral(select s as old from group_metric_set_scores s where s.group_exercise_id=(p_target).group_exercise_id
      and s.rules_revision=(p_target).rules_revision and s.member_user_id=(p_target).member_user_id
      and s.session_id=(p_target).session_id and s.set_id=x->>'set_id' order by s.metric limit 1) published on true
    left join lateral(select max((l->>'updated_at_ms')::bigint) as link_time from jsonb_array_elements(member.m->'links') l
      where l->>'exercise_definition_id'=x->>'exercise_definition_id') binding on true
    where x->>'member_user_id'=(p_target).member_user_id::text and x->>'session_id'=(p_target).session_id
  ), entries as (
    select x->>'set_id' as set_id,coalesce(prior,jsonb_build_object(
      'context',case when (old).set_id is null then encode(extensions.digest(jsonb_build_array(x->'source_load_input_mode',
          x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex')
        when (old).fingerprint=group_metric_graph_fingerprint(x||(old).performance,p_graph->'rules',(old).metric,
          (old).performance->>'source_load_input_mode') then encode(extensions.digest(jsonb_build_array(
            (old).performance->'source_load_input_mode',to_jsonb((old).source_mode_generation),x->'reading_pin',
            to_jsonb((old).achieved_at_ms))::text,'sha256'),'hex') end,
      'performed_pin',case when (old).set_id is null then x->>'observed_set_pin' else coalesce((
          select c.observed_set_pin from group_metric_certifications c where c.id=any(coalesce(certification_ids,'{}'::uuid[]))
            and c.set_id=x->>'set_id' order by c.certified_at,c.id limit 1),
          group_metric_observed_set_pin((p_target).member_user_id,(old).performance,x->>'set_type')) end,
      'certified_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
        cross join lateral group_metric_certification_matching(s.group_exercise_id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c
        where s.group_exercise_id=(p_target).group_exercise_id and s.rules_revision=(p_target).rules_revision
          and s.member_user_id=(p_target).member_user_id and s.session_id=(p_target).session_id
          and s.set_id=x->>'set_id' and s.counting and c.id is not null
          and s.unit=group_competition_unit(s.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
          and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
            not group_competition_redacts_exercise(array[ge.group_id],s.member_user_id,s.exercise_definition_id))),'[]'::jsonb),
      'counted_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        where s.group_exercise_id=(p_target).group_exercise_id and s.rules_revision=(p_target).rules_revision
          and s.member_user_id=(p_target).member_user_id and s.set_id=x->>'set_id' and s.counting),'[]'::jsonb),
      'counted',coalesce((old).counting,false))) ||
      jsonb_build_object(
        'link_admission_pin',case when not coalesce((old).counting,false) and (x->>'counting')::boolean and not
          ((x->>'exercise_definition_id')=any(coalesce(linked_definition_ids,'{}'::text[]))) and
          (x->>'set_created_at_ms')::bigint<coalesce(link_time,9223372036854775807)
          then to_jsonb(x->>'observed_set_pin') else prior->'link_admission_pin' end,
        'member_admission_pin',case when not coalesce((old).counting,false) and
          membership_id is distinct from (m->>'membership_id')::uuid and
          (x->>'set_created_at_ms')::bigint<floor(extract(epoch from joined_at)*1000)
          then to_jsonb(x->>'observed_set_pin') else prior->'member_admission_pin' end) as control
    from sources
  ) select previous.controls||coalesce(jsonb_object_agg(set_id,control) filter(where set_id is not null),'{}'::jsonb)
    from previous left join entries on true group by previous.controls;
$function$;

-- The map-taking variants, the caches and the evidence helpers.
drop function app_public.group_competition_session_card(uuid,text,jsonb,jsonb);
drop function app_public.group_competition_session_json(uuid[],uuid,text,jsonb);
drop function app_public.group_competition_session_exercises(uuid[],uuid,text,jsonb);
drop function app_public.group_competition_stream_withdrawn(app_public.group_events,jsonb);
drop function app_public.group_competition_records_history_item(app_public.group_events,text,jsonb);
drop function app_public.group_competition_event_json(app_public.group_events,jsonb);
drop function app_public.group_competition_stream_record(app_public.group_events,jsonb);
drop function app_public.group_competition_event_normalized(app_public.group_events,jsonb);
drop function app_public.group_competition_board_rows(uuid,uuid,bigint,text,boolean,jsonb);
drop function app_public.group_cow_stream_item(uuid,bigint,jsonb);
drop function app_public.group_cow_public_result(app_public.group_cows,text[],text,integer,boolean,jsonb);
drop function app_public.group_cow_result_rows(app_public.group_cows,text,jsonb);
drop function app_public.notification_target_capture_from_graph(app_public.notification_workout_targets,jsonb,boolean,jsonb);
drop function app_public.notification_ranks_from_graph(uuid,uuid,bigint,app_public.notification_workout_targets,jsonb,jsonb);
drop function app_public.notification_redaction_map(uuid,uuid,bigint,app_public.notification_workout_targets);
drop function app_public.group_competition_redaction_cache(uuid,uuid[]);
drop function app_public.group_competition_redaction_lookup(jsonb,uuid[],uuid,text);
drop function app_public.group_competition_redactions(uuid,uuid[],text[]);
drop function app_public.group_competition_redaction_key(uuid,text);
drop function app_public.group_cow_redacts_exercise(uuid[],uuid,text);

-- Indexes that only the evidence branches used.
drop index app_public.group_events_exercise_member;
drop index app_public.group_metric_set_scores_member;
drop index app_public.group_metric_certifications_member;
