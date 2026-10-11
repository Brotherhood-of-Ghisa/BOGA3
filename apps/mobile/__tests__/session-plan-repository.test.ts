/* eslint-disable import/first */

/**
 * Outcome: plan/programme authoring is local-first, validated before any
 * write, transactional (a rejected save leaves zero rows), and lifecycle-gated
 * — a block that a live performed card claims, or that is explicitly
 * resolved, is a read-only snapshot while future unattached blocks stay
 * editable. Graph rewrites survive the non-partial local `(parent,
 * order_index)` unique indexes via the scratch-band dance, so tombstones
 * never collide with re-densified live rows.
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle (FK
 * enforcement on, like the production handle), with `bootstrapLocalDataLayer`
 * pointed at it so the real repository runs end to end.
 */

import { eq, isNull } from 'drizzle-orm';

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

// Imported AFTER the bootstrap mock so the repository and store bind to it.
import { __resetClockForTests } from '@/src/data/clock';
import { createDrizzleSessionPlanStore } from '@/src/data/session-plan-store';
import {
  exerciseDefinitions,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
  trainingProgrammes,
} from '@/src/data/schema';
import { planRepository } from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

const store = createDrizzleSessionPlanStore();

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-06T08:00:00.000Z');

const set = (overrides: Partial<PlanDraft['exercises'][number]['sets'][number]> = {}) => ({
  targetWeightText: '60',
  targetRepsText: '8',
  targetSetType: null,
  ...overrides,
});

const exercise = (overrides: Partial<PlanDraft['exercises'][number]> = {}) => ({
  exerciseDefinitionId: 'def-squat',
  name: 'Back Squat',
  sets: [set()],
  ...overrides,
});

const planDraft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  title: 'Heavy Day',
  gymId: null,
  scheduledFor: null,
  exercises: [exercise()],
  ...overrides,
});

const planRows = () => db().select().from(sessionPlans).all();
const blockRows = () => db().select().from(sessionPlanExercises).all();
const setRows = () => db().select().from(sessionPlanSets).all();
const livePlanRows = () => db().select().from(sessionPlans).where(isNull(sessionPlans.deletedAt)).all();

/** Seeds a live performed card that claims `planExerciseId` (attachment). */
const attachBlockToCard = (planExerciseId: string, cardId = 'card-1'): void => {
  db().insert(sessions).values({ id: 'sess-1', startedAt: T0 }).run();
  db()
    .insert(sessionExercises)
    .values({
      id: cardId,
      sessionId: 'sess-1',
      exerciseDefinitionId: 'def-squat',
      orderIndex: 0,
      name: 'Back Squat',
      sourcePlanExerciseId: planExerciseId,
    })
    .run();
};

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

