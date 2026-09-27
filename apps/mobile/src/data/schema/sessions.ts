import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { gyms } from './gyms';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    gymId: text('gym_id').references(() => gyms.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['active', 'completed'] })
      .notNull()
      .default('active'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    durationSec: integer('duration_sec'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    statusIdx: index('sessions_status_idx').on(table.status),
    completedAtIdx: index('sessions_completed_at_idx').on(table.completedAt),
    deletedAtIdx: index('sessions_deleted_at_idx').on(table.deletedAt),
    statusGuard: check(
      'sessions_status_guard',
      sql`${table.status} in ('active', 'completed')`
    ),
    durationGuard: check('sessions_duration_non_negative', sql`${table.durationSec} is null or ${table.durationSec} >= 0`),
  })
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
