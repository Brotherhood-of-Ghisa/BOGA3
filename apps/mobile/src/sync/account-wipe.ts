// Account ownership of the local store, and the local-only wipe that enforces it.
//
// The local database holds exactly one account's data. `sync_runtime_state.
// account_user_id` records which. Two paths empty it:
//
//   1. Sign-out (`wipeLocalForAccountSwitch`): the signed-out account's rows must
//      not stay on the device for whoever signs in next.
//   2. The sync cycle's ownership guard (`ensureLocalDataOwnedBy`): before a
//      cycle syncs as account B, a database that holds account A's data is wiped
//      and re-stamped as B's. This is the authoritative check. It does not rely
//      on the app having watched the account change: a session that expired, or
//      could not be read back from the keychain, leaves the app signed out
//      without a sign-out, and the next sign-in as someone else used to sync on
//      top of the previous account's rows AND its pull cursors — skipping the new
//      account's older rows in one layer while pulling their children in the
//      next, which failed every retry with a local FK violation.
//
// A store with no recorded owner that has synced before (written before the
// owner was recorded) is wiped when it holds no unpushed edits, and otherwise
// kept with its pull cursors reset, so a device already stuck on stale cursors
// heals on upgrade without dropping an edit.
//
// Both wipes are LOCAL ONLY (no server delete: the server keeps every account's
// data so a later sign-in restores it) and both are complete: every account
// table, the derived facts, the quarantine and the group cache, plus the sync
// accounting (`wipeLocalDatabaseRows`). Every wipe and every sync cycle run
// under one lock, so a wipe can never land between two pages of a pull.

import { resetBodyweightCalculationPreferenceForAccountSwitch } from '@/src/bodyweight/calculation-preference';
import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import {
  countDirtyRows,
  hasSyncHistory,
  readLocalDataOwner,
  resetPullCursors,
  stampLocalDataOwner,
  wipeLocalDatabaseRows,
} from '@/src/data/local-wipe';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { logEvent } from '@/src/logging/logEvent';

// -----------------------------------------------------------------------------
// The local-data lock
// -----------------------------------------------------------------------------

let localDataLock: Promise<unknown> = Promise.resolve();

/**
 * Runs `operation` after every sync cycle and local wipe queued before it, and
 * holds later ones until it settles (either way, so one failure never wedges the
 * chain). The sync cycle and every wipe/reset take it; nothing that runs inside
 * the lock may take it again.
 */
export const withLocalDataLock = <T>(operation: () => Promise<T>): Promise<T> => {
  const run = localDataLock.then(operation, operation);
  localDataLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

// -----------------------------------------------------------------------------
// The local-data-reset signal
// -----------------------------------------------------------------------------

type ResetListener = () => void;

const resetListeners = new Set<ResetListener>();

/**
 * Subscribes to "the local store was just emptied". The first-sync gate's bridge
 * uses it to re-read the (now null) bootstrap flag and to re-acquire the
 * database handle, so the gate comes back up and follows the restore.
 */
export const subscribeToLocalDataReset = (listener: ResetListener): (() => void) => {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
};

/** Announces a completed wipe or reset of the local store. */
export const notifyLocalDataReset = (): void => {
  for (const listener of resetListeners) {
    listener();
  }
};

/** Test-only: drop listeners and release the lock chain. */
export const __resetAccountWipeForTests = (): void => {
  resetListeners.clear();
  localDataLock = Promise.resolve();
};

// -----------------------------------------------------------------------------
// Wipes
// -----------------------------------------------------------------------------

/**
 * Wipes the store and drops the in-memory state derived from it. The bodyweight
 * preference reset goes FIRST: it drains a pending preference write, which would
 * otherwise land a dirty `user_settings` row in the emptied store for the next
 * account to push.
 */
const wipeStore = async (database: LocalDatabase, accountUserId: string | null): Promise<void> => {
  await resetBodyweightCalculationPreferenceForAccountSwitch();
  wipeLocalDatabaseRows(database, { accountUserId });
  invalidateExerciseCatalogCache();
  notifyLocalDataReset();
};

/** Best-effort structured log; never changes what the guard does. */
const logOwnership = (event: string, message: string, context: Record<string, unknown>): void => {
  try {
    void logEvent({ level: 'warn', source: 'sync', event, message, context }).catch(() => undefined);
  } catch {
    // Diagnostic logging must never mask the guard's outcome.
  }
};

/**
 * Wipes the signed-out account's local data. Waits for an in-flight sync cycle
 * (which ends promptly once the session is gone), then empties the store and
 * leaves it unowned. Performs no network I/O and issues no server delete.
 */
export const wipeLocalForAccountSwitch = (): Promise<void> =>
  withLocalDataLock(async () => {
    await wipeStore(await bootstrapLocalDataLayer(), null);
  });

/** What the ownership guard did. */
export type LocalDataOwnership = 'owned' | 'adopted' | 'healed' | 'wiped';

/**
 * Takes an unowned store for `userId`. A fresh or signed-out store is empty and
 * is simply stamped. A store that has synced before but records no owner was
 * written before the owner was recorded, by whichever account was signed in —
 * possibly not this one, with that account's pull cursors:
 *
 *   - nothing waiting to push → wipe it; the bootstrapper restores `userId`
 *     cleanly;
 *   - unpushed edits → keep the rows (never drop an edit) but restart every
 *     layer's pull from the beginning, so stale cursors cannot skip this
 *     account's parents while pulling their children.
 */
const adoptUnownedStore = async (database: LocalDatabase, userId: string): Promise<LocalDataOwnership> => {
  if (!hasSyncHistory(database)) {
    stampLocalDataOwner(database, userId);
    return 'adopted';
  }
  const dirtyRows = countDirtyRows(database);
  if (dirtyRows === 0) {
    logOwnership('sync.local_store_unowned_wipe', 'Wiped a synced local store with no recorded owner.', {
      dirty_rows: 0,
    });
    await wipeStore(database, userId);
    return 'wiped';
  }
  resetPullCursors(database);
  stampLocalDataOwner(database, userId);
  logOwnership(
    'sync.local_store_unowned_repull',
    'Adopted a synced local store with no recorded owner and unpushed edits; pulling from scratch.',
    { dirty_rows: dirtyRows },
  );
  return 'healed';
};

/**
 * The sync cycle's ownership guard: makes the local store `userId`'s before the
 * cycle syncs as `userId`. Must run inside the local-data lock (the cycle holds
 * it).
 *
 *   - Owned by `userId` → nothing to do.
 *   - Owned by another account → wipe everything (logging how many unpushed
 *     edits of that account are discarded) and stamp `userId`; the cycle's
 *     bootstrapper then restores `userId` from scratch.
 *   - Unowned → see {@link adoptUnownedStore}.
 */
export const ensureLocalDataOwnedBy = async (
  database: LocalDatabase,
  userId: string,
): Promise<LocalDataOwnership> => {
  const owner = readLocalDataOwner(database);
  if (owner === userId) {
    return 'owned';
  }
  if (owner === null) {
    return adoptUnownedStore(database, userId);
  }

  logOwnership('sync.local_store_owner_mismatch_wipe', 'Wiped another account\'s local store before syncing.', {
    dirty_rows_discarded: countDirtyRows(database),
  });
  await wipeStore(database, userId);
  return 'wiped';
};
