-- M22-T02: the group record — share ledger, share trigger, metric helpers,
-- and the stream / friend-session reads.
--
-- Contract: docs/specs/tech/groups-contract.md §2.4–§2.5 (ledger, share rule,
-- trigger, failure isolation), §4.2 (group_stream, group_session_detail),
-- §5 (performed-set predicate, card metrics, PR rule, parity vectors).
--
-- Ground rules (contract §2): no `owner_user_id` column, no FK into the nine
-- Sync v2 tables, RLS on with no policies and no anon/authenticated grants.
-- Reads inner-join members' live Sync v2 rows, so a dangling share (session
-- hard-deleted) is invisible and a tombstoned session is hidden until undeleted.
--
-- Reuses the M22-T01 helpers: group_require_app_user (AUTH_REQUIRED /
-- AGENT_FORBIDDEN preamble), group_require_member (NOT_FOUND), and
-- group_active_role.

-- -----------------------------------------------------------------------------
-- The share ledger (§2.4)
-- -----------------------------------------------------------------------------

create table app_public.group_session_shares (
  group_id           uuid not null references app_public.groups (id) on delete cascade,
  member_user_id     uuid not null references auth.users (id) on delete cascade,
  session_id         text not null,
  session_started_at bigint not null,
  shared_at          timestamptz not null default now(),
  constraint group_session_shares_pkey primary key (group_id, member_user_id, session_id)
);

comment on table app_public.group_session_shares is
  'M22 group record: which member sessions belong to which group. Written only by the group_share_session trigger on app_public.sessions; additive and permanent. Content is read through from the member''s own Sync v2 rows (no FK into them by design). Direct client access denied.';

create index group_session_shares_group_started_idx
  on app_public.group_session_shares (group_id, session_started_at desc, member_user_id, session_id);
create index group_session_shares_member_session_idx
  on app_public.group_session_shares (member_user_id, session_id);

alter table app_public.group_session_shares enable row level security;
revoke all on table app_public.group_session_shares from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_session_shares to service_role;

-- -----------------------------------------------------------------------------
-- The share trigger (§2.5)
-- -----------------------------------------------------------------------------

-- Fires on every session insert/update (every autosave), so a missed share is
-- created on that session's next write. The body can never abort sync_push:
-- any failure is recorded as a sanitized `group.share_failed` diagnostic
-- (session id + SQLSTATE only — never payload values or the error text, which
-- can echo row contents) and the trigger returns normally.
create function app_public.group_share_session()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _sqlstate text;
begin
  begin
    insert into app_public.group_session_shares
      (group_id, member_user_id, session_id, session_started_at)
    select m.group_id, new.owner_user_id, new.id, new.started_at
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = new.owner_user_id
       and m.joined_at <= to_timestamp(new.started_at / 1000.0)
       and (m.ended_at is null or to_timestamp(new.started_at / 1000.0) < m.ended_at)
    on conflict (group_id, member_user_id, session_id)
      do update set session_started_at = excluded.session_started_at
      where group_session_shares.session_started_at <> excluded.session_started_at;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    begin
      insert into public.app_logs (level, source, event, message, user_id, context)
      values (
        'error', 'database', 'group.share_failed',
        'group share trigger failed; the session write committed',
        new.owner_user_id,
        jsonb_build_object('session_id', new.id, 'sqlstate', _sqlstate)
      );
    exception when others then
      -- The diagnostics sink itself failed. Still never abort the sync write;
      -- surface it in the Postgres server log instead.
      raise warning 'group.share_failed (app_logs unavailable): session %, sqlstate %',
        new.id, _sqlstate;
    end;
  end;
  return null;
end;
$$;

create trigger sessions_group_share_session
  after insert or update on app_public.sessions
  for each row execute function app_public.group_share_session();

