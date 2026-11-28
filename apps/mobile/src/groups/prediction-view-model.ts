import type {
  PredictionBettorWire, PredictionBoardMarketWire, PredictionBoardWire, PredictionHistoryWeekWire, PredictionMarketBetsWire,
  PredictionMarketWire, PredictionMatchWire, PredictionOfferWire, PredictionOutcome, PredictionRankingRowWire, PredictionRankingWire,
  PredictionTemplate, PredictionThreadWire, PredictionWeekState,
} from './prediction-wire.ts';

// View models of the member prediction reads
// (`docs/specs/tech/group-predictions-contract.md`, "Member screens"). They turn
// wire payloads into rows a screen draws and expose each market's template
// parameters and figures; statement text and layout belong to the screens.

export type PredictionTone = 'gain' | 'loss' | 'even';

const cents = (points: number): number => Math.round(points * 100);

/** Play points to two decimals, from whole hundredths (so `-0.001` is `0.00`, never `-0.00`). */
export const formatPredictionPoints = (points: number): string => {
  const total = cents(points);
  const abs = Math.abs(total);
  return `${total < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** A profit with its sign as the app's signed figures show it ([[comparison.change-display]]): `+12.50`, `−3.00`, `0.00`. */
export const formatPredictionProfit = (profit: number): string => {
  const text = formatPredictionPoints(profit);
  return cents(profit) > 0 ? `+${text}` : text.replace(/^-/, '−');
};

export const predictionProfitTone = (profit: number): PredictionTone => (cents(profit) > 0 ? 'gain' : cents(profit) < 0 ? 'loss' : 'even');

export type PredictionBettor = { bettorId: string; userId: string; name: string; own: boolean; former: boolean };
export const toPredictionBettor = (bettor: PredictionBettorWire, viewerUserId: string): PredictionBettor => ({
  bettorId: bettor.bettor_id, userId: bettor.member.user_id, name: bettor.display_name,
  own: bettor.member.user_id === viewerUserId, former: !bettor.current_member,
});

/** What a market's statement is built from: its template, parameters and figures. */
export type PredictionMarketFacts = {
  marketId: string; template: PredictionTemplate; weekStart: string; memberUserId: string | null; memberName: string | null;
  exerciseName: string | null; metric: string | null; line: number | null;
  /** The frozen baseline of an e1RM line, once the board has closed. */
  baseline: { value: number; unit: string } | null;
  /** An e1RM line's target (the baseline times the line), once the baseline is known. */
  target: number | null;
  outcome: PredictionOutcome | null; resultValue: number | null; resultUnit: string | null;
};

export const toPredictionMarketFacts = (market: PredictionMarketWire): PredictionMarketFacts => {
  const { parameters: p, baseline } = market;
  return {
    marketId: market.market_id, template: market.template, weekStart: market.week_start,
    memberUserId: p.member_user_id ?? null, memberName: market.member?.username ?? null,
    exerciseName: market.exercise_name, metric: p.metric ?? null, line: p.line ?? null,
    baseline, target: baseline !== null && p.line !== undefined ? (baseline.value * p.line) / 100 : null,
    outcome: market.outcome, resultValue: market.result_value, resultUnit: market.result_unit,
  };
};

// ---- Board ---------------------------------------------------------------------

export type PredictionBoardMarketRow = {
  facts: PredictionMarketFacts; openOffers: number; bestYes: number | null; bestNo: number | null; openStake: number;
  matchedBets: number; lastPrice: number | null;
};
export type PredictionBetRow = {
  matchId: string; facts: PredictionMarketFacts; price: number; via: 'cross' | 'counter'; yes: PredictionBettor; no: PredictionBettor;
  yesStake: number; noStake: number; /** The viewer's user has an AI on either side. */ own: boolean;
  winner: 'yes' | 'no' | null; /** Points the winner takes: the loser's stake; 0 while pending and for a void market. */ moved: number;
};
export type PredictionBoardView = {
  timeZone: string | null;
  nextWeek: { weekStart: string; state: PredictionWeekState; closesAtMs: number; closesInMs: number; markets: PredictionBoardMarketRow[] } | null;
  thisWeek: { weekStart: string; state: PredictionWeekState; endsAtMs: number; bets: PredictionBetRow[] } | null;
};

const betRow = (market: PredictionMarketWire, bet: PredictionMatchWire, viewerUserId: string): PredictionBetRow => {
  const yes = toPredictionBettor(bet.yes_bettor, viewerUserId);
  const no = toPredictionBettor(bet.no_bettor, viewerUserId);
  const moved = bet.winner === 'yes' ? bet.no_stake : bet.winner === 'no' ? bet.yes_stake : 0;
  return { matchId: bet.match_id, facts: toPredictionMarketFacts(market), price: bet.price, via: bet.via, yes, no,
    yesStake: bet.yes_stake, noStake: bet.no_stake, own: yes.own || no.own, winner: bet.winner, moved };
};

/** Matched bets, oldest market first, each market's bets oldest first. */
export const predictionBetRows = (markets: PredictionMarketBetsWire[], viewerUserId: string): PredictionBetRow[] =>
  markets.flatMap(({ market, bets }) => bets.map(bet => betRow(market, bet, viewerUserId)));

const boardMarketRow = (row: PredictionBoardMarketWire): PredictionBoardMarketRow => ({
  facts: toPredictionMarketFacts(row.market), openOffers: row.open_offers, bestYes: row.best_yes, bestNo: row.best_no,
  openStake: row.open_stake, matchedBets: row.matched_bets, lastPrice: row.last_price,
});

export const buildPredictionBoard = (board: PredictionBoardWire, viewerUserId: string, nowMs: number): PredictionBoardView => ({
  timeZone: board.time_zone,
  nextWeek: board.next_week && {
    weekStart: board.next_week.week_start, state: board.next_week.state, closesAtMs: board.next_week.starts_at_ms,
    closesInMs: Math.max(0, board.next_week.starts_at_ms - nowMs), markets: board.next_week.markets.map(boardMarketRow),
  },
  thisWeek: board.this_week && {
    weekStart: board.this_week.week_start, state: board.this_week.state, endsAtMs: board.this_week.ends_at_ms,
    bets: predictionBetRows(board.this_week.markets, viewerUserId),
  },
});

// ---- Thread --------------------------------------------------------------------

export type PredictionThreadItem =
  | { kind: 'offer' | 'counter'; key: string; atMs: number; bettor: PredictionBettor; side: 'yes' | 'no'; price: number; stake: number; note: string | null;
      /** A counter's answered offer: its id and posted price (null when it is not in this thread). */
      answersOfferId: string | null; answeredPrice: number | null }
  | { kind: 'match'; key: string; atMs: number; bet: PredictionBetRow }
  | { kind: 'withdrawn' | 'expired'; key: string; atMs: number; bettor: PredictionBettor; side: 'yes' | 'no'; price: number; released: number }
  | { kind: 'result'; key: string; atMs: number; outcome: PredictionOutcome; resultValue: number | null; resultUnit: string | null };
export type PredictionThreadView = {
  facts: PredictionMarketFacts; weekStart: string; weekState: PredictionWeekState; closesAtMs: number; items: PredictionThreadItem[];
};

const KIND_ORDER: Record<PredictionThreadItem['kind'], number> = { offer: 0, counter: 0, match: 1, withdrawn: 2, expired: 2, result: 3 };

const offerItems = (offers: PredictionOfferWire[], viewerUserId: string): PredictionThreadItem[] => {
  const priceById = new Map(offers.map(offer => [offer.offer_id, offer.price]));
  return offers.flatMap<PredictionThreadItem>(offer => {
    const bettor = toPredictionBettor(offer.bettor, viewerUserId);
    const shared = { bettor, side: offer.side, price: offer.price };
    const posted: PredictionThreadItem = { ...shared, kind: offer.answers_offer_id === null ? 'offer' : 'counter', key: `offer:${offer.offer_id}`,
      atMs: offer.created_at_ms, stake: offer.stake, note: offer.note, answersOfferId: offer.answers_offer_id,
      answeredPrice: offer.answers_offer_id === null ? null : priceById.get(offer.answers_offer_id) ?? null };
    const released: PredictionThreadItem[] = offer.released_at_ms !== null && (offer.state === 'withdrawn' || offer.state === 'expired')
      ? [{ ...shared, kind: offer.state, key: `release:${offer.offer_id}`, atMs: offer.released_at_ms, released: offer.released }] : [];
    return [posted, ...released];
  });
};

/** The thread oldest first: offers and counters, matches, withdrawals and expiries, then the result. */
export const buildPredictionThread = (thread: PredictionThreadWire, viewerUserId: string): PredictionThreadView => {
  const facts = toPredictionMarketFacts(thread.market);
  const matches = thread.matches.map<PredictionThreadItem>(match => ({ kind: 'match', key: `match:${match.match_id}`, atMs: match.created_at_ms,
    bet: betRow(thread.market, match, viewerUserId) }));
  const result: PredictionThreadItem[] = thread.market.outcome === null ? [] : [{ kind: 'result', key: 'result', atMs: thread.week.ends_at_ms,
    outcome: thread.market.outcome, resultValue: thread.market.result_value, resultUnit: thread.market.result_unit }];
  const items = [...offerItems(thread.offers, viewerUserId), ...matches, ...result]
    .sort((a, b) => a.atMs - b.atMs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key));
  return { facts, weekStart: thread.week.week_start, weekState: thread.week.state, closesAtMs: thread.week.starts_at_ms, items };
};

// ---- Ranking -------------------------------------------------------------------

export type PredictionResultRow = { weekStart: string; profit: number; profitLabel: string; tone: PredictionTone; matched: number };
export type PredictionHeadToHeadRow = {
  opponent: PredictionBettor; matched: number; wins: number; losses: number; voids: number; profit: number; profitLabel: string; tone: PredictionTone;
};
export type PredictionRankingRow = {
  rank: number; bettor: PredictionBettor; weekProfit: number; weekProfitLabel: string; weekTone: PredictionTone;
  allTimeProfit: number; allTimeProfitLabel: string; allTimeTone: PredictionTone; matched: number; wins: number; losses: number; voids: number;
  headToHead: PredictionHeadToHeadRow[]; recent: PredictionResultRow[];
};
export type PredictionRankingView = { weekStart: string | null; rows: PredictionRankingRow[] };

const compareRows = (a: PredictionRankingRowWire, b: PredictionRankingRowWire): number =>
  cents(b.week_profit) - cents(a.week_profit) || cents(b.all_time_profit) - cents(a.all_time_profit) || b.matched - a.matched ||
  a.bettor.display_name.localeCompare(b.bettor.display_name) || a.bettor.bettor_id.localeCompare(b.bettor.bettor_id);
const sameStanding = (a: PredictionRankingRowWire, b: PredictionRankingRowWire): boolean =>
  cents(a.week_profit) === cents(b.week_profit) && cents(a.all_time_profit) === cents(b.all_time_profit) && a.matched === b.matched;

const headToHeadRow = (h: PredictionRankingRowWire['head_to_head'][number], viewerUserId: string): PredictionHeadToHeadRow => ({
  opponent: toPredictionBettor(h.opponent, viewerUserId), matched: h.matched, wins: h.wins, losses: h.losses, voids: h.voids,
  profit: h.profit, profitLabel: formatPredictionProfit(h.profit), tone: predictionProfitTone(h.profit),
});

const rankingRow = (row: PredictionRankingRowWire, rank: number, viewerUserId: string): PredictionRankingRow => ({
  rank, bettor: toPredictionBettor(row.bettor, viewerUserId),
  weekProfit: row.week_profit, weekProfitLabel: formatPredictionProfit(row.week_profit), weekTone: predictionProfitTone(row.week_profit),
  allTimeProfit: row.all_time_profit, allTimeProfitLabel: formatPredictionProfit(row.all_time_profit), allTimeTone: predictionProfitTone(row.all_time_profit),
  matched: row.matched, wins: row.wins, losses: row.losses, voids: row.voids,
  headToHead: row.head_to_head.map(h => headToHeadRow(h, viewerUserId))
    .sort((a, b) => b.matched - a.matched || a.opponent.name.localeCompare(b.opponent.name) || a.opponent.bettorId.localeCompare(b.opponent.bettorId)),
  recent: [...row.recent].sort((a, b) => b.week_start.localeCompare(a.week_start)).map(r => ({
    weekStart: r.week_start, profit: r.profit, profitLabel: formatPredictionProfit(r.profit), tone: predictionProfitTone(r.profit), matched: r.matched })),
});

/** AIs ranked by the latest settled week's profit, then all-time profit, then matched bets; equal standings share a rank. */
export const buildPredictionRanking = (ranking: PredictionRankingWire, viewerUserId: string): PredictionRankingView => {
  const sorted = [...ranking.rows].sort(compareRows);
  let rank = 1;
  const rows = sorted.map((row, index) => {
    if (index > 0 && !sameStanding(sorted[index - 1], row)) rank = index + 1;
    return rankingRow(row, rank, viewerUserId);
  });
  return { weekStart: ranking.week_start, rows };
};

// ---- History -------------------------------------------------------------------

export type PredictionHistoryMarketRow = { facts: PredictionMarketFacts; bets: PredictionBetRow[] };
export type PredictionHistoryWeekRow = {
  weekStart: string; startsAtMs: number; endsAtMs: number; markets: PredictionHistoryMarketRow[];
  results: { bettor: PredictionBettor; profit: number; profitLabel: string; tone: PredictionTone; matched: number }[];
};

export const buildPredictionHistoryWeek = (week: PredictionHistoryWeekWire, viewerUserId: string): PredictionHistoryWeekRow => ({
  weekStart: week.week_start, startsAtMs: week.starts_at_ms, endsAtMs: week.ends_at_ms,
  markets: week.markets.map(({ market, bets }) => ({ facts: toPredictionMarketFacts(market), bets: bets.map(bet => betRow(market, bet, viewerUserId)) })),
  results: week.results.map(r => ({ bettor: toPredictionBettor(r.bettor, viewerUserId), profit: r.profit, profitLabel: formatPredictionProfit(r.profit),
    tone: predictionProfitTone(r.profit), matched: r.matched })),
});
