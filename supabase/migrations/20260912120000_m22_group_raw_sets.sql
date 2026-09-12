-- Group reads return raw set rows; every set computation moves to the viewing
-- device.
--
-- Contract: docs/specs/tech/groups-contract.md §4.2 (card and detail shapes)
-- and §5 (metrics are computed on the device by the recorder's TS; PR
-- highlights are deferred, §9).
--
-- The stream card and the friend-session detail now carry the same
-- `exercises` array: every live exercise with every live set as synced
-- (weight_value / reps_value text, set_type, performance_status). Nothing is
-- parsed or filtered by performed-ness here, so the M22-T02 SQL mirrors of the
-- TS parsers (group_js_trim, group_parse_reps, group_parse_weight, group_e1rm,
-- group_performed_sets) and the card's metrics/highlights are dropped.

-- A session's live exercises with their live sets, raw, in order_index order.
-- Tombstoned exercises and sets are omitted. Never reads GPS columns.
create function app_public.group_session_exercises_json(p_member uuid, p_session_id text)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'session_exercise_id', se.id,
               'name', se.name,
               'machine_name', se.machine_name,
               'order_index', se.order_index,
               'sets', coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'set_id', es.id,
                            'order_index', es.order_index,
                            'weight_value', es.weight_value,
                            'reps_value', es.reps_value,
                            'set_type', es.set_type,
                            'performance_status', es.performance_status
                          )
                          order by es.order_index, es.id
                        )
                   from app_public.exercise_sets es
                  where es.owner_user_id = se.owner_user_id
                    and es.session_exercise_id = se.id
                    and es.deleted_at is null
               ), '[]'::jsonb)
             )
             order by se.order_index, se.id
           ),
           '[]'::jsonb
         )
    from app_public.session_exercises se
   where se.owner_user_id = p_member
     and se.session_id = p_session_id
     and se.deleted_at is null;
$$;

-- Session-card fields (§4.2) for one live session. p_groups is the caller's
-- in-scope groups holding the share.
create or replace function app_public.group_session_card_json(p_member uuid, p_session_id text, p_groups jsonb)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'kind', 'session',
    'key', p_member::text || ':' || p_session_id,
    'sort_at_ms', s.started_at,
    'member', app_public.group_member_ref_json(p_member),
    'session_id', p_session_id,
    'groups', p_groups,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member and g.id = s.gym_id and g.deleted_at is null
    ),
    'status', s.status,
    'started_at_ms', s.started_at,
    'completed_at_ms', s.completed_at,
    'duration_sec', s.duration_sec,
    'exercises', app_public.group_session_exercises_json(p_member, p_session_id)
  )
  from app_public.sessions s
  where s.owner_user_id = p_member and s.id = p_session_id;
$$;

-- A friend's session: visible only when the caller is an active member of a
-- non-deleted group holding a share for (member, session) and the session is
-- not tombstoned. Non-member ≡ nonexistent ≡ deleted: one NOT_FOUND body.
create or replace function app_public.group_session_detail(p_member_user_id uuid, p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
  _s   record;
begin
  if not exists (
    select 1
      from app_public.group_session_shares sh
      join app_public.sessions s
        on s.owner_user_id = sh.member_user_id
       and s.id = sh.session_id
       and s.deleted_at is null
     where sh.member_user_id = p_member_user_id
       and sh.session_id = p_session_id
       and app_public.group_active_role(sh.group_id, _uid) is not null
  ) then
    raise exception 'NOT_FOUND: session not found'
      using errcode = 'P0001';
  end if;

  select x.gym_id, x.status, x.started_at, x.completed_at, x.duration_sec
    into _s
    from app_public.sessions x
   where x.owner_user_id = p_member_user_id and x.id = p_session_id;

  return jsonb_build_object('session', jsonb_build_object(
    'member', app_public.group_member_ref_json(p_member_user_id),
    'session_id', p_session_id,
    'gym_name', (
      select g.name
        from app_public.gyms g
       where g.owner_user_id = p_member_user_id and g.id = _s.gym_id and g.deleted_at is null
    ),
    'status', _s.status,
    'started_at_ms', _s.started_at,
    'completed_at_ms', _s.completed_at,
    'duration_sec', _s.duration_sec,
    'exercises', app_public.group_session_exercises_json(p_member_user_id, p_session_id)
  ));
end;
$$;

-- The SQL mirrors of the TS set semantics are gone with their last callers.
drop function app_public.group_performed_sets(uuid, text[]);
drop function app_public.group_e1rm(double precision, integer);
drop function app_public.group_parse_weight(text, integer);
drop function app_public.group_parse_reps(text);
drop function app_public.group_js_trim(text);

revoke all on function app_public.group_session_exercises_json(uuid, text) from public, anon, authenticated;
