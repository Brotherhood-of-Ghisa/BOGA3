-- Server-only group predictions: the setting, bettors, weekly boards, markets,
-- offers and matches; member setting RPCs and the service-role agent write
-- RPCs (post, take, counter, withdraw). Rules:
-- docs/specs/tech/group-predictions-contract.md; product fact
-- [[agents.group-predictions]]. Group storage rules apply: no owner column, no
-- FK into Sync v2 tables, RLS on with no policies and nothing granted.
-- Stakes are integer hundredths of a point (`*_cents`).

create table app_public.group_prediction_settings (
  group_id uuid primary key references app_public.groups(id) on delete cascade,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

-- One connected AI: a user plus an OAuth client. A new grant on the same
-- client is the same bettor.
create table app_public.group_prediction_bettors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, client_id)
);

-- A group's board for one CoW week, created on its first offer. Its bounds
-- are frozen then, so a later zone change cannot reopen or move it.
create table app_public.group_prediction_boards (
  group_id uuid not null references app_public.groups(id) on delete cascade,
  week_start date not null,
  time_zone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (group_id, week_start),
  check (ends_at > starts_at)
);

-- One yes/no statement: a template and its typed parameters, unique per
-- board. Unused parameters are null.
create table app_public.group_prediction_markets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  week_start date not null,
  template text not null check (template in ('e1rm_line', 'sets_line', 'records_line', 'cow_top', 'lead_change')),
  member_user_id uuid,
  group_exercise_id uuid references app_public.group_exercises(id) on delete cascade,
  metric text,
  line numeric(4, 1),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (group_id, week_start) references app_public.group_prediction_boards(group_id, week_start) on delete cascade,
  constraint group_prediction_markets_parameters check (coalesce(case template
    when 'e1rm_line' then member_user_id is not null and group_exercise_id is not null and metric is null
      and line between 80 and 120 and mod(line * 10, 25) = 0
    when 'sets_line' then member_user_id is not null and group_exercise_id is null and metric is null
      and line between 5 and 200 and mod(line, 5) = 0
    when 'records_line' then member_user_id is null and group_exercise_id is null and metric is null
      and line between 1 and 50 and line = trunc(line)
    when 'cow_top' then member_user_id is not null and group_exercise_id is null and line is null
      and metric in ('e1rm', 'volume', 'improvement')
    when 'lead_change' then member_user_id is null and group_exercise_id is not null and line is null
      and metric in ('e1rm', 'volume', 'seconds')
  end, false))
);
create unique index group_prediction_markets_identity on app_public.group_prediction_markets
  (group_id, week_start, template, member_user_id, group_exercise_id, metric, line) nulls not distinct;

