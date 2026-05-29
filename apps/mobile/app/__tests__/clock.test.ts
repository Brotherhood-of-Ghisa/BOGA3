/**
 * Tests for `apps/mobile/src/data/clock.ts` — the canonical monotonic clock
 * helper per t2 §8 / sync-v2-client t4.
 *
 * Coverage matrix (mirrors the Outcomes enumerated on t4.md):
 *   - Cold start: first call reads the persisted `last_emitted_ms` fixture.
 *   - Cache hit: a second call inside the same process does NOT re-SELECT.
 *   - `Date.now()` ahead of cache: result equals `Date.now()`.
 *   - Cache ahead of `Date.now()` (clock skew): result equals cache + 1.
 *   - Strict monotonicity over 10000 calls with `Date.now()` frozen.
 *   - Persistence inside one transaction: row reflects the 10th-emitted ms.
 *   - Persistence across restart: `__resetClockForTests()` simulates a cold
 *     start; the next call reads the persisted value, not 0.
 *
 * All tests drive a real in-memory SQLite database via better-sqlite3 +
 * drizzle's better-sqlite3 adapter. The transaction shape that drizzle
 * yields for better-sqlite3 is structurally identical to the production
 * expo-sqlite shape (both extend `BaseSQLiteDatabase<'sync', ..., TSchema>`),
 * so the helper's `Transaction` parameter type accepts the test DB's
 * transaction without casting.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import {
  PRIMARY_RUNTIME_STATE_ID,
  __resetClockForTests,
  nowMonotonic,
  type Transaction,
} from '@/src/data/clock';
import * as schema from '@/src/data/schema';
import { syncRuntimeState } from '@/src/data/schema';

type TestDatabase = BetterSQLite3Database<typeof schema>;

// Only the `sync_runtime_state` table is needed for the clock helper's
// SELECT / UPDATE. The other entity tables are absent from the in-memory
// fixture on purpose — the helper must not touch them, and a missing-table
// SQL error here would surface that regression.
const SYNC_RUNTIME_STATE_DDL = `
  CREATE TABLE sync_runtime_state (
    id text PRIMARY KEY NOT NULL,
    pull_cursor text DEFAULT '{}' NOT NULL,
    last_emitted_ms integer DEFAULT 0 NOT NULL,
    bootstrap_completed_at integer,
    applied_seed_migration_app_version integer DEFAULT 0 NOT NULL
  );
`;

const createTestDatabase = (): { database: TestDatabase; client: Database.Database } => {
  const client = new Database(':memory:');
  client.exec(SYNC_RUNTIME_STATE_DDL);
  // Drizzle gets the full app schema so the test database's transaction
  // shape matches the helper's `Transaction` parameter type exactly — no
  // structural casts needed at the call site.
  const database = drizzle(client, { schema });
  return { database, client };
};

const readPersistedLastEmittedMs = (database: TestDatabase): number => {
  const row = database
    .select({ lastEmittedMs: syncRuntimeState.lastEmittedMs })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  return row?.lastEmittedMs ?? 0;
};

const seedRuntimeStateRow = (database: TestDatabase, lastEmittedMs: number): void => {
  database
    .insert(syncRuntimeState)
    .values({
      id: PRIMARY_RUNTIME_STATE_ID,
      lastEmittedMs,
    })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { lastEmittedMs },
    })
    .run();
};

describe('nowMonotonic (t4 — sync-v2-client clock helper)', () => {
  let realDateNow: typeof Date.now;

  beforeEach(() => {
    __resetClockForTests();
    realDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = realDateNow;
    __resetClockForTests();
  });

  it('reads the persisted last_emitted_ms on cold start when the row already exists', () => {
    const { database } = createTestDatabase();
    const persisted = 1_700_000_000_000;
    seedRuntimeStateRow(database, persisted);

    // Pin Date.now() below the persisted value so the cold-read must come
    // from the row (not just be coincidentally clamped by wall time).
    Date.now = () => persisted - 1_000;

    const emitted = database.transaction((tx: Transaction) => nowMonotonic(tx));

    expect(emitted).toBe(persisted + 1);
    expect(readPersistedLastEmittedMs(database)).toBe(persisted + 1);
  });

  it('initialises to 0 when no sync_runtime_state row exists yet and creates the singleton row', () => {
    const { database } = createTestDatabase();

    const fixedNow = 1_800_000_000_000;
    Date.now = () => fixedNow;

    const emitted = database.transaction((tx: Transaction) => nowMonotonic(tx));

    // Cold cache => null => SELECT returns no row => treated as 0.
    // next = max(fixedNow, 0 + 1) = fixedNow.
    expect(emitted).toBe(fixedNow);
    expect(readPersistedLastEmittedMs(database)).toBe(fixedNow);
  });

  it('does not re-SELECT sync_runtime_state on a second call within the same process (cache hit)', () => {
    const { database, client } = createTestDatabase();
    const persisted = 1_700_000_500_000;
    seedRuntimeStateRow(database, persisted);

    Date.now = () => persisted + 5_000;

    // First call primes the cache via a SELECT.
    const first = database.transaction((tx: Transaction) => nowMonotonic(tx));
    expect(first).toBe(persisted + 5_000);

    // Wrap the underlying better-sqlite3 prepare() so we can observe every
    // SQL statement compiled on the second call. The cache-hit path must
    // emit zero SELECTs against sync_runtime_state — only the UPDATE-or-
    // INSERT to persist `next`.
    const prepareSpy = jest.spyOn(client, 'prepare');

    const second = database.transaction((tx: Transaction) => nowMonotonic(tx));

    expect(second).toBeGreaterThan(first);
    const compiledSql = prepareSpy.mock.calls.map(([sql]) => sql.toLowerCase());
    const selectsAgainstRuntimeState = compiledSql.filter(
      (sql) => sql.includes('select') && sql.includes('sync_runtime_state'),
    );
    expect(selectsAgainstRuntimeState).toEqual([]);

    prepareSpy.mockRestore();
  });

  it('returns Date.now() when wall clock is ahead of the cached value', () => {
    const { database } = createTestDatabase();
    const persisted = 1_700_000_000_000;
    seedRuntimeStateRow(database, persisted);

    const wallAhead = persisted + 60_000; // wall clock is 60s ahead of cache
    Date.now = () => wallAhead;

    const emitted = database.transaction((tx: Transaction) => nowMonotonic(tx));

    expect(emitted).toBe(wallAhead);
    expect(readPersistedLastEmittedMs(database)).toBe(wallAhead);
  });

  it('returns cached + 1 when wall clock has skewed backwards (cache ahead of Date.now())', () => {
    const { database } = createTestDatabase();
    const persisted = 1_700_000_000_000;
    seedRuntimeStateRow(database, persisted);

    // NTP-style backwards skew: wall clock is 10s behind the persisted
    // counter. The helper must clamp to cached + 1 to preserve monotonicity.
    const wallBehind = persisted - 10_000;
    Date.now = () => wallBehind;

    const emitted = database.transaction((tx: Transaction) => nowMonotonic(tx));

    expect(emitted).toBe(persisted + 1);
    expect(readPersistedLastEmittedMs(database)).toBe(persisted + 1);
  });

  it('produces strictly increasing values across 10000 sequential calls even when Date.now() is frozen', () => {
    const { database } = createTestDatabase();
    const frozenNow = 1_700_000_000_000;
    Date.now = () => frozenNow;

    const ITERATIONS = 10_000;
    const emitted: number[] = new Array(ITERATIONS);

    database.transaction((tx: Transaction) => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        emitted[i] = nowMonotonic(tx);
      }
    });

    // First call: cache null, persisted row absent => max(frozenNow, 0+1) = frozenNow.
    expect(emitted[0]).toBe(frozenNow);
    // Subsequent calls clamp to previous + 1 because Date.now() never moves.
    for (let i = 1; i < ITERATIONS; i += 1) {
      expect(emitted[i]).toBe(emitted[i - 1] + 1);
    }
    // Strict monotonicity holds across the whole sequence.
    expect(emitted[ITERATIONS - 1]).toBe(frozenNow + ITERATIONS - 1);
  });

  it('persists each emitted value synchronously: after 10 calls inside one transaction the row reads the 10th value', () => {
    const { database } = createTestDatabase();
    const persisted = 1_700_000_900_000;
    seedRuntimeStateRow(database, persisted);

    const frozenNow = persisted + 100; // ahead of cache so wall wins on call #1
    Date.now = () => frozenNow;

    let tenth = 0;
    database.transaction((tx: Transaction) => {
      let last = 0;
      for (let i = 0; i < 10; i += 1) {
        last = nowMonotonic(tx);
      }
      tenth = last;
    });

    // After 10 calls with Date.now() frozen at `frozenNow` and cache
    // initialised from the persisted row: call #1 emits `frozenNow`; each
    // subsequent call clamps to prev + 1; the 10th emits `frozenNow + 9`.
    expect(tenth).toBe(frozenNow + 9);
    // The row reflects the final persisted value — no fire-and-forget loss.
    expect(readPersistedLastEmittedMs(database)).toBe(frozenNow + 9);
  });

  it('persists across simulated restart: __resetClockForTests() forces the next call to read from sync_runtime_state', () => {
    const { database } = createTestDatabase();

    const firstNow = 1_700_001_000_000;
    Date.now = () => firstNow;

    const beforeRestart = database.transaction((tx: Transaction) => nowMonotonic(tx));
    expect(beforeRestart).toBe(firstNow);
    expect(readPersistedLastEmittedMs(database)).toBe(firstNow);

    // Simulate a cold launch: cache is gone, wall clock rolls back below
    // the persisted counter (e.g. user changed system clock; or the device
    // booted with an uninitialised RTC).
    __resetClockForTests();
    const wallBehindPersisted = firstNow - 5_000;
    Date.now = () => wallBehindPersisted;

    const afterRestart = database.transaction((tx: Transaction) => nowMonotonic(tx));

    // The helper must re-read the persisted value (not start from 0 or from
    // the rolled-back wall clock) and clamp to persisted + 1.
    expect(afterRestart).toBe(firstNow + 1);
    expect(readPersistedLastEmittedMs(database)).toBe(firstNow + 1);
  });

  it('writes the singleton row under the canonical PRIMARY_RUNTIME_STATE_ID', () => {
    const { database, client } = createTestDatabase();
    Date.now = () => 1_700_002_000_000;

    database.transaction((tx: Transaction) => nowMonotonic(tx));

    // Direct SQL — bypass the helper to assert against the raw schema.
    const rows = client.prepare('SELECT id, last_emitted_ms FROM sync_runtime_state').all() as {
      id: string;
      last_emitted_ms: number;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(PRIMARY_RUNTIME_STATE_ID);
    expect(rows[0].id).toBe('primary');
    expect(rows[0].last_emitted_ms).toBe(1_700_002_000_000);
  });
});
