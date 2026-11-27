-- Meet scoring, the cutoff snapshot, Refresh results and the Meets
-- leaderboard. Rules: docs/specs/tech/group-meet-contract.md ("Scoring,
-- snapshot and refresh", "Meets leaderboard"); product fact [[meets.results]]
-- in docs/product/meets.md. Group storage rules 1-4 apply: no owner column,
-- no FK into Sync v2 tables, RLS on with no policies and nothing granted.
--
--   - Scores are the evaluator's: e1rm, Volume and seconds are the published
--     per-set comparison scores (group_metric_set_scores, the TS scorer under
--     the strict group policy); Weight is the Volume score per rep, in the
--     comparison's units; reps are the set facts' (set-facts.ts). SQL adds no
--     load, bodyweight or 1RM formula.
--   - Live standings are computed on read from the counting links. At the
--     cutoff the worker copies every set of every counting link, with its
--     group-exercise mapping and scored values, into the snapshot tables and
--     ranks every challenge into group_meet_standings; from then on results
--     come only from there.
--   - Timed transitions (`on`, `results`, the snapshot) run in SQL from the
--     group-eval worker, which the pg_net kick and the hourly sweep start.

-- ---------------------------------------------------------------------------
-- 1. Transition markers and storage.
-- ---------------------------------------------------------------------------

alter table app_public.group_meets
  add column on_at timestamptz,
  add column results_at timestamptz,
  add column finalized_at timestamptz;
-- The meets a transition may still be due for: what the sweep and the worker probe.
create index group_meets_pending on app_public.group_meets(starts_at, id)
  where cancelled_at is null and finalized_at is null;

create table app_public.group_meet_snapshots (
  meet_id uuid primary key references app_public.group_meets(id) on delete cascade,
  taken_at timestamptz not null,
  refreshed_at timestamptz,
  refreshed_by uuid references auth.users(id) on delete set null,
  refresh_count integer not null default 0 check (refresh_count >= 0),
  check ((refresh_count = 0) = (refreshed_at is null))
);

-- The counting sessions at the snapshot.
create table app_public.group_meet_snapshot_sessions (
  meet_id uuid not null references app_public.group_meet_snapshots(meet_id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  started_at_ms bigint not null,
  completed_at_ms bigint,
  primary key (meet_id, member_user_id, session_id)
);

-- Every live set of those sessions, all exercises, with the group exercise it
-- was linked to in the meet's group (null when unlinked) and its raw values.
create table app_public.group_meet_snapshot_sets (
  meet_id uuid not null,
  member_user_id uuid not null,
  session_id text not null,
  set_id text not null,
  session_exercise_id text not null,
  exercise_definition_id text,
  group_exercise_id uuid references app_public.group_exercises(id) on delete set null,
  exercise_order_index integer not null,
  set_order_index integer not null,
  set_created_at_ms bigint not null,
  performance jsonb not null check (jsonb_typeof(performance) = 'object'),
  primary key (meet_id, member_user_id, set_id),
  foreign key (meet_id, member_user_id, session_id)
    references app_public.group_meet_snapshot_sessions(meet_id, member_user_id, session_id) on delete cascade
);
create index group_meet_snapshot_sets_exercise on app_public.group_meet_snapshot_sets(meet_id, group_exercise_id);
create index group_meet_snapshot_sets_member on app_public.group_meet_snapshot_sets(member_user_id);

-- The set's qualifying scores under its group exercise's rules at the snapshot.
create table app_public.group_meet_snapshot_scores (
  meet_id uuid not null,
  member_user_id uuid not null,
  set_id text not null,
  metric text not null,
  value numeric not null check (value > 0 and value < 'Infinity'::numeric),
  unit text not null,
  primary key (meet_id, member_user_id, set_id, metric),
  foreign key (meet_id, member_user_id, set_id)
    references app_public.group_meet_snapshot_sets(meet_id, member_user_id, set_id) on delete cascade,
  constraint group_meet_snapshot_scores_unit check (
    metric = 'e1rm' and unit in ('kg', 'percent_bw') or metric = 'weight' and unit in ('kg', 'percent_bw')
    or metric = 'volume' and unit in ('kg_reps', 'percent_bw_reps') or metric = 'reps' and unit = 'reps'
    or metric = 'seconds' and unit = 'seconds')
);

-- Each challenge's ranking from the snapshot; places 1-3 are the trophies.
create table app_public.group_meet_standings (
  meet_id uuid not null references app_public.group_meet_snapshots(meet_id) on delete cascade,
  challenge_id uuid not null references app_public.group_meet_challenges(id) on delete cascade,
  member_user_id uuid not null,
  place integer not null check (place >= 1),
  set_id text not null,
  value numeric not null,
  unit text not null,
  primary key (challenge_id, member_user_id),
  foreign key (meet_id, member_user_id, set_id)
    references app_public.group_meet_snapshot_sets(meet_id, member_user_id, set_id) on delete cascade
);
create index group_meet_standings_podium on app_public.group_meet_standings(meet_id, place) where place <= 3;
create index group_meet_standings_member on app_public.group_meet_standings(member_user_id);

-- ---------------------------------------------------------------------------
-- 2. Scoring helpers (no client execute; they run inside the definer RPCs).
-- ---------------------------------------------------------------------------

-- Every live set of the meet's counting links at p_now, with the group
-- exercise its exercise is linked to in the meet's group at that moment.
create function app_public.group_meet_live_sets(p_meet app_public.group_meets, p_now timestamptz)
returns table(member_user_id uuid, session_id text, set_id text, session_exercise_id text,
  exercise_definition_id text, group_exercise_id uuid, session_started_at_ms bigint,
  exercise_order_index integer, set_order_index integer, set_created_at_ms bigint, performance jsonb, fingerprint text)
language sql stable set search_path = app_public, pg_temp as $$
  select c.member_user_id, se.session_id, es.id, se.id, se.exercise_definition_id, map.group_exercise_id,
    s.started_at, se.order_index, es.order_index, es.created_at,
    jsonb_build_object('weight_value', es.weight_value, 'reps_value', es.reps_value,
      'recording_mode', es.recording_mode, 'duration_sec', es.duration_sec,
      'performance_status', es.performance_status, 'set_type', es.set_type),
    app_public.group_legacy_set_fingerprint(es)
  from app_public.group_meet_counting_links(p_meet, p_now) c
  join app_public.sessions s on s.owner_user_id = c.member_user_id and s.id = c.session_id
  join app_public.session_exercises se
    on se.owner_user_id = c.member_user_id and se.session_id = c.session_id and se.deleted_at is null
  join app_public.exercise_sets es
    on es.owner_user_id = se.owner_user_id and es.session_exercise_id = se.id and es.deleted_at is null
  left join lateral (
    select ge.id as group_exercise_id
      from app_public.exercise_group_links l
      join app_public.group_exercises ge
        on ge.id = app_public.group_eval_try_uuid(l.group_exercise_id) and ge.group_id = p_meet.group_id
     where l.owner_user_id = c.member_user_id and l.exercise_definition_id = se.exercise_definition_id
       and lower(l.group_id) = p_meet.group_id::text and l.deleted_at is null
     order by l.id collate "C" limit 1) map on true;
$$;

-- The qualifying scores of one live set under its group exercise's current
-- published rules. e1rm, Volume and seconds are the evaluator's counting
-- scores, used only while they still describe the live set (an edit not yet
-- evaluated has none); Weight is that Volume per rep, as a total-load kg in the
-- comparison's entry mode or, normalized, the added load %BW the set display
-- shows; reps are the set facts' for a performed working set.
create function app_public.group_meet_set_scores(p_member uuid, p_set_id text, p_group_exercise uuid,
  p_session_exercise_id text, p_definition text, p_performance jsonb, p_fingerprint text)
returns table(metric text, value numeric, unit text)
language sql stable set search_path = app_public, pg_temp as $$
  with ge as (
    select x.* from app_public.group_exercises x
     where x.id = p_group_exercise and x.published_rules_revision = x.rules_revision
  ), scored as (
    select sc.metric, sc.value, sc.unit, (sc.performance->>'reps')::numeric as reps, ge.load_input_mode,
      ge.bodyweight_contribution
      from ge join app_public.group_metric_set_scores sc
        on sc.group_exercise_id = ge.id and sc.rules_revision = ge.rules_revision
       and sc.member_user_id = p_member and sc.set_id = p_set_id
     where sc.counting and sc.metric in ('e1rm', 'volume', 'seconds')
       and sc.performance->>'session_exercise_id' = p_session_exercise_id
       and sc.performance->>'exercise_definition_id' is not distinct from p_definition
       and sc.performance->>'weight_value' = p_performance->>'weight_value'
       and sc.performance->>'reps_value' = p_performance->>'reps_value'
       and (sc.performance->>'duration_sec') is not distinct from (p_performance->>'duration_sec')
       and (sc.performance->>'performance_status') is not distinct from (p_performance->>'performance_status')
  )
  select metric, value, unit from scored
  union all
  select 'weight', w.value, w.unit
    from scored, lateral (select
      trim_scale(case when scored.unit = 'percent_bw_reps'
        then greatest(0, scored.value / scored.reps - 100 * scored.bodyweight_contribution::numeric)
        else scored.value / scored.reps / case when scored.load_input_mode = 'per_side_load' then 2 else 1 end end) as value,
      case when scored.unit = 'percent_bw_reps' then 'percent_bw' else 'kg' end as unit) w
   where scored.metric = 'volume' and scored.reps > 0 and w.value > 0
  union all
  select 'reps', f.reps, 'reps'
    from app_public.group_set_facts f
   where p_group_exercise is not null and f.member_user_id = p_member and f.set_id = p_set_id
     and f.fingerprint = p_fingerprint and f.live and f.performed and f.working is not false and f.reps > 0;
$$;

-- Scored sets of a meet, live (read through to the members' rows) or from its
-- snapshot: one row per set and qualifying metric.
create function app_public.group_meet_scored_sets(p_meet app_public.group_meets, p_now timestamptz,
  p_from_snapshot boolean)
returns table(member_user_id uuid, session_id text, set_id text, exercise_definition_id text,
  group_exercise_id uuid, session_started_at_ms bigint, exercise_order_index integer, set_order_index integer,
  set_created_at_ms bigint, performance jsonb, metric text, value numeric, unit text)
language sql stable set search_path = app_public, pg_temp as $$
  select l.member_user_id, l.session_id, l.set_id, l.exercise_definition_id, l.group_exercise_id,
    l.session_started_at_ms, l.exercise_order_index, l.set_order_index, l.set_created_at_ms, l.performance,
    sc.metric, sc.value, sc.unit
    from app_public.group_meet_live_sets(p_meet, p_now) l
    cross join lateral app_public.group_meet_set_scores(l.member_user_id, l.set_id, l.group_exercise_id,
      l.session_exercise_id, l.exercise_definition_id, l.performance, l.fingerprint) sc
   where not p_from_snapshot and l.group_exercise_id is not null
  union all
  select ss.member_user_id, ss.session_id, ss.set_id, ss.exercise_definition_id, ss.group_exercise_id,
    se.started_at_ms, ss.exercise_order_index, ss.set_order_index, ss.set_created_at_ms, ss.performance,
    sc.metric, sc.value, sc.unit
    from app_public.group_meet_snapshot_sets ss
    join app_public.group_meet_snapshot_sessions se
      on se.meet_id = ss.meet_id and se.member_user_id = ss.member_user_id and se.session_id = ss.session_id
    join app_public.group_meet_snapshot_scores sc
      on sc.meet_id = ss.meet_id and sc.member_user_id = ss.member_user_id and sc.set_id = ss.set_id
   where p_from_snapshot and ss.meet_id = p_meet.id and ss.group_exercise_id is not null;
$$;

-- Each live challenge's ranking: every member's best qualifying set (board
-- order breaks a member's own ties), then competition ranking on the
-- full-precision value, so equal scores share a place and the next skips.
create function app_public.group_meet_rankings(p_meet app_public.group_meets, p_now timestamptz,
  p_from_snapshot boolean, p_challenge uuid default null)
returns table(challenge_id uuid, member_user_id uuid, place integer, set_id text, session_id text,
  exercise_definition_id text, performance jsonb, value numeric, unit text)
language sql stable set search_path = app_public, pg_temp as $$
  with best as (
    select distinct on (c.id, s.member_user_id) c.id as challenge_id, s.*
      from app_public.group_meet_challenges c
      join app_public.group_meet_scored_sets(p_meet, p_now, p_from_snapshot) s
        on s.group_exercise_id = c.group_exercise_id and s.metric = c.metric
     where c.meet_id = p_meet.id and c.removed_at is null and (p_challenge is null or c.id = p_challenge)
     order by c.id, s.member_user_id, s.value desc, s.session_started_at_ms, s.exercise_order_index,
       s.set_order_index, s.set_created_at_ms, s.set_id collate "C"
  )
  select b.challenge_id, b.member_user_id,
    (rank() over (partition by b.challenge_id order by b.value desc))::integer,
    b.set_id, b.session_id, b.exercise_definition_id, b.performance, b.value, b.unit
    from best b;
$$;

-- Rewrites the stored standings of one challenge (or all) from the snapshot.
create function app_public.group_meet_rescore(p_meet app_public.group_meets, p_challenge uuid default null)
returns void language plpgsql set search_path = app_public, pg_temp as $$
begin
  if not exists (select 1 from app_public.group_meet_snapshots where meet_id = p_meet.id) then
    return;
  end if;
  delete from app_public.group_meet_standings
   where meet_id = p_meet.id and (p_challenge is null or challenge_id = p_challenge);
  insert into app_public.group_meet_standings(meet_id, challenge_id, member_user_id, place, set_id, value, unit)
  select p_meet.id, r.challenge_id, r.member_user_id, r.place, r.set_id, r.value, r.unit
    from app_public.group_meet_rankings(p_meet, clock_timestamp(), true, p_challenge) r
  on conflict (challenge_id, member_user_id) do update
    set place = excluded.place, set_id = excluded.set_id, value = excluded.value, unit = excluded.unit;
end $$;

-- The evaluator has caught up with the meet's sources: no queued (unparked)
-- evaluation of a counting session, of a counting member's targets in the
-- group, or of one of the group's comparisons. Scores read before then could
-- miss the latest edit.
create function app_public.group_meet_sources_settled(p_meet app_public.group_meets, p_now timestamptz)
returns boolean language sql stable set search_path = app_public, pg_temp as $$
  with counting as materialized (select * from app_public.group_meet_counting_links(p_meet, p_now))
  select not exists (
      select 1 from counting c join app_public.group_eval_queue q
        on q.kind = 'session' and q.member_user_id = c.member_user_id and q.session_id = c.session_id
       where q.available_at < 'infinity'::timestamptz)
    and not exists (
      select 1 from app_public.group_eval_queue q
       where q.kind = 'target' and q.group_id = p_meet.group_id and q.available_at < 'infinity'::timestamptz
         and q.member_user_id in (select c.member_user_id from counting c))
    and not exists (
      select 1 from app_public.group_metric_eval_queue q
       where q.group_id = p_meet.group_id and q.available_at < 'infinity'::timestamptz);
$$;

-- Replaces the meet's snapshot with its counting links as they stand at p_now
-- and ranks every challenge from it, in one statement so the sessions, sets
-- and scores come from one read (its data-modifying CTEs always run). The
-- caller holds the meet row lock.
create function app_public.group_meet_take_snapshot(p_meet app_public.group_meets, p_now timestamptz,
  p_refreshed_by uuid) returns void
language plpgsql set search_path = app_public, pg_temp as $$
begin
  perform set_config('app.group_meet_snapshotting', 'on', true);
  delete from app_public.group_meet_snapshot_sessions where meet_id = p_meet.id;
  insert into app_public.group_meet_snapshots(meet_id, taken_at, refreshed_at, refreshed_by, refresh_count)
  values (p_meet.id, p_now, case when p_refreshed_by is not null then p_now end, p_refreshed_by,
    case when p_refreshed_by is not null then 1 else 0 end)
  on conflict (meet_id) do update set taken_at = excluded.taken_at,
    refreshed_at = coalesce(excluded.refreshed_at, app_public.group_meet_snapshots.refreshed_at),
    refreshed_by = case when excluded.refreshed_at is not null then excluded.refreshed_by
      else app_public.group_meet_snapshots.refreshed_by end,
    refresh_count = app_public.group_meet_snapshots.refresh_count + excluded.refresh_count;
  with sessions as (
    insert into app_public.group_meet_snapshot_sessions(meet_id, member_user_id, session_id, started_at_ms, completed_at_ms)
    select p_meet.id, c.member_user_id, c.session_id, s.started_at, s.completed_at
      from app_public.group_meet_counting_links(p_meet, p_now) c
      join app_public.sessions s on s.owner_user_id = c.member_user_id and s.id = c.session_id
    returning 1
  ), live as materialized (
    select * from app_public.group_meet_live_sets(p_meet, p_now)
  ), sets as (
    insert into app_public.group_meet_snapshot_sets(meet_id, member_user_id, session_id, set_id, session_exercise_id,
      exercise_definition_id, group_exercise_id, exercise_order_index, set_order_index, set_created_at_ms, performance)
    select p_meet.id, l.member_user_id, l.session_id, l.set_id, l.session_exercise_id, l.exercise_definition_id,
      l.group_exercise_id, l.exercise_order_index, l.set_order_index, l.set_created_at_ms, l.performance
      from live l
    returning 1
  )
  insert into app_public.group_meet_snapshot_scores(meet_id, member_user_id, set_id, metric, value, unit)
  select p_meet.id, l.member_user_id, l.set_id, sc.metric, sc.value, sc.unit
    from live l
    cross join lateral app_public.group_meet_set_scores(l.member_user_id, l.set_id, l.group_exercise_id,
      l.session_exercise_id, l.exercise_definition_id, l.performance, l.fingerprint) sc
   where l.group_exercise_id is not null;
  perform app_public.group_meet_rescore(p_meet);
  perform set_config('app.group_meet_snapshotting', '', true);
end $$;

-- The due transitions of one meet at p_now, under the caller's group and meet
-- row locks: the `on` item at the start, the `results` item at the end, the
-- snapshot at the cutoff once the evaluator has caught up (Refresh results,
-- p_refreshed_by, takes it again). Each fires once: its marker commits with
-- it. Returns what it did.
create function app_public.group_meet_advance_meet(p_meet app_public.group_meets, p_now timestamptz,
  p_refreshed_by uuid default null) returns text[]
language plpgsql set search_path = app_public, pg_temp as $$
declare _done text[] := '{}';
begin
  if p_meet.cancelled_at is not null then
    return _done;
  end if;
  if p_meet.on_at is null and p_meet.starts_at <= p_now then
    perform app_public.group_meet_stream_write(p_meet, 'on', p_meet.starts_at, null);
    update app_public.group_meets set on_at = p_now where id = p_meet.id;
    _done := _done || 'on'::text;
  end if;
  if p_meet.results_at is null and p_meet.ends_at <= p_now then
    perform app_public.group_meet_stream_write(p_meet, 'results', p_meet.ends_at, null);
    update app_public.group_meets set results_at = p_now where id = p_meet.id;
    _done := _done || 'results'::text;
  end if;
  if (p_meet.finalized_at is null or p_refreshed_by is not null) and app_public.group_meet_cutoff(p_meet) <= p_now then
    if app_public.group_meet_sources_settled(p_meet, p_now) then
      if p_refreshed_by is not null
         or not exists (select 1 from app_public.group_meet_snapshots where meet_id = p_meet.id) then
        perform app_public.group_meet_take_snapshot(p_meet, p_now, p_refreshed_by);
      end if;
      update app_public.group_meets set finalized_at = coalesce(finalized_at, p_now) where id = p_meet.id;
      _done := _done || 'snapshot'::text;
    else
      _done := _done || 'deferred'::text;
    end if;
  end if;
  return _done;
end $$;

-- A meet a transition may be due for: not cancelled, not final, in a live group.
create function app_public.group_meet_transition_due(p_meet app_public.group_meets, p_now timestamptz)
returns boolean language sql stable set search_path = app_public, pg_temp as $$
  select p_meet.cancelled_at is null and p_meet.finalized_at is null
    and (p_meet.on_at is null and p_meet.starts_at <= p_now
      or p_meet.results_at is null and p_meet.ends_at <= p_now
      or app_public.group_meet_cutoff(p_meet) <= p_now)
    and exists (select 1 from app_public.groups g where g.id = p_meet.group_id and g.deleted_at is null);
$$;

-- ---------------------------------------------------------------------------
-- 3. The worker's entry point and the sweep.
-- ---------------------------------------------------------------------------

-- Runs every due transition, each meet in its own subtransaction: a failure
-- logs a sanitized row and leaves that meet for the next run. A meet another
-- run holds is skipped; that run fires it. Group row then meet row, the order
-- the meet RPCs lock in.
create function app_public.group_meet_eval_advance(p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _picked record; _meet app_public.group_meets; _now timestamptz; _done text[];
  _on integer := 0; _results integer := 0; _snapshots integer := 0; _deferred integer := 0; _failed integer := 0;
  _code text;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'VALIDATION: invalid meet advance limit' using errcode = 'P0001';
  end if;
  for _picked in select m.id, m.group_id from app_public.group_meets m
      where m.cancelled_at is null and m.finalized_at is null and m.starts_at <= clock_timestamp()
        and app_public.group_meet_transition_due(m, clock_timestamp())
      order by m.starts_at, m.id limit p_limit loop
    begin
      perform 1 from app_public.groups g where g.id = _picked.group_id and g.deleted_at is null for no key update;
      if not found then continue; end if;
      select * into _meet from app_public.group_meets where id = _picked.id for update skip locked;
      if not found then continue; end if;
      _now := clock_timestamp();
      _done := app_public.group_meet_advance_meet(_meet, _now);
      _on := _on + case when 'on' = any(_done) then 1 else 0 end;
      _results := _results + case when 'results' = any(_done) then 1 else 0 end;
      _snapshots := _snapshots + case when 'snapshot' = any(_done) then 1 else 0 end;
      _deferred := _deferred + case when 'deferred' = any(_done) then 1 else 0 end;
    exception when others then
      get stacked diagnostics _code = returned_sqlstate;
      _failed := _failed + 1;
      perform app_public.group_eval_log_failure('group.meet_advance_failed', null,
        jsonb_build_object('meet_id', _picked.id, 'group_id', _picked.group_id, 'sqlstate', _code));
    end;
  end loop;
  return jsonb_build_object('on', _on, 'results', _results, 'snapshots', _snapshots,
    'deferred', _deferred, 'failed', _failed);
end $$;

-- The hourly backstop also kicks when a meet transition is due.
create or replace function app_public.group_eval_sweep() returns boolean
language plpgsql security definer set search_path = app_public, pg_temp as $$
begin
  if not exists(select 1 from app_public.group_cows where cancelled_at is null and finalized_at is null
    and starts_at<=now() and available_at<=now() and (lease_until is null or lease_until<now()))
    and not exists(select 1 from app_public.group_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_metric_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_meets m where m.cancelled_at is null and m.finalized_at is null
      and m.starts_at<=now() and app_public.group_meet_transition_due(m, now()))
    and not exists(select 1 from app_public.group_eval_rules_state s where
      (select min(f.rules_version) from app_public.group_set_facts f)<s.rules_version
      and exists(select 1 from app_public.group_eval_rules_stale(s.rules_version,1))) then return false; end if;
  perform app_public.group_eval_kick('sweep'); return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Rescoring: a challenge change after the snapshot, and a member's
-- deletion (account deletion cascades; dev_wipe_my_data deletes explicitly).
-- ---------------------------------------------------------------------------

create function app_public.group_meet_challenge_rescore() returns trigger
language plpgsql security definer set search_path = app_public, pg_temp as $$
declare _meet app_public.group_meets;
begin
  select * into _meet from app_public.group_meets where id = new.meet_id;
  if found then
    perform app_public.group_meet_rescore(_meet, new.id);
  end if;
  return null;
end $$;
create trigger group_meet_challenges_rescore
  after insert or update of group_exercise_id, metric, removed_at on app_public.group_meet_challenges
  for each row execute function app_public.group_meet_challenge_rescore();

-- Deleted snapshot sets (an account or wipe) rerank the meets they were in;
-- a snapshot being rewritten reranks itself.
create function app_public.group_meet_snapshot_sets_deleted() returns trigger
language plpgsql security definer set search_path = app_public, pg_temp as $$
declare _meet app_public.group_meets;
begin
  if coalesce(current_setting('app.group_meet_snapshotting', true), '') = 'on' then
    return null;
  end if;
  for _meet in select m.* from app_public.group_meets m
      where m.id in (select distinct g.meet_id from gone g) order by m.id loop
    perform app_public.group_meet_rescore(_meet);
  end loop;
  return null;
end $$;
create trigger group_meet_snapshot_sets_deleted
  after delete on app_public.group_meet_snapshot_sets
  referencing old table as gone
  for each statement execute function app_public.group_meet_snapshot_sets_deleted();

do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised := replace(definition,
    $anchor$  delete from app_public.session_meet_links where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.group_meet_snapshot_sessions where member_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.session_meet_links where owner_user_id = _uid;$patch$);
  if revised = definition then
    raise exception 'group meet snapshot dev_wipe_my_data patch anchor missing';
  end if;
  execute revised;
end $migration$;

-- ---------------------------------------------------------------------------
-- 5. Reads and Refresh results.
-- ---------------------------------------------------------------------------

-- The current kg rule for one member's figures on one group exercise: the
-- groups.kg-disclosure answer, plus a kg score's exercise now counting
-- bodyweight (as CoW results).
create function app_public.group_meet_hides_kg(p_group uuid, p_member uuid, p_definition text,
  p_group_exercise uuid) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_competition_redacts_exercise(array[p_group], p_member, p_definition)
    or exists (select 1 from app_public.groups g join app_public.group_exercises ge on ge.group_id = g.id
      where g.id = p_group and g.bodyweight_calculations_enabled and ge.id = p_group_exercise
        and ge.bodyweight_contribution > 0);
$$;

create function app_public.group_meet_current_member(p_group uuid, p_member uuid) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  select exists (select 1 from app_public.group_memberships m
    where m.group_id = p_group and m.user_id = p_member and m.ended_at is null);
$$;

-- One standings row as the readers return it: the place stands even when the
-- figures are hidden.
create function app_public.group_meet_standing_json(p_group uuid, p_group_exercise uuid, p_member uuid,
  p_place integer, p_set_id text, p_session_id text, p_definition text, p_performance jsonb,
  p_value numeric, p_unit text) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  with rule as (select app_public.group_meet_hides_kg(p_group, p_member, p_definition, p_group_exercise) as hides)
  select jsonb_build_object('place', p_place, 'member', app_public.group_member_ref_json(p_member),
    'current_member', app_public.group_meet_current_member(p_group, p_member),
    'value', case when rule.hides and p_unit in ('kg', 'kg_reps') then null else p_value end,
    'unit', p_unit, 'unavailable', rule.hides and p_unit in ('kg', 'kg_reps'),
    'set', jsonb_build_object('set_id', p_set_id, 'session_id', p_session_id,
      'recording_mode', coalesce(p_performance->>'recording_mode', 'reps'),
      'reps_value', p_performance->>'reps_value',
      'duration_sec', p_performance->'duration_sec',
      'weight_value', case when rule.hides then null else p_performance->>'weight_value' end),
    'certified', exists (select 1 from app_public.group_metric_certifications gc
      where gc.group_exercise_id = p_group_exercise and gc.member_user_id = p_member and gc.set_id = p_set_id
        and gc.ended_at is null))
  from rule;
$$;

-- The group records set in the counting sessions, figures under the kg rule.
create function app_public.group_meet_records_json(p_group uuid, p_sessions jsonb) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(x.member_user_id),
      'session_id', x.session_id, 'set_id', r.record_json->>'set_id',
      'group_exercise_id', r.record_json->'group_exercise'->'group_exercise_id',
      'exercise_name', r.record_json->'group_exercise'->'name',
      'boards', (select coalesce(jsonb_agg(jsonb_build_object('metric', b->>'metric', 'unit', b->>'unit',
          'value', case when hide.hides and b->>'unit' in ('kg', 'kg_reps') then null else b->'value' end,
          'unavailable', hide.hides and b->>'unit' in ('kg', 'kg_reps')) order by b->>'metric'), '[]'::jsonb)
        from jsonb_array_elements(r.record_json->'boards') b))
      order by x.started_at_ms, x.member_user_id, r.seq), '[]'::jsonb)
  from jsonb_to_recordset(p_sessions) as x(member_user_id uuid, session_id text, started_at_ms bigint)
  cross join lateral app_public.group_week_session_records(p_group, x.member_user_id, x.session_id) r
  cross join lateral (select app_public.group_meet_hides_kg(p_group, x.member_user_id,
      (select se.exercise_definition_id from app_public.exercise_sets es
         join app_public.session_exercises se on se.owner_user_id = es.owner_user_id and se.id = es.session_exercise_id
        where es.owner_user_id = x.member_user_id and es.id = r.record_json->>'set_id'),
      (r.record_json->'group_exercise'->>'group_exercise_id')::uuid) as hides) hide;
$$;

-- A meet's results for a current member: per live challenge the ranked rows,
-- the caption state, the counting sessions and the records set in them. Live
-- until the snapshot exists, then only from it.
create function app_public.group_meet_results_json(p_meet app_public.group_meets, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = app_public, pg_temp as $$
declare _snapshot app_public.group_meet_snapshots; _final boolean; _rows jsonb; _sessions jsonb; _state text;
begin
  select * into _snapshot from app_public.group_meet_snapshots where meet_id = p_meet.id;
  _final := found and p_meet.cancelled_at is null;
  _state := case when p_meet.cancelled_at is not null then 'cancelled'
    when _final and _snapshot.refreshed_at is not null then 'refreshed'
    when _final then 'final'
    when p_now < p_meet.starts_at then 'scheduled'
    when p_now < p_meet.ends_at then 'live'
    else 'so_far' end;
  if p_meet.cancelled_at is not null then
    _rows := '[]'::jsonb;
  elsif _final then
    select coalesce(jsonb_object_agg(x.challenge_id, x.rows), '{}'::jsonb) into _rows from (
      select st.challenge_id, jsonb_agg(app_public.group_meet_standing_json(p_meet.group_id, ss.group_exercise_id,
          st.member_user_id, st.place, st.set_id, ss.session_id, ss.exercise_definition_id, ss.performance,
          st.value, st.unit)
        order by st.place, (select p.username from app_public.user_profiles p where p.id = st.member_user_id) collate "C" nulls last,
          st.member_user_id) as rows
        from app_public.group_meet_standings st
        join app_public.group_meet_snapshot_sets ss
          on ss.meet_id = st.meet_id and ss.member_user_id = st.member_user_id and ss.set_id = st.set_id
       where st.meet_id = p_meet.id
       group by st.challenge_id) x;
    select coalesce(jsonb_agg(jsonb_build_object('member_user_id', s.member_user_id, 'session_id', s.session_id,
        'started_at_ms', s.started_at_ms, 'completed_at_ms', s.completed_at_ms)
        order by s.started_at_ms, s.member_user_id, s.session_id collate "C"), '[]'::jsonb) into _sessions
      from app_public.group_meet_snapshot_sessions s where s.meet_id = p_meet.id;
  else
    select coalesce(jsonb_object_agg(x.challenge_id, x.rows), '{}'::jsonb) into _rows from (
      select r.challenge_id, jsonb_agg(app_public.group_meet_standing_json(p_meet.group_id, c.group_exercise_id,
          r.member_user_id, r.place, r.set_id, r.session_id, r.exercise_definition_id, r.performance, r.value, r.unit)
        order by r.place, (select p.username from app_public.user_profiles p where p.id = r.member_user_id) collate "C" nulls last,
          r.member_user_id) as rows
        from app_public.group_meet_rankings(p_meet, p_now, false) r
        join app_public.group_meet_challenges c on c.id = r.challenge_id
       group by r.challenge_id) x;
    select coalesce(jsonb_agg(jsonb_build_object('member_user_id', c.member_user_id, 'session_id', c.session_id,
        'started_at_ms', s.started_at, 'completed_at_ms', s.completed_at)
        order by s.started_at, c.member_user_id, c.session_id collate "C"), '[]'::jsonb) into _sessions
      from app_public.group_meet_counting_links(p_meet, p_now) c
      join app_public.sessions s on s.owner_user_id = c.member_user_id and s.id = c.session_id;
  end if;
  _sessions := coalesce(_sessions, '[]'::jsonb);
  return jsonb_build_object('meet', app_public.group_meet_json(p_meet),
    'results', jsonb_build_object('state', _state,
      'final_at_ms', app_public.group_meet_ms(app_public.group_meet_cutoff(p_meet)),
      'refreshed_at_ms', case when _final then app_public.group_meet_ms(_snapshot.refreshed_at) end,
      'refreshed_by', case when _final then app_public.group_meet_member_ref(_snapshot.refreshed_by) end),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('challenge', app_public.group_meet_challenge_json(c),
        'standings', coalesce(_rows -> c.id::text, '[]'::jsonb)) order by c.created_at, c.id)
      from app_public.group_meet_challenges c where c.meet_id = p_meet.id and c.removed_at is null), '[]'::jsonb),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(x.member_user_id),
        'current_member', app_public.group_meet_current_member(p_meet.group_id, x.member_user_id),
        'session_id', x.session_id, 'started_at_ms', x.started_at_ms, 'completed_at_ms', x.completed_at_ms)
        order by x.started_at_ms, x.member_user_id, x.session_id collate "C"), '[]'::jsonb)
      from jsonb_to_recordset(_sessions) as x(member_user_id uuid, session_id text,
        started_at_ms bigint, completed_at_ms bigint)),
    'records', case when p_meet.cancelled_at is null then app_public.group_meet_records_json(p_meet.group_id, _sessions)
      else '[]'::jsonb end);
