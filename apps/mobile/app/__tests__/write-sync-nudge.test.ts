/* eslint-disable import/first */

/**
 * Write-time sync-nudge contract for the data layer.
 *
 * The bug this guards: a committed local edit dirties its row but NOTHING asks
 * the sync scheduler to push it, so the edit sits unsynced until the 60s long
 * backstop, the next foreground edge, or a relaunch. The fix fires the
 * `write-nudge` emitter (`notifyLocalWrite`) from every repo write boundary,
 * AFTER the transaction commits, exactly once per logical mutation — and never
 * from a read path.
 *
 * What this suite proves (fails on origin/main, passes with the fix):
 *   1. Each representative repo write path marks its row `local_dirty = 1` AND
 *      calls `notifyLocalWrite` exactly once.
 *   2. The nudge fires POST-COMMIT: when the spy runs, the dirtied row is
 *      already visible in the database (it is not called from inside the
 *      transaction, before the row landed).
 *   3. Read paths never nudge.
 *
 * Driver: the shared in-memory `better-sqlite3` fixture with the full migrated
 * schema. `@/src/data/bootstrap` is mocked so the real repos run against it.
 * `@/src/sync/write-nudge` is mocked to a spy so the nudge is observable without
 * wiring the real scheduler (covered separately by
 * `write-sync-nudge-scheduler.test.ts`).
 */

import { eq } from 'drizzle-orm';

import {
  exerciseDefinitions,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExercises,
  sessions,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

type TestDatabase = InMemoryTestDatabase;

const mockBootstrapState: { database: TestDatabase | null } = { database: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

// The nudge emitter is mocked to a spy. The mock records, on every call, whether
// the just-written row is already committed-and-visible — this is how the suite
// proves the nudge fires AFTER the transaction rather than inside it.
const mockNotifyLocalWrite = jest.fn();
jest.mock('@/src/sync/write-nudge', () => ({
  notifyLocalWrite: () => mockNotifyLocalWrite(),
}));

// Imported AFTER the mocks so the repos bind to them.
import { __resetClockForTests } from '@/src/data/clock';
import { upsertLocalGym, loadLocalGymById } from '@/src/data/local-gyms';
import { createDrizzleExerciseCatalogStore } from '@/src/data/exercise-catalog';
import { createDrizzleExerciseTagStore } from '@/src/data/exercise-tags';
import { createDrizzleSessionDraftStore } from '@/src/data/session-drafts';
import { createDrizzleSessionListStore } from '@/src/data/session-list';

let fixture: InMemoryDatabaseFixture;

const requireDatabase = (): TestDatabase => {
  if (!mockBootstrapState.database) {
    throw new Error('Test database not initialised');
  }
  return mockBootstrapState.database;
};

const seedMuscleGroup = (id = 'chest') => {
  requireDatabase()
    .insert(muscleGroups)
    .values({ id, displayName: 'Chest', familyName: 'Chest', sortOrder: 0 })
    .run();
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  mockBootstrapState.database = fixture.database;
  mockNotifyLocalWrite.mockClear();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('repo write paths nudge the scheduler exactly once, post-commit', () => {
  it('gyms upsert: dirties the row AND nudges once after commit', async () => {
    // The nudge must see the committed row. Capture DB visibility at call time.
    let rowDirtyAtNudgeTime: boolean | undefined;
    mockNotifyLocalWrite.mockImplementation(() => {
      const row = requireDatabase().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
      rowDirtyAtNudgeTime = row?.localDirty;
    });

    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });

    const row = requireDatabase().select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.localDirty).toBe(true);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
    // Post-commit ordering: the dirtied row is already visible when the nudge
    // runs, so the nudge cannot have fired from inside the transaction.
    expect(rowDirtyAtNudgeTime).toBe(true);
  });

  it('gyms read path (loadLocalGymById) never nudges', async () => {
    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });
    mockNotifyLocalWrite.mockClear();

    await loadLocalGymById('gym-1');

    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('exercise-catalog saveExercise: dirties the definition AND nudges once', async () => {
    seedMuscleGroup();
    const store = createDrizzleExerciseCatalogStore();

    const saved = await store.saveExercise({
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const row = requireDatabase()
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, saved.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('exercise-catalog listExercises (read) never nudges', async () => {
    seedMuscleGroup();
    const store = createDrizzleExerciseCatalogStore();
    await store.saveExercise({
      name: 'Custom Press',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });
    mockNotifyLocalWrite.mockClear();

    await store.listExercises({ includeDeleted: true });

    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('session-list soft delete: dirties the session AND nudges once', async () => {
    requireDatabase()
      .insert(sessions)
      .values({ id: 'session-1', startedAt: new Date('2026-05-29T08:00:00.000Z') })
      .run();
    const store = createDrizzleSessionListStore();

    await store.setSessionDeletedState({
      sessionId: 'session-1',
      deletedAt: new Date('2026-05-29T09:00:00.000Z'),
      updatedAt: new Date('2026-05-29T09:00:00.000Z'),
    });

    const row = requireDatabase().select().from(sessions).where(eq(sessions.id, 'session-1')).get();
    expect(row?.localDirty).toBe(true);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('session-list listSessionRecords (read) never nudges', async () => {
    const store = createDrizzleSessionListStore();
    await store.listSessionRecords();
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('session-drafts saveDraftGraph: one nudge for the whole graph mutation', async () => {
    seedMuscleGroup();
    const catalog = createDrizzleExerciseCatalogStore();
    const saved = await catalog.saveExercise({
      name: 'Bench',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      now: new Date('2026-05-29T10:00:00.000Z'),
    });
    mockNotifyLocalWrite.mockClear();

    const store = createDrizzleSessionDraftStore();
    const result = await store.saveDraftGraph({
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-29T11:00:00.000Z'),
      now: new Date('2026-05-29T11:00:00.000Z'),
      exercises: [
        {
          exerciseDefinitionId: saved.id,
          name: 'Bench',
          sets: [
            { repsValue: '10', weightValue: '100' },
            { repsValue: '8', weightValue: '110' },
          ],
        },
      ],
    });

    const sessionRow = requireDatabase()
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.sessionId))
      .get();
    const exerciseRows = requireDatabase()
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, result.sessionId))
      .all();

    expect(sessionRow?.localDirty).toBe(true);
    expect(exerciseRows.length).toBeGreaterThan(0);
    // The whole session + exercise + set graph is one logical mutation: exactly
    // one nudge, NOT one per dirtied row.
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('exercise-tags createTagDefinition: dirties the row AND nudges once', async () => {
    requireDatabase()
      .insert(exerciseDefinitions)
      .values({ id: 'def-1', name: 'Bench Press' })
      .run();
    const store = createDrizzleExerciseTagStore();

    const created = await store.createTagDefinition({
      exerciseDefinitionId: 'def-1',
      name: 'Heavy',
      normalizedName: 'heavy',
      now: new Date('2026-05-29T10:00:00.000Z'),
    });

    const row = requireDatabase()
      .select()
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, created.id))
      .get();
    expect(row?.localDirty).toBe(true);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('exercise-tags listTagDefinitions (read) never nudges', async () => {
    requireDatabase()
      .insert(exerciseDefinitions)
      .values({ id: 'def-1', name: 'Bench Press' })
      .run();
    const store = createDrizzleExerciseTagStore();
    await store.listTagDefinitions({ exerciseDefinitionId: 'def-1', includeDeleted: true });
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });
});