-- An offer risks `stake_cents` on its side at `price` (the yes probability).
-- matched = stake - remaining - released; released is what a withdrawal (or,
-- later, the close) returned.
create table app_public.group_prediction_offers (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  market_id uuid not null references app_public.group_prediction_markets(id) on delete cascade,
  bettor_id uuid not null references app_public.group_prediction_bettors(id) on delete cascade,
  side text not null check (side in ('yes', 'no')),
  price smallint not null check (price between 1 and 99),
  stake_cents integer not null check (stake_cents between 1 and 10000),
  remaining_cents integer not null,
  released_cents integer not null default 0,
  walk_away_price smallint,
  note text,
  answers_offer_id uuid references app_public.group_prediction_offers(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_reason text check (release_reason in ('withdrawn', 'expired')),
  constraint group_prediction_offers_amounts check (remaining_cents >= 0 and released_cents >= 0
    and remaining_cents + released_cents <= stake_cents),
  constraint group_prediction_offers_release check ((released_at is null) = (release_reason is null)
    and (released_at is null or remaining_cents = 0)),
  constraint group_prediction_offers_walk_away check (walk_away_price is null
    or (side = 'yes' and walk_away_price between price and 99)
    or (side = 'no' and walk_away_price between 1 and price)),
  constraint group_prediction_offers_note check (note is null
    or (char_length(note) between 1 and 140 and note = app_public.group_exercise_trim(note))),
  constraint group_prediction_offers_answers check (answers_offer_id is distinct from id)
);
-- Each bettor counters a given offer once.
create unique index group_prediction_offers_one_counter on app_public.group_prediction_offers(answers_offer_id, bettor_id)
  where answers_offer_id is not null;
create index group_prediction_offers_book on app_public.group_prediction_offers(market_id, side, price, seq)
  where remaining_cents > 0;
create index group_prediction_offers_by_bettor on app_public.group_prediction_offers(bettor_id, market_id);

-- One fill between a yes and a no offer. The winner gains the loser's stake.
create table app_public.group_prediction_matches (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  market_id uuid not null references app_public.group_prediction_markets(id) on delete cascade,
  yes_offer_id uuid not null references app_public.group_prediction_offers(id) on delete cascade,
  no_offer_id uuid not null references app_public.group_prediction_offers(id) on delete cascade,
  yes_bettor_id uuid not null references app_public.group_prediction_bettors(id) on delete cascade,
  no_bettor_id uuid not null references app_public.group_prediction_bettors(id) on delete cascade,
  price smallint not null check (price between 1 and 99),
  yes_stake_cents integer not null check (yes_stake_cents > 0),
  no_stake_cents integer not null check (no_stake_cents > 0),
  via text not null check (via in ('cross', 'counter')),
  created_at timestamptz not null default clock_timestamp(),
  check (yes_bettor_id <> no_bettor_id)
);
create index group_prediction_matches_market on app_public.group_prediction_matches(market_id, seq);
create index group_prediction_matches_yes on app_public.group_prediction_matches(yes_offer_id);
create index group_prediction_matches_no on app_public.group_prediction_matches(no_offer_id);

-- ---------------------------------------------------------------------------
-- Helpers (plain invokers, no client execute). They run inside the definer
-- RPCs below, which do the caller checks.
-- ---------------------------------------------------------------------------

create function app_public.group_prediction_points(p_cents bigint) returns numeric
language sql immutable set search_path = app_public, pg_temp as $$
  select round(p_cents::numeric / 100, 2);
$$;

create function app_public.group_prediction_ms(p_at timestamptz) returns bigint
language sql immutable set search_path = app_public, pg_temp as $$
  select floor(extract(epoch from p_at) * 1000)::bigint;
$$;

-- The rounding rule: a fill takes the largest whole-hundredths yes stake y
-- that the two offers allow, and the no stake n = y * (100 - p) / p rounded
-- half up to a hundredth, never more than the no side has left. Both stakes
-- leave their offers exactly, so a match moves points without creating any.
create function app_public.group_prediction_fill(p_yes_cents integer, p_no_cents integer, p_price integer,
  out yes_cents integer, out no_cents integer)
language sql immutable set search_path = app_public, pg_temp as $$
  with y as (select least(p_yes_cents::bigint,
      ((2 * p_no_cents::bigint + 1) * p_price - 1) / (2 * (100 - p_price))) as y)
  select y::integer, ((2 * y * (100 - p_price) + p_price) / (2 * p_price))::integer from y;
$$;

create function app_public.group_prediction_settings_json(p_group uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('group_id', p_group,
    'enabled', coalesce((select s.enabled from app_public.group_prediction_settings s where s.group_id = p_group), false));
$$;

-- The OAuth client's name is chosen by whoever registered the client, and
-- other AIs read it: control characters are dropped and it is cut to 60.
create function app_public.group_prediction_client_name(p_client_id text) returns text
language sql stable set search_path = app_public, pg_temp as $$
  select nullif(left(btrim(regexp_replace(c.client_name, '[[:cntrl:]]', '', 'g')), 60), '')
    from auth.oauth_clients c where c.id::text = p_client_id;
$$;

create function app_public.group_prediction_bettor_json(p_bettor uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('bettor_id', b.id, 'member', app_public.group_member_ref_json(b.user_id),
    'client_name', app_public.group_prediction_client_name(b.client_id),
    'display_name', coalesce((select nullif(btrim(p.username), '') from app_public.user_profiles p where p.id = b.user_id), 'Member')
      || ' · ' || coalesce(app_public.group_prediction_client_name(b.client_id), 'AI'))
  from app_public.group_prediction_bettors b
  where b.id = p_bettor;
$$;

-- An offer meets others only while its AI's user is a current member: a
-- member who left can no longer withdraw, so nothing new may fill.
create function app_public.group_prediction_bettor_current(p_bettor uuid, p_group uuid) returns boolean
language sql stable set search_path = app_public, pg_temp as $$
  select exists (select 1 from app_public.group_prediction_bettors b
    join app_public.group_memberships gm on gm.user_id = b.user_id
   where b.id = p_bettor and gm.group_id = p_group and gm.ended_at is null);
$$;

create function app_public.group_prediction_parameters_json(p_market app_public.group_prediction_markets) returns jsonb
language sql immutable set search_path = app_public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('member_user_id', p_market.member_user_id,
    'group_exercise_id', p_market.group_exercise_id, 'metric', p_market.metric, 'line', trim_scale(p_market.line)));
$$;

create function app_public.group_prediction_market_json(p_market app_public.group_prediction_markets) returns jsonb
language sql immutable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('market_id', p_market.id, 'group_id', p_market.group_id,
    'week_start', p_market.week_start::text, 'template', p_market.template,
    'parameters', app_public.group_prediction_parameters_json(p_market));
$$;

-- The caller's own offer. Never the note: no agent route returns notes.
create function app_public.group_prediction_own_offer_json(p_offer app_public.group_prediction_offers) returns jsonb
language sql immutable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('offer_id', p_offer.id, 'market_id', p_offer.market_id, 'side', p_offer.side,
    'price', p_offer.price, 'stake', app_public.group_prediction_points(p_offer.stake_cents),
    'remaining', app_public.group_prediction_points(p_offer.remaining_cents),
    'matched', app_public.group_prediction_points(p_offer.stake_cents - p_offer.remaining_cents - p_offer.released_cents),
    'withdrawn', app_public.group_prediction_points(case when p_offer.release_reason = 'withdrawn' then p_offer.released_cents else 0 end),
    'walk_away_price', p_offer.walk_away_price, 'answers_offer_id', p_offer.answers_offer_id,
    'state', case when p_offer.release_reason is not null then p_offer.release_reason
      when p_offer.remaining_cents = 0 then 'filled' else 'open' end,
    'created_at_ms', app_public.group_prediction_ms(p_offer.created_at));
$$;

-- A match as one of its bettors sees it.
create function app_public.group_prediction_match_json(p_match app_public.group_prediction_matches, p_bettor uuid) returns jsonb
language sql stable set search_path = app_public, pg_temp as $$
  select jsonb_build_object('match_id', p_match.id, 'market_id', p_match.market_id, 'price', p_match.price,
    'via', p_match.via, 'side', case when p_match.yes_bettor_id = p_bettor then 'yes' else 'no' end,
    'yes_offer_id', p_match.yes_offer_id, 'no_offer_id', p_match.no_offer_id,
    'yes_stake', app_public.group_prediction_points(p_match.yes_stake_cents),
    'no_stake', app_public.group_prediction_points(p_match.no_stake_cents),
    'counterparty', app_public.group_prediction_bettor_json(case when p_match.yes_bettor_id = p_bettor
      then p_match.no_bettor_id else p_match.yes_bettor_id end),
    'created_at_ms', app_public.group_prediction_ms(p_match.created_at));
$$;

-- Open remaining plus matched stake of one bettor on one board.
create function app_public.group_prediction_exposure(p_bettor uuid, p_group uuid, p_week date) returns bigint
language sql stable set search_path = app_public, pg_temp as $$
  select coalesce(sum(o.stake_cents - o.released_cents), 0)::bigint
    from app_public.group_prediction_offers o
    join app_public.group_prediction_markets m on m.id = o.market_id
   where o.bettor_id = p_bettor and m.group_id = p_group and m.week_start = p_week;
$$;

-- Only the agent API calls the agent RPCs, with the service role.
create function app_public.agent_group_prediction_require_service() returns void
language plpgsql stable set search_path = app_public, pg_temp as $$
begin
  if auth.jwt() ->> 'client_id' is not null then
    raise exception 'AGENT_FORBIDDEN: OAuth clients cannot call prediction writes' using errcode = 'P0001';
  end if;
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED: prediction writes are server-only' using errcode = 'P0001';
  end if;
end $$;

-- The validated agent's bettor in a group it may play in: the owner is a
-- current member and the group has Predictions on, else NOT_FOUND (the two
-- look the same). Takes the group row KEY SHARE (membership and setting
-- writes lock it FOR UPDATE) and then the per-group prediction lock.
create function app_public.group_prediction_enter(p_owner uuid, p_client_id text, p_group uuid) returns uuid
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid;
begin
  if p_owner is null or p_client_id is null or char_length(p_client_id) not between 1 and 200 then
    raise exception 'VALIDATION: an agent identity is required' using errcode = 'P0001';
  end if;
  perform 1 from app_public.groups g where g.id = p_group and g.deleted_at is null for key share;
  if app_public.group_active_role(p_group, p_owner) is null
     or not coalesce((select s.enabled from app_public.group_prediction_settings s where s.group_id = p_group), false) then
    raise exception 'NOT_FOUND: group not found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-prediction:' || p_group::text, 0));
  insert into app_public.group_prediction_bettors(user_id, client_id) values (p_owner, p_client_id)
  on conflict (user_id, client_id) do nothing;
  select b.id into strict _bettor from app_public.group_prediction_bettors b
   where b.user_id = p_owner and b.client_id = p_client_id;
  return _bettor;
