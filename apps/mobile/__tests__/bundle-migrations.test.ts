/**
 * Bundle-migration runtime loop.
 *
 * The first-install seeder writes the starter catalog once, then never runs
 * again. Bundle migrations are the mechanism by which a later catalog change (a
 * revised seed field, a brand-new seed) reaches a device that was already
 * seeded under an earlier bundle. The loop runs after the bootstrapper on every
 * cycle: it applies every migration whose generation falls in
 * `(applied_marker, current_generation]`, each in its own transaction,
 * advancing the marker in that same transaction, and then brings the marker up
 * to the current generation even when nothing was pending.
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema, via the shared `helpers/in-memory-db` fixture — so the per-migration
 * transaction semantics (atomic commit, rollback on throw, marker advance bound
 * to the same transaction) are exercised end to end against real SQLite.
 *
 * The shipped `BUNDLE_MIGRATIONS` array is empty for the first launch; the
 * ordered / resume / idempotent behaviour is proven against a FIXTURE migration
 * list injected through `__setBundleMigrationsForTests`, so the tests verify the
 * mechanism without depending on a concrete migration existing.
 */

import { eq } from 'drizzle-orm';

import { __resetClockForTests } from '@/src/data/clock';
import {
  __setBundleMigrationsForTests,
  __setCurrentAppVersionForTests,
  type BundleMigration,
  type BundleMigrationRepo,
  BUNDLE_MIGRATIONS,
  runBundleMigrations,
} from '@/src/data/bundle-migrations';
import {
  CURRENT_APP_VERSION,
  readSeedsAppliedMarker,
} from '@/src/data/exercise-catalog-seeds';
import { exerciseDefinitions, muscleGroups, syncRuntimeState } from '@/src/data/schema';
import { subscribeToExerciseCatalogInvalidation } from '@/src/exercise-catalog/invalidation';
import type { LocalDatabase } from '@/src/data/bootstrap';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

const RUNTIME_STATE_ID = 'primary';

const asLocalDatabase = (fixture: InMemoryDatabaseFixture) =>
  fixture.database as unknown as LocalDatabase;

/** Seeds the singleton runtime-state row with a starting marker value. */
const setMarker = (fixture: InMemoryDatabaseFixture, value: number) => {
  fixture.database
    .insert(syncRuntimeState)
    .values({ id: RUNTIME_STATE_ID, appliedSeedMigrationAppVersion: value })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { appliedSeedMigrationAppVersion: value },
    })
    .run();
};

const readMarker = (fixture: InMemoryDatabaseFixture) =>
  readSeedsAppliedMarker(asLocalDatabase(fixture));

const insertExerciseDefinition = (
  fixture: InMemoryDatabaseFixture,
  values: { id: string; name: string }
) => {
  const now = new Date();
  fixture.database
    .insert(exerciseDefinitions)
    .values({ ...values, createdAt: now, updatedAt: now })
    .run();
};

const readExerciseDefinition = (fixture: InMemoryDatabaseFixture, id: string) =>
  fixture.database
    .select()
    .from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.id, id))
    .get();

