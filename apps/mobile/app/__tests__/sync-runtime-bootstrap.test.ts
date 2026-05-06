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
  getSyncRuntimeState,
  setSyncEnabled,
  startSyncRuntime,
  stopSyncRuntime,
} from '@/src/sync/runtime';
import { createSyncScheduler, SYNC_SESSION_RECORDER_CADENCE_MS } from '@/src/sync/scheduler';

type RuntimeStateRow = {
  id: string;
  isEnabled: number;
  bootstrapUserId: string | null;
  bootstrapCompletedAt: Date | null;
  lastBootstrapError: string | null;
  updatedAt: Date;
};

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

    const scheduler = createSyncScheduler({ flush: recorderFlush });
    scheduler.start();
    scheduler.setContext('session-recorder');
    jest.advanceTimersByTime(SYNC_SESSION_RECORDER_CADENCE_MS);
    await flushAsync();

    expect(recorderFlush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });
});
