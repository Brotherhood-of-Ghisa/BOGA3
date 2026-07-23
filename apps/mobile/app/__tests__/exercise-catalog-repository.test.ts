import {
  createExerciseCatalogRepository,
  type ExerciseCatalogStore,
} from '@/src/data/exercise-catalog';

const createMockStore = (): jest.Mocked<ExerciseCatalogStore> => ({
  listMuscleGroups: jest.fn(),
  listExercises: jest.fn(),
  saveExercise: jest.fn(),
  setExerciseDeletedState: jest.fn(),
});

describe('exercise catalog repository', () => {
  it('validates and saves an exercise with normalized muscle-link payload', async () => {
    const store = createMockStore();
    const repository = createExerciseCatalogRepository(store);
    const now = new Date('2026-02-25T10:00:00.000Z');

    store.listMuscleGroups.mockResolvedValue([
      { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
      { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
    ]);
    store.saveExercise.mockResolvedValue({
      id: 'exercise-1',
      name: 'Custom Press',
      loadInputMode: 'per_side_load',
      deletedAt: null,
      mappings: [
        { id: 'map-1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { id: 'map-2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    });

    const saved = await repository.saveExercise({
      name: '  Custom Press  ',
      loadInputMode: 'per_side_load',
      mappings: [
        { muscleGroupId: 'chest', weight: 1 },
        { muscleGroupId: 'triceps', weight: 0.5, role: null },
      ],
      now,
    });

    expect(saved.name).toBe('Custom Press');
    expect(store.saveExercise).toHaveBeenCalledWith({
      id: undefined,
      name: 'Custom Press',
      loadInputMode: 'per_side_load',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
      now,
    });
  });

  it('lists exercises with explicit includeDeleted defaults', async () => {
    const store = createMockStore();
    const repository = createExerciseCatalogRepository(store);
    store.listExercises.mockResolvedValue([]);

    await repository.listExercises();
    await repository.listExercises({ includeDeleted: true });

    expect(store.listExercises).toHaveBeenNthCalledWith(1, { includeDeleted: false });
    expect(store.listExercises).toHaveBeenNthCalledWith(2, { includeDeleted: true });
  });

  it('rejects missing links, duplicate links, and invalid weights', async () => {
    const store = createMockStore();
    const repository = createExerciseCatalogRepository(store);

    store.listMuscleGroups.mockResolvedValue([
      { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
    ]);

    await expect(
      repository.saveExercise({
        name: 'Bench',
        mappings: [],
      })
    ).rejects.toThrow('At least one muscle link is required');

    await expect(
      repository.saveExercise({
        name: 'Bench',
        mappings: [
          { muscleGroupId: 'chest', weight: 1 },
          { muscleGroupId: 'chest', weight: 0.5 },
        ],
      })
    ).rejects.toThrow('Duplicate muscle link');

    await expect(
      repository.saveExercise({
        name: 'Bench',
        mappings: [{ muscleGroupId: 'chest', weight: 0 }],
      })
    ).rejects.toThrow('Invalid muscle weight');

    await expect(
      repository.saveExercise({
        name: 'Bench',
        mappings: [{ muscleGroupId: 'chest', weight: 1.1 }],
      })
    ).rejects.toThrow('Invalid muscle weight');

    expect(store.saveExercise).not.toHaveBeenCalled();
  });

  it('writes soft-delete state changes for delete and undelete', async () => {
    const store = createMockStore();
    const repository = createExerciseCatalogRepository(store);
    const now = new Date('2026-02-27T12:00:00.000Z');

    await repository.deleteExercise('exercise-1', now);
    await repository.undeleteExercise('exercise-1', now);

    expect(store.setExerciseDeletedState).toHaveBeenNthCalledWith(1, {
      id: 'exercise-1',
      deletedAt: now,
      now,
    });
    expect(store.setExerciseDeletedState).toHaveBeenNthCalledWith(2, {
      id: 'exercise-1',
      deletedAt: null,
      now,
    });
  });
});
