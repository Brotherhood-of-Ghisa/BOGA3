import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { sessionPlanExercises } from './session-plan-exercises';

export const sessionPlanSets = sqliteTable(
  'session_plan_sets',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    sessionPlanExerciseId: text('session_plan_exercise_id')
      .notNull()
      .references(() => sessionPlanExercises.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    targetWeightValue: text('target_weight_value'),
    targetReps: integer('target_reps').notNull(),
    targetSetType: text('target_set_type'),
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
    sessionPlanExerciseIdx: index('session_plan_sets_session_plan_exercise_id_idx').on(
      table.sessionPlanExerciseId
    ),
    deletedAtIdx: index('session_plan_sets_deleted_at_idx').on(table.deletedAt),
    sessionPlanExerciseOrderUnique: uniqueIndex(
      'session_plan_sets_plan_exercise_id_order_index_unique'
    ).on(table.sessionPlanExerciseId, table.orderIndex),
    orderGuard: check('session_plan_sets_order_index_non_negative', sql`${table.orderIndex} >= 0`),
    targetRepsGuard: check('session_plan_sets_target_reps_positive', sql`${table.targetReps} > 0`),
  })
);

export type SessionPlanSet = typeof sessionPlanSets.$inferSelect;
export type NewSessionPlanSet = typeof sessionPlanSets.$inferInsert;
