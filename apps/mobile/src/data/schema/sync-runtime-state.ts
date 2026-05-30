import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// v2 singleton row carrying client-side sync runtime state: the pull cursor
// (JSON shape) and `last_emitted_ms` (the monotonic-clock value persisted by
// `nowMonotonic`). The v1 columns (is_enabled, bootstrap_user_id,
// last_bootstrap_error, last_bootstrap_attempt_at, seeds_applied_at,
// updated_at) were dropped — the client ships against a manual-wipe contract
// so no v1 row data needs preservation. `bootstrap_completed_at` is preserved
// (nullable) so a future sync gate can be re-introduced without another
// migration.
export const syncRuntimeState = sqliteTable('sync_runtime_state', {
  id: text('id').primaryKey().notNull(),
  pullCursor: text('pull_cursor', { mode: 'json' }).notNull().default('{}'),
  lastEmittedMs: integer('last_emitted_ms').notNull().default(0),
  bootstrapCompletedAt: integer('bootstrap_completed_at', { mode: 'timestamp_ms' }),
  appliedSeedMigrationAppVersion: integer('applied_seed_migration_app_version').notNull().default(0),
});

export type SyncRuntimeState = typeof syncRuntimeState.$inferSelect;
export type NewSyncRuntimeState = typeof syncRuntimeState.$inferInsert;
