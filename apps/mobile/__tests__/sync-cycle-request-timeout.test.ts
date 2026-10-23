/**
 * Per-request timeout for the sync RPCs. A request whose connection dies
 * without an error (seen on iOS after the app was suspended mid-request) must
 * not hold the cycle open forever: the cycle ends INTERNAL after
 * SYNC_REQUEST_TIMEOUT_MS with dirty bits and cursors untouched, and the next
 * cycle re-sends the same rows and converges — safe even if the abandoned
 * request lands late, because a re-pushed row at the same timestamp is a
 * server no-op.
 *
 * Driver: a real in-memory better-sqlite3 database; the Supabase RPC is
 * stubbed and Jest fake timers drive the deadline.
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { gyms, syncRuntimeState } from '@/src/data/schema';
import { CURRENT_APP_VERSION } from '@/src/data/exercise-catalog-seeds';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import {
  __resetCycleErrorSignalForTests,
  getCycleErrorCode,
} from '@/src/sync/cycle-error-signal';
import { runSyncCycle, SYNC_REQUEST_TIMEOUT_MS, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

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
const mockGetSession = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    auth: { getSession: mockGetSession },
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  jest.useFakeTimers();
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  database.insert(syncRuntimeState).values({
    id: PRIMARY_RUNTIME_STATE_ID,
    appliedSeedMigrationAppVersion: CURRENT_APP_VERSION,
    bootstrapCompletedAt: new Date(1_700_000_000_000),
  }).run();
  database.insert(gyms).values({ id: 'gym-local', name: 'Local', localDirty: true, localUpdatedAtMs: 50 }).run();
  mockBootstrapState.database = database;
  mockRpc.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  mockLogEvent.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const emptyPage = { data: { entities: [], next_cursor: null, has_more: false }, error: null };
const pushOk = { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };
const never = () => new Promise<never>(() => undefined);

const isGymDirty = (): boolean | undefined =>
  database.select().from(gyms).where(eq(gyms.id, 'gym-local')).get()?.localDirty;

const readPullCursor = (): unknown =>
  database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get()?.pullCursor ?? null;

const cycleResultMessages = (): unknown[] =>
  mockLogEvent.mock.calls
    .map(([params]) => params)
    .filter((params) => params.event === 'sync.cycle_result')
    .map((params) => (params.context as { exception_message?: unknown }).exception_message);

/** Starts a cycle and reports whether it has settled, so a test can assert it is still waiting. */
const startCycle = () => {
  const state = { settled: false };
  const outcome = runSyncCycle().finally(() => {
    state.settled = true;
  });
  return { outcome, state };
};

describe('sync request timeout', () => {
  it('ends the cycle INTERNAL when a pull never answers, keeping dirty rows and cursors', async () => {
    mockRpc.mockImplementation((name: string) => (name === 'sync_pull' ? never() : Promise.resolve(pushOk)));
    const cursorBefore = readPullCursor();

    const { outcome, state } = startCycle();
    await jest.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe('internal');

    expect(getCycleErrorCode()).toBe('INTERNAL');
    expect(cycleResultMessages()).toEqual([expect.stringContaining('sync_pull timed out after 30000 ms')]);
    expect(isGymDirty()).toBe(true);
    expect(readPullCursor()).toEqual(cursorBefore);
    expect(mockRpc.mock.calls.some(([name]) => name === 'sync_push')).toBe(false);
  });

  it('retries a push that never answered and converges even when the abandoned push lands late', async () => {
    let answerLatePush: (value: typeof pushOk) => void = () => undefined;
    mockRpc.mockImplementation((name: string) =>
      name === 'sync_pull'
        ? Promise.resolve(emptyPage)
        : new Promise((resolve) => {
            answerLatePush = resolve;
          }),
    );

    const first = startCycle();
    await jest.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);
    await expect(first.outcome).resolves.toBe('internal');
    expect(cycleResultMessages()).toEqual([expect.stringContaining('sync_push timed out after 30000 ms')]);
    expect(isGymDirty()).toBe(true);

    // The server finally answers the abandoned push: nothing is listening, so
    // local state is untouched and the row stays dirty for the retry.
    answerLatePush(pushOk);
    await jest.advanceTimersByTimeAsync(0);
    expect(isGymDirty()).toBe(true);

    const pushed: WireEntity[][] = [];
    mockRpc.mockImplementation((name: string, args: { entities?: WireEntity[] }) => {
      if (name === 'sync_pull') return Promise.resolve(emptyPage);
      pushed.push(args.entities ?? []);
      return Promise.resolve(pushOk);
    });

    await expect(runSyncCycle()).resolves.toBe('converged');
    expect(pushed[0]).toEqual([expect.objectContaining({ type: 'gyms', id: 'gym-local', client_updated_at_ms: 50 })]);
    expect(isGymDirty()).toBe(false);
  });

  it('leaves no timer behind when every request answers in time', async () => {
    mockRpc.mockImplementation((name: string) => Promise.resolve(name === 'sync_pull' ? emptyPage : pushOk));

    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(jest.getTimerCount()).toBe(0);
  });
});
