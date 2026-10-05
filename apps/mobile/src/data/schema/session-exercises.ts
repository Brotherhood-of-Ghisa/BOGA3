import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';
import { sessionPlanExercises } from './session-plan-exercises';
import { sessions } from './sessions';

export const sessionExercises = sqliteTable(
  'session_exercises',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    exerciseDefinitionId: text('exercise_definition_id').references(() => exerciseDefinitions.id, {
      onDelete: 'no action',
    }),
    sourcePlanExerciseId: text('source_plan_exercise_id').references(() => sessionPlanExercises.id, {
      onDelete: 'set null',
    }),
    orderIndex: integer('order_index').notNull(),
    name: text('name').notNull(),
    machineName: text('machine_name'),
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
    sessionIdx: index('session_exercises_session_id_idx').on(table.sessionId),
    exerciseDefinitionIdx: index('session_exercises_exercise_definition_id_idx').on(table.exerciseDefinitionId),
    sourcePlanExerciseIdx: index('session_exercises_source_plan_exercise_id_idx').on(
      table.sourcePlanExerciseId
    ),
    deletedAtIdx: index('session_exercises_deleted_at_idx').on(table.deletedAt),
    sessionOrderUnique: uniqueIndex('session_exercises_session_id_order_index_unique').on(
      table.sessionId,
      table.orderIndex
    ),
    sourcePlanExerciseUnique: uniqueIndex('session_exercises_owner_source_block_unique')
      .on(table.sourcePlanExerciseId)
      .where(sql`${table.deletedAt} is null and ${table.sourcePlanExerciseId} is not null`),
    orderGuard: check('session_exercises_order_index_non_negative', sql`${table.orderIndex} >= 0`),
  })
);

export type SessionExercise = typeof sessionExercises.$inferSelect;
export type NewSessionExercise = typeof sessionExercises.$inferInsert;
