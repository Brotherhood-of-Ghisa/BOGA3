-- Group predictions: the weekly close and settlement, weekly results, the
-- ranking derivations and the reset. Rules:
-- docs/specs/tech/group-predictions-contract.md ("Week and timing",
-- "Markets", "Settlement and ranking"). SQL only: every figure is read from
-- the existing group sources; nothing here scores a set.

alter table app_public.group_prediction_boards
  add column closed_at timestamptz,
  add column settled_at timestamptz,
  add constraint group_prediction_boards_settled_closed check (settled_at is null or closed_at is not null);
create index group_prediction_boards_to_close on app_public.group_prediction_boards(starts_at) where closed_at is null;
create index group_prediction_boards_to_settle on app_public.group_prediction_boards(ends_at) where settled_at is null;

-- An e1RM line's baseline is frozen at close (value, unit and the comparison
-- revision it was read at). A matched market is settled once: its outcome and
-- the figure it was settled on.
alter table app_public.group_prediction_markets
  add column baseline_value numeric,
  add column baseline_unit text,
  add column baseline_rules_revision bigint,
  add column outcome text check (outcome in ('yes', 'no', 'void')),
  add column result_value numeric,
  add column result_unit text,
  add column settled_at timestamptz,
  add constraint group_prediction_markets_baseline check (
    (baseline_value is null) = (baseline_unit is null) and (baseline_value is null) = (baseline_rules_revision is null)
    and (baseline_value is null or (template = 'e1rm_line' and baseline_value > 0))),
  add constraint group_prediction_markets_settled check ((outcome is null) = (settled_at is null)
    and (outcome is not null or result_value is null) and (result_value is null) = (result_unit is null));

-- One row per AI that posted on a settled board: its profit (hundredths) and
-- its matches won, lost and voided. Profits of one board sum to zero.
create table app_public.group_prediction_results (
  group_id uuid not null,
  week_start date not null,
  bettor_id uuid not null references app_public.group_prediction_bettors(id) on delete cascade,
  profit_cents bigint not null,
  matched integer not null check (matched >= 0),
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  voids integer not null check (voids >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (group_id, week_start, bettor_id),
  foreign key (group_id, week_start) references app_public.group_prediction_boards(group_id, week_start) on delete cascade,
  check (matched = wins + losses + voids)
);
create index group_prediction_results_bettor on app_public.group_prediction_results(bettor_id);

-- Results are final: a settled board or market and a results row never
-- change (a reset deletes them).
create function app_public.group_prediction_preserve_final() returns trigger
language plpgsql set search_path = app_public, pg_temp as $$
begin
  -- Results rows have no settled_at: they are final from insert.
  if tg_table_name = 'group_prediction_results' then
    raise exception 'A settled prediction is final';
  elsif old.settled_at is not null then
    raise exception 'A settled prediction is final';
  end if;
  return new;
end $$;
create trigger group_prediction_boards_final before update on app_public.group_prediction_boards
  for each row execute function app_public.group_prediction_preserve_final();
create trigger group_prediction_markets_final before update on app_public.group_prediction_markets
  for each row execute function app_public.group_prediction_preserve_final();
create trigger group_prediction_results_final before update on app_public.group_prediction_results
  for each row execute function app_public.group_prediction_preserve_final();

-- ---------------------------------------------------------------------------
-- Figures (plain invokers, no client execute). Each reads an existing group
-- source over the member's completed, live sessions shared into the group
-- and started in [p_from_ms, p_to_ms) (no lower bound when p_from_ms is null).
-- ---------------------------------------------------------------------------

create function app_public.group_prediction_sessions(p_group uuid, p_member uuid, p_from_ms bigint, p_to_ms bigint)
returns table (member_user_id uuid, session_id text)
language sql stable set search_path = app_public, pg_temp as $$
  select s.owner_user_id, s.id
    from app_public.group_session_shares sh
    join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
   where sh.group_id = p_group and (p_member is null or sh.member_user_id = p_member)
     and s.deleted_at is null and s.status = 'completed'
     and (p_from_ms is null or s.started_at >= p_from_ms) and s.started_at < p_to_ms;
$$;

-- A member's working sets (group_week_session_counts, the week summary's rule).
create function app_public.group_prediction_week_sets(p_group uuid, p_member uuid, p_from_ms bigint, p_to_ms bigint)
returns integer
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(sum(c.working_sets), 0)::integer
    from app_public.group_prediction_sessions(p_group, p_member, p_from_ms, p_to_ms) ws
    cross join lateral app_public.group_week_session_counts(ws.member_user_id, ws.session_id) c;
