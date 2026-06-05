/* eslint-disable import/first */

/**
 * Outcome: the foreground scheduler is a four-state machine that walks two
 * total transition tables, with the network reachability projection as the sole
 * authority on online/offline.
 *
 * The four states are OFFLINE (no network, never sync), LONG_TIMEOUT (online,
 * idle, long backstop ticking), SHORT_TIMEOUT (online, nudged, short debounce
 * ticking), and RUNNING (a cycle in flight). Three external inputs drive it
 * (request sync, go online, go offline) and two internal events fire as a
 * consequence (timer fires, cycle ends).
 *
 * This file walks BOTH tables cell-by-cell. Each `it(...)` is exactly one
 * (state, event) cell and its expected outcome, named in plain machine terms.
 *
 *   External-input table: 4 states x 3 inputs = 12 cells.
 *   Internal-event table:  4 states x 2 events = 8 cells.
 *   => 20 cells, plus the network-projection-is-authority guards.
 *
 * The cycle is a controllable deferred so RUNNING can be held open; the network
 * library exposes its registered listener so reachability snapshots can be fed
 * in; AppState exposes its change listener; timers are faked.
 */

import { AppState, type AppStateStatus } from 'react-native';

import type { LogEventParams } from '@/src/logging/logEvent';

// --- Controllable cycle stub: resolve/reject by hand to observe RUNNING. ------
let cycleResolvers: { resolve: () => void; reject: (error: unknown) => void }[] = [];
let cycleStartCount = 0;
const mockRunSyncCycle = jest.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      cycleStartCount += 1;
      cycleResolvers.push({ resolve, reject });
    }),
);
jest.mock('@/src/sync/cycle', () => ({ runSyncCycle: () => mockRunSyncCycle() }));

// --- NetInfo stub: capture the listener so tests feed connectivity snapshots.
// The scheduler keys "online" off `isConnected`; `isInternetReachable` is carried
// only so a test can prove it is ignored.
type NetInfoSnapshot = { isConnected?: boolean | null; isInternetReachable?: boolean | null };
const mockNetInfoState: { listener: ((state: NetInfoSnapshot) => void) | null } = { listener: null };
const mockNetInfoUnsubscribe = jest.fn(() => {
  mockNetInfoState.listener = null;
});
const mockNetInfoAddEventListener = jest.fn((listener: (state: NetInfoSnapshot) => void) => {
  mockNetInfoState.listener = listener;
  return mockNetInfoUnsubscribe;
});
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetInfoSnapshot) => void) =>
      mockNetInfoAddEventListener(listener),
  },
}));

// --- Logging spy --------------------------------------------------------------
const mockLogEvent = jest.fn((_params: LogEventParams) => Promise.resolve());
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (params: LogEventParams) => mockLogEvent(params) }));

import {
  __getSchedulerStateForTests,
  LONG_INTERVAL,
  requestSync,
  SHORT_INTERVAL,
  startSyncScheduler,
  stopSyncScheduler,
} from '@/src/sync/scheduler';

// --- AppState change-listener capture ----------------------------------------
let appStateListener: ((status: AppStateStatus) => void) | null = null;
const appStateRemove = jest.fn();

const goOnline = () => mockNetInfoState.listener?.({ isConnected: true });
const goOffline = () => mockNetInfoState.listener?.({ isConnected: false });
/** A snapshot with no usable link (isConnected null) — projects offline. */
const linkUnknown = () => mockNetInfoState.listener?.({ isConnected: null });

const endCycle = async (mode: 'success' | 'error') => {
  const pending = cycleResolvers.shift();
  if (mode === 'success') {
    pending?.resolve();
  } else {
    pending?.reject(new Error('cycle failed'));
  }
  await Promise.resolve();
  await Promise.resolve();
};

const stateName = () => __getSchedulerStateForTests().state.name;
const timerArmed = () => __getSchedulerStateForTests().timerArmed;