describe('plan repository — create', () => {
  it('creates a standalone plan with dense order, canonical targets and dirty stamps', async () => {
    const result = await planRepository.createPlan(
      planDraft({
        title: '  Heavy Day  ',
        scheduledFor: T1,
        exercises: [
          exercise({
            sets: [set({ targetWeightText: '080.50', targetRepsText: '08' }), set({ targetWeightText: '' })],
          }),
        ],
      }),
      T0,
    );

    expect(result).toEqual({ status: 'saved', id: expect.any(String) });
    const plan = planRows()[0];
    expect(plan).toMatchObject({
      title: 'Heavy Day',
      gymId: null,
      scheduledFor: T1,
      provenance: 'human',
      deletedAt: null,
      localDirty: true,
    });
    expect(blockRows()).toHaveLength(1);
    expect(blockRows()[0]).toMatchObject({
      sessionPlanId: plan.id,
      orderIndex: 0,
      name: 'Back Squat',
      exerciseDefinitionId: 'def-squat',
      progressStatus: 'pending',
      localDirty: true,
    });
    expect(setRows().map((row) => [row.orderIndex, row.targetWeightValue, row.targetReps])).toEqual([
      [0, '80.5', 8],
      [1, null, 8],
    ]);
  });

  it('stores an unscheduled plan with a null schedule', async () => {
    await planRepository.createPlan(planDraft(), T0);
    expect(planRows()[0].scheduledFor).toBeNull();
  });

  it('rejects a zero-exercise plan without writing anything', async () => {
    const result = await planRepository.createPlan(planDraft({ exercises: [] }), T0);
    expect(result).toEqual({
      status: 'validation-failed',
      errors: [{ path: 'exercises', code: 'too_few', message: 'Add at least one exercise.' }],
    });
    expect(planRows()).toHaveLength(0);
    expect(blockRows()).toHaveLength(0);
    expect(setRows()).toHaveLength(0);
  });

  it('rejects invalid field values at their exact paths without a partial write', async () => {
    const result = await planRepository.createPlan(
      planDraft({
        exercises: [
          exercise(),
          exercise({ name: 'Bench', sets: [set({ targetRepsText: '0', targetWeightText: '-1' })] }),
        ],
      }),
      T0,
    );
    expect(result.status).toBe('validation-failed');
    if (result.status === 'validation-failed') {
      expect(result.errors.map((e) => e.path).sort()).toEqual([
        'exercises.1.sets.0.targetReps',
        'exercises.1.sets.0.targetWeight',
      ]);
    }
    expect(planRows()).toHaveLength(0);
    expect(blockRows()).toHaveLength(0);
  });

  it('rejects unknown set types', async () => {
    const result = await planRepository.createPlan(
      planDraft({ exercises: [exercise({ sets: [set({ targetSetType: 'work' as never })] })] }),
      T0,
    );
    expect(result.status).toBe('validation-failed');
    if (result.status === 'validation-failed') {
      expect(result.errors).toEqual([
        { path: 'exercises.0.sets.0.targetSetType', code: 'unknown_set_type', message: expect.any(String) },
      ]);
    }
    expect(planRows()).toHaveLength(0);
  });
});

