// First-sign-in bootstrapper: the single load-bearing step that decides whether
// a fresh device-account pairing needs its starter catalog seeded, and that
// marks the first sync cycle as having drained.
//
// It runs once per device per account, gated on `bootstrap_completed_at IS
// NULL`. On a fresh install (or after a sign-out wipe) the local entity tables
// are empty, so the bootstrapper:
//
//   1. resets the persisted pull cursors so the first full pull always replays
//      from scratch (see below);
//   2. runs the first full pull, draining every topological layer;
//   3. iff that pull returned ZERO rows (the server holds nothing for this user,
//      not even a tombstone) it seeds the starter catalog via the normal repo
//      path, so the seeded rows become dirty and the next cycle pushes them;
//   4. sets `bootstrap_completed_at` LAST.
//
// Setting the flag last is what makes a crash recoverable: if the process dies
// between the pull and the flag write, the flag stays null and the next sign-in
// re-attempts the whole thing cleanly. Because a reinstall that pulls back even
// a single row (or a tombstone for a previously-deleted row) sees a non-zero
// pull, the seeder no-ops and the server's state — including the user's
// deletions — stands, which is the device-recovery guarantee.
//
// Resetting the cursors first is what keeps that guarantee honest across a
// RESUMED attempt. The per-layer pull cursors are persisted page-by-page inside
// the pull leg and survive INDEPENDENTLY of `bootstrap_completed_at` and of the
// seed marker. Without a reset, an attempt that advanced some cursors and then
// died before marking bootstrap complete would, on the next attempt, RESUME the
// first full pull from those cursors, pull zero NEW rows on a returning user
// whose data it had already drained, and wrongly conclude "the server is empty"
// — re-seeding the starter catalog and overwriting (via the seeder's
// last-write-wins upsert) the very rows it had just pulled. Clearing the cursors
// while the bootstrap is incomplete forces every attempt to compute the seed
// decision from a complete, from-scratch pull, so a resumed attempt can never
// see a spuriously-empty pull. Steady state is untouched: once
// `bootstrap_completed_at` is set the bootstrapper no-ops, so the converged
// cycle keeps its cursors and resumes incrementally exactly as before.
//
// As it crosses each boundary it publishes a progress snapshot (phase + the
// monotonic counters) so a setup screen can show the current phase and prove it
// is still advancing.

import { eq } from 'drizzle-orm';

import { type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { syncRuntimeState } from '@/src/data/schema';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { runFirstFullPull } from '@/src/sync/cycle';
import {
  PULL_LAYER_COUNT,
  resetSyncProgress,
  setSyncProgress,
  type SyncProgress,
} from '@/src/sync/progress';

/** Whether the bootstrapper has already completed for this device-account. */
const isBootstrapCompleted = (database: LocalDatabase): boolean => {
  const row = database
    .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();

  return row?.bootstrapCompletedAt != null;
};

/**
 * Stamps `bootstrap_completed_at` on the singleton runtime-state row, creating
 * the row if it does not exist yet. This is the LAST write the bootstrapper
 * makes; once it lands the bootstrapper never runs again on this device for this
 * account.
 */
const markBootstrapCompleted = (database: LocalDatabase, completedAt: Date): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: completedAt })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: completedAt },
    })
    .run();
};

/**
 * Reads the persisted per-layer pull-cursor map off the singleton runtime row.
 * The column is JSON mode, so drizzle hands back the parsed object (or the empty
 * `{}` default); a raw-string fallback covers a non-parsed read. Returns `null`
 * (distinct from an empty map) when the runtime-state row does not exist at all,
 * so the caller can tell "no row" from "row with an empty cursor".
 */
const readPullCursorMap = (database: LocalDatabase): Record<string, unknown> | null => {
  const row = database
    .select({ pullCursor: syncRuntimeState.pullCursor })
    .from(syncRuntimeState)
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .get();

  if (row == null) {
    return null;
  }

  const raw = row.pullCursor;
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
};

/**
 * Clears every persisted per-layer pull cursor back to the empty map. Called
 * only while the bootstrap is incomplete, BEFORE the first full pull, so each
 * (re)attempt replays the pull from scratch and the seed decision is computed
 * from a complete drain — never from cursors a prior interrupted attempt left
 * advanced. The empty `{}` matches the column's default; the steady-state cycle,
 * which runs only after `bootstrap_completed_at` is set, is never reached by
 * this.
 *
 * Crucially this is a NO-OP when there is nothing to reset: it only UPDATEs an
 * EXISTING runtime-state row whose cursor map is currently non-empty, and never
 * INSERTs a fresh row (or writes at all) when no row exists or the cursor is
 * already `{}`. `runBootstrapper` runs before the auth outcome surfaces in the
 * cycle, so on a no-JWT cycle — which must mutate nothing — a clean fresh DB has
 * no row and this writes nothing, leaving `sync_runtime_state` untouched. The
 * re-seed bug it guards against only arises after a prior interrupted attempt
 * advanced a cursor, which leaves a row with a non-empty map — exactly the case
 * this still resets.
 */
