import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { getMobileAuthRuntimeConfig } from '@/src/auth/supabase';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { logEvent } from '@/src/logging';

import { localRuntimeMigrations } from './migrations';
import { maintainInfraFreeStarterCatalog } from './infra-free-catalog-bootstrap';
import * as schema from './schema';

const LOCAL_DATABASE_NAME = 'scaffolding-local.db';

type ForeignKeyPragmaRow = {
  foreign_keys?: number | boolean | string | null;
};

type ForeignKeyCheckRow = {
  table?: string | null;
  rowid?: number | string | null;
  parent?: string | null;
  fkid?: number | string | null;
};

let sqliteDatabase: SQLiteDatabase | null = null;

export const getSqliteDatabase = () => {
  if (sqliteDatabase) {
    return sqliteDatabase;
  }

  sqliteDatabase = openDatabaseSync(LOCAL_DATABASE_NAME);
  configureForeignKeyEnforcement(sqliteDatabase);
  return sqliteDatabase;
};

const sanitizeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message : String(error);

const recordForeignKeyBootstrapFailure = (context: Record<string, unknown>, error: unknown) => {
  void logEvent({
    level: 'error',
    source: 'database',
    event: 'data.sqlite_foreign_key_bootstrap_failed',
    message: 'SQLite foreign-key bootstrap check failed',
    context: {
      ...context,
      error_message: sanitizeErrorMessage(error),
    },
  }).catch(() => undefined);
};

const readForeignKeyPragma = (database: SQLiteDatabase): number => {
  const row = database.getFirstSync<ForeignKeyPragmaRow>('PRAGMA foreign_keys');
  const rawValue = row?.foreign_keys;
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  if (typeof rawValue === 'boolean') {
    return rawValue ? 1 : 0;
  }
  if (typeof rawValue === 'string') {
    return Number.parseInt(rawValue, 10);
  }
  return 0;
};

const configureForeignKeyEnforcement = (database: SQLiteDatabase) => {
  try {
    database.execSync('PRAGMA foreign_keys = ON');
    const pragmaState = readForeignKeyPragma(database);
    if (pragmaState !== 1) {
      throw new Error(`SQLite foreign_keys pragma is ${pragmaState}`);
    }
  } catch (error) {
    recordForeignKeyBootstrapFailure(
      {
        operation: 'configure_foreign_keys',
        foreign_keys: (() => {
          try {
            return readForeignKeyPragma(database);
          } catch {
            return 'unreadable';
          }
        })(),
      },
      error,
    );
    throw error;
  }
};

const runForeignKeyIntegrityCheck = (database: SQLiteDatabase) => {
  try {
    const firstViolation = database.getFirstSync<ForeignKeyCheckRow>('PRAGMA foreign_key_check');
    if (firstViolation) {
      throw new Error('SQLite foreign_key_check found violations');
    }
  } catch (error) {
    recordForeignKeyBootstrapFailure(
      {
        operation: 'foreign_key_check',
        foreign_keys: (() => {
          try {
            return readForeignKeyPragma(database);
          } catch {
            return 'unreadable';
          }
        })(),
      },
      error,
    );
    throw error;
  }
};

const createLocalDatabase = () => drizzle(getSqliteDatabase(), { schema });

export type LocalDatabase = ReturnType<typeof createLocalDatabase>;

let localDatabase: LocalDatabase | null = null;
let runtimeMigrationsComplete = false;
let runtimeMigrationPromise: Promise<void> | null = null;

const runRuntimeMigrations = async (database: LocalDatabase) => {
  if (runtimeMigrationsComplete) {
    return;
  }

  if (!runtimeMigrationPromise) {
    runtimeMigrationPromise = migrate(database, localRuntimeMigrations)
      .then(() => {
        runtimeMigrationsComplete = true;
      })
      .catch((error) => {
        runtimeMigrationPromise = null;
        throw error;
      });
  }

  await runtimeMigrationPromise;
};

