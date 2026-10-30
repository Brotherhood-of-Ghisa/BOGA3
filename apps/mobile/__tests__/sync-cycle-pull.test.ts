/**
 * Pull-leg coverage for the sync cycle: per-row last-write-wins on apply
 * (insert-when-absent, incoming-wins, incoming-loses), whole-page rollback when
 * a row violates a foreign key, and cursor advance only after a successful page
 * commit.
 *
 * Driver: a real in-memory better-sqlite3 database with the full migrated
 * schema applied. FK enforcement is toggled per test.
 */

import { eq } from 'drizzle-orm';

import {
  applyPullPage,
  createPullDrainTracker,
  finalizePullDrain,
  readPendingProvisionalMoves,
  writeCursorAndPendingMoves,
  selectPushBatch,
  BATCH_CAP,
  type WireEntity,
} from '@/src/sync/cycle';
import {
  __resetClockForTests,
  nowMonotonic,
  PRIMARY_RUNTIME_STATE_ID,
  type Transaction,
} from '@/src/data/clock';
import {
  exerciseDefinitions,
  gyms,
  muscleGroups,
  sessionPlanExercises,
  sessionPlanSets,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

afterEach(() => {
  fixture.close();
});

const gymWire = (id: string, ms: number, name: string): WireEntity => ({
  type: 'gyms',
  id,
  client_updated_at_ms: ms,
  fields: {
    name,
    latitude: null,
    longitude: null,
    coordinate_accuracy_m: null,
    coordinates_updated_at: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

describe('applyPullPage last-write-wins', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  it('inserts a row that is absent locally and lands it clean', () => {
    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [gymWire('gym-1', 100, 'Iron Temple')], 'gyms'),
    );
    // An insert is a real local change, so it counts toward convergence motion.
    expect(changed).toBe(1);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Iron Temple');
    expect(row?.localDirty).toBe(false);
    expect(row?.localUpdatedAtMs).toBe(100);
  });

  it('overwrites a local row when the incoming timestamp is strictly newer', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Old', localDirty: true, localUpdatedAtMs: 100 }).run();

    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'New')], 'gyms'),
    );
    // Incoming wins and overwrites the row — a real change.
    expect(changed).toBe(1);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('New');
    expect(row?.localDirty).toBe(false);
    expect(row?.localUpdatedAtMs).toBe(200);
  });

  it('no-ops when the incoming timestamp is older-or-equal and keeps the row dirty', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Local Newer', localDirty: true, localUpdatedAtMs: 300 }).run();

    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'Server Stale')], 'gyms'),
    );
    // The local edit is newer: nothing is written, so this contributes no motion
    // (a round of only such no-ops is quiet).
    expect(changed).toBe(0);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Local Newer');
    // The local edit is newer, so the dirty bit stays set for the next push.
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs).toBe(300);
  });

  it('treats an equal timestamp as incoming-loses (no clear of the dirty bit)', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Local', localDirty: true, localUpdatedAtMs: 200 }).run();

    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'Server')], 'gyms'),
    );
    // Equal timestamp is incoming-loses: a no-op that counts no motion.
    expect(changed).toBe(0);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Local');
    expect(row?.localDirty).toBe(true);
  });

  it('applies an incoming soft delete as a normal LWW column write', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Live', localDirty: false, localUpdatedAtMs: 100 }).run();
    const deletePage = gymWire('gym-1', 200, 'Live');
    deletePage.fields.deleted_at = 250;

    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [deletePage], 'gyms'),
    );
    // A tombstone arriving as incoming-wins is a normal LWW write — one change.
    expect(changed).toBe(1);

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.deletedAt?.getTime()).toBe(250);
  });
});

