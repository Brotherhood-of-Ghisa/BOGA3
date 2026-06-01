/**
 * Soft-delete behaviour for the converted user-delete paths.
 *
 * Each path that used to hard-delete a syncable row now tombstones it instead:
 * the row stays in the table with `deleted_at` set and `local_dirty = 1`, so it
 * pushes to the server as a deletion and survives a reinstall, while the
 * default reader filters it out (`deleted_at IS NULL`). Paths covered:
 *   - removing a tag attachment (`session_exercise_tags`);
 *   - re-saving an exercise with a muscle link dropped
 *     (`exercise_muscle_mappings`).
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema applied, via the shared `helpers/in-memory-db` fixture.
 * `bootstrapLocalDataLayer` is mocked to hand the repos this in-memory drizzle
 * instance so the real write/read paths execute end-to-end.
 */

import { and, eq } from 'drizzle-orm';

import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseTagDefinitions,
  muscleGroups,
  sessionExercises,
  sessionExerciseTags,
  sessions,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

type TestDatabase = InMemoryTestDatabase;

let mockActiveDatabase: TestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) {
      throw new Error('test database not initialised');
    }
    return mockActiveDatabase;
  }),
}));

// Imported AFTER the mock so the repos pick up the mocked bootstrap.
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { createDrizzleExerciseCatalogStore } from '@/src/data/exercise-catalog';
import { __resetClockForTests } from '@/src/data/clock';

const EXERCISE_DEFINITION_ID = 'exercise-def-1';
const SESSION_ID = 'session-1';
const SESSION_EXERCISE_ID = 'session-exercise-1';
const TAG_DEFINITION_ID = 'tag-def-1';

const seedTagFixture = (database: TestDatabase): void => {
  database
    .insert(exerciseDefinitions)
    .values({ id: EXERCISE_DEFINITION_ID, name: 'Bench Press' })
    .run();
  database
    .insert(sessions)
    .values({
      id: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
    })
    .run();
  database
    .insert(sessionExercises)
    .values({
      id: SESSION_EXERCISE_ID,
      sessionId: SESSION_ID,
      exerciseDefinitionId: EXERCISE_DEFINITION_ID,
      orderIndex: 0,
      name: 'Bench Press',
    })
    .run();
  database
    .insert(exerciseTagDefinitions)
    .values({
      id: TAG_DEFINITION_ID,
      exerciseDefinitionId: EXERCISE_DEFINITION_ID,
      name: 'Wide Grip',
      normalizedName: 'wide grip',
    })
    .run();
  database
    .insert(sessionExerciseTags)
    .values({
      id: 'assignment-1',
      sessionExerciseId: SESSION_EXERCISE_ID,
      exerciseTagDefinitionId: TAG_DEFINITION_ID,
    })
    .run();
};

const seedMuscleGroups = (database: TestDatabase): void => {
  database
    .insert(muscleGroups)
    .values([
      { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0, isEditable: 0 },
      { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1, isEditable: 0 },
    ])
    .run();
};

const readTagRow = (database: TestDatabase, assignmentId: string) =>
  database.select().from(sessionExerciseTags).where(eq(sessionExerciseTags.id, assignmentId)).get();

const readMappingRows = (database: TestDatabase) =>
  database
    .select()
    .from(exerciseMuscleMappings)
    .where(eq(exerciseMuscleMappings.exerciseDefinitionId, EXERCISE_DEFINITION_ID))
    .all();

const readAllTagRowsForPair = (database: TestDatabase) =>
  database
    .select()
    .from(sessionExerciseTags)
    .where(
      and(
        eq(sessionExerciseTags.sessionExerciseId, SESSION_EXERCISE_ID),
        eq(sessionExerciseTags.exerciseTagDefinitionId, TAG_DEFINITION_ID)
      )
    )
    .all();

beforeEach(() => {
  __resetClockForTests();
});

