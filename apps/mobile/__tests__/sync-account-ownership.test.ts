/**
 * The sync cycle's account-ownership guard (`src/sync/account-wipe.ts`).
 *
 * The local store holds one account's data, recorded in
 * `sync_runtime_state.account_user_id`. Before a cycle syncs as account B it
 * must not reuse account A's rows, bootstrap flag or pull cursors: reusing A's
 * cursors for B skips B's older rows in one layer while pulling their children
 * in the next, and the page fails the local FK check on every retry. The guard
 * keys off the session the cycle syncs with, not an in-memory "previous user",
 * so it also catches a switch the app never saw (a session that expired or
 * could not be read back, then a sign-in as someone else).
 *
 * Drives the real `runSyncCycle` over an in-memory database against a stub
 * server that serves each account its own rows. The live-server version of the
 * same journeys is `__tests__/sync/cycle-fresh-device-and-account-switch.test.ts`.
 */

import { eq } from 'drizzle-orm';

import { getSignedInUserId } from '@/src/auth/session-user';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { readLocalDataOwner, stampLocalDataOwner } from '@/src/data/local-wipe';
import { sessionExercises, sessions, syncRuntimeState } from '@/src/data/schema';
import {
  __resetAccountWipeForTests,
  subscribeToLocalDataReset,
  wipeLocalForAccountSwitch,
} from '@/src/sync/account-wipe';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests, getCycleErrorCode } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };

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

const mockLogEvent = jest.fn((_params: { event: string; context?: Record<string, unknown> }) => Promise.resolve());

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: { event: string; context?: Record<string, unknown> }) => mockLogEvent(params),
}));

const loggedEvents = (event: string) =>
  mockLogEvent.mock.calls.map(([params]) => params).filter((params) => params.event === event);

const mockedSignedInUserId = jest.mocked(getSignedInUserId);

const USER_A = 'user-a';
const USER_B = 'user-b';

