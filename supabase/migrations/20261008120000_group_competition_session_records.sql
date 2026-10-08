-- The group session view's records: the #1 group records one shared session
-- took in one group, each with its board's current leader.
--
-- A new reader beside group_competition_session_detail, not a field on it: the
-- app decodes every protocol-4 payload against an exact key allowlist, so a new
-- key would fail the session view on every installed build.
--
-- Each record is the stream's competition event (group_competition_event_json:
-- the value as the record set it, enabled-group disclosure, and the live
-- certification and write token in record_context), with its `record` values
-- kept to the boards it took #1 on, as the week summary's latest session keeps
-- them (20261005120000). Voided records and records whose set is deleted are
-- left out (group_week_session_records); provisional ones stay, flagged.
--
-- `boards` pairs each #1 board with the All board's current leader at the
-- comparison's current published revision: `leads` is true while the record's
-- own set still holds #1. A record from an earlier revision, or of a metric
-- the current rules have no board for, has `leader` null.

create function app_public.group_competition_session_record_boards(p_event app_public.group_events,p_boards jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('metric',b->>'metric',
    'leader',case when l.member_user_id is not null then app_public.group_member_ref_json(l.member_user_id) end,
    'leads',coalesce(l.member_user_id=p_event.member_user_id and l.set_id=p_event.set_id,false))
    order by b->>'metric'),'[]'::jsonb)
  from jsonb_array_elements(p_boards) b
  join app_public.group_exercises ge on ge.id=p_event.group_exercise_id
  left join lateral (
    select r.member_user_id,r.row_json->'performance'->>'set_id' as set_id
      from app_public.group_competition_board_rows(p_event.group_id,ge.id,ge.rules_revision,b->>'metric',false) r
     where coalesce(p_event.rules_revision,1)=ge.rules_revision and ge.published_rules_revision=ge.rules_revision
       and b->>'metric' in ('volume','e1rm') and r.rank=1) l on true;
$$;
revoke all on function app_public.group_competition_session_record_boards(app_public.group_events,jsonb) from public,anon,authenticated,service_role;

create function app_public.group_competition_session_records(p_group_id uuid,p_member_user_id uuid,p_session_id text)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
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
$$;
revoke all on function app_public.group_competition_session_records(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_session_records(uuid,uuid,text) to authenticated;