const muscleWire = (ms: number, setup?: { report_group: string | null; tracked: number }): WireEntity => ({
  type: 'muscle_groups',
  id: 'back_lats',
  client_updated_at_ms: ms,
  fields: {
    display_name: 'Lats',
    family_name: 'Back',
    sort_order: 7,
    is_editable: 0,
    ...setup,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const readMuscleSetup = () =>
  database
    .select({ reportGroup: muscleGroups.reportGroup, tracked: muscleGroups.tracked })
    .from(muscleGroups)
    .where(eq(muscleGroups.id, 'back_lats'))
    .get();

describe('applyPullPage carries the muscle report group and tracked flag', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  it('writes both columns on insert and on an incoming-wins update', () => {
    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [muscleWire(100, { report_group: 'back', tracked: 0 })], 'muscle_groups'),
    );
    expect(readMuscleSetup()).toEqual({ reportGroup: 'back', tracked: 0 });

    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [muscleWire(200, { report_group: null, tracked: 1 })], 'muscle_groups'),
    );
    expect(readMuscleSetup()).toEqual({ reportGroup: null, tracked: 1 });
  });

  it('keeps the local values when a newer envelope omits both keys', () => {
    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [muscleWire(100, { report_group: 'back', tracked: 0 })], 'muscle_groups'),
    );
    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [muscleWire(200)], 'muscle_groups'),
    );
    expect(changed).toBe(1);
    expect(readMuscleSetup()).toEqual({ reportGroup: 'back', tracked: 0 });
  });

  it('inserts the column defaults when a new row arrives without either key', () => {
    database.transaction((tx) => applyPullPage(tx as Transaction, [muscleWire(100)], 'muscle_groups'));
    expect(readMuscleSetup()).toEqual({ reportGroup: null, tracked: 1 });
  });
});

const exerciseWire = (ms: number, restTimer?: { rest_timer_sec: number | null }): WireEntity => ({
  type: 'exercise_definitions',
  id: 'bench',
  client_updated_at_ms: ms,
  fields: {
    name: 'Bench Press',
    load_input_mode: 'total_load',
    bodyweight_contribution: 0,
    split_by_gym: false,
    ...restTimer,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const readRestTimerSec = () =>
  database
    .select({ restTimerSec: exerciseDefinitions.restTimerSec })
    .from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.id, 'bench'))
    .get()?.restTimerSec;

describe('applyPullPage carries the exercise rest timer', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  it('writes the value on insert, and an incoming null clears it', () => {
    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [exerciseWire(100, { rest_timer_sec: 120 })], 'exercise_definitions'),
    );
    expect(readRestTimerSec()).toBe(120);

    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [exerciseWire(200, { rest_timer_sec: null })], 'exercise_definitions'),
    );
    expect(readRestTimerSec()).toBeNull();
  });

  it('keeps the local value when a newer envelope omits the key', () => {
    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [exerciseWire(100, { rest_timer_sec: 120 })], 'exercise_definitions'),
    );
    const changed = database.transaction((tx) =>
      applyPullPage(tx as Transaction, [exerciseWire(200)], 'exercise_definitions'),
    );
    expect(changed).toBe(1);
    expect(readRestTimerSec()).toBe(120);
  });

  it('stores null (the global timer) when a new row arrives without the key', () => {
    database.transaction((tx) => applyPullPage(tx as Transaction, [exerciseWire(100)], 'exercise_definitions'));
    expect(readRestTimerSec()).toBeNull();
  });
});

