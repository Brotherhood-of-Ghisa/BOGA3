/**
 * A sync RPC cut off by the client's request timeout (see
 * auth-fetch-with-timeout.test.ts) comes back as postgrest's status-0 error.
 * The cycle must end INTERNAL with dirty bits and cursors untouched, and the
 * next cycle re-sends the same rows and converges: a re-pushed row at the
 * same timestamp is a server no-op, so a push the server did commit before
 * its response was lost is safe to repeat.
 *
 * Driver: a real in-memory better-sqlite3 database; the Supabase RPC is
 * stubbed.
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
import { SUPABASE_REQUEST_TIMEOUT_MS } from '@/src/auth/fetch-with-timeout';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

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
    ...jest.requireActual('./helpers/sync-cycle-mocks').syncRpcClient(mockRpc),
    auth: { getSession: mockGetSession },
  })),
}));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
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
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const emptyPage = { data: { entities: [], next_cursor: null, has_more: false }, error: null };
const pushOk = { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };
const timeoutMessage = `SupabaseRequestTimeoutError: Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS} ms`;
/** What postgrest-js resolves when the client's fetch rejects with the timeout. */
const timedOut = {
  data: null,
  error: { message: timeoutMessage, details: '', hint: '', code: '' },
  status: 0,
};

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

describe('a sync request cut off by the client timeout', () => {
  it('ends the cycle INTERNAL when a pull times out, keeping dirty rows and cursors', async () => {
    mockRpc.mockImplementation((name: string) => Promise.resolve(name === 'sync_pull' ? timedOut : pushOk));
    const cursorBefore = readPullCursor();

    await expect(runSyncCycle()).resolves.toBe('internal');

    expect(getCycleErrorCode()).toBe('INTERNAL');
    expect(cycleResultMessages()).toEqual([expect.stringContaining(timeoutMessage)]);
    expect(isGymDirty()).toBe(true);
    expect(readPullCursor()).toEqual(cursorBefore);
    expect(mockRpc.mock.calls.some(([name]) => name === 'sync_push')).toBe(false);
  });

  it('re-sends a timed-out push unchanged on the next cycle and converges', async () => {
    const pushed: WireEntity[][] = [];
    let pushAnswer = timedOut as typeof timedOut | typeof pushOk;
    mockRpc.mockImplementation((name: string, args: { entities?: WireEntity[] }) => {
      if (name === 'sync_pull') return Promise.resolve(emptyPage);
      pushed.push(args.entities ?? []);
      return Promise.resolve(pushAnswer);
    });

    await expect(runSyncCycle()).resolves.toBe('internal');
    expect(cycleResultMessages()).toEqual([expect.stringContaining(timeoutMessage)]);
    expect(isGymDirty()).toBe(true);

    pushAnswer = pushOk;
    await expect(runSyncCycle()).resolves.toBe('converged');

    expect(pushed).toHaveLength(2);
    expect(pushed[1]).toEqual(pushed[0]);
    expect(pushed[1]).toEqual([expect.objectContaining({ type: 'gyms', id: 'gym-local', client_updated_at_ms: 50 })]);
    expect(isGymDirty()).toBe(false);
  });
});