$$;

-- The group's records, one per board taken (group_week_session_records, the
-- week summary's rule), over every member's sessions.
create function app_public.group_prediction_week_records(p_group uuid, p_from_ms bigint, p_to_ms bigint)
returns integer
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(sum(jsonb_array_length(r.record_json -> 'boards')), 0)::integer
    from app_public.group_prediction_sessions(p_group, null, p_from_ms, p_to_ms) ws
    cross join lateral app_public.group_week_session_records(p_group, ws.member_user_id, ws.session_id) r;
$$;

-- A member's best counting e1RM on a group exercise at one comparison
-- revision (group_metric_set_scores), in that revision's unit.
create function app_public.group_prediction_best_e1rm(p_group uuid, p_group_exercise uuid, p_revision bigint,
  p_member uuid, p_from_ms bigint, p_to_ms bigint)
returns table (value numeric, unit text)
language sql stable set search_path = app_public, pg_temp as $$
  select s.value, s.unit
    from app_public.group_metric_set_scores s
    join app_public.group_prediction_sessions(p_group, p_member, p_from_ms, p_to_ms) ws on ws.session_id = s.session_id
   where s.group_exercise_id = p_group_exercise and s.rules_revision = p_revision and s.member_user_id = p_member
     and s.metric = 'e1rm' and s.counting
   order by s.value desc
   limit 1;
$$;

-- Lead changes of an All board: `lead_change` events with reason `record`
-- that took #1 from a previous leader, whose record still stands
-- (group_week_session_records) and was set in a session that counts.
create function app_public.group_prediction_week_lead_changes(p_group uuid, p_group_exercise uuid, p_metric text,
  p_from_ms bigint, p_to_ms bigint)
returns integer
language sql stable set search_path = app_public, pg_temp as $$
  select count(*)::integer
    from app_public.group_prediction_sessions(p_group, null, p_from_ms, p_to_ms) ws
    cross join lateral app_public.group_week_session_records(p_group, ws.member_user_id, ws.session_id) r
    join app_public.group_events lc on lc.related_event_id = (r.record_json ->> 'key')::uuid
   where lc.group_id = p_group and lc.kind = 'lead_change' and not lc.certified and lc.reason = 'record'
     and lc.group_exercise_id = p_group_exercise and lc.metric = p_metric
     and jsonb_typeof(lc.payload -> 'previous') = 'object';
$$;

-- The week's CoW: the one not cancelled. A replaced CoW is the replacement.
create function app_public.group_prediction_week_cow(p_group uuid, p_week date) returns app_public.group_cows
language sql stable set search_path = app_public, pg_temp as $$
  select c.* from app_public.group_cows c where c.group_id = p_group and c.week_start = p_week and c.cancelled_at is null;
$$;

-- One matched market's outcome and the figure it was settled on (contract
-- "Markets").
create function app_public.group_prediction_market_outcome(p_market app_public.group_prediction_markets,
  p_board app_public.group_prediction_boards, out outcome text, out result_value numeric, out result_unit text)
language plpgsql stable set search_path = app_public, pg_temp as $$
declare _from bigint := app_public.group_prediction_ms(p_board.starts_at);
  _to bigint := app_public.group_prediction_ms(p_board.ends_at);
  _best record; _cow app_public.group_cows; _ranking jsonb;
