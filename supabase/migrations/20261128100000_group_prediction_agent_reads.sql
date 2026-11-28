-- Group predictions: the agent reads (groups, form, board) and the
-- AI-scheduled CoW. Rules: docs/specs/tech/group-predictions-agent-contract.md
-- (reads, pick record, schedule rule) and group-predictions-contract.md.
-- Service-role only, called by agent-api with the validated owner and client
-- (spec 10 rules 15 and 17). No read returns a note or another AI's
-- walk-away price, and every figure stays within existing group disclosure.

-- The service-role guard now serves the reads too: neutral wording, same
-- tokens.
create or replace function app_public.agent_group_prediction_require_service() returns void
language plpgsql stable set search_path = app_public, pg_temp as $$
begin
  if auth.jwt() ->> 'client_id' is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot call prediction RPCs' using errcode = 'P0001';
  end if;
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED: prediction RPCs are server-only' using errcode = 'P0001';
  end if;
end $$;

-- Which AI picked a CoW: one row per AI-scheduled CoW (a manager's CoW has
-- none). CoW history, so the predictions reset keeps it.
create table app_public.group_prediction_cow_picks (
  cow_id uuid primary key references app_public.group_cows(id) on delete cascade,
  bettor_id uuid not null references app_public.group_prediction_bettors(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index group_prediction_cow_picks_bettor on app_public.group_prediction_cow_picks(bettor_id);

-- The `cow` scheduled Stream event names the creator when no app user is
-- calling (the service-role AI path, where auth.uid() is null). An app
-- manager's create is unchanged: the caller is the creator.
create or replace function app_public.group_cow_stream_write(p_cow app_public.group_cows,p_event text,
  p_occurred_at timestamptz,p_previous jsonb default null) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform app_public.group_cow_reject_agent();
  insert into app_public.group_events(group_id,kind,member_user_id,actor_user_id,sort_at_ms,payload)
    values(p_cow.group_id,'cow',null,case when p_event='scheduled' then coalesce(auth.uid(),p_cow.created_by)
        when p_event in ('updated','cancelled') then auth.uid() end,
      floor(extract(epoch from p_occurred_at)*1000)::bigint,
      jsonb_build_object('event',p_event,'definition',app_public.group_cow_stream_definition(p_cow),
        'previous',p_previous,'publication_id',case when p_event in ('results','unavailable') then p_cow.publication_id end))
    on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (plain invokers, no client execute).
-- ---------------------------------------------------------------------------

-- A read's gate: a current member of a live group with Predictions on, else
-- NOT_FOUND (the two look the same). Returns the agent's bettor, or null
-- before its first post. Takes the group row KEY SHARE, so the setting and the
-- membership cannot change under the read; takes no prediction lock.
create function app_public.group_prediction_read_enter(p_owner uuid, p_client_id text, p_group uuid) returns uuid
language plpgsql volatile set search_path = app_public, pg_temp as $$
begin
  if p_owner is null or p_client_id is null or char_length(p_client_id) not between 1 and 200 then
    raise exception 'VALIDATION: an agent identity is required' using errcode = 'P0001';
  end if;
  perform 1 from app_public.groups g where g.id = p_group and g.deleted_at is null for key share;
  if not found or app_public.group_active_role(p_group, p_owner) is null
     or not coalesce((select s.enabled from app_public.group_prediction_settings s where s.group_id = p_group), false) then
    raise exception 'NOT_FOUND: group not found' using errcode = 'P0001';
  end if;
  return (select b.id from app_public.group_prediction_bettors b where b.user_id = p_owner and b.client_id = p_client_id);
end $$;

-- The calling AI, also before it has a bettor row.
create function app_public.group_prediction_me_json(p_owner uuid, p_client_id text, p_bettor uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(app_public.group_prediction_bettor_json(p_bettor), jsonb_build_object('bettor_id', null,
    'member', app_public.group_member_ref_json(p_owner),
    'client_name', app_public.group_prediction_client_name(p_client_id),
    'display_name', coalesce((select nullif(btrim(p.username), '') from app_public.user_profiles p where p.id = p_owner), 'Member')
      || ' · ' || coalesce(app_public.group_prediction_client_name(p_client_id), 'AI')));
$$;

-- The open week (next week) of a group with a zone: its bounds, from the
-- board when one exists (frozen at its first offer).
create function app_public.group_prediction_open_week_json(p_group uuid, p_now timestamptz) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select case when g.cow_time_zone is not null then (
    select jsonb_build_object('week_start', w.week_start::text, 'time_zone', coalesce(b.time_zone, g.cow_time_zone),
      'closes_at_ms', app_public.group_prediction_ms(coalesce(b.starts_at, lower(w.bounds))),
      'ends_at_ms', app_public.group_prediction_ms(coalesce(b.ends_at, upper(w.bounds))))
    from (select app_public.group_cow_week(g.cow_time_zone, p_now) + 7 as week_start) o
    cross join lateral (select o.week_start, app_public.group_cow_bounds(g.cow_time_zone, o.week_start) as bounds) w
    left join app_public.group_prediction_boards b on b.group_id = g.id and b.week_start = w.week_start) end
  from app_public.groups g where g.id = p_group;
$$;

create function app_public.group_prediction_stake_left(p_bettor uuid, p_group uuid, p_now timestamptz) returns numeric
language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_prediction_points(10000 - case when p_bettor is null or g.cow_time_zone is null then 0
      else app_public.group_prediction_exposure(p_bettor, p_group, app_public.group_cow_week(g.cow_time_zone, p_now) + 7) end)
  from app_public.groups g where g.id = p_group;
$$;

-- A week's CoW with its exercise name and the AI that picked it, if any.
create function app_public.group_prediction_cow_json(p_cow app_public.group_cows) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select case when p_cow.id is not null then app_public.group_cow_json(p_cow) || jsonb_build_object(
    'exercise_name', coalesce((select ge.name from app_public.group_exercises ge
      where ge.id = p_cow.group_exercise_id and ge.group_id = p_cow.group_id), 'Exercise unavailable'),
    'picked_by', (select app_public.group_prediction_bettor_json(k.bettor_id)
      from app_public.group_prediction_cow_picks k where k.cow_id = p_cow.id)) end;
$$;

-- The board a group exercise has: Hold exercises rank seconds, the others
-- e1RM and volume; e1RM is scored in the group's bodyweight unit when the
-- exercise counts bodyweight.
create function app_public.group_prediction_normalized(p_group uuid, p_exercise uuid) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  select g.bodyweight_calculations_enabled and ge.bodyweight_contribution > 0
    from app_public.groups g join app_public.group_exercises ge on ge.group_id = g.id
   where g.id = p_group and ge.id = p_exercise;
$$;

create function app_public.group_prediction_exercise_json(p_ge app_public.group_exercises) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('group_exercise_id', p_ge.id, 'name', p_ge.name,
    'type', case when p_ge.default_metric = 'seconds' then 'hold' else 'repetitions' end,
    'board_metrics', case when p_ge.default_metric = 'seconds' then '["seconds"]'::jsonb else '["e1rm","volume"]'::jsonb end,
    'e1rm_unit', case when p_ge.default_metric <> 'seconds' then app_public.group_competition_unit('e1rm',
      app_public.group_prediction_normalized(p_ge.group_id, p_ge.id)) end);
$$;

create function app_public.group_prediction_group_json(p_group uuid, p_owner uuid, p_client_id text, p_now timestamptz)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  with me as (select b.id from app_public.group_prediction_bettors b where b.user_id = p_owner and b.client_id = p_client_id)
  select jsonb_build_object('group_id', g.id, 'name', g.name, 'time_zone', g.cow_time_zone,
    'me', app_public.group_prediction_me_json(p_owner, p_client_id, (select id from me)),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(gm.user_id),
        'role', gm.role) order by gm.joined_at, gm.user_id)
      from app_public.group_memberships gm where gm.group_id = g.id and gm.ended_at is null), '[]'::jsonb),
    'group_exercises', coalesce((select jsonb_agg(app_public.group_prediction_exercise_json(ge) order by ge.name, ge.id)
      from app_public.group_exercises ge where ge.group_id = g.id and ge.archived_at is null), '[]'::jsonb),
    'open_week', app_public.group_prediction_open_week_json(g.id, p_now),
    'stake_left', app_public.group_prediction_stake_left((select id from me), g.id, p_now),
    'next_week_cow', case when g.cow_time_zone is not null then app_public.group_prediction_cow_json(
      app_public.group_prediction_week_cow(g.id, app_public.group_cow_week(g.cow_time_zone, p_now) + 7)) end)
  from app_public.groups g where g.id = p_group;