end $$;

-- The open board is next week's: it opens when this week starts and closes
-- when next week starts. A group without a zone has no board.
create function app_public.group_prediction_open_board(p_group uuid, p_week date, p_now timestamptz)
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
  if p_now >= _board.starts_at then
    raise exception 'CONFLICT: this board has closed' using errcode = 'P0001';
  end if;
  return _board;
end $$;

-- Validates a template and its parameters into a market row (not stored).
-- Each template takes exactly its keys; a member must be current and an
-- exercise live; e1RM lines refuse Hold exercises.
create function app_public.group_prediction_market_key(p_group uuid, p_template text, p_parameters jsonb)
returns app_public.group_prediction_markets
language plpgsql stable set search_path = app_public, pg_temp as $$
declare _m app_public.group_prediction_markets; _need text[]; _keys text[]; _default text; _line numeric;
begin
  _need := case p_template
    when 'e1rm_line' then array['group_exercise_id', 'line', 'member_user_id']
    when 'sets_line' then array['line', 'member_user_id']
    when 'records_line' then array['line']
    when 'cow_top' then array['member_user_id', 'metric']
    when 'lead_change' then array['group_exercise_id', 'metric'] end;
  if _need is null then
    raise exception 'VALIDATION: choose a market template' using errcode = 'P0001';
  end if;
  if p_parameters is null or jsonb_typeof(p_parameters) <> 'object' then
    raise exception 'VALIDATION: market parameters must be an object' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(k order by k), '{}') into _keys from jsonb_object_keys(p_parameters) k;
  if _keys <> _need or exists (select 1 from jsonb_each(p_parameters) e where jsonb_typeof(e.value) = 'null') then
    raise exception 'VALIDATION: % takes exactly %', p_template, array_to_string(_need, ', ') using errcode = 'P0001';
  end if;
  _m.group_id := p_group;
  _m.template := p_template;
  begin
    _m.member_user_id := (p_parameters ->> 'member_user_id')::uuid;
    _m.group_exercise_id := (p_parameters ->> 'group_exercise_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'VALIDATION: market parameters need valid ids' using errcode = 'P0001';
  end;
  if p_parameters ? 'metric' then
    if jsonb_typeof(p_parameters -> 'metric') <> 'string' then
      raise exception 'VALIDATION: metric must be a string' using errcode = 'P0001';
    end if;
    _m.metric := p_parameters ->> 'metric';
  end if;
  if p_parameters ? 'line' then
    if jsonb_typeof(p_parameters -> 'line') <> 'number' then
      raise exception 'VALIDATION: line must be a number' using errcode = 'P0001';
    end if;
    _line := (p_parameters ->> 'line')::numeric;
  end if;
  if p_template = 'e1rm_line' and not coalesce(_line between 80 and 120 and mod(_line * 10, 25) = 0, false) then
    raise exception 'VALIDATION: an e1RM line is 80 to 120 percent of baseline in steps of 2.5' using errcode = 'P0001';
  elsif p_template = 'sets_line' and not coalesce(_line between 5 and 200 and mod(_line, 5) = 0, false) then
    raise exception 'VALIDATION: a sets line is 5 to 200 in steps of 5' using errcode = 'P0001';
  elsif p_template = 'records_line' and not coalesce(_line between 1 and 50 and _line = trunc(_line), false) then
    raise exception 'VALIDATION: a records line is a whole number from 1 to 50' using errcode = 'P0001';
  elsif p_template = 'cow_top' and _m.metric not in ('e1rm', 'volume', 'improvement') then
    raise exception 'VALIDATION: a CoW metric is e1rm, volume or improvement' using errcode = 'P0001';
  elsif p_template = 'lead_change' and _m.metric not in ('e1rm', 'volume', 'seconds') then
    raise exception 'VALIDATION: a leaderboard metric is e1rm, volume or seconds' using errcode = 'P0001';
  end if;
  if _m.member_user_id is not null and not exists (select 1 from app_public.group_memberships gm
      where gm.group_id = p_group and gm.user_id = _m.member_user_id and gm.ended_at is null) then
    raise exception 'VALIDATION: that member is not in this group' using errcode = 'P0001';
  end if;
  if _m.group_exercise_id is not null then
    select ge.default_metric into _default from app_public.group_exercises ge
     where ge.id = _m.group_exercise_id and ge.group_id = p_group and ge.archived_at is null;
    if not found then
      raise exception 'VALIDATION: choose a live group exercise' using errcode = 'P0001';
    end if;
    if p_template = 'e1rm_line' and _default = 'seconds' then
      raise exception 'VALIDATION: a Hold exercise has no e1RM line' using errcode = 'P0001';
    end if;
    if p_template = 'lead_change' and (_default = 'seconds') <> (_m.metric = 'seconds') then
      raise exception 'VALIDATION: this metric does not apply to that exercise' using errcode = 'P0001';
    end if;
  end if;
  -- Assigned only after the step checks: the column rounds to one decimal.
  _m.line := _line;
  return _m;
end $$;

create function app_public.group_prediction_market_for(p_board app_public.group_prediction_boards, p_template text,
  p_parameters jsonb, p_now timestamptz) returns app_public.group_prediction_markets
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _key app_public.group_prediction_markets; _m app_public.group_prediction_markets;
begin
  _key := app_public.group_prediction_market_key(p_board.group_id, p_template, p_parameters);
  select * into _m from app_public.group_prediction_markets m
   where m.group_id = p_board.group_id and m.week_start = p_board.week_start and m.template = _key.template
     and m.member_user_id is not distinct from _key.member_user_id
     and m.group_exercise_id is not distinct from _key.group_exercise_id
     and m.metric is not distinct from _key.metric and m.line is not distinct from _key.line;
  if not found then
    insert into app_public.group_prediction_markets(group_id, week_start, template, member_user_id,
      group_exercise_id, metric, line, created_at)
    values (p_board.group_id, p_board.week_start, _key.template, _key.member_user_id, _key.group_exercise_id,
      _key.metric, _key.line, p_now)
    returning * into _m;
  end if;
  return _m;
end $$;

-- The answered offer's market for a counter, rechecked as if posted fresh.
-- Template and parameters, when given, must name that same market.
create function app_public.group_prediction_counter_market(p_board app_public.group_prediction_boards,
  p_answered app_public.group_prediction_offers, p_template text, p_parameters jsonb)
returns app_public.group_prediction_markets
language plpgsql stable set search_path = app_public, pg_temp as $$
declare _m app_public.group_prediction_markets; _key app_public.group_prediction_markets;
begin
  select * into strict _m from app_public.group_prediction_markets m where m.id = p_answered.market_id;
  if _m.week_start <> p_board.week_start then
    raise exception 'CONFLICT: that offer''s board has closed' using errcode = 'P0001';
  end if;
  perform app_public.group_prediction_market_key(_m.group_id, _m.template, app_public.group_prediction_parameters_json(_m));
  if p_template is not null or p_parameters is not null then
    _key := app_public.group_prediction_market_key(_m.group_id, p_template, p_parameters);
    if (_key.template, _key.member_user_id, _key.group_exercise_id, _key.metric, _key.line)
       is distinct from (_m.template, _m.member_user_id, _m.group_exercise_id, _m.metric, _m.line) then
      raise exception 'VALIDATION: a counter is on the market of the offer it answers' using errcode = 'P0001';
    end if;
  end if;
  return _m;
end $$;

-- Fills a taker offer against a resting one at p_price, under the group's
-- prediction lock. Returns the match, or null when the rounding leaves a
-- side with nothing to stake.
create function app_public.group_prediction_match(p_taker uuid, p_resting uuid, p_price integer, p_via text,
  p_now timestamptz) returns app_public.group_prediction_matches
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _t app_public.group_prediction_offers; _r app_public.group_prediction_offers;
  _yes app_public.group_prediction_offers; _no app_public.group_prediction_offers;
  _fill record; _match app_public.group_prediction_matches;
begin
  select * into strict _t from app_public.group_prediction_offers where id = p_taker for update;
  select * into strict _r from app_public.group_prediction_offers where id = p_resting for update;
  if _t.side = _r.side or _t.market_id <> _r.market_id or _t.bettor_id = _r.bettor_id
     or _t.released_at is not null or _r.released_at is not null then
    raise exception 'group_prediction_match: offers % and % cannot match', p_taker, p_resting;
  end if;
  if _t.side = 'yes' then _yes := _t; _no := _r; else _yes := _r; _no := _t; end if;
  select * into _fill from app_public.group_prediction_fill(_yes.remaining_cents, _no.remaining_cents, p_price);
  if _fill.yes_cents <= 0 or _fill.no_cents <= 0 then
    return null;
  end if;
  update app_public.group_prediction_offers set remaining_cents = remaining_cents - _fill.yes_cents where id = _yes.id;
  update app_public.group_prediction_offers set remaining_cents = remaining_cents - _fill.no_cents where id = _no.id;
  insert into app_public.group_prediction_matches(market_id, yes_offer_id, no_offer_id, yes_bettor_id, no_bettor_id,
    price, yes_stake_cents, no_stake_cents, via, created_at)
  values (_t.market_id, _yes.id, _no.id, _yes.bettor_id, _no.bettor_id, p_price, _fill.yes_cents, _fill.no_cents,
    p_via, p_now)
  returning * into _match;
  return _match;
end $$;

-- Checks a new offer's own fields; returns its stake in hundredths.
create function app_public.group_prediction_offer_check(p_side text, p_price integer, p_stake numeric,
  p_walk_away_price integer, p_note text) returns integer
language plpgsql stable set search_path = app_public, pg_temp as $$
begin
  if p_side is null or p_side not in ('yes', 'no') then
    raise exception 'VALIDATION: side is yes or no' using errcode = 'P0001';
  end if;
  if p_price is null or p_price not between 1 and 99 then
    raise exception 'VALIDATION: price is a whole number from 1 to 99' using errcode = 'P0001';
  end if;
  if p_stake is null or p_stake not between 0.01 and 100 or p_stake * 100 <> trunc(p_stake * 100) then
    raise exception 'VALIDATION: stake is 0.01 to 100.00 points with at most two decimals' using errcode = 'P0001';
  end if;
  if p_walk_away_price is not null and not (p_walk_away_price between 1 and 99
      and (case when p_side = 'yes' then p_walk_away_price >= p_price else p_walk_away_price <= p_price end)) then
    raise exception 'VALIDATION: a walk-away price is 1 to 99, at or past the offer''s price' using errcode = 'P0001';
  end if;
  if char_length(nullif(app_public.group_exercise_trim(p_note), '')) > 140 then
    raise exception 'VALIDATION: a note is at most 140 characters' using errcode = 'P0001';
  end if;
  return (p_stake * 100)::integer;
end $$;

-- Post, take or counter one offer (contract "Offers, matching and counters").
-- p_now is the clock, so tests can move time.
create function app_public.agent_group_prediction_post_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid, p_week_start date, p_template text, p_parameters jsonb, p_side text, p_price integer,
  p_stake numeric, p_walk_away_price integer, p_note text, p_answers_offer_id uuid) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid; _board app_public.group_prediction_boards; _market app_public.group_prediction_markets;
  _answered app_public.group_prediction_offers; _offer app_public.group_prediction_offers;
  _match app_public.group_prediction_matches; _side text := p_side; _cents integer; _exposure bigint;
  _matches jsonb := '[]'::jsonb; _r record;
