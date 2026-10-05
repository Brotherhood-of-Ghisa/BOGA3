import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { gyms } from './gyms';
import { trainingProgrammes } from './training-programmes';

export const sessionPlans = sqliteTable(
  'session_plans',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    programmeId: text('programme_id').references(() => trainingProgrammes.id, {
      onDelete: 'set null',
    }),
    programmeOrderIndex: integer('programme_order_index'),
    gymId: text('gym_id').references(() => gyms.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }),
    provenance: text('provenance', { enum: ['human', 'agent'] })
      .notNull()
      .default('human'),
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
    programmeIdx: index('session_plans_programme_id_idx').on(table.programmeId),
    gymIdx: index('session_plans_gym_id_idx').on(table.gymId),
    scheduledForIdx: index('session_plans_scheduled_for_idx').on(table.scheduledFor),
    deletedAtIdx: index('session_plans_deleted_at_idx').on(table.deletedAt),
    titleGuard: check('session_plans_title_non_empty', sql`length(${table.title}) > 0`),
    provenanceGuard: check('session_plans_provenance_valid', sql`${table.provenance} in ('human', 'agent')`),
    orderGuard: check(
      'session_plans_programme_order_index_non_negative',
      sql`${table.programmeOrderIndex} is null or ${table.programmeOrderIndex} >= 0`
    ),
  })
);

export type SessionPlan = typeof sessionPlans.$inferSelect;
export type NewSessionPlan = typeof sessionPlans.$inferInsert;
