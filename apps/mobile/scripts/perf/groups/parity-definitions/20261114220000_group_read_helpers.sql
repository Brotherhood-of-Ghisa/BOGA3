CREATE OR REPLACE FUNCTION app_public.group_competition_board(p_group_id uuid, p_group_exercise_id uuid, p_metric text, p_certified boolean DEFAULT true, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _ge app_public.group_exercises;
  _rules jsonb; _state text; _cursor jsonb; _after integer:=0; _entries jsonb; _me jsonb; _count integer; _last integer; _next text;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
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
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_podiums(p_group_id uuid, p_certified boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _rows jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  if p_certified is null then raise exception 'VALIDATION: scope is required' using errcode='P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('exercise',app_public.group_competition_exercise_json(ge),
    'board',app_public.group_competition_board(p_group_id,ge.id,ge.default_metric,p_certified,3,null)) order by ge.name collate "C",ge.id),'[]') into _rows
    from app_public.group_exercises ge where ge.group_id=p_group_id and ge.archived_at is null;
  return jsonb_build_object('contract_version',4,'certified',p_certified,'podiums',_rows);
end;
$function$

;

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
    order by e.seq desc limit p_limit+1)
  select coalesce(jsonb_agg(app_public.group_competition_records_history_item(e,p_metric) order by p.seq desc)
      filter(where p.n<=p_limit),'[]'::jsonb),
    count(*)>p_limit,min(p.seq) filter(where p.n<=p_limit) into _rows,_more,_last
    from page p join app_public.group_events e on e.id=p.id;
  return jsonb_build_object('contract_version',4,'exercise',app_public.group_competition_exercise_json(_ge),
    'metric',p_metric,'certified',p_certified,'items',_rows,
    'next_cursor',case when _more then app_public.group_metric_cursor_encode(_binding||jsonb_build_object('seq',_last)) end);
end;
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_detail(p_group_id uuid, p_member_user_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _session jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  if not exists(select 1 from app_public.group_session_shares sh where sh.group_id=p_group_id
    and sh.member_user_id=p_member_user_id and sh.session_id=p_session_id) then
    raise exception 'NOT_FOUND: session not found' using errcode='P0001';
  end if;
  _session:=app_public.group_competition_session_json(array[p_group_id],p_member_user_id,p_session_id);
  if _session is null then raise exception 'NOT_FOUND: session not found' using errcode='P0001'; end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'session',_session);
end;
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_records(p_group_id uuid, p_member_user_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  -- The session view's own existence check: an unshared or deleted session
  -- reads exactly like group_competition_session_detail's.
  if not exists(select 1 from app_public.group_session_shares sh where sh.group_id=p_group_id
    and sh.member_user_id=p_member_user_id and sh.session_id=p_session_id)
    or not exists(select 1 from app_public.sessions s where s.owner_user_id=p_member_user_id
      and s.id=p_session_id and s.deleted_at is null) then
    raise exception 'NOT_FOUND: session not found' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'event',jsonb_set(x.event,'{values}',coalesce((
        select jsonb_agg(v.value order by v.ordinality)
          from jsonb_array_elements(x.event->'values') with ordinality v(value,ordinality)
         where v.value->>'role'<>'record'
            or v.value->>'metric' in (select b->>'metric' from jsonb_array_elements(r.record_json->'boards') b)),'[]'::jsonb)),
      'boards',app_public.group_competition_session_record_boards(e,r.record_json->'boards'))
    order by e.seq),'[]'::jsonb) into _records
    from app_public.group_week_session_records(p_group_id,p_member_user_id,p_session_id) r
    join app_public.group_events e on e.id=(r.record_json->>'key')::uuid and e.group_id=p_group_id
    cross join lateral (select app_public.group_competition_event_json(e) as event) x;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'member_user_id',p_member_user_id,
    'session_id',p_session_id,'records',_records);
