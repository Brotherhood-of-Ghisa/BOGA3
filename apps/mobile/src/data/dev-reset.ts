import { isDevMode } from '@/src/utils/isDevMode';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import {
  __clearSeedsAppliedMarkerForReset,
  seedSystemExerciseCatalog,
} from './exercise-catalog-seeds';
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
} from './schema';

export type ResetLocalDataAndReseedOptions = {
  /** Override the dev-mode check for tests. Production callers must not pass this. */
  isDev?: boolean;
  /** Override the bootstrap helper for tests. */
  bootstrap?: () => Promise<LocalDatabase>;
  /** Clock injection for tests. */
  now?: Date;
};

export type ResetLocalDataAndReseedResult = {
  database: LocalDatabase;
  resetAt: Date;
};

/**
 * Wipes every user-mutable table in the local SQLite database, clears the
 * `appliedSeedMigrationAppVersion` marker on `sync_runtime_state` (resetting
 * it to `0`), and re-runs the exercise-catalog seeder so the catalog is
 * repopulated from the canonical seed bundle.
 *
 * This is the dev-only escape hatch for the "seed once, never overwrite"
 * model introduced in plan task T8: in production the seeder runs exactly
 * once per install (per catalog bundle version), so any developer who
 * needs a fresh catalog (e.g. after editing seed data) must invoke this
 * helper explicitly.
 *
 * The helper deliberately leaves the singleton `sync_runtime_state` row in
 * place — only its `appliedSeedMigrationAppVersion` field is reset — so any
 * remaining v2 sync accounting (`pull_cursor`, `last_emitted_ms`,
 * `bootstrap_completed_at`) on that row survives the wipe. The v1 sync
 * engine was removed in plan `sync-v2-client` t1, so there is no
 * `stopSyncRuntime()` follow-up to issue from callers any more.
 *
 * Throws synchronously when invoked outside dev mode (see `isDevMode`).
 */
export const resetLocalDataAndReseed = async (
  options: ResetLocalDataAndReseedOptions = {}
): Promise<ResetLocalDataAndReseedResult> => {
  const isDev = options.isDev ?? isDevMode();
  if (!isDev) {
    throw new Error(
      'resetLocalDataAndReseed is a developer-only helper and must not run in release builds.'
    );
  }

  const now = options.now ?? new Date();
  const bootstrap = options.bootstrap ?? bootstrapLocalDataLayer;
  const database = await bootstrap();

  database.transaction((tx) => {
    // Order matters: child rows first, parents after. Foreign keys cascade
    // in most cases but we list every table explicitly so the wipe is
    // exhaustive even if a future schema change drops a cascade.
    tx.delete(sessionExerciseTags).run();
    tx.delete(exerciseSets).run();
    tx.delete(sessionExercises).run();
    tx.delete(sessions).run();
    tx.delete(gyms).run();
    tx.delete(exerciseTagDefinitions).run();
    tx.delete(exerciseMuscleMappings).run();
    tx.delete(exerciseDefinitions).run();
    tx.delete(muscleGroups).run();
  });

  // Clear the marker AFTER the wipe so a partial failure above leaves the
  // marker intact (avoids losing track of a previously-seeded catalog).
  __clearSeedsAppliedMarkerForReset(database, now);

  // Re-run the seeder. The marker is now null so the inserts will execute.
  seedSystemExerciseCatalog(database, now);

  return {
    database,
    resetAt: now,
  };
};
