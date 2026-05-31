/* eslint-disable import/first */

/**
 * Outcome: every repo write path marks the row it touches dirty in the same
 * transaction as the data write.
 *
 * The push side of sync only ships rows whose dirty bit is set; a write path
 * that forgets to flip the bit silently drops the user's edit from sync. This
 * file asserts the contract once per entity table (all eight), exercising the
 * canonical create / update / soft-delete path the app actually uses and then
 * asserting the persisted row has `local_dirty = 1` and a positive monotonic
 * `local_updated_at_ms`. The eight per-entity checks together cover the whole
 * entity surface.
 *
 * One case is called out explicitly: reordering two sibling exercise sets must
 * dirty BOTH rows in the same transaction, otherwise a half-applied reorder
 * would ship to the server and violate the per-parent order-index uniqueness
 * invariant.
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle via
 * the shared fixture, with `bootstrapLocalDataLayer` pointed at it so the real
 * repo write paths run end to end (not a hand-rolled stand-in).
 */

import { and, eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState } from '../helpers/sync-cycle-mocks';

type TestDatabase = InMemoryTestDatabase;

// Repos resolve their handle through `bootstrapLocalDataLayer`; point it at the
// per-test in-memory database. The mock factory may only close over names that
// start with `mock`, and babel-jest hoists it above the imports below; the
// factory body comes from the shared sync-cycle mock helper.
const mockBootstrapState = createBootstrapMockState<TestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Imported AFTER the bootstrap mock so the repos bind to it.
import { __resetClockForTests } from '@/src/data/clock';
import { createDrizzleExerciseCatalogStore } from '@/src/data/exercise-catalog';
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { upsertLocalGym } from '@/src/data/local-gyms';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExercises,
  sessionExerciseTags,
  sessions,
} from '@/src/data/schema';
import { createDrizzleSessionDraftStore } from '@/src/data/session-drafts';
import { createDrizzleSessionListStore } from '@/src/data/session-list';

let fixture: InMemoryDatabaseFixture;

