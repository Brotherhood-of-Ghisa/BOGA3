-- M25-T04: the group evaluator pipeline — queue, enqueue triggers, set facts,
-- pg_net kick and pg_cron sweep.
--
-- Contract: docs/specs/tech/groups-contract.md §2.8 (queue), §2.9 (facts),
-- §2.10 (evaluator, triggers, invocation). M25 design decisions T3/T4.
--
--   member's sync_push ──▶ Sync v2 rows (sessions, session_exercises,
--   exercise_sets, exercise_definitions.load_input_mode, exercise_group_links)
--     │ failure-isolated AFTER triggers (never abort sync_push, the §2.5 pattern)
--     ▼
--   group_eval_queue ── one pg_net kick per transaction / pg_cron sweep ──▶
--   group-eval Edge Function: claim → session rows → TS normalize →
--   group_eval_complete (facts upsert, live targets, apply seam) | group_eval_fail
--
-- Ground rules (contract §2): no `owner_user_id` column, no FK into the Sync v2
-- tables, RLS on with no policies and no anon/authenticated privileges. The
-- evaluator READS exercise_group_links and never writes them: a server-written
-- row that breaks the `<group_id>:<exercise_definition_id>` id form stalls the
-- member's pull (sync contract §A.2.10). Link group columns are plain text, so
-- every read goes through group_eval_try_uuid and a stray value is inert.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists supabase_vault;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

create table app_public.group_eval_queue (
  id                bigint generated always as identity primary key,
  kind              text not null,
  member_user_id    uuid not null references auth.users (id) on delete cascade,
  session_id        text null,
  group_id          uuid null references app_public.groups (id) on delete cascade,
  group_exercise_id uuid null references app_public.group_exercises (id) on delete cascade,
  causes            text[] not null,
  generation        bigint not null default 1,
  attempts          integer not null default 0,
  enqueued_at       timestamptz not null default now(),
  available_at      timestamptz not null default now(),
  claimed_until     timestamptz null,
  last_sqlstate     text null,
  constraint group_eval_queue_kind_valid check (kind in ('session', 'target')),
  constraint group_eval_queue_shape check (
    (kind = 'session' and session_id is not null and group_id is null and group_exercise_id is null)
    or (kind = 'target' and session_id is null and group_id is not null and group_exercise_id is not null)
  ),
  constraint group_eval_queue_causes_valid check (
    cardinality(causes) > 0 and causes <@ array['set', 'link', 'load_mode', 'rules']::text[]
  )
);

comment on table app_public.group_eval_queue is
  'M25 evaluator work queue: one row per pending unit (session job = re-normalize a shared session; target job = re-apply one (group, member, group exercise) board target), coalesced on its natural key. Written by failure-isolated triggers; drained by the group-eval Edge Function. Server-only.';

create unique index group_eval_queue_session_key
  on app_public.group_eval_queue (member_user_id, session_id) where kind = 'session';
create unique index group_eval_queue_target_key
  on app_public.group_eval_queue (member_user_id, group_id, group_exercise_id) where kind = 'target';
create index group_eval_queue_available
  on app_public.group_eval_queue (available_at, id);

