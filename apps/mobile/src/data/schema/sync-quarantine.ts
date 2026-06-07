import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Local-only sync bookkeeping: one row per dirty entity that the push-side FK
// closure preflight found to be structurally orphaned (a required FK parent that
// is neither in the batch nor physically present locally). A quarantined row is
// skipped by future push batch selection so one bad row can no longer wedge an
// otherwise-valid offline backlog behind a server `FK_VIOLATION`.
//
// This is NOT user data and never crosses the wire: it carries no dirty bit, no
// monotonic timestamp, and is not in the topological sync layers. It is also
// deliberately FK-free — its `entity_id` / `parent_id` are opaque identifiers of
// rows that may be missing or orphaned, so a real `.references(...)` would be
// wrong (and would fail under the production `PRAGMA foreign_keys = ON`).
//
// The composite primary key `(entity_type, entity_id)` makes repeated detection
// of the same orphan an idempotent upsert: `first_seen_at_ms` is preserved while
// `last_seen_at_ms` and `occurrence_count` advance, so a persistent defect never
// accumulates unbounded duplicate rows.
export const syncQuarantine = sqliteTable(
  'sync_quarantine',
  {
    /** Syncable entity type of the quarantined row (snake_case wire/table name). */
    entityType: text('entity_type').notNull(),
    /** The quarantined row's opaque id. */
    entityId: text('entity_id').notNull(),
    /** Why it was quarantined — currently always the local FK closure code. */
    errorCode: text('error_code').notNull(),
    /** Diagnostic: the FK parent entity type the row failed to resolve, if any. */
    parentType: text('parent_type'),
    /** Diagnostic: the snake_case FK column on the row that could not be resolved. */
    parentIdField: text('parent_id_field'),
    /** Diagnostic: the unresolved parent id the row points at. */
    parentId: text('parent_id'),
    /** Epoch-ms when this row was first quarantined. Preserved across repeats. */
    firstSeenAtMs: integer('first_seen_at_ms').notNull(),
    /** Epoch-ms of the most recent detection. Advanced on every repeat. */
    lastSeenAtMs: integer('last_seen_at_ms').notNull(),
    /** How many times this orphan has been detected. Starts at 1, bumped on repeats. */
    occurrenceCount: integer('occurrence_count').notNull().default(1),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityType, table.entityId] }),
  }),
);

export type SyncQuarantineRecord = typeof syncQuarantine.$inferSelect;
export type NewSyncQuarantineRecord = typeof syncQuarantine.$inferInsert;
