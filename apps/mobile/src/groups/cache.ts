// Read/write access to the local-only `group_cache` table
// (`docs/specs/tech/groups-contract.md` §6.2). Every function takes the drizzle
// handle explicitly so it runs unchanged against the production expo-sqlite
// database and the in-memory test fixture.

import { and, eq, inArray, like, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '@/src/data/schema';

const { groupCache } = schema;

/** Any synchronous drizzle SQLite handle over the app schema (expo-sqlite or better-sqlite3). */
export type GroupCacheDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export const groupCacheKeys = {
  mine: 'groups:mine',
  group: (groupId: string) => `group:${groupId}`,
  streamAll: 'stream:all',
  stream: (groupId: string) => `stream:${groupId}`,
  session: (memberUserId: string, sessionId: string) => `session:${memberUserId}:${sessionId}`,
} as const;

const SESSION_KEY_PATTERN = 'session:%';

export type GroupCacheEntry<T> = {
  payload: T;
  fetchedAtMs: number;
};

/**
 * Returns the cached payload for `cacheKey` only when it was fetched by
 * `userId`; another account's row reads as absent. A payload that is not valid
 * JSON throws (it is only ever written by `writeGroupCache`, so corruption is a
 * bug to surface, not a miss to hide).
 */
export const readGroupCache = <T>(
  database: GroupCacheDatabase,
  cacheKey: string,
  userId: string,
): GroupCacheEntry<T> | null => {
  const row = database
    .select()
    .from(groupCache)
    .where(and(eq(groupCache.cacheKey, cacheKey), eq(groupCache.userId, userId)))
    .get();
  if (!row) {
    return null;
  }
  return { payload: JSON.parse(row.payloadJson) as T, fetchedAtMs: row.fetchedAtMs };
};

/** Upserts the last successful payload for `cacheKey`, replacing any previous owner. */
export const writeGroupCache = <T>(
  database: GroupCacheDatabase,
  entry: { cacheKey: string; userId: string; payload: T; fetchedAtMs: number },
): void => {
  const values = {
    cacheKey: entry.cacheKey,
    userId: entry.userId,
    payloadJson: JSON.stringify(entry.payload),
    fetchedAtMs: entry.fetchedAtMs,
  };
  database
    .insert(groupCache)
    .values(values)
    .onConflictDoUpdate({
      target: groupCache.cacheKey,
      set: { userId: values.userId, payloadJson: values.payloadJson, fetchedAtMs: values.fetchedAtMs },
    })
    .run();
};

/** Deletes one cache entry (any owner). */
export const deleteGroupCacheEntry = (database: GroupCacheDatabase, cacheKey: string): void => {
  database.delete(groupCache).where(eq(groupCache.cacheKey, cacheKey)).run();
};

/**
 * Access loss (C3.6.8): removes `group:<id>`, `stream:<id>`, and every
 * `session:*` entry. Session entries are not group-scoped (a session can be
 * shared into several groups), so all of them go.
 */
export const evictGroup = (database: GroupCacheDatabase, groupId: string): void => {
  database
    .delete(groupCache)
    .where(
      or(
        inArray(groupCache.cacheKey, [groupCacheKeys.group(groupId), groupCacheKeys.stream(groupId)]),
        like(groupCache.cacheKey, SESSION_KEY_PATTERN),
      ),
    )
    .run();
};

/** Clears the whole cache. `wipeLocalTables` deletes the table inside its own transaction. */
export const wipeGroupCache = (database: GroupCacheDatabase): void => {
  database.delete(groupCache).run();
};