create table app_public.group_set_facts (
  member_user_id         uuid not null references auth.users (id) on delete cascade,
  set_id                 text not null,
  session_id             text not null,
  session_exercise_id    text not null,
  exercise_definition_id text null,
  exercise_order_index   integer not null,
  set_order_index        integer not null,
  performed              boolean not null,
  live                   boolean not null,
  -- Wide enough for any finite value the TS rules accept (reps is any JS
  -- integer the recorder's parser takes), so no client text can make a job
  -- fail on every retry.
  weight_kg              double precision null,
  reps                   numeric null,
  e1rm_kg                double precision null,
  achieved_at_ms         bigint not null,
  fingerprint            text not null,
  rules_version          integer not null,
  evaluated_at           timestamptz not null default now(),
  constraint group_set_facts_pkey primary key (member_user_id, set_id),
  constraint group_set_facts_performed_values check (
    (performed and weight_kg is not null and weight_kg >= 0 and reps is not null and reps > 0)
    or (not performed and weight_kg is null and reps is null and e1rm_kg is null)
  ),
  constraint group_set_facts_rules_version_positive check (rules_version > 0)
);

comment on table app_public.group_set_facts is
  'M25 evaluator output: one row per set of a shared session, normalized by the app''s TS set rules in the member''s entered load mode. No FK into Sync v2 rows (ground rule 2): consumers inner-join the live rows. Server-only.';

create index group_set_facts_member_session
  on app_public.group_set_facts (member_user_id, session_id);
create index group_set_facts_member_exercise
  on app_public.group_set_facts (member_user_id, exercise_definition_id);
-- Every drain asks for facts older than the TS rules version; normally none.
create index group_set_facts_rules_version
  on app_public.group_set_facts (rules_version);

alter table app_public.group_eval_queue enable row level security;
alter table app_public.group_set_facts enable row level security;
revoke all on table app_public.group_eval_queue from public, anon, authenticated;
revoke all on table app_public.group_set_facts from public, anon, authenticated;
grant select, insert, update, delete on table app_public.group_eval_queue to service_role;
grant select, insert, update, delete on table app_public.group_set_facts to service_role;

-- -----------------------------------------------------------------------------
-- 2. Pure helpers
-- -----------------------------------------------------------------------------

-- Link group columns are plain text (sync contract §A.2.10): a value that is
-- not a uuid is inert, never a cast error inside a trigger.
create function app_public.group_eval_try_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end;
$$;

-- The set's attested identity for certification (M25-T06): md5 over the raw
-- synced values. It interprets nothing, so no TS set rule is restated here.
create function app_public.group_set_fingerprint(
  p_weight_value text,
  p_reps_value text,
  p_performance_status text,
  p_deleted_at bigint
)
returns text
language sql
immutable
set search_path = app_public, pg_temp
as $$
  select md5(jsonb_build_array(p_weight_value, p_reps_value, p_performance_status, p_deleted_at)::text);
$$;

-- -----------------------------------------------------------------------------
-- 3. Configuration (Vault) and diagnostics
-- -----------------------------------------------------------------------------

-- The kick secret is generated here, once, and never leaves the database except
-- in the kick's header; the lane reads it with psql. The kick URL differs per
-- environment and is set by group_eval_set_url (local: the baseline script).
do $vault$
begin
  if not exists (select 1 from vault.secrets where name = 'group_eval_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'group_eval_secret',
      'M25 group-eval kick secret (x-group-eval-secret header)'
    );
  end if;
end
$vault$;

create function app_public.group_eval_config(p_name text)
returns text
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select nullif(btrim(s.decrypted_secret), '')
    from vault.decrypted_secrets s
   where s.name = p_name
   order by s.created_at desc
   limit 1;
$$;

-- Operator helper: set (or, with null / blank, unset) the URL the kick posts to.
create function app_public.group_eval_set_url(p_url text)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _id uuid;
  _url text := coalesce(btrim(p_url), '');
begin
  select s.id into _id from vault.secrets s where s.name = 'group_eval_url' order by s.created_at desc limit 1;
  if _id is null then
    perform vault.create_secret(_url, 'group_eval_url', 'M25 group-eval kick URL');
  else
    perform vault.update_secret(_id, _url);
  end if;
end;
$$;

-- One sanitized diagnostics row (event, ids, sqlstate — never SQLERRM, which
-- can echo row values). Never raises: a failing sink falls back to the server log.
create function app_public.group_eval_log_failure(p_event text, p_user_id uuid, p_context jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  begin
    insert into public.app_logs (level, source, event, message, user_id, context)
    values (
      'error', 'database', p_event,
      case p_event
        when 'group.eval_enqueue_failed' then 'group evaluator enqueue failed; the sync write committed'
        when 'group.eval_kick_failed' then 'group evaluator kick failed; the sync write committed and the sweep will retry'
        else 'group evaluator job failed; it stays queued and retries'
      end,
      p_user_id, p_context
    );
  exception when others then
    raise warning '% (app_logs unavailable): %', p_event, p_context;
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Enqueue (coalesced upserts) and the kick
-- -----------------------------------------------------------------------------

-- Session job, only for a session shared into at least one group.
create function app_public.group_eval_enqueue_session(p_member_user_id uuid, p_session_id text, p_cause text)
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

  insert into app_public.group_eval_queue as q (kind, member_user_id, session_id, causes)
  values ('session', p_member_user_id, p_session_id, array[p_cause])
  on conflict (member_user_id, session_id) where kind = 'session'
  do update set
    generation   = q.generation + 1,
    causes       = (select array_agg(distinct c order by c) from unnest(q.causes || excluded.causes) c),
    enqueued_at  = now(),
    available_at = least(q.available_at, now());
  return true;
end;
$$;

-- Target job, only when the group exercise exists and belongs to the group:
-- an unknown or foreign target is inert (no job, no failure row). Liveness
-- (membership, archive) is decided at resolution time, not here.
create function app_public.group_eval_enqueue_target(
  p_member_user_id uuid,
  p_group_id uuid,
  p_group_exercise_id uuid,
  p_cause text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  if p_group_id is null or p_group_exercise_id is null or not exists (
    select 1 from app_public.group_exercises ge
     where ge.id = p_group_exercise_id and ge.group_id = p_group_id
  ) then
    return false;
  end if;

  insert into app_public.group_eval_queue as q (kind, member_user_id, group_id, group_exercise_id, causes)
  values ('target', p_member_user_id, p_group_id, p_group_exercise_id, array[p_cause])
  on conflict (member_user_id, group_id, group_exercise_id) where kind = 'target'
  do update set
    generation   = q.generation + 1,
    causes       = (select array_agg(distinct c order by c) from unnest(q.causes || excluded.causes) c),
    enqueued_at  = now(),
    available_at = least(q.available_at, now());
  return true;
end;
$$;

-- POST {} to group-eval with the shared secret. pg_net queues the request in
-- this transaction and sends it after commit, so a rolled-back push sends
-- nothing. Returns the pg_net request id, or null when the URL is unset.
create function app_public.group_eval_kick()
returns bigint
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _url    text := app_public.group_eval_config('group_eval_url');
  _secret text := app_public.group_eval_config('group_eval_secret');
begin
  if _url is null or _secret is null then
    return null;
  end if;
  return net.http_post(
    url := _url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-group-eval-secret', _secret),
    timeout_milliseconds := 5000
  );
end;
$$;

-- At most one kick per transaction (a 200-row push fires hundreds of row
-- triggers), isolated from the enqueue that preceded it: a kick failure never
-- rolls back the queued work, and the sweep retries it. The flag is set
-- outside the isolated block, so a kick that fails is not retried (and logged)
-- once per remaining row.
create function app_public.group_eval_kick_once(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _sqlstate text;
begin
  if coalesce(current_setting('app.group_eval_kicked', true), '') = 'on' then
    return;
  end if;
  perform set_config('app.group_eval_kicked', 'on', true);
  begin
    perform app_public.group_eval_kick();
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure(
      'group.eval_kick_failed', p_user_id, jsonb_build_object('sqlstate', _sqlstate)
    );
  end;
end;
$$;

-- pg_cron backstop (every 30 s): one kick when claimable work exists (never
-- claimed, lease expired, or backoff elapsed) — a missed kick or a failed run.
create function app_public.group_eval_sweep()
returns boolean
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  if not exists (
    select 1 from app_public.group_eval_queue q
     where q.available_at <= now() and (q.claimed_until is null or q.claimed_until < now())
  ) then
    return false;
  end if;
  perform app_public.group_eval_kick();
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Enqueue triggers (failure-isolated: the §2.5 pattern)
--
-- Each body enqueues inside its own `begin … exception`; a failure writes one
-- sanitized group.eval_enqueue_failed row and the trigger returns normally, so
-- sync_push always commits. The kick runs in a separate isolated block. None
-- fires on DELETE: hard deletes (dev_wipe_my_data, account deletion) leave
-- dangling facts that consumers never see, since they inner-join live rows.
-- -----------------------------------------------------------------------------

create function app_public.group_eval_on_session()
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

create function app_public.group_eval_on_session_exercise()
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
    _queued := app_public.group_eval_enqueue_session(new.owner_user_id, new.session_id, 'set');
    if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
      _queued := app_public.group_eval_enqueue_session(old.owner_user_id, old.session_id, 'set') or _queued;
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

create function app_public.group_eval_on_exercise_set()
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
    _queued := app_public.group_eval_enqueue_session(
      new.owner_user_id,
      (select se.session_id from app_public.session_exercises se
        where se.owner_user_id = new.owner_user_id and se.id = new.session_exercise_id),
      'set');
    if tg_op = 'UPDATE' and old.session_exercise_id is distinct from new.session_exercise_id then
      _queued := app_public.group_eval_enqueue_session(
        old.owner_user_id,
        (select se.session_id from app_public.session_exercises se
          where se.owner_user_id = old.owner_user_id and se.id = old.session_exercise_id),
        'set') or _queued;
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

-- A load-mode change rescales every linked board (design §5: treated like an edit).
create function app_public.group_eval_on_exercise_definition()
returns trigger
language plpgsql
security definer
set search_path = app_public, pg_temp
as $$
declare
  _queued boolean := false;
  _link record;
  _sqlstate text;
begin
  begin
    for _link in
      select l.group_id, l.group_exercise_id
        from app_public.exercise_group_links l
       where l.owner_user_id = new.owner_user_id
         and l.exercise_definition_id = new.id
         and l.deleted_at is null
    loop
      _queued := app_public.group_eval_enqueue_target(
        new.owner_user_id,
        app_public.group_eval_try_uuid(_link.group_id),
        app_public.group_eval_try_uuid(_link.group_exercise_id),
        'load_mode') or _queued;
    end loop;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'exercise_definitions', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
$$;

-- Link, unlink (tombstone), relink (undelete) and retarget: re-apply the new
-- target and, when the target moved, the old one.
create function app_public.group_eval_on_exercise_group_link()
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
    _queued := app_public.group_eval_enqueue_target(
      new.owner_user_id,
      app_public.group_eval_try_uuid(new.group_id),
      app_public.group_eval_try_uuid(new.group_exercise_id),
      'link');
    if tg_op = 'UPDATE'
       and (old.group_id, old.group_exercise_id) is distinct from (new.group_id, new.group_exercise_id) then
      _queued := app_public.group_eval_enqueue_target(
        old.owner_user_id,
        app_public.group_eval_try_uuid(old.group_id),
        app_public.group_eval_try_uuid(old.group_exercise_id),
        'link') or _queued;
    end if;
  exception when others then
    get stacked diagnostics _sqlstate = returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed', new.owner_user_id,
      jsonb_build_object('table', 'exercise_group_links', 'row_id', new.id, 'sqlstate', _sqlstate));
  end;
  if _queued then
    perform app_public.group_eval_kick_once(new.owner_user_id);
  end if;
  return null;
end;
$$;

-- Same-event triggers fire in name order: `z_` sorts this after
-- sessions_group_share_session and sessions_group_stream_event, so the share
-- its own write created is already visible.
create trigger sessions_group_z_eval_enqueue
  after insert or update on app_public.sessions
  for each row execute function app_public.group_eval_on_session();
create trigger session_exercises_group_eval_enqueue
  after insert or update on app_public.session_exercises
  for each row execute function app_public.group_eval_on_session_exercise();
create trigger exercise_sets_group_eval_enqueue
  after insert or update on app_public.exercise_sets
  for each row execute function app_public.group_eval_on_exercise_set();
create trigger exercise_definitions_group_eval_enqueue
  after update of load_input_mode on app_public.exercise_definitions
  for each row
  when (old.load_input_mode is distinct from new.load_input_mode)
  execute function app_public.group_eval_on_exercise_definition();
create trigger exercise_group_links_group_eval_enqueue
  after insert or update on app_public.exercise_group_links
  for each row execute function app_public.group_eval_on_exercise_group_link();

-- -----------------------------------------------------------------------------
-- 6. Target resolution (inert links) and the apply seam
-- -----------------------------------------------------------------------------

-- A target is live when the member is currently active in a non-deleted group
-- (P4: links are inactive until rejoin; P7: leaving freezes entries) and the
-- group exercise belongs to that group and is not archived (D8: archived boards
-- are frozen — which also keeps a link written after archive from applying).
create function app_public.group_eval_target_is_live(
  p_member_user_id uuid,
  p_group_id uuid,
  p_group_exercise_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select exists (
    select 1
      from app_public.group_exercises ge
      join app_public.groups g on g.id = ge.group_id and g.deleted_at is null
      join app_public.group_memberships m
        on m.group_id = ge.group_id and m.user_id = p_member_user_id and m.ended_at is null
     where ge.id = p_group_exercise_id
       and ge.group_id = p_group_id
       and ge.archived_at is null
  );
$$;

-- Live targets of a session job: every group holding a share of the session ×
-- every live link of the member into that group from one of the given
-- exercises (those in the session before and after this evaluation).
create function app_public.group_eval_session_targets(
  p_member_user_id uuid,
  p_session_id text,
  p_exercise_definition_ids text[]
)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('group_id', t.group_id, 'group_exercise_id', t.group_exercise_id)
              order by t.group_id, t.group_exercise_id),
    '[]'::jsonb)
    from (
      select distinct sh.group_id, app_public.group_eval_try_uuid(l.group_exercise_id) as group_exercise_id
        from app_public.group_session_shares sh
        join app_public.exercise_group_links l
          on l.owner_user_id = sh.member_user_id
         and l.deleted_at is null
         and app_public.group_eval_try_uuid(l.group_id) = sh.group_id
         and l.exercise_definition_id = any(p_exercise_definition_ids)
       where sh.member_user_id = p_member_user_id
         and sh.session_id = p_session_id
    ) t
   where t.group_exercise_id is not null
     and app_public.group_eval_target_is_live(p_member_user_id, t.group_id, t.group_exercise_id);
$$;

-- The seam M25-T05 fills: recompute the member's four board entries for the
-- target from facts, diff, and write events. Intentionally a no-op in T04.
create function app_public.group_eval_apply(
  p_group_id uuid,
  p_member_user_id uuid,
  p_group_exercise_id uuid,
  p_causes text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Evaluator RPCs (service_role only; called by the group-eval function)
-- -----------------------------------------------------------------------------

create function app_public.group_eval_check_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select coalesce(
    p_secret is not null and p_secret <> ''
      and p_secret = app_public.group_eval_config('group_eval_secret'),
    false);
$$;

-- Claim up to p_limit claimable jobs under a 2-minute lease (skip locked, so
-- concurrent drains never share a job).
create function app_public.group_eval_claim(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _jobs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'VALIDATION: p_limit must be between 1 and 200' using errcode = 'P0001';
  end if;

  with picked as (
    select q.id
      from app_public.group_eval_queue q
     where q.available_at <= now()
       and (q.claimed_until is null or q.claimed_until < now())
     order by q.available_at, q.id
     limit p_limit
       for update skip locked
  ), claimed as (
    update app_public.group_eval_queue q
       set claimed_until = now() + interval '2 minutes'
      from picked
     where q.id = picked.id
    returning q.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', c.id,
           'kind', c.kind,
           'member_user_id', c.member_user_id,
           'session_id', c.session_id,
           'group_id', c.group_id,
           'group_exercise_id', c.group_exercise_id,
           'causes', to_jsonb(c.causes),
           'generation', c.generation
         ) order by c.id), '[]'::jsonb)
    into _jobs
    from claimed c;

  return jsonb_build_object('jobs', _jobs);
end;
$$;

-- Every set row of the member's session, raw, with its live flag and
-- fingerprint in one snapshot. A missing session returns no sets.
create function app_public.group_eval_session_rows(p_member_user_id uuid, p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select jsonb_build_object(
    'session_id', p_session_id,
    'started_at_ms', s.started_at,
    'sets', case when s.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'set_id', es.id,
               'session_exercise_id', se.id,
               'exercise_definition_id', se.exercise_definition_id,
               'exercise_order_index', se.order_index,
               'set_order_index', es.order_index,
               'weight_value', es.weight_value,
               'reps_value', es.reps_value,
               'performance_status', es.performance_status,
               'live', es.deleted_at is null and se.deleted_at is null and s.deleted_at is null,
               'fingerprint', app_public.group_set_fingerprint(
                 es.weight_value, es.reps_value, es.performance_status, es.deleted_at)
             ) order by se.order_index, se.id, es.order_index, es.id)
        from app_public.session_exercises se
        join app_public.exercise_sets es
          on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id
       where se.owner_user_id = p_member_user_id
         and se.session_id = p_session_id
    ), '[]'::jsonb) end
  )
    from (select 1) one
    left join app_public.sessions s on s.owner_user_id = p_member_user_id and s.id = p_session_id;
