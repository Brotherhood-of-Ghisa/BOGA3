/**
 * Write-path dirty-bit contract for the Layer 2 / Layer 3 entities — the
 * counterpart to the Layer 0 / 1 coverage in `dirty-bit-layer-0-1.test.ts`.
 * Every repo create / update / softDelete / cascade path that writes to one
 * of these tables MUST, inside the SAME `database.transaction((tx) => {...})`
 * as the row write, set `local_dirty = 1` and
 * `local_updated_at_ms = nowMonotonic(tx)`.
 *
 * Layer partition (authoritative — `apps/mobile/src/sync/topo-order.ts`):
 *   - Layer 2: `session_exercises`
 *   - Layer 3: `exercise_sets`, `session_exercise_tags`
 *
 * Files under test:
 *   - `src/data/session-drafts.ts` — writes `session_exercises` and
 *     `exercise_sets` (and the `sessions` row those transactions share).
 *   - `src/data/exercise-tags.ts` — the `session_exercise_tags` create path
 *     (`createTagAssignment`).
 *
 * Coverage (one test per entity in scope, ≥ 3):
 *   - create / update / softDelete each leave the row `local_dirty = 1`.
 *   - reorder swapping two siblings leaves BOTH dirty so they ride the same
 *     push batch and the per-session uniqueness invariant holds.
 *
 * Driver: a real in-memory `better-sqlite3` database with the full migrated
 * schema applied, built via the shared `helpers/in-memory-db` fixture (see
 * that file for why we drive the schema from the generated migration bundle).
 * `bootstrapLocalDataLayer` is mocked to hand the repos this in-memory drizzle
 * instance so the real write paths execute end-to-end.
 */

import { and, eq } from 'drizzle-orm';

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

type TestDatabase = InMemoryTestDatabase;

let mockActiveDatabase: TestDatabase | null = null;

// The repos resolve their database handle through `bootstrapLocalDataLayer`.
// Point it at the per-test in-memory instance so the real write paths run
// against a real SQLite engine (not a hand-rolled mock).
jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) {
      throw new Error('test database not initialised');
    }
    return mockActiveDatabase;
  }),
}));

// Imported AFTER the mock so the repos pick up the mocked bootstrap.
import { createDrizzleSessionDraftStore } from '@/src/data/session-drafts';
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { __resetClockForTests } from '@/src/data/clock';

const SESSION_ID = 'session-l23';
const EXERCISE_DEFINITION_ID = 'sys_barbell_bench_press';

const seedFixtureGraph = (database: TestDatabase): void => {
  // FK parents for the Layer 2 / 3 writes under test.
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
};

const readSessionExercises = (database: TestDatabase) =>
  database
    .select({
      id: sessionExercises.id,
      orderIndex: sessionExercises.orderIndex,
      name: sessionExercises.name,
      deletedAt: sessionExercises.deletedAt,
      localDirty: sessionExercises.localDirty,
      localUpdatedAtMs: sessionExercises.localUpdatedAtMs,
    })
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, SESSION_ID))
    .all();

const readLiveSessionExercises = (database: TestDatabase) =>
  readSessionExercises(database).filter((row) => row.deletedAt === null);

const readExerciseSets = (database: TestDatabase) =>
  database
    .select({
      id: exerciseSets.id,
      sessionExerciseId: exerciseSets.sessionExerciseId,
      orderIndex: exerciseSets.orderIndex,
      repsValue: exerciseSets.repsValue,
      deletedAt: exerciseSets.deletedAt,
      localDirty: exerciseSets.localDirty,
      localUpdatedAtMs: exerciseSets.localUpdatedAtMs,
    })
    .from(exerciseSets)
    .all();

const readLiveExerciseSets = (database: TestDatabase) =>
  readExerciseSets(database).filter((row) => row.deletedAt === null);

