/* eslint-disable import/first */

/**
 * Outcome: a device restores an account completely from the live server — on a
 * fresh install, and after the device switches from another account — over the
 * real cycle, real Postgres + PostgREST + RLS, and real multi-page cursors. No
 * simulator: each "device" is an in-memory, fully migrated local database.
 *
 *   1. Sync from scratch. An account with a multi-page history (more than one
 *      200-row page in each of layers 1-3) is restored onto a fresh device, and
 *      the device ends up holding exactly the rows the writing device holds,
 *      table by table, id by id.
 *   2. Re-sync after changing user. A device that synced account F (so it holds
 *      F's rows, bootstrap flag and per-layer pull cursors) syncs as account E
 *      with no sign-out in between — an expired or unreadable session, then a
 *      sign-in as someone else. The server rows are ordered so that F's stale
 *      cursors would skip E's sessions (layer 1) but still pull E's session
 *      exercises (layer 2): the shape of the production failure, where every
 *      retry died on `LOCAL_FK_VIOLATION`. The cycle must instead wipe F's data
 *      and restore E from scratch.
 *
 * Each test resets its dedicated fixture users' server rows first (`user_e`,
 * `user_f` — no other suite or flow signs in as them), so repeated runs in one
 * slot start alike. Runs in the sync-infra lane (`./boga test sync-infra`); the
 * fast lane excludes it. The stubbed-server version of the same guard is
 * `__tests__/sync-account-ownership.test.ts`.
 */

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedTestClient,
  readSyncTestEndpoint,
  resetFixtureServerRows,
  USER_E,
  USER_F,
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

import { getTableName } from 'drizzle-orm';

import { getSignedInUserId } from '@/src/auth/session-user';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests } from '@/src/data/clock';
import { readLocalDataOwner } from '@/src/data/local-wipe';
import * as schema from '@/src/data/schema';
import { exerciseSets, sessionExercises, sessions, syncRuntimeState } from '@/src/data/schema';
import { __resetAccountWipeForTests } from '@/src/sync/account-wipe';
import { __resetCycleErrorSignalForTests, getCycleErrorDetail } from '@/src/sync/cycle-error-signal';
import { runSyncCycle } from '@/src/sync/cycle';
import { TOPO_LAYERS } from '@/src/sync/topo-order';

const config = readSyncTestEndpoint();
const mockedSignedInUserId = jest.mocked(getSignedInUserId);

// More than one 200-row pull page in layers 1 (sessions), 2 and 3.
const HISTORY_SESSIONS = 210;
const LIVE_TIMEOUT_MS = 180_000;

let userE: AuthedTestClient;
let userF: AuthedTestClient;
const devices: InMemoryDatabaseFixture[] = [];

const newDevice = (): InMemoryTestDatabase => {
  const fixture = createInMemoryDatabase();
  devices.push(fixture);
  return fixture.database;
};

/** One cycle on `device`, signed in as `account` (the session the cycle syncs with). */
const syncAs = (device: InMemoryTestDatabase, account: AuthedTestClient) => {
  mockBootstrapState.database = device;
  mockClientState.client = account.client;
  mockedSignedInUserId.mockResolvedValue(account.userId);
  return runSyncCycle();
};

let runSeq = 0;
const runTag = (): string => {
  runSeq += 1;
  return `fdas-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${runSeq}`;
};

/** Logs `count` completed workouts on `device` (dirty, so the next cycle pushes them). */
const logSessions = (device: InMemoryTestDatabase, tag: string, count: number): string[] => {
  const base = Date.now();
  const ids = Array.from({ length: count }, (_, index) => `${tag}-session-${index}`);
  device.transaction((tx) => {
    ids.forEach((id, index) => {
      tx.insert(sessions)
        .values({
          id,
          status: 'completed',
          startedAt: new Date(base - (count - index) * 86_400_000),
          completedAt: new Date(base - (count - index) * 86_400_000 + 3_600_000),
          localDirty: true,
          localUpdatedAtMs: base + index,
        })
        .run();
    });
  });
  return ids;
};

/** Adds one exercise with one set to each session (dirty). */
const logExercisesAndSets = (device: InMemoryTestDatabase, sessionIds: readonly string[]): void => {
  const base = Date.now();
  device.transaction((tx) => {
    sessionIds.forEach((sessionId, index) => {
      tx.insert(sessionExercises)
        .values({
          id: `${sessionId}-sx`,
          sessionId,
          orderIndex: 0,
          name: 'Bench Press',
          localDirty: true,
          localUpdatedAtMs: base + index,
        })
        .run();
      tx.insert(exerciseSets)
        .values({
          id: `${sessionId}-sx-set`,
          sessionExerciseId: `${sessionId}-sx`,
          orderIndex: 0,
          weightValue: '100',
          repsValue: '5',
          performanceStatus: 'completed',
          localDirty: true,
          localUpdatedAtMs: base + index,
        })
        .run();
    });
  });
};

