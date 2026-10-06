/* eslint-disable import/first */

/**
 * Outcome: the planner read models present upcoming/unscheduled queues,
 * programme progress, per-block consumption state, and the next available
 * programme block — all derived on read from block attachment and resolution,
 * never stored, and never including tombstoned rows.
 *
 * Driver: real in-memory SQLite from the shipped migration bundle, with the
 * data layer bootstrapped against it, authoring through the real repository
 * and attaching/resolving through direct seeded rows.
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

// Imported AFTER the bootstrap mock so the repository binds to it.
import { __resetClockForTests } from '@/src/data/clock';
import { createDrizzleSessionPlanStore } from '@/src/data/session-plan-store';
import {
  exerciseDefinitions,
  sessionExercises,
  sessionPlanExercises,
  sessionPlans,
  sessions,
} from '@/src/data/schema';
import { planQueries, planRepository } from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

const store = createDrizzleSessionPlanStore();

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-06T08:00:00.000Z');
const MONDAY = new Date('2026-10-12T07:00:00.000Z');
const WEDNESDAY = new Date('2026-10-14T18:30:00.000Z');

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

const planDraft = (title: string, overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  title,
  gymId: null,
  scheduledFor: null,
  exercises: [exercise('Back Squat')],
  ...overrides,
});

/** Seeds a live performed card that claims `planExerciseId` (attachment). */
const attachBlock = (planExerciseId: string, cardId: string, sessionId = 'sess-1'): void => {
  db().insert(sessions).values({ id: sessionId, startedAt: T0 }).onConflictDoNothing().run();
  db()
    .insert(sessionExercises)
    .values({
      id: cardId,
      sessionId,
      exerciseDefinitionId: 'def-squat',
      orderIndex: 0,
      name: 'Back Squat',
      sourcePlanExerciseId: planExerciseId,
    })
    .run();
};

const resolveBlock = (planExerciseId: string, status: 'completed' | 'skipped'): void => {
  db()
    .update(sessionPlanExercises)
    .set({ progressStatus: status, resolvedAt: T0 })
    .where(eq(sessionPlanExercises.id, planExerciseId))
    .run();
};

const blockIdsByPlan = async (planId: string): Promise<string[]> =>
  db()
    .select({ id: sessionPlanExercises.id })
    .from(sessionPlanExercises)
    .where(eq(sessionPlanExercises.sessionPlanId, planId))
    .orderBy(sessionPlanExercises.orderIndex)
    .all()
    .map((row) => row.id);

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db()
    .insert(exerciseDefinitions)
    .values([{ id: 'def-squat', name: 'Back Squat' }, { id: 'def-bench', name: 'Bench Press' }])
    .run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('upcoming and unscheduled queues', () => {
  it('lists scheduled plans soonest first with derived progress', async () => {
    const early = await planRepository.createPlan(planDraft('Early', { scheduledFor: MONDAY }), T0);
    const late = await planRepository.createPlan(
      planDraft('Late', { scheduledFor: WEDNESDAY, exercises: [exercise('Bench', { exerciseDefinitionId: 'def-bench' })] }),
      T0,
    );
    const unscheduled = await planRepository.createPlan(planDraft('Unscheduled'), T0);
    if (early.status !== 'saved' || late.status !== 'saved' || unscheduled.status !== 'saved') {
      throw new Error('seed failed');
    }
    db().update(sessionPlans).set({ deletedAt: T0 }).where(eq(sessionPlans.id, late.id)).run();

    const upcoming = await planQueries.listUpcomingPlans();
    expect(upcoming.map((plan) => plan.title)).toEqual(['Early']);
    expect(upcoming[0]).toMatchObject({
      scheduledFor: MONDAY,
      programmeId: null,
      provenance: 'human',
      progress: 'planned',
      blockCounts: { pending: 1, attached: 0, completed: 0, skipped: 0 },
    });
  });

  it('lists unscheduled standalone plans newest-first, excluding programme children', async () => {
    const created = await planRepository.createProgramme(
      { name: 'Wave', description: '', plans: [planDraft('W1'), planDraft('W2')] },
      T0,
    );
    const standalone = await planRepository.createPlan(planDraft('Standalone'), T0);
    if (created.status !== 'saved' || standalone.status !== 'saved') throw new Error('seed failed');
    const secondStandalone = await planRepository.createPlan(planDraft('Newer'), T0);
    if (secondStandalone.status !== 'saved') throw new Error('seed failed');
    // Distinct stamps make the newest-first order deterministic.
    db().update(sessionPlans).set({ updatedAt: T1 }).where(eq(sessionPlans.id, secondStandalone.id)).run();

    const unscheduled = await planQueries.listUnscheduledPlans();
    expect(unscheduled.map((plan) => plan.title)).toEqual(['Newer', 'Standalone']);
    expect(unscheduled.every((plan) => plan.programmeId === null)).toBe(true);
    expect(unscheduled.some((plan) => plan.id === secondStandalone.id)).toBe(true);
  });
});

