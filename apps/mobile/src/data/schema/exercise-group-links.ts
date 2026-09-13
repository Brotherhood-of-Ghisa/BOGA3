import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';

// A member's link from one of their own exercises to a group exercise (Sync v2
// entity, contract §A.2.10). `group_id` / `group_exercise_id` are plain text
// with no FK: group tables are server-side and not synced parents. The id is
// deterministic (`<group_id>:<exercise_definition_id>`), which enforces "one
// group exercise per personal exercise per group"; unlink tombstones the row and
// relink undeletes the same id.
export const exerciseGroupLinks = sqliteTable(
  'exercise_group_links',
  {
    id: text('id').primaryKey().notNull(),
    exerciseDefinitionId: text('exercise_definition_id')
      .notNull()
      .references(() => exerciseDefinitions.id, { onDelete: 'no action' }),
    groupId: text('group_id').notNull(),
    groupExerciseId: text('group_exercise_id').notNull(),
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
    exerciseDefinitionIdx: index('exercise_group_links_exercise_definition_id_idx').on(table.exerciseDefinitionId),
    groupExerciseIdx: index('exercise_group_links_group_exercise_id_idx').on(table.groupExerciseId),
    deletedAtIdx: index('exercise_group_links_deleted_at_idx').on(table.deletedAt),
    deterministicIdGuard: check(
      'exercise_group_links_id_deterministic',
      sql`${table.id} = ${table.groupId} || ':' || ${table.exerciseDefinitionId}`
    ),
  })
);

export type ExerciseGroupLink = typeof exerciseGroupLinks.$inferSelect;
export type NewExerciseGroupLink = typeof exerciseGroupLinks.$inferInsert;
