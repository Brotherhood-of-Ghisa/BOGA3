-- Group week summary: one read for a group's weekly board, who is training now
-- and the latest completed session (groups contract §2.9, §4.7).
--
-- 1. group_set_facts gains `working`: the app's own working-set rule
--    (`isWorkingSessionSetType`), run by the evaluator (TS). SQL never
--    interprets a set.
-- 2. group_eval_session_rows returns `set_type`; group_eval_complete stores
--    `working`. GROUP_EVAL_RULES_VERSION 4 re-normalizes every older fact.
-- 3. group_week_summary(p_group_id, p_window_start_ms, p_window_end_ms): the
--    client passes its local-week window, so the server never guesses a time
--    zone.

-- 1. Facts ------------------------------------------------------------------------

-- Null on a fact written before rules version 4, until it is re-normalized.
alter table app_public.group_set_facts
  add column working boolean null;

-- 2. Evaluator I/O ------------------------------------------------------------------

create or replace function app_public.group_eval_session_rows(p_member_user_id uuid,p_session_id text)
returns jsonb language sql stable security definer set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'session_id',p_session_id,'started_at_ms',s.started_at,
    'sets',case when s.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'set_id',es.id,'session_exercise_id',se.id,
        'exercise_definition_id',se.exercise_definition_id,
        'exercise_order_index',se.order_index,'set_order_index',es.order_index,
        'weight_value',es.weight_value,'reps_value',es.reps_value,
        'performance_status',es.performance_status,
        'set_type',es.set_type,
        'live',es.deleted_at is null and se.deleted_at is null and s.deleted_at is null,
        'fingerprint',app_public.group_legacy_set_fingerprint(es))
        order by se.order_index,se.id,es.order_index,es.id)
      from app_public.session_exercises se join app_public.exercise_sets es
        on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
      where se.owner_user_id=p_member_user_id and se.session_id=p_session_id),'[]'::jsonb) end)
  from(select 1) one left join app_public.sessions s
    on s.owner_user_id=p_member_user_id and s.id=p_session_id;
$$;

