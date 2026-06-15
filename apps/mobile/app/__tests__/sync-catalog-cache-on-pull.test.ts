/**
 * Steady-state pull → exercise-catalog cache invalidation (single-device base case).
 *
 * The in-memory exercise-catalog cache mirrors the catalog tables and is the one
 * read model that does NOT re-read SQLite on every access. The first-sign-in
 * bootstrapper invalidates it after its pull, but the steady-state cycle used to
 * write pulled catalog changes straight to SQLite and leave the cache stale —
 * the running app would keep showing the old catalog until an unrelated local
 * write, a screen refocus, or an app restart. Every prior sync test asserted
 * only SQLite state, so this miss survived a green suite.
 *
 * These tests wire the REAL cache to the REAL cycle and detect invalidation
 * BEHAVIOURALLY (no spying on a module export): the cache only re-reads SQLite
 * when invalidated, so a probe row written straight to the DB (bypassing the
 * cache) reveals whether a reload happened. They prove:
 *   - a pulled rename becomes visible in the cache snapshot with no manual
 *     reload (the regression — the snapshot can only change if the cycle
 *     invalidated);
 *   - a quiet converged cycle does not invalidate (a DB-only probe stays hidden);
 *   - a push-only cycle does not invalidate (a push is invisible to readers).
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { exerciseDefinitions, gyms, syncRuntimeState } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
// Real cache: it subscribes to the real invalidation seam at import, and the
// cycle calls the real invalidation, so the cache reloads exactly when the cycle
// invalidates it. (babel hoists the jest.mock calls below above every import.)
import {
  ensureExerciseCatalogLoaded,
  getExerciseCatalogSnapshot,
  __resetExerciseCatalogCacheForTests,
} from '@/src/exercise-catalog/cache';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

const mockRpc = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};
const emptyPage = { entities: [], next_cursor: null, has_more: false };

const cursorFor = (id: string) => ({
  server_received_at: '2026-05-29T10:00:00.000Z',
  owner_user_id: 'u',
  type: 'exercise_definitions',
  id,
});

const exerciseEntity = (id: string, name: string, ms: number): WireEntity => ({
  type: 'exercise_definitions',
  id,
  client_updated_at_ms: ms,
  fields: { name, created_at: ms - 10, updated_at: ms, deleted_at: null },
});

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

/**
 * Renames an exercise straight in SQLite, bypassing the repo mutators (which
 * would invalidate). Used as a probe: if the cache later shows this name, it
 * re-read the DB — i.e. something invalidated it.
 */
const rawRenameExerciseInDb = (id: string, name: string): void => {
  database.update(exerciseDefinitions).set({ name }).where(eq(exerciseDefinitions.id, id)).run();
};

/** Flush the cache's fire-and-forget async reload to completion. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 25; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const catalogNames = (): string[] =>
  getExerciseCatalogSnapshot().exercises.map((exercise) => exercise.name);

const waitForCatalogName = async (name: string): Promise<void> => {
  for (let i = 0; i < 25; i += 1) {
    if (catalogNames().includes(name)) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`catalog snapshot never showed "${name}"; saw [${catalogNames().join(', ')}]`);
};

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  __resetExerciseCatalogCacheForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
});

afterEach(async () => {
  await settle();
  __resetExerciseCatalogCacheForTests();
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('catalog cache reacts to a steady-state pull', () => {
  it('makes a pulled rename visible in the cache snapshot with no manual reload', async () => {
    database
      .insert(exerciseDefinitions)
      .values({ id: 'ex-bench', name: 'Bench Press', localDirty: false, localUpdatedAtMs: 100 })
      .run();

    // Hydrate the cache once (as cold boot does); it shows the old name.
    await ensureExerciseCatalogLoaded();
    expect(catalogNames()).toEqual(['Bench Press']);

    // The server renames that exercise (strictly newer) and the cycle pulls it.
    let layer0Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Pulls += 1;
          if (layer0Pulls === 1) {
            return {
              data: {
                entities: [exerciseEntity('ex-bench', 'Bench Press (wide grip)', 200)],
                next_cursor: cursorFor('ex-bench'),
                has_more: false,
              },
              error: null,
            };
          }
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    // Without anyone calling ensureExerciseCatalogLoaded again, the cache snapshot
    // now reflects the renamed exercise. The snapshot can only change here if the
    // cycle invalidated the cache after applying the pulled rename.
    await waitForCatalogName('Bench Press (wide grip)');
    expect(catalogNames()).toEqual(['Bench Press (wide grip)']);
  });

  it('does not invalidate the cache on a quiet converged cycle', async () => {
    database
      .insert(exerciseDefinitions)
      .values({ id: 'ex-bench', name: 'Bench Press', localDirty: false, localUpdatedAtMs: 100 })
      .run();
    await ensureExerciseCatalogLoaded();
    expect(catalogNames()).toEqual(['Bench Press']);

    // Probe: change the DB out from under the cache without invalidating.
    rawRenameExerciseInDb('ex-bench', 'DB Only Probe');

    // Nothing dirty, every pull empty.
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');
    await settle();

    // The cache never re-read the DB (the probe stays hidden), proving the quiet
    // cycle did not invalidate.
    expect(catalogNames()).toEqual(['Bench Press']);
  });

  it('does not invalidate the cache on a push-only cycle', async () => {
    database
      .insert(exerciseDefinitions)
      .values({ id: 'ex-bench', name: 'Bench Press', localDirty: false, localUpdatedAtMs: 100 })
      .run();
    // A dirty gym makes this a real push, but a push changes nothing a reader sees.
    database
      .insert(gyms)
      .values({ id: 'gym-1', name: 'Local', localDirty: true, localUpdatedAtMs: 50 })
      .run();
    await ensureExerciseCatalogLoaded();
    expect(catalogNames()).toEqual(['Bench Press']);

    rawRenameExerciseInDb('ex-bench', 'DB Only Probe');

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') {
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');
    await settle();

    // The push happened (gym cleared) but no pull applied a change, so the cache
    // was left alone (probe stays hidden).
    expect(
      database.select({ d: gyms.localDirty }).from(gyms).where(eq(gyms.id, 'gym-1')).get()?.d,
    ).toBe(false);
    expect(catalogNames()).toEqual(['Bench Press']);
  });
});
