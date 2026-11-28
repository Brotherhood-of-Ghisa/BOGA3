import type { GroupMemberRef } from './types.ts';

// Closed wire shapes of the member prediction reads
// (`docs/specs/tech/group-predictions-contract.md`, "Member screens"). Every
// guard rejects an unknown key, a wrong type and a field that contradicts
// another, so a server shape drift drops the whole read. Walk-away prices are
// not part of any shape: a payload carrying one fails its guard.

export type PredictionTemplate = 'e1rm_line' | 'sets_line' | 'records_line' | 'cow_top' | 'lead_change';
export type PredictionParametersWire = { member_user_id?: string; group_exercise_id?: string; metric?: string; line?: number };
export type PredictionBettorWire = { bettor_id: string; member: GroupMemberRef; client_name: string | null; display_name: string; current_member: boolean };
export type PredictionOutcome = 'yes' | 'no' | 'void';
export type PredictionMarketWire = {
  market_id: string; group_id: string; week_start: string; template: PredictionTemplate; parameters: PredictionParametersWire;
  member: GroupMemberRef | null; exercise_name: string | null; baseline: { value: number; unit: string } | null;
  outcome: PredictionOutcome | null; result_value: number | null; result_unit: string | null;
};
export type PredictionOfferState = 'open' | 'filled' | 'withdrawn' | 'expired';
export type PredictionOfferWire = {
  offer_id: string; market_id: string; bettor: PredictionBettorWire; side: 'yes' | 'no'; price: number; stake: number; remaining: number;
  matched: number; released: number; state: PredictionOfferState; live: boolean; answers_offer_id: string | null; note: string | null;
  created_at_ms: number; released_at_ms: number | null;
};
export type PredictionMatchWire = {
  match_id: string; market_id: string; price: number; via: 'cross' | 'counter'; yes_offer_id: string; no_offer_id: string;
  yes_bettor: PredictionBettorWire; no_bettor: PredictionBettorWire; yes_stake: number; no_stake: number; winner: 'yes' | 'no' | null; created_at_ms: number;
};
export type PredictionWeekState = 'open' | 'closed' | 'settled';
export type PredictionWeekWire = { week_start: string; starts_at_ms: number; ends_at_ms: number; state: PredictionWeekState };
export type PredictionMarketBetsWire = { market: PredictionMarketWire; bets: PredictionMatchWire[] };
export type PredictionBoardMarketWire = {
  market: PredictionMarketWire; open_offers: number; best_yes: number | null; best_no: number | null; open_stake: number;
  matched_bets: number; last_price: number | null;
};
export type PredictionBoardWire = {
  group_id: string; time_zone: string | null;
  this_week: (PredictionWeekWire & { markets: PredictionMarketBetsWire[] }) | null;
  next_week: (PredictionWeekWire & { markets: PredictionBoardMarketWire[] }) | null;
};
export type PredictionThreadWire = { group_id: string; market: PredictionMarketWire; week: PredictionWeekWire; offers: PredictionOfferWire[]; matches: PredictionMatchWire[] };
export type PredictionResultWire = { week_start: string; profit: number; matched: number; wins: number; losses: number; voids: number };
export type PredictionHeadToHeadWire = { opponent: PredictionBettorWire; matched: number; wins: number; losses: number; voids: number; profit: number };
export type PredictionRankingRowWire = {
  bettor: PredictionBettorWire; week_profit: number; all_time_profit: number; matched: number; wins: number; losses: number; voids: number;
  weeks: number; head_to_head: PredictionHeadToHeadWire[]; recent: PredictionResultWire[];
};
export type PredictionRankingWire = { group_id: string; week_start: string | null; rows: PredictionRankingRowWire[] };
export type PredictionHistoryWeekWire = {
  week_start: string; starts_at_ms: number; ends_at_ms: number; settled_at_ms: number; markets: PredictionMarketBetsWire[];
  results: (Omit<PredictionResultWire, 'week_start'> & { bettor: PredictionBettorWire })[];
};
export type PredictionHistoryWire = { group_id: string; weeks: PredictionHistoryWeekWire[]; next_cursor: string | null };
export type PredictionSettingWire = { group_id: string; enabled: boolean };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const text = (v: unknown): v is string | null => v === null || typeof v === 'string';
const nullableId = (v: unknown): v is string | null => v === null || id(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableInteger = (v: unknown) => v === null || integer(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const points = (v: unknown): v is number => finite(v) && v >= 0;
const price = (v: unknown): v is number => integer(v) && v >= 1 && v <= 99;
const nullablePrice = (v: unknown) => v === null || price(v);
const weekStart = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const member = (v: unknown) => exact(v, ['user_id', 'username']) && id(v.user_id) && text(v.username);
const nullableMember = (v: unknown) => v === null || member(v);

export const isPredictionBettorWire = (v: unknown): v is PredictionBettorWire =>
  exact(v, ['bettor_id', 'member', 'client_name', 'display_name', 'current_member']) && id(v.bettor_id) && member(v.member) &&
  text(v.client_name) && id(v.display_name) && typeof v.current_member === 'boolean';

const METRICS: Record<string, string[]> = { cow_top: ['e1rm', 'volume', 'improvement'], lead_change: ['e1rm', 'volume', 'seconds'] };
const PARAMETER_KEYS: Record<string, string[]> = {
  e1rm_line: ['group_exercise_id', 'line', 'member_user_id'], sets_line: ['line', 'member_user_id'], records_line: ['line'],
  cow_top: ['member_user_id', 'metric'], lead_change: ['group_exercise_id', 'metric'],
};
const lineFits = (template: string, line: unknown): boolean => {
  if (!finite(line)) return false;
  if (template === 'e1rm_line') return line >= 80 && line <= 120 && (line * 10) % 25 === 0;
  if (template === 'sets_line') return line >= 5 && line <= 200 && line % 5 === 0;
  return line >= 1 && line <= 50 && Number.isInteger(line);
};
const parametersFit = (template: string, p: unknown): p is PredictionParametersWire => {
  const keys = PARAMETER_KEYS[template];
  if (!keys || !exact(p, keys)) return false;
  const metrics = METRICS[template];
  return (p.line === undefined || lineFits(template, p.line)) && (p.member_user_id === undefined || id(p.member_user_id)) &&
    (p.group_exercise_id === undefined || id(p.group_exercise_id)) && (metrics === undefined || metrics.includes(p.metric as string));
};

export function isPredictionMarketWire(v: unknown): v is PredictionMarketWire {
  if (!exact(v, ['market_id', 'group_id', 'week_start', 'template', 'parameters', 'member', 'exercise_name', 'baseline', 'outcome', 'result_value', 'result_unit'])) return false;
  const template = v.template;
  if (typeof template !== 'string' || !id(v.market_id) || !id(v.group_id) || !weekStart(v.week_start) || !parametersFit(template, v.parameters)) return false;
  const p = v.parameters as PredictionParametersWire;
  const baselineOk = v.baseline === null || (template === 'e1rm_line' && exact(v.baseline, ['value', 'unit']) && finite(v.baseline.value) && v.baseline.value > 0 && id(v.baseline.unit));
  const outcomeOk = v.outcome === null ? v.result_value === null && v.result_unit === null
    : ['yes', 'no', 'void'].includes(v.outcome as string) && (v.result_value === null) === (v.result_unit === null) && (v.result_value === null || finite(v.result_value));
  return nullableMember(v.member) && (p.member_user_id === undefined ? v.member === null : (v.member as GroupMemberRef | null)?.user_id === p.member_user_id) &&
    (p.group_exercise_id === undefined ? v.exercise_name === null : id(v.exercise_name)) && baselineOk && outcomeOk && text(v.result_unit);
}

export function isPredictionOfferWire(v: unknown): v is PredictionOfferWire {
  if (!exact(v, ['offer_id', 'market_id', 'bettor', 'side', 'price', 'stake', 'remaining', 'matched', 'released', 'state', 'live', 'answers_offer_id', 'note', 'created_at_ms', 'released_at_ms'])) return false;
  const stake = v.stake as number;
  return id(v.offer_id) && id(v.market_id) && isPredictionBettorWire(v.bettor) && (v.side === 'yes' || v.side === 'no') && price(v.price) &&
    points(v.stake) && points(v.remaining) && points(v.matched) && points(v.released) && Math.round((v.remaining as number + (v.matched as number) + (v.released as number)) * 100) === Math.round(stake * 100) &&
    ['open', 'filled', 'withdrawn', 'expired'].includes(v.state as string) && typeof v.live === 'boolean' && nullableId(v.answers_offer_id) &&
    text(v.note) && integer(v.created_at_ms) && nullableInteger(v.released_at_ms) && (v.state === 'withdrawn' || v.state === 'expired') === (v.released_at_ms !== null);
}

export const isPredictionMatchWire = (v: unknown): v is PredictionMatchWire =>
  exact(v, ['match_id', 'market_id', 'price', 'via', 'yes_offer_id', 'no_offer_id', 'yes_bettor', 'no_bettor', 'yes_stake', 'no_stake', 'winner', 'created_at_ms']) &&
  id(v.match_id) && id(v.market_id) && price(v.price) && (v.via === 'cross' || v.via === 'counter') && id(v.yes_offer_id) && id(v.no_offer_id) &&
  isPredictionBettorWire(v.yes_bettor) && isPredictionBettorWire(v.no_bettor) && v.yes_bettor.bettor_id !== v.no_bettor.bettor_id &&
  points(v.yes_stake) && points(v.no_stake) && (v.winner === null || v.winner === 'yes' || v.winner === 'no') && integer(v.created_at_ms);

const isWeek = (v: unknown, extra: string[]): v is Record<string, unknown> =>
  exact(v, ['week_start', 'starts_at_ms', 'ends_at_ms', 'state', ...extra]) && weekStart(v.week_start) && integer(v.starts_at_ms) && integer(v.ends_at_ms) &&
  (v.ends_at_ms as number) > (v.starts_at_ms as number) && ['open', 'closed', 'settled'].includes(v.state as string);

const isMarketBets = (week: string) => (v: unknown): v is PredictionMarketBetsWire =>
  exact(v, ['market', 'bets']) && isPredictionMarketWire(v.market) && v.market.week_start === week && Array.isArray(v.bets) && v.bets.length > 0 &&
  v.bets.every(b => isPredictionMatchWire(b) && b.market_id === (v.market as PredictionMarketWire).market_id);

const isBoardMarket = (week: string) => (v: unknown): v is PredictionBoardMarketWire =>
  exact(v, ['market', 'open_offers', 'best_yes', 'best_no', 'open_stake', 'matched_bets', 'last_price']) && isPredictionMarketWire(v.market) &&
  v.market.week_start === week && integer(v.open_offers) && nullablePrice(v.best_yes) && nullablePrice(v.best_no) && points(v.open_stake) &&
  integer(v.matched_bets) && nullablePrice(v.last_price) && (v.open_offers > 0 || v.matched_bets > 0) && (v.matched_bets > 0) === (v.last_price !== null);

export function isPredictionBoardWire(v: unknown): v is PredictionBoardWire {
  if (!exact(v, ['group_id', 'time_zone', 'this_week', 'next_week']) || !id(v.group_id)) return false;
  if (v.this_week === null || v.next_week === null) return v.this_week === null && v.next_week === null && v.time_zone === null;
  const { this_week: now, next_week: next } = v;
  return id(v.time_zone) && isWeek(now, ['markets']) && isWeek(next, ['markets']) && Array.isArray(now.markets) && Array.isArray(next.markets) &&
    now.markets.every(isMarketBets(now.week_start as string)) && next.markets.every(isBoardMarket(next.week_start as string)) &&
    new Set(next.markets.map(m => (m as PredictionBoardMarketWire).market.market_id)).size === next.markets.length;
}

export const isPredictionThreadWire = (v: unknown): v is PredictionThreadWire =>
  exact(v, ['group_id', 'market', 'week', 'offers', 'matches']) && id(v.group_id) && isPredictionMarketWire(v.market) && isWeek(v.week, []) &&
  v.week.week_start === v.market.week_start && Array.isArray(v.offers) && v.offers.every(o => isPredictionOfferWire(o) && o.market_id === (v.market as PredictionMarketWire).market_id) &&
  Array.isArray(v.matches) && v.matches.every(m => isPredictionMatchWire(m) && m.market_id === (v.market as PredictionMarketWire).market_id);

const result = (v: unknown, keys: string[]) => exact(v, keys) && finite(v.profit) && integer(v.matched) && integer(v.wins) && integer(v.losses) &&
  integer(v.voids) && v.matched === (v.wins as number) + (v.losses as number) + (v.voids as number);
const isHeadToHead = (v: unknown) => exact(v, ['opponent', 'matched', 'wins', 'losses', 'voids', 'profit']) && isPredictionBettorWire(v.opponent) &&
  result(v, ['opponent', 'matched', 'wins', 'losses', 'voids', 'profit']);
const isRankingRow = (v: unknown): v is PredictionRankingRowWire => exact(v, ['bettor', 'week_profit', 'all_time_profit', 'matched', 'wins', 'losses', 'voids', 'weeks', 'head_to_head', 'recent']) &&
  isPredictionBettorWire(v.bettor) && finite(v.week_profit) && finite(v.all_time_profit) && integer(v.matched) && integer(v.wins) && integer(v.losses) &&
  integer(v.voids) && v.matched === v.wins + v.losses + v.voids && integer(v.weeks) && Array.isArray(v.head_to_head) && v.head_to_head.every(isHeadToHead) &&
  Array.isArray(v.recent) && v.recent.every(r => weekStart((r as Record<string, unknown>)?.week_start) && result(r, ['week_start', 'profit', 'matched', 'wins', 'losses', 'voids']));

export const isPredictionRankingWire = (v: unknown): v is PredictionRankingWire =>
  exact(v, ['group_id', 'week_start', 'rows']) && id(v.group_id) && (v.week_start === null ? Array.isArray(v.rows) && v.rows.length === 0 : weekStart(v.week_start)) &&
  Array.isArray(v.rows) && v.rows.every(isRankingRow) && new Set(v.rows.map(r => (r as PredictionRankingRowWire).bettor.bettor_id)).size === v.rows.length;

const isHistoryWeek = (v: unknown): v is PredictionHistoryWeekWire =>
  exact(v, ['week_start', 'starts_at_ms', 'ends_at_ms', 'settled_at_ms', 'markets', 'results']) && weekStart(v.week_start) && integer(v.starts_at_ms) &&
  integer(v.ends_at_ms) && integer(v.settled_at_ms) && Array.isArray(v.markets) && v.markets.every(isMarketBets(v.week_start)) &&
  Array.isArray(v.results) && v.results.every(r => isPredictionBettorWire((r as Record<string, unknown>)?.bettor) && result(r, ['bettor', 'profit', 'matched', 'wins', 'losses', 'voids']));

export const isPredictionHistoryWire = (v: unknown): v is PredictionHistoryWire =>
  exact(v, ['group_id', 'weeks', 'next_cursor']) && id(v.group_id) && Array.isArray(v.weeks) && v.weeks.every(isHistoryWeek) &&
  (v.next_cursor === null || (id(v.next_cursor) && v.weeks.length > 0)) && new Set(v.weeks.map(w => (w as PredictionHistoryWeekWire).week_start)).size === v.weeks.length;

export const isPredictionSettingWire = (v: unknown): v is PredictionSettingWire => exact(v, ['group_id', 'enabled']) && id(v.group_id) && typeof v.enabled === 'boolean';
