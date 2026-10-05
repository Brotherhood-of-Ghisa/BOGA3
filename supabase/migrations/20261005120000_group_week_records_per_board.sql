-- Group records count one per board taken (groups contract §4.7), as a
-- session's personal PRs count one per record kind (training metrics contract
-- §3): a set that takes #1 on Weight and on 1RM is two group records.
--
-- 1. group_week_summary_pre_competition: a member's `group_records` sums the
--    #1 boards of their week's records, not the records. The body is the
--    week summary's (20261002120000), renamed by the competition publication,
--    with only that sum changed; it stays security invoker under its checked
--    entrypoints.
-- 2. group_competition_week_summary: the latest session's records keep only
--    the `record` values of the boards they took #1 on, as §4.7 states, so a
--    client counts and names the group records from them. The wire shape is
--    unchanged.

-- 1. The board's count ----------------------------------------------------------------

create or replace function app_public.group_week_summary_pre_competition(
  p_group_id uuid,
  p_window_start_ms bigint,
  p_window_end_ms bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid;
  _members jsonb;
  _training jsonb;
  _latest jsonb;
begin
  _uid := app_public.group_require_app_user();
  perform app_public.group_require_member(p_group_id, _uid, false);

  if p_window_start_ms is null or p_window_end_ms is null or p_window_start_ms < 0
     or p_window_end_ms <= p_window_start_ms or p_window_end_ms - p_window_start_ms > 8 * 86400000 then
    raise exception 'VALIDATION: the window must be 0 <= p_window_start_ms < p_window_end_ms, at most 8 days long'
      using errcode = 'P0001';
  end if;

  -- The board: every current member, ranked by working sets then group
  -- records (one per board taken) over their completed, live sessions shared
  -- to this group and started in the window. Equal figures share a rank.
  with members as (
    select m.user_id, nullif(btrim(p.username), '') as username
      from app_public.group_memberships m
      left join app_public.user_profiles p on p.id = m.user_id
     where m.group_id = p_group_id and m.ended_at is null
  ),
  week_sessions as (
    select s.owner_user_id as member_user_id, s.id as session_id
      from app_public.group_session_shares sh
      join members mb on mb.user_id = sh.member_user_id
      join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
     where sh.group_id = p_group_id
       and s.deleted_at is null and s.status = 'completed'
       and s.started_at >= p_window_start_ms and s.started_at < p_window_end_ms
  ),
  totals as (
    select mb.user_id, mb.username,
           coalesce((select sum(c.working_sets) from week_sessions ws
                      cross join lateral app_public.group_week_session_counts(ws.member_user_id, ws.session_id) c
                     where ws.member_user_id = mb.user_id), 0)::integer as working_sets,
           -- One per board taken: a set #1 on Weight and on 1RM is two.
           coalesce((select sum(jsonb_array_length(r.record_json -> 'boards')) from week_sessions ws
              cross join lateral app_public.group_week_session_records(p_group_id, ws.member_user_id, ws.session_id) r
             where ws.member_user_id = mb.user_id), 0)::integer as group_records
      from members mb
  ),
  ranked as (
    select t.*, rank() over (order by t.working_sets desc, t.group_records desc) as rank
      from totals t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rank,
           'member', jsonb_build_object('user_id', r.user_id, 'username', r.username),
           'working_sets', r.working_sets,
           'group_records', r.group_records)
         order by r.rank, lower(r.username) nulls last, r.user_id), '[]'::jsonb)
    into _members
    from ranked r;

  -- Training now: current members' active, live sessions shared to this
  -- group whose latest accepted write (session, exercise or set row) is
  -- under 2 hours old. Not windowed: a session spanning midnight Sunday
  -- still trains now.
  select coalesce(jsonb_agg(jsonb_build_object(
           'member', app_public.group_member_ref_json(s.owner_user_id),
           'session_id', s.id,
           'started_at_ms', s.started_at,
           'gym_name', app_public.group_week_gym_name(s.owner_user_id, s.gym_id),
           'working_sets', c.working_sets,
           'exercise_count', c.exercise_count)
         order by s.started_at desc, s.owner_user_id, s.id), '[]'::jsonb)
    into _training
    from app_public.group_session_shares sh
    join app_public.group_memberships m
      on m.group_id = sh.group_id and m.user_id = sh.member_user_id and m.ended_at is null
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
    cross join lateral app_public.group_week_session_counts(s.owner_user_id, s.id) c
   where sh.group_id = p_group_id
     and s.deleted_at is null and s.status = 'active'
     and greatest(
           s.server_received_at,
           (select max(se.server_received_at) from app_public.session_exercises se
             where se.owner_user_id = s.owner_user_id and se.session_id = s.id),
           (select max(es.server_received_at) from app_public.session_exercises se
              join app_public.exercise_sets es
                on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
             where se.owner_user_id = s.owner_user_id and se.session_id = s.id)
         ) >= now() - interval '2 hours';

  -- The latest completed session: a current member's completed, live session
  -- shared to this group with the latest completed_at, at any time. Chosen
  -- first, so only that session's facts are counted.
  select jsonb_build_object(
           'member', app_public.group_member_ref_json(l.owner_user_id),
           'session_id', l.id,
           'started_at_ms', l.started_at,
           'completed_at_ms', l.completed_at,
           'duration_sec', l.duration_sec,
           'gym_name', app_public.group_week_gym_name(l.owner_user_id, l.gym_id),
           'working_sets', c.working_sets,
           'exercise_count', c.exercise_count,
           'group_records', coalesce((
             select jsonb_agg(r.record_json order by r.seq)
               from app_public.group_week_session_records(p_group_id, l.owner_user_id, l.id) r),
             '[]'::jsonb))
    into _latest
    from (
      select s.*
        from app_public.group_session_shares sh
        join app_public.group_memberships m
          on m.group_id = sh.group_id and m.user_id = sh.member_user_id and m.ended_at is null
        join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
       where sh.group_id = p_group_id
         and s.deleted_at is null and s.status = 'completed'
       order by s.completed_at desc nulls last, s.started_at desc, s.owner_user_id, s.id
       limit 1
    ) l
    cross join lateral app_public.group_week_session_counts(l.owner_user_id, l.id) c;

  return jsonb_build_object(
    'members', _members,
    'training_now', _training,
    'latest_completed', _latest);
