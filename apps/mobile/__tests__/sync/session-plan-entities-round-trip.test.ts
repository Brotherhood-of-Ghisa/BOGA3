/**
 * Outcome: the four M23 planning entities and the three performed-domain
 * provenance links are first-class synced data — they serialise onto the wire,
 * drain in FK-safe layer order, and survive a wiped/reinstalled client with
 * every reference (programme order, plan→block→target chain, and
 * session→card→set provenance) intact.
 *
 * This is the deep-chain analogue of the muscle-groups anti-brick test: the new
 * chain is five layers deep (training_programmes L0 → session_plans L1 →
 * sessions/session_plan_exercises L2 → session_exercises/session_plan_sets L3 →
 * exercise_sets L4), so a wrong layer mapping would surface as a local FK
 * violation on reinstall. FKs are enforced on the in-memory store, exactly as
 * the app enables them at boot.
 */

import { eq } from 'drizzle-orm';

import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseSets,
  gyms,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
  syncRuntimeState,
  trainingProgrammes,
} from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';
import { TOPO_LAYERS, type EntityTableName } from '@/src/sync/topo-order';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockRpc = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) throw new Error('Test database not initialised');
    return mockBootstrapState.database;
  }),
}));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));

interface StubServer {
  rpc: jest.Mock;
  pullObservationOrder: string[];
  count: (type: EntityTableName) => number;
}

const LAYER_OF: Record<string, number> = {};
TOPO_LAYERS.forEach((layer, index) => {
  for (const type of layer) LAYER_OF[type] = index;
});

const createStubServer = (): StubServer => {
  const store = new Map<string, Map<string, WireEntity>>();
  const observed = new Set<string>();
  const pullObservationOrder: string[] = [];

  const rpc = jest.fn(async (name: string, args: { layer?: number; entities?: WireEntity[] }) => {
    if (name === 'sync_push') {
      for (const entity of args.entities ?? []) {
        const bucket = store.get(entity.type) ?? new Map<string, WireEntity>();
        const existing = bucket.get(entity.id);
        if (!existing || entity.client_updated_at_ms >= existing.client_updated_at_ms) {
          bucket.set(entity.id, entity);
        }
        store.set(entity.type, bucket);
      }
      return { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };
    }

    const layer = args.layer ?? 0;
    const entities: WireEntity[] = [];
    for (const type of (TOPO_LAYERS[layer] ?? []) as readonly string[]) {
      for (const envelope of store.get(type)?.values() ?? []) {
        entities.push(envelope);
        if (!observed.has(type)) {
          observed.add(type);
          pullObservationOrder.push(type);
        }
      }
    }
    return { data: { entities, next_cursor: null, has_more: false }, error: null };
  });

  return { rpc, pullObservationOrder, count: (type) => store.get(type)?.size ?? 0 };
};

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockRpc.mockReset();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const reinstallLocalStore = (): void => {
  fixture.close();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
};

const markBootstrapDone = (): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: new Date(1_700_000_000_000) },
    })
    .run();
};

