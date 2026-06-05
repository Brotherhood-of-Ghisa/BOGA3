/* eslint-disable import/first */

/**
 * Walks the foreground scheduler's two transition tables cell-by-cell, plus the
 * higher-level integration paths (the foreground edge via AppState, the network
 * projection emitting inputs only on change, and structured logging on every
 * transition).
 *
 * The scheduler's outbound dependencies are all stubbed: the cycle is a
 * controllable deferred so RUNNING can be held open or settled on demand, the
 * network library exposes its registered listener so tests can feed reachability
 * snapshots, and AppState exposes its change listener so tests can drive the
 * foreground edge. Timers are faked so the short/long windows advance
 * deterministically.
 */

import { AppState, type AppStateStatus } from 'react-native';

import type { LogEventParams } from '@/src/logging/logEvent';

// --- Controllable cycle stub -------------------------------------------------
//
// runSyncCycle returns a promise the test resolves/rejects by hand so the
// RUNNING state can be observed before the cycle settles.
let cycleResolvers: { resolve: () => void; reject: (error: unknown) => void }[] = [];
let cycleStartCount = 0;

const mockRunSyncCycle = jest.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      cycleStartCount += 1;
      cycleResolvers.push({ resolve, reject });
    }),
);

jest.mock('@/src/sync/cycle', () => ({
  runSyncCycle: () => mockRunSyncCycle(),
}));

// --- NetInfo stub ------------------------------------------------------------
//
// Captures the listener registered by addEventListener so tests can push
// reachability snapshots through it, and records the unsubscribe call. The
// `mock`-prefixed names are the only out-of-scope references babel-jest allows
// inside a hoisted jest.mock factory.
// The scheduler keys "online" off `isConnected`; `isInternetReachable` is carried
// here only so tests can prove it is IGNORED (a connected link is online even when
// the reachability probe is null or false).
type NetInfoSnapshot = { isConnected?: boolean | null; isInternetReachable?: boolean | null };
const mockNetInfoState: { listener: ((state: NetInfoSnapshot) => void) | null } = {
  listener: null,
};
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

// --- Logging spy -------------------------------------------------------------
const mockLogEvent = jest.fn((_params: LogEventParams) => Promise.resolve());
jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

import {
  __getSchedulerStateForTests,
  LONG_INTERVAL,
  requestSync,
  SHORT_INTERVAL,
  startSyncScheduler,
  stopSyncScheduler,
} from '@/src/sync/scheduler';

// --- AppState change-listener capture ---------------------------------------
let appStateListener: ((status: AppStateStatus) => void) | null = null;
const appStateRemove = jest.fn();

const goOnline = () => mockNetInfoState.listener?.({ isConnected: true });
const goOffline = () => mockNetInfoState.listener?.({ isConnected: false });
/** A connected link whose reachability probe has not resolved (the iOS sim case). */
const connectedReachabilityNull = () =>
  mockNetInfoState.listener?.({ isConnected: true, isInternetReachable: null });
/** A connected link whose reachability probe says unreachable (captive portal). */
const connectedReachabilityFalse = () =>
  mockNetInfoState.listener?.({ isConnected: true, isInternetReachable: false });

/** Settle the most recently started cycle (success). */
const endCycleSuccess = async () => {
  const pending = cycleResolvers.shift();
  pending?.resolve();
  // Let the .finally() chain run so the cycle-ends transition lands.
  await Promise.resolve();
  await Promise.resolve();
};

/** Settle the most recently started cycle (thrown). */
const endCycleError = async () => {
  const pending = cycleResolvers.shift();
  pending?.reject(new Error('cycle failed'));
  await Promise.resolve();
  await Promise.resolve();
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

  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, handler) => {
      if (type === 'change') {
        appStateListener = handler as (status: AppStateStatus) => void;
      }
      return { remove: appStateRemove } as never;
    });
  // Default the lifecycle baseline to a clean "active" so a test's first
  // background->active edge is unambiguous.
  (AppState as { currentState: AppStateStatus }).currentState = 'active';

  startSyncScheduler();
});

