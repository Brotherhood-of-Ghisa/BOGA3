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
  __resetSchedulerStateBridgeForTests,
  startSchedulerStateBridge,
} from '@/src/sync/scheduler-state-bridge';
import {
  __resetSchedulerStateForTests,
  getSchedulerStateSnapshot,
} from '@/src/sync/scheduler-state';

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

describe('scheduler-state bridge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFixture = createInMemoryDatabase();
    __resetSchedulerStateForTests();
    __resetAuthRequiredSignalForTests();
    __resetCycleErrorSignalForTests();
    __resetSchedulerStateBridgeForTests();
  });

  afterEach(() => {
    __resetSchedulerStateBridgeForTests();
    jest.useRealTimers();
    mockFixture.close();
  });

  it('publishes the persisted bootstrap flag once the data layer is ready', async () => {
    setBootstrapCompletedAt(new Date(1_700_000_000_000));
    startSchedulerStateBridge();

    await flushMicrotasks();

    expect(getSchedulerStateSnapshot().bootstrapCompletedAt?.getTime()).toBe(1_700_000_000_000);
  });

  it('keeps the flag null while the first cycle has not drained, then reflects it', async () => {
    startSchedulerStateBridge();
    await flushMicrotasks();
    expect(getSchedulerStateSnapshot().bootstrapCompletedAt).toBeNull();

    // The first cycle sets the flag; the poll picks it up on the next tick.
    setBootstrapCompletedAt(new Date(1_700_000_111_000));
    jest.advanceTimersByTime(BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
    await flushMicrotasks();

    expect(getSchedulerStateSnapshot().bootstrapCompletedAt?.getTime()).toBe(1_700_000_111_000);
    expect(readBootstrapColumn()?.getTime()).toBe(1_700_000_111_000);
  });

  it('mirrors the auth-required signal as AUTH_REQUIRED', async () => {
    startSchedulerStateBridge();
    await flushMicrotasks();

    markAuthRequired();
    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBe('AUTH_REQUIRED');

    clearAuthRequired();
    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBeNull();
  });

  it('mirrors non-auth cycle error codes and clears them on a clean cycle', async () => {
    startSchedulerStateBridge();
    await flushMicrotasks();

    markCycleError('INTERNAL');
    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBe('INTERNAL');

    markCycleError('FK_VIOLATION');
    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBe('FK_VIOLATION');

    clearCycleError();
    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBeNull();
  });

  it('prefers AUTH_REQUIRED over a lingering non-auth code', async () => {
    startSchedulerStateBridge();
    await flushMicrotasks();

    markCycleError('INTERNAL');
    markAuthRequired();

    expect(getSchedulerStateSnapshot().lastCycleErrorCode).toBe('AUTH_REQUIRED');
  });
});
