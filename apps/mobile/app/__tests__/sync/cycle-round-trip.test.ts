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
 * The suite does NOT wipe the test user's server rows between cases: the shared
 * fixture user's server state accumulates across cases and across repeated runs,
 * and isolation comes solely from minting a unique row-id set per `it`, so
 * concurrent or repeated runs never collide. Each fixture database is stood up
 * the way production boot does — fully migrated, then seeded via the real
 * `seedBootDataLayer` (which populates the client-only `muscle_groups`
 * taxonomy) — so a pulled `exercise_muscle_mappings` row never violates its FK
 * into `muscle_groups`, exactly as in production.
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

jest.mock('@/src/data/bootstrap', () => ({
  // The cycle resolves its local DB through the mocked `bootstrapLocalDataLayer`
  // (a bare in-memory DB), but the TEST seeds that DB the same way production
  // boot does — by calling the REAL `seedBootDataLayer`. Re-export the actual
  // helper from `jest.requireActual` so the test and production share one seeding
  // path; the mock cannot silently drift from what boot prepares.
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

// `seedBootDataLayer` is the REAL boot-time seed (re-exported from the actual
// module by the mock above); production runs it unconditionally at boot, so the
// test runs it too — see `seedFixtureDatabase`.
import { seedBootDataLayer } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
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

interface ChainIds {
  gym: string;
  session: string;
  sessionExercise: string;
  exerciseSet: string;
}

// A fresh, globally-unique id set per `it`. The suite no longer wipes the
// server between cases (see `beforeEach`), so the fixture user's server rows
// ACCUMULATE across cases and across repeated runs. Minting a distinct prefix
// for every case keeps each case's four-row chain isolated on that shared,
// growing server — two cases (or two back-to-back lane runs) can never collide
// on a primary key, and one case's leftover rows are invisible to the next.
let chainSeq = 0;
const makeChainIds = (): ChainIds => {
  chainSeq += 1;
  const run = `rt-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${chainSeq}`;
  return {
    gym: `${run}-gym`,
    session: `${run}-session`,
    sessionExercise: `${run}-sx`,
    exerciseSet: `${run}-set`,
  };
};

type PushHook = (() => void) | null;

describe('sync cycle round-trip against a live endpoint', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let authed: AuthedBranchClient;
  // The unique row-id set for the case currently running; assigned at the top of
  // each `it` from `makeChainIds()`.
  let ids: ChainIds;
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

  // Stand up a fresh fixture DB exactly the way production boot prepares the
  // local data layer: a fully-migrated store (done by `createInMemoryDatabase`)
  // PLUS the unconditional boot seed (`seedBootDataLayer`), which populates the
  // client-only `muscle_groups` taxonomy. That seed is the boot step the mock
  // used to skip; without it, `exercise_muscle_mappings` pulled back on the
  // re-pull path violate their NOT NULL FK into the empty `muscle_groups` table
  // and the whole pull page aborts. Running the real seed here makes the test
  // faithful to production, where boot always seeds `muscle_groups` first.
  //
  // The better-sqlite3 fixture enforces foreign keys by default (PRAGMA
  // foreign_keys defaults ON), the same as the production expo-sqlite handle, so
  // this seed is load-bearing rather than cosmetic.
  const seedFixtureDatabase = (): void => {
    seedBootDataLayer(database as never);
  };

  // Re-create a fresh, empty local store so the re-pull starts from nothing —
  // mirrors wiping the local database on a reinstall, which re-runs boot
  // (migrations + `seedBootDataLayer`) before any sync.
  const wipeLocalStore = (): void => {
    fixture.close();
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedFixtureDatabase();
  };

  beforeAll(async () => {
    authed = await createAuthedBranchClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(() => {
    beforePushHook = null;
    // A fresh id set per case: the server is no longer wiped between cases, so
    // its rows accumulate across cases and across repeated lane runs. Unique ids
    // keep each case's chain isolated on that shared, growing fixture-user store.
    ids = makeChainIds();
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedFixtureDatabase();
    mockClientState.client = wrapClientWithPushHook(authed.client);

    // NOTE: we intentionally do NOT wipe the server here. The previous
    // `dev_wipe_my_data` call no-opped over the local PostgREST path anyway (it
    // returns FORBIDDEN_ENV because the local stack never sets `app.env`), so the
    // suite leaned on per-run unique ids for isolation rather than on the wipe.
    // Dropping it makes that the explicit, sole isolation mechanism and keeps the
    // suite robust against a non-empty / accumulating server. A focused
    // dev-wipe-my-data test can be extracted separately if that affordance ever
    // needs its own coverage.
  });

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
    // layer directly through the authed client. The fixture user's server rows
    // accumulate across cases and runs (no wipe), so a single fixed-size page is
    // not guaranteed to contain THIS run's freshly pushed rows; drain every page
    // of each layer by following the cursor until the server reports no more.
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA);
    const seen = new Set<string>();
    for (let layer = 0; layer < 4; layer += 1) {
      let cursor: unknown = null;
      // Bounded loop: the server always advances the cursor and eventually
      // reports `has_more = false`; the cap is a safety stop against a runaway.
      for (let guard = 0; guard < 1000; guard += 1) {
        const page = (await scoped.rpc('sync_pull', { layer, cursor, limit: 200 })) as {
          data?: {
            entities?: { type: string; id: string }[];
            next_cursor?: unknown;
            has_more?: boolean;
          };
        };
        for (const entity of page.data?.entities ?? []) {
          seen.add(`${entity.type}:${entity.id}`);
        }
        if (!page.data?.has_more) {
          break;
        }
        cursor = page.data?.next_cursor ?? null;
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
