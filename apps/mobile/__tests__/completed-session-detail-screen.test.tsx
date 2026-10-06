/**
 * Completed-session states real data cannot produce (spec 06, "Jest test
 * shapes"): pending, failed and obsolete insight reads, failed loads and
 * writes, a second delete mid-write, share failures, a catalog read error, and
 * the Android back handler. Everything a real session can show is asserted over
 * the database in `completed-session-local-data.test.tsx`.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import CompletedSessionDetailRoute, {
  CompletedSessionDetailScreenShell,
  resolveCompletedSessionPresentation,
  type CompletedSessionDetailDataClient,
  type CompletedSessionDetailRecord,
} from '../app/completed-session/[sessionId]';

let mockLocalSearchParams: Record<string, string | undefined> = {
  sessionId: 'session-completed-1',
};
const mockStackScreen = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
const mockFocusEffects = new Map<() => void | (() => void), void | (() => void)>();

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
    mockReact.useEffect(() => {
      mockFocusEffects.set(callback, callback());
      return () => { mockFocusEffects.get(callback)?.(); mockFocusEffects.delete(callback); };
    }, [callback]);
  },
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
  __triggerFocus: () => {
    for (const [callback, cleanup] of mockFocusEffects) {
      cleanup?.();
      mockFocusEffects.set(callback, callback());
    }
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
  bodyWeightKg: null,
  bodyWeightSource: null,
  bodyWeightMeasurementId: null,
  bodyWeightMeasuredAt: null,
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
    mockFocusEffects.clear();
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
    expect(resolveCompletedSessionPresentation('summary')).toBe('summary');
    expect(resolveCompletedSessionPresentation('unexpected')).toBe('detail');
    expect(resolveCompletedSessionPresentation(undefined)).toBe('detail');
  });

  it('distinguishes pending and failed comparisons from absent history without blocking sets, actions or sharing', async () => {
    let rejectInsights!: (error: Error) => void;
    const loadInsights = jest.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectInsights = reject; }));
    render(<CompletedSessionDetailScreenShell dataClient={detailClient({ loadInsights })} sessionId="completed-under-test" />);
    await screen.findByText('Loading comparisons…');
    expect(screen.getByTestId('completed-session-detail-sets')).toHaveProp('accessibilityLabel', 'Sets 4');
    fireEvent.press(screen.getByTestId('view-session-section-sets'));
    expect(screen.getByTestId('completed-session-detail-exercise-exercise-1')).toBeTruthy();
    await act(async () => rejectInsights(new Error('history offline')));
    fireEvent.press(screen.getByTestId('view-session-section-summary'));
    expect(screen.getByText('Comparisons unavailable. Return to this session to retry.')).toBeTruthy();
    expect(screen.queryByText('No comparison history yet')).toBeNull();
    expect(screen.queryByTestId('session-completion-exercise-exercise-1')).toBeNull();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    expect(screen.getByTestId('session-share-card')).toBeTruthy();
    expect(screen.queryByTestId('session-share-exercise-exercise-1')).toBeNull();
    fireEvent(screen.getByTestId('session-share-preview'), 'accessibilityEscape');
    openSessionOptions();
    expect(screen.getByText('Delete session')).toBeTruthy();
  });

  it('ignores an obsolete insight response after returning from editing', async () => {
    let resolveOld!: (value: unknown) => void;
    const loadInsights = jest.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error('latest history failed'));
    render(<CompletedSessionDetailScreenShell dataClient={detailClient({ loadInsights })} sessionId="completed-under-test" />);
    await screen.findByText('Loading comparisons…');
    act(() => jest.requireMock('expo-router').__triggerFocus());
    await screen.findByText('Comparisons unavailable. Return to this session to retry.');
    await act(async () => resolveOld({ personalRecords: [], exerciseVolumeComparisons: [], muscleVolumeComparisons: [] }));
    expect(screen.getByText('Comparisons unavailable. Return to this session to retry.')).toBeTruthy();
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

  it('keeps session image-share failures inline and retries the same complete preview', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockResolvedValue({
        muscleVolumeComparisons: [],
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

    // A page sheet: no Cancel, its X (or a swipe down) closes it.
    expect(screen.queryByTestId('session-share-cancel')).toBeNull();
    expect(screen.getByTestId('session-share-preview-modal')).toHaveProp('presentationStyle', 'pageSheet');
    fireEvent.press(screen.getByTestId('session-share-preview-close'));
    expect(screen.queryByTestId('session-share-preview')).toBeNull();
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
        muscleVolumeComparisons: [],
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
      expect(hardwareBackHandler?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
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
        muscleVolumeComparisons: [],
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

  it('offers one safe exit when completion loading fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
      loadInsights: jest.fn().mockResolvedValue({
        muscleVolumeComparisons: [],
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
    fireEvent.press(screen.getByTestId('view-session-section-sets'));
  };

  const openSessionOptions = () => {
    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    return screen.getByTestId('completed-session-detail-options-sheet');
  };

  it('asks for the bests before this session and bands the set that beats them', async () => {
    const loadHistoricalBests = jest.fn().mockResolvedValue(
      new Map([['bench-press', { oneRepMax: 200, weight: { weight: 200, reps: 1 } }]])
    );
    await renderDetail(detailClient({ loadHistoricalBests }));

    expect(await screen.findByTestId('completed-session-detail-exercise-exercise-1-record'))
      .toHaveTextContent('New 1RM record · 236.2');
    expect(loadHistoricalBests).toHaveBeenCalledWith(
      { sessionId: 'completed-under-test', completedAt: new Date('2026-02-20T16:58:00.000Z') },
      ['bench-press', 'lat-pulldown']
    );
    // No earlier best for the pulldown: no band.
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-2-record')).toBeNull();
  });

  it('bands a Weight record, and says it, when no 1RM beats the record', async () => {
    // 185 × 8 is as heavy as the record with more reps, but below the 1RM record.
    const loadHistoricalBests = jest.fn().mockResolvedValue(
      new Map([['bench-press', { oneRepMax: 300, weight: { weight: 185, reps: 7 } }]])
    );
    await renderDetail(detailClient({ loadHistoricalBests }));

    expect(await screen.findByTestId('completed-session-detail-exercise-exercise-1-record'))
      .toHaveTextContent('New top weight · 185.0 × 8');
    expect(screen.getByLabelText('Bench Press, 3 sets, new top weight 185.0 × 8')).toBeTruthy();
  });

  it('shows no record while history is unavailable, and still renders the session', async () => {
    await renderDetail(
      detailClient({ loadHistoricalBests: jest.fn().mockRejectedValue(new Error('history unavailable')) })
    );

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-1-record')).toBeNull();
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
    mockFocusEffects.clear();
  });

  it('redirects route intent=edit to the session view', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1', intent: 'edit' };

    render(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-edit-redirect')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/session/session-completed-1');
    });
  });

});
