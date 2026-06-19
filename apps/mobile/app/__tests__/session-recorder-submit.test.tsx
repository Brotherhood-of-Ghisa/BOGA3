import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SessionRecorderScreen from '../(tabs)/session-recorder';

const dismissEmptyStateIfPresent = async () => {
  await act(async () => {});
  const startButton = screen.queryByTestId('start-session-button');
  if (startButton) {
    fireEvent.press(startButton);
    await act(async () => {});
  }
};

let mockSearchParams: Record<string, string | undefined> = {};
const mockLogEvent = jest.fn();

const swipeLeft = (target: ReturnType<typeof screen.getByTestId>) => {
  fireEvent(target, 'touchStart', { nativeEvent: { pageX: 220 } });
  fireEvent(target, 'touchEnd', { nativeEvent: { pageX: 120 } });
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

jest.mock('@/src/data', () => ({
  attachExerciseTagToSessionExercise: jest.fn().mockResolvedValue(undefined),
  createExerciseTagDefinition: jest.fn().mockResolvedValue({
    id: 'tag-1',
    exerciseDefinitionId: 'seed_barbell_back_squat',
    name: 'Paused',
    normalizedName: 'paused',
    deletedAt: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
  }),
  deleteExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  formatSessionListCompactDuration: (durationSec: number | null) => {
    if (!durationSec || durationSec <= 0) {
      return '0m';
    }
    const totalMinutes = Math.floor(durationSec / 60);
    return `${totalMinutes}m`;
  },
  listExerciseTagDefinitions: jest.fn().mockResolvedValue([]),
  listSessionExerciseAssignedTags: jest.fn().mockResolvedValue([]),
  listLocalGyms: jest.fn().mockResolvedValue([]),
  loadRecentExerciseBlocks: jest.fn().mockImplementation(async ({ exerciseDefinitionId }: { exerciseDefinitionId: string }) => ({
    exerciseDefinitionId,
    limit: null,
    blocks: [],
  })),
  loadLocalGymById: jest.fn().mockResolvedValue(null),
  loadLatestSessionDraftSnapshot: jest.fn().mockResolvedValue(null),
  loadSessionSnapshotById: jest.fn().mockResolvedValue(null),
  persistCompletedSessionSnapshot: jest.fn().mockResolvedValue({
    sessionId: 'test-session',
    completedAt: new Date('2026-02-24T00:00:00.000Z'),
    durationSec: 0,
  }),
  persistSessionDraftSnapshot: jest.fn().mockResolvedValue({ sessionId: 'test-session' }),
  removeExerciseTagFromSessionExercise: jest.fn().mockResolvedValue(undefined),
  renameExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  setSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  undeleteExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  upsertLocalGym: jest.fn().mockResolvedValue(undefined),
  completeSessionDraft: jest.fn().mockResolvedValue({
    sessionId: 'test-session',
    completedAt: new Date('2026-02-24T00:00:00.000Z'),
    durationSec: 0,
    wasAlreadyCompleted: false,
  }),
}));

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockResolvedValue([
    { id: 'seed_barbell_back_squat', name: 'Barbell Squat', deletedAt: null, mappings: [] },
    { id: 'seed_barbell_bench_press', name: 'Bench Press', deletedAt: null, mappings: [] },
    { id: 'seed_romanian_deadlift', name: 'Deadlift', deletedAt: null, mappings: [] },
  ]),
  listExerciseCatalogMuscleGroups: jest.fn().mockResolvedValue([]),
}));

jest.mock('expo-router', () => {
  const mockReplace = jest.fn();
  const mockDismissTo = jest.fn();
  const mockDismissAll = jest.fn();
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      const React = jest.requireActual('react');
      React.useEffect(() => callback(), [callback]);
    },
    useLocalSearchParams: () => mockSearchParams,
    useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
    useRouter: () => ({
      replace: mockReplace,
      dismissTo: mockDismissTo,
      dismissAll: mockDismissAll,
      push: jest.fn(),
    }),
    __mockReplace: mockReplace,
    __mockDismissTo: mockDismissTo,
    __mockDismissAll: mockDismissAll,
  };
});

