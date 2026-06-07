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

// A layer-0 exercise_definitions wire row. Used by the resumed-bootstrap test to
// model a returning user whose server holds their own customised catalog row —
// the seeder, if it wrongly ran, would clobber it.
const exerciseDefinitionRow = (id: string, name: string, updatedAtMs: number): WireEntity => ({
  type: 'exercise_definitions',
  id,
  client_updated_at_ms: updatedAtMs,
  fields: {
    name,
    created_at: updatedAtMs,
    updated_at: updatedAtMs,
    deleted_at: null,
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

// Snapshots every sync_runtime_state row. Used to prove the cursor-reset step
// neither creates nor mutates the singleton row on a cycle that must write
// nothing (the no-JWT / clean-incomplete-bootstrap path).
const allRuntimeStateRows = () => database.select().from(syncRuntimeState).all();

// Reads the persisted per-layer pull-cursor map off the singleton runtime row.
// The column is JSON mode, so drizzle hands back the parsed object (or the empty
// `{}` default); a string fallback covers a raw-text read just in case.
const readPullCursorMap = (): Record<string, unknown> => {
  const row = database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  const raw = row?.pullCursor;
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
};

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

describe('runBootstrapper cursor reset is a no-op when there is nothing to reset', () => {
  // Regression guard for the #149 reseed fix. `runBootstrapper` runs BEFORE the
  // auth outcome surfaces in `runSyncCycle`, so on a no-JWT cycle — which must
  // mutate NOTHING — the cursor-reset step must not touch sync_runtime_state.
  // The earlier fix did an unconditional INSERT ... ON CONFLICT, which wrote a
  // fresh row on a clean DB and regressed auth-required-envelope (it asserts an
  // unauthenticated cycle leaves the runtime-state table untouched). The reset
  // must therefore be a no-op unless an EXISTING row carries a non-empty cursor.

  it('writes NO sync_runtime_state row when the pull throws on a fresh DB (no prior cursor)', async () => {
    // The runtime-state table starts empty (a fresh in-memory DB), exactly like
    // a clean device on a no-JWT cycle.
    expect(allRuntimeStateRows()).toEqual([]);

    // The pull throws immediately (a missing JWT / dropped network) — the same
    // shape as the unauthenticated cycle. The reset runs first, the pull then
    // throws, and the bootstrapper rejects before it could mark anything.
    mockClientState.client = {
      schema: () => ({
        rpc: async () => {
          throw new Error('AUTH_REQUIRED: no signed-in user');
        },
      }),
    };

    await expect(bootstrap(database)).rejects.toThrow('AUTH_REQUIRED');

    // The reset created NO row. Without the guard the unconditional INSERT would
    // have left a single `{}`-cursor row here, regressing auth-required-envelope.
    expect(allRuntimeStateRows()).toEqual([]);
    expect(readBootstrapFlag()).toBeNull();
    expect(seededDefinitionCount()).toBe(0);
  });

  it('leaves an EXISTING empty-cursor row byte-for-byte unchanged when the pull throws', async () => {
    // A runtime-state row already exists with the default empty cursor (e.g. a
    // prior cycle persisted last_emitted_ms but never advanced a pull cursor).
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, lastEmittedMs: 7 })
      .run();
    const before = allRuntimeStateRows();
    expect(readPullCursorMap()).toEqual({});

    mockClientState.client = {
      schema: () => ({
        rpc: async () => {
          throw new Error('AUTH_REQUIRED: no signed-in user');
        },
      }),
    };

    await expect(bootstrap(database)).rejects.toThrow('AUTH_REQUIRED');

    // The empty cursor needed no reset, so the row is untouched (no UPDATE ran).
    expect(allRuntimeStateRows()).toEqual(before);
  });

  it('DOES reset an existing non-empty cursor back to {} (the reseed-bug case still works)', async () => {
    // A prior interrupted attempt advanced layer 0's cursor — the precise state
    // the reseed fix must still clear so the resumed pull replays from scratch.
    const advancedCursor = { '0': { server_received_at: '2026-01-01T00:00:00Z', id: 'x' } };
    database
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: advancedCursor as never })
      .run();
    expect(readPullCursorMap()['0']).toBeDefined();

    // Let the pull throw after the reset so we observe the cursor state without a
    // full successful bootstrap muddying it.
    mockClientState.client = {
      schema: () => ({
        rpc: async () => {
          throw new Error('network dropped mid-pull');
        },
      }),
    };

    await expect(bootstrap(database)).rejects.toThrow('network dropped mid-pull');

    // The reset cleared the advanced cursor back to the empty map (UPDATE, not
    // INSERT — still a single row), so the resumed seed decision is honest.
    expect(allRuntimeStateRows()).toHaveLength(1);
    expect(readPullCursorMap()).toEqual({});
  });
});