$$;

-- ---------------------------------------------------------------------------
-- Form: the last 8 weeks (this week, in progress, and the 7 before).
-- ---------------------------------------------------------------------------

create function app_public.group_prediction_form_weeks(p_zone text, p_now timestamptz)
returns table (week_start date, from_ms bigint, to_ms bigint, complete boolean)
language sql stable set search_path = app_public, pg_temp as $$
  select w.week_start, app_public.group_prediction_ms(lower(b.bounds)), app_public.group_prediction_ms(upper(b.bounds)),
    upper(b.bounds) <= p_now
    from (select app_public.group_cow_week(p_zone, p_now) - 7 * k as week_start from generate_series(0, 7) k) w
    cross join lateral (select app_public.group_cow_bounds(p_zone, w.week_start) as bounds) b;
$$;

-- Each current member's counting e1RM on each live repetition exercise, at
-- its published revision and in its board's unit, where its board would show
-- it (the group_competition_board_rows rule): per week the best in the week
-- and the baseline (the best before the week, the e1rm_line baseline), and
-- the best as a percent of that baseline.
create function app_public.group_prediction_form_e1rm(p_group uuid, p_zone text, p_now timestamptz)
returns table (member_user_id uuid, group_exercise_id uuid, unit text, week_start date, baseline numeric, best numeric)
language sql stable set search_path = app_public, pg_temp as $$
  with exercises as (
    select ge.id, ge.published_rules_revision as revision, ge.rules_revision as current_revision,
      app_public.group_prediction_normalized(p_group, ge.id) as normalized
      from app_public.group_exercises ge
     where ge.group_id = p_group and ge.archived_at is null and ge.default_metric <> 'seconds'
       and ge.published_rules_revision is not null
  ), members as (
    select gm.user_id, gm.id as membership_id from app_public.group_memberships gm
     where gm.group_id = p_group and gm.ended_at is null
  ), weeks as (select * from app_public.group_prediction_form_weeks(p_zone, p_now)
  ), scores as (
    select s.member_user_id, s.group_exercise_id, s.value, ws.started_at
      from exercises x
      join app_public.group_metric_set_scores s on s.group_exercise_id = x.id and s.rules_revision = x.revision
       and s.metric = 'e1rm' and s.counting and s.unit = app_public.group_competition_unit('e1rm', x.normalized)
      -- The board's membership rule (group_metric_entries): at the current
      -- revision only the current membership's scores count, so a member
      -- who left and rejoined starts again.
      join members m on m.user_id = s.member_user_id
       and (x.revision <> x.current_revision or s.membership_id = m.membership_id)
      join lateral (select ses.started_at from app_public.group_session_shares sh
          join app_public.sessions ses on ses.owner_user_id = sh.member_user_id and ses.id = sh.session_id
         where sh.group_id = p_group and sh.member_user_id = s.member_user_id and sh.session_id = s.session_id
           and ses.deleted_at is null and ses.status = 'completed') ws on true
     where x.normalized
        or not app_public.group_competition_redacts_exercise(array[p_group], s.member_user_id,
          s.performance ->> 'exercise_definition_id')
  )
  select m.user_id, x.id, app_public.group_competition_unit('e1rm', x.normalized), w.week_start,
    max(s.value) filter (where s.started_at < w.from_ms),
    max(s.value) filter (where s.started_at >= w.from_ms and s.started_at < w.to_ms)
    from members m cross join exercises x cross join weeks w
    left join scores s on s.member_user_id = m.user_id and s.group_exercise_id = x.id and s.started_at < w.to_ms
   group by m.user_id, x.id, x.normalized, w.week_start;