end;
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_json(p_groups uuid[], p_member uuid, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select jsonb_build_object('member',app_public.group_member_ref_json(p_member),'session_id',s.id,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member and g.id=s.gym_id and g.deleted_at is null),
    'status',s.status,'started_at_ms',s.started_at,'completed_at_ms',s.completed_at,'duration_sec',s.duration_sec,
    'exercises',app_public.group_competition_session_exercises(p_groups,p_member,p_session))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session and s.deleted_at is null;
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_session_exercises(p_groups uuid[], p_member uuid, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
    'visibility',case when d.normalized then 'normalized' else 'ordinary' end,
    'load_input_mode',ed.load_input_mode,'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object('set_id',es.id,'order_index',es.order_index,
      'reps_value',es.reps_value,'set_type',es.set_type,'performance_status',es.performance_status)
      ||case when not d.normalized then jsonb_build_object('weight_value',es.weight_value)
        when app_public.group_competition_set_display_enabled() then
          jsonb_build_object('normalized_metrics',app_public.group_competition_set_display(p_groups,p_member,es.id))
        else '{}'::jsonb end
      order by es.order_index,es.id collate "C") from app_public.exercise_sets es
      where es.owner_user_id=p_member and es.session_exercise_id=se.id and es.deleted_at is null),'[]'))
    order by se.order_index,se.id collate "C"),'[]')
  from app_public.session_exercises se left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id and ed.id=se.exercise_definition_id
  cross join lateral (select app_public.group_competition_redacts_exercise(p_groups,p_member,
    case when ed.id is not null then se.exercise_definition_id end) as normalized) d
  where se.owner_user_id=p_member and se.session_id=p_session and se.deleted_at is null;
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_event_json(p_event app_public.group_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
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
    'values',coalesce((select jsonb_agg(app_public.group_competition_history_display(v,d.normalized,role,metric,p_event) order by role,metric)
      filter(where jsonb_typeof(v)='object') from values_to_project),'[]'::jsonb),
    'record_context',case when p_event.kind='record' then app_public.group_competition_record_context(p_event) end)
  from disclosure d;
$function$

