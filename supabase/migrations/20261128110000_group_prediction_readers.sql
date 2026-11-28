-- Group predictions: the member read path. Four client-executable readers
-- (board, market thread, ranking, history) over the existing prediction
-- tables. Rules: docs/specs/tech/group-predictions-contract.md ("Access",
-- "Member screens"); product fact [[agents.group-predictions]]. Members only:
-- an OAuth claim is AGENT_FORBIDDEN, a non-member or a group with Predictions
-- off is the same NOT_FOUND. Notes are shown (members only); a walk-away price
-- is selected nowhere. Nothing here changes a table or an existing function.

-- ---------------------------------------------------------------------------
-- Helpers (plain invokers, no client execute). They run inside the definer
-- readers below, which do the caller checks.
-- ---------------------------------------------------------------------------

-- A current member of a group with Predictions on, else the one NOT_FOUND
-- (byte-identical to a missing group). Takes the group row KEY SHARE, like the
-- setting read: the setting write locks it FOR UPDATE.
create function app_public.group_prediction_require_reader(p_group uuid, p_user uuid) returns text
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _role text;
begin
  perform 1 from app_public.groups g where g.id = p_group and g.deleted_at is null for key share;
  _role := app_public.group_require_member(p_group, p_user, false);
  if not coalesce((select s.enabled from app_public.group_prediction_settings s where s.group_id = p_group), false) then
    raise exception 'NOT_FOUND: group not found' using errcode = 'P0001';
  end if;
  return _role;
end $$;

