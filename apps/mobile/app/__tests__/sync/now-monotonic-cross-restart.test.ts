/**
 * Outcome: the monotonic clock helper never goes backwards, including across a
 * simulated cold start.
 *
 * The helper stamps every entity write with `max(wall-clock, last_emitted + 1)`
 * and persists the new high-water mark inside the caller's transaction. Two
 * properties are load-bearing for the server's last-write-wins to behave:
 *
 *   1. Values strictly increase even when the wall clock is frozen (so a burst
 *      of writes within one millisecond still produces distinct, ordered
 *      timestamps).
 *   2. After a process restart the next value continues above the persisted
 *      high-water mark rather than resetting to the wall clock — otherwise the
 *      first post-restart write could stamp a timestamp at or below an
 *      already-pushed row and be silently rejected by the server.
 *
 * This drives the real helper against a real in-memory SQLite (built from the
 * shipped migration bundle), takes 100 values across 100 separate transactions
 * with `Date.now()` pinned to a constant, simulates a cold start by clearing
 * the in-memory cache, and asserts the next value still strictly exceeds the
 * 100th — proving the continuation came from the persisted row, not the clock.
 */

import { __resetClockForTests, nowMonotonic, type Transaction } from '@/src/data/clock';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;
let realDateNow: typeof Date.now;

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  realDateNow = Date.now;
});

afterEach(() => {
  Date.now = realDateNow;
  __resetClockForTests();
  fixture.close();
});

const stamp = (): number =>
  database.transaction((tx) => nowMonotonic(tx as Transaction));

describe('monotonic clock across a simulated restart', () => {
  it('strictly increases for 100 calls in 100 transactions, then continues above the last value after a cold start', () => {
    // Freeze the wall clock so monotonicity can only come from the persisted
    // high-water mark, not from time advancing on its own.
    const FROZEN = 1_700_000_000_000;
    Date.now = () => FROZEN;

    const values: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      values.push(stamp());
    }

    // Strictly increasing across the whole batch.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    const hundredth = values[99];
    expect(hundredth).toBeGreaterThanOrEqual(FROZEN + 99);

    // Simulate a cold start: drop the in-memory cache so the next call must
    // re-read the persisted high-water mark from SQLite.
    __resetClockForTests();

    // Keep the wall clock frozen at the SAME constant — if the helper reset to
    // the wall clock it would return <= the 100th value and fail here.
    const afterRestart = stamp();
    expect(afterRestart).toBeGreaterThan(hundredth);
  });

  it('keeps advancing even with Date.now() pinned below the persisted value', () => {
    // Seed a high persisted value with the real clock.
    const seeded = stamp();
    expect(seeded).toBeGreaterThan(0);

    // Now pin the wall clock far in the past and cold-start: the persisted
    // value must still dominate so the counter never regresses.
    Date.now = () => 1;
    __resetClockForTests();

    const next = stamp();
    expect(next).toBeGreaterThan(seeded);
  });
});