;

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
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_stream_record(p_event app_public.group_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION app_public.group_competition_stream_page(p_group_id uuid DEFAULT NULL::uuid, p_before jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _uid      uuid := app_public.group_require_app_user();
  _scope    uuid[];
  _limit    integer;
  _c_sort   bigint;
  _c_kind   text;
  _c_key    text;
  _items    jsonb;
  _has_more boolean;
  _last     jsonb; _group uuid;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[])
      into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid
       and m.ended_at is null;
  end if;

  for _group in select unnest(_scope) order by 1 loop
    perform app_public.group_competition_require_member(_group,_uid);
  end loop;
  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50'
      using errcode = 'P0001';
  end if;

  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'rules_change', 'session', 'shared_exercise')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor'
        using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  with session_rows as (
    -- One card per (member, session) in scope, deduplicated across groups.
    select e.member_user_id,
           e.session_id,
           s.started_at,
           jsonb_agg(
             jsonb_build_object('group_id', g.id, 'name', g.name)
             order by lower(g.name), g.name, g.id
           ) as groups
      from app_public.group_events e
      join app_public.groups g on g.id = e.group_id and g.deleted_at is null
      join app_public.sessions s
        on s.owner_user_id = e.member_user_id
       and s.id = e.session_id
       and s.deleted_at is null
     where e.group_id = any(_scope)
       and e.kind = 'session'
     group by e.member_user_id, e.session_id, s.started_at
  ),
  items as (
    select 'session'::text as kind,
           r.member_user_id::text || ':' || r.session_id as key,
           r.started_at as sort_at_ms,
           r.member_user_id as user_id,
           r.session_id,
           r.groups,
           null::text as event,
           null::uuid as group_id,
           null::uuid as event_id
      from session_rows r
    union all
    select 'membership',
           e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end,
           e.sort_at_ms,
           e.member_user_id, null, null, e.kind, e.group_id, null
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('joined', 'left', 'removed')
    union all
    select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms),
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
      left join app_public.sessions s
        on s.owner_user_id = e.member_user_id and s.id = e.session_id
     where e.group_id = any(_scope)
       and e.kind = 'record'
    union all
    select case when e.kind = 'record_voided' then 'record_voided' else 'link' end,
           e.id::text, e.sort_at_ms,
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('record_voided', 'link', 'unlink')
     union all
     select 'shared_exercise', e.id::text, e.sort_at_ms,
            e.member_user_id, null, null, null, e.group_id, e.id
       from app_public.group_events e
       join app_public.group_shared_exercises se
         on se.id = (e.payload->>'shared_exercise_id')::uuid
        and se.deleted_at is null
      where e.group_id = any(_scope)
        and e.kind = 'shared_exercise'
  ),
  page as (
    select i.*,
           row_number() over (
             order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
           ) as rn
      from items i
     where _c_sort is null
        or i.sort_at_ms < _c_sort
        or (i.sort_at_ms = _c_sort
            and (i.kind collate "C" > _c_kind
                 or (i.kind = _c_kind and i.key collate "C" < _c_key)))
     order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
     limit _limit + 1
  )
  select coalesce(
           jsonb_agg(
             case
               when p.kind = 'session' then
                 app_public.group_competition_session_card(p.user_id, p.session_id, p.groups)
               when p.kind = 'membership' then
                 jsonb_build_object(
                   'kind', 'membership',
                   'key', p.key,
                   'sort_at_ms', p.sort_at_ms,
                   'event', p.event,
                   'group', (
                     select jsonb_build_object('group_id', g.id, 'name', g.name)
                       from app_public.groups g
                      where g.id = p.group_id
                   ),
                   'member', app_public.group_member_ref_json(p.user_id)
                 )
               else
                 case when p.kind = 'shared_exercise' then app_public.group_shared_exercise_stream_card(p.event_id, p.sort_at_ms) else app_public.group_competition_stream_event(p.event_id,p.sort_at_ms) end
             end
             order by p.rn
           ) filter (where p.rn <= _limit),
           '[]'::jsonb
         ),
         count(*) > _limit,
         (array_agg(
            jsonb_build_object('sort_at_ms', p.sort_at_ms, 'kind', p.kind, 'key', p.key)
            order by p.rn desc
          ) filter (where p.rn <= _limit))[1]
    into _items, _has_more, _last
    from page p;

  return jsonb_build_object(
    'contract_version',4,'items', _items,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_stream_page_v3(p_group_id uuid DEFAULT NULL::uuid, p_before jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare
  _uid      uuid := app_public.group_require_app_user();
  _scope    uuid[];
  _limit    integer;
  _c_sort   bigint;
  _c_kind   text;
  _c_key    text;
  _items    jsonb;
  _has_more boolean;
  _last     jsonb; _group uuid;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[])
      into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid
       and m.ended_at is null;
  end if;

  for _group in select unnest(_scope) order by 1 loop
    perform app_public.group_competition_require_member(_group,_uid);
  end loop;
  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50'
      using errcode = 'P0001';
  end if;

  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('link', 'membership', 'record', 'record_voided', 'rules_change', 'session', 'shared_exercise', 'cow')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor'
        using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  with session_rows as (
    -- One card per (member, session) in scope, deduplicated across groups.
    select e.member_user_id,
           e.session_id,
           s.started_at,
           jsonb_agg(
             jsonb_build_object('group_id', g.id, 'name', g.name)
             order by lower(g.name), g.name, g.id
           ) as groups
      from app_public.group_events e
      join app_public.groups g on g.id = e.group_id and g.deleted_at is null
      join app_public.sessions s
        on s.owner_user_id = e.member_user_id
       and s.id = e.session_id
       and s.deleted_at is null
     where e.group_id = any(_scope)
       and e.kind = 'session'
     group by e.member_user_id, e.session_id, s.started_at
  ),
  items as (
    select 'session'::text as kind,
           r.member_user_id::text || ':' || r.session_id as key,
           r.started_at as sort_at_ms,
           r.member_user_id as user_id,
           r.session_id,
           r.groups,
           null::text as event,
           null::uuid as group_id,
           null::uuid as event_id
      from session_rows r
    union all
    select 'membership',
           e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end,
           e.sort_at_ms,
           e.member_user_id, null, null, e.kind, e.group_id, null
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('joined', 'left', 'removed')
    union all
    select 'record', e.id::text, coalesce(s.started_at, e.sort_at_ms),
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
      left join app_public.sessions s
        on s.owner_user_id = e.member_user_id and s.id = e.session_id
     where e.group_id = any(_scope)
       and e.kind = 'record'
    union all
    select case when e.kind = 'record_voided' then 'record_voided' else 'link' end,
           e.id::text, e.sort_at_ms,
           e.member_user_id, null, null, null, e.group_id, e.id
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('record_voided', 'link', 'unlink')
    union all
    select 'cow',lpad(e.seq::text,20,'0'),e.sort_at_ms,
      e.member_user_id,null,null,null,e.group_id,e.id
      from app_public.group_events e where e.group_id=any(_scope) and e.kind='cow'
     union all
     select 'shared_exercise', e.id::text, e.sort_at_ms,
            e.member_user_id, null, null, null, e.group_id, e.id
       from app_public.group_events e
       join app_public.group_shared_exercises se
         on se.id = (e.payload->>'shared_exercise_id')::uuid
        and se.deleted_at is null
      where e.group_id = any(_scope)
        and e.kind = 'shared_exercise'
  ),
  page as (
    select i.*,
           row_number() over (
             order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
           ) as rn
      from items i
     where _c_sort is null
        or i.sort_at_ms < _c_sort
        or (i.sort_at_ms = _c_sort
            and (i.kind collate "C" > _c_kind
                 or (i.kind = _c_kind and i.key collate "C" < _c_key)))
     order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
     limit _limit + 1
  )
  select coalesce(
           jsonb_agg(
             case
               when p.kind = 'session' then
                 app_public.group_competition_session_card(p.user_id, p.session_id, p.groups)
               when p.kind = 'membership' then
                 jsonb_build_object(
                   'kind', 'membership',
                   'key', p.key,
                   'sort_at_ms', p.sort_at_ms,
                   'event', p.event,
                   'group', (
                     select jsonb_build_object('group_id', g.id, 'name', g.name)
                       from app_public.groups g
                      where g.id = p.group_id
                   ),
                   'member', app_public.group_member_ref_json(p.user_id)
                 )
               else
                 case when p.kind = 'cow' then app_public.group_cow_stream_item(p.event_id,p.sort_at_ms) when p.kind = 'shared_exercise' then app_public.group_shared_exercise_stream_card(p.event_id, p.sort_at_ms) else app_public.group_competition_stream_event(p.event_id,p.sort_at_ms) end
             end
             order by p.rn
           ) filter (where p.rn <= _limit),
           '[]'::jsonb
         ),
         count(*) > _limit,
         (array_agg(
            jsonb_build_object('sort_at_ms', p.sort_at_ms, 'kind', p.kind, 'key', p.key)
            order by p.rn desc
          ) filter (where p.rn <= _limit))[1]
    into _items, _has_more, _last
    from page p;

  return jsonb_build_object(
    'contract_version',4,'items', _items,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_public.group_competition_stream(p_group_id uuid DEFAULT NULL::uuid, p_before text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare _uid uuid:=app_public.group_require_app_user(); _cursor jsonb; _page jsonb; _binding jsonb;
begin
  if p_group_id is not null then perform app_public.group_competition_require_member(p_group_id,_uid); end if;
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
$function$;

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
  ), disclosure as (
    select m.*,not (p_cow.start_context->>'normalized')::boolean and exists(
      select 1 from app_public.group_cow_source_refs refs where refs.cow_id=p_cow.id
        and refs.member_user_id=m.member_user_id and refs.metric=p_metric and
        (app_public.group_competition_redacts_exercise(array[p_cow.group_id],m.member_user_id,nullif(refs.definition_id,''))
          or exists(select 1 from app_public.exercise_sets es join app_public.session_exercises se
            on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
            where es.owner_user_id=m.member_user_id and es.id=refs.set_id
              and app_public.group_competition_redacts_exercise(array[p_cow.group_id],m.member_user_id,se.exercise_definition_id)))) as suppressed
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
