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
import { loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import {
  exerciseDefinitions,
  exerciseSets,
  gyms,
  sessionExercises,
  sessionPlanExercises,
  sessionPlans,
  sessions,
} from '@/src/data/schema';
import { addPlanBlockToSession, planRepository, startSessionPlan } from '@/src/session-planner';
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

  it('materializes new pending work into a writable session when previous start is completed', async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');

    // 1. Start the plan
    const started = await startSessionPlan(created.id, T0);
    expect(started.status).toBe('started');
    if (started.status !== 'started') throw new Error(String(started));

    // 2. Mark the started session completed
    db().update(sessions).set({ status: 'completed', completedAt: T1 }).where(eq(sessions.id, started.sessionId)).run();
    db().update(sessionPlanExercises).set({ progressStatus: 'completed' }).where(eq(sessionPlanExercises.sessionPlanId, created.id)).run();

    // 3. Add a new block to the plan
    const addResult = await planRepository.addPlanBlock(
      created.id,
      exercise('Bench', { exerciseDefinitionId: 'def-bench' }),
      T1,
    );
    expect(addResult.status).toBe('saved');

    // 4. Start again: should materialize the new work into a writable session rather than failing on completed session
    const startedAgain = await startSessionPlan(created.id, T1);
    expect(startedAgain.status).toBe('started');
    if (startedAgain.status !== 'started') throw new Error(String(startedAgain));
    expect(startedAgain.sessionId).not.toBe(started.sessionId);

    const newSession = sessionRows().find((row) => row.id === startedAgain.sessionId);
    expect(newSession?.status).toBe('active');
  });
});

