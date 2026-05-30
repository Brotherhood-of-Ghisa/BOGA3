import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { localRuntimeMigrations } from './migrations';
import { seedSystemExerciseCatalog } from './exercise-catalog-seeds';
import * as schema from './schema';

const LOCAL_DATABASE_NAME = 'scaffolding-local.db';

let sqliteDatabase: SQLiteDatabase | null = null;

export const getSqliteDatabase = () => {
  if (sqliteDatabase) {
    return sqliteDatabase;
  }

  sqliteDatabase = openDatabaseSync(LOCAL_DATABASE_NAME);
  return sqliteDatabase;
};

const createLocalDatabase = () => drizzle(getSqliteDatabase(), { schema });

export type LocalDatabase = ReturnType<typeof createLocalDatabase>;

let localDatabase: LocalDatabase | null = null;
let runtimeMigrationsComplete = false;
let runtimeMigrationPromise: Promise<void> | null = null;
let runtimeExerciseCatalogSeedComplete = false;
let runtimeExerciseCatalogSeedPromise: Promise<void> | null = null;

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

const runRuntimeExerciseCatalogSeed = async (database: LocalDatabase) => {
  if (runtimeExerciseCatalogSeedComplete) {
    return;
  }

  if (!runtimeExerciseCatalogSeedPromise) {
    runtimeExerciseCatalogSeedPromise = Promise.resolve()
      .then(() => {
        seedSystemExerciseCatalog(database);
        runtimeExerciseCatalogSeedComplete = true;
      })
      .catch((error) => {
        runtimeExerciseCatalogSeedPromise = null;
        throw error;
      });
  }

  await runtimeExerciseCatalogSeedPromise;
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

const prepareLocalDataLayer = async (): Promise<LocalDatabase> => {
  if (!localDatabase) {
    localDatabase = createLocalDatabase();
  }

  await runRuntimeMigrations(localDatabase);
  await runRuntimeExerciseCatalogSeed(localDatabase);
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
    runtimeExerciseCatalogSeedComplete = false;
    runtimeExerciseCatalogSeedPromise = null;

    await databaseToClose?.closeAsync();
    await deleteDatabaseAsync(LOCAL_DATABASE_NAME);

    // Re-bootstrap inline while still holding the lock. Calling the exported
    // `bootstrapLocalDataLayer()` here would deadlock — it would queue behind
    // this very operation and never resolve.
    return prepareLocalDataLayer();
  });

export const __resetLocalDataLayerForTests = () => {
  sqliteDatabase = null;
  localDatabase = null;
  runtimeMigrationsComplete = false;
  runtimeMigrationPromise = null;
  runtimeExerciseCatalogSeedComplete = false;
  runtimeExerciseCatalogSeedPromise = null;
  dataLayerOperationLock = Promise.resolve();
};
