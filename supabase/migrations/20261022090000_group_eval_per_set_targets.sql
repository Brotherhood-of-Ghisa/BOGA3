-- A set re-evaluates only the comparisons its own exercise reaches.
--
-- Before: every set push also rewrote its session row, the session trigger
-- queued a whole-session job, and group_eval_session_targets added every
-- comparison the member held board state on in the group. One logged set
-- re-published every comparison in the group (13 on hosted BOGA_DEV, about
-- 8 full source-graph publications per push), enough for one member's workout
-- to exhaust the hosted database.
--
-- Now:
--   - a session job carries the exercise definitions its set and session
--     exercise writes touched; null means the whole session (session insert,
--     a start/status/deletion change, a share created by the write, rules
--     drains, notification recovery);
--   - the session trigger queues only for those session changes;
--   - a completed session job applies only targets those definitions reach:
--     a live link, the member's current board state linked to one, or an
--     active certification or unvoided record card on one of their sets
--     (unlinking keeps both, and a correction must still end them).

alter table app_public.group_eval_queue
  add column exercise_definition_ids text[] null,
  add constraint group_eval_queue_definitions_session_only
    check (kind = 'session' or exercise_definition_ids is null);

comment on column app_public.group_eval_queue.exercise_definition_ids is
  'Session jobs: the exercise definitions the queued set and session-exercise writes touched; null re-applies every exercise of the session. Target jobs: always null.';

drop function app_public.group_eval_enqueue_session(uuid, text, text);

