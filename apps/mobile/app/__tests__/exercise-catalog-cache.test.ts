import {
  __resetExerciseCatalogCacheForTests,
  ensureExerciseCatalogLoaded,
  getExerciseCatalogSnapshot,
  invalidateExerciseCatalogCache,
  subscribeToExerciseCatalog,
} from '@/src/exercise-catalog/cache';
import {
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogMuscleGroups: jest.fn(),
  listExerciseCatalogExercises: jest.fn(),
}));

const mockListMuscleGroups = jest.mocked(listExerciseCatalogMuscleGroups);
const mockListExercises = jest.mocked(listExerciseCatalogExercises);

const muscleGroupsFixture = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
];

const exerciseFixture = (overrides: Partial<ExerciseCatalogExercise> = {}): ExerciseCatalogExercise => ({
  id: 'exercise-bench',
  name: 'Bench Press',
  deletedAt: null,
  mappings: [{ id: 'map-1', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
  ...overrides,
});

describe('exercise catalog cache', () => {
  beforeEach(() => {
    mockListMuscleGroups.mockReset();
    mockListExercises.mockReset();
    __resetExerciseCatalogCacheForTests();
    mockListMuscleGroups.mockResolvedValue(muscleGroupsFixture);
  });

  it('loads the catalog and indexes search text per exercise', async () => {
    mockListExercises.mockResolvedValue([exerciseFixture()]);

    await ensureExerciseCatalogLoaded();

    const snapshot = getExerciseCatalogSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.exercises).toHaveLength(1);
    expect(snapshot.exercises[0].searchText).toContain('bench press');
    expect(snapshot.exercises[0].searchText).toContain('chest');
    expect(snapshot.muscleGroupsById.chest).toEqual(muscleGroupsFixture[0]);
    expect(mockListExercises).toHaveBeenCalledWith({ includeDeleted: true });
  });

  it('returns the cached snapshot without refetching on a second ensure call', async () => {
    mockListExercises.mockResolvedValue([exerciseFixture()]);

    await ensureExerciseCatalogLoaded();
    await ensureExerciseCatalogLoaded();

    expect(mockListExercises).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping invalidations into a single trailing reload', async () => {
    mockListExercises.mockResolvedValue([exerciseFixture()]);
    await ensureExerciseCatalogLoaded();
    expect(mockListExercises).toHaveBeenCalledTimes(1);

    let resolveSecondReload: ((value: ExerciseCatalogExercise[]) => void) | undefined;
    mockListExercises.mockImplementationOnce(
      () =>
        new Promise<ExerciseCatalogExercise[]>((resolve) => {
          resolveSecondReload = resolve;
        })
    );
    mockListExercises.mockResolvedValueOnce([exerciseFixture({ id: 'after-burst', name: 'After Burst' })]);

    invalidateExerciseCatalogCache();
    invalidateExerciseCatalogCache();
    invalidateExerciseCatalogCache();

    // Allow microtasks to start the in-flight reload.
    await Promise.resolve();

    invalidateExerciseCatalogCache();
    invalidateExerciseCatalogCache();

    // Resolve the in-flight reload; the cache should then run exactly one follow-up.
    resolveSecondReload?.([exerciseFixture({ id: 'mid-burst', name: 'Mid Burst' })]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockListExercises).toHaveBeenCalledTimes(3);
    expect(getExerciseCatalogSnapshot().exercises[0].name).toBe('After Burst');
  });

  it('notifies subscribers when the snapshot changes', async () => {
    mockListExercises.mockResolvedValue([exerciseFixture()]);
    const listener = jest.fn();
    const unsubscribe = subscribeToExerciseCatalog(listener);

    await ensureExerciseCatalogLoaded();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    mockListExercises.mockResolvedValueOnce([exerciseFixture({ id: 'second', name: 'Squat' })]);
    invalidateExerciseCatalogCache();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(listener).toHaveBeenCalled();
    expect(getExerciseCatalogSnapshot().exercises[0].name).toBe('Squat');

    unsubscribe();
  });

  it('never runs two reloads concurrently when invalidations land during an in-flight reload', async () => {
    let inFlightCount = 0;
    let maxInFlight = 0;
    let resolveCurrent: ((value: ExerciseCatalogExercise[]) => void) | undefined;
    let pendingResolvers: ((value: ExerciseCatalogExercise[]) => void)[] = [];

    mockListExercises.mockImplementation(
      () =>
        new Promise<ExerciseCatalogExercise[]>((resolve) => {
          inFlightCount += 1;
          maxInFlight = Math.max(maxInFlight, inFlightCount);
          resolveCurrent = (value) => {
            inFlightCount -= 1;
            resolve(value);
          };
          pendingResolvers.push(resolveCurrent);
        })
    );

    void ensureExerciseCatalogLoaded();
    await Promise.resolve();

    // While the first reload is in flight, fire invalidations across
    // several microtask boundaries to give a buggy drain a chance to
    // schedule a concurrent reload.
    invalidateExerciseCatalogCache();
    await Promise.resolve();
    invalidateExerciseCatalogCache();
    await Promise.resolve();
    invalidateExerciseCatalogCache();
    await Promise.resolve();

    // Drain the queue: resolve reloads one at a time and verify no overlap.
    while (pendingResolvers.length > 0) {
      const resolver = pendingResolvers.shift()!;
      resolver([exerciseFixture()]);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(maxInFlight).toBe(1);
    // Initial load + at most one trailing reload coalesces the burst.
    expect(mockListExercises.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('surfaces a load error in the snapshot when the data layer throws', async () => {
    mockListExercises.mockRejectedValue(new Error('boom'));

    await ensureExerciseCatalogLoaded();

    const snapshot = getExerciseCatalogSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.lastError).toBe('boom');
  });
});
