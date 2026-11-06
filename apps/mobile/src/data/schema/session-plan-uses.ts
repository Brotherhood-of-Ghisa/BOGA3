import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { sessionPlans } from './session-plans';

/** An immutable action identity; workout completion stays on ordinary sessions. */
export const sessionPlanUses = sqliteTable('session_plan_uses', {
  id: text('id').primaryKey().notNull(),
  sessionPlanId: text('session_plan_id').notNull().references(() => sessionPlans.id, { onDelete: 'cascade' }),
  slotIndex: integer('slot_index').notNull(),
  kind: text('kind', { enum: ['workout', 'skip'] }).notNull(),
  skippedAt: integer('skipped_at', { mode: 'timestamp_ms' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
  localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => ({
  planIdx: index('session_plan_uses_session_plan_id_idx').on(table.sessionPlanId),
  deletedAtIdx: index('session_plan_uses_deleted_at_idx').on(table.deletedAt),
  slotUnique: uniqueIndex('session_plan_uses_owner_slot_unique').on(table.sessionPlanId, table.slotIndex)
    .where(sql`${table.deletedAt} is null`),
  slotGuard: check('session_plan_uses_slot_positive', sql`${table.slotIndex} > 0`),
  kindGuard: check('session_plan_uses_kind_valid', sql`${table.kind} in ('workout', 'skip')`),
  skipGuard: check('session_plan_uses_skip_date', sql`${table.kind} = 'skip' or ${table.skippedAt} is null`),
}));

export type SessionPlanUse = typeof sessionPlanUses.$inferSelect;
export type NewSessionPlanUse = typeof sessionPlanUses.$inferInsert;