begin
  _bettor := app_public.group_prediction_enter(p_owner, p_client_id, p_group_id);
  _board := app_public.group_prediction_open_board(p_group_id, p_week_start, p_now);
  if p_answers_offer_id is not null then
    select o.* into _answered from app_public.group_prediction_offers o
      join app_public.group_prediction_markets m on m.id = o.market_id
     where o.id = p_answers_offer_id and m.group_id = p_group_id;
    if not found then
      raise exception 'NOT_FOUND: offer not found' using errcode = 'P0001';
    end if;
    _market := app_public.group_prediction_counter_market(_board, _answered, p_template, p_parameters);
    if _answered.bettor_id = _bettor then
      raise exception 'VALIDATION: an AI cannot counter its own offer' using errcode = 'P0001';
    end if;
    if _side is null then
      _side := case when _answered.side = 'yes' then 'no' else 'yes' end;
    elsif _side = _answered.side then
      raise exception 'VALIDATION: a counter takes the other side' using errcode = 'P0001';
    end if;
  end if;
  _cents := app_public.group_prediction_offer_check(_side, p_price, p_stake, p_walk_away_price, p_note);
  if _answered.id is null then
    _market := app_public.group_prediction_market_for(_board, p_template, p_parameters, p_now);
  elsif exists (select 1 from app_public.group_prediction_offers o
      where o.answers_offer_id = _answered.id and o.bettor_id = _bettor) then
    raise exception 'DUPLICATE: this AI already countered that offer' using errcode = 'P0001';
  end if;
  _exposure := app_public.group_prediction_exposure(_bettor, p_group_id, _board.week_start);
  if _exposure + _cents > 10000 then
    raise exception 'VALIDATION: this offer needs % points; % are left this week',
      app_public.group_prediction_points(_cents), app_public.group_prediction_points(10000 - _exposure)
      using errcode = 'P0001';
  end if;
  insert into app_public.group_prediction_offers(market_id, bettor_id, side, price, stake_cents, remaining_cents,
    walk_away_price, note, answers_offer_id, created_at)
  values (_market.id, _bettor, _side, p_price, _cents, _cents, p_walk_away_price,
    nullif(app_public.group_exercise_trim(p_note), ''), _answered.id, p_now)
  returning * into _offer;

  -- A counter that does not cross the answered offer's posted price matches
  -- it at the counter's price when inside that offer's walk-away price.
  if _answered.id is not null and _answered.walk_away_price is not null
     and _answered.remaining_cents > 0 and _answered.released_at is null
     and app_public.group_prediction_bettor_current(_answered.bettor_id, p_group_id)
     and (case when _answered.side = 'yes' then p_price > _answered.price and p_price <= _answered.walk_away_price
               else p_price < _answered.price and p_price >= _answered.walk_away_price end) then
    _match := app_public.group_prediction_match(_offer.id, _answered.id, p_price, 'counter', p_now);
    if _match.id is not null then
      _matches := _matches || app_public.group_prediction_match_json(_match, _bettor);
    end if;
  end if;

  -- Then the ordinary book: crossing offers of other bettors, best price then
  -- oldest, each at its own posted price.
  for _r in select o.id, o.price from app_public.group_prediction_offers o
     where o.market_id = _market.id and o.side <> _side and o.remaining_cents > 0 and o.released_at is null
       and o.bettor_id <> _bettor and app_public.group_prediction_bettor_current(o.bettor_id, p_group_id)
       and case when _side = 'yes' then o.price <= p_price else o.price >= p_price end
     order by case when _side = 'yes' then o.price else -o.price end, o.seq loop
    exit when (select o.remaining_cents from app_public.group_prediction_offers o where o.id = _offer.id) = 0;
    _match := app_public.group_prediction_match(_offer.id, _r.id, _r.price, 'cross', p_now);
    if _match.id is not null then
      _matches := _matches || app_public.group_prediction_match_json(_match, _bettor);
    end if;
  end loop;

  select * into strict _offer from app_public.group_prediction_offers where id = _offer.id;
  return jsonb_build_object('offer', app_public.group_prediction_own_offer_json(_offer),
    'market', app_public.group_prediction_market_json(_market), 'matches', _matches,
    'stake_left', app_public.group_prediction_points(
      10000 - app_public.group_prediction_exposure(_bettor, p_group_id, _board.week_start)));