-- -----------------------------------------------------------------------------
-- Metric helpers (§5.1) — SQL mirrors of the canonical TS
-- -----------------------------------------------------------------------------
--
-- Parity is pinned by supabase/tests/fixtures/group-set-metric-vectors.json,
-- asserted here (groups-contract lane) and against the TS functions (jest).
-- These helpers never raise for any input text, so one member's malformed row
-- cannot break a group read. The two deliberate SQL-side bounds (reps above
-- int4, weights >= 1e15) are pinned as `sql` overrides in the vectors.

-- String.prototype.trim(): JS WhiteSpace + LineTerminator code points. btrim()
-- only strips spaces and [[:space:]] is locale-dependent, so the set is explicit.
create function app_public.group_js_trim(p_value text)
returns text
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select regexp_replace(
    p_value,
    '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
      || '|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g');
$$;

-- parseSetReps: trimmed, ^[0-9]+$, > 0, else null. JS `\d` is ASCII-only, so
-- [0-9] (not the locale-aware \d). Values above int4 return null (SQL bound).
create function app_public.group_parse_reps(p_value text)
returns integer
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case
    when x.t is null or x.t !~ '^[0-9]+$' then null
    when x.digits = '' then null
    when char_length(x.digits) > 10 then null
    when char_length(x.digits) = 10 and x.digits collate "C" > '2147483647' then null
    else x.digits::integer
  end
  from (
    select t, ltrim(t, '0') as digits
      from (select app_public.group_js_trim(p_value) as t) trimmed
  ) x;
$$;

-- canonicalizeWeightForReps + parseSetWeight: a blank weight with valid reps
-- is 0; otherwise trimmed, ^[0-9]*\.?[0-9]*$ with at least one digit, >= 0,
-- else null. p_reps is the already-parsed reps (null when invalid).
create function app_public.group_parse_weight(p_value text, p_reps integer)
returns double precision
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
declare
  _t text := app_public.group_js_trim(p_value);
begin
  if _t is null then
    return null;
  end if;
  if _t = '' then
    return case when p_reps is not null and p_reps > 0 then 0 else null end;
  end if;
  if _t !~ '^[0-9]*\.?[0-9]*$' or _t !~ '[0-9]' then
    return null;
  end if;
  -- SQL bound: weights >= 1e15 (16+ integer digits) are rejected so every read
  -- sum/product stays finite and JSON-representable.
  if char_length(ltrim(split_part(_t, '.', 1), '0')) > 15 then
    return null;
  end if;
  -- With <= 15 integer digits and <= 300 characters the value is within
  -- [1e-299, 1e15): float8in (correctly rounded, like JS Number) cannot error.
  if char_length(_t) <= 300 then
    return _t::double precision;
  end if;
  -- Only a very long fraction can get here; it can underflow, where float8in
  -- raises but JS Number yields 0.
  begin
    return _t::double precision;
  exception when numeric_value_out_of_range then
    return 0;
  end;
end;
$$;

-- estimateOneRepMax (Wathan): 100·w / (48.8 + 53.8·e^(−0.075·r)); null when
-- w <= 0. Above 600 reps 53.8·e^(−0.075·r) is below half an ulp of 48.8, so JS
-- evaluates the denominator to exactly 48.8; short-circuiting there also keeps
-- exp() from raising on underflow for huge rep counts.
create function app_public.group_e1rm(p_weight double precision, p_reps integer)
returns double precision
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case
    when p_weight is null or p_reps is null or p_weight <= 0 or p_reps <= 0 then null
    when p_reps > 600 then (100 * p_weight) / 48.8::double precision
    else (100 * p_weight)
      / (48.8::double precision + 53.8::double precision * exp(-0.075::double precision * p_reps))
  end;
$$;

