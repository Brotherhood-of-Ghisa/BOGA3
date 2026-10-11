import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';
import { sessionPlans } from './session-plans';

export const sessionPlanExercises = sqliteTable(
  'session_plan_exercises',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    sessionPlanId: text('session_plan_id')
      .notNull()
      .references(() => sessionPlans.id, { onDelete: 'cascade' }),
    exerciseDefinitionId: text('exercise_definition_id').references(() => exerciseDefinitions.id, {
      onDelete: 'set null',
    }),
    orderIndex: integer('order_index').notNull(),
    name: text('name').notNull(),
    progressStatus: text('progress_status', { enum: ['pending', 'completed', 'skipped'] })
      .notNull()
      .default('pending'),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
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
    sessionPlanIdx: index('session_plan_exercises_session_plan_id_idx').on(table.sessionPlanId),
    exerciseDefinitionIdx: index('session_plan_exercises_exercise_definition_id_idx').on(
      table.exerciseDefinitionId
    ),
    deletedAtIdx: index('session_plan_exercises_deleted_at_idx').on(table.deletedAt),
    sessionPlanOrderUnique: uniqueIndex('session_plan_exercises_plan_id_order_index_unique').on(
      table.sessionPlanId,
      table.orderIndex
    ),
    orderGuard: check('session_plan_exercises_order_index_non_negative', sql`${table.orderIndex} >= 0`),
    progressStatusGuard: check(
      'session_plan_exercises_progress_status_valid',
      sql`${table.progressStatus} in ('pending', 'completed', 'skipped')`
    ),
    resolvedAtGuard: check(
      'session_plan_exercises_resolved_at_valid',
      sql`${table.resolvedAt} is null or ${table.progressStatus} in ('completed', 'skipped')`
    ),
  })
);

export type SessionPlanExercise = typeof sessionPlanExercises.$inferSelect;
export type NewSessionPlanExercise = typeof sessionPlanExercises.$inferInsert;
