import type {
  PredictionBettorWire, PredictionBoardWire, PredictionHistoryWire, PredictionMarketWire, PredictionMatchWire, PredictionOfferWire,
  PredictionRankingWire, PredictionThreadWire,
} from '@/src/groups/prediction-wire';

// Payloads as the member prediction readers return them.

export const bettorFixture = (n: 'alex' | 'blair' | 'cleo', client = 'Claude', current = true): PredictionBettorWire => ({
  bettor_id: `bet-${n}-${client}`, member: { user_id: `u-${n}`, username: n[0].toUpperCase() + n.slice(1) }, client_name: client,
  display_name: `${n[0].toUpperCase() + n.slice(1)} · ${client}`, current_member: current,
});

export const marketFixture = (over: Partial<PredictionMarketWire> = {}): PredictionMarketWire => ({
  market_id: 'mk-1', group_id: 'g1', week_start: '2026-11-30', template: 'records_line', parameters: { line: 3 }, member: null,
  exercise_name: null, baseline: null, outcome: null, result_value: null, result_unit: null, ...over,
});
export const e1rmMarketFixture = (over: Partial<PredictionMarketWire> = {}): PredictionMarketWire => marketFixture({
  market_id: 'mk-e1rm', template: 'e1rm_line', parameters: { group_exercise_id: 'ge1', line: 102.5, member_user_id: 'u-alex' },
  member: { user_id: 'u-alex', username: 'Alex' }, exercise_name: 'Squat', ...over });

export const offerFixture = (over: Partial<PredictionOfferWire> = {}): PredictionOfferWire => ({
  offer_id: 'of-1', market_id: 'mk-1', bettor: bettorFixture('alex'), side: 'yes', price: 60, stake: 10, remaining: 4, matched: 6, released: 0,
  state: 'open', live: true, answers_offer_id: null, note: 'Quiet week', created_at_ms: 1_000, released_at_ms: null, ...over,
});

export const matchFixture = (over: Partial<PredictionMatchWire> = {}): PredictionMatchWire => ({
  match_id: 'ma-1', market_id: 'mk-1', price: 60, via: 'cross', yes_offer_id: 'of-1', no_offer_id: 'of-2',
  yes_bettor: bettorFixture('alex'), no_bettor: bettorFixture('blair'), yes_stake: 6, no_stake: 4, winner: null, created_at_ms: 2_000, ...over,
});

const week = { week_start: '2026-11-23', starts_at_ms: 1_795_392_000_000, ends_at_ms: 1_795_996_800_000 };
const nextWeek = { week_start: '2026-11-30', starts_at_ms: 1_795_996_800_000, ends_at_ms: 1_796_601_600_000 };

export const boardFixture = (over: Partial<PredictionBoardWire> = {}): PredictionBoardWire => ({
  group_id: 'g1', time_zone: 'UTC',
  this_week: { ...week, state: 'closed', markets: [{ market: marketFixture({ market_id: 'mk-now', week_start: '2026-11-23' }),
    bets: [matchFixture({ market_id: 'mk-now' })] }] },
  next_week: { ...nextWeek, state: 'open', markets: [
    { market: marketFixture(), open_offers: 1, best_yes: 60, best_no: null, open_stake: 4, matched_bets: 1, last_price: 60 },
    { market: e1rmMarketFixture(), open_offers: 2, best_yes: 55, best_no: 70, open_stake: 9.5, matched_bets: 0, last_price: null }] },
  ...over,
});

export const threadFixture = (over: Partial<PredictionThreadWire> = {}): PredictionThreadWire => ({
  group_id: 'g1', market: marketFixture(), week: { ...nextWeek, state: 'open' },
  offers: [offerFixture(), offerFixture({ offer_id: 'of-2', bettor: bettorFixture('blair'), side: 'no', price: 50, stake: 4, remaining: 0, matched: 4,
    state: 'filled', live: false, note: null, created_at_ms: 1_500 })],
  matches: [matchFixture()], ...over,
});

const row = (n: 'alex' | 'blair' | 'cleo', client: string, week_profit: number, all: number, matched: number): PredictionRankingWire['rows'][number] => ({
  bettor: bettorFixture(n, client), week_profit, all_time_profit: all, matched, wins: matched, losses: 0, voids: 0, weeks: 1,
  head_to_head: [{ opponent: bettorFixture('cleo'), matched, wins: matched, losses: 0, voids: 0, profit: all }],
  recent: [{ week_start: '2026-11-23', profit: week_profit, matched, wins: matched, losses: 0, voids: 0 }],
});
export const rankingFixture = (over: Partial<PredictionRankingWire> = {}): PredictionRankingWire => ({
  group_id: 'g1', week_start: '2026-11-23', rows: [row('alex', 'Claude', 6, 6, 1), row('blair', 'Codex', 1.66, 3, 2)], ...over,
});

export const historyFixture = (over: Partial<PredictionHistoryWire> = {}): PredictionHistoryWire => ({
  group_id: 'g1', next_cursor: null, weeks: [{ ...week, settled_at_ms: week.ends_at_ms + 60_000,
    markets: [{ market: marketFixture({ market_id: 'mk-old', week_start: '2026-11-23', outcome: 'no', result_value: 0, result_unit: 'records' }),
      bets: [matchFixture({ market_id: 'mk-old', winner: 'no' })] }],
    results: [{ bettor: bettorFixture('blair'), profit: 6, matched: 1, wins: 1, losses: 0, voids: 0 },
      { bettor: bettorFixture('alex'), profit: -6, matched: 1, wins: 0, losses: 1, voids: 0 }] }], ...over,
});
