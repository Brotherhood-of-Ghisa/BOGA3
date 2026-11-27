-- session_meet_links: a member's link from one of their own sessions to a group
-- meet, as a Sync v2 entity so Join works offline. Rules: sync-v2 contract
-- "Per-entity rules" and group-meet-contract.md "Roster and session links";
-- product fact [[meets.linking]] in docs/product/meets.md.
--
--   - The member's own data, shaped like every other entity: composite PK
--     (owner_user_id, id), owner RLS plus the restrictive direct-app-only
--     policy, the two structural triggers, sync_push/sync_pull wiring.
--   - session_id is a composite FK into sessions (a synced layer-3 parent),
--     `on delete cascade` like session_exercises.session_id. meet_id is plain
--     text with no FK: group tables are not synced parents.
--   - The client derives the id as `<meet_id>:<session_id>`, so re-join
--     undeletes the same row. Leave is a tombstone.
--   - Pull layer 4 (after sessions). No trigger: whether a link counts is read
--     by group_meet_counting_links, never stored, and a link that does not
--     count never fails sync_push.

-- ---------------------------------------------------------------------------
-- 1. Table, indexes, structural triggers.
-- ---------------------------------------------------------------------------

create table app_public.session_meet_links (
  owner_user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  id text not null,
  session_id text not null,
  meet_id text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  constraint session_meet_links_pkey primary key (owner_user_id, id),
  constraint session_meet_links_session_fk
    foreign key (owner_user_id, session_id)
    references app_public.sessions (owner_user_id, id)
    on delete cascade
    deferrable initially deferred
);

create index session_meet_links_owner_received_idx
  on app_public.session_meet_links (owner_user_id, server_received_at);
create index session_meet_links_session_id_idx
  on app_public.session_meet_links (session_id);
create index session_meet_links_meet_id_idx
  on app_public.session_meet_links (meet_id);
create index session_meet_links_deleted_at_idx
  on app_public.session_meet_links (deleted_at);

create trigger session_meet_links_touch_server_received_at
  before update on app_public.session_meet_links
  for each row
  when (new is distinct from old)
  execute function app_public.touch_server_received_at();
create trigger session_meet_links_owner_user_id_immutable
  before update on app_public.session_meet_links
  for each row
  execute function app_public.enforce_owner_user_id_immutable();

-- ---------------------------------------------------------------------------
-- 2. RLS (universal shape) and grants.
-- ---------------------------------------------------------------------------

alter table app_public.session_meet_links enable row level security;
create policy session_meet_links_owner_select on app_public.session_meet_links
  for select to authenticated using (owner_user_id = auth.uid());
create policy session_meet_links_owner_insert on app_public.session_meet_links
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy session_meet_links_owner_update on app_public.session_meet_links
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
create policy session_meet_links_owner_delete on app_public.session_meet_links
  for delete to authenticated using (owner_user_id = auth.uid());
create policy session_meet_links_direct_app_only on app_public.session_meet_links
  as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

grant select, insert, update, delete on table app_public.session_meet_links to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Wire the entity into sync_push, sync_pull and dev_wipe_my_data. Each
-- replacement targets text the latest definition holds; a no-op replacement
-- fails the migration instead of leaving an asymmetric wire contract.
-- ---------------------------------------------------------------------------

do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  revised := replace(definition,
    $anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$,
    $replacement$    elsif _type = 'session_meet_links' then
      insert into app_public.session_meet_links (
        owner_user_id, id, session_id, meet_id,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id, _fields ->> 'session_id', _fields ->> 'meet_id',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      ) on conflict (owner_user_id, id) do update set
        session_id = excluded.session_id,
        meet_id = excluded.meet_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        client_updated_at_ms = excluded.client_updated_at_ms,
        server_received_at = excluded.server_received_at
      where excluded.client_updated_at_ms > app_public.session_meet_links.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$replacement$);
  if revised = definition then
    raise exception 'session_meet_links sync_push patch anchor missing';
  end if;
  execute revised;
end $migration$;

do $migration$
declare
  definition text;
  revised text;
  anchor text;
  replacement text;
begin
  definition := pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  for anchor, replacement in select * from (values
    (
      $anchor$'session_plan_sets', 'session_plan_uses', 'training_notes', 'injuries'$anchor$,
      $replacement$'session_plan_sets', 'session_plan_uses', 'training_notes', 'injuries', 'session_meet_links'$replacement$
    ),
    (
      $anchor$    when 4 then v_types := array['session_exercises'];$anchor$,
      $replacement$    when 4 then v_types := array['session_exercises', 'session_meet_links'];$replacement$
    ),
    (
      $anchor$    union all
    select 'session_plans'::text$anchor$,
      $replacement$    union all
    select 'session_meet_links'::text, sml.id, sml.client_updated_at_ms,
           sml.server_received_at, sml.owner_user_id,
           jsonb_build_object(
             'session_id', sml.session_id, 'meet_id', sml.meet_id,
             'created_at', sml.created_at, 'updated_at', sml.updated_at,
             'deleted_at', sml.deleted_at)
      from app_public.session_meet_links sml
      where sml.owner_user_id = auth.uid() and 'session_meet_links' = any(v_types)
    union all
    select 'session_plans'::text$replacement$
    )
  ) patches(anchor, replacement) loop
    revised := replace(definition, anchor, replacement);
    if revised = definition then
      raise exception 'session_meet_links sync_pull patch anchor missing: %', anchor;
    end if;
    definition := revised;
  end loop;
  execute definition;