describe('plan detail with block consumption state', () => {
  it('derives pending, attached, completed and skipped statuses from rows', async () => {
    const created = await planRepository.createPlan(
      planDraft('Mixed', {
        exercises: [exercise('Squat'), exercise('Bench', { exerciseDefinitionId: 'def-bench' }), exercise('Row')],
      }),
      T0,
    );
    if (created.status !== 'saved') throw new Error('seed failed');
    const ids = await blockIdsByPlan(created.id);
    attachBlock(ids[0], 'card-squat');
    resolveBlock(ids[1], 'completed');
    resolveBlock(ids[2], 'skipped');

    const detail = await planQueries.loadPlanDetail(created.id);
    expect(detail).not.toBeNull();
    if (!detail) throw new Error('missing detail');
    expect(detail.progress).toBe('in_progress');
    expect(detail.blocks.map((block) => block.status)).toEqual(['attached', 'completed', 'skipped']);
    expect(detail.blocks[0]).toMatchObject({
      attachedSessionId: 'sess-1',
      attachedSessionExerciseId: 'card-squat',
      progressStatus: 'pending',
      targets: [{ targetWeightValue: '60', targetReps: 8, targetSetType: null }],
    });
    expect(detail.blocks[1].resolvedAt).toEqual(T0);

    resolveBlock(ids[0], 'completed');
    const resolvedDetail = await planQueries.loadPlanDetail(created.id);
    expect(resolvedDetail?.progress).toBe('completed');
  });
});

describe('programme progress and next block', () => {
  const createTwoPlanProgramme = async () => {
    const created = await planRepository.createProgramme(
      {
        name: 'Squat Wave',
        description: 'Three waves',
        plans: [
          planDraft('W1', { exercises: [exercise('Squat'), exercise('Bench', { exerciseDefinitionId: 'def-bench' })] }),
          planDraft('W2'),
        ],
      },
      T0,
    );
    if (created.status !== 'saved') throw new Error('seed failed');
    const graphs = await store.listPlanGraphsByProgramme(created.id);
    return { programmeId: created.id, w1: graphs[0].plan.id, w2: graphs[1].plan.id };
  };

  it('exposes the earliest pending block in programme-order then exercise-order', async () => {
    const { programmeId } = await createTwoPlanProgramme();
    const next = await planQueries.findNextProgrammeBlock(programmeId);
    expect(next).not.toBeNull();
    expect(next?.name).toBe('Squat');
    expect(next?.status).toBe('pending');
  });

  it('skips attached and resolved blocks; null when every block is consumed', async () => {
    const { programmeId, w1, w2 } = await createTwoPlanProgramme();
    const w1Ids = await blockIdsByPlan(w1);
    attachBlock(w1Ids[0], 'card-squat');
    const attachedNext = await planQueries.findNextProgrammeBlock(programmeId);
    expect(attachedNext?.name).toBe('Bench');

    resolveBlock(w1Ids[1], 'skipped');
    const laterNext = await planQueries.findNextProgrammeBlock(programmeId);
    expect(laterNext?.planId).toBe(w2);

    const w2Ids = await blockIdsByPlan(w2);
    resolveBlock(w2Ids[0], 'completed');
    // The attached-but-unresolved squat keeps progress in_progress; resolving
    // it is what completes the programme.
    resolveBlock(w1Ids[0], 'completed');
    expect(await planQueries.findNextProgrammeBlock(programmeId)).toBeNull();
    const detail = await planQueries.loadProgrammeDetail(programmeId);
    expect(detail?.progress).toBe('completed');
  });

  it('reports derived progress across the programme summaries', async () => {
    const { programmeId, w1 } = await createTwoPlanProgramme();
    const before = await planQueries.listProgrammeSummaries();
    expect(before.map((programme) => programme.progress)).toEqual(['planned']);
    expect(before[0].planCount).toBe(2);
    expect(before[0].blockCounts).toEqual({ pending: 3, attached: 0, completed: 0, skipped: 0 });

    const w1Ids = await blockIdsByPlan(w1);
    attachBlock(w1Ids[0], 'sess-1', 'card-squat');
    const during = await planQueries.listProgrammeSummaries();
    expect(during[0].progress).toBe('in_progress');
    expect(during[0].blockCounts.attached).toBe(1);
    expect(during[0].id).toBe(programmeId);
  });
});