-- Performed sets (§5.1) of one member's sessions: set and session exercise not
-- tombstoned, performance_status normalizes to null (normalizeSessionSetPerformanceStatus:
-- only planned/skipped/unperformed are not performed), and both parsers non-null.
-- Never reads GPS columns.
create function app_public.group_performed_sets(p_member uuid, p_session_ids text[])
returns table (
  session_id             text,
  session_exercise_id    text,
  exercise_order         integer,
  exercise_definition_id text,
  exercise_name          text,
  machine_name           text,
  set_id                 text,
  set_order              integer,
  set_type               text,
  weight                 double precision,
  reps                   integer
)
language sql
stable
set search_path = app_public, pg_temp
as $$
  select se.session_id, se.id, se.order_index, se.exercise_definition_id, se.name, se.machine_name,
         es.id, es.order_index, es.set_type, pw.weight, pr.reps
    from app_public.session_exercises se
    join app_public.exercise_sets es
      on es.owner_user_id = se.owner_user_id
     and es.session_exercise_id = se.id
     and es.deleted_at is null
    cross join lateral (select app_public.group_parse_reps(es.reps_value) as reps) pr
    cross join lateral (select app_public.group_parse_weight(es.weight_value, pr.reps) as weight) pw
   where se.owner_user_id = p_member
     and se.session_id = any(p_session_ids)
     and se.deleted_at is null
     and (es.performance_status is null
          or es.performance_status not in ('planned', 'skipped', 'unperformed'))
     and pr.reps is not null
     and pw.weight is not null;
$$;

-- `{ user_id, username }` for a member (username null when blank or absent).
create function app_public.group_member_ref_json(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'user_id', p_user_id,
    'username', (select nullif(btrim(p.username), '') from app_public.user_profiles p where p.id = p_user_id)
  );
$$;

-- Session-card fields (§4.2, §5.2) for one live session. p_groups is the
-- caller's in-scope groups holding the share.
create function app_public.group_session_card_json(p_member uuid, p_session_id text, p_groups jsonb)
returns jsonb
language sql
stable
set search_path = app_public, pg_temp
as $$
  with s as (
    select x.gym_id, x.status, x.started_at, x.completed_at, x.duration_sec
      from app_public.sessions x
     where x.owner_user_id = p_member and x.id = p_session_id
  ),
  cur as (
    select ps.*, app_public.group_e1rm(ps.weight, ps.reps) as e1rm
      from app_public.group_performed_sets(p_member, array[p_session_id]) ps
  ),
  -- Current: the best-e1RM performed set per exercise definition; ties go to
  -- the lowest order_index (exercise, then set).
  best as (
    select distinct on (c.exercise_definition_id) c.*
      from cur c
     where c.exercise_definition_id is not null and c.e1rm is not null
     order by c.exercise_definition_id, c.e1rm desc, c.exercise_order, c.set_order, c.set_id
  ),
  -- History: the member's other completed, non-deleted sessions with a
  -- completed_at and an earlier started_at that contain one of those
  -- definitions. The member's full history, not only what was shared.
  hist_sessions as (
    select coalesce(array_agg(h.id), '{}'::text[]) as ids
      from app_public.sessions h, s
     where h.owner_user_id = p_member
       and h.id <> p_session_id
       and h.status = 'completed'
       and h.deleted_at is null
       and h.completed_at is not null
       and h.started_at < s.started_at
       and exists (
         select 1
           from app_public.session_exercises hse
          where hse.owner_user_id = p_member
            and hse.session_id = h.id
            and hse.deleted_at is null
            and hse.exercise_definition_id in (select b.exercise_definition_id from best b)
       )
  ),
  hist as (
    select ps.exercise_definition_id, max(app_public.group_e1rm(ps.weight, ps.reps)) as best_e1rm
      from hist_sessions hs
     cross join lateral app_public.group_performed_sets(p_member, hs.ids) ps
     where ps.exercise_definition_id in (select b.exercise_definition_id from best b)
     group by ps.exercise_definition_id
  )
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
    'metrics', jsonb_build_object(
      'performed_sets', (select count(*) from cur),
      'total_volume_kg', coalesce((select sum(c.weight * c.reps) from cur c), 0),
      'exercise_count', (select count(distinct c.session_exercise_id) from cur c)
    ),
    'highlights', jsonb_build_object(
      'prs', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'exercise_name', b.exercise_name,
                   'weight_kg', b.weight,
                   'reps', b.reps,
                   'e1rm_kg', b.e1rm
                 )
                 order by b.exercise_order, b.set_order, b.exercise_definition_id
               )
          from best b
          join hist h on h.exercise_definition_id = b.exercise_definition_id
         where b.e1rm > h.best_e1rm
      ), '[]'::jsonb)
    )
  )
  from s;