describe('soft-delete: removing a tag attachment', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    mockActiveDatabase = fixture.database;
    seedTagFixture(fixture.database);
  });

  afterEach(() => {
    mockActiveDatabase = null;
    fixture.close();
  });

  it('tombstones the attachment, marks it dirty, and hides it from the reader', async () => {
    const store = createDrizzleExerciseTagStore();
    const now = new Date('2026-05-31T12:00:00.000Z');

    await store.removeTagAssignment({
      sessionExerciseId: SESSION_EXERCISE_ID,
      tagDefinitionId: TAG_DEFINITION_ID,
      now,
    });

    const row = readTagRow(fixture.database, 'assignment-1');
    // The row is tombstoned, not removed.
    expect(row).toBeDefined();
    expect(row?.deletedAt).toEqual(now);
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs).toBeGreaterThan(0);

    // The default reader hides the tombstoned attachment.
    const assigned = await store.listAssignedTags({ sessionExerciseId: SESSION_EXERCISE_ID });
    expect(assigned).toEqual([]);
  });

  it('revives the same attachment row on re-attach instead of colliding on the unique pair', async () => {
    const store = createDrizzleExerciseTagStore();

    await store.removeTagAssignment({
      sessionExerciseId: SESSION_EXERCISE_ID,
      tagDefinitionId: TAG_DEFINITION_ID,
      now: new Date('2026-05-31T12:00:00.000Z'),
    });

    await store.createTagAssignment({
      sessionExerciseId: SESSION_EXERCISE_ID,
      tagDefinitionId: TAG_DEFINITION_ID,
      now: new Date('2026-05-31T13:00:00.000Z'),
    });

    // Exactly one row for the pair (the tombstone was revived, not duplicated).
    const allRows = readAllTagRowsForPair(fixture.database);
    expect(allRows).toHaveLength(1);
    expect(allRows[0].deletedAt).toBeNull();
    expect(allRows[0].localDirty).toBe(true);

    const assigned = await store.listAssignedTags({ sessionExerciseId: SESSION_EXERCISE_ID });
    expect(assigned).toHaveLength(1);
  });
});

describe('soft-delete: dropping a muscle link on re-save', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    mockActiveDatabase = fixture.database;
    seedMuscleGroups(fixture.database);
  });

  afterEach(() => {
    mockActiveDatabase = null;
    fixture.close();
  });

  it('tombstones the removed link, keeps the kept link, and hides the tombstone from the reader', async () => {
    const store = createDrizzleExerciseCatalogStore();

    const created = await store.saveExercise({
      id: EXERCISE_DEFINITION_ID,
      name: 'Bench Press',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
      now: new Date('2026-05-30T10:00:00.000Z'),
    });
    expect(created.mappings).toHaveLength(2);

    // Re-save dropping the triceps link.
    const resaved = await store.saveExercise({
      id: EXERCISE_DEFINITION_ID,
      name: 'Bench Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-31T10:00:00.000Z'),
    });

    // The reader returns only the live link.
    expect(resaved.mappings).toHaveLength(1);
    expect(resaved.mappings[0].muscleGroupId).toBe('chest');

    const rows = readMappingRows(fixture.database);
    const chest = rows.find((row) => row.muscleGroupId === 'chest');
    const triceps = rows.find((row) => row.muscleGroupId === 'triceps');

    // The dropped link is tombstoned (not removed) and dirty.
    expect(triceps).toBeDefined();
    expect(triceps?.deletedAt).not.toBeNull();
    expect(triceps?.localDirty).toBe(true);

    // The kept link stays live.
    expect(chest?.deletedAt).toBeNull();
  });

  it('revives a previously-dropped link on re-add instead of colliding on the unique pair', async () => {
    const store = createDrizzleExerciseCatalogStore();

    await store.saveExercise({
      id: EXERCISE_DEFINITION_ID,
      name: 'Bench Press',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
      now: new Date('2026-05-30T10:00:00.000Z'),
    });

    // Drop triceps...
    await store.saveExercise({
      id: EXERCISE_DEFINITION_ID,
      name: 'Bench Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-31T10:00:00.000Z'),
    });

    // ...then re-add it with a new weight.
    const readded = await store.saveExercise({
      id: EXERCISE_DEFINITION_ID,
      name: 'Bench Press',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.7, role: 'secondary' },
      ],
      now: new Date('2026-06-01T10:00:00.000Z'),
    });

    expect(readded.mappings).toHaveLength(2);
    const triceps = readded.mappings.find((mapping) => mapping.muscleGroupId === 'triceps');
    expect(triceps?.weight).toBe(0.7);

    // Exactly one DB row for the (exercise, triceps) pair — the tombstone was
    // revived, not duplicated (the unique pair index holds).
    const tricepsRows = readMappingRows(fixture.database).filter((row) => row.muscleGroupId === 'triceps');
    expect(tricepsRows).toHaveLength(1);
    expect(tricepsRows[0].deletedAt).toBeNull();
  });
});
