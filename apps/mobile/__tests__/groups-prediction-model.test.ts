/* eslint-disable import/first */
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: (...args: unknown[]) => {
  const result = mockRpc(...args); return Object.assign(result, { setHeader: () => result });
} }) }) }));
import * as api from '@/src/groups/api';
import { evictGroup, groupCacheKeys, readGroupCache, writeGroupCache } from '@/src/groups/cache';
import { isCompetitionCachePayload } from '@/src/groups/competition-cache-guards';
import { buildPredictionBoard, buildPredictionHistoryWeek, buildPredictionRanking, buildPredictionThread, formatPredictionPoints,
  formatPredictionProfit, predictionProfitTone, toPredictionMarketFacts } from '@/src/groups/prediction-view-model';
import { isPredictionBettorWire, isPredictionBoardWire, isPredictionHistoryWire, isPredictionMarketWire, isPredictionMatchWire, isPredictionOfferWire,
  isPredictionRankingWire, isPredictionSettingWire, isPredictionThreadWire } from '@/src/groups/prediction-wire';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { bettorFixture, boardFixture, e1rmMarketFixture, historyFixture, marketFixture, matchFixture, offerFixture, rankingFixture,
  threadFixture } from './helpers/prediction-fixtures';

const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });
beforeEach(() => mockRpc.mockReset());

