import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const muscleGroups = sqliteTable(
  'muscle_groups',
  {
    // Stable taxonomy IDs (for example `chest_sternal`) are supplied by seed
    // data; the random default covers any row inserted without an explicit id.
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    displayName: text('display_name').notNull(),
    familyName: text('family_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isEditable: integer('is_editable').notNull().default(0),
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
    familyIdx: index('muscle_groups_family_name_idx').on(table.familyName),
    sortOrderIdx: index('muscle_groups_sort_order_idx').on(table.sortOrder),
    displayNameIdx: index('muscle_groups_display_name_idx').on(table.displayName),
    sortOrderGuard: check('muscle_groups_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
    isEditableBooleanGuard: check('muscle_groups_is_editable_boolean_guard', sql`${table.isEditable} in (0, 1)`),
  })
);

export type MuscleGroup = typeof muscleGroups.$inferSelect;
export type NewMuscleGroup = typeof muscleGroups.$inferInsert;
