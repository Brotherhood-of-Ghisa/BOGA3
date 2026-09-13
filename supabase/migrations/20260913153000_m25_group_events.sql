-- M25-T02: the persistent group stream. `group_events` is the stream: every
-- item is a row written once, when it happens, and never deleted by the app.
-- `group_stream` reads it instead of assembling items at read time from the
-- share ledger and membership periods.
--
-- Contract: docs/specs/tech/groups-contract.md §2.6 (table, writers, backfill)
-- and §4.2 (group_stream: wire shape, order, keys, cursor — unchanged).
--
-- Ground rules (contract §2): no `owner_user_id` column, no FK into the nine
-- Sync v2 tables, RLS on with no policies and no anon/authenticated grants.
--
-- Kinds written now: `session` (share trigger path), `joined`, `left`,
-- `removed` (membership writes). `record`, `record_voided`, `link`, `unlink`,
-- and `lead_change` are reserved by the CHECK for M25-T05; `group_stream`
-- ignores them until it is taught their items.
--
-- Session cards still read their content live (§4.2): a `session` event is
-- the item's identity and group; the card's fields, its sort position (the
-- live `sessions.started_at`), and its visibility (not tombstoned) come from
-- the member's Sync v2 rows at read time.

-- -----------------------------------------------------------------------------
-- The stream table
-- -----------------------------------------------------------------------------

create table app_public.group_events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references app_public.groups (id) on delete cascade,
  kind           text not null,
  -- The member the item is about: the athlete for `session`, the member for
  -- the membership kinds.
  member_user_id uuid not null references auth.users (id) on delete cascade,
  -- Who caused it, where that differs from the member (`removed`: the remover).
  actor_user_id  uuid null references auth.users (id) on delete set null,
  -- `session`: sessions.id in the member's keyspace (no FK — ground rule 2).
  session_id     text null,
  -- Membership kinds: the period; also the item key's prefix.
  membership_id  uuid null references app_public.group_memberships (id) on delete cascade,
  -- Position in epoch ms. Membership kinds: floor(joined_at | ended_at).
  -- `session`: sessions.started_at, kept current by the session trigger; the
  -- read orders by the live started_at, so this copy never decides the wire.
  sort_at_ms     bigint not null,
  occurred_at    timestamptz not null default now(),
  constraint group_events_kind_check check (kind in (
    'session', 'joined', 'left', 'removed',
    'record', 'record_voided', 'link', 'unlink', 'lead_change'
  )),
  constraint group_events_session_shape_check check (
    kind <> 'session'
    or (session_id is not null and membership_id is null and actor_user_id is null)
  ),
  constraint group_events_membership_shape_check check (
    kind not in ('joined', 'left', 'removed')
    or (membership_id is not null and session_id is null
        and (actor_user_id is null or kind = 'removed'))
  )
);

comment on table app_public.group_events is
  'M25 persistent group stream: one row per stream item, written once when it happens (share trigger: session; membership trigger: joined/left/removed; M25-T05 evaluator: reserved kinds). group_stream reads only this table; session card content is read live from the member''s Sync v2 rows. Direct client access denied.';

-- One `session` item per (group, member, session); one joined and at most one
-- ended item per membership period. The writers rely on these for idempotence.
create unique index group_events_session_uniq
  on app_public.group_events (group_id, member_user_id, session_id)
  where kind = 'session';
create unique index group_events_joined_uniq
  on app_public.group_events (membership_id)
  where kind = 'joined';
create unique index group_events_ended_uniq
  on app_public.group_events (membership_id)
  where kind in ('left', 'removed');
-- Stream order and keyset cursor within a group (sort_at_ms desc, then kind).
create index group_events_stream_idx
  on app_public.group_events (group_id, sort_at_ms desc, kind);
-- The session trigger's lookup of a member's session across groups.
create index group_events_member_session_idx
  on app_public.group_events (member_user_id, session_id)
  where kind = 'session';

alter table app_public.group_events enable row level security;
revoke all on table app_public.group_events from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_events to service_role;

-- -----------------------------------------------------------------------------
-- Writers
-- -----------------------------------------------------------------------------

-- Session items. An AFTER trigger on app_public.sessions that fires after
-- `sessions_group_share_session` (same-event triggers fire in name order:
-- "..._share_session" < "..._stream_event"), so it sees the shares that write
-- just made. It derives items from the ledger rather than from "this write
-- created a share", so a missed item — a failure here, or a share that
-- predates the table — is created on the session's next accepted write,
-- exactly like the share itself (§2.5 self-heal).
--
-- Failure-isolated with the §2.5 pattern: any failure is recorded as a
-- sanitized `group.event_failed` diagnostic (session id + SQLSTATE only) and
-- the trigger returns normally, so it can never abort sync_push.
create function app_public.group_event_session()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _sqlstate text;
begin
  begin
    insert into app_public.group_events (group_id, kind, member_user_id, session_id, sort_at_ms)
    select sh.group_id, 'session', sh.member_user_id, sh.session_id, new.started_at
      from app_public.group_session_shares sh
     where sh.member_user_id = new.owner_user_id
       and sh.session_id = new.id
    on conflict (group_id, member_user_id, session_id) where kind = 'session'
      do nothing;

    update app_public.group_events e
       set sort_at_ms = new.started_at
     where e.kind = 'session'
       and e.member_user_id = new.owner_user_id
       and e.session_id = new.id
       and e.sort_at_ms <> new.started_at;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    begin
      insert into public.app_logs (level, source, event, message, user_id, context)
      values (
        'error', 'database', 'group.event_failed',
        'group stream event trigger failed; the session write committed',
        new.owner_user_id,
        jsonb_build_object('session_id', new.id, 'sqlstate', _sqlstate)
      );
    exception when others then
      raise warning 'group.event_failed (app_logs unavailable): session %, sqlstate %',
        new.id, _sqlstate;
    end;
  end;
  return null;