$$;

-- -----------------------------------------------------------------------------
-- Reads (§4.2)
-- -----------------------------------------------------------------------------

-- Items ordered by sort_at_ms desc, kind asc, key desc (kind/key in the "C"
-- collation). p_before is the previous page's next_cursor; a page holds items
-- strictly after it. Membership items: `<membership_id>:joined` at joined_at
-- and `<membership_id>:ended` (event left|removed) at ended_at, in epoch ms.
create function app_public.group_stream(
  p_group_id uuid default null,
  p_before   jsonb default null,
  p_limit    integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _scope    uuid[];
  _limit    integer;
  _c_sort   bigint;
  _c_kind   text;
  _c_key    text;
  _items    jsonb;
  _has_more boolean;
  _last     jsonb;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id, _uid, false);
    _scope := array[p_group_id];
  else
    select coalesce(array_agg(m.group_id), '{}'::uuid[])
      into _scope
      from app_public.group_memberships m
      join app_public.groups g on g.id = m.group_id and g.deleted_at is null
     where m.user_id = _uid
       and m.ended_at is null;
  end if;

  _limit := coalesce(p_limit, 20);
  if _limit < 1 or _limit > 50 then
    raise exception 'VALIDATION: p_limit must be between 1 and 50'
      using errcode = 'P0001';
  end if;

  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    if jsonb_typeof(p_before) <> 'object'
       or (select count(*) from jsonb_object_keys(p_before)) <> 3
       or jsonb_typeof(p_before -> 'sort_at_ms') is distinct from 'number'
       or (p_before ->> 'sort_at_ms') !~ '^-?[0-9]{1,18}$'
       or (p_before ->> 'kind') is null
       or (p_before ->> 'kind') not in ('membership', 'session')
       or jsonb_typeof(p_before -> 'key') is distinct from 'string'
       or (p_before ->> 'key') = '' then
      raise exception 'VALIDATION: p_before must be a cursor {sort_at_ms, kind, key} from next_cursor'
        using errcode = 'P0001';
    end if;
    _c_sort := (p_before ->> 'sort_at_ms')::bigint;
    _c_kind := p_before ->> 'kind';
    _c_key  := p_before ->> 'key';
  end if;

  with share_rows as (
    -- One card per (member, session) in scope, deduplicated across groups.
    select sh.member_user_id,
           sh.session_id,
           s.started_at,
           jsonb_agg(
             jsonb_build_object('group_id', g.id, 'name', g.name)
             order by lower(g.name), g.name, g.id
           ) as groups
      from app_public.group_session_shares sh
      join app_public.groups g on g.id = sh.group_id and g.deleted_at is null
      join app_public.sessions s
        on s.owner_user_id = sh.member_user_id
       and s.id = sh.session_id
       and s.deleted_at is null
     where sh.group_id = any(_scope)
     group by sh.member_user_id, sh.session_id, s.started_at
  ),
  items as (
    select 'session'::text as kind,
           r.member_user_id::text || ':' || r.session_id as key,
           r.started_at as sort_at_ms,
           r.member_user_id as user_id,
           r.session_id,
           r.groups,
           null::text as event,
           null::uuid as group_id
      from share_rows r
    union all
    select 'membership', m.id::text || ':joined',
           floor(extract(epoch from m.joined_at) * 1000)::bigint,
           m.user_id, null, null, 'joined', m.group_id
      from app_public.group_memberships m
     where m.group_id = any(_scope)
    union all
    select 'membership', m.id::text || ':ended',
           floor(extract(epoch from m.ended_at) * 1000)::bigint,
           m.user_id, null, null, m.end_reason, m.group_id
      from app_public.group_memberships m
     where m.group_id = any(_scope)
       and m.ended_at is not null
  ),
  page as (
    select i.*,
           row_number() over (
             order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
           ) as rn
      from items i
     where _c_sort is null
        or i.sort_at_ms < _c_sort
        or (i.sort_at_ms = _c_sort
            and (i.kind collate "C" > _c_kind
                 or (i.kind = _c_kind and i.key collate "C" < _c_key)))
     order by i.sort_at_ms desc, i.kind collate "C", i.key collate "C" desc
     limit _limit + 1
  )
  select coalesce(
           jsonb_agg(
             case
               when p.kind = 'session' then
                 app_public.group_session_card_json(p.user_id, p.session_id, p.groups)
               else
                 jsonb_build_object(
                   'kind', 'membership',
                   'key', p.key,
                   'sort_at_ms', p.sort_at_ms,
                   'event', p.event,
                   'group', (
                     select jsonb_build_object('group_id', g.id, 'name', g.name)
                       from app_public.groups g
                      where g.id = p.group_id
                   ),
                   'member', app_public.group_member_ref_json(p.user_id)
                 )
             end
             order by p.rn
           ) filter (where p.rn <= _limit),
           '[]'::jsonb
         ),
         count(*) > _limit,
         (array_agg(
            jsonb_build_object('sort_at_ms', p.sort_at_ms, 'kind', p.kind, 'key', p.key)
            order by p.rn desc
          ) filter (where p.rn <= _limit))[1]
    into _items, _has_more, _last
    from page p;

  return jsonb_build_object(
    'items', _items,
    'next_cursor', case when _has_more then _last else null end,
    'has_more', _has_more
  );
