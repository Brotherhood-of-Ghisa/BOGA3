/* eslint-disable import/first */

const mockOpenDatabaseSync = jest.fn();
const mockDeleteDatabaseAsync = jest.fn();
const mockDrizzle = jest.fn();
const mockMigrate = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();

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
  seedSystemExerciseCatalog: (...args: unknown[]) => mockSeedSystemExerciseCatalog(...args),
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
    mockSeedSystemExerciseCatalog.mockReset();
  });

  it('creates the local database, applies runtime migrations, and seeds the system exercise catalog once', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    const firstBootstrap = await bootstrapLocalDataLayer();
    const secondBootstrap = await bootstrapLocalDataLayer();

    expect(firstBootstrap).toBe(localDatabase);
    expect(secondBootstrap).toBe(localDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledWith(localDatabase, localRuntimeMigrations);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledWith(localDatabase);
  });

  it('retries runtime migrations on the next bootstrap call after a failure', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockRejectedValueOnce(new Error('migration failed')).mockResolvedValueOnce(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('migration failed');
    await expect(bootstrapLocalDataLayer()).resolves.toBe(localDatabase);

    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(1);
  });

  it('retries system exercise catalog seeding on the next bootstrap call after a seed failure', async () => {
    const sqliteClient = { name: 'sqlite-client' };
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedSystemExerciseCatalog.mockImplementationOnce(() => {
      throw new Error('seed failed');
    });

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('seed failed');

    mockSeedSystemExerciseCatalog.mockImplementation(() => undefined);

    await expect(bootstrapLocalDataLayer()).resolves.toBe(localDatabase);

    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(2);
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
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    await bootstrapLocalDataLayer();
    const resetDatabase = await resetLocalAppData();

    expect(resetDatabase).toBe(resetLocalDatabase);
    expect(sqliteClient.closeAsync).toHaveBeenCalledTimes(1);
    expect(resetSqliteClient.closeAsync).not.toHaveBeenCalled();
    expect(mockDeleteDatabaseAsync).toHaveBeenCalledWith('scaffolding-local.db');
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockDrizzle).toHaveBeenCalledTimes(2);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(2);
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
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

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
});
