import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { exerciseTagDefinitions } from './exercise-tag-definitions';
import { sessionExercises } from './session-exercises';

export const sessionExerciseTags = sqliteTable(
  'session_exercise_tags',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    sessionExerciseId: text('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id, { onDelete: 'cascade' }),
    exerciseTagDefinitionId: text('exercise_tag_definition_id')
      .notNull()
      .references(() => exerciseTagDefinitions.id, { onDelete: 'cascade' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    sessionExerciseIdx: index('session_exercise_tags_session_exercise_id_idx').on(table.sessionExerciseId),
    tagDefinitionIdx: index('session_exercise_tags_exercise_tag_definition_id_idx').on(table.exerciseTagDefinitionId),
    deletedAtIdx: index('session_exercise_tags_deleted_at_idx').on(table.deletedAt),
    sessionExerciseTagUnique: uniqueIndex('session_exercise_tags_session_exercise_id_tag_definition_unique').on(
      table.sessionExerciseId,
      table.exerciseTagDefinitionId
    ),
  })
);

export type SessionExerciseTag = typeof sessionExerciseTags.$inferSelect;
export type NewSessionExerciseTag = typeof sessionExerciseTags.$inferInsert;