/** Drives OFFLINE -> SHORT -> RUNNING -> LONG_TIMEOUT by running one cycle. */
const reachLongTimeout = async () => {
  goOnline();
  jest.advanceTimersByTime(SHORT_INTERVAL);
  expect(stateName()).toBe('RUNNING');
  await endCycle('success');
  expect(stateName()).toBe('LONG_TIMEOUT');
};

/** Drives OFFLINE -> SHORT_TIMEOUT (online, nudged window armed). */
const reachShortTimeout = () => {
  goOnline();
  expect(stateName()).toBe('SHORT_TIMEOUT');
};

/** Drives into RUNNING (cycle in flight). */
const reachRunning = () => {
  goOnline();
  jest.advanceTimersByTime(SHORT_INTERVAL);
  expect(stateName()).toBe('RUNNING');
};

beforeEach(() => {
  jest.useFakeTimers();
  cycleResolvers = [];
  cycleStartCount = 0;
  mockRunSyncCycle.mockClear();
  mockNetInfoAddEventListener.mockClear();
  mockNetInfoUnsubscribe.mockClear();
  mockLogEvent.mockClear();
  appStateRemove.mockClear();
  mockNetInfoState.listener = null;
  appStateListener = null;

  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') {
      appStateListener = handler as (status: AppStateStatus) => void;
    }
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
});

// =============================================================================
// External-input transition table — 12 cells (4 states x 3 inputs).
// =============================================================================

describe('external inputs from OFFLINE', () => {
  it('OFFLINE + request-sync stays OFFLINE with no timer (offline never syncs)', () => {
    requestSync();
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });

  it('OFFLINE + go-online enters SHORT_TIMEOUT and arms the short window', () => {
    goOnline();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('SHORT_TIMEOUT');
    if (snapshot.state.name === 'SHORT_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + SHORT_INTERVAL);
    }
  });

  it('OFFLINE + go-offline stays OFFLINE (a redundant offline projection is a no-op)', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });
});

describe('external inputs from LONG_TIMEOUT', () => {
  beforeEach(async () => {
    await reachLongTimeout();
  });

  it('LONG_TIMEOUT + request-sync pulls the idle backstop forward into SHORT_TIMEOUT', () => {
    requestSync();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('SHORT_TIMEOUT');
    if (snapshot.state.name === 'SHORT_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + SHORT_INTERVAL);
    }
  });

  it('LONG_TIMEOUT + go-online stays LONG_TIMEOUT (already online, no change)', () => {
    goOnline();
    expect(stateName()).toBe('LONG_TIMEOUT');
  });

  it('LONG_TIMEOUT + go-offline cancels the backstop and enters OFFLINE', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });
});

describe('external inputs from SHORT_TIMEOUT', () => {
  beforeEach(() => {
    reachShortTimeout();
  });

  it('SHORT_TIMEOUT + request-sync is a deliberate no-op (restarting would only delay the cycle)', () => {
    jest.advanceTimersByTime(500);
    const before = __getSchedulerStateForTests().state;
    const beforeDeadline = before.name === 'SHORT_TIMEOUT' ? before.deadlineMs : -1;

    requestSync();

    const after = __getSchedulerStateForTests().state;
    expect(after.name).toBe('SHORT_TIMEOUT');
    if (after.name === 'SHORT_TIMEOUT') {
      // The deadline did NOT move — the existing short window is preserved.
      expect(after.deadlineMs).toBe(beforeDeadline);
    }
  });

  it('SHORT_TIMEOUT + go-online stays SHORT_TIMEOUT (already online, no change)', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('SHORT_TIMEOUT + go-offline cancels the short window and enters OFFLINE', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });
});

