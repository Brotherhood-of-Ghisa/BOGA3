import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { gyms } from './gyms';
import { sessionPlans } from './session-plans';
import { sessionPlanUses } from './session-plan-uses';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    gymId: text('gym_id').references(() => gyms.id, { onDelete: 'set null' }),
    sourcePlanId: text('source_plan_id').references(() => sessionPlans.id, { onDelete: 'set null' }),
    sourcePlanUseId: text('source_plan_use_id').references(() => sessionPlanUses.id, { onDelete: 'set null' }),
    mergeRevision: integer('merge_revision').notNull().default(0),
    loggingClientId: text('logging_client_id'),
    loggingGrantedAt: text('logging_granted_at'),
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
    sourcePlanIdx: index('sessions_source_plan_id_idx').on(table.sourcePlanId),
    completedAtIdx: index('sessions_completed_at_idx').on(table.completedAt),
    deletedAtIdx: index('sessions_deleted_at_idx').on(table.deletedAt),
    sourcePlanUnique: uniqueIndex('sessions_owner_source_plan_unique')
      .on(table.sourcePlanId)
      .where(sql`${table.deletedAt} is null and ${table.sourcePlanId} is not null and ${table.sourcePlanUseId} is null`),
    sourcePlanUseUnique: uniqueIndex('sessions_owner_source_use_unique').on(table.sourcePlanUseId)
      .where(sql`${table.deletedAt} is null and ${table.sourcePlanUseId} is not null`),
    statusGuard: check(
      'sessions_status_guard',
      sql`${table.status} in ('active', 'completed')`
    ),
    durationGuard: check('sessions_duration_non_negative', sql`${table.durationSec} is null or ${table.durationSec} >= 0`),
  })
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
