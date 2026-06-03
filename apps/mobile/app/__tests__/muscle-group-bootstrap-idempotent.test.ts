/**
 * Idempotent muscle-group bootstrap.
 *
 * `muscle_groups` is a client-only, non-syncable taxonomy: it is seeded on
 * every launch directly from the bundle and never crosses the sync wire. The
 * seed routine inserts any bundle row whose id is not already present locally
 * and leaves every existing row untouched (ids are the join key). This lets a
 * group added to the bundle in a later app version reach a device that has
 * already been seeded, without overwriting or duplicating existing rows.
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema applied, via the shared `helpers/in-memory-db` fixture — so the real
 * `muscle_groups` CHECK constraints (including the non-editable guard) are
 * exercised end to end.
 */

import {
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedMuscleGroups,
} from '@/src/data/exercise-catalog-seeds';
import { muscleGroups } from '@/src/data/schema';
import type { LocalDatabase } from '@/src/data/bootstrap';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

const readAllRows = (fixture: InMemoryDatabaseFixture) =>
  fixture.database.select().from(muscleGroups).all();

const readRowById = (fixture: InMemoryDatabaseFixture, id: string) =>
  readAllRows(fixture).find((row) => row.id === id);

// `seedMuscleGroups` is typed against the production expo-sqlite handle; the
// in-memory better-sqlite3 handle is structurally identical (both extend the
// same drizzle sync base), so this cast is a type-only bridge.
const seed = (fixture: InMemoryDatabaseFixture, now?: Date) =>
  seedMuscleGroups(fixture.database as unknown as LocalDatabase, now);

describe('muscle-group bootstrap (insert-if-not-exists by id)', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
  });

  afterEach(() => {
    fixture.close();
  });

  it('seeds the full bundle into a fresh table', () => {
    seed(fixture);

    const rows = readAllRows(fixture);
    expect(rows).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);

    const seededIds = new Set(rows.map((row) => row.id));
    for (const bundleRow of SYSTEM_MUSCLE_GROUP_SEEDS) {
      expect(seededIds.has(bundleRow.id)).toBe(true);
    }
  });

  it('gains exactly the one missing id when a single bundle row is absent', () => {
    // Pre-seed every bundle row except the first, simulating a device seeded by
    // an earlier app version whose bundle lacked one group.
    const [missingGroup, ...alreadyPresent] = SYSTEM_MUSCLE_GROUP_SEEDS;
    const now = new Date('2026-01-01T00:00:00.000Z');
    for (const group of alreadyPresent) {
      fixture.database
        .insert(muscleGroups)
        .values({ ...group, createdAt: now, updatedAt: now })
        .run();
    }
    expect(readAllRows(fixture)).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length - 1);
    expect(readRowById(fixture, missingGroup.id)).toBeUndefined();

    seed(fixture);

    const rows = readAllRows(fixture);
    expect(rows).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(readRowById(fixture, missingGroup.id)).toBeDefined();
  });

  it('is a no-op on a fully-seeded table (no duplicates, no row count change)', () => {
    seed(fixture);
    const afterFirst = readAllRows(fixture);
    expect(afterFirst).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);

    seed(fixture);
    const afterSecond = readAllRows(fixture);

    expect(afterSecond).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    // No id appears more than once — ids are the join key.
    const ids = afterSecond.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not overwrite a pre-existing row that shares a bundle id', () => {
    const bundleRow = SYSTEM_MUSCLE_GROUP_SEEDS[0];
    const customDisplayName = `Custom ${bundleRow.displayName}`;
    const preExistingCreatedAt = new Date('2025-12-01T00:00:00.000Z');

    // A row already present under a bundle id, but with a locally-divergent
    // display name and timestamps.
    fixture.database
      .insert(muscleGroups)
      .values({
        ...bundleRow,
        displayName: customDisplayName,
        createdAt: preExistingCreatedAt,
        updatedAt: preExistingCreatedAt,
      })
      .run();

    seed(fixture, new Date('2026-06-01T00:00:00.000Z'));

    const row = readRowById(fixture, bundleRow.id);
    expect(row).toBeDefined();
    // The seed routine left the divergent fields exactly as they were.
    expect(row?.displayName).toBe(customDisplayName);
    expect(row?.createdAt?.getTime()).toBe(preExistingCreatedAt.getTime());
    expect(row?.updatedAt?.getTime()).toBe(preExistingCreatedAt.getTime());
    // The rest of the bundle still seeded around the untouched row.
    expect(readAllRows(fixture)).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);
  });

  it('seeds every row with the non-editable flag set to 0', () => {
    seed(fixture);

    for (const row of readAllRows(fixture)) {
      expect(row.isEditable).toBe(0);
    }
  });
});
