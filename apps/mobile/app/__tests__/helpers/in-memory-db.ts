/**
 * Shared in-memory SQLite fixture for unit tests.
 *
 * Spins up an in-memory `better-sqlite3` database, applies EVERY migration
 * from the generated migration bundle (the same SQL the production Expo
 * migrator ships), and returns the drizzle handle plus a teardown.
 *
 * Driving the schema from the generated bundle — not a hand-copied DDL string
 * or a single hand-picked `.sql` file — means the fixture always matches the
 * real shipped schema: when a new migration is added and the bundle is
 * regenerated, every test on this helper picks it up automatically. There is
 * one source of truth for "a real, fully-migrated in-memory database", so no
 * test needs to duplicate DB-setup logic.
 *
 * The transaction shape better-sqlite3 yields is structurally identical to the
 * production expo-sqlite shape (both extend
 * `BaseSQLiteDatabase<'sync', ..., TSchema>`), so handles from this helper can
 * be passed to production code that takes a drizzle `Transaction` unchanged.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import * as schema from '@/src/data/schema';

export type InMemoryTestDatabase = BetterSQLite3Database<typeof schema>;

export interface InMemoryDatabaseFixture {
  /** Drizzle handle bound to the full app schema. */
  database: InMemoryTestDatabase;
  /** Underlying better-sqlite3 client — for raw SQL or `prepare()` spies. */
  client: Database.Database;
  /** Closes the underlying connection. Call from `afterEach`. */
  close: () => void;
}

// Bundle keys each migration as `m${idx.padStart(4, '0')}` — the same
// convention the Expo migrator uses (see src/data/migrations/index.ts).
const migrationKeyForIndex = (idx: number): string => `m${String(idx).padStart(4, '0')}`;

/**
 * Applies all bundled migrations, in journal order, to a raw better-sqlite3
 * client. Each migration's SQL is split on drizzle's
 * `--> statement-breakpoint` markers and executed statement by statement.
 */
export const applyAllMigrations = (client: Database.Database): void => {
  const { journal, migrations } = generatedMigrationBundle;
  const orderedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of orderedEntries) {
    const key = migrationKeyForIndex(entry.idx);
    const sql = (migrations as Record<string, string | undefined>)[key];
    if (sql === undefined) {
      throw new Error(`Migration bundle is missing SQL for journal entry "${entry.tag}" (${key}).`);
    }

    for (const rawStatement of sql.split('--> statement-breakpoint')) {
      const statement = rawStatement.trim();
      if (statement.length > 0) {
        client.exec(statement);
      }
    }
  }
};

/**
 * Creates a fresh in-memory database with the full migrated schema applied.
 *
 * Foreign-key enforcement is ON by default, mirroring production: at boot the
 * app runs `PRAGMA foreign_keys = ON` after migrations and before any data is
 * written, so every fixture sees the same enforcement the running app does and
 * an insertion-order bug fails a test here instead of bricking a real device.
 * (SQLite leaves `foreign_keys` OFF per connection unless this pragma is set —
 * it is never on "by default".) The pragma is applied after the migrations run,
 * matching the boot order, so the schema DDL itself is never affected.
 *
 * @param options.foreignKeys - pass `false` to leave enforcement OFF. Only for
 *   fixtures that deliberately need to plant an orphan or otherwise insert a
 *   child before its parent for a non-FK reason; document the reason at the call
 *   site.
 */
export const createInMemoryDatabase = (
  options: { foreignKeys?: boolean } = {},
): InMemoryDatabaseFixture => {
  const client = new Database(':memory:');
  applyAllMigrations(client);
  if (options.foreignKeys !== false) {
    client.pragma('foreign_keys = ON');
  }
  const database = drizzle(client, { schema });
  return {
    database,
    client,
    close: () => client.close(),
  };
};
