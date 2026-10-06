/* eslint-disable import/first */

/**
 * Outcome: planning rows stay invisible to every existing read surface, while
 * a session created from a plan participates like any other workout once it
 * exists. With plans pending, attached, completed and skipped in the
 * database, the session list, exercise history, the stats aggregation input,
 * and the group set-fact derivation see exactly the performed session's data
 * — and nothing derived from a plan.
 *
 * Driver: real in-memory SQLite from the shipped migration bundle with the
 * data layer bootstrapped against it; the performed side is produced through
 * the real materialization and completion paths.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Imported AFTER the bootstrap mock so the domain code binds to it.
import { __resetClockForTests } from '@/src/data/clock';
import {
  completeSessionDraft,
  listCompletedSessionsForAnalysis,
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
} from '@/src/data/session-drafts';
import { createDrizzleStatsStore, aggregateStats } from '@/src/data/stats';
import { listSessionListBuckets } from '@/src/data/session-list';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { normalizeGroupSetFacts } from '@/src/groups/set-facts';
import {
  exerciseDefinitions,
  exerciseSets,
  muscleGroups,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
} from '@/src/data/schema';
import {
  completePlanBlock,
  planRepository,
  startSessionPlan,
} from '@/src/session-planner';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-05T09:00:00.000Z');
const T2 = new Date('2026-10-05T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const planDraft = (title: string) => ({
  title,
  gymId: null,
  scheduledFor: null,
  exercises: [
    {
      exerciseDefinitionId: 'def-squat',
      name: 'Back Squat',
      machineName: '',
      sets: [
        { targetWeightText: '100', targetRepsText: '5', targetSetType: null },
        { targetWeightText: '80', targetRepsText: '8', targetSetType: null },
      ],
    },
  ],
});

/** Seeds: one completed session FROM a plan, plus pending and skipped plans. */
const seedWorld = async (): Promise<{ completedSessionId: string; sourcePlanId: string }> => {
  const used = await planRepository.createPlan(planDraft('Used Plan'), T0);
  if (used.status !== 'saved') throw new Error('seed failed');
  const started = await startSessionPlan(used.id, T1);
  if (started.status !== 'started') throw new Error('seed failed');
  const graph = await loadSessionSnapshotById(started.sessionId);
  if (!graph) throw new Error('seed failed');
  // Confirm both planned sets (5×100, 8×80) through the recorder path.
  await persistSessionDraftSnapshot(
    {
      sessionId: graph.sessionId,
      gymId: graph.gymId,
      startedAt: graph.startedAt,
      sourcePlanId: graph.sourcePlanId ?? null,
      exercises: graph.exercises.map((card) => ({
        id: card.id,
        exerciseDefinitionId: card.exerciseDefinitionId,
        name: card.name,
        machineName: card.machineName,
        sourcePlanExerciseId: card.sourcePlanExerciseId ?? null,
        sets: card.sets.map((row, index) => ({
          id: row.id,
          repsValue: ['5', '8'][index] ?? row.repsValue,
          weightValue: ['100', '80'][index] ?? row.weightValue,
          setType: row.setType,
          performanceStatus: null,
          plannedRepsValue: row.plannedRepsValue ?? null,
          plannedWeightValue: row.plannedWeightValue ?? null,
          plannedSetType: row.plannedSetType ?? null,
          sourcePlanSetId: row.sourcePlanSetId ?? null,
        })),
      })),
    },
    { now: T1 },
  );
  const blocks = db()
    .select()
    .from(sessionPlanExercises)
    .where(eq(sessionPlanExercises.sessionPlanId, used.id))
    .all();
  const completedBlock = await completePlanBlock(blocks[0].id, T1);
  if (completedBlock.status !== 'completed') throw new Error('seed failed');
  await completeSessionDraft(started.sessionId, { completedAt: T1 });

  await planRepository.createPlan(planDraft('Pending Plan'), T0);

  const skipped = await planRepository.createPlan(planDraft('Skipped Plan'), T0);
  if (skipped.status !== 'saved') throw new Error('seed failed');
  db()
    .update(sessionPlanExercises)
    .set({ progressStatus: 'skipped', resolvedAt: T0 })
    .where(eq(sessionPlanExercises.sessionPlanId, skipped.id))
    .run();

  return { completedSessionId: started.sessionId, sourcePlanId: used.id };
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db()
    .insert(exerciseDefinitions)
    .values([{ id: 'def-squat', name: 'Back Squat', loadInputMode: 'total_load' }])
    .run();
  db()
    .insert(muscleGroups)
    .values([{ id: 'mg-quads', displayName: 'Quadriceps', familyName: 'legs', sortOrder: 0 }])
    .run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('planner rows stay out of existing read surfaces', () => {
  it('session list sees only the performed session, whatever the plan states', async () => {
    const { completedSessionId } = await seedWorld();

    const buckets = await listSessionListBuckets();
    expect(buckets.active).toBeNull();
    expect(buckets.completed.map((session) => session.id)).toEqual([completedSessionId]);
  });

  it('a completed session created from a plan participates in history normally', async () => {
    const { completedSessionId } = await seedWorld();

    const records = await listCompletedSessionsForAnalysis();
    expect(records.map((record) => record.sessionId)).toEqual([completedSessionId]);
    expect(records[0].durationSec).toBe(0);
  });

  it('exercise history counts exactly the performed sets of the plan-sourced session', async () => {
    await seedWorld();

    const history = await loadExercisePerformanceHistory({ exerciseDefinitionId: 'def-squat', now: T2 });
    expect(history).not.toBeNull();
    expect(history?.sessions).toHaveLength(1);
    const setCount = history?.sessions.reduce((total, session) => total + session.sets.length, 0) ?? 0;
    expect(setCount).toBe(2);
  });

  it('the stats aggregation input derives only from performed rows', async () => {
    const { completedSessionId } = await seedWorld();

    const statsStore = createDrizzleStatsStore();
    const input = await statsStore.loadAggregationInput({
      start: new Date(T0.getTime() - DAY_MS),
      end: new Date(T2.getTime() + DAY_MS),
    });
    expect(input.sessions.map((session) => session.id)).toEqual([completedSessionId]);
    expect(input.exerciseSets).toHaveLength(2);
    expect(input.exerciseSets.map((row) => [row.weightValue, row.repsValue])).toEqual([
      ['100', '5'],
      ['80', '8'],
    ]);
    // Plans exist in every state alongside, and none of them appear.
    expect(db().select().from(sessionPlans).all()).toHaveLength(3);
    expect(db().select().from(sessionPlanExercises).all()).toHaveLength(3);
    expect(db().select().from(sessionPlanSets).all()).toHaveLength(6);

    const totals = aggregateStats({ ...input, muscleGroups: await statsStore.loadMuscleGroupTaxonomy() });
    expect(totals.sessionCount).toBe(1);
    expect(totals.workingSetCount).toBe(2);
  });

  it('group set facts derive from performed rows only and ignore plan provenance', async () => {
    const { completedSessionId } = await seedWorld();

    const graph = await loadSessionSnapshotById(completedSessionId);
    if (!graph) throw new Error('seed failed');
    const card = graph.exercises[0];
    const facts = normalizeGroupSetFacts({
      session_id: completedSessionId,
      started_at_ms: graph.startedAt.getTime(),
      sets: card.sets.map((row, index) => ({
        set_id: row.id,
        session_exercise_id: card.id,
        exercise_definition_id: card.exerciseDefinitionId,
        exercise_order_index: 0,
        set_order_index: index,
        weight_value: row.weightValue,
        reps_value: row.repsValue,
        performance_status: row.performanceStatus ?? null,
        set_type: row.setType,
        live: true,
        fingerprint: `${row.id}`,
      })),
    });
    expect(facts).toHaveLength(2);
    expect(facts.map((fact) => fact.weight_kg)).toEqual([100, 80]);
    expect(facts.every((fact) => fact.working)).toBe(true);
    // The plan's target rows are not facts — only performed sets are.
    expect(db().select().from(sessionPlanSets).all()).toHaveLength(6);
  });

  it('leaves performed-set provenance readable for the planner without exposing it to analytics', async () => {
    await seedWorld();
    const sourcedSets = db()
      .select({ id: exerciseSets.id, sourcePlanSetId: exerciseSets.sourcePlanSetId })
      .from(exerciseSets)
      .all();
    expect(sourcedSets.every((row) => row.sourcePlanSetId !== null)).toBe(true);
  });
});
