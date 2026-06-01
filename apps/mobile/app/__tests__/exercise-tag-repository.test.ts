import {
  createExerciseTagRepository,
  ExerciseTagDomainError,
  type ExerciseTagStore,
} from '@/src/data/exercise-tags';

const createMockStore = (): jest.Mocked<ExerciseTagStore> => ({
  listTagDefinitions: jest.fn(),
  createTagDefinition: jest.fn(),
  renameTagDefinition: jest.fn(),
  setTagDefinitionDeletedState: jest.fn(),
  loadSessionExerciseScope: jest.fn(),
  loadTagDefinitionScope: jest.fn(),
  createTagAssignment: jest.fn(),
  removeTagAssignment: jest.fn(),
  listAssignedTags: jest.fn(),
});

describe('exercise tag repository', () => {
  it('lists tag definitions with includeDeleted false by default', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    store.listTagDefinitions.mockResolvedValue([]);

    await repository.listTagDefinitions('exercise-1');
    await repository.listTagDefinitions('exercise-1', { includeDeleted: true });

    expect(store.listTagDefinitions).toHaveBeenNthCalledWith(1, {
      exerciseDefinitionId: 'exercise-1',
      includeDeleted: false,
    });
    expect(store.listTagDefinitions).toHaveBeenNthCalledWith(2, {
      exerciseDefinitionId: 'exercise-1',
      includeDeleted: true,
    });
  });

  it('lists tag suggestions excluding soft-deleted rows by default', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    store.listTagDefinitions.mockResolvedValue([]);

    await repository.listTagSuggestions('exercise-1');

    expect(store.listTagDefinitions).toHaveBeenCalledWith({
      exerciseDefinitionId: 'exercise-1',
      includeDeleted: false,
    });
  });

  it('creates tags with trimmed display name and case-insensitive normalized value', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    const now = new Date('2026-03-05T10:30:00.000Z');

    store.createTagDefinition.mockResolvedValue({
      id: 'tag-1',
      exerciseDefinitionId: 'exercise-1',
      name: 'Wide Grip',
      normalizedName: 'wide grip',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await repository.createTagDefinition({
      exerciseDefinitionId: ' exercise-1 ',
      name: '  Wide Grip  ',
      now,
    });

    expect(created.name).toBe('Wide Grip');
    expect(store.createTagDefinition).toHaveBeenCalledWith({
      exerciseDefinitionId: 'exercise-1',
      name: 'Wide Grip',
      normalizedName: 'wide grip',
      now,
    });
  });

  it('rejects blank tag names with a typed domain error', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);

    await expect(
      repository.createTagDefinition({
        exerciseDefinitionId: 'exercise-1',
        name: '   ',
      })
    ).rejects.toMatchObject({
      code: 'tag_name_required',
    });
    await expect(
      repository.createTagDefinition({
        exerciseDefinitionId: 'exercise-1',
        name: '   ',
      })
    ).rejects.toBeInstanceOf(ExerciseTagDomainError);
  });

  it('maps create duplicate failures to duplicate-name domain errors', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);

    store.createTagDefinition.mockRejectedValue(
      new Error(
        'UNIQUE constraint failed: exercise_tag_definitions.exercise_definition_id, exercise_tag_definitions.normalized_name'
      )
    );

    await expect(
      repository.createTagDefinition({
        exerciseDefinitionId: 'exercise-1',
        name: 'Wide Grip',
      })
    ).rejects.toMatchObject({
      code: 'tag_name_duplicate',
    });
  });

  it('renames tags using the same normalization and duplicate-prevention rules', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    const now = new Date('2026-03-05T12:00:00.000Z');

    store.renameTagDefinition.mockResolvedValue({
      id: 'tag-1',
      exerciseDefinitionId: 'exercise-1',
      name: 'Close Neutral',
      normalizedName: 'close neutral',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await repository.renameTagDefinition({
      tagDefinitionId: ' tag-1 ',
      name: '  Close Neutral  ',
      now,
    });

    expect(store.renameTagDefinition).toHaveBeenCalledWith({
      id: 'tag-1',
      name: 'Close Neutral',
      normalizedName: 'close neutral',
      now,
    });
  });

  it('maps rename duplicate failures to duplicate-name domain errors', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);

    store.renameTagDefinition.mockRejectedValue(
      new Error(
        'UNIQUE constraint failed: exercise_tag_definitions.exercise_definition_id, exercise_tag_definitions.normalized_name'
      )
    );

    await expect(
      repository.renameTagDefinition({
        tagDefinitionId: 'tag-1',
        name: 'Wide Grip',
      })
    ).rejects.toMatchObject({
      code: 'tag_name_duplicate',
    });
  });

  it('writes soft-delete and undelete state changes', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    const now = new Date('2026-03-05T14:00:00.000Z');

    await repository.deleteTagDefinition('tag-1', now);
    await repository.undeleteTagDefinition('tag-1', now);

    expect(store.setTagDefinitionDeletedState).toHaveBeenNthCalledWith(1, {
      id: 'tag-1',
      deletedAt: now,
      now,
    });
    expect(store.setTagDefinitionDeletedState).toHaveBeenNthCalledWith(2, {
      id: 'tag-1',
      deletedAt: null,
      now,
    });
  });

  it('keeps historical assignment visibility when assigned tags point to soft-deleted definitions', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    const deletedAt = new Date('2026-03-05T14:00:00.000Z');

    store.listAssignedTags.mockResolvedValue([
      {
        assignmentId: 'assignment-1',
        sessionExerciseId: 'session-exercise-1',
        tagDefinitionId: 'tag-1',
        exerciseDefinitionId: 'exercise-1',
        name: 'Competition Pause',
        normalizedName: 'competition pause',
        deletedAt,
        assignedAt: new Date('2026-03-05T13:59:00.000Z'),
      },
    ]);

    const assigned = await repository.listAssignedTagsForSessionExercise('session-exercise-1');

    expect(assigned).toEqual([
      expect.objectContaining({
        assignmentId: 'assignment-1',
        tagDefinitionId: 'tag-1',
        deletedAt,
      }),
    ]);
    expect(store.listAssignedTags).toHaveBeenCalledWith({
      sessionExerciseId: 'session-exercise-1',
    });
  });

  it('rejects cross-definition tag assignment for logged exercises', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);

    store.loadSessionExerciseScope.mockResolvedValue({
      sessionExerciseId: 'session-exercise-1',
      exerciseDefinitionId: 'exercise-1',
    });
    store.loadTagDefinitionScope.mockResolvedValue({
      tagDefinitionId: 'tag-1',
      exerciseDefinitionId: 'exercise-2',
    });

    await expect(
      repository.attachTagToSessionExercise({
        sessionExerciseId: 'session-exercise-1',
        tagDefinitionId: 'tag-1',
      })
    ).rejects.toMatchObject({
      code: 'invalid_cross_definition_assignment',
    });

    expect(store.createTagAssignment).not.toHaveBeenCalled();
  });

  it('maps duplicate assignment inserts to duplicate-assignment domain errors', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);

    store.loadSessionExerciseScope.mockResolvedValue({
      sessionExerciseId: 'session-exercise-1',
      exerciseDefinitionId: 'exercise-1',
    });
    store.loadTagDefinitionScope.mockResolvedValue({
      tagDefinitionId: 'tag-1',
      exerciseDefinitionId: 'exercise-1',
    });
    store.createTagAssignment.mockRejectedValue(
      new Error(
        'UNIQUE constraint failed: session_exercise_tags.session_exercise_id, session_exercise_tags.exercise_tag_definition_id'
      )
    );

    await expect(
      repository.attachTagToSessionExercise({
        sessionExerciseId: 'session-exercise-1',
        tagDefinitionId: 'tag-1',
      })
    ).rejects.toMatchObject({
      code: 'duplicate_session_exercise_assignment',
    });
  });

  it('lists and removes assigned tags for a logged exercise', async () => {
    const store = createMockStore();
    const repository = createExerciseTagRepository(store);
    store.listAssignedTags.mockResolvedValue([]);

    await repository.listAssignedTagsForSessionExercise(' session-exercise-1 ');
    await repository.removeTagFromSessionExercise({
      sessionExerciseId: ' session-exercise-1 ',
      tagDefinitionId: ' tag-1 ',
    });

    expect(store.listAssignedTags).toHaveBeenCalledWith({
      sessionExerciseId: 'session-exercise-1',
    });
    expect(store.removeTagAssignment).toHaveBeenCalledWith({
      sessionExerciseId: 'session-exercise-1',
      tagDefinitionId: 'tag-1',
      now: expect.any(Date),
    });
  });
});