-- An AI as members see it: the bettor's name and whether its user is still a
-- member of the group.
create function app_public.group_prediction_reader_bettor_json(p_bettor uuid, p_group uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_prediction_bettor_json(b.id) || jsonb_build_object('current_member',
    exists (select 1 from app_public.group_memberships gm
      where gm.group_id = p_group and gm.user_id = b.user_id and gm.ended_at is null))
  from app_public.group_prediction_bettors b
  where b.id = p_bettor;
$$;

-- A market with what a statement is built from (the member and the exercise
-- name) and, once known, its frozen baseline and its settled outcome.
create function app_public.group_prediction_reader_market_json(p_market app_public.group_prediction_markets) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_prediction_market_json(p_market) || jsonb_build_object(
    'member', case when p_market.member_user_id is not null
      then app_public.group_member_ref_json(p_market.member_user_id) end,
    'exercise_name', (select ge.name from app_public.group_exercises ge where ge.id = p_market.group_exercise_id),
    'baseline', case when p_market.baseline_value is not null
      then jsonb_build_object('value', p_market.baseline_value, 'unit', p_market.baseline_unit) end,
    'outcome', p_market.outcome, 'result_value', p_market.result_value, 'result_unit', p_market.result_unit);
$$;

-- An offer as members see it: its note, never its walk-away price. `live` is
-- whether it can still fill (its AI's user has been a member without a break
-- since it was posted).
create function app_public.group_prediction_reader_offer_json(p_offer app_public.group_prediction_offers, p_group uuid)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('offer_id', p_offer.id, 'market_id', p_offer.market_id,
    'bettor', app_public.group_prediction_reader_bettor_json(p_offer.bettor_id, p_group),
    'side', p_offer.side, 'price', p_offer.price,
    'stake', app_public.group_prediction_points(p_offer.stake_cents),
    'remaining', app_public.group_prediction_points(p_offer.remaining_cents),
    'matched', app_public.group_prediction_points(p_offer.stake_cents - p_offer.remaining_cents - p_offer.released_cents),
    'released', app_public.group_prediction_points(p_offer.released_cents),
    'state', case when p_offer.release_reason is not null then p_offer.release_reason
      when p_offer.remaining_cents = 0 then 'filled' else 'open' end,
    'live', p_offer.release_reason is null and p_offer.remaining_cents > 0
      and app_public.group_prediction_offer_live(p_offer, p_group),
    'answers_offer_id', p_offer.answers_offer_id, 'note', p_offer.note,
    'created_at_ms', app_public.group_prediction_ms(p_offer.created_at),
    'released_at_ms', case when p_offer.released_at is not null then app_public.group_prediction_ms(p_offer.released_at) end);
$$;

-- A match with both AIs and, once its market is settled, the winning side
-- (null while pending and for a void market).
create function app_public.group_prediction_reader_match_json(p_match app_public.group_prediction_matches, p_group uuid)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('match_id', p_match.id, 'market_id', p_match.market_id, 'price', p_match.price,
    'via', p_match.via, 'yes_offer_id', p_match.yes_offer_id, 'no_offer_id', p_match.no_offer_id,
    'yes_bettor', app_public.group_prediction_reader_bettor_json(p_match.yes_bettor_id, p_group),
    'no_bettor', app_public.group_prediction_reader_bettor_json(p_match.no_bettor_id, p_group),
    'yes_stake', app_public.group_prediction_points(p_match.yes_stake_cents),
    'no_stake', app_public.group_prediction_points(p_match.no_stake_cents),
    'winner', (select case when m.outcome in ('yes', 'no') then m.outcome end
      from app_public.group_prediction_markets m where m.id = p_match.market_id),
    'created_at_ms', app_public.group_prediction_ms(p_match.created_at));
$$;

-- One week's bounds and where it stands: `open` before its start, `closed`
-- from its start, `settled` once settled. A week with no board yet reads its
-- bounds from the group's zone.
create function app_public.group_prediction_reader_week_json(p_group uuid, p_week date, p_zone text, p_now timestamptz)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  with b as (select * from app_public.group_prediction_boards x where x.group_id = p_group and x.week_start = p_week),
  bounds as (
    select coalesce((select starts_at from b), lower(app_public.group_cow_bounds(p_zone, p_week))) as starts_at,
           coalesce((select ends_at from b), upper(app_public.group_cow_bounds(p_zone, p_week))) as ends_at)
  select jsonb_build_object('week_start', p_week::text,
    'starts_at_ms', app_public.group_prediction_ms(bounds.starts_at),
    'ends_at_ms', app_public.group_prediction_ms(bounds.ends_at),
    'state', case when (select settled_at from b) is not null then 'settled'
      when (select closed_at from b) is not null or p_now >= bounds.starts_at then 'closed' else 'open' end)
  from bounds;
$$;

-- The matched markets of one week with their bets, oldest market first.
create function app_public.group_prediction_matched_markets_json(p_group uuid, p_week date) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('market', app_public.group_prediction_reader_market_json(m),
    'bets', (select jsonb_agg(app_public.group_prediction_reader_match_json(x, p_group) order by x.seq)
      from app_public.group_prediction_matches x where x.market_id = m.id)) order by m.created_at, m.id), '[]'::jsonb)
  from app_public.group_prediction_markets m
  where m.group_id = p_group and m.week_start = p_week
    and exists (select 1 from app_public.group_prediction_matches x where x.market_id = m.id);
$$;

-- One AI's stored week.
create function app_public.group_prediction_reader_result_json(p_result app_public.group_prediction_results) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('week_start', p_result.week_start::text,
    'profit', app_public.group_prediction_points(p_result.profit_cents), 'matched', p_result.matched,
    'wins', p_result.wins, 'losses', p_result.losses, 'voids', p_result.voids);
$$;

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

