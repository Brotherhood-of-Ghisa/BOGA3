// Pure decision layer for the first-sync gate: given the auth snapshot and the
// scheduler-state snapshot, decide what the gate should do. Kept free of React
// so the branching rules can be asserted directly.
//
// The rules, in priority order:
//
//   1. The gate only applies to a user the app holds a working session for. When
//      auth is unconfigured (no working credential path) or there is no session
//      yet, there is no first sync that will ever set the flag, so the gate
//      stands aside and the app renders its normal routes. (The route-layer auth
//      guard already redirects a configured-but-signed-out launch to sign-in
//      before this gate is reached; an unconfigured local/dev build falls
//      through both.)
//   2. Once the device holds its restored data (`bootstrapCompletedAt` set), the
//      gate is done — the app renders its normal routes.
//   3. While the gate is up and the latest cycle ended "no signed-in user", the
//      user needs to sign in before anything else can make progress; the gate
//      routes to sign-in and shows NO Retry (a retry would just re-hit the same
//      envelope).
//   4. While the gate is up and the latest cycle failed for any other reason, the
//      gate shows the error and a single Retry that fires one fresh cycle.
//   5. Otherwise the gate shows the in-progress block: the phase, the advancing
//      activity counters, and — when the device is offline — the offline message
//      instead of an indefinite spinner.

import type { SchedulerStateSnapshot } from '@/src/sync/scheduler-state';

/** The minimal auth-snapshot fields the gate decision reads. */
export interface SyncGateAuthSnapshot {
  /** Whether mobile auth has a working credential path configured. */
  isConfigured: boolean;
  /** Whether a live session is currently held (null/undefined when signed out). */
  session: unknown;
}

/** What the gate should present for the current snapshots. */
export type SyncGateMode =
  /** Bootstrap is complete (or the gate does not apply); render the app's normal routes. */
  | { kind: 'pass' }
  /** No signed-in user; route to the sign-in screen (no Retry). */
  | { kind: 'route-to-sign-in' }
  /** A retriable cycle error; show the message and a single Retry. */
  | { kind: 'error'; errorCode: 'FK_VIOLATION' | 'INTERNAL' }
  /** Work is in progress (or waiting on the network); show the block. */
  | { kind: 'in-progress' };

/**
 * Maps the auth snapshot and a scheduler-state snapshot to the gate mode. The
 * gate only blocks a signed-in user whose first sync has not yet drained; it
 * stands aside for everyone else so an unconfigured build (no session, no sync)
 * is never trapped behind a block that nothing will ever lift.
 */
export const selectSyncGateMode = (
  auth: SyncGateAuthSnapshot,
  snapshot: SchedulerStateSnapshot,
): SyncGateMode => {
  if (!auth.isConfigured || !auth.session) {
    return { kind: 'pass' };
  }

  if (snapshot.bootstrapCompletedAt !== null) {
    return { kind: 'pass' };
  }

  if (snapshot.lastCycleErrorCode === 'AUTH_REQUIRED') {
    return { kind: 'route-to-sign-in' };
  }

  if (
    snapshot.lastCycleErrorCode === 'FK_VIOLATION' ||
    snapshot.lastCycleErrorCode === 'INTERNAL'
  ) {
    return { kind: 'error', errorCode: snapshot.lastCycleErrorCode };
  }

  return { kind: 'in-progress' };
};