describe('wire guards reject unknown keys, wrong types and contradictions', () => {
  const withKey = (v: object) => ({ ...v, walk_away_price: 70 });
  it('accepts the fixtures', () => {
    expect(isPredictionBoardWire(boardFixture())).toBe(true);
    expect(isPredictionBoardWire(boardFixture({ time_zone: null, this_week: null, next_week: null }))).toBe(true);
    expect(isPredictionThreadWire(threadFixture())).toBe(true);
    expect(isPredictionRankingWire(rankingFixture())).toBe(true);
    expect(isPredictionRankingWire(rankingFixture({ week_start: null, rows: [] }))).toBe(true);
    expect(isPredictionHistoryWire(historyFixture())).toBe(true);
    expect(isPredictionSettingWire({ group_id: 'g1', enabled: false })).toBe(true);
  });
  it.each([
    ['board', isPredictionBoardWire, boardFixture()], ['thread', isPredictionThreadWire, threadFixture()],
    ['ranking', isPredictionRankingWire, rankingFixture()], ['history', isPredictionHistoryWire, historyFixture()],
    ['market', isPredictionMarketWire, marketFixture()], ['offer', isPredictionOfferWire, offerFixture()],
    ['match', isPredictionMatchWire, matchFixture()], ['bettor', isPredictionBettorWire, bettorFixture('alex')],
    ['setting', isPredictionSettingWire, { group_id: 'g1', enabled: true }],
  ] as const)('%s: an extra key (a walk-away price) or a missing key fails', (_name, guard, value) => {
    expect(guard(withKey(value))).toBe(false);
    const { [Object.keys(value)[0]]: _dropped, ...rest } = value as Record<string, unknown>;
    expect(guard(rest)).toBe(false);
    expect(guard(null)).toBe(false);
    expect(guard([])).toBe(false);
  });
  it('nested extra keys fail every parent', () => {
    const board = boardFixture();
    const leaky = { ...board, next_week: { ...board.next_week!, markets: [{ ...board.next_week!.markets[0], market: withKey(board.next_week!.markets[0].market) }] } };
    expect(isPredictionBoardWire(leaky)).toBe(false);
    expect(isPredictionThreadWire(threadFixture({ offers: [withKey(offerFixture())] as never }))).toBe(false);
    expect(isPredictionThreadWire(threadFixture({ matches: [withKey(matchFixture())] as never }))).toBe(false);
    expect(isPredictionHistoryWire(historyFixture({ weeks: [{ ...historyFixture().weeks[0], results: [withKey(historyFixture().weeks[0].results[0])] }] as never }))).toBe(false);
    expect(isPredictionRankingWire(rankingFixture({ rows: [{ ...rankingFixture().rows[0], head_to_head: [withKey(rankingFixture().rows[0].head_to_head[0])] }] as never }))).toBe(false);
  });
  it.each([
    ['an unknown template', marketFixture({ template: 'coin_flip' as never })],
    ['a missing line', marketFixture({ parameters: {} })],
    ['an e1RM line off its step', e1rmMarketFixture({ parameters: { group_exercise_id: 'ge1', line: 101, member_user_id: 'u-alex' } })],
    ['an e1RM line out of range', e1rmMarketFixture({ parameters: { group_exercise_id: 'ge1', line: 125, member_user_id: 'u-alex' } })],
    ['a sets line off its step', marketFixture({ template: 'sets_line', parameters: { line: 7, member_user_id: 'u-alex' }, member: { user_id: 'u-alex', username: 'A' } })],
    ['a fractional records line', marketFixture({ parameters: { line: 2.5 } })],
    ['a bad CoW metric', marketFixture({ template: 'cow_top', parameters: { member_user_id: 'u-alex', metric: 'weight' }, member: { user_id: 'u-alex', username: 'A' } })],
    ['a member that differs from the parameters', e1rmMarketFixture({ member: { user_id: 'u-other', username: 'O' } })],
    ['a member on a memberless template', marketFixture({ member: { user_id: 'u-alex', username: 'A' } })],
    ['an exercise name on a template without an exercise', marketFixture({ exercise_name: 'Squat' })],
    ['a baseline on another template', marketFixture({ baseline: { value: 100, unit: 'kg' } })],
    ['a result without an outcome', marketFixture({ result_value: 3, result_unit: 'records' })],
    ['an unknown outcome', marketFixture({ outcome: 'maybe' as never })],
    ['a result value without its unit', marketFixture({ outcome: 'no', result_value: 3, result_unit: null })],
    ['a week that is not a date', marketFixture({ week_start: 'next week' })],
  ])('a market with %s fails', (_label, market) => expect(isPredictionMarketWire(market)).toBe(false));
  it('a settled market keeps its outcome and a void one may carry no figure', () => {
    expect(isPredictionMarketWire(marketFixture({ outcome: 'void' }))).toBe(true);
    expect(isPredictionMarketWire(marketFixture({ outcome: 'yes', result_value: 4, result_unit: 'records' }))).toBe(true);
    expect(isPredictionMarketWire(e1rmMarketFixture({ baseline: { value: 140, unit: 'kg' } }))).toBe(true);
  });
  it.each([
    ['stakes that do not add up', offerFixture({ remaining: 5 })],
    ['an unknown state', offerFixture({ state: 'gone' as never })],
    ['a withdrawal without its time', offerFixture({ state: 'withdrawn', remaining: 0, matched: 6, released: 4, released_at_ms: null })],
    ['a price of 100', offerFixture({ price: 100 })],
    ['a fractional price', offerFixture({ price: 50.5 })],
    ['a negative stake', offerFixture({ stake: -1 })],
    ['a non-string note', offerFixture({ note: 3 as never })],
  ])('an offer with %s fails', (_label, offer) => expect(isPredictionOfferWire(offer)).toBe(false));
  it('a withdrawn offer carries its time', () => expect(isPredictionOfferWire(offerFixture({ state: 'withdrawn', remaining: 0, released: 4, released_at_ms: 3_000 }))).toBe(true));
  it('a match between one AI and itself fails', () => expect(isPredictionMatchWire(matchFixture({ no_bettor: bettorFixture('alex') }))).toBe(false));
  it('board scope: a matched market of another week, an empty market and a duplicate market fail', () => {
    const board = boardFixture();
    const next = board.next_week!;
    expect(isPredictionBoardWire({ ...board, next_week: { ...next, markets: [{ ...next.markets[0], market: marketFixture({ week_start: '2026-12-07' }) }] } })).toBe(false);
    expect(isPredictionBoardWire({ ...board, next_week: { ...next, markets: [{ ...next.markets[0], open_offers: 0, matched_bets: 0, last_price: null }] } })).toBe(false);
    expect(isPredictionBoardWire({ ...board, next_week: { ...next, markets: [next.markets[0], next.markets[0]] } })).toBe(false);
    expect(isPredictionBoardWire({ ...board, next_week: { ...next, markets: [{ ...next.markets[0], last_price: null }] } })).toBe(false);
    expect(isPredictionBoardWire({ ...board, next_week: null })).toBe(false);
    expect(isPredictionBoardWire({ ...board, this_week: { ...board.this_week!, markets: [{ market: marketFixture({ week_start: '2026-11-23' }), bets: [] }] } })).toBe(false);
  });
  it('thread scope: an offer of another market, a week that is not the market\'s and a bad state fail', () => {
    expect(isPredictionThreadWire(threadFixture({ offers: [offerFixture({ market_id: 'other' })] }))).toBe(false);
    expect(isPredictionThreadWire(threadFixture({ matches: [matchFixture({ market_id: 'other' })] }))).toBe(false);
    const thread = threadFixture();
    expect(isPredictionThreadWire({ ...thread, week: { ...thread.week, week_start: '2026-12-07' } })).toBe(false);
    expect(isPredictionThreadWire({ ...thread, week: { ...thread.week, state: 'done' } })).toBe(false);
  });
  it('ranking and history: record sums, duplicate AIs, empty weeks and orphan cursors fail', () => {
    const ranking = rankingFixture();
    expect(isPredictionRankingWire({ ...ranking, rows: [{ ...ranking.rows[0], matched: 5 }] })).toBe(false);
    expect(isPredictionRankingWire({ ...ranking, rows: [ranking.rows[0], ranking.rows[0]] })).toBe(false);
    expect(isPredictionRankingWire({ ...ranking, week_start: null })).toBe(false);
    const history = historyFixture();
    expect(isPredictionHistoryWire({ ...history, next_cursor: '{}', weeks: [] })).toBe(false);
    expect(isPredictionHistoryWire({ ...history, weeks: [history.weeks[0], history.weeks[0]] })).toBe(false);
    expect(isPredictionHistoryWire({ ...history, weeks: [{ ...history.weeks[0], results: [{ ...history.weeks[0].results[0], matched: 9 }] }] })).toBe(false);
  });
});

