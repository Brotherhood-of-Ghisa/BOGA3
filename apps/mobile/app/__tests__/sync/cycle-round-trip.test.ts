/* eslint-disable import/first */

/**
 * Outcome: the full sync cycle converges local and server state over a real
 * push -> server-side last-write-wins -> pull -> local last-write-wins loop.
 *
 * This is the integration assertion the whole sync design exists to satisfy.
 * It runs the REAL cycle against a REAL Postgres + PostgREST + RLS endpoint
 * (not a stubbed RPC), authenticated as a real test user so the RLS-enforced
 * RPCs accept the call. It requires a live endpoint (URL + anon key in the
 * environment) and runs only through its own dedicated script; the fast test
 * lane excludes it. With no endpoint configured it fails hard with a clear
 * message rather than skipping.
 *
 * How this differs from the other cycle tests: the rest of the sync-cycle suite
 * drives `runSyncCycle` against an in-process, stubbed RPC. Those tests verify
 * the client's control flow (batching, layer order, the in-flight race, cursor
 * advance) but never touch a server, so they cannot catch a wire-contract bug —
 * the request shape, the Postgres schema the RPC lives in, server-side LWW, real
 * cursors, or RLS. This test is the only one that exercises that contract end to
 * end. It is exactly what surfaced the schema-targeting bug where the client
 * dispatched the RPCs against the wrong Postgres schema: every stubbed test
 * passed while the real round-trip failed, because the stub never enforced where
 * the RPC actually lives.
 *
 * What it asserts:
 *
 *   1. Push converges. A four-layer FK chain (gym -> session -> session
 *      exercise -> exercise set), all dirty, all clear after one cycle, and the
 *      server holds all four under the test user.
 *   2. A wiped client re-pulls everything via the layered drain. Dropping the
 *      local rows and re-running the cycle restores all four through the
 *      per-layer pull (layer 0 -> 1 -> 2 -> 3), each layer's cursor advancing.
 *   3. A no-op re-run moves nothing. With no local edits, a second cycle leaves
 *      dirty bits clear and does not advance any cursor (no new server rows).
 *   4. The push-in-flight race is preserved end to end. An edit injected
 *      mid-push, after the batch is serialised but before its ack, keeps that
 *      row dirty so the newer value re-pushes on the next round.
 *
 * Each run wipes the test user's server rows first (a dev helper) so the shared
 * fixture user starts from a clean server slate, and uses unique row ids so
 * concurrent or repeated runs never collide.
 */

import { and, eq } from 'drizzle-orm';

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