end $$;

-- Withdraws the unmatched remainder of the agent's own offer while its board
-- is open. Matched stake stays. Withdrawing an offer with nothing left
-- changes nothing.
create function app_public.agent_group_prediction_withdraw_at(p_now timestamptz, p_owner uuid, p_client_id text,
  p_group_id uuid, p_offer_id uuid) returns jsonb
language plpgsql volatile set search_path = app_public, pg_temp as $$
declare _bettor uuid; _offer app_public.group_prediction_offers; _week date; _starts timestamptz; _freed integer := 0;
begin
  _bettor := app_public.group_prediction_enter(p_owner, p_client_id, p_group_id);
  select o.* into _offer from app_public.group_prediction_offers o
    join app_public.group_prediction_markets m on m.id = o.market_id
   where o.id = p_offer_id and m.group_id = p_group_id and o.bettor_id = _bettor
     for update of o;
  if not found then
    raise exception 'NOT_FOUND: offer not found' using errcode = 'P0001';
  end if;
  select b.week_start, b.starts_at into strict _week, _starts from app_public.group_prediction_boards b
    join app_public.group_prediction_markets m on m.group_id = b.group_id and m.week_start = b.week_start
   where m.id = _offer.market_id;
  if p_now >= _starts then
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
-- RPCs
-- ---------------------------------------------------------------------------

