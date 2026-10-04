// The one complete local-data wipe. Every path that must leave the device with
// no account data — sign-out, a sync cycle for a different account than the one
// the database holds, and the developer reset — goes through
// `wipeLocalDatabaseRows`, so none of them can forget a table or leave the
// previous account's pull cursors behind.
//
// Why cursors matter as much as rows: the pull cursors are per-layer positions
// in the server's change stream. If they survive into a different account (or a
// database whose rows were deleted), the next incremental pull skips every
// server row older than the stale cursor. Layers drain independently, so a
// child layer can return rows whose parents the parent layer skipped — the
// local FK check then rejects the page (`LOCAL_FK_VIOLATION`) on every retry.

import { eq, sql } from 'drizzle-orm';

import { type LocalDatabase } from './bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from './clock';
import { clearExerciseSessionFacts } from './exercise-session-facts';
import {
  bodyWeightMeasurements,
  exerciseDefinitions,
  exerciseGroupLinks,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  groupCache,
  gyms,
  muscleGroups,
  sessionExerciseTags,
  sessionExercises,
  sessions,
  syncQuarantine,
  syncRuntimeState,
  userSettings,
} from './schema';
import { smokeRecords } from './schema/smoke';

/**
 * The twelve synced, per-account entity tables, child before parent so foreign
 * keys stay satisfied even where a cascade is missing (`exercise_group_links`
 * has a `no action` FK into `exercise_definitions`). Each carries `local_dirty`.
 */
const SYNCED_ENTITY_TABLES = [
  sessionExerciseTags,
  exerciseSets,
  sessionExercises,
  sessions,
  gyms,
  exerciseTagDefinitions,
  exerciseMuscleMappings,
  exerciseGroupLinks,
  exerciseDefinitions,
  muscleGroups,
  userSettings,
  bodyWeightMeasurements,
] as const;

/**
 * Tables the wipe deletes: the synced entity tables, then the local-only ones.
 * The derived exercise-session facts tables are cleared last by
 * `clearExerciseSessionFacts`, because the entity deletes fire the facts
 * triggers that refill their stale queue.
 */
export const LOCAL_WIPE_TABLES = [...SYNCED_ENTITY_TABLES, groupCache, syncQuarantine, smokeRecords] as const;

/**
 * Tables the wipe keeps. `sync_runtime_state` is reset in place (below) rather
 * than deleted, because it carries the device-global monotonic clock; the
 * migrator's bookkeeping table is the schema itself.
 */
export const LOCAL_WIPE_PRESERVED_TABLES = ['sync_runtime_state', '__drizzle_migrations'] as const;

export interface LocalWipeOptions {
  /**
   * The account the emptied database now belongs to: the signed-in account a
   * sync cycle is about to restore, or null after sign-out.
   */
  accountUserId: string | null;
}

/**
 * Deletes every row of every account table, the derived facts, the quarantine
 * and the group cache, then resets the sync accounting on the runtime-state row
 * — all in one transaction:
 *
 *   - `bootstrap_completed_at` → null, so the next cycle runs the first-sign-in
 *     bootstrapper (a from-scratch pull) and the first-sync gate comes up;
 *   - `pull_cursor` → {}, so every layer pulls from the beginning;
 *   - `applied_seed_migration_app_version` → 0, so pending catalog-bundle
 *     migrations re-apply to the pulled rows;
 *   - `account_user_id` → `options.accountUserId`.
 *
 * `last_emitted_ms` is preserved: the monotonic clock is device-global, and
 * resetting it could let a later write carry a timestamp at or below one this
 * device already pushed, which server last-write-wins would silently reject.
 *
 * The runtime row is upserted only when an owner is being stamped; a sign-out
 * wipe on a database that never wrote the row has nothing to reset.
 */
export const wipeLocalDatabaseRows = (database: LocalDatabase, options: LocalWipeOptions): void => {
  database.transaction((tx) => {
    const transaction = tx as Transaction;

    for (const table of LOCAL_WIPE_TABLES) {
      transaction.delete(table).run();
    }
    clearExerciseSessionFacts(transaction);

    const reset = {
      bootstrapCompletedAt: null,
      pullCursor: {} as never,
      appliedSeedMigrationAppVersion: 0,
      accountUserId: options.accountUserId,
    };

    if (options.accountUserId === null) {
      transaction
        .update(syncRuntimeState)
        .set(reset)
        .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
        .run();
      return;
    }

    transaction
      .insert(syncRuntimeState)
      .values({ id: PRIMARY_RUNTIME_STATE_ID, ...reset })
      .onConflictDoUpdate({ target: syncRuntimeState.id, set: reset })
      .run();
  });
};

/** The account the local database holds data for, or null when unowned. */
export const readLocalDataOwner = (database: LocalDatabase): string | null => {
  const row = database
    .select({ accountUserId: syncRuntimeState.accountUserId })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  return row?.accountUserId ?? null;
};

/**
 * How many rows wait to be pushed (`local_dirty`) across the synced entity
 * tables: the unpushed edits a wipe would discard.
 */
export const countDirtyRows = (database: LocalDatabase): number =>
  SYNCED_ENTITY_TABLES.reduce((total, table) => {
    const row = database
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(sql`local_dirty = 1`)
      .get();
    return total + Number(row?.n ?? 0);
  }, 0);

/** Whether the store has synced before (a bootstrap flag or a pull cursor). */
export const hasSyncHistory = (database: LocalDatabase): boolean => {
  const row = database
    .select({
      bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt,
      pullCursor: syncRuntimeState.pullCursor,
    })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();
  if (!row) {
    return false;
  }
  const cursor = typeof row.pullCursor === 'string' ? (JSON.parse(row.pullCursor) as object) : row.pullCursor;
  return row.bootstrapCompletedAt != null || Object.keys((cursor ?? {}) as object).length > 0;
};

/**
 * Restarts every layer's pull from the beginning, keeping rows, dirty bits and
 * the bootstrap flag: the next pull re-applies the account's whole server state
 * under last-write-wins (a no-op for rows already local, a win for newer local
 * edits), parents before children.
 */
export const resetPullCursors = (database: LocalDatabase): void => {
  database
    .update(syncRuntimeState)
    .set({ pullCursor: {} as never })
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .run();
};

/** Records `accountUserId` as the owner of the local database. */
export const stampLocalDataOwner = (database: LocalDatabase, accountUserId: string): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, accountUserId })
    .onConflictDoUpdate({ target: syncRuntimeState.id, set: { accountUserId } })
    .run();
};