describe('api wrappers', () => {
  it('send the exact arguments and decode', async () => {
    respond({ group_id: 'g1', enabled: true }); expect(await api.getPredictionSetting('g1')).toEqual({ group_id: 'g1', enabled: true });
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_settings_get', { p_group_id: 'g1' });
    respond({ group_id: 'g1', enabled: false }); await api.setPredictionSetting('g1', false);
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_settings_set', { p_group_id: 'g1', p_enabled: false });
    respond(boardFixture()); await api.getPredictionBoard('g1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_board', { p_group_id: 'g1' });
    respond(threadFixture()); await api.getPredictionThread('g1', 'mk-1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_market', { p_group_id: 'g1', p_market_id: 'mk-1' });
    respond(rankingFixture()); await api.getPredictionRanking('g1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_ranking', { p_group_id: 'g1' });
    respond(historyFixture({ next_cursor: 'opaque' })); await api.listPredictionHistory('g1', 'cur');
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_history', { p_group_id: 'g1', p_before: 'cur', p_limit: 4 });
    respond(historyFixture()); await api.listPredictionHistory('g1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_prediction_history', { p_group_id: 'g1', p_before: null, p_limit: 4 });
  });
  it('refuse a payload for another group, market or setting', async () => {
    const internal = { code: 'INTERNAL', invalidPayload: true };
    respond({ group_id: 'other', enabled: true }); await expect(api.getPredictionSetting('g1')).rejects.toMatchObject(internal);
    respond({ group_id: 'g1', enabled: true }); await expect(api.setPredictionSetting('g1', false)).rejects.toMatchObject(internal);
    respond(boardFixture({ group_id: 'other' })); await expect(api.getPredictionBoard('g1')).rejects.toMatchObject(internal);
    respond(boardFixture({ this_week: { ...boardFixture().this_week!, markets: [{ market: marketFixture({ group_id: 'other', week_start: '2026-11-23' }), bets: [matchFixture()] }] } }));
    await expect(api.getPredictionBoard('g1')).rejects.toMatchObject(internal);
    respond(threadFixture()); await expect(api.getPredictionThread('g1', 'mk-other')).rejects.toMatchObject(internal);
    respond(threadFixture({ market: marketFixture({ group_id: 'other' }) })); await expect(api.getPredictionThread('g1', 'mk-1')).rejects.toMatchObject(internal);
    respond(rankingFixture({ group_id: 'other' })); await expect(api.getPredictionRanking('g1')).rejects.toMatchObject(internal);
    respond(historyFixture({ group_id: 'other' })); await expect(api.listPredictionHistory('g1')).rejects.toMatchObject(internal);
    respond({ ...historyFixture(), walk_away_price: 70 }); await expect(api.listPredictionHistory('g1')).rejects.toMatchObject(internal);
  });
  it('map the server tokens and tell a missing market from a lost group', async () => {
    for (const [token, call] of [['AGENT_FORBIDDEN', () => api.getPredictionBoard('g1')], ['FORBIDDEN', () => api.setPredictionSetting('g1', true)],
      ['VALIDATION', () => api.listPredictionHistory('g1', 'bad')], ['UPDATE_REQUIRED', () => api.getPredictionRanking('g1')]] as const) {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: `${token}: refused` }, status: 400 });
      await expect(call()).rejects.toMatchObject({ code: token });
    }
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: market not found' }, status: 400 });
    const missing = await api.getPredictionThread('g1', 'mk-1').catch(e => e);
    expect(api.isPredictionMarketNotFound(missing)).toBe(true);
    expect(api.isGroupNotFound(missing)).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: group not found' }, status: 400 });
    const lost = await api.getPredictionThread('g1', 'mk-1').catch(e => e);
    expect(api.isPredictionMarketNotFound(lost)).toBe(false);
    expect(api.isGroupNotFound(lost)).toBe(true);
  });
});