begin
  outcome := 'void';
  if p_market.template = 'e1rm_line' then
    if p_market.baseline_value is null then return; end if;
    select b.value, b.unit into _best from app_public.group_prediction_best_e1rm(p_market.group_id,
      p_market.group_exercise_id, p_market.baseline_rules_revision, p_market.member_user_id, _from, _to) b;
    if _best.value is null or _best.unit is distinct from p_market.baseline_unit then return; end if;
    result_value := _best.value; result_unit := _best.unit;
    outcome := case when _best.value * 100 >= p_market.baseline_value * p_market.line then 'yes' else 'no' end;
  elsif p_market.template = 'sets_line' then
    result_value := app_public.group_prediction_week_sets(p_market.group_id, p_market.member_user_id, _from, _to);
    result_unit := 'sets';
    outcome := case when result_value >= p_market.line then 'yes' else 'no' end;
  elsif p_market.template = 'records_line' then
    result_value := app_public.group_prediction_week_records(p_market.group_id, _from, _to);
    result_unit := 'records';
    outcome := case when result_value >= p_market.line then 'yes' else 'no' end;
  elsif p_market.template = 'lead_change' then
    result_value := app_public.group_prediction_week_lead_changes(p_market.group_id, p_market.group_exercise_id,
      p_market.metric, _from, _to);
    result_unit := 'lead_changes';
    outcome := case when result_value > 0 then 'yes' else 'no' end;
  elsif p_market.template = 'cow_top' then
    -- A cancel voids the markets matched before it; one first matched after a
    -- replacement settles on the replacement.
    if exists (select 1 from app_public.group_cows c where c.group_id = p_market.group_id
        and c.week_start = p_market.week_start and c.cancelled_at is not null
        and c.cancelled_at >= (select min(x.created_at) from app_public.group_prediction_matches x
          where x.market_id = p_market.id)) then
      return;
    end if;
    _cow := app_public.group_prediction_week_cow(p_market.group_id, p_market.week_start);
    if _cow.id is null or _cow.final_outcome is distinct from 'ready' or not (p_market.metric = any(_cow.metrics)) then
      return;
    end if;
    select r into _ranking from jsonb_array_elements(_cow.final_rankings) r where r ->> 'metric' = p_market.metric;
    if _ranking is null or jsonb_array_length(_ranking -> 'entries') = 0 then return; end if;
    result_value := (select (e ->> 'rank')::numeric from jsonb_array_elements(_ranking -> 'entries') e
      where e ->> 'memberId' = p_market.member_user_id::text);
    result_unit := case when result_value is not null then 'place' end;
    outcome := case when result_value = 1 then 'yes' else 'no' end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Close and settle. Each takes the clock (tests move it) and the group's
-- prediction lock, so it serializes with posts and withdrawals.
-- ---------------------------------------------------------------------------

-- At the board's start: expire every open remainder and freeze each e1RM
-- line's baseline (the member's best from sessions started before the week).
create function app_public.group_prediction_close_at(p_now timestamptz, p_group uuid, p_week date) returns boolean
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _board app_public.group_prediction_boards; _m record; _best record; _revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('group-prediction:' || p_group::text, 0));
  select * into _board from app_public.group_prediction_boards b
   where b.group_id = p_group and b.week_start = p_week for update;
  if not found or _board.closed_at is not null or p_now < _board.starts_at then
    return false;
  end if;
  update app_public.group_prediction_offers o
     set released_cents = o.released_cents + o.remaining_cents, remaining_cents = 0,
         released_at = p_now, release_reason = 'expired'
    from app_public.group_prediction_markets m
   where m.id = o.market_id and m.group_id = p_group and m.week_start = p_week
     and o.remaining_cents > 0 and o.released_at is null;
  for _m in select m.id, m.group_exercise_id, m.member_user_id from app_public.group_prediction_markets m
     where m.group_id = p_group and m.week_start = p_week and m.template = 'e1rm_line' order by m.id loop
    select ge.published_rules_revision into _revision from app_public.group_exercises ge where ge.id = _m.group_exercise_id;
    select b.value, b.unit into _best from app_public.group_prediction_best_e1rm(p_group, _m.group_exercise_id, _revision,
      _m.member_user_id, null, app_public.group_prediction_ms(_board.starts_at)) b;
    if _best.value is not null then
      update app_public.group_prediction_markets set baseline_value = _best.value, baseline_unit = _best.unit,
        baseline_rules_revision = _revision where id = _m.id;
    end if;
  end loop;
  update app_public.group_prediction_boards set closed_at = p_now where group_id = p_group and week_start = p_week;
  return true;
end $$;

-- After the board's end: settle every matched market once and store each
-- AI's week. Waits (returns false) while a matched `cow_top` market's CoW is
-- not final yet.
create function app_public.group_prediction_settle_at(p_now timestamptz, p_group uuid, p_week date) returns boolean
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _board app_public.group_prediction_boards; _m app_public.group_prediction_markets; _o record;
  _cow app_public.group_cows;