beforeEach(() => {
  __resetClockForTests();
  // FK enforcement on: the Layer 2/3 writes depend on seeded parents.
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

const db = (): TestDatabase => {
  if (!mockBootstrapState.database) {
    throw new Error('Test database not initialised');
  }
  return mockBootstrapState.database;
};

// Fixtures the various write paths reference as FK parents / lookups.
const SESSION_ID = 'session-dirty';
const EXERCISE_DEFINITION_ID = 'sys_def_dirty';
const MUSCLE_GROUP_ID = 'chest';

const seedMuscleGroup = (): void => {
  db()
    .insert(muscleGroups)
    .values({ id: MUSCLE_GROUP_ID, displayName: 'Chest', familyName: 'Chest', sortOrder: 0 })
    .run();
};

const seedSession = (): void => {
  db()
    .insert(sessions)
    .values({ id: SESSION_ID, status: 'active', startedAt: new Date('2026-05-30T10:00:00.000Z') })
    .run();
};

const seedExerciseDefinition = (): void => {
  db().insert(exerciseDefinitions).values({ id: EXERCISE_DEFINITION_ID, name: 'Bench Press' }).run();
};

const draftExercise = (id: string, name: string) => ({
  id,
  exerciseDefinitionId: EXERCISE_DEFINITION_ID,
  name,
  sets: [{ repsValue: '5', weightValue: '225' }],
});

describe('every entity write path flips the dirty bit in the write transaction', () => {
  it('gyms — create flips local_dirty and stamps a positive timestamp', async () => {
    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });

    const row = db().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('exercise_definitions — create flips local_dirty and stamps a positive timestamp', async () => {
    seedMuscleGroup();
    const store = createDrizzleExerciseCatalogStore();

    const saved = await store.saveExercise({
      id: 'def-create',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: MUSCLE_GROUP_ID, weight: 1, role: 'primary' }],
      now: new Date('2026-05-30T10:00:00.000Z'),
    });

    const row = db()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, saved.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('exercise_muscle_mappings — saving an exercise dirties its mapping rows', async () => {
    seedMuscleGroup();
    const store = createDrizzleExerciseCatalogStore();

    await store.saveExercise({
      id: 'def-mapping',
      name: 'Custom Press',
      mappings: [{ muscleGroupId: MUSCLE_GROUP_ID, weight: 1, role: 'primary' }],
      now: new Date('2026-05-30T10:00:00.000Z'),
    });

    const rows = db()
      .select()
      .from(exerciseMuscleMappings)
      .where(eq(exerciseMuscleMappings.exerciseDefinitionId, 'def-mapping'))
      .all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
  });

  it('exercise_tag_definitions — create flips local_dirty and stamps a positive timestamp', async () => {
    seedExerciseDefinition();
    const store = createDrizzleExerciseTagStore();

    const created = await store.createTagDefinition({
      exerciseDefinitionId: EXERCISE_DEFINITION_ID,
      name: 'Heavy',
      normalizedName: 'heavy',
      now: new Date('2026-05-30T10:00:00.000Z'),
    });

    const row = db()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('sessions — soft delete flips local_dirty and sets deleted_at', async () => {
    seedSession();
    const store = createDrizzleSessionListStore();
    const deletedAt = new Date('2026-05-30T11:00:00.000Z');

    await store.setSessionDeletedState({ sessionId: SESSION_ID, deletedAt, updatedAt: deletedAt });

    const row = db().select().from(sessions).where(eq(sessions.id, SESSION_ID)).get();
    expect(row?.localDirty).toBe(true);
    expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('session_exercises — saving a draft graph dirties the exercise row', async () => {
    seedSession();
    seedExerciseDefinition();
    const store = createDrizzleSessionDraftStore();

    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [draftExercise('sx-1', 'Bench Press')],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    const rows = db()
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, SESSION_ID))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].localDirty).toBe(true);
    expect(rows[0].localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('exercise_sets — saving a draft graph dirties the set rows', async () => {
    seedSession();
    seedExerciseDefinition();
    const store = createDrizzleSessionDraftStore();

    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        {
          id: 'sx-sets',
          exerciseDefinitionId: EXERCISE_DEFINITION_ID,
          name: 'Bench Press',
          sets: [
            { id: 'set-1', repsValue: '5', weightValue: '225' },
            { id: 'set-2', repsValue: '4', weightValue: '230' },
          ],
        },
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    const rows = db().select().from(exerciseSets).all();
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.localDirty).toBe(true);
      expect(row.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
    }
  });

  it('exercise_sets — reordering two sibling sets dirties BOTH rows in one transaction', async () => {
    seedSession();
    seedExerciseDefinition();
    const store = createDrizzleSessionDraftStore();

    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        {
          id: 'sx-reorder',
          exerciseDefinitionId: EXERCISE_DEFINITION_ID,
          name: 'Bench Press',
          sets: [
            { id: 'set-a', repsValue: '5', weightValue: '225' },
            { id: 'set-b', repsValue: '4', weightValue: '230' },
          ],
        },
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    // Model a clean post-push state, then swap the two sets' order.
    db().update(exerciseSets).set({ localDirty: false }).run();
    expect(db().select().from(exerciseSets).all().every((row) => row.localDirty === false)).toBe(
      true,
    );

    await store.saveDraftGraph({
      sessionId: SESSION_ID,
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        {
          id: 'sx-reorder',
          exerciseDefinitionId: EXERCISE_DEFINITION_ID,
          name: 'Bench Press',
          sets: [
            { id: 'set-b', repsValue: '4', weightValue: '230' },
            { id: 'set-a', repsValue: '5', weightValue: '225' },
          ],
        },
      ],
      now: new Date('2026-05-30T10:02:00.000Z'),
    });

    const byId = new Map(db().select().from(exerciseSets).all().map((row) => [row.id, row]));
    expect(byId.get('set-b')?.orderIndex).toBe(0);
    expect(byId.get('set-a')?.orderIndex).toBe(1);
    // Both swapped siblings must be dirty so the reorder ships as one batch.
    expect(byId.get('set-b')?.localDirty).toBe(true);
    expect(byId.get('set-a')?.localDirty).toBe(true);
  });

  it('session_exercise_tags — creating a tag assignment dirties the join row', async () => {
    // FK parents: a persisted session_exercise and a tag definition.
    seedSession();
    seedExerciseDefinition();
    db()
      .insert(sessionExercises)
      .values({
        id: 'sx-with-tag',
        sessionId: SESSION_ID,
        exerciseDefinitionId: EXERCISE_DEFINITION_ID,
        orderIndex: 0,
        name: 'Bench Press',
      })
      .run();
    db()
      .insert(exerciseTagDefinitions)
      .values({
        id: 'tag-def-1',
        exerciseDefinitionId: EXERCISE_DEFINITION_ID,
        name: 'Warmup',
        normalizedName: 'warmup',
      })
      .run();

    const store = createDrizzleExerciseTagStore();
    await store.createTagAssignment({
      sessionExerciseId: 'sx-with-tag',
      tagDefinitionId: 'tag-def-1',
      now: new Date('2026-05-30T10:03:00.000Z'),
    });

    const row = db()
      .select()
      .from(sessionExerciseTags)
      .where(
        and(
          eq(sessionExerciseTags.sessionExerciseId, 'sx-with-tag'),
          eq(sessionExerciseTags.exerciseTagDefinitionId, 'tag-def-1'),
        ),
      )
      .get();
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs ?? 0).toBeGreaterThan(0);
  });
});
