// Bundle-migration runtime loop.
//
// The first-install seeder writes the starter catalog exactly once per device,
// then never runs again. That leaves a gap: a later app version that adds a
// field to an existing seed, or ships a brand-new seed, has no way to reach a
// device that was seeded under an earlier bundle — the seeder is permanently
// inert there.
//
// Bundle migrations close that gap. Each migration is a typed, ordered, opt-in
// patch keyed by the catalog-bundle generation it belongs to. On every
// successful sign-in cycle, AFTER the first-sign-in bootstrapper has run
// (whether it seeded a fresh account or no-op'd on a returning one), this loop
// applies every migration whose generation is newer than the persisted marker
// and advances the marker. With no migrations declared yet the loop is a no-op
// beyond bringing a stale marker up to the current generation.
//
// Discipline this loop relies on (enforced by the migration authors, exercised
// by the tests):
//
//   * Each migration runs in its OWN transaction, and the marker advances to
//     that migration's generation IN THE SAME transaction as its row writes.
//     A crash partway through a multi-migration run therefore leaves the marker
//     at the last fully-committed generation; the next launch resumes from
//     there and never re-applies a committed migration.
//   * Every migration's `apply()` must be idempotent under re-run — patch a row
//     only when the target column is still untouched, insert a seed only when it
//     is absent. The repo handle below routes writes so they become dirty (they
//     ride the normal sync push leg to the server next cycle); a migration must
//     never flip the dirty bit itself.

import { and, eq } from 'drizzle-orm';

import { nowMonotonic, type Transaction } from './clock';
import {
  CURRENT_APP_VERSION,
  readSeedsAppliedMarker,
} from './exercise-catalog-seeds';
import { exerciseDefinitions, syncRuntimeState } from './schema';
import type { LocalDatabase } from './bootstrap';

const PRIMARY_RUNTIME_STATE_ID = 'primary';

/**
 * The write surface a bundle migration patches the local catalog through.
 *
 * Every method routes through the monotonic clock and stamps `local_dirty = 1`
 * — exactly the contract the normal repo create/update paths honour — so a
 * migrated row pushes to the server on the next sync cycle. A migration never
 * writes `local_dirty` / `local_updated_at_ms` directly; it goes through these
 * methods, which is what keeps migrated rows on the sync path.
 *
 * The two methods cover the two shapes a catalog change takes: revising a
 * field on existing seed rows, and shipping a brand-new seed. Both are
 * idempotent under re-run by construction — revise-only-from-the-prior-bundle-
 * value and insert-only-if-absent — so re-running a migration over already-
 * migrated rows (or a row the user has since edited) is a safe no-op.
 */
export interface BundleMigrationRepo {
  /**
   * Rewrites the `name` of the exercise definition with the given id from
   * `fromName` to `toName`, but ONLY when the row still holds `fromName` — the
   * value the prior bundle shipped. A row the user renamed (its name no longer
   * matches `fromName`) is left untouched, and a re-run is a no-op because the
   * name is already `toName`. This is the "compare against a known prior bundle
   * value" discipline for a non-null column, where NULL is not the
   * "untouched-by-the-user" signal.
   */
  reviseExerciseDefinitionName(id: string, fromName: string, toName: string): void;

  /**
   * Inserts an exercise-definition seed iff a row with that id is not already
   * present locally. An existing row — seeded earlier, or edited by the user —
   * is left exactly as it is.
   */
  insertExerciseDefinitionIfAbsent(values: { id: string; name: string }): void;
}

/**
 * A single bundle migration: a patch keyed to the catalog-bundle generation
 * that introduced it. The loop applies it once on the first launch whose
 * persisted marker is below `appVersion`, then records `appVersion` as applied.
 *
 * `apply` runs inside the loop's per-migration transaction; it receives a repo
 * handle whose writes are dirty + monotonic-stamped, and must be idempotent
 * under re-run (the loop may re-invoke it if a prior attempt failed before its
 * transaction committed).
 */
export interface BundleMigration {
  /** The catalog-bundle generation this migration belongs to. */
  readonly appVersion: number;
  /** Applies the patch through the dirty-routing repo handle. */
  apply(repo: BundleMigrationRepo): void;
}

/**
 * The ordered list of bundle migrations the current app ships.
 *
 * EMPTY for the first launch of this catalog mechanism: the starter catalog is
 * written wholesale by the seeder, so there is nothing to backfill yet. Each
 * later app version that needs an already-seeded device to pick up a catalog
 * change appends one entry here, keyed to the generation it bumps
 * {@link CURRENT_APP_VERSION} to, with an idempotent `apply`.
 */
export const BUNDLE_MIGRATIONS: readonly BundleMigration[] = [];

/**
 * Test-only override of the migration list the loop runs against. `null` (the
 * default) means "use the shipped {@link BUNDLE_MIGRATIONS}". Tests inject a
 * fixture list here to exercise ordering / resume / idempotency without a
 * concrete migration having to exist in the shipped array.
 *
 * Production code never sets this; only {@link __setBundleMigrationsForTests}
 * mutates it.
 */
let bundleMigrationsOverride: readonly BundleMigration[] | null = null;

