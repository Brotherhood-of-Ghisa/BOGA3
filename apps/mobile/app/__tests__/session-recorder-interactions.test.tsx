import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { uiColors } from '@/components/ui';
import SessionRecorderScreen from '../(tabs)/session-recorder';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';

const mockPush = jest.fn();
const mockLogEvent = jest.fn();
const mockFocusCallbacks = new Set<() => void | (() => void)>();
let mockSearchParams: Record<string, string | undefined> = {};

const swipeLeft = (target: ReturnType<typeof screen.getByTestId>) => {
  fireEvent(target, 'touchStart', { nativeEvent: { pageX: 220 } });
  fireEvent(target, 'touchEnd', { nativeEvent: { pageX: 120 } });
};

const swipeRight = (target: ReturnType<typeof screen.getByTestId>) => {
  fireEvent(target, 'touchStart', { nativeEvent: { pageX: 120 } });
  fireEvent(target, 'touchEnd', { nativeEvent: { pageX: 220 } });
};

jest.mock('@/src/logging', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));

jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => ({
    user: {
      id: 'user-1',
    },
  }),
}));

jest.mock('@/src/data', () => {
  class ExerciseTagDomainError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'ExerciseTagDomainError';
      this.code = code;
    }
  }

  const tagDefinitionsByExerciseDefinitionId = new Map<string, any[]>();
  const assignmentsBySessionExerciseId = new Map<string, Set<string>>();
  const sessionExerciseDefinitionById = new Map<string, string>();
  let tagCounter = 0;
  let assignmentCounter = 0;
  let listAssignedTagsFailureCount = 0;

  const newTagId = () => {
    tagCounter += 1;
    return `tag-${tagCounter}`;
  };

  const seedTagStore = () => {
    tagDefinitionsByExerciseDefinitionId.clear();
    assignmentsBySessionExerciseId.clear();
    sessionExerciseDefinitionById.clear();
    tagCounter = 0;
    assignmentCounter = 0;
    listAssignedTagsFailureCount = 0;

    const seededTags: any[] = [
      {
        id: newTagId(),
        exerciseDefinitionId: 'seed_barbell_back_squat',
        name: 'Paused',
        normalizedName: 'paused',
        deletedAt: null,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
      {
        id: newTagId(),
        exerciseDefinitionId: 'seed_barbell_back_squat',
        name: 'Tempo',
        normalizedName: 'tempo',
        deletedAt: null,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
      {
        id: newTagId(),
        exerciseDefinitionId: 'seed_barbell_bench_press',
        name: 'Close Grip',
        normalizedName: 'close grip',
        deletedAt: null,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
      {
        id: newTagId(),
        exerciseDefinitionId: 'seed_barbell_bench_press',
        name: 'Feet Up',
        normalizedName: 'feet up',
        deletedAt: null,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
    ];

    seededTags.forEach((tagDefinition) => {
      const current = tagDefinitionsByExerciseDefinitionId.get(tagDefinition.exerciseDefinitionId) ?? [];
      current.push(tagDefinition);
      tagDefinitionsByExerciseDefinitionId.set(tagDefinition.exerciseDefinitionId, current);
    });
  };

  seedTagStore();

  const findTagDefinitionById = (tagDefinitionId: string) => {
    for (const tagDefinitions of tagDefinitionsByExerciseDefinitionId.values()) {
      const matched = tagDefinitions.find((tagDefinition) => tagDefinition.id === tagDefinitionId);
      if (matched) {
        return matched;
      }
    }
    return null;
  };

  const listTagDefinitions = jest.fn().mockImplementation(async (exerciseDefinitionId: string, options?: any) => {
    const includeDeleted = options?.includeDeleted === true;
    const definitions = tagDefinitionsByExerciseDefinitionId.get(exerciseDefinitionId) ?? [];
    const sorted = [...definitions].sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));
    return includeDeleted ? sorted : sorted.filter((tagDefinition) => tagDefinition.deletedAt === null);
  });

  const createTagDefinition = jest.fn().mockImplementation(async (input: any) => {
    const name = input.name.trim();
    const normalizedName = name.toLowerCase();
    const current = tagDefinitionsByExerciseDefinitionId.get(input.exerciseDefinitionId) ?? [];
    if (current.some((tagDefinition) => tagDefinition.normalizedName === normalizedName)) {
      throw new ExerciseTagDomainError('tag_name_duplicate', 'Tag already exists');
    }

    const now = new Date('2026-03-01T11:00:00.000Z');
    const created: any = {
      id: newTagId(),
      exerciseDefinitionId: input.exerciseDefinitionId,
      name,
      normalizedName,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tagDefinitionsByExerciseDefinitionId.set(input.exerciseDefinitionId, [...current, created]);
    return created;
  });

  const renameTagDefinition = jest.fn().mockImplementation(async (input: any) => {
    const definition = findTagDefinitionById(input.tagDefinitionId);
    if (!definition) {
      throw new ExerciseTagDomainError('tag_definition_not_found', 'Tag not found');
    }
    definition.name = input.name.trim();
    definition.normalizedName = definition.name.toLowerCase();
    definition.updatedAt = new Date('2026-03-01T11:00:00.000Z');
    return definition;
  });

  const deleteTagDefinition = jest.fn().mockImplementation(async (tagDefinitionId: string) => {
    const definition = findTagDefinitionById(tagDefinitionId);
    if (!definition) {
      throw new ExerciseTagDomainError('tag_definition_not_found', 'Tag not found');
    }
    definition.deletedAt = new Date('2026-03-01T12:00:00.000Z');
  });

  const undeleteTagDefinition = jest.fn().mockImplementation(async (tagDefinitionId: string) => {
    const definition = findTagDefinitionById(tagDefinitionId);
    if (!definition) {
      throw new ExerciseTagDomainError('tag_definition_not_found', 'Tag not found');
    }
    definition.deletedAt = null;
  });

  const persistSessionDraftSnapshot = jest.fn().mockImplementation(async (input: any) => {
    input.exercises.forEach((exercise: any) => {
      sessionExerciseDefinitionById.set(exercise.id, exercise.exerciseDefinitionId);
    });
    return { sessionId: 'test-session' };
  });

  const persistCompletedSessionSnapshot = jest.fn().mockImplementation(async (input: any) => {
    input.exercises.forEach((exercise: any) => {
      sessionExerciseDefinitionById.set(exercise.id, exercise.exerciseDefinitionId);
    });
    return {
      sessionId: input.sessionId ?? 'test-session',
      completedAt: new Date('2026-02-24T00:00:00.000Z'),
      durationSec: 0,
    };
  });

  const attachExerciseTagToSessionExercise = jest.fn().mockImplementation(async (input: any) => {
    const definition = findTagDefinitionById(input.tagDefinitionId);
    if (!definition) {
      throw new ExerciseTagDomainError('tag_definition_not_found', 'Tag not found');
    }

    const scopedExerciseDefinitionId = sessionExerciseDefinitionById.get(input.sessionExerciseId);
    if (scopedExerciseDefinitionId && scopedExerciseDefinitionId !== definition.exerciseDefinitionId) {
      throw new ExerciseTagDomainError('invalid_cross_definition_assignment', 'Cross-definition tag assignment');
    }

    sessionExerciseDefinitionById.set(input.sessionExerciseId, definition.exerciseDefinitionId);
    const existing = assignmentsBySessionExerciseId.get(input.sessionExerciseId) ?? new Set<string>();
    if (existing.has(input.tagDefinitionId)) {
      throw new Error(
        'UNIQUE constraint failed: session_exercise_tags.session_exercise_id, session_exercise_tags.exercise_tag_definition_id'
      );
    }
    existing.add(input.tagDefinitionId);
    assignmentsBySessionExerciseId.set(input.sessionExerciseId, existing);
  });

  const removeExerciseTagFromSessionExercise = jest.fn().mockImplementation(async (input: any) => {
    const existing = assignmentsBySessionExerciseId.get(input.sessionExerciseId);
    if (!existing) {
      return;
    }
    existing.delete(input.tagDefinitionId);
  });

  const listSessionExerciseAssignedTags = jest.fn().mockImplementation(async (sessionExerciseId: string) => {
    if (listAssignedTagsFailureCount > 0) {
      listAssignedTagsFailureCount -= 1;
      throw new Error('list assigned tags failed');
    }

    const assignedTagIds = assignmentsBySessionExerciseId.get(sessionExerciseId) ?? new Set<string>();
    const definitions = [...assignedTagIds]
      .map((tagDefinitionId) => findTagDefinitionById(tagDefinitionId))
      .filter((definition) => definition !== null)
      .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));

    return definitions.map((definition) => {
      assignmentCounter += 1;
      return {
        assignmentId: `assignment-${assignmentCounter}`,
        sessionExerciseId,
        tagDefinitionId: definition.id,
        exerciseDefinitionId: definition.exerciseDefinitionId,
        name: definition.name,
        normalizedName: definition.normalizedName,
        deletedAt: definition.deletedAt,
        assignedAt: new Date('2026-03-01T12:30:00.000Z'),
      };
    });
  });
  const loadRecentExerciseBlocks = jest.fn().mockImplementation(async ({ exerciseDefinitionId }: { exerciseDefinitionId: string }) => ({
    exerciseDefinitionId,
    limit: null,
    blocks: [],
  }));
  const loadSuggestedExercisePlan = jest.fn().mockResolvedValue(null);

  return {
    ExerciseTagDomainError,
    __resetTagStore: seedTagStore,
    __setListAssignedTagsFailureCount: (count: number) => {
      listAssignedTagsFailureCount = count;
    },
    attachExerciseTagToSessionExercise,
    completeSessionDraft: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      completedAt: new Date('2026-02-24T00:00:00.000Z'),
      durationSec: 0,
      wasAlreadyCompleted: false,
    }),
    createExerciseTagDefinition: createTagDefinition,
    deleteExerciseTagDefinition: deleteTagDefinition,
    formatSessionListCompactDuration: (durationSec: number | null) => {
      if (!durationSec || durationSec <= 0) {
        return '0m';
      }
      const totalMinutes = Math.floor(durationSec / 60);
      return `${totalMinutes}m`;
    },
    listExerciseTagDefinitions: listTagDefinitions,
    listSessionExerciseAssignedTags,
    listLocalGyms: jest.fn().mockResolvedValue([]),
    loadRecentExerciseBlocks,
    loadSuggestedExercisePlan,
    loadLocalGymById: jest.fn().mockResolvedValue(null),
    loadLatestSessionDraftSnapshot: jest.fn().mockResolvedValue(null),
    loadSessionSnapshotById: jest.fn().mockResolvedValue(null),
    persistCompletedSessionSnapshot,
    persistSessionDraftSnapshot,
    removeExerciseTagFromSessionExercise,
    renameExerciseTagDefinition: renameTagDefinition,
    setSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    undeleteExerciseTagDefinition: undeleteTagDefinition,
    upsertLocalGym: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockResolvedValue([
    {
      id: 'seed_barbell_back_squat',
      name: 'Barbell Squat',
      loadInputMode: 'total_load',
      deletedAt: null,
      mappings: [{ id: 'map-squat-quads', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
    },
    {
      id: 'seed_barbell_bench_press',
      name: 'Bench Press',
      loadInputMode: 'total_load',
      deletedAt: null,
      mappings: [
        { id: 'map-bench-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { id: 'map-bench-triceps', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    },
    {
      id: 'seed_dumbbell_bench_press',
      name: 'Dumbbell Bench Press',
      loadInputMode: 'per_side_load',
      deletedAt: null,
      mappings: [{ id: 'map-db-bench-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    },
    {
      id: 'seed_romanian_deadlift',
      name: 'Deadlift',
      deletedAt: null,
      mappings: [{ id: 'map-deadlift-hamstrings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' }],
    },
    {
      id: 'seed_overhead_press',
      name: 'Overhead Press',
      deletedAt: null,
      mappings: [{ id: 'map-overhead-press-delts', muscleGroupId: 'delts_front', weight: 1, role: 'primary' }],
    },
  ]),
  listExerciseCatalogMuscleGroups: jest.fn().mockResolvedValue([
    { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
    { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2 },
    { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3 },
    { id: 'hamstrings', displayName: 'Hamstrings', familyName: 'Legs', sortOrder: 4 },
  ]),
  saveExerciseCatalogExercise: jest.fn().mockImplementation(async (input: any) => ({
    id: input.id ?? 'custom-exercise-1',
    name: input.name.trim(),
    loadInputMode: input.loadInputMode,
    deletedAt: null,
    mappings: input.mappings.map((mapping: any, index: number) => ({
      id: `map-${index + 1}`,
      muscleGroupId: mapping.muscleGroupId,
      weight: mapping.weight,
      role: mapping.role,
    })),
  })),
}));

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  loadExerciseCatalogStatsRawHistory: jest.fn().mockResolvedValue({
    sessions: [],
    sessionExercises: [],
    exerciseSets: [],
  }),
  aggregateExerciseCatalogStats: jest.requireActual(
    '@/src/data/exercise-catalog-stats'
  ).aggregateExerciseCatalogStats,
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(() => {
      mockFocusCallbacks.add(callback);
      const cleanup = callback();
      return () => {
        mockFocusCallbacks.delete(callback);
        if (typeof cleanup === 'function') {
          cleanup();
        }
      };
    }, [callback]);
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  __triggerFocus: () => {
    for (const callback of [...mockFocusCallbacks]) {
      callback();
    }
  },
}));

const { __triggerFocus } = jest.requireMock('expo-router') as {
  __triggerFocus: () => void;
};

const {
  __resetTagStore: mockResetTagStore,
  __setListAssignedTagsFailureCount: mockSetListAssignedTagsFailureCount,
  attachExerciseTagToSessionExercise: mockAttachExerciseTagToSessionExercise,
  createExerciseTagDefinition: mockCreateExerciseTagDefinition,
  loadRecentExerciseBlocks: mockLoadRecentExerciseBlocks,
  loadSuggestedExercisePlan: mockLoadSuggestedExercisePlan,
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
} = jest.requireMock('@/src/data') as {
  __resetTagStore: () => void;
  __setListAssignedTagsFailureCount: (count: number) => void;
  attachExerciseTagToSessionExercise: jest.Mock;
  createExerciseTagDefinition: jest.Mock;
  loadRecentExerciseBlocks: jest.Mock;
  loadSuggestedExercisePlan: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
};

const { saveExerciseCatalogExercise: mockSaveExerciseCatalogExercise } = jest.requireMock(
  '@/src/data/exercise-catalog'
) as {
  saveExerciseCatalogExercise: jest.Mock;
};

const buildCompletedEditSnapshot = (overrides: Partial<any> = {}) => ({
  sessionId: 'completed-edit-1',
  gymId: null,
  status: 'completed',
  startedAt: new Date('2026-02-25T10:00:00.000Z'),
  completedAt: new Date('2026-02-25T10:45:00.000Z'),
  durationSec: 2700,
  deletedAt: null,
  createdAt: new Date('2026-02-25T10:00:00.000Z'),
  updatedAt: new Date('2026-02-25T10:45:00.000Z'),
  exercises: [
    {
      id: 'exercise-1',
      exerciseDefinitionId: 'seed_barbell_bench_press',
      name: 'Bench Press',
      machineName: null,
      sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
    },
  ],
  ...overrides,
});

const dismissEmptyStateIfPresent = async () => {
  await act(async () => {});
  const startButton = screen.queryByTestId('start-session-button');
  if (startButton) {
    fireEvent.press(startButton);
    await act(async () => {});
  }
};

const selectExerciseFromPicker = async (
  exerciseName: string,
  options: { addEmpty?: boolean } = {}
) => {
  const addEmpty = options.addEmpty ?? true;
  fireEvent.press(await screen.findByLabelText(`Select exercise ${exerciseName}`));
  if (addEmpty) {
    fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
  }
};

describe('SessionRecorderScreen exercise interactions', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockFocusCallbacks.clear();
    mockSearchParams = {};
    mockResetTagStore();
    mockSetListAssignedTagsFailureCount(0);
    mockAttachExerciseTagToSessionExercise.mockClear();
    mockCreateExerciseTagDefinition.mockClear();
    mockLoadRecentExerciseBlocks.mockReset();
    mockLoadRecentExerciseBlocks.mockImplementation(async ({ exerciseDefinitionId }: { exerciseDefinitionId: string }) => ({
      exerciseDefinitionId,
      limit: null,
      blocks: [],
    }));
    mockLoadSuggestedExercisePlan.mockReset();
    mockLoadSuggestedExercisePlan.mockResolvedValue(null);
    mockLoadSessionSnapshotById.mockReset();
    mockLoadSessionSnapshotById.mockResolvedValue(null);
    mockSaveExerciseCatalogExercise.mockClear();
    mockLogEvent.mockClear();
    __resetExerciseListPreferencesForTests();
    setExerciseListPreferences({ groupByMuscleFamily: false });
  });

  it('adds a preset exercise from the log flow and updates first set fields', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(screen.getByText('Select Exercise')).toBeTruthy();
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    await selectExerciseFromPicker('Barbell Squat');

    expect(screen.queryByText('Select Exercise')).toBeNull();
    expect(screen.getByText('Barbell Squat')).toBeTruthy();
    expect(screen.queryByTestId('exercise-1-set-header')).toBeNull();
    expect(screen.getByLabelText('Weight for exercise 1 set 1')).toBeTruthy();
    expect(screen.getByTestId('set-weight-unit-1-1')).toHaveTextContent('kg total');
    expect(screen.getByPlaceholderText('Reps')).toBeTruthy();
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.autoFocus).toBe(true);
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.selectTextOnFocus).toBeUndefined();
    expect(screen.getByLabelText('Reps for exercise 1 set 1').props.selectTextOnFocus).toBeUndefined();
    expect(screen.queryByText('No exercises logged yet.')).toBeNull();
    expect(screen.queryByText('No tags yet.')).toBeNull();
    expect(mockLogEvent).toHaveBeenCalledWith({
      level: 'info',
      source: 'app',
      event: 'session.exercise_added',
      message: 'A session exercise was added to the active workout log.',
      userId: 'user-1',
      context: {
        exerciseDefinitionId: 'seed_barbell_back_squat',
        exerciseName: 'Barbell Squat',
      },
    });

    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '225');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');

    expect(screen.getByDisplayValue('225')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy();

    await act(async () => {});
  });

  it('labels per-side exercise weight entry without changing the scalar input', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();
    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Dumbbell Bench Press');

    expect(screen.getByTestId('set-weight-unit-1-1')).toHaveTextContent('kg per side');
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '22');
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.value).toBe('22');
  });

  it('opens preselection for add-row picks, keeps Append plan disabled without valid history, and clears on search', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(await screen.findByTestId('exercise-picker-preselection-panel')).toBeTruthy();
    expect(screen.getByText('Add empty set')).toBeTruthy();
    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByText(/Unable/i)).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
    await waitFor(() => {
      expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
      expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
    });
  });

  it('shows Append plan disabled while the historical suggestion is loading', async () => {
    mockLoadSuggestedExercisePlan.mockImplementationOnce(() => new Promise(() => undefined));

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const appendButton = await screen.findByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId('exercise-picker-plan-source')).toBeNull();
  });

  it('previews a valid historical plan and appends it as planned rows into the recorder', async () => {
    mockLoadSuggestedExercisePlan
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sessionId: 'history-session-1',
        completedAt: new Date(2026, 5, 10, 18, 42),
        sessionExerciseIds: ['history-exercise-1', 'history-exercise-2'],
        sets: [
          {
            setId: 'history-set-1',
            sessionExerciseId: 'history-exercise-1',
            weightValue: '0',
            repsValue: '10',
            setType: 'warm_up',
          },
          {
            setId: 'history-set-2',
            sessionExerciseId: 'history-exercise-2',
            weightValue: '120',
            repsValue: '5',
            setType: 'rir_1',
          },
        ],
      });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Bench Press');
    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(mockLoadSuggestedExercisePlan).toHaveBeenLastCalledWith({
      exerciseDefinitionId: 'seed_barbell_back_squat',
    });
    expect(await screen.findByTestId('exercise-picker-plan-source')).toHaveTextContent(
      'From 2026-06-10 18:42'
    );
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/0kg/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/10 reps/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-2')).toHaveTextContent(/RIR 1/);

    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(appendButton);

    expect(screen.queryByText('Select Exercise')).toBeNull();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Barbell Squat')).toBeTruthy();
    expect(screen.getByTestId('session-exercise-card-2').props.accessibilityState?.selected).toBe(true);
    expect(screen.getByLabelText('Exercise options 2')).toBeTruthy();
    expect(screen.getByTestId('planned-set-row-2-1')).toHaveTextContent(/0kg/);
    expect(screen.getByTestId('planned-set-row-2-1')).toHaveTextContent(/10 reps/);
    expect(screen.getByTestId('planned-set-row-2-2')).toHaveTextContent(/120kg/);
    expect(screen.getByTestId('planned-set-row-2-2')).toHaveTextContent(/5 reps/);
    expect(screen.getByLabelText('Log set 1 as planned')).toBeTruthy();
    expect(screen.getByLabelText('Skip set 2')).toBeTruthy();
  });

  it('shows collapsible Past Records with date/current/max columns and swipe navigation', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: null,
      blocks: [
        {
          sessionId: 'session-new',
          completedAt: new Date('2026-05-24T10:00:00.000Z'),
          daysAgo: 2,
          sessionExerciseIds: ['se-new'],
          estimatedOneRepMax: 250.5,
          totalVolume: 1500,
          highestWeight: 205,
          rirAtMostTwoSetCount: 3,
        },
        {
          sessionId: 'session-old',
          completedAt: new Date('2026-05-17T10:00:00.000Z'),
          daysAgo: 9,
          sessionExerciseIds: ['se-old'],
          estimatedOneRepMax: 235,
          totalVolume: 1325,
          highestWeight: 195,
          rirAtMostTwoSetCount: 1,
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');

    const collapsedPanel = await screen.findByTestId('exercise-block-history-panel-1-collapsed');
    expect(collapsedPanel).toHaveTextContent('Past Records');
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.queryByText('Current')).toBeNull();

    fireEvent.press(collapsedPanel);
    await screen.findByTestId('exercise-block-history-panel-1');
    expect(screen.getByText('Past Records')).toBeTruthy();
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.getByText('2026-05-24')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
    expect(screen.getByText(/2d ago/)).toBeTruthy();
    const selectedDateHeader = screen.getByText('2026-05-24');
    expect(selectedDateHeader.props.children).toBe('2026-05-24');
    expect(selectedDateHeader.props.numberOfLines).toBe(1);
    expect(screen.getByText(/swipe for records/)).toBeTruthy();
    expect(screen.queryByText(/swipe records/)).toBeNull();
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-date')).toHaveTextContent('250.5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-date')).toHaveTextContent('1500');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-date')).toHaveTextContent('205');
    expect(screen.getByText('Near failure')).toBeTruthy();
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-date')).toHaveTextContent('3');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-current')).toHaveTextContent('0');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-max')).toHaveTextContent('250.5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-max')).toHaveTextContent('1500');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-max')).toHaveTextContent('205');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-max')).toHaveTextContent('3');
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-est-1rm-max').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-volume-max').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-highest-max').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-rir-count-max').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
    expect(screen.queryByTestId('exercise-block-history-panel-1-newer')).toBeNull();
    expect(screen.queryByTestId('exercise-block-history-panel-1-older')).toBeNull();
    expect(screen.getByTestId('exercise-block-history-panel-1-toggle').props.accessibilityState.expanded).toBe(true);
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-highest-date').props.style).color).toBe(
      uiColors.heatmapBucket4
    );

    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-toggle'));
    expect(screen.getByTestId('exercise-block-history-panel-1-collapsed')).toHaveTextContent(
      'Past Records'
    );
    expect(screen.queryByTestId('exercise-block-history-panel-1-est-1rm-current')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-collapsed'));
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).toHaveTextContent('-');
    expect(mockLoadRecentExerciseBlocks).toHaveBeenCalledTimes(1);
    const reopenedPanel = screen.getByTestId('exercise-block-history-panel-1');

    swipeRight(reopenedPanel);
    expect(screen.getByText(/9d ago/)).toBeTruthy();
    expect(screen.getByText('2026-05-17')).toBeTruthy();
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-date')).toHaveTextContent('235');

    swipeLeft(reopenedPanel);
    expect(screen.getByText(/2d ago/)).toBeTruthy();
    expect(screen.getByText('2026-05-24')).toBeTruthy();
  });

  it('updates current comparison metrics live from unsaved sets', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: null,
      blocks: [
        {
          sessionId: 'session-new',
          completedAt: new Date('2026-05-24T10:00:00.000Z'),
          daysAgo: 2,
          sessionExerciseIds: ['se-new'],
          estimatedOneRepMax: 250.5,
          totalVolume: 1500,
          highestWeight: 205,
          rirAtMostTwoSetCount: 3,
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));

    const firstSetTypeButton = screen.getByTestId('set-quality-button-1-1');
    fireEvent.press(firstSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '500');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('2500');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('500');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-current')).toHaveTextContent('0');

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));
    const secondSetTypeButton = screen.getByTestId('set-quality-button-1-2');
    fireEvent.press(secondSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 2'), '260');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 2'), '6');

    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('4060');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('500');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).not.toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-current')).toHaveTextContent('1');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-date')).toHaveTextContent('250.5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-max')).toHaveTextContent('4060');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-max')).toHaveTextContent('500');
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-highest-date').props.style).color).not.toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-highest-current').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(screen.getByTestId('exercise-block-history-panel-1-highest-max').props.style).color).toBe(
      uiColors.heatmapBucket4
    );
  });

  it('uses the first Past Records tap to collapse an active editable set row without opening history', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: null,
      blocks: [
        {
          sessionId: 'session-new',
          completedAt: new Date('2026-05-24T10:00:00.000Z'),
          daysAgo: 2,
          sessionExerciseIds: ['se-new'],
          estimatedOneRepMax: 250.5,
          totalVolume: 1500,
          highestWeight: 205,
          rirAtMostTwoSetCount: 3,
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '120');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');

    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));

    expect(screen.queryByLabelText('Weight for exercise 1 set 1')).toBeNull();
    expect(screen.getByTestId('exercise-block-history-panel-1-collapsed')).toHaveTextContent('Past Records');
    expect(screen.queryByTestId('exercise-block-history-panel-1-est-1rm-current')).toBeNull();

    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1')).toHaveTextContent(/2026-05-24/);
  });

  it('keeps set entry usable when exercise block history is empty or unavailable', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: null,
      blocks: [],
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');

    expect(await screen.findByTestId('exercise-block-history-panel-1-empty-collapsed')).toHaveTextContent(
      'Past Records'
    );
    expect(screen.queryByText('No past records')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-empty-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1-empty')).toHaveTextContent(
      /No past records/
    );
    expect(screen.getAllByText('No past records')).toHaveLength(1);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '135');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '8');
    expect(screen.getByDisplayValue('135')).toBeTruthy();
    expect(screen.getByDisplayValue('8')).toBeTruthy();

    mockLoadRecentExerciseBlocks.mockRejectedValueOnce(new Error('history unavailable'));
    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Bench Press');

    expect(await screen.findByTestId('exercise-block-history-panel-2-error-collapsed')).toHaveTextContent(
      'Past Records'
    );
    expect(screen.queryByText('Past records unavailable')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-2-error-collapsed'));
    expect(screen.getByTestId('exercise-block-history-panel-2-error-collapsed')).toHaveTextContent(
      'Past Records'
    );
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-2-error-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-2-error')).toHaveTextContent(
      /Past records unavailable/
    );
    fireEvent.press(screen.getByLabelText('Add set to exercise 2'));
    expect(screen.getByLabelText('Weight for exercise 2 set 2')).toBeTruthy();
  });

  it('resets the block navigator when an exercise card changes exercise definition', async () => {
    mockLoadRecentExerciseBlocks
      .mockResolvedValueOnce({
        exerciseDefinitionId: 'seed_barbell_back_squat',
        limit: null,
        blocks: [
          {
            sessionId: 'squat-history',
            completedAt: new Date('2026-05-24T10:00:00.000Z'),
            daysAgo: 2,
            sessionExerciseIds: ['se-squat'],
            estimatedOneRepMax: 250,
            totalVolume: 1500,
            highestWeight: 205,
            rirAtMostTwoSetCount: 3,
          },
        ],
      })
      .mockResolvedValueOnce({
        exerciseDefinitionId: 'seed_barbell_bench_press',
        limit: null,
        blocks: [
          {
            sessionId: 'bench-history',
            completedAt: new Date('2026-05-21T10:00:00.000Z'),
            daysAgo: 5,
            sessionExerciseIds: ['se-bench'],
            estimatedOneRepMax: 190,
            totalVolume: 980,
            highestWeight: 165,
            rirAtMostTwoSetCount: 2,
          },
        ],
      });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1')).toHaveTextContent(/2d ago/);

    fireEvent.press(screen.getByLabelText('Exercise options 1'));
    fireEvent.press(screen.getByLabelText('Change exercise'));
    await selectExerciseFromPicker('Bench Press', { addEmpty: false });
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();

    await waitFor(() => {
      expect(mockLoadRecentExerciseBlocks).toHaveBeenLastCalledWith({
        exerciseDefinitionId: 'seed_barbell_bench_press',
      });
    });
    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1')).toHaveTextContent(/5d ago/);
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.queryByText('Barbell Squat')).toBeNull();
  });

  it('cycles set type from the row button and supports long-press selection modal', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');

    const setTypeButton = screen.getByTestId('set-quality-button-1-1');
    expect(setTypeButton.findByType('Text').props.children).toBe('•');

    fireEvent.press(setTypeButton);
    expect(screen.getByText('W-Up')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 0')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 1')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 2')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByLabelText('Quality for exercise 1 set 1: none')).toBeTruthy();

    fireEvent(setTypeButton, 'onLongPress');
    expect(screen.getByLabelText('Choose W-Up set type')).toBeTruthy();
    expect(screen.getByLabelText('Choose RIR 1 set type')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Choose RIR 1 set type'));
    expect(screen.getByText('RIR 1')).toBeTruthy();

    await act(async () => {});
  });

  it('constrains set inputs and allows zero weight while keeping zero reps invalid', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');

    const weightInputLabel = 'Weight for exercise 1 set 1';
    const repsInputLabel = 'Reps for exercise 1 set 1';

    fireEvent.changeText(screen.getByLabelText(weightInputLabel), '12.5kg');
    fireEvent.changeText(screen.getByLabelText(repsInputLabel), '8.5');
    expect(screen.getByLabelText(weightInputLabel).props.value).toBe('');
    expect(screen.getByLabelText(repsInputLabel).props.value).toBe('');

    fireEvent.changeText(screen.getByLabelText(weightInputLabel), '0');
    fireEvent.changeText(screen.getByLabelText(repsInputLabel), '0');

    const zeroWeightStyle = StyleSheet.flatten(screen.getByTestId('set-weight-input-shell-1-1').props.style);
    const invalidRepsStyle = StyleSheet.flatten(screen.getByLabelText(repsInputLabel).props.style);
    expect(zeroWeightStyle.borderColor).toBe(uiColors.borderDefault);
    expect(invalidRepsStyle.borderColor).toBe(uiColors.actionDangerSubtleBorder);

    fireEvent.changeText(screen.getByLabelText(weightInputLabel), '135.5');
    fireEvent.changeText(screen.getByLabelText(repsInputLabel), '8');

    const validWeightStyle = StyleSheet.flatten(screen.getByTestId('set-weight-input-shell-1-1').props.style);
    const validRepsStyle = StyleSheet.flatten(screen.getByLabelText(repsInputLabel).props.style);
    expect(validWeightStyle.borderColor).toBe(uiColors.borderDefault);
    expect(validRepsStyle.borderColor).toBe(uiColors.borderDefault);

    await act(async () => {});
  });

  it('defaults a new set from the previous set in the same exercise', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');

    const firstSetTypeButton = screen.getByTestId('set-quality-button-1-1');
    fireEvent.press(firstSetTypeButton);
    fireEvent.press(firstSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '135.5');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '8');

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));

    expect(screen.queryByLabelText('Weight for exercise 1 set 1')).toBeNull();
    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('135.5kg')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.autoFocus).toBe(true);
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.selectTextOnFocus).toBeUndefined();
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.selection).toBeUndefined();
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.value).toBe('135.5');
    expect(screen.getByLabelText('Reps for exercise 1 set 2').props.value).toBe('8');
    expect(screen.getAllByText('RIR 0')).toHaveLength(2);

    fireEvent(screen.getByLabelText('Reps for exercise 1 set 2'), 'focus');
    expect(screen.getByLabelText('Reps for exercise 1 set 2').props.selection).toBeUndefined();

    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 2'), '10');
    expect(screen.getByLabelText('Reps for exercise 1 set 2').props.value).toBe('10');
    expect(screen.getByLabelText('Reps for exercise 1 set 2').props.selection).toBeUndefined();

    await act(async () => {});
  });

  it('filters exercise picker by all query words across names and primary muscles only', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Deadlift')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Overhead Press')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '   squAT   press  ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  CHEST bench ');
    await waitFor(() => {
      expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  front press ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.getByLabelText('Select exercise Overhead Press')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  triceps ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
      expect(screen.getByText('No exercises match that filter.')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  delts_front ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });
  }, 30000);

  it('uses grouped picker rows with shared stats when grouping is enabled', async () => {
    __resetExerciseListPreferencesForTests();

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Chest exercises 2')).toBeTruthy();
    expect(screen.getByLabelText('Core exercises 0')).toBeTruthy();
    expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();

    fireEvent.press(screen.getByLabelText('Chest exercises 2'));

    expect(await screen.findByLabelText('Select exercise Bench Press')).toBeTruthy();
    expect(screen.getAllByText('Never done')).toHaveLength(2);
  });

  it('creates a new exercise inline from the picker and keeps set add/remove interactions intact', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(screen.getByLabelText('Open inline exercise create'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByText('Create Exercise')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Custom Press');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select primary muscle Chest'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() => {
      expect(mockSaveExerciseCatalogExercise).toHaveBeenCalledWith({
        id: undefined,
        name: 'Custom Press',
        loadInputMode: 'total_load',
        mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      });
    });

    expect(screen.getByText('Custom Press')).toBeTruthy();
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.autoFocus).toBe(true);
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.selectTextOnFocus).toBeUndefined();

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));
    expect(screen.getByLabelText('Weight for exercise 1 set 2')).toBeTruthy();
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.autoFocus).toBe(false);
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.autoFocus).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 2'), '10');
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 2'), '70');

    expect(screen.queryByLabelText('Remove set 1 from exercise 1')).toBeNull();
    swipeLeft(screen.getByTestId('set-swipe-delete-1-1'));
    expect(screen.queryByLabelText('Weight for exercise 1 set 2')).toBeNull();
    expect(screen.getByLabelText('Weight for exercise 1 set 1')).toBeTruthy();
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    expect(screen.getByDisplayValue('70')).toBeTruthy();

    await act(async () => {});
  });

  it('adds and removes assigned tags from a logged exercise card', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    expect(await screen.findByLabelText('Tag search input')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Select tag Paused'));

    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    const pausedTagOption = await screen.findByLabelText('Select tag Paused');
    expect(pausedTagOption.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText('Dismiss add tag modal overlay'));

    fireEvent.press(screen.getByLabelText('Remove tag Paused from exercise 1'));
    await act(async () => {});

    await waitFor(() => {
      expect(screen.queryByText('Paused')).toBeNull();
    });
  });

  it('recovers when second tag attach hits a transient unique constraint', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    fireEvent.press(await screen.findByLabelText('Select tag Paused'));
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeTruthy();
    });

    mockAttachExerciseTagToSessionExercise.mockImplementationOnce(async (input: any) => {
      expect(input.tagDefinitionId).toBe('tag-2');
      throw new Error(
        'UNIQUE constraint failed: session_exercise_tags.session_exercise_id, session_exercise_tags.exercise_tag_definition_id'
      );
    });
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    fireEvent.press(await screen.findByLabelText('Select tag Tempo'));

    await waitFor(() => {
      expect(screen.getByText(/UNIQUE constraint failed/i)).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Select tag Tempo'));

    await waitFor(() => {
      expect(screen.queryByText(/UNIQUE constraint failed/i)).toBeNull();
      expect(screen.getByText('Paused')).toBeTruthy();
      expect(screen.getByText('Tempo')).toBeTruthy();
    });
  });

  it('creates, renames, deletes, undeletes, and assigns tags from manage flow', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Bench Press');
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    expect(await screen.findByLabelText('Tag search input')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Tag search input'), 'Competition');
    fireEvent.press(screen.getByLabelText('Add tag'));
    await waitFor(() => {
      expect(screen.getByText('Competition')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    fireEvent.press(await screen.findByLabelText('Open manage tags'));
    expect(screen.getByText('Manage tags')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Rename tag Competition'));
    fireEvent.changeText(screen.getByLabelText('Rename tag Competition'), 'Competition Pause');
    fireEvent.press(screen.getByLabelText('Save tag rename'));
    await waitFor(() => {
      expect(screen.getAllByText('Competition Pause').length).toBeGreaterThan(0);
    });

    fireEvent.press(screen.getByLabelText('Delete tag Competition Pause'));
    await waitFor(() => {
      expect(screen.queryByText('Competition Pause')).toBeNull();
    });

    fireEvent.press(screen.getByText('Show deleted'));
    expect(screen.getAllByText('Competition Pause').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('Undelete tag Competition Pause'));
    fireEvent.press(screen.getByText('Hide deleted'));
    expect(screen.getAllByText('Competition Pause').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.queryByText('Loading tags...')).toBeNull();
    });
    fireEvent.press(screen.getByLabelText('Dismiss add tag modal overlay'));
    fireEvent.press(screen.getByLabelText('Remove tag Competition Pause from exercise 1'));
    await act(async () => {});
    await waitFor(() => {
      expect(screen.queryByText('Competition Pause')).toBeNull();
    });
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    fireEvent.press(await screen.findByLabelText('Select tag Competition Pause'));

    await waitFor(() => {
      expect(screen.getAllByText('Competition Pause').length).toBeGreaterThan(0);
    });
  });

  it('creates and immediately assigns a new tag to the active exercise', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Deadlift');
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    expect(await screen.findByLabelText('Tag search input')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Tag search input'), 'Top Set');
    fireEvent.press(screen.getByLabelText('Add tag'));

    await waitFor(() => {
      expect(screen.getByText('Top Set')).toBeTruthy();
    });

    expect(mockCreateExerciseTagDefinition).toHaveBeenCalledWith({
      exerciseDefinitionId: 'seed_romanian_deadlift',
      name: 'Top Set',
    });
    expect(mockAttachExerciseTagToSessionExercise).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionExerciseId: expect.any(String),
        tagDefinitionId: 'tag-5',
      })
    );
  });

  it('keeps add button disabled for empty or duplicate names', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await selectExerciseFromPicker('Bench Press');
    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));

    await waitFor(() => {
      expect(screen.queryByText('Loading tags...')).toBeNull();
    });
    expect(screen.getByLabelText('Add tag').props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Tag search input'), 'Close Grip');
    await waitFor(() => {
      expect(screen.getByLabelText('Add tag').props.accessibilityState?.disabled).toBe(true);
    });

    fireEvent.changeText(screen.getByLabelText('Tag search input'), 'Board Press');
    await waitFor(() => {
      expect(screen.getByLabelText('Add tag').props.accessibilityState?.disabled).toBe(false);
    });
  });

  it('routes Manage to exercise catalog', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open exercise catalog manage flow'));
    expect(mockPush).toHaveBeenCalledWith('/exercise-catalog?source=session-recorder&intent=manage');
    expect(screen.queryByText('Select Exercise')).toBeNull();
  });

  it('reopens the exercise picker on focus after routing to catalog', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open exercise catalog manage flow'));
    expect(screen.queryByText('Select Exercise')).toBeNull();

    act(() => {
      __triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByText('Select Exercise')).toBeTruthy();
    });
  });

  it('uses the same inline add-new flow in completed-edit mode', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByText('Bench Press')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(screen.getByLabelText('Open inline exercise create'));
    expect(await screen.findByText('Create Exercise')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Cable Fly');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select primary muscle Chest'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() => {
      expect(mockSaveExerciseCatalogExercise).toHaveBeenCalledWith({
        id: undefined,
        name: 'Cable Fly',
        loadInputMode: 'total_load',
        mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      });
      expect(screen.getByText('Cable Fly')).toBeTruthy();
    });
  });

  it('supports set-type cycle and modal selection in completed-edit mode', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByText('Bench Press')).toBeTruthy();
    });

    const setTypeButton = screen.getByTestId('set-quality-button-1-1');

    fireEvent.press(setTypeButton);
    expect(screen.getByText('W-Up')).toBeTruthy();

    fireEvent(setTypeButton, 'onLongPress');
    expect(screen.getByLabelText('Choose None set type')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Choose None set type'));
    expect(setTypeButton.findByType('Text').props.children).toBe('•');
  });

  it('supports tag attach/remove in completed-edit mode', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByText('Bench Press')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Add tag to exercise 1'));
    fireEvent.press(await screen.findByLabelText('Select tag Close Grip'));

    await waitFor(() => {
      expect(screen.getByText('Close Grip')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Remove tag Close Grip from exercise 1'));
    await act(async () => {});
    await waitFor(() => {
      expect(screen.queryByText('Close Grip')).toBeNull();
    });
  });

  it('removes an exercise and updates nested set totals', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    await selectExerciseFromPicker('Barbell Squat');
    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Bench Press')).toBeTruthy();
    await selectExerciseFromPicker('Bench Press');

    expect(screen.getByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.getByLabelText('Exercise options 2')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise options 2'));
    expect(screen.getByLabelText('Change exercise')).toBeTruthy();
    fireEvent.press(screen.getByText('Change exercise'));
    expect(await screen.findByLabelText('Select exercise Deadlift')).toBeTruthy();
    await selectExerciseFromPicker('Deadlift', { addEmpty: false });
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
    expect(screen.getByText('Deadlift')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise options 2'));
    fireEvent.press(screen.getByText('Remove exercise'));

    expect(screen.getByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.queryByLabelText('Exercise options 2')).toBeNull();
    expect(screen.queryByText('Deadlift')).toBeNull();

    await act(async () => {});
  });
});
