import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SessionRecorderScreen from '../(tabs)/session-recorder';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';

let mockSearchParams: Record<string, string | undefined> = {};
let mockBeforeRemoveListener: ((event: any) => void) | null = null;
let mockFocusCleanup: (() => void) | null = null;
const mockNavigationDispatch = jest.fn();
const mockNavigationAddListener = jest.fn((eventName: string, listener: (event: any) => void) => {
  if (eventName === 'beforeRemove') {
    mockBeforeRemoveListener = listener;
  }

  return () => {
    if (mockBeforeRemoveListener === listener) {
      mockBeforeRemoveListener = null;
    }
  };
});

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
  loadSuggestedExercisePlan: jest.fn().mockResolvedValue(null),
  loadLocalGymById: jest.fn().mockResolvedValue(null),
  loadLatestSessionDraftSnapshot: jest.fn().mockResolvedValue(null),
  loadSessionSnapshotById: jest.fn().mockResolvedValue(null),
  persistCompletedSessionSnapshot: jest.fn().mockResolvedValue({
    sessionId: 'persisted-session-1',
    completedAt: new Date('2026-02-24T00:00:00.000Z'),
    durationSec: 0,
  }),
  persistSessionDraftSnapshot: jest.fn().mockResolvedValue({ sessionId: 'persisted-session-1' }),
  removeExerciseTagFromSessionExercise: jest.fn().mockResolvedValue(undefined),
  renameExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  setSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  undeleteExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  upsertLocalGym: jest.fn().mockResolvedValue(undefined),
  completeSessionDraft: jest.fn().mockResolvedValue({
    sessionId: 'persisted-session-1',
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
      const cleanup = callback();
      mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
      return () => {
        if (mockFocusCleanup === cleanup) {
          mockFocusCleanup = null;
        }
        cleanup?.();
      };
    }, [callback]);
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({ addListener: mockNavigationAddListener, dispatch: mockNavigationDispatch }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

const {
  loadLatestSessionDraftSnapshot: mockLoadLatestSessionDraftSnapshot,
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
  persistCompletedSessionSnapshot: mockPersistCompletedSessionSnapshot,
  persistSessionDraftSnapshot: mockPersistSessionDraftSnapshot,
} = jest.requireMock('@/src/data') as {
  loadLatestSessionDraftSnapshot: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
  persistCompletedSessionSnapshot: jest.Mock;
  persistSessionDraftSnapshot: jest.Mock;
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const dismissEmptyStateIfPresent = async () => {
  await act(async () => {
    await flushMicrotasks();
  });
  const startButton = screen.queryByTestId('start-session-button');
  if (startButton) {
    fireEvent.press(startButton);
    await act(async () => {
      await flushMicrotasks();
    });
  }
};

const addExerciseWithEmptySet = async (exerciseName: string) => {
  fireEvent.press(await screen.findByLabelText(`Select exercise ${exerciseName}`));
  fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
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
      sets: [{ id: 'set-1', repsValue: '5', weightValue: '225', setType: null }],
    },
  ],
  ...overrides,
});