end;
$$;

-- 2. The latest session's records ------------------------------------------------------

create or replace function app_public.group_competition_week_summary(p_group_id uuid,p_window_start_ms bigint,p_window_end_ms bigint)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _summary jsonb; _latest jsonb; _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
  perform app_public.group_competition_require_active();
  _summary:=app_public.group_week_summary_pre_competition(p_group_id,p_window_start_ms,p_window_end_ms);
  _latest:=_summary->'latest_completed';
  if jsonb_typeof(_latest)='object' then
    -- `r.boards` holds only the boards the record took #1 on; a record value
    -- of any other board is the member's own best, not a group record.
    select coalesce(jsonb_agg(jsonb_set(x.event,'{values}',coalesce((
             select jsonb_agg(v.value order by v.ordinality)
               from jsonb_array_elements(x.event->'values') with ordinality v(value,ordinality)
              where v.value->>'role'<>'record'
                 or v.value->>'metric' in (select b->>'metric' from jsonb_array_elements(r->'boards') b)),'[]'::jsonb))
           order by e.seq),'[]') into _records
      from jsonb_array_elements(_latest->'group_records') r
      join app_public.group_events e on e.id=(r->>'key')::uuid and e.group_id=p_group_id
      cross join lateral (select app_public.group_competition_event_json(e) as event) x;
    _latest:=jsonb_build_object('member',_latest->'member','session_id',_latest->'session_id',
      'started_at_ms',_latest->'started_at_ms','completed_at_ms',_latest->'completed_at_ms',
      'duration_sec',_latest->'duration_sec','gym_name',_latest->'gym_name','working_sets',_latest->'working_sets',
      'exercise_count',_latest->'exercise_count','group_records',_records);
  end if;
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'members',_summary->'members',
    'training_now',_summary->'training_now','latest_completed',_latest);
end;
$$;
