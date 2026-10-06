/* eslint-disable import/first */

/**
 * Outcome: starting a complete plan materializes every available block into
 * ONE ordinary active-session graph the recorder already understands —
 * sourced cards, planned targets in the `planned_*` fields, blank actuals,
 * `performance_status = 'planned'`, deterministic owner-composed ids — while
 * the source blocks stay pending. Same-plan retries (local or pulled from a
 * competing device) return the existing session; an unrelated active session
 * is a typed conflict; consumed blocks are never re-materialized.
 *
 * Driver: real in-memory SQLite from the shipped migration bundle, with the
 * data layer bootstrapped against it, authoring through the real repository.
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
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import {
  exerciseDefinitions,
  exerciseSets,
  gyms,
  sessionExercises,
  sessionPlanExercises,
  sessionPlans,
  sessions,
} from '@/src/data/schema';
import { planRepository, startSessionPlan } from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-05T09:00:00.000Z');

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
  title: 'Heavy Day',
  gymId: 'gym-1',
  scheduledFor: null,
  exercises: [
    exercise('Back Squat', {
      sets: [set({ targetWeightText: '100', targetRepsText: '5', targetSetType: 'warm_up' }), set({ targetWeightText: '', targetRepsText: '8' })],
    }),
  ],
  ...overrides,
});

const sessionRows = () => db().select().from(sessions).all();
const cardRows = () => db().select().from(sessionExercises).orderBy(sessionExercises.orderIndex).all();
const performedSetRows = () =>
  db().select().from(exerciseSets).orderBy(exerciseSets.orderIndex).all();

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
  db().insert(gyms).values({ id: 'gym-1', name: 'Home Gym' }).run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('startSessionPlan', () => {
  it('materializes every available block into one active, dirty, recorder-readable graph', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');

    const result = await startSessionPlan(created.id, T1);
    expect(result).toEqual({ status: 'started', sessionId: expect.any(String) });
    if (result.status !== 'started') throw new Error(String(result));

    const session = sessionRows()[0];
    expect(session).toMatchObject({
      id: 'local:' + created.id + ':start',
      gymId: 'gym-1',
      sourcePlanId: created.id,
      status: 'active',
      deletedAt: null,
      localDirty: true,
    });
    expect(session.startedAt).toEqual(T1);

    const cards = cardRows();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      sessionId: session.id,
      exerciseDefinitionId: 'def-squat',
      name: 'Back Squat',
      orderIndex: 0,
      sourcePlanExerciseId: expect.any(String),
      deletedAt: null,
      localDirty: true,
    });

    const sets = performedSetRows();
    expect(sets.map((row) => [row.orderIndex, row.repsValue, row.weightValue, row.performanceStatus])).toEqual([
      [0, '', '', 'planned'],
      [1, '', '', 'planned'],
    ]);
    expect(sets.map((row) => row.plannedWeightValue)).toEqual(['100', null]);
    expect(sets.map((row) => row.plannedRepsValue)).toEqual(['5', '8']);
    expect(sets[0].plannedSetType).toBe('warm_up');
    expect(sets.every((row) => row.sourcePlanSetId !== null && row.localDirty)).toBe(true);

    // Provenance survived into the graph the recorder loads.
    const snapshot = await loadSessionSnapshotById(session.id);
    expect(snapshot?.sourcePlanId).toBe(created.id);
    expect(snapshot?.exercises[0].sourcePlanExerciseId).toBe(cards[0].sourcePlanExerciseId);
    expect(snapshot?.exercises[0].sets[0].sourcePlanSetId).toBe(sets[0].sourcePlanSetId);

    // The source blocks are NOT resolved by starting.
    const blocks = db().select().from(sessionPlanExercises).all();
    expect(blocks.every((block) => block.progressStatus === 'pending' && block.resolvedAt === null)).toBe(true);
  });

  it('returns the existing active session on a same-plan retry without duplicating rows', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    const first = await startSessionPlan(created.id, T1);
    if (first.status !== 'started') throw new Error(String(first));

    const retry = await startSessionPlan(created.id, T1);
    expect(retry).toEqual({ status: 'already-active', sessionId: first.sessionId });
    expect(sessionRows()).toHaveLength(1);
    expect(cardRows()).toHaveLength(1);
    expect(performedSetRows()).toHaveLength(2);
  });

  it('returns the pulled session when a competing device already started the plan', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    // Another device started the plan; sync pulled its session (a plain
    // active session row carrying the source link, under a different id).
    db()
      .insert(sessions)
      .values({ id: 'pulled-session', sourcePlanId: created.id, startedAt: T0, localDirty: false })
      .run();

    const result = await startSessionPlan(created.id, T1);
    expect(result).toEqual({ status: 'already-active', sessionId: 'pulled-session' });
    expect(sessionRows()).toHaveLength(1);
  });

  it('refuses with a typed conflict while an unrelated session is active, writing nothing', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    db().insert(sessions).values({ id: 'freeform-session', startedAt: T0 }).run();

    const result = await startSessionPlan(created.id, T1);
    expect(result).toEqual({ status: 'active-conflict', activeSessionId: 'freeform-session' });
    expect(sessionRows()).toHaveLength(1);
    expect(cardRows()).toHaveLength(0);
    expect(performedSetRows()).toHaveLength(0);
  });

  it('materializes only the available blocks of a partially used plan', async () => {
    const created = await planRepository.createPlan(
      planDraft({ exercises: [exercise('Back Squat'), exercise('Bench', { exerciseDefinitionId: 'def-bench' })] }),
      T0,
    );
    if (created.status !== 'saved') throw new Error('seed failed');
    const blocks = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, created.id))
      .orderBy(sessionPlanExercises.orderIndex)
      .all();
    // The first block is already attached to an active session (pulled).
    db().insert(sessions).values({ id: 'other-session', startedAt: T0 }).run();
    db()
      .insert(sessionExercises)
      .values({
        id: 'pulled-card',
        sessionId: 'other-session',
        exerciseDefinitionId: 'def-squat',
        orderIndex: 0,
        name: 'Back Squat',
        sourcePlanExerciseId: blocks[0].id,
      })
      .run();

    const result = await startSessionPlan(created.id, T1);
    // An unrelated active session still conflicts — Start all never merges.
    expect(result).toEqual({ status: 'active-conflict', activeSessionId: 'other-session' });
  });

  it('materializes only unattached pending blocks once the conflict clears', async () => {
    const created = await planRepository.createPlan(
      planDraft({ exercises: [exercise('Back Squat'), exercise('Bench', { exerciseDefinitionId: 'def-bench' })] }),
      T0,
    );
    if (created.status !== 'saved') throw new Error('seed failed');
    const blocks = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, created.id))
      .orderBy(sessionPlanExercises.orderIndex)
      .all();
    // First block attached to a COMPLETED historical session (never resolves
    // it); the block is not available again.
    db().insert(sessions).values({ id: 'done-session', status: 'completed', startedAt: T0 }).run();
    db()
      .insert(sessionExercises)
      .values({
        id: 'done-card',
        sessionId: 'done-session',
        exerciseDefinitionId: 'def-squat',
        orderIndex: 0,
        name: 'Back Squat',
        sourcePlanExerciseId: blocks[0].id,
      })
      .run();

    const result = await startSessionPlan(created.id, T1);
    if (result.status !== 'started') throw new Error(String(result));
    const startedCards = cardRows().filter((row) => row.sessionId === result.sessionId);
    expect(startedCards).toHaveLength(1);
    expect(startedCards[0].sourcePlanExerciseId).toBe(blocks[1].id);
    expect(startedCards[0].exerciseDefinitionId).toBe('def-bench');
  });

  it('returns no-pending-blocks when every block is resolved', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    db()
      .update(sessionPlanExercises)
      .set({ progressStatus: 'completed', resolvedAt: T1 })
      .where(eq(sessionPlanExercises.sessionPlanId, created.id))
      .run();

    const result = await startSessionPlan(created.id, T1);
    expect(result).toEqual({ status: 'no-pending-blocks' });
    expect(sessionRows()).toHaveLength(0);
  });

  it('rejects a deleted plan', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    await planRepository.deletePlan(created.id, T1);
    const result = await startSessionPlan(created.id, T1);
    expect(result).toEqual({ status: 'plan-not-found' });
  });
});
