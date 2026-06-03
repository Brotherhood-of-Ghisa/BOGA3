/* eslint-disable import/first */

const mockOpenDatabaseSync = jest.fn();
const mockDeleteDatabaseAsync = jest.fn();
const mockDrizzle = jest.fn();
const mockMigrate = jest.fn();
const mockSeedMuscleGroups = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();
const mockInvalidateExerciseCatalogCache = jest.fn();
const mockGetMobileAuthRuntimeConfig = jest.fn();

jest.mock('expo-sqlite', () => ({
  deleteDatabaseAsync: (...args: unknown[]) => mockDeleteDatabaseAsync(...args),
  openDatabaseSync: (...args: unknown[]) => mockOpenDatabaseSync(...args),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: (...args: unknown[]) => mockDrizzle(...args),
}));

jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: (...args: unknown[]) => mockMigrate(...args),
}));

jest.mock('@/src/data/exercise-catalog-seeds', () => ({
  seedMuscleGroups: (...args: unknown[]) => mockSeedMuscleGroups(...args),
  seedSystemExerciseCatalog: (...args: unknown[]) => mockSeedSystemExerciseCatalog(...args),
}));

jest.mock('@/src/auth/supabase', () => ({
  getMobileAuthRuntimeConfig: (...args: unknown[]) => mockGetMobileAuthRuntimeConfig(...args),
}));

jest.mock('@/src/exercise-catalog/invalidation', () => ({
  invalidateExerciseCatalogCache: (...args: unknown[]) =>
    mockInvalidateExerciseCatalogCache(...args),
}));

import { __resetLocalDataLayerForTests, bootstrapLocalDataLayer, resetLocalAppData } from '@/src/data/bootstrap';
import { localRuntimeMigrations } from '@/src/data/migrations';

