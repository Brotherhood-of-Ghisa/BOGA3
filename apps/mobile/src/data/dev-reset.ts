import { isDevMode } from '@/src/utils/isDevMode';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { seedSystemExerciseCatalog } from './exercise-catalog-seeds';
import { readLocalDataOwner, wipeLocalDatabaseRows } from './local-wipe';

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
 * Empties the local store with the same complete wipe sign-out uses (every
 * account table, the derived facts, the quarantine, the group cache, and the
 * sync accounting: bootstrap flag, pull cursors, catalog-bundle marker), keeps
 * the store's owning account, and re-runs the exercise-catalog seeder so the
 * catalog is repopulated from the canonical seed bundle.
 *
 * This is the dev-only escape hatch for the "seed once, never overwrite"
 * model: in production the seeder runs exactly once per install (per catalog
 * bundle version), so a developer who needs a fresh catalog (e.g. after editing
 * seed data) must invoke this helper explicitly.
 *
 * Resetting the sync accounting is what keeps the reset recoverable: the next
 * sync cycle runs the first-sign-in bootstrapper, re-pulling the account's
 * sessions and history from scratch (the freshly seeded catalog rows are newer,
 * so they win last-write-wins and push). Keeping the old pull cursors over an
 * emptied store would instead skip every server row older than them — the rows
 * would never come back, and a later child row whose parent was skipped would
 * fail the local FK check on every pull.
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

  wipeLocalDatabaseRows(database, { accountUserId: readLocalDataOwner(database) });
  seedSystemExerciseCatalog(database, now);

  return {
    database,
    resetAt: now,
  };
};
