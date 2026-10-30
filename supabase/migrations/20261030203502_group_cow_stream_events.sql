-- CoW transitions share the durable Stream ledger; existing readers stay closed.
alter table app_public.group_events drop constraint group_events_kind_check,
  add constraint group_events_kind_check check (kind in (
    'session','joined','left','removed','record','record_voided','link','unlink',
    'lead_change','rules_change','shared_exercise','cow')),
  drop constraint group_events_subject_shape,
  add constraint group_events_subject_shape check (kind in ('rules_change','cow') or member_user_id is not null),
  add constraint group_events_cow_shape check (kind <> 'cow' or (
    contract_version=1 and rules_revision is null and group_exercise_id is null
    and session_id is null and set_id is null and membership_id is null
    and metric is null and certified is null and reason is null and related_event_id is null
    and payload is not null and payload ?& array['event','definition','previous','publication_id']
    and payload->>'event' in ('scheduled','updated','cancelled','started','ended','results','unavailable')
    and payload->'definition' ?& array['cow_id','revision']));
create unique index group_events_cow_transition on app_public.group_events
  ((payload->'definition'->>'cow_id'),(payload->>'event'),(payload->'definition'->>'revision')) where kind='cow';

create function app_public.group_cow_stream_definition(p_cow app_public.group_cows) returns jsonb
language sql stable set search_path=app_public,pg_temp as $$
  select (app_public.group_cow_json(p_cow)-'state')||jsonb_build_object('exercise_name',
    coalesce((select name from app_public.group_exercises where id=p_cow.group_exercise_id and group_id=p_cow.group_id),'Exercise unavailable'));
$$;

create function app_public.group_cow_stream_write(p_cow app_public.group_cows,p_event text,
  p_occurred_at timestamptz,p_previous jsonb default null) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  insert into app_public.group_events(group_id,kind,member_user_id,actor_user_id,sort_at_ms,payload)
    values(p_cow.group_id,'cow',null,case when p_event in ('scheduled','updated','cancelled') then auth.uid() end,
      floor(extract(epoch from p_occurred_at)*1000)::bigint,
      jsonb_build_object('event',p_event,'definition',app_public.group_cow_stream_definition(p_cow),
        'previous',p_previous,'publication_id',case when p_event in ('results','unavailable') then p_cow.publication_id end))
    on conflict do nothing;
end $$;

-- Only future committed transitions emit. Existing history/actors are not inferred.
-- Source-only generation updates take none of these branches, preserving sync isolation.
create function app_public.group_cow_stream_capture() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if tg_op='INSERT' then
    perform app_public.group_cow_stream_write(new,'scheduled',new.created_at);
    return null;
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    perform app_public.group_cow_stream_write(new,'cancelled',new.cancelled_at);
  elsif new.cancelled_at is null then
    if (old.group_exercise_id,old.metrics) is distinct from (new.group_exercise_id,new.metrics) then
      perform app_public.group_cow_stream_write(new,'updated',clock_timestamp(),app_public.group_cow_stream_definition(old));
    end if;
    if old.start_high_water is null and new.start_high_water is not null then
      perform app_public.group_cow_stream_write(new,'started',new.starts_at);
    end if;
    if old.end_high_water is null and new.end_high_water is not null then
      perform app_public.group_cow_stream_write(new,'ended',new.ends_at);
    end if;
    if old.finalized_at is null and new.finalized_at is not null then
      perform app_public.group_cow_stream_write(new,case when new.final_outcome='ready' then 'results' else 'unavailable' end,new.finalized_at);
    end if;
  end if;
  return null;
end $$;
create trigger group_cow_stream_capture after insert or update on app_public.group_cows
  for each row execute function app_public.group_cow_stream_capture();

