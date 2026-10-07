/* eslint-disable import/first */

/**
 * Outcome: the provenance arbitration repair (session-planning contract §4.5)
 * is deterministic — the server commits first, so a pulled attachment claim
 * beats any live local claimant. Clearing the losing claims keeps every
 * entered value, manual set, and row identity (the loser keeps its work as
 * unsourced rows), touches only the named claims, and the server's
 * BLOCK_ALREADY_ATTACHED token classifies to its own code before the FK token.
 *
 * Fast lane: pure in-memory SQLite (no endpoint). The full two-device cycle
 * proof over the live server is the sync-infra suite of the same name.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState } from '../helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Imported AFTER the bootstrap mock so the domain code binds to it.
import { __resetClockForTests } from '@/src/data/clock';
import { repairProvenanceForWirePage } from '@/src/data/session-drafts';
import {
  exerciseDefinitions,
  exerciseSets,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
} from '@/src/data/schema';
import { classifyRpcResult } from '@/src/sync/cycle';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-10-05T08:00:00.000Z');

/** One plan with one block carrying two targets. */
const seedPlanGraph = (): void => {
  db().insert(sessionPlans).values({ id: 'plan-1', title: 'P' }).run();
  db()
    .insert(sessionPlanExercises)
    .values({ id: 'block-1', sessionPlanId: 'plan-1', exerciseDefinitionId: 'def-1', orderIndex: 0, name: 'Squat' })
    .run();
  db()
    .insert(sessionPlanSets)
    .values([
      { id: 'target-a', sessionPlanExerciseId: 'block-1', orderIndex: 0, targetReps: 5 },
      { id: 'target-b', sessionPlanExerciseId: 'block-1', orderIndex: 1, targetReps: 8 },
    ])
    .run();
};

/**
 * Seeds the local loser's world: an active session with one dirty card
 * claiming block-1, holding one confirmed source-derived set (target-a) plus
 * the block's second planned target, and one manual warm-up.
 */
