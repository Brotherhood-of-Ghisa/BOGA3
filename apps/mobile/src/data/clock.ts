import { eq } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { SQLiteTransaction } from 'drizzle-orm/sqlite-core';

import * as schema from './schema';
import { syncRuntimeState } from './schema';

/**
 * Canonical singleton id for the `sync_runtime_state` row that carries
 * `last_emitted_ms`, `pull_cursor`, `bootstrap_completed_at`, and
 * `applied_seed_migration_app_version`. Matches the constant used by the
 * exercise-catalog seed marker — kept in sync so the helper and the seeder
 * write the same physical row instead of fighting over two rows.
 *
 * See `apps/mobile/src/data/schema/sync-runtime-state.ts` and
 * `docs/plans/sync-v2/designs/t2.md` §8.3 / §9.3.
 */
export const PRIMARY_RUNTIME_STATE_ID = 'primary';

/**
 * The drizzle-orm transaction handle the helper writes through.
 *
 * Both the `expo-sqlite` driver (production) and the `better-sqlite3` driver
 * (tests) yield a `SQLiteTransaction<'sync', TRunResult, ...>` from
 * `database.transaction(...)`. The chained query API is identical between
 * the two — only the `TRunResult` generic differs (`SQLiteRunResult` vs
 * better-sqlite3's `RunResult`) — so the helper accepts any sync run-result
 * shape and lets call sites flow their concrete driver type through.
 *
 * Test fixtures that drive an in-memory `better-sqlite3` instance pass their
 * transaction in directly; production call sites in repo write paths pass
 * the `expo-sqlite`-flavoured one. Both satisfy this generic.
 */
export type Transaction = SQLiteTransaction<
  'sync',
  unknown,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Module-scoped cache mirroring the persisted `last_emitted_ms` value per
 * t2 §8.4. Reads the SQLite row exactly once on cold start; every subsequent
 * call inside the same process serves from this cache. The cache is updated
 * inside the **same** transaction that persists the new value (t2 §8.3) so
 * a crash between cache mutation and row commit cannot leak a forward-only
 * counter through to the next process.
 */
let cachedLastEmitted: number | null = null;

/**
 * Returns a strictly-monotonic timestamp in epoch milliseconds, computed as
 * `max(Date.now(), last_emitted_ms + 1)` per t2 §8.1, and persists the new
 * value to `sync_runtime_state.last_emitted_ms` **inside the caller's
 * transaction** (t2 §8.3). The helper takes a `Transaction` — never a
 * `LocalDatabase` — so the SELECT / UPDATE on the singleton row commits
 * atomically with the entity write that consumed the value.
 *
 * Fire-and-forget persistence is forbidden: a crash between the entity row
 * commit and the counter persist would leave the counter behind, and the
 * next launch would emit a timestamp ≤ already-persisted entity timestamps,
 * which the server's LWW would silently reject (incoming ≤ stored).
 *
 * Callers that do not yet hold a transaction must wrap their write in
 * `database.transaction(tx => { ... nowMonotonic(tx) ... })`.
 *
 * The helper is the single source of monotonic time across the app per
 * t2 §8.2. UI timestamps, log timestamps, and other reads that do **not**
 * bump entity `local_updated_at_ms` keep using `Date.now()` directly.
 */
export const nowMonotonic = (tx: Transaction): number => {
  let previous = cachedLastEmitted;
  if (previous === null) {
    const row = tx
      .select({ lastEmittedMs: syncRuntimeState.lastEmittedMs })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();

    previous = row?.lastEmittedMs ?? 0;
  }

  const wall = Date.now();
  const next = Math.max(wall, previous + 1);

  tx.insert(syncRuntimeState)
    .values({
      id: PRIMARY_RUNTIME_STATE_ID,
      lastEmittedMs: next,
    })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: {
        lastEmittedMs: next,
      },
    })
    .run();

  cachedLastEmitted = next;
  return next;
};

/**
 * Test-only helper that resets the module-scoped {@link cachedLastEmitted}
 * cache, simulating a cold start (process restart). The next call to
 * {@link nowMonotonic} will re-read the persisted value from
 * `sync_runtime_state` exactly as it would on a fresh launch.
 *
 * **Production code MUST NOT call this.** The runtime invariant is that the
 * cache always tracks the persisted counter; clearing it mid-session would
 * force an extra SELECT but is otherwise harmless — the helper is documented
 * here strictly for Jest fixtures.
 */
export const __resetClockForTests = (): void => {
  cachedLastEmitted = null;
};