/** Every synced entity table's ids on `device`, sorted, keyed by table name. */
const syncedIds = (device: InMemoryTestDatabase): Record<string, string[]> =>
  Object.fromEntries(
    TOPO_LAYERS.flat().map((type) => {
      const table = (schema as unknown as Record<string, typeof schema.gyms>)[toSchemaKey(type)];
      const ids = device
        .select({ id: table.id })
        .from(table)
        .all()
        .map((row) => row.id)
        .sort();
      return [getTableName(table), ids];
    }),
  );

const toSchemaKey = (type: string): string => type.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

const sessionIdsOn = (device: InMemoryTestDatabase): string[] =>
  device.select({ id: sessions.id }).from(sessions).all().map((row) => row.id).sort();

const bootstrapFlag = (device: InMemoryTestDatabase): Date | null =>
  device.select({ flag: syncRuntimeState.bootstrapCompletedAt }).from(syncRuntimeState).get()?.flag ?? null;

const owner = (device: InMemoryTestDatabase): string | null =>
  readLocalDataOwner(device as unknown as LocalDatabase);

beforeAll(async () => {
  userE = await createAuthedTestClient(config, USER_E);
  userF = await createAuthedTestClient(config, USER_F);
}, 60_000);

afterAll(async () => {
  await userE?.teardown();
  await userF?.teardown();
});

beforeEach(async () => {
  __resetClockForTests();
  __resetCycleErrorSignalForTests();
  __resetAccountWipeForTests();
  await resetFixtureServerRows(config, userE.userId);
  await resetFixtureServerRows(config, userF.userId);
}, 60_000);

afterEach(() => {
  for (const fixture of devices.splice(0)) {
    fixture.close();
  }
  mockBootstrapState.database = null;
  mockClientState.client = null;
  mockedSignedInUserId.mockReset();
  mockedSignedInUserId.mockResolvedValue(null);
});

describe('restore from the live server', () => {
  it(
    'a fresh device restores a multi-page account exactly (sync from scratch)',
    async () => {
      // The writing device: a new account's first sign-in seeds the starter
      // catalog, then the logged history pushes.
      const writer = newDevice();
      const tag = runTag();
      const sessionIds = logSessions(writer, tag, HISTORY_SESSIONS);
      logExercisesAndSets(writer, sessionIds);
      await expect(syncAs(writer, userE)).resolves.toBe('converged');

      const restored = newDevice();
      await expect(syncAs(restored, userE)).resolves.toBe('converged');

      expect(syncedIds(restored)).toEqual(syncedIds(writer));
      expect(sessionIdsOn(restored)).toHaveLength(HISTORY_SESSIONS);
      expect(bootstrapFlag(restored)).not.toBeNull();
      expect(owner(restored)).toBe(userE.userId);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'a device that held another account restores the new one from scratch (re-sync after changing user)',
    async () => {
      const writerE = newDevice();
      const tagE = runTag();

      // t1: E's sessions reach the server.
      const sessionIdsE = logSessions(writerE, tagE, 5);
      await expect(syncAs(writerE, userE)).resolves.toBe('converged');

      // t2: the shared device signs in as F, logs a workout and syncs, so it
      // now holds F's rows and every layer's cursor sits at t2.
      const device = newDevice();
      const sessionIdsF = logSessions(device, runTag(), 1);
      logExercisesAndSets(device, sessionIdsF);
      await expect(syncAs(device, userF)).resolves.toBe('converged');
      expect(owner(device)).toBe(userF.userId);

      // t3: E's session exercises and sets reach the server — after F's layer-2
      // cursor, while E's sessions are before F's layer-1 cursor.
      logExercisesAndSets(writerE, sessionIdsE);
      await expect(syncAs(writerE, userE)).resolves.toBe('converged');

      // The device syncs as E with no sign-out in between.
      const outcome = await syncAs(device, userE);
      expect({ outcome, detail: getCycleErrorDetail() }).toEqual({ outcome: 'converged', detail: null });

      expect(syncedIds(device)).toEqual(syncedIds(writerE));
      expect(sessionIdsOn(device)).toEqual([...sessionIdsE].sort());
      expect(owner(device)).toBe(userE.userId);
      expect(bootstrapFlag(device)).not.toBeNull();
    },
    LIVE_TIMEOUT_MS,
  );
});