-- The board: next week's open markets (best resting prices, open stake and
-- matched bets per market) and this week's matched bets awaiting a result.
-- A group without a zone has no weeks.
create function app_public.group_prediction_board(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _zone text; _now timestamptz := clock_timestamp();
  _this date; _next date;
begin
  perform app_public.group_prediction_require_reader(p_group_id, _uid);
  select g.cow_time_zone into _zone from app_public.groups g where g.id = p_group_id;
  if _zone is null then
    return jsonb_build_object('group_id', p_group_id, 'time_zone', null, 'this_week', null, 'next_week', null);
  end if;
  _this := app_public.group_cow_week(_zone, _now);
  _next := _this + 7;
  return jsonb_build_object('group_id', p_group_id, 'time_zone', _zone,
    'this_week', app_public.group_prediction_reader_week_json(p_group_id, _this, _zone, _now)
      || jsonb_build_object('markets', app_public.group_prediction_matched_markets_json(p_group_id, _this)),
    'next_week', app_public.group_prediction_reader_week_json(p_group_id, _next, _zone, _now)
      || jsonb_build_object('markets', coalesce((
        select jsonb_agg(jsonb_build_object('market', app_public.group_prediction_reader_market_json(m),
          'open_offers', s.open_offers, 'best_yes', s.best_yes, 'best_no', s.best_no,
          'open_stake', app_public.group_prediction_points(s.open_cents), 'matched_bets', s.matched_bets,
          'last_price', s.last_price) order by m.created_at, m.id)
        from app_public.group_prediction_markets m
        cross join lateral (
          select count(*) filter (where o.live)::integer as open_offers,
            max(o.price) filter (where o.live and o.side = 'yes') as best_yes,
            min(o.price) filter (where o.live and o.side = 'no') as best_no,
            coalesce(sum(o.remaining_cents) filter (where o.live), 0) as open_cents,
            (select count(*) from app_public.group_prediction_matches x where x.market_id = m.id)::integer as matched_bets,
            (select x.price from app_public.group_prediction_matches x where x.market_id = m.id
              order by x.seq desc limit 1) as last_price
          from (select o2.side, o2.price, o2.remaining_cents,
              o2.release_reason is null and o2.remaining_cents > 0
                and app_public.group_prediction_offer_live(o2, p_group_id) as live
            from app_public.group_prediction_offers o2 where o2.market_id = m.id) o) s
        where m.group_id = p_group_id and m.week_start = _next and (s.open_offers > 0 or s.matched_bets > 0)), '[]'::jsonb)));
end $$;

-- One market's thread: every offer (counters, notes, withdrawals and expiries
-- included) and every match, oldest first, with the week it belongs to.
create function app_public.group_prediction_market(p_group_id uuid, p_market_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _market app_public.group_prediction_markets;
  _zone text;
begin
  perform app_public.group_prediction_require_reader(p_group_id, _uid);
  select m.* into _market from app_public.group_prediction_markets m where m.id = p_market_id and m.group_id = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: market not found' using errcode = 'P0001';
  end if;
  select b.time_zone into strict _zone from app_public.group_prediction_boards b
   where b.group_id = p_group_id and b.week_start = _market.week_start;
  return jsonb_build_object('group_id', p_group_id,
    'market', app_public.group_prediction_reader_market_json(_market),
    'week', app_public.group_prediction_reader_week_json(p_group_id, _market.week_start, _zone, clock_timestamp()),
    'offers', coalesce((select jsonb_agg(app_public.group_prediction_reader_offer_json(o, p_group_id) order by o.seq)
      from app_public.group_prediction_offers o where o.market_id = _market.id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(app_public.group_prediction_reader_match_json(x, p_group_id) order by x.seq)
      from app_public.group_prediction_matches x where x.market_id = _market.id), '[]'::jsonb));
end $$;

-- The ranking: one row per AI with a settled week: the latest settled week's
-- profit, all-time profit and bets, its record against each other AI and its
-- recent weeks. Ordered by all-time profit, then week profit, then bets (the agents' ranking order).
create function app_public.group_prediction_ranking(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _week date;
begin
  perform app_public.group_prediction_require_reader(p_group_id, _uid);
  select max(b.week_start) into _week from app_public.group_prediction_boards b
   where b.group_id = p_group_id and b.settled_at is not null;
  return jsonb_build_object('group_id', p_group_id, 'week_start', _week::text, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'bettor', app_public.group_prediction_reader_bettor_json(t.bettor_id, p_group_id),
      'week_profit', app_public.group_prediction_points(coalesce(w.profit_cents, 0)),
      'all_time_profit', app_public.group_prediction_points(t.profit_cents),
      'matched', t.matched, 'wins', t.wins, 'losses', t.losses, 'voids', t.voids, 'weeks', t.weeks,
      'head_to_head', coalesce((select jsonb_agg(jsonb_build_object(
          'opponent', app_public.group_prediction_reader_bettor_json(h.opponent_id, p_group_id),
          'matched', h.matched, 'wins', h.wins, 'losses', h.losses, 'voids', h.voids,
          'profit', app_public.group_prediction_points(h.profit_cents)) order by h.profit_cents desc, h.opponent_id)
        from app_public.group_prediction_head_to_head(p_group_id) h where h.bettor_id = t.bettor_id), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(app_public.group_prediction_reader_result_json(r) order by r.week_start desc)
        from (select * from app_public.group_prediction_results x where x.group_id = p_group_id
            and x.bettor_id = t.bettor_id order by x.week_start desc limit 5) r), '[]'::jsonb))
      order by t.profit_cents desc, coalesce(w.profit_cents, 0) desc, t.matched desc, t.bettor_id)
    from app_public.group_prediction_all_time(p_group_id) t
    left join app_public.group_prediction_results w
      on w.group_id = p_group_id and w.bettor_id = t.bettor_id and w.week_start = _week), '[]'::jsonb));
