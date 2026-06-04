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
import { getSyncProgress, type SyncProgress } from '@/src/sync/progress';

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

/**
 * Compile-time exhaustiveness guard. Calling this in a switch `default:` makes
 * the TypeScript compiler reject the code if any member of the discriminated
 * union is left unhandled — the unhandled case would not narrow to `never` and
 * the call would fail to type-check. At runtime it throws, so an impossible
 * state reached via untyped boundaries is loud rather than silently ignored.
 */
const assertNever = (value: never): never => {
  throw new Error(`Unhandled scheduler state: ${JSON.stringify(value)}`);
};

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

// The most recent cycle's failure, or null if the latest cycle ended cleanly.
// A cycle that throws records its message here; a cycle that completes without
// throwing clears it. This is the read-only signal the status surface shows as
// the error state — it never changes the machine's behaviour.
let lastCycleError: string | null = null;

// The wall-clock time (epoch ms) at which the most recent cycle finished
// without throwing, or null if no cycle has completed cleanly yet. This is the
// "last successful sync" the status surface displays.
let lastSuccessAtMs: number | null = null;

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

/**
 * Records an event the machine deliberately ignored: a (state, trigger) pair
 * that the transition tables map to no-op. These are meaningful — for instance
 * the short-debounce-window "request sync" that intentionally does NOT restart
 * the timer is the heart of the design, and seeing it in the logs confirms the
 * coalescing is working rather than that an input was lost.
 */
const logIgnoredEvent = (
  trigger: ExternalInput | InternalEvent,
  fromState: SchedulerStateName,
): void => {
  void logEvent({
    level: 'debug',
    source: 'sync',
    event: 'sync_scheduler_ignored_event',
    context: {
      trigger,
      state: fromState,
      timestampMs: Date.now(),
    },
  });
};

/**
 * Records a cycle that ended by throwing. The settle logic treats a thrown
 * cycle identically to a clean one (the long backstop is the only retry path),
 * but the error itself — an auth-required / internal / FK-violation envelope or
 * a transport failure — is meaningful signal that was previously invisible.
 */