const {
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
  persistCompletedSessionSnapshot: mockPersistCompletedSessionSnapshot,
  persistSessionDraftSnapshot: mockPersistSessionDraftSnapshot,
  completeSessionDraft: mockCompleteSessionDraft,
} = jest.requireMock('@/src/data') as {
  loadSessionSnapshotById: jest.Mock;
  persistCompletedSessionSnapshot: jest.Mock;
  persistSessionDraftSnapshot: jest.Mock;
  completeSessionDraft: jest.Mock;
};

const {
  __mockReplace: mockReplace,
  __mockDismissTo: mockDismissTo,
  __mockDismissAll: mockDismissAll,
} = jest.requireMock('expo-router') as {
  __mockReplace: jest.Mock;
  __mockDismissTo: jest.Mock;
  __mockDismissAll: jest.Mock;
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
      machineName: 'Flat Bench',
      sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
    },
  ],
  ...overrides,
});

describe('SessionRecorderScreen submit cleanup flow', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockLoadSessionSnapshotById.mockClear();
    mockPersistCompletedSessionSnapshot.mockClear();
    mockPersistSessionDraftSnapshot.mockClear();
    mockCompleteSessionDraft.mockClear();
    mockReplace.mockClear();
    mockDismissTo.mockClear();
    mockDismissAll.mockClear();
  });

  it('allows submit without gym selection and preserves zero-weight sets', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '0');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');
    fireEvent.press(screen.getByText('Submit Session'));

    expect(screen.queryByText('Session submitted (UI only)')).toBeNull();
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          exercises: [
            expect.objectContaining({
              sets: [
                expect.objectContaining({
                  repsValue: '5',
                  weightValue: '0',
                }),
              ],
            }),
          ],
        })
      );
      expect(mockCompleteSessionDraft).toHaveBeenCalledWith('test-session');
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
  });

  it('clears the stack back to the root list on submit so the list header has no back button', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '225');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');
    fireEvent.press(screen.getByText('Submit Session'));

    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalled();
      expect(mockCompleteSessionDraft).toHaveBeenCalledWith('test-session');
    });

    expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    expect(mockDismissAll).not.toHaveBeenCalled();
  });

  it('shows incomplete-set modal with go-back and remove-and-submit actions', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByLabelText('Select gym Westside Barbell Club'));
    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '225');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');
    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 2'), '205');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 2'), '');

    fireEvent.press(screen.getByText('Submit Session'));
    expect(screen.getByText('Remove incomplete sets and submit?')).toBeTruthy();

    fireEvent.press(screen.getByText('Go back to edit session'));
    expect(screen.queryByText('Remove incomplete sets and submit?')).toBeNull();
    expect(screen.queryByText('Session submitted (UI only)')).toBeNull();

    fireEvent.press(screen.getByText('Submit Session'));
    fireEvent.press(screen.getByText('Remove incomplete sets and submit'));

    expect(screen.queryByText('Session submitted (UI only)')).toBeNull();
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalled();
      expect(mockCompleteSessionDraft).toHaveBeenCalledWith('test-session');
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
  });

  it('shows empty-exercise modal and can submit with empty exercises removed', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Bench Press'));
    expect(screen.queryByLabelText('Remove set 1 from exercise 1')).toBeNull();
    swipeLeft(screen.getByTestId('set-swipe-delete-1-1'));
    fireEvent.press(screen.getByText('Submit Session'));

    expect(screen.getByText('Remove exercises with no sets and submit?')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove empty exercises and submit'));

    expect(screen.queryByText('Session submitted (UI only)')).toBeNull();
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalled();
      expect(mockCompleteSessionDraft).toHaveBeenCalledWith('test-session');
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
  });

  it('keeps submit disabled when any set contains invalid reps values', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    mockPersistSessionDraftSnapshot.mockClear();
    mockCompleteSessionDraft.mockClear();

    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '0');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '0');

    expect(screen.getByTestId('session-recorder-submit-button').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByText('Submit Session'));

    expect(screen.queryByText('Remove incomplete sets and submit?')).toBeNull();
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).not.toHaveBeenCalled();
      expect(mockCompleteSessionDraft).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it('saves completed-edit sessions with zero-weight sets', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(
      buildCompletedEditSnapshot({
        exercises: [
          {
            id: 'exercise-1',
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Bench Press',
            machineName: 'Flat Bench',
            sets: [{ id: 'set-1', repsValue: '5', weightValue: '0' }],
          },
        ],
      })
    );

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByLabelText('logged set 1 for exercise 1: 0kg · 5 reps; quality none')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('logged set 1 for exercise 1: 0kg · 5 reps; quality none'));
    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.value).toBe('0');

    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'completed-edit-1',
          exercises: [
            expect.objectContaining({
              sets: [
                expect.objectContaining({
                  repsValue: '5',
                  weightValue: '0',
                }),
              ],
            }),
          ],
        })
      );
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
    expect(screen.queryByText('Remove incomplete sets and submit?')).toBeNull();
    expect(mockCompleteSessionDraft).not.toHaveBeenCalled();
  });

  it('loads completed-edit mode, validates end time, and saves changes back to the list', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.queryByTestId('completed-edit-banner')).toBeNull();
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByTestId('completed-edit-end-time-input')).toBeTruthy();
      expect(screen.getByDisplayValue('2026-02-25 10:45')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('completed-edit-start-time-input'), '2026-02-30 10:00');
    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-30 10:50');
    fireEvent(screen.getByTestId('completed-edit-start-time-input'), 'blur');
    fireEvent(screen.getByTestId('completed-edit-end-time-input'), 'blur');
    expect(screen.getByTestId('completed-edit-start-time-validation-error')).toBeTruthy();
    expect(screen.getByTestId('completed-edit-time-validation-error')).toBeTruthy();
    expect(screen.getByTestId('completed-edit-save-blocked-notice')).toBeTruthy();
    fireEvent.press(screen.getByText('Save Changes'));
    expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledTimes(0);

    fireEvent.changeText(screen.getByTestId('completed-edit-start-time-input'), '2026-02-25 10:00');
    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 09:55');
    expect(screen.getByTestId('completed-edit-time-validation-error')).toBeTruthy();
    expect(screen.getByTestId('completed-edit-save-blocked-notice')).toBeTruthy();
    fireEvent.press(screen.getByText('Save Changes'));
    expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledTimes(0);

    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 10:50');
    expect(screen.queryByTestId('completed-edit-save-blocked-notice')).toBeNull();
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'completed-edit-1',
          startedAt: new Date(2026, 1, 25, 10, 0, 0, 0),
          completedAt: new Date(2026, 1, 25, 10, 50, 0, 0),
        })
      );
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });

    expect(mockCompleteSessionDraft).not.toHaveBeenCalled();
  });

  it('uses completed-edit cleanup prompt labels for incomplete sets and saves changes after confirmation', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(
      buildCompletedEditSnapshot({
        exercises: [
          {
            id: 'exercise-1',
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Bench Press',
            machineName: 'Flat Bench',
            sets: [
              { id: 'set-1', repsValue: '5', weightValue: '225' },
              { id: 'set-2', repsValue: '', weightValue: '205' },
            ],
          },
        ],
      })
    );

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByDisplayValue('2026-02-25 10:45')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Save Changes'));

    expect(screen.getByText('Remove incomplete sets and submit?')).toBeTruthy();
    expect(screen.getByText('Remove incomplete sets and save changes')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove incomplete sets and save changes'));

    await waitFor(() => {
      expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
    expect(mockCompleteSessionDraft).not.toHaveBeenCalled();
  });

  it('uses completed-edit cleanup prompt labels for empty exercises and saves changes after confirmation', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByDisplayValue('2026-02-25 10:45')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('logged set 1 for exercise 1: 225kg · 5 reps; quality none'));
    expect(screen.queryByLabelText('Remove set 1 from exercise 1')).toBeNull();
    swipeLeft(screen.getByTestId('set-swipe-delete-1-1'));
    fireEvent.press(screen.getByText('Save Changes'));

    expect(screen.getByText('Remove exercises with no sets and submit?')).toBeTruthy();
    expect(screen.getByText('Remove empty exercises and save changes')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove empty exercises and save changes'));

    await waitFor(() => {
      expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/stats-history');
    });
    expect(mockCompleteSessionDraft).not.toHaveBeenCalled();
  });
});
