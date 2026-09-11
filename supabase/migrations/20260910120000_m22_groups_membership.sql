-- M22-T01: group domain — groups, membership periods, invites, authorization.
--
-- Contract: docs/specs/tech/groups-contract.md §2 (ground rules 1–5), §2.1–§2.3,
-- §3 (authorization model), §4 (RPC wire contract).
--
-- Ground rules enforced here:
--   1. No group table carries an `owner_user_id` column (the Sync v2 drift
--      checker derives entity tables from that column name).
--   2. No FK from a group table into the nine Sync v2 tables.
--   4. RLS enabled with NO policies, and every direct privilege revoked from
--      anon/authenticated: all access goes through the SECURITY DEFINER
--      `app_public.group_*` RPCs below.
--   5. Group tables carry CHECK constraints (the server is their only writer).
--
-- Error transport (contract §4, same as sync_push):
--   raise exception '<TOKEN>: <message>' using errcode = 'P0001'
-- Tokens: AUTH_REQUIRED, AGENT_FORBIDDEN, NOT_FOUND, FORBIDDEN, VALIDATION,
-- USERNAME_REQUIRED, INVITE_INVALID, OWNER_MUST_TRANSFER (+ INTERNAL for
-- broken invariants, which the client maps like any unrecognised error).

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table app_public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text null,
  created_by  uuid null references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz null,
  constraint groups_name_trimmed_bounds
    check (name = btrim(name) and char_length(name) between 1 and 50),
  constraint groups_description_trimmed_bounds
    check (
      description is null
      or (description = btrim(description) and char_length(description) between 1 and 280)
    )
);

comment on table app_public.groups is
  'M22 group record header. Server-authoritative; direct client access denied (RLS, no policies, no grants). Access only via app_public.group_* RPCs. Ownership lives on group_memberships (role = owner), never on this row.';
comment on column app_public.groups.deleted_at is
  'Reserved for soft delete (deferred). Every read requires deleted_at is null.';

create table app_public.group_memberships (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references app_public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null,
  joined_at  timestamptz not null default now(),
  ended_at   timestamptz null,
  end_reason text null,
  ended_by   uuid null references auth.users (id) on delete set null,
  constraint group_memberships_role_valid
    check (role in ('owner', 'admin', 'member')),
  constraint group_memberships_end_reason_valid
    check (end_reason is null or end_reason in ('left', 'removed')),
  constraint group_memberships_end_pair
    check ((ended_at is null) = (end_reason is null)),
  constraint group_memberships_ended_after_joined
    check (ended_at is null or ended_at >= joined_at),
  constraint group_memberships_ended_by_only_when_ended
    check (ended_by is null or ended_at is not null)
);

comment on table app_public.group_memberships is
  'M22 membership periods: one row per (group, user) period. ended_at null = active. Rejoin inserts a new member period. role is frozen when the period ends.';

-- At most one active period per person per group.
create unique index group_memberships_one_active_per_user
  on app_public.group_memberships (group_id, user_id)
  where ended_at is null;

-- At most one active owner per group (the RPCs keep exactly one).
create unique index group_memberships_one_active_owner
  on app_public.group_memberships (group_id)
  where role = 'owner' and ended_at is null;

-- Share trigger (M22-T02) and "my groups" lookups.
create index group_memberships_user_group_joined
  on app_public.group_memberships (user_id, group_id, joined_at);

create table app_public.group_invites (
  group_id   uuid primary key references app_public.groups (id) on delete cascade,
  code       text not null unique,
  created_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint group_invites_code_format
    check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$')
);

comment on table app_public.group_invites is
  'M22 invite codes: one active multi-use, non-expiring code per group (8 Crockford base32 chars). Regenerate replaces code in place.';

-- -----------------------------------------------------------------------------
-- Deny-all direct access (contract §3)
-- -----------------------------------------------------------------------------

alter table app_public.groups enable row level security;
alter table app_public.group_memberships enable row level security;
alter table app_public.group_invites enable row level security;

revoke all on table app_public.groups from public, anon, authenticated;
revoke all on table app_public.group_memberships from public, anon, authenticated;
revoke all on table app_public.group_invites from public, anon, authenticated;