describe('plan repository — meta, duplicate and delete lifecycle', () => {
  let planId: string;
  let blockId: string;
  let setId: string;

  beforeEach(async () => {
    const created = await planRepository.createPlan(
      planDraft({ exercises: [exercise(), exercise({ name: 'Bench', exerciseDefinitionId: 'def-bench' })] }),
      T0,
    );
    if (created.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(created)}`);
    planId = created.id;
    blockId = blockRows().find((row) => row.name === 'Back Squat')?.id ?? '';
    setId = setRows()[0]?.id ?? '';
  });

  it('updates meta only — block and set rows keep their stamps', async () => {
    const setStampBefore = setRows()[0].localUpdatedAtMs;
    const result = await planRepository.updatePlanMeta(planId, { title: 'Renamed', scheduledFor: T1 }, T1);
    expect(result).toEqual({ status: 'updated' });
    expect(planRows()[0]).toMatchObject({ title: 'Renamed', scheduledFor: T1 });
    expect(setRows()[0].localUpdatedAtMs).toBe(setStampBefore);
  });

  it('refuses an empty title and changes nothing', async () => {
    const result = await planRepository.updatePlanMeta(planId, { title: '   ' }, T1);
    expect(result.status).toBe('validation-failed');
    expect(planRows()[0].title).toBe('Heavy Day');
  });

  it('duplicates authored content under fresh ids, unscheduled by default', async () => {
    const result = await planRepository.duplicatePlan(planId, undefined, T1);
    expect(result).toEqual({ status: 'saved', id: expect.any(String) });
    if (result.status !== 'saved') throw new Error(String(result.status));
    const copies = planRows().filter((row) => row.id !== planId);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ title: 'Heavy Day (copy)', scheduledFor: null, gymId: null });
    const originalBlock = blockRows().find((row) => row.id === blockId);
    expect(originalBlock?.deletedAt).toBeNull();
    // The duplicate's blocks are fresh rows with the same authored values.
    const duplicateBlock = blockRows().find((row) => row.sessionPlanId === copies[0].id);
    expect(duplicateBlock?.id).not.toBe(blockId);
    const originalReps = setRows()
      .filter((row) => row.sessionPlanExerciseId === blockId)
      .map((row) => row.targetReps);
    const duplicateReps = setRows()
      .filter((row) => row.sessionPlanExerciseId === duplicateBlock?.id)
      .map((row) => row.targetReps);
    expect(duplicateReps).toEqual(originalReps);
  });

  it('keeps generated duplicate titles within the title limit when duplicating a long title', async () => {
    const longTitle = 'A'.repeat(100);
    const created = await planRepository.createPlan(
      planDraft({ title: longTitle, exercises: [exercise()] }),
      T0,
    );
    if (created.status !== 'saved') throw new Error(String(created.status));
    const result = await planRepository.duplicatePlan(created.id, undefined, T1);
    expect(result).toEqual({ status: 'saved', id: expect.any(String) });
    if (result.status !== 'saved') throw new Error(String(result.status));
    const duplicate = planRows().find((row) => row.id === result.id);
    expect(duplicate?.title).toBe(`${'A'.repeat(93)} (copy)`);
    expect(duplicate?.title.length).toBe(100);
  });

  it('tombstones the whole graph on delete and hides it from loads', async () => {
    const result = await planRepository.deletePlan(planId, T1);
    expect(result).toEqual({ status: 'updated' });
    expect(await store.loadPlanGraph(planId)).toBeNull();
    expect(planRows().find((row) => row.id === planId)?.deletedAt).not.toBeNull();
    expect(
      blockRows()
        .filter((row) => row.sessionPlanId === planId)
        .every((row) => row.deletedAt !== null),
    ).toBe(true);
    expect(
      setRows()
        .filter((row) => row.sessionPlanExerciseId === blockId)
        .every((row) => row.deletedAt !== null),
    ).toBe(true);
    expect(setId.length).toBeGreaterThan(0);
  });

  it('refuses to delete a plan while a block is attached to a live card', async () => {
    attachBlockToCard(blockId);
    const result = await planRepository.deletePlan(planId, T1);
    expect(result).toEqual({ status: 'immutable-block' });
    expect(livePlanRows().some((row) => row.id === planId)).toBe(true);
  });

  it('refuses to delete a plan while a block is resolved', async () => {
    db()
      .update(sessionPlanExercises)
      .set({ progressStatus: 'completed', resolvedAt: T1 })
      .where(eq(sessionPlanExercises.id, blockId))
      .run();
    const result = await planRepository.deletePlan(planId, T1);
    expect(result).toEqual({ status: 'immutable-block' });
  });

  it('refuses to edit a consumed block but keeps future unattached blocks editable', async () => {
    attachBlockToCard(blockId);
    const attachedResult = await planRepository.updatePlanBlock(blockId, exercise({ name: 'Rewritten' }), T1);
    expect(attachedResult).toEqual({ status: 'immutable-block' });
    expect(blockRows().find((row) => row.id === blockId)?.name).toBe('Back Squat');

    const deleteBlockResult = await planRepository.deletePlanBlock(blockId, T1);
    expect(deleteBlockResult).toEqual({ status: 'immutable-block' });

    const benchId = blockRows().find((row) => row.name === 'Bench')?.id ?? '';
    const futureResult = await planRepository.updatePlanBlock(
      benchId,
      exercise({ name: 'Bench', exerciseDefinitionId: 'def-bench', sets: [set({ targetRepsText: '12' })] }),
      T1,
    );
    expect(futureResult).toEqual({ status: 'updated' });
    const benchSets = setRows().filter(
      (row) => row.sessionPlanExerciseId === benchId && row.deletedAt === null,
    );
    expect(benchSets.map((row) => row.targetReps)).toEqual([12]);
  });

  it('refuses block edits for a resolved block', async () => {
    db()
      .update(sessionPlanExercises)
      .set({ progressStatus: 'skipped', resolvedAt: T1 })
      .where(eq(sessionPlanExercises.id, blockId))
      .run();
    const result = await planRepository.updatePlanBlock(blockId, exercise(), T1);
    expect(result).toEqual({ status: 'immutable-block' });
  });

  it('deletes an edited block whose targets were previously parked as tombstones', async () => {
    const benchId = blockRows().find((row) => row.name === 'Bench')?.id ?? '';
    const editResult = await planRepository.updatePlanBlock(
      benchId,
      exercise({ name: 'Bench Press', exerciseDefinitionId: 'def-bench', sets: [set({ targetRepsText: '10' })] }),
      T1,
    );
    expect(editResult).toEqual({ status: 'updated' });

    const deleteResult = await planRepository.deletePlanBlock(benchId, T1);
    expect(deleteResult).toEqual({ status: 'updated' });
    const benchRow = blockRows().find((row) => row.id === benchId);
    expect(benchRow?.deletedAt).not.toBeNull();
  });

  it('reports not-found for unknown plan and block ids', async () => {
    expect(await planRepository.updatePlanMeta('nope', { title: 'X' }, T1)).toEqual({ status: 'not-found' });
    expect(await planRepository.updatePlanBlock('nope', exercise(), T1)).toEqual({ status: 'not-found' });
    expect(await planRepository.deletePlanBlock('nope', T1)).toEqual({ status: 'not-found' });
    expect(await planRepository.deletePlan('nope', T1)).toEqual({ status: 'not-found' });
  });
});

describe('plan repository — block order', () => {
  let planId: string;

  beforeEach(async () => {
    const created = await planRepository.createPlan(
      planDraft({
        exercises: [
          exercise({ name: 'A' }),
          exercise({ name: 'B' }),
          exercise({ name: 'C', exerciseDefinitionId: 'def-bench' }),
        ],
      }),
      T0,
    );
    if (created.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(created)}`);
    planId = created.id;
  });

  const orderedNames = () =>
    db()
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.sessionPlanId, planId))
      .all()
      .filter((row) => row.deletedAt === null)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((row) => row.name);

  const liveIds = async () => (await store.loadPlanGraph(planId))?.exercises.map((row) => row.id) ?? [];

  it('re-densifies block order across an exact permutation', async () => {
    const ids = await liveIds();
    const result = await planRepository.reorderPlanBlocks(planId, [ids[2], ids[0], ids[1]], T1);
    expect(result).toEqual({ status: 'updated' });
    expect(orderedNames()).toEqual(['C', 'A', 'B']);
  });

  it('survives a parked tombstone: delete the middle block, then reorder', async () => {
    const ids = await liveIds();
    const removed = await planRepository.deletePlanBlock(ids[1], T1);
    expect(removed).toEqual({ status: 'updated' });
    const remaining = await liveIds();
    expect(remaining).toHaveLength(2);
    const result = await planRepository.reorderPlanBlocks(planId, [remaining[1], remaining[0]], T1);
    expect(result).toEqual({ status: 'updated' });
    expect(orderedNames()).toEqual(['C', 'A']);
  });

  it('rejects invalid permutations atomically: duplicate, partial and foreign ids', async () => {
    const ids = await liveIds();
    expect(await planRepository.reorderPlanBlocks(planId, [ids[0], ids[0], ids[2]], T1)).toEqual({
      status: 'invalid-order',
    });
    expect(await planRepository.reorderPlanBlocks(planId, [ids[0], ids[1]], T1)).toEqual({ status: 'invalid-order' });
    expect(await planRepository.reorderPlanBlocks(planId, [ids[0], ids[1], 'foreign'], T1)).toEqual({
      status: 'invalid-order',
    });
    expect(orderedNames()).toEqual(['A', 'B', 'C']);
  });
});

