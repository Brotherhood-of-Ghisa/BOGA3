import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';

export const exerciseTagDefinitions = sqliteTable(
  'exercise_tag_definitions',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    exerciseDefinitionId: text('exercise_definition_id')
      .notNull()
      .references(() => exerciseDefinitions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
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
    exerciseDefinitionIdx: index('exercise_tag_definitions_exercise_definition_id_idx').on(table.exerciseDefinitionId),
    deletedAtIdx: index('exercise_tag_definitions_deleted_at_idx').on(table.deletedAt),
    exerciseDefinitionNormalizedNameUnique: uniqueIndex(
      'exercise_tag_definitions_exercise_id_normalized_name_unique'
    ).on(table.exerciseDefinitionId, table.normalizedName),
    nameNonEmptyGuard: check('exercise_tag_definitions_name_non_empty', sql`${table.name} <> ''`),
    normalizedNameNonEmptyGuard: check(
      'exercise_tag_definitions_normalized_name_non_empty',
      sql`${table.normalizedName} <> ''`
    ),
  })
);

export type ExerciseTagDefinition = typeof exerciseTagDefinitions.$inferSelect;
export type NewExerciseTagDefinition = typeof exerciseTagDefinitions.$inferInsert;
