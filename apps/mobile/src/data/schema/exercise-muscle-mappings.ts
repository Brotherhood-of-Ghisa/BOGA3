import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { exerciseDefinitions } from './exercise-definitions';

export const exerciseMuscleMappings = sqliteTable(
  'exercise_muscle_mappings',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    exerciseDefinitionId: text('exercise_definition_id')
      .notNull()
      .references(() => exerciseDefinitions.id, { onDelete: 'cascade' }),
    // Opaque text with NO FK — mirrors the server, which stores muscle_group_id
    // as opaque text with no foreign key because muscle_groups is a client-only,
    // never-synced taxonomy table. A client FK here bricks cross-version sync:
    // a vN device can push a mapping referencing a muscle group that a v(N-1)
    // device's seeded taxonomy lacks, and the pull would violate the FK and
    // hard-fail the first-sync gate. Kept .notNull() and indexed, like the
    // server.
    muscleGroupId: text('muscle_group_id').notNull(),
    weight: real('weight').notNull(),
    role: text('role', { enum: ['primary', 'secondary', 'stabilizer'] }),
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
    exerciseDefinitionIdx: index('exercise_muscle_mappings_exercise_definition_id_idx').on(table.exerciseDefinitionId),
    muscleGroupIdx: index('exercise_muscle_mappings_muscle_group_id_idx').on(table.muscleGroupId),
    deletedAtIdx: index('exercise_muscle_mappings_deleted_at_idx').on(table.deletedAt),
    exerciseMuscleUnique: uniqueIndex('exercise_muscle_mappings_exercise_id_muscle_group_id_unique').on(
      table.exerciseDefinitionId,
      table.muscleGroupId
    ),
    weightPositiveGuard: check('exercise_muscle_mappings_weight_positive', sql`${table.weight} > 0`),
    roleGuard: check(
      'exercise_muscle_mappings_role_guard',
      sql`${table.role} is null or ${table.role} in ('primary', 'secondary', 'stabilizer')`
    ),
  })
);

export type ExerciseMuscleMapping = typeof exerciseMuscleMappings.$inferSelect;
export type NewExerciseMuscleMapping = typeof exerciseMuscleMappings.$inferInsert;
