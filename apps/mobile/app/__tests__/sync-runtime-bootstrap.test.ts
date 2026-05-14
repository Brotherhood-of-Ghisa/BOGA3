/* eslint-disable import/first */

const mockBootstrapLocalDataLayer = jest.fn();
const mockGetAuthSnapshot = jest.fn();
const mockSubscribeToAuthState = jest.fn();
const mockGetSupabaseMobileClient = jest.fn();
const mockFlushSyncOutbox = jest.fn();
const mockSetSyncIngestTransport = jest.fn();
const mockRunSyncBootstrapMerge = jest.fn();
const mockClearSyncRetryState = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

jest.mock('@/src/auth', () => ({
  getAuthSnapshot: (...args: unknown[]) => mockGetAuthSnapshot(...args),
  subscribeToAuthState: (...args: unknown[]) => mockSubscribeToAuthState(...args),
}));

jest.mock('@/src/auth/supabase', () => ({
  getSupabaseMobileClient: (...args: unknown[]) => mockGetSupabaseMobileClient(...args),
}));

jest.mock('@/src/sync/engine', () => ({
  flushSyncOutbox: (...args: unknown[]) => mockFlushSyncOutbox(...args),
  setSyncIngestTransport: (...args: unknown[]) => mockSetSyncIngestTransport(...args),
}));

jest.mock('@/src/sync/bootstrap', () => ({
  runSyncBootstrapMerge: (...args: unknown[]) => mockRunSyncBootstrapMerge(...args),
}));

jest.mock('@/src/sync/outbox', () => ({
  clearSyncRetryState: (...args: unknown[]) => mockClearSyncRetryState(...args),
}));

import {
  __resetSyncRuntimeForTests,
  BOOTSTRAP_COOLDOWN_MS,
  flushSyncOutboxUntilSettled,
  getSyncRuntimeState,
  setSyncEnabled,
  shouldRunBootstrap,
  startSyncRuntime,
  stopSyncRuntime,
  type SyncRuntimeStateSnapshot,
} from '@/src/sync/runtime';
import type { SyncFlushResult } from '@/src/sync/engine';
import { createSyncScheduler, SYNC_SESSION_RECORDER_CADENCE_MS } from '@/src/sync/scheduler';

type RuntimeStateRow = {
  id: string;
  isEnabled: number;
  bootstrapUserId: string | null;
  bootstrapCompletedAt: Date | null;
  lastBootstrapError: string | null;
  lastBootstrapAttemptAt: Date | null;
  updatedAt: Date;
};

const flushAsync = async () => {
  // Drain enough microtasks to settle nested awaits across reconcile,
  // bootstrap, runtime-state writes, merge, and convergence.
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
};

