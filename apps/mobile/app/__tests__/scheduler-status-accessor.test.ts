/* eslint-disable import/first */

/**
 * The production scheduler-status accessor: a read-only snapshot of the
 * scheduler's observable state. These tests assert it returns the current
 * machine state, the latest cycle error, the last-success time, the live online
 * projection, and the first-sync progress shape (phase + monotonic counters)
 * with `offline` overridden from the live projection. This is the single shared
 * read path consumers use; reading it never advances the machine.
 */

import { AppState, type AppStateStatus } from 'react-native';

import type { LogEventParams } from '@/src/logging/logEvent';

// Controllable cycle stub: resolve/reject by hand so RUNNING is observable.
let cycleResolvers: { resolve: () => void; reject: (error: unknown) => void }[] = [];
const mockRunSyncCycle = jest.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      cycleResolvers.push({ resolve, reject });
    }),
);

jest.mock('@/src/sync/cycle', () => ({
  runSyncCycle: () => mockRunSyncCycle(),
}));

// NetInfo stub exposing the registered listener so tests drive reachability.
type NetInfoSnapshot = { isConnected?: boolean | null; isInternetReachable?: boolean | null };
const mockNetInfoState: { listener: ((state: NetInfoSnapshot) => void) | null } = {
  listener: null,
};
const mockNetInfoUnsubscribe = jest.fn(() => {
  mockNetInfoState.listener = null;
});
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetInfoSnapshot) => void) => {
      mockNetInfoState.listener = listener;
      return mockNetInfoUnsubscribe;
    },
  },
}));

const mockLogEvent = jest.fn((_params: LogEventParams) => Promise.resolve());
jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

import {
  getSchedulerStatus,
  startSyncScheduler,
  stopSyncScheduler,
} from '@/src/sync/scheduler';
import { resetSyncProgress, setSyncProgress } from '@/src/sync/progress';

const goOnline = () => mockNetInfoState.listener?.({ isConnected: true });

const endCycleSuccess = async () => {
  cycleResolvers.shift()?.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const endCycleError = async () => {
  cycleResolvers.shift()?.reject(new Error('cycle blew up'));
  await Promise.resolve();
  await Promise.resolve();
};

const appStateRemove = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  cycleResolvers = [];
  mockRunSyncCycle.mockClear();
  mockLogEvent.mockClear();
  mockNetInfoState.listener = null;
  resetSyncProgress();

  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
    return { remove: appStateRemove } as never;
  });
  (AppState as { currentState: AppStateStatus }).currentState = 'active';

  startSyncScheduler();
});

afterEach(() => {
  stopSyncScheduler();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  resetSyncProgress();
});

describe('production scheduler status accessor', () => {
  it('starts OFFLINE with no error, no success time, and offline progress', () => {
    const status = getSchedulerStatus();
    expect(status.state.name).toBe('OFFLINE');
    expect(status.online).toBe(false);
    expect(status.lastCycleError).toBeNull();
    expect(status.lastSuccessAtMs).toBeNull();
    expect(status.progress.offline).toBe(true);
  });

  it('reports the online projection once the link is connected', () => {
    goOnline();
    const status = getSchedulerStatus();
    expect(status.online).toBe(true);
    expect(status.progress.offline).toBe(false);
  });

  it('records the last successful sync time and clears the error on a clean cycle', async () => {
    goOnline();
    jest.advanceTimersByTime(1000); // short timer fires -> RUNNING
    expect(getSchedulerStatus().state.name).toBe('RUNNING');

    const before = Date.now();
    await endCycleSuccess();

    const status = getSchedulerStatus();
    expect(status.lastCycleError).toBeNull();
    expect(status.lastSuccessAtMs).not.toBeNull();
    expect(status.lastSuccessAtMs).toBeGreaterThanOrEqual(before);
  });

  it('retains the latest cycle error message after a thrown cycle', async () => {
    goOnline();
    jest.advanceTimersByTime(1000);
    await endCycleError();

    const status = getSchedulerStatus();
    expect(status.lastCycleError).toBe('cycle blew up');
  });

  it('clears a prior error once a later cycle completes cleanly', async () => {
    goOnline();
    jest.advanceTimersByTime(1000);
    await endCycleError();
    expect(getSchedulerStatus().lastCycleError).toBe('cycle blew up');

    // Idle backstop re-arms; let it fire and settle cleanly.
    jest.advanceTimersByTime(60_000);
    await endCycleSuccess();

    expect(getSchedulerStatus().lastCycleError).toBeNull();
  });

  it('surfaces the first-sync progress phase and counters from the producer', () => {
    setSyncProgress({ phase: 'pull', layersCompleted: 2, rowsApplied: 137, offline: false });
    goOnline();

    const status = getSchedulerStatus();
    expect(status.progress.phase).toBe('pull');
    expect(status.progress.layersCompleted).toBe(2);
    expect(status.progress.rowsApplied).toBe(137);
  });

  it('overrides progress.offline from the live projection, not the stale snapshot', () => {
    // Producer wrote offline=false, but the live machine is OFFLINE.
    setSyncProgress({ phase: 'pull', layersCompleted: 1, rowsApplied: 4, offline: false });
    expect(getSchedulerStatus().online).toBe(false);
    expect(getSchedulerStatus().progress.offline).toBe(true);

    // Producer wrote offline=true, but the live machine just went online.
    goOnline();
    setSyncProgress({ phase: 'seed', layersCompleted: 4, rowsApplied: 9, offline: true });
    expect(getSchedulerStatus().online).toBe(true);
    expect(getSchedulerStatus().progress.offline).toBe(false);
  });

  it('does not advance the machine when the accessor is read', () => {
    const first = getSchedulerStatus().state.name;
    getSchedulerStatus();
    getSchedulerStatus();
    expect(getSchedulerStatus().state.name).toBe(first);
    expect(mockRunSyncCycle).not.toHaveBeenCalled();
  });
});
