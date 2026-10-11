-- Group period totals: the Groups screen's At a glance read (groups contract,
-- "Week summary and period totals"). One call returns, for each window the client sends, every
-- current member's working sets and group records over their completed, live
-- sessions shared to the group and started in it: the week summary's board
-- figures, over weeks or months, for several periods at once.
--
-- The client sends its local windows, so the server never guesses a time
-- zone. Figures only: no rank (the client ranks by the metric it shows), no
-- volume (groups dropped that metric), no session or set context.

create function app_public.group_competition_period_totals(p_group_id uuid,p_windows jsonb)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _invalid boolean; _periods jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  -- 1 to 12 windows, each {start_ms, end_ms} of whole ms with
  -- 0 <= start_ms < end_ms and at most 32 days long (a month across a DST
  -- change fits). Windows may overlap: each is totalled on its own. CASE,
  -- not OR: each test runs only once the ones before it hold, so no JSON
  -- function sees a value of the wrong type. (Assigned first: an IF reads its
  -- condition only up to the first THEN, which would be the CASE's.)
  _invalid := case
       when jsonb_typeof(p_windows) is distinct from 'array' then true
       when jsonb_array_length(p_windows) not between 1 and 12 then true
       else exists (
         select 1 from jsonb_array_elements(p_windows) w
          where case
                  when jsonb_typeof(w) <> 'object' then true
                  when (select count(*) from jsonb_object_keys(w)) <> 2 then true
                  when jsonb_typeof(w -> 'start_ms') is distinct from 'number'
                    or jsonb_typeof(w -> 'end_ms') is distinct from 'number' then true
                  else (w ->> 'start_ms')::numeric <> trunc((w ->> 'start_ms')::numeric)
                    or (w ->> 'end_ms')::numeric <> trunc((w ->> 'end_ms')::numeric)
                    or (w ->> 'start_ms')::numeric < 0
                    or (w ->> 'end_ms')::numeric <= (w ->> 'start_ms')::numeric
                    or (w ->> 'end_ms')::numeric - (w ->> 'start_ms')::numeric > 32 * 86400000::numeric
                    or (w ->> 'end_ms')::numeric > 9007199254740991
                end)
     end;
  if _invalid then
    raise exception 'VALIDATION: p_windows must be 1 to 12 {start_ms, end_ms} windows, 0 <= start_ms < end_ms, at most 32 days long'
      using errcode = 'P0001';
  end if;

  with windows as (
    -- Through numeric: a whole number may arrive with a scale (`1.0`).
    select x.idx, (x.w ->> 'start_ms')::numeric::bigint as start_ms, (x.w ->> 'end_ms')::numeric::bigint as end_ms
      from jsonb_array_elements(p_windows) with ordinality x(w, idx)
  ),
  members as (
    select m.user_id, nullif(btrim(p.username), '') as username
      from app_public.group_memberships m
      left join app_public.user_profiles p on p.id = m.user_id
     where m.group_id = p_group_id and m.ended_at is null
  ),
  -- The week summary's session scope: completed, live, shared to this group
  -- by a current member, started inside at least one window.
  period_sessions as (
    select s.owner_user_id as member_user_id, s.id as session_id, s.started_at
      from app_public.group_session_shares sh
      join members mb on mb.user_id = sh.member_user_id
      join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
     where sh.group_id = p_group_id
       and s.deleted_at is null and s.status = 'completed'
       and exists (select 1 from windows w where s.started_at >= w.start_ms and s.started_at < w.end_ms)
  ),
  session_totals as (
    select ps.member_user_id, ps.started_at, c.working_sets,
           -- One per board taken: a set #1 on Volume and on 1RM is two.
           coalesce((select sum(jsonb_array_length(r.record_json -> 'boards'))
                       from app_public.group_week_session_records(p_group_id, ps.member_user_id, ps.session_id) r), 0) as group_records
      from period_sessions ps
      cross join lateral app_public.group_week_session_counts(ps.member_user_id, ps.session_id) c
  ),
  totals as (
    select w.idx, mb.user_id, mb.username,
           coalesce(sum(st.working_sets), 0)::integer as working_sets,
           coalesce(sum(st.group_records), 0)::integer as group_records
      from windows w
      cross join members mb
      left join session_totals st
        on st.member_user_id = mb.user_id and st.started_at >= w.start_ms and st.started_at < w.end_ms
     group by w.idx, mb.user_id, mb.username
  )
  select jsonb_agg(jsonb_build_object(
           'start_ms', w.start_ms,
           'end_ms', w.end_ms,
           'members', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'member', jsonb_build_object('user_id', t.user_id, 'username', t.username),
                      'working_sets', t.working_sets,
                      'group_records', t.group_records)
                    order by lower(t.username) nulls last, t.user_id)
               from totals t where t.idx = w.idx), '[]'::jsonb))
         order by w.idx)
    into _periods
    from windows w;

  return jsonb_build_object('contract_version', 4, 'group_id', p_group_id, 'periods', _periods);
end;
$$;

revoke all on function app_public.group_competition_period_totals(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_public.group_competition_period_totals(uuid,jsonb) to authenticated;