$$;

-- The current #1 of every All board of the group's live exercises (the board
-- reader's rows and disclosure, with its former-member flag); none while a
-- board rebuilds.
create function app_public.group_prediction_form_leaders(p_group uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_exercise_id', ge.id, 'metric', mt.metric,
      'state', case when ge.published_rules_revision is distinct from ge.rules_revision then 'rebuilding' else 'ready' end,
      'leader', (select jsonb_build_object('member', r.row_json -> 'member', 'former', r.row_json -> 'former',
          'value', r.row_json -> 'value', 'unit', r.row_json -> 'unit')
        from app_public.group_competition_board_rows(p_group, ge.id, ge.rules_revision, mt.metric, false) r
       where r.rank = 1 and ge.published_rules_revision is not distinct from ge.rules_revision))
    order by ge.name, ge.id, mt.ord), '[]'::jsonb)
    from app_public.group_exercises ge
    cross join lateral unnest(case when ge.default_metric = 'seconds' then array['seconds'] else array['e1rm', 'volume'] end)
      with ordinality mt(metric, ord)
   where ge.group_id = p_group and ge.archived_at is null;
$$;

create function app_public.agent_group_prediction_form_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _zone text; _form jsonb;
begin
  perform app_public.group_prediction_read_enter(p_owner, p_client_id, p_group_id);
  select g.cow_time_zone into _zone from app_public.groups g where g.id = p_group_id;
  if _zone is null then
    raise exception 'VALIDATION: set the group time zone before predictions' using errcode = 'P0001';
  end if;
  -- One statement, so records, sets, e1RM and leaders share one snapshot.
  with weeks as (select * from app_public.group_prediction_form_weeks(_zone, p_now)),
  e1rm as (select * from app_public.group_prediction_form_e1rm(p_group_id, _zone, p_now)),
  per_exercise as (
    select e.member_user_id, e.group_exercise_id, jsonb_build_object('group_exercise_id', e.group_exercise_id,
        'unit', min(e.unit), 'weeks', jsonb_agg(jsonb_build_object('week_start', e.week_start::text,
          'baseline', trim_scale(e.baseline), 'best', trim_scale(e.best),
          'percent_of_baseline', round(e.best * 100 / nullif(e.baseline, 0), 1)) order by e.week_start)) as j
      from e1rm e group by e.member_user_id, e.group_exercise_id
  )
  select jsonb_build_object('group_id', p_group_id,
    'weeks', (select jsonb_agg(jsonb_build_object('week_start', w.week_start::text, 'starts_at_ms', w.from_ms,
        'ends_at_ms', w.to_ms, 'complete', w.complete,
        'records', app_public.group_prediction_week_records(p_group_id, w.from_ms, w.to_ms)) order by w.week_start)
      from weeks w),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member', app_public.group_member_ref_json(gm.user_id),
        'working_sets', (select jsonb_agg(jsonb_build_object('week_start', w.week_start::text,
            'sets', app_public.group_prediction_week_sets(p_group_id, gm.user_id, w.from_ms, w.to_ms)) order by w.week_start)
          from weeks w),
        'e1rm', coalesce((select jsonb_agg(p.j order by ge.name, ge.id) from per_exercise p
            join app_public.group_exercises ge on ge.id = p.group_exercise_id
           where p.member_user_id = gm.user_id), '[]'::jsonb))
        order by gm.joined_at, gm.user_id)
      from app_public.group_memberships gm where gm.group_id = p_group_id and gm.ended_at is null), '[]'::jsonb),
    'leaders', app_public.group_prediction_form_leaders(p_group_id))
  into _form;
  return _form;
