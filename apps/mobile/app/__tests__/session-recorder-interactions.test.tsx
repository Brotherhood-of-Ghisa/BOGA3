import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { uiColors } from '@/components/ui';
import SessionRecorderScreen from '../(tabs)/session-recorder';

const mockPush = jest.fn();
const mockLogEvent = jest.fn();
const mockFocusCallbacks = new Set<() => void | (() => void)>();
let mockSearchParams: Record<string, string | undefined> = {};

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
    limit: 5,
    blocks: [],
  }));

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
      deletedAt: null,
      mappings: [{ id: 'map-squat-quads', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
    },
    {
      id: 'seed_barbell_bench_press',
      name: 'Bench Press',
      deletedAt: null,
      mappings: [
        { id: 'map-bench-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { id: 'map-bench-triceps', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
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
    deletedAt: null,
    mappings: input.mappings.map((mapping: any, index: number) => ({
      id: `map-${index + 1}`,
      muscleGroupId: mapping.muscleGroupId,
      weight: mapping.weight,
      role: mapping.role,
    })),
  })),
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
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
} = jest.requireMock('@/src/data') as {
  __resetTagStore: () => void;
  __setListAssignedTagsFailureCount: (count: number) => void;
  attachExerciseTagToSessionExercise: jest.Mock;
  createExerciseTagDefinition: jest.Mock;
  loadRecentExerciseBlocks: jest.Mock;
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
      limit: 5,
      blocks: [],
    }));
    mockLoadSessionSnapshotById.mockReset();
    mockLoadSessionSnapshotById.mockResolvedValue(null);
    mockSaveExerciseCatalogExercise.mockClear();
    mockLogEvent.mockClear();
  });

  it('adds a preset exercise from the log flow and updates first set fields', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();

    fireEvent.press(screen.getByText('Log new exercise'));
    expect(screen.getByText('Select Exercise')).toBeTruthy();
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Select exercise Barbell Squat'));

    expect(screen.queryByText('Select Exercise')).toBeNull();
    expect(screen.getByText('Barbell Squat')).toBeTruthy();
    expect(screen.queryByTestId('exercise-1-set-header')).toBeNull();
    expect(screen.getByLabelText('Weight for exercise 1 set 1')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
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

  it('shows collapsible previous/current block comparison and navigates older/newer in place', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: 5,
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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const collapsedPanel = await screen.findByTestId('exercise-block-history-panel-1-collapsed');
    expect(collapsedPanel).toHaveTextContent('Past blocks');
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.queryByText('Current')).toBeNull();

    fireEvent.press(collapsedPanel);
    await screen.findByTestId('exercise-block-history-panel-1');
    expect(screen.getByText('Past blocks')).toBeTruthy();
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('2d ago')).toBeTruthy();
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-previous')).toHaveTextContent('250.5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-previous')).toHaveTextContent('1500');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-previous')).toHaveTextContent('205');
    expect(screen.getByText('Near failure')).toBeTruthy();
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-previous')).toHaveTextContent('3');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-current')).toHaveTextContent('0');
    expect(screen.getByTestId('exercise-block-history-panel-1-newer').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('exercise-block-history-panel-1-older').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('exercise-block-history-panel-1-newer').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('exercise-block-history-panel-1-older').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId('exercise-block-history-panel-1-toggle').props.accessibilityState.expanded).toBe(true);

    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-toggle'));
    expect(screen.getByTestId('exercise-block-history-panel-1-collapsed')).toHaveTextContent(
      'Past blocks'
    );
    expect(screen.queryByTestId('exercise-block-history-panel-1-est-1rm-current')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-collapsed'));
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).toHaveTextContent('-');
    expect(mockLoadRecentExerciseBlocks).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-older'));
    expect(screen.getByText('9d ago')).toBeTruthy();
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-previous')).toHaveTextContent('235');
    expect(screen.getByTestId('exercise-block-history-panel-1-newer').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId('exercise-block-history-panel-1-older').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-newer'));
    expect(screen.getByText('2d ago')).toBeTruthy();
  });

  it('updates current comparison metrics live from unsaved working sets', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: 5,
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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));

    const firstSetTypeButton = screen.getByTestId('set-quality-button-1-1');
    fireEvent.press(firstSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '500');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');
    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('-');

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));
    const secondSetTypeButton = screen.getByTestId('set-quality-button-1-2');
    fireEvent.press(secondSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 2'), '200');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 2'), '5');

    expect(screen.getByTestId('exercise-block-history-panel-1-volume-current')).toHaveTextContent('1000');
    expect(screen.getByTestId('exercise-block-history-panel-1-highest-current')).toHaveTextContent('200');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-current')).not.toHaveTextContent('-');
    expect(screen.getByTestId('exercise-block-history-panel-1-rir-count-current')).toHaveTextContent('1');
    expect(screen.getByTestId('exercise-block-history-panel-1-est-1rm-previous')).toHaveTextContent('250.5');
  });

  it('keeps set entry usable when exercise block history is empty or unavailable', async () => {
    mockLoadRecentExerciseBlocks.mockResolvedValueOnce({
      exerciseDefinitionId: 'seed_barbell_back_squat',
      limit: 5,
      blocks: [],
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(await screen.findByTestId('exercise-block-history-panel-1-empty-collapsed')).toHaveTextContent(
      'Past blocks'
    );
    expect(screen.queryByText('No previous blocks')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-1-empty-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1-empty')).toHaveTextContent(
      /No previous blocks/
    );
    expect(screen.getAllByText('No previous blocks')).toHaveLength(1);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '135');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '8');
    expect(screen.getByDisplayValue('135')).toBeTruthy();
    expect(screen.getByDisplayValue('8')).toBeTruthy();

    mockLoadRecentExerciseBlocks.mockRejectedValueOnce(new Error('history unavailable'));
    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Bench Press'));

    expect(await screen.findByTestId('exercise-block-history-panel-2-error-collapsed')).toHaveTextContent(
      'Past blocks'
    );
    expect(screen.queryByText('Previous blocks unavailable')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-block-history-panel-2-error-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-2-error')).toHaveTextContent(
      /Previous blocks unavailable/
    );
    fireEvent.press(screen.getByLabelText('Add set to exercise 2'));
    expect(screen.getByLabelText('Weight for exercise 2 set 2')).toBeTruthy();
  });

  it('resets the block navigator when an exercise card changes exercise definition', async () => {
    mockLoadRecentExerciseBlocks
      .mockResolvedValueOnce({
        exerciseDefinitionId: 'seed_barbell_back_squat',
        limit: 5,
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
        limit: 5,
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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.press(await screen.findByTestId('exercise-block-history-panel-1-collapsed'));
    expect(await screen.findByTestId('exercise-block-history-panel-1')).toHaveTextContent(/2d ago/);

    fireEvent.press(screen.getByLabelText('Exercise options 1'));
    fireEvent.press(screen.getByLabelText('Change exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Bench Press'));

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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const setTypeButton = screen.getByTestId('set-quality-button-1-1');
    expect(setTypeButton.findByType('Text').props.children).toBe('•');

    fireEvent.press(setTypeButton);
    expect(screen.getByText('WUp')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 0')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 1')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByText('RIR 2')).toBeTruthy();
    fireEvent.press(setTypeButton);
    expect(screen.getByLabelText('Quality for exercise 1 set 1: none')).toBeTruthy();

    fireEvent(setTypeButton, 'onLongPress');
    expect(screen.getByLabelText('Choose WUp set type')).toBeTruthy();
    expect(screen.getByLabelText('Choose RIR 1 set type')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Choose RIR 1 set type'));
    expect(screen.getByText('RIR 1')).toBeTruthy();

    await act(async () => {});
  });

  it('constrains set inputs and allows zero weight while keeping zero reps invalid', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const firstSetTypeButton = screen.getByTestId('set-quality-button-1-1');
    fireEvent.press(firstSetTypeButton);
    fireEvent.press(firstSetTypeButton);
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '135.5');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '8');

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));

    expect(screen.queryByLabelText('Weight for exercise 1 set 1')).toBeNull();
    expect(screen.getByText('Set 1 · 135.5kg · 8 reps')).toBeTruthy();
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

    fireEvent.press(screen.getByLabelText('Remove set 1 from exercise 1'));
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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
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
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
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
    fireEvent.press(await screen.findByLabelText('Select exercise Bench Press'));
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
    fireEvent.press(await screen.findByLabelText('Select exercise Deadlift'));
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
    fireEvent.press(await screen.findByLabelText('Select exercise Bench Press'));
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
    expect(screen.getByText('WUp')).toBeTruthy();

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
    fireEvent.press(screen.getByLabelText('Select exercise Barbell Squat'));
    fireEvent.press(screen.getByText('Log new exercise'));
    expect(await screen.findByLabelText('Select exercise Bench Press')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Select exercise Bench Press'));

    expect(screen.getByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.getByLabelText('Exercise options 2')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise options 2'));
    expect(screen.getByLabelText('Change exercise')).toBeTruthy();
    fireEvent.press(screen.getByText('Change exercise'));
    expect(await screen.findByLabelText('Select exercise Deadlift')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Select exercise Deadlift'));
    expect(screen.getByText('Deadlift')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise options 2'));
    fireEvent.press(screen.getByText('Remove exercise'));

    expect(screen.getByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.queryByLabelText('Exercise options 2')).toBeNull();
    expect(screen.queryByText('Deadlift')).toBeNull();

    await act(async () => {});
  });
});