describe('cache keys', () => {
  let fixture: InMemoryDatabaseFixture;
  beforeEach(() => { fixture = createInMemoryDatabase(); });
  afterEach(() => fixture.close());
  it('are versioned per group and read through the closed guards', () => {
    expect(groupCacheKeys.predictionSetting('g1')).toBe('prediction-setting:v10:g1:v1');
    expect(groupCacheKeys.predictionBoard('g1')).toBe('prediction-board:v10:g1:v1');
    expect(groupCacheKeys.predictionRanking('g1')).toBe('prediction-ranking:v10:g1:v1');
    expect(groupCacheKeys.predictionThread('g1', 'mk-1')).toBe('prediction-thread:v10:g1:mk-1:v1');
    const ok: [string, unknown][] = [[groupCacheKeys.predictionSetting('g1'), { group_id: 'g1', enabled: true }], [groupCacheKeys.predictionBoard('g1'), boardFixture()],
      [groupCacheKeys.predictionRanking('g1'), rankingFixture()], [groupCacheKeys.predictionThread('g1', 'mk-1'), threadFixture()]];
    for (const [key, payload] of ok) {
      expect(isCompetitionCachePayload(key, payload)).toBe(true);
      expect(isCompetitionCachePayload(key.replace(':v1', ':v2'), payload)).toBe(false);
      expect(isCompetitionCachePayload(key.replace('g1', 'g2'), payload)).toBe(false);
      expect(isCompetitionCachePayload(`${key}:extra`, payload)).toBe(false);
      expect(isCompetitionCachePayload(key.replace(':v10:', ':v9:'), payload)).toBe(false);
    }
    expect(isCompetitionCachePayload(groupCacheKeys.predictionThread('g1', 'mk-other'), threadFixture())).toBe(false);
    expect(isCompetitionCachePayload(groupCacheKeys.predictionBoard('g1'), rankingFixture())).toBe(false);
    expect(isCompetitionCachePayload('prediction-history:v10:g1:v1', historyFixture())).toBe(false);
    expect(isCompetitionCachePayload('prediction-board:v10:g1', boardFixture())).toBe(false);
  });
  it('are written, read back, and evicted with the group (only that group)', () => {
    const entries: [string, unknown][] = [[groupCacheKeys.predictionSetting('g1'), { group_id: 'g1', enabled: true }], [groupCacheKeys.predictionBoard('g1'), boardFixture()],
      [groupCacheKeys.predictionRanking('g1'), rankingFixture()], [groupCacheKeys.predictionThread('g1', 'mk-1'), threadFixture()],
      [groupCacheKeys.predictionBoard('g2'), boardFixture({ group_id: 'g2', this_week: null, next_week: null, time_zone: null })]];
    for (const [cacheKey, payload] of entries) writeGroupCache(fixture.database, { cacheKey, userId: 'u1', payload, fetchedAtMs: 5 });
    expect(readGroupCache(fixture.database, groupCacheKeys.predictionBoard('g1'), 'u1')?.payload).toEqual(boardFixture());
    expect(readGroupCache(fixture.database, groupCacheKeys.predictionBoard('g1'), 'u2')).toBeNull();
    evictGroup(fixture.database, 'g1');
    for (const [cacheKey] of entries.slice(0, 4)) expect(readGroupCache(fixture.database, cacheKey, 'u1')).toBeNull();
    expect(readGroupCache(fixture.database, groupCacheKeys.predictionBoard('g2'), 'u1')).not.toBeNull();
  });
  it('refuse to cache a payload that fails its guard', () => {
    expect(() => writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.predictionBoard('g1'), userId: 'u1', payload: { ...boardFixture(), walk_away_price: 7 }, fetchedAtMs: 1 }))
      .toThrow('Unsafe group cache payload.');
  });
});