afterEach(() => {
  stopSyncScheduler();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const stateName = () => __getSchedulerStateForTests().state.name;
const isTimerArmed = () => __getSchedulerStateForTests().timerArmed;

// =============================================================================
// External-input transition table
// =============================================================================

describe('external inputs from OFFLINE', () => {
  it('starts in OFFLINE with no timer armed', () => {
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });

  it('request sync -> no-op (stays OFFLINE, no timer)', () => {
    requestSync();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });

  it('go online -> SHORT_TIMEOUT armed at the short interval', () => {
    goOnline();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('SHORT_TIMEOUT');
    expect(isTimerArmed()).toBe(true);
    if (snapshot.state.name === 'SHORT_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + SHORT_INTERVAL);
    }
  });

  it('go offline -> no-op (stays OFFLINE)', () => {
    // Already offline; a redundant offline projection makes no change so the
    // projection-change filter swallows it. Stays OFFLINE regardless.
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });
});

describe('external inputs from LONG_TIMEOUT', () => {
  beforeEach(async () => {
    // Drive OFFLINE -> SHORT -> RUNNING -> LONG by running one cycle online.
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    await endCycleSuccess();
    expect(stateName()).toBe('LONG_TIMEOUT');
  });

  it('request sync -> cancels long timer, SHORT_TIMEOUT armed at the short interval', () => {
    requestSync();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('SHORT_TIMEOUT');
    expect(isTimerArmed()).toBe(true);
    if (snapshot.state.name === 'SHORT_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + SHORT_INTERVAL);
    }
  });

  it('request sync pulls the deadline forward (fires near +short, not +long)', () => {
    requestSync();
    // The short window elapses well before the long backstop would have.
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(2);
  });

  it('go online -> no-op (already online)', () => {
    // Reachability is still true; a redundant true projection is filtered out.
    goOnline();
    expect(stateName()).toBe('LONG_TIMEOUT');
  });

  it('go offline -> cancels timer, OFFLINE', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });
});

describe('external inputs from SHORT_TIMEOUT', () => {
  beforeEach(() => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('request sync -> no-op (does NOT restart the timer)', () => {
    // Let part of the short window elapse, then nudge five times.
    jest.advanceTimersByTime(500);
    const before = __getSchedulerStateForTests().state;
    const beforeDeadline = before.name === 'SHORT_TIMEOUT' ? before.deadlineMs : -1;

    for (let i = 0; i < 5; i += 1) {
      requestSync();
    }

    const after = __getSchedulerStateForTests().state;
    expect(after.name).toBe('SHORT_TIMEOUT');
    if (after.name === 'SHORT_TIMEOUT') {
      expect(after.deadlineMs).toBe(beforeDeadline);
    }

    // The cycle fires at the ORIGINAL mark (500ms more), not 1s after the last nudge.
    jest.advanceTimersByTime(500);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(1);
  });

  it('go online -> no-op (already online)', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('go offline -> cancels timer, OFFLINE', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });
});

describe('external inputs from RUNNING', () => {
  beforeEach(() => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
  });

  it('request sync -> no-op (stays RUNNING, no extra timer)', () => {
    requestSync();
    expect(stateName()).toBe('RUNNING');
    expect(isTimerArmed()).toBe(false);
    expect(cycleStartCount).toBe(1);
  });

  it('go online -> no-op (stays RUNNING)', () => {
    // The projection is already true; a redundant true is filtered before the
    // machine even sees it, so RUNNING is preserved.
    goOnline();
    expect(stateName()).toBe('RUNNING');
  });

  it('go offline -> no-op for the external input (stays RUNNING until cycle ends)', () => {
    goOffline();
    expect(stateName()).toBe('RUNNING');
    expect(isTimerArmed()).toBe(false);
  });
});

// =============================================================================
// Internal-event transition table
// =============================================================================

describe('internal events: timer fires', () => {
  it('SHORT_TIMEOUT timer fires -> RUNNING, cycle started', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(1);
  });

  it('LONG_TIMEOUT timer fires -> RUNNING, cycle started', async () => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    await endCycleSuccess();
    expect(stateName()).toBe('LONG_TIMEOUT');

    jest.advanceTimersByTime(LONG_INTERVAL);
    expect(stateName()).toBe('RUNNING');
    expect(cycleStartCount).toBe(2);
  });
});