/** Seeds a whole-plan-start graph with full source provenance, all dirty. */
const seedDirtyPlanGraph = (db: InMemoryTestDatabase): void => {
  const ms = Date.now();
  let n = 0;
  const stamp = () => ms + ++n;

  db.insert(gyms).values({ id: 'gym-plan', name: 'Iron Temple', localDirty: true, localUpdatedAtMs: stamp() }).run();
  db.insert(exerciseDefinitions).values({ id: 'def-squat', name: 'Squat', localDirty: true, localUpdatedAtMs: stamp() }).run();
  db.insert(trainingProgrammes)
    .values({ id: 'tp-1', name: 'Squat Wave', description: 'Six weeks', localDirty: true, localUpdatedAtMs: stamp() })
    .run();
  db.insert(sessionPlans)
    .values({
      id: 'sp-1',
      programmeId: 'tp-1',
      programmeOrderIndex: 0,
      gymId: 'gym-plan',
      title: 'Day 1',
      scheduledFor: new Date('2026-06-01T08:00:00.000Z'),
      provenance: 'human',
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
  db.insert(sessionPlanExercises)
    .values({
      id: 'spe-1',
      sessionPlanId: 'sp-1',
      exerciseDefinitionId: 'def-squat',
      orderIndex: 0,
      name: 'Squat',
      machineName: 'Rack',
      progressStatus: 'pending',
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
  db.insert(sessionPlanSets)
    .values({
      id: 'sps-1',
      sessionPlanExerciseId: 'spe-1',
      orderIndex: 0,
      targetWeightValue: '100',
      targetReps: 5,
      targetSetType: 'rir_4',
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
  db.insert(sessions)
    .values({
      id: 'sess-plan',
      gymId: 'gym-plan',
      sourcePlanId: 'sp-1',
      status: 'active',
      startedAt: new Date('2026-06-01T08:00:00.000Z'),
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
  db.insert(sessionExercises)
    .values({
      id: 'sx-plan',
      sessionId: 'sess-plan',
      exerciseDefinitionId: 'def-squat',
      sourcePlanExerciseId: 'spe-1',
      orderIndex: 0,
      name: 'Squat',
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
  db.insert(exerciseSets)
    .values({
      id: 'es-plan',
      sessionExerciseId: 'sx-plan',
      sourcePlanSetId: 'sps-1',
      orderIndex: 0,
      weightValue: '',
      repsValue: '',
      plannedWeightValue: '100',
      plannedRepsValue: '5',
      plannedSetType: 'rir_4',
      performanceStatus: 'planned',
      localDirty: true,
      localUpdatedAtMs: stamp(),
    })
    .run();
};

describe('M23 planning graph round-trips through the sync cycle and survives reinstall', () => {
  it('pushes, wipes, and re-pulls the whole chain in FK-safe layer order with provenance intact', async () => {
    const server = createStubServer();
    mockRpc.mockImplementation(server.rpc);

    markBootstrapDone();
    seedDirtyPlanGraph(database);

    await expect(runSyncCycle()).resolves.toBe('converged');

    for (const [type, count] of [
      ['training_programmes', 1],
      ['session_plans', 1],
      ['session_plan_exercises', 1],
      ['session_plan_sets', 1],
      ['sessions', 1],
      ['session_exercises', 1],
      ['exercise_sets', 1],
    ] as const) {
      expect([type, server.count(type)]).toEqual([type, count]);
    }

    reinstallLocalStore();
    expect(database.select().from(trainingProgrammes).all()).toHaveLength(0);
    expect(database.select().from(exerciseSets).all()).toHaveLength(0);

    // Under enforced FKs a page landing before its parent layer aborts the pull
    // as 'fk-violation'; convergence is the proof the layer map is correct.
    await expect(runSyncCycle()).resolves.toBe('converged');

    const plan = database.select().from(sessionPlans).where(eq(sessionPlans.id, 'sp-1')).get();
    expect(plan).toMatchObject({ programmeId: 'tp-1', gymId: 'gym-plan', title: 'Day 1', provenance: 'human' });
    expect(plan?.scheduledFor).toEqual(new Date('2026-06-01T08:00:00.000Z'));

    const block = database.select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, 'spe-1')).get();
    expect(block).toMatchObject({ sessionPlanId: 'sp-1', exerciseDefinitionId: 'def-squat', progressStatus: 'pending' });

    const target = database.select().from(sessionPlanSets).where(eq(sessionPlanSets.id, 'sps-1')).get();
    expect(target).toMatchObject({ sessionPlanExerciseId: 'spe-1', targetWeightValue: '100', targetReps: 5, targetSetType: 'rir_4' });

    const performedSession = database.select().from(sessions).where(eq(sessions.id, 'sess-plan')).get();
    expect(performedSession?.sourcePlanId).toBe('sp-1');

    const card = database.select().from(sessionExercises).where(eq(sessionExercises.id, 'sx-plan')).get();
    expect(card?.sourcePlanExerciseId).toBe('spe-1');

    const set = database.select().from(exerciseSets).where(eq(exerciseSets.id, 'es-plan')).get();
    expect(set).toMatchObject({ sourcePlanSetId: 'sps-1', plannedWeightValue: '100', plannedRepsValue: '5', performanceStatus: 'planned' });

    // The parent layers were observed before their children across the pull.
    const order = server.pullObservationOrder;
    const firstIndex = (type: string) => order.indexOf(type);
    for (const [parent, child] of [
      ['training_programmes', 'session_plans'],
      ['session_plans', 'session_plan_exercises'],
      ['session_plans', 'sessions'],
      ['session_plan_exercises', 'session_exercises'],
      ['session_plan_sets', 'exercise_sets'],
    ] as const) {
      expect([parent, child, firstIndex(parent) < firstIndex(child)]).toEqual([parent, child, true]);
    }
  });

  it('maps the new entities onto the expected five layers', () => {
    expect(LAYER_OF.training_programmes).toBe(0);
    expect(LAYER_OF.session_plans).toBe(1);
    expect(LAYER_OF.sessions).toBe(2);
    expect(LAYER_OF.session_plan_exercises).toBe(2);
    expect(LAYER_OF.session_exercises).toBe(3);
    expect(LAYER_OF.session_plan_sets).toBe(3);
    expect(LAYER_OF.exercise_sets).toBe(4);
  });
});