describe('points and profits', () => {
  it('round to hundredths and carry their sign', () => {
    expect(formatPredictionPoints(4)).toBe('4.00');
    expect(formatPredictionPoints(1.665)).toBe('1.67');
    expect(formatPredictionPoints(-0.001)).toBe('0.00');
    expect(formatPredictionProfit(6)).toBe('+6.00');
    expect(formatPredictionProfit(-7.66)).toBe('−7.66');
    expect(formatPredictionProfit(0)).toBe('0.00');
    expect(formatPredictionProfit(0.004)).toBe('0.00');
    expect([6, -7.66, 0, 0.004, -0.004].map(predictionProfitTone)).toEqual(['gain', 'loss', 'even', 'even', 'even']);
  });
});

describe('market facts', () => {
  it('expose parameters and the e1RM target once the baseline is frozen', () => {
    expect(toPredictionMarketFacts(marketFixture())).toMatchObject({ template: 'records_line', line: 3, memberName: null, exerciseName: null, baseline: null, target: null });
    expect(toPredictionMarketFacts(e1rmMarketFixture())).toMatchObject({ memberUserId: 'u-alex', memberName: 'Alex', exerciseName: 'Squat', line: 102.5, target: null });
    expect(toPredictionMarketFacts(e1rmMarketFixture({ baseline: { value: 140, unit: 'kg' }, outcome: 'yes', result_value: 145, result_unit: 'kg' })))
      .toMatchObject({ baseline: { value: 140, unit: 'kg' }, target: 143.5, outcome: 'yes', resultValue: 145, resultUnit: 'kg' });
    expect(toPredictionMarketFacts(marketFixture({ template: 'cow_top', parameters: { member_user_id: 'u-b', metric: 'volume' }, member: { user_id: 'u-b', username: null } })))
      .toMatchObject({ metric: 'volume', line: null, memberName: null, memberUserId: 'u-b' });
  });
});

describe('board view', () => {
  const view = buildPredictionBoard(boardFixture(), 'u-alex', 1_795_996_800_000 - 90_000);
  it('counts down to the close and lists next week\'s markets with their prices', () => {
    expect(view.nextWeek).toMatchObject({ weekStart: '2026-11-30', state: 'open', closesAtMs: 1_795_996_800_000, closesInMs: 90_000 });
    expect(view.nextWeek!.markets.map(m => [m.facts.marketId, m.bestYes, m.bestNo, m.openStake, m.matchedBets, m.lastPrice, m.openOffers]))
      .toEqual([['mk-1', 60, null, 4, 1, 60, 1], ['mk-e1rm', 55, 70, 9.5, 0, null, 2]]);
  });
  it('never counts down below zero', () => expect(buildPredictionBoard(boardFixture(), 'u-alex', 1_800_000_000_000).nextWeek!.closesInMs).toBe(0));
  it('lists this week\'s matched bets, flagging the viewer\'s own AIs', () => {
    expect(view.thisWeek).toMatchObject({ weekStart: '2026-11-23', state: 'closed' });
    expect(view.thisWeek!.bets).toHaveLength(1);
    expect(view.thisWeek!.bets[0]).toMatchObject({ own: true, price: 60, yesStake: 6, noStake: 4, winner: null, moved: 0 });
    expect(view.thisWeek!.bets[0].yes).toMatchObject({ name: 'Alex · Claude', own: true });
    expect(view.thisWeek!.bets[0].no).toMatchObject({ name: 'Blair · Claude', own: false });
    expect(buildPredictionBoard(boardFixture(), 'u-cleo', 0).thisWeek!.bets[0].own).toBe(false);
  });
  it('has no weeks for a group without a zone', () =>
    expect(buildPredictionBoard(boardFixture({ time_zone: null, this_week: null, next_week: null }), 'u-alex', 0)).toEqual({ timeZone: null, nextWeek: null, thisWeek: null }));
  it('moves the loser\'s stake to the winner, and nothing for a void or pending bet', () => {
    const bets = (winner: 'yes' | 'no' | null) => buildPredictionBoard(boardFixture({ this_week: { ...boardFixture().this_week!, markets: [{ market: marketFixture({ week_start: '2026-11-23' }),
      bets: [matchFixture({ winner })] }] } }), 'u-alex', 0).thisWeek!.bets[0].moved;
    expect([bets('yes'), bets('no'), bets(null)]).toEqual([4, 6, 0]);
  });
});

