import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Account-private recovery/staging, never a synced entity. Pending edits and
// operation IDs survive account wipes; every read filters ownerUserId.
export const exerciseMergeLocal = sqliteTable('exercise_merge_local', {
  ownerUserId: text('owner_user_id').notNull(),
  id: text('id').notNull(),
  kind: text('kind', { enum: ['pending', 'operation', 'stage', 'state', 'conflicts'] }).notNull(),
  payload: text('payload').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ownerUserId, table.id] }),
  ownerKindIdx: index('exercise_merge_local_owner_kind_idx').on(table.ownerUserId, table.kind),
}));