end $$;

-- ---------------------------------------------------------------------------
-- Board.
-- ---------------------------------------------------------------------------

-- Another AI's offer as every AI sees it: never its note or walk-away price.
create function app_public.group_prediction_public_offer_json(p_offer app_public.group_prediction_offers, p_bettor uuid)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('offer_id', p_offer.id, 'market_id', p_offer.market_id,
    'bettor', app_public.group_prediction_bettor_json(p_offer.bettor_id), 'mine', p_offer.bettor_id is not distinct from p_bettor,
    'side', p_offer.side, 'price', p_offer.price, 'stake', app_public.group_prediction_points(p_offer.stake_cents),
    'remaining', app_public.group_prediction_points(p_offer.remaining_cents),
    'answers_offer_id', p_offer.answers_offer_id, 'created_at_ms', app_public.group_prediction_ms(p_offer.created_at));
$$;

create function app_public.group_prediction_public_match_json(p_match app_public.group_prediction_matches)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('match_id', p_match.id, 'market_id', p_match.market_id, 'price', p_match.price,
    'via', p_match.via, 'yes_bettor', app_public.group_prediction_bettor_json(p_match.yes_bettor_id),
    'no_bettor', app_public.group_prediction_bettor_json(p_match.no_bettor_id),
    'yes_stake', app_public.group_prediction_points(p_match.yes_stake_cents),
    'no_stake', app_public.group_prediction_points(p_match.no_stake_cents),
    'created_at_ms', app_public.group_prediction_ms(p_match.created_at));