describe('thread view', () => {
  it('orders offers, matches, withdrawals and the result, tagging the viewer\'s own AI', () => {
    const answered = offerFixture({ offer_id: 'of-3', bettor: bettorFixture('cleo', 'Codex'), side: 'no', price: 30, stake: 5, remaining: 0, matched: 0, released: 5,
      state: 'withdrawn', live: false, note: null, created_at_ms: 2_500, released_at_ms: 4_000 });
    const counter = offerFixture({ offer_id: 'of-4', bettor: bettorFixture('alex', 'Codex'), side: 'yes', price: 25, stake: 3, remaining: 3, matched: 0, state: 'open',
      answers_offer_id: 'of-3', note: null, created_at_ms: 3_000 });
    const thread = threadFixture({ market: marketFixture({ outcome: 'no', result_value: 0, result_unit: 'records' }),
      offers: [...threadFixture().offers, answered, counter], matches: [matchFixture({ winner: 'no' })] });
    const view = buildPredictionThread(thread, 'u-alex');
    expect(view.items.map(i => i.kind)).toEqual(['offer', 'offer', 'match', 'offer', 'counter', 'withdrawn', 'result']);
    expect(view.items.map(i => i.atMs)).toEqual([1_000, 1_500, 2_000, 2_500, 3_000, 4_000, thread.week.ends_at_ms]);
    expect(view.items[0]).toMatchObject({ kind: 'offer', note: 'Quiet week', bettor: { own: true, name: 'Alex · Claude' }, answeredPrice: null });
    expect(view.items[1]).toMatchObject({ bettor: { own: false }, note: null, side: 'no', price: 50 });
    expect(view.items[2]).toMatchObject({ kind: 'match', bet: { winner: 'no', moved: 6 } });
    expect(view.items[4]).toMatchObject({ kind: 'counter', answersOfferId: 'of-3', answeredPrice: 30, price: 25 });
    expect(view.items[5]).toMatchObject({ kind: 'withdrawn', released: 5, price: 30 });
    expect(view.items[6]).toMatchObject({ kind: 'result', outcome: 'no', resultValue: 0, resultUnit: 'records' });
    expect(view).toMatchObject({ weekStart: '2026-11-30', weekState: 'open', closesAtMs: thread.week.starts_at_ms, facts: { marketId: 'mk-1', outcome: 'no' } });
  });
  it('keeps an offer before the match it made when they share a moment, and has no result while pending', () => {
    const view = buildPredictionThread(threadFixture({ matches: [matchFixture({ created_at_ms: 1_000 })] }), 'u-alex');
    expect(view.items.map(i => i.kind)).toEqual(['offer', 'match', 'offer']);
    expect(view.items.some(i => i.kind === 'result')).toBe(false);
  });
  it('shows an expired remainder and a counter whose answered offer is not in the thread', () => {
    const expired = offerFixture({ offer_id: 'of-5', state: 'expired', remaining: 0, released: 4, live: false, released_at_ms: 9_000, answers_offer_id: 'of-missing' });
    const view = buildPredictionThread(threadFixture({ offers: [expired], matches: [] }), 'u-alex');
    expect(view.items.map(i => i.kind)).toEqual(['counter', 'expired']);
    expect(view.items[0]).toMatchObject({ answersOfferId: 'of-missing', answeredPrice: null });
  });
});

