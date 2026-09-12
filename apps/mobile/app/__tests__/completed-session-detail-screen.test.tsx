import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import CompletedSessionDetailRoute, {
  CompletedSessionDetailScreenShell,
  resolveCompletedSessionPresentation,
  type CompletedSessionDetailDataClient,
  type CompletedSessionDetailRecord,
} from '../completed-session/[sessionId]';

let mockLocalSearchParams: Record<string, string | undefined> = {
  sessionId: 'session-completed-1',
};
const mockStackScreen = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
let mockLatestFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockLocalSearchParams,
  useRouter: () => ({
    push: mockPush,
    dismissTo: mockDismissTo,
    replace: mockReplace,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockLatestFocusCallback = callback;
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
  __triggerFocus: () => {
    mockLatestFocusCallback?.();
  },
}));

jest.mock('@/src/data', () => ({
  formatSessionListCompactDuration: (durationSec: number | null) => {
    if (!durationSec || durationSec <= 0) {
      return '0m';
    }

    const totalMinutes = Math.floor(durationSec / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours <= 0) {
      return `${totalMinutes}m`;
    }

    if (minutes <= 0) {
      return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
  },
  listSessionListBuckets: jest.fn().mockResolvedValue({ active: null, completed: [] }),
  listSessionExerciseAssignedTags: jest.fn().mockResolvedValue([]),
  loadLocalGymById: jest.fn(),
  loadSessionSnapshotById: jest.fn(),
  appendCompletedSessionExerciseAsPlanned: jest.fn(),
  isWorkingSessionSetType: (value: unknown) =>
    value === 'rir_0' || value === 'rir_1' || value === 'rir_2',
  normalizeSessionSetType: (value: unknown) =>
    value === 'warm_up' || value === 'rir_0' || value === 'rir_1' || value === 'rir_2' ? value : null,
  setSessionDeletedState: jest.fn(),
}));

const mockEnsureExerciseCatalogLoaded = jest.fn().mockResolvedValue(undefined);
let mockExerciseCatalogState = {
  status: 'ready' as 'loading' | 'ready' | 'error',
  exercises: [
    {
      id: 'bench-press',
      name: 'Bench Press',
      loadInputMode: 'total_load',
      deletedAt: null,
      mappings: [{ id: 'mapping-chest', muscleGroupId: 'chest', role: 'primary', weight: 1 }],
    },
    {
      id: 'lat-pulldown',
      name: 'Lat Pulldown',
      loadInputMode: 'total_load',
      deletedAt: null,
      mappings: [],
    },
  ],
  muscleGroups: [{ id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 1 }],
  muscleGroupsById: {},
  lastError: null as Error | null,
};

jest.mock('@/src/exercise-catalog/cache', () => ({
  ensureExerciseCatalogLoaded: () => mockEnsureExerciseCatalogLoaded(),
  useExerciseCatalog: () => mockExerciseCatalogState,
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => true,
}));

const {
  loadLocalGymById: mockLoadLocalGymById,
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
} = jest.requireMock('@/src/data') as {
  loadLocalGymById: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
};

const COMPLETED_SESSION_DETAIL_FIXTURE: CompletedSessionDetailRecord = {
  id: 'completed-under-test',
  startedAt: '2026-02-20T16:00:00.000Z',
  completedAt: '2026-02-20T16:58:00.000Z',
  durationDisplay: '58m',
  gymName: 'Westside Barbell Club',
  deletedAt: null,
  exercises: [
    {
      id: 'exercise-1',
      exerciseDefinitionId: 'bench-press',
      name: 'Bench Press',
      machineName: 'Flat Bench',
      tags: [
        { tagDefinitionId: 'tag-1', name: 'Paused', deletedAt: null },
        { tagDefinitionId: 'tag-2', name: 'Tempo', deletedAt: null },
      ],
      sets: [
        { id: 'set-1', weight: '135', reps: '8', setType: 'warm_up' },
        { id: 'set-2', weight: '185', reps: '8', setType: 'rir_0' },
        { id: 'set-3', weight: '185', reps: '6', setType: 'rir_1' },
        { id: 'set-4', weight: '185', reps: '5', setType: 'rir_2' },
      ],
    },
    {
      id: 'exercise-2',
      exerciseDefinitionId: 'lat-pulldown',
      name: 'Lat Pulldown',
      machineName: 'Cable',
      tags: [],
      sets: [
        { id: 'set-5', weight: '120', reps: '12', setType: null },
      ],
    },
  ],
};

describe('CompletedSessionDetailScreenShell', () => {
  beforeEach(() => {
    mockLoadLocalGymById.mockReset();
    mockLoadSessionSnapshotById.mockReset();
    mockStackScreen.mockReset();
    mockPush.mockReset();
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockLatestFocusCallback = null;
    mockEnsureExerciseCatalogLoaded.mockClear();
    mockExerciseCatalogState = {
      ...mockExerciseCatalogState,
      status: 'ready',
      lastError: null,
    };
  });

  it('validates completion presentation route values', () => {
    expect(resolveCompletedSessionPresentation('completion')).toBe('completion');
    expect(resolveCompletedSessionPresentation(['completion'])).toBe('completion');
    expect(resolveCompletedSessionPresentation('unexpected')).toBe('detail');
    expect(resolveCompletedSessionPresentation(undefined)).toBe('detail');
  });

  it('renders the no-PR completion hierarchy and hides ordinary detail actions', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-completion-presentation')).toBeTruthy();
    });
    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(screen.getByText('58m · 2 exercises · 5 sets')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-personal-records')).toBeNull();
    expect(screen.getByTestId('session-muscle-load-surface')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-action-bar')).toBeNull();
    expect(screen.queryByText('Append')).toBeNull();
  });

  it('exposes and retries the Maestro-only catalog failure evidence state', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
        shouldFailNextMaestroCatalog
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-muscle-load-row-status')).toHaveTextContent(
        'Unavailable · 5 sets (3 working)'
      );
    });

    fireEvent.press(screen.getByLabelText('Retry session muscle load'));
    expect(screen.getByTestId('session-muscle-load-row-status')).toHaveTextContent(
      '1 muscle · 5 sets (3 working)'
    );
  });

  it('pages multiple PRs deterministically and shares each selected record independently', async () => {
    const personalRecords = [
      {
        exerciseDefinitionId: 'bench-press',
        exerciseName: 'Bench Press',
        sessionExerciseId: 'exercise-1',
        sessionExerciseOrderIndex: 0,
        setId: 'set-2',
        setOrderIndex: 1,
        weight: 185,
        reps: 8,
        estimatedOneRepMax: 234.33,
        historicalBestEstimatedOneRepMax: 220,
      },
      {
        exerciseDefinitionId: 'lat-pulldown',
        exerciseName: 'Lat Pulldown',
        sessionExerciseId: 'exercise-2',
        sessionExerciseOrderIndex: 1,
        setId: 'set-5',
        setOrderIndex: 0,
        weight: 120,
        reps: 12,
        estimatedOneRepMax: 168,
        historicalBestEstimatedOneRepMax: 150,
      },
    ];
    const shareAction = jest
      .fn()
      .mockRejectedValueOnce(new Error('Share is unavailable'))
      .mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue(personalRecords),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
        sharePersonalRecordAction={shareAction}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-completion-pr-position')).toHaveTextContent('1 of 2');
    });
    expect(screen.getByText('Bench Press')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Share PR for Bench Press'));
    await waitFor(() => expect(screen.getByText('Share is unavailable')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Share PR for Bench Press'));
    await waitFor(() => expect(shareAction).toHaveBeenCalledTimes(2));

    fireEvent.press(screen.getByLabelText('Next personal record'));
    expect(screen.getByTestId('session-completion-pr-position')).toHaveTextContent('2 of 2');
    expect(screen.getByText('Lat Pulldown')).toBeTruthy();
    expect(screen.queryByText('Share is unavailable')).toBeNull();
  });

  it('replaces to Stats for both completion exits', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByTestId('session-completion-done')).toBeTruthy());
    fireEvent.press(screen.getByTestId('session-completion-view-muscle-load'));
    expect(mockReplace).toHaveBeenCalledWith('/stats-history?period=7&breakdown=muscle');

    view.unmount();
    mockReplace.mockClear();
    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );
    await waitFor(() => expect(screen.getByTestId('session-completion-done')).toBeTruthy());
    fireEvent.press(screen.getByTestId('session-completion-done'));
    expect(mockReplace).toHaveBeenCalledWith('/stats-history');
  });

  it('replaces to Stats when Android hardware back is pressed during completion', async () => {
    let hardwareBackHandler: Parameters<typeof BackHandler.addEventListener>[1] | null = null;
    const remove = jest.fn();
    const addEventListenerSpy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_eventName, handler) => {
        hardwareBackHandler = handler;
        return { remove };
      });
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    const view = render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByTestId('session-completion-done')).toBeTruthy());
    expect(hardwareBackHandler).not.toBeNull();
    act(() => {
      expect(hardwareBackHandler?.()).toBe(true);
    });
    expect(mockReplace).toHaveBeenCalledWith('/stats-history');

    view.unmount();
    expect(remove).toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });

  it('shows recoverable catalog-error content during completion', async () => {
    mockExerciseCatalogState = {
      ...mockExerciseCatalogState,
      status: 'error',
      lastError: new Error('Catalog unavailable'),
    };
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByText(/Unavailable ·/)).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Retry session muscle load'));
    expect(mockEnsureExerciseCatalogLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('session-completion-done')).toBeTruthy();
  });

  it('offers one safe exit when a completion target is deleted', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: '2026-02-21T10:00:00.000Z',
      }),
      loadPersonalRecords: jest.fn().mockResolvedValue(null),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByTestId('completed-session-detail-empty')).toBeTruthy());
    expect(screen.getByTestId('session-completion-safe-exit')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-presentation')).toBeNull();
    fireEvent.press(screen.getByTestId('session-completion-safe-exit'));
    expect(mockReplace).toHaveBeenCalledWith('/stats-history');
  });

  it('offers one safe exit when completion loading fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
      loadPersonalRecords: jest.fn().mockResolvedValue([]),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByTestId('completed-session-detail-error')).toBeTruthy());
    expect(screen.getByText('Storage unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-completion-safe-exit'));
    expect(mockReplace).toHaveBeenCalledWith('/stats-history');
  });

  it('renders loading then a recorder-like read-only detail on success', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    expect(screen.getByTestId('completed-session-detail-loading')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText('End')).toBeTruthy();
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('Location')).toBeTruthy();
    expect(screen.queryByText('Date and Time')).toBeNull();
    expect(screen.queryByText('Gym')).toBeNull();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-reopen-button')).toBeNull();
    expect(screen.getAllByText('Append')).toHaveLength(2);
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-screen').props.stickyHeaderIndices).toEqual([0]);
    expect(screen.getByTestId('completed-session-detail-sets-table-header-exercise-1')).toBeTruthy();
    expect(screen.getAllByText('Weight').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reps').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Effort').length).toBeGreaterThan(0);
    expect(screen.getByText('W-Up')).toBeTruthy();
    expect(screen.getByText('RIR 0')).toBeTruthy();
    expect(screen.getByText('RIR 1')).toBeTruthy();
    expect(screen.getByText('RIR 2')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Flat Bench')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-tags-exercise-1')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Tempo')).toBeTruthy();
    expect(screen.getAllByText('185').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
    expect(screen.getByText('58m')).toBeTruthy();
  });

  it('does not render tag chips when an exercise has no assigned tags', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        exercises: COMPLETED_SESSION_DETAIL_FIXTURE.exercises.map((exercise) => ({
          ...exercise,
          tags: [],
        })),
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.queryByTestId('completed-session-detail-tags-exercise-1')).toBeNull();
  });

  it('collapses each exercise to valid performed-set and working-set counts', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        exercises: COMPLETED_SESSION_DETAIL_FIXTURE.exercises.map((exercise, index) =>
          index === 0
            ? {
                ...exercise,
                sets: [
                  ...exercise.sets,
                  { id: 'set-invalid', weight: '', reps: '5', setType: 'rir_0' as const },
                  {
                    id: 'set-unconfirmed',
                    weight: '500',
                    reps: '10',
                    setType: 'rir_0' as const,
                    performanceStatus: 'unperformed' as const,
                  },
                ],
              }
            : exercise
        ),
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        sessionId="completed-under-test"
        dataClient={dataClient}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    const collapseToggle = screen.getByTestId('exercise-collapse-toggle-1');
    fireEvent.press(collapseToggle);

    expect(collapseToggle.props.accessibilityState.expanded).toBe(false);
    expect(
      screen.getByTestId('completed-session-detail-collapsed-summary-exercise-1-counts')
    ).toHaveTextContent('4 sets · 3 w/sets');
    expect(
      screen.queryByTestId('completed-session-detail-collapsed-summary-exercise-1-new-pr')
    ).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-sets-table-header-exercise-1')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-tags-exercise-1')).toBeNull();
    expect(screen.queryByText('500kg')).toBeNull();
    expect(
      screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1')
    ).toBeTruthy();

    fireEvent.press(collapseToggle);

    expect(collapseToggle.props.accessibilityState.expanded).toBe(true);
    expect(screen.getByTestId('completed-session-detail-sets-table-header-exercise-1')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-tags-exercise-1')).toBeTruthy();
  });

  it('edit action navigates to the recorder completed-edit UI', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Edit')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));

    expect(mockPush).toHaveBeenCalledWith('/session-recorder?mode=completed-edit&sessionId=completed-under-test');
  });

  it('per-exercise append action calls the data client and opens the recorder', async () => {
    const mockAppendCompletedSessionExercise = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: mockAppendCompletedSessionExercise,
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1'));

    await waitFor(() => {
      expect(mockAppendCompletedSessionExercise).toHaveBeenCalledWith('completed-under-test', 'exercise-1');
      expect(mockPush).toHaveBeenCalledWith('/session-recorder');
    });
  });

  it('renders one append action for each exercise block', async () => {
    const mockAppendCompletedSessionExercise = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      appendCompletedSessionExerciseAsPlanned: mockAppendCompletedSessionExercise,
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-2')).toBeTruthy();
    expect(screen.getByLabelText('Append Bench Press block to current session')).toBeTruthy();
    expect(screen.getByLabelText('Append Lat Pulldown block to current session')).toBeTruthy();
  });

  it('shows non-destructive feedback when append fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockRejectedValue(new Error('Unable to append now')),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1'));

    await waitFor(() => {
      expect(screen.getByText('Unable to append now')).toBeTruthy();
    });
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
  });

  it('reloads the completed session when the detail screen regains focus', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest
        .fn()
        .mockResolvedValueOnce(COMPLETED_SESSION_DETAIL_FIXTURE)
        .mockResolvedValueOnce({
          ...COMPLETED_SESSION_DETAIL_FIXTURE,
          gymName: 'Updated Gym',
        }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };
    const { __triggerFocus: triggerFocus } = jest.requireMock('expo-router') as {
      __triggerFocus: () => void;
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByText('Westside Barbell Club')).toBeTruthy();
    });

    act(() => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByText('Updated Gym')).toBeTruthy();
    });
  });

  it('delete and undelete persist through the data client and update the action label', async () => {
    const mockSetCompletedSessionDeletedState = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient & {
      setCompletedSessionDeletedState: jest.Mock;
    } = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: mockSetCompletedSessionDeletedState,
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Delete')).toBeTruthy();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledWith('completed-under-test', true);
    });
    await waitFor(() => {
      expect(screen.getByText('Undelete')).toBeTruthy();
    });
    expect(screen.queryByText('Deleting...')).toBeNull();
    expect(screen.queryByText(/viewer-only stub/i)).toBeNull();
    expect(screen.getByText('Session hidden from default history.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenNthCalledWith(2, 'completed-under-test', false);
    });
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Session restored to default history.')).toBeTruthy();
  });

  it('disables the delete button while delete state is being persisted', async () => {
    let resolveDeleteRequest: (() => void) | undefined;
    const pendingDeleteRequest = new Promise<void>((resolve) => {
      resolveDeleteRequest = resolve;
    });

    const mockSetCompletedSessionDeletedState = jest
      .fn()
      .mockReturnValueOnce(pendingDeleteRequest)
      .mockResolvedValueOnce(undefined);

    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: mockSetCompletedSessionDeletedState,
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    const deleteButton = screen.getByTestId('completed-session-detail-delete-button');
    fireEvent.press(deleteButton);

    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledWith('completed-under-test', true);
    });
    expect(screen.getByText('Deleting...')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledTimes(1);

    if (!resolveDeleteRequest) {
      throw new Error('Expected delete request resolver to be set');
    }
    resolveDeleteRequest();

    await waitFor(() => {
      expect(screen.getByText('Undelete')).toBeTruthy();
    });
    expect(screen.queryByText('Deleting...')).toBeNull();
  });

  it('shows feedback and preserves the delete label when delete persistence fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockRejectedValue(new Error('Unable to update deleted state')),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to update deleted state')).toBeTruthy();
    });

    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.queryByText('Undelete')).toBeNull();
  });

  it('renders a stable empty state when the session is missing', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(null),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="missing-session" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-empty')).toBeTruthy();
    });

    expect(screen.getByText('Session not found')).toBeTruthy();
  });

  it('renders an error state when loading fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockRejectedValue(new Error('boom')),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="broken-session" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-error')).toBeTruthy();
    });

    expect(screen.getByText('boom')).toBeTruthy();
  });
});

