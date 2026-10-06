/* eslint-disable import/first */

/**
 * Outcome: a block resolves only through explicit Complete or Skip. Complete
 * demands at least one confirmed performed set sourced from THIS block on the
 * live card (manual warm-ups alone never suffice; target deviations never
 * block completion); Skip is refused once confirmed source-derived work
 * exists and never creates performed rows. Resolution writes
 * `progress_status` + `resolved_at` in one transaction and is what advances
 * derived programme progress — attachment alone leaves a block pending.
 *
 * Driver: real in-memory SQLite with the data layer bootstrapped against it;
 * blocks are attached through the real add-block path and performed through
 * the real draft-persistence path.
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
import { loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { exerciseDefinitions, sessionPlanExercises } from '@/src/data/schema';
import {
  addPlanBlockToSession,
  completePlanBlock,
  planQueries,
  planRepository,
  skipPlanBlock,
} from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-05T09:00:00.000Z');
const T2 = new Date('2026-10-05T10:00:00.000Z');

const set = (overrides: Partial<PlanDraft['exercises'][number]['sets'][number]> = {}) => ({
  targetWeightText: '100',
  targetRepsText: '5',
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

/** Attaches the block (creating the active session when none exists). */
const attachBlock = async (blockId: string) => {
  const result = await addPlanBlockToSession(blockId, undefined, T1);
  if (result.status !== 'attached') throw new Error(String(result));
  return result;
};

/** Logs actual values onto the card's sets through the recorder path. */
const performSets = async (sessionId: string, values: { reps: string; weight: string }[]) => {
  const graph = await loadSessionSnapshotById(sessionId);
  if (!graph) throw new Error('seed failed');
  const card = graph.exercises[0];
  await persistSessionDraftSnapshot(
    {
      sessionId: graph.sessionId,
      gymId: graph.gymId,
      startedAt: graph.startedAt,
      sourcePlanId: graph.sourcePlanId ?? null,
      exercises: [
        {
          id: card.id,
          exerciseDefinitionId: card.exerciseDefinitionId,
          name: card.name,
          machineName: card.machineName,
          sourcePlanExerciseId: card.sourcePlanExerciseId ?? null,
          sets: card.sets.map((row, index) => ({
            id: row.id,
            repsValue: values[index]?.reps ?? row.repsValue,
            weightValue: values[index]?.weight ?? row.weightValue,
            setType: row.setType,
            plannedRepsValue: row.plannedRepsValue ?? null,
            plannedWeightValue: row.plannedWeightValue ?? null,
            plannedSetType: row.plannedSetType ?? null,
            performanceStatus: values[index] ? null : (row.performanceStatus ?? null),
            sourcePlanSetId: row.sourcePlanSetId ?? null,
          })),
        },
      ],
    },
    { now: T2 },
  );
};

const planWithBlock = async () => {
  const created = await planRepository.createPlan(
    {
      title: 'Squat Day',
      gymId: null,
      scheduledFor: null,
      exercises: [
        exercise('Back Squat', {
          sets: [
            set({ targetWeightText: '', targetRepsText: '8', targetSetType: 'warm_up' }),
            set(),
          ],
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
  return { planId: created.id, blockId: blocks[0].id };
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db().insert(exerciseDefinitions).values([{ id: 'def-squat', name: 'Back Squat' }]).run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('completePlanBlock', () => {
  it('completes after one confirmed source-derived set, tolerating target deviations', async () => {
    const { planId, blockId } = await planWithBlock();
    const attached = await attachBlock(blockId);
    // Deviation: 3 reps at 90 kg against targets of 5×100.
    await performSets(attached.sessionId, [{ reps: '3', weight: '90' }]);

    const result = await completePlanBlock(blockId, T2);
    expect(result).toEqual({ status: 'completed', resolvedAt: T2 });
    const block = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.id, blockId))
      .get();
    expect(block).toMatchObject({ progressStatus: 'completed', resolvedAt: T2 });

    // Resolution is what advances derived programme progress.
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.progress).toBe('completed');
  });

  it('rejects zero performed sets and manual-only performed sets', async () => {
    const { blockId } = await planWithBlock();
    const attached = await attachBlock(blockId);

    // Nothing performed yet.
    expect(await completePlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });

    // A manual warm-up confirmed on the same card does not count.
    const graph = await loadSessionSnapshotById(attached.sessionId);
    if (!graph) throw new Error('seed failed');
    const card = graph.exercises[0];
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
            sourcePlanExerciseId: card.sourcePlanExerciseId ?? null,
            sets: [
              ...card.sets.map((row) => ({
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
              { repsValue: '10', weightValue: '20', setType: 'warm_up', performanceStatus: null },
            ],
          },
        ],
      },
      { now: T2 },
    );
    expect(await completePlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });
    const block = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.id, blockId))
      .get();
    expect(block?.progressStatus).toBe('pending');
  });

  it('refuses an unattached or unknown block', async () => {
    const { blockId } = await planWithBlock();
    // Nothing attached, nothing performed: completion needs the sourced card.
    expect(await completePlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });
    expect(await completePlanBlock('no-such-block', T2)).toEqual({ status: 'block-not-found' });
  });

  it('completing twice is refused', async () => {
    const { blockId } = await planWithBlock();
    const attached = await attachBlock(blockId);
    await performSets(attached.sessionId, [{ reps: '5', weight: '100' }]);
    expect(await completePlanBlock(blockId, T2)).toEqual({ status: 'completed', resolvedAt: T2 });
    expect(await completePlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });
  });
});

describe('skipPlanBlock', () => {
  it('skips without performed work and never creates performed rows', async () => {
    const { planId, blockId } = await planWithBlock();
    const attached = await attachBlock(blockId);
    expect(
      db()
        .select()
        .from(sessionPlanExercises)
        .where(eq(sessionPlanExercises.id, blockId))
        .get()?.progressStatus,
    ).toBe('pending');

    const result = await skipPlanBlock(blockId, T2);
    expect(result).toEqual({ status: 'skipped', resolvedAt: T2 });
    const block = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.id, blockId))
      .get();
    expect(block).toMatchObject({ progressStatus: 'skipped', resolvedAt: T2 });
    // The performed graph is untouched: the planned rows stay as they were.
    const graph = await loadSessionSnapshotById(attached.sessionId);
    expect(graph?.exercises[0].sets.every((row) => row.performanceStatus === 'planned')).toBe(true);
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.progress).toBe('completed');
  });

  it('refuses to skip once confirmed source-derived work exists', async () => {
    const { blockId } = await planWithBlock();
    const attached = await attachBlock(blockId);
    await performSets(attached.sessionId, [{ reps: '5', weight: '100' }]);
    expect(await skipPlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });
  });

  it('refuses a resolved or unknown block', async () => {
    const { blockId } = await planWithBlock();
    await skipPlanBlock(blockId, T2);
    expect(await skipPlanBlock(blockId, T2)).toEqual({ status: 'not-resolvable' });
    expect(await skipPlanBlock('no-such-block', T2)).toEqual({ status: 'block-not-found' });
  });
});