const seedLoser = (): string => {
  db().insert(sessions).values({ id: 'sess-1', startedAt: T0 }).run();
  db()
    .insert(sessionExercises)
    .values({
      id: 'card-loser',
      sessionId: 'sess-1',
      exerciseDefinitionId: 'def-1',
      orderIndex: 0,
      name: 'Squat',
      sourcePlanExerciseId: 'block-1',
      localDirty: true,
      // A real monotonic stamp, so an older incoming echo loses LWW.
      localUpdatedAtMs: 1500,
    })
    .run();
  db()
    .insert(exerciseSets)
    .values([
      {
        id: 'set-confirmed',
        sessionExerciseId: 'card-loser',
        orderIndex: 0,
        repsValue: '3',
        weightValue: '90',
        performanceStatus: null,
        sourcePlanSetId: 'target-a',
        localDirty: true,
        localUpdatedAtMs: 1500,
      },
      {
        id: 'set-planned',
        sessionExerciseId: 'card-loser',
        orderIndex: 1,
        repsValue: '',
        weightValue: '',
        performanceStatus: 'planned',
        sourcePlanSetId: 'target-b',
        localDirty: true,
        localUpdatedAtMs: 1500,
      },
      {
        id: 'set-manual',
        sessionExerciseId: 'card-loser',
        orderIndex: 2,
        repsValue: '10',
        weightValue: '20',
        setType: 'warm_up',
        performanceStatus: null,
        sourcePlanSetId: null,
        localDirty: true,
        localUpdatedAtMs: 1500,
      },
    ])
    .run();
  return 'card-loser';
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db().insert(exerciseDefinitions).values({ id: 'def-1', name: 'Squat' }).run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('repairProvenanceForWirePage', () => {
  it('clears the local block claimant and its block-sourced sets, keeping all user work', async () => {
    seedPlanGraph();
    seedLoser();

    // The winner's page row: a pulled card claiming block-1 that will write
    // (its id is absent locally, so its claim arbitrates against the loser).
    const page = [
      {
        type: 'session_exercises',
        id: 'card-winner',
        client_updated_at_ms: 2000,
        fields: { source_plan_exercise_id: 'block-1' },
      },
    ];
    const repaired = await repairProvenanceForWirePage(page, T0);
    expect(repaired).toEqual({ blocks: new Set(['block-1']), targets: new Set() });

    const card = db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-loser')).get();
    expect(card).toMatchObject({ sourcePlanExerciseId: null, localDirty: true });

    const sets = db()
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.sessionExerciseId, 'card-loser'))
      .all();
    expect(sets.map((row) => row.sourcePlanSetId)).toEqual([null, null, null]);
    // Entered work survives untouched.
    expect(sets.map((row) => [row.id, row.repsValue, row.weightValue])).toEqual([
      ['set-confirmed', '3', '90'],
      ['set-planned', '', ''],
      ['set-manual', '10', '20'],
    ]);
    expect(sets[1].performanceStatus).toBe('planned');
    expect(sets[2].setType).toBe('warm_up');
  });

  it('clears a set-level claim only, leaving card provenance and other targets intact', async () => {
    seedPlanGraph();
    seedLoser();

    const page = [
      {
        type: 'exercise_sets',
        id: 'set-winner',
        client_updated_at_ms: 2000,
        fields: { source_plan_set_id: 'target-a' },
      },
    ];
    expect(await repairProvenanceForWirePage(page, T0)).toEqual({
      blocks: new Set(),
      targets: new Set(['target-a']),
    });

    const sets = db()
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.sessionExerciseId, 'card-loser'))
      .all();
    expect(sets.map((row) => row.sourcePlanSetId)).toEqual([null, 'target-b', null]);
    expect(
      db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-loser')).get()
        ?.sourcePlanExerciseId,
    ).toBe('block-1');
  });

  it('skips LWW no-op rows: a self-echo claim never clears a held attachment', async () => {
    seedPlanGraph();
    seedLoser();
    // The device's OWN sourced card echoed back at an OLDER stamp — the local
    // edit is newer, the apply is a no-op, and its claim must not be cleared.
    const ownEcho = [
      {
        type: 'session_exercises',
        id: 'card-loser',
        client_updated_at_ms: 1, // older than the local dirty row's stamp
        fields: { source_plan_exercise_id: 'block-1' },
      },
    ];
    expect(await repairProvenanceForWirePage(ownEcho, T0)).toBeNull();
    expect(
      db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-loser')).get()
        ?.sourcePlanExerciseId,
    ).toBe('block-1');
  });

  it('clears exactly the named claims and reports null when the page carries none', async () => {
    seedPlanGraph();
    seedLoser();
    // A second plan with its own untouched claimant.
    db().insert(sessionPlans).values({ id: 'plan-2', title: 'Q' }).run();
    db()
      .insert(sessionPlanExercises)
      .values({ id: 'block-2', sessionPlanId: 'plan-2', exerciseDefinitionId: 'def-1', orderIndex: 0, name: 'Row' })
      .run();
    db()
      .insert(sessionExercises)
      .values({
        id: 'card-other',
        sessionId: 'sess-1',
        exerciseDefinitionId: 'def-1',
        orderIndex: 1,
        name: 'Row',
        sourcePlanExerciseId: 'block-2',
        localDirty: true,
      })
      .run();

    expect(
      await repairProvenanceForWirePage(
        [
          {
            type: 'session_exercises',
            id: 'card-winner',
            client_updated_at_ms: 2000,
            fields: { source_plan_exercise_id: 'block-1' },
          },
        ],
        T0,
      ),
    ).toEqual({ blocks: new Set(['block-1']), targets: new Set() });
    expect(
      db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-other')).get()
        ?.sourcePlanExerciseId,
    ).toBe('block-2');

    // A page without provenance claims is a no-op.
    expect(
      await repairProvenanceForWirePage([{ type: 'gyms', id: 'g-1', client_updated_at_ms: 1, fields: { name: 'x' } }], T0),
    ).toBeNull();
  });

  it('excludes same-row updates from arbitration clearing when page carries competing attachment', async () => {
    seedPlanGraph();
    seedLoser();

    // A second plan block and an already-local card claiming it.
    db().insert(sessionPlans).values({ id: 'plan-2', title: 'Q' }).run();
    db()
      .insert(sessionPlanExercises)
      .values({ id: 'block-2', sessionPlanId: 'plan-2', exerciseDefinitionId: 'def-1', orderIndex: 0, name: 'Bench' })
      .run();
    db()
      .insert(sessionPlanSets)
      .values({ id: 'target-c', sessionPlanExerciseId: 'block-2', orderIndex: 0, targetReps: 10 })
      .run();
    db()
      .insert(sessionExercises)
      .values({
        id: 'card-unrelated',
        sessionId: 'sess-1',
        exerciseDefinitionId: 'def-1',
        orderIndex: 1,
        name: 'Old Name',
        sourcePlanExerciseId: 'block-2',
        localDirty: false,
        localUpdatedAtMs: 1500,
      })
      .run();
    db()
      .insert(exerciseSets)
      .values({
        id: 'set-unrelated',
        sessionExerciseId: 'card-unrelated',
        orderIndex: 0,
        repsValue: '10',
        weightValue: '50',
        sourcePlanSetId: 'target-c',
        localDirty: false,
        localUpdatedAtMs: 1500,
      })
      .run();

    // The wire page contains:
    // 1. One actual competing attachment (competing for block-1 against card-loser)
    // 2. An unrelated newer update to card-unrelated and set-unrelated
    const page = [
      {
        type: 'session_exercises',
        id: 'card-winner',
        client_updated_at_ms: 2000,
        fields: { source_plan_exercise_id: 'block-1' },
      },
      {
        type: 'session_exercises',
        id: 'card-unrelated',
        client_updated_at_ms: 2000,
        fields: { name: 'New Name', source_plan_exercise_id: 'block-2' },
      },
      {
        type: 'exercise_sets',
        id: 'set-unrelated',
        client_updated_at_ms: 2000,
        fields: { reps_value: '12', source_plan_set_id: 'target-c' },
      },
    ];

    const repaired = await repairProvenanceForWirePage(page, T0);
    // Only the conflicting block-1 claim should be repaired; block-2 / target-c must not be touched.
    expect(repaired).toEqual({ blocks: new Set(['block-1']), targets: new Set() });

    // card-loser was repaired/cleared
    const loser = db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-loser')).get();
    expect(loser?.sourcePlanExerciseId).toBeNull();
    expect(loser?.localDirty).toBe(true);

    // card-unrelated and set-unrelated retained their provenance links and local timestamp was not bumped
    const unrelatedCard = db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-unrelated')).get();
    expect(unrelatedCard?.sourcePlanExerciseId).toBe('block-2');
    expect(unrelatedCard?.localUpdatedAtMs).toBe(1500);
    expect(unrelatedCard?.localDirty).toBe(false);

    const unrelatedSet = db().select().from(exerciseSets).where(eq(exerciseSets.id, 'set-unrelated')).get();
    expect(unrelatedSet?.sourcePlanSetId).toBe('target-c');
    expect(unrelatedSet?.localUpdatedAtMs).toBe(1500);
    expect(unrelatedSet?.localDirty).toBe(false);
  });
});

describe('classifyRpcResult — arbitration token', () => {
  it('classifies the server BLOCK_ALREADY_ATTACHED message before the FK token', () => {
    expect(
      classifyRpcResult(
        {
          message:
            'BLOCK_ALREADY_ATTACHED: duplicate key value violates unique constraint "session_exercises_owner_source_block_unique"',
        },
        null,
      ),
    ).toBe('BLOCK_ALREADY_ATTACHED');
  });

  it('still classifies a plain FK_VIOLATION as FK_VIOLATION', () => {
    expect(classifyRpcResult({ message: 'FK_VIOLATION: insert into sessions violates fk' }, null)).toBe(
      'FK_VIOLATION',
    );
  });
});