const draftExercise = (
  overrides: Partial<{
    id: string;
    name: string;
    sets: { id?: string; repsValue: string; weightValue: string }[];
  }> = {},
) => ({
  id: overrides.id,
  exerciseDefinitionId: EXERCISE_DEFINITION_ID,
  name: overrides.name ?? 'Bench Press',
  sets: overrides.sets ?? [{ repsValue: '5', weightValue: '225' }],
});

describe('Layer 2 / 3 write-path dirty-bit contract', () => {
  let realDateNow: typeof Date.now;
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    __resetClockForTests();
    // FK enforcement on: the Layer 2/3 writes under test depend on the
    // session / exercise-definition parents seeded below.
    fixture = createInMemoryDatabase({ foreignKeys: true });
    mockActiveDatabase = fixture.database;
    seedFixtureGraph(mockActiveDatabase);
    realDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = realDateNow;
    __resetClockForTests();
    fixture.close();
    mockActiveDatabase = null;
  });

  describe('session_exercises (Layer 2)', () => {
    it('create: saving a draft graph leaves every session_exercise row local_dirty = 1', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [draftExercise({ name: 'Bench Press' })],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      const rows = readSessionExercises(mockActiveDatabase!);
      expect(rows).toHaveLength(1);
      expect(rows[0].localDirty).toBe(true);
      expect(rows[0].localUpdatedAtMs).toBeGreaterThan(0);
    });

    it('update: re-saving the same session with edited content re-dirties the session_exercise row', async () => {
      const store = createDrizzleSessionDraftStore();
      const exerciseId = 'exercise-stable-1';

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [draftExercise({ id: exerciseId, name: 'Bench Press' })],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      // Simulate a push having cleared the dirty bit before the next edit.
      mockActiveDatabase!
        .update(sessionExercises)
        .set({ localDirty: false })
        .where(eq(sessionExercises.id, exerciseId))
        .run();
      expect(readSessionExercises(mockActiveDatabase!)[0].localDirty).toBe(false);

      const firstMs = readSessionExercises(mockActiveDatabase!)[0].localUpdatedAtMs;

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [draftExercise({ id: exerciseId, name: 'Bench Press (paused)' })],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const rows = readSessionExercises(mockActiveDatabase!);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Bench Press (paused)');
      expect(rows[0].localDirty).toBe(true);
      expect(rows[0].localUpdatedAtMs).toBeGreaterThan(firstMs);
    });

    it('softDelete (cascade via graph rebuild): removing an exercise from the draft tombstones its row and re-dirties the survivors', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: 'exercise-keep', name: 'Bench Press' }),
          draftExercise({ id: 'exercise-drop', name: 'Incline Press' }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });
      expect(readLiveSessionExercises(mockActiveDatabase!)).toHaveLength(2);

      // Re-save without the dropped exercise. The graph rebuild tombstones the
      // dropped row (so the deletion pushes to the server) and re-writes the
      // survivor — which must stay live and dirty.
      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [draftExercise({ id: 'exercise-keep', name: 'Bench Press' })],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const live = readLiveSessionExercises(mockActiveDatabase!);
      expect(live.map((row) => row.id)).toEqual(['exercise-keep']);
      expect(live[0].localDirty).toBe(true);

      const all = readSessionExercises(mockActiveDatabase!);
      const dropped = all.find((row) => row.id === 'exercise-drop');
      // The dropped exercise is NOT hard-deleted: it survives as a dirty
      // tombstone so the next push carries the deletion to the server.
      expect(dropped).toBeDefined();
      expect(dropped?.deletedAt).not.toBeNull();
      expect(dropped?.localDirty).toBe(true);
    });

    it('reorder: swapping two sibling exercises leaves BOTH rows local_dirty = 1', async () => {
      const store = createDrizzleSessionDraftStore();
      const benchId = 'exercise-bench';
      const squatId = 'exercise-squat';

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: benchId, name: 'Bench Press' }),
          draftExercise({ id: squatId, name: 'Back Squat' }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      // Clear dirty bits to model a clean post-push state, then reorder.
      mockActiveDatabase!.update(sessionExercises).set({ localDirty: false }).run();
      expect(readSessionExercises(mockActiveDatabase!).every((row) => row.localDirty === false)).toBe(true);

      // Swap order: squat now first, bench second.
      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: squatId, name: 'Back Squat' }),
          draftExercise({ id: benchId, name: 'Bench Press' }),
        ],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const rows = readSessionExercises(mockActiveDatabase!);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(squatId)?.orderIndex).toBe(0);
      expect(byId.get(benchId)?.orderIndex).toBe(1);
      // BOTH swapped siblings must be dirty so they ship in the same push
      // batch and the per-session (session_id, order_index) uniqueness
      // invariant holds across the batch.
      expect(byId.get(squatId)?.localDirty).toBe(true);
      expect(byId.get(benchId)?.localDirty).toBe(true);
    });
  });

  describe('exercise_sets (Layer 3)', () => {
    it('create: saving sets leaves every exercise_set row local_dirty = 1', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({
            id: 'exercise-1',
            sets: [
              { id: 'set-1', repsValue: '5', weightValue: '225' },
              { id: 'set-2', repsValue: '4', weightValue: '230' },
            ],
          }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      const rows = readExerciseSets(mockActiveDatabase!);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.localDirty === true)).toBe(true);
      expect(rows.every((row) => row.localUpdatedAtMs > 0)).toBe(true);
    });

    it('update: editing a set re-dirties its exercise_set row after a simulated push clear', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: 'exercise-1', sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }] }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      mockActiveDatabase!.update(exerciseSets).set({ localDirty: false }).run();
      expect(readExerciseSets(mockActiveDatabase!)[0].localDirty).toBe(false);

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: 'exercise-1', sets: [{ id: 'set-1', repsValue: '6', weightValue: '225' }] }),
        ],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const rows = readExerciseSets(mockActiveDatabase!);
      expect(rows).toHaveLength(1);
      expect(rows[0].repsValue).toBe('6');
      expect(rows[0].localDirty).toBe(true);
    });

    it('softDelete (cascade via graph rebuild): dropping a set tombstones it and re-dirties the surviving set', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({
            id: 'exercise-1',
            sets: [
              { id: 'set-keep', repsValue: '5', weightValue: '225' },
              { id: 'set-drop', repsValue: '4', weightValue: '230' },
            ],
          }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });
      expect(readLiveExerciseSets(mockActiveDatabase!)).toHaveLength(2);

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({ id: 'exercise-1', sets: [{ id: 'set-keep', repsValue: '5', weightValue: '225' }] }),
        ],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const live = readLiveExerciseSets(mockActiveDatabase!);
      expect(live.map((row) => row.id)).toEqual(['set-keep']);
      expect(live[0].localDirty).toBe(true);

      const dropped = readExerciseSets(mockActiveDatabase!).find((row) => row.id === 'set-drop');
      // The dropped set survives as a dirty tombstone, not a hard delete.
      expect(dropped).toBeDefined();
      expect(dropped?.deletedAt).not.toBeNull();
      expect(dropped?.localDirty).toBe(true);
    });

    it('reorder: swapping two sibling sets leaves BOTH rows local_dirty = 1', async () => {
      const store = createDrizzleSessionDraftStore();

      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({
            id: 'exercise-1',
            sets: [
              { id: 'set-a', repsValue: '5', weightValue: '225' },
              { id: 'set-b', repsValue: '4', weightValue: '230' },
            ],
          }),
        ],
        now: new Date('2026-05-30T10:01:00.000Z'),
      });

      mockActiveDatabase!.update(exerciseSets).set({ localDirty: false }).run();
      expect(readExerciseSets(mockActiveDatabase!).every((row) => row.localDirty === false)).toBe(true);

      // Swap set order.
      await store.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [
          draftExercise({
            id: 'exercise-1',
            sets: [
              { id: 'set-b', repsValue: '4', weightValue: '230' },
              { id: 'set-a', repsValue: '5', weightValue: '225' },
            ],
          }),
        ],
        now: new Date('2026-05-30T10:02:00.000Z'),
      });

      const rows = readExerciseSets(mockActiveDatabase!);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get('set-b')?.orderIndex).toBe(0);
      expect(byId.get('set-a')?.orderIndex).toBe(1);
      expect(byId.get('set-b')?.localDirty).toBe(true);
      expect(byId.get('set-a')?.localDirty).toBe(true);
    });
  });

  describe('session_exercise_tags (Layer 3)', () => {
    const TAG_DEFINITION_ID = 'exercise-tag-def-1';
    const SESSION_EXERCISE_ID = 'exercise-with-tag';

    const seedTagFixtures = (database: TestDatabase): void => {
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
          name: 'Warmup',
          normalizedName: 'warmup',
        })
        .run();
    };

    const readTag = (database: TestDatabase, sessionExerciseId: string, tagDefinitionId: string) =>
      database
        .select({
          id: sessionExerciseTags.id,
          localDirty: sessionExerciseTags.localDirty,
          localUpdatedAtMs: sessionExerciseTags.localUpdatedAtMs,
        })
        .from(sessionExerciseTags)
        .where(
          and(
            eq(sessionExerciseTags.sessionExerciseId, sessionExerciseId),
            eq(sessionExerciseTags.exerciseTagDefinitionId, tagDefinitionId),
          ),
        )
        .get();

    it('create: createTagAssignment leaves the session_exercise_tag row local_dirty = 1 with a bumped timestamp', async () => {
      seedTagFixtures(mockActiveDatabase!);
      const store = createDrizzleExerciseTagStore();

      await store.createTagAssignment({
        sessionExerciseId: SESSION_EXERCISE_ID,
        tagDefinitionId: TAG_DEFINITION_ID,
        now: new Date('2026-05-30T10:03:00.000Z'),
      });

      const tag = readTag(mockActiveDatabase!, SESSION_EXERCISE_ID, TAG_DEFINITION_ID);
      expect(tag).toBeDefined();
      expect(tag?.localDirty).toBe(true);
      expect(tag?.localUpdatedAtMs).toBeGreaterThan(0);
    });

    it('cascade via graph rebuild: re-saving the draft re-writes the preserved tag and keeps it local_dirty = 1', async () => {
      seedTagFixtures(mockActiveDatabase!);
      const tagStore = createDrizzleExerciseTagStore();
      const draftStore = createDrizzleSessionDraftStore();

      await tagStore.createTagAssignment({
        sessionExerciseId: SESSION_EXERCISE_ID,
        tagDefinitionId: TAG_DEFINITION_ID,
        now: new Date('2026-05-30T10:03:00.000Z'),
      });

      // Model a clean post-push state.
      mockActiveDatabase!.update(sessionExerciseTags).set({ localDirty: false }).run();
      expect(readTag(mockActiveDatabase!, SESSION_EXERCISE_ID, TAG_DEFINITION_ID)?.localDirty).toBe(false);

      // Re-save the same session-exercise. `replaceSessionExerciseGraph`
      // preserves the existing tag assignment and re-inserts it — which must
      // be re-dirtied so the cascade rides along in the next push batch.
      await draftStore.saveDraftGraph({
        sessionId: SESSION_ID,
        gymId: null,
        status: 'active',
        startedAt: new Date('2026-05-30T10:00:00.000Z'),
        exercises: [draftExercise({ id: SESSION_EXERCISE_ID, name: 'Bench Press' })],
        now: new Date('2026-05-30T10:04:00.000Z'),
      });

      const tag = readTag(mockActiveDatabase!, SESSION_EXERCISE_ID, TAG_DEFINITION_ID);
      expect(tag).toBeDefined();
      expect(tag?.localDirty).toBe(true);
    });
  });
});