/**
 * Test-only seam. Replaces the migration list the loop reads with `migrations`,
 * or clears the override (back to the shipped empty list) when passed `null`.
 * Jest fixtures call this to drive the loop's ordering / resume / idempotency
 * behaviour. Production code MUST NOT call it.
 */
export const __setBundleMigrationsForTests = (
  migrations: readonly BundleMigration[] | null
): void => {
  bundleMigrationsOverride = migrations;
};

/**
 * Test-only override of the current catalog-bundle generation the loop targets.
 * `null` (the default) means "use the shipped {@link CURRENT_APP_VERSION}".
 * Fixture tests raise it so a fixture migration keyed to a later generation than
 * the first ship's `1` falls inside the loop's `(applied, current]` window —
 * simulating a future app build without having to bump the real constant.
 */
let currentAppVersionOverride: number | null = null;

/**
 * Test-only seam. Sets the current generation the loop targets, or clears the
 * override (back to the shipped {@link CURRENT_APP_VERSION}) when passed `null`.
 * Production code MUST NOT call it.
 */
export const __setCurrentAppVersionForTests = (version: number | null): void => {
  currentAppVersionOverride = version;
};

/**
 * Builds the dirty-routing repo handle bound to one transaction. Every write
 * stamps the monotonic clock and `local_dirty = 1` in `tx`, so the migration's
 * rows commit atomically with the marker advance and ride the next sync push.
 */
const createBundleMigrationRepo = (tx: Transaction): BundleMigrationRepo => ({
  reviseExerciseDefinitionName: (id, fromName, toName) => {
    const stampMs = nowMonotonic(tx);
    tx.update(exerciseDefinitions)
      .set({
        name: toName,
        updatedAt: new Date(),
        localDirty: true,
        localUpdatedAtMs: stampMs,
      })
      // Only revise a row still holding the prior bundle value: a re-run (name
      // already revised) and a user-renamed row both fail this predicate and
      // are left untouched.
      .where(and(eq(exerciseDefinitions.id, id), eq(exerciseDefinitions.name, fromName)))
      .run();
  },
  insertExerciseDefinitionIfAbsent: ({ id, name }) => {
    const stampMs = nowMonotonic(tx);
    const now = new Date();
    tx.insert(exerciseDefinitions)
      .values({
        id,
        name,
        createdAt: now,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: stampMs,
      })
      // A row already present (seeded earlier or user-owned) wins; the seed is
      // never overwritten.
      .onConflictDoNothing({ target: exerciseDefinitions.id })
      .run();
  },
});

/**
 * Advances the applied-generation marker on the singleton runtime-state row to
 * `version`, writing through the caller's transaction so the advance commits
 * atomically with the migration's row writes.
 */
const advanceAppliedMarker = (tx: Transaction, version: number): void => {
  tx.insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, appliedSeedMigrationAppVersion: version })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { appliedSeedMigrationAppVersion: version },
    })
    .run();
};

/**
 * Applies every pending bundle migration, in ascending generation order, then
 * brings the marker up to the current generation.
 *
 * Runs after the bootstrapper on every successful sign-in cycle. The persisted
 * `applied_seed_migration_app_version` marker records the newest generation
 * already applied on this device (0 = none). The loop:
 *
 *   1. Short-circuits when the marker already meets or exceeds the current
 *      generation — there is nothing newer to apply.
 *   2. Otherwise applies each migration with `applied < appVersion <= current`
 *      in ascending order, EACH in its own transaction, advancing the marker to
 *      that migration's generation inside the same transaction. A failure
 *      partway leaves the marker at the last committed generation; the next
 *      launch resumes from there.
 *   3. Finally, if the marker still trails the current generation (the common
 *      case with no migration at the top end — including the empty-list first
 *      ship), advances it to the current generation in one more transaction, so
 *      a future migration keyed to a generation already passed is not run.
 *
 * Migrated rows go through the dirty-routing repo handle, so they push to the
 * server on the next cycle; the loop never touches the dirty bit directly.
 */
export const runBundleMigrations = (database: LocalDatabase): void => {
  const applied = readSeedsAppliedMarker(database);
  const current = currentAppVersionOverride ?? CURRENT_APP_VERSION;

  if (applied >= current) {
    return;
  }

  const migrations = bundleMigrationsOverride ?? BUNDLE_MIGRATIONS;
  const pending = migrations
    .filter((migration) => migration.appVersion > applied && migration.appVersion <= current)
    .sort((a, b) => a.appVersion - b.appVersion);

  let marker = applied;

  for (const migration of pending) {
    database.transaction((tx) => {
      migration.apply(createBundleMigrationRepo(tx as Transaction));
      advanceAppliedMarker(tx as Transaction, migration.appVersion);
    });
    marker = migration.appVersion;
  }

  // No migration carried the marker all the way to the current generation
  // (the empty-list case, or a gap above the last declared migration). Advance
  // it so the loop short-circuits next launch and a later migration keyed to a
  // now-passed generation is never applied.
  if (marker < current) {
    database.transaction((tx) => {
      advanceAppliedMarker(tx as Transaction, current);
    });
  }
};
