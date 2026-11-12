// The one-time combined-muscle migration ([[muscle.report-groups]],
// [[muscle.weekly-targets]]): after a drained pull, an account whose settings
// row holds no definitions stores its legacy Broad keys as combined muscles
// and its legacy per-setup targets as one map. The pull runs first so a
// device that upgrades late finds another device's migration instead of
// replacing it (the local schema migration re-pulls every row once).
import { awaitsCombinedMuscleDefinitions, migrateLegacyMuscleSetup } from '@/src/data/muscle-report-settings';
import { logEvent } from '@/src/logging/logEvent';
import { refreshAccountLocalSyncedPreferences } from '@/src/preferences/account-local';

/** Never fails the cycle: a failure only logs, and the next cycle retries. */
export const migrateLegacyMuscleSetupLogged = async (): Promise<void> => {
  try {
    if (await migrateLegacyMuscleSetup()) await refreshAccountLocalSyncedPreferences();
    else if (await awaitsCombinedMuscleDefinitions()) {
      // Setup writes are refused meanwhile; a lasting state means the settings row never reached the server.
      void logEvent({
        level: 'warn', source: 'sync', event: 'sync.combined_muscles_awaiting_definitions',
        message: 'Combined-muscle keys are on this device but their definitions have not been pulled yet.',
      }).catch(() => undefined);
    }
  } catch (error) {
    void logEvent({
      level: 'warn', source: 'sync', event: 'sync.combined_muscles_migration_failed',
      message: 'Could not migrate the muscle setup to combined muscles; retrying next sync.',
      context: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
  }
};