describe('bundle-migration runtime loop', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    __resetClockForTests();
  });

  afterEach(() => {
    __setBundleMigrationsForTests(null);
    __setCurrentAppVersionForTests(null);
    fixture.close();
  });

  it('ships the load-mode, bodyweight and muscle migrations in order', () => {
    expect(BUNDLE_MIGRATIONS.map(migration => migration.appVersion)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  describe('shipped migration behaviour', () => {
    it.each([
      {
        id: 'back_upper', displayName: 'Upper Back (Rhomboids + Mid Traps)',
        familyName: 'Back', renamed: 'Upper back', fromVersion: 4,
      },
      {
        id: 'chest', displayName: 'Chest', familyName: 'Chest',
        renamed: 'Pectoralis', fromVersion: 5,
      },
      {
        id: 'forearms_grip', displayName: 'Forearms / Grip', familyName: 'Arms',
        renamed: 'Forearms', fromVersion: 6,
      },
      {
        id: 'abs_rectus', displayName: 'Abs (Rectus Abdominis)', familyName: 'Core',
        renamed: 'Abs', fromVersion: 6,
      },
      {
        id: 'hip_abductors', displayName: 'Hip Abductors (Glute Med/Min)', familyName: 'Legs',
        renamed: 'Hip Abductors', fromVersion: 6,
      },
    ])('renames $id for sync and is idempotent on repeat upgrades', ({
      id, displayName, familyName, renamed, fromVersion,
    }) => {
      fixture.database.insert(muscleGroups).values({
        id,
        displayName,
        familyName,
        sortOrder: 5,
        localDirty: false,
        localUpdatedAtMs: 123,
      }).run();
      const before = fixture.database.select().from(muscleGroups).get();
      setMarker(fixture, fromVersion);

      runBundleMigrations(asLocalDatabase(fixture));

      const after = fixture.database.select().from(muscleGroups).get();
      expect(after).toEqual({
        ...before,
        displayName: renamed,
        updatedAt: expect.any(Date),
        localDirty: true,
        localUpdatedAtMs: expect.any(Number),
      });
      expect(after?.localUpdatedAtMs).toBeGreaterThan(123);
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);

      setMarker(fixture, fromVersion);
      runBundleMigrations(asLocalDatabase(fixture));

      expect(fixture.database.select().from(muscleGroups).all()).toEqual([after]);
    });

    it.each([
      { id: 'back_upper', displayName: 'My upper back', familyName: 'Back', deletedAt: null },
      { id: 'back_upper', displayName: 'Upper back', familyName: 'Back', deletedAt: null },
      {
        id: 'back_upper',
        displayName: 'Upper Back (Rhomboids + Mid Traps)',
        familyName: 'Back',
        deletedAt: new Date('2026-10-01T12:00:00.000Z'),
      },
      {
        id: 'custom_upper_back', displayName: 'Upper Back (Rhomboids + Mid Traps)',
        familyName: 'Back', deletedAt: null,
      },
      { id: 'chest', displayName: 'My chest', familyName: 'Chest', deletedAt: null },
      { id: 'chest', displayName: 'Pectoralis', familyName: 'Chest', deletedAt: null },
      {
        id: 'chest', displayName: 'Chest', familyName: 'Chest',
        deletedAt: new Date('2026-10-01T12:00:00.000Z'),
      },
      { id: 'custom_chest', displayName: 'Chest', familyName: 'Chest', deletedAt: null },
      ...[
        { id: 'forearms_grip', displayName: 'Forearms / Grip', renamed: 'Forearms', familyName: 'Arms' },
        { id: 'abs_rectus', displayName: 'Abs (Rectus Abdominis)', renamed: 'Abs', familyName: 'Core' },
        { id: 'hip_abductors', displayName: 'Hip Abductors (Glute Med/Min)', renamed: 'Hip Abductors', familyName: 'Legs' },
      ].flatMap(({ id, displayName, renamed, familyName }) => [
        { id, displayName: `My ${renamed}`, familyName, deletedAt: null },
        { id, displayName: renamed, familyName, deletedAt: null },
        { id, displayName, familyName, deletedAt: new Date('2026-10-01T12:00:00.000Z') },
        { id: `custom_${id}`, displayName, familyName, deletedAt: null },
      ]),
    ])('preserves $id named $displayName with deletedAt=$deletedAt', (muscle) => {
      fixture.database.insert(muscleGroups).values({
        ...muscle,
        localDirty: false,
        localUpdatedAtMs: 123,
      }).run();
      const before = fixture.database.select().from(muscleGroups).all();
      setMarker(fixture, 4);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(fixture.database.select().from(muscleGroups).all()).toEqual(before);
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('advances a never-seeded marker (0) up to the current generation', () => {
      // A returning account whose first pull restored server rows: the seeder
      // no-op'd so the marker is still 0. The loop must carry it to current so a
      // future migration keyed to a generation already passed never re-runs.
      setMarker(fixture, 0);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('is a no-op when the marker already matches the current generation', () => {
      setMarker(fixture, CURRENT_APP_VERSION);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('does not recreate absent exercise definitions during upgrades', () => {
      setMarker(fixture, 0);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(fixture.database.select().from(exerciseDefinitions).all()).toHaveLength(0);
    });

    it('does not recreate absent muscles when shortening names', () => {
      setMarker(fixture, 6);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(fixture.database.select().from(muscleGroups).all()).toEqual([]);
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('backfills a per-side starter row, dirties it, and advances the marker atomically', () => {
      fixture.database
        .insert(exerciseDefinitions)
        .values({ id: 'seed_dumbbell_bench_press', name: 'Dumbbell Bench Press' })
        .run();
      setMarker(fixture, 1);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(readExerciseDefinition(fixture, 'seed_dumbbell_bench_press')).toMatchObject({
        loadInputMode: 'per_side_load',
        localDirty: true,
      });
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('adds the new muscles to an older catalog once and marks them for sync', () => {
      setMarker(fixture, 3);

      runBundleMigrations(asLocalDatabase(fixture));

      const rows = fixture.database.select().from(muscleGroups).all();
      expect(rows.map((row) => row.id).sort()).toEqual([
        'brachialis', 'hip_flexors', 'rotator_cuff', 'serratus_anterior', 'tibialis_anterior', 'traps_lower',
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({ isEditable: 0, localDirty: true });
        expect(row.localUpdatedAtMs).toBeGreaterThan(0);
      }
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);

      setMarker(fixture, 3);
      runBundleMigrations(asLocalDatabase(fixture));

      expect(fixture.database.select().from(muscleGroups).all()).toEqual(rows);
    });

    it.each([null, new Date('2026-10-01T12:00:00.000Z')])(
      'preserves an existing Tibialis Anterior row, including deletedAt=%s',
      (deletedAt) => {
        fixture.database.insert(muscleGroups).values({
          id: 'tibialis_anterior',
          displayName: 'My Tibialis',
          familyName: 'Custom',
          sortOrder: 42,
          deletedAt,
          localDirty: false,
          localUpdatedAtMs: 123,
        }).run();
        const before = fixture.database.select().from(muscleGroups)
          .where(eq(muscleGroups.id, 'tibialis_anterior')).get();
        setMarker(fixture, 3);

        runBundleMigrations(asLocalDatabase(fixture));

        expect(fixture.database.select().from(muscleGroups)
          .where(eq(muscleGroups.id, 'tibialis_anterior')).get()).toEqual(before);
        expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
      }
    );
  });

  describe('short-circuit when the marker already meets or exceeds current', () => {
    it('returns immediately without running a higher-versioned migration', () => {
      const applied: number[] = [];
      __setBundleMigrationsForTests([
        {
          appVersion: CURRENT_APP_VERSION + 5,
          apply() {
            applied.push(CURRENT_APP_VERSION + 5);
          },
        },
      ]);
      // Marker already at current: every declared migration is for a later
      // generation this build does not ship yet, so the loop must do nothing.
      setMarker(fixture, CURRENT_APP_VERSION);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(applied).toEqual([]);
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION);
    });

    it('returns immediately when the marker is already past current', () => {
      const applied: number[] = [];
      __setBundleMigrationsForTests([
        {
          appVersion: CURRENT_APP_VERSION + 1,
          apply() {
            applied.push(CURRENT_APP_VERSION + 1);
          },
        },
      ]);
      setMarker(fixture, CURRENT_APP_VERSION + 10);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(applied).toEqual([]);
      // The loop never lowers a marker that is already ahead.
      expect(readMarker(fixture)).toBe(CURRENT_APP_VERSION + 10);
    });
  });

  describe('fixture migration list', () => {
    // Simulate a future build whose current generation is 3, so the fixture
    // migrations keyed to generations 2 and 3 fall inside the loop's
    // `(applied, current]` window (the first ship's real current generation is
    // 1, which would exclude them).
    beforeEach(() => {
      __setCurrentAppVersionForTests(3);
    });

    // A fixture that revises a known seed name (idempotent: only fires while the
    // row still holds the prior name) and inserts a new seed (idempotent: only
    // when absent). Generations climb above the starting marker.
    const FROM_NAME = 'Old Bench Press';
    const TO_NAME = 'Bench Press';
    const REVISED_ID = 'seed_bench_press';
    const NEW_SEED_ID = 'seed_incline_press';

    const makeMigrations = (
      onApply?: (version: number) => void
    ): BundleMigration[] => [
      {
        appVersion: 2,
        apply(repo: BundleMigrationRepo) {
          onApply?.(2);
          repo.reviseExerciseDefinitionName(REVISED_ID, FROM_NAME, TO_NAME);
        },
      },
      {
        appVersion: 3,
        apply(repo: BundleMigrationRepo) {
          onApply?.(3);
          repo.insertExerciseDefinitionIfAbsent({ id: NEW_SEED_ID, name: 'Incline Press' });
        },
      },
    ];

    it('applies pending migrations in ascending generation order', () => {
      const order: number[] = [];
      __setBundleMigrationsForTests(makeMigrations((v) => order.push(v)).reverse());
      // Declared out of order above; the loop must still run 2 before 3.
      insertExerciseDefinition(fixture, { id: REVISED_ID, name: FROM_NAME });
      setMarker(fixture, 1);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(order).toEqual([2, 3]);
      expect(readExerciseDefinition(fixture, REVISED_ID)?.name).toBe(TO_NAME);
      expect(readExerciseDefinition(fixture, NEW_SEED_ID)?.name).toBe('Incline Press');
    });

    it('advances the marker one generation per applied migration', () => {
      const markerAtEachStep: number[] = [];
      __setBundleMigrationsForTests(
        makeMigrations().map((migration) => ({
          ...migration,
          apply(repo: BundleMigrationRepo) {
            // The marker reflects the PREVIOUS migration's commit when this one
            // starts, proving each ran in its own committed transaction.
            markerAtEachStep.push(readMarker(fixture));
            migration.apply(repo);
          },
        }))
      );
      insertExerciseDefinition(fixture, { id: REVISED_ID, name: FROM_NAME });
      setMarker(fixture, 1);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(markerAtEachStep).toEqual([1, 2]);
      expect(readMarker(fixture)).toBe(3);
    });

    it('routes migrated rows through the dirty path so they push next cycle', () => {
      __setBundleMigrationsForTests(makeMigrations());
      insertExerciseDefinition(fixture, { id: REVISED_ID, name: FROM_NAME });
      // The pre-existing row starts clean (as if pulled / previously pushed).
      fixture.database
        .update(exerciseDefinitions)
        .set({ localDirty: false, localUpdatedAtMs: 0 })
        .where(eq(exerciseDefinitions.id, REVISED_ID))
        .run();
      setMarker(fixture, 1);

      runBundleMigrations(asLocalDatabase(fixture));

      const revised = readExerciseDefinition(fixture, REVISED_ID);
      const inserted = readExerciseDefinition(fixture, NEW_SEED_ID);
      expect(revised?.localDirty).toBe(true);
      expect((revised?.localUpdatedAtMs ?? 0) as number).toBeGreaterThan(0);
      expect(inserted?.localDirty).toBe(true);
      expect((inserted?.localUpdatedAtMs ?? 0) as number).toBeGreaterThan(0);
    });

    it('is idempotent on re-run: a second pass changes nothing', () => {
      __setBundleMigrationsForTests(makeMigrations());
      insertExerciseDefinition(fixture, { id: REVISED_ID, name: FROM_NAME });
      setMarker(fixture, 1);

      runBundleMigrations(asLocalDatabase(fixture));

      const afterFirst = {
        revisedName: readExerciseDefinition(fixture, REVISED_ID)?.name,
        revisedStamp: readExerciseDefinition(fixture, REVISED_ID)?.localUpdatedAtMs,
        insertedStamp: readExerciseDefinition(fixture, NEW_SEED_ID)?.localUpdatedAtMs,
        marker: readMarker(fixture),
        rowCount: fixture.database.select().from(exerciseDefinitions).all().length,
      };

      // Re-running the cycle re-enters the loop. The marker is at 3, so the loop
      // short-circuits and touches nothing. To prove per-migration idempotency
      // even if the loop did re-enter the apply()s, force the marker back and run
      // again — the predicates must make every write a no-op.
      setMarker(fixture, 1);
      runBundleMigrations(asLocalDatabase(fixture));

      const revised = readExerciseDefinition(fixture, REVISED_ID);
      const inserted = readExerciseDefinition(fixture, NEW_SEED_ID);
      // Name already revised → predicate skips it, stamp unchanged.
      expect(revised?.name).toBe(afterFirst.revisedName);
      expect(revised?.localUpdatedAtMs).toBe(afterFirst.revisedStamp);
      // Seed already present → insert-if-absent skips it, no duplicate row.
      expect(inserted?.localUpdatedAtMs).toBe(afterFirst.insertedStamp);
      expect(fixture.database.select().from(exerciseDefinitions).all()).toHaveLength(
        afterFirst.rowCount
      );
      expect(readMarker(fixture)).toBe(3);
    });

    it('resumes from the last committed generation after a mid-loop failure', () => {
      const committedMarkers: number[] = [];
      const unsubscribe = subscribeToExerciseCatalogInvalidation(() => {
        committedMarkers.push(readMarker(fixture));
      });
      const boom = new Error('simulated migration failure');
      const firstAttempt = [
        {
          appVersion: 2,
          apply(repo: BundleMigrationRepo) {
            repo.reviseExerciseDefinitionName(REVISED_ID, FROM_NAME, TO_NAME);
          },
        },
        {
          appVersion: 3,
          apply() {
            // Generation 3 throws AFTER generation 2 has committed.
            throw boom;
          },
        },
      ];
      __setBundleMigrationsForTests(firstAttempt);
      insertExerciseDefinition(fixture, { id: REVISED_ID, name: FROM_NAME });
      setMarker(fixture, 1);

      expect(() => runBundleMigrations(asLocalDatabase(fixture))).toThrow(boom);
      unsubscribe();
      expect(committedMarkers).toEqual([2]);

      // Generation 2 committed (its own transaction); generation 3 rolled back.
      expect(readMarker(fixture)).toBe(2);
      expect(readExerciseDefinition(fixture, REVISED_ID)?.name).toBe(TO_NAME);
      expect(readExerciseDefinition(fixture, NEW_SEED_ID)).toBeUndefined();

      // Next launch: generation 3 now succeeds. The loop resumes from 2, never
      // re-running the already-committed generation 2.
      const generation2Reruns: number[] = [];
      __setBundleMigrationsForTests([
        {
          appVersion: 2,
          apply() {
            generation2Reruns.push(2);
          },
        },
        {
          appVersion: 3,
          apply(repo: BundleMigrationRepo) {
            repo.insertExerciseDefinitionIfAbsent({ id: NEW_SEED_ID, name: 'Incline Press' });
          },
        },
      ]);

      runBundleMigrations(asLocalDatabase(fixture));

      expect(generation2Reruns).toEqual([]);
      expect(readMarker(fixture)).toBe(3);
      expect(readExerciseDefinition(fixture, NEW_SEED_ID)?.name).toBe('Incline Press');
    });

    it('rolls back the marker advance with the migration when its transaction throws', () => {
      const invalidated = jest.fn();
      const unsubscribe = subscribeToExerciseCatalogInvalidation(invalidated);
      __setBundleMigrationsForTests([
        {
          appVersion: 2,
          apply(repo: BundleMigrationRepo) {
            repo.insertExerciseDefinitionIfAbsent({ id: NEW_SEED_ID, name: 'Incline Press' });
            throw new Error('fail after write, before commit');
          },
        },
      ]);
      setMarker(fixture, 1);

      expect(() => runBundleMigrations(asLocalDatabase(fixture))).toThrow();
      unsubscribe();
      expect(invalidated).not.toHaveBeenCalled();

      // The whole transaction rolled back: neither the row write nor the marker
      // advance survived.
      expect(readMarker(fixture)).toBe(1);
      expect(readExerciseDefinition(fixture, NEW_SEED_ID)).toBeUndefined();
    });

    it('skips a migration whose generation is above the current generation', () => {
      // This build's current generation is 3; a migration keyed to 4 is for a
      // later build and must not run yet.
      const applied: number[] = [];
      __setBundleMigrationsForTests([
        {
          appVersion: 3,
          apply() {
            applied.push(3);
          },
        },
        {
          appVersion: 4,
          apply() {
            applied.push(4);
          },
        },
      ]);
      setMarker(fixture, 2);

      runBundleMigrations(asLocalDatabase(fixture));

      // Only the migration at-or-below the current generation (3) runs; the
      // generation-4 one waits until a build that ships it bumps current.
      expect(applied).toEqual([3]);
      expect(readMarker(fixture)).toBe(3);
    });
  });
});
