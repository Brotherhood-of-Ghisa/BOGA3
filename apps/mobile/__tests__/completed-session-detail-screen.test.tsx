/**
 * Completed-session states real data cannot produce (spec 06, "Jest test
 * shapes"): pending, failed and obsolete insight reads, failed loads and
 * writes, a second delete mid-write, share failures, a catalog read error, and
 * the Android back handler. Everything a real session can show is asserted over
 * the database in `completed-session-local-data.test.tsx`.
 */

import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, StyleSheet } from 'react-native';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { setAccountLocalPreferenceAccount, setAccountLocalPreferences } from '@/src/preferences/account-local';
import { ActiveSessionConflictError, SessionUnavailableError } from '@/src/data/session-drafts';
import { subscribeOpenedWorkout } from '@/components/navigation/use-open-main-tab';

import CompletedSessionDetailRoute, {
  CompletedSessionDetailScreenShell,
  resolveCompletedSessionPresentation,
  type CompletedSessionDetailDataClient,
  type CompletedSessionDetailRecord,
} from '../app/completed-session/[sessionId]';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);

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
  muscleSetup: { assignment: new Map() as ReadonlyMap<string, { muscle: { id: string; displayName: string; familyName: string; sortOrder: number }; tracked: boolean }> },
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
    renderWithTheme(<CompletedSessionDetailScreenShell dataClient={detailClient({ loadInsights })} sessionId="completed-under-test" />);
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
    renderWithTheme(<CompletedSessionDetailScreenShell dataClient={detailClient({ loadInsights })} sessionId="completed-under-test" />);
    await screen.findByText('Loading comparisons…');
    act(() => jest.requireMock('expo-router').__triggerFocus());
    await screen.findByText('Comparisons unavailable. Return to this session to retry.');
    await act(async () => resolveOld({ personalRecords: [], exerciseVolumeComparisons: [], muscleVolumeComparisons: [] }));
    expect(screen.getByText('Comparisons unavailable. Return to this session to retry.')).toBeTruthy();
  });

  it.each(['look-back', 'account'])('rejects obsolete comparisons after changing the %s', async change => {
    setAccountLocalPreferenceAccount('A', true);
    let resolveOld!: (value: unknown) => void;
    const loadInsights = jest.fn()
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error('new context failed'));
    renderWithTheme(<CompletedSessionDetailScreenShell dataClient={detailClient({ loadInsights })} sessionId="completed-under-test" />);
    await screen.findByText('Loading comparisons…');
    expect(loadInsights).toHaveBeenLastCalledWith('completed-under-test', 52);
    act(() => {
      if (change === 'look-back') setAccountLocalPreferences({ historyLookbackWeeks: 1 });
      else setAccountLocalPreferenceAccount('B', true);
    });
    await screen.findByText('Comparisons unavailable. Return to this session to retry.');
    expect(loadInsights).toHaveBeenLastCalledWith('completed-under-test', change === 'look-back' ? 1 : 52);
    await act(async () => resolveOld({ personalRecords: [], exerciseVolumeComparisons: [], muscleVolumeComparisons: [] }));
    expect(screen.getByText('Comparisons unavailable. Return to this session to retry.')).toBeTruthy();
  });

  it('says the comparisons are loading on completion while the insight history reads', async () => {
    let resolveInsights!: (value: unknown) => void;
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockReturnValue(new Promise((resolve) => { resolveInsights = resolve; })),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    renderWithTheme(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    // A pending read is never drawn as a session with no history.
    expect(await screen.findByText('Loading comparisons…')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-comparison-unavailable-exercise')).toBeNull();
    // The stored context carries the screen meanwhile.
    expect(screen.getByTestId('session-completion-presentation')).toBeTruthy();
    expect(screen.getByTestId('session-completion-share-session')).toBeTruthy();

    await act(async () =>
      resolveInsights({ personalRecords: [], exerciseVolumeComparisons: [], muscleVolumeComparisons: [] })
    );
    expect(screen.getByTestId('session-insight-empty')).toHaveTextContent('No working sets to compare.');
  });

  it('says the comparisons are unavailable on completion when the insight history fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      loadInsights: jest.fn().mockRejectedValue(new Error('Insight history unavailable')),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    renderWithTheme(
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
    // A failed history read says so: it is never drawn as a session with no
    // history. The rest of the screen stands.
    expect(screen.getByTestId('session-insight-empty')).toHaveTextContent(
      'Comparisons unavailable. Return to this session to retry.'
    );
    expect(screen.queryByTestId('session-completion-comparison-unavailable-exercise')).toBeNull();
    expect(screen.queryByTestId('session-completion-exercise-exercise-1')).toBeNull();
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
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    renderWithTheme(
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
    // A share error is a strong meta line in `danger`.
    expect(StyleSheet.flatten(screen.getByTestId('session-share-error').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.sm, color: roles.danger, textAlign: 'center',
    });
    expect(StyleSheet.flatten(screen.getByText('Nothing is shared until you choose an app.').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, color: roles.inkMuted, textAlign: 'center',
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

  it('closes onto Progress when Android hardware back is pressed during completion', async () => {
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
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    const view = renderWithTheme(
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
    expect(mockDismissTo).toHaveBeenCalledWith('/progress');

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
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    renderWithTheme(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('session-completion-breakdown-muscle-empty')).toHaveTextContent(
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
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    renderWithTheme(
      <CompletedSessionDetailScreenShell
        dataClient={dataClient}
        presentation="completion"
        sessionId="completed-under-test"
      />
    );

    await waitFor(() => expect(screen.getByTestId('completed-session-detail-error')).toBeTruthy());
    expect(screen.getByText('Storage unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-completion-safe-exit'));
    expect(mockDismissTo).toHaveBeenCalledWith('/progress');
  });

  const detailClient = (
    overrides: Partial<CompletedSessionDetailDataClient> = {}
  ): CompletedSessionDetailDataClient => ({
    loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
    setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const renderDetail = async (dataClient: CompletedSessionDetailDataClient) => {
    renderWithTheme(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);
    await screen.findByTestId('completed-session-detail-screen');
    fireEvent.press(screen.getByTestId('view-session-section-sets'));
  };

  const openSessionOptions = () => {
    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    return screen.getByTestId('completed-session-detail-options-sheet');
  };

  it('suppresses Resume, Delete and Edit while a resume write is pending and navigates only after success', async () => {
    let resolve!: (result: { sessionId: string }) => void;
    const resumeCompletedSession = jest.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    const client = detailClient({ resumeCompletedSession });
    await renderDetail(client);
    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeDisabled();
    openSessionOptions();
    expect(screen.getByTestId('completed-session-detail-resume-button')).toBeDisabled();
    expect(screen.getByTestId('completed-session-detail-resume-button')).toHaveTextContent('Resuming session…');
    fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    expect(resumeCompletedSession).toHaveBeenCalledTimes(1);
    expect(client.setCompletedSessionDeletedState).not.toHaveBeenCalled();
    await act(async () => resolve({ sessionId: 'completed-under-test' }));
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('keeps a failed resume completed and retryable', async () => {
    const resumeCompletedSession = jest.fn().mockRejectedValueOnce(new Error('Unable to save. Try again.'))
      .mockResolvedValue({ sessionId: 'completed-under-test' });
    await renderDetail(detailClient({ resumeCompletedSession }));
    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
    expect(await screen.findByText('Unable to save. Try again.')).toBeTruthy();
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeEnabled();
    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/train'));
    expect(resumeCompletedSession).toHaveBeenCalledTimes(2);
  });

  it('offers the conflicting current workout without navigating or changing the requested session', async () => {
    const opened = jest.fn();
    const unsubscribe = subscribeOpenedWorkout(opened);
    try {
      const resumeCompletedSession = jest.fn().mockRejectedValue(new ActiveSessionConflictError('current-workout'));
      await renderDetail(detailClient({ resumeCompletedSession }));
      openSessionOptions();
      fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
      expect(await screen.findByText('Another session is already in progress. Finish or abandon it first.')).toBeTruthy();
      expect(mockDismissTo).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('completed-session-detail-open-active'));
      expect(opened).toHaveBeenCalledWith('current-workout');
      expect(mockDismissTo).toHaveBeenCalledWith('/train');
    } finally {
      unsubscribe();
    }
  });

  it('replaces stale detail with the unavailable state when the target was removed before Resume', async () => {
    await renderDetail(detailClient({ resumeCompletedSession: jest.fn().mockRejectedValue(new SessionUnavailableError()) }));
    openSessionOptions();
    fireEvent.press(screen.getByTestId('completed-session-detail-resume-button'));
    expect(await screen.findByTestId('completed-session-detail-empty')).toBeTruthy();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('asks for the bests before this session and bands the set that beats them', async () => {
    const loadHistoricalBests = jest.fn().mockResolvedValue(
      new Map([['bench-press', { oneRepMax: 200, weight: { weight: 200, reps: 1 }, volume: null }]])
    );
    await renderDetail(detailClient({ loadHistoricalBests }));

    expect(await screen.findByTestId('completed-session-detail-exercise-exercise-1-record-1'))
      .toHaveTextContent('New 1RM record · 236.2185.0 × 8');
    expect(loadHistoricalBests).toHaveBeenCalledWith(
      { sessionId: 'completed-under-test', completedAt: new Date('2026-02-20T16:58:00.000Z') },
      ['bench-press', 'lat-pulldown']
    );
    // No earlier best for the pulldown: no band.
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-2-record')).toBeNull();
  });

  it('bands every record, a line each, and says them', async () => {
    // 185 × 8 is as heavy as the record with more reps, but below the 1RM
    // record; the working volume (185 × 19) beats the Volume record.
    const loadHistoricalBests = jest.fn().mockResolvedValue(
      new Map([['bench-press', { oneRepMax: 300, weight: { weight: 185, reps: 7 }, volume: 3000 }]])
    );
    await renderDetail(detailClient({ loadHistoricalBests }));

    expect(await screen.findByTestId('completed-session-detail-exercise-exercise-1-record-1'))
      .toHaveTextContent('New top weight185.0 × 8');
    expect(screen.getByTestId('completed-session-detail-exercise-exercise-1-record-2'))
      .toHaveTextContent('New volume record · 3515');
    expect(screen.getByLabelText('Bench Press, 3 sets, new top weight 185.0 × 8, new volume record 3515')).toBeTruthy();
  });

  it('shows no record while history is unavailable, and still renders the session', async () => {
    await renderDetail(
      detailClient({ loadHistoricalBests: jest.fn().mockRejectedValue(new Error('history unavailable')) })
    );

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-exercise-exercise-1-record')).toBeNull();
  });

  it('titles the session and shows Start and Duration, then Gym, Ex, Sets and Volume', async () => {
    renderWithTheme(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={detailClient()} />);
    await screen.findByTestId('completed-session-detail-screen');

    // 16:00 UTC is 16:00 in London in February: an afternoon.
    expect(screen.getByTestId('completed-session-detail-title')).toHaveTextContent('Afternoon training · 20-02-2026');
    expect(screen.getByLabelText('Start 20-02-2026 16:00')).toBeTruthy();
    expect(screen.getByLabelText('Duration 58m')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-times-end')).toBeNull();
    expect(screen.getByTestId('completed-session-detail-gym')).toHaveProp('accessibilityLabel', 'Gym Westside Barbell Club');
    expect(screen.getByTestId('completed-session-detail-exercises')).toHaveProp('accessibilityLabel', 'Exercises 2');
    expect(screen.getByTestId('completed-session-detail-sets')).toHaveProp('accessibilityLabel', 'Sets 4');
  });

  it('offers no per-exercise options: the cards carry no ⋮', async () => {
    await renderDetail(detailClient());

    expect(screen.getByTestId('completed-session-detail-exercise-exercise-1')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-exercise-options-exercise-1')).toBeNull();
    expect(screen.queryByLabelText('Options for Bench Press')).toBeNull();
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
    // The band's words are a muted micro-label.
    expect(StyleSheet.flatten(screen.getByText('Deleted · hidden from history').props.style)).toMatchObject({
      fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase', color: roles.inkMuted,
    });
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
    expect(StyleSheet.flatten(screen.getByTestId('completed-session-detail-error-notice').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, color: roles.danger,
    });
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();
  });

  it('renders an error state when loading fails', async () => {
    renderWithTheme(
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

    renderWithTheme(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-edit-redirect')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/session/session-completed-1');
    });
  });

});