const sessionEntity = (id: string, ms: number): WireEntity => ({
  type: 'sessions',
  id,
  client_updated_at_ms: ms,
  fields: {
    gym_id: null,
    source_plan_id: null,
    status: 'completed',
    started_at: ms,
    completed_at: ms,
    duration_sec: 60,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const sessionExerciseEntity = (id: string, sessionId: string, ms: number): WireEntity => ({
  type: 'session_exercises',
  id,
  client_updated_at_ms: ms,
  fields: {
    session_id: sessionId,
    exercise_definition_id: null,
    source_plan_exercise_id: null,
    order_index: 0,
    name: 'Bench Press',
    machine_name: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

/** Each account's server rows, by pull layer (five-layer topology). */
const SERVER_ROWS: Record<string, Record<number, WireEntity[]>> = {
  [USER_A]: { 2: [sessionEntity('a-session', 100)], 3: [sessionExerciseEntity('a-sx', 'a-session', 100)] },
  [USER_B]: { 2: [sessionEntity('b-session', 200)], 3: [sessionExerciseEntity('b-sx', 'b-session', 200)] },
};

/** The cursor the stub server hands back after a layer's snapshot. */
const cursorFor = (layer: number) => ({
  server_received_at: '2026-10-04T16:00:00.000000Z',
  owner_user_id: 'any',
  type: 'stub',
  id: `layer-${layer}`,
});

/** Every pull the stub served: layer, account, and the cursor the client sent. */
let pulls: { layer: number; user: string; cursor: unknown }[] = [];
let serverUser = USER_A;

/**
 * A stub server: a null cursor gets the account's whole layer, any cursor gets
 * an empty page (nothing newer). So a client that reuses a stale cursor never
 * receives the rows it is missing — exactly the production failure's shape.
 */
const serveAs = (user: string): void => {
  serverUser = user;
  mockedSignedInUserId.mockResolvedValue(user);
};

const installStubServer = (): void => {
  mockRpc.mockImplementation(async (fn: string, args: { layer?: number; cursor?: unknown }) => {
    if (fn === 'sync_push') {
      return { data: { ok: true }, error: null };
    }
    const layer = args.layer ?? 0;
    pulls.push({ layer, user: serverUser, cursor: args.cursor ?? null });
    const entities = args.cursor ? [] : (SERVER_ROWS[serverUser][layer] ?? []);
    return { data: { entities, next_cursor: cursorFor(layer), has_more: false }, error: null };
  });
};

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

const local = (): LocalDatabase => database as unknown as LocalDatabase;

const ids = (table: typeof sessions | typeof sessionExercises): string[] =>
  database.select({ id: table.id }).from(table).all().map((row) => row.id).sort();

const runtimeRow = () =>
  database.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get();

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  __resetAccountWipeForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  pulls = [];
  mockRpc.mockReset();
  mockLogEvent.mockClear();
  installStubServer();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  mockedSignedInUserId.mockReset();
  mockedSignedInUserId.mockResolvedValue(null);
});

describe('sync cycle account-ownership guard', () => {
  it('a fresh device restores the signed-in account from scratch and records it as the owner', async () => {
    serveAs(USER_A);

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(ids(sessions)).toEqual(['a-session']);
    expect(ids(sessionExercises)).toEqual(['a-sx']);
    expect(readLocalDataOwner(local())).toBe(USER_A);
    expect(runtimeRow()?.bootstrapCompletedAt).not.toBeNull();
  });

  it('signing in as another account without a sign-out wipes the first account and restores the second from scratch', async () => {
    serveAs(USER_A);
    await expect(runSyncCycle()).resolves.toBe('converged');
    const lastEmittedBefore = runtimeRow()?.lastEmittedMs;
    const resets = jest.fn();
    subscribeToLocalDataReset(resets);

    // B's session arrives while the store still holds A's rows, flag and
    // cursors: no sign-out ran (an expired / unreadable session, then sign-in).
    pulls = [];
    serveAs(USER_B);
    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(getCycleErrorCode()).toBeNull();
    expect(ids(sessions)).toEqual(['b-session']);
    expect(ids(sessionExercises)).toEqual(['b-sx']);
    expect(readLocalDataOwner(local())).toBe(USER_B);
    expect(resets).toHaveBeenCalledTimes(1);
    // B's first pull of every layer started from scratch, not from A's cursors.
    const firstPullPerLayer = new Map<number, unknown>();
    for (const pull of pulls) {
      if (!firstPullPerLayer.has(pull.layer)) {
        firstPullPerLayer.set(pull.layer, pull.cursor);
      }
    }
    expect([...firstPullPerLayer.values()].every((cursor) => cursor === null)).toBe(true);
    // The device-global monotonic clock survives the wipe.
    expect(runtimeRow()?.lastEmittedMs).toBeGreaterThanOrEqual(lastEmittedBefore ?? 0);
    // The wipe is logged with the unpushed edits it discarded.
    expect(loggedEvents('sync.local_store_owner_mismatch_wipe')).toEqual([
      expect.objectContaining({ context: { dirty_rows_discarded: 0 } }),
    ]);
  });

  it('keeps the store and its cursors when the same account syncs again', async () => {
    serveAs(USER_A);
    await runSyncCycle();
    pulls = [];

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(ids(sessions)).toEqual(['a-session']);
    expect(pulls.every((pull) => pull.cursor !== null)).toBe(true);
  });

  it('heals an unowned store that synced before (from before the owner was recorded): wipe and restore', async () => {
    // Today's broken devices: another account's rows and cursors, no owner.
    serveAs(USER_A);
    await runSyncCycle();
    database.update(syncRuntimeState).set({ accountUserId: null }).run();
    pulls = [];

    serveAs(USER_B);
    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(ids(sessions)).toEqual(['b-session']);
    expect(ids(sessionExercises)).toEqual(['b-sx']);
    expect(readLocalDataOwner(local())).toBe(USER_B);
    expect(loggedEvents('sync.local_store_unowned_wipe')).toHaveLength(1);
  });

  it('keeps unpushed edits in an unowned store but restarts every pull from scratch', async () => {
    serveAs(USER_A);
    await runSyncCycle();
    database.update(syncRuntimeState).set({ accountUserId: null }).run();
    database.update(sessions).set({ localDirty: true }).run();
    pulls = [];

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(ids(sessions)).toEqual(['a-session']);
    expect(readLocalDataOwner(local())).toBe(USER_A);
    const firstPullOfLayer = (layer: number) => pulls.find((pull) => pull.layer === layer)?.cursor;
    expect([0, 1, 2, 3, 4].map(firstPullOfLayer)).toEqual([null, null, null, null, null]);
    expect(loggedEvents('sync.local_store_unowned_repull')).toEqual([
      expect.objectContaining({ context: { dirty_rows: 1 } }),
    ]);
  });

  it('touches nothing when there is no session (the RPCs report AUTH_REQUIRED)', async () => {
    stampLocalDataOwner(local(), USER_A);
    mockedSignedInUserId.mockResolvedValue(null);
    mockRpc.mockResolvedValue({ data: { error: { code: 'AUTH_REQUIRED' } }, error: null });

    await expect(runSyncCycle()).resolves.toBe('auth-required');

    expect(readLocalDataOwner(local())).toBe(USER_A);
  });

  it('a sign-out wipe waits for the in-flight cycle, so no pulled page lands in the emptied store', async () => {
    serveAs(USER_A);
    let releasePull: () => void = () => undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    const serve = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (fn: string, args: { layer?: number }) => {
      if (fn === 'sync_pull' && args.layer === 2) {
        await pullGate;
      }
      return serve(fn, args);
    });

    const cycle = runSyncCycle();
    await new Promise((resolve) => setImmediate(resolve));
    let wiped = false;
    const wipe = wipeLocalForAccountSwitch().then(() => {
      wiped = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(wiped).toBe(false);

    releasePull();
    await expect(cycle).resolves.toBe('converged');
    await wipe;

    expect(ids(sessions)).toEqual([]);
    expect(ids(sessionExercises)).toEqual([]);
    expect(readLocalDataOwner(local())).toBeNull();
    expect(runtimeRow()?.bootstrapCompletedAt).toBeNull();
  });
});
