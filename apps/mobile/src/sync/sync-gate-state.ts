// The first-sync gate's own reactive read holder for the two signals the shared
// scheduler-status accessor does not carry on its own snapshot:
//
//   - `bootstrapCompletedAt`: the `sync_runtime_state.bootstrap_completed_at`
//     flag (null until the first full sync cycle has drained). The gate keys its
//     dismissal on this. It lives in the local runtime-state row, not on the
//     scheduler, so the gate reads it from the row and republishes it here.
//   - `lastCycleErrorCode`: the classification of the most recent failed cycle
//     ('AUTH_REQUIRED' | 'FK_VIOLATION' | 'INTERNAL'), or null when the last
//     cycle was clean. The gate renders an error + Retry for the non-auth codes
//     and routes to sign-in for the auth one. It is mirrored from the cycle's own
//     observable signals (the auth-required flag and the classified error code).
//
// This is NOT a second scheduler-state accessor: the phase / progress / offline
// snapshot is read straight from the shared scheduler-status accessor. This
// holder carries only the two gate-scoped signals above, so the gate has one
// reactive value to subscribe to while it composes the shared progress snapshot
// in. It is module-scoped on purpose: the cycle and the test harness run with no
// React context, and the UI subscribes via `useSyncExternalStore`, so all three
// must reach the same holder.

import type { SyncProgress } from '@/src/sync/progress';

/** The classification of a failed cycle, mirroring the cycle's own error codes. */
export type LastCycleErrorCode = 'AUTH_REQUIRED' | 'FK_VIOLATION' | 'INTERNAL';

/** The immutable gate-scoped snapshot the gate subscribes to. */
export interface SyncGateStateSnapshot {
  /**
   * The persisted first-sync completion flag: null until the first full sync
   * cycle has drained and the device holds the restored data, non-null after.
   */
  bootstrapCompletedAt: Date | null;
  /** The most recent failed cycle's error code, or null when the last cycle was clean. */
  lastCycleErrorCode: LastCycleErrorCode | null;
  /**
   * Test/harness-only: when non-null, the gate renders this in-progress block
   * (online, the given phase) and stays up regardless of the live scheduler and
   * the persisted bootstrap flag. The iOS simulator's NetInfo cannot confirm
   * internet reachability, and — with the connectivity fix — the real first cycle
   * now completes and dismisses the gate too fast to assert; this lets the harness
   * drive the online "setting up" state deterministically, the same way the
   * bootstrap flag drives dismissal. Always null in production (no harness route
   * is reachable in a release build).
   */
  forcedProgress?: SyncProgress | null;
}

/** The snapshot returned before any cycle has reported anything. */
const INITIAL_SNAPSHOT: SyncGateStateSnapshot = {
  bootstrapCompletedAt: null,
  lastCycleErrorCode: null,
  forcedProgress: null,
};

type Listener = () => void;

const listeners = new Set<Listener>();

let snapshot: SyncGateStateSnapshot = INITIAL_SNAPSHOT;

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Reads the latest gate-scoped snapshot. Returns a stable reference between
 * updates so `useSyncExternalStore` does not loop: a new object is published
 * only when {@link publishSyncGateState} actually changes the value.
 */
export const getSyncGateStateSnapshot = (): SyncGateStateSnapshot => snapshot;

/**
 * Subscribes to snapshot changes. Returns an unsubscribe function and matches
 * React's `useSyncExternalStore` subscribe contract so the UI can observe state
 * without polling React itself.
 */
export const subscribeToSyncGateState = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Publishes a new snapshot (replacing the current one) and notifies subscribers.
 * The bridge that mirrors the runtime-state row and the cycle's error signals
 * calls this; the UI never does. Publishing an equal-by-reference value is a
 * no-op so a redundant write cannot churn subscribers.
 */
export const publishSyncGateState = (next: SyncGateStateSnapshot): void => {
  if (next === snapshot) {
    return;
  }
  snapshot = next;
  emit();
};

/** Test-only reset so suites start from a known clean snapshot. */
export const __resetSyncGateStateForTests = (): void => {
  snapshot = INITIAL_SNAPSHOT;
  listeners.clear();
};
