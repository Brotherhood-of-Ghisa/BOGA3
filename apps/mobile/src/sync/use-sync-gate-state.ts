// React binding the first-sync gate uses to observe everything it renders. It
// composes two reactive reads into one snapshot:
//
//   - the gate-scoped holder (the bootstrap flag + the classified last-cycle
//     error code), subscribed via `useSyncExternalStore` so a change re-renders
//     the gate without polling React; and
//   - the phase / progress / offline snapshot read straight from the shared
//     scheduler-status accessor — the single source of truth for sync progress —
//     re-read on each render the holder triggers (the holder is republished on
//     the same short interval the bridge polls, so the progress read stays fresh
//     while the block is up).
//
// Keeping `progress` sourced from the shared accessor means the gate has no
// parallel progress representation: it renders exactly what the accessor reports.

import { useSyncExternalStore } from 'react';

import { getSchedulerStatus } from '@/src/sync/scheduler';
import type { SyncProgress } from '@/src/sync/progress';
import {
  getSyncGateStateSnapshot,
  subscribeToSyncGateState,
  type LastCycleErrorCode,
} from '@/src/sync/sync-gate-state';

/** The composed snapshot the gate renders. */
export interface SyncGateSnapshot {
  /** Null until the first full sync cycle has drained; the gate keys dismissal on this. */
  bootstrapCompletedAt: Date | null;
  /** The most recent failed cycle's error code, or null when the last cycle was clean. */
  lastCycleErrorCode: LastCycleErrorCode | null;
  /** Phase + advancing counters + offline boolean from the shared scheduler-status accessor. */
  progress: SyncProgress;
}

/**
 * Subscribes to the gate-scoped holder and composes it with the live progress
 * snapshot from the shared scheduler-status accessor. Re-renders whenever the
 * holder publishes (the bridge republishes on its poll interval, which also
 * refreshes the progress read).
 */
export const useSyncGateState = (): SyncGateSnapshot => {
  const gateState = useSyncExternalStore(
    subscribeToSyncGateState,
    getSyncGateStateSnapshot,
    getSyncGateStateSnapshot,
  );

  // Harness-pinned in-progress override (tests only): render the pinned
  // in-progress block and stay up regardless of the live scheduler and the
  // persisted bootstrap flag, so a Maestro flow can observe the online "setting
  // up your data" state deterministically on a simulator whose NetInfo cannot
  // confirm reachability. Never set in production.
  if (gateState.forcedProgress) {
    return {
      bootstrapCompletedAt: null,
      lastCycleErrorCode: null,
      progress: gateState.forcedProgress,
    };
  }

  return {
    bootstrapCompletedAt: gateState.bootstrapCompletedAt,
    lastCycleErrorCode: gateState.lastCycleErrorCode,
    progress: getSchedulerStatus().progress,
  };
};
