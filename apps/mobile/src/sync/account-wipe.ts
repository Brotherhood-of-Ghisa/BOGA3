// Local-only data wipe for sign-out and account switches.
//
// When the signed-in user signs out, or when a different account signs in on
// the same device, the previous account's rows must not survive in the local
// store. Two failure modes motivate this:
//
//   1. Stale data leak — the next account would see the previous account's
//      catalog / sessions until the first pull overwrote them.
//   2. Suppressed restore — a non-null `bootstrap_completed_at` left over from
//      the previous account tells the first-cycle bootstrapper "this device is
//      already set up", so it never runs the first full pull for the new
//      account and the new account's server data is never restored.
//
// This wipe is LOCAL ONLY. It deletes local rows and resets the local sync
// accounting so the next sign-in re-enters the bootstrapper cleanly. It issues
// NO server delete: the server keeps every account's data so a later sign-in
// restores it. (A server-side wipe is a separate developer-only affordance and
// must never run on a normal sign-out / account switch.)

import { eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExerciseTags,
  sessionExercises,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';

/**
 * Clears every per-user local table and resets the singleton sync-accounting
 * row, in a single transaction, on the supplied database handle.
 *
 * What it clears (the nine syncable, per-user entity tables, deleted in
 * child-before-parent order so foreign keys stay satisfied even if a future
 * schema change drops a cascade):
 *   session_exercise_tags, exercise_sets, session_exercises, sessions,
 *   gyms, exercise_tag_definitions, exercise_muscle_mappings,
 *   exercise_definitions, muscle_groups.
 *
 * What it resets on the singleton runtime-state row:
 *   - bootstrap_completed_at → null  (so the first-cycle bootstrapper re-runs
 *     for the next account)
 *   - pull_cursor → {}               (so the next account pulls every layer
 *     from the beginning)
 *   - applied_seed_migration_app_version → 0  (so any pending bundle
 *     migrations re-apply to the next account's pulled rows)
 *
 * What it deliberately PRESERVES:
 *   - last_emitted_ms — the monotonic clock counter is device-global, not
 *     per-account. Resetting it could let a later write emit a timestamp at or
 *     below an already-pushed one, which the server's last-write-wins rule
 *     would silently reject.
 *
 * The runtime-state reset is a plain UPDATE on the existing singleton row: if
 * no row exists yet (a fresh install that has never written the monotonic
 * clock), there is nothing to reset — the cursor is already empty, the
 * bootstrap flag is already null, and the seed-migration marker is already 0
 * by column default.
 */
const wipeLocalTables = (database: LocalDatabase): void => {
  database.transaction((tx) => {
    const transaction = tx as Transaction;

    transaction.delete(sessionExerciseTags).run();
    transaction.delete(exerciseSets).run();
    transaction.delete(sessionExercises).run();
    transaction.delete(sessions).run();
    transaction.delete(gyms).run();
    transaction.delete(exerciseTagDefinitions).run();
    transaction.delete(exerciseMuscleMappings).run();
    transaction.delete(exerciseDefinitions).run();
    transaction.delete(muscleGroups).run();

    transaction
      .update(syncRuntimeState)
      .set({
        bootstrapCompletedAt: null,
        pullCursor: {} as never,
        appliedSeedMigrationAppVersion: 0,
      })
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .run();
  });
};

/**
 * Wipes the previous account's local data on sign-out or account switch.
 *
 * Acquires the local database handle (re-bootstrapping the data layer if it is
 * not yet open) and runs {@link wipeLocalTables}. Resolves once the local
 * tables are cleared and the runtime-state row is reset.
 *
 * Intended to be awaited from the auth layer's sign-out path and from its
 * auth-state-change handler when the signed-in user id changes to a different
 * account. It performs no network I/O and issues no server delete.
 */
export const wipeLocalForAccountSwitch = async (): Promise<void> => {
  const database = await bootstrapLocalDataLayer();
  wipeLocalTables(database);
};
