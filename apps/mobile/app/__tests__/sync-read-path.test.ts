/**
 * Read-path-after-sync coverage (single-device base case).
 *
 * The sync cycle's existing fast-lane tests all assert the cycle's SQLite
 * end-state (the row landed, the dirty bit cleared, the cursor advanced). None
 * of them prove the thing the running app actually depends on: that a row the
 * server PUSHED DOWN is then surfaced — and correctly filtered — by the real
 * repository READ APIs the screens call. That gap is exactly where past misses
 * lived (a value lands in SQLite but the read layer never reflects it).
 *
 * These tests drive the real `runSyncCycle` (server stubbed at the RPC seam,
 * real in-memory SQLite) and then call the REAL read APIs:
 *   - `listSessionListBuckets()` must surface a pulled session.
 *   - `listExerciseCatalogExercises()` must HIDE a pulled tombstone while
 *     `{ includeDeleted: true }` still returns it.
 *
 * The exercise-catalog in-memory cache is intentionally NOT loaded here (no
 * import of `@/src/exercise-catalog/cache`), so the cycle's catalog-cache
 * invalidation is a no-op and these tests isolate the repository read path. The
 * cache's own visibility guarantee is proven in
 * `sync-catalog-cache-on-pull.test.ts`.
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { exerciseDefinitions, syncRuntimeState } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
// The real repos resolve their db handle through the mocked bootstrap (babel
// hoists the jest.mock calls below above every import, and each mock factory
// defers its variable references to call time).
import { listSessionListBuckets } from '@/src/data/session-list';
import { listExerciseCatalogExercises } from '@/src/data/exercise-catalog';

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

const emptyPage = { entities: [], next_cursor: null, has_more: false };
const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};

const cursorFor = (type: string, id: string) => ({
  server_received_at: '2026-05-29T10:00:00.000Z',
  owner_user_id: 'u',
  type,
  id,
});

/** A pulled, already-completed session envelope (layer 1). */
const completedSessionEntity = (id: string, ms: number): WireEntity => ({
  type: 'sessions',
  id,
  client_updated_at_ms: ms,
  fields: {
    gym_id: null,
    status: 'completed',
    started_at: ms,
    completed_at: ms + 1,
    duration_sec: 3600,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

/** A pulled tombstone for an exercise definition (layer 0). */
const exerciseTombstoneEntity = (id: string, name: string, ms: number): WireEntity => ({
  type: 'exercise_definitions',
  id,
  client_updated_at_ms: ms,
  fields: {
    name,
    created_at: ms - 10,
    updated_at: ms,
    deleted_at: ms,
  },
});

/** Marks bootstrap complete so the cycle skips first-sign-in seeding. */
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

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('read path reflects server-pulled rows', () => {
  it('surfaces a pulled completed session through listSessionListBuckets', async () => {
    // Layer-1 pull #1 hands back one completed session; every other pull empty.
    let layer1Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 1) {
          layer1Pulls += 1;
          if (layer1Pulls === 1) {
            return {
              data: {
                entities: [completedSessionEntity('sess-pulled', 1000)],
                next_cursor: cursorFor('sessions', 'sess-pulled'),
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

    // Before the cycle the read API shows nothing.
    expect((await listSessionListBuckets()).completed).toHaveLength(0);

    await expect(runSyncCycle()).resolves.toBe('converged');

    // After the cycle the real session-list read surfaces the pulled session —
    // proving the row is not just in SQLite but visible to the screen's reader.
    const buckets = await listSessionListBuckets();
    expect(buckets.completed.map((summary) => summary.id)).toEqual(['sess-pulled']);
    expect(buckets.active).toBeNull();
  });

  it('hides a pulled tombstone from listExerciseCatalogExercises but keeps it under includeDeleted', async () => {
    // A clean, live exercise definition already on this device.
    database
      .insert(exerciseDefinitions)
      .values({ id: 'ex-squat', name: 'Squat', localDirty: false, localUpdatedAtMs: 100 })
      .run();
    expect((await listExerciseCatalogExercises()).map((exercise) => exercise.id)).toEqual([
      'ex-squat',
    ]);

    // The server pulls down a strictly-newer tombstone for that same row.
    let layer0Pulls = 0;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0) {
          layer0Pulls += 1;
          if (layer0Pulls === 1) {
            return {
              data: {
                entities: [exerciseTombstoneEntity('ex-squat', 'Squat', 200)],
                next_cursor: cursorFor('exercise_definitions', 'ex-squat'),
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

    // The LWW tombstone applied (deleted_at set) and the default read filters it.
    expect(await listExerciseCatalogExercises()).toHaveLength(0);

    // includeDeleted still returns it, now carrying the tombstone.
    const all = await listExerciseCatalogExercises({ includeDeleted: true });
    expect(all.map((exercise) => exercise.id)).toEqual(['ex-squat']);
    expect(all[0].deletedAt).not.toBeNull();

    // And the row is clean locally (pulled, not dirty).
    const row = database
      .select({ localDirty: exerciseDefinitions.localDirty })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, 'ex-squat'))
      .get();
    expect(row?.localDirty).toBe(false);
  });
});
