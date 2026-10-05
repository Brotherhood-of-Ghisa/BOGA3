// Read/write access to the local-only `group_cache` table
// (`docs/specs/tech/groups-contract.md`). Every function takes the drizzle
// handle explicitly so it runs unchanged against the production expo-sqlite
// database and the in-memory test fixture.

import { and, eq, inArray, like, notLike, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from '@/src/data/schema';
import { isCompetitionCachePayload } from './competition-cache-guards';
import { applyCompetitionPolicy, bootstrapCompetitionPolicy, competitionPolicyObservations, emptyCompetitionPolicy, isObservedCompetitionPolicy,
  type ObservedCompetitionPolicy } from './competition-cache-policy';

const { groupCache } = schema;

/** Any synchronous drizzle SQLite handle over the app schema (expo-sqlite or better-sqlite3). */
export type GroupCacheDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export const groupCacheKeys = {
  mine: 'groups:v5:mine',
  group: (groupId: string) => `group:v5:${groupId}`,
  stream: (groupId: string) => `stream:v5:${groupId}`,
  session: (groupId: string, memberUserId: string, sessionId: string) => `session:v5:${groupId}:${memberUserId}:${sessionId}`,
  /** Versioned comparison catalogue; v1 cache entries are not reused. */
  groupExercises: (groupId: string) => `group-exercises:v5:${groupId}`,
  /** Versioned podium payload. Full boards and history are never cached. */
  boards: (groupId: string) => `boards:v5:${groupId}`,
  /** Today's group card: the latest week read, stamped with its window (one entry per group). */
  weekSummary: (groupId: string) => `week:v5:${groupId}`,
} as const;

const SESSION_KEY_PATTERN = 'session:%';

export type GroupCacheEntry<T> = {
  payload: T;
  fetchedAtMs: number;
};

/**
 * Returns the cached payload for `cacheKey` only when it was fetched by
 * `userId`; another account's row reads as absent. Malformed JSON, incompatible generations and unsafe payloads are evicted
 * before reaching a screen.
 */
export const readGroupCache = <T>(
  database: GroupCacheDatabase,
  cacheKey: string,
  userId: string,
): GroupCacheEntry<T> | null => {
  if (quarantinedAccounts.has(userId)) return null;
  evictObsoleteGroupCache(database,userId);
  const row = database
    .select()
    .from(groupCache)
    .where(and(eq(groupCache.cacheKey, cacheKey), eq(groupCache.userId, userId)))
    .get();
  if (!row) {
    return null;
  }
  let payload: unknown;
  try { payload=JSON.parse(row.payloadJson); } catch {
    deleteGroupCacheEntry(database,cacheKey);
    return null;
  }
  if (!isCompetitionCachePayload(cacheKey,payload)) {
    deleteGroupCacheEntry(database,cacheKey);
    return null;
  }
  return { payload: payload as T, fetchedAtMs: row.fetchedAtMs };
};

/** Upserts the last successful payload for `cacheKey`, replacing any previous owner. */
export const writeGroupCache = <T>(
  database: GroupCacheDatabase,
  entry: { cacheKey: string; userId: string; payload: T; fetchedAtMs: number },
): void => {
  if (quarantinedAccounts.has(entry.userId)) deleteAccountCompetitionCache(database,entry.userId);
  evictObsoleteGroupCache(database,entry.userId);
  if (!isCompetitionCachePayload(entry.cacheKey,entry.payload)) throw new Error('Unsafe group cache payload.');
  observeCompetitionPolicy(database,entry.cacheKey,entry.userId,entry.payload,entry.fetchedAtMs);
  clearObservedGroupLoss(entry.userId,entry.cacheKey,entry.payload);
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
 * Access loss removes the current versioned group, stream, exercise, board,
 * week summary, and every session entry. A session can be shared into several
 * groups, so all cached group-specific session projections go. The member's `exercise_group_links` rows are synced data and are never
 * touched here.
 */
export const evictGroup = (database: GroupCacheDatabase, groupId: string): void => {
  const scope = or(inArray(groupCache.cacheKey,[groupCacheKeys.group(groupId),groupCacheKeys.stream(groupId),
    groupCacheKeys.groupExercises(groupId),groupCacheKeys.boards(groupId),groupCacheKeys.weekSummary(groupId),`group-policy:v5:${groupId}`]),
    like(groupCache.cacheKey,SESSION_KEY_PATTERN));
  const accounts = new Set(database.select({ userId: groupCache.userId }).from(groupCache).where(scope).all().map(row => row.userId));
  database.delete(groupCache).where(scope).run();
  accounts.forEach(invalidateCompetitionMemory);
};

/** Clears the whole cache. `wipeLocalTables` deletes the table inside its own transaction. */
export const wipeGroupCache = (database: GroupCacheDatabase): void => {
  database.delete(groupCache).run();
  cacheGenerations.forEach((_generation,userId) => invalidateCompetitionMemory(userId));
};

/** Competition activation/mode changes evict ALL of this account's disposable
 * group projections, including unscoped session joins and previous generations.
 * Mounted readers observe the generation and hide previous projections immediately. */
export const evictCompetitionCache = (database: GroupCacheDatabase, userId: string): void => {
  quarantineCompetitionCache(userId);
  deleteAccountCompetitionCache(database,userId);
};

export const competitionCacheKeys = groupCacheKeys;

const quarantinedAccounts = new Set<string>();
const lostGroups = new Map<string,Set<string>>();
const cacheGenerations = new Map<string,number>();
const cacheListeners = new Set<() => void>();
export const getCompetitionCacheGeneration = (userId: string | null): number => userId ? cacheGenerations.get(userId) ?? 0 : 0;
export const subscribeCompetitionCache = (listener: () => void): (() => void) => {
  cacheListeners.add(listener);
  return () => { cacheListeners.delete(listener); };
};
/** Upgrade removes all prior generations for this account before hydration. */
export const evictObsoleteGroupCache = (database: GroupCacheDatabase,userId: string): void => {
  database.delete(groupCache).where(and(eq(groupCache.userId,userId),notLike(groupCache.cacheKey,'%:v5:%'))).run();
};

export function invalidateCompetitionMemory(userId: string): void {
  cacheGenerations.set(userId,getCompetitionCacheGeneration(userId) + 1);
  cacheListeners.forEach(listener => listener());
}

/** A public policy stamp persists across projection retirement, so readers of
 * different endpoints share observations even when their own cache key was absent. */
function observeCompetitionPolicy(database: GroupCacheDatabase,key: string,userId: string,payload: unknown,fetchedAtMs: number): void {
  try { observeCompetitionPolicyUnchecked(database,key,userId,payload,fetchedAtMs); }
  catch(error) {
    if(!quarantinedAccounts.has(userId)) quarantineCompetitionCache(userId);
    throw error;
  }
}
function observeCompetitionPolicyUnchecked(database: GroupCacheDatabase,key: string,userId: string,payload: unknown,fetchedAtMs: number): void {
  const rows = readClosedAccountCache(database,userId);
  const policies = new Map<string,ObservedCompetitionPolicy>();
  const projections = new Set<string>();
  for (const row of rows) {
    if (row.key.startsWith('group-policy:') && isObservedCompetitionPolicy(row.value)) policies.set(row.key.split(':')[2],row.value);
  }
  for (const row of rows) {
    if (row.key.startsWith('group-policy:')) continue;
    const observations=competitionPolicyObservations(row.key,row.value);
    const groupId=row.key.split(':')[2];
    if (!row.key.startsWith('groups:') && groupId) projections.add(groupId);
    for (const observation of observations) {
      projections.add(observation.groupId);
      const before=policies.get(observation.groupId) ?? emptyCompetitionPolicy();
      policies.set(observation.groupId,bootstrapCompetitionPolicy(before,observation));
    }
  }
  let changed=false;
  const incomingAbsoluteGroups=new Set<string>();
  for (const observation of competitionPolicyObservations(key,payload)) {
    if(observation.absolute_projection_seen) incomingAbsoluteGroups.add(observation.groupId);
    const before=policies.get(observation.groupId) ?? emptyCompetitionPolicy();
    const next=applyCompetitionPolicy(before,observation,projections.has(observation.groupId));
    changed ||= next.changed;
    policies.set(observation.groupId,next.policy);
  }
  if (changed) {
    quarantineCompetitionCache(userId);
    database.delete(groupCache).where(and(eq(groupCache.userId,userId),notLike(groupCache.cacheKey,'group-policy:v5:%'))).run();
    for (const [groupId,policy] of policies) policies.set(groupId,{ ...policy,absolute_projection_seen: incomingAbsoluteGroups.has(groupId) });
  }
  for (const [groupId,policy] of policies) {
    const cacheKey=`group-policy:v5:${groupId}`;
    const values={ cacheKey,userId,payloadJson: JSON.stringify({ ...policy,sessions: policy.sessions.slice(-256) }),fetchedAtMs };
    database.insert(groupCache).values(values).onConflictDoUpdate({ target: groupCache.cacheKey,set: values }).run();
  }
  if(changed) quarantinedAccounts.delete(userId);
}

function readClosedAccountCache(database: GroupCacheDatabase,userId: string) {
  return database.select().from(groupCache).where(eq(groupCache.userId,userId)).all()
    .sort((a,b) => b.fetchedAtMs-a.fetchedAtMs).flatMap(row => {
      try {
        const value: unknown=JSON.parse(row.payloadJson);
        return isCompetitionCachePayload(row.cacheKey,value) ? [{ key: row.cacheKey,value }] : [];
      } catch { return []; }
    });
}

/** Online-only readers publish their current public policy before displaying a page. */
export function observeGroupCompetitionPolicy(database: GroupCacheDatabase,groupId: string,userId: string,payload: unknown): number {
  if (quarantinedAccounts.has(userId)) deleteAccountCompetitionCache(database,userId);
  observeCompetitionPolicy(database,`group-read:v5:${groupId}`,userId,payload,Date.now());
  clearObservedGroupLoss(userId,`group-read:v5:${groupId}`,payload);
  return getCompetitionCacheGeneration(userId);
}

/** Account-wide fail-closed retirement also applies while SQLite is unavailable. */
export function quarantineCompetitionCache(userId: string): number {
  quarantinedAccounts.add(userId);
  invalidateCompetitionMemory(userId);
  return getCompetitionCacheGeneration(userId);
}
export function deleteAccountCompetitionCache(database: GroupCacheDatabase,userId: string): void {
  database.delete(groupCache).where(eq(groupCache.userId,userId)).run();
  quarantinedAccounts.delete(userId);
}

/** Multiple mounted readers can discover the same loss. Fence once until a
 * fresh authorized response for this group; repeated denial must not refetch forever. */
export function quarantineCompetitionGroup(userId: string,groupId: string): number {
  const groups=lostGroups.get(userId) ?? new Set<string>();
  if (!groups.has(groupId)) {
    groups.add(groupId);lostGroups.set(userId,groups);
    quarantineCompetitionCache(userId);
  }
  return getCompetitionCacheGeneration(userId);
}
function clearObservedGroupLoss(userId: string,key: string,payload: unknown): void {
  const groups=lostGroups.get(userId);
  if (!groups) return;
  if (!key.startsWith('groups:')) groups.delete(key.split(':')[2]);
  for (const observation of competitionPolicyObservations(key,payload)) groups.delete(observation.groupId);
  if (groups.size===0) lostGroups.delete(userId);
}
