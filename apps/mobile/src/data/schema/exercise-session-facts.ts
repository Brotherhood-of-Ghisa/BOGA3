import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Local-only, derived facts: one row per completed, non-deleted session and
// linked exercise definition with at least one eligible performed set. Each row
// holds that exercise's bests for the session and its personal-record flags
// (spec 05, "Exercise session facts").
//
// This is NOT user data and never crosses the wire: no dirty bit, no monotonic
// timestamp, no server counterpart. Sync impact decision: `out of sync scope`.
// It is FK-free (spec 05 local integrity rule 2); readers inner-join the live
// session rows. Triggers on the raw tables queue stale definitions in
// `exercise_session_facts_stale`, and `src/data/exercise-session-facts.ts`
// rebuilds them before any read. All three tables are cleared by the
// sign-out / account-switch wipe.
export const exerciseSessionFacts = sqliteTable(
  'exercise_session_facts',
  {
    sessionId: text('session_id').notNull(),
    exerciseDefinitionId: text('exercise_definition_id').notNull(),
    /** The session's `completed_at`; ties are ordered by `session_id`. */
    achievedAt: integer('achieved_at', { mode: 'timestamp_ms' }).notNull(),
    bestE1rmKg: real('best_e1rm_kg'),
    bestE1rmSetId: text('best_e1rm_set_id'),
    /** Raw entered kg. */
    topWeightKg: real('top_weight_kg'),
    topWeightSetId: text('top_weight_set_id'),
    /** The known subtotal; the full total only when `volume_complete`. */
    volumeKg: real('volume_kg'),
    volumeComplete: integer('volume_complete', { mode: 'boolean' }).notNull(),
    workingSets: integer('working_sets').notNull(),
    volumeSets: integer('volume_sets').notNull().default(0),
    prE1rm: integer('pr_e1rm', { mode: 'boolean' }).notNull(),
    prWeight: integer('pr_weight', { mode: 'boolean' }).notNull(),
    prVolume: integer('pr_volume', { mode: 'boolean' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.exerciseDefinitionId, table.sessionId] }),
    definitionAchievedAtIdx: index('exercise_session_facts_definition_achieved_at_idx').on(
      table.exerciseDefinitionId,
      table.achievedAt,
    ),
    achievedAtIdx: index('exercise_session_facts_achieved_at_idx').on(table.achievedAt),
  }),
);

/** Definitions whose facts a raw-data or policy write made stale. */
export const exerciseSessionFactsStale = sqliteTable('exercise_session_facts_stale', {
  exerciseDefinitionId: text('exercise_definition_id').primaryKey().notNull(),
});

/**
 * Singleton: the rules version the whole facts table was last fully built
 * under, with a canonical personal effort-policy key. A missing row (fresh install, wipe) or an older version forces a full
 * rebuild before the next read; a different effort-policy key does the same.
 */
export const exerciseSessionFactsState = sqliteTable('exercise_session_facts_state', {
  id: text('id').primaryKey().notNull().default('facts'),
  rulesVersion: integer('rules_version').notNull(),
  effortPolicyKey: text('effort_policy_key').notNull().default(''),
});

export type ExerciseSessionFact = typeof exerciseSessionFacts.$inferSelect;
export type NewExerciseSessionFact = typeof exerciseSessionFacts.$inferInsert;
