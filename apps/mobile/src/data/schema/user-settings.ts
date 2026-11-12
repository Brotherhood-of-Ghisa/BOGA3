import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const userSettings = sqliteTable(
  'user_settings',
  {
    id: text('id').primaryKey().notNull().default('settings'),
    bodyweightCalculationsEnabled: integer('bodyweight_calculations_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    // Synced weekly muscle targets and independent counting choices. Null until
    // a device uploads or adopts them; preference writes set them together.
    weeklyWorkingSetTarget: integer('weekly_working_set_target'),
    muscleTargetMode: text('muscle_target_mode'),
    // Legacy per-setup overrides; read only to migrate them into `muscleTargets`.
    muscleTargetOverrides: text('muscle_target_overrides'),
    // One JSON map, reported muscle id to weekly target ([[muscle.weekly-targets]]).
    muscleTargets: text('muscle_targets'),
    // The user's combined-muscle definitions, a JSON list of {key, name, family}
    // ([[muscle.report-groups]]). Null until a device writes them: the legacy
    // Broad keys on `muscle_groups.report_group` are read instead.
    combinedMuscles: text('combined_muscles'),
    countSecondaryMuscles: integer('count_secondary_muscles', { mode: 'boolean' }),
    volumePrimaryOnly: integer('volume_primary_only', { mode: 'boolean' }),
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