end;
$$;

create trigger sessions_group_stream_event
  after insert or update on app_public.sessions
  for each row execute function app_public.group_event_session();

-- Membership items. Every membership write goes through the §4.3 RPCs
-- (group_create / group_join insert a period; group_leave / group_remove_member
-- end one), so a trigger on the period table is where they write their item.
-- Not failure-isolated: the item is part of the membership change and commits
-- or fails with it. Role changes and ownership transfers write nothing.
create function app_public.group_event_membership()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _was_active boolean := true;
begin
  if tg_op = 'INSERT' then
    insert into app_public.group_events
      (group_id, kind, member_user_id, membership_id, sort_at_ms, occurred_at)
    values (
      new.group_id, 'joined', new.user_id, new.id,
      floor(extract(epoch from new.joined_at) * 1000)::bigint, new.joined_at
    );
  else
    _was_active := old.ended_at is null;
  end if;
  if new.ended_at is not null and _was_active then
    insert into app_public.group_events
      (group_id, kind, member_user_id, actor_user_id, membership_id, sort_at_ms, occurred_at)
    values (
      new.group_id, new.end_reason, new.user_id,
      case when new.end_reason = 'removed' then new.ended_by end,
      new.id, floor(extract(epoch from new.ended_at) * 1000)::bigint, new.ended_at
    );
  end if;
  return null;
end;
$$;

create trigger group_memberships_stream_event
  after insert or update of ended_at on app_public.group_memberships
  for each row execute function app_public.group_event_membership();

-- -----------------------------------------------------------------------------
-- Backfill
-- -----------------------------------------------------------------------------

-- Writes every missing item for the step-1 sources: one `session` per share
-- row (at the live started_at, else the ledger copy for a hard-deleted
-- session, which no read shows) and one joined plus, for an ended period,
-- one left/removed per membership period. Idempotent (the unique indexes),
-- so it is safe to re-run as a repair; returns the number of rows inserted.
create function app_public.group_events_backfill()
returns integer
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _sessions integer;
  _joined   integer;
  _ended    integer;
begin
  insert into app_public.group_events
    (group_id, kind, member_user_id, session_id, sort_at_ms, occurred_at)
  select sh.group_id, 'session', sh.member_user_id, sh.session_id,
         coalesce(s.started_at, sh.session_started_at), sh.shared_at
    from app_public.group_session_shares sh
    left join app_public.sessions s
      on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
  on conflict (group_id, member_user_id, session_id) where kind = 'session'
    do nothing;
  get diagnostics _sessions = row_count;

  insert into app_public.group_events
    (group_id, kind, member_user_id, membership_id, sort_at_ms, occurred_at)
  select m.group_id, 'joined', m.user_id, m.id,
         floor(extract(epoch from m.joined_at) * 1000)::bigint, m.joined_at
    from app_public.group_memberships m
  on conflict (membership_id) where kind = 'joined'
    do nothing;
  get diagnostics _joined = row_count;

  insert into app_public.group_events
    (group_id, kind, member_user_id, actor_user_id, membership_id, sort_at_ms, occurred_at)
  select m.group_id, m.end_reason, m.user_id,
         case when m.end_reason = 'removed' then m.ended_by end,
         m.id, floor(extract(epoch from m.ended_at) * 1000)::bigint, m.ended_at
    from app_public.group_memberships m
   where m.ended_at is not null
  on conflict (membership_id) where kind in ('left', 'removed')
    do nothing;
  get diagnostics _ended = row_count;

  return _sessions + _joined + _ended;
end;
$$;

select app_public.group_events_backfill();

-- -----------------------------------------------------------------------------
-- group_stream reads group_events (§4.2 — wire shape, order, keys unchanged)
-- -----------------------------------------------------------------------------

-- Items ordered by sort_at_ms desc, kind asc, key desc (kind/key in the "C"
-- collation). p_before is the previous page's next_cursor; a page holds items
-- strictly after it. Session items: one per (member, session) across the
-- in-scope `session` events, at the live started_at, hidden while the session
-- row is missing or tombstoned. Membership items: `<membership_id>:joined`
-- and `<membership_id>:ended` (event left|removed) at the stored sort_at_ms.
-- Reserved (M25-T05) kinds are not stream items yet.
create or replace function app_public.group_stream(
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

  with session_rows as (
    -- One card per (member, session) in scope, deduplicated across groups.
    select e.member_user_id,
           e.session_id,
           s.started_at,
           jsonb_agg(
             jsonb_build_object('group_id', g.id, 'name', g.name)
             order by lower(g.name), g.name, g.id
           ) as groups
      from app_public.group_events e
      join app_public.groups g on g.id = e.group_id and g.deleted_at is null
      join app_public.sessions s
        on s.owner_user_id = e.member_user_id
       and s.id = e.session_id
       and s.deleted_at is null
     where e.group_id = any(_scope)
       and e.kind = 'session'
     group by e.member_user_id, e.session_id, s.started_at
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
      from session_rows r
    union all
    select 'membership',
           e.membership_id::text || case when e.kind = 'joined' then ':joined' else ':ended' end,
           e.sort_at_ms,
           e.member_user_id, null, null, e.kind, e.group_id
      from app_public.group_events e
     where e.group_id = any(_scope)
       and e.kind in ('joined', 'left', 'removed')
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

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function app_public.group_event_session() from public, anon, authenticated;
revoke all on function app_public.group_event_membership() from public, anon, authenticated;
revoke all on function app_public.group_events_backfill() from public, anon, authenticated;