describe('internal events: cycle ends', () => {
  beforeEach(() => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');
  });

  it('cycle ends while online -> LONG_TIMEOUT armed at the long interval', async () => {
    await endCycleSuccess();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('LONG_TIMEOUT');
    expect(isTimerArmed()).toBe(true);
    if (snapshot.state.name === 'LONG_TIMEOUT') {
      expect(snapshot.state.deadlineMs).toBe(Date.now() + LONG_INTERVAL);
    }
  });

  it('cycle ends while offline -> OFFLINE, no timer', async () => {
    // A "go offline" landed during the cycle; the cycle-end consults the
    // latest projection and falls back to OFFLINE.
    goOffline();
    expect(stateName()).toBe('RUNNING');
    await endCycleSuccess();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });

  it('cycle ends after a thrown error while online -> LONG_TIMEOUT (no backoff)', async () => {
    await endCycleError();
    const snapshot = __getSchedulerStateForTests();
    expect(snapshot.state.name).toBe('LONG_TIMEOUT');
    expect(isTimerArmed()).toBe(true);
    if (snapshot.state.name === 'LONG_TIMEOUT') {
      // Armed at the plain long interval — there is no per-error backoff value.
      expect(snapshot.state.deadlineMs).toBe(Date.now() + LONG_INTERVAL);
    }
  });

  it('exposes no nextAttemptAt-style backoff field on the public surface', async () => {
    await endCycleError();
    const snapshot = __getSchedulerStateForTests();
    expect(Object.keys(snapshot)).toEqual(['state', 'online', 'timerArmed']);
    expect('nextAttemptAt' in snapshot).toBe(false);
  });
});

// =============================================================================
// Integration: AppState foreground edge
// =============================================================================

describe('AppState foreground edge', () => {
  it('background -> active emits request sync (LONG_TIMEOUT pulled to SHORT_TIMEOUT)', async () => {
    // Arm LONG_TIMEOUT first so the foreground edge has a visible effect.
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    await endCycleSuccess();
    expect(stateName()).toBe('LONG_TIMEOUT');

    appStateListener?.('background');
    appStateListener?.('active');

    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('inactive -> active does NOT emit request sync', async () => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    await endCycleSuccess();
    expect(stateName()).toBe('LONG_TIMEOUT');
    const before = __getSchedulerStateForTests().state;
    const beforeDeadline = before.name === 'LONG_TIMEOUT' ? before.deadlineMs : -1;

    appStateListener?.('inactive');
    appStateListener?.('active');

    const after = __getSchedulerStateForTests().state;
    expect(after.name).toBe('LONG_TIMEOUT');
    if (after.name === 'LONG_TIMEOUT') {
      expect(after.deadlineMs).toBe(beforeDeadline);
    }
  });

  it('active -> background does NOT emit request sync', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
    const before = __getSchedulerStateForTests().state;
    const beforeDeadline = before.name === 'SHORT_TIMEOUT' ? before.deadlineMs : -1;

    appStateListener?.('background');

    const after = __getSchedulerStateForTests().state;
    expect(after.name).toBe('SHORT_TIMEOUT');
    if (after.name === 'SHORT_TIMEOUT') {
      expect(after.deadlineMs).toBe(beforeDeadline);
    }
  });
});

// =============================================================================
// Integration: NetInfo projection emits inputs only on change
// =============================================================================