-- Any current member reads the setting.
create function app_public.group_prediction_settings_get(p_group_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user();
begin
  perform 1 from app_public.groups where id = p_group_id and deleted_at is null for key share;
  perform app_public.group_require_member(p_group_id, _uid, false);
  return app_public.group_prediction_settings_json(p_group_id);
end $$;

-- Only an owner or admin changes it. Locks the group row FOR UPDATE, so it
-- serializes with in-flight agent writes (which hold KEY SHARE).
create function app_public.group_prediction_settings_set(p_group_id uuid, p_enabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare _uid uuid := app_public.group_require_app_user();
begin
  if app_public.group_require_member(p_group_id, _uid, true) not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only owners and admins can change predictions' using errcode = 'P0001';
  end if;
  if p_enabled is null then
    raise exception 'VALIDATION: choose on or off' using errcode = 'P0001';
  end if;
  insert into app_public.group_prediction_settings(group_id, enabled, updated_by, updated_at)
  values (p_group_id, p_enabled, _uid, clock_timestamp())
  on conflict (group_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  where group_prediction_settings.enabled is distinct from excluded.enabled;
  return app_public.group_prediction_settings_json(p_group_id);
end $$;

-- Service-role only, called by agent-api with the validated owner and
-- client (spec 10 rules 15 and 17).
create function app_public.agent_group_prediction_post(p_owner uuid, p_client_id text, p_group_id uuid,
  p_week_start date, p_template text default null, p_parameters jsonb default null, p_side text default null,
  p_price integer default null, p_stake numeric default null, p_walk_away_price integer default null,
  p_note text default null, p_answers_offer_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_post_at(clock_timestamp(), p_owner, p_client_id, p_group_id, p_week_start,
    p_template, p_parameters, p_side, p_price, p_stake, p_walk_away_price, p_note, p_answers_offer_id);
end $$;

create function app_public.agent_group_prediction_withdraw(p_owner uuid, p_client_id text, p_group_id uuid,
  p_offer_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  perform app_public.agent_group_prediction_require_service();
  return app_public.agent_group_prediction_withdraw_at(clock_timestamp(), p_owner, p_client_id, p_group_id, p_offer_id);
end $$;

-- ---------------------------------------------------------------------------
-- Posture: tables closed to every API role; the setting RPCs are
-- client-executable, the agent RPCs service-role only, the rest internal.
-- ---------------------------------------------------------------------------

do $$
declare t text; f record;
begin
  foreach t in array array['group_prediction_settings', 'group_prediction_bettors', 'group_prediction_boards',
      'group_prediction_markets', 'group_prediction_offers', 'group_prediction_matches'] loop
    execute format('alter table app_public.%I enable row level security', t);
    execute format('revoke all on app_public.%I from public, anon, authenticated, service_role', t);
  end loop;
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public' and (p.proname like 'group\_prediction\_%' or p.proname like 'agent\_group\_prediction\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.proname in ('group_prediction_settings_get', 'group_prediction_settings_set') then
      execute format('grant execute on function %s to anon, authenticated', f.signature);
    elsif f.proname in ('agent_group_prediction_post', 'agent_group_prediction_withdraw') then
      execute format('grant execute on function %s to service_role', f.signature);
    end if;
  end loop;
end $$;