begin
  perform pg_advisory_xact_lock(hashtextextended('group-prediction:' || p_group::text, 0));
  select * into _board from app_public.group_prediction_boards b
   where b.group_id = p_group and b.week_start = p_week for update;
  if not found or _board.settled_at is not null or p_now < _board.ends_at then
    return false;
  end if;
  if _board.closed_at is null then
    perform app_public.group_prediction_close_at(p_now, p_group, p_week);
    select * into strict _board from app_public.group_prediction_boards b where b.group_id = p_group and b.week_start = p_week;
  end if;
  _cow := app_public.group_prediction_week_cow(p_group, p_week);
  if _cow.id is not null and _cow.finalized_at is null and exists (select 1 from app_public.group_prediction_markets m
      join app_public.group_prediction_matches x on x.market_id = m.id
     where m.group_id = p_group and m.week_start = p_week and m.template = 'cow_top') then
    return false;
  end if;
  for _m in select m.* from app_public.group_prediction_markets m
     where m.group_id = p_group and m.week_start = p_week
       and exists (select 1 from app_public.group_prediction_matches x where x.market_id = m.id)
     order by m.id loop
    select * into strict _o from app_public.group_prediction_market_outcome(_m, _board);
    update app_public.group_prediction_markets set outcome = _o.outcome, result_value = _o.result_value,
      result_unit = _o.result_unit, settled_at = p_now where id = _m.id;
  end loop;
  -- Per match the winner gains the loser's stake; a void moves nothing.
  insert into app_public.group_prediction_results(group_id, week_start, bettor_id, profit_cents, matched, wins, losses,
    voids, created_at)
  with sides as (
    select x.yes_bettor_id as bettor_id, 'yes' as side, x.yes_stake_cents as own, x.no_stake_cents as other, m.outcome
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = p_group and m.week_start = p_week
    union all
    select x.no_bettor_id, 'no', x.no_stake_cents, x.yes_stake_cents, m.outcome
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = p_group and m.week_start = p_week
  ), players as (
    select distinct o.bettor_id from app_public.group_prediction_offers o
      join app_public.group_prediction_markets m on m.id = o.market_id
     where m.group_id = p_group and m.week_start = p_week
  )
  select p_group, p_week, p.bettor_id,
    coalesce(sum(case when s.outcome = s.side then s.other when s.outcome <> 'void' then -s.own else 0 end), 0),
    count(s.side), count(*) filter (where s.outcome = s.side),
    count(*) filter (where s.outcome <> 'void' and s.outcome <> s.side), count(*) filter (where s.outcome = 'void'), p_now
  from players p left join sides s on s.bettor_id = p.bettor_id
  group by p.bettor_id;
  update app_public.group_prediction_boards set settled_at = p_now where group_id = p_group and week_start = p_week;
  return true;
end $$;

-- The sweep's work: every board due to close or settle at p_now. A group
-- whose prediction lock is busy waits for the next sweep; a board that fails
-- is logged and retried by the next sweep without stopping the others.
create function app_public.group_prediction_sweep_at(p_now timestamptz) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _b record; _closed integer := 0; _settled integer := 0; _waiting integer := 0; _failed integer := 0;
  _state text; _work jsonb;
begin
  for _b in select b.group_id, b.week_start, b.closed_at, b.ends_at from app_public.group_prediction_boards b
     where (b.closed_at is null and b.starts_at <= p_now) or (b.settled_at is null and b.ends_at <= p_now)
     order by b.starts_at, b.group_id limit 100 loop
    if not pg_try_advisory_xact_lock(hashtextextended('group-prediction:' || _b.group_id::text, 0)) then
      continue;
    end if;
    begin
      if _b.closed_at is null and app_public.group_prediction_close_at(p_now, _b.group_id, _b.week_start) then
        _closed := _closed + 1;
      end if;
      if _b.ends_at <= p_now then
        if app_public.group_prediction_settle_at(p_now, _b.group_id, _b.week_start) then
          _settled := _settled + 1;
        else
          _waiting := _waiting + 1;
        end if;
      end if;
    exception when others then
      get stacked diagnostics _state = returned_sqlstate;
      _failed := _failed + 1;
      begin
        insert into public.app_logs(level, source, event, message, context)
        values ('error', 'database', 'group.prediction_sweep_failed',
          'a prediction board failed to close or settle; the next sweep retries it',
          jsonb_build_object('group_id', _b.group_id, 'week_start', _b.week_start, 'sqlstate', _state));
      exception when others then
        raise warning 'group.prediction_sweep_failed (app_logs unavailable): %', _state;
      end;
    end;
  end loop;
  _work := jsonb_build_object('closed', _closed, 'settled', _settled, 'waiting', _waiting, 'failed', _failed);
  if _closed + _settled + _failed > 0 then
    insert into public.app_logs(level, source, event, message, context)
    values ('info', 'database', 'group.prediction_sweep_work', 'the backstop sweep closed or settled prediction boards', _work);
  end if;
  return _work;