describe('NetInfo projection', () => {
  it('emits go online when isConnected === true (only on change)', () => {
    goOffline();
    expect(stateName()).toBe('OFFLINE');

    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('treats a connected link as online even when the reachability probe is null', () => {
    // The iOS simulator reports isConnected=true with isInternetReachable=null;
    // keying off isConnected (not the probe) is what keeps it from being stranded
    // OFFLINE — the regression this fix addresses.
    connectedReachabilityNull();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('treats a connected link as online even when the reachability probe is false', () => {
    // Pure isConnected: a captive portal / blocked probe host still counts as
    // online; the sync cycle's own failure (not the probe) is the authority on
    // backend reachability.
    connectedReachabilityFalse();
    expect(stateName()).toBe('SHORT_TIMEOUT');
  });

  it('a missing/null isConnected projects offline', () => {
    mockNetInfoState.listener?.({ isConnected: null });
    expect(stateName()).toBe('OFFLINE');
  });

  it('repeated connected snapshots produce no further input (no timer restart)', () => {
    goOnline();
    const before = __getSchedulerStateForTests().state;
    const beforeDeadline = before.name === 'SHORT_TIMEOUT' ? before.deadlineMs : -1;
    jest.advanceTimersByTime(300);

    goOnline();
    goOnline();

    const after = __getSchedulerStateForTests().state;
    expect(after.name).toBe('SHORT_TIMEOUT');
    if (after.name === 'SHORT_TIMEOUT') {
      // The short timer was never restarted by the redundant connected snapshots.
      expect(after.deadlineMs).toBe(beforeDeadline);
    }
  });

  it('losing the link after online flips back to offline', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');

    // isConnected:false is a real change from true: emits go offline.
    goOffline();
    expect(stateName()).toBe('OFFLINE');
    expect(isTimerArmed()).toBe(false);
  });
});

// =============================================================================
// Integration: logging covers every transition
// =============================================================================

describe('structured logging', () => {
  const transitionLogs = (): LogEventParams[] =>
    mockLogEvent.mock.calls
      .map(([params]) => params)
      .filter((params) => params.event === 'sync_scheduler_transition');

  it('logs a transition with all required fields', () => {
    goOnline();
    const logs = transitionLogs();
    expect(logs.length).toBe(1);

    const params = logs[0];
    expect(params.source).toBe('sync');
    expect(params.context).toMatchObject({
      trigger: 'go online',
      from: 'OFFLINE',
      to: 'SHORT_TIMEOUT',
    });
    expect(params.context?.armedDeadlineMs).toEqual(expect.any(Number));
    expect(params.context?.timestampMs).toEqual(expect.any(Number));
  });

  it('logs every transition across a full online->cycle->idle path', async () => {
    goOnline(); // OFFLINE -> SHORT_TIMEOUT
    jest.advanceTimersByTime(SHORT_INTERVAL); // SHORT_TIMEOUT -> RUNNING
    await endCycleSuccess(); // RUNNING -> LONG_TIMEOUT

    const triggers = transitionLogs().map((params) => params.context?.trigger);
    expect(triggers).toEqual(['go online', 'timer fires', 'cycle ends']);
  });

  it('records a null armedDeadlineMs for transitions into OFFLINE', () => {
    goOnline();
    goOffline();

    const offlineLog = transitionLogs().find((params) => params.context?.to === 'OFFLINE');
    expect(offlineLog).toBeDefined();
    expect(offlineLog?.context?.armedDeadlineMs).toBeNull();
  });
});

// =============================================================================
// Integration: observability for ignored events, cycle errors, foreground edge
// =============================================================================

describe('observability for no-op / error / foreground paths', () => {
  const logsFor = (event: string): LogEventParams[] =>
    mockLogEvent.mock.calls.map(([params]) => params).filter((params) => params.event === event);

  const ignoredLogs = () => logsFor('sync_scheduler_ignored_event');

  it('logs an ignored event when request sync is a no-op in OFFLINE', () => {
    requestSync();
    expect(stateName()).toBe('OFFLINE');

    const logs = ignoredLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('debug');
    expect(logs[0].context).toMatchObject({ trigger: 'request sync', state: 'OFFLINE' });
  });

  it('logs the deliberate short-window request-sync no-op as ignored', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');

    requestSync();

    const logs = ignoredLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].context).toMatchObject({ trigger: 'request sync', state: 'SHORT_TIMEOUT' });
  });

  it('logs an ignored event when an external input lands while RUNNING', () => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');

    requestSync();

    const logs = ignoredLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].context).toMatchObject({ trigger: 'request sync', state: 'RUNNING' });
  });

  it('logs a distinct cycle-error event when the cycle throws', async () => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(stateName()).toBe('RUNNING');

    await endCycleError();

    const logs = logsFor('sync_scheduler_cycle_error');
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('warn');
    expect(String(logs[0].context?.error)).toContain('cycle failed');
    // Control flow is unchanged: the failed cycle still settles into LONG_TIMEOUT.
    expect(stateName()).toBe('LONG_TIMEOUT');
  });

  it('does not log a cycle-error event when the cycle resolves cleanly', async () => {
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    await endCycleSuccess();

    expect(logsFor('sync_scheduler_cycle_error').length).toBe(0);
  });

  it('emits a distinct foreground-sync event on the background -> active edge', () => {
    goOnline();
    expect(stateName()).toBe('SHORT_TIMEOUT');

    appStateListener?.('background');
    appStateListener?.('active');

    const logs = logsFor('sync_scheduler_foreground_sync_requested');
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('debug');
  });

  it('does not emit the foreground-sync event on inactive -> active', () => {
    goOnline();

    appStateListener?.('inactive');
    appStateListener?.('active');

    expect(logsFor('sync_scheduler_foreground_sync_requested').length).toBe(0);
  });
});