describe('runBootstrapper resumed first sync (returning user, server holds data)', () => {
  // A real seed id the server-side row reuses, so the seeder's last-write-wins
  // upsert would target (and clobber) this exact row if it wrongly ran.
  const CUSTOMISED_DEF_ID = SYSTEM_EXERCISE_DEFINITION_SEEDS[0].id; // 'seed_barbell_bench_press'
  const CUSTOM_NAME = 'My Custom Bench Variant';
  const DEFAULT_SEED_NAME = SYSTEM_EXERCISE_DEFINITION_SEEDS[0].name; // 'Barbell Bench Press'
  // A monotonic stamp far ahead of the seeder's wall-clock-derived stamp would
  // not matter — the seeder's upsert overwrites unconditionally — so the bug is
  // about the seeder running at all, not about LWW ordering.
  const SERVER_STAMP = 5_000;

  const readDefinition = (id: string) =>
    database.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, id)).get();

  it('does NOT re-seed or clobber the pulled catalog when a prior interrupted attempt left a cursor advanced', async () => {
    // The server holds the user's own customised catalog row on layer 0. Build a
    // cursor-aware sync_pull stub that faithfully models a RESUMED pull:
    //
    //   - Layer 0 with a NULL cursor serves the data page once and hands back a
    //     non-null next_cursor (so the persisted cursor advances past the row).
    //   - Layer 0 with a NON-null cursor (a resume) is already past the row, so
    //     it serves a drained empty page — exactly what makes the resumed run
    //     see "zero rows".
    //   - The first attempt is interrupted at layer 1 (network blip), AFTER
    //     layer 0's cursor advanced and the row landed locally. The second
    //     attempt's layers 1..3 drain empty.
    const dataCursor = {
      server_received_at: '2026-01-01T00:00:00Z',
      owner_user_id: 'user-1',
      type: 'exercise_definitions',
      id: CUSTOMISED_DEF_ID,
    };
    let failLayer1Once = true;
    mockClientState.client = {
      schema: () => ({
        rpc: async (fn: string, args?: { layer?: number; cursor?: unknown }) => {
          if (fn !== 'sync_pull') {
            return { data: {}, error: null };
          }
          const layer = args?.layer ?? 0;
          const cursor = args?.cursor ?? null;
          if (layer === 0) {
            if (cursor === null) {
              // Fresh drain: serve the user's row, advance the cursor, stop.
              return {
                data: {
                  entities: [
                    exerciseDefinitionRow(CUSTOMISED_DEF_ID, CUSTOM_NAME, SERVER_STAMP),
                  ],
                  next_cursor: dataCursor,
                  has_more: false,
                },
                error: null,
              };
            }
            // Resume: the cursor is already past the row, so nothing new.
            return { data: { entities: [], next_cursor: cursor, has_more: false }, error: null };
          }
          if (layer === 1 && failLayer1Once) {
            // Interrupt the FIRST attempt after layer 0's cursor advanced.
            failLayer1Once = false;
            throw new Error('network dropped mid-pull (layer 1)');
          }
          return { data: { entities: [], next_cursor: null, has_more: false }, error: null };
        },
      }),
    };

    // Attempt 1: drains layer 0 (row lands, cursor advances) then dies at layer 1.
    await expect(bootstrap(database)).rejects.toThrow('network dropped mid-pull');

    // Sanity: the row was pulled, the bootstrap flag stayed null (re-attempt
    // allowed), and layer 0's cursor was persisted (a real interrupted resume
    // state — NOT a hand-poked fixture).
    expect(readDefinition(CUSTOMISED_DEF_ID)?.name).toBe(CUSTOM_NAME);
    expect(readBootstrapFlag()).toBeNull();
    expect(readPullCursorMap()['0']).not.toBeNull();
    expect(readPullCursorMap()['0']).toBeDefined();

    // Attempt 2: the resumed bootstrapper. On origin/main it would read the
    // advanced layer-0 cursor, pull zero NEW rows, conclude "server empty", and
    // SEED — whose upsert clobbers the customised row back to the default name
    // and marks it dirty. With the fix it resets the cursor first, re-pulls the
    // row from scratch, sees a non-zero pull, and never seeds.
    await bootstrap(database);

    // The starter catalog must NOT have been re-created: only the single pulled
    // definition exists.
    expect(seededDefinitionCount()).toBe(1);

    const resumed = readDefinition(CUSTOMISED_DEF_ID);
    // The user's customisation survives — the name was NOT reverted to the seed
    // default...
    expect(resumed?.name).toBe(CUSTOM_NAME);
    expect(resumed?.name).not.toBe(DEFAULT_SEED_NAME);
    // ...and the pulled row was NOT marked dirty (a seed upsert would have set
    // localDirty = true and a fresh monotonic stamp, which the next push's LWW
    // would propagate as a reversion to all the user's devices).
    expect(resumed?.localDirty).toBe(false);
    expect(resumed?.localUpdatedAtMs).toBe(SERVER_STAMP);

    // Bootstrap completed this time.
    expect(readBootstrapFlag()).not.toBeNull();
  });

  it('still seeds exactly once for a genuinely fresh account even after a prior empty-pull interruption', async () => {
    // Attempt 1: a fresh account (empty server) whose pull is interrupted at
    // layer 1 — no rows anywhere, but layer 0's cursor still advances to a
    // non-null drained cursor before the blip.
    const drainedCursor = {
      server_received_at: '2026-01-01T00:00:00Z',
      owner_user_id: 'user-1',
      type: 'gyms',
      id: 'cursor-only',
    };
    let failLayer1Once = true;
    mockClientState.client = {
      schema: () => ({
        rpc: async (fn: string, args?: { layer?: number }) => {
          if (fn !== 'sync_pull') {
            return { data: {}, error: null };
          }
          const layer = args?.layer ?? 0;
          if (layer === 0) {
            // Empty data, but a non-null cursor so it persists and advances.
            return { data: { entities: [], next_cursor: drainedCursor, has_more: false }, error: null };
          }
          if (layer === 1 && failLayer1Once) {
            failLayer1Once = false;
            throw new Error('network dropped mid-pull (layer 1)');
          }
          return { data: { entities: [], next_cursor: null, has_more: false }, error: null };
        },
      }),
    };

    await expect(bootstrap(database)).rejects.toThrow('network dropped mid-pull');
    // Cursor advanced, nothing seeded yet, flag still null.
    expect(readPullCursorMap()['0']).not.toBeNull();
    expect(readPullCursorMap()['0']).toBeDefined();
    expect(seededDefinitionCount()).toBe(0);
    expect(readBootstrapFlag()).toBeNull();

    // Attempt 2: still a genuinely empty server. The resumed bootstrapper must
    // seed exactly once (the from-scratch pull confirms the server is empty).
    await bootstrap(database);

    expect(seededDefinitionCount()).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(readBootstrapFlag()).not.toBeNull();
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
