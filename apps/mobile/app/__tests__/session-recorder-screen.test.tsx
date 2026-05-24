import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SessionRecorderScreen from '../(tabs)/session-recorder';

jest.mock('@/src/data', () => ({
  attachExerciseTagToSessionExercise: jest.fn().mockResolvedValue(undefined),
  createExerciseTagDefinition: jest.fn().mockResolvedValue({
    id: 'tag-1',
    exerciseDefinitionId: 'sys_barbell_back_squat',
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
    { id: 'sys_barbell_back_squat', name: 'Barbell Squat', deletedAt: null, mappings: [] },
    { id: 'sys_barbell_bench_press', name: 'Bench Press', deletedAt: null, mappings: [] },
    { id: 'sys_romanian_deadlift', name: 'Deadlift', deletedAt: null, mappings: [] },
  ]),
  listExerciseCatalogMuscleGroups: jest.fn().mockResolvedValue([]),
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

describe('SessionRecorderScreen', () => {
  beforeEach(() => {
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
    const dataMock = jest.requireMock('@/src/data') as {
      persistSessionDraftSnapshot: jest.Mock;
    };
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
    expect(screen.getByText('Choose gym')).toBeTruthy();
    expect(screen.getByText('Log new exercise')).toBeTruthy();
    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();
    expect(screen.getByText('Submit Session')).toBeTruthy();
  });

  it('renders the baseline session recorder shell', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    expect(screen.getByText('Date and Time')).toBeTruthy();
    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.getByText('Choose gym')).toBeTruthy();
    expect(screen.getByText('Log new exercise')).toBeTruthy();
    expect(screen.getByText('No exercises logged yet.')).toBeTruthy();
    expect(screen.queryByText('Barbell Squat')).toBeNull();
    expect(screen.getByText('Submit Session')).toBeTruthy();
    expect(screen.queryByLabelText('Select gym Downtown Iron Temple')).toBeNull();
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

    fireEvent.press(screen.getByText('Choose gym'));
    expect(screen.getByText('Select Gym')).toBeTruthy();

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
    fireEvent.press(screen.getByText('Add'));

    expect(screen.getAllByText('Southside Fitness Forge').length).toBeGreaterThanOrEqual(1);
  });

  it('supports manage gyms edit/archive/filter/unarchive flow', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Choose gym'));
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

    fireEvent.press(screen.getByText('Choose gym'));
    expect(screen.getByLabelText('Select gym Downtown Iron Works')).toBeTruthy();
  });

  it('dismisses the gym modal when pressing outside', async () => {
    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByText('Choose gym'));
    expect(screen.getByText('Select Gym')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Dismiss gym modal overlay'));
    expect(screen.queryByText('Select Gym')).toBeNull();
  });

  it('shows a matched GPS gym suggestion and applies it only after confirmation', async () => {
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.501, longitude: -0.141 },
        distanceM: 18.4,
      },
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByLabelText('Detect current gym'));

    expect(await screen.findByText('Looks like Westside Barbell Club')).toBeTruthy();
    expect(screen.getByText('Choose gym')).toBeTruthy();

    fireEvent.press(screen.getByText('Use this gym'));

    expect(screen.getAllByText('Westside Barbell Club').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Looks like Westside Barbell Club')).toBeNull();
    expect(locationMock.getCurrentForegroundPositionLazy).toHaveBeenCalledTimes(1);
    expect(locationMock.matchNearestGymForPosition).toHaveBeenCalledWith(
      expect.objectContaining({ accuracyM: 20, latitude: 51.501, longitude: -0.141 }),
      expect.arrayContaining([
        expect.objectContaining({ id: 'westside-barbell-club', name: 'Westside Barbell Club' }),
      ])
    );
  });

  it('keeps manual gym selection authoritative when a GPS suggestion is visible', async () => {
    locationMock.matchNearestGymForPosition.mockReturnValueOnce({
      status: 'matched',
      match: {
        gym: { id: 'westside-barbell-club', name: 'Westside Barbell Club', latitude: 51.501, longitude: -0.141 },
        distanceM: 18.4,
      },
    });

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByLabelText('Detect current gym'));
    expect(await screen.findByText('Looks like Westside Barbell Club')).toBeTruthy();

    fireEvent.press(screen.getByText('Choose gym'));
    fireEvent.press(screen.getByLabelText('Select gym Downtown Iron Temple'));

    expect(screen.getAllByText('Downtown Iron Temple').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Looks like Westside Barbell Club')).toBeNull();
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
  ])('shows inline GPS feedback for %s without changing the selected gym', async (_caseName, locationResult, matchResult, expectedMessage) => {
    locationMock.getCurrentForegroundPositionLazy.mockResolvedValueOnce(locationResult);
    if (matchResult) {
      locationMock.matchNearestGymForPosition.mockReturnValueOnce(matchResult);
    }

    render(<SessionRecorderScreen />);
    await dismissEmptyStateIfPresent();

    fireEvent.press(screen.getByLabelText('Detect current gym'));

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(screen.getByText('Choose gym')).toBeTruthy();
  });
});