$$;

-- A settled e1RM line's figure is a member's score, so the current kg
-- disclosure applies to it on every read ([[groups.kg-disclosure]], the
-- group_competition_board_rows rule): shown only in the exercise's current
-- board unit, and, when that is kg with bodyweight calculations on, only while
-- the member has a live link to the exercise and none of their live links to
-- it hides kg. Without a live link the source exercise is unknown, so the
-- figure is hidden. Other templates' figures are counts.
create function app_public.group_prediction_result_shown(p_market app_public.group_prediction_markets) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  with links as (
    select l.exercise_definition_id from app_public.exercise_group_links l
     where l.owner_user_id = p_market.member_user_id and lower(l.group_id) = p_market.group_id::text
       and app_public.group_eval_try_uuid(l.group_exercise_id) = p_market.group_exercise_id and l.deleted_at is null
  ), n as (
    select coalesce(app_public.group_prediction_normalized(p_market.group_id, p_market.group_exercise_id), false) as normalized,
      coalesce((select g.bodyweight_calculations_enabled from app_public.groups g where g.id = p_market.group_id), false) as bw
  )
  select p_market.template <> 'e1rm_line' or (
    p_market.result_unit is not distinct from app_public.group_competition_unit('e1rm', n.normalized)
    and (n.normalized or not n.bw or (exists (select 1 from links)
      and not exists (select 1 from links k where app_public.group_competition_redacts_exercise(array[p_market.group_id],
        p_market.member_user_id, k.exercise_definition_id)))))
  from n;
$$;

create function app_public.group_prediction_settled_market_json(p_market app_public.group_prediction_markets) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select app_public.group_prediction_market_json(p_market) || jsonb_build_object('outcome', p_market.outcome,
    'result_value', case when app_public.group_prediction_result_shown(p_market) then trim_scale(p_market.result_value) end,
    'result_unit', p_market.result_unit);
$$;

-- The open board's public book: its markets, live open offers and matches.
create function app_public.group_prediction_open_book_json(p_group uuid, p_week date, p_bettor uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object(
    'markets', coalesce((select jsonb_agg(app_public.group_prediction_market_json(m) order by m.created_at, m.id)
      from app_public.group_prediction_markets m where m.group_id = p_group and m.week_start = p_week), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(app_public.group_prediction_public_offer_json(o, p_bettor) order by o.seq)
      from app_public.group_prediction_offers o join app_public.group_prediction_markets m on m.id = o.market_id
     where m.group_id = p_group and m.week_start = p_week and o.remaining_cents > 0 and o.released_at is null
       and app_public.group_prediction_offer_live(o, p_group)), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(app_public.group_prediction_public_match_json(x) order by x.seq)
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
     where m.group_id = p_group and m.week_start = p_week), '[]'::jsonb));
$$;

