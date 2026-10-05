/**
 * Outcome: the performed-domain source links clear to NULL when their plan row
 * is hard-deleted, rather than raising a foreign-key error.
 *
 * The three `source_*` columns are nullable provenance links. Their FKs must be
 * `ON DELETE SET NULL` on the reference column only — a plain composite
 * `ON DELETE SET NULL` would also try to clear the non-nullable, immutable
 * `owner_user_id` and fail. This drives the shipped migration bundle against a
 * real better-sqlite3 database with FK enforcement ON (the app's boot state) and
 * asserts the SET NULL behaviour, which the schema-drift checker does not cover.
 */

import { eq } from 'drizzle-orm';

import {
  exerciseDefinitions,
  exerciseSets,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
  trainingProgrammes,
} from '@/src/data/schema';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from '../helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;

beforeEach(() => {
  fixture = createInMemoryDatabase({ foreignKeys: true });
});

afterEach(() => {
  fixture.close();
});

/** A whole-plan-start graph with a performed set sourced from a plan target. */
const seedProvenanceGraph = (): void => {
  const db = fixture.database;
  db.insert(trainingProgrammes).values({ id: 'tp-1', name: 'Wave' }).run();
  db.insert(sessionPlans).values({ id: 'sp-1', programmeId: 'tp-1', title: 'Day 1' }).run();
  db.insert(exerciseDefinitions).values({ id: 'def-1', name: 'Squat' }).run();
  db.insert(sessionPlanExercises)
    .values({ id: 'spe-1', sessionPlanId: 'sp-1', exerciseDefinitionId: 'def-1', orderIndex: 0, name: 'Squat' })
    .run();
  db.insert(sessionPlanSets)
    .values({ id: 'sps-1', sessionPlanExerciseId: 'spe-1', orderIndex: 0, targetReps: 5 })
    .run();
  db.insert(sessions)
    .values({ id: 'sess-1', sourcePlanId: 'sp-1', startedAt: new Date(1000) })
    .run();
  db.insert(sessionExercises)
    .values({ id: 'sx-1', sessionId: 'sess-1', sourcePlanExerciseId: 'spe-1', orderIndex: 0, name: 'Squat' })
    .run();
  db.insert(exerciseSets)
    .values({ id: 'es-1', sessionExerciseId: 'sx-1', sourcePlanSetId: 'sps-1', orderIndex: 0 })
    .run();
};

describe('performed-domain source links clear on parent delete', () => {
  it('nulls sessions.source_plan_id when its plan is hard-deleted', () => {
    seedProvenanceGraph();
    fixture.database.delete(sessionPlans).where(eq(sessionPlans.id, 'sp-1')).run();
    const row = fixture.database.select().from(sessions).where(eq(sessions.id, 'sess-1')).get();
    expect(row?.sourcePlanId).toBeNull();
  });

  it('nulls session_exercises.source_plan_exercise_id when its block is hard-deleted', () => {
    seedProvenanceGraph();
    fixture.database.delete(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'spe-1')).run();
    const row = fixture.database.select().from(sessionExercises).where(eq(sessionExercises.id, 'sx-1')).get();
    expect(row?.sourcePlanExerciseId).toBeNull();
  });

  it('nulls exercise_sets.source_plan_set_id when its target is hard-deleted', () => {
    seedProvenanceGraph();
    fixture.database.delete(sessionPlanSets).where(eq(sessionPlanSets.id, 'sps-1')).run();
    const row = fixture.database.select().from(exerciseSets).where(eq(exerciseSets.id, 'es-1')).get();
    expect(row?.sourcePlanSetId).toBeNull();
  });

  it('nulls session_plans.programme_id when its programme is hard-deleted', () => {
    seedProvenanceGraph();
    fixture.database.delete(trainingProgrammes).where(eq(trainingProgrammes.id, 'tp-1')).run();
    const row = fixture.database.select().from(sessionPlans).where(eq(sessionPlans.id, 'sp-1')).get();
    expect(row?.programmeId).toBeNull();
  });
});
