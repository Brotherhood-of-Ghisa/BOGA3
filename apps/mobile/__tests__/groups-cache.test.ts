/**
 * `group_cache` access (groups contract §6.2) against the shared in-memory
 * SQLite fixture: user-scoped reads, upsert, access-loss eviction, and wipe.
 * The account-wipe integration is covered in account-switch-local-wipe.test.ts.
 */

import { competitionCacheKeys, evictCompetitionCache } from '@/src/groups/cache';
import { groupCache } from '@/src/data/schema';
import {
  deleteGroupCacheEntry,
  evictGroup,
  groupCacheKeys,
  readGroupCache,
  wipeGroupCache,
  writeGroupCache,
} from '@/src/groups';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;

const db = () => fixture.database;

const allKeys = (): string[] =>
  db()
    .select({ key: groupCache.cacheKey })
    .from(groupCache)
    .all()
    .map((row) => row.key)
    .sort();

const put = (cacheKey: string, userId = 'user-1', payload: unknown = { cacheKey }, fetchedAtMs = 1_000) =>
  writeGroupCache(db(), { cacheKey, userId, payload, fetchedAtMs });

describe('group cache', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
  });

  afterEach(() => {
    fixture.close();
  });

  it('builds the contract cache keys', () => {
    expect(groupCacheKeys.mine).toBe('groups:v4:mine');
    expect(groupCacheKeys.group('g1')).toBe('group:v4:g1');
    expect(groupCacheKeys.stream('g1')).toBe('stream:v4:g1');
    expect(groupCacheKeys.session('u2', 's1')).toBe('session:v4:u2:s1');
    expect(groupCacheKeys.groupExercises('g1')).toBe('group-exercises:v4:g1');
    expect(groupCacheKeys.boards('g1')).toBe('boards:v4:g1');
    expect(groupCacheKeys.weekSummary('g1')).toBe('week:v4:g1');
    // The app reads one group's stream at a time: there is no all-groups key.
    expect(groupCacheKeys).not.toHaveProperty('streamAll');
  });

  it('round-trips a payload and its fetch time for the owning user', () => {
    put(groupCacheKeys.mine, 'user-1', { groups: [{ group_id: 'g1', name: 'Crew' }] }, 1_700_000_000_000);

    expect(readGroupCache(db(), groupCacheKeys.mine, 'user-1')).toEqual({
      payload: { groups: [{ group_id: 'g1', name: 'Crew' }] },
      fetchedAtMs: 1_700_000_000_000,
    });
  });

  it('returns nothing when the row belongs to a different user', () => {
    put(groupCacheKeys.mine, 'user-1');

    expect(readGroupCache(db(), groupCacheKeys.mine, 'user-2')).toBeNull();
  });

  it('returns nothing for a missing key', () => {
    expect(readGroupCache(db(), groupCacheKeys.stream('g1'), 'user-1')).toBeNull();
  });

  it('upserts: a later write replaces the payload, fetch time, and owner', () => {
    put(groupCacheKeys.stream('g1'), 'user-1', { v: 1 }, 1_000);
    put(groupCacheKeys.stream('g1'), 'user-2', { v: 2 }, 2_000);

    expect(readGroupCache(db(), groupCacheKeys.stream('g1'), 'user-1')).toBeNull();
    expect(readGroupCache(db(), groupCacheKeys.stream('g1'), 'user-2')).toEqual({ payload: { v: 2 }, fetchedAtMs: 2_000 });
    expect(allKeys()).toEqual(['stream:v4:g1']);
  });

  it('throws on a corrupt payload instead of reading it as a miss', () => {
    db().insert(groupCache).values({ cacheKey: 'groups:mine', userId: 'user-1', payloadJson: '{not json', fetchedAtMs: 1 }).run();

    expect(() => readGroupCache(db(), 'groups:mine', 'user-1')).toThrow(SyntaxError);
  });

  it('evictGroup removes group:<id>, stream:<id>, group-exercises:<id>, boards:<id>, week:<id>, and every session:* entry, and nothing else', () => {
    put(groupCacheKeys.mine);
    put(groupCacheKeys.group('g1'));
    put(groupCacheKeys.stream('g1'));
    put(groupCacheKeys.groupExercises('g1'));
    put(groupCacheKeys.boards('g1'));
    put(groupCacheKeys.weekSummary('g1'));
    put(groupCacheKeys.group('g2'));
    put(groupCacheKeys.stream('g2'));
    put(groupCacheKeys.groupExercises('g2'));
    put(groupCacheKeys.boards('g2'));
    put(groupCacheKeys.weekSummary('g2'));
    put(groupCacheKeys.session('u2', 's1'));
    put(groupCacheKeys.session('u3', 's9'), 'user-2');

    evictGroup(db(), 'g1');

    expect(allKeys()).toEqual(['boards:v4:g2', 'group-exercises:v4:g2', 'group:v4:g2', 'groups:v4:mine', 'stream:v4:g2', 'week:v4:g2']);
  });

  it('never reads a v1 payload under a v2 key and evicts both generations on access loss', () => {
    put('stream:g1', 'user-1', { old: true });
    put('group-exercises:g1');
    put('boards:g1');
    put('session:u2:s1');
    put('stream:g2');
    expect(readGroupCache(db(), groupCacheKeys.stream('g1'), 'user-1')).toBeNull();
    put(groupCacheKeys.stream('g1'), 'user-1', { contract_version: 3 });
    evictGroup(db(), 'g1');
    expect(allKeys()).toEqual(['stream:g2']);
  });

  it('deleteGroupCacheEntry removes exactly one key', () => {
    put(groupCacheKeys.group('g1'));
    put(groupCacheKeys.group('g2'));

    deleteGroupCacheEntry(db(), groupCacheKeys.group('g1'));

    expect(allKeys()).toEqual(['group:v4:g2']);
  });

  it('competition keys bind sessions to a group and activation evicts every owning-account generation', () => {
    expect(competitionCacheKeys.session('g1','u2','s1')).toBe('session:v5:g1:u2:s1');
    expect(competitionCacheKeys.session('g2','u2','s1')).not.toBe(competitionCacheKeys.session('g1','u2','s1'));
    put(groupCacheKeys.boards('g1'));
    put(groupCacheKeys.session('u2','s1'));
    put('stream:g1');
    put(competitionCacheKeys.stream('g1'));
    put(groupCacheKeys.stream('g2'),'user-2');
    expect(readGroupCache(db(),competitionCacheKeys.boards('g1'),'user-1')).toBeNull();
    evictCompetitionCache(db(),'user-1');
    expect(allKeys()).toEqual([groupCacheKeys.stream('g2')]);
    expect(readGroupCache(db(),groupCacheKeys.session('u2','s1'),'user-1')).toBeNull();
  });

  it('wipeGroupCache clears every row for every user', () => {
    put(groupCacheKeys.mine, 'user-1');
    put(groupCacheKeys.stream('g1'), 'user-2');

    wipeGroupCache(db());

    expect(allKeys()).toEqual([]);
  });
});
