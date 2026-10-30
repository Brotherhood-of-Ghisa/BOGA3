-- Retained source identities extend the existing current-disclosure decision.
create function app_public.group_cow_redacts_exercise(p_groups uuid[],p_member uuid,p_definition text) returns boolean
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  return exists(select 1 from app_public.group_cow_source_refs r join app_public.group_cows c on c.id=r.cow_id
    join app_public.group_exercises ge on ge.id=c.group_exercise_id and ge.group_id=c.group_id
    join app_public.groups g on g.id=c.group_id where c.group_id=any(p_groups) and r.member_user_id=p_member
      and g.deleted_at is null and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 and
      (p_definition is null or r.definition_id='' or r.definition_id=p_definition or exists(select 1 from app_public.exercise_sets es
        join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
        where es.owner_user_id=p_member and es.id=r.set_id and se.exercise_definition_id=p_definition)));
end $$;
do $disclosure$
declare definition text:=pg_get_functiondef('app_public.group_competition_redacts_exercise(uuid[],uuid,text)'::regprocedure);
begin
  definition:=replace(definition,'  select exists(select 1 from app_public.group_exercises',
    '  select app_public.group_cow_redacts_exercise(p_groups,p_member,p_definition) or exists(select 1 from app_public.group_exercises');
  if position('group_cow_redacts_exercise(' in definition)=0 then raise exception 'CoW disclosure patch did not match'; end if;
  execute definition;
end $disclosure$;

create function app_public.group_cow_public_state(p_cow app_public.group_cows) returns text
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  if p_cow.finalized_at is not null then return p_cow.final_outcome; end if;
  if p_cow.starts_at>clock_timestamp() or p_cow.ends_at<=clock_timestamp() or p_cow.published_generation is distinct from p_cow.generation then return 'pending'; end if;
  return coalesce(p_cow.live_rankings->>'state','pending');
end $$;

create function app_public.group_cow_result_rows(p_cow app_public.group_cows,p_metric text)
returns table(ordinal integer,member_id uuid,row_json jsonb)
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
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
    from disclosure m;
end $$;

create function app_public.group_cow_public_result(p_cow app_public.group_cows,p_metrics text[],p_before text,p_limit integer,p_top boolean default false)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
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
    select count(*)::integer into total from app_public.group_cow_result_rows(p_cow,metric);
    select coalesce(jsonb_agg(r.row_json order by coalesce(r.ordinal,2147483647),r.member_id),'[]'),count(*)>p_limit into rows,more
      from (select * from app_public.group_cow_result_rows(p_cow,metric) r
        where (not p_top or r.ordinal<=3) and (coalesce(r.ordinal,2147483647),r.member_id)>(edge,edge_id)
        order by coalesce(r.ordinal,2147483647),r.member_id limit p_limit+1) r;
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
end $$;

create function app_public.group_cow_results(p_group_id uuid,p_cow_id uuid,p_metric text,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); c app_public.group_cows;
begin
  perform app_public.group_cow_reject_agent();
  perform app_public.group_competition_require_member(p_group_id,u);
  select * into c from app_public.group_cows where id=p_cow_id and group_id=p_group_id;
  if not found then raise exception 'NOT_FOUND: CoW not found' using errcode='P0001'; end if;
  if p_metric is null or not(p_metric=any(c.metrics)) or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'VALIDATION: invalid CoW metric or page size' using errcode='P0001'; end if;
  return app_public.group_cow_public_result(c,array[p_metric],p_before,p_limit);
end $$;

create function app_public.group_cow_summary(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); c app_public.group_cows; g app_public.groups;
  observed timestamptz; deadline timestamptz; week date; selection text:='none'; result jsonb; upcoming timestamptz;
begin
  perform app_public.group_cow_reject_agent();
  perform app_public.group_competition_require_member(p_group_id,u);
  select * into strict g from app_public.groups where id=p_group_id;
  observed:=clock_timestamp();
  if g.cow_time_zone is not null then
    week:=app_public.group_cow_week(g.cow_time_zone,observed);
    deadline:=upper(app_public.group_cow_bounds(g.cow_time_zone,week));
  else deadline:=observed; end if;
  -- Published UTC windows survive later group-calendar changes.
  select * into c from app_public.group_cows where group_id=p_group_id and cancelled_at is null
    and starts_at<=observed and ends_at>observed order by starts_at desc,id desc limit 1;
  if found then
    selection:='current'; deadline:=c.ends_at;
  else
    select * into c from app_public.group_cows where group_id=p_group_id and cancelled_at is null
      and week_start=week-7 and ends_at<=observed and finalized_at is not null and final_outcome='ready'
      order by starts_at desc,id desc limit 1;
    if found then selection:='previous_final'; end if;
    select min(starts_at) into upcoming from app_public.group_cows where group_id=p_group_id and cancelled_at is null and starts_at>observed;
    deadline:=least(deadline,upcoming);
  end if;
  if selection<>'none' then result:=app_public.group_cow_public_result(c,c.metrics,null,3,true); end if;
  return jsonb_build_object('group_id',g.id,'week_start',week,'calendar_revision',g.cow_calendar_revision,
    'observed_at_us',app_public.group_cow_us(observed),'valid_until_us',app_public.group_cow_us(deadline),
    'selection',selection,'result',result);
end $$;

do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname in ('group_cow_redacts_exercise','group_cow_public_state','group_cow_result_rows',
      'group_cow_public_result','group_cow_results','group_cow_summary') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('group_cow_results','group_cow_summary') then execute format('grant execute on function %s to anon,authenticated',f.signature); end if;
  end loop;
end $permissions$;
