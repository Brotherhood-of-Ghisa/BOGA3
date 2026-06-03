/**
 * Reconcile-and-tombstone contract for the session-graph rebuild.
 *
 * Editing an in-progress session re-persists the whole exercise / set / tag
 * graph. Rows that drop out of the edit must NOT be hard-deleted — they become
 * tombstones (`deleted_at` set, dirty bit flipped) so the deletion pushes to
 * the server and survives a device reinstall. Surviving rows keep their primary
 * key and are repositioned in place; a re-added row revives its tombstone
 * rather than colliding with it. Throughout, the per-parent `order_index`
 * uniqueness and the primary-key invariants must hold against the real (NON
 * partial) local unique indexes.
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema and FK + unique-index enforcement on, so a broken reconcile (a PK
 * collision, an `order_index` clash, or a `< 0` order index) throws here
 * exactly as it would on device. `bootstrapLocalDataLayer` is mocked to hand
 * the store this in-memory instance so the real write path runs end to end.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  exerciseDefinitions,
  exerciseSets,
  exerciseTagDefinitions,
  sessionExercises,
  sessionExerciseTags,
  sessions,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let mockActiveDatabase: InMemoryTestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) {
      throw new Error('test database not initialised');
    }
    return mockActiveDatabase;
  }),
}));

// Imported AFTER the mock so the store picks up the mocked bootstrap.
import { createDrizzleSessionDraftStore } from '@/src/data/session-drafts';
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { __resetClockForTests } from '@/src/data/clock';

const SESSION_ID = 'session-reconcile';
const EXERCISE_DEFINITION_ID = 'def-bench';
const SECOND_EXERCISE_DEFINITION_ID = 'def-squat';
const TAG_DEFINITION_ID = 'tag-def-1';

const seedParents = (database: InMemoryTestDatabase): void => {
  database
    .insert(exerciseDefinitions)
    .values({ id: EXERCISE_DEFINITION_ID, name: 'Bench Press' })
    .run();
  database
    .insert(exerciseDefinitions)
    .values({ id: SECOND_EXERCISE_DEFINITION_ID, name: 'Back Squat' })
    .run();
  database
    .insert(exerciseTagDefinitions)
    .values({
      id: TAG_DEFINITION_ID,
      exerciseDefinitionId: EXERCISE_DEFINITION_ID,
      name: 'Top set',
      normalizedName: 'top set',
    })
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
};

const draftExercise = (
  overrides: Partial<{
    id: string;
    exerciseDefinitionId: string;
    name: string;
    sets: { id?: string; repsValue: string; weightValue: string }[];
  }> = {},
) => ({
  id: overrides.id,
  exerciseDefinitionId: overrides.exerciseDefinitionId ?? EXERCISE_DEFINITION_ID,
  name: overrides.name ?? 'Bench Press',
  sets: overrides.sets ?? [{ repsValue: '5', weightValue: '225' }],
});

const allExercises = (database: InMemoryTestDatabase) =>
  database
    .select({
      id: sessionExercises.id,
      orderIndex: sessionExercises.orderIndex,
      name: sessionExercises.name,
      deletedAt: sessionExercises.deletedAt,
      localDirty: sessionExercises.localDirty,
    })
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, SESSION_ID))
    .all();

const liveExercises = (database: InMemoryTestDatabase) =>
  database
    .select({ id: sessionExercises.id, orderIndex: sessionExercises.orderIndex, name: sessionExercises.name })
    .from(sessionExercises)
    .where(and(eq(sessionExercises.sessionId, SESSION_ID), isNull(sessionExercises.deletedAt)))
    .orderBy(asc(sessionExercises.orderIndex))
    .all();

const setsForExercise = (database: InMemoryTestDatabase, sessionExerciseId: string) =>
  database
    .select({
      id: exerciseSets.id,
      orderIndex: exerciseSets.orderIndex,
      repsValue: exerciseSets.repsValue,
      deletedAt: exerciseSets.deletedAt,
      localDirty: exerciseSets.localDirty,
    })
    .from(exerciseSets)
    .where(eq(exerciseSets.sessionExerciseId, sessionExerciseId))
    .all();

const liveSetsForExercise = (database: InMemoryTestDatabase, sessionExerciseId: string) =>
  setsForExercise(database, sessionExerciseId).filter((row) => row.deletedAt === null);

const tagFor = (database: InMemoryTestDatabase, sessionExerciseId: string) =>
  database
    .select({
      id: sessionExerciseTags.id,
      deletedAt: sessionExerciseTags.deletedAt,
      localDirty: sessionExerciseTags.localDirty,
    })
    .from(sessionExerciseTags)
    .where(
      and(
        eq(sessionExerciseTags.sessionExerciseId, sessionExerciseId),
        eq(sessionExerciseTags.exerciseTagDefinitionId, TAG_DEFINITION_ID),
      ),
    )
    .get();

const baseGraph = async (store: ReturnType<typeof createDrizzleSessionDraftStore>) =>
  store.saveDraftGraph({
    sessionId: SESSION_ID,
    gymId: null,
    status: 'active',
    startedAt: new Date('2026-05-30T10:00:00.000Z'),
    exercises: [
      draftExercise({
        id: 'exercise-keep',
        name: 'Bench Press',
        sets: [
          { id: 'set-keep', repsValue: '5', weightValue: '225' },
          { id: 'set-drop', repsValue: '4', weightValue: '230' },
        ],
      }),
      draftExercise({ id: 'exercise-drop', exerciseDefinitionId: SECOND_EXERCISE_DEFINITION_ID, name: 'Back Squat' }),
    ],
    now: new Date('2026-05-30T10:01:00.000Z'),
  });

describe('session-graph rebuild reconcile + tombstone', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    __resetClockForTests();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    mockActiveDatabase = fixture.database;
    seedParents(mockActiveDatabase);
  });

  afterEach(() => {
    __resetClockForTests();
    fixture.close();
    mockActiveDatabase = null;
  });

  it('tombstones a removed exercise (and its sets), keeps it dirty, and hides it from the default reader', async () => {
    const store = createDrizzleSessionDraftStore();
    await baseGraph(store);
    expect(liveExercises(mockActiveDatabase!)).toHaveLength(2);

    // Re-save without the dropped exercise.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({ id: 'exercise-keep', name: 'Bench Press', sets: [{ id: 'set-keep', repsValue: '5', weightValue: '225' }] }),
      ],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });

    const live = liveExercises(mockActiveDatabase!);
    expect(live.map((row) => row.id)).toEqual(['exercise-keep']);

    const dropped = allExercises(mockActiveDatabase!).find((row) => row.id === 'exercise-drop');
    expect(dropped).toBeDefined();
    expect(dropped?.deletedAt).not.toBeNull();
    expect(dropped?.localDirty).toBe(true);

    // The removed set on the surviving exercise is also a dirty tombstone.
    const droppedSet = setsForExercise(mockActiveDatabase!, 'exercise-keep').find((row) => row.id === 'set-drop');
    expect(droppedSet?.deletedAt).not.toBeNull();
    expect(droppedSet?.localDirty).toBe(true);
    expect(liveSetsForExercise(mockActiveDatabase!, 'exercise-keep').map((row) => row.id)).toEqual(['set-keep']);
  });

  it('re-adding a removed exercise revives its tombstone in place (same primary key, no collision)', async () => {
    const store = createDrizzleSessionDraftStore();
    await baseGraph(store);

    // Drop the second exercise.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise({ id: 'exercise-keep', name: 'Bench Press', sets: [{ id: 'set-keep', repsValue: '5', weightValue: '225' }] })],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });
    expect(allExercises(mockActiveDatabase!).find((row) => row.id === 'exercise-drop')?.deletedAt).not.toBeNull();

    // Re-add the same exercise id at position 0.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({ id: 'exercise-drop', exerciseDefinitionId: SECOND_EXERCISE_DEFINITION_ID, name: 'Back Squat' }),
        draftExercise({ id: 'exercise-keep', name: 'Bench Press', sets: [{ id: 'set-keep', repsValue: '5', weightValue: '225' }] }),
      ],
      now: new Date('2026-05-30T10:03:00.000Z'),
    });

    const revived = allExercises(mockActiveDatabase!).find((row) => row.id === 'exercise-drop');
    expect(revived?.deletedAt).toBeNull();
    expect(revived?.orderIndex).toBe(0);
    expect(revived?.localDirty).toBe(true);
    // Exactly one row carries that id — the tombstone was revived, not duplicated.
    expect(allExercises(mockActiveDatabase!).filter((row) => row.id === 'exercise-drop')).toHaveLength(1);
    expect(liveExercises(mockActiveDatabase!).map((row) => row.id)).toEqual(['exercise-drop', 'exercise-keep']);
  });

  it('tombstones and revives a session-exercise tag across a rebuild', async () => {
    const draftStore = createDrizzleSessionDraftStore();
    const tagStore = createDrizzleExerciseTagStore();
    await draftStore.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise({ id: 'exercise-keep', name: 'Bench Press' })],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });
    await tagStore.createTagAssignment({
      sessionExerciseId: 'exercise-keep',
      tagDefinitionId: TAG_DEFINITION_ID,
      now: new Date('2026-05-30T10:01:30.000Z'),
    });
    expect(tagFor(mockActiveDatabase!, 'exercise-keep')?.deletedAt).toBeNull();

    // Change the exercise definition on the same row id: the tag no longer
    // applies, so the rebuild must tombstone it.
    await draftStore.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({ id: 'exercise-keep', exerciseDefinitionId: SECOND_EXERCISE_DEFINITION_ID, name: 'Back Squat' }),
      ],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });
    const tombstoned = tagFor(mockActiveDatabase!, 'exercise-keep');
    expect(tombstoned?.deletedAt).not.toBeNull();
    expect(tombstoned?.localDirty).toBe(true);
    const tombstonedId = tombstoned?.id;

    // Re-attach via the tag repo: the unique slot is revived in place.
    await tagStore.createTagAssignment({
      sessionExerciseId: 'exercise-keep',
      tagDefinitionId: TAG_DEFINITION_ID,
      now: new Date('2026-05-30T10:03:00.000Z'),
    });
    const revived = tagFor(mockActiveDatabase!, 'exercise-keep');
    expect(revived?.id).toBe(tombstonedId);
    expect(revived?.deletedAt).toBeNull();
    expect(revived?.localDirty).toBe(true);
  });

  it('reorders survivors while a tombstone is parked, holding the unique (parent, order_index) invariant', async () => {
    const store = createDrizzleSessionDraftStore();
    // Three exercises at 0, 1, 2.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({ id: 'ex-a', name: 'A' }),
        draftExercise({ id: 'ex-b', exerciseDefinitionId: SECOND_EXERCISE_DEFINITION_ID, name: 'B' }),
        draftExercise({ id: 'ex-c', name: 'C' }),
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    // Drop the middle one AND swap the order of the survivors. The dropped
    // tombstone keeps occupying a slot; the survivors must still land at
    // 0 and 1 without a unique-index collision.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({ id: 'ex-c', name: 'C' }),
        draftExercise({ id: 'ex-a', name: 'A' }),
      ],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });

    const live = liveExercises(mockActiveDatabase!);
    expect(live.map((row) => row.id)).toEqual(['ex-c', 'ex-a']);
    expect(live.map((row) => row.orderIndex)).toEqual([0, 1]);

    const tombstone = allExercises(mockActiveDatabase!).find((row) => row.id === 'ex-b');
    expect(tombstone?.deletedAt).not.toBeNull();
    // Parked out of the live range, but still a valid non-negative index.
    expect(tombstone?.orderIndex).toBeGreaterThanOrEqual(0);
    expect(live.every((row) => row.orderIndex !== tombstone?.orderIndex)).toBe(true);
  });

  it('keeps the saved snapshot reader free of tombstoned rows after edits', async () => {
    const store = createDrizzleSessionDraftStore();
    await baseGraph(store);
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise({ id: 'exercise-keep', name: 'Bench Press', sets: [{ id: 'set-keep', repsValue: '5', weightValue: '225' }] })],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });

    const graph = await store.loadSessionGraphById(SESSION_ID);
    expect(graph?.exercises.map((exercise) => exercise.id)).toEqual(['exercise-keep']);
    expect(graph?.exercises[0]?.sets.map((set) => set.id)).toEqual(['set-keep']);
  });

  it('keeps a middle survivor while tombstoning multiple sibling sets without an order_index collision', async () => {
    const store = createDrizzleSessionDraftStore();
    // Four sets at order 0..3 under one exercise.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({
          id: 'ex-1',
          name: 'Bench Press',
          sets: [
            { id: 's0', repsValue: '5', weightValue: '225' },
            { id: 's1', repsValue: '5', weightValue: '230' },
            { id: 's2', repsValue: '5', weightValue: '235' },
            { id: 's3', repsValue: '5', weightValue: '240' },
          ],
        }),
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    // Keep only the middle set s2 (its original park slot collides with a
    // sibling tombstone unless the allocator dodges it) — must not throw on the
    // unique (session_exercise_id, order_index) index.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise({ id: 'ex-1', name: 'Bench Press', sets: [{ id: 's2', repsValue: '6', weightValue: '235' }] })],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });

    const live = liveSetsForExercise(mockActiveDatabase!, 'ex-1');
    expect(live.map((row) => row.id)).toEqual(['s2']);
    expect(live[0].orderIndex).toBe(0);

    const all = setsForExercise(mockActiveDatabase!, 'ex-1');
    const tombstones = all.filter((row) => row.deletedAt !== null);
    expect(tombstones.map((row) => row.id).sort()).toEqual(['s0', 's1', 's3']);
    expect(tombstones.every((row) => row.localDirty === true)).toBe(true);
    // Every order_index is unique and non-negative (the unique index + the
    // `>= 0` check both held through the rebuild).
    const indexes = all.map((row) => row.orderIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(indexes.every((value) => value >= 0)).toBe(true);
  });

  it('re-adds a dropped set after the survivor took its slot, reviving the tombstone in place', async () => {
    const store = createDrizzleSessionDraftStore();
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({
          id: 'ex-1',
          name: 'Bench Press',
          sets: [
            { id: 's0', repsValue: '5', weightValue: '225' },
            { id: 's1', repsValue: '5', weightValue: '230' },
          ],
        }),
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    // Drop s0 (so s1 keeps slot 0 elsewhere), then re-add s0 at the front.
    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise({ id: 'ex-1', name: 'Bench Press', sets: [{ id: 's1', repsValue: '5', weightValue: '230' }] })],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });
    expect(setsForExercise(mockActiveDatabase!, 'ex-1').find((row) => row.id === 's0')?.deletedAt).not.toBeNull();

    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        draftExercise({
          id: 'ex-1',
          name: 'Bench Press',
          sets: [
            { id: 's0', repsValue: '5', weightValue: '225' },
            { id: 's1', repsValue: '5', weightValue: '230' },
          ],
        }),
      ],
      now: new Date('2026-05-30T10:03:00.000Z'),
    });

    const all = setsForExercise(mockActiveDatabase!, 'ex-1');
    // s0 revived in place — exactly one row, live, at order 0.
    expect(all.filter((row) => row.id === 's0')).toHaveLength(1);
    const revived = all.find((row) => row.id === 's0');
    expect(revived?.deletedAt).toBeNull();
    expect(revived?.orderIndex).toBe(0);
    expect(liveSetsForExercise(mockActiveDatabase!, 'ex-1').map((row) => row.id).sort()).toEqual(['s0', 's1']);
  });
});