-- Server-side maintenance only (e.g. a lane runner's fixture cleanup).
grant select, insert, update, delete on table app_public.groups to service_role;
grant select, insert, update, delete on table app_public.group_memberships to service_role;
grant select, insert, update, delete on table app_public.group_invites to service_role;

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to clients)
-- -----------------------------------------------------------------------------

-- Common preamble: the caller's uid, or AUTH_REQUIRED / AGENT_FORBIDDEN.
create function app_public.group_require_app_user()
returns uuid
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'AUTH_REQUIRED: group access requires an authenticated user'
      using errcode = 'P0001';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot access groups'
      using errcode = 'P0001';
  end if;
  return _uid;
end;
$$;

-- The user's role in an active period of a non-deleted group, else null.
-- Rejects OAuth tokens independently (spec 10 rule 17).
create function app_public.group_active_role(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _role text;
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot access groups'
      using errcode = 'P0001';
  end if;
  select m.role
    into _role
    from app_public.group_memberships m
    join app_public.groups g on g.id = m.group_id and g.deleted_at is null
   where m.group_id = p_group_id
     and m.user_id = p_user_id
     and m.ended_at is null;
  return _role;
end;
$$;

-- Caller's active role, or NOT_FOUND (non-member ≡ nonexistent ≡ deleted).
-- p_lock = true takes `select … for update` on the groups row first, so every
-- mutating RPC serializes on the group before its role checks (contract §3).
-- The NOT_FOUND message is the single source so the two cases are
-- byte-identical on the wire.
create function app_public.group_require_member(p_group_id uuid, p_user_id uuid, p_lock boolean)
returns text
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _role text;
begin
  if p_lock then
    perform 1
      from app_public.groups g
     where g.id = p_group_id
       and g.deleted_at is null
       for update;
  end if;
  _role := app_public.group_active_role(p_group_id, p_user_id);
  if _role is null then
    raise exception 'NOT_FOUND: group not found'
      using errcode = 'P0001';
  end if;
  return _role;
end;
$$;

-- Non-blank username or USERNAME_REQUIRED.
create function app_public.group_require_username(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _username text;
begin
  select nullif(btrim(p.username), '')
    into _username
    from app_public.user_profiles p
   where p.id = p_user_id;
  if _username is null then
    raise exception 'USERNAME_REQUIRED: set a username before creating or joining a group'
      using errcode = 'P0001';
  end if;
  return _username;
end;
$$;

-- Validated, trimmed group name or VALIDATION.
create function app_public.group_validate_name(p_name text)
returns text
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
declare
  _name text := btrim(p_name);
begin
  if _name is null or char_length(_name) not between 1 and 50 then
    raise exception 'VALIDATION: group name must be 1–50 characters after trimming'
      using errcode = 'P0001';
  end if;
  return _name;
end;
$$;

-- Trimmed description (empty → null) or VALIDATION.
create function app_public.group_validate_description(p_description text)
returns text
language plpgsql
immutable
set search_path = app_public, pg_temp
as $$
declare
  _description text := nullif(btrim(p_description), '');
begin
  if _description is not null and char_length(_description) > 280 then
    raise exception 'VALIDATION: group description must be at most 280 characters'
      using errcode = 'P0001';
  end if;
  return _description;
end;
$$;

-- Invite lookup normalization: upper-case, strip whitespace and '-', map
-- O→0 and I/L→1 (contract §2.3).
create function app_public.group_normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g')), 'OIL', '011');
$$;

-- 8 Crockford base32 characters from pgcrypto randomness. 256 is a multiple
-- of 32, so `byte % 32` is uniform over the alphabet.
create function app_public.group_generate_invite_code()
returns text
language plpgsql
volatile
set search_path = app_public, pg_temp
as $$
declare
  _alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  _bytes bytea := extensions.gen_random_bytes(8);
  _code text := '';
  _i int;
begin
  for _i in 0..7 loop
    _code := _code || substr(_alphabet, (get_byte(_bytes, _i) % 32) + 1, 1);
  end loop;
  return _code;
end;
$$;

-- Writes a fresh code for the group (insert on create, replace on
-- regenerate). A code collision (1 in 32^8 per existing code) retries with a
-- new code; five consecutive collisions is a broken generator, not bad luck,
-- and fails loud as INTERNAL.
create function app_public.group_write_invite_code(p_group_id uuid, p_actor uuid, p_replace boolean)
returns text
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _code text;
  _attempt int;
  _constraint text;
begin
  for _attempt in 1..5 loop
    _code := app_public.group_generate_invite_code();
    begin
      if p_replace then
        update app_public.group_invites
           set code = _code, created_by = p_actor, created_at = now()
         where group_id = p_group_id;
        if not found then
          raise exception 'INTERNAL: group % has no invite row', p_group_id
            using errcode = 'P0001';
        end if;
      else
        insert into app_public.group_invites (group_id, code, created_by)
        values (p_group_id, _code, p_actor);
      end if;
      return _code;
    exception
      when unique_violation then
        -- Only a code collision is retryable; a duplicate group_id is a bug.
        get stacked diagnostics _constraint = constraint_name;
        if _constraint is distinct from 'group_invites_code_key' then
          raise;
        end if;
    end;
  end loop;
  raise exception 'INTERNAL: could not generate a unique invite code'
    using errcode = 'P0001';
end;
$$;

-- GroupSummary (contract §4.1) for a group the caller is known to be in.
create function app_public.group_summary_json(p_group_id uuid, p_my_role text)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'description', g.description,
    'member_count', (
      select count(*)
        from app_public.group_memberships m
       where m.group_id = g.id and m.ended_at is null
    ),
    'my_role', p_my_role
  )
  from app_public.groups g
  where g.id = p_group_id;
$$;

-- Active members (contract §4.2 group_get ordering): owner → admins →
-- members, then username case-insensitively with nulls last, then user_id
-- as a deterministic tiebreak.
create function app_public.group_members_json(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('user_id', x.user_id, 'username', x.username, 'role', x.role)
      order by x.role_rank, lower(x.username) nulls last, x.user_id
    ),
    '[]'::jsonb
  )
  from (
    select m.user_id,
           m.role,
           nullif(btrim(p.username), '') as username,
           case m.role when 'owner' then 0 when 'admin' then 1 else 2 end as role_rank
      from app_public.group_memberships m
      left join app_public.user_profiles p on p.id = m.user_id
     where m.group_id = p_group_id
       and m.ended_at is null
  ) x;