end $$;

create function app_public.group_meet_results(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _meet app_public.group_meets;
begin
  perform app_public.group_meet_require_reader(p_group_id, _uid);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  return app_public.group_meet_results_json(_meet, clock_timestamp());
end $$;

-- Refresh results (owners and admins, after the cutoff): re-snapshot the
-- counting links as they stand now, rerank, and write one stream item. Before
-- the cutoff results are still live, so there is nothing to refresh.
create function app_public.group_meet_refresh_results(p_group_id uuid, p_meet_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _meet app_public.group_meets; _now timestamptz;
begin
  perform app_public.group_meet_require_manager(p_group_id, _uid);
  select * into _meet from app_public.group_meets where id = p_meet_id and group_id = p_group_id for update;
  if not found then
    raise exception 'NOT_FOUND: meet not found' using errcode = 'P0001';
  end if;
  if _meet.cancelled_at is not null then
    raise exception 'CONFLICT: this meet was cancelled' using errcode = 'P0001';
  end if;
  _now := clock_timestamp();
  if _now < app_public.group_meet_cutoff(_meet) then
    raise exception 'CONFLICT: results stay live until the cutoff' using errcode = 'P0001';
  end if;
  -- The worker's transitions not run yet come first, in order; the snapshot
  -- waits for the evaluator to catch up.
  if not ('snapshot' = any(app_public.group_meet_advance_meet(_meet, _now, _uid))) then
    raise exception 'CONFLICT: results are still being calculated; try again shortly' using errcode = 'P0001';
  end if;
  select * into _meet from app_public.group_meets where id = _meet.id;
  perform app_public.group_meet_stream_write(_meet, 'results_refreshed', _now, _uid);
  return app_public.group_meet_results_json(_meet, _now);
end $$;

-- The Meets leaderboard: members ranked by trophies (places 1-3) across the
-- group's final meets, gold then silver then bronze; equal tuples share a
-- rank, ordered by name then ID. Former members stay, marked. Each row lists
-- its trophies with their meets.
create function app_public.group_meet_leaderboard(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user();
begin
  perform app_public.group_meet_require_reader(p_group_id, _uid);
  return jsonb_build_object('rows', coalesce((
    with podium as (
      select st.member_user_id, st.place, st.challenge_id, m.id as meet_id, m.title, m.venue_name, m.starts_at,
        c.group_exercise_id, c.metric
        from app_public.group_meets m
        join app_public.group_meet_standings st on st.meet_id = m.id and st.place <= 3
        join app_public.group_meet_challenges c on c.id = st.challenge_id and c.removed_at is null
       where m.group_id = p_group_id and m.cancelled_at is null and m.finalized_at is not null
    ), tally as (
      select member_user_id, count(*) filter (where place = 1) as gold, count(*) filter (where place = 2) as silver,
        count(*) filter (where place = 3) as bronze
        from podium group by member_user_id
    ), ranked as (
      select t.*, rank() over (order by gold desc, silver desc, bronze desc) as rank,
        (select p.username from app_public.user_profiles p where p.id = t.member_user_id) as username
        from tally t
    )
    select jsonb_agg(jsonb_build_object('rank', r.rank, 'member', app_public.group_member_ref_json(r.member_user_id),
        'current_member', app_public.group_meet_current_member(p_group_id, r.member_user_id),
        'gold', r.gold, 'silver', r.silver, 'bronze', r.bronze,
        'trophies', (select jsonb_agg(jsonb_build_object('place', p.place, 'meet_id', p.meet_id, 'title', p.title,
            'venue_name', p.venue_name, 'starts_at_ms', app_public.group_meet_ms(p.starts_at),
            'challenge_id', p.challenge_id, 'group_exercise_id', p.group_exercise_id,
            'exercise_name', (select ge.name from app_public.group_exercises ge where ge.id = p.group_exercise_id),
            'metric', p.metric) order by p.starts_at desc, p.meet_id, p.place, p.challenge_id)
          from podium p where p.member_user_id = r.member_user_id))
        order by r.rank, r.username collate "C" nulls last, r.member_user_id)
      from ranked r), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Posture: tables closed to clients; only the reads and Refresh are
-- client-executable; the worker's entry point is the service role's.
-- ---------------------------------------------------------------------------

do $$
declare t text; f record;
begin
  foreach t in array array['group_meet_snapshots', 'group_meet_snapshot_sessions', 'group_meet_snapshot_sets',
      'group_meet_snapshot_scores', 'group_meet_standings'] loop
    execute format('alter table app_public.%I enable row level security', t);
    execute format('revoke all on app_public.%I from public, anon, authenticated, service_role', t);
  end loop;
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and p.proname in ('group_meet_live_sets', 'group_meet_set_scores',
       'group_meet_scored_sets', 'group_meet_rankings', 'group_meet_rescore', 'group_meet_sources_settled',
       'group_meet_take_snapshot', 'group_meet_advance_meet', 'group_meet_transition_due', 'group_meet_eval_advance',
       'group_meet_challenge_rescore', 'group_meet_snapshot_sets_deleted', 'group_meet_hides_kg',
       'group_meet_current_member', 'group_meet_standing_json', 'group_meet_records_json', 'group_meet_results_json',
       'group_meet_results', 'group_meet_refresh_results', 'group_meet_leaderboard') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('group_meet_results', 'group_meet_refresh_results', 'group_meet_leaderboard') then
      execute format('grant execute on function %s to anon, authenticated', f.signature);
    elsif f.proname = 'group_meet_eval_advance' then
      execute format('grant execute on function %s to service_role', f.signature);
    end if;
  end loop;
end $$;