describe('bootstrapLocalDataLayer', () => {
  beforeEach(() => {
    __resetLocalDataLayerForTests();
    mockOpenDatabaseSync.mockReset();
    mockDeleteDatabaseAsync.mockReset();
    mockDrizzle.mockReset();
    mockMigrate.mockReset();
    mockSeedMuscleGroups.mockReset();
    mockSeedSystemExerciseCatalog.mockReset();
    mockInvalidateExerciseCatalogCache.mockReset();
    // Default to a sync-configured build: the first-sign-in bootstrapper owns
    // the exercise catalog, so boot must NOT seed it. The infra-free branch is
    // exercised explicitly in its own tests below.
    mockGetMobileAuthRuntimeConfig.mockReset();
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: true });
  });

  it('creates the local database, applies runtime migrations, and seeds the muscle-group taxonomy once', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);

    const firstBootstrap = await bootstrapLocalDataLayer();
    const secondBootstrap = await bootstrapLocalDataLayer();

    expect(firstBootstrap).toBe(localDatabase);
    expect(secondBootstrap).toBe(localDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledWith(localDatabase, localRuntimeMigrations);
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(1);
    expect(mockSeedMuscleGroups).toHaveBeenCalledWith(localDatabase);
    // Sync-configured build: the first-sign-in bootstrapper owns the exercise
    // catalog, so boot must not seed it (a reinstall recovers it from the server).
    expect(mockSeedSystemExerciseCatalog).not.toHaveBeenCalled();
  });

  it('retries runtime migrations on the next bootstrap call after a failure', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockRejectedValueOnce(new Error('migration failed')).mockResolvedValueOnce(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('migration failed');
    await expect(bootstrapLocalDataLayer()).resolves.toBe(localDatabase);

    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(1);
  });

  it('retries muscle-group seeding on the next bootstrap call after a seed failure', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockImplementationOnce(() => {
      throw new Error('seed failed');
    });

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('seed failed');

    mockSeedMuscleGroups.mockImplementation(() => undefined);

    await expect(bootstrapLocalDataLayer()).resolves.toBe(localDatabase);

    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(2);
  });

  it('resets runtime app data by closing the database, deleting it, and re-running bootstrap', async () => {
    const sqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client',
    };
    const resetSqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client-after-reset',
    };
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);

    await bootstrapLocalDataLayer();
    const resetDatabase = await resetLocalAppData();

    expect(resetDatabase).toBe(resetLocalDatabase);
    expect(sqliteClient.closeAsync).toHaveBeenCalledTimes(1);
    expect(resetSqliteClient.closeAsync).not.toHaveBeenCalled();
    expect(mockDeleteDatabaseAsync).toHaveBeenCalledWith('scaffolding-local.db');
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockDrizzle).toHaveBeenCalledTimes(2);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(2);
  });

  it('invalidates the exercise-catalog cache after a reset re-seeds the database, so the next read repopulates from the fresh seed', async () => {
    const sqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client',
    };
    const resetSqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client-after-reset',
    };
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);

    // A plain bootstrap must not touch the cache — invalidation only matters
    // once the DB is wiped and re-seeded out from under the in-memory snapshot.
    await bootstrapLocalDataLayer();
    expect(mockInvalidateExerciseCatalogCache).not.toHaveBeenCalled();

    await resetLocalAppData();

    // Reset invalidates exactly once, and only after the re-seed has run so the
    // subsequent reload observes the freshly seeded rows (not the wiped DB).
    expect(mockInvalidateExerciseCatalogCache).toHaveBeenCalledTimes(1);
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(2);
    expect(mockInvalidateExerciseCatalogCache.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSeedMuscleGroups.mock.invocationCallOrder[1]
    );
  });

  it('serializes a concurrent bootstrap behind an in-flight reset so the database is never reopened before deletion completes', async () => {
    const sqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client',
    };
    const resetSqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client-after-reset',
    };
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);

    // Drain enough microtasks for any pending data-layer chaining to settle.
    const flushMicrotasks = async () => {
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }
    };

    // Gate the native delete so the reset stays "in flight" while we launch a
    // concurrent bootstrap. This models the cold-start race: the root layout /
    // focused screens call `bootstrapLocalDataLayer()` while the Maestro
    // `reset=data` harness is mid-reset.
    let resolveDelete: (() => void) | null = null;
    mockDeleteDatabaseAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = () => resolve();
        })
    );

    await bootstrapLocalDataLayer();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);

    const resetPromise = resetLocalAppData();
    // Let the reset advance all the way to its gated `deleteDatabaseAsync`.
    await flushMicrotasks();
    expect(mockDeleteDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(typeof resolveDelete).toBe('function');

    const concurrentBootstrap = bootstrapLocalDataLayer();
    // Drain microtasks so a non-serialized bootstrap would have reopened by now.
    await flushMicrotasks();

    // The reset is still gated on deletion. A serialized bootstrap is queued
    // behind it and must NOT have reopened the database. Pre-fix it reopened
    // here (open count 2) — deleting an open DB, which crashes native SQLite.
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);

    resolveDelete!();

    const [resetDatabase, concurrentDatabase] = await Promise.all([
      resetPromise,
      concurrentBootstrap,
    ]);

    expect(resetDatabase).toBe(resetLocalDatabase);
    // The queued bootstrap resolves to the freshly re-bootstrapped database.
    expect(concurrentDatabase).toBe(resetLocalDatabase);
    // Reopened exactly once, only after deletion finished.
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(sqliteClient.closeAsync).toHaveBeenCalledTimes(1);
    expect(resetSqliteClient.closeAsync).not.toHaveBeenCalled();
  });

  it('seeds the full starter exercise catalog at boot when no sync backend is configured (infra-free build)', async () => {
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: false });

    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    await bootstrapLocalDataLayer();

    // With no server to recover the catalog from, boot seeds BOTH the client-only
    // taxonomy and the syncable starter catalog (the picker would be empty otherwise).
    expect(mockSeedMuscleGroups).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledWith(localDatabase);
    // The catalog seed runs after the muscle-group seed.
    expect(mockSeedSystemExerciseCatalog.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSeedMuscleGroups.mock.invocationCallOrder[0]
    );
  });

  it('re-seeds the starter exercise catalog after a data reset when no sync backend is configured, so the infra-free picker stays populated', async () => {
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: false });

    const sqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client',
    };
    const resetSqliteClient = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      name: 'sqlite-client-after-reset',
    };
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedMuscleGroups.mockReturnValue(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    await bootstrapLocalDataLayer();
    await resetLocalAppData();

    // The Maestro `reset=data` harness deletes the DB and re-bootstraps. The
    // infra-free seed must run again against the freshly re-opened DB so the
    // exercise picker is populated after the reset — this is exactly the path the
    // data-runtime-smoke lane exercises.
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(2);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenLastCalledWith(resetLocalDatabase);
  });
});