end $$;

-- The hourly sweep's entry: never lets a prediction failure stop the eval kick.
create function app_public.group_prediction_sweep() returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
begin
  return app_public.group_prediction_sweep_at(clock_timestamp());
exception when others then
  raise warning 'group.prediction_sweep_failed';
  return null;
end $$;

-- The hourly group-eval sweep closes and settles prediction boards first, in
-- SQL, then kicks the evaluator as before.
create or replace function app_public.group_eval_sweep() returns boolean
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_prediction_sweep();
  if not exists(select 1 from app_public.group_cows where cancelled_at is null and finalized_at is null
    and starts_at<=now() and available_at<=now() and (lease_until is null or lease_until<now()))
    and not exists(select 1 from app_public.group_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_metric_eval_queue where available_at<=now() and (claimed_until is null or claimed_until<now()))
    and not exists(select 1 from app_public.group_eval_rules_state s where
      (select min(f.rules_version) from app_public.group_set_facts f)<s.rules_version
      and exists(select 1 from app_public.group_eval_rules_stale(s.rules_version,1))) then return false; end if;
  perform app_public.group_eval_kick('sweep'); return true;
end $$;

-- A post or withdrawal that waited on the lock while the board closed sees
-- the close: its clock was read before the wait.
create or replace function app_public.group_prediction_open_board(p_group uuid, p_week date, p_now timestamptz)
returns app_public.group_prediction_boards
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _zone text; _open date; _bounds tstzrange; _board app_public.group_prediction_boards;
begin
  select g.cow_time_zone into _zone from app_public.groups g where g.id = p_group;
  if _zone is null then
    raise exception 'VALIDATION: set the group time zone before predictions' using errcode = 'P0001';
  end if;
  if p_week is null then
    raise exception 'VALIDATION: choose the open week' using errcode = 'P0001';
  end if;
  _open := app_public.group_cow_week(_zone, p_now) + 7;
  if p_week < _open then
    raise exception 'CONFLICT: this board has closed' using errcode = 'P0001';
  end if;
  if p_week > _open then
    raise exception 'VALIDATION: only next week''s board is open' using errcode = 'P0001';
  end if;
  select * into _board from app_public.group_prediction_boards b where b.group_id = p_group and b.week_start = p_week;
  if not found then
    _bounds := app_public.group_cow_bounds(_zone, p_week);
    insert into app_public.group_prediction_boards(group_id, week_start, time_zone, starts_at, ends_at, created_at)
    values (p_group, p_week, _zone, lower(_bounds), upper(_bounds), p_now)
    returning * into _board;
  end if;
  if p_now >= _board.starts_at or _board.closed_at is not null then
    raise exception 'CONFLICT: this board has closed' using errcode = 'P0001';
  end if;
  return _board;
end $$;

create or replace function app_public.agent_group_prediction_withdraw_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid, p_offer_id uuid) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid; _offer app_public.group_prediction_offers; _week date; _starts timestamptz; _closed timestamptz;
  _freed integer := 0;
begin
  _bettor := app_public.group_prediction_enter(p_owner, p_client_id, p_group_id);
  select o.* into _offer from app_public.group_prediction_offers o
    join app_public.group_prediction_markets m on m.id = o.market_id
   where o.id = p_offer_id and m.group_id = p_group_id and o.bettor_id = _bettor
     for update of o;
  if not found then
    raise exception 'NOT_FOUND: offer not found' using errcode = 'P0001';
  end if;
  select b.week_start, b.starts_at, b.closed_at into strict _week, _starts, _closed from app_public.group_prediction_boards b
    join app_public.group_prediction_markets m on m.group_id = b.group_id and m.week_start = b.week_start
   where m.id = _offer.market_id;
  if p_now >= _starts or _closed is not null then
    raise exception 'CONFLICT: this board has closed' using errcode = 'P0001';
  end if;
  if _offer.remaining_cents > 0 and _offer.released_at is null then
    _freed := _offer.remaining_cents;
    update app_public.group_prediction_offers set released_cents = remaining_cents, remaining_cents = 0,
      released_at = p_now, release_reason = 'withdrawn'
    where id = _offer.id returning * into _offer;
  end if;
  return jsonb_build_object('offer', app_public.group_prediction_own_offer_json(_offer),
    'freed', app_public.group_prediction_points(_freed),
    'stake_left', app_public.group_prediction_points(10000 - app_public.group_prediction_exposure(_bettor, p_group_id, _week)));