-- The calling AI's side: its offers on the open board (its own walk-away
-- prices, never notes) and its matches on every board not yet settled.
create function app_public.group_prediction_mine_json(p_group uuid, p_week date, p_bettor uuid, p_now timestamptz)
returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('stake_left', app_public.group_prediction_stake_left(p_bettor, p_group, p_now),
    'offers', coalesce((select jsonb_agg(app_public.group_prediction_own_offer_json(o) order by o.seq)
      from app_public.group_prediction_offers o join app_public.group_prediction_markets m on m.id = o.market_id
     where m.group_id = p_group and m.week_start = p_week and o.bettor_id = p_bettor), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(app_public.group_prediction_match_json(x, p_bettor)
        || jsonb_build_object('market', app_public.group_prediction_market_json(m)) order by x.seq)
      from app_public.group_prediction_matches x join app_public.group_prediction_markets m on m.id = x.market_id
      join app_public.group_prediction_boards b on b.group_id = m.group_id and b.week_start = m.week_start
     where m.group_id = p_group and b.settled_at is null
       and p_bettor in (x.yes_bettor_id, x.no_bettor_id)), '[]'::jsonb));
$$;

-- The latest settled board: each settled market and each AI's week.
create function app_public.group_prediction_last_week_json(p_group uuid, p_week date) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select case when p_week is not null then jsonb_build_object('week_start', p_week::text,
    'markets', coalesce((select jsonb_agg(app_public.group_prediction_settled_market_json(m) order by m.created_at, m.id)
      from app_public.group_prediction_markets m where m.group_id = p_group and m.week_start = p_week
       and m.outcome is not null), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('bettor', app_public.group_prediction_bettor_json(r.bettor_id),
        'profit', app_public.group_prediction_points(r.profit_cents), 'matched', r.matched, 'wins', r.wins,
        'losses', r.losses, 'voids', r.voids) order by r.profit_cents desc, r.bettor_id)
      from app_public.group_prediction_results r where r.group_id = p_group and r.week_start = p_week), '[]'::jsonb)) end;
$$;

-- One row per AI with results: the latest settled week's profit, all-time
-- profit and record, and head-to-head against each opponent (derived once).
create function app_public.group_prediction_ranking_json(p_group uuid, p_week date) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  with h2h as materialized (select * from app_public.group_prediction_head_to_head(p_group))
  select coalesce(jsonb_agg(jsonb_build_object('bettor', app_public.group_prediction_bettor_json(a.bettor_id),
      'week_profit', app_public.group_prediction_points(coalesce(w.profit_cents, 0)),
      'all_time_profit', app_public.group_prediction_points(a.profit_cents), 'matched', a.matched, 'wins', a.wins,
      'losses', a.losses, 'voids', a.voids, 'weeks', a.weeks,
      'head_to_head', coalesce((select jsonb_agg(jsonb_build_object(
          'opponent', app_public.group_prediction_bettor_json(h.opponent_id), 'matched', h.matched, 'wins', h.wins,
          'losses', h.losses, 'voids', h.voids, 'profit', app_public.group_prediction_points(h.profit_cents))
          order by h.profit_cents desc, h.opponent_id)
        from h2h h where h.bettor_id = a.bettor_id), '[]'::jsonb))
      order by a.profit_cents desc, coalesce(w.profit_cents, 0) desc, a.bettor_id), '[]'::jsonb)
    from app_public.group_prediction_all_time(p_group) a
    left join app_public.group_prediction_results w on w.group_id = p_group and w.week_start = p_week
      and w.bettor_id = a.bettor_id;
$$;

create function app_public.agent_group_prediction_board_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid; _zone text; _open date; _last date;
begin
  _bettor := app_public.group_prediction_read_enter(p_owner, p_client_id, p_group_id);
  select g.cow_time_zone into _zone from app_public.groups g where g.id = p_group_id;
  if _zone is null then
    raise exception 'VALIDATION: set the group time zone before predictions' using errcode = 'P0001';
  end if;
  _open := app_public.group_cow_week(_zone, p_now) + 7;
  select max(b.week_start) into _last from app_public.group_prediction_boards b
   where b.group_id = p_group_id and b.settled_at is not null;
  return jsonb_build_object('group_id', p_group_id, 'me', app_public.group_prediction_me_json(p_owner, p_client_id, _bettor),
    'open_week', app_public.group_prediction_open_week_json(p_group_id, p_now)
      || app_public.group_prediction_open_book_json(p_group_id, _open, _bettor),
    'mine', app_public.group_prediction_mine_json(p_group_id, _open, _bettor, p_now),
    'last_week', app_public.group_prediction_last_week_json(p_group_id, _last),
    'ranking', app_public.group_prediction_ranking_json(p_group_id, _last));
