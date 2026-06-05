// Feeds the first-sync gate's reactive holder from the two observable sources
// the shared scheduler-status accessor does not surface on its own snapshot:
//
//   - `bootstrapCompletedAt`: read from the `sync_runtime_state` singleton row.
//     The row is re-read on a short interval while the flag is still null (the
//     only window the gate is up), so the block dismisses promptly once the
//     first cycle sets it. Polling stops as soon as the flag is non-null.
//   - `lastCycleErrorCode`: 'AUTH_REQUIRED' is mirrored from the cycle's
//     observable "no signed-in user" signal; the non-auth failure codes
//     ('FK_VIOLATION' / 'INTERNAL') are mirrored from the cycle's classified
//     error signal. The cycle owns raising both; this bridge only projects them
//     onto the holder the gate reads.
//
// The phase / progress / offline snapshot is NOT republished here — the gate
// reads it straight from the shared scheduler-status accessor, so this bridge
// stays scoped to the two signals that holder carries.

import { eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
import {
  getAuthRequiredSignal,
  subscribeToAuthRequiredSignal,
} from '@/src/sync/auth-required-signal';
import {
  getCycleErrorCode,
  subscribeToCycleErrorCode,
} from '@/src/sync/cycle-error-signal';
import {
  getSyncGateStateSnapshot,
  publishSyncGateState,
  type LastCycleErrorCode,
} from '@/src/sync/sync-gate-state';

/** How often the bootstrap flag is re-read while the gate is still up. */
export const BOOTSTRAP_FLAG_POLL_INTERVAL_MS = 1000;

let pollHandle: ReturnType<typeof setInterval> | null = null;
let authRequiredUnsubscribe: (() => void) | null = null;
let cycleErrorUnsubscribe: (() => void) | null = null;
let database: LocalDatabase | null = null;

/**
 * Reads the persisted `bootstrap_completed_at` value from the runtime-state
 * singleton row. Returns null when the row is missing or the column is null
 * (the first-sync-not-yet-drained state), and swallows read errors as null so a
 * transient SQLite hiccup never crashes the gate — it just keeps the block up
 * until the next read succeeds.
 */
const readBootstrapCompletedAt = (db: LocalDatabase): Date | null => {
  try {
    const row = db
      .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    return row?.bootstrapCompletedAt ?? null;
  } catch {
    return null;
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
 * Recomputes the bootstrap flag and last-cycle error from their live sources and
 * publishes a fresh snapshot, which also re-renders the gate so it re-reads the
 * live progress / offline snapshot from the shared scheduler-status accessor (see
 * the body comment). Stops the poll once the bootstrap flag is set, since the gate
 * dismisses and never re-blocks for this session.
 */
const refresh = (): void => {
  const current = getSyncGateStateSnapshot();
  const bootstrapCompletedAt = database ? readBootstrapCompletedAt(database) : current.bootstrapCompletedAt;
  const lastCycleErrorCode = readLastCycleErrorCode();

  // Publish a fresh snapshot on every refresh (each signal change AND each poll
  // tick) so the gate re-renders and re-reads the live progress / offline / phase
  // snapshot from the shared scheduler-status accessor while the block is up. The
  // gate's reactive holder is its ONLY re-render trigger; the progress snapshot is
  // NOT part of this holder, so without re-publishing here the gate would freeze at
  // its mount-time snapshot and never reflect the scheduler going online
  // (offline -> online) or the cycle's advancing counters. A new object reference
  // each tick is intentional — that is what drives the re-render. The block is up
  // only briefly (the first sync) and the poll is 1s, so the churn is bounded to
  // that window and stops the moment the bootstrap flag is set (below).
  publishSyncGateState({
    bootstrapCompletedAt,
    lastCycleErrorCode,
    // Preserve a harness-pinned in-progress override across the poll; the bridge
    // owns only the bootstrap flag + error code, never the pin (the harness sets
    // and clears it). Dropping it here would let the 1s poll erase the pin.
    forcedProgress: current.forcedProgress,
  });

  if (bootstrapCompletedAt !== null) {
    stopBootstrapFlagPoll();
  }
};

const stopBootstrapFlagPoll = (): void => {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
};

/**
 * Starts the bridge: mirrors the cycle's auth-required and error signals into the
 * gate holder and polls the bootstrap flag until it is set. Idempotent — a second
 * call while already running is a no-op. Safe to call at boot; the data-layer
 * handle is acquired asynchronously and the signal mirrors work immediately.
 */
export const startSyncGateStateBridge = (): void => {
  if (authRequiredUnsubscribe !== null) {
    return;
  }

  authRequiredUnsubscribe = subscribeToAuthRequiredSignal(refresh);
  cycleErrorUnsubscribe = subscribeToCycleErrorCode(refresh);
  refresh();

  if (pollHandle === null) {
    pollHandle = setInterval(refresh, BOOTSTRAP_FLAG_POLL_INTERVAL_MS);
  }

  void bootstrapLocalDataLayer()
    .then((db) => {
      database = db;
      refresh();
    })
    .catch(() => {
      // The data layer failed to come up. Leave `database` null so reads stay
      // conservative (the gate keeps the block up); the data-layer bootstrap
      // surfaces its own failure elsewhere.
    });
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

  database = null;
};

/** Test-only reset so suites start from a known clean bridge. */
export const __resetSyncGateStateBridgeForTests = (): void => {
  stopSyncGateStateBridge();
};