end $$;

-- Past weeks: a keyset page of settled boards, latest first, each with its
-- matched markets (outcome, figure, who won what) and every AI's week.
create function app_public.group_prediction_history(p_group_id uuid, p_before text default null,
  p_limit integer default 4) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user(); _cursor jsonb; _edge date; _weeks jsonb; _more boolean; _last jsonb;
begin
  perform app_public.group_prediction_require_reader(p_group_id, _uid);
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'VALIDATION: invalid prediction history page size' using errcode = 'P0001';
  end if;
  if p_before is not null then
    begin
      _cursor := p_before::jsonb;
      if jsonb_typeof(_cursor) <> 'object' or (select count(*) from jsonb_object_keys(_cursor)) <> 2
         or _cursor ->> 'group_id' is distinct from p_group_id::text
         or jsonb_typeof(_cursor -> 'week_start') is distinct from 'string' then
        raise exception 'bad cursor';
      end if;
      _edge := (_cursor ->> 'week_start')::date;
    exception when others then
      raise exception 'VALIDATION: invalid prediction history cursor' using errcode = 'P0001';
    end;
  end if;
  select coalesce(jsonb_agg(w.page order by w.week_start desc), '[]'::jsonb), count(*) > p_limit
    into _weeks, _more
    from (select b.week_start, jsonb_build_object('week_start', b.week_start::text,
        'starts_at_ms', app_public.group_prediction_ms(b.starts_at), 'ends_at_ms', app_public.group_prediction_ms(b.ends_at),
        'settled_at_ms', app_public.group_prediction_ms(b.settled_at),
        'markets', app_public.group_prediction_matched_markets_json(p_group_id, b.week_start),
        'results', coalesce((select jsonb_agg(jsonb_build_object(
            'bettor', app_public.group_prediction_reader_bettor_json(r.bettor_id, p_group_id),
            'profit', app_public.group_prediction_points(r.profit_cents), 'matched', r.matched, 'wins', r.wins,
            'losses', r.losses, 'voids', r.voids) order by r.profit_cents desc, r.bettor_id)
          from app_public.group_prediction_results r where r.group_id = b.group_id and r.week_start = b.week_start),
          '[]'::jsonb)) as page
      from app_public.group_prediction_boards b
      where b.group_id = p_group_id and b.settled_at is not null and (_edge is null or b.week_start < _edge)
      order by b.week_start desc limit p_limit + 1) w;
  if _more then _weeks := _weeks - (jsonb_array_length(_weeks) - 1); end if;
  _last := _weeks -> (jsonb_array_length(_weeks) - 1);
  return jsonb_build_object('group_id', p_group_id, 'weeks', _weeks, 'next_cursor', case when _more then
    jsonb_build_object('group_id', p_group_id, 'week_start', _last -> 'week_start')::text end);
end $$;

-- ---------------------------------------------------------------------------
-- Posture: every new function is closed to the API roles except the four
-- readers, which the signed-in app calls (a client token is refused inside).
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and p.proname in ('group_prediction_require_reader',
       'group_prediction_reader_bettor_json', 'group_prediction_reader_market_json', 'group_prediction_reader_offer_json',
       'group_prediction_reader_match_json', 'group_prediction_reader_week_json', 'group_prediction_matched_markets_json',
       'group_prediction_reader_result_json', 'group_prediction_board', 'group_prediction_market',
       'group_prediction_ranking', 'group_prediction_history') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('group_prediction_board', 'group_prediction_market', 'group_prediction_ranking',
        'group_prediction_history') then
      execute format('grant execute on function %s to anon, authenticated', f.signature);
    end if;
  end loop;
end $$;
