import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Owner-private Sync v2 root. Session source ids are provenance, not FKs:
// editing or deleting a reading must never modify a saved session snapshot.
export const bodyWeightMeasurements = sqliteTable(
  'body_weight_measurements',
  {
    id: text('id').primaryKey().notNull().default(sql`(lower(hex(randomblob(16))))`),
    weightValue: text('weight_value').notNull(),
    weightUnit: text('weight_unit').notNull(),
    weightKg: real('weight_kg').notNull(),
    measuredAt: integer('measured_at', { mode: 'timestamp_ms' }).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  table => ({
    measuredAtIdx: index('body_weight_measurements_measured_at_idx').on(table.measuredAt),
    deletedAtIdx: index('body_weight_measurements_deleted_at_idx').on(table.deletedAt),
  })
);

export type BodyWeightMeasurement = typeof bodyWeightMeasurements.$inferSelect;
export type NewBodyWeightMeasurement = typeof bodyWeightMeasurements.$inferInsert;
