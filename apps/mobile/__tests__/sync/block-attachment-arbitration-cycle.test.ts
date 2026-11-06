/* eslint-disable import/first */

jest.unmock('@/src/auth/session-user');

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
  exerciseDefinitions,
  exerciseSets,
  muscleGroups,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessionPlanUses,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { runSyncCycle, type SyncCycleOutcome } from '@/src/sync/cycle';
import { completeSessionDraft, loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { addPlanBlockToSession, planQueries, planRepository, skipSessionPlanUse, startSessionPlan } from '@/src/session-planner';

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

// Fresh owner keeps recent completed Routine uses out of the coaching fixture account.
async function fixtureUser(method: string, path: string, body?: unknown): Promise<{ id: string }> {
  if (!['127.0.0.1', 'localhost'].includes(new URL(config.url).hostname)) throw new Error('Local fixture required');
  const key = process.env.SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Run through boga test sync-infra');
  const response = await fetch(config.url + '/auth/v1/admin/users' + path, {
    method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Fixture user request failed: ' + response.status);
  return response.json() as Promise<{ id: string }>;
}

describe('block-attachment arbitration across devices against a live endpoint', () => {
  let authed: AuthedTestClient;
  let isolatedUserId: string;
  const openFixtures: InMemoryDatabaseFixture[] = [];

  const makeDevice = (): DeviceFixture => {
    const fixture = createInMemoryDatabase({ foreignKeys: true });
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
  const seedPlanGraph = (database: InMemoryTestDatabase, ids: ArbitrationIds, dirty: boolean, routine = false): void => {
    const stamp = planStampMs;
    if (routine) database.insert(exerciseDefinitions).values({ id: `${ids.plan}-definition`, name: 'Back Squat',
      localDirty: dirty, localUpdatedAtMs: stamp }).run();
    database
      .insert(sessionPlans)
      .values({
        id: ids.plan,
        title: 'Arbitration Plan',
        isRoutine: routine,
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
        exerciseDefinitionId: routine ? `${ids.plan}-definition` : null,
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
    const credentials = { email: makeIds().plan + '@example.test', password: 'ArbitrationFixture!234' };
    isolatedUserId = (await fixtureUser('POST', '', { ...credentials, email_confirm: true })).id;
    authed = await createAuthedTestClient(config, credentials);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
    if (isolatedUserId) await fixtureUser('DELETE', '/' + isolatedUserId);
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
    const layer3 = await pullLayerEntities(4);
    const claimingCards = layer3.filter(
      (entity) => entity.type === 'session_exercises' && entity.fields.source_plan_exercise_id === ids.block,
    );
    expect(claimingCards.map((entity) => entity.id)).toEqual(['card-winner']);
    const layer4 = await pullLayerEntities(5);
    const claimingSets = layer4.filter(
      (entity) => entity.type === 'exercise_sets' && entity.fields.source_plan_set_id === ids.targetA,
    );
    expect(claimingSets.map((entity) => entity.id)).toEqual(['set-winner']);
  }, 120_000);

  const startOn = async (device: DeviceFixture, planId: string) => {
    mockBootstrapState.database = device.database;
    const result = await startSessionPlan(planId);
    if (result.status !== 'started') throw new Error('Fixture start failed: ' + result.status);
    return (await loadSessionSnapshotById(result.sessionId))!;
  };
  const enterWorkOn = async (device: DeviceFixture, snapshot: NonNullable<Awaited<ReturnType<typeof loadSessionSnapshotById>>>) => {
    mockBootstrapState.database = device.database;
    const card = snapshot.exercises[0];
    await persistSessionDraftSnapshot({ sessionId: snapshot.sessionId, sourcePlanId: snapshot.sourcePlanId,
      sourcePlanUseId: snapshot.sourcePlanUseId, gymId: null, startedAt: snapshot.startedAt,
      exercises: [{ ...card, sets: [{ ...card.sets[0], weightValue: '93', repsValue: '4', performanceStatus: null }] }],
    });
  };

  it.each(['workout', 'skip'] as const)('arbitrates offline Start against %s, retaining actuals and refusing stale recorder provenance', async winnerKind => {
    const ids = makeIds();
    const winner = makeDevice(), loser = makeDevice();
    seedPlanGraph(winner.database, ids, true, true);
    seedPlanGraph(loser.database, ids, false, true);
    mockBootstrapState.database = winner.database;
    if (winnerKind === 'workout') await startOn(winner, ids.plan);
    else expect((await skipSessionPlanUse(ids.plan, `${ids.plan}-skip`)).status).toBe('skipped');
    const opened = await startOn(loser, ids.plan);
    await enterWorkOn(loser, opened);
    expect(await runCycleOn(winner)).toBe('converged');
    expect(await runCycleOn(loser)).toBe('converged');
    const repaired = loser.database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, opened.sourcePlanUseId!)).get()!;
    expect(repaired.deletedAt).not.toBeNull();
    expect(loser.database.select().from(exerciseSets).where(eq(exerciseSets.id, opened.exercises[0].sets[0].id)).get())
      .toMatchObject({ sourcePlanSetId: null, sourcePlanUseId: null, weightValue: '93', repsValue: '4', localDirty: false });
    // An editor opened offline may still hold the old use links after repair.
    await enterWorkOn(loser, opened);
    expect(await runCycleOn(loser)).toBe('converged');
    const retained = (await loadSessionSnapshotById(opened.sessionId))!;
    expect(retained.sourcePlanUseId).toBeNull();
    expect(retained.sourcePlanId).toBeNull();
    expect(retained.exercises[0].sets[0]).toMatchObject({ sourcePlanSetId: null, sourcePlanUseId: null, weightValue: '93', repsValue: '4' });
    const claims = (await pullLayerEntities(2)).filter(entity => entity.type === 'session_plan_uses' &&
      entity.fields.session_plan_id === ids.plan && entity.fields.deleted_at === null);
    expect(claims).toHaveLength(1);
    expect(claims[0].fields.kind).toBe(winnerKind);
  }, 120_000);

  it('converges offline conversion of the same entirely skipped one-off with different recovered dates', async () => {
    const ids = makeIds(), first = makeDevice(), second = makeDevice();
    seedPlanGraph(first.database, ids, true);
    seedPlanGraph(second.database, ids, false);
    const firstDate = new Date(Date.now() - 2000), secondDate = new Date(Date.now() - 1000);
    const convert = async (device: DeviceFixture, resolvedAt: Date) => {
      device.database.update(sessionPlanExercises).set({ progressStatus: 'skipped', resolvedAt,
        localDirty: true, localUpdatedAtMs: resolvedAt.getTime() }).where(eq(sessionPlanExercises.id, ids.block)).run();
      mockBootstrapState.database = device.database;
      expect((await planRepository.updatePlanMeta(ids.plan, { isRoutine: true })).status).toBe('updated');
      return device.database.select().from(sessionPlanUses).get()!;
    };
    const accepted = await convert(first, firstDate), competing = await convert(second, secondDate);
    expect(accepted.id).not.toBe(competing.id);
    expect(await runCycleOn(first)).toBe('converged');
    expect(await runCycleOn(second)).toBe('converged');
    expect(second.database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, competing.id)).get()!.deletedAt).not.toBeNull();
    const use = second.database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, accepted.id)).get()!;
    expect(use).toMatchObject({ skippedAt: firstDate, deletedAt: null, localDirty: false });
    expect(await runCycleOn(second)).toBe('converged');
  }, 120_000);

  it('resumes the existing scoped card after turning Routine off and syncs without an ordinary duplicate', async () => {
    const ids = makeIds(), device = makeDevice();
    seedPlanGraph(device.database, ids, true, true);
    const opened = await startOn(device, ids.plan);
    expect((await planRepository.updatePlanMeta(ids.plan, { isRoutine: false })).status).toBe('updated');
    expect(await addPlanBlockToSession(ids.block)).toMatchObject({ status: 'attached',
      sessionId: opened.sessionId, sessionExerciseId: opened.exercises[0].id });
    expect(device.database.select().from(sessionExercises).all()).toHaveLength(1);
    expect(await runCycleOn(device)).toBe('converged');
  }, 120_000);

  it('restores repeated workouts and more than one page of Skip uses into a wiped device with foreign keys enabled', async () => {
    const ids = makeIds(), original = makeDevice();
    seedPlanGraph(original.database, ids, true, true);
    const first = await startOn(original, ids.plan);
    await enterWorkOn(original, first);
    await completeSessionDraft(first.sessionId, { completedAt: new Date() });
    const second = await startOn(original, ids.plan);
    expect(second.sourcePlanUseId).not.toBe(first.sourcePlanUseId);
    expect(second.exercises[0].sets[0].performanceStatus).toBe('planned');
    await enterWorkOn(original, second);
    await completeSessionDraft(second.sessionId, { completedAt: new Date() });
    for (let index = 0; index < 201; index += 1) {
      expect((await skipSessionPlanUse(ids.plan, `${ids.plan}-skip-${index}`)).status).toBe('skipped');
    }
    expect(await runCycleOn(original)).toBe('converged');
    const priorHistory = [await loadSessionSnapshotById(first.sessionId), await loadSessionSnapshotById(second.sessionId)];
    const wiped = makeDevice();
    expect(await runCycleOn(wiped)).toBe('converged');
    expect(wiped.database.select().from(sessionPlanUses).all().filter(use => use.sessionPlanId === ids.plan)).toHaveLength(203);
    expect(await loadSessionSnapshotById(first.sessionId)).toEqual(priorHistory[0]);
    expect(await loadSessionSnapshotById(second.sessionId)).toEqual(priorHistory[1]);
    expect(wiped.fixture.client.pragma('foreign_key_check')).toEqual([]);
    const detail = (await planQueries.loadPlanDetail(ids.plan))!;
    expect(detail.routine).toMatchObject({ activeSessionId: null, hasKnownUse: true,
      lastCompletedAt: priorHistory[1]!.completedAt, lastSkippedAt: expect.any(Date) });
    expect(await runCycleOn(wiped)).toBe('converged');
  }, 120_000);

});