describe('CompletedSessionDetailRoute', () => {
  beforeEach(() => {
    mockLoadLocalGymById.mockReset();
    mockLoadSessionSnapshotById.mockReset();
    mockStackScreen.mockReset();
    mockPush.mockReset();
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockLatestFocusCallback = null;
  });

  it('reads the session id from route params', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1' };

    render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });
    expect(screen.getByTestId('completed-session-detail-screen').props.testID).toBe('completed-session-detail-screen');
  });

  it('redirects route intent=edit to the recorder completed-edit flow', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1', intent: 'edit' };

    render(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-edit-redirect')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/session-recorder?mode=completed-edit&sessionId=session-completed-1');
    });
  });

  it('loads a persisted completed session by generated id via the default route data client', async () => {
    const generatedSessionId = 'generated-completed-session-id';
    mockLoadSessionSnapshotById.mockResolvedValue({
      sessionId: generatedSessionId,
      gymId: 'test-gym-1',
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
          exerciseDefinitionId: 'seed_barbell_back_squat',
          name: 'Back Squat',
          machineName: 'Rack',
          sets: [
            { id: 'set-1', repsValue: '5', weightValue: '225' },
            { id: 'set-2', repsValue: '5', weightValue: '225' },
          ],
        },
      ],
    });
    mockLoadLocalGymById.mockResolvedValue({
      id: 'test-gym-1',
      name: 'Route Test Gym',
    });

    mockLocalSearchParams = { sessionId: generatedSessionId };

    render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });
    expect(screen.getByText('Back Squat')).toBeTruthy();
    expect(screen.getByText('Route Test Gym')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-empty')).toBeNull();
    expect(mockLoadSessionSnapshotById).toHaveBeenCalledWith(generatedSessionId);
  });
});
