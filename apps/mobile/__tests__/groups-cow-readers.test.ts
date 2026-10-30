import { groupCache } from '@/src/data/schema';
import { groupCacheKeys, readGroupCache, writeGroupCache, evictGroup, observeGroupCompetitionPolicy } from '@/src/groups/cache';
import { coWSummaryCacheKey, coWSummaryExpiresAt, isCoWResultWire, isCoWSummaryWire } from '@/src/groups/cow-wire';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { cowResult, cowSummary, previousCowSummary } from './helpers/cow-fixtures';
import { competitionSession } from './helpers/competition-fixtures';

let fixture: InMemoryDatabaseFixture;
beforeEach(() => { fixture = createInMemoryDatabase(); jest.useFakeTimers().setSystemTime(cowSummary().observed_at_us / 1000); });
afterEach(() => { fixture.close(); jest.useRealTimers(); });

it('accepts normalized rows, signed improvement, missing metrics and suppressed original places', () => {
  const result = cowResult();
  expect(isCoWResultWire(result)).toBe(true);
  result.rankings[2].entries = [{ rank: 1, member: { user_id: 'u2', username: null }, former: true, value: -5, state: 'ranked' }];
  expect(isCoWResultWire(result)).toBe(true);
  result.rankings[0].entries[0] = { ...result.rankings[0].entries[0], value: null, state: 'unavailable' };
  expect(isCoWResultWire(result)).toBe(true);
  result.rankings[0].entries[0] = { ...result.rankings[0].entries[0], rank: null, state: 'unranked' };
  expect(isCoWResultWire(result)).toBe(true);
});

it.each([
  { rankings: [null] }, { rankings: [3] }, { private_context: { body_weight_kg: 80 } },
  { publication_id: null }, { normalized: null }, { state: 'invented' },
])('rejects malformed and private result envelopes without throwing: %j', patch => {
  expect(isCoWResultWire({ ...cowResult(), ...patch })).toBe(false);
});

it('rejects duplicate metrics/members, incoherent units, unsafe absolute counterparts and nonfinite figures', () => {
  const result = cowResult();
  const row = result.rankings[0].entries[0];
  for (const entries of [[row, { ...row, rank: 2 }], [{ ...row, value: Infinity }], [{ ...row, value: 0 }], [{ ...row, body_weight_kg: 80 }]]) {
    expect(isCoWResultWire({ ...result, rankings: [{ ...result.rankings[0], entries, entry_count: 2 }] })).toBe(false);
  }
  expect(isCoWResultWire({ ...result, rankings: [result.rankings[0], result.rankings[0]] })).toBe(false);
  expect(isCoWResultWire({ ...result, rankings: [{ ...result.rankings[0], unit: 'kg' }] })).toBe(false);
  expect(isCoWResultWire({ ...result, normalized: false, rankings: [{ ...result.rankings[0], unit: 'kg' }] })).toBe(false);
});

it('distinguishes current pending/unavailable/empty and exactly previous final summary shapes', () => {
  const summary = cowSummary();
  expect(isCoWSummaryWire(summary)).toBe(true);
  expect(isCoWSummaryWire({ ...summary, selection: 'none', result: null })).toBe(true);
  for (const state of ['pending', 'unavailable', 'ready'] as const) {
    const result = cowResult(); result.state = state; result.rankings.forEach(r => { r.entries = []; });
    if (state === 'pending') result.publication_id = null;
    expect(isCoWSummaryWire({ ...summary, result })).toBe(true);
  }
  const result = cowResult(); result.cow.state = 'final'; result.cow.ends_at_us = summary.observed_at_us - 1;
  expect(isCoWSummaryWire({ ...summary, selection: 'previous_final', result })).toBe(true);
  result.cow.state = 'finalizing';
  expect(isCoWSummaryWire({ ...summary, selection: 'previous_final', result })).toBe(false);
  expect(isCoWSummaryWire({ ...summary, result: { ...cowResult(), cow: { ...cowResult().cow, group_id: 'g2' } } })).toBe(false);
  expect(isCoWSummaryWire({ ...summary, result: { ...cowResult(), rankings: [] } })).toBe(false);
});

it('binds the summary to account, group, week, revision and publication; full results have no cache key', () => {
  const payload = cowSummary(); const alias = groupCacheKeys.cowSummary('g1'); const fetchedAtMs = Date.now();
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload, fetchedAtMs });
  expect(fixture.database.select().from(groupCache).all().some(row => row.cacheKey === coWSummaryCacheKey(payload))).toBe(true);
  expect(readGroupCache(fixture.database, alias, 'u1')).toEqual({ payload, fetchedAtMs });
  expect(readGroupCache(fixture.database, alias, 'u2')).toBeNull();
  expect(readGroupCache(fixture.database, groupCacheKeys.cowSummary('g2'), 'u1')).toBeNull();
  const newer = { ...payload, calendar_revision: 2 };
  jest.setSystemTime(fetchedAtMs + 1);
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload: newer, fetchedAtMs: fetchedAtMs + 1 });
  expect(readGroupCache(fixture.database, alias, 'u1')?.payload).toEqual(newer);
  expect(fixture.database.select().from(groupCache).all().filter(row => row.cacheKey.startsWith('cow-summary:'))).toHaveLength(1);
  expect(() => writeGroupCache(fixture.database, { cacheKey: 'cow-results:v7:g1', userId: 'u1', payload: cowResult(), fetchedAtMs })).toThrow();
  evictGroup(fixture.database, 'g1');
  expect(readGroupCache(fixture.database, alias, 'u1')).toBeNull();
});

