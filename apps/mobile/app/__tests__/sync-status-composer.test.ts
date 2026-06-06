/* eslint-disable import/first */

/**
 * The sync-status composer: it folds the scheduler's production status, the
 * runtime-state row, and a dirty-row count into the single snapshot the Settings
 * surface renders. These tests pin two things against a real in-memory database:
 *  1. the dirty count sums `local_dirty = 1` rows across all eight entity tables
 *     (and excludes clean rows), and
 *  2. the snapshot carries the scheduler's last-success time, error, network
 *     state, the auth-required flag, and the bootstrap-completed flag.
 */

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(currentDatabase()),
}));

const mockGetSchedulerStatus = jest.fn();
jest.mock('@/src/sync/scheduler', () => ({
  getSchedulerStatus: () => mockGetSchedulerStatus(),
}));

const mockGetAuthRequiredSignal = jest.fn(() => false);
jest.mock('@/src/sync/auth-required-signal', () => ({
  getAuthRequiredSignal: () => mockGetAuthRequiredSignal(),
}));

import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
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
  syncQuarantine,
  syncRuntimeState,
} from '@/src/data/schema';
import { getSyncStatus } from '@/src/sync/sync-status';

// The bootstrap mock factory is hoisted above the fixture assignment, so it
// reads the database through this getter at call time rather than capturing a
// stale reference.
const currentDatabase = () => fixture.database;

const cleanStatus = {
  state: { name: 'LONG_TIMEOUT' as const, deadlineMs: 0 },
  online: true,
  lastCycleError: null as string | null,
  lastSuccessAtMs: 1_700_000_000_000 as number | null,
  progress: { phase: 'done' as const, layersCompleted: 4, rowsApplied: 10, offline: false },
};

beforeEach(() => {
  fixture = createInMemoryDatabase();
  mockGetSchedulerStatus.mockReset().mockReturnValue(cleanStatus);
  mockGetAuthRequiredSignal.mockReset().mockReturnValue(false);
});

afterEach(() => {
  fixture.close();
});

describe('dirty-row count across the eight entity tables', () => {
  it('is zero on an empty database', async () => {
    const status = await getSyncStatus();
    expect(status.dirtyCount).toBe(0);
  });

  it('sums dirty rows across every entity table and skips clean rows', async () => {
    const db = fixture.database;

    // Two dirty + one clean gym.
    await db.insert(gyms).values([
      { id: 'gym-dirty-1', name: 'A', localDirty: true },
      { id: 'gym-dirty-2', name: 'B', localDirty: true },
      { id: 'gym-clean', name: 'C', localDirty: false },
    ]);

    // A muscle group the mapping below references. `muscle_groups` is NOT one
    // of the eight dirty-counted tables, so it never affects the count.
    await db
      .insert(muscleGroups)
      .values({ id: 'chest', displayName: 'Chest', familyName: 'Chest' });

    // One dirty exercise definition (Layer 0).
    await db.insert(exerciseDefinitions).values({ id: 'def-1', name: 'Bench', localDirty: true });

    // One dirty tag definition (Layer 1).
    await db.insert(exerciseTagDefinitions).values({
      id: 'tag-1',
      exerciseDefinitionId: 'def-1',
      name: 'Heavy',
      normalizedName: 'heavy',
      localDirty: true,
    });

    // One dirty muscle mapping (Layer 1).
    await db.insert(exerciseMuscleMappings).values({
      id: 'map-1',
      exerciseDefinitionId: 'def-1',
      muscleGroupId: 'chest',
      weight: 1,
      localDirty: true,
    });

    // One dirty session (Layer 1).
    await db.insert(sessions).values({
      id: 'sess-1',
      startedAt: new Date(0),
      localDirty: true,
    });

    // One dirty session-exercise (Layer 2).
    await db.insert(sessionExercises).values({
      id: 'se-1',
      sessionId: 'sess-1',
      name: 'Bench',
      orderIndex: 0,
      localDirty: true,
    });

    // One dirty set + one dirty session-exercise-tag (Layer 3).
    await db
      .insert(exerciseSets)
      .values({ id: 'set-1', sessionExerciseId: 'se-1', orderIndex: 0, localDirty: true });
    await db.insert(sessionExerciseTags).values({
      id: 'set-tag-1',
      sessionExerciseId: 'se-1',
      exerciseTagDefinitionId: 'tag-1',
      localDirty: true,
    });

    const status = await getSyncStatus();
    // 2 gyms + 1 def + 1 tag-def + 1 mapping + 1 session + 1 se + 1 set + 1 se-tag = 9
    expect(status.dirtyCount).toBe(9);
  });
});

describe('snapshot composition', () => {
  it('carries the scheduler last-success time, error, and online network state', async () => {
    const status = await getSyncStatus();
    expect(status.lastSuccessAtMs).toBe(1_700_000_000_000);
    expect(status.errorMessage).toBeNull();
    expect(status.networkState).toBe('online');
    expect(status.authRequired).toBe(false);
  });

  it('reports offline and the latest error when the scheduler does', async () => {
    mockGetSchedulerStatus.mockReturnValue({
      ...cleanStatus,
      online: false,
      lastCycleError: 'server unreachable',
    });

    const status = await getSyncStatus();
    expect(status.networkState).toBe('offline');
    expect(status.errorMessage).toBe('server unreachable');
  });

  it('reports auth-required when the cycle reported no signed-in user', async () => {
    mockGetAuthRequiredSignal.mockReturnValue(true);
    const status = await getSyncStatus();
    expect(status.authRequired).toBe(true);
  });

  it('reads bootstrap-completed from the runtime-state row', async () => {
    expect((await getSyncStatus()).bootstrapCompleted).toBe(false);

    await fixture.database.insert(syncRuntimeState).values({
      id: PRIMARY_RUNTIME_STATE_ID,
      bootstrapCompletedAt: new Date(1_699_000_000_000),
    });

    expect((await getSyncStatus()).bootstrapCompleted).toBe(true);
  });

  it('reports the count of blocked (quarantined) sync rows', async () => {
    expect((await getSyncStatus()).blockedRowCount).toBe(0);

    await fixture.database.insert(syncQuarantine).values([
      {
        entityType: 'session_exercises',
        entityId: 'se-orphan',
        errorCode: 'LOCAL_FK_VIOLATION',
        parentType: 'sessions',
        parentIdField: 'session_id',
        parentId: 'sess-missing',
        firstSeenAtMs: 1_700_000_000_000,
        lastSeenAtMs: 1_700_000_000_000,
        occurrenceCount: 1,
      },
      {
        entityType: 'exercise_sets',
        entityId: 'set-orphan',
        errorCode: 'LOCAL_FK_VIOLATION',
        parentType: 'session_exercises',
        parentIdField: 'session_exercise_id',
        parentId: 'se-missing',
        firstSeenAtMs: 1_700_000_000_000,
        lastSeenAtMs: 1_700_000_000_000,
        occurrenceCount: 1,
      },
    ]);

    expect((await getSyncStatus()).blockedRowCount).toBe(2);
  });
});
