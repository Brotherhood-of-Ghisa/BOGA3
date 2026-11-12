-- group_competition_records_history: a board's records log, newest first.
--
-- All sets: every new personal best on the board's metric (a `record` event
-- listing that board), with the set as performed, the group's previous #1
-- (the stream record's shape) and the member's own previous best on the
-- metric. Certified: the board's lead changes to a new leader (an emptied
-- board is no #1). Both include each rules change
-- and span every rules revision, so a rules edit no longer empties the log;
-- every figure stays as it was scored under its own revision. Voided records
-- are left out, as is protocol-3 history (group_competition_history keeps it).
--
-- A new reader beside group_competition_history: installed builds decode that
-- one against an exact key allowlist, so its shape is unchanged. Disclosure is
-- the stream's own (event, stream record and history display helpers).

create index group_events_records_history on app_public.group_events (group_exercise_id, seq desc)
  where contract_version = 2 and kind in ('record','lead_change','rules_change');

create function app_public.group_competition_records_history_item(p_event app_public.group_events,p_metric text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
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
$$;
revoke all on function app_public.group_competition_records_history_item(app_public.group_events,text)
  from public,anon,authenticated,service_role;

create function app_public.group_competition_records_history(p_group_id uuid,p_group_exercise_id uuid,p_metric text,
  p_certified boolean,p_before text default null,p_limit integer default 50)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
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
        or (p_certified and e.kind='lead_change' and e.certified and e.metric=p_metric
          and jsonb_typeof(e.payload->'leader')='object'))
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
$$;
revoke all on function app_public.group_competition_records_history(uuid,uuid,text,boolean,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_records_history(uuid,uuid,text,boolean,text,integer) to authenticated;
