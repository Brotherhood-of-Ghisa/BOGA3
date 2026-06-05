/* eslint-disable import/first */

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

// `mock`-prefixed so the jest factory below may reference it despite hoisting.
let mockFixture: InMemoryDatabaseFixture;

jest.mock('@/src/data', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database),
}));

import { eq } from 'drizzle-orm';

import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
import {
  __resetAuthRequiredSignalForTests,
  clearAuthRequired,
  markAuthRequired,
} from '@/src/sync/auth-required-signal';
import {
  __resetCycleErrorSignalForTests,
  clearCycleError,
  markCycleError,
} from '@/src/sync/cycle-error-signal';
import {
  BOOTSTRAP_FLAG_POLL_INTERVAL_MS,
  __resetSyncGateStateBridgeForTests,
  startSyncGateStateBridge,
} from '@/src/sync/sync-gate-state-bridge';
import {
  __resetSyncGateStateForTests,
  getSyncGateStateSnapshot,
  subscribeToSyncGateState,
  type SyncGateStateSnapshot,
} from '@/src/sync/sync-gate-state';

const setBootstrapCompletedAt = (value: Date | null): void => {
  mockFixture.database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: value })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: value },
    })
    .run();
};

const readBootstrapColumn = (): Date | null =>
  mockFixture.database
    .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get()?.bootstrapCompletedAt ?? null;

/** Lets the mocked `bootstrapLocalDataLayer()` promise resolve and run refresh. */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe('sync-gate state bridge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFixture = createInMemoryDatabase();
    __resetSyncGateStateForTests();
    __resetAuthRequiredSignalForTests();
    __resetCycleErrorSignalForTests();
    __resetSyncGateStateBridgeForTests();
  });

  afterEach(() => {
    __resetSyncGateStateBridgeForTests();
    jest.useRealTimers();
    mockFixture.close();
  });

  it('publishes the persisted bootstrap flag once the data layer is ready', async () => {
    setBootstrapCompletedAt(new Date(1_700_000_000_000));
    startSyncGateStateBridge();

    await flushMicrotasks();

    expect(getSyncGateStateSnapshot().bootstrapCompletedAt?.getTime()).toBe(1_700_000_000_000);
  });

  it('keeps the flag null while the first cycle has not drained, then reflects it', async () => {
    startSyncGateStateBridge();
    await flushMicrotasks();
    expect(getSyncGateStateSnapshot().bootstrapCompletedAt).toBeNull();

    // The first cycle sets the flag; the poll picks it up on the next tick.
    setBootstrapCompletedAt(new Date(1_700_000_111_000));
    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
    await flushMicrotasks();

    expect(getSyncGateStateSnapshot().bootstrapCompletedAt?.getTime()).toBe(1_700_000_111_000);
    expect(readBootstrapColumn()?.getTime()).toBe(1_700_000_111_000);
  });

  it('mirrors the auth-required signal as AUTH_REQUIRED', async () => {
    startSyncGateStateBridge();
    await flushMicrotasks();

    markAuthRequired();
    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBe('AUTH_REQUIRED');

    clearAuthRequired();
    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBeNull();
  });

  it('mirrors non-auth cycle error codes and clears them on a clean cycle', async () => {
    startSyncGateStateBridge();
    await flushMicrotasks();

    markCycleError('INTERNAL');
    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBe('INTERNAL');

    markCycleError('FK_VIOLATION');
    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBe('FK_VIOLATION');

    clearCycleError();
    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBeNull();
  });

  it('prefers AUTH_REQUIRED over a lingering non-auth code', async () => {
    startSyncGateStateBridge();
    await flushMicrotasks();

    markCycleError('INTERNAL');
    markAuthRequired();

    expect(getSyncGateStateSnapshot().lastCycleErrorCode).toBe('AUTH_REQUIRED');
  });

  it('republishes a fresh snapshot on every poll tick while the gate is up, then stops once the flag is set', async () => {
    // The gate's reactive holder is its only re-render trigger, and the live
    // progress / offline snapshot is NOT carried on it — so the bridge must
    // republish each poll for the gate to reflect the scheduler going online.
    startSyncGateStateBridge();
    await flushMicrotasks();

    const seen: SyncGateStateSnapshot[] = [];
    const unsubscribe = subscribeToSyncGateState(() => {
      seen.push(getSyncGateStateSnapshot());
    });

    // Two poll ticks with the bootstrap flag still null: each publishes a fresh
    // snapshot (a new object reference, which is what drives useSyncExternalStore).
    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
    await flushMicrotasks();
    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
    await flushMicrotasks();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).not.toBe(seen[1]);

    // The first cycle sets the flag: the next tick publishes once more and then
    // the poll stops, so the gate never re-blocks for this session.
    setBootstrapCompletedAt(new Date(1_700_000_222_000));
    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
    await flushMicrotasks();
    const countAfterFlagSet = seen.length;

    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS * 3);
    await flushMicrotasks();
    expect(seen.length).toBe(countAfterFlagSet);

    unsubscribe();
  });
});
