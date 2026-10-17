import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const exerciseDefinitions = sqliteTable(
  'exercise_definitions',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    name: text('name').notNull(),
    loadInputMode: text('load_input_mode', { enum: ['total_load', 'per_side_load'] })
      .notNull()
      .default('total_load'),
    bodyweightContribution: real('bodyweight_contribution').notNull().default(0),
    // Report this exercise once per gym instead of once overall (docs/product/gym.md,
    // gym.split). Synced and retroactive: it selects the reporting bucket at read
    // time and never rewrites a raw row.
    splitByGym: integer('split_by_gym', { mode: 'boolean' }).notNull().default(false),
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
    nameIdx: index('exercise_definitions_name_idx').on(table.name),
    deletedAtIdx: index('exercise_definitions_deleted_at_idx').on(table.deletedAt),
    nameNonEmptyGuard: check('exercise_definitions_name_non_empty', sql`${table.name} <> ''`),
    loadInputModeGuard: check(
      'exercise_definitions_load_input_mode_valid',
      sql`${table.loadInputMode} in ('total_load', 'per_side_load')`
    ),
  })
);

export type ExerciseDefinition = typeof exerciseDefinitions.$inferSelect;
export type NewExerciseDefinition = typeof exerciseDefinitions.$inferInsert;
