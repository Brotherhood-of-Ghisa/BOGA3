-- Group read helpers: the two shared costs of the group readers.
--
-- R2, per-session record lookups. group_week_session_records filters
-- group_events by (group, kind 'record', member, session); only the stream
-- index applied, so each call read the group's whole event history, and the
-- At a glance reads call it once per session.
--
-- R1, bodyweight redaction. group_competition_redacts_exercise is not inlined
-- and, when the answer is "not redacted", runs every branch: its events,
-- set-score and certification branches had no index on (exercise, member),
-- and group_cow_redacts_exercise's `or definition_id = ''` kept its refs
-- index from the definition. The branches get indexes, the CoW helper splits
-- its condition so the index applies, and readers get a once-per-statement
-- cache (group_competition_redactions) that asks the live function once per
-- distinct (member, definition). One statement sees one snapshot, so a
-- cached answer is the per-row answer. The live functions stay for single
-- calls.
--
-- Answers and figures are unchanged; the read-path parity cases prove it.
-- Indexes only: no table or column changes.

-- R2: one session's records in one group.
create index group_events_session_records on app_public.group_events (group_id, member_user_id, session_id)
  where kind = 'record';

-- R1: the redaction branches, by exercise and member.
create index group_events_exercise_member on app_public.group_events (group_exercise_id, member_user_id);
create index group_metric_set_scores_member on app_public.group_metric_set_scores (group_exercise_id, member_user_id)
  where counting;
create index group_metric_certifications_member on app_public.group_metric_certifications (group_exercise_id, member_user_id);

-- The week summary's latest completed session, per member, in its order.
create index sessions_owner_latest_completed on app_public.sessions
  (owner_user_id, completed_at desc nulls last, started_at desc, id)
  where status = 'completed' and deleted_at is null;