describe('applyPullPage advances the local clock past pulled stamps', () => {
  beforeEach(() => {
    __resetClockForTests();
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  afterEach(() => {
    __resetClockForTests();
  });

  it('stamps the next local edit above a pulled row written ahead of this device clock', () => {
    // A server-side (agent) write or a fast-clock device stamps a row ahead of
    // this device's wall clock. The next local edit must out-stamp it, or the
    // server's LWW would silently drop that edit.
    const ahead = Date.now() + 60_000;
    database.transaction((tx) =>
      applyPullPage(tx as Transaction, [gymWire('gym-1', ahead, 'Agent')], 'gyms'),
    );

    const nextLocal = database.transaction((tx) => nowMonotonic(tx as Transaction));
    expect(nextLocal).toBeGreaterThan(ahead);
  });

  it('also observes the stamp of a pulled row that loses LWW locally', () => {
    const ahead = Date.now() + 60_000;
    database
      .insert(gyms)
      .values({ id: 'gym-1', name: 'Local', localDirty: true, localUpdatedAtMs: ahead + 10 })
      .run();
    // The losing row carries the page's newest stamp; the applied one is older.
    database.transaction((tx) =>
      applyPullPage(
        tx as Transaction,
        [gymWire('gym-2', ahead - 30_000, 'Remote'), gymWire('gym-1', ahead, 'Old')],
        'gyms',
      ),
    );

    const nextLocal = database.transaction((tx) => nowMonotonic(tx as Transaction));
    expect(nextLocal).toBeGreaterThan(ahead);
  });

  it('rejects a page whose stamp is not an integer instead of stamping local edits with it', () => {
    // An existing row makes the NaN lose LWW silently; only the clock sees it.
    database.insert(gyms).values({ id: 'gym-1', name: 'Local', localDirty: false, localUpdatedAtMs: 100 }).run();
    const malformed = { ...gymWire('gym-1', 100, 'Bad'), client_updated_at_ms: Number.NaN };
    expect(() =>
      database.transaction((tx) => applyPullPage(tx as Transaction, [malformed], 'gyms')),
    ).toThrow('Pulled client_updated_at_ms is not an integer: NaN');
    __resetClockForTests();
    expect(Number.isSafeInteger(database.transaction((tx) => nowMonotonic(tx as Transaction)))).toBe(true);
  });
});

describe('applyPullPage page atomicity under FK enforcement', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
  });

  it('rolls the whole page back when a row violates a foreign key', () => {
    // A session referencing a non-existent gym fails the FK check. Because the
    // whole page applies in one transaction, the valid row alongside it must
    // also roll back.
    const validSession: WireEntity = {
      type: 'sessions',
      id: 'sess-ok',
      client_updated_at_ms: 100,
      fields: {
        gym_id: null,
        status: 'active',
        started_at: 100,
        completed_at: null,
        duration_sec: null,
        created_at: 100,
        updated_at: 100,
        deleted_at: null,
      },
    };
    const orphanSession: WireEntity = {
      ...validSession,
      id: 'sess-orphan',
      fields: { ...validSession.fields, gym_id: 'gym-does-not-exist' },
    };

    expect(() => {
      database.transaction((tx) => {
        applyPullPage(tx as Transaction, [validSession, orphanSession], 'sessions');
      });
    }).toThrow();

    // Neither row landed: the page rolled back as a unit.
    expect(database.select().from(sessions).all()).toHaveLength(0);
  });
});

describe('pull cursor advances only after a committed page', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  const readCursorJson = (): Record<string, unknown> => {
    const row = database
      .select({ pullCursor: syncRuntimeState.pullCursor })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    const raw = row?.pullCursor;
    if (!raw) {
      return {};
    }
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  };

  it('does not persist the cursor when the page apply throws', () => {
    fixture.close();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;

    const orphan: WireEntity = {
      type: 'sessions',
      id: 'sess-orphan',
      client_updated_at_ms: 100,
      fields: {
        gym_id: 'missing',
        status: 'active',
        started_at: 100,
        completed_at: null,
        duration_sec: null,
        created_at: 100,
        updated_at: 100,
        deleted_at: null,
      },
    };

    expect(() => {
      database.transaction((tx) => {
        const transaction = tx as Transaction;
        applyPullPage(transaction, [orphan], 'sessions');
        // Cursor write is in the same transaction; it must roll back too.
        transaction
          .insert(syncRuntimeState)
          .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: { '1': { server_received_at: 'x' } } as never })
          .onConflictDoUpdate({
            target: syncRuntimeState.id,
            set: { pullCursor: { '1': { server_received_at: 'x' } } as never },
          })
          .run();
      });
    }).toThrow();

    expect(readCursorJson()).toEqual({});
  });

  it('persists the cursor in the same transaction as a clean page apply', () => {
    database.transaction((tx) => {
      const transaction = tx as Transaction;
      applyPullPage(transaction, [gymWire('gym-1', 100, 'Iron Temple')], 'gyms');
      const cursor = { server_received_at: '2026-05-29T10:00:00.000Z', owner_user_id: 'u', type: 'gyms', id: 'gym-1' };
      transaction
        .insert(syncRuntimeState)
        .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: { '0': cursor } as never })
        .onConflictDoUpdate({
          target: syncRuntimeState.id,
          set: { pullCursor: { '0': cursor } as never },
        })
        .run();
    });

    expect(readCursorJson()).toMatchObject({ '0': { type: 'gyms', id: 'gym-1' } });
    expect(database.select().from(gyms).all()).toHaveLength(1);
  });
});

