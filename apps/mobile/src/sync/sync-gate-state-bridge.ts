// Feeds the first-sync gate's reactive holder from the observable sources the
// shared scheduler-status accessor does not surface on its own snapshot:
//
//   - `bootstrapCompletedAt` and `localDataOwnerId`: read from the
//     `sync_runtime_state` singleton row. The row is re-read on a short interval
//     while the flag is still null (the window the gate is up), so the block
//     dismisses promptly once the first cycle sets it. Polling pauses once the
//     flag is set and resumes whenever the local store is wiped or reset (sign-
//     out, a sync for a different account, a developer reset), because the flag
//     is null again and the gate comes back up for the restore.
//   - `lastCycleErrorCode` / `lastCycleErrorDetail`: 'AUTH_REQUIRED' is mirrored
//     from the cycle's observable "no signed-in user" signal; the non-auth
//     failure codes ('FK_VIOLATION' / 'LOCAL_FK_VIOLATION' / 'INTERNAL') and
//     their technical detail from the cycle's classified error signal. The cycle
//     owns raising them; this bridge only projects them onto the holder.
//
// The phase / progress / offline snapshot is NOT republished here — the gate
// reads it straight from the shared scheduler-status accessor. Each publish
// re-renders the gate, which is what keeps that progress read live.

import { eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
import { subscribeToLocalDataReset } from '@/src/sync/account-wipe';
import {
  getAuthRequiredSignal,
  subscribeToAuthRequiredSignal,
} from '@/src/sync/auth-required-signal';
import {
  getCycleErrorCode,
  getCycleErrorDetail,
  subscribeToCycleErrorCode,
} from '@/src/sync/cycle-error-signal';
import {
  getSyncGateStateSnapshot,
  publishSyncGateState,
  type LastCycleErrorCode,
} from '@/src/sync/sync-gate-state';

/** How often the runtime-state row is re-read while the gate is still up. */
export const BOOTSTRAP_FLAG_POLL_INTERVAL_MS = 1000;

let pollHandle: ReturnType<typeof setInterval> | null = null;
let authRequiredUnsubscribe: (() => void) | null = null;
let cycleErrorUnsubscribe: (() => void) | null = null;
let localDataResetUnsubscribe: (() => void) | null = null;
let database: LocalDatabase | null = null;
// Set once the persisted flag has been read, or the data layer failed to come up.
let bootstrapFlagKnown = false;

interface RuntimeRowRead {
  bootstrapCompletedAt: Date | null;
  localDataOwnerId: string | null;
}

/**
 * Reads the bootstrap flag and the store's owning account from the runtime-state
 * singleton row. A missing row reads as not-bootstrapped and unowned; a read
 * error (a transient SQLite hiccup, or a handle closed by a developer reset that
 * dropped the database file) also reads as not-bootstrapped, so the gate keeps
 * the block up until the next read succeeds rather than crashing.
 */
const readRuntimeRow = (db: LocalDatabase): RuntimeRowRead => {
  try {
    const row = db
      .select({
        bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt,
        localDataOwnerId: syncRuntimeState.accountUserId,
      })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    return {
      bootstrapCompletedAt: row?.bootstrapCompletedAt ?? null,
      localDataOwnerId: row?.localDataOwnerId ?? null,
    };
  } catch {
    return { bootstrapCompletedAt: null, localDataOwnerId: null };
  }
};

/** Maps the cycle's observable error signals to a single last-cycle error code. */
const readLastCycleErrorCode = (): LastCycleErrorCode | null => {
  // The "no signed-in user" condition takes priority: it routes to sign-in, and
  // a Retry would only re-hit the same outcome, so the gate must treat it as the
  // auth case rather than a retriable error.
  if (getAuthRequiredSignal()) {
    return 'AUTH_REQUIRED';
  }
  return getCycleErrorCode();
};

/**
 * Recomputes the runtime-row fields and the last-cycle error from their live
 * sources and publishes a fresh snapshot, which also re-renders the gate so it
 * re-reads the live progress / offline snapshot from the shared scheduler-status
 * accessor. Pauses the poll once the bootstrap flag is set.
 */
const refresh = (): void => {
  const current = getSyncGateStateSnapshot();
  const runtime = database
    ? readRuntimeRow(database)
    : {
        bootstrapCompletedAt: current.bootstrapCompletedAt,
        localDataOwnerId: current.localDataOwnerId ?? null,
      };
  const lastCycleErrorCode = readLastCycleErrorCode();

  // Publish a fresh snapshot on every refresh (each signal change AND each poll
  // tick) so the gate re-renders and re-reads the live progress / offline / phase
  // snapshot from the shared scheduler-status accessor while the block is up. The
  // gate's reactive holder is its ONLY re-render trigger; without re-publishing
  // here the gate would freeze at its mount-time snapshot and never show the
  // cycle's advancing counters. A new object reference each tick is intentional.
  // The churn is bounded to the window the flag is null.
  publishSyncGateState({
    bootstrapCompletedAt: runtime.bootstrapCompletedAt,
    localDataOwnerId: runtime.localDataOwnerId,
    lastCycleErrorCode,
    lastCycleErrorDetail: lastCycleErrorCode === 'AUTH_REQUIRED' ? null : getCycleErrorDetail(),
    // Preserve a harness-pinned in-progress override across the poll; the bridge
    // never owns the pin (the harness sets and clears it).
    forcedProgress: current.forcedProgress,
    bootstrapFlagKnown,
  });

  if (runtime.bootstrapCompletedAt !== null) {
    stopBootstrapFlagPoll();
  }
};

const startBootstrapFlagPoll = (): void => {
  if (pollHandle === null) {
    pollHandle = setInterval(refresh, BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
  }
};

const stopBootstrapFlagPoll = (): void => {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
};

/**
 * (Re-)acquires the data-layer handle and refreshes. Called at start and after
 * every local reset: a developer reset may have dropped and reopened the
 * database file, leaving the previous handle closed.
 */
const acquireDatabase = (): void => {
  void bootstrapLocalDataLayer()
    .then((db) => {
      database = db;
      bootstrapFlagKnown = true;
      refresh();
    })
    .catch(() => {
      // The data layer failed to come up. Leave `database` null so reads stay
      // conservative (the gate keeps the block up); the data-layer bootstrap
      // surfaces its own failure elsewhere. The flag counts as known (not
      // synced) so boot does not wait on a read that will never happen.
      bootstrapFlagKnown = true;
      refresh();
    });
};

/** The local store was emptied: the flag is null again, so follow the restore. */
const handleLocalDataReset = (): void => {
  refresh();
  startBootstrapFlagPoll();
  acquireDatabase();
};

/**
 * Starts the bridge: mirrors the cycle's auth-required and error signals into the
 * gate holder, polls the runtime row until the bootstrap flag is set, and resumes
 * polling after every local reset. Idempotent — a second call while already
 * running is a no-op. Safe to call at boot; the data-layer handle is acquired
 * asynchronously and the signal mirrors work immediately.
 */
export const startSyncGateStateBridge = (): void => {
  if (authRequiredUnsubscribe !== null) {
    return;
  }

  authRequiredUnsubscribe = subscribeToAuthRequiredSignal(refresh);
  cycleErrorUnsubscribe = subscribeToCycleErrorCode(refresh);
  localDataResetUnsubscribe = subscribeToLocalDataReset(handleLocalDataReset);
  refresh();
  startBootstrapFlagPoll();
  acquireDatabase();
};

/** Tears down the bridge so a subsequent start begins clean. */
export const stopSyncGateStateBridge = (): void => {
  stopBootstrapFlagPoll();

  if (authRequiredUnsubscribe !== null) {
    authRequiredUnsubscribe();
    authRequiredUnsubscribe = null;
  }

  if (cycleErrorUnsubscribe !== null) {
    cycleErrorUnsubscribe();
    cycleErrorUnsubscribe = null;
  }

  if (localDataResetUnsubscribe !== null) {
    localDataResetUnsubscribe();
    localDataResetUnsubscribe = null;
  }

  database = null;
  bootstrapFlagKnown = false;
};

/** Test-only reset so suites start from a known clean bridge. */
export const __resetSyncGateStateBridgeForTests = (): void => {
  stopSyncGateStateBridge();
};
