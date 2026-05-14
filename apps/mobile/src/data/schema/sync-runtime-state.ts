import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const syncRuntimeState = sqliteTable(
  'sync_runtime_state',
  {
    id: text('id').primaryKey().notNull(),
    isEnabled: integer('is_enabled').notNull().default(0),
    bootstrapUserId: text('bootstrap_user_id'),
    bootstrapCompletedAt: integer('bootstrap_completed_at', { mode: 'timestamp_ms' }),
    lastBootstrapError: text('last_bootstrap_error'),
    lastBootstrapAttemptAt: integer('last_bootstrap_attempt_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    isEnabledBooleanGuard: check('sync_runtime_state_is_enabled_boolean_guard', sql`${table.isEnabled} in (0, 1)`),
  })
);

export type SyncRuntimeState = typeof syncRuntimeState.$inferSelect;
export type NewSyncRuntimeState = typeof syncRuntimeState.$inferInsert;