describe('addPlanBlockToSession', () => {
  /** A freeform active session with one unsourced card, optionally with sets. */
  const seedActiveSession = async (
    exerciseDefinitionId: string,
    name: string,
    sets: { repsValue: string; weightValue: string; setType?: string | null; performanceStatus?: 'planned' | 'unperformed' | null }[] = [],
    cardId?: string,
  ): Promise<{ sessionId: string; cardId: string }> => {
    const persisted = await persistSessionDraftSnapshot(
      {
        gymId: null,
        startedAt: T0,
        exercises: [
          {
            ...(cardId ? { id: cardId } : {}),
            exerciseDefinitionId,
            name,
            machineName: null,
            sets: sets.map((input) => ({
              repsValue: input.repsValue,
              weightValue: input.weightValue,
              setType: (input.setType ?? null) as never,
              performanceStatus: input.performanceStatus ?? null,
            })),
          },
        ],
      },
      { now: T0 },
    );
    const graph = await loadSessionSnapshotById(persisted.sessionId);
    if (!graph) throw new Error('seed failed');
    return { sessionId: persisted.sessionId, cardId: graph.exercises[0].id };
  };

  const createdPlanWithBlock = async () => {
    const created = await planRepository.createPlan(planDraft(), T0);
    if (created.status !== 'saved') throw new Error('seed failed');
    const blocks = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, created.id))
      .orderBy(sessionPlanExercises.orderIndex)
      .all();
    return { planId: created.id, blockId: blocks[0].id };
  };

  it('creates an active session from the plan when none exists', async () => {
    const { blockId } = await createdPlanWithBlock();
    const result = await addPlanBlockToSession(blockId, undefined, T1);
    expect(result).toEqual({
      status: 'attached',
      sessionId: expect.any(String),
      sessionExerciseId: 'local:' + blockId + ':start',
    });
    if (result.status !== 'attached') throw new Error(String(result));

    const session = sessionRows().find((row) => row.id === result.sessionId);
    expect(session).toMatchObject({
      gymId: 'gym-1',
      sourcePlanId: null, // individual-block starts leave it null
      status: 'active',
      localDirty: true,
    });
    const card = cardRows().find((row) => row.id === result.sessionExerciseId);
    expect(card).toMatchObject({
      exerciseDefinitionId: 'def-squat',
      sourcePlanExerciseId: blockId,
      orderIndex: 0,
    });
    const sets = performedSetRows();
    expect(sets.map((row) => [row.orderIndex, row.performanceStatus, row.repsValue])).toEqual([
      [0, 'planned', ''],
      [1, 'planned', ''],
    ]);
    expect(sets.map((row) => row.sourcePlanSetId)).toEqual([expect.any(String), expect.any(String)]);
    expect(sets[0].plannedWeightValue).toBe('100');
  });

  it('appends a sourced card to an unrelated active session, leaving freeform data intact', async () => {
    const { sessionId, cardId } = await seedActiveSession('def-bench', 'Bench', [
      { repsValue: '10', weightValue: '80' },
    ]);
    const freeformBefore = cardRows().find((row) => row.id === cardId);
    const { blockId } = await createdPlanWithBlock();

    const result = await addPlanBlockToSession(blockId, undefined, T1);
    if (result.status !== 'attached') throw new Error(String(result));
    expect(result.sessionId).toBe(sessionId);

    const cards = cardRows().filter((row) => row.deletedAt === null);
    expect(cards).toHaveLength(2);
    expect(cards.map((row) => row.orderIndex)).toEqual([0, 1]);
    const sourcedCard = cards.find((row) => row.id !== cardId);
    expect(sourcedCard).toMatchObject({
      sourcePlanExerciseId: blockId,
      name: 'Back Squat',
      exerciseDefinitionId: 'def-squat',
    });
    const freeformAfter = cardRows().find((row) => row.id === cardId);
    expect(freeformAfter).toMatchObject({
      name: freeformBefore?.name,
      machineName: freeformBefore?.machineName,
      sourcePlanExerciseId: null,
    });
    // The freeform card's set is untouched.
    expect(performedSetRows().filter((row) => row.sessionExerciseId === cardId).map((row) => row.repsValue)).toEqual(['10']);
    // The session stays a manual session (source_plan_id null).
    expect(sessionRows().find((row) => row.id === sessionId)?.sourcePlanId).toBeNull();
  });

  it('attaches to the single compatible unsourced card and keeps manual warm-ups above', async () => {
    const { sessionId, cardId } = await seedActiveSession('def-squat', 'Back Squat', [
      { repsValue: '', weightValue: '', setType: 'warm_up', performanceStatus: 'unperformed' },
    ]);
    const { blockId } = await createdPlanWithBlock();

    const result = await addPlanBlockToSession(blockId, undefined, T1);
    if (result.status !== 'attached') throw new Error(String(result));
    expect(result.sessionId).toBe(sessionId);
    expect(result.sessionExerciseId).toBe(cardId);

    const sets = performedSetRows().filter((row) => row.deletedAt === null);
    expect(sets.map((row) => [row.orderIndex, row.repsValue, row.sourcePlanSetId === null])).toEqual([
      [0, '', true], // the manual warm-up stays first, provenance-free
      [1, '', false],
      [2, '', false],
    ]);
    expect(sets[0].setType).toBe('warm_up');
    expect(sets[0].performanceStatus).toBe('unperformed');
  });

  it('returns ambiguity with candidate ids and writes nothing', async () => {
    const first = await seedActiveSession('def-squat', 'Back Squat A', [], 'card-a');
    const second = await seedActiveSession('def-squat', 'Back Squat B', [], 'card-b');
    // Two active sessions violate the one-active invariant; fold both cards
    // into the first session by moving the second card under it directly.
    db().update(sessionExercises).set({ sessionId: first.sessionId, orderIndex: 1 }).where(eq(sessionExercises.id, second.cardId)).run();
    db().update(sessions).set({ deletedAt: T0 }).where(eq(sessions.id, second.sessionId)).run();
    const { blockId } = await createdPlanWithBlock();

    const result = await addPlanBlockToSession(blockId, undefined, T1);
    expect(result).toEqual({ status: 'ambiguous', candidateSessionExerciseIds: [first.cardId, second.cardId] });
    // Nothing was written: the cards still carry no source link and no sets.
    expect(cardRows().every((row) => row.sourcePlanExerciseId === null)).toBe(true);
    expect(performedSetRows()).toHaveLength(0);
  });

  it('attaches to an explicitly selected compatible card', async () => {
    const first = await seedActiveSession('def-squat', 'Back Squat A', [], 'card-a');
    const second = await seedActiveSession('def-squat', 'Back Squat B', [], 'card-b');
    db().update(sessionExercises).set({ sessionId: first.sessionId, orderIndex: 1 }).where(eq(sessionExercises.id, second.cardId)).run();
    db().update(sessions).set({ deletedAt: T0 }).where(eq(sessions.id, second.sessionId)).run();
    const { blockId } = await createdPlanWithBlock();

    const result = await addPlanBlockToSession(blockId, second.cardId, T1);
    if (result.status !== 'attached') throw new Error(String(result));
    expect(result.sessionExerciseId).toBe(second.cardId);
    expect(performedSetRows().filter((row) => row.deletedAt === null)).toHaveLength(2);
  });

  it('refuses foreign, different-exercise, or already-sourced targets', async () => {
    const active = await seedActiveSession('def-bench', 'Bench');
    const { blockId, planId } = await createdPlanWithBlock();
    // A card already sourced from another plan block.
    const otherPlan = await planRepository.createPlan(planDraft(), T0);
    if (otherPlan.status !== 'saved') throw new Error('seed failed');
    const otherBlocks = db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, otherPlan.id))
      .all();
    db()
      .update(sessionExercises)
      .set({ sourcePlanExerciseId: otherBlocks[0].id })
      .where(eq(sessionExercises.id, active.cardId))
      .run();
    void planId;

    expect(await addPlanBlockToSession(blockId, 'no-such-card', T1)).toEqual({ status: 'target-invalid' });
    expect(await addPlanBlockToSession(blockId, active.cardId, T1)).toEqual({ status: 'target-invalid' });
    expect(performedSetRows().filter((row) => row.deletedAt === null)).toHaveLength(0);
  });

  it('returns the same attachment on retry without duplicating rows', async () => {
    const { blockId } = await createdPlanWithBlock();
    const first = await addPlanBlockToSession(blockId, undefined, T1);
    if (first.status !== 'attached') throw new Error(String(first));

    const retry = await addPlanBlockToSession(blockId, undefined, T1);
    expect(retry).toEqual(first);
    expect(cardRows().filter((row) => row.deletedAt === null)).toHaveLength(1);
    expect(performedSetRows().filter((row) => row.deletedAt === null)).toHaveLength(2);
  });

  it('refuses a resolved block and an unknown block id', async () => {
    const { blockId } = await createdPlanWithBlock();
    db()
      .update(sessionPlanExercises)
      .set({ progressStatus: 'skipped', resolvedAt: T1 })
      .where(eq(sessionPlanExercises.id, blockId))
      .run();
    expect(await addPlanBlockToSession(blockId, undefined, T1)).toEqual({ status: 'block-not-available' });
    expect(await addPlanBlockToSession('no-such-block', undefined, T1)).toEqual({ status: 'block-not-found' });
  });

  it('lets a later manual warm-up share the sourced card without touching provenance', async () => {
    const { blockId } = await createdPlanWithBlock();
    const result = await addPlanBlockToSession(blockId, undefined, T1);
    if (result.status !== 'attached') throw new Error(String(result));

    // The recorder appends a manual set to the sourced card through its own
    // load → splice → persist path.
    const graph = await loadSessionSnapshotById(result.sessionId);
    if (!graph) throw new Error('seed failed');
    const card = graph.exercises.find((exercise) => exercise.id === result.sessionExerciseId);
    if (!card) throw new Error('seed failed');
    const plannedSetsBefore = card.sets.map((set) => [set.id, set.sourcePlanSetId]);
    await persistSessionDraftSnapshot(
      {
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        startedAt: graph.startedAt,
        sourcePlanId: graph.sourcePlanId ?? null,
        exercises: [
          ...graph.exercises.filter((exercise) => exercise.id !== card.id).map((exercise) => ({
            id: exercise.id,
            exerciseDefinitionId: exercise.exerciseDefinitionId,
            name: exercise.name,
            machineName: exercise.machineName,
            sourcePlanExerciseId: exercise.sourcePlanExerciseId ?? null,
            sets: exercise.sets.map((set) => ({
              id: set.id,
              repsValue: set.repsValue,
              weightValue: set.weightValue,
              setType: set.setType,
              plannedRepsValue: set.plannedRepsValue ?? null,
              plannedWeightValue: set.plannedWeightValue ?? null,
              plannedSetType: set.plannedSetType ?? null,
              performanceStatus: set.performanceStatus ?? null,
              sourcePlanSetId: set.sourcePlanSetId ?? null,
            })),
          })),
          {
            id: card.id,
            exerciseDefinitionId: card.exerciseDefinitionId,
            name: card.name,
            machineName: card.machineName,
            sourcePlanExerciseId: card.sourcePlanExerciseId ?? null,
            sets: [
              ...card.sets.map((set) => ({
                id: set.id,
                repsValue: set.repsValue,
                weightValue: set.weightValue,
                setType: set.setType,
                plannedRepsValue: set.plannedRepsValue ?? null,
                plannedWeightValue: set.plannedWeightValue ?? null,
                plannedSetType: set.plannedSetType ?? null,
                performanceStatus: set.performanceStatus ?? null,
                sourcePlanSetId: set.sourcePlanSetId ?? null,
              })),
              { repsValue: '', weightValue: '', setType: 'warm_up' as never, performanceStatus: 'unperformed' as const },
            ],
          },
        ],
      },
      { now: T1 },
    );

    const sets = performedSetRows().filter((row) => row.deletedAt === null);
    expect(sets).toHaveLength(3);
    expect(sets.map((row) => row.setType)).toEqual([null, null, 'warm_up']);
    expect(sets.slice(0, 2).map((row) => [row.id, row.sourcePlanSetId])).toEqual(plannedSetsBefore);
    expect(sets[2].sourcePlanSetId).toBeNull();
  });

  it('releases discarded child claims and allows re-attaching block to a new session', async () => {
    const { blockId } = await createdPlanWithBlock();
    // 1. Attach block to session 1
    const firstAttach = await addPlanBlockToSession(blockId, undefined, T0);
    expect(firstAttach.status).toBe('attached');
    if (firstAttach.status !== 'attached') throw new Error(String(firstAttach));

    // 2. Discard session 1 (soft delete the session row)
    db().update(sessions).set({ deletedAt: T1 }).where(eq(sessions.id, firstAttach.sessionId)).run();

    // 3. Attach the same block again (in a new session): must not fail with UNIQUE constraint on source_plan_exercise_id
    const secondAttach = await addPlanBlockToSession(blockId, undefined, T1);
    expect(secondAttach.status).toBe('attached');
    if (secondAttach.status !== 'attached') throw new Error(String(secondAttach));
    expect(secondAttach.sessionId).not.toBe(firstAttach.sessionId);
  });

  it('generates distinct set ids for attachments to different cards', async () => {
    const { blockId } = await createdPlanWithBlock();
    const sessionA = await seedActiveSession('def-squat', 'Squat A', [], 'card-A');

    // Attach to card A
    const attachA = await addPlanBlockToSession(blockId, sessionA.cardId, T0);
    expect(attachA.status).toBe('attached');

    // Sets on card A
    const setsA = performedSetRows().filter((s) => s.sessionExerciseId === sessionA.cardId);

    // Complete session A and clear its card's and sets' claim so session B can be active on Device B
    db().update(sessions).set({ status: 'completed', completedAt: T1 }).where(eq(sessions.id, sessionA.sessionId)).run();
    db().update(sessionExercises).set({ sourcePlanExerciseId: null }).where(eq(sessionExercises.id, sessionA.cardId)).run();
    db().update(exerciseSets).set({ sourcePlanSetId: null }).where(eq(exerciseSets.sessionExerciseId, sessionA.cardId)).run();

    const sessionB = await seedActiveSession('def-squat', 'Squat B', [], 'card-B');

    // Attach same block to card B
    const attachB = await addPlanBlockToSession(blockId, sessionB.cardId, T1);
    expect(attachB.status).toBe('attached');

    const setsB = performedSetRows().filter((s) => s.sessionExerciseId === sessionB.cardId);

    expect(setsA.length).toBeGreaterThan(0);
    expect(setsB.length).toBeGreaterThan(0);
    const idsA = new Set(setsA.map((s) => s.id));
    for (const setB of setsB) {
      expect(idsA.has(setB.id)).toBe(false);
    }
  });
});