create function app_public.group_eval_enqueue_session(
  p_member_user_id uuid, p_session_id text, p_cause text, p_exercise_definition_ids text[] default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  if p_session_id is null or not exists (
    select 1 from app_public.group_session_shares sh
     where sh.member_user_id = p_member_user_id and sh.session_id = p_session_id
  ) then
    return false;
  end if;

  insert into app_public.group_eval_queue as q (kind, member_user_id, session_id, causes, exercise_definition_ids)
  values ('session', p_member_user_id, p_session_id, array[p_cause],
          case when p_exercise_definition_ids is not null then
            (select coalesce(array_agg(distinct d order by d), '{}')
               from unnest(p_exercise_definition_ids) d where d is not null) end)
  on conflict (member_user_id, session_id) where kind = 'session'
  do update set
    generation   = q.generation + 1,
    causes       = (select array_agg(distinct c order by c) from unnest(q.causes || excluded.causes) c),
    -- A whole-session request absorbs any per-definition one.
    exercise_definition_ids = case
      when q.exercise_definition_ids is null or excluded.exercise_definition_ids is null then null
      else (select coalesce(array_agg(distinct d order by d), '{}')
              from unnest(q.exercise_definition_ids || excluded.exercise_definition_ids) d) end,
    enqueued_at  = now(),
    available_at = least(q.available_at, now());
  return true;
end;
$$;

revoke all on function app_public.group_eval_enqueue_session(uuid, text, text, text[])
  from public, anon, authenticated, service_role;

-- Every sync_push of a set also rewrites its session row (updated_at); only
-- the columns the evaluator reads re-evaluate the whole session.
create or replace function app_public.group_eval_on_session()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued boolean := false;
  _sqlstate text;
begin
  -- group_share_session (ordered before this trigger) recreates a missed
  -- share on any write; that write evaluates the whole session too.
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.started_at is not distinct from new.started_at
     and old.deleted_at is not distinct from new.deleted_at
     and not exists (select 1 from app_public.group_session_shares sh
                      where sh.member_user_id = new.owner_user_id and sh.session_id = new.id
                        and sh.shared_at = now()) then
    return null;
  end if;
  begin
    _queued := app_public.group_eval_enqueue_session(new.owner_user_id, new.id, 'set');
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'sessions', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
$$;

create or replace function app_public.group_eval_on_session_exercise()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued boolean := false;
  _sqlstate text;
begin
  begin
    if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
      _queued := app_public.group_eval_enqueue_session(new.owner_user_id, new.session_id, 'set',
        array[new.exercise_definition_id]);
      _queued := app_public.group_eval_enqueue_session(old.owner_user_id, old.session_id, 'set',
        array[old.exercise_definition_id]) or _queued;
    else
      _queued := app_public.group_eval_enqueue_session(new.owner_user_id, new.session_id, 'set',
        array[new.exercise_definition_id,
              case when tg_op = 'UPDATE' then old.exercise_definition_id end]);
    end if;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'session_exercises', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
$$;

create or replace function app_public.group_eval_on_exercise_set()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued boolean := false;
  _sqlstate text;
  _new app_public.session_exercises;
  _old app_public.session_exercises;
begin
  begin
    select * into _new from app_public.session_exercises se
     where se.owner_user_id = new.owner_user_id and se.id = new.session_exercise_id;
    if tg_op = 'UPDATE' and old.session_exercise_id is distinct from new.session_exercise_id then
      select * into _old from app_public.session_exercises se
       where se.owner_user_id = old.owner_user_id and se.id = old.session_exercise_id;
    end if;
    if _old.session_id is not null and _old.session_id is distinct from _new.session_id then
      _queued := app_public.group_eval_enqueue_session(new.owner_user_id, _new.session_id, 'set',
        array[_new.exercise_definition_id]);
      _queued := app_public.group_eval_enqueue_session(old.owner_user_id, _old.session_id, 'set',
        array[_old.exercise_definition_id]) or _queued;
    else
      _queued := app_public.group_eval_enqueue_session(new.owner_user_id, _new.session_id, 'set',
        array[_new.exercise_definition_id, _old.exercise_definition_id]);
    end if;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'exercise_sets', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
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
  _sets text[];
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

    -- A whole-session job re-applies every exercise in the session before and
    -- after (a changed exercise re-applies the target it left and the one it
    -- joined). A per-definition job re-applies the definitions its writes
    -- touched, plus those of facts this completion drops (a hard-deleted set).
    select coalesce(array_agg(distinct d.id), '{}') into _defs
      from (
        select f.exercise_definition_id as id
          from app_public.group_set_facts f
         where f.member_user_id = _job.member_user_id and f.session_id = _job.session_id
           and (_job.exercise_definition_ids is null
                or not exists (select 1 from jsonb_array_elements(p_facts) e where e ->> 'set_id' = f.set_id))
        union
        select e ->> 'exercise_definition_id'
          from jsonb_array_elements(p_facts) e
         where _job.exercise_definition_ids is null
        union
        select unnest(_job.exercise_definition_ids)
      ) d
     where d.id is not null;

    -- The sets under those definitions, before and after this completion
    -- (a moved or hard-deleted set keeps its identity for the checks below).
    select coalesce(array_agg(distinct x.set_id), '{}') into _sets
      from (
        select f.set_id from app_public.group_set_facts f
         where f.member_user_id = _job.member_user_id and f.session_id = _job.session_id
           and f.exercise_definition_id = any(_defs)
        union
        select e ->> 'set_id' from jsonb_array_elements(p_facts) e
         where e ->> 'exercise_definition_id' = any(_defs)
      ) x;

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

    -- Only targets these definitions reach: a live link, current board state
    -- linked to one at its last apply, or an active certification or unvoided
    -- record card on one of their sets (unlinking keeps both, and a correction
    -- must still end them).
    select coalesce(jsonb_agg(jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.group_exercise_id)
                              order by t.group_id, t.group_exercise_id), '[]'::jsonb)
      into _targets
      from jsonb_to_recordset(app_public.group_eval_session_targets(_job.member_user_id, _job.session_id, _defs))
             as t(group_id uuid, group_exercise_id uuid)
     where exists (
             select 1 from app_public.exercise_group_links l
              where l.owner_user_id = _job.member_user_id and l.deleted_at is null
                and l.exercise_definition_id = any(_defs)
                and app_public.group_eval_try_uuid(l.group_id) = t.group_id
                and app_public.group_eval_try_uuid(l.group_exercise_id) = t.group_exercise_id)
        or exists (
             select 1 from app_public.group_metric_board_state st
               join app_public.group_exercises ge on ge.id = st.group_exercise_id and ge.rules_revision = st.rules_revision
              where st.group_exercise_id = t.group_exercise_id and st.member_user_id = _job.member_user_id
                and st.linked_definition_ids && _defs)
        or exists (
             select 1 from app_public.group_metric_certifications c
              where c.group_exercise_id = t.group_exercise_id and c.member_user_id = _job.member_user_id
                and c.ended_at is null and c.set_id = any(_sets))
        or exists (
             select 1 from app_public.group_events r
              where r.group_exercise_id = t.group_exercise_id and r.member_user_id = _job.member_user_id
                and r.kind = 'record' and r.set_id = any(_sets)
                and not exists (select 1 from app_public.group_events v
                                 where v.related_event_id = r.id and v.kind = 'record_voided'));
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
