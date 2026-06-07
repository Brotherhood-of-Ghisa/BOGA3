// The user-facing sync-status snapshot: a single read that tells a signed-in
// user whether their data is syncing healthily. It composes three local
// sources into one immutable shape — no server round-trip:
//
//   1. The scheduler's production status accessor: the last successful sync
//      time, the latest cycle error, and the live online/offline projection.
//   2. The local `sync_runtime_state` row: whether the first-sync bootstrap has
//      completed.
//   3. A dirty-row count: how many local edits are still waiting to be pushed,
//      summed across the nine user-owned entity tables.
//
// It is read-only: building the snapshot never triggers a sync, mutates state,
// or talks to the server.

import { count, eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import * as schema from '@/src/data/schema';
import { getAuthRequiredSignal } from '@/src/sync/auth-required-signal';
import { getSchedulerStatus } from '@/src/sync/scheduler';

/**
 * The nine user-owned entity tables that carry a `local_dirty` flag. The dirty
 * count sums pending (unpushed) rows across all of them. Kept as an explicit
 * list so the count is obviously total over every syncable entity. Listed in
 * the same dependency order the sync engine drains, Layer 0 parents first.
 */
const DIRTY_COUNTED_TABLES = [
  schema.gyms,
  schema.exerciseDefinitions,
  schema.muscleGroups,
  schema.exerciseTagDefinitions,
  schema.sessions,
  schema.exerciseMuscleMappings,
  schema.sessionExercises,
  schema.exerciseSets,
  schema.sessionExerciseTags,
] as const;

/** The network state a user sees: connected and syncing, or offline. */
export type SyncNetworkState = 'online' | 'offline';

/**
 * The composed sync-status snapshot the Settings surface renders. Every field
 * is derived locally; `errorMessage` is null when the latest cycle was clean,
 * and `authRequired` is true when the latest cycle reported no signed-in user
 * (the user needs to sign in, not retry).
 */
export interface SyncStatusSnapshot {
  /** Epoch-ms of the most recent clean sync cycle, or null if none yet. */
  lastSuccessAtMs: number | null;
  /** Count of local rows still waiting to be pushed, across all 9 tables. */
  dirtyCount: number;
  /** The latest cycle's error message, or null when the latest cycle was clean. */
  errorMessage: string | null;
  /** True when the latest cycle reported that no user is signed in. */
  authRequired: boolean;
  /** Online/offline from the scheduler's live network projection. */
  networkState: SyncNetworkState;
  /** Whether the first-sync bootstrap has completed for this device-account. */
  bootstrapCompleted: boolean;
  /**
   * Count of rows the push leg has quarantined as structurally orphaned: blocked
   * sync rows that are skipped on every push and need repair. 0 in the healthy
   * case; a non-zero value is the "sync needs repair" signal a status surface can
   * render even though the full repair UI is deferred.
   */
  blockedRowCount: number;
}

/**
 * Sums `count(*) WHERE local_dirty = 1` across the nine entity tables. Each
 * table is a small aggregate query; the total is the number of local edits the
 * next push will flush.
 */
const countDirtyRows = async (database: LocalDatabase): Promise<number> => {
  let total = 0;
  for (const table of DIRTY_COUNTED_TABLES) {
    const [row] = await database
      .select({ value: count() })
      .from(table)
      .where(eq(table.localDirty, true));
    total += row?.value ?? 0;
  }
  return total;
};

/**
 * Counts the rows currently quarantined as structural orphans — the "blocked
 * sync rows exist" status signal. A single aggregate over the local-only
 * `sync_quarantine` bookkeeping table; 0 in the healthy case.
 */
const countBlockedRows = async (database: LocalDatabase): Promise<number> => {
  const [row] = await database.select({ value: count() }).from(schema.syncQuarantine);
  return row?.value ?? 0;
};

/**
 * Reads whether the first-sync bootstrap has completed from the singleton
 * runtime-state row. A missing row (never bootstrapped) reads as not completed.
 */
const readBootstrapCompleted = async (database: LocalDatabase): Promise<boolean> => {
  const [row] = await database
    .select({ bootstrapCompletedAt: schema.syncRuntimeState.bootstrapCompletedAt })
    .from(schema.syncRuntimeState)
    .where(eq(schema.syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID));
  return row?.bootstrapCompletedAt != null;
};

/**
 * Builds the current sync-status snapshot from the scheduler status, the
 * runtime-state row, and the dirty-row count. Read-only: it never starts a sync
 * or mutates any state.
 */
export const getSyncStatus = async (): Promise<SyncStatusSnapshot> => {
  const database = await bootstrapLocalDataLayer();
  const schedulerStatus = getSchedulerStatus();

  const [dirtyCount, bootstrapCompleted, blockedRowCount] = await Promise.all([
    countDirtyRows(database),
    readBootstrapCompleted(database),
    countBlockedRows(database),
  ]);

  return {
    lastSuccessAtMs: schedulerStatus.lastSuccessAtMs,
    dirtyCount,
    errorMessage: schedulerStatus.lastCycleError,
    authRequired: getAuthRequiredSignal(),
    networkState: schedulerStatus.online ? 'online' : 'offline',
    bootstrapCompleted,
    blockedRowCount,
  };
};