end $$;

-- ---------------------------------------------------------------------------
-- Ranking derivations for the readers: all-time per AI (the sum of its
-- weeks) and head-to-head per pair of AIs (from settled matches).
-- ---------------------------------------------------------------------------

create function app_public.group_prediction_all_time(p_group uuid)
returns table (bettor_id uuid, profit_cents bigint, matched bigint, wins bigint, losses bigint, voids bigint, weeks bigint)
language sql stable set search_path = app_public, pg_temp as $$
  select r.bettor_id, sum(r.profit_cents)::bigint, sum(r.matched)::bigint, sum(r.wins)::bigint, sum(r.losses)::bigint,
    sum(r.voids)::bigint, count(*)
    from app_public.group_prediction_results r
   where r.group_id = p_group
   group by r.bettor_id;
$$;

create function app_public.group_prediction_head_to_head(p_group uuid)
returns table (bettor_id uuid, opponent_id uuid, matched bigint, wins bigint, losses bigint, voids bigint, profit_cents bigint)
language sql stable set search_path = app_public, pg_temp as $$
  with sides as (
    select x.yes_bettor_id as bettor_id, x.no_bettor_id as opponent_id, 'yes' as side,
      x.yes_stake_cents as own, x.no_stake_cents as other, m.outcome
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = p_group and m.outcome is not null
    union all
    select x.no_bettor_id, x.yes_bettor_id, 'no', x.no_stake_cents, x.yes_stake_cents, m.outcome
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = p_group and m.outcome is not null
  )
  select s.bettor_id, s.opponent_id, count(*), count(*) filter (where s.outcome = s.side),
    count(*) filter (where s.outcome <> 'void' and s.outcome <> s.side), count(*) filter (where s.outcome = 'void'),
    sum(case when s.outcome = s.side then s.other when s.outcome <> 'void' then -s.own else 0 end)::bigint
    from sides s
   group by s.bettor_id, s.opponent_id;
$$;

-- ---------------------------------------------------------------------------
-- The post-test reset (RUNBOOK): deletes one group's boards and with them its
-- markets, offers, matches and results. Keeps the setting and the bettors.
-- Service role or operator SQL only.
-- ---------------------------------------------------------------------------

create function app_public.group_predictions_reset(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _boards integer;
begin
  if auth.jwt() ->> 'client_id' is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot reset predictions' using errcode = 'P0001';
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED: the predictions reset is server-only' using errcode = 'P0001';
  end if;
  if p_group_id is null then
    raise exception 'VALIDATION: choose a group' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-prediction:' || p_group_id::text, 0));
  delete from app_public.group_prediction_boards where group_id = p_group_id;
  get diagnostics _boards = row_count;
  return jsonb_build_object('group_id', p_group_id, 'boards_deleted', _boards);
end $$;

-- ---------------------------------------------------------------------------
-- Posture: the new table closed to every API role; the reset service-role
-- only; every other new function internal.
-- ---------------------------------------------------------------------------

alter table app_public.group_prediction_results enable row level security;
revoke all on app_public.group_prediction_results from public, anon, authenticated, service_role;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and p.proname in ('group_prediction_preserve_final', 'group_prediction_sessions',
       'group_prediction_week_sets', 'group_prediction_week_records', 'group_prediction_best_e1rm',
       'group_prediction_week_lead_changes', 'group_prediction_week_cow', 'group_prediction_market_outcome',
       'group_prediction_close_at', 'group_prediction_settle_at', 'group_prediction_sweep_at', 'group_prediction_sweep',
       'group_prediction_open_board', 'agent_group_prediction_withdraw_at', 'group_prediction_all_time',
       'group_prediction_head_to_head', 'group_predictions_reset') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname = 'group_predictions_reset' then
      execute format('grant execute on function %s to service_role', f.signature);
    end if;
  end loop;
end $$;