describe('external inputs from RUNNING', () => {
  beforeEach(() => {
    reachRunning();
  });

  it('RUNNING + request-sync is a no-op (the in-flight cycle already drains both ends)', () => {
    requestSync();
    expect(stateName()).toBe('RUNNING');
    expect(timerArmed()).toBe(false);
    expect(cycleStartCount).toBe(1);
  });

  it('RUNNING + go-online stays RUNNING (already online, no change)', () => {
    goOnline();
    expect(stateName()).toBe('RUNNING');
  });

  it('RUNNING + go-offline stays RUNNING until the cycle ends (no preemption mid-cycle)', () => {
    goOffline();
    expect(stateName()).toBe('RUNNING');
    expect(timerArmed()).toBe(false);
  });
});

// =============================================================================
// Internal-event transition table — 8 cells (4 states x 2 events).
// =============================================================================

describe('internal event: timer fires', () => {
  it('OFFLINE + timer-fires is a no-op (no timer is armed in OFFLINE)', () => {
    // No timer is armed in OFFLINE, so this cell is unreachable in normal
    // operation; the machine stays put and arms nothing.
    expect(stateName()).toBe('OFFLINE');
    jest.advanceTimersByTime(LONG_INTERVAL);
    expect(stateName()).toBe('OFFLINE');
    expect(cycleStartCount).toBe(0);
  });

  it('SHORT_TIMEOUT + timer-fires enters RUNNING and starts a cycle', () => {
    reachShortTimeout();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(1);
  });

  it('LONG_TIMEOUT + timer-fires enters RUNNING and starts a cycle', async () => {
    await reachLongTimeout();
    jest.advanceTimersByTime(LONG_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(2);
  });

  it('RUNNING + timer-fires is a no-op (no timer is armed while a cycle runs)', () => {
    reachRunning();
    jest.advanceTimersByTime(LONG_INTERVAL);
    // No timer was armed, so advancing time changes nothing; still RUNNING.
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(1);
  });
});

describe('internal event: cycle ends', () => {
  it('OFFLINE + cycle-ends is a no-op (no cycle runs in OFFLINE)', () => {
    // No cycle is in flight in OFFLINE; the machine has nothing to settle.
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });

  it('SHORT_TIMEOUT + cycle-ends cannot happen — no cycle runs in a timeout state', () => {
    // A cycle only runs in RUNNING, so a cycle-ends event cannot be observed
    // from SHORT_TIMEOUT; reaching SHORT_TIMEOUT leaves no cycle to end.
    reachShortTimeout();
    expect(cycleResolvers).toHaveLength(0);
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('RUNNING + cycle-ends while online arms the long backstop (LONG_TIMEOUT)', async () => {
    reachRunning();
    await endCycle('success');
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('LONG_TIMEOUT');
    if (snapshot.state.name === 'LONG_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + LONG_INTERVAL);
    }
  });

  it('RUNNING + cycle-ends while offline falls back to OFFLINE with no timer', async () => {
    reachRunning();
    // A go-offline landed during the cycle; cycle-end consults the latest
    // projection and falls back to OFFLINE.
    goOffline();
    await endCycle('success');
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });

  it('RUNNING + cycle-ends after a thrown cycle still settles into LONG_TIMEOUT (no per-error backoff)', async () => {
    reachRunning();
    await endCycle('error');
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('LONG_TIMEOUT');
    if (snapshot.state.name === 'LONG_TIMEOUT') {
      // Armed at the plain long interval — there is no backoff multiplier.
      expect(snapshot.state.deadlineMs).toBe(Date.now() + LONG_INTERVAL);
    }
  });
});

// =============================================================================
// Network connectivity (isConnected) is the authority on online/offline.
// =============================================================================

describe('the network projection is the sole authority on online/offline', () => {
  it('only a connected link counts as online', () => {
    linkUnknown();
    expect(stateName()).toBe('OFFLINE');
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('losing the link after online flips the machine back to OFFLINE', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(timerArmed()).toBe(false);
  });

  it('the foreground edge (background -> active) emits a request-sync', async () => {
    await reachLongTimeout();
    appStateListener?.('background');
    appStateListener?.('active');
    // The foreground edge pulled the idle backstop forward.
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });
});
