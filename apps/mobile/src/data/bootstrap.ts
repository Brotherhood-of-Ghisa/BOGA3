import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';

import { localRuntimeMigrations } from './migrations';
import { seedMuscleGroups } from './exercise-catalog-seeds';
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
let muscleGroupSeedComplete = false;
let muscleGroupSeedPromise: Promise<void> | null = null;

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

// Seed the client-only muscle-group taxonomy at boot. The syncable entity
// catalog (exercise definitions + muscle mappings) is NOT seeded here — it is
// seeded by the first-sign-in bootstrapper only when the first full pull returns
// no rows, so a reinstall recovers the server's state rather than re-creating
// starter rows. Muscle groups never sync, so they seed unconditionally at boot.
const runMuscleGroupSeed = async (database: LocalDatabase) => {
  if (muscleGroupSeedComplete) {
    return;
  }

  if (!muscleGroupSeedPromise) {
    muscleGroupSeedPromise = Promise.resolve()
      .then(() => {
        seedMuscleGroups(database);
        muscleGroupSeedComplete = true;
      })
      .catch((error) => {
        muscleGroupSeedPromise = null;
        throw error;
      });
  }

  await muscleGroupSeedPromise;
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
  await runMuscleGroupSeed(localDatabase);
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
    muscleGroupSeedComplete = false;
    muscleGroupSeedPromise = null;

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
  muscleGroupSeedComplete = false;
  muscleGroupSeedPromise = null;
  dataLayerOperationLock = Promise.resolve();
};