describe('ranking view', () => {
  it('orders by all-time profit, then week profit, then matched bets, and ties share a rank', () => {
    const ranking = rankingFixture();
    const mk = (n: 'alex' | 'blair' | 'cleo', client: string, week: number, all: number, matched: number) => ({ ...ranking.rows[0], bettor: bettorFixture(n, client),
      week_profit: week, all_time_profit: all, matched, wins: matched, losses: 0, voids: 0 });
    const rows = [mk('blair', 'Codex', 1.66, 3, 2), mk('alex', 'Claude', 6, 6, 1), mk('cleo', 'Claude', 1.66, 9, 1), mk('cleo', 'Codex', 1.66, 3, 2), mk('alex', 'Codex', -7.66, -7.66, 2)];
    const view = buildPredictionRanking(rankingFixture({ rows }), 'u-alex');
    expect(view.weekStart).toBe('2026-11-23');
    expect(view.rows.map(r => [r.bettor.name, r.rank])).toEqual([['Cleo · Claude', 1], ['Alex · Claude', 2], ['Blair · Codex', 3], ['Cleo · Codex', 3], ['Alex · Codex', 5]]);
  });
  it('labels profits with their sign and tone, flags the viewer, and orders head-to-head by profit and recent weeks', () => {
    const ranking = rankingFixture();
    const row = { ...ranking.rows[0], week_profit: -7.66, all_time_profit: 6, matched: 3, wins: 1, losses: 2, voids: 0,
      head_to_head: [{ opponent: bettorFixture('cleo', 'Codex', false), matched: 1, wins: 0, losses: 1, voids: 0, profit: -1.66 },
        { opponent: bettorFixture('blair'), matched: 2, wins: 1, losses: 1, voids: 0, profit: 3 }],
      recent: [{ week_start: '2026-11-16', profit: 2, matched: 1, wins: 1, losses: 0, voids: 0 }, { week_start: '2026-11-23', profit: -7.66, matched: 2, wins: 0, losses: 2, voids: 0 }] };
    const [view] = buildPredictionRanking(rankingFixture({ rows: [row] }), 'u-alex').rows;
    expect(view).toMatchObject({ rank: 1, weekProfitLabel: '−7.66', weekTone: 'loss', allTimeProfitLabel: '+6.00', allTimeTone: 'gain', bettor: { own: true } });
    expect(view.headToHead.map(h => [h.opponent.name, h.profitLabel, h.tone, h.opponent.former])).toEqual([['Blair · Claude', '+3.00', 'gain', false], ['Cleo · Codex', '−1.66', 'loss', true]]);
    expect(view.recent.map(r => [r.weekStart, r.profitLabel])).toEqual([['2026-11-23', '−7.66'], ['2026-11-16', '+2.00']]);
  });
  it('has no rows before a week settles', () => expect(buildPredictionRanking(rankingFixture({ week_start: null, rows: [] }), 'u-alex')).toEqual({ weekStart: null, rows: [] }));
});

describe('history view', () => {
  it('lists each settled week\'s markets, bets with who won what, and every AI\'s result', () => {
    const [week] = historyFixture().weeks;
    const view = buildPredictionHistoryWeek(week, 'u-blair');
    expect(view).toMatchObject({ weekStart: '2026-11-23', startsAtMs: week.starts_at_ms, endsAtMs: week.ends_at_ms });
    expect(view.markets[0].facts).toMatchObject({ marketId: 'mk-old', outcome: 'no', resultValue: 0, resultUnit: 'records' });
    expect(view.markets[0].bets[0]).toMatchObject({ winner: 'no', moved: 6, own: true });
    expect(view.results.map(r => [r.bettor.name, r.profitLabel, r.tone, r.bettor.own])).toEqual([['Blair · Claude', '+6.00', 'gain', true], ['Alex · Claude', '−6.00', 'loss', false]]);
  });
});
