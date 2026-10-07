-- A GROUP_EVAL_RULES_VERSION bump drains to completion without member activity
-- once the new group-eval has run once (a kick after deploy starts it).
--
-- group-eval requeues at most 50 stale sessions per run (group_eval_requeue_rules)
-- and the sweep kicked only for queued work, so once the first batch drained the
-- rest waited for an unrelated kick (hosted, 2026-10-06: 57 facts in 7 sessions
-- after the 5 → 6 bump). SQL cannot read the TS constant, so each requeue now
-- records the version its caller runs with, and the sweep also kicks while a
-- shared session has facts older than it and no queued job. Sessions with a
-- queued job, parked ones included, are excluded on both sides: a parked job
-- keeps its attempt cap and never makes the sweep kick.

create table app_public.group_eval_rules_state (
  singleton     boolean primary key default true,
  rules_version integer not null,
  updated_at    timestamptz not null default now(),
  constraint group_eval_rules_state_singleton check (singleton),
  constraint group_eval_rules_state_rules_version_positive check (rules_version > 0)
);

comment on table app_public.group_eval_rules_state is
  'The GROUP_EVAL_RULES_VERSION group-eval last ran with, written by group_eval_requeue_rules; the sweep kicks while older set facts remain. One row. Server-only.';

alter table app_public.group_eval_rules_state enable row level security;
revoke all on table app_public.group_eval_rules_state from public, anon, authenticated;

-- Shared sessions with facts older than p_rules_version and no queued job: the
-- one predicate behind the requeue and the sweep. A fact whose share is gone
-- (group hard-deleted) can never be requeued; skipping it keeps the batch from
-- sticking on it.
create function app_public.group_eval_rules_stale(p_rules_version integer, p_limit integer)
returns table (member_user_id uuid, session_id text)
language sql
stable
security definer
set search_path = app_public, pg_temp
as $$
  select distinct f.member_user_id, f.session_id
    from app_public.group_set_facts f
   where f.rules_version < p_rules_version
     and exists (
       select 1 from app_public.group_session_shares sh
        where sh.member_user_id = f.member_user_id and sh.session_id = f.session_id)
     and not exists (
       select 1 from app_public.group_eval_queue q
        where q.kind = 'session' and q.member_user_id = f.member_user_id and q.session_id = f.session_id)
   limit p_limit
$$;

-- A rules bump (GROUP_EVAL_RULES_VERSION in the TS) re-normalizes, silently
-- (cause `rules`), a bounded batch of sessions whose facts are older. The
-- function calls this at the start of every drain, so the recorded version is
-- the one the deployed function runs with.
create or replace function app_public.group_eval_requeue_rules(p_rules_version integer, p_limit integer)
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
  -- Written only when the version changes: a drain is not a write.
  insert into app_public.group_eval_rules_state as s (singleton, rules_version)
  values (true, p_rules_version)
  on conflict (singleton) do update
    set rules_version = excluded.rules_version, updated_at = now()
    where s.rules_version <> excluded.rules_version;
  for _stale in select * from app_public.group_eval_rules_stale(p_rules_version, p_limit)
  loop
    if app_public.group_eval_enqueue_session(_stale.member_user_id, _stale.session_id, 'rules') then
      _count := _count + 1;
    end if;
  end loop;
  return _count;
end;
$$;

-- pg_cron backstop (every 5 minutes): one kick when claimable work exists
-- (never claimed, lease expired, or backoff elapsed) or a rules requeue is owed.
create or replace function app_public.group_eval_sweep()
returns boolean language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if not exists (select 1 from app_public.group_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now()))
    and not exists (select 1 from app_public.group_metric_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now()))
    and not exists (select 1 from app_public.group_eval_rules_state s
    cross join lateral app_public.group_eval_rules_stale(s.rules_version, 1)) then return false; end if;
  perform app_public.group_eval_kick();
  return true;
end;
$$;

-- Internal: owner (postgres) only; the requeue and the sweep call it.
revoke all on function app_public.group_eval_rules_stale(integer, integer) from public, anon, authenticated, service_role;