-- The same rows as before: with no definition every retained ref counts; with
-- one, a ref counts when its definition is unknown (''), is that definition,
-- or its set is now logged under it. The first two now probe
-- group_cow_refs_definition.
create or replace function app_public.group_cow_redacts_exercise(p_groups uuid[],p_member uuid,p_definition text) returns boolean
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  if p_definition is null then
    return exists(select 1 from app_public.group_cow_source_refs r join app_public.group_cows c on c.id=r.cow_id
      join app_public.group_exercises ge on ge.id=c.group_exercise_id and ge.group_id=c.group_id
      join app_public.groups g on g.id=c.group_id where c.group_id=any(p_groups) and r.member_user_id=p_member
        and g.deleted_at is null and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0);
  end if;
  return exists(select 1 from app_public.group_cow_source_refs r join app_public.group_cows c on c.id=r.cow_id
      join app_public.group_exercises ge on ge.id=c.group_exercise_id and ge.group_id=c.group_id
      join app_public.groups g on g.id=c.group_id where c.group_id=any(p_groups) and r.member_user_id=p_member
        and r.definition_id=any(array['',p_definition])
        and g.deleted_at is null and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
    or exists(select 1 from app_public.group_cow_source_refs r join app_public.group_cows c on c.id=r.cow_id
      join app_public.group_exercises ge on ge.id=c.group_exercise_id and ge.group_id=c.group_id
      join app_public.groups g on g.id=c.group_id where c.group_id=any(p_groups) and r.member_user_id=p_member
        and g.deleted_at is null and g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0
        and exists(select 1 from app_public.exercise_sets es
          join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
          where es.owner_user_id=p_member and es.id=r.set_id and se.exercise_definition_id=p_definition));
end $$;

-- The readers' redaction cache: group_competition_redacts_exercise's answer
-- for each distinct (member, definition) the caller passes (the two arrays
-- zipped; equal lengths; a null definition is asked as null). A reader materializes it once
-- per statement and looks each row up, falling back to the live call when a
-- pair is missing:
--   with redaction as materialized (
--     select * from app_public.group_competition_redactions(p_group, <members>, <definitions>))
--   ... coalesce((select r.redacted from redaction r where r.member_user_id = x
--         and r.definition_id is not distinct from y),
--       app_public.group_competition_redacts_exercise(array[p_group], x, y))
create function app_public.group_competition_redactions(p_group uuid,p_members uuid[],p_definitions text[])
returns table(member_user_id uuid,definition_id text,redacted boolean)
language sql stable set search_path=app_public,pg_temp as $$
  select d.member_user_id,d.definition_id,
    app_public.group_competition_redacts_exercise(array[p_group],d.member_user_id,d.definition_id)
  from (select distinct x.member_user_id,x.definition_id
    from unnest(p_members,p_definitions) x(member_user_id,definition_id)) d;
$$;
revoke all on function app_public.group_competition_redactions(uuid,uuid[],text[]) from public,anon,authenticated,service_role;

-- A session's working sets and exercises, as before: its performed, live,
-- working facts whose set and exercise rows still exist untombstoned. The
-- session's own live exercises and sets are read first, by its active-row
-- indexes; a fact whose set is not among them (since moved or deleted) is
-- checked as before.
create or replace function app_public.group_week_session_counts(p_member uuid, p_session_id text)
returns table (working_sets integer, exercise_count integer)
language sql
stable
set search_path = app_public, pg_temp
as $$
  with live as materialized (
    select es.id as set_id
      from app_public.session_exercises se
      join app_public.exercise_sets es
        on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id and es.deleted_at is null
     where se.owner_user_id = p_member and se.session_id = p_session_id and se.deleted_at is null
  )
  select (count(*))::integer,
         (count(distinct f.session_exercise_id))::integer
    from app_public.group_set_facts f
   where f.member_user_id = p_member and f.session_id = p_session_id
     and f.performed and f.live and f.working is not false
     and (exists (select 1 from live l where l.set_id = f.set_id)
       or exists (select 1 from app_public.exercise_sets es
                    join app_public.session_exercises se
                      on se.owner_user_id = es.owner_user_id and se.id = es.session_exercise_id and se.deleted_at is null
                   where es.owner_user_id = f.member_user_id and es.id = f.set_id and es.deleted_at is null));
$$;

create or replace function app_public.group_competition_period_totals(p_group_id uuid,p_windows jsonb)
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
  -- Materialized: referenced once, it would be inlined into `totals`, and
  -- every session's counts and records recomputed for each window.
  session_totals as materialized (
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

create or replace function app_public.group_competition_week_summary(p_group_id uuid,p_window_start_ms bigint,p_window_end_ms bigint)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _members jsonb; _training jsonb; _latest jsonb; _records jsonb;
begin
  perform app_public.group_competition_require_member(p_group_id,_uid);
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
           -- One per board taken: a set #1 on Volume and on 1RM is two.
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
  -- first, so only that session's facts are counted. Keyset per member: each
  -- current member's first shared session in that order
  -- (`sessions_owner_latest_completed`), then the first of those, so no
  -- share history is sorted.
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
        from app_public.group_memberships m
        cross join lateral (
          select s.*
            from app_public.sessions s
           where s.owner_user_id = m.user_id
             and s.deleted_at is null and s.status = 'completed'
             and exists (select 1 from app_public.group_session_shares sh
                          where sh.group_id = p_group_id and sh.member_user_id = s.owner_user_id and sh.session_id = s.id)
           order by s.completed_at desc nulls last, s.started_at desc, s.id
           limit 1
        ) s
       where m.group_id = p_group_id and m.ended_at is null
       order by s.completed_at desc nulls last, s.started_at desc, s.owner_user_id, s.id
       limit 1
    ) l
    cross join lateral app_public.group_week_session_counts(l.owner_user_id, l.id) c;

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
  return jsonb_build_object('contract_version',4,'group_id',p_group_id,'members',_members,
    'training_now',_training,'latest_completed',_latest);
end;
$$;

