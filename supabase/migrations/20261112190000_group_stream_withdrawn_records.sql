-- group_competition_stream_v5: the v4 stream, with each `record_voided` item
-- also carrying the record it withdrew (`withdrawn`): that record's event and
-- its stream `record` (set, previous holders, GR boards), exactly as v4 shows
-- the record item itself, or null when the record is gone. The app draws a
-- withdrawn record as its GR card, once, at withdrawal time; a withdrawal of
-- a record that took no #1 (a PR, never shown as a card) draws nothing.
--
-- The record event is already on the stream (voided records stay listed), so
-- this discloses nothing new; its visibility is the event reader's own.
--
-- A new reader beside v4: installed builds decode the stream against an exact
-- key allowlist, so v4's shape is unchanged. Paging, cursors and access are
-- v3's own (v5 hands its arguments and cursor straight through v4).

create function app_public.group_competition_stream_withdrawn(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('event',app_public.group_competition_event_json(r),
    'record',app_public.group_competition_stream_record(r)
      ||jsonb_build_object('group_record_metrics',app_public.group_competition_stream_group_record_metrics(r)))
  from app_public.group_events r
  where r.id=p_event.related_event_id and r.kind='record' and r.group_id=p_event.group_id
    and r.group_exercise_id=p_event.group_exercise_id and r.member_user_id=p_event.member_user_id;
$$;
revoke all on function app_public.group_competition_stream_withdrawn(app_public.group_events) from public,anon,authenticated,service_role;

create function app_public.group_competition_stream_v5(p_group_id uuid default null,p_before text default null,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare page jsonb;
begin
  page:=app_public.group_competition_stream_v4(p_group_id,p_before,p_limit);
  return jsonb_set(page,'{items}',coalesce((
    select jsonb_agg(case when e.id is not null and e.kind='record_voided'
      then i||jsonb_build_object('withdrawn',coalesce(app_public.group_competition_stream_withdrawn(e),'null'::jsonb)) else i end
      order by x.ordinality)
    from jsonb_array_elements(page->'items') with ordinality x(i,ordinality)
    left join app_public.group_events e on i->>'kind'='competition' and e.id::text=i->>'key'),'[]'::jsonb));
end $$;
revoke all on function app_public.group_competition_stream_v5(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_stream_v5(uuid,text,integer) to anon,authenticated;