$$;

-- Finish one claimed job. When a re-enqueue bumped its generation since the
-- claim, p_facts is a stale snapshot: the job is released to run again with
-- the newer work and nothing is written. Otherwise a session job replaces the
-- session's facts with p_facts (the TS normalization of
-- group_eval_session_rows), both kinds resolve their live targets and call the
-- apply seam, and the job is deleted.
create function app_public.group_eval_complete(p_job_id bigint, p_generation bigint, p_facts jsonb)
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
      exercise_order_index, set_order_index, performed, live, weight_kg, reps, e1rm_kg,
      achieved_at_ms, fingerprint, rules_version, evaluated_at
    )
    select _job.member_user_id, r.set_id, _job.session_id, r.session_exercise_id, r.exercise_definition_id,
           r.exercise_order_index, r.set_order_index, r.performed, r.live, r.weight_kg, r.reps, r.e1rm_kg,
           r.achieved_at_ms, r.fingerprint, r.rules_version, now()
      from jsonb_to_recordset(p_facts) as r(
        set_id text, session_exercise_id text, exercise_definition_id text,
        exercise_order_index integer, set_order_index integer, performed boolean, live boolean,
        weight_kg double precision, reps numeric, e1rm_kg double precision,
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

-- Release a failed job with exponential backoff (2 s, 4 s, … capped at 5 min)
-- and one sanitized group.eval_failed row. The job is never dropped.
create function app_public.group_eval_fail(p_job_id bigint, p_sqlstate text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _job app_public.group_eval_queue;
  _code text := case when p_sqlstate ~ '^[0-9A-Z]{5}$' then p_sqlstate else 'EVALX' end;
begin
  update app_public.group_eval_queue q
     set attempts      = q.attempts + 1,
         claimed_until = null,
         available_at  = now() + make_interval(secs => least(300, power(2, least(q.attempts + 1, 9)))),
         last_sqlstate = _code
   where q.id = p_job_id
  returning q.* into _job;
  if not found then
    return jsonb_build_object('job_id', p_job_id, 'found', false);
  end if;

  perform app_public.group_eval_log_failure('group.eval_failed', _job.member_user_id,
    jsonb_build_object('job_id', _job.id, 'kind', _job.kind, 'sqlstate', _code));
  return jsonb_build_object('job_id', _job.id, 'found', true, 'attempts', _job.attempts);
end;
$$;

-- A rules bump (GROUP_EVAL_RULES_VERSION in the TS) re-normalizes, silently
-- (cause `rules`), a bounded batch of sessions whose facts are older. The
-- function calls this at the start of every drain.
create function app_public.group_eval_requeue_rules(p_rules_version integer, p_limit integer)
returns integer
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _stale record;
  _count integer := 0;
begin
  if p_rules_version is null or p_rules_version < 1 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'VALIDATION: p_rules_version must be >= 1 and p_limit between 1 and 1000' using errcode = 'P0001';
  end if;
  for _stale in
    select distinct f.member_user_id, f.session_id
      from app_public.group_set_facts f
     where f.rules_version < p_rules_version
       -- A fact whose share is gone (group hard-deleted) can never be
       -- requeued; skipping it keeps the batch from sticking on it.
       and exists (
         select 1 from app_public.group_session_shares sh
          where sh.member_user_id = f.member_user_id and sh.session_id = f.session_id)
       and not exists (
         select 1 from app_public.group_eval_queue q
          where q.kind = 'session' and q.member_user_id = f.member_user_id and q.session_id = f.session_id)
     limit p_limit
  loop
    if app_public.group_eval_enqueue_session(_stale.member_user_id, _stale.session_id, 'rules') then
      _count := _count + 1;
    end if;
  end loop;
  return _count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Function privileges and the sweep schedule
-- -----------------------------------------------------------------------------

do $grants$
declare
  _sig text;
begin
  -- Internal: owner (postgres) only. Triggers and the definer RPCs call them.
  foreach _sig in array array[
    'group_eval_try_uuid(text)',
    'group_set_fingerprint(text, text, text, bigint)',
    'group_eval_config(text)',
    'group_eval_set_url(text)',
    'group_eval_log_failure(text, uuid, jsonb)',
    'group_eval_enqueue_session(uuid, text, text)',
    'group_eval_enqueue_target(uuid, uuid, uuid, text)',
    'group_eval_kick()',
    'group_eval_kick_once(uuid)',
    'group_eval_sweep()',
    'group_eval_on_session()',
    'group_eval_on_session_exercise()',
    'group_eval_on_exercise_set()',
    'group_eval_on_exercise_definition()',
    'group_eval_on_exercise_group_link()',
    'group_eval_target_is_live(uuid, uuid, uuid)',
    'group_eval_session_targets(uuid, text, text[])',
    'group_eval_apply(uuid, uuid, uuid, text[])'
  ]
  loop
    execute format('revoke all on function app_public.%s from public, anon, authenticated, service_role', _sig);
  end loop;

  -- The evaluator's surface: service_role only (the group-eval function's key).
  foreach _sig in array array[
    'group_eval_check_secret(text)',
    'group_eval_claim(integer)',
    'group_eval_session_rows(uuid, text)',
    'group_eval_complete(bigint, bigint, jsonb)',
    'group_eval_fail(bigint, text)',
    'group_eval_requeue_rules(integer, integer)'
  ]
  loop
    execute format('revoke all on function app_public.%s from public, anon, authenticated', _sig);
    execute format('grant execute on function app_public.%s to service_role', _sig);
  end loop;
end
$grants$;

-- cron.schedule upserts by job name, so a re-run keeps one job.
select cron.schedule('group-eval-sweep', '30 seconds', 'select app_public.group_eval_sweep()');
