/**
 * `group_cache` access (groups contract §6.2) against the shared in-memory
 * SQLite fixture: user-scoped reads, upsert, access-loss eviction, and wipe.
 * The account-wipe integration is covered in account-switch-local-wipe.test.ts.
 */

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
    expect(groupCacheKeys.mine).toBe('groups:mine');
    expect(groupCacheKeys.group('g1')).toBe('group:g1');
    expect(groupCacheKeys.streamAll).toBe('stream:all');
    expect(groupCacheKeys.stream('g1')).toBe('stream:g1');
    expect(groupCacheKeys.session('u2', 's1')).toBe('session:u2:s1');
    expect(groupCacheKeys.groupExercises('g1')).toBe('group-exercises:g1');
    expect(groupCacheKeys.boards('g1')).toBe('boards:g1');
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
    expect(readGroupCache(db(), groupCacheKeys.streamAll, 'user-1')).toBeNull();
  });

  it('upserts: a later write replaces the payload, fetch time, and owner', () => {
    put(groupCacheKeys.streamAll, 'user-1', { v: 1 }, 1_000);
    put(groupCacheKeys.streamAll, 'user-2', { v: 2 }, 2_000);

    expect(readGroupCache(db(), groupCacheKeys.streamAll, 'user-1')).toBeNull();
    expect(readGroupCache(db(), groupCacheKeys.streamAll, 'user-2')).toEqual({ payload: { v: 2 }, fetchedAtMs: 2_000 });
    expect(allKeys()).toEqual(['stream:all']);
  });

  it('throws on a corrupt payload instead of reading it as a miss', () => {
    db().insert(groupCache).values({ cacheKey: 'groups:mine', userId: 'user-1', payloadJson: '{not json', fetchedAtMs: 1 }).run();

    expect(() => readGroupCache(db(), 'groups:mine', 'user-1')).toThrow(SyntaxError);
  });

  it('evictGroup removes group:<id>, stream:<id>, group-exercises:<id>, boards:<id>, and every session:* entry, and nothing else', () => {
    put(groupCacheKeys.mine);
    put(groupCacheKeys.streamAll);
    put(groupCacheKeys.group('g1'));
    put(groupCacheKeys.stream('g1'));
    put(groupCacheKeys.groupExercises('g1'));
    put(groupCacheKeys.boards('g1'));
    put(groupCacheKeys.group('g2'));
    put(groupCacheKeys.stream('g2'));
    put(groupCacheKeys.groupExercises('g2'));
    put(groupCacheKeys.boards('g2'));
    put(groupCacheKeys.session('u2', 's1'));
    put(groupCacheKeys.session('u3', 's9'), 'user-2');

    evictGroup(db(), 'g1');

    expect(allKeys()).toEqual(['boards:g2', 'group-exercises:g2', 'group:g2', 'groups:mine', 'stream:all', 'stream:g2']);
  });

  it('deleteGroupCacheEntry removes exactly one key', () => {
    put(groupCacheKeys.group('g1'));
    put(groupCacheKeys.group('g2'));

    deleteGroupCacheEntry(db(), groupCacheKeys.group('g1'));

    expect(allKeys()).toEqual(['group:g2']);
  });

  it('wipeGroupCache clears every row for every user', () => {
    put(groupCacheKeys.mine, 'user-1');
    put(groupCacheKeys.streamAll, 'user-2');

    wipeGroupCache(db());

    expect(allKeys()).toEqual([]);
  });
});
