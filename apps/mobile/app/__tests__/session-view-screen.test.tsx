/* eslint-disable import/first */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockNavigation = {
  addListener: jest.fn((_event: string, _listener: (event: unknown) => void) => () => undefined),
  dispatch: jest.fn(),
};
// Every mounted focus callback, so a test can play "the screen came back".
const mockFocusCallbacks = new Set<() => void | (() => void)>();

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        mockFocusCallbacks.add(callback);
        const cleanup = callback();
        return () => {
          mockFocusCallbacks.delete(callback);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [callback]);
    },
    useLocalSearchParams: () => ({}),
    useNavigation: () => mockNavigation,
    useRouter: () => ({
      push: mockPush,
      replace: mockReplace,
      dismissTo: mockDismissTo,
      back: mockBack,
      canGoBack: mockCanGoBack,
    }),
  };
});

jest.mock('@/src/data', () => ({
  completeSessionDraft: jest.fn(),
  listLocalGymsIncludingArchived: jest.fn(),
  loadLatestSessionDraftSnapshot: jest.fn(),
  loadLocalGymById: jest.fn(),
  loadRecentExerciseBlocks: jest.fn(),
  loadSessionSnapshotById: jest.fn(),
  persistCompletedSessionSnapshot: jest.fn(),
  persistSessionDraftSnapshot: jest.fn(),
  setSessionDeletedState: jest.fn(),
  upsertLocalGym: jest.fn(),
}));

jest.mock('@/src/session-insights/repository', () => ({
  ...jest.requireActual('@/src/session-insights/repository'),
  loadSessionInsightHistory: jest.fn(),
}));
jest.mock('@/src/exercise-catalog/cache', () => ({
  useExerciseCatalog: () => ({
    status: 'ready',
    exercises: [{ id: 'def_bench', loadInputMode: 'total_load', mappings: [{ muscleGroupId: 'chest', role: 'primary' }] }],
    muscleGroups: [{ id: 'chest', displayName: 'Chest', familyName: 'Torso', sortOrder: 0 }],
  }),
}));

