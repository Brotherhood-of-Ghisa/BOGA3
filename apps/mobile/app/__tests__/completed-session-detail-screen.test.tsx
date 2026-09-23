import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockLatestFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockLocalSearchParams,
  useRouter: () => ({
    push: mockPush,
    dismissTo: mockDismissTo,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
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
  loadRecentExerciseBlocks: jest.fn().mockResolvedValue({ blocks: [] }),
  loadLocalGymById: jest.fn(),
  loadSessionSnapshotById: jest.fn(),
  appendCompletedSessionExerciseAsPlanned: jest.fn(),
  ...jest.requireActual('@/src/data/set-types'),
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

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/boga-session.png'),
  releaseCapture: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const {
  loadLocalGymById: mockLoadLocalGymById,
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
} = jest.requireMock('@/src/data') as {
  loadLocalGymById: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
};
const { captureRef: mockCaptureRef, releaseCapture: mockReleaseCapture } = jest.requireMock(
  'react-native-view-shot'
) as { captureRef: jest.Mock; releaseCapture: jest.Mock };
const { shareAsync: mockShareAsync } = jest.requireMock('expo-sharing') as {
  shareAsync: jest.Mock;
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
      sets: [
        { id: 'set-1', weight: '135', reps: '8', setType: 'warm_up' },
        { id: 'set-2', weight: '185', reps: '8', setType: 'rir_0' },
        { id: 'set-3', weight: '185', reps: '6', setType: 'rir_1' },
        { id: 'set-4', weight: '185', reps: '5', setType: 'rir_3' },
      ],
    },
    {
      id: 'exercise-2',
      exerciseDefinitionId: 'lat-pulldown',
      name: 'Lat Pulldown',
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
    mockBack.mockReset();
    mockCanGoBack = true;
    mockLatestFocusCallback = null;
    mockEnsureExerciseCatalogLoaded.mockClear();
    mockCaptureRef.mockClear();
    mockCaptureRef.mockResolvedValue('file:///tmp/boga-session.png');
    mockReleaseCapture.mockClear();
    mockShareAsync.mockClear();
    mockShareAsync.mockResolvedValue(undefined);
    mockExerciseCatalogState = {
      ...mockExerciseCatalogState,
      status: 'ready',
      lastError: null,
    };
  });

  it('validates completion presentation route values', () => {
    expect(resolveCompletedSessionPresentation('completion')).toBe('completion');
    expect(resolveCompletedSessionPresentation(['completion'])).toBe('completion');
    // History's `summary` is gone: the detail already is the summary.
    expect(resolveCompletedSessionPresentation('summary')).toBe('detail');
    expect(resolveCompletedSessionPresentation('unexpected')).toBe('detail');
    expect(resolveCompletedSessionPresentation(undefined)).toBe('detail');
  });

  it('renders the no-PR completion hierarchy and hides ordinary detail actions', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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
    expect(mockStackScreen).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ title: 'Session complete' }) })
    );
    expect(screen.getByTestId('session-completion-duration')).toHaveTextContent('58 min');
    expect(screen.getByTestId('session-completion-exercises')).toHaveTextContent('2');
    expect(screen.getByTestId('session-completion-sets')).toHaveTextContent('5 (3 working)');
    expect(screen.getByTestId('session-completion-gym')).toHaveTextContent(
      'Westside Barbell Club'
    );
    expect(screen.queryByTestId('session-completion-personal-records')).toBeNull();
    expect(screen.getByTestId('session-completion-muscle-chest')).toHaveTextContent('Chest (3)');
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-action-bar')).toBeNull();
    expect(screen.queryByText('Append')).toBeNull();
  });

  it('keeps completion and current exercise rows available when optional insight history fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockRejectedValue(new Error('Insight history unavailable')),
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
    expect(screen.queryByTestId('completed-session-detail-error')).toBeNull();
    expect(screen.queryByTestId('session-completion-personal-records')).toBeNull();
    expect(screen.getByTestId('session-completion-exercise-exercise-1')).toBeTruthy();
    expect(screen.getAllByText('No comparison history yet')).toHaveLength(2);
    expect(screen.getByTestId('session-completion-done')).toBeTruthy();
  });

  it('omits an empty muscle breakdown without removing the completion exits', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        exercises: [],
      }),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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
      expect(screen.getByTestId('session-completion-sets')).toHaveTextContent('0 (0 working)');
    });
    expect(screen.queryByTestId('session-completion-muscle-breakdown')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
    expect(screen.getByTestId('session-completion-done')).toBeTruthy();
  });

  it('keeps the Maestro-only catalog failure state informational and non-interactive', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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
      expect(screen.getByTestId('session-completion-muscle-empty-state')).toHaveTextContent(
        'Muscle breakdown unavailable.'
      );
    });
    expect(screen.queryByLabelText('Retry session muscle load')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
  });

  it('shows every PR at once and previews the complete session image', async () => {
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
    const exerciseVolumeComparisons = [
      {
        exerciseDefinitionId: 'bench-press',
        exerciseName: 'Bench Press',
        sessionExerciseIds: ['exercise-1'],
        sessionExerciseOrderIndex: 0,
        setCount: 4,
        workingSetCount: 3,
        currentVolume: 4950,
        historicalSessionCount: 5,
        medianVolume: 4300,
        percentile5Volume: 3200,
        percentile95Volume: 5200,
        state: 'distribution' as const,
      },
      {
        exerciseDefinitionId: 'lat-pulldown',
        exerciseName: 'Lat Pulldown',
        sessionExerciseIds: ['exercise-2'],
        sessionExerciseOrderIndex: 1,
        setCount: 1,
        workingSetCount: 0,
        currentVolume: 1440,
        historicalSessionCount: 0,
        medianVolume: null,
        percentile5Volume: null,
        percentile95Volume: null,
        state: 'no-history' as const,
      },
    ];
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords,
        exerciseVolumeComparisons,
      }),
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
      expect(screen.getByTestId('session-completion-pr-bench-press')).toBeTruthy();
      expect(screen.getByTestId('session-completion-pr-lat-pulldown')).toBeTruthy();
    });
    expect(screen.queryByTestId('session-completion-pr-pager')).toBeNull();
    expect(screen.queryByText('Share PR')).toBeNull();
    expect(screen.getByTestId('session-completion-sets')).toHaveTextContent('5 (3 working)');
    expect(screen.getByTestId('session-completion-exercise-exercise-1')).toBeTruthy();
    expect(screen.getByTestId('session-completion-exercise-exercise-2')).toBeTruthy();
    expect(screen.getByText('4 sets · 3 working')).toBeTruthy();
    expect(screen.getByText('1 set · 0 working')).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    expect(screen.getByTestId('session-share-preview')).toBeTruthy();
    expect(screen.getByTestId('session-share-card-pr-bench-press')).toBeTruthy();
    expect(screen.getByTestId('session-share-card-pr-lat-pulldown')).toBeTruthy();
    expect(screen.getByTestId('session-share-exercise-exercise-1')).toBeTruthy();
    expect(screen.getByTestId('session-share-exercise-exercise-2')).toBeTruthy();
    expect(within(screen.getByTestId('session-share-card')).queryByText('Westside Barbell Club')).toBeNull();
    expect(screen.getByText('Nothing is shared until you choose an app.')).toBeTruthy();
  });

  it('keeps session image-share failures inline and retries the same complete preview', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
        shouldFailNextMaestroShare
      />
    );

    await waitFor(() => expect(screen.getByTestId('session-completion-share-session')).toBeTruthy());
    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    fireEvent(screen.getByTestId('session-share-capture-target'), 'layout', {
      nativeEvent: { layout: { width: 340, height: 680, x: 0, y: 0 } },
    });

    fireEvent.press(screen.getByTestId('session-share-image'));
    await waitFor(() => {
      expect(screen.getByTestId('session-share-error')).toHaveTextContent(
        'Share is temporarily unavailable. Try again.'
      );
    });
    expect(mockCaptureRef).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('session-share-image'));
    await waitFor(() => expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///tmp/boga-session.png',
      expect.objectContaining({ mimeType: 'image/png' })
    ));
    expect(mockCaptureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 1080, height: 2160, format: 'png' })
    );
    expect(mockReleaseCapture).toHaveBeenCalledWith('file:///tmp/boga-session.png');
    expect(screen.queryByTestId('session-share-error')).toBeNull();

    fireEvent.press(screen.getByTestId('session-share-cancel'));
    expect(screen.queryByTestId('session-share-preview')).toBeNull();
  });

  it('offers Done as the only completion navigation action', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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

    await waitFor(() => expect(screen.getByTestId('session-completion-done')).toBeTruthy());
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
    fireEvent.press(screen.getByTestId('session-completion-done'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');
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
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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
    expect(mockReplace).toHaveBeenCalledWith('/progress');

    view.unmount();
    expect(remove).toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });

  it('shows non-interactive catalog-error content during completion', async () => {
    mockExerciseCatalogState = {
      ...mockExerciseCatalogState,
      status: 'error',
      lastError: new Error('Catalog unavailable'),
    };
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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

    await waitFor(() =>
      expect(screen.getByTestId('session-completion-muscle-empty-state')).toHaveTextContent(
        'Muscle breakdown unavailable.'
      )
    );
    expect(screen.queryByLabelText('Retry session muscle load')).toBeNull();
    expect(mockEnsureExerciseCatalogLoaded).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-completion-done')).toBeTruthy();
  });

  it('offers one safe exit when a completion target is deleted', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: '2026-02-21T10:00:00.000Z',
      }),
      loadInsights: jest.fn().mockResolvedValue(null),
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
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });

  it('offers one safe exit when completion loading fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
      loadInsights: jest.fn().mockResolvedValue({
        personalRecords: [],
        exerciseVolumeComparisons: [],
      }),
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
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });

  const detailClient = (
    overrides: Partial<CompletedSessionDetailDataClient> = {}
  ): CompletedSessionDetailDataClient => ({
    loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
    appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue({ sessionId: 'active-1' }),
    setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const renderDetail = async (dataClient: CompletedSessionDetailDataClient) => {
    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);
    await screen.findByTestId('completed-session-detail-screen');
  };

  const openSessionOptions = () => {
    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    return screen.getByTestId('completed-session-detail-options-sheet');
  };

  it('renders loading, then the summary and every performed set in the design language', async () => {
    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={detailClient()} />);

    expect(screen.getByTestId('completed-session-detail-loading')).toBeTruthy();
    await screen.findByTestId('completed-session-detail-screen');

    // The detail draws its own top bar: no native header.
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { title: 'View Session', headerShown: false },
    });
    expect(screen.getByText('View Session')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();

    // Start / End as the completed edit's fields show them, then the facts.
    expect(screen.getByTestId('completed-session-detail-times-start').props.accessibilityLabel).toMatch(
      /^Start \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(screen.getByTestId('completed-session-detail-times-end').props.accessibilityLabel).toMatch(
      /^End \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(screen.getByTestId('completed-session-detail-duration').props.accessibilityLabel).toBe('Duration 58m');
    expect(screen.getByTestId('completed-session-detail-gym').props.accessibilityLabel).toBe(
      'Gym Westside Barbell Club'
    );
    expect(screen.getByTestId('completed-session-detail-sets').props.accessibilityLabel).toBe('Sets 5');
    // 135×8 + 185×8 + 185×6 + 185×5 + 120×12, no thousands separator.
    expect(screen.getByTestId('completed-session-detail-volume').props.accessibilityLabel).toBe('Volume 6035');

    // The session view's set row: type · weight × reps · 1RM · VOL.
    const bench = within(screen.getByTestId('completed-session-detail-exercise-exercise-1'));
    expect(bench.getByText('Bench Press')).toBeTruthy();
    expect(bench.getByTestId('completed-session-detail-exercise-exercise-1-count')).toHaveTextContent('4 sets');
    expect(bench.getByText('W-Up')).toBeTruthy();
    expect(bench.getByText('RIR 0')).toBeTruthy();
    expect(bench.getByText('RIR 1')).toBeTruthy();
    expect(bench.getByText('RIR 3')).toBeTruthy();
    expect(
      bench.getByTestId('completed-session-detail-exercise-exercise-1-set-1-values')
    ).toHaveTextContent('135.0 × 8');
    expect(bench.getByTestId('completed-session-detail-exercise-exercise-1-set-2-vol').props.accessibilityLabel).toBe(
      'Vol 1480'
    );
    const pulldown = within(screen.getByTestId('completed-session-detail-exercise-exercise-2'));
    expect(pulldown.getByTestId('completed-session-detail-exercise-exercise-2-count')).toHaveTextContent('1 set');
    // No effort reads as an em dash, not `-`.
    expect(pulldown.getByText('—')).toBeTruthy();

    // No collapse, no set table, no tags, and Append sits behind each card's ⋮.
    expect(screen.queryByText('Weight')).toBeNull();
    expect(screen.queryByText('Append')).toBeNull();
    expect(screen.queryByTestId('exercise-collapse-toggle-1')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
  });

  it('shows only confirmed sets with valid values and leaves out an exercise with none', async () => {
    await renderDetail(
      detailClient({
        loadCompletedSession: jest.fn().mockResolvedValue({
          ...COMPLETED_SESSION_DETAIL_FIXTURE,
          exercises: [
            {
              ...COMPLETED_SESSION_DETAIL_FIXTURE.exercises[0],
              sets: [
                ...COMPLETED_SESSION_DETAIL_FIXTURE.exercises[0].sets,
                { id: 'set-invalid', weight: '', reps: '5', setType: 'rir_0' as const },
                {
                  id: 'set-unconfirmed',
                  weight: '500',
                  reps: '10',
                  setType: 'rir_0' as const,
                  performanceStatus: 'unperformed' as const,
                },
              ],
            },
            {
              ...COMPLETED_SESSION_DETAIL_FIXTURE.exercises[1],
              sets: [{ id: 'set-planned', weight: '120', reps: '12', setType: null, performanceStatus: 'planned' as const }],
            },
          ],
        }),
      })
    );

    expect(screen.getByTestId('completed-session-detail-exercise-exercise-1-count')).toHaveTextContent('4 sets');
    expect(screen.queryByText('500.0 × 10')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-2')).toBeNull();
    expect(screen.getByTestId('completed-session-detail-sets').props.accessibilityLabel).toBe('Sets 4');
  });

  it('says so when no exercise was performed', async () => {
    await renderDetail(
      detailClient({
        loadCompletedSession: jest.fn().mockResolvedValue({ ...COMPLETED_SESSION_DETAIL_FIXTURE, exercises: [] }),
      })
    );

    expect(screen.getByTestId('completed-session-detail-no-exercises')).toHaveTextContent(
      'No exercises logged in this session.'
    );
  });

  it('marks the set whose 1RM beats every other session with a record band', async () => {
    const loadHistoricalBests = jest.fn().mockResolvedValue(
      new Map<string, number | null>([
        ['bench-press', 200],
        ['lat-pulldown', 500],
      ])
    );
    await renderDetail(detailClient({ loadHistoricalBests }));

    expect(loadHistoricalBests).toHaveBeenCalledWith('completed-under-test', ['bench-press', 'lat-pulldown']);
    const band = await screen.findByTestId('completed-session-detail-exercise-exercise-1-record');
    // 185 × 8 is the bench's best 1RM (Mayhew), above the 200 of history.
    expect(band).toHaveTextContent(/^New 1RM record · \d+\.\d$/);
    expect(
      screen.getByTestId('completed-session-detail-exercise-exercise-1').props.accessibilityLabel
    ).toMatch(/^Bench Press, 4 sets, new 1RM record \d+\.\d$/);
    // The pulldown did not beat its history.
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-2-record')).toBeNull();
  });

  it('shows no record while history is unavailable, and still renders the session', async () => {
    await renderDetail(
      detailClient({ loadHistoricalBests: jest.fn().mockRejectedValue(new Error('history unavailable')) })
    );

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-1-record')).toBeNull();
  });

  it('Edit opens the session view on the completed session', async () => {
    await renderDetail(detailClient());

    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));

    expect(mockPush).toHaveBeenCalledWith('/session/completed-under-test');
  });

  it('back returns to the previous screen, or to Progress when there is none', async () => {
    await renderDetail(detailClient());

    fireEvent.press(screen.getByTestId('completed-session-detail-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);

    mockCanGoBack = false;
    fireEvent.press(screen.getByTestId('completed-session-detail-back'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });

  it("appends an exercise from its ⋮ and opens the active session", async () => {
    const appendCompletedSessionExerciseAsPlanned = jest.fn().mockResolvedValue({ sessionId: 'active-1' });
    await renderDetail(detailClient({ appendCompletedSessionExerciseAsPlanned }));

    fireEvent.press(screen.getByTestId('completed-session-detail-exercise-options-exercise-2'));
    const sheet = screen.getByTestId('completed-session-detail-exercise-sheet');
    expect(within(sheet).getByText('Lat Pulldown')).toBeTruthy();
    expect(within(sheet).getByLabelText('Append Lat Pulldown block to current session')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-2'));

    await waitFor(() => {
      expect(appendCompletedSessionExerciseAsPlanned).toHaveBeenCalledWith('completed-under-test', 'exercise-2');
      expect(mockPush).toHaveBeenCalledWith('/session/active-1');
    });
    expect(screen.queryByTestId('completed-session-detail-exercise-sheet')).toBeNull();
  });

  it('shows a failed append inline and stays on the session', async () => {
    await renderDetail(
      detailClient({
        appendCompletedSessionExerciseAsPlanned: jest.fn().mockRejectedValue(new Error('Unable to append now')),
      })
    );

    fireEvent.press(screen.getByTestId('completed-session-detail-exercise-options-exercise-1'));
    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1'));

    expect(await screen.findByTestId('completed-session-detail-error-notice')).toHaveTextContent(
      'Unable to append now'
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
  });

  it('reloads the completed session when the detail screen regains focus', async () => {
    const { __triggerFocus: triggerFocus } = jest.requireMock('expo-router') as {
      __triggerFocus: () => void;
    };
    await renderDetail(
      detailClient({
        loadCompletedSession: jest
          .fn()
          .mockResolvedValueOnce(COMPLETED_SESSION_DETAIL_FIXTURE)
          .mockResolvedValueOnce({ ...COMPLETED_SESSION_DETAIL_FIXTURE, gymName: 'Updated Gym' }),
      })
    );
    expect(screen.getByText('Westside Barbell Club')).toBeTruthy();

    act(() => {
      triggerFocus();
    });

    expect(await screen.findByText('Updated Gym')).toBeTruthy();
  });

  it('deletes and undeletes from the ⋮, with a band and no Edit while deleted', async () => {
    const setCompletedSessionDeletedState = jest.fn().mockResolvedValue(undefined);
    await renderDetail(detailClient({ setCompletedSessionDeletedState }));

    const sheet = openSessionOptions();
    expect(within(sheet).getByText('Delete session')).toBeTruthy();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));

    expect(await screen.findByTestId('completed-session-detail-deleted-band')).toHaveTextContent(
      'Deleted · hidden from history'
    );
    expect(setCompletedSessionDeletedState).toHaveBeenCalledWith('completed-under-test', true);
    // The session view only edits a live session, so Edit goes while deleted.
    expect(screen.queryByTestId('completed-session-detail-edit-button')).toBeNull();

    expect(within(openSessionOptions()).getByText('Undelete session')).toBeTruthy();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));

    expect(await screen.findByTestId('completed-session-detail-edit-button')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
    expect(setCompletedSessionDeletedState).toHaveBeenNthCalledWith(2, 'completed-under-test', false);
  });

  it('opens a deleted session with its band and without Edit', async () => {
    await renderDetail(
      detailClient({
        loadCompletedSession: jest.fn().mockResolvedValue({
          ...COMPLETED_SESSION_DETAIL_FIXTURE,
          deletedAt: '2026-02-21T08:00:00.000Z',
        }),
      })
    );

    expect(screen.getByTestId('completed-session-detail-deleted-band')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-edit-button')).toBeNull();
  });

  it('ignores a second delete while the first is being written', async () => {
    let resolveDelete: (() => void) | undefined;
    const setCompletedSessionDeletedState = jest.fn().mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      })
    );
    await renderDetail(detailClient({ setCompletedSessionDeletedState }));

    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    expect(setCompletedSessionDeletedState).toHaveBeenCalledTimes(1);

    act(() => {
      resolveDelete?.();
    });
    expect(await screen.findByTestId('completed-session-detail-deleted-band')).toBeTruthy();
  });

  it('shows a failed delete inline and keeps the session as it was', async () => {
    await renderDetail(
      detailClient({
        setCompletedSessionDeletedState: jest.fn().mockRejectedValue(new Error('Unable to update deleted state')),
      })
    );

    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));

    expect(await screen.findByTestId('completed-session-detail-error-notice')).toHaveTextContent(
      'Unable to update deleted state'
    );
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();
  });

  it('renders a stable empty state, with a way back, when the session is missing', async () => {
    render(
      <CompletedSessionDetailScreenShell
        sessionId="missing-session"
        dataClient={detailClient({ loadCompletedSession: jest.fn().mockResolvedValue(null) })}
      />
    );

    expect(await screen.findByTestId('completed-session-detail-empty')).toBeTruthy();
    expect(screen.getByText('Session not found')).toBeTruthy();
    fireEvent.press(screen.getByTestId('completed-session-detail-back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('renders an error state when loading fails', async () => {
    render(
      <CompletedSessionDetailScreenShell
        sessionId="broken-session"
        dataClient={detailClient({ loadCompletedSession: jest.fn().mockRejectedValue(new Error('boom')) })}
      />
    );

    expect(await screen.findByTestId('completed-session-detail-error')).toBeTruthy();
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

  it('redirects route intent=edit to the session view', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1', intent: 'edit' };

    render(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-edit-redirect')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/session/session-completed-1');
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