describe('plan repository — target-set order within one block', () => {
  let blockId: string;

  beforeEach(async () => {
    const created = await planRepository.createPlan(
      planDraft({
        exercises: [
          exercise({
            sets: [set({ targetRepsText: '8' }), set({ targetRepsText: '6' }), set({ targetRepsText: '4' })],
          }),
        ],
      }),
      T0,
    );
    if (created.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(created)}`);
    blockId = blockRows()[0].id;
  });

  const repsInOrder = () =>
    setRows()
      .filter((row) => row.sessionPlanExerciseId === blockId && row.deletedAt === null)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((row) => row.targetReps);

  it('reorders target sets by exact permutation', async () => {
    const sets = setRows().filter((row) => row.sessionPlanExerciseId === blockId);
    const result = await planRepository.reorderPlanSets(blockId, [sets[2].id, sets[0].id, sets[1].id], T1);
    expect(result).toEqual({ status: 'updated' });
    expect(repsInOrder()).toEqual([4, 8, 6]);
  });

  it('rejects invalid set permutations without writing', async () => {
    const sets = setRows().filter((row) => row.sessionPlanExerciseId === blockId);
    expect(await planRepository.reorderPlanSets(blockId, [sets[0].id, sets[1].id], T1)).toEqual({
      status: 'invalid-order',
    });
    expect(repsInOrder()).toEqual([8, 6, 4]);
  });

  it('refuses to reorder a consumed block', async () => {
    db()
      .update(sessionPlanExercises)
      .set({ progressStatus: 'completed', resolvedAt: T1 })
      .where(eq(sessionPlanExercises.id, blockId))
      .run();
    const sets = setRows().filter((row) => row.sessionPlanExerciseId === blockId);
    const result = await planRepository.reorderPlanSets(blockId, [sets[1].id, sets[0].id, sets[2].id], T1);
    expect(result).toEqual({ status: 'immutable-block' });
    expect(repsInOrder()).toEqual([8, 6, 4]);
  });
});

describe('programme repository', () => {
  it('creates a programme with ordered child plans', async () => {
    const result = await planRepository.createProgramme(
      {
        name: 'Squat Wave',
        description: '',
        plans: [planDraft({ title: 'Week 1', scheduledFor: T0 }), planDraft({ title: 'Week 2' })],
      },
      T0,
    );
    expect(result).toEqual({ status: 'saved', id: expect.any(String) });
    if (result.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(result)}`);
    const programme = await store.loadProgramme(result.id);
    expect(programme).toMatchObject({ name: 'Squat Wave', description: null, deletedAt: null });
    const graphs = await store.listPlanGraphsByProgramme(result.id);
    expect(graphs.map((graph) => [graph.plan.title, graph.plan.programmeOrderIndex])).toEqual([
      ['Week 1', 0],
      ['Week 2', 1],
    ]);
  });

  it('rejects a one-plan programme without writing', async () => {
    const result = await planRepository.createProgramme(
      { name: 'Too Small', description: '', plans: [planDraft()] },
      T0,
    );
    expect(result.status).toBe('validation-failed');
    expect(planRows()).toHaveLength(0);
    expect(db().select().from(trainingProgrammes).all()).toHaveLength(0);
  });

  it('reorders child plans by exact permutation and rejects invalid lists', async () => {
    const created = await planRepository.createProgramme(
      {
        name: 'Wave',
        description: '',
        plans: [planDraft({ title: 'W1' }), planDraft({ title: 'W2' }), planDraft({ title: 'W3' })],
      },
      T0,
    );
    if (created.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(created)}`);
    const graphs = await store.listPlanGraphsByProgramme(created.id);
    const ids = graphs.map((graph) => graph.plan.id);

    expect(await planRepository.reorderProgrammePlans(created.id, [ids[2], ids[0], ids[1]], T1)).toEqual({
      status: 'updated',
    });
    const reordered = await store.listPlanGraphsByProgramme(created.id);
    expect(reordered.map((graph) => graph.plan.title)).toEqual(['W3', 'W1', 'W2']);

    expect(await planRepository.reorderProgrammePlans(created.id, [ids[0], ids[0]], T1)).toEqual({
      status: 'invalid-order',
    });
  });

  it('deleting the programme detaches its plans as standalone schedules', async () => {
    const created = await planRepository.createProgramme(
      {
        name: 'Wave',
        description: '',
        plans: [planDraft({ title: 'W1', scheduledFor: T0 }), planDraft({ title: 'W2', scheduledFor: T1 })],
      },
      T0,
    );
    if (created.status !== 'saved') throw new Error(`unexpected ${JSON.stringify(created)}`);
    const result = await planRepository.deleteProgramme(created.id, T1);
    expect(result).toEqual({ status: 'updated' });
    expect(await store.loadProgramme(created.id)).toBeNull();
    const plans = planRows();
    expect(plans).toHaveLength(2);
    expect(
      plans.every(
        (row) => row.programmeId === null && row.programmeOrderIndex === null && row.deletedAt === null,
      ),
    ).toBe(true);
    expect(plans.map((row) => row.scheduledFor)).toEqual([T0, T1]);
  });
});
