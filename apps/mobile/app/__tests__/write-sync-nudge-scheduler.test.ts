/* eslint-disable import/first */

/**
 * End-to-end wiring for the write-time sync nudge: a `notifyLocalWrite()` fired
 * by the data layer must reach the scheduler's single `requestSync` entry point
 * once the scheduler has wired itself at boot.
 *
 * This is the other half of `write-sync-nudge.test.ts`: that suite proves the
 * repos FIRE the emitter post-commit; this one proves the scheduler SUBSCRIBES
 * to it (via `startSyncScheduler`) and UNSUBSCRIBES on stop. Together they close
 * the bug — a committed edit now pulls an idle scheduler forward into the short
 * debounce window instead of waiting for the long backstop.
 *
 * Uses the REAL `@/src/sync/write-nudge` emitter and the real scheduler; only
 * NetInfo, the cycle, and logging are stubbed (mirroring sync-scheduler.test.ts)
 * so the machine's observable state can be driven and inspected deterministically.
 */

import type { LogEventParams } from '@/src/logging/logEvent';

// Controllable cycle stub: each run resolves only when the test settles it, so
// RUNNING and the post-cycle LONG_TIMEOUT backstop are both reachable on demand.
let cycleResolvers: Array<() => void> = [];
const mockRunSyncCycle = jest.fn(
  () =>
    new Promise<void>((resolve) => {
      cycleResolvers.push(resolve);
    }),
);
jest.mock('@/src/sync/cycle', () => ({
  runSyncCycle: () => mockRunSyncCycle(),
}));

// NetInfo stub: capture the registered listener so the test can drive the
// online projection (the scheduler starts OFFLINE, where requestSync is a no-op).
type NetInfoSnapshot = { isConnected?: boolean | null };
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
  __getSchedulerStateForTests,
  LONG_INTERVAL,
  SHORT_INTERVAL,
  startSyncScheduler,
  stopSyncScheduler,
} from '@/src/sync/scheduler';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

const goOnline = () => mockNetInfoState.listener?.({ isConnected: true });

/** Settle the most recently started cycle and flush its .finally() chain. */
const endCycle = async () => {
  const resolve = cycleResolvers.shift();
  resolve?.();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  cycleResolvers = [];
  mockRunSyncCycle.mockClear();
  mockNetInfoState.listener = null;
  mockNetInfoUnsubscribe.mockClear();
  mockLogEvent.mockClear();
});

afterEach(() => {
  stopSyncScheduler();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('scheduler subscribes its requestSync entry to the write-nudge emitter', () => {
  it('a local-write nudge pulls an idle (LONG_TIMEOUT) online scheduler into the short debounce window', async () => {
    startSyncScheduler();
    goOnline(); // OFFLINE -> SHORT_TIMEOUT (online edge arms the short window)
    jest.advanceTimersByTime(SHORT_INTERVAL); // short window elapses -> RUNNING (cycle starts)
    await endCycle(); // cycle ends while online -> LONG_TIMEOUT (idle backstop)

    const idle = __getSchedulerStateForTests();
    expect(idle.state.name).toBe('LONG_TIMEOUT');
    if (idle.state.name === 'LONG_TIMEOUT') {
      // The long backstop is ~60s out.
      expect(idle.state.deadlineMs - Date.now()).toBeGreaterThan(SHORT_INTERVAL);
    }

    // Fire the data-layer nudge through the REAL emitter. If the scheduler is
    // subscribed, this reaches requestSync, which pulls the idle backstop forward
    // into the short debounce window.
    notifyLocalWrite();

    const nudged = __getSchedulerStateForTests();
    expect(nudged.state.name).toBe('SHORT_TIMEOUT');
    if (nudged.state.name === 'SHORT_TIMEOUT') {
      expect(nudged.state.deadlineMs - Date.now()).toBeLessThanOrEqual(SHORT_INTERVAL);
    }

    // And the pulled-forward short window actually fires a cycle.
    jest.advanceTimersByTime(SHORT_INTERVAL);
    expect(__getSchedulerStateForTests().state.name).toBe('RUNNING');
    expect(mockRunSyncCycle).toHaveBeenCalledTimes(2);
  });

  it('does nothing while OFFLINE — a nudge before going online is a coalesced no-op', () => {
    startSyncScheduler();
    const before = __getSchedulerStateForTests();
    expect(before.online).toBe(false);
    expect(before.state.name).toBe('OFFLINE');

    notifyLocalWrite();

    const after = __getSchedulerStateForTests();
    // requestSync is a documented no-op while OFFLINE; the nudge is safe and
    // cheap, leaving the machine untouched and no cycle started.
    expect(after.state.name).toBe('OFFLINE');
    expect(after.timerArmed).toBe(false);
    expect(mockRunSyncCycle).not.toHaveBeenCalled();
  });

  it('after stopSyncScheduler the emitter is unsubscribed — a later nudge does not crash or arm', () => {
    startSyncScheduler();
    goOnline();
    stopSyncScheduler();

    // No subscriber remains; the nudge must be a harmless no-op.
    expect(() => notifyLocalWrite()).not.toThrow();
    const after = __getSchedulerStateForTests();
    expect(after.state.name).toBe('OFFLINE');
    expect(after.timerArmed).toBe(false);
  });

  it('keeps the long backstop usable too: LONG_INTERVAL is the idle re-arm', async () => {
    // Sanity anchor that the idle state we pull forward from is the real backstop
    // window, so the nudge is genuinely accelerating sync, not a cosmetic flip.
    startSyncScheduler();
    goOnline();
    jest.advanceTimersByTime(SHORT_INTERVAL);
    await endCycle();
    const idle = __getSchedulerStateForTests();
    expect(idle.state.name).toBe('LONG_TIMEOUT');
    if (idle.state.name === 'LONG_TIMEOUT') {
      expect(idle.state.deadlineMs - Date.now()).toBeLessThanOrEqual(LONG_INTERVAL);
      expect(idle.state.deadlineMs - Date.now()).toBeGreaterThan(SHORT_INTERVAL);
    }
  });
});
