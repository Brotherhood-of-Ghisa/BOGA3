// First-sign-in bootstrapper: the single load-bearing step that decides whether
// a fresh device-account pairing needs its starter catalog seeded, and that
// marks the first sync cycle as having drained.
//
// It runs once per device per account, gated on `bootstrap_completed_at IS
// NULL`. On a fresh install (or after a sign-out wipe) the local entity tables
// are empty, so the bootstrapper:
//
//   1. runs the first full pull, draining every topological layer;
//   2. iff that pull returned ZERO rows (the server holds nothing for this user,
//      not even a tombstone) it seeds the starter catalog via the normal repo
//      path, so the seeded rows become dirty and the next cycle pushes them;
//   3. sets `bootstrap_completed_at` LAST.
//
// Setting the flag last is what makes a crash recoverable: if the process dies
// between the pull and the flag write, the flag stays null and the next sign-in
// re-attempts the whole thing cleanly. Because a reinstall that pulls back even
// a single row (or a tombstone for a previously-deleted row) sees a non-zero
// pull, the seeder no-ops and the server's state — including the user's
// deletions — stands, which is the device-recovery guarantee.
//
// As it crosses each boundary it publishes a progress snapshot (phase + the
// monotonic counters) so a setup screen can show the current phase and prove it
// is still advancing.

import { eq } from 'drizzle-orm';

import { type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { syncRuntimeState } from '@/src/data/schema';
import { runFirstFullPull } from '@/src/sync/cycle';
import {
  PULL_LAYER_COUNT,
  resetSyncProgress,
  setSyncProgress,
  type SyncProgress,
} from '@/src/sync/progress';

/** Whether the bootstrapper has already completed for this device-account. */
const isBootstrapCompleted = (database: LocalDatabase): boolean => {
  const row = database
    .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();

  return row?.bootstrapCompletedAt != null;
};

/**
 * Stamps `bootstrap_completed_at` on the singleton runtime-state row, creating
 * the row if it does not exist yet. This is the LAST write the bootstrapper
 * makes; once it lands the bootstrapper never runs again on this device for this
 * account.
 */
const markBootstrapCompleted = (database: LocalDatabase, completedAt: Date): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: completedAt })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: completedAt },
    })
    .run();
};

/**
 * Runs the first-sign-in bootstrapper if it has not completed yet. A no-op when
 * `bootstrap_completed_at` is already set. The caller passes the already-prepared
 * local database handle (the cycle holds it) so the bootstrapper does not
 * re-resolve the data layer.
 *
 * Returns once the bootstrap pass is finished (flag set) or immediately if it
 * was already done. Any error from the pull or seed propagates: the flag is not
 * set, so the next sign-in re-attempts cleanly.
 */
export const runBootstrapper = async (database: LocalDatabase): Promise<void> => {
  if (isBootstrapCompleted(database)) {
    return;
  }

  // Start every run from a clean idle snapshot so the per-run counters are
  // honest (a previous, interrupted run never leaks its counts forward).
  resetSyncProgress();

  let rowsApplied = 0;
  let layersCompleted = 0;

  const publish = (phase: SyncProgress['phase']): void => {
    setSyncProgress({ phase, layersCompleted, rowsApplied, offline: false });
  };

  // Pull phase: drain all four layers, bumping the counters as each page applies
  // and each layer completes so a watcher sees motion the whole way through.
  publish('pull');
  const rowsPulled = await runFirstFullPull(database, {
    onPage: (applied) => {
      rowsApplied += applied;
      publish('pull');
    },
    onLayerDrained: (completed) => {
      layersCompleted = completed;
      publish('pull');
    },
  });

  // Make sure the pull phase ends reporting all layers drained even if a layer
  // produced no page event (an empty server returns a single empty page).
  layersCompleted = PULL_LAYER_COUNT;

  // Seed only when the first full pull returned nothing — no rows AND no
  // tombstones. Any pulled row means the server is authoritative for this user
  // and the starter catalog must not be re-created.
  if (rowsPulled === 0) {
    publish('seed');
    seedSystemExerciseCatalog(database);
  }

  // Flag last: a crash before this point leaves `bootstrap_completed_at` null so
  // the next sign-in re-runs the whole pass.
  markBootstrapCompleted(database, new Date());
  publish('done');
};
