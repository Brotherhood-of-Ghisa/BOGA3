/**
 * The one complete local-data wipe (`src/data/local-wipe.ts`), used by
 * sign-out, the sync cycle's account-ownership guard and the developer reset.
 *
 * "Complete" is enforced against the real migrated schema: every table in the
 * database must be either wiped or explicitly preserved, so a new table cannot
 * silently survive a sign-out into the next account. And the sync accounting
 * must reset with the rows — pull cursors left over an emptied store skip every
 * older server row, which is how a re-sync ended in a local FK violation.
 */

import { eq, getTableName } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import {
  LOCAL_WIPE_PRESERVED_TABLES,
  LOCAL_WIPE_TABLES,
  readLocalDataOwner,
  stampLocalDataOwner,
  wipeLocalDatabaseRows,
} from '@/src/data/local-wipe';
import {
  exerciseSessionFacts,
  exerciseSessionFactsStale,
  exerciseSessionFactsState,
  syncRuntimeState,
} from '@/src/data/schema';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;

beforeEach(() => {
  fixture = createInMemoryDatabase();
});

afterEach(() => {
  fixture.close();
});

const local = (): LocalDatabase => fixture.database as unknown as LocalDatabase;

const allTables = (): string[] =>
  (
    fixture.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((row) => row.name);

const rowCount = (table: string): number =>
  (fixture.client.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

const runtimeRow = () =>
  fixture.database
    .select()
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();

/** One row in every account table the catalog seed does not fill, raw SQL so no repo path filters it. */
const insertHistory = (): void => {
  fixture.client.exec(`
    INSERT INTO gyms (id, name) VALUES ('gym-1', 'Gym');
    INSERT INTO sessions (id, gym_id, started_at, completed_at, status) VALUES ('s-1', 'gym-1', 1, 2, 'completed');
    INSERT INTO session_exercises (id, session_id, order_index, name) VALUES ('sx-1', 's-1', 0, 'Bench Press');
    INSERT INTO exercise_sets (id, session_exercise_id, order_index) VALUES ('set-1', 'sx-1', 0);
    INSERT INTO sync_quarantine (entity_type, entity_id, error_code, first_seen_at_ms, last_seen_at_ms)
      VALUES ('exercise_sets', 'orphan', 'LOCAL_FK_VIOLATION', 1, 1);
    INSERT INTO group_cache (cache_key, user_id, payload_json, fetched_at_ms) VALUES ('g', 'user-a', '{}', 1);
  `);
};

const FACTS_TABLES = [exerciseSessionFacts, exerciseSessionFactsStale, exerciseSessionFactsState].map(getTableName);
const WIPED_TABLES = [...LOCAL_WIPE_TABLES.map(getTableName), ...FACTS_TABLES];

describe('wipeLocalDatabaseRows', () => {
  it('covers every table in the schema: each is wiped or explicitly preserved', () => {
    const accounted = new Set<string>([...WIPED_TABLES, ...LOCAL_WIPE_PRESERVED_TABLES]);

    expect(allTables().filter((table) => !accounted.has(table))).toEqual([]);
  });

  it('empties every account table and resets the sync accounting, keeping the monotonic clock', () => {
    seedSystemExerciseCatalog(local());
    insertHistory();
    fixture.database
      .update(syncRuntimeState)
      .set({
        bootstrapCompletedAt: new Date(1_700_000_000_000),
        pullCursor: { '1': { id: 'stale' } } as never,
        lastEmittedMs: 1_800_000_000_000,
        accountUserId: 'user-a',
      })
      .run();
    expect(rowCount('sessions')).toBeGreaterThan(0);

    wipeLocalDatabaseRows(local(), { accountUserId: 'user-b' });

    for (const table of WIPED_TABLES) {
      expect({ table, rows: rowCount(table) }).toEqual({ table, rows: 0 });
    }
    expect(runtimeRow()).toMatchObject({
      bootstrapCompletedAt: null,
      pullCursor: {},
      appliedSeedMigrationAppVersion: 0,
      lastEmittedMs: 1_800_000_000_000,
      accountUserId: 'user-b',
    });
  });

  it('leaves the store unowned after a sign-out wipe', () => {
    stampLocalDataOwner(local(), 'user-a');

    wipeLocalDatabaseRows(local(), { accountUserId: null });

    expect(readLocalDataOwner(local())).toBeNull();
  });

  it('writes no runtime row on a sign-out wipe of a database that never had one', () => {
    wipeLocalDatabaseRows(local(), { accountUserId: null });

    expect(runtimeRow()).toBeUndefined();
  });
});
