import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { muscleGroups } from './muscle-groups';

export const injuries = sqliteTable(
  'injuries',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    muscleGroupId: text('muscle_group_id').references(() => muscleGroups.id, {
      onDelete: 'set null',
    }),
    side: text('side', { enum: ['left', 'right', 'bilateral'] }),
    status: text('status', {
      enum: ['acute', 'managing', 'monitoring', 'resolved'],
    }).notNull(),
    painScore: integer('pain_score'),
    label: text('label').notNull(),
    notes: text('notes'),
    contraindications: text('contraindications'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' })
      .notNull()
      .default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    muscleGroupIdx: index('injuries_muscle_group_id_idx').on(table.muscleGroupId),
    startedAtIdx: index('injuries_started_at_idx').on(table.startedAt),
    deletedAtIdx: index('injuries_deleted_at_idx').on(table.deletedAt),
  })
);

export type Injury = typeof injuries.$inferSelect;
export type NewInjury = typeof injuries.$inferInsert;
