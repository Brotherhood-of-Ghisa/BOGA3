import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { sessionExercises } from './session-exercises';

export const exerciseSets = sqliteTable(
  'exercise_sets',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    sessionExerciseId: text('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    weightValue: text('weight_value').notNull().default(''),
    repsValue: text('reps_value').notNull().default(''),
    weightUnit: text('weight_unit').notNull().default('kg'),
    // Null is unresolved legacy bodyweight meaning, not inferred added load.
    externalLoadMode: text('external_load_mode'),
    setType: text('set_type'),
    plannedWeightValue: text('planned_weight_value'),
    plannedWeightUnit: text('planned_weight_unit'),
    plannedExternalLoadMode: text('planned_external_load_mode'),
    plannedRepsValue: text('planned_reps_value'),
    plannedSetType: text('planned_set_type'),
    performanceStatus: text('performance_status'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    // False only on pre-M27 rows awaiting one-time metadata hydration.
    localBodyweightMetadataKnown: integer('local_bodyweight_metadata_known', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    sessionExerciseIdx: index('exercise_sets_session_exercise_id_idx').on(table.sessionExerciseId),
    deletedAtIdx: index('exercise_sets_deleted_at_idx').on(table.deletedAt),
    sessionExerciseOrderUnique: uniqueIndex('exercise_sets_session_exercise_id_order_index_unique').on(
      table.sessionExerciseId,
      table.orderIndex
    ),
    orderGuard: check('exercise_sets_order_index_non_negative', sql`${table.orderIndex} >= 0`),
  })
);

export type ExerciseSet = typeof exerciseSets.$inferSelect;
export type NewExerciseSet = typeof exerciseSets.$inferInsert;
