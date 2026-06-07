/* eslint-disable import/first */

/**
 * Outcome: TWO local devices sharing ONE real server converge under
 * last-write-wins, and the server's future-clock clamp is honoured end to end.
 *
 * This is the sibling of `cycle-round-trip.test.ts`. That suite drives the REAL
 * `runSyncCycle` against a REAL Postgres + PostgREST + RLS endpoint with a
 * single local database; it proves the wire contract round-trips. This suite
 * adds the one capability the round-trip cannot exercise: a SECOND local
 * database talking to the SAME server as the same user, so a row edited on one
 * device collides with the other device's copy on the server and LWW has to
 * pick a winner. The cycle is mocked at exactly two seams (the local data layer
 * and the authed Supabase client, via the shared `sync-cycle-mocks` helpers);
 * everything past the wire — server-side LWW in `sync_push`, the future-clock
 * clamp, the per-layer pull cursors — is the live endpoint.
 *
 * The NEW mechanism vs the round-trip suite: there are two in-memory
 * better-sqlite3 fixtures (device A, device B). `mockBootstrapState.database` is
 * swapped to the device whose cycle we want to run, between `runSyncCycle()`
 * calls. Both authenticate as the SAME `user_a` fixture, so a row with the same
 * id pushed from A and edited on B is one row `(owner_user_id, id)` on the
 * server — the collision the whole LWW design exists to resolve.
 *
 * Isolation, exactly as in the round-trip suite: the shared `user_a` server is
 * NEVER wiped, so its rows accumulate across cases and across repeated lane
 * runs. Every case mints a fresh, globally-unique id set (`makeChainIds`) so two
 * cases — or two back-to-back runs — can never collide on a primary key. Each
 * fixture is stood up fully migrated, with the `muscle_groups` taxonomy bundle
 * seeded up front. That seed is load-bearing — the client
 * `exercise_muscle_mappings.muscle_group_id` FK is present, so a pulled mapping
 * (left on the accumulating server by any prior run) would violate its FK into
 * an empty `muscle_groups` (its Layer 0 synced parent) and abort the whole pull
 * page otherwise.
 *
 * Every device is additionally stamped with `bootstrap_completed_at` so the
 * first-sign-in bootstrapper no-ops: it makes each fixture a RETURNING device,
 * which (a) keeps the LWW collision landing in the convergence loop's
 * `applyPullPage` rather than the bootstrapper's first-full-pull, and (b) avoids
 * the bootstrapper seeding the starter exercise catalog on a (first-ever-run)
 * empty server, which would push the whole catalog and pollute the shared
 * fixture user.
 *
 * Three describes, all on the gym -> session -> session-exercise -> set chain
 * (no muscle mappings needed), with the GYM as the collision/clamp target (it is
 * layer 0, parent-free, and carries a `name` that makes the winner obvious):
 *
 *   1. end-to-end LWW conflict — a dirty local row driven into a server
 *      collision through the full pull -> push -> pull loop. (a) incoming-wins
 *      clobbers a dirty local edit (LWW ignores the dirty bit); (b) the newer
 *      local edit wins, pushes, and the ack clears the bit.
 *   2. multi-device convergence — A pushes, B adopts, B edits + pushes, A
 *      re-pulls and adopts B's value; all three (A, B, server) land on it.
 *   3. future-clock clamp reconciliation — a row stamped 24h ahead is stored
 *      clamped server-side, the client keeps its local stamp, and a second cycle
 *      neither re-dirties nor thrashes.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedBranchClient,
  readLiveBranchConfig,
  SYNC_RPC_SCHEMA,
  type AuthedBranchClient,
} from './helpers/live-branch';

// Local DB handle and server client live on mock-prefixed holders so the
// hoisted `jest.mock` factories can close over them (see `sync-cycle-mocks`).
const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () => ({
  // The cycle resolves its local DB through the mocked `bootstrapLocalDataLayer`;
  // the TEST seeds the `muscle_groups` taxonomy onto that DB itself (see
  // `makeDevice`). Re-export the actual module so any non-mocked helper the cycle
  // reaches for resolves to the real implementation.
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
import { gyms, muscleGroups, sessions, sessionExercises, exerciseSets, syncRuntimeState } from '@/src/data/schema';
import { runSyncCycle, type SyncCycleOutcome } from '@/src/sync/cycle';

// Reads the live-endpoint config; throws here (failing the suite) when the env
// is missing or incomplete, since this suite runs only when an endpoint has been
// provisioned.
const config = readLiveBranchConfig();

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Slack on the clamp bound: absorbs the gap between the test reading `Date.now()`
// and the server computing `now_ms()` (same Docker host, so sub-second in
// practice) — a minute is comfortably generous without weakening the assertion.
const CLAMP_SLACK_MS = 60 * 1000;

interface ChainIds {
  gym: string;
  session: string;
  sessionExercise: string;
  exerciseSet: string;
}

// A fresh, globally-unique id set per case. The suite never wipes the server, so
// the fixture user's rows accumulate; minting a distinct prefix for every case
// keeps each case isolated on that shared, growing server.
let chainSeq = 0;
const makeChainIds = (): ChainIds => {
  chainSeq += 1;
  const run = `md-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${chainSeq}`;
  return {
    gym: `${run}-gym`,
    session: `${run}-session`,
    sessionExercise: `${run}-sx`,
    exerciseSet: `${run}-set`,
  };
};

interface DeviceFixture {
  fixture: InMemoryDatabaseFixture;
  database: InMemoryTestDatabase;
}

interface ServerEntity {
  type: string;
  id: string;
  client_updated_at_ms: number;
  fields: Record<string, unknown>;
}

describe('sync cycle multi-device LWW against a live endpoint', () => {
  let authed: AuthedBranchClient;
  // Every fixture opened during a case, closed in afterEach.
  const openFixtures: InMemoryDatabaseFixture[] = [];

  // Stamps `bootstrap_completed_at` on the singleton runtime row so the
  // first-sign-in bootstrapper no-ops on this device: the device becomes a
  // RETURNING one, so the LWW collision lands in the convergence loop's
  // `applyPullPage` (not the bootstrapper's first-full-pull) and the catalog
  // seeder never fires against the shared server.
  const markBootstrapCompleted = (database: InMemoryTestDatabase): void => {
    const now = new Date();
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: now })
      .onConflictDoUpdate({ target: syncRuntimeState.id, set: { bootstrapCompletedAt: now } })
      .run();
  };

  // Stands up one fresh device: a fully-migrated in-memory store, with the
  // `muscle_groups` taxonomy bundle seeded (its Layer 0 synced parent, so a
  // pulled mapping satisfies its FK), and stamped as already-bootstrapped.
  const seedMuscleGroupTaxonomy = (database: InMemoryTestDatabase): void => {
    const now = new Date();
    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      database
        .insert(muscleGroups)
        .values({ ...muscleGroup, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: muscleGroups.id })
        .run();
    }
  };

  const makeDevice = (): DeviceFixture => {
    const fixture = createInMemoryDatabase();
    openFixtures.push(fixture);
    const { database } = fixture;
    seedMuscleGroupTaxonomy(database);
    markBootstrapCompleted(database);
    return { fixture, database };
  };

  // Points the cycle at a device and runs one full convergence cycle against the
  // live server.
  const runCycleOn = (device: DeviceFixture): Promise<SyncCycleOutcome> => {
    mockBootstrapState.database = device.database;
    return runSyncCycle();
  };

  // Seeds a single dirty gym (the collision target) with an explicit LWW stamp.
  const seedDirtyGym = (
    database: InMemoryTestDatabase,
    id: string,
    name: string,
    stampMs: number,
  ): void => {
    database
      .insert(gyms)
      .values({ id, name, localDirty: true, localUpdatedAtMs: stampMs })
      .run();
  };

  // Seeds the full dirty gym -> session -> sx -> set chain (parents first; the
  // better-sqlite3 fixture enforces FKs by default). The gym carries the
  // caller-controlled name + LWW stamp; the rest get derived, near-now stamps.
  const seedDirtyChain = (
    database: InMemoryTestDatabase,
    ids: ChainIds,
    gymName: string,
    gymStampMs: number,
  ): void => {
    const base = Date.now();
    seedDirtyGym(database, ids.gym, gymName, gymStampMs);
    database
      .insert(sessions)
      .values({
        id: ids.session,
        gymId: ids.gym,
        status: 'active',
        startedAt: new Date(base),
        localDirty: true,
        localUpdatedAtMs: base + 2,
      })
      .run();
    database
      .insert(sessionExercises)
      .values({
        id: ids.sessionExercise,
        sessionId: ids.session,
        orderIndex: 0,
        name: 'Bench Press',
        localDirty: true,
        localUpdatedAtMs: base + 3,
      })
      .run();
    database
      .insert(exerciseSets)
      .values({
        id: ids.exerciseSet,
        sessionExerciseId: ids.sessionExercise,
        orderIndex: 0,
        weightValue: '225',
        repsValue: '5',
        localDirty: true,
        localUpdatedAtMs: base + 4,
      })
      .run();
  };

  const readGym = (database: InMemoryTestDatabase, id: string) =>
    database.select().from(gyms).where(eq(gyms.id, id)).get();

  // Pulls the live server's copy of a gym (layer 0) through the authed client,
  // draining every page until the id is found or the layer is exhausted. The
  // server accumulates rows across runs, so a single fixed-size page is not
  // guaranteed to contain this run's row — follow the cursor.
  const pullServerGym = async (id: string): Promise<ServerEntity | undefined> => {
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA);
    let cursor: unknown = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page = (await scoped.rpc('sync_pull', { layer: 0, cursor, limit: 200 })) as {
        data?: { entities?: ServerEntity[]; next_cursor?: unknown; has_more?: boolean };
      };
      for (const entity of page.data?.entities ?? []) {
        if (entity.type === 'gyms' && entity.id === id) {
          return entity;
        }
      }
      if (!page.data?.has_more) {
        break;
      }
      cursor = page.data?.next_cursor ?? null;
    }
    return undefined;
  };

  beforeAll(async () => {
    authed = await createAuthedBranchClient(config);
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

  describe('end-to-end LWW conflict through the full pull -> push -> pull loop', () => {
    it('(a) server holds X@T_high: incoming wins and clobbers the dirty local edit', async () => {
      const ids = makeChainIds();
      const base = Date.now();
      const tLow = base;
      const tHigh = base + 10_000; // 10s ahead — well under the 5min clamp.

      const deviceA = makeDevice();
      const deviceB = makeDevice();

      // A pushes the chain; the gym lands on the server at the HIGH stamp.
      seedDirtyChain(deviceA.database, ids, 'device-A-wins', tHigh);
      expect(await runCycleOn(deviceA)).toBe('converged');

      // B holds the SAME gym, dirty, at the LOW stamp.
      seedDirtyGym(deviceB.database, ids.gym, 'device-B-stale', tLow);

      // B's cycle: the pull leg's applyPullPage sees incoming T_high > local
      // T_low and overwrites — LWW ignores B's dirty bit. The clobbered row is
      // then clean (no push), so the dirty edit is gone.
      expect(await runCycleOn(deviceB)).toBe('converged');

      const gymB = readGym(deviceB.database, ids.gym);
      expect(gymB?.name).toBe('device-A-wins');
      expect(gymB?.localDirty).toBe(false);
      expect(gymB?.localUpdatedAtMs).toBe(tHigh);
    }, 60_000);

    it('(b) server holds X@T_low: the newer local edit wins, pushes, and the ack clears the bit', async () => {
      const ids = makeChainIds();
      const base = Date.now();
      const tLow = base;
      const tHigh = base + 10_000;

      const deviceA = makeDevice();
      const deviceB = makeDevice();

      // A pushes the chain; the gym lands on the server at the LOW stamp.
      seedDirtyChain(deviceA.database, ids, 'device-A-stale', tLow);
      expect(await runCycleOn(deviceA)).toBe('converged');

      // B holds the SAME gym, dirty, at the HIGH stamp.
      seedDirtyGym(deviceB.database, ids.gym, 'device-B-wins', tHigh);

      // B's cycle: the pull no-ops (local T_high newer than server T_low), B
      // pushes and wins server-side LWW, the ack clears the bit, and the re-pull
      // of B's own value no-ops — converged clean.
      expect(await runCycleOn(deviceB)).toBe('converged');

      const gymB = readGym(deviceB.database, ids.gym);
      expect(gymB?.name).toBe('device-B-wins');
      expect(gymB?.localDirty).toBe(false);
      expect(gymB?.localUpdatedAtMs).toBe(tHigh);

      // The server now holds B's value at the high stamp (not clamped).
      const serverGym = await pullServerGym(ids.gym);
      expect(serverGym?.fields.name).toBe('device-B-wins');
      expect(serverGym?.client_updated_at_ms).toBe(tHigh);
    }, 60_000);
  });

  describe('multi-device convergence', () => {
    it('A pushes, B adopts, B edits + pushes, A re-pulls and adopts — all three reach X@T2', async () => {
      const ids = makeChainIds();
      const base = Date.now();
      const t1 = base;
      const t2 = base + 5_000;

      const deviceA = makeDevice();
      const deviceB = makeDevice();

      // A pushes the chain (gym@T1).
      seedDirtyChain(deviceA.database, ids, 'gym-v1', t1);
      expect(await runCycleOn(deviceA)).toBe('converged');
      expect(readGym(deviceA.database, ids.gym)?.name).toBe('gym-v1');

      // B pulls and converges on A's value.
      expect(await runCycleOn(deviceB)).toBe('converged');
      expect(readGym(deviceB.database, ids.gym)?.name).toBe('gym-v1');
      expect(readGym(deviceB.database, ids.gym)?.localDirty).toBe(false);

      // B edits the gym to V2@T2 and pushes.
      deviceB.database
        .update(gyms)
        .set({ name: 'gym-v2', localDirty: true, localUpdatedAtMs: t2 })
        .where(eq(gyms.id, ids.gym))
        .run();
      expect(await runCycleOn(deviceB)).toBe('converged');
      expect(readGym(deviceB.database, ids.gym)?.name).toBe('gym-v2');
      expect(readGym(deviceB.database, ids.gym)?.localDirty).toBe(false);

      // A re-pulls (its cursor advanced past its own V1 push, so it now picks up
      // B's V2) and adopts it.
      expect(await runCycleOn(deviceA)).toBe('converged');
      const gymA = readGym(deviceA.database, ids.gym);
      expect(gymA?.name).toBe('gym-v2');
      expect(gymA?.localDirty).toBe(false);
      expect(gymA?.localUpdatedAtMs).toBe(t2);

      // All three — A, B, and the server — converged on V2@T2. Each cycle
      // returned 'converged' and left the row clean, so convergence settled
      // within MAX_CYCLES_PER_CALL (a capped, non-converged run would leave a
      // dirty bit or a stale value behind).
      expect(readGym(deviceB.database, ids.gym)?.localUpdatedAtMs).toBe(t2);
      const serverGym = await pullServerGym(ids.gym);
      expect(serverGym?.fields.name).toBe('gym-v2');
      expect(serverGym?.client_updated_at_ms).toBe(t2);
    }, 90_000);
  });

  describe('future-clock clamp reconciliation', () => {
    it('stores the clamped stamp server-side, keeps the local stamp, and does not thrash on re-run', async () => {
      const ids = makeChainIds();
      const base = Date.now();
      const future = base + ONE_DAY_MS; // 24h ahead — far past the clamp ceiling.

      const deviceB = makeDevice();
      seedDirtyGym(deviceB.database, ids.gym, 'future-clock-gym', future);

      // Cycle 1: B pushes the future-stamped row. The server clamps the stored
      // client_updated_at_ms to ~now+5min; the ack clears B's dirty bit on the
      // SENT value, leaving B's local stamp untouched (still 24h ahead).
      expect(await runCycleOn(deviceB)).toBe('converged');

      const gym1 = readGym(deviceB.database, ids.gym);
      expect(gym1?.localDirty).toBe(false);
      expect(gym1?.localUpdatedAtMs).toBe(future);

      // The server stored the CLAMPED stamp: below now+5min(+slack) and strictly
      // below what the client sent. A near-now lower bound proves it is a real
      // clamp value, not a zeroed/garbage one.
      const serverGym = await pullServerGym(ids.gym);
      expect(serverGym).toBeDefined();
      const stored = serverGym!.client_updated_at_ms;
      expect(stored).toBeLessThan(future);
      expect(stored).toBeLessThanOrEqual(base + FIVE_MINUTES_MS + CLAMP_SLACK_MS);
      expect(stored).toBeGreaterThanOrEqual(base - CLAMP_SLACK_MS);

      // Cycle 2: the re-pulled clamped value (< local 24h-ahead stamp) makes
      // applyPullPage a no-op, so the row neither re-dirties nor thrashes.
      expect(await runCycleOn(deviceB)).toBe('converged');
      const gym2 = readGym(deviceB.database, ids.gym);
      expect(gym2?.localDirty).toBe(false);
      expect(gym2?.localUpdatedAtMs).toBe(future);
    }, 60_000);
  });
});