it('expires at rollover, rejects a backwards clock and bounds expiry by the server remaining lifetime', () => {
  const payload = cowSummary(); const fetchedAtMs = Date.now(); const alias = groupCacheKeys.cowSummary('g1');
  expect(coWSummaryExpiresAt(payload, fetchedAtMs - 1000)).toBe(payload.valid_until_us / 1000 - 1000);
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload, fetchedAtMs });
  jest.setSystemTime(payload.valid_until_us / 1000);
  expect(readGroupCache(fixture.database, alias, 'u1')).toBeNull();
  jest.setSystemTime(fetchedAtMs);
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload, fetchedAtMs });
  jest.setSystemTime(fetchedAtMs - 1);
  expect(readGroupCache(fixture.database, alias, 'u1')).toBeNull();
});

it('marks absolute aggregate projections so a newly normalized session retires the cached total', () => {
  const payload = cowSummary(); const result = payload.result!;
  result.normalized = false; result.bodyweight_calculations_enabled = false;
  result.exercise = { ...result.exercise!, rules: { ...result.exercise!.rules, bodyweight_calculations_enabled: false } };
  result.rankings[0].unit = 'kg'; result.rankings[1].unit = 'kg_reps';
  const alias = groupCacheKeys.cowSummary('g1');
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload, fetchedAtMs: Date.now() });
  observeGroupCompetitionPolicy(fixture.database, 'g1', 'u1', competitionSession);
  expect(readGroupCache(fixture.database, alias, 'u1')).toBeNull();
});

it('validates exactly last week while retaining finalizing, empty and unavailable states', () => {
  const payload = previousCowSummary();
  expect(isCoWSummaryWire(payload)).toBe(true);
  for (const state of ['pending', 'unavailable', 'ready'] as const) {
    const result = { ...payload.result!, state, cow: { ...payload.result!.cow,
      state: state === 'pending' ? 'finalizing' as const : state === 'unavailable' ? 'unavailable' as const : 'final' as const },
      publication_id: state === 'pending' ? null : 'stored', rankings: payload.result!.rankings.map(row => ({ ...row, entries: [] })) };
    expect(isCoWSummaryWire({ ...payload, result })).toBe(true);
  }
  for (const patch of [{ week_start: '2026-10-12' }, { week_start: '2026-10-26' }, { state: 'active' },
    { ends_at_us: payload.observed_at_us + 1 }]) {
    expect(isCoWSummaryWire({ ...payload, result: { ...payload.result!, cow: { ...payload.result!.cow, ...patch } } })).toBe(false);
  }
});

it('isolates the two summary views in cache, retires both on access loss, and expires last week', () => {
  const current = cowSummary(); const previous = previousCowSummary(); const fetchedAtMs = Date.now();
  const currentKey = groupCacheKeys.cowSummary('g1'); const previousKey = groupCacheKeys.cowSummary('g1', true);
  writeGroupCache(fixture.database, { cacheKey: currentKey, userId: 'u1', payload: current, fetchedAtMs });
  writeGroupCache(fixture.database, { cacheKey: previousKey, userId: 'u1', payload: previous, fetchedAtMs });
  expect(readGroupCache(fixture.database, currentKey, 'u1')?.payload).toEqual(current);
  expect(readGroupCache(fixture.database, previousKey, 'u1')?.payload).toEqual(previous);
  expect(readGroupCache(fixture.database, previousKey, 'u2')).toBeNull();
  expect(readGroupCache(fixture.database, groupCacheKeys.cowSummary('g2', true), 'u1')).toBeNull();
  expect(() => writeGroupCache(fixture.database, { cacheKey: previousKey, userId: 'u1', payload: current, fetchedAtMs })).toThrow();
  expect(() => writeGroupCache(fixture.database, { cacheKey: currentKey, userId: 'u1', payload: previous, fetchedAtMs })).toThrow();
  writeGroupCache(fixture.database, { cacheKey: previousKey, userId: 'u1', payload: previous, fetchedAtMs });
  jest.setSystemTime(previous.valid_until_us / 1000);
  expect(readGroupCache(fixture.database, previousKey, 'u1')).toBeNull();
  jest.setSystemTime(fetchedAtMs);
  writeGroupCache(fixture.database, { cacheKey: currentKey, userId: 'u1', payload: current, fetchedAtMs });
  writeGroupCache(fixture.database, { cacheKey: previousKey, userId: 'u1', payload: previous, fetchedAtMs });
  evictGroup(fixture.database, 'g1');
  expect(readGroupCache(fixture.database, currentKey, 'u1')).toBeNull();
  expect(readGroupCache(fixture.database, previousKey, 'u1')).toBeNull();
});

it('retires a previous-week absolute total when current disclosure becomes normalized', () => {
  const payload = previousCowSummary(); const result = payload.result!;
  result.normalized = false; result.bodyweight_calculations_enabled = false;
  result.exercise = { ...result.exercise!, rules: { ...result.exercise!.rules, bodyweight_calculations_enabled: false } };
  result.rankings[0].unit = 'kg'; result.rankings[1].unit = 'kg_reps';
  const alias = groupCacheKeys.cowSummary('g1', true);
  writeGroupCache(fixture.database, { cacheKey: alias, userId: 'u1', payload, fetchedAtMs: Date.now() });
  observeGroupCompetitionPolicy(fixture.database, 'g1', 'u1', competitionSession);
  expect(readGroupCache(fixture.database, alias, 'u1')).toBeNull();
});
