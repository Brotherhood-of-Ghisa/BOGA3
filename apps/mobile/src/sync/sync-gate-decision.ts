// Pure decision layer for the first-sync gate: given the auth snapshot and the
// gate-state snapshot (the bootstrap flag + the latest cycle error code), decide
// what the gate should do. Kept free of React so the branching rules can be
// asserted directly.
//
// The rules, in priority order:
//
//   1. The gate only applies to a user the app holds a working session for. When
//      auth is unconfigured (no working credential path) or there is no session
//      yet, there is no first sync that will ever set the flag, so the gate
//      stands aside and the app renders its normal routes. (Root route access
//      sends a configured-but-signed-out user to sign-in before this applies; an
//      unconfigured local/dev build gets the app.)
//   2. Once the device holds the signed-in account's restored data
//      (`bootstrapCompletedAt` set on a store that account owns — see
//      `isFirstSyncDrained`), the gate is done — the app renders its normal
//      routes.
//   3. While the gate is up and the latest cycle ended "no signed-in user", the
//      user needs to sign in before anything else can make progress; the gate
//      routes to sign-in and shows NO Retry (a retry would just re-hit the same
//      envelope).
//   4. While the gate is up and the latest cycle failed for any other reason, the
//      gate shows the error and a single Retry that fires one fresh cycle.
//   5. Otherwise the gate shows the in-progress block: the phase, the advancing
//      activity counters, and — when the device is offline — the offline message
//      instead of an indefinite spinner.

import type { LastCycleErrorCode } from '@/src/sync/sync-gate-state';

/** The minimal auth-snapshot fields the gate decision reads. */
export interface SyncGateAuthSnapshot {
  /** Whether mobile auth has a working credential path configured. */
  isConfigured: boolean;
  /** Whether a live session is currently held (null/undefined when signed out). */
  session: unknown;
}

/** The minimal gate-state fields the gate decision reads. */
export interface SyncGateDecisionSnapshot {
  /** Null until the first full sync cycle has drained; the gate keys dismissal on this. */
  bootstrapCompletedAt: Date | null;
  /** The account the local store belongs to (null/omitted when unowned). */
  localDataOwnerId?: string | null;
  /** The most recent failed cycle's error code, or null when the last cycle was clean. */
  lastCycleErrorCode: LastCycleErrorCode | null;
}

/** What the gate should present for the current snapshots. */
export type SyncGateMode =
  /** Bootstrap is complete (or the gate does not apply); render the app's normal routes. */
  | { kind: 'pass' }
  /** No signed-in user; route to the sign-in screen (no Retry). */
  | { kind: 'route-to-sign-in' }
  /** A retriable cycle error; show the message and a single Retry. */
  | { kind: 'error'; errorCode: 'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'UPDATE_REQUIRED' | 'INTERNAL' }
  /** Work is in progress (or waiting on the network); show the block. */
  | { kind: 'in-progress' };

/** The signed-in account's id from an auth snapshot's session, or null. */
export const readSessionUserId = (session: unknown): string | null => {
  const user = (session as { user?: { id?: unknown } } | null | undefined)?.user;
  return typeof user?.id === 'string' ? user.id : null;
};

/**
 * Whether the first sync has drained for the signed-in account. The bootstrap
 * flag alone is not enough: when the local store still belongs to a different
 * account (signed in as B on a device holding A's data), the flag is A's, and B
 * has not been restored yet — the next cycle wipes A's data and restores B. An
 * unowned store (from before the owner was recorded) is judged by the flag.
 */
export const isFirstSyncDrained = (
  snapshot: SyncGateDecisionSnapshot,
  sessionUserId: string | null,
): boolean => {
  if (snapshot.bootstrapCompletedAt === null) {
    return false;
  }
  const owner = snapshot.localDataOwnerId ?? null;
  return owner === null || sessionUserId === null || owner === sessionUserId;
};

/**
 * Maps the auth snapshot and the gate-state snapshot to the gate mode. The
 * gate only blocks a signed-in user whose first sync has not yet drained; it
 * stands aside for everyone else so an unconfigured build (no session, no sync)
 * is never trapped behind a block that nothing will ever lift.
 */
export const selectSyncGateMode = (
  auth: SyncGateAuthSnapshot,
  snapshot: SyncGateDecisionSnapshot,
): SyncGateMode => {
  if (!auth.isConfigured || !auth.session) {
    return { kind: 'pass' };
  }

  if (isFirstSyncDrained(snapshot, readSessionUserId(auth.session))) {
    return { kind: 'pass' };
  }

  if (snapshot.lastCycleErrorCode === 'AUTH_REQUIRED') {
    return { kind: 'route-to-sign-in' };
  }

  if (
    snapshot.lastCycleErrorCode === 'UPDATE_REQUIRED' ||
    snapshot.lastCycleErrorCode === 'FK_VIOLATION' ||
    snapshot.lastCycleErrorCode === 'LOCAL_FK_VIOLATION' ||
    snapshot.lastCycleErrorCode === 'INTERNAL'
  ) {
    return { kind: 'error', errorCode: snapshot.lastCycleErrorCode };
  }

  return { kind: 'in-progress' };
};
