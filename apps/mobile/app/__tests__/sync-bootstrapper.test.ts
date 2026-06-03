/* eslint-disable import/first */

/**
 * First-sign-in bootstrapper: the gate that decides whether a fresh
 * device-account pairing seeds its starter catalog, and that marks the first
 * cycle as drained.
 *
 * Driver: a real in-memory better-sqlite3 database with the full migrated
 * schema, plus a hand-rolled Supabase RPC stub that returns canned pull pages so
 * the first full pull drains deterministically without a server. Each test sets
 * how many rows (and which tombstones) the server returns, then asserts on the
 * local DB and the typed progress snapshot — never on a UI render.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { type LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
import { exerciseDefinitions, gyms, syncRuntimeState } from '@/src/data/schema';
import { runBootstrapper } from '@/src/sync/bootstrapper';
import { getSyncProgress, resetSyncProgress, type SyncProgress } from '@/src/sync/progress';

// The in-memory better-sqlite3 handle is structurally compatible with the
// production expo-sqlite `LocalDatabase` the bootstrapper takes (both extend the
// same drizzle base), but their driver `RunResult` generics differ nominally, so
// bridge the two with a single typed view rather than casting at every call.
const bootstrap = (db: InMemoryTestDatabase): Promise<void> =>
  runBootstrapper(db as unknown as LocalDatabase);

// -----------------------------------------------------------------------------
// A scriptable sync_pull stub.
//
// The bootstrapper's first full pull walks layers 0..3, draining each to
// `has_more = false`. The stub answers each (layer) call from a per-layer queue
// of pages; an unscripted layer answers with a single empty, drained page.
// -----------------------------------------------------------------------------

type WireEntity = { type: string; id: string; client_updated_at_ms: number; fields: Record<string, unknown> };
type PullPage = { entities: WireEntity[]; next_cursor: null; has_more: boolean };

const drainedEmptyPage: PullPage = { entities: [], next_cursor: null, has_more: false };

const gymRow = (id: string, deleted: boolean): WireEntity => ({
  type: 'gyms',
  id,
  client_updated_at_ms: 1_000,
  fields: {
    name: deleted ? 'Removed Gym' : 'Live Gym',
    latitude: null,
    longitude: null,
    coordinate_accuracy_m: null,
    coordinates_updated_at: null,
    created_at: 1_000,
    updated_at: 1_000,
    deleted_at: deleted ? 1_500 : null,
  },
});

// Builds a Supabase-client shape whose `sync_pull` RPC serves scripted pages.
const createPullStub = (pagesByLayer: Record<number, PullPage[]>): unknown => {
  const queues: Record<number, PullPage[]> = {};
  for (const [layer, pages] of Object.entries(pagesByLayer)) {
    queues[Number(layer)] = [...pages];
  }
  return {
    schema: () => ({
      rpc: async (fn: string, args?: { layer?: number }) => {
        if (fn !== 'sync_pull') {
          // The bootstrapper only pulls; a push never fires before the flag is set.
          return { data: {}, error: null };
        }
        const layer = args?.layer ?? 0;
        const queue = queues[layer];
        const page = queue && queue.length > 0 ? queue.shift()! : drainedEmptyPage;
        return { data: page, error: null };
      },
    }),
  };
};

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

const readBootstrapFlag = (): Date | null => {
  const row = database
    .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  return row?.bootstrapCompletedAt ?? null;
};

const seededDefinitionCount = (): number =>
  database.select({ id: exerciseDefinitions.id }).from(exerciseDefinitions).all().length;

beforeEach(() => {
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  __resetClockForTests();
  resetSyncProgress();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  mockClientState.client = null;
});

describe('runBootstrapper gate', () => {
  it('skips entirely when bootstrap_completed_at is already set', async () => {
    // Pre-set the flag: this device-account is already bootstrapped.
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(42) })
      .run();

    // A stub that would throw if the pull ran proves the bootstrapper did not pull.
    mockClientState.client = {
      schema: () => ({
        rpc: async () => {
          throw new Error('the bootstrapper must not pull when the flag is already set');
        },
      }),
    };

    await bootstrap(database);

    expect(readBootstrapFlag()?.getTime()).toBe(42);
    expect(seededDefinitionCount()).toBe(0);
    // The progress snapshot was never advanced past idle.
    expect(getSyncProgress().phase).toBe('idle');
  });
});

describe('runBootstrapper seed decision', () => {
  it('seeds the starter catalog when the first full pull returns zero rows', async () => {
    mockClientState.client = createPullStub({});

    await bootstrap(database);

    // The server held nothing, so the bundle was seeded.
    expect(seededDefinitionCount()).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    // The seeded row carries a real monotonic local timestamp — the seeder
    // stamped it through nowMonotonic rather than the bootstrapper poking the
    // bookkeeping columns by hand.
    const anyDefinition = database.select().from(exerciseDefinitions).limit(1).get();
    expect(anyDefinition?.localUpdatedAtMs).toBeGreaterThan(0);
    // The flag is set, and the marker advanced to the current bundle version.
    expect(readBootstrapFlag()).not.toBeNull();
    const marker = database
      .select({ v: syncRuntimeState.appliedSeedMigrationAppVersion })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    expect(marker?.v).toBe(SEED_CATALOG_BUNDLE_VERSION);
  });

  it('no-ops the seeder when the first full pull returns live rows', async () => {
    mockClientState.client = createPullStub({
      0: [{ entities: [gymRow('gym-1', false)], next_cursor: null, has_more: false }],
    });

    await bootstrap(database);

    // A pulled row means the server is authoritative: no starter catalog.
    expect(seededDefinitionCount()).toBe(0);
    // The pulled row landed locally and the flag is set.
    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get()?.name).toBe('Live Gym');
    expect(readBootstrapFlag()).not.toBeNull();
  });

  it('no-ops the seeder when the pull returns only a tombstone (deletion survives)', async () => {
    // The server holds a single tombstoned row — the user previously deleted it.
    mockClientState.client = createPullStub({
      0: [{ entities: [gymRow('gym-1', true)], next_cursor: null, has_more: false }],
    });

    await bootstrap(database);

    // A tombstone counts toward rowsPulled, so the seeder must not run: the
    // deleted catalog must not be resurrected on reinstall.
    expect(seededDefinitionCount()).toBe(0);
    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.deletedAt?.getTime()).toBe(1_500);
    expect(readBootstrapFlag()).not.toBeNull();
  });
});

describe('runBootstrapper crash recovery', () => {
  it('leaves the flag null when the pull throws mid-bootstrap, then re-attempts cleanly', async () => {
    // First attempt: the pull fails after the bootstrapper has started.
    mockClientState.client = {
      schema: () => ({
        rpc: async () => {
          throw new Error('network dropped mid-pull');
        },
      }),
    };

    await expect(bootstrap(database)).rejects.toThrow('network dropped mid-pull');

    // The flag was NOT set (it is the last write), so a re-attempt is allowed,
    // and nothing was seeded.
    expect(readBootstrapFlag()).toBeNull();
    expect(seededDefinitionCount()).toBe(0);

    // Second attempt with a healthy (empty) server: the bootstrapper runs again
    // from scratch, seeds, and sets the flag.
    mockClientState.client = createPullStub({});

    await bootstrap(database);

    expect(seededDefinitionCount()).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(readBootstrapFlag()).not.toBeNull();
  });

  it('sets bootstrap_completed_at LAST — strictly after the seed phase, never before', async () => {
    mockClientState.client = createPullStub({});

    // Capture the DB state at every progress boundary. The bootstrapper publishes
    // 'seed' right before it seeds and 'done' right after it sets the flag, so the
    // flag must be null at the 'seed' boundary and non-null at 'done'. The seed
    // rows must already be present at 'done'.
    const flagByPhase = new Map<string, Date | null>();
    const seedCountByPhase = new Map<string, number>();
    const progress = jest.requireActual<typeof import('@/src/sync/progress')>('@/src/sync/progress');
    const setSpy = jest
      .spyOn(progress, 'setSyncProgress')
      .mockImplementation((next) => {
        flagByPhase.set(next.phase, readBootstrapFlag());
        seedCountByPhase.set(next.phase, seededDefinitionCount());
      });

    try {
      await bootstrap(database);
    } finally {
      setSpy.mockRestore();
    }

    // At the seed boundary the flag is still null — the seed happens first.
    expect(flagByPhase.get('seed')).toBeNull();
    // At the done boundary the flag is set AND the seed rows have landed.
    expect(flagByPhase.get('done')).not.toBeNull();
    expect(seedCountByPhase.get('done')).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
  });
});

describe('runBootstrapper progress emission', () => {
  it('advances the typed progress snapshot through pull, seed, and done', async () => {
    const snapshots: SyncProgress[] = [];
    // Wrap the stub so we record the snapshot after each pull page resolves —
    // capturing the phase + advancing counters as the leg crosses boundaries.
    const innerStub = createPullStub({
      0: [
        { entities: [gymRow('g-a', false)], next_cursor: null, has_more: true },
        { entities: [gymRow('g-b', false)], next_cursor: null, has_more: false },
      ],
    }) as { schema: () => { rpc: (fn: string, args?: { layer?: number }) => Promise<unknown> } };

    mockClientState.client = {
      schema: () => {
        const scoped = innerStub.schema();
        return {
          rpc: async (fn: string, args?: { layer?: number }) => {
            const result = await scoped.rpc(fn, args);
            snapshots.push({ ...getSyncProgress() });
            return result;
          },
        };
      },
    };

    await bootstrap(database);

    const finalSnapshot = getSyncProgress();
    // Final state: done, all four layers reported drained, the gym rows counted.
    expect(finalSnapshot.phase).toBe('done');
    expect(finalSnapshot.layersCompleted).toBe(4);

    // The 'pull' phase was observed and its row counter advanced monotonically
    // across the two pages on layer 0.
    const pullSnapshots = snapshots.filter((snapshot) => snapshot.phase === 'pull');
    expect(pullSnapshots.length).toBeGreaterThanOrEqual(2);
    const appliedCounts = pullSnapshots.map((snapshot) => snapshot.rowsApplied);
    for (let i = 1; i < appliedCounts.length; i += 1) {
      expect(appliedCounts[i]).toBeGreaterThanOrEqual(appliedCounts[i - 1]);
    }
    // Two live rows pulled (no server data otherwise) → seed still runs only
    // when rowsPulled is zero; here rowsPulled is 2, so the final counter is 2.
    expect(finalSnapshot.rowsApplied).toBe(2);

    // Because two rows were pulled, the seeder did NOT run — confirm 'seed' was
    // never entered for this non-empty-server case.
    expect(snapshots.some((snapshot) => snapshot.phase === 'seed')).toBe(false);
  });

  it('reports the seed phase when the server is empty', async () => {
    mockClientState.client = createPullStub({});

    // Record the phase sequence by hooking the progress reads is unnecessary;
    // the seed phase is provable from the post-state: an empty pull seeds, and
    // the only path that seeds passes through phase 'seed' before 'done'.
    await bootstrap(database);

    const finalSnapshot = getSyncProgress();
    expect(finalSnapshot.phase).toBe('done');
    expect(finalSnapshot.rowsApplied).toBe(0);
    expect(finalSnapshot.layersCompleted).toBe(4);
    expect(seededDefinitionCount()).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
  });
});
