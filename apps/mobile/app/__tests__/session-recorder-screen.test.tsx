import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SessionRecorderScreen from '../(tabs)/session-recorder';

const swipeLeft = (target: ReturnType<typeof screen.getByTestId>) => {
  fireEvent(target, 'touchStart', { nativeEvent: { pageX: 220 } });
  fireEvent(target, 'touchEnd', { nativeEvent: { pageX: 120 } });
};
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';

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

jest.mock('@/src/location/foreground-location-lazy', () => ({
  getCurrentForegroundPositionLazy: jest.fn().mockResolvedValue({
    status: 'success',
    position: {
      latitude: 51.501,
      longitude: -0.141,
      accuracyM: 20,
      capturedAt: new Date('2026-05-23T10:00:00.000Z'),
    },
  }),
}));

jest.mock('@/src/location/gym-location-matcher', () => ({
  DEFAULT_MAX_POSITION_ACCURACY_M: 100,
  matchNearestGymForPosition: jest.fn().mockReturnValue({
    status: 'no_match',
    radiusM: 150,
  }),
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

const dismissEmptyStateIfPresent = async () => {
  await act(async () => {});
  const startButton = screen.queryByTestId('start-session-button');
  if (startButton) {
    fireEvent.press(startButton);
    await act(async () => {});
  }
};

const locationMock = {
  ...jest.requireMock('@/src/location/foreground-location-lazy'),
  ...jest.requireMock('@/src/location/gym-location-matcher'),
} as {
  getCurrentForegroundPositionLazy: jest.Mock;
  matchNearestGymForPosition: jest.Mock;
};

const dataMock = jest.requireMock('@/src/data') as {
  loadLatestSessionDraftSnapshot: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
  persistSessionDraftSnapshot: jest.Mock;
  listLocalGyms: jest.Mock;
  upsertLocalGym: jest.Mock;
};

describe('SessionRecorderScreen', () => {
  beforeEach(() => {
    __resetExerciseListPreferencesForTests();
    setExerciseListPreferences({ groupByMuscleFamily: false });
    dataMock.loadLatestSessionDraftSnapshot.mockReset();
    dataMock.loadLatestSessionDraftSnapshot.mockResolvedValue(null);
    dataMock.loadSessionSnapshotById.mockReset();
    dataMock.loadSessionSnapshotById.mockResolvedValue(null);
    dataMock.persistSessionDraftSnapshot.mockReset();
    dataMock.persistSessionDraftSnapshot.mockResolvedValue({ sessionId: 'test-session' });
    dataMock.listLocalGyms.mockReset();
    dataMock.listLocalGyms.mockResolvedValue([]);
    dataMock.upsertLocalGym.mockClear();
    dataMock.upsertLocalGym.mockResolvedValue(undefined);
    locationMock.getCurrentForegroundPositionLazy.mockReset();
    locationMock.matchNearestGymForPosition.mockReset();
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValue({
      status: 'success',
      position: {
        latitude: 51.501,
        longitude: -0.141,
        accuracyM: 20,
        capturedAt: new Date('2026-05-23T10:00:00.000Z'),
      },
    });
    locationMock.matchNearestGymForPosition.mockReturnValue({
      status: 'no_match',
      radiusM: 150,
    });
  });

  it('renders the empty-state Start CTA when no active session exists', async () => {
    render(<SessionRecorderScreen />);
    await act(async () => {});

    expect(screen.getByTestId('session-recorder-empty-state')).toBeTruthy();
    expect(screen.getByTestId('start-session-button')).toBeTruthy();
    expect(screen.queryByText('Date and Time')).toBeNull();
    expect(screen.queryByText('Log new exercise')).toBeNull();
  });

  it('reveals the recorder body after tapping Start Session and persists a new draft', async () => {
    dataMock.persistSessionDraftSnapshot.mockClear();
    dataMock.persistSessionDraftSnapshot.mockResolvedValueOnce({ sessionId: 'new-draft-1' });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(dataMock.persistSessionDraftSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        gymId: null,
        status: 'active',
        exercises: [],
      })
    );

    expect(screen.queryByTestId('session-recorder-empty-state')).toBeNull();
    expect(screen.getByText('Date and Time')).toBeTruthy();
    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.getByText('No gym')).toBeTruthy();
    expect(screen.getByText('Log new exercise')).toBeTruthy();
    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();
    expect(screen.getByText('Submit Session')).toBeTruthy();
    expect(screen.queryByTestId('session-recorder-delete-button')).toBeNull();
    expect(screen.queryByTestId('session-recorder-delete-confirm-button')).toBeNull();
    expect(screen.queryByLabelText('Detect current gym')).toBeNull();
    expect(screen.queryByText('Use this gym')).toBeNull();
    expect(screen.queryByText('Ignore')).toBeNull();
  });

  it('starts a session when startup GPS preselection does not resolve', async () => {
    jest.useFakeTimers();
    dataMock.persistSessionDraftSnapshot.mockClear();
    locationMock.getCurrentForegroundPositionLazy.mockImplementationOnce(() => new Promise(() => {}));

    try {
      render(<SessionRecorderScreen />);
      await act(async () => {});

      fireEvent.press(screen.getByTestId('start-session-button'));
      expect(dataMock.persistSessionDraftSnapshot).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await act(async () => {});

      expect(dataMock.persistSessionDraftSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          gymId: null,
          status: 'active',
          exercises: [],
        })
      );
      expect(screen.queryByTestId('session-recorder-empty-state')).toBeNull();
      expect(screen.getByText('No exercises logged yet.')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders the baseline session recorder shell', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(screen.getByText('Date and Time')).toBeTruthy();
    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.getByText('No gym')).toBeTruthy();
    expect(screen.getByText('Log new exercise')).toBeTruthy();
    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();
    expect(screen.queryByText('Barbell Squat')).toBeNull();
    expect(screen.getByText('Submit Session')).toBeTruthy();
    expect(screen.queryByTestId('session-recorder-delete-button')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('session-recorder-submit-button').props.style)).toEqual(
      expect.objectContaining({
        borderRadius: StyleSheet.flatten(screen.getByLabelText('Log new exercise').props.style).borderRadius,
        paddingVertical: StyleSheet.flatten(screen.getByLabelText('Log new exercise').props.style).paddingVertical,
      })
    );
    expect(screen.queryByLabelText('Select gym Downtown Iron Temple')).toBeNull();
    expect(screen.queryByTestId('detect-current-gym-button')).toBeNull();
    expect(screen.queryByTestId('gps-gym-suggestion-feedback')).toBeNull();
  });

  it('quietly preselects one matched gym when starting a brand-new session', async () => {
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.501, longitude: -0.141 },
        distanceM: 18.4,
      },
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(dataMock.persistSessionDraftSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        gymId: 'westside-barbell-club',
        status: 'active',
        exercises: [],
      })
    );
    expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);
    expect(locationMock.getCurrentForegroundPositionLazy).toHaveBeenCalledTimes(1);
    expect(locationMock.matchNearestGymForPosition).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('gps-gym-suggestion-feedback')).toBeNull();
  });

  it('does not run startup GPS detection when restoring an existing active draft', async () => {
    dataMock.loadLatestSessionDraftSnapshot.mockResolvedValueOnce({
      sessionId: 'existing-draft',
      gymId: null,
      startedAt: new Date('2026-05-23T10:00:00.000Z'),
      exercises: [],
    });

    render(<SessionRecorderScreen />);
    await act(async () => {});

    expect(screen.queryByTestId('session-recorder-empty-state')).toBeNull();
    expect(screen.getByText('No gym')).toBeTruthy();
    expect(locationMock.getCurrentForegroundPositionLazy).not.toHaveBeenCalled();
    expect(locationMock.matchNearestGymForPosition).not.toHaveBeenCalled();
  });

  it('renders planned imported sets and supports log and skip actions', async () => {
    dataMock.loadLatestSessionDraftSnapshot.mockResolvedValueOnce({
      sessionId: 'planned-draft',
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-23T10:00:00.000Z'),
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:00:00.000Z'),
      exercises: [
        {
          id: 'exercise-pullups',
          exerciseDefinitionId: 'seed_pull_up',
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'planned-set-1',
              repsValue: '',
              weightValue: '',
              setType: null,
              plannedRepsValue: '6',
              plannedWeightValue: '',
              plannedSetType: 'rir_2',
              performanceStatus: 'planned',
            },
            {
              id: 'planned-set-2',
              repsValue: '',
              weightValue: '',
              setType: null,
              plannedRepsValue: '8',
              plannedWeightValue: '30',
              plannedSetType: 'rir_2',
              performanceStatus: 'planned',
            },
            {
              id: 'added-set-3',
              repsValue: '8',
              weightValue: '185',
              setType: 'rir_1',
              plannedRepsValue: null,
              plannedWeightValue: null,
              plannedSetType: null,
              performanceStatus: null,
            },
          ],
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await act(async () => {});

    expect(screen.getByText('2 planned · 1 performed')).toBeTruthy();
    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('0kg')).toBeTruthy();
    expect(screen.getByText('6 reps')).toBeTruthy();
    expect(screen.getByText('Set 3')).toBeTruthy();
    expect(screen.getByText('185kg')).toBeTruthy();
    expect(screen.getAllByText('8 reps').length).toBeGreaterThan(0);
    expect(screen.queryByText('Added')).toBeNull();
    expect(screen.queryByText('RIR 2')).toBeNull();
    expect(screen.getByText('RIR 1')).toBeTruthy();
    expect(screen.queryByLabelText('Weight for exercise 1 set 3')).toBeNull();

    fireEvent.press(screen.getByLabelText('added set 3 for exercise 1: 185kg · 8 reps; quality RIR 1'));
    expect(screen.getByLabelText('Weight for exercise 1 set 3')).toBeTruthy();
    fireEvent(screen.getByLabelText('Weight for exercise 1 set 3'), 'blur');

    fireEvent.press(screen.getByLabelText('Log set 1 as planned'));
    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('0kg')).toBeTruthy();
    expect(screen.getByText('6 reps')).toBeTruthy();
    expect(screen.getByText('2 planned · 2 performed')).toBeTruthy();
    expect(screen.getByLabelText('Quality for exercise 1 set 1: RIR 2')).toBeTruthy();

    expect(screen.queryByLabelText('Quality for exercise 1 set 2: none')).toBeNull();
    fireEvent.press(screen.getByLabelText('Skip set 2'));
    expect(screen.getByText('Set 2')).toBeTruthy();
    expect(screen.getByText('30kg')).toBeTruthy();
    expect(screen.getAllByText('8 reps').length).toBeGreaterThan(0);
    expect(screen.queryByText('Skipped')).toBeNull();
    expect(screen.getByText('2 planned · 2 performed · 1 skipped')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('added set 3 for exercise 1: 185kg · 8 reps; quality RIR 1'));
    expect(screen.getByLabelText('Weight for exercise 1 set 3')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('skipped planned set 2 for exercise 1: 30kg · 8 reps; quality RIR 2'));
    expect(screen.queryByLabelText('Weight for exercise 1 set 2')).toBeNull();
    expect(screen.queryByLabelText('Weight for exercise 1 set 3')).toBeNull();

    fireEvent.press(screen.getByLabelText('skipped planned set 2 for exercise 1: 30kg · 8 reps; quality RIR 2'));
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.value).toBe('30');
    expect(screen.getByLabelText('Reps for exercise 1 set 2').props.value).toBe('8');
    expect(screen.getByLabelText('Quality for exercise 1 set 2: RIR 2')).toBeTruthy();
    expect(screen.queryByLabelText('Done editing set 2')).toBeNull();
    expect(screen.queryByLabelText('Skip set 2')).toBeNull();
    expect(screen.getByText('2 planned · 3 performed')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 2'), '35');
    expect(screen.getByLabelText('Weight for exercise 1 set 2').props.value).toBe('35');

    swipeLeft(screen.getByTestId('planned-set-row-1-2'));
    expect(screen.getByText('Set 2')).toBeTruthy();
    expect(screen.getByText('30kg')).toBeTruthy();
    expect(screen.getAllByText('8 reps').length).toBeGreaterThan(0);
    expect(screen.queryByText('Skipped')).toBeNull();
    expect(screen.getByText('2 planned · 2 performed · 1 skipped')).toBeTruthy();
  });

  it('treats equal planned volume as matched even when quality changes', async () => {
    dataMock.loadLatestSessionDraftSnapshot.mockResolvedValueOnce({
      sessionId: 'planned-quality-draft',
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-23T10:00:00.000Z'),
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:00:00.000Z'),
      exercises: [
        {
          id: 'exercise-row',
          exerciseDefinitionId: 'seed_one_arm_dumbbell_row',
          name: 'DB Row',
          machineName: null,
          sets: [
            {
              id: 'planned-set-1',
              repsValue: '8',
              weightValue: '30',
              setType: 'rir_0',
              plannedRepsValue: '8',
              plannedWeightValue: '30',
              plannedSetType: 'rir_2',
              performanceStatus: null,
            },
          ],
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await act(async () => {});

    expect(screen.getByText('1 planned · 1 performed')).toBeTruthy();
    expect(screen.getByLabelText('matched planned set 1 for exercise 1: 30kg · 8 reps; quality RIR 0')).toBeTruthy();
    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('30kg')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();
    expect(screen.queryByText('Set 1 · 30kg · 8 reps -> 30kg · 8 reps')).toBeNull();
  });

  it('uses compact editable rows for normal logged sets', async () => {
    dataMock.loadLatestSessionDraftSnapshot.mockResolvedValueOnce({
      sessionId: 'normal-draft',
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-23T10:00:00.000Z'),
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:00:00.000Z'),
      exercises: [
        {
          id: 'exercise-row',
          exerciseDefinitionId: 'seed_one_arm_dumbbell_row',
          name: 'DB Row',
          machineName: null,
          sets: [
            {
              id: 'normal-set-1',
              repsValue: '8',
              weightValue: '30',
              setType: 'rir_2',
              plannedRepsValue: null,
              plannedWeightValue: null,
              plannedSetType: null,
              performanceStatus: null,
            },
          ],
        },
      ],
    });

    render(<SessionRecorderScreen />);
    await act(async () => {});

    expect(screen.queryByTestId('exercise-1-set-header')).toBeNull();
    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('30kg')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();
    expect(screen.getByText('RIR 2')).toBeTruthy();
    expect(screen.queryByLabelText('Weight for exercise 1 set 1')).toBeNull();

    fireEvent.press(screen.getByLabelText('logged set 1 for exercise 1: 30kg · 8 reps; quality RIR 2'));

    expect(screen.getByLabelText('Weight for exercise 1 set 1')).toBeTruthy();
    expect(screen.getByText('kg total')).toBeTruthy();
    expect(screen.getByPlaceholderText('Reps')).toBeTruthy();
    expect(screen.getByLabelText('Quality for exercise 1 set 1: RIR 2')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Add set to exercise 1'));

    expect(screen.getByText('Set 1')).toBeTruthy();
    expect(screen.getByText('30kg')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();
    expect(screen.getByLabelText('Weight for exercise 1 set 2')).toBeTruthy();
    expect(screen.getByLabelText('Reps for exercise 1 set 2')).toBeTruthy();
    expect(screen.getByLabelText('Quality for exercise 1 set 2: RIR 2')).toBeTruthy();

    fireEvent(screen.getByLabelText('Reps for exercise 1 set 2'), 'blur');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('Set 2')).toBeTruthy();
    expect(screen.getAllByText('30kg').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('8 reps').length).toBeGreaterThanOrEqual(2);

    fireEvent.press(screen.getByLabelText('logged set 1 for exercise 1: 30kg · 8 reps; quality RIR 2'));
    expect(screen.getByLabelText('Weight for exercise 1 set 1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('logged set 2 for exercise 1: 30kg · 8 reps; quality RIR 2'));
    expect(screen.queryByLabelText('Weight for exercise 1 set 1')).toBeNull();
    expect(screen.queryByLabelText('Weight for exercise 1 set 2')).toBeNull();

    fireEvent.press(screen.getByLabelText('logged set 2 for exercise 1: 30kg · 8 reps; quality RIR 2'));
    expect(screen.getByLabelText('Weight for exercise 1 set 2')).toBeTruthy();
  });

  it('prefills date and time with the current value pattern', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(screen.getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('YYYY-MM-DD HH:mm')).toBeNull();
  });

  it('supports picker selection and add new gym flow', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    expect(screen.getByText('Select Gym')).toBeTruthy();

    expect(screen.getByLabelText('Select no gym')).toBeTruthy();
    expect(screen.getByLabelText('Select gym Downtown Iron Temple')).toBeTruthy();
    expect(screen.getByLabelText('Select gym Westside Barbell Club')).toBeTruthy();
    expect(screen.getByLabelText('Select gym North End Strength Lab')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Select gym Westside Barbell Club'));
    expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);

    // Re-open the gym picker via the recorder body's gym button (the active-session
    // row also renders the gym name now but is not pressable for re-opening).
    const gymButtonTexts = screen.getAllByText('Westside Barbell Club');
    const gymButtonText = gymButtonTexts[gymButtonTexts.length - 1];
    fireEvent.press(gymButtonText);
    fireEvent.press(screen.getByText('Add new'));
    expect(screen.getByText('Add Gym')).toBeTruthy();
    expect(screen.queryByText('Manage')).toBeNull();
    expect(screen.queryByLabelText('Select gym Downtown Iron Temple')).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('Gym name'), 'Southside Fitness Forge');
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValueOnce({
      status: 'permission_denied',
      canAskAgain: false,
    });
    fireEvent.press(screen.getByText('Add'));

    expect(screen.getAllByText('Southside Fitness Forge').length).toBeGreaterThanOrEqual(1);
  });

  it('hydrates non-seeded local gyms into the picker and manager', async () => {
    dataMock.listLocalGyms.mockResolvedValueOnce([
      {
        id: 'synced-strength-house',
        name: 'Synced Strength House',
        latitude: 51.5,
        longitude: -0.12,
        coordinateAccuracyM: 15,
        coordinatesUpdatedAt: new Date('2026-05-23T10:00:00.000Z'),
      },
    ]);

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));

    await waitFor(() => {
      expect(screen.getByLabelText('Select gym Synced Strength House')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Manage'));

    expect(screen.getByText('Synced Strength House')).toBeTruthy();
    expect(screen.getByText('GPS saved')).toBeTruthy();
  });

  it('supports manage gyms edit/archive/filter/unarchive flow', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    expect(screen.getByText('Manage Gyms')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.changeText(screen.getByDisplayValue('Downtown Iron Temple'), 'Downtown Iron Works');
    fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Downtown Iron Works')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Archive gym Downtown Iron Works'));
    expect(screen.queryByText('Downtown Iron Works')).toBeNull();

    fireEvent.press(screen.getByText('Show archived'));
    expect(screen.getByText('Downtown Iron Works')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Unarchive gym Downtown Iron Works'));
    fireEvent.press(screen.getByText('Hide archived'));
    fireEvent.press(screen.getByText('Back to picker'));
    expect(screen.getByText('Select Gym')).toBeTruthy();

    expect(screen.getByLabelText('Select gym Downtown Iron Works')).toBeTruthy();
  });

  it('lets the picker set the active session back to No gym without creating a gym row', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByLabelText('Select gym Westside Barbell Club'));
    expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);

    const gymButtonTexts = screen.getAllByText('Westside Barbell Club');
    fireEvent.press(gymButtonTexts[gymButtonTexts.length - 1]);
    fireEvent.press(screen.getByLabelText('Select no gym'));

    expect(screen.getByText('No gym')).toBeTruthy();
    expect(dataMock.upsertLocalGym).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'no-gym' })
    );
  });

  it('keeps coordinate actions out of Manage and saves current coordinates from the single gym editor', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    expect(screen.queryByLabelText('Save current location for gym Downtown Iron Temple')).toBeNull();
    expect(screen.queryByLabelText('Replace coordinates for gym Downtown Iron Temple')).toBeNull();
    expect(screen.queryByLabelText('Clear coordinates for gym Downtown Iron Temple')).toBeNull();

    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));

    await waitFor(() => {
      expect(dataMock.upsertLocalGym).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'downtown-iron-temple',
          name: 'Downtown Iron Temple',
          coordinates: {
            latitude: 51.501,
            longitude: -0.141,
            accuracyM: 20,
            updatedAt: new Date('2026-05-23T10:00:00.000Z'),
          },
        })
      );
    });

    expect(await screen.findByText('Coordinates saved from current location.')).toBeTruthy();
    expect(screen.getByText('GPS saved')).toBeTruthy();
  });

  it('requires confirmation before replacing saved gym coordinates in the editor', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    await screen.findByText('Coordinates saved from current location.');

    locationMock.getCurrentForegroundPositionLazy.mockResolvedValueOnce({
      status: 'success',
      position: {
        latitude: 51.502,
        longitude: -0.142,
        accuracyM: 12,
        capturedAt: new Date('2026-05-23T10:05:00.000Z'),
      },
    });

    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    expect(screen.getByText('Replace saved coordinates with your current location?')).toBeTruthy();
    expect(dataMock.upsertLocalGym).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Confirm replace coordinates for gym Downtown Iron Temple'));

    await waitFor(() => {
      expect(dataMock.upsertLocalGym).toHaveBeenCalledTimes(2);
    });
    expect(dataMock.upsertLocalGym).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'downtown-iron-temple',
        name: 'Downtown Iron Temple',
        coordinates: {
          latitude: 51.502,
          longitude: -0.142,
          accuracyM: 12,
          updatedAt: new Date('2026-05-23T10:05:00.000Z'),
        },
      })
    );
    expect(await screen.findByText('Coordinates replaced from current location.')).toBeTruthy();
  });

  it('requires confirmation before clearing coordinates in the editor and excludes the gym from later GPS matching', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));
    await screen.findByText('Coordinates saved from current location.');

    fireEvent.press(screen.getByLabelText('Clear coordinates for gym Downtown Iron Temple'));
    expect(screen.getByText('Clear saved coordinates for this gym?')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel coordinate action for gym Downtown Iron Temple'));
    expect(screen.queryByText('Clear saved coordinates for this gym?')).toBeNull();
    expect(dataMock.upsertLocalGym).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Clear coordinates for gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Confirm clear coordinates for gym Downtown Iron Temple'));

    await waitFor(() => {
      expect(dataMock.upsertLocalGym).toHaveBeenCalledTimes(2);
    });
    expect(dataMock.upsertLocalGym).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'downtown-iron-temple',
        name: 'Downtown Iron Temple',
        coordinates: null,
      })
    );
    expect(await screen.findByText('Coordinates cleared. This gym will not be used for GPS matching.')).toBeTruthy();

    locationMock.getCurrentForegroundPositionLazy.mockClear();
    locationMock.matchNearestGymForPosition.mockClear();
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'downtown-iron-temple', name: 'Downtown Iron Temple', latitude: 51.501, longitude: -0.141 },
        distanceM: 5,
      },
    });

    fireEvent.press(screen.getByText('Back'));
    fireEvent.press(screen.getByText('Back to picker'));
    fireEvent.press(screen.getByLabelText('Dismiss gym modal overlay'));
    fireEvent(screen.getByText('No gym'), 'onLongPress');

    await waitFor(() => {
      expect(locationMock.matchNearestGymForPosition).toHaveBeenCalledWith(
        expect.objectContaining({ accuracyM: 20, latitude: 51.501, longitude: -0.141 }),
        expect.arrayContaining([
          expect.objectContaining({
            id: 'downtown-iron-temple',
            latitude: null,
            longitude: null,
          }),
        ])
      );
    });
  });

  it('automatically attempts coordinate capture when adding a gym but still selects it if GPS fails', async () => {
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValue({
      status: 'permission_denied',
      canAskAgain: false,
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Add new'));
    fireEvent.changeText(screen.getByPlaceholderText('Gym name'), 'Southside Fitness Forge');
    fireEvent.press(screen.getByText('Add'));

    expect(screen.getAllByText('Southside Fitness Forge').length).toBeGreaterThanOrEqual(1);
    expect(dataMock.upsertLocalGym).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringContaining('southside-fitness-forge'),
        coordinates: expect.anything(),
      })
    );
  });

  it.each([
    [
      'permission denial',
      { status: 'permission_denied', canAskAgain: false },
      'Location permission was denied. Coordinates were not changed.',
    ],
    [
      'low accuracy',
      {
        status: 'success',
        position: { latitude: 51.501, longitude: -0.141, accuracyM: 140, capturedAt: new Date('2026-05-23T10:00:00.000Z') },
      },
      'Location accuracy is too low right now. Coordinates were not changed.',
    ],
    [
      'unavailable services',
      { status: 'unavailable', reason: 'services_disabled' },
      'Location services are unavailable. Coordinates were not changed.',
    ],
  ])('shows inline coordinate feedback for %s without persisting coordinates', async (_caseName, locationResult, expectedMessage) => {
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValue(locationResult);

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(dataMock.upsertLocalGym).not.toHaveBeenCalled();
  });

  it('keeps coordinate persistence failures inline without marking coordinates saved', async () => {
    dataMock.upsertLocalGym.mockRejectedValueOnce(new Error('database unavailable'));

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByText('Manage'));
    fireEvent.press(screen.getByLabelText('Edit gym Downtown Iron Temple'));
    fireEvent.press(screen.getByLabelText('Save current location for gym Downtown Iron Temple'));

    expect(await screen.findByText('Unable to update gym coordinates right now.')).toBeTruthy();
    expect(screen.getAllByText('No GPS coordinates').length).toBeGreaterThanOrEqual(1);
  });

  it('dismisses the gym modal when pressing outside', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    expect(screen.getByText('Select Gym')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Dismiss gym modal overlay'));
    expect(screen.queryByText('Select Gym')).toBeNull();
  });

  it('selects a single matched gym after an explicit long-press retry without showing a suggestion panel', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    locationMock.getCurrentForegroundPositionLazy.mockClear();
    locationMock.matchNearestGymForPosition.mockClear();
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.501, longitude: -0.141 },
        distanceM: 18.4,
      },
    });

    fireEvent(screen.getByText('No gym'), 'onLongPress');

    await waitFor(() => {
      expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Looks like Westside Barbell Club')).toBeNull();
    expect(screen.queryByText('Use this gym')).toBeNull();
    expect(screen.queryByTestId('gps-gym-suggestion-feedback')).toBeNull();
    expect(locationMock.getCurrentForegroundPositionLazy).toHaveBeenCalledTimes(1);
    expect(locationMock.matchNearestGymForPosition).toHaveBeenCalledWith(
      expect.objectContaining({ accuracyM: 20, latitude: 51.501, longitude: -0.141 }),
      expect.arrayContaining([
        expect.objectContaining({ id: 'westside-barbell-club', name: 'Westside Barbell Club' }),
      ])
    );
  });

  it('keeps manual gym selection authoritative when a GPS suggestion is visible', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByLabelText('Select gym Downtown Iron Temple'));
    locationMock.getCurrentForegroundPositionLazy.mockClear();
    locationMock.matchNearestGymForPosition.mockClear();
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.501, longitude: -0.141 },
        distanceM: 18.4,
      },
    });
    const selectedGymTexts = screen.getAllByText('Downtown Iron Temple');
    fireEvent(selectedGymTexts[selectedGymTexts.length - 1], 'onLongPress');

    await waitFor(() => {
      expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Use this gym')).toBeNull();
  });

  it.each([
    [
      'permission denial',
      { status: 'permission_denied', canAskAgain: false },
      null,
      'Location permission was denied. Choose a gym manually.',
    ],
    [
      'unavailable services',
      { status: 'unavailable', reason: 'services_disabled' },
      null,
      'Location services are unavailable. Choose a gym manually.',
    ],
    [
      'low accuracy',
      {
        status: 'success',
        position: { latitude: 51.501, longitude: -0.141, accuracyM: 140, capturedAt: new Date('2026-05-23T10:00:00.000Z') },
      },
      { status: 'low_accuracy', accuracyM: 140, maxAccuracyM: 100 },
      'Location accuracy is too low right now. Choose a gym manually.',
    ],
    [
      'no match',
      {
        status: 'success',
        position: { latitude: 51.501, longitude: -0.141, accuracyM: 20, capturedAt: new Date('2026-05-23T10:00:00.000Z') },
      },
      { status: 'no_match', radiusM: 150 },
      'No saved gym matched your current location.',
    ],
    [
      'ambiguous match',
      {
        status: 'success',
        position: { latitude: 51.501, longitude: -0.141, accuracyM: 20, capturedAt: new Date('2026-05-23T10:00:00.000Z') },
      },
      {
        status: 'ambiguous',
        closestDistanceM: 12,
        tieThresholdM: 25,
        matches: [
          { gym: { id: 'downtown-iron-temple', name: 'Downtown Iron Temple', latitude: 51.501, longitude: -0.141 }, distanceM: 12 },
          { gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.5011, longitude: -0.1411 }, distanceM: 18 },
        ],
      },
      'Multiple saved gyms are nearby. Choose a gym manually.',
    ],
  ])('leaves the selected gym unchanged for failed long-press GPS retry: %s', async (_caseName, locationResult, matchResult, _expectedMessage) => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('No gym'));
    fireEvent.press(screen.getByLabelText('Select gym Downtown Iron Temple'));
    expect(screen.getAllByText('Downtown Iron Temple').length).toBeGreaterThanOrEqual(1);

    locationMock.getCurrentForegroundPositionLazy.mockClear();
    locationMock.matchNearestGymForPosition.mockClear();
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValueOnce(locationResult);
    if (matchResult) {
      locationMock.matchNearestGymForPosition.mockReturnValueOnce(matchResult);
    }

    const selectedGymTexts = screen.getAllByText('Downtown Iron Temple');
    fireEvent(selectedGymTexts[selectedGymTexts.length - 1], 'onLongPress');

    await act(async () => {});
    expect(screen.getAllByText('Downtown Iron Temple').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('gps-gym-suggestion-feedback')).toBeNull();
  });
});
