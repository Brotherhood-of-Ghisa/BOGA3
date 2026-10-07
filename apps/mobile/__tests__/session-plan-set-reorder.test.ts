/* eslint-disable import/first */

/**
 * Outcome: performed-set reordering is a pure ordering operation over the
 * performed graph — an exact permutation of one card's live set ids rewrites
 * dense `order_index` values atomically and survives reload, an autosave
 * round-trip, and the completed-session edit flow, without touching row
 * identity, source-plan links, planned targets, values, or performance state.
 * Invalid, partial, duplicate, and cross-card lists fail without writing.
 *
 * Driver: real in-memory SQLite from the shipped migration bundle with the
 * data layer bootstrapped against it; sessions are seeded through the real
 * draft-persistence path, including a block materialized by the planner.
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
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
} from '@/src/data/session-drafts';
import { exerciseDefinitions, exerciseSets, sessionPlanExercises } from '@/src/data/schema';
import { addPlanBlockToSession, planRepository, reorderSessionExerciseSets } from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-05T09:00:00.000Z');
const T2 = new Date('2026-10-05T10:00:00.000Z');

const set = (overrides: Partial<PlanDraft['exercises'][number]['sets'][number]> = {}) => ({
  targetWeightText: '60',
  targetRepsText: '8',
  targetSetType: null,
  ...overrides,
});

const exercise = (name: string, overrides: Partial<PlanDraft['exercises'][number]> = {}) => ({
  exerciseDefinitionId: 'def-squat',
  name,
  machineName: '',
  sets: [set()],
  ...overrides,
});

const planDraft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  title: 'Squat Day',
  gymId: null,
  scheduledFor: null,
  exercises: [exercise('Back Squat')],
  ...overrides,
});

/** The performed rows of one card, in stored order. */
const storedSetRows = async (sessionId: string, cardIndex = 0) => {
  const graph = await loadSessionSnapshotById(sessionId);
  const cardId = graph?.exercises[cardIndex]?.id;
  if (!cardId) {
    return [];
  }
  return db()
    .select({
      id: exerciseSets.id,
      orderIndex: exerciseSets.orderIndex,
      repsValue: exerciseSets.repsValue,
      deletedAt: exerciseSets.deletedAt,
    })
    .from(exerciseSets)
    .where(eq(exerciseSets.sessionExerciseId, cardId))
    .orderBy(exerciseSets.orderIndex)
    .all();
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db()
    .insert(exerciseDefinitions)
    .values([
      { id: 'def-squat', name: 'Back Squat' },
      { id: 'def-bench', name: 'Bench Press' },
    ])
    .run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('reorderSessionExerciseSets', () => {
  it('reorders a mixed manual/planned card across reload, autosave, and completed editing', async () => {
    // Warm-up first, then Add block: the card mixes a manual warm-up with two
    // planned sets sourced from a plan block.
    const seeded = await persistSessionDraftSnapshot(
      {
        gymId: null,
        startedAt: T0,
        exercises: [
          {
            exerciseDefinitionId: 'def-squat',
            name: 'Back Squat',
            machineName: null,
            sets: [{ repsValue: '', weightValue: '', setType: 'warm_up', performanceStatus: 'unperformed' }],
          },
        ],
      },
      { now: T0 },
    );
    const created = await planRepository.createPlan(
      {
        title: 'Squat Day',
        gymId: null,
        scheduledFor: null,
        exercises: [
          exercise('Back Squat', {
            sets: [set({ targetWeightText: '100', targetRepsText: '5' }), set({ targetWeightText: '102.5', targetRepsText: '5' })],
          }),
        ],
      },
      T0,
    );
    if (created.status !== 'saved') throw new Error('seed failed');
    const blocks = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, created.id))
      .all();
    const attached = await addPlanBlockToSession(blocks[0].id, undefined, T1);
    if (attached.status !== 'attached') throw new Error(String(attached));
    expect(attached.sessionId).toBe(seeded.sessionId);

    const card = (await loadSessionSnapshotById(seeded.sessionId))?.exercises[0];
    if (!card) throw new Error('seed failed');
    const [warmUpId, plannedA, plannedB] = card.sets.map((row) => row.id);

    // Planned work moves above the warm-up: exact permutation.
    const result = await reorderSessionExerciseSets(card.id, [plannedA, plannedB, warmUpId], T2);
    expect(result).toEqual({ status: 'reordered' });

    const afterReload = (await loadSessionSnapshotById(seeded.sessionId))?.exercises[0];
    expect(afterReload?.sets.map((row) => row.id)).toEqual([plannedA, plannedB, warmUpId]);
    const storedAfterReload = await storedSetRows(seeded.sessionId);
    expect(storedAfterReload.map((row) => row.orderIndex)).toEqual([0, 1, 2]);
    // Provenance and state survive untouched.
    expect(afterReload?.sets[2].setType).toBe('warm_up');
    expect(afterReload?.sets[2].performanceStatus).toBe('unperformed');
    expect(afterReload?.sets[0].sourcePlanSetId).not.toBeNull();
    expect(afterReload?.sets[0].plannedWeightValue).toBe('100');
    expect(afterReload?.sets[2].sourcePlanSetId ?? null).toBeNull();

    // An autosave round-trip (load → persist) preserves the performed order.
    const snapshot = await loadSessionSnapshotById(seeded.sessionId);
    if (!snapshot) throw new Error('seed failed');
    await persistSessionDraftSnapshot(
      {
        sessionId: snapshot.sessionId,
        gymId: snapshot.gymId,
        startedAt: snapshot.startedAt,
        sourcePlanId: snapshot.sourcePlanId ?? null,
        exercises: snapshot.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          name: exercise.name,
          machineName: exercise.machineName,
          sourcePlanExerciseId: exercise.sourcePlanExerciseId ?? null,
          sets: exercise.sets.map((row) => ({
            id: row.id,
            repsValue: row.repsValue,
            weightValue: row.weightValue,
            setType: row.setType,
            plannedRepsValue: row.plannedRepsValue ?? null,
            plannedWeightValue: row.plannedWeightValue ?? null,
            plannedSetType: row.plannedSetType ?? null,
            performanceStatus: row.performanceStatus ?? null,
            sourcePlanSetId: row.sourcePlanSetId ?? null,
          })),
        })),
      },
      { now: T2 },
    );
    const afterAutosave = (await loadSessionSnapshotById(seeded.sessionId))?.exercises[0];
    expect(afterAutosave?.sets.map((row) => row.id)).toEqual([plannedA, plannedB, warmUpId]);
  });

  it('reorders a completed session during the completed-edit flow', async () => {
    const seeded = await persistSessionDraftSnapshot(
      {
        gymId: null,
        startedAt: T0,
        exercises: [
          {
            exerciseDefinitionId: 'def-squat',
            name: 'Back Squat',
            machineName: null,
            sets: [
              { repsValue: '8', weightValue: '100', performanceStatus: null },
              { repsValue: '8', weightValue: '102.5', performanceStatus: null },
              { repsValue: '6', weightValue: '105', performanceStatus: null },
            ],
          },
        ],
      },
      { now: T0 },
    );
    await completeSessionDraft(seeded.sessionId, { completedAt: T1 });
    const sessionId = seeded.sessionId;
    const card = (await loadSessionSnapshotById(sessionId))?.exercises[0];
    if (!card) throw new Error('seed failed');
    const [a, b, c] = card.sets.map((row) => row.id);

    const result = await reorderSessionExerciseSets(card.id, [c, a, b], T2);
    expect(result).toEqual({ status: 'reordered' });

    const afterEdit = (await loadSessionSnapshotById(sessionId))?.exercises[0];
    expect(afterEdit?.sets.map((row) => row.id)).toEqual([c, a, b]);
    const storedAfterEdit = await storedSetRows(sessionId);
    expect(storedAfterEdit.map((row) => [row.id, row.orderIndex])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
    ]);
    expect(storedAfterEdit.map((row) => row.repsValue)).toEqual(['6', '8', '8']);
  });

  it('rejects invalid, partial, duplicate and cross-card lists atomically', async () => {
    const seeded = await persistSessionDraftSnapshot(
      {
        gymId: null,
        startedAt: T0,
        exercises: [
          {
            exerciseDefinitionId: 'def-squat',
            name: 'Back Squat',
            machineName: null,
            sets: [
              { repsValue: '8', weightValue: '100', performanceStatus: null },
              { repsValue: '8', weightValue: '102.5', performanceStatus: null },
              { repsValue: '6', weightValue: '105', performanceStatus: null },
            ],
          },
          {
            exerciseDefinitionId: 'def-bench',
            name: 'Bench',
            machineName: null,
            sets: [{ repsValue: '10', weightValue: '60', performanceStatus: null }],
          },
        ],
      },
      { now: T0 },
    );
    const graph = await loadSessionSnapshotById(seeded.sessionId);
    if (!graph) throw new Error('seed failed');
    const squat = graph.exercises[0];
    const bench = graph.exercises[1];
    const [a, b, c] = squat.sets.map((row) => row.id);

    const orders = async () => (await storedSetRows(seeded.sessionId)).map((row) => row.orderIndex);

    expect(await reorderSessionExerciseSets(squat.id, [a, b], T2)).toEqual({ status: 'invalid-list' });
    expect(await reorderSessionExerciseSets(squat.id, [a, a, b], T2)).toEqual({ status: 'invalid-list' });
    expect(await reorderSessionExerciseSets(squat.id, [a, b, c, bench.sets[0].id], T2)).toEqual({
      status: 'invalid-list',
    });
    expect(await reorderSessionExerciseSets('no-such-card', [a, b, c], T2)).toEqual({
      status: 'exercise-not-found',
    });
    expect(await orders()).toEqual([0, 1, 2]);
  });

  it('reorders over parked set tombstones without colliding', async () => {
    const seeded = await persistSessionDraftSnapshot(
      {
        gymId: null,
        startedAt: T0,
        exercises: [
          {
            exerciseDefinitionId: 'def-squat',
            name: 'Back Squat',
            machineName: null,
            sets: [
              { repsValue: '8', weightValue: '100', performanceStatus: null },
              { repsValue: '8', weightValue: '102.5', performanceStatus: null },
              { repsValue: '6', weightValue: '105', performanceStatus: null },
            ],
          },
        ],
      },
      { now: T0 },
    );
    const graph = await loadSessionSnapshotById(seeded.sessionId);
    if (!graph) throw new Error('seed failed');
    const card = graph.exercises[0];
    const [a, b, c] = card.sets.map((row) => row.id);
    // Delete the middle set through the recorder's own graph path (tombstone
    // parked at ≥2,000,000), then reorder the survivors.
    await persistSessionDraftSnapshot(
      {
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        startedAt: graph.startedAt,
        exercises: [
          {
            id: card.id,
            exerciseDefinitionId: card.exerciseDefinitionId,
            name: card.name,
            machineName: card.machineName,
            sets: [a, c].map((id) => {
              const row = card.sets.find((set) => set.id === id);
              return {
                id,
                repsValue: row?.repsValue ?? '',
                weightValue: row?.weightValue ?? '',
                setType: row?.setType ?? null,
                performanceStatus: row?.performanceStatus ?? null,
              };
            }),
          },
        ],
      },
      { now: T1 },
    );

    const result = await reorderSessionExerciseSets(card.id, [c, a], T2);
    expect(result).toEqual({ status: 'reordered' });
    const rows = db()
      .select({ id: exerciseSets.id, orderIndex: exerciseSets.orderIndex, deletedAt: exerciseSets.deletedAt })
      .from(exerciseSets)
      .where(eq(exerciseSets.sessionExerciseId, card.id))
      .orderBy(exerciseSets.orderIndex)
      .all();
    expect(rows.map((row) => row.id)).toEqual([c, a, b]);
    expect(rows[2].deletedAt).not.toBeNull();
    expect(rows[2].orderIndex).toBeGreaterThan(1_000_000);
  });
});