const logCycleError = (error: unknown): void => {
  void logEvent({
    level: 'warn',
    source: 'sync',
    event: 'sync_scheduler_cycle_error',
    message: 'Sync cycle ended with an error; the long backstop will retry.',
    context: {
      error: String(error),
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
    .then(() => {
      // The cycle completed without throwing: record the success time and
      // clear any earlier failure so the status surface reflects a healthy
      // latest cycle.
      lastSuccessAtMs = Date.now();
      lastCycleError = null;
    })
    .catch((error: unknown) => {
      // A thrown cycle is handled identically to a clean one for control
      // flow: the cycle-ends transition below decides what to arm next, and
      // the long backstop is the only retry path. We do surface the error
      // here as distinct observability — the failure is otherwise invisible —
      // and retain it so the status surface can show the latest error state.
      lastCycleError = error instanceof Error ? error.message : String(error);
      logCycleError(error);
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
      logIgnoredEvent(event, state.name);
      return;

    case 'LONG_TIMEOUT':
    case 'SHORT_TIMEOUT':
      if (event === 'timer fires') {
        // The debounce / backstop window elapsed: start a cycle.
        transitionTo(event, { name: 'RUNNING' });
        startCycle();
        return;
      }
      // A cycle cannot end while we are in a timeout state.
      logIgnoredEvent(event, state.name);
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
        return;
      }
      // The timer is never armed while RUNNING, so "timer fires" cannot reach here.
      logIgnoredEvent(event, state.name);
      return;

    default:
      // Exhaustiveness guard: if a state is added to the union without a case
      // above, this fails to type-check.
      return assertNever(state);
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
        return;
      }
      // request sync / go offline: no-op while offline.
      logIgnoredEvent(input, state.name);
      return;

    case 'LONG_TIMEOUT':
      if (input === 'request sync') {
        // Pull the idle backstop forward into the debounce window.
        const deadlineMs = armTimer(SHORT_INTERVAL);
        transitionTo(input, { name: 'SHORT_TIMEOUT', deadlineMs });
        return;
      }
      if (input === 'go offline') {
        cancelTimer();
        transitionTo(input, { name: 'OFFLINE' });
        return;
      }
      // go online: already online, no-op.
      logIgnoredEvent(input, state.name);
      return;

    case 'SHORT_TIMEOUT':
      if (input === 'go offline') {
        cancelTimer();
        transitionTo(input, { name: 'OFFLINE' });
        return;
      }
      // request sync: the short timer is already armed; restarting it would only
      // DELAY the cycle, so this is a deliberate no-op. go online: already
      // online, no-op.
      logIgnoredEvent(input, state.name);
      return;

    case 'RUNNING':
      // Every external input is a no-op while a cycle is in flight. The cycle
      // drains both ends, so an edit landing mid-cycle is picked up by the
      // cycle's own iteration; the cycle-ends transition re-arms afterwards.
      logIgnoredEvent(input, state.name);
      return;

    default:
      // Exhaustiveness guard: if a state is added to the union without a case
      // above, this fails to type-check.
      return assertNever(state);
  }
};

// -----------------------------------------------------------------------------
// NetInfo wiring
//
// NetInfo is the authority on whether the device has a network link. A single
// listener projects `isConnected === true` to a boolean and emits "go online" /
// "go offline" only when that projection CHANGES. The initial projection is
// false, so the machine starts OFFLINE and waits for the first reported link.
//
// We deliberately key off `isConnected`, NOT `isInternetReachable`. The latter
// is a probe to a generic external host (NetInfo's default connectivity-check
// endpoint): it is `null` until that probe resolves, `false` behind a captive
// portal or on networks that block the probe host (e.g. where Google's
// connectivity-check endpoints are unreachable), and on the iOS simulator it
// stays `null` indefinitely. Gating sync on `isInternetReachable === true`
// therefore strands a user who genuinely has a connection — and can reach OUR
// backend — behind a permanent "You are offline" first-sync block. So a
// reported link counts as online, and the sync cycle's own success/failure is
// the authority on whether the backend is actually reachable; only a true
// link-down (no connection) projects offline.
// -----------------------------------------------------------------------------

const handleNetInfoState = (netState: NetInfoState): void => {
  const nextProjection = netState.isConnected === true;
  if (nextProjection === onlineProjection) {
    // No change in the boolean projection: a reachability-probe flip
    // (true/false/null) while the link state is unchanged collapses to nothing.
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
    // The state machine has a single entry point with no per-source distinction
    // — a foreground edge feeds the same "request sync" as a repo write. We log
    // the source here so a foreground-triggered sync is distinguishable in the
    // logs from a write-triggered one without forking the machine input.
    void logEvent({
      level: 'debug',
      source: 'sync',
      event: 'sync_scheduler_foreground_sync_requested',
      context: { timestampMs: Date.now() },
    });
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
 * Wires the NetInfo and AppState listeners and arms the machine. Idempotent: a
 * second call with the listeners already wired is a no-op so a double-mount
 * cannot stack subscriptions.
 *
 * The network projection is NOT reset to OFFLINE on (re)start: it is the device's
 * network truth, which does not change merely because the scheduler was torn down
 * and re-wired (the root layout remounting on a deep-link navigation does exactly
 * that). NetInfo only emits on a CHANGE, and `addEventListener`'s initial emit is
 * not reliably redelivered on rapid re-subscribe — so resetting the projection to
 * false on every start would pin the machine OFFLINE on a connected device, which
 * strands the first-sync gate on "You are offline." Instead the projection
 * persists and the machine is re-armed from it below.
 */
export const startSyncScheduler = (): void => {
  if (netInfoUnsubscribe !== null) {
    return;
  }

  state = { name: 'OFFLINE' };
  lastCycleError = null;
  lastSuccessAtMs = null;
  previousAppState = AppState.currentState;

  // Wire the network and foreground listeners. In a healthy build these calls
  // do not throw. A throw means a genuinely broken build (e.g. a missing native
  // module), which would leave sync permanently dead. We log the failure as an
  // error for observability and then re-throw so the failure surfaces at boot
  // rather than silently disabling sync. The caller (the root layout's
  // bootstrap effect) propagates it.
  try {
    netInfoUnsubscribe = NetInfo.addEventListener(handleNetInfoState);
    appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  } catch (error) {
    void logEvent({
      level: 'error',
      source: 'sync',
      event: 'sync_scheduler_start_failed',
      message: 'Sync scheduler listeners could not be wired.',
      context: { error: String(error) },
    });
    throw error;
  }

  // Re-derive the machine from the persisted network projection. A bare remount
  // re-wires the listeners but NetInfo emits nothing for an unchanged still-online
  // device, so the just-reset OFFLINE state would never advance on its own. When
  // the projection is online, feed the machine the same "go online" the listener
  // would, so the cycle resumes deterministically.
  if (onlineProjection) {
    handleExternal('go online');
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
 * Test-only: fully resets module state — including the persisted network
 * projection that `stopSyncScheduler` intentionally keeps — so each suite starts
 * from a clean, offline scheduler. Production code never calls this.
 */
export const __resetSchedulerForTests = (): void => {
  stopSyncScheduler();
  onlineProjection = false;
  lastCycleError = null;
  lastSuccessAtMs = null;
};

/**
 * The production read of the scheduler's observable state. This is the single
 * shared accessor every consumer uses to learn how sync is doing — there is no
 * parallel read path. It is purely a snapshot getter: reading it never advances
 * the machine, fires a cycle, or mutates any state.
 *
 * It returns:
 *  - `state`: the current four-state machine state (with any armed deadline).
 *  - `online`: the latest network-link projection (NetInfo `isConnected`).
 *  - `lastCycleError`: the most recent cycle's failure message, or null when
 *    the latest cycle ended cleanly (or none has run yet).
 *  - `lastSuccessAtMs`: epoch-ms of the most recent clean cycle, or null.
 *  - `progress`: the first-sync progress snapshot (phase + monotonic counters),
 *    with `offline` overridden from the live online projection so a stale
 *    producer snapshot can never report the wrong network state.
 */
export const getSchedulerStatus = (): {
  state: SchedulerState;
  online: boolean;
  lastCycleError: string | null;
  lastSuccessAtMs: number | null;
  progress: SyncProgress;
} => {
  const progress = getSyncProgress();
  return {
    state,
    online: onlineProjection,
    lastCycleError,
    lastSuccessAtMs,
    progress: { ...progress, offline: !onlineProjection },
  };
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
