import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const userSettings = sqliteTable(
  'user_settings',
  {
    id: text('id').primaryKey().notNull().default('settings'),
    bodyweightCalculationsEnabled: integer('bodyweight_calculations_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    // Synced weekly muscle targets and the count-secondary switch. Null until a
    // device uploads or adopts them; a write always sets the four together.
    weeklyWorkingSetTarget: integer('weekly_working_set_target'),
    muscleTargetMode: text('muscle_target_mode'),
    muscleTargetOverrides: text('muscle_target_overrides'),
    countSecondaryMuscles: integer('count_secondary_muscles', { mode: 'boolean' }),
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
  table => ({
    singletonGuard: check('user_settings_singleton', sql`${table.id} = 'settings'`),
    deletedAtIdx: index('user_settings_deleted_at_idx').on(table.deletedAt),
  }),
);

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;
