// Foreground sync scheduler: a four-state machine that decides WHEN to run a
// sync cycle. It owns exactly one timer handle and exactly two external sources
// of truth — the network reachability projection and the app foreground edge.
//
// The four states are literal so every transition is a table lookup, not a
// chain of conditional branches over a nullable deadline:
//
//   OFFLINE       — no usable network; we never sync; no timer armed.
//   LONG_TIMEOUT  — online and idle; a long safety-backstop timer is ticking.
//   SHORT_TIMEOUT — online and nudged; a short debounce timer is ticking.
//   RUNNING       — a cycle is in flight; no timer armed.
//
// Three external inputs reach the machine (request sync, go online, go offline)
// and two internal events fire as a consequence of state (timer fires, cycle
// ends). The transition tables below are total: every (state, input) pair has
// an explicit outcome.
//
// The short timer is the heart of the design. A "request sync" never restarts
// an already-armed short timer — restarting would only delay the cycle. It only
// pulls a long-armed idle state forward into the short debounce window.

import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { logEvent } from '@/src/logging/logEvent';
import { runSyncCycle } from '@/src/sync/cycle';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The debounce window between a "request sync" arriving and the cycle starting. */
export const SHORT_INTERVAL = 1000;

/** The safety-backstop wait between a cycle ending and the next idle cycle. */
export const LONG_INTERVAL = 60_000;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

/** The four scheduler states, kept literal so transitions read off a table. */
export type SchedulerStateName = 'OFFLINE' | 'LONG_TIMEOUT' | 'SHORT_TIMEOUT' | 'RUNNING';

/**
 * The current scheduler state plus, when a timer is armed, the absolute epoch-ms
 * deadline that timer is due to fire at. OFFLINE and RUNNING never carry a
 * deadline; the two timeout states always do.
 */
export type SchedulerState =
  | { name: 'OFFLINE' }
  | { name: 'LONG_TIMEOUT'; deadlineMs: number }
  | { name: 'SHORT_TIMEOUT'; deadlineMs: number }
  | { name: 'RUNNING' };

/** The external inputs that drive the machine from outside. */
type ExternalInput = 'request sync' | 'go online' | 'go offline';

/** The internal events that fire as a consequence of the current state. */
type InternalEvent = 'timer fires' | 'cycle ends';

// -----------------------------------------------------------------------------
// Module-scoped machine state
//
// There is exactly one timer handle in the system at a time. The online
// projection is the latest boolean derived from NetInfo; it is consulted at
// cycle-end to decide whether to re-arm the backstop or fall back to OFFLINE.
// -----------------------------------------------------------------------------

let state: SchedulerState = { name: 'OFFLINE' };
let timerHandle: ReturnType<typeof setTimeout> | null = null;

let onlineProjection = false;

let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let previousAppState: AppStateStatus = AppState.currentState;

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

/**
 * Records one state transition with the triggering event, the from-state, the
 * to-state, the deadline of any newly armed timer, and a millisecond timestamp.
 * Logging is fire-and-forget — it never blocks or fails a transition.
 */
const logTransition = (
  event: ExternalInput | InternalEvent,
  fromState: SchedulerStateName,
  toState: SchedulerState,
): void => {
  void logEvent({
    level: 'debug',
    source: 'sync',
    event: 'sync_scheduler_transition',
    context: {
      trigger: event,
      from: fromState,
      to: toState.name,
      armedDeadlineMs:
        toState.name === 'LONG_TIMEOUT' || toState.name === 'SHORT_TIMEOUT'
          ? toState.deadlineMs
          : null,
      timestampMs: Date.now(),
    },
  });
};

// -----------------------------------------------------------------------------
// Timer plumbing
// -----------------------------------------------------------------------------

/** Cancels the single armed timer, if any. */
const cancelTimer = (): void => {
  if (timerHandle !== null) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
};

/**
 * Arms the single timer for the given interval and returns the absolute deadline
 * so the new state can record it. Any previously armed timer is cancelled first
 * so there is never more than one outstanding handle.
 */
const armTimer = (intervalMs: number): number => {
  cancelTimer();
  timerHandle = setTimeout(() => {
    timerHandle = null;
    handleInternal('timer fires');
  }, intervalMs);
  return Date.now() + intervalMs;
};

/** Moves the machine to a new state and logs the transition. */
const transitionTo = (
  event: ExternalInput | InternalEvent,
  next: SchedulerState,
): void => {
  const fromState = state.name;
  state = next;
  logTransition(event, fromState, next);
};

// -----------------------------------------------------------------------------
// The cycle leg
// -----------------------------------------------------------------------------

/**
 * Runs one cycle to completion, then settles the machine per the internal-event
 * table: a cycle that ends while online re-arms the long backstop; one that
 * ends while offline falls back to OFFLINE. Success and error settle the same
 * way — the scheduler does not distinguish; a thrown cycle is just the cycle
 * ending, and the long backstop is the only retry path (no per-error backoff).
 */
const startCycle = (): void => {
  void runSyncCycle()
    .catch(() => {
      // A thrown cycle is handled identically to a clean one: the
      // cycle-ends transition decides what to arm next. Swallowing here
      // keeps the settle logic in one place below.
    })
    .finally(() => {
      handleInternal('cycle ends');
    });
};

// -----------------------------------------------------------------------------
// Internal-event transition table (timer fires / cycle ends)
// -----------------------------------------------------------------------------