describe('applyPullPage collision-safe order application and tombstone parking', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  const planWire = (id: string, ms: number, title: string): WireEntity => ({
    type: 'session_plans',
    id,
    client_updated_at_ms: ms,
    fields: {
      programme_id: null,
      programme_order_index: null,
      gym_id: null,
      title,
      scheduled_for: null,
      provenance: 'agent',
      last_modified_by: 'agent',
      created_at: ms,
      updated_at: ms,
      deleted_at: null,
    },
  });

  const blockWire = (
    id: string,
    planId: string,
    orderIndex: number,
    ms: number,
    deletedAt: number | null = null,
  ): WireEntity => ({
    type: 'session_plan_exercises',
    id,
    client_updated_at_ms: ms,
    fields: {
      session_plan_id: planId,
      exercise_definition_id: null,
      order_index: orderIndex,
      name: `Block ${id}`,
      progress_status: 'pending',
      resolved_at: null,
      last_modified_by: 'agent',
      created_at: ms,
      updated_at: ms,
      deleted_at: deletedAt,
    },
  });

  const setWire = (
    id: string,
    blockId: string,
    orderIndex: number,
    ms: number,
    deletedAt: number | null = null,
  ): WireEntity => ({
    type: 'session_plan_sets',
    id,
    client_updated_at_ms: ms,
    fields: {
      session_plan_exercise_id: blockId,
      order_index: orderIndex,
      target_weight_value: null,
      target_reps: 10,
      target_set_type: null,
      last_modified_by: 'agent',
      created_at: ms,
      updated_at: ms,
      deleted_at: deletedAt,
    },
  });

  it('handles collision-safe block reordering on an already populated store', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Push Day')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-a', 'plan-1', 0, 100),
          blockWire('block-b', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    // Server reorders to [B, A], so B is now 0 and A is 1
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-b', 'plan-1', 0, 200),
          blockWire('block-a', 'plan-1', 1, 200),
        ],
        'session_plan_exercises',
      );
    });

    const b = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();
    const a = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(b?.orderIndex).toBe(0);
    expect(a?.orderIndex).toBe(1);
  });

  it('handles block tombstone parking above occupied slots on populated and wiped stores', () => {
    // Populated store: A at 0, B at 1
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Pull Day')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-a', 'plan-1', 0, 100),
          blockWire('block-b', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    // Server tombstones A (parked at 2000000) and redensifies B to 0
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-b', 'plan-1', 0, 200),
          blockWire('block-a', 'plan-1', 2_000_000, 200, 200),
        ],
        'session_plan_exercises',
      );
    });

    const b = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();
    const a = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(b?.orderIndex).toBe(0);
    expect(a?.orderIndex).toBe(2_000_000);
    expect(a?.deletedAt).not.toBeNull();

    // Wiped (fresh restore) store: apply both rows from scratch
    const freshFixture = createInMemoryDatabase();
    freshFixture.database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Pull Day')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-a', 'plan-1', 2_000_000, 200, 200),
          blockWire('block-b', 'plan-1', 0, 200),
        ],
        'session_plan_exercises',
      );
    });
    const freshA = freshFixture.database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    const freshB = freshFixture.database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();
    expect(freshA?.orderIndex).toBe(2_000_000);
    expect(freshB?.orderIndex).toBe(0);
    freshFixture.close();
  });

  it('handles collision-safe set reordering and set tombstone parking', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Legs')], 'session_plans');
      applyPullPage(tx as Transaction, [blockWire('block-1', 'plan-1', 0, 100)], 'session_plan_exercises');
      applyPullPage(
        tx as Transaction,
        [
          setWire('set-1', 'block-1', 0, 100),
          setWire('set-2', 'block-1', 1, 100),
        ],
        'session_plan_sets',
      );
    });

    // Swapped order
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          setWire('set-2', 'block-1', 0, 200),
          setWire('set-1', 'block-1', 1, 200),
        ],
        'session_plan_sets',
      );
    });
    const s2 = database.select().from(sessionPlanSets).where(eq(sessionPlanSets.id, 'set-2')).get();
    const s1 = database.select().from(sessionPlanSets).where(eq(sessionPlanSets.id, 'set-1')).get();
    expect(s2?.orderIndex).toBe(0);
    expect(s1?.orderIndex).toBe(1);

    // Set 1 tombstoned and parked at 2000000
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          setWire('set-1', 'block-1', 2_000_000, 300, 300),
          setWire('set-2', 'block-1', 0, 300),
        ],
        'session_plan_sets',
      );
    });
    const s1Dead = database.select().from(sessionPlanSets).where(eq(sessionPlanSets.id, 'set-1')).get();
    expect(s1Dead?.orderIndex).toBe(2_000_000);
    expect(s1Dead?.deletedAt).not.toBeNull();
  });

  it('preserves local newer dirty row and repairs colliding incoming slot with monotonic timestamp', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Legs')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-a', 'plan-1', 0, 100),
          blockWire('block-b', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    // Simulate local dirty edit on block-a at timestamp 300
    database
      .update(sessionPlanExercises)
      .set({ localDirty: true, localUpdatedAtMs: 300, name: 'Local Edited Squat' })
      .where(eq(sessionPlanExercises.id, 'block-a'))
      .run();

    // Server sends reorder generated at timestamp 200: B -> 0, A -> 1
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-b', 'plan-1', 0, 200),
          blockWire('block-a', 'plan-1', 1, 200),
        ],
        'session_plan_exercises',
      );
    });

    const a = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    const b = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();

    // Local winner A must retain its slot 0, dirty bit, and timestamp 300
    expect(a?.orderIndex).toBe(0);
    expect(a?.localDirty).toBeTruthy();
    expect(a?.localUpdatedAtMs).toBe(300);
    expect(a?.name).toBe('Local Edited Squat');

    // Colliding incoming B must be conflict-repaired to slot 1 with dirty bit and fresh monotonic clock
    expect(b?.orderIndex).toBe(1);
    expect(b?.localDirty).toBeTruthy();
    expect(Number(b?.localUpdatedAtMs)).toBeGreaterThan(300);

    // No rows left in scratch band
    const all = database.select().from(sessionPlanExercises).all();
    for (const row of all) {
      expect(row.orderIndex).toBeLessThan(5_000_000);
    }
  });

  it('preserves local equal row on slot collision and conflict-repairs incoming row', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Legs')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [blockWire('block-a', 'plan-1', 0, 200)],
        'session_plan_exercises',
      );
    });

    // Local block-a is at slot 0 with timestamp 200
    database
      .update(sessionPlanExercises)
      .set({ localDirty: true, localUpdatedAtMs: 200 })
      .where(eq(sessionPlanExercises.id, 'block-a'))
      .run();

    // Incoming new block-b also arrives claiming slot 0 with equal timestamp 200
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-b', 'plan-1', 0, 200)],
        'session_plan_exercises',
      );
    });

    const a = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    const b = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();

    expect(a?.orderIndex).toBe(0);
    expect(b?.orderIndex).toBe(1);
    expect(b?.localDirty).toBeTruthy();
    expect(Number(b?.localUpdatedAtMs)).toBeGreaterThan(200);
  });

  it('handles split-page pull without leaving temporary scratch slots across cycles', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Push')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-a', 'plan-1', 0, 100),
          blockWire('block-b', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    const tracker = createPullDrainTracker();

    // Page 1 arrives with ONLY block-b moved to slot 0 at timestamp 200 (block-a split to next page)
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-b', 'plan-1', 0, 200)],
        'session_plan_exercises',
        tracker,
      );
    });

    const bAfterPage1 = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();
    const aAfterPage1 = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();

    // B took slot 0; displaced A is at safe non-colliding slot 1 (NOT in scratch)
    expect(bAfterPage1?.orderIndex).toBe(0);
    expect(aAfterPage1?.orderIndex).toBe(1);
    expect(aAfterPage1?.orderIndex).toBeLessThan(5_000_000);

    // Page 2 arrives with block-a at slot 1
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-a', 'plan-1', 1, 200)],
        'session_plan_exercises',
        tracker,
      );
      finalizePullDrain(tx as Transaction, tracker);
    });

    const bFinal = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-b')).get();
    const aFinal = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();

    expect(bFinal?.orderIndex).toBe(0);
    expect(aFinal?.orderIndex).toBe(1);
    expect(aFinal?.localDirty).toBeFalsy();
    expect(bFinal?.localDirty).toBeFalsy();
  });

  it('persists unresolved clean-sibling repair when displaced row is omitted from subsequent pages', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Push')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-0', 'plan-1', 0, 100),
          blockWire('block-a', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    const tracker = createPullDrainTracker();

    // Page 1: incoming block-b claims slot 1 at timestamp 200 (displaces clean block-a)
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-b', 'plan-1', 1, 200)],
        'session_plan_exercises',
        tracker,
      );
    });

    const aMid = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(aMid?.orderIndex).toBe(2);
    // Still provisionally clean mid-drain
    expect(aMid?.localDirty).toBeFalsy();
    expect(aMid?.localUpdatedAtMs).toBe(100);

    // Page 2: another block arrives; block-a is omitted from all later pages
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-c', 'plan-1', 3, 200)],
        'session_plan_exercises',
        tracker,
      );
    });

    // Drain finishes: finalize unresolved repairs
    database.transaction((tx) => {
      finalizePullDrain(tx as Transaction, tracker);
    });

    const aFinal = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(aFinal?.orderIndex).toBe(2);
    expect(aFinal?.localDirty).toBeTruthy();
    expect(Number(aFinal?.localUpdatedAtMs)).toBeGreaterThan(200);

    // Push leg selection picks up the repaired row
    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));
    const pushedA = batch.find((entity) => entity.id === 'block-a');
    expect(pushedA).toBeDefined();
    expect(pushedA?.fields.order_index).toBe(2);
    expect(pushedA?.client_updated_at_ms).toBe(Number(aFinal?.localUpdatedAtMs));
  });

  it('advances monotonic clock before ordered reconciliation so repairs beat future remote timestamps', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Legs')], 'session_plans');
    });

    const futureStamp = Date.now() + 120_000;

    // Two colliding incoming blocks at slot 0 with futureStamp
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-x', 'plan-1', 0, futureStamp),
          blockWire('block-y', 'plan-1', 0, futureStamp),
        ],
        'session_plan_exercises',
      );
    });

    const x = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-x')).get();
    const y = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-y')).get();

    const winner = x?.orderIndex === 0 ? x : y;
    const loser = x?.orderIndex === 1 ? x : y;

    expect(winner?.orderIndex).toBe(0);
    expect(winner?.localDirty).toBeFalsy();
    expect(winner?.localUpdatedAtMs).toBe(futureStamp);

    expect(loser?.orderIndex).toBe(1);
    expect(loser?.localDirty).toBeTruthy();
    // Repair timestamp must strictly exceed the future incoming timestamp
    expect(Number(loser?.localUpdatedAtMs)).toBeGreaterThan(futureStamp);

    // Push batch assertion: the repaired losing row is selected with client_updated_at_ms > futureStamp
    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));
    const pushedLoser = batch.find((entity) => entity.id === loser?.id);
    expect(pushedLoser).toBeDefined();
    expect(pushedLoser?.fields.order_index).toBe(1);
    expect(pushedLoser?.client_updated_at_ms).toBeGreaterThan(futureStamp);

    // Pull assertion: a subsequent pull of the loser with the older futureStamp loses to local repair
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire(loser!.id, 'plan-1', 0, futureStamp)],
        'session_plan_exercises',
      );
    });

    const loserAfterPull = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, loser!.id)).get();
    expect(loserAfterPull?.orderIndex).toBe(1);
    expect(loserAfterPull?.localDirty).toBeTruthy();
    expect(loserAfterPull?.localUpdatedAtMs).toBe(loser?.localUpdatedAtMs);
  });

  it('persists pending provisional moves atomically with cursor across network failure and process restart', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [planWire('plan-1', 100, 'Legs')], 'session_plans');
      applyPullPage(
        tx as Transaction,
        [
          blockWire('block-0', 'plan-1', 0, 100),
          blockWire('block-a', 'plan-1', 1, 100),
        ],
        'session_plan_exercises',
      );
    });

    const tracker1 = createPullDrainTracker();

    // Page 1 arrives: block-b arrives at slot 1 (displacing clean block-a to slot 2)
    database.transaction((tx) => {
      applyPullPage(
        tx as Transaction,
        [blockWire('block-b', 'plan-1', 1, 200)],
        'session_plan_exercises',
        tracker1,
      );
      // Persist cursor and pending moves atomically with page 1
      writeCursorAndPendingMoves(
        tx as Transaction,
        2,
        { server_received_at: '2026-10-28T10:00:00Z', owner_user_id: 'u1', type: 'session_plan_exercises', id: 'block-b' },
        Array.from(tracker1.provisionalMoves.values()),
      );
    });

    // Verify pending move is persisted in SQLite
    const persistedBeforeCrash = database.transaction((tx) => readPendingProvisionalMoves(tx as Transaction));
    expect(persistedBeforeCrash).toHaveLength(1);
    expect(persistedBeforeCrash[0].id).toBe('block-a');
    expect(persistedBeforeCrash[0].type).toBe('session_plan_exercises');

    // Simulate network drop on Page 2 and process restart
    __resetClockForTests();

    // Next cycle / process restart: create fresh tracker and restore persisted moves from SQLite
    const tracker2 = createPullDrainTracker();
    const restored = database.transaction((tx) => readPendingProvisionalMoves(tx as Transaction));
    for (const move of restored) {
      tracker2.provisionalMoves.set(move.id, move);
    }
    expect(tracker2.provisionalMoves.has('block-a')).toBe(true);

    // Case 1: Page 2 does NOT deliver block-a; drain finishes
    database.transaction((tx) => {
      finalizePullDrain(tx as Transaction, tracker2);
    });

    const aFinal = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(aFinal?.orderIndex).toBe(2);
    expect(aFinal?.localDirty).toBeTruthy();
    expect(Number(aFinal?.localUpdatedAtMs)).toBeGreaterThan(200);

    // Persisted moves are cleared on finalization
    const persistedAfterFinalize = database.transaction((tx) => readPendingProvisionalMoves(tx as Transaction));
    expect(persistedAfterFinalize).toHaveLength(0);

    // Case 2: Verify later-page arrival preserves LWW when server delivers block-a
    const futureServerStamp = Number(aFinal!.localUpdatedAtMs) + 100;
    database.transaction((tx) => {
      // Server delivers block-a at slot 2 with timestamp > aFinal timestamp
      applyPullPage(
        tx as Transaction,
        [blockWire('block-a', 'plan-1', 2, futureServerStamp)],
        'session_plan_exercises',
      );
    });

    const aLww = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'block-a')).get();
    expect(aLww?.orderIndex).toBe(2);
    expect(aLww?.localDirty).toBeFalsy();
    expect(aLww?.localUpdatedAtMs).toBe(futureServerStamp);
  });
});
