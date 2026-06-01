// Feeds the shared scheduler-state accessor from the observable sources the gate
// needs today, so the gate reads everything through the one accessor seam.
//
// This is a deliberately minimal producer. The durable instrumentation that
// reports per-layer phase and row counters from inside the cycle, and the
// durable persistence behind the accessor, are owned elsewhere and will replace
// the wiring here without changing the accessor's read surface. What this bridge
// supplies in the meantime is exactly what the first-sync gate must observe to
// decide whether to block, dismiss, route to sign-in, or show an error:
//
//   - `bootstrapCompletedAt`: read from the `sync_runtime_state` singleton row.
//     The row is re-read on a short interval while the flag is still null (the
//     only window the gate is up), so the block dismisses promptly once the
//     first cycle sets it. Polling stops as soon as the flag is non-null.
//   - `lastCycleErrorCode`: 'AUTH_REQUIRED' is mirrored from the cycle's
//     observable "no signed-in user" signal; the non-auth failure codes
//     ('FK_VIOLATION' / 'INTERNAL') are mirrored from the cycle's failure-code
//     signal. The cycle owns raising both; this bridge only projects them onto
//     the accessor the gate reads.
//
// `progress` (phase + counters + offline) is published by the cycle/bootstrapper
// instrumentation through the same accessor; this bridge preserves whatever
// progress value is current when it republishes the bootstrap/error fields.

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
  getSchedulerStateSnapshot,
  publishSchedulerState,
  type LastCycleErrorCode,
} from '@/src/sync/scheduler-state';

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
 * publishes a fresh snapshot when either changed, preserving the current
 * progress value. Stops the poll once the bootstrap flag is set, since the gate
 * dismisses and never re-blocks for this session.
 */
const refresh = (): void => {
  const current = getSchedulerStateSnapshot();
  const bootstrapCompletedAt = database ? readBootstrapCompletedAt(database) : current.bootstrapCompletedAt;
  const lastCycleErrorCode = readLastCycleErrorCode();

  const bootstrapChanged =
    (current.bootstrapCompletedAt?.getTime() ?? null) !== (bootstrapCompletedAt?.getTime() ?? null);

  if (bootstrapChanged || current.lastCycleErrorCode !== lastCycleErrorCode) {
    publishSchedulerState({
      ...current,
      bootstrapCompletedAt,
      lastCycleErrorCode,
    });
  }

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
 * Starts the bridge: mirrors the auth-required signal into the accessor and
 * polls the bootstrap flag until it is set. Idempotent — a second call while
 * already running is a no-op. Safe to call at boot; the data-layer handle is
 * acquired asynchronously and the auth-required mirror works immediately.
 */
export const startSchedulerStateBridge = (): void => {
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
export const stopSchedulerStateBridge = (): void => {
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
export const __resetSchedulerStateBridgeForTests = (): void => {
  stopSchedulerStateBridge();
};