-- Event inserts check the group's FK. Take that row lock before the intake
-- fence, matching management's group-row -> fence order rather than inverting it.
do $locks$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('app_public.group_cow_eval_claim(integer)'::regprocedure);
  anchor:='    if not pg_try_advisory_xact_lock';
  if position(anchor in definition)=0 then raise exception 'CoW claim lock anchor missing'; end if;
  definition:=replace(definition,anchor,'    perform 1 from app_public.groups where id=picked.group_id for key share skip locked;
    if not found then continue; end if;
'||anchor);
  execute definition;
  definition:=pg_get_functiondef('app_public.group_cow_eval_publish(uuid,bigint,uuid,bigint,text,jsonb)'::regprocedure);
  anchor:='  perform pg_advisory_xact_lock(hashtextextended(''group-cow:''||g::text,0));';
  if position(anchor in definition)=0 then raise exception 'CoW publish lock anchor missing'; end if;
  execute replace(definition,anchor,'  perform 1 from app_public.groups where id=g for key share;
'||anchor);
end $locks$;

-- Final figures are projected through the existing current-disclosure reader on
-- every read, never copied into an event or reconstructed from mutable workouts.
create function app_public.group_cow_stream_item(p_event_id uuid,p_sort bigint) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
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
end $$;

-- Opt-in page: leave protocol-4 v2 responses and their cursors unchanged.
do $page$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('app_public.group_competition_stream_page(uuid,jsonb,integer)'::regprocedure);
  definition:=replace(definition,'app_public.group_competition_stream_page(','app_public.group_competition_stream_page_v3(');
  anchor:='''rules_change'', ''session'', ''shared_exercise''';
  if position(anchor in definition)=0 then raise exception 'CoW stream cursor anchor missing'; end if;
  definition:=replace(definition,anchor,anchor||', ''cow''');
  anchor:='e.kind in (''record_voided'', ''link'', ''unlink'')';
  if position(anchor in definition)=0 then raise exception 'CoW stream items anchor missing'; end if;
  definition:=replace(definition,anchor,anchor||'
    union all
    select ''cow'',lpad(e.seq::text,20,''0''),e.sort_at_ms,
      e.member_user_id,null,null,null,e.group_id,e.id
      from app_public.group_events e where e.group_id=any(_scope) and e.kind=''cow''');
  anchor:='case when p.kind = ''shared_exercise'' then';
  if position(anchor in definition)=0 then raise exception 'CoW stream projection anchor missing'; end if;
  definition:=replace(definition,anchor,'case when p.kind = ''cow'' then app_public.group_cow_stream_item(p.event_id,p.sort_at_ms) when p.kind = ''shared_exercise'' then');
  execute definition;
end $page$;

create function app_public.group_competition_stream_v3(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); cursor jsonb; page jsonb; binding jsonb;
begin
  if p_group_id is not null then perform app_public.group_competition_require_member(p_group_id,u); end if;
  perform app_public.group_competition_require_capability();
  binding:=jsonb_build_object('kind','competition_stream_v3','group',p_group_id);
  cursor:=app_public.group_metric_cursor_decode(p_before);
  if cursor is not null and (cursor-'cursor') is distinct from binding then
    raise exception 'VALIDATION: stream cursor scope mismatch' using errcode='P0001';
  end if;
  page:=app_public.group_competition_stream_page_v3(p_group_id,cursor->'cursor',p_limit);
  return jsonb_build_object('contract_version',4,'items',coalesce((
    select jsonb_agg(case when e.id is not null and e.kind='record'
      then i||jsonb_build_object('record',app_public.group_competition_stream_record(e)) else i end order by x.ordinality)
    from jsonb_array_elements(page->'items') with ordinality x(i,ordinality)
    left join app_public.group_events e on i->>'kind'='competition' and e.id::text=i->>'key'),'[]'::jsonb),
    'has_more',page->'has_more','next_cursor',case when (page->>'has_more')::boolean then
      app_public.group_metric_cursor_encode(binding||jsonb_build_object('cursor',page->'next_cursor')) end);
end $$;

revoke all on function app_public.group_cow_stream_definition(app_public.group_cows),
  app_public.group_cow_stream_write(app_public.group_cows,text,timestamptz,jsonb),
  app_public.group_cow_stream_capture(),app_public.group_cow_stream_item(uuid,bigint),
  app_public.group_competition_stream_page_v3(uuid,jsonb,integer),
  app_public.group_competition_stream_v3(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_stream_v3(uuid,text,integer) to anon,authenticated;
