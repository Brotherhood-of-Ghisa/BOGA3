// The single shared read path the UI uses to observe sync runtime state.
//
// Both the first-sync gate and (later) the Settings sync-status surface read
// from exactly one accessor so the "what is sync doing right now?" question has
// one source of truth rather than each surface re-deriving it from logs and the
// runtime-state row independently. This module is that seam.
//
// What the snapshot carries:
//   - `bootstrapCompletedAt`: the `sync_runtime_state.bootstrap_completed_at`
//     flag (null until the first full sync cycle has drained). The gate keys its
//     dismissal on this.
//   - `lastCycleErrorCode`: the classification of the most recent failed cycle
//     ('AUTH_REQUIRED' | 'FK_VIOLATION' | 'INTERNAL'), or null when the last
//     cycle was clean. The gate renders an error + Retry for the non-auth codes
//     and routes to sign-in for the auth one.
//   - `progress`: the phase + advancing counters + offline boolean the gate
//     renders as liveness while the block is up.
//
// The producer that feeds this snapshot (the cycle/bootstrapper instrumentation
// and the durable persistence behind it) is wired in separately; this module
// owns only the observable read surface and a writable in-memory holder so the
// producer and the UI tree observe the same value. It is module-scoped on
// purpose: the cycle runs with no React context, and the UI subscribes via
// `useSyncExternalStore`, so both must reach the same holder.

import { IDLE_SYNC_PROGRESS, type SyncProgress } from '@/src/sync/sync-progress';

/** The classification of a failed cycle, mirroring the cycle's own error codes. */
export type LastCycleErrorCode = 'AUTH_REQUIRED' | 'FK_VIOLATION' | 'INTERNAL';

/** The immutable snapshot the UI reads to render sync state. */
export interface SchedulerStateSnapshot {
  /**
   * The persisted first-sync completion flag: null until the first full sync
   * cycle has drained and the device holds the restored data, non-null after.
   */
  bootstrapCompletedAt: Date | null;
  /** The most recent failed cycle's error code, or null when the last cycle was clean. */
  lastCycleErrorCode: LastCycleErrorCode | null;
  /** The phase + advancing counters + offline boolean for the in-progress run. */
  progress: SyncProgress;
}

/** The snapshot returned before any cycle has reported anything. */
const INITIAL_SNAPSHOT: SchedulerStateSnapshot = {
  bootstrapCompletedAt: null,
  lastCycleErrorCode: null,
  progress: IDLE_SYNC_PROGRESS,
};

type Listener = () => void;

const listeners = new Set<Listener>();

let snapshot: SchedulerStateSnapshot = INITIAL_SNAPSHOT;

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Reads the latest scheduler-state snapshot. Returns a stable reference between
 * updates so `useSyncExternalStore` does not loop: a new object is published
 * only when {@link publishSchedulerState} actually changes the value.
 */
export const getSchedulerStateSnapshot = (): SchedulerStateSnapshot => snapshot;

/**
 * Subscribes to snapshot changes. Returns an unsubscribe function and matches
 * React's `useSyncExternalStore` subscribe contract so the UI can observe state
 * without polling.
 */
export const subscribeToSchedulerState = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Publishes a new snapshot (replacing the current one) and notifies subscribers.
 * The producer that instruments the cycle/bootstrapper calls this; the UI never
 * does. Publishing an equal-by-reference value is a no-op so a redundant write
 * cannot churn subscribers.
 */
export const publishSchedulerState = (next: SchedulerStateSnapshot): void => {
  if (next === snapshot) {
    return;
  }
  snapshot = next;
  emit();
};

/** Test-only reset so suites start from a known clean snapshot. */
export const __resetSchedulerStateForTests = (): void => {
  snapshot = INITIAL_SNAPSHOT;
  listeners.clear();
};