jest.mock('@/src/logging', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

// The injected location service: quiet (denied) unless a test says otherwise.
jest.mock('@/src/location/foreground-location-lazy', () => ({
  getCurrentForegroundPositionLazy: jest.fn(),
}));

// The picker has its own suite (exercise-picker.test.tsx); here it only has
// to hand back a choice or ask for Manage.
jest.mock('@/components/session-recorder/exercise-picker', () => ({
  ExercisePicker: ({
    visible,
    onSelectExercise,
    onOpenManage,
  }: {
    visible: boolean;
    onSelectExercise: (id: string, name: string) => void;
    onOpenManage: () => void;
  }) => {
    const { Pressable: MockPressable, Text: MockText, View: MockView } = jest.requireActual('react-native');
    return visible ? (
      <MockView>
        <MockPressable onPress={() => onSelectExercise('def_row', 'Seated Row')} testID="mock-picker-choose">
          <MockText>Choose</MockText>
        </MockPressable>
        <MockPressable onPress={onOpenManage} testID="mock-picker-manage">
          <MockText>Manage</MockText>
        </MockPressable>
      </MockView>
    ) : null;
  },
}));

import { SessionViewScreen } from '../session/[sessionId]/index';

const insightHistory = jest.requireMock('@/src/session-insights/repository').loadSessionInsightHistory as jest.Mock;
const data = jest.requireMock('@/src/data') as Record<string, jest.Mock>;
const location = jest.requireMock('@/src/location/foreground-location-lazy') as {
  getCurrentForegroundPositionLazy: jest.Mock;
};

const gymRow = (
  id: string,
  name: string,
  coordinates: { latitude: number; longitude: number } | null = null,
  archivedAt: Date | null = null
) => ({
  id,
  name,
  latitude: coordinates?.latitude ?? null,
  longitude: coordinates?.longitude ?? null,
  coordinateAccuracyM: coordinates ? 10 : null,
  coordinatesUpdatedAt: coordinates ? new Date('2026-09-01T10:00:00Z') : null,
  archivedAt,
});

const HARBOUR = { latitude: 51.5, longitude: -0.12 };

const positionAt = (coordinates: { latitude: number; longitude: number }, accuracyM = 20) => ({
  status: 'success',
  position: { ...coordinates, accuracyM, capturedAt: new Date('2026-09-23T09:05:00Z') },
});

const set = (
  id: string,
  weightValue: string,
  repsValue: string,
  setType: string | null,
  performanceStatus: 'planned' | 'unperformed' | null = null,
  planned?: { weight: string; reps: string; setType: string }
) => ({
  id,
  weightValue,
  repsValue,
  setType,
  plannedWeightValue: planned?.weight ?? null,
  plannedRepsValue: planned?.reps ?? null,
  plannedSetType: planned?.setType ?? null,
  performanceStatus,
});

const snapshot = () => ({
  sessionId: 'session-1',
  gymId: 'gym-1',
  status: 'active' as const,
  startedAt: new Date('2026-09-23T09:00:00'),
  createdAt: new Date('2026-09-23T09:00:00'),
  updatedAt: new Date('2026-09-23T09:30:00'),
  exercises: [
    {
      id: 'bench',
      exerciseDefinitionId: 'def_bench',
      name: 'Barbell Bench Press',
      machineName: null,
      sets: [
        set('b1', '100', '10', 'warm_up'),
        set('b2', '160', '8', 'rir_2'),
        set('b3', '', '', null, 'planned', { weight: '165', reps: '5', setType: 'rir_0' }),
      ],
    },
    {
      id: 'fly',
      exerciseDefinitionId: 'def_fly',
      name: 'Cable Flys',
      machineName: null,
      sets: [set('f1', '', '', null, 'planned', { weight: '22.5', reps: '15', setType: 'rir_2' })],
    },
  ],
});

// Answers each Alert with the button labelled `answer`, recording the titles.
const answerAlerts = (answer: (title: string) => string) => {
  const titles: string[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    titles.push(title);
    const choice = answer(title);
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
  return titles;
};

describe('Session view', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    insightHistory.mockReset().mockResolvedValue([]);
    jest.restoreAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockDismissTo.mockReset();
    data.loadLatestSessionDraftSnapshot.mockReset().mockImplementation(async () => snapshot());
    data.loadLocalGymById.mockReset().mockResolvedValue({ id: 'gym-1', name: 'Iron Works' });
    data.listLocalGymsIncludingArchived
      .mockReset()
      .mockResolvedValue([gymRow('gym-1', 'Iron Works'), gymRow('gym-2', 'Harbour Barbell', HARBOUR)]);
    location.getCurrentForegroundPositionLazy
      .mockReset()
      .mockResolvedValue({ status: 'permission_denied', canAskAgain: true });
    data.upsertLocalGym.mockReset().mockResolvedValue(undefined);
    data.loadRecentExerciseBlocks.mockReset().mockImplementation(async ({ exerciseDefinitionId }) => ({
      exerciseDefinitionId,
      limit: null,
      blocks:
        exerciseDefinitionId === 'def_bench'
          ? [{ sessionId: 'old', completedAt: new Date(0), daysAgo: 3, sessionExerciseIds: [], estimatedOneRepMax: 190, totalVolume: 0, highestWeight: 150, workingSetCount: 1 }]
          : [],
    }));
    data.persistSessionDraftSnapshot.mockReset().mockResolvedValue({ sessionId: 'session-1' });
    data.loadSessionSnapshotById.mockReset().mockResolvedValue(null);
    data.persistCompletedSessionSnapshot.mockReset().mockResolvedValue({ sessionId: 'done-1' });
    mockBack.mockReset();
    mockCanGoBack.mockReset().mockReturnValue(true);
    mockNavigation.addListener.mockClear();
    mockNavigation.dispatch.mockReset();
    data.completeSessionDraft.mockReset().mockResolvedValue({ sessionId: 'session-1' });
    data.setSessionDeletedState.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderReady = async () => {
    render(<SessionViewScreen sessionId="session-1" />);
    await screen.findByLabelText('Barbell Bench Press, 2 of 3 sets done, new 1RM record 204.3');
  };

  it('shows the summary and one read-only card per exercise, with its record band', async () => {
    await renderReady();

    expect(screen.getByTestId('session-view-summary-gym-button')).toHaveProp('accessibilityLabel', 'Gym Iron Works');
    expect(screen.getByLabelText('Sets 2')).toBeTruthy();
    expect(screen.getByLabelText('Volume 2280')).toBeTruthy();
    expect(screen.getByTestId('session-view-exercise-bench-record')).toBeTruthy();
    expect(screen.getByLabelText('Cable Flys, 0 of 1 sets done')).toBeTruthy();
    expect(screen.queryByTestId('session-view-exercise-fly-record')).toBeNull();
    // Mini legends label every metric column.
    expect(screen.getAllByText('1RM').length).toBeGreaterThan(0);
  });

  it('loads real exercise and muscle baselines for the active session', async () => {
    insightHistory.mockResolvedValue([{
      sessionId: 'prior', status: 'completed', completedAt: new Date('2026-01-01'),
      exercises: [{ id: 'prior-bench', exerciseDefinitionId: 'def_bench', exerciseName: 'Bench', orderIndex: 0,
        sets: [{ id: 'prior-set', orderIndex: 0, weightValue: '100', repsValue: '10', setType: 'rir_2', performanceStatus: null }] }],
    }]);
    await renderReady();
    await screen.findByText('128% above median');
    expect(insightHistory).toHaveBeenCalledWith({ targetSessionId: 'session-1', completedAt: expect.any(Date) });
    expect(screen.getByLabelText(/Barbell Bench Press, 2 sets · 1 working.*Historical median 1000/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    expect(screen.getByLabelText(/Chest, 2 sets · 1 working.*Historical median 500/)).toBeTruthy();
  });

  it('uses the persisted completion boundary when editing history', async () => {
    const completedAt = new Date('2026-09-01T12:00:00Z');
    data.loadLatestSessionDraftSnapshot.mockResolvedValue(null);
    data.loadSessionSnapshotById.mockResolvedValue({ ...snapshot(), status: 'completed', completedAt, deletedAt: null });
    await renderReady();
    expect(insightHistory).toHaveBeenCalledWith({ targetSessionId: 'session-1', completedAt });
  });

  it('keeps logging usable when comparison history fails', async () => {
    insightHistory.mockRejectedValue(new Error('History read failed'));
    await renderReady();
    await screen.findByText('Comparisons unavailable. Return to this session to retry.');
    fireEvent.press(screen.getByLabelText('Cable Flys, 0 of 1 sets done'));
    expect(mockPush).toHaveBeenCalledWith('/session/session-1/exercise/fly');
    expect(screen.queryByText('No comparison history yet')).toBeNull();
  });

  it('links each card to its exercise page', async () => {
    await renderReady();
    fireEvent.press(screen.getByLabelText('Cable Flys, 0 of 1 sets done'));
    expect(mockPush).toHaveBeenCalledWith('/session/session-1/exercise/fly');
  });

  it('finishes through the cleanup prompts and completion write, then opens the completion screen', async () => {
    const titles = answerAlerts((title) =>
      title.startsWith('Remove exercises') ? 'Remove empty exercises and submit' : 'unexpected'
    );
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/completed-session/session-1?presentation=completion')
    );
    expect(titles).toEqual(['Remove exercises with no sets and submit?']);
    // Confirmed sets only, planned columns cleared — the completed-history graph.
    const written = data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0];
    expect(written).toMatchObject({ sessionId: 'session-1', gymId: 'gym-1', status: 'active' });
    expect(written.startedAt).toEqual(new Date('2026-09-23T09:00:00'));
    expect(written.exercises).toHaveLength(1);
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['b1', 'b2']);
    expect(data.completeSessionDraft).toHaveBeenCalledWith('session-1');
  });

  it('writes nothing when a finish prompt is declined', async () => {
    answerAlerts(() => 'Go back to edit session');
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
    expect(data.completeSessionDraft).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('abandons only after the destructive confirmation, then returns to Train', async () => {
    let answer = 'Keep session';
    const titles = answerAlerts(() => answer);
    await renderReady();

    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(titles).toEqual(['Abandon session?']);
    expect(data.setSessionDeletedState).not.toHaveBeenCalled();

    answer = 'Abandon';
    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(data.setSessionDeletedState).toHaveBeenCalledWith('session-1', true);
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('adds an exercise with one empty set to the persisted draft', async () => {
    await renderReady();

    fireEvent.press(screen.getByTestId('session-view-add-exercise'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('mock-picker-choose'));
    });

    const written = data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0];
    expect(written.exercises.map((exercise: { name: string }) => exercise.name)).toEqual([
      'Barbell Bench Press',
      'Cable Flys',
      'Seated Row',
    ]);
    expect(written.exercises[2].sets).toHaveLength(1);
    expect(written.exercises[2].sets[0]).toMatchObject({ repsValue: '', weightValue: '', performanceStatus: 'unperformed' });
    // The existing sets go back unchanged.
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('opens the catalogue from the picker\'s Manage and shows the picker again on return', async () => {
    await renderReady();

    fireEvent.press(screen.getByTestId('session-view-add-exercise'));
    fireEvent.press(screen.getByTestId('mock-picker-manage'));

    expect(mockPush).toHaveBeenCalledWith('/exercise-catalog?source=session&intent=manage');
    expect(screen.queryByTestId('mock-picker-choose')).toBeNull();

    await act(async () => {
      mockFocusCallbacks.forEach((callback) => callback());
    });
    expect(screen.getByTestId('mock-picker-choose')).toBeTruthy();
  });

  it('picks the gym from the gym sheet by tapping the Gym stat', async () => {
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-summary-gym-button'));
    });
    // No gym, the seeded gyms, then the local ones; the current one marked.
    expect(screen.getByTestId('session-view-gym-option-none')).toBeTruthy();
    expect(screen.getByTestId('session-view-gym-option-downtown-iron-temple')).toBeTruthy();
    expect(screen.getByTestId('session-view-gym-option-gym-1')).toBeSelected();

    data.loadLocalGymById.mockResolvedValue({ id: 'gym-2', name: 'Harbour Barbell' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-gym-2'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'gym-2', name: 'Harbour Barbell' });
    const written = data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0];
    expect(written).toMatchObject({ sessionId: 'session-1', gymId: 'gym-2', status: 'active' });
    // The sets go back unchanged.
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('clears the gym with No gym', async () => {
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-summary-gym-button'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-none'));
    });

    expect(data.upsertLocalGym).not.toHaveBeenCalled();
    expect(data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ gymId: null });
  });

  const openGymSheet = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-summary-gym-button'));
    });
  };

  it('suggests the one nearby gym as the first row, and selects it only when tapped', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await renderReady();

    await openGymSheet();

    const suggestion = await screen.findByTestId('session-view-gym-suggestion');
    expect(screen.getByText('Nearby · Harbour Barbell')).toBeTruthy();
    // Suggest only: nothing is written until the lifter taps it.
    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-view-gym-option-gym-1')).toBeSelected();

    data.loadLocalGymById.mockResolvedValue({ id: 'gym-2', name: 'Harbour Barbell' });
    await act(async () => {
      fireEvent.press(suggestion);
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'gym-2', name: 'Harbour Barbell' });
    expect(data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ gymId: 'gym-2' });
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();
  });

  it.each([
    ['permission denial', () => ({ status: 'permission_denied', canAskAgain: false })],
    ['services off', () => ({ status: 'unavailable', reason: 'services_disabled' })],
    ['a read failure', () => ({ status: 'read_failure', error: new Error('gps') })],
    ['low accuracy', () => positionAt(HARBOUR, 140)],
    ['no gym in range', () => positionAt({ latitude: 48.85, longitude: 2.35 })],
  ])('shows no suggestion row on %s', async (_case, result) => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(result());
    await renderReady();

    await openGymSheet();
    await act(async () => {});

    expect(location.getCurrentForegroundPositionLazy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('session-view-gym-option-gym-2')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('shows no suggestion row when two gyms tie, or when no gym has a location', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    data.listLocalGymsIncludingArchived.mockResolvedValue([
      gymRow('gym-1', 'Iron Works', { latitude: 51.5001, longitude: -0.12 }),
      gymRow('gym-2', 'Harbour Barbell', HARBOUR),
    ]);
    await renderReady();

    await openGymSheet();
    await act(async () => {});
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();

    fireEvent.press(screen.getByTestId('session-view-gym-sheet-backdrop', { includeHiddenElements: true }));
    data.listLocalGymsIncludingArchived.mockResolvedValue([gymRow('gym-1', 'Iron Works'), gymRow('gym-2', 'Harbour Barbell')]);
    await openGymSheet();
    await act(async () => {});
    expect(screen.getByTestId('session-view-gym-option-gym-2')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('gives up on the suggestion after 1.5 s without a fix, leaving the list usable', async () => {
    let resolveFix: (value: unknown) => void = () => undefined;
    location.getCurrentForegroundPositionLazy.mockReturnValue(new Promise((resolve) => (resolveFix = resolve)));
    await renderReady();

    await openGymSheet();
    expect(screen.getByTestId('session-view-gym-option-gym-2')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    // A fix arriving after the budget is dropped.
    await act(async () => {
      resolveFix(positionAt(HARBOUR));
    });

    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('does not suggest the gym the session already has', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    data.loadLocalGymById.mockResolvedValue({ id: 'gym-2', name: 'Harbour Barbell' });
    data.loadLatestSessionDraftSnapshot.mockImplementation(async () => ({ ...snapshot(), gymId: 'gym-2' }));
    await renderReady();

    await openGymSheet();
    await act(async () => {});

    expect(screen.getByTestId('session-view-gym-option-gym-2')).toBeSelected();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('leaves archived gyms out of the sheet, seeded ones included', async () => {
    data.listLocalGymsIncludingArchived.mockResolvedValue([
      gymRow('downtown-iron-temple', 'Downtown Iron Temple', null, new Date('2026-09-20T10:00:00Z')),
      gymRow('gym-1', 'Iron Works'),
      gymRow('gym-3', 'Old Garage', HARBOUR, new Date('2026-09-20T10:00:00Z')),
    ]);
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await renderReady();

    await openGymSheet();
    await act(async () => {});

    expect(screen.getByTestId('session-view-gym-option-westside-barbell-club')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-option-downtown-iron-temple')).toBeNull();
    expect(screen.queryByTestId('session-view-gym-option-gym-3')).toBeNull();
    // An archived gym is never suggested either.
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('opens the Gyms screen from Manage gyms and reopens the sheet, reloaded, on return', async () => {
    await renderReady();

    await openGymSheet();
    fireEvent.press(screen.getByTestId('session-view-gym-manage'));

    expect(mockPush).toHaveBeenCalledWith('/gyms');
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();

    data.listLocalGymsIncludingArchived.mockResolvedValue([
      gymRow('gym-1', 'Iron Works'),
      gymRow('gym-2', 'Harbour Barbell', HARBOUR),
      gymRow('gym-4', 'Canal Street Gym'),
    ]);
    await act(async () => {
      mockFocusCallbacks.forEach((callback) => callback());
    });

    expect(screen.getByTestId('session-view-gym-sheet')).toBeTruthy();
    expect(await screen.findByTestId('session-view-gym-option-gym-4')).toBeTruthy();

    // A later return with the sheet closed leaves it closed.
    fireEvent.press(screen.getByTestId('session-view-gym-sheet-backdrop', { includeHiddenElements: true }));
    await act(async () => {
      mockFocusCallbacks.forEach((callback) => callback());
    });
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();
  });

  it('says so when its session is no longer the active draft', async () => {
    data.loadLatestSessionDraftSnapshot.mockResolvedValue(null);
    render(<SessionViewScreen sessionId="session-1" />);

    expect(await screen.findByText('This session is no longer active.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-view-back'));
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('shows a retryable error when the draft cannot be read', async () => {
    data.loadLatestSessionDraftSnapshot.mockRejectedValueOnce(new Error('disk'));
    render(<SessionViewScreen sessionId="session-1" />);

    fireEvent.press(await screen.findByTestId('session-view-retry'));
    expect(await screen.findByLabelText('Cable Flys, 0 of 1 sets done')).toBeTruthy();
  });
});

// The completed edit (once the old recorder's `?mode=completed-edit`), on the session
// view: these port its load, validation, autosave, save and leave cases.
describe('Session view: editing a completed session', () => {
  // Stored to the second, so Done can prove it keeps untouched instants.
  const STARTED_AT = new Date(2026, 1, 25, 10, 0, 30);
  const COMPLETED_AT = new Date(2026, 1, 25, 10, 45, 10);

  const completed = (
    exercises = [
      {
        id: 'bench',
        exerciseDefinitionId: 'def_bench',
        name: 'Barbell Bench Press',
        machineName: null,
        sets: [set('c1', '160', '8', 'rir_1'), set('c2', '150', '8', 'rir_2', 'unperformed')],
      },
    ],
    overrides: Record<string, unknown> = {}
  ) => ({
    sessionId: 'done-1',
    gymId: 'gym-1',
    status: 'completed' as const,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    durationSec: 2680,
    deletedAt: null,
    createdAt: STARTED_AT,
    updatedAt: COMPLETED_AT,
    exercises,
    ...overrides,
  });

  let stored: ReturnType<typeof completed>;

  beforeEach(() => {
    jest.useFakeTimers();
    insightHistory.mockReset().mockResolvedValue([]);
    jest.restoreAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockDismissTo.mockReset();
    mockBack.mockReset();
    mockCanGoBack.mockReset().mockReturnValue(true);
    mockNavigation.addListener.mockClear();
    mockNavigation.dispatch.mockReset();
    stored = completed();
    // Another session is the active draft; this one is history.
    data.loadLatestSessionDraftSnapshot.mockReset().mockImplementation(async () => snapshot());
    data.loadSessionSnapshotById.mockReset().mockImplementation(async (id: string) =>
      id === stored.sessionId ? stored : null
    );
    data.loadLocalGymById.mockReset().mockResolvedValue({ id: 'gym-1', name: 'Iron Works' });
    data.listLocalGymsIncludingArchived.mockReset().mockResolvedValue([gymRow('gym-2', 'Harbour Barbell')]);
    location.getCurrentForegroundPositionLazy
      .mockReset()
      .mockResolvedValue({ status: 'permission_denied', canAskAgain: true });
    data.upsertLocalGym.mockReset().mockResolvedValue(undefined);
    data.loadRecentExerciseBlocks.mockReset().mockResolvedValue({ exerciseDefinitionId: null, limit: null, blocks: [] });
    data.persistSessionDraftSnapshot.mockReset().mockResolvedValue({ sessionId: 'session-1' });
    data.persistCompletedSessionSnapshot.mockReset().mockResolvedValue({ sessionId: 'done-1' });
    data.completeSessionDraft.mockReset();
    data.setSessionDeletedState.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderCompleted = async () => {
    render(<SessionViewScreen sessionId="done-1" />);
    await screen.findByTestId('session-view-done-button');
  };

  const lastCompletedWrite = () => data.persistCompletedSessionSnapshot.mock.calls.at(-1)?.[0];

  const pressDone = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-done-button'));
    });
  };

  it('opens with Start/End in place of Time, and Done in place of Finish and Abandon', async () => {
    await renderCompleted();

    expect(screen.getByText('Edit session')).toBeTruthy();
    expect(screen.queryByTestId('session-view-finish-button')).toBeNull();
    expect(screen.queryByTestId('session-view-options-button')).toBeNull();
    expect(screen.queryByTestId('session-view-summary-time')).toBeNull();
    expect(screen.getByTestId('session-view-start-time')).toHaveProp('value', '2026-02-25 10:00');
    expect(screen.getByTestId('session-view-end-time')).toHaveProp('value', '2026-02-25 10:45');
    expect(screen.getByTestId('session-view-summary-gym-button')).toHaveProp('accessibilityLabel', 'Gym Iron Works');
    expect(screen.getByLabelText('Barbell Bench Press, 1 of 2 sets done')).toBeTruthy();
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
  });

  it('validates Start/End, and Done writes nothing until they are valid', async () => {
    await renderCompleted();
    const start = screen.getByTestId('session-view-start-time');
    const end = screen.getByTestId('session-view-end-time');

    fireEvent.changeText(start, '2026-02-30 10:00');
    fireEvent.changeText(end, '2026-02-30 10:50');
    await act(async () => {
      fireEvent(start, 'blur');
      fireEvent(end, 'blur');
    });
    expect(screen.getByTestId('session-view-start-time-error')).toHaveTextContent(
      'Enter a valid Start time in YYYY-MM-DD HH:mm format.'
    );
    expect(screen.getByTestId('session-view-end-time-error')).toHaveTextContent(
      'Enter a valid End time in YYYY-MM-DD HH:mm format.'
    );
    expect(screen.getByTestId('session-view-times-notice')).toHaveTextContent(
      'Autosave paused until Start/End times are valid.'
    );
    await pressDone();
    expect(data.persistCompletedSessionSnapshot).not.toHaveBeenCalled();

    fireEvent.changeText(start, '2026-02-25 10:00');
    fireEvent.changeText(end, '2026-02-25 09:55');
    expect(screen.queryByTestId('session-view-start-time-error')).toBeNull();
    expect(screen.getByTestId('session-view-end-time-error')).toHaveTextContent(
      'End time must be later than or equal to Start time.'
    );
    await pressDone();
    expect(data.persistCompletedSessionSnapshot).not.toHaveBeenCalled();

    fireEvent.changeText(end, '2026-02-25 10:50');
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
    answerAlerts((title) => (title.startsWith('Discard unconfirmed') ? 'Discard unconfirmed sets and save changes' : 'x'));
    await pressDone();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    // Start still shows its stored minute, so it keeps the stored instant.
    expect(lastCompletedWrite()).toMatchObject({
      sessionId: 'done-1',
      gymId: 'gym-1',
      startedAt: STARTED_AT,
      completedAt: new Date(2026, 1, 25, 10, 50, 0, 0),
    });
    expect(data.completeSessionDraft).not.toHaveBeenCalled();
    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
  });

  it('pauses autosave while the times are invalid and resumes, keeping every row, when they are valid', async () => {
    await renderCompleted();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 09:50');
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(data.persistCompletedSessionSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-view-times-notice')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 10:50');
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    expect(data.persistCompletedSessionSnapshot).toHaveBeenCalledTimes(1);
    const written = lastCompletedWrite();
    expect(written).toMatchObject({ startedAt: STARTED_AT, completedAt: new Date(2026, 1, 25, 10, 50) });
    // Autosave is lossless: the unconfirmed row stays until Done.
    expect(written.exercises[0].sets.map((row: { id: string; performanceStatus: string | null }) => [row.id, row.performanceStatus])).toEqual([
      ['c1', null],
      ['c2', 'unperformed'],
    ]);
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
  });

  it('saves confirmed rows only on Done: planned and skipped rows drop out, zero-weight sets stay', async () => {
    stored = completed([
      {
        id: 'bench',
        exerciseDefinitionId: 'def_bench',
        name: 'Barbell Bench Press',
        machineName: null,
        sets: [
          { ...set('s-skipped', '', '', null), plannedWeightValue: '225', plannedRepsValue: '5', plannedSetType: 'rir_2', performanceStatus: 'skipped' },
          set('s-planned', '', '', null, 'planned', { weight: '245', reps: '3', setType: 'rir_1' }),
          set('s-performed', '185', '8', 'rir_1', null, { weight: '185', reps: '8', setType: 'rir_2' }),
          set('s-zero', '0', '5', null),
        ],
      },
    ] as never);
    const titles = answerAlerts(() => 'unexpected');
    await renderCompleted();

    await pressDone();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(titles).toEqual([]);
    const written = lastCompletedWrite();
    expect(written.exercises).toHaveLength(1);
    expect(written.exercises[0].sets).toEqual([
      expect.objectContaining({
        id: 's-performed',
        weightValue: '185',
        repsValue: '8',
        setType: 'rir_1',
        plannedWeightValue: null,
        plannedRepsValue: null,
        plannedSetType: null,
        performanceStatus: null,
      }),
      expect.objectContaining({ id: 's-zero', weightValue: '0', repsValue: '5' }),
    ]);
    expect(data.completeSessionDraft).not.toHaveBeenCalled();
  });

  it('asks before discarding with the completed-edit copy, and writes nothing when declined', async () => {
    stored = completed([
      {
        id: 'bench',
        exerciseDefinitionId: 'def_bench',
        name: 'Barbell Bench Press',
        machineName: null,
        sets: [set('c1', '225', '5', null), set('c2', '205', '', null, 'unperformed')],
      },
      { id: 'fly', exerciseDefinitionId: 'def_fly', name: 'Cable Flys', machineName: null, sets: [] },
    ] as never);
    let answer = 'Go back to edit session';
    const titles = answerAlerts(() => answer);
    await renderCompleted();

    await pressDone();
    expect(titles).toEqual(['Remove incomplete sets and empty exercises?']);
    expect(data.persistCompletedSessionSnapshot).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();

    answer = 'Remove and save changes';
    await pressDone();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const written = lastCompletedWrite();
    expect(written.exercises.map((exercise: { id: string }) => exercise.id)).toEqual(['bench']);
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['c1']);
  });

  it('labels each cleanup prompt for saving changes', async () => {
    const buttons: string[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      const confirm = alertButtons?.find((button) => button.style !== 'cancel');
      buttons.push(confirm?.text ?? '');
      confirm?.onPress?.();
    });
    await renderCompleted();

    await pressDone();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(buttons).toEqual(['Discard unconfirmed sets and save changes']);
  });

  it('goes to the completed session when there is nothing to go back to', async () => {
    mockCanGoBack.mockReturnValue(false);
    answerAlerts(() => 'Discard unconfirmed sets and save changes');
    await renderCompleted();

    await pressDone();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/completed-session/done-1'));
  });

  it('writes pending valid times before the screen is removed', async () => {
    await renderCompleted();
    const listener = mockNavigation.addListener.mock.calls.find(([event]) => event === 'beforeRemove')?.[1];
    expect(listener).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 10:50');
    const preventDefault = jest.fn();
    const action = { type: 'GO_BACK' };
    await act(async () => {
      listener?.({ preventDefault, data: { action } });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(action));
    expect(lastCompletedWrite()).toMatchObject({ sessionId: 'done-1', completedAt: new Date(2026, 1, 25, 10, 50) });
  });

  it('changes the gym in place, keeping the session completed and its times', async () => {
    await renderCompleted();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-summary-gym-button'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-gym-2'));
    });

    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'gym-2', name: 'Harbour Barbell' });
    expect(lastCompletedWrite()).toMatchObject({
      sessionId: 'done-1',
      gymId: 'gym-2',
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    });
    expect(lastCompletedWrite().exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['c1', 'c2']);
    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
  });

  it('adds an exercise to the completed session', async () => {
    await renderCompleted();

    fireEvent.press(screen.getByTestId('session-view-add-exercise'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('mock-picker-choose'));
    });

    const written = lastCompletedWrite();
    expect(written.exercises.map((exercise: { name: string }) => exercise.name)).toEqual([
      'Barbell Bench Press',
      'Seated Row',
    ]);
    expect(written.completedAt).toEqual(COMPLETED_AT);
    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
  });

  it('measures its records against the rest of history, not against itself', async () => {
    data.loadRecentExerciseBlocks.mockResolvedValue({
      exerciseDefinitionId: 'def_bench',
      limit: null,
      blocks: [
        { sessionId: 'done-1', completedAt: COMPLETED_AT, daysAgo: 0, sessionExerciseIds: ['bench'], estimatedOneRepMax: 204.3, totalVolume: 1280, highestWeight: 160, workingSetCount: 1 },
        { sessionId: 'older', completedAt: new Date(0), daysAgo: 30, sessionExerciseIds: [], estimatedOneRepMax: 190, totalVolume: 0, highestWeight: 150, workingSetCount: 1 },
      ],
    });
    render(<SessionViewScreen sessionId="done-1" />);

    expect(await screen.findByLabelText('Barbell Bench Press, 1 of 2 sets done, new 1RM record 204.3')).toBeTruthy();
  });

  it('says so when the completed session was deleted', async () => {
    stored = completed(undefined, { deletedAt: new Date(2026, 1, 26) });
    render(<SessionViewScreen sessionId="done-1" />);

    expect(await screen.findByTestId('session-view-missing')).toBeTruthy();
  });
});
