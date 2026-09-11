import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Local-only, disposable cache of server-authoritative group RPC results (M22,
// `docs/specs/tech/groups-contract.md` §6.2). One row per cache key holds the
// last successful RPC payload for the account that fetched it.
//
// This is NOT user data and never crosses the wire: no dirty bit, no monotonic
// timestamp, no server counterpart, not in the topological sync layers. Sync
// impact decision: `out of sync scope` (spec 05). It is deliberately FK-free —
// it only caches opaque server JSON, so a local `.references(...)` would be
// wrong (spec 05 local integrity rule 2: client FKs reference synced parents
// only). It is wiped with the rest of the per-user local data on sign-out and
// account switch (`src/sync/account-wipe.ts`).
export const groupCache = sqliteTable('group_cache', {
  /**
   * `groups:mine`, `group:<id>`, `stream:all`, `stream:<groupId>`, or
   * `session:<memberId>:<sessionId>` — built by `groupCacheKeys` in
   * `src/groups/cache.ts`.
   */
  cacheKey: text('cache_key').primaryKey(),
  /** The account the payload belongs to. Reads require a match with the signed-in user. */
  userId: text('user_id').notNull(),
  /** The last successful RPC result, JSON-encoded. */
  payloadJson: text('payload_json').notNull(),
  /** Epoch-ms when the payload was fetched. Drives "last updated". */
  fetchedAtMs: integer('fetched_at_ms').notNull(),
});

export type GroupCacheRecord = typeof groupCache.$inferSelect;
export type NewGroupCacheRecord = typeof groupCache.$inferInsert;