// Local handle and server handle live on mock-prefixed holders so the hoisted
// factories can close over them. The factory bodies come from the shared
// sync-cycle mock helper (required from inside the hoisted factory, the only
// hoist-safe way to reference a non-`mock` import).
const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import { seedMuscleGroups } from '@/src/data/exercise-catalog-seeds';
import {
  exerciseSets,
  gyms,
  sessionExercises,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { runSyncCycle } from '@/src/sync/cycle';

// Reads the live-endpoint config; throws here (failing the suite) when the env
// is missing or incomplete, since this suite runs only when an endpoint has
// been provisioned.
const config = readLiveBranchConfig();

// Distinct id prefix per run so repeated / parallel runs against the shared
// fixture user never collide on a primary key.
const RUN = `rt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ids = {
  gym: `${RUN}-gym`,
  session: `${RUN}-session`,
  sessionExercise: `${RUN}-sx`,
  exerciseSet: `${RUN}-set`,
};

type PushHook = (() => void) | null;

describe('sync cycle round-trip against a live endpoint', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let authed: AuthedBranchClient;
  // A hook fired just before each sync_push request resolves, used to inject a
  // mid-flight edit for the race assertion. Null when not under test.
  let beforePushHook: PushHook = null;

  // Wraps the authed client so a sync_push call fires the hook (if set) before
  // delegating to the real RPC, modelling an edit landing while the request is
  // in flight.
  const wrapClientWithPushHook = (client: AuthedBranchClient['client']): unknown => ({
    ...client,
    schema: (name: string) => {
      const scoped = client.schema(name);
      return {
        rpc: async (fn: string, args?: unknown) => {
          if (fn === 'sync_push' && beforePushHook) {
            beforePushHook();
          }
          return scoped.rpc(fn, args);
        },
      };
    },
  });

  const seedDirtyChain = (): void => {
    const ms = Date.now();
    database
      .insert(gyms)
      .values({ id: ids.gym, name: 'Round Trip Gym', localDirty: true, localUpdatedAtMs: ms + 1 })
      .run();
    database
      .insert(sessions)
      .values({
        id: ids.session,
        gymId: ids.gym,
        status: 'active',
        startedAt: new Date(ms),
        localDirty: true,
        localUpdatedAtMs: ms + 2,
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
        localUpdatedAtMs: ms + 3,
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
        localUpdatedAtMs: ms + 4,
      })
      .run();
  };

  const allFourClean = (): boolean => {
    const gym = database.select().from(gyms).where(eq(gyms.id, ids.gym)).get();
    const session = database.select().from(sessions).where(eq(sessions.id, ids.session)).get();
    const sx = database
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.id, ids.sessionExercise))
      .get();
    const set = database
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.id, ids.exerciseSet))
      .get();
    return [gym, session, sx, set].every((row) => row !== undefined && row.localDirty === false);
  };

  const readCursorMap = (): Record<string, unknown> => {
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

  // Seed the client-only muscle-group taxonomy into the current store, as the
  // production boot data layer does on every launch. `muscle_groups` never
  // crosses the wire, so any path that materialises an `exercise_muscle_mappings`
  // row locally — the first-sign-in catalog seed the cycle runs on a fresh store,
  // or a re-pull of those mappings after the catalog reaches the server — needs
  // the referenced muscle groups already present for the mapping's foreign key to
  // resolve. Seeding here mirrors that production boot order.
  const seedClientTaxonomy = (): void => {
    seedMuscleGroups(database as unknown as LocalDatabase);
  };

  // Stamp the runtime row as already-bootstrapped so the cycle skips the
  // first-sign-in bootstrapper. This suite drives the steady-state convergence
  // of a hand-built chain on a device that has already completed first sign-in;
  // it is not the first-sign-in path. Without this, a cycle run against the
  // freshly wiped (empty) server would see a zero-row first pull and re-seed the
  // entire starter catalog, flooding the server layers and drowning the
  // hand-built chain this suite asserts on. The dedicated reinstall suite covers
  // the first-sign-in restore path separately.
  const markAlreadyBootstrapped = (): void => {
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date() })
      .onConflictDoUpdate({
        target: syncRuntimeState.id,
        set: { bootstrapCompletedAt: new Date() },
      })
      .run();
  };

  // Re-create a fresh, empty local store so the re-pull starts from nothing —
  // mirrors wiping the local database on a reinstall. The client-only
  // muscle-group taxonomy is re-seeded, exactly as the boot data layer does after
  // a reinstall, so a re-pulled muscle mapping's foreign key still resolves.
  const wipeLocalStore = (): void => {
    fixture.close();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
    mockBootstrapState.database = database;
    seedClientTaxonomy();
    markAlreadyBootstrapped();
  };

  beforeAll(async () => {
    authed = await createAuthedBranchClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(async () => {
    beforePushHook = null;
    // Enforce foreign keys so the store behaves like the production SQLite
    // engine: a muscle mapping that lands before its muscle group is rejected,
    // rather than silently orphaned.
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
    mockBootstrapState.database = database;
    mockClientState.client = wrapClientWithPushHook(authed.client);
    seedClientTaxonomy();
    markAlreadyBootstrapped();

    // Clean the test user's server rows so each test starts from an empty
    // server slate (the fixture user persists across runs).
    await authed.client.schema(SYNC_RPC_SCHEMA).rpc('dev_wipe_my_data');
  }, 30_000);

  afterEach(() => {
    fixture?.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('pushes the dirty chain, clears every dirty bit, and the server holds all four rows', async () => {
    seedDirtyChain();

    await runSyncCycle();

    // Every local row is now clean.
    expect(allFourClean()).toBe(true);

    // The server holds all four under the test user — assert by pulling each
    // layer directly through the authed client.
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA);
    const seen = new Set<string>();
    for (let layer = 0; layer < 4; layer += 1) {
      const page = (await scoped.rpc('sync_pull', { layer, cursor: null, limit: 200 })) as {
        data?: { entities?: { type: string; id: string }[] };
      };
      for (const entity of page.data?.entities ?? []) {
        seen.add(`${entity.type}:${entity.id}`);
      }
    }
    expect(seen.has(`gyms:${ids.gym}`)).toBe(true);
    expect(seen.has(`sessions:${ids.session}`)).toBe(true);
    expect(seen.has(`session_exercises:${ids.sessionExercise}`)).toBe(true);
    expect(seen.has(`exercise_sets:${ids.exerciseSet}`)).toBe(true);
  }, 30_000);

  it('a wiped client re-pulls all four rows via the layered drain with advancing cursors', async () => {
    // First, push the chain to the server.
    seedDirtyChain();
    await runSyncCycle();
    expect(allFourClean()).toBe(true);

    // Wipe the local store and re-run: the cycle must pull all four back.
    wipeLocalStore();
    expect(database.select().from(gyms).all()).toHaveLength(0);

    await runSyncCycle();

    // All four restored locally, landed clean.
    expect(database.select().from(gyms).where(eq(gyms.id, ids.gym)).get()?.name).toBe(
      'Round Trip Gym',
    );
    expect(
      database.select().from(sessions).where(eq(sessions.id, ids.session)).get()?.gymId,
    ).toBe(ids.gym);
    expect(
      database
        .select()
        .from(sessionExercises)
        .where(eq(sessionExercises.id, ids.sessionExercise))
        .get()?.sessionId,
    ).toBe(ids.session);
    expect(
      database
        .select()
        .from(exerciseSets)
        .where(eq(exerciseSets.id, ids.exerciseSet))
        .get()?.sessionExerciseId,
    ).toBe(ids.sessionExercise);
    expect(allFourClean()).toBe(true);

    // Each layer's cursor advanced (every layer drained at least one row).
    const cursorMap = readCursorMap();
    for (const layer of ['0', '1', '2', '3']) {
      expect(cursorMap[layer]).not.toBeNull();
      expect(cursorMap[layer]).toBeDefined();
    }
  }, 45_000);

  it('a no-op re-run with no local edits moves nothing and does not advance the cursors', async () => {
    // Push, then wipe + re-pull so the local store is fully converged with the
    // server and the cursors point past the last row.
    seedDirtyChain();
    await runSyncCycle();
    wipeLocalStore();
    await runSyncCycle();
    const cursorAfterDrain = readCursorMap();

    // A further cycle with nothing dirty and no new server rows is a no-op.
    await runSyncCycle();

    expect(allFourClean()).toBe(true);
    // No row was re-dirtied, and the cursors did not move (no new rows landed).
    expect(readCursorMap()).toEqual(cursorAfterDrain);
  }, 45_000);

  it('an edit injected mid-push keeps that row dirty (push-in-flight race)', async () => {
    seedDirtyChain();

    // Before EVERY push request, bump the gym row's monotonic timestamp after
    // the batch was serialised but before the ack lands. The cycle's ack
    // handler clears the dirty bit only when the row's current timestamp still
    // equals the one it sent; because the row moves on every in-flight window,
    // its ack never matches and it must end the cycle still dirty, carrying the
    // latest in-flight value (nothing is silently clobbered).
    let edits = 0;
    beforePushHook = () => {
      edits += 1;
      (database as unknown as { transaction: (fn: (tx: Transaction) => void) => void }).transaction(
        (tx) => {
          tx.update(gyms)
            .set({ localUpdatedAtMs: Date.now() + edits * 1000, name: `Edited In Flight ${edits}` })
            .where(eq(gyms.id, ids.gym))
            .run();
        },
      );
    };

    await runSyncCycle();

    // The gym carries the latest in-flight edit and stays dirty for a later
    // round; the other three rows, never touched mid-flight, converged clean.
    const gym = database.select().from(gyms).where(eq(gyms.id, ids.gym)).get();
    expect(edits).toBeGreaterThan(0);
    expect(gym?.name).toBe(`Edited In Flight ${edits}`);
    expect(gym?.localDirty).toBe(true);

    const others = [
      database.select().from(sessions).where(eq(sessions.id, ids.session)).get(),
      database
        .select()
        .from(sessionExercises)
        .where(and(eq(sessionExercises.id, ids.sessionExercise)))
        .get(),
      database.select().from(exerciseSets).where(eq(exerciseSets.id, ids.exerciseSet)).get(),
    ];
    for (const row of others) {
      expect(row?.localDirty).toBe(false);
    }
  }, 45_000);
});
