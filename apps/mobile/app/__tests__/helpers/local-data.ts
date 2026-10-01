/* eslint-disable @typescript-eslint/no-require-imports -- lazy loads: the app modules
   below import `@/src/data/bootstrap`, whose mock factory loads this file, so a
   top-level import would cycle back into a half-built mock. */

/**
 * Screen-on-real-data harness for Jest.
 *
 * Renders real screens over a real, fully migrated SQLite database (the shared
 * in-memory fixture), seeded with the same fixtures the Maestro harness loads.
 * Repositories, caches, hooks and screens are production code; only the native
 * database open in `@/src/data/bootstrap` is replaced.
 *
 * The stand-in replays the production boot steps a screen depends on (see
 * `prepareLocalDataLayer` / `resetLocalAppData` in `src/data/bootstrap.ts`):
 * the starter catalog when no sync backend is configured, the foreign-key
 * integrity check, and the exercise-catalog cache invalidation after a reset.
 * Keep it in step with those functions.
 *
 * Wiring, in the test file (a `jest.mock` factory cannot close over imports):
 *
 *   jest.mock('@/src/data/bootstrap', () =>
 *     require('./helpers/local-data').localDataBootstrapModule());
 *
 *   beforeEach(() => resetLocalData());
 *   afterEach(() => closeLocalData());
 *
 *   await loadMaestroFixture('exercise-block-history'); // same seed as the lane
 */

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './in-memory-db';

import type { LocalDatabase } from '@/src/data/bootstrap';
import type { MaestroHarnessFixtureName } from '@/src/maestro/harness';

type ForeignKeyCheckRow = { table?: string; rowid?: number; parent?: string };

let current: InMemoryDatabaseFixture | null = null;
let booted = false;

const currentFixture = (): InMemoryDatabaseFixture => {
  if (!current) {
    current = createInMemoryDatabase();
    booted = false;
  }
  return current;
};

const asLocalDatabase = (fixture: InMemoryDatabaseFixture): LocalDatabase =>
  // better-sqlite3 and expo-sqlite drizzle handles share the sync query
  // surface the app uses (see in-memory-db.ts).
  fixture.database as unknown as LocalDatabase;

/** Production boot steps after migrations (`prepareLocalDataLayer`). */
const bootOnce = (fixture: InMemoryDatabaseFixture): LocalDatabase => {
  const database = asLocalDatabase(fixture);
  if (booted) {
    return database;
  }

  const { getMobileAuthRuntimeConfig } = require('@/src/auth/supabase');
  if (!getMobileAuthRuntimeConfig().isConfigured) {
    const { maintainInfraFreeStarterCatalog } = require('@/src/data/infra-free-catalog-bootstrap');
    maintainInfraFreeStarterCatalog(database);
  }

  const violation = fixture.client.prepare('PRAGMA foreign_key_check').get() as
    | ForeignKeyCheckRow
    | undefined;
  if (violation) {
    throw new Error(
      `Foreign key integrity check failed: ${violation.table} row ${violation.rowid} -> ${violation.parent}`
    );
  }

  booted = true;
  return database;
};

const bootstrapLocalDataLayer = async (): Promise<LocalDatabase> => bootOnce(currentFixture());

/** `resetLocalAppData`: drop the database, boot a fresh one, invalidate the catalog cache. */
const resetLocalAppData = async (): Promise<LocalDatabase> => {
  current?.close();
  current = null;
  const database = bootOnce(currentFixture());
  const { invalidateExerciseCatalogCache } = require('@/src/exercise-catalog/invalidation');
  invalidateExerciseCatalogCache();
  return database;
};

/** The module `jest.mock('@/src/data/bootstrap', …)` should return. */
export const localDataBootstrapModule = () => ({
  bootstrapLocalDataLayer,
  resetLocalAppData,
  getSqliteDatabase: () => {
    throw new Error('getSqliteDatabase() is native-only; use localDataClient() in tests');
  },
  __resetLocalDataLayerForTests: () => undefined,
});

/**
 * A fresh, empty app database and cold caches — the `reset=data` starting point.
 * Call from `beforeEach`.
 */
export const resetLocalData = (): void => {
  closeLocalData();
  const { __resetExerciseCatalogCacheForTests } = require('@/src/exercise-catalog/cache');
  const { __resetExerciseCatalogStatsCacheForTests } = require('@/src/exercise-catalog/stats-cache');
  __resetExerciseCatalogCacheForTests();
  __resetExerciseCatalogStatsCacheForTests();
};

/** Closes the current database. Call from `afterEach`. */
export const closeLocalData = (): void => {
  current?.close();
  current = null;
  booted = false;
};

/** Seeds a Maestro harness fixture through the harness itself (`fixture=<name>`). */
export const loadMaestroFixture = async (name: MaestroHarnessFixtureName): Promise<void> => {
  const { runMaestroHarnessFixture } = require('@/src/maestro/harness');
  await runMaestroHarnessFixture(name);
};

/** The booted drizzle handle, for direct reads in assertions. */
export const localDatabase = (): LocalDatabase => bootOnce(currentFixture());

/** The raw better-sqlite3 client, for SQL assertions. */
export const localDataClient = () => currentFixture().client;
