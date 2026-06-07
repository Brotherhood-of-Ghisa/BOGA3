/* eslint-disable import/first */

const mockOpenDatabaseSync = jest.fn();
const mockDeleteDatabaseAsync = jest.fn();
const mockDrizzle = jest.fn();
const mockMigrate = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();
const mockInvalidateExerciseCatalogCache = jest.fn();
const mockGetMobileAuthRuntimeConfig = jest.fn();
const mockLogEvent = jest.fn();

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

jest.mock('@/src/auth/supabase', () => ({
  getMobileAuthRuntimeConfig: (...args: unknown[]) => mockGetMobileAuthRuntimeConfig(...args),
}));

jest.mock('@/src/exercise-catalog/invalidation', () => ({
  invalidateExerciseCatalogCache: (...args: unknown[]) =>
    mockInvalidateExerciseCatalogCache(...args),
}));

jest.mock('@/src/logging', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));

import { __resetLocalDataLayerForTests, bootstrapLocalDataLayer, resetLocalAppData } from '@/src/data/bootstrap';
import { localRuntimeMigrations } from '@/src/data/migrations';

const createSqliteClient = (
  name: string,
  options: {
    closeAsync?: jest.Mock<Promise<void>, []>;
    foreignKeysStayOff?: boolean;
    foreignKeyCheckViolation?: Record<string, unknown>;
  } = {},
) => {
  let foreignKeys = 0;
  const client = {
    closeAsync: options.closeAsync ?? jest.fn().mockResolvedValue(undefined),
    execSync: jest.fn((sql: string) => {
      if (sql.trim().toUpperCase() === 'PRAGMA FOREIGN_KEYS = ON') {
        foreignKeys = options.foreignKeysStayOff ? 0 : 1;
      }
    }),
    getFirstSync: jest.fn((sql: string) => {
      const normalizedSql = sql.trim().toUpperCase();
      if (normalizedSql === 'PRAGMA FOREIGN_KEYS') {
        return { foreign_keys: foreignKeys };
      }
      if (normalizedSql === 'PRAGMA FOREIGN_KEY_CHECK') {
        return options.foreignKeyCheckViolation ?? null;
      }
      return null;
    }),
    name,
  };
  return client;
};