// =============================================================================
// Lifecycle: start / stop wiring
// =============================================================================

describe('scheduler lifecycle', () => {
  it('stopSyncScheduler tears down both listeners and cancels the timer', () => {
    goOnline();
    expect(isTimerArmed()).toBe(true);

    stopSyncScheduler();

    expect(mockNetInfoUnsubscribe).toHaveBeenCalledTimes(1);
    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(isTimerArmed()).toBe(false);
    expect(stateName()).toBe('OFFLINE');
  });

  it('startSyncScheduler is idempotent (no stacked subscriptions)', () => {
    // beforeEach already started it once.
    startSyncScheduler();
    expect(mockNetInfoAddEventListener).toHaveBeenCalledTimes(1);
  });

  it('logs at error AND re-throws when the network listener cannot be wired', () => {
    // Reset to a clean, un-started scheduler, then make listener registration
    // throw the way a missing native module would. A broken build must surface
    // at boot rather than silently disabling sync forever, so the failure both
    // logs at error level and propagates out to the caller.
    stopSyncScheduler();
    mockLogEvent.mockClear();
    mockNetInfoAddEventListener.mockImplementationOnce(() => {
      throw new Error('NativeModule.RNCNetInfo is null');
    });

    expect(() => startSyncScheduler()).toThrow('NativeModule.RNCNetInfo is null');

    const failureLog = mockLogEvent.mock.calls
      .map(([params]) => params)
      .find((params) => params.event === 'sync_scheduler_start_failed');
    expect(failureLog).toBeDefined();
    expect(failureLog?.level).toBe('error');
  });

  it('re-arms cleanly on a healthy start after a wiring failure', () => {
    // After a throw, a subsequent start in a healthy build wires the listeners
    // (the failed start left the unsubscribe handle null, so the idempotence
    // guard does not block the retry).
    stopSyncScheduler();
    mockNetInfoAddEventListener.mockImplementationOnce(() => {
      throw new Error('NativeModule.RNCNetInfo is null');
    });
    expect(() => startSyncScheduler()).toThrow();

    expect(() => startSyncScheduler()).not.toThrow();
    expect(stateName()).toBe('OFFLINE');
    expect(mockNetInfoState.listener).not.toBeNull();
  });
});