end $$;

create function app_public.agent_group_prediction_groups_at(p_now timestamptz, p_owner uuid, p_client_id text)
returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _groups uuid[];
begin
  if p_owner is null or p_client_id is null or char_length(p_client_id) not between 1 and 200 then
    raise exception 'VALIDATION: an agent identity is required' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(g.id order by g.name, g.id), '{}') into _groups
    from app_public.groups g
    join app_public.group_memberships gm on gm.group_id = g.id and gm.user_id = p_owner and gm.ended_at is null
    join app_public.group_prediction_settings s on s.group_id = g.id and s.enabled
   where g.deleted_at is null;
  -- KEY SHARE, like a single-group read, so neither can change under it.
  perform 1 from app_public.groups g where g.id = any(_groups) order by g.id for key share;
  return jsonb_build_object('groups', coalesce((select jsonb_agg(
      app_public.group_prediction_group_json(x.id, p_owner, p_client_id, p_now) order by x.ord)
    from unnest(_groups) with ordinality x(id, ord)
    where app_public.group_active_role(x.id, p_owner) is not null
      and exists (select 1 from app_public.group_prediction_settings s where s.group_id = x.id and s.enabled)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- The AI-scheduled CoW.
-- ---------------------------------------------------------------------------

-- The previous-week rule: this AI picked the week before's CoW and another
-- AI has posted in the group in the last four weeks.
create function app_public.group_prediction_cow_pick_refused(p_group uuid, p_bettor uuid, p_week date,
  p_now timestamptz) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  select exists (select 1 from app_public.group_prediction_cow_picks k
      where k.bettor_id = p_bettor and k.cow_id = (app_public.group_prediction_week_cow(p_group, p_week - 7)).id)
    and exists (select 1 from app_public.group_prediction_offers o
      join app_public.group_prediction_markets m on m.id = o.market_id
     where m.group_id = p_group and o.bettor_id <> p_bettor and o.created_at > p_now - interval '28 days'
       and o.created_at <= p_now);
$$;

-- group_cow_create's validation (live exercise, 1-3 metrics, zone set, next
-- week only, not started, slot empty) without the manager check; the owner
-- is the creator and the pick names the AI. p_cow_id makes a retry return
-- the same CoW (the agent API derives it from its idempotency key).
create function app_public.agent_group_prediction_cow_schedule_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid, p_cow_id uuid, p_week_start date, p_group_exercise_id uuid, p_metrics text[]) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid; g app_public.groups; c app_public.group_cows; _key text; _chosen text[]; _expected date;
  _begin timestamptz; _end timestamptz;
begin
  _bettor := app_public.group_prediction_enter(p_owner, p_client_id, p_group_id);
  perform pg_advisory_xact_lock(hashtextextended('group-cow:' || p_group_id::text, 0));
  if p_cow_id is null then
    raise exception 'VALIDATION: CoW identity is required' using errcode = 'P0001';
  end if;
  _key := jsonb_build_array('agent', p_group_exercise_id, p_metrics, p_week_start)::text;
  select * into c from app_public.group_cows where id = p_cow_id;
  if found then
    if c.group_id = p_group_id and c.create_key = _key
       and exists (select 1 from app_public.group_prediction_cow_picks k where k.cow_id = c.id and k.bettor_id = _bettor) then
      return jsonb_build_object('cow', app_public.group_prediction_cow_json(c));
    end if;
    raise exception 'CONFLICT: this CoW request already exists' using errcode = 'P0001';
  end if;
  _chosen := app_public.group_cow_validate(p_group_id, p_group_exercise_id, p_metrics);
  select * into strict g from app_public.groups where id = p_group_id;
  if g.cow_time_zone is null then
    raise exception 'VALIDATION: set the group time zone before scheduling' using errcode = 'P0001';
  end if;
  _expected := app_public.group_cow_week(g.cow_time_zone, p_now) + 7;
  if p_week_start is distinct from _expected then
    raise exception 'VALIDATION: schedule next week only' using errcode = 'P0001';
  end if;
  _begin := lower(app_public.group_cow_bounds(g.cow_time_zone, _expected));
  _end := upper(app_public.group_cow_bounds(g.cow_time_zone, _expected));
  if _begin <= p_now then
    raise exception 'VALIDATION: this CoW has already started' using errcode = 'P0001';
  end if;
  if exists (select 1 from app_public.group_cows x where x.group_id = p_group_id and x.cancelled_at is null
      and (x.week_start = _expected or tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(_begin, _end, '[)'))) then
    raise exception 'CONFLICT: this group already has a CoW in that week' using errcode = 'P0001';
  end if;
  if app_public.group_prediction_cow_pick_refused(p_group_id, _bettor, _expected, p_now) then
    raise exception 'FORBIDDEN: this AI picked last week''s CoW; another AI picks this one' using errcode = 'P0001';
  end if;
  insert into app_public.group_cows(id, group_id, group_exercise_id, week_start, time_zone, starts_at, ends_at, metrics,
    create_key, created_by, available_at)
  values (p_cow_id, p_group_id, p_group_exercise_id, _expected, g.cow_time_zone, _begin, _end, _chosen, _key, p_owner, _begin)
  on conflict (id) do nothing returning * into c;
  if not found then
    raise exception 'CONFLICT: this CoW request already exists' using errcode = 'P0001';
  end if;
  insert into app_public.group_prediction_cow_picks(cow_id, bettor_id, created_at) values (c.id, _bettor, p_now);
  return jsonb_build_object('cow', app_public.group_prediction_cow_json(c));
end $$;

-- ---------------------------------------------------------------------------
-- RPCs: service-role only, called by agent-api.
-- ---------------------------------------------------------------------------

create function app_public.agent_group_prediction_groups(p_owner uuid, p_client_id text) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_groups_at(clock_timestamp(), p_owner, p_client_id);
end $$;

create function app_public.agent_group_prediction_form(p_owner uuid, p_client_id text, p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_form_at(clock_timestamp(), p_owner, p_client_id, p_group_id);
end $$;

create function app_public.agent_group_prediction_board(p_owner uuid, p_client_id text, p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_board_at(clock_timestamp(), p_owner, p_client_id, p_group_id);
end $$;

create function app_public.agent_group_prediction_cow_schedule(p_owner uuid, p_client_id text, p_group_id uuid,
  p_cow_id uuid, p_week_start date, p_group_exercise_id uuid, p_metrics text[]) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_cow_schedule_at(clock_timestamp(), p_owner, p_client_id, p_group_id,
    p_cow_id, p_week_start, p_group_exercise_id, p_metrics);
end $$;

-- ---------------------------------------------------------------------------
-- Posture: the picks table closed to every API role; the four RPCs
-- service-role only; every other new function internal.
-- ---------------------------------------------------------------------------

alter table app_public.group_prediction_cow_picks enable row level security;
revoke all on app_public.group_prediction_cow_picks from public, anon, authenticated, service_role;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and p.proname in ('group_prediction_read_enter', 'group_prediction_me_json',
       'group_prediction_open_week_json', 'group_prediction_stake_left', 'group_prediction_cow_json',
       'group_prediction_normalized', 'group_prediction_exercise_json', 'group_prediction_group_json',
       'group_prediction_form_weeks', 'group_prediction_form_e1rm', 'group_prediction_form_leaders',
       'agent_group_prediction_form_at', 'group_prediction_public_offer_json', 'group_prediction_public_match_json',
       'group_prediction_settled_market_json', 'group_prediction_result_shown', 'group_prediction_open_book_json', 'group_prediction_mine_json',
       'group_prediction_last_week_json', 'group_prediction_ranking_json', 'agent_group_prediction_board_at',
       'agent_group_prediction_groups_at', 'group_prediction_cow_pick_refused', 'agent_group_prediction_cow_schedule_at',
       'agent_group_prediction_groups', 'agent_group_prediction_form', 'agent_group_prediction_board',
       'agent_group_prediction_cow_schedule') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('agent_group_prediction_groups', 'agent_group_prediction_form', 'agent_group_prediction_board',
        'agent_group_prediction_cow_schedule') then
      execute format('grant execute on function %s to service_role', f.signature);
    end if;
  end loop;
end $$;
