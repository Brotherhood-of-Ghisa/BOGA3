/* eslint-disable import/first */

/**
 * Outcome: TWO devices attaching the SAME plan block converge on at most one
 * live claim, server commit order deciding — the second device's cycle meets
 * the winner in its pull leg, the provenance-arbitration repair clears its
 * losing claim deterministically (the losing card keeps all entered work as
 * unsourced rows), and the cycle re-pushes to convergence instead of wedging
 * on a repeated unique violation. This is the live-endpoint proof of the
 * session-planning contract §4.5; the deterministic repair rules and the
 * server token themselves are proven infra-free in the fast suite and the
 * sync-push-contract backend suite.
 *
 * Fixture model (same as cycle-multidevice-lww): fresh in-memory devices under
 * the shared mock factories, one authed client as the shared fixture user, an
 * accumulating server — every case mints globally-unique ids. The plan graph
 * is seeded on device A dirty (its cycle pushes it), seeded clean on B (as-if
 * pulled) with B's own dirty attachment (B wins the claim), and on device C
 * with the conflicting dirty attachment (C loses and must repair).
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedTestClient,
  readSyncTestEndpoint,
  SYNC_RPC_SCHEMA,
  type AuthedTestClient,
} from './helpers/sync-test-endpoint';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () => ({
  ...(jest.requireActual('@/src/data/bootstrap') as typeof import('@/src/data/bootstrap')),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  ...(require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
}));

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  exerciseSets,
  muscleGroups,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { runSyncCycle, type SyncCycleOutcome } from '@/src/sync/cycle';

const config = readSyncTestEndpoint();

interface ArbitrationIds {
  plan: string;
  block: string;
  targetA: string;
  targetB: string;
}

let idSeq = 0;
const makeIds = (): ArbitrationIds => {
  idSeq += 1;
  const run = `arb-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${idSeq}`;
  return {
    plan: `${run}-plan`,
    block: `${run}-block`,
    targetA: `${run}-target-a`,
    targetB: `${run}-target-b`,
  };
};

interface DeviceFixture {
  fixture: InMemoryDatabaseFixture;
  database: InMemoryTestDatabase;
}

describe('block-attachment arbitration across devices against a live endpoint', () => {
  let authed: AuthedTestClient;
  const openFixtures: InMemoryDatabaseFixture[] = [];

  const makeDevice = (): DeviceFixture => {
    const fixture = createInMemoryDatabase();
    openFixtures.push(fixture);
    const { database } = fixture;
    const now = new Date();
    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      database
        .insert(muscleGroups)
        .values({ ...muscleGroup, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: muscleGroups.id })
        .run();
    }
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: now })
      .onConflictDoUpdate({ target: syncRuntimeState.id, set: { bootstrapCompletedAt: now } })
      .run();
    return { fixture, database };
  };

  const runCycleOn = (device: DeviceFixture): Promise<SyncCycleOutcome> => {
    mockBootstrapState.database = device.database;
    return runSyncCycle();
  };

  const planStampMs = Date.now();

  /** Seeds the plan graph; dirty seeds push, clean seeds behave as pulled rows. */
  const seedPlanGraph = (database: InMemoryTestDatabase, ids: ArbitrationIds, dirty: boolean): void => {
    const stamp = planStampMs;
    database
      .insert(sessionPlans)
      .values({
        id: ids.plan,
        title: 'Arbitration Plan',
        localDirty: dirty,
        localUpdatedAtMs: stamp,
      })
      .run();
    database
      .insert(sessionPlanExercises)
      .values({
        id: ids.block,
        sessionPlanId: ids.plan,
        orderIndex: 0,
        name: 'Back Squat',
        progressStatus: 'pending',
        localDirty: dirty,
        localUpdatedAtMs: stamp,
      })
      .run();
    database
      .insert(sessionPlanSets)
      .values([
        {
          id: ids.targetA,
          sessionPlanExerciseId: ids.block,
          orderIndex: 0,
          targetReps: 5,
          targetWeightValue: '100',
          localDirty: dirty,
          localUpdatedAtMs: stamp,
        },
        {
          id: ids.targetB,
          sessionPlanExerciseId: ids.block,
          orderIndex: 1,
          targetReps: 8,
          targetWeightValue: '80',
          localDirty: dirty,
          localUpdatedAtMs: stamp,
        },
      ])
      .run();
  };

  /** Seeds the device's own active session with a dirty sourced card + set. */
  const seedOwnAttachment = (
    database: InMemoryTestDatabase,
    ids: ArbitrationIds,
    cardId: string,
    setId: string,
  ): void => {
    const base = Date.now();
    database
      .insert(sessions)
      .values({
        id: `${cardId}-session`,
        status: 'active',
        startedAt: new Date(base),
        localDirty: true,
        localUpdatedAtMs: base + 1,
      })
      .run();
    database
      .insert(sessionExercises)
      .values({
        id: cardId,
        sessionId: `${cardId}-session`,
        orderIndex: 0,
        name: 'Back Squat',
        sourcePlanExerciseId: ids.block,
        localDirty: true,
        localUpdatedAtMs: base + 2,
      })
      .run();
    database
      .insert(exerciseSets)
      .values({
        id: setId,
        sessionExerciseId: cardId,
        orderIndex: 0,
        // The loser entered its own actuals — these must survive the repair.
        weightValue: '90',
        repsValue: '3',
        performanceStatus: null,
        sourcePlanSetId: ids.targetA,
        localDirty: true,
        localUpdatedAtMs: base + 3,
      })
      .run();
  };

  /** Drains one layer from the live server and returns the matching entities. */
  const pullLayerEntities = async (layer: number): Promise<{ type: string; id: string; fields: Record<string, unknown> }[]> => {
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA);
    const found: { type: string; id: string; fields: Record<string, unknown> }[] = [];
    let cursor: unknown = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page = (await scoped.rpc('sync_pull', { layer, cursor, limit: 200 })) as {
        data?: { entities?: { type: string; id: string; fields: Record<string, unknown> }[]; next_cursor?: unknown; has_more?: boolean };
      };
      found.push(...(page.data?.entities ?? []));
      if (!page.data?.has_more) {
        break;
      }
      cursor = page.data?.next_cursor ?? null;
    }
    return found;
  };

  beforeAll(async () => {
    authed = await createAuthedTestClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(() => {
    mockClientState.client = authed.client;
  });

  afterEach(() => {
    for (const fixture of openFixtures.splice(0)) {
      fixture.close();
    }
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('the losing device repairs deterministically and converges', async () => {
    const ids = makeIds();

    // Device A authors the plan graph and pushes it to the server.
    const deviceA = makeDevice();
    seedPlanGraph(deviceA.database, ids, true);
    expect(await runCycleOn(deviceA)).toBe('converged');

    // Device B has pulled the plan graph (clean local rows) and claims the
    // block with its own card + set. Its cycle pushes the FIRST live claim.
    const deviceB = makeDevice();
    seedPlanGraph(deviceB.database, ids, false);
    seedOwnAttachment(deviceB.database, ids, 'card-winner', 'set-winner');
    expect(await runCycleOn(deviceB)).toBe('converged');

    // Device C: same pulled plan graph, its own dirty card + set claiming the
    // SAME block and target — attached offline before its first sync. The
    // cycle's pull leg now delivers B's claim, the local partial unique index
    // rejects the pulled row, and the arbitration repair clears C's losing
    // provenance; the cycle then pushes C's rows as unsourced and converges.
    const deviceC = makeDevice();
    seedPlanGraph(deviceC.database, ids, false);
    seedOwnAttachment(deviceC.database, ids, 'card-loser', 'set-loser');
    expect(await runCycleOn(deviceC)).toBe('converged');

    // C's losing card keeps all user work, unsourced.
    const loserCard = deviceC.database
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.id, 'card-loser'))
      .get();
    expect(loserCard).toMatchObject({
      sourcePlanExerciseId: null,
      name: 'Back Squat',
      localDirty: false,
    });
    const loserSet = deviceC.database
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.id, 'set-loser'))
      .get();
    expect(loserSet).toMatchObject({
      sourcePlanSetId: null,
      weightValue: '90',
      repsValue: '3',
      performanceStatus: null,
      localDirty: false,
    });

    // B's winning claim is untouched.
    const winnerCard = deviceB.database
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.id, 'card-winner'))
      .get();
    expect(winnerCard?.sourcePlanExerciseId).toBe(ids.block);

    // The server holds exactly one live card claiming the block (B's), and
    // exactly one live set claiming the target.
    const layer3 = await pullLayerEntities(3);
    const claimingCards = layer3.filter(
      (entity) => entity.type === 'session_exercises' && entity.fields.source_plan_exercise_id === ids.block,
    );
    expect(claimingCards.map((entity) => entity.id)).toEqual(['card-winner']);
    const layer4 = await pullLayerEntities(4);
    const claimingSets = layer4.filter(
      (entity) => entity.type === 'exercise_sets' && entity.fields.source_plan_set_id === ids.targetA,
    );
    expect(claimingSets.map((entity) => entity.id)).toEqual(['set-winner']);
  }, 120_000);
});
