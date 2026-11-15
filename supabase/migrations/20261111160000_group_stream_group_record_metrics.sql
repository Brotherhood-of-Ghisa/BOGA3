-- group_competition_stream_v4: the v3 stream, with each record item's `record`
-- also naming the boards the set took #1 on (`group_record_metrics`, the
-- stored per-board `group_record` flag, in metric order). A record event lists
-- every board the member beat their own best on; only these are group records,
-- so the app counts the rest as the member's personal bests in the group.
--
-- A new reader beside v3: installed builds decode the stream against an exact
-- key allowlist, so v3's shape is unchanged. Paging, cursors and access are
-- v3's own (v4 hands its arguments and cursor straight through).

create function app_public.group_competition_stream_group_record_metrics(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(m order by m),'[]'::jsonb)
  from (select distinct b->>'metric' as m
    from jsonb_array_elements(coalesce(p_event.payload->'boards','[]'::jsonb)) b
    where jsonb_typeof(b)='object' and b->>'metric' is not null
      and coalesce((b->>'group_record')::boolean,false)) boards;
$$;
revoke all on function app_public.group_competition_stream_group_record_metrics(app_public.group_events) from public,anon,authenticated,service_role;

create function app_public.group_competition_stream_v4(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare page jsonb;
begin
  page:=app_public.group_competition_stream_v3(p_group_id,p_before,p_limit);
  return jsonb_set(page,'{items}',coalesce((
    select jsonb_agg(case when e.id is not null and e.kind='record' and jsonb_typeof(i->'record')='object'
      then jsonb_set(i,'{record,group_record_metrics}',app_public.group_competition_stream_group_record_metrics(e)) else i end
      order by x.ordinality)
    from jsonb_array_elements(page->'items') with ordinality x(i,ordinality)
    left join app_public.group_events e on i->>'kind'='competition' and e.id::text=i->>'key'),'[]'::jsonb));
end $$;
revoke all on function app_public.group_competition_stream_v4(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_stream_v4(uuid,text,integer) to anon,authenticated;