// Bootstrap and reset both mutate the shared `sqliteDatabase`/`localDatabase`
// singletons and call into native SQLite (`openDatabaseSync`, `closeAsync`,
// `deleteDatabaseAsync`). They must never interleave: deleting or closing a
// handle that a concurrent bootstrap has just reopened crashes the native
// layer. The Maestro `reset=data` harness triggers exactly this — its
// `resetLocalAppData()` runs while the root layout's bootstrap and the focused
// screens' queries are still in flight. Serializing every data-layer operation
// behind a single lock chain keeps each critical section atomic.
let dataLayerOperationLock: Promise<unknown> = Promise.resolve();

const runExclusiveDataLayerOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  // Run `operation` after whatever is currently queued, regardless of whether
  // that prior operation resolved or rejected, so one failure never wedges the
  // chain. The gate is updated synchronously so the next caller in this tick
  // queues behind us rather than racing.
  const run = dataLayerOperationLock.then(operation, operation);
  dataLayerOperationLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

// Maintain the starter catalog at boot, but ONLY when no sync backend is
// configured. The starter catalog is the three system-seeded tables —
// muscle_groups (Layer 0), exercise_definitions (Layer 0), and the
// exercise_muscle_mappings join (Layer 1) — all written dirty so they push once
// an account is wired up. In a sync-configured build the catalog is owned by the
// first-sign-in bootstrapper, so a reinstall recovers the server's catalog
// (including the user's deletions) instead of re-creating starter rows; seeding
// here would defeat that recovery, so this stays a no-op there. In an infra-free
// build there is no server to recover from and nothing else ever seeds the
// catalog, so the exercise picker would stay permanently empty without this. The
// seeder is idempotent (guarded by its applied-version marker on
// `sync_runtime_state`) and seeds the Layer 0 parents before the Layer 1 join so
// the post-seed FK integrity check passes; `resetLocalAppData()` deletes the
// database — marker included — so the catalog re-seeds on the next bootstrap.
// An existing local-only database instead runs the pending bundle migrations,
// whose compare-from-prior-value writes preserve user edits.
const seedStarterCatalogWhenNoSyncBackend = (database: LocalDatabase) => {
  if (getMobileAuthRuntimeConfig().isConfigured) {
    return;
  }

  maintainInfraFreeStarterCatalog(database);
};

const prepareLocalDataLayer = async (): Promise<LocalDatabase> => {
  if (!localDatabase) {
    localDatabase = createLocalDatabase();
  }

  await runRuntimeMigrations(localDatabase);
  seedStarterCatalogWhenNoSyncBackend(localDatabase);
  runForeignKeyIntegrityCheck(getSqliteDatabase());
  return localDatabase;
};

export const bootstrapLocalDataLayer = (): Promise<LocalDatabase> =>
  runExclusiveDataLayerOperation(prepareLocalDataLayer);

export const resetLocalAppData = (): Promise<LocalDatabase> =>
  runExclusiveDataLayerOperation(async () => {
    const databaseToClose = sqliteDatabase;

    sqliteDatabase = null;
    localDatabase = null;
    runtimeMigrationsComplete = false;
    runtimeMigrationPromise = null;

    await databaseToClose?.closeAsync();
    await deleteDatabaseAsync(LOCAL_DATABASE_NAME);

    // Re-bootstrap inline while still holding the lock. Calling the exported
    // `bootstrapLocalDataLayer()` here would deadlock — it would queue behind
    // this very operation and never resolve.
    const database = await prepareLocalDataLayer();

    // The exercise-catalog cache holds an in-memory snapshot taken from the
    // pre-reset database. Now that the DB has been wiped and re-seeded, that
    // snapshot is stale. Invalidate the cache so the next read repopulates from
    // the fresh database rather than serving rows that no longer reflect it.
    // Done after the re-seed completes (and while still inside the lock) so the
    // reload sees the final state, and placed here so every reset caller
    // benefits.
    invalidateExerciseCatalogCache();

    return database;
  });

export const __resetLocalDataLayerForTests = () => {
  sqliteDatabase = null;
  localDatabase = null;
  runtimeMigrationsComplete = false;
  runtimeMigrationPromise = null;
  dataLayerOperationLock = Promise.resolve();
};