describe('SessionRecorderScreen persistence wiring', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSearchParams = {};
    mockBeforeRemoveListener = null;
    mockFocusCleanup = null;
    __resetExerciseListPreferencesForTests();
    setExerciseListPreferences({ groupByMuscleFamily: false });
    mockNavigationDispatch.mockReset();
    mockNavigationAddListener.mockClear();
    mockLoadLatestSessionDraftSnapshot.mockReset();
    mockLoadSessionSnapshotById.mockReset();
    mockPersistCompletedSessionSnapshot.mockReset();
    mockPersistSessionDraftSnapshot.mockReset();
    mockLoadLatestSessionDraftSnapshot.mockResolvedValue(null);
    mockLoadSessionSnapshotById.mockResolvedValue(null);
    mockPersistCompletedSessionSnapshot.mockResolvedValue({
      sessionId: 'persisted-session-1',
      completedAt: new Date('2026-02-24T00:00:00.000Z'),
      durationSec: 0,
    });
    mockPersistSessionDraftSnapshot.mockResolvedValue({ sessionId: 'persisted-session-1' });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('persists structural edits immediately and text edits with the existing 3s debounce SLA', async () => {
    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadLatestSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    await dismissEmptyStateIfPresent();
    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.press(screen.getByText('Log new exercise'));
    await addExerciseWithEmptySet('Barbell Squat');

    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(mockPersistSessionDraftSnapshot.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        status: 'active',
        exercises: [
          expect.objectContaining({
            name: 'Barbell Squat',
            sets: [expect.objectContaining({ repsValue: '', weightValue: '', setType: null })],
          }),
        ],
      })
    );

    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '225');

    await act(async () => {
      jest.advanceTimersByTime(2_999);
      await flushMicrotasks();
    });
    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await flushMicrotasks();
    });

    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPersistSessionDraftSnapshot.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: 'persisted-session-1',
        exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ weightValue: '225', setType: null })],
          }),
        ],
      })
    );

    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.press(screen.getByTestId('set-quality-button-1-1'));

    await act(async () => {
      jest.advanceTimersByTime(3_000);
      await flushMicrotasks();
    });

    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPersistSessionDraftSnapshot.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: 'persisted-session-1',
        exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ setType: 'warm_up' })],
          }),
        ],
      })
    );
  });

  it('flushes pending debounced text edits on unmount (best-effort navigation-out/exit flush)', async () => {
    const rendered = render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadLatestSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    await dismissEmptyStateIfPresent();
    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.press(screen.getByText('Log new exercise'));
    await addExerciseWithEmptySet('Barbell Squat');
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });

    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });
    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(0);

    await act(async () => {
      rendered.unmount();
      await flushMicrotasks();
    });

    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPersistSessionDraftSnapshot.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: 'persisted-session-1',
        exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ repsValue: '5', setType: null })],
          }),
        ],
      })
    );
  });

  it('flushes pending text when the recorder tab loses focus without unmounting', async () => {
    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadLatestSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await addExerciseWithEmptySet('Barbell Squat');
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalled();
    });
    mockPersistSessionDraftSnapshot.mockClear();

    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '80');

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });
    expect(mockPersistSessionDraftSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      mockFocusCleanup?.();
      await flushMicrotasks();
    });

    expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ repsValue: '', weightValue: '80' })],
          }),
        ],
      })
    );
  });

  it('commits blank weight as zero and flushes pending reps when the row input blurs', async () => {
    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadLatestSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await addExerciseWithEmptySet('Barbell Squat');
    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalled();
    });
    mockPersistSessionDraftSnapshot.mockClear();

    const repsInput = screen.getByLabelText('Reps for exercise 1 set 1');
    fireEvent.changeText(repsInput, '5');

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });
    expect(mockPersistSessionDraftSnapshot).not.toHaveBeenCalled();

    fireEvent(repsInput, 'blur');

    await waitFor(() => {
      expect(mockPersistSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
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
    expect(
      screen.getByLabelText('logged set 1 for exercise 1: 0kg · 5 reps; quality none')
    ).toBeTruthy();
  });

  it('does not inject zero while focus moves between inputs in the same row', async () => {
    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadLatestSessionDraftSnapshot).toHaveBeenCalledTimes(1);
    });
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Log new exercise'));
    await addExerciseWithEmptySet('Barbell Squat');

    const repsInput = screen.getByLabelText('Reps for exercise 1 set 1');
    const weightInput = screen.getByLabelText('Weight for exercise 1 set 1');
    fireEvent(repsInput, 'focus');
    fireEvent.changeText(repsInput, '5');
    fireEvent(repsInput, 'blur');
    fireEvent(weightInput, 'focus');

    await act(async () => {
      jest.advanceTimersByTime(20);
      await flushMicrotasks();
    });

    expect(screen.getByLabelText('Weight for exercise 1 set 1').props.value).toBe('');
  });

  it('pauses completed-edit autosave while times are invalid and resumes when valid', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(mockLoadSessionSnapshotById).toHaveBeenCalledWith('completed-edit-1');
      expect(screen.queryByTestId('completed-edit-banner')).toBeNull();
      expect(screen.getByTestId('completed-edit-end-time-input')).toBeTruthy();
      expect(screen.getByText('Save Changes')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 09:50');

    await act(async () => {
      jest.advanceTimersByTime(3_000);
      await flushMicrotasks();
    });

    expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('completed-edit-autosave-notice')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 10:50');

    await act(async () => {
      jest.advanceTimersByTime(3_000);
      await flushMicrotasks();
    });

    expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPersistCompletedSessionSnapshot.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: 'completed-edit-1',
      })
    );
  });

  it('shows an immediate error when completed-edit mode is missing a session id', async () => {
    mockSearchParams = { mode: 'completed-edit' };

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-edit-recorder-error')).toBeTruthy();
    });

    expect(screen.getByText('Missing completed session id')).toBeTruthy();
    expect(mockLoadSessionSnapshotById).not.toHaveBeenCalled();
  });

  it('shows a loading state while the completed-edit session is being loaded', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };

    let resolveSnapshot: (value: any) => void = () => {
      throw new Error('Expected completed-edit loader promise resolver');
    };
    mockLoadSessionSnapshotById.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      })
    );

    render(<SessionRecorderScreen />);

    expect(screen.getByTestId('completed-edit-recorder-loading')).toBeTruthy();

    await act(async () => {
      resolveSnapshot(buildCompletedEditSnapshot());
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
    });
  });

  it('shows an error when completed-edit target is not a completed session', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(
      buildCompletedEditSnapshot({
        status: 'active',
        completedAt: null,
        durationSec: null,
      })
    );

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-edit-recorder-error')).toBeTruthy();
    });

    expect(screen.getByText('Session is not completed')).toBeTruthy();
  });

  it('flushes completed-edit changes before navigation is removed', async () => {
    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-edit-1' };
    mockLoadSessionSnapshotById.mockResolvedValue(buildCompletedEditSnapshot());

    render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(mockNavigationAddListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
    });

    expect(mockBeforeRemoveListener).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 10:50');

    const preventDefault = jest.fn();
    const action = { type: 'GO_BACK' };

    await act(async () => {
      mockBeforeRemoveListener?.({
        preventDefault,
        data: { action },
      });
      await flushMicrotasks();
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockNavigationDispatch).toHaveBeenCalledWith(action);
      expect(mockPersistCompletedSessionSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'completed-edit-1',
          completedAt: new Date(2026, 1, 25, 10, 50, 0, 0),
        })
      );
    });
  });
});