describe('sync runtime bootstrap trigger', () => {
  let runtimeRow: RuntimeStateRow | null;
  let authSnapshot: {
    session: { user: { id: string } } | null;
  };
  let authListener: (() => void) | null;

  beforeEach(async () => {
    runtimeRow = null;
    authSnapshot = {
      session: {
        user: {
          id: 'user-a',
        },
      },
    };
    authListener = null;

    mockBootstrapLocalDataLayer.mockReset();
    mockGetAuthSnapshot.mockReset();
    mockSubscribeToAuthState.mockReset();
    mockGetSupabaseMobileClient.mockReset();
    mockFlushSyncOutbox.mockReset();
    mockSetSyncIngestTransport.mockReset();
    mockRunSyncBootstrapMerge.mockReset();
    mockClearSyncRetryState.mockReset();

    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn(() => runtimeRow),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn((value: RuntimeStateRow) => ({
          run: jest.fn(() => {
            runtimeRow = {
              ...value,
            };
          }),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((value: Partial<RuntimeStateRow>) => ({
          where: jest.fn(() => ({
            run: jest.fn(() => {
              if (!runtimeRow) {
                throw new Error('runtime row missing');
              }

              const next: RuntimeStateRow = {
                ...runtimeRow,
              };

              for (const [key, entry] of Object.entries(value)) {
                if (entry !== undefined) {
                  (next as Record<string, unknown>)[key] = entry;
                }
              }

              runtimeRow = next;
            }),
          })),
        })),
      })),
      delete: jest.fn(() => ({
        run: jest.fn(() => {
          runtimeRow = null;
        }),
      })),
    };

    mockBootstrapLocalDataLayer.mockResolvedValue({
      transaction: (callback: (input: typeof tx) => unknown) => callback(tx),
    });

    mockGetAuthSnapshot.mockImplementation(() => authSnapshot);
    mockSubscribeToAuthState.mockImplementation((listener: () => void) => {
      authListener = listener;
      return () => {
        authListener = null;
      };
    });

    const mockClient = {
      schema: jest.fn(() => ({
        rpc: jest.fn(),
      })),
    };
    mockGetSupabaseMobileClient.mockReturnValue(mockClient);
    mockRunSyncBootstrapMerge.mockResolvedValue({
      convergenceEventsQueued: 3,
      mergedCounts: {
        gyms: 1,
        sessions: 1,
        sessionExercises: 0,
        exerciseSets: 0,
        exerciseDefinitions: 1,
        exerciseMuscleMappings: 0,
        exerciseTagDefinitions: 0,
        sessionExerciseTags: 0,
      },
    });
    mockFlushSyncOutbox.mockResolvedValue({ status: 'idle' });
    mockClearSyncRetryState.mockResolvedValue(undefined);

    await __resetSyncRuntimeForTests();
  });

  afterEach(() => {
    stopSyncRuntime();
    jest.useRealTimers();
  });

  it('runs bootstrap merge immediately when sync is enabled for an authenticated user', async () => {
    startSyncRuntime();
    await flushAsync();

    await setSyncEnabled(true);
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);
    expect(mockFlushSyncOutbox).toHaveBeenCalledTimes(1);

    const runtimeState = await getSyncRuntimeState();
    expect(runtimeState.isEnabled).toBe(true);
    expect(runtimeState.bootstrapUserId).toBe('user-a');
    expect(runtimeState.bootstrapCompletedAt).toBeInstanceOf(Date);
    expect(runtimeState.lastBootstrapError).toBeNull();
  });

  it('clears blocked retry state when sync is manually enabled', async () => {
    await setSyncEnabled(true);

    expect(mockClearSyncRetryState).toHaveBeenCalledTimes(1);
  });

  it('defers bootstrap until login when sync was enabled while logged out', async () => {
    authSnapshot = {
      session: null,
    };

    startSyncRuntime();
    await flushAsync();

    await setSyncEnabled(true);
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(0);

    authSnapshot = {
      session: {
        user: {
          id: 'user-b',
        },
      },
    };

    authListener?.();
    await flushAsync();
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);

    const runtimeState = await getSyncRuntimeState();
    expect(runtimeState.bootstrapUserId).toBe('user-b');
    expect(runtimeState.bootstrapCompletedAt).toBeInstanceOf(Date);
  });

  it('proves the already-logged-in recorder journey bootstraps, converges, then flushes on recorder cadence', async () => {
    jest.useFakeTimers();
    const recorderFlush = jest.fn(async () => ({ status: 'idle' as const }));

    startSyncRuntime();
    await flushAsync();

    await setSyncEnabled(true);
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);
    expect(mockFlushSyncOutbox).toHaveBeenCalledTimes(1);

    const scheduler = createSyncScheduler({ flush: recorderFlush });
    scheduler.start();
    scheduler.setContext('session-recorder');

    jest.advanceTimersByTime(SYNC_SESSION_RECORDER_CADENCE_MS - 1);
    await flushAsync();
    expect(recorderFlush).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    await flushAsync();
    expect(recorderFlush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('proves the logged-out login journey bootstraps after auth, converges, then flushes recorder work', async () => {
    jest.useFakeTimers();
    const recorderFlush = jest.fn(async () => ({ status: 'idle' as const }));

    authSnapshot = {
      session: null,
    };

    startSyncRuntime();
    await flushAsync();

    await setSyncEnabled(true);
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(0);
    expect(mockFlushSyncOutbox).toHaveBeenCalledTimes(0);

    authSnapshot = {
      session: {
        user: {
          id: 'user-b',
        },
      },
    };

    authListener?.();
    await flushAsync();
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);
    expect(mockFlushSyncOutbox).toHaveBeenCalledTimes(1);

    const scheduler = createSyncScheduler({
      flush: recorderFlush,
      isBootstrapInProgress: () => false,
    });
    scheduler.start();
    scheduler.setContext('session-recorder');
    jest.advanceTimersByTime(SYNC_SESSION_RECORDER_CADENCE_MS);
    await flushAsync();

    expect(recorderFlush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('does not re-run bootstrap on a same-user auth event (bug 2)', async () => {
    startSyncRuntime();
    await flushAsync();

    await setSyncEnabled(true);
    await flushAsync();

    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);

    // Simulate two TOKEN_REFRESHED events for the same user.
    authListener?.();
    authListener?.();
    await flushAsync();
    await flushAsync();

    // No additional bootstrap merge should have been triggered for these
    // same-user auth events.
    expect(mockRunSyncBootstrapMerge).toHaveBeenCalledTimes(1);
  });
});

describe('flushSyncOutboxUntilSettled (bug 1)', () => {
  it('handles in_flight followed by idle as converged', async () => {
    let inFlightPromiseResolved = false;
    const pending: Promise<SyncFlushResult> = Promise.resolve({ status: 'idle' as const }).then(
      (result) => {
        inFlightPromiseResolved = true;
        return result;
      }
    );

    const flush = jest
      .fn<Promise<SyncFlushResult>, []>()
      .mockResolvedValueOnce({ status: 'in_flight' })
      .mockResolvedValueOnce({ status: 'idle' });

    const awaitInFlight = jest
      .fn<Promise<SyncFlushResult> | null, []>()
      .mockReturnValueOnce(pending)
      .mockReturnValue(null);

    const result = await flushSyncOutboxUntilSettled({ flush, awaitInFlight });

    expect(result.status).toBe('converged');
    expect(flush).toHaveBeenCalledTimes(2);
    expect(awaitInFlight).toHaveBeenCalledTimes(1);
    expect(inFlightPromiseResolved).toBe(true);
  });

  it('treats backoff as converged (bug 1)', async () => {
    const flush = jest
      .fn<Promise<SyncFlushResult>, []>()
      .mockResolvedValue({ status: 'backoff', nextAttemptAt: new Date() });

    const result = await flushSyncOutboxUntilSettled({ flush, awaitInFlight: () => null });

    expect(result.status).toBe('converged');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('still reports not_converged when the engine reports a transport failure', async () => {
    const flush = jest
      .fn<Promise<SyncFlushResult>, []>()
      .mockResolvedValue({
        status: 'transport_failure',
        sentCount: 0,
        nextAttemptAt: new Date(),
        message: 'boom',
      });

    const result = await flushSyncOutboxUntilSettled({ flush, awaitInFlight: () => null });

    expect(result.status).toBe('not_converged');
  });
});

describe('shouldRunBootstrap cooldown (bug 3)', () => {
  const session = { user: { id: 'user-cooldown' } } as unknown as Parameters<
    typeof shouldRunBootstrap
  >[1];

  const baseSnapshot = (
    overrides: Partial<SyncRuntimeStateSnapshot> = {}
  ): SyncRuntimeStateSnapshot => ({
    id: 'primary',
    isEnabled: true,
    bootstrapUserId: null,
    bootstrapCompletedAt: null,
    lastBootstrapError: null,
    lastBootstrapAttemptAt: null,
    updatedAt: new Date(0),
    ...overrides,
  });

  it('returns false within the cooldown window after a failed attempt', () => {
    const lastAttempt = new Date(1_000_000);
    const snapshot = baseSnapshot({
      lastBootstrapAttemptAt: lastAttempt,
      bootstrapUserId: null,
      lastBootstrapError: 'boom',
    });

    const within = new Date(lastAttempt.getTime() + BOOTSTRAP_COOLDOWN_MS - 1);
    expect(shouldRunBootstrap(snapshot, session, { now: within })).toBe(false);
  });

  it('returns true once the cooldown elapses', () => {
    const lastAttempt = new Date(1_000_000);
    const snapshot = baseSnapshot({
      lastBootstrapAttemptAt: lastAttempt,
      bootstrapUserId: null,
      lastBootstrapError: 'boom',
    });

    const after = new Date(lastAttempt.getTime() + BOOTSTRAP_COOLDOWN_MS + 1);
    expect(shouldRunBootstrap(snapshot, session, { now: after })).toBe(true);
  });

  it('ignores cooldown when a different user previously completed bootstrap', () => {
    const lastAttempt = new Date(1_000_000);
    const snapshot = baseSnapshot({
      lastBootstrapAttemptAt: lastAttempt,
      bootstrapCompletedAt: new Date(500_000),
      bootstrapUserId: 'someone-else',
    });

    const within = new Date(lastAttempt.getTime() + 1);
    expect(shouldRunBootstrap(snapshot, session, { now: within })).toBe(true);
  });
});
