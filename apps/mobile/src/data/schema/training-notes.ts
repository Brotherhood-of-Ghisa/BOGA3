import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';

// A short dated note, general or about one exercise (Sync v2 entity, layer 1).
// `noted_on` is the local calendar date (`YYYY-MM-DD`) it applies from;
// `source` is `app` or `agent` (written through the agent API). Removal is a
// soft delete; there is no edit.
export const trainingNotes = sqliteTable(
  'training_notes',
  {
    id: text('id').primaryKey().notNull(),
    exerciseDefinitionId: text('exercise_definition_id')
      .references(() => exerciseDefinitions.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    notedOn: text('noted_on').notNull(),
    source: text('source', { enum: ['app', 'agent'] }).notNull().default('app'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  table => ({
    exerciseIdx: index('training_notes_exercise_definition_id_idx').on(table.exerciseDefinitionId),
    deletedAtIdx: index('training_notes_deleted_at_idx').on(table.deletedAt),
  })
);

export type TrainingNote = typeof trainingNotes.$inferSelect;
export type NewTrainingNote = typeof trainingNotes.$inferInsert;