end;
$$;

-- A friend's session: visible only when the caller is an active member of a
-- non-deleted group holding a share for (member, session) and the session is
-- not tombstoned. Non-member ≡ nonexistent ≡ deleted: one NOT_FOUND body.
create function app_public.group_session_detail(p_member_user_id uuid, p_session_id text)
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
    'exercises', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'session_exercise_id', e.session_exercise_id,
                 'name', e.exercise_name,
                 'machine_name', e.machine_name,
                 'order_index', e.exercise_order,
                 'sets', e.sets
               )
               order by e.exercise_order, e.session_exercise_id
             )
        from (
          select ps.session_exercise_id, ps.exercise_name, ps.machine_name, ps.exercise_order,
                 jsonb_agg(
                   jsonb_build_object(
                     'set_id', ps.set_id,
                     'order_index', ps.set_order,
                     'weight_kg', ps.weight,
                     'reps', ps.reps,
                     'set_type', ps.set_type
                   )
                   order by ps.set_order, ps.set_id
                 ) as sets
            from app_public.group_performed_sets(p_member_user_id, array[p_session_id]) ps
           group by ps.session_exercise_id, ps.exercise_name, ps.machine_name, ps.exercise_order
        ) e
    ), '[]'::jsonb)
  ));
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function app_public.group_share_session() from public, anon, authenticated;
revoke all on function app_public.group_js_trim(text) from public, anon, authenticated;
revoke all on function app_public.group_parse_reps(text) from public, anon, authenticated;
revoke all on function app_public.group_parse_weight(text, integer) from public, anon, authenticated;
revoke all on function app_public.group_e1rm(double precision, integer) from public, anon, authenticated;
revoke all on function app_public.group_performed_sets(uuid, text[]) from public, anon, authenticated;
revoke all on function app_public.group_member_ref_json(uuid) from public, anon, authenticated;
revoke all on function app_public.group_session_card_json(uuid, text, jsonb) from public, anon, authenticated;

revoke all on function app_public.group_stream(uuid, jsonb, integer) from public;
grant execute on function app_public.group_stream(uuid, jsonb, integer) to anon, authenticated, service_role;
revoke all on function app_public.group_session_detail(uuid, text) from public;
grant execute on function app_public.group_session_detail(uuid, text) to anon, authenticated, service_role;