create or replace function app_public.group_eval_complete(p_job_id bigint, p_generation bigint, p_facts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _job app_public.group_eval_queue;
  _defs text[];
  _targets jsonb;
  _target record;
begin
  select q.* into _job from app_public.group_eval_queue q where q.id = p_job_id for update;
  if not found then
    raise exception 'NOT_FOUND: evaluator job not found' using errcode = 'P0001';
  end if;

  if _job.generation <> p_generation then
    update app_public.group_eval_queue set claimed_until = null where id = _job.id;
    return jsonb_build_object('job_id', _job.id, 'completed', false, 'targets', '[]'::jsonb);
  end if;

  if _job.kind = 'session' then
    if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
      raise exception 'VALIDATION: a session job needs a facts array' using errcode = 'P0001';
    end if;

    -- Exercises in the session before and after: a changed exercise must
    -- re-apply the target it left as well as the one it joined.
    select coalesce(array_agg(distinct d.id), '{}') into _defs
      from (
        select f.exercise_definition_id as id
          from app_public.group_set_facts f
         where f.member_user_id = _job.member_user_id and f.session_id = _job.session_id
        union
        select e ->> 'exercise_definition_id'
          from jsonb_array_elements(p_facts) e
      ) d
     where d.id is not null;

    delete from app_public.group_set_facts f
     where f.member_user_id = _job.member_user_id
       and f.session_id = _job.session_id
       and not exists (select 1 from jsonb_array_elements(p_facts) e where e ->> 'set_id' = f.set_id);

    insert into app_public.group_set_facts as f (
      member_user_id, set_id, session_id, session_exercise_id, exercise_definition_id,
      exercise_order_index, set_order_index, performed, live, weight_kg, reps, e1rm_kg, working,
      achieved_at_ms, fingerprint, rules_version, evaluated_at
    )
    select _job.member_user_id, r.set_id, _job.session_id, r.session_exercise_id, r.exercise_definition_id,
           r.exercise_order_index, r.set_order_index, r.performed, r.live, r.weight_kg, r.reps, r.e1rm_kg, r.working,
           r.achieved_at_ms, r.fingerprint, r.rules_version, now()
      from jsonb_to_recordset(p_facts) as r(
        set_id text, session_exercise_id text, exercise_definition_id text,
        exercise_order_index integer, set_order_index integer, performed boolean, live boolean,
        weight_kg double precision, reps numeric, e1rm_kg double precision, working boolean,
        achieved_at_ms bigint, fingerprint text, rules_version integer)
    on conflict (member_user_id, set_id) do update set
      session_id             = excluded.session_id,
      session_exercise_id    = excluded.session_exercise_id,
      exercise_definition_id = excluded.exercise_definition_id,
      exercise_order_index   = excluded.exercise_order_index,
      set_order_index        = excluded.set_order_index,
      performed              = excluded.performed,
      live                   = excluded.live,
      weight_kg              = excluded.weight_kg,
      reps                   = excluded.reps,
      e1rm_kg                = excluded.e1rm_kg,
      working                = excluded.working,
      achieved_at_ms         = excluded.achieved_at_ms,
      fingerprint            = excluded.fingerprint,
      rules_version          = excluded.rules_version,
      evaluated_at           = excluded.evaluated_at;

    _targets := app_public.group_eval_session_targets(_job.member_user_id, _job.session_id, _defs);
  else
    _targets := case
      when app_public.group_eval_target_is_live(_job.member_user_id, _job.group_id, _job.group_exercise_id)
        then jsonb_build_array(jsonb_build_object(
               'group_id', _job.group_id, 'group_exercise_id', _job.group_exercise_id))
      else '[]'::jsonb
    end;
  end if;

  for _target in
    select t.group_id, t.group_exercise_id
      from jsonb_to_recordset(_targets) as t(group_id uuid, group_exercise_id uuid)
  loop
    perform app_public.group_eval_apply(_target.group_id, _job.member_user_id, _target.group_exercise_id, _job.causes);
  end loop;

  delete from app_public.group_eval_queue where id = _job.id;
  return jsonb_build_object('job_id', _job.id, 'completed', true, 'targets', _targets);
end;
$$;

-- 3. The summary ----------------------------------------------------------------------

-- Working sets and exercises of one session from its facts: performed, live
-- facts whose Sync v2 set and exercise rows still exist untombstoned, so a
-- delete of either kind counts at once, before the evaluator re-drains; a
-- working set is a performed one the app's rule marks working; an exercise
-- counts once it has a performed set (contract §5).
create function app_public.group_week_session_counts(p_member uuid, p_session_id text)
returns table (working_sets integer, exercise_count integer)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select (count(*) filter (where f.working))::integer,
         (count(distinct f.session_exercise_id))::integer
    from app_public.group_set_facts f
    join app_public.exercise_sets es
      on es.owner_user_id = f.member_user_id and es.id = f.set_id and es.deleted_at is null
    join app_public.session_exercises se
      on se.owner_user_id = es.owner_user_id and se.id = es.session_exercise_id and se.deleted_at is null
   where f.member_user_id = p_member and f.session_id = p_session_id
     and f.performed and f.live;
$$;

-- The group records of one session in one group: non-voided `record` events
-- (either pipeline's) whose set row still exists untombstoned, where the
-- member took #1 on at least one board, with those boards. The set check
-- covers a record no apply will void any more (an earlier contract-2 rules
-- revision). Contract-1 boards carry `value_kg`; contract-2 `value` + `unit`.
create function app_public.group_week_session_records(p_group_id uuid, p_member uuid, p_session_id text)
returns table (seq bigint, record_json jsonb)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select e.seq,
         jsonb_build_object(
           'key', e.id,
           'group_exercise', jsonb_build_object('group_exercise_id', gx.id, 'name', gx.name),
           'set_id', e.set_id,
           'boards', (
             select jsonb_agg(jsonb_build_object(
                      'metric', b ->> 'metric',
                      'value', coalesce(b -> 'value', b -> 'value_kg'),
                      'unit', coalesce(b ->> 'unit', 'kg'))
                    order by b ->> 'metric')
               from jsonb_array_elements(e.payload -> 'boards') b
              where (b ->> 'group_record')::boolean))
    from app_public.group_events e
    join app_public.group_exercises gx on gx.id = e.group_exercise_id
   where e.group_id = p_group_id and e.kind = 'record'
     and e.member_user_id = p_member and e.session_id = p_session_id
     and exists (select 1 from app_public.exercise_sets es
                  where es.owner_user_id = e.member_user_id and es.id = e.set_id and es.deleted_at is null)
     and not exists (select 1 from app_public.group_events v
                      where v.kind = 'record_voided' and v.related_event_id = e.id)
     and exists (select 1 from jsonb_array_elements(e.payload -> 'boards') b
                  where (b ->> 'group_record')::boolean);
$$;

create function app_public.group_week_gym_name(p_member uuid, p_gym_id text)
returns text
language sql
stable
set search_path = app_public, pg_temp
as $$
  select g.name from app_public.gyms g
   where g.owner_user_id = p_member and g.id = p_gym_id and g.deleted_at is null;
$$;

create function app_public.group_week_summary(
  p_group_id uuid,
  p_window_start_ms bigint,
  p_window_end_ms bigint
)
returns jsonb
language plpgsql
stable
security definer
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
  -- records over their completed, live sessions shared to this group and
  -- started in the window. Equal figures share a rank.
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
           (select count(*) from week_sessions ws
              cross join lateral app_public.group_week_session_records(p_group_id, ws.member_user_id, ws.session_id) r
             where ws.member_user_id = mb.user_id)::integer as group_records
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

-- Facts written before rules version 4 have no `working`. Queue them now rather
-- than at the first drain after deploy, which waits for unrelated activity:
-- the sweep drains the queue within 30 s. 4 is GROUP_EVAL_RULES_VERSION; the
-- requeue skips sessions already queued, so the loop ends.
do $requeue$
begin
  while app_public.group_eval_requeue_rules(4, 1000) > 0 loop
  end loop;
end
$requeue$;

revoke all on function app_public.group_week_session_counts(uuid, text) from public, anon, authenticated;
revoke all on function app_public.group_week_session_records(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_public.group_week_gym_name(uuid, text) from public, anon, authenticated;
revoke all on function app_public.group_week_summary(uuid, bigint, bigint) from public;
grant execute on function app_public.group_week_summary(uuid, bigint, bigint)
  to anon, authenticated, service_role;