$$;

-- `{ group, members }` — the group_get payload, also returned by the member
-- management writes so the client can re-render without a second round trip.
create function app_public.group_detail_json(p_group_id uuid, p_my_role text)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'group', app_public.group_summary_json(p_group_id, p_my_role),
    'members', app_public.group_members_json(p_group_id)
  );
$$;

-- Target of a member-management action: must not be the caller (VALIDATION)
-- and must hold an active period (NOT_FOUND). Returns the target's role.
create function app_public.group_require_target(p_group_id uuid, p_caller uuid, p_target uuid)
returns text
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _role text;
begin
  if p_target is null then
    raise exception 'VALIDATION: a target user is required'
      using errcode = 'P0001';
  end if;
  if p_target = p_caller then
    raise exception 'VALIDATION: this action cannot target yourself'
      using errcode = 'P0001';
  end if;
  _role := app_public.group_active_role(p_group_id, p_target);
  if _role is null then
    raise exception 'NOT_FOUND: member not found'
      using errcode = 'P0001';
  end if;
  return _role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------

create function app_public.group_list_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid uuid := app_public.group_require_app_user();
begin
  return jsonb_build_object(
    'groups',
    coalesce((
      select jsonb_agg(
               app_public.group_summary_json(g.id, m.role)
               order by lower(g.name), g.name, g.id
             )
        from app_public.group_memberships m
        join app_public.groups g on g.id = m.group_id and g.deleted_at is null
       where m.user_id = _uid
         and m.ended_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create function app_public.group_get(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, false);
begin
  return app_public.group_detail_json(p_group_id, _role);
end;
$$;

create function app_public.group_invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _group_id uuid;
  _name     text;
begin
  select g.id, g.name
    into _group_id, _name
    from app_public.group_invites i
    join app_public.groups g on g.id = i.group_id and g.deleted_at is null
   where i.code = app_public.group_normalize_invite_code(p_code);
  if _group_id is null then
    raise exception 'INVITE_INVALID: invite code not recognised'
      using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'group_id', _group_id,
    'name', _name,
    'member_count', (
      select count(*)
        from app_public.group_memberships m
       where m.group_id = _group_id and m.ended_at is null
    ),
    'already_member', app_public.group_active_role(_group_id, _uid) is not null
  );
end;
$$;

create function app_public.group_invite_get(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, false);
  _code text;
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can view the invite code'
      using errcode = 'P0001';
  end if;
  select i.code into _code from app_public.group_invites i where i.group_id = p_group_id;
  if _code is null then
    raise exception 'INTERNAL: group % has no invite row', p_group_id
      using errcode = 'P0001';
  end if;
  return jsonb_build_object('code', _code);
end;
$$;

-- -----------------------------------------------------------------------------
-- Writes
-- -----------------------------------------------------------------------------

create function app_public.group_create(p_name text, p_description text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid         uuid := app_public.group_require_app_user();
  _name        text;
  _description text;
  _group_id    uuid;
begin
  perform app_public.group_require_username(_uid);
  _name := app_public.group_validate_name(p_name);
  _description := app_public.group_validate_description(p_description);

  insert into app_public.groups (name, description, created_by)
  values (_name, _description, _uid)
  returning id into _group_id;

  insert into app_public.group_memberships (group_id, user_id, role)
  values (_group_id, _uid, 'owner');

  perform app_public.group_write_invite_code(_group_id, _uid, false);

  return jsonb_build_object('group_id', _group_id);
end;
$$;

-- Full replacement of name and description (a null/blank description clears it).
create function app_public.group_update(p_group_id uuid, p_name text, p_description text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid         uuid := app_public.group_require_app_user();
  _role        text := app_public.group_require_member(p_group_id, _uid, true);
  _name        text;
  _description text;
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can edit the group'
      using errcode = 'P0001';
  end if;
  _name := app_public.group_validate_name(p_name);
  _description := app_public.group_validate_description(p_description);

  update app_public.groups
     set name = _name, description = _description, updated_at = now()
   where id = p_group_id;

  return jsonb_build_object('group', app_public.group_summary_json(p_group_id, _role));
end;
$$;

create function app_public.group_invite_regenerate(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, true);
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can regenerate the invite code'
      using errcode = 'P0001';
  end if;
  return jsonb_build_object('code', app_public.group_write_invite_code(p_group_id, _uid, true));
end;
$$;

create function app_public.group_join(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid      uuid := app_public.group_require_app_user();
  _group_id uuid;
begin
  perform app_public.group_require_username(_uid);

  -- Lock the group row while resolving the code, so the membership check and
  -- insert below serialize with concurrent membership writes.
  select g.id
    into _group_id
    from app_public.group_invites i
    join app_public.groups g on g.id = i.group_id and g.deleted_at is null
   where i.code = app_public.group_normalize_invite_code(p_code)
     for update of g;
  if _group_id is null then
    raise exception 'INVITE_INVALID: invite code not recognised'
      using errcode = 'P0001';
  end if;

  if app_public.group_active_role(_group_id, _uid) is not null then
    return jsonb_build_object('group_id', _group_id, 'joined', false);
  end if;

  insert into app_public.group_memberships (group_id, user_id, role)
  values (_group_id, _uid, 'member');

  return jsonb_build_object('group_id', _group_id, 'joined', true);
end;
$$;

create function app_public.group_leave(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid  uuid := app_public.group_require_app_user();
  _role text := app_public.group_require_member(p_group_id, _uid, true);
begin
  if _role = 'owner' then
    raise exception 'OWNER_MUST_TRANSFER: the owner must transfer ownership before leaving'
      using errcode = 'P0001';
  end if;

  update app_public.group_memberships
     set ended_at = now(), end_reason = 'left'
   where group_id = p_group_id
     and user_id = _uid
     and ended_at is null;

  return jsonb_build_object('group_id', p_group_id);
end;
$$;

create function app_public.group_remove_member(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid         uuid := app_public.group_require_app_user();
  _role        text := app_public.group_require_member(p_group_id, _uid, true);
  _target_role text;
begin
  if _role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can remove members'
      using errcode = 'P0001';
  end if;
  _target_role := app_public.group_require_target(p_group_id, _uid, p_user_id);
  if _role = 'admin' and _target_role <> 'member' then
    raise exception 'FORBIDDEN: an admin can remove members only'
      using errcode = 'P0001';
  end if;

  update app_public.group_memberships
     set ended_at = now(), end_reason = 'removed', ended_by = _uid
   where group_id = p_group_id
     and user_id = p_user_id
     and ended_at is null;

  return app_public.group_detail_json(p_group_id, _role);
end;
$$;

create function app_public.group_set_role(p_group_id uuid, p_user_id uuid, p_role text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid         uuid := app_public.group_require_app_user();
  _role        text := app_public.group_require_member(p_group_id, _uid, true);
  _target_role text;
begin
  if _role <> 'owner' then
    raise exception 'FORBIDDEN: only the owner can change roles'
      using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'VALIDATION: role must be admin or member'
      using errcode = 'P0001';
  end if;
  -- The caller is the only owner, so a non-self target is never the owner.
  _target_role := app_public.group_require_target(p_group_id, _uid, p_user_id);

  update app_public.group_memberships
     set role = p_role
   where group_id = p_group_id
     and user_id = p_user_id
     and ended_at is null;

  return app_public.group_detail_json(p_group_id, _role);
end;
$$;

create function app_public.group_transfer_ownership(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _uid         uuid := app_public.group_require_app_user();
  _role        text := app_public.group_require_member(p_group_id, _uid, true);
  _target_role text;
begin
  if _role <> 'owner' then
    raise exception 'FORBIDDEN: only the owner can transfer ownership'
      using errcode = 'P0001';
  end if;
  _target_role := app_public.group_require_target(p_group_id, _uid, p_user_id);

  -- Demote first: the one-active-owner unique index is not deferrable.
  update app_public.group_memberships
     set role = 'admin'
   where group_id = p_group_id
     and user_id = _uid
     and ended_at is null;

  update app_public.group_memberships
     set role = 'owner'
   where group_id = p_group_id
     and user_id = p_user_id
     and ended_at is null;

  return app_public.group_detail_json(p_group_id, 'admin');
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

-- Internal helpers: owner-only (called from the SECURITY DEFINER RPCs).
revoke all on function app_public.group_require_app_user() from public, anon, authenticated;
revoke all on function app_public.group_active_role(uuid, uuid) from public, anon, authenticated;
revoke all on function app_public.group_require_member(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function app_public.group_require_username(uuid) from public, anon, authenticated;
revoke all on function app_public.group_validate_name(text) from public, anon, authenticated;
revoke all on function app_public.group_validate_description(text) from public, anon, authenticated;
revoke all on function app_public.group_normalize_invite_code(text) from public, anon, authenticated;
revoke all on function app_public.group_generate_invite_code() from public, anon, authenticated;
revoke all on function app_public.group_write_invite_code(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function app_public.group_summary_json(uuid, text) from public, anon, authenticated;
revoke all on function app_public.group_members_json(uuid) from public, anon, authenticated;
revoke all on function app_public.group_detail_json(uuid, text) from public, anon, authenticated;
revoke all on function app_public.group_require_target(uuid, uuid, uuid) from public, anon, authenticated;

-- Client RPCs: anon is granted so the function itself emits AUTH_REQUIRED
-- instead of PostgREST raising 42501 (same posture as sync_push).
do $grants$
declare
  _sig text;
begin
  foreach _sig in array array[
    'group_list_mine()',
    'group_get(uuid)',
    'group_invite_preview(text)',
    'group_invite_get(uuid)',
    'group_create(text, text)',
    'group_update(uuid, text, text)',
    'group_invite_regenerate(uuid)',
    'group_join(text)',
    'group_leave(uuid)',
    'group_remove_member(uuid, uuid)',
    'group_set_role(uuid, uuid, text)',
    'group_transfer_ownership(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public', _sig);
    execute format('grant execute on function app_public.%s to anon, authenticated, service_role', _sig);
  end loop;
end
$grants$;
