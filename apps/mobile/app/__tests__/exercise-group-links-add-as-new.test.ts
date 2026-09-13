/* eslint-disable import/first */

/**
 * Outcome (M25-T07 AC1): "Add as new" writes a personal exercise, its muscle
 * links, and its group link in ONE local transaction, with one write nudge. A
 * failure in either write leaves neither row. `linkExercise` keeps its T03
 * behaviour (covered by exercise-group-links-repository.test.ts).
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle (FK
 * enforcement on). Failures are forced with SQLite `RAISE(ABORT)` triggers, so
 * they happen inside the real transaction.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

const mockNotifyLocalWrite = jest.fn();
jest.mock('@/src/sync/write-nudge', () => ({
  notifyLocalWrite: () => mockNotifyLocalWrite(),
}));

import { __resetClockForTests } from '@/src/data/clock';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { exerciseDefinitions, exerciseGroupLinks, exerciseMuscleMappings, muscleGroups } from '@/src/data/schema';
import {
  __resetExerciseCatalogInvalidationForTests,
  subscribeToExerciseCatalogInvalidation,
} from '@/src/exercise-catalog/invalidation';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const T0 = new Date('2026-09-13T10:00:00.000Z');

const INPUT = {
  name: '  Bench (hotel gym) ',
  loadInputMode: 'per_side_load' as const,
  mappings: [
    { muscleGroupId: 'chest', weight: 1, role: 'primary' as const },
    { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' as const },
  ],
  now: T0,
};

const LINK = { groupId: 'grp-1', groupExerciseId: 'gx-bench' };

beforeEach(() => {
  __resetClockForTests();
  __resetExerciseCatalogInvalidationForTests();
  mockNotifyLocalWrite.mockClear();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db().insert(muscleGroups).values({ id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 }).run();
  db().insert(muscleGroups).values({ id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 }).run();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('createExerciseWithGroupLink', () => {
  it('writes the definition, its mappings, and the link, all dirty, with one nudge and a catalogue invalidation', async () => {
    const invalidations = jest.fn();
    subscribeToExerciseCatalogInvalidation(invalidations);

    const { exercise, link } = await createExerciseWithGroupLink(INPUT, LINK);

    expect(exercise).toMatchObject({ name: 'Bench (hotel gym)', loadInputMode: 'per_side_load', deletedAt: null });
    expect(exercise.mappings.map((mapping) => mapping.muscleGroupId)).toEqual(['chest', 'triceps']);
    expect(link).toMatchObject({
      id: `grp-1:${exercise.id}`,
      exerciseDefinitionId: exercise.id,
      groupId: 'grp-1',
      groupExerciseId: 'gx-bench',
      createdAt: T0,
    });

    const definition = db().select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, exercise.id)).get();
    expect(definition?.localDirty).toBe(true);
    const mappings = db()
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.exerciseDefinitionId, exercise.id))
      .all();
    expect(mappings).toHaveLength(2);
    expect(mappings.every((mapping) => mapping.localDirty)).toBe(true);
    const linkRow = db().select().from(exerciseGroupLinks).where(eq(exerciseGroupLinks.id, link.id)).get();
    expect(linkRow?.localDirty).toBe(true);
    expect(linkRow?.deletedAt).toBeNull();

    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
    expect(invalidations).toHaveBeenCalledTimes(1);
  });

  it('a failure in the link write leaves no definition, mapping, or link row', async () => {
    fixture.client.exec(
      `CREATE TRIGGER t07_fail_link BEFORE INSERT ON exercise_group_links BEGIN SELECT RAISE(ABORT, 'forced link failure'); END;`,
    );

    await expect(createExerciseWithGroupLink(INPUT, LINK)).rejects.toMatchObject({
      message: expect.stringMatching(/forced link failure/),
    });

    expect(db().select().from(exerciseDefinitions).all()).toHaveLength(0);
    expect(db().select().from(exerciseMuscleMappings).all()).toHaveLength(0);
    expect(db().select().from(exerciseGroupLinks).all()).toHaveLength(0);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('a failure in the exercise write leaves no link row', async () => {
    fixture.client.exec(
      `CREATE TRIGGER t07_fail_mapping BEFORE INSERT ON exercise_muscle_mappings BEGIN SELECT RAISE(ABORT, 'forced exercise failure'); END;`,
    );

    await expect(createExerciseWithGroupLink(INPUT, LINK)).rejects.toMatchObject({
      message: expect.stringMatching(/forced exercise failure/),
    });

    expect(db().select().from(exerciseDefinitions).all()).toHaveLength(0);
    expect(db().select().from(exerciseGroupLinks).all()).toHaveLength(0);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('validates like saveExercise before writing anything', async () => {
    await expect(createExerciseWithGroupLink({ ...INPUT, name: '   ' }, LINK)).rejects.toThrow('Exercise name is required');
    await expect(createExerciseWithGroupLink({ ...INPUT, mappings: [] }, LINK)).rejects.toThrow(
      'At least one muscle link is required',
    );
    await expect(
      createExerciseWithGroupLink({ ...INPUT, mappings: [{ muscleGroupId: 'nope', weight: 1 }] }, LINK),
    ).rejects.toThrow('Unknown muscle group: nope');
    await expect(createExerciseWithGroupLink(INPUT, { groupId: ' ', groupExerciseId: 'gx' })).rejects.toThrow(
      'groupId is required',
    );

    expect(db().select().from(exerciseDefinitions).all()).toHaveLength(0);
    expect(db().select().from(exerciseGroupLinks).all()).toHaveLength(0);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });
});

describe('extracted writers keep existing behaviour', () => {
  it('saveExercise still writes through the shared graph writer', async () => {
    const saved = await saveExerciseCatalogExercise({ ...INPUT, id: 'def-1' });

    expect(saved).toMatchObject({ id: 'def-1', name: 'Bench (hotel gym)', loadInputMode: 'per_side_load' });
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('linkExercise wraps the transaction-scoped writer and nudges once per real write', async () => {
    db().insert(exerciseDefinitions).values({ id: 'def-bench', name: 'Bench Press' }).run();

    await linkExercise('def-bench', 'grp-1', 'gx-1', T0);
    await linkExercise('def-bench', 'grp-1', 'gx-1', T0);

    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });
});
