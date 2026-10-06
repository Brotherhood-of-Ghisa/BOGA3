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
import {
  clearProvenanceClaimsForWirePage,
  collectProvenanceClaimsFromWire,
} from '@/src/data/session-drafts';
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

describe('clearProvenanceClaimsForWirePage', () => {
  it('clears the local block claimant and its block-sourced sets, keeping all user work', async () => {
    seedPlanGraph();
    seedLoser();

    // The winner's page: a pulled card claiming block-1 (its set rows are
    // plain fields the collect step reads provenance from).
    const page = [
      {
        type: 'session_exercises',
        fields: { source_plan_exercise_id: 'block-1' },
      },
    ];
    expect(await clearProvenanceClaimsForWirePage(page, T0)).toBe(true);

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

    const page = [{ type: 'exercise_sets', fields: { source_plan_set_id: 'target-a' } }];
    expect(await clearProvenanceClaimsForWirePage(page, T0)).toBe(true);

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

  it('clears exactly the named claims and reports no-op when the page carries none', async () => {
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
      await clearProvenanceClaimsForWirePage(
        [{ type: 'session_exercises', fields: { source_plan_exercise_id: 'block-1' } }],
        T0,
      ),
    ).toBe(true);
    expect(
      db().select().from(sessionExercises).where(eq(sessionExercises.id, 'card-other')).get()
        ?.sourcePlanExerciseId,
    ).toBe('block-2');

    // A page without provenance claims is a no-op.
    expect(await clearProvenanceClaimsForWirePage([{ type: 'gyms', fields: { name: 'x' } }], T0)).toBe(false);
  });
});

describe('collectProvenanceClaimsFromWire', () => {
  it('collects block and target claims from the page fields, ignoring nulls and other types', () => {
    const claims = collectProvenanceClaimsFromWire([
      { type: 'session_exercises', fields: { source_plan_exercise_id: 'block-1' } },
      { type: 'session_exercises', fields: { source_plan_exercise_id: null } },
      { type: 'exercise_sets', fields: { source_plan_set_id: 'target-a' } },
      { type: 'exercise_sets', fields: { other: 'x' } },
      { type: 'sessions', fields: { source_plan_id: 'plan-1' } },
      { type: 'gyms', fields: { name: 'g' } },
    ]);
    expect(claims.blocks).toEqual(new Set(['block-1']));
    expect(claims.targets).toEqual(new Set(['target-a']));
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
