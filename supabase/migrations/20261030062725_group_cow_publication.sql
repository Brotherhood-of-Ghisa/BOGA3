-- CoW work reuses group-eval; private service graphs never enter app responses.
alter table app_public.group_cows add column published_at timestamptz,
  add column published_generation bigint, add column live_rankings jsonb, add column publication_id uuid;

create table app_public.group_cow_source_refs (
  cow_id uuid not null references app_public.group_cows(id) on delete cascade,
  member_user_id uuid not null, metric text not null, set_id text not null, definition_id text not null,
  primary key(cow_id,member_user_id,metric,set_id,definition_id)
);
create index group_cow_refs_definition on app_public.group_cow_source_refs(member_user_id,definition_id,cow_id);
alter table app_public.group_cow_source_refs enable row level security;
revoke all on app_public.group_cow_source_refs from public,anon,authenticated,service_role;

-- Minimal original identities survive moving/unlinking a counted source.
do $source$
declare definition text:=pg_get_functiondef('app_public.group_cow_source_snapshot(app_public.group_cows,jsonb)'::regprocedure);
begin
  definition:=replace(definition,'select s.owner_user_id as member_user_id,es.id as set_id,s.id as session_id,s.started_at,',
    'select s.owner_user_id as member_user_id,es.id as set_id,s.id as session_id,se.exercise_definition_id,s.started_at,');
  definition:=replace(definition,'''session_id'',session_id,''session_started_at_ms'',started_at,',
    '''session_id'',session_id,''exercise_definition_id'',exercise_definition_id,''session_started_at_ms'',started_at,');
  if position('''exercise_definition_id'',exercise_definition_id' in definition)=0 then raise exception 'CoW source identity patch did not match'; end if;
  execute definition;
end $source$;

-- Legacy receipts lack original definition identity. Preserve their priority and
-- use a private unknown marker rather than guess from today's mutable graph.
update app_public.group_cow_sources set input=input||jsonb_build_object('exercise_definition_id',''),
  input_key=encode(extensions.digest((input||jsonb_build_object('exercise_definition_id',''))::text,'sha256'),'hex')
  where not (input ? 'exercise_definition_id');
do $legacy_retry$
declare definition text:=pg_get_functiondef('app_public.group_cow_capture(uuid)'::regprocedure);
begin
  definition:=replace(definition,'if not found or old.input is distinct from row->''input'' then',
    'if not found or (case when old.input->>''exercise_definition_id''='''' then old.input-''exercise_definition_id'' is distinct from (row->''input'')-''exercise_definition_id'' else old.input is distinct from row->''input'' end) then');
  if position('case when old.input->>''exercise_definition_id''' in definition)=0 then raise exception 'CoW retry patch did not match'; end if;
  execute definition;
end $legacy_retry$;

create function app_public.group_cow_has_uncertainty(p_cow app_public.group_cows) returns boolean
language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  return exists(select 1 from app_public.group_cow_intake_failures f
    where f.failed_at>=p_cow.created_at and f.failed_at<p_cow.ends_at and (
      f.cow_id=p_cow.id or f.cow_id is null and (f.group_id=p_cow.group_id or f.group_id is null and
        (f.member_user_id is null or exists(select 1 from app_public.group_cow_participants p
          where p.cow_id=p_cow.id and p.member_user_id=f.member_user_id)))));
end $$;

create function app_public.group_cow_eval_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare picked record; c app_public.group_cows; ctx jsonb; jobs jsonb:='[]'; mark timestamptz;
begin
  perform app_public.group_cow_reject_agent();
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'VALIDATION: invalid CoW claim limit'; end if;
  for picked in select id,group_id from app_public.group_cows where cancelled_at is null and finalized_at is null
    and starts_at<=clock_timestamp() and available_at<=clock_timestamp()
    and (lease_until is null or lease_until<clock_timestamp()) order by available_at,id limit p_limit loop
    if not pg_try_advisory_xact_lock(hashtextextended('group-cow:'||picked.group_id::text,0)) then continue; end if;
    select * into c from app_public.group_cows where id=picked.id for update skip locked;
    if not found or c.cancelled_at is not null or c.finalized_at is not null or
      c.lease_until>=clock_timestamp() or c.available_at>clock_timestamp() then continue; end if;
    if c.start_high_water is null then
      select context into ctx from app_public.group_cow_contexts where cow_id=c.id and received_at<c.starts_at
        order by received_at desc,id desc limit 1;
      insert into app_public.group_cow_participants(cow_id,member_user_id,membership_id,ended_at)
        select distinct on(member_user_id) c.id,member_user_id,membership_id,ended_at
        from app_public.group_cow_admissions where cow_id=c.id and joined_at<=c.starts_at
          and (ended_at is null or ended_at>c.starts_at) order by member_user_id,joined_at,membership_id;
      update app_public.group_cows set start_context=ctx,
        start_high_water=(select coalesce(max(id),0) from app_public.group_cow_sources where cow_id=c.id and received_at<c.starts_at)
        where id=c.id returning * into c;
    end if;
    update app_public.group_cow_participants p set ended_at=a.ended_at from app_public.group_cow_admissions a
      where p.cow_id=c.id and a.cow_id=c.id and a.membership_id=p.membership_id and p.ended_at is null and a.ended_at is not null;
    select min(received_at) into mark from app_public.group_cow_contexts where cow_id=c.id and received_at>=c.starts_at
      and received_at<least(c.ends_at,clock_timestamp()) and context is distinct from c.start_context;
    update app_public.group_cows set context_changed_at=least(context_changed_at,mark),
      end_high_water=case when clock_timestamp()>=ends_at then coalesce(end_high_water,
        (select coalesce(max(id),0) from app_public.group_cow_sources where cow_id=c.id)) else end_high_water end,
      claim_id=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
      where id=c.id returning * into c;
    jobs:=jobs||jsonb_build_array(jsonb_build_object('cow_id',c.id,'generation',c.generation,'claim_id',c.claim_id));
  end loop;
  return jsonb_build_object('jobs',jobs);
end $$;

create function app_public.group_cow_eval_graph(p_cow app_public.group_cows,p_before_us bigint) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare graph jsonb; people jsonb; versions jsonb; before_at timestamptz:=timestamptz 'epoch'+(p_before_us||' microseconds')::interval;
begin
  perform app_public.group_cow_reject_agent();
  select coalesce(jsonb_agg(jsonb_build_object('memberId',member_user_id,'endedAtUs',case when ended_at<p_cow.ends_at
    then app_public.group_cow_us(ended_at) end) order by member_user_id),'[]') into people
    from app_public.group_cow_participants where cow_id=p_cow.id;
  with retained as materialized (
    select s.* from app_public.group_cow_sources s join app_public.group_cow_participants p
      on p.cow_id=s.cow_id and p.member_user_id=s.member_user_id
    where s.cow_id=p_cow.id and (p_cow.end_high_water is null or s.id<=p_cow.end_high_water)
      and s.received_at<least(before_at,p_cow.ends_at,coalesce(p.ended_at,p_cow.ends_at))
  ), baseline as (
    select distinct on(member_user_id,set_id) * from retained where received_at<p_cow.starts_at and id<=p_cow.start_high_water
      order by member_user_id,set_id,received_at desc,id desc
  ), selected as (
    select * from baseline union all select * from retained where received_at>=p_cow.starts_at
  ) select coalesce(jsonb_agg(jsonb_build_object('memberId',member_user_id,'setId',set_id,'version',id,
    'receivedAtUs',app_public.group_cow_us(received_at),'contextKey',(input->'context')::text,'input',input)
    order by received_at,id),'[]') into versions from selected;
  graph:=jsonb_build_object('cowId',p_cow.id,'groupId',p_cow.group_id,'revision',p_cow.revision,
    'window',jsonb_build_object('startUs',app_public.group_cow_us(p_cow.starts_at),'endUs',app_public.group_cow_us(p_cow.ends_at),
      'readBeforeUs',p_before_us,'context',case when (p_cow.start_context->>'available')::boolean then
        jsonb_build_object('key',p_cow.start_context::text,'normalized',(p_cow.start_context->>'normalized')::boolean) end,
      'contextChangedAtUs',app_public.group_cow_us(p_cow.context_changed_at)),
    'context',p_cow.start_context,'metrics',p_cow.metrics,'participants',people,'sources',versions);
  return graph||jsonb_build_object('sourceToken',encode(extensions.digest(graph::text,'sha256'),'hex'));
end $$;

create function app_public.group_cow_eval_prepare(p_cow_id uuid,p_generation bigint,p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare c app_public.group_cows; g uuid; before_us bigint;
begin
  perform app_public.group_cow_reject_agent();
  select group_id into g from app_public.group_cows where id=p_cow_id;
  if not found then return jsonb_build_object('prepared',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('group-cow:'||g::text,0));
  select * into c from app_public.group_cows where id=p_cow_id for update;
  if not found or c.claim_id is distinct from p_claim_id or c.lease_until<clock_timestamp() or c.finalized_at is not null
    or c.cancelled_at is not null then return jsonb_build_object('prepared',false); end if;
  if c.end_high_water is null and c.generation<>p_generation then
    update app_public.group_cows set claim_id=null,lease_until=null where id=c.id;
    return jsonb_build_object('prepared',false);
  end if;
  if app_public.group_cow_has_uncertainty(c) then raise exception 'CoW intake is uncertain' using errcode='COW01'; end if;
  before_us:=app_public.group_cow_us(least(clock_timestamp(),c.ends_at));
  return jsonb_build_object('prepared',true,'graph',app_public.group_cow_eval_graph(c,before_us));
end $$;

create function app_public.group_cow_validate_publication(p_cow app_public.group_cows,p_result jsonb,p_before_us bigint) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare ranking jsonb; entry jsonb; source jsonb; member_id uuid; place integer; value double precision; unit text; seen uuid[]; metrics text[]:='{}';
begin
  perform app_public.group_cow_reject_agent();
  if p_result is null or jsonb_typeof(p_result)<>'object' or not (p_result ?& array['state','rankings']) or p_result-array['state','rankings']<>'{}'::jsonb or
    not coalesce(p_result->>'state' in ('ready','unavailable'),false) or jsonb_typeof(p_result->'rankings') is distinct from 'array' then raise exception 'Invalid CoW evaluation'; end if;
  if not coalesce((p_cow.start_context->>'available')::boolean,false) or
    app_public.group_cow_us(p_cow.context_changed_at)<p_before_us then
    if p_result<>jsonb_build_object('state','unavailable','rankings','[]'::jsonb) then raise exception 'Invalid unavailable CoW evaluation'; end if;
    return;
  end if;
  if p_result->>'state'<>'ready' then raise exception 'Invalid CoW evaluation state'; end if;
  for ranking in select * from jsonb_array_elements(p_result->'rankings') loop
    if jsonb_typeof(ranking) is distinct from 'object' or not (ranking ?& array['metric','unit','entries','unavailableMemberIds']) or ranking-array['metric','unit','entries','unavailableMemberIds']<>'{}'::jsonb or
      not coalesce(ranking->>'metric'=any(p_cow.metrics),false) or ranking->>'metric'=any(metrics) or
      jsonb_typeof(ranking->'entries') is distinct from 'array' or jsonb_typeof(ranking->'unavailableMemberIds') is distinct from 'array' then raise exception 'Invalid CoW ranking'; end if;
    metrics:=array_append(metrics,ranking->>'metric');
    unit:=case when ranking->>'metric'='improvement' then 'percent' else app_public.group_competition_unit(ranking->>'metric',
      (p_cow.start_context->>'normalized')::boolean) end;
    if ranking->>'unit' is distinct from unit then raise exception 'Invalid CoW score unit'; end if;
    seen:='{}'; place:=0;
    for entry in select * from jsonb_array_elements(ranking->'entries') loop
      place:=place+1; member_id:=(entry->>'memberId')::uuid; value:=(entry->>'value')::double precision;
      if jsonb_typeof(entry) is distinct from 'object' or not (entry ?& array['memberId','value','receivedAtUs','rank','sources']) or entry-array['memberId','value','receivedAtUs','rank','sources']<>'{}'::jsonb or
        jsonb_typeof(entry->'value') is distinct from 'number' or jsonb_typeof(entry->'receivedAtUs') is distinct from 'number' or member_id is null or value is null or value in ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) or
        ranking->>'metric'<>'improvement' and value<=0 or (entry->>'rank')::integer is distinct from place or member_id=any(seen) or
        not exists(select 1 from app_public.group_cow_participants where cow_id=p_cow.id and member_user_id=member_id) or
        (entry->>'receivedAtUs')::bigint<app_public.group_cow_us(p_cow.starts_at) or (entry->>'receivedAtUs')::bigint>=p_before_us or
        jsonb_typeof(entry->'sources') is distinct from 'array' or jsonb_array_length(entry->'sources')=0 then raise exception 'Invalid CoW entry'; end if;
      seen:=array_append(seen,member_id);
      for source in select * from jsonb_array_elements(entry->'sources') loop
        if jsonb_typeof(source) is distinct from 'object' or not (source ?& array['set_id','definition_id']) or source-array['set_id','definition_id']<>'{}'::jsonb or not exists(
          select 1 from app_public.group_cow_sources s where s.cow_id=p_cow.id and s.member_user_id=member_id
            and s.set_id=source->>'set_id' and coalesce(s.input->>'exercise_definition_id','')=source->>'definition_id') then raise exception 'Invalid CoW provenance'; end if;
      end loop;
    end loop;
    for entry in select * from jsonb_array_elements(ranking->'unavailableMemberIds') loop
      member_id:=(entry#>>'{}')::uuid;
      if member_id=any(seen) or not exists(select 1 from app_public.group_cow_participants where cow_id=p_cow.id and member_user_id=member_id)
        then raise exception 'Invalid unavailable CoW member'; end if;
      seen:=array_append(seen,member_id);
    end loop;
  end loop;
  if cardinality(metrics)<>cardinality(p_cow.metrics) then raise exception 'Incomplete CoW rankings'; end if;
end $$;

create function app_public.group_cow_store_rankings(p_cow uuid,p_rankings jsonb) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare ranking jsonb; entry jsonb; entries jsonb; rankings jsonb:='[]';
begin
  perform app_public.group_cow_reject_agent();
  for ranking in select * from jsonb_array_elements(p_rankings) loop
    entries:='[]';
    for entry in select * from jsonb_array_elements(ranking->'entries') loop
      insert into app_public.group_cow_source_refs(cow_id,member_user_id,metric,set_id,definition_id)
        select p_cow,(entry->>'memberId')::uuid,ranking->>'metric',source->>'set_id',source->>'definition_id'
          from jsonb_array_elements(entry->'sources') source on conflict do nothing;
      entries:=entries||jsonb_build_array(entry-'sources');
    end loop;
    rankings:=rankings||jsonb_build_array(ranking||jsonb_build_object('entries',entries));
  end loop;
  return rankings;
end $$;

create function app_public.group_cow_eval_publish(p_cow_id uuid,p_generation bigint,p_claim_id uuid,
  p_before_us bigint,p_source_token text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare c app_public.group_cows; g uuid; graph jsonb; rankings jsonb;
begin
  perform app_public.group_cow_reject_agent();
  select group_id into g from app_public.group_cows where id=p_cow_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('group-cow:'||g::text,0));
  select * into c from app_public.group_cows where id=p_cow_id for update;
  if not found or c.finalized_at is not null or c.cancelled_at is not null or c.claim_id is distinct from p_claim_id or
    c.lease_until<clock_timestamp() then return jsonb_build_object('completed',false); end if;
  if c.end_high_water is null and c.generation<>p_generation then
    update app_public.group_cows set claim_id=null,lease_until=null where id=c.id;
    return jsonb_build_object('completed',false);
  end if;
  if p_before_us is null or p_before_us<app_public.group_cow_us(c.starts_at) or p_before_us>app_public.group_cow_us(least(clock_timestamp(),c.ends_at))
    or c.end_high_water is not null and p_before_us<>app_public.group_cow_us(c.ends_at) then raise exception 'Invalid CoW publication fence'; end if;
  if app_public.group_cow_has_uncertainty(c) then raise exception 'CoW intake is uncertain' using errcode='COW01'; end if;
  graph:=app_public.group_cow_eval_graph(c,p_before_us);
  if graph->>'sourceToken' is distinct from p_source_token then
    update app_public.group_cows set claim_id=null,lease_until=null,available_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('completed',false);
  end if;
  perform app_public.group_cow_validate_publication(c,p_result,p_before_us);
  rankings:=app_public.group_cow_store_rankings(c.id,p_result->'rankings');
  update app_public.group_cows set published_at=clock_timestamp(),published_generation=generation,publication_id=p_claim_id,
    live_rankings=jsonb_build_object('state',p_result->'state','rankings',rankings),attempts=0,last_error=null,claim_id=null,lease_until=null,available_at=ends_at,
    finalized_at=case when end_high_water is not null then clock_timestamp() end,
    final_outcome=case when end_high_water is not null then p_result->>'state' end,
    final_rankings=case when end_high_water is not null then rankings end where id=c.id;
  return jsonb_build_object('completed',true);
end $$;

create function app_public.group_cow_eval_fail(p_cow_id uuid,p_generation bigint,p_claim_id uuid,p_sqlstate text) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  update app_public.group_cows set attempts=attempts+1,last_error=case when p_sqlstate~'^[A-Z0-9]{5}$' then p_sqlstate else 'EVALX' end,
    available_at=clock_timestamp()+least(300,power(2,least(attempts+1,8))) * interval '1 second',claim_id=null,lease_until=null
    where id=p_cow_id and claim_id=p_claim_id and finalized_at is null;
end $$;

create function app_public.group_cow_preserve_final() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  if old.finalized_at is not null and new is distinct from old
    then raise exception 'A final CoW is immutable'; end if;
  return new;
end $$;
create trigger group_cow_preserve_final before update on app_public.group_cows for each row execute function app_public.group_cow_preserve_final();

create function app_public.group_cow_kick() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  if new.cancelled_at is null and new.finalized_at is null and new.starts_at<=clock_timestamp()
    and new.available_at<=clock_timestamp() and (tg_op='INSERT' or new.generation<>old.generation) then
    perform app_public.group_eval_kick_once(new.created_by);
  end if;
  return null;
end $$;
create trigger zz_group_cow_kick after insert or update on app_public.group_cows for each row execute function app_public.group_cow_kick();

create or replace function app_public.group_eval_sweep() returns boolean
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if not exists(select 1 from app_public.group_cows where cancelled_at is null and finalized_at is null
    and starts_at<=now() and available_at<=now() and (lease_until is null or lease_until<now()))
    and not exists(select 1 from app_public.group_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_metric_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_eval_rules_state s where
      (select min(f.rules_version) from app_public.group_set_facts f)<s.rules_version
      and exists(select 1 from app_public.group_eval_rules_stale(s.rules_version,1))) then return false; end if;
  perform app_public.group_eval_kick('sweep'); return true;
end $$;

do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname in ('group_cow_has_uncertainty','group_cow_eval_claim','group_cow_eval_graph',
      'group_cow_eval_prepare','group_cow_validate_publication','group_cow_store_rankings','group_cow_eval_publish','group_cow_eval_fail','group_cow_preserve_final','group_cow_kick') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('group_cow_eval_claim','group_cow_eval_prepare','group_cow_eval_publish','group_cow_eval_fail') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end $permissions$;