describe('bootstrapLocalDataLayer', () => {
  beforeEach(() => {
    __resetLocalDataLayerForTests();
    mockOpenDatabaseSync.mockReset();
    mockDeleteDatabaseAsync.mockReset();
    mockDrizzle.mockReset();
    mockMigrate.mockReset();
    mockSeedSystemExerciseCatalog.mockReset();
    mockInvalidateExerciseCatalogCache.mockReset();
    mockLogEvent.mockReset();
    mockLogEvent.mockResolvedValue(undefined);
    // Default to a sync-configured build: the first-sign-in bootstrapper owns
    // the starter catalog (muscle_groups + exercise definitions + mappings), so
    // boot must NOT seed it. The infra-free branch is exercised explicitly in its
    // own tests below.
    mockGetMobileAuthRuntimeConfig.mockReset();
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: true });
  });

  it('creates the local database, enables FK enforcement, applies runtime migrations, and runs the integrity check', async () => {
    const sqliteClient = createSqliteClient('sqlite-client');
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);

    const firstBootstrap = await bootstrapLocalDataLayer();
    const secondBootstrap = await bootstrapLocalDataLayer();

    expect(firstBootstrap).toBe(localDatabase);
    expect(secondBootstrap).toBe(localDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(sqliteClient.execSync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
    expect(sqliteClient.getFirstSync).toHaveBeenCalledWith('PRAGMA foreign_keys');
    expect(sqliteClient.getFirstSync).toHaveBeenCalledWith('PRAGMA foreign_key_check');
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledWith(localDatabase, localRuntimeMigrations);
    // Sync-configured build: the first-sign-in bootstrapper owns the starter
    // catalog (which now includes muscle_groups), so boot must not seed it (a
    // reinstall recovers it from the server).
    expect(mockSeedSystemExerciseCatalog).not.toHaveBeenCalled();
  });

  it('logs and rethrows when SQLite foreign-key enforcement cannot be enabled', async () => {
    const sqliteClient = createSqliteClient('sqlite-client', { foreignKeysStayOff: true });

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('SQLite foreign_keys pragma is 0');

    expect(mockDrizzle).not.toHaveBeenCalled();
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith({
      level: 'error',
      source: 'database',
      event: 'data.sqlite_foreign_key_bootstrap_failed',
      message: 'SQLite foreign-key bootstrap check failed',
      context: {
        operation: 'configure_foreign_keys',
        foreign_keys: 0,
        error_message: 'SQLite foreign_keys pragma is 0',
      },
    });
  });

  it('logs and rethrows integrity-check failures after migrations and seeds complete', async () => {
    const sqliteClient = createSqliteClient('sqlite-client', {
      foreignKeyCheckViolation: {
        table: 'session_exercises',
        rowid: 7,
        parent: 'sessions',
        fkid: 0,
      },
    });
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('SQLite foreign_key_check found violations');

    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith({
      level: 'error',
      source: 'database',
      event: 'data.sqlite_foreign_key_bootstrap_failed',
      message: 'SQLite foreign-key bootstrap check failed',
      context: {
        operation: 'foreign_key_check',
        foreign_keys: 1,
        error_message: 'SQLite foreign_key_check found violations',
      },
    });
  });

  it('does not let diagnostic logging failure mask the original FK bootstrap failure', async () => {
    const sqliteClient = createSqliteClient('sqlite-client', { foreignKeysStayOff: true });
    mockLogEvent.mockRejectedValueOnce(new Error('logger unavailable'));
    mockOpenDatabaseSync.mockReturnValue(sqliteClient);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('SQLite foreign_keys pragma is 0');
  });

  it('retries runtime migrations on the next bootstrap call after a failure', async () => {
    const sqliteClient = createSqliteClient('sqlite-client');
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockRejectedValueOnce(new Error('migration failed')).mockResolvedValueOnce(undefined);

    await expect(bootstrapLocalDataLayer()).rejects.toThrow('migration failed');
    await expect(bootstrapLocalDataLayer()).resolves.toBe(localDatabase);

    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
  });

  it('resets runtime app data by closing the database, deleting it, and re-running bootstrap', async () => {
    const sqliteClient = createSqliteClient('sqlite-client');
    const resetSqliteClient = createSqliteClient('sqlite-client-after-reset');
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);

    await bootstrapLocalDataLayer();
    const resetDatabase = await resetLocalAppData();

    expect(resetDatabase).toBe(resetLocalDatabase);
    expect(sqliteClient.closeAsync).toHaveBeenCalledTimes(1);
    expect(resetSqliteClient.closeAsync).not.toHaveBeenCalled();
    expect(mockDeleteDatabaseAsync).toHaveBeenCalledWith('scaffolding-local.db');
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockDrizzle).toHaveBeenCalledTimes(2);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
  });

  it('invalidates the exercise-catalog cache after a reset re-seeds the database, so the next read repopulates from the fresh seed', async () => {
    // Infra-free build: the reset path re-runs the starter-catalog seed, and the
    // cache must be invalidated once exactly, after the re-seed.
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: false });

    const sqliteClient = createSqliteClient('sqlite-client');
    const resetSqliteClient = createSqliteClient('sqlite-client-after-reset');
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    // A plain bootstrap must not touch the cache — invalidation only matters
    // once the DB is wiped and re-seeded out from under the in-memory snapshot.
    await bootstrapLocalDataLayer();
    expect(mockInvalidateExerciseCatalogCache).not.toHaveBeenCalled();

    await resetLocalAppData();

    // Reset invalidates exactly once, and only after the re-seed has run so the
    // subsequent reload observes the freshly seeded rows (not the wiped DB).
    expect(mockInvalidateExerciseCatalogCache).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(2);
    expect(mockInvalidateExerciseCatalogCache.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSeedSystemExerciseCatalog.mock.invocationCallOrder[1]
    );
  });

  it('serializes a concurrent bootstrap behind an in-flight reset so the database is never reopened before deletion completes', async () => {
    const sqliteClient = createSqliteClient('sqlite-client');
    const resetSqliteClient = createSqliteClient('sqlite-client-after-reset');
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);

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

  it('a rejected reset does not wedge the data-layer lock chain — a later bootstrap still resolves', async () => {
    // `runExclusiveDataLayerOperation` queues the next op behind the previous
    // one REGARDLESS of whether it resolved or rejected (`.then(op, op)` on the
    // gate). This proves the failure path: a reset that throws at the native
    // delete must not leave the lock chain permanently blocked.
    const sqliteClient = createSqliteClient('sqlite-client');
    const reopenedSqliteClient = createSqliteClient('sqlite-client-reopened');
    const localDatabase = { name: 'local-db' };
    const reopenedLocalDatabase = { name: 'local-db-reopened' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(reopenedSqliteClient);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(reopenedLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
    // The native delete rejects exactly once — the reset operation fails.
    mockDeleteDatabaseAsync.mockRejectedValueOnce(new Error('delete failed'));

    await bootstrapLocalDataLayer();
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(1);

    // The reset closes the old handle, then rejects at the gated delete.
    await expect(resetLocalAppData()).rejects.toThrow('delete failed');
    expect(sqliteClient.closeAsync).toHaveBeenCalledTimes(1);
    // It rejected before re-preparing the data layer, so it never reached the
    // re-seed or the cache invalidation.
    expect(mockInvalidateExerciseCatalogCache).not.toHaveBeenCalled();

    // The chain is NOT wedged: the next bootstrap runs and re-opens the database
    // (the reset cleared the singletons before it failed). Pre-fix a rejected op
    // would have left the gate rejected and this would never resolve.
    const reopened = await bootstrapLocalDataLayer();

    expect(reopened).toBe(reopenedLocalDatabase);
    expect(mockOpenDatabaseSync).toHaveBeenCalledTimes(2);
    expect(mockDrizzle).toHaveBeenCalledTimes(2);
    expect(mockMigrate).toHaveBeenCalledTimes(2);
  });

  it('seeds the full starter catalog at boot when no sync backend is configured (infra-free build)', async () => {
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: false });

    const sqliteClient = createSqliteClient('sqlite-client');
    const localDatabase = { name: 'local-db' };

    mockOpenDatabaseSync.mockReturnValue(sqliteClient);
    mockDrizzle.mockReturnValue(localDatabase);
    mockMigrate.mockResolvedValue(undefined);
    mockSeedSystemExerciseCatalog.mockReturnValue(undefined);

    await bootstrapLocalDataLayer();

    // With no server to recover the catalog from, boot seeds the full starter
    // catalog — muscle_groups, exercise definitions, and mappings — via the
    // generic seeder (the picker would be empty otherwise).
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledTimes(1);
    expect(mockSeedSystemExerciseCatalog).toHaveBeenCalledWith(localDatabase);
    // The catalog seed runs after migrations have applied.
    expect(mockSeedSystemExerciseCatalog.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockMigrate.mock.invocationCallOrder[0]
    );
  });

  it('re-seeds the starter exercise catalog after a data reset when no sync backend is configured, so the infra-free picker stays populated', async () => {
    mockGetMobileAuthRuntimeConfig.mockReturnValue({ isConfigured: false });

    const sqliteClient = createSqliteClient('sqlite-client');
    const resetSqliteClient = createSqliteClient('sqlite-client-after-reset');
    const localDatabase = { name: 'local-db' };
    const resetLocalDatabase = { name: 'local-db-after-reset' };

    mockOpenDatabaseSync.mockReturnValueOnce(sqliteClient).mockReturnValueOnce(resetSqliteClient);
    mockDeleteDatabaseAsync.mockResolvedValue(undefined);
    mockDrizzle.mockReturnValueOnce(localDatabase).mockReturnValueOnce(resetLocalDatabase);
    mockMigrate.mockResolvedValue(undefined);
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