end $migration$;

do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised := replace(definition,
    $anchor$  delete from app_public.session_exercise_tags where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.session_meet_links where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_exercise_tags where owner_user_id = _uid;$patch$);
  if revised = definition then
    raise exception 'session_meet_links dev_wipe_my_data patch anchor missing';
  end if;
  execute revised;
end $migration$;

-- ---------------------------------------------------------------------------
-- 4. The counting rule ([[meets.linking]]) and the roster union. Server-only
-- helpers the meet reads and scoring share; they read the members' live Sync
-- v2 rows (inner joins, so hard-delete leftovers are invisible) and never
-- write them.
-- ---------------------------------------------------------------------------

-- A session overlaps a meet when it starts before the meet ends and its end is
-- after the meet starts. Its end is completed_at; while it runs (status
-- active, no completed_at) it is now; a completed session without one ends
-- where it started.
create function app_public.group_meet_session_overlaps(p_meet app_public.group_meets, p_started_at bigint,
  p_completed_at bigint, p_status text, p_now timestamptz) returns boolean
language sql immutable set search_path = app_public, pg_temp as $$
  select p_started_at < app_public.group_meet_ms(p_meet.ends_at)
    and coalesce(p_completed_at,
      case when p_status = 'active' then app_public.group_meet_ms(p_now) else p_started_at end)
      > app_public.group_meet_ms(p_meet.starts_at);
$$;

-- The links that count toward a meet at p_now, one row per member session: the
-- link is live, the session is live and shared into the meet's group, its
-- owner is a current member, the meet is not cancelled, and the session
-- overlaps the window. A link that fails any of these is kept and ignored.
create function app_public.group_meet_counting_links(p_meet app_public.group_meets, p_now timestamptz)
returns table(member_user_id uuid, session_id text)
language sql stable set search_path = app_public, pg_temp as $$
  select distinct l.owner_user_id, l.session_id
    from app_public.session_meet_links l
    join app_public.sessions s
      on s.owner_user_id = l.owner_user_id and s.id = l.session_id and s.deleted_at is null
    join app_public.group_session_shares sh
      on sh.group_id = p_meet.group_id and sh.member_user_id = l.owner_user_id and sh.session_id = l.session_id
    join app_public.group_memberships m
      on m.group_id = p_meet.group_id and m.user_id = l.owner_user_id and m.ended_at is null
   where p_meet.cancelled_at is null
     and l.meet_id = p_meet.id::text
     and l.deleted_at is null
     and app_public.group_meet_session_overlaps(p_meet, s.started_at, s.completed_at, s.status, p_now);
$$;

-- The roster: members who joined (with when) ∪ members with a counting link.
create function app_public.group_meet_roster_members(p_meet app_public.group_meets, p_now timestamptz)
returns table(user_id uuid, joined_at timestamptz, linked boolean)
language sql stable set search_path = app_public, pg_temp as $$
  with joined as (
    select r.user_id, r.joined_at from app_public.group_meet_roster r where r.meet_id = p_meet.id
  ), linked as (
    select distinct c.member_user_id as user_id from app_public.group_meet_counting_links(p_meet, p_now) c
  )
  select coalesce(j.user_id, k.user_id), j.joined_at, k.user_id is not null
    from joined j full join linked k on k.user_id = j.user_id;
$$;

-- group_meet_get now lists the roster union. `joined` and `joined_at_ms` are
-- the explicit join (null for a member on the roster by a link only); `linked`
-- says the member has a counting link.
create or replace function app_public.group_meet_get(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _role text; _meet app_public.group_meets;
begin
  _role := app_public.group_meet_require_reader(p_group_id, _uid);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  return jsonb_build_object('meet', app_public.group_meet_json(_meet),
    'challenges', coalesce((select jsonb_agg(app_public.group_meet_challenge_json(c) order by c.created_at, c.id)
      from app_public.group_meet_challenges c where c.meet_id = _meet.id and c.removed_at is null), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(x.user_id),
        'joined', x.joined_at is not null,
        'joined_at_ms', app_public.group_meet_ms(x.joined_at),
        'linked', x.linked,
        'current_member', exists (select 1 from app_public.group_memberships m
          where m.group_id = p_group_id and m.user_id = x.user_id and m.ended_at is null))
        order by x.joined_at nulls last, x.user_id)
      from app_public.group_meet_roster_members(_meet, clock_timestamp()) x), '[]'::jsonb),
    'viewer', jsonb_build_object('role', _role,
      'joined', exists (select 1 from app_public.group_meet_roster r where r.meet_id = _meet.id and r.user_id = _uid)));
end $$;

-- Posture: the helpers are server-only; group_meet_get keeps its grant.
revoke all on function app_public.group_meet_session_overlaps(app_public.group_meets, bigint, bigint, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_public.group_meet_counting_links(app_public.group_meets, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_public.group_meet_roster_members(app_public.group_meets, timestamptz)
  from public, anon, authenticated, service_role;