const resetPullCursors = (database: LocalDatabase): void => {
  const cursorMap = readPullCursorMap(database);

  // No runtime-state row yet (a clean first cycle): nothing persisted to reset,
  // and we must not create a row — a no-JWT cycle would otherwise mutate state.
  if (cursorMap == null) {
    return;
  }

  // The row exists but its cursor is already empty/`{}`: nothing to clear, so
  // skip the write and leave the row byte-for-byte unchanged.
  if (Object.keys(cursorMap).length === 0) {
    return;
  }

  // A prior interrupted attempt advanced at least one layer's cursor. UPDATE the
  // existing row's cursor back to `{}` (never INSERT) so the resumed attempt
  // replays the pull from scratch.
  database
    .update(syncRuntimeState)
    .set({ pullCursor: {} as never })
    .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
    .run();
};

/**
 * Runs the first-sign-in bootstrapper if it has not completed yet. A no-op when
 * `bootstrap_completed_at` is already set. The caller passes the already-prepared
 * local database handle (the cycle holds it) so the bootstrapper does not
 * re-resolve the data layer.
 *
 * Returns once the bootstrap pass is finished (flag set) or immediately if it
 * was already done. Any error from the pull or seed propagates: the flag is not
 * set, so the next sign-in re-attempts cleanly.
 */
export const runBootstrapper = async (database: LocalDatabase): Promise<void> => {
  if (isBootstrapCompleted(database)) {
    return;
  }

  // Start every run from a clean idle snapshot so the per-run counters are
  // honest (a previous, interrupted run never leaks its counts forward).
  resetSyncProgress();

  // Reset the persisted pull cursors before the first full pull. The cursors
  // survive independently of `bootstrap_completed_at`, so an interrupted prior
  // attempt may have left them advanced; clearing them here makes every
  // (re)attempt replay the pull from scratch and compute the seed decision from
  // a complete drain rather than from a resumed — and so spuriously-empty —
  // pull. Only reached while the bootstrap is incomplete (the gate above), so
  // the steady-state cycle's incremental cursors are never touched.
  resetPullCursors(database);

  let rowsApplied = 0;
  let layersCompleted = 0;

  const publish = (phase: SyncProgress['phase']): void => {
    setSyncProgress({ phase, layersCompleted, rowsApplied, offline: false });
  };

  // Pull phase: drain all four layers, bumping the counters as each page applies
  // and each layer completes so a watcher sees motion the whole way through.
  publish('pull');
  const rowsPulled = await runFirstFullPull(database, {
    onPage: (applied) => {
      rowsApplied += applied;
      publish('pull');
    },
    onLayerDrained: (completed) => {
      layersCompleted = completed;
      publish('pull');
    },
  });

  // Make sure the pull phase ends reporting all layers drained even if a layer
  // produced no page event (an empty server returns a single empty page).
  layersCompleted = PULL_LAYER_COUNT;

  // Seed only when the first full pull returned nothing — no rows AND no
  // tombstones. Any pulled row means the server is authoritative for this user
  // and the starter catalog must not be re-created.
  if (rowsPulled === 0) {
    publish('seed');
    seedSystemExerciseCatalog(database);
  }

  // The first full pull and/or the starter-catalog seed above have populated the
  // local catalog tables (exercise definitions, muscle groups, mappings). The
  // in-memory catalog cache was hydrated EMPTY at cold boot (app/_layout.tsx
  // calls `ensureExerciseCatalogLoaded()` before this first sign-in seeds/pulls),
  // and the sync apply path never touches that cache — so without this explicit
  // invalidation a brand-new user would see an empty exercise picker / catalog /
  // stats for the whole first session, until an unrelated catalog write or an app
  // restart re-hydrated it. Invalidate so the freshly-bootstrapped catalog shows
  // immediately. Fires for both branches: the seed path AND a returning user
  // whose catalog arrived via the pull.
  invalidateExerciseCatalogCache();

  // Flag last: a crash before this point leaves `bootstrap_completed_at` null so
  // the next sign-in re-runs the whole pass.
  markBootstrapCompleted(database, new Date());
  publish('done');
};