const handleInternal = (event: InternalEvent): void => {
  switch (state.name) {
    case 'OFFLINE':
      // No timer armed and no cycle running: neither internal event reaches here
      // in normal operation, and if it does there is nothing to do.
      return;

    case 'LONG_TIMEOUT':
    case 'SHORT_TIMEOUT':
      if (event === 'timer fires') {
        // The debounce / backstop window elapsed: start a cycle.
        transitionTo(event, { name: 'RUNNING' });
        startCycle();
      }
      // A cycle cannot end while we are in a timeout state.
      return;

    case 'RUNNING':
      if (event === 'cycle ends') {
        if (onlineProjection) {
          const deadlineMs = armTimer(LONG_INTERVAL);
          transitionTo(event, { name: 'LONG_TIMEOUT', deadlineMs });
        } else {
          cancelTimer();
          transitionTo(event, { name: 'OFFLINE' });
        }
      }
      // The timer is never armed while RUNNING, so "timer fires" cannot reach here.
      return;
  }
};

// -----------------------------------------------------------------------------
// External-input transition table (request sync / go online / go offline)
// -----------------------------------------------------------------------------

const handleExternal = (input: ExternalInput): void => {
  switch (state.name) {
    case 'OFFLINE':
      if (input === 'go online') {
        const deadlineMs = armTimer(SHORT_INTERVAL);
        transitionTo(input, { name: 'SHORT_TIMEOUT', deadlineMs });
      }
      // request sync / go offline: no-op while offline.
      return;

    case 'LONG_TIMEOUT':
      if (input === 'request sync') {
        // Pull the idle backstop forward into the debounce window.
        const deadlineMs = armTimer(SHORT_INTERVAL);
        transitionTo(input, { name: 'SHORT_TIMEOUT', deadlineMs });
      } else if (input === 'go offline') {
        cancelTimer();
        transitionTo(input, { name: 'OFFLINE' });
      }
      // go online: already online, no-op.
      return;

    case 'SHORT_TIMEOUT':
      if (input === 'go offline') {
        cancelTimer();
        transitionTo(input, { name: 'OFFLINE' });
      }
      // request sync: the short timer is already armed; restarting it would only
      // DELAY the cycle, so this is a deliberate no-op. go online: already
      // online, no-op.
      return;

    case 'RUNNING':
      // Every external input is a no-op while a cycle is in flight. The cycle
      // drains both ends, so an edit landing mid-cycle is picked up by the
      // cycle's own iteration; the cycle-ends transition re-arms afterwards.
      return;
  }
};

// -----------------------------------------------------------------------------
// NetInfo wiring
//
// NetInfo is the sole authority on online/offline. A single listener projects
// `isInternetReachable === true` to a boolean and emits "go online" / "go
// offline" only when that projection CHANGES. The initial projection is false,
// so the machine starts OFFLINE and waits for the first definitive `true`
// before considering itself online.
// -----------------------------------------------------------------------------

const handleNetInfoState = (netState: NetInfoState): void => {
  const nextProjection = netState.isInternetReachable === true;
  if (nextProjection === onlineProjection) {
    // No change in the boolean projection: a link-layer flip, a VPN handoff, or
    // a still-null reachability all collapse to nothing here.
    return;
  }

  onlineProjection = nextProjection;
  handleExternal(nextProjection ? 'go online' : 'go offline');
};

// -----------------------------------------------------------------------------
// AppState wiring
//
// The foreground edge (background -> active) emits "request sync". An
// active -> background transition and every `inactive` transition are no-ops.
// -----------------------------------------------------------------------------

const handleAppStateChange = (nextAppState: AppStateStatus): void => {
  const wasBackground = previousAppState === 'background';
  previousAppState = nextAppState;

  if (wasBackground && nextAppState === 'active') {
    handleExternal('request sync');
  }
};

// -----------------------------------------------------------------------------
// Public surface
// -----------------------------------------------------------------------------

/**
 * The single external entry point. An edit, the app foreground edge, or the
 * cold-launch trigger all call this. Whether it does anything depends on the
 * current state per the external-input table — in OFFLINE it is a no-op.
 */
export const requestSync = (): void => {
  handleExternal('request sync');
};

/**
 * Wires the NetInfo and AppState listeners and arms the initial state (OFFLINE).
 * Idempotent: a second call with the listeners already wired is a no-op so a
 * double-mount cannot stack subscriptions.
 */
export const startSyncScheduler = (): void => {
  if (netInfoUnsubscribe !== null) {
    return;
  }

  state = { name: 'OFFLINE' };
  onlineProjection = false;
  previousAppState = AppState.currentState;

  // Wiring the listeners must never crash app boot. If the network library is
  // unavailable (e.g. a build where its native module did not link), we stay in
  // OFFLINE — the safe default — and log it rather than taking down the root
  // layout. Sync simply does not run until a working build is present.
  try {
    netInfoUnsubscribe = NetInfo.addEventListener(handleNetInfoState);
    appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  } catch (error) {
    void logEvent({
      level: 'error',
      source: 'sync',
      event: 'sync_scheduler_start_failed',
      message: 'Sync scheduler listeners could not be wired; staying offline.',
      context: { error: String(error) },
    });
  }
};

/**
 * Tears down both listeners and cancels any armed timer. Leaves the machine in
 * OFFLINE so a subsequent start begins from a clean slate.
 */
export const stopSyncScheduler = (): void => {
  cancelTimer();

  if (netInfoUnsubscribe !== null) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }

  if (appStateSubscription !== null) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }

  state = { name: 'OFFLINE' };
};

/**
 * Test-only inspector exposing the current state (and any armed deadline) plus
 * the latest online projection. Lets the unit suite walk the transition tables
 * cell-by-cell without reaching into module internals.
 */
export const __getSchedulerStateForTests = (): {
  state: SchedulerState;
  online: boolean;
  timerArmed: boolean;
} => ({
  state,
  online: onlineProjection,
  timerArmed: timerHandle !== null,
});
