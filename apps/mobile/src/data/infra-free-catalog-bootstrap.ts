import { runBundleMigrations } from './bundle-migrations';
import {
  readSeedsAppliedMarker,
  seedSystemExerciseCatalog,
} from './exercise-catalog-seeds';
import type { LocalDatabase } from './bootstrap';

/**
 * Maintains the starter catalog for builds without a sync backend.
 *
 * A marker of zero identifies a fresh local database, which needs the complete
 * starter bundle. Once a prior bundle has been installed, later generations
 * must use the edit-preserving bundle migrations rather than re-running the
 * full conflict-update seeder over user-owned catalog rows.
 */
export const maintainInfraFreeStarterCatalog = (database: LocalDatabase): void => {
  if (readSeedsAppliedMarker(database) === 0) {
    seedSystemExerciseCatalog(database);
    return;
  }

  runBundleMigrations(database);
};
