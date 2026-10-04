/* eslint-disable import/first */

/**
 * The Stats screen over real data: the production route, repositories and
 * catalog caches over the migrated in-memory SQLite database, seeded through
 * the Maestro harness with the `exercise-block-history` fixture. No Maestro
 * flow covers Stats beyond `ios-data-smoke`'s exercise-list read-back: this
 * suite owns the rest. Only the native database open and the
 * router are replaced (helpers/local-data.ts); the two overlay read failures
 * are forced with `jest.spyOn` on the real module, the only states real data
 * cannot produce.
 *
 * `stats-screen.test.tsx` covers the formatting and sorting rules and the
 * screen shell's presentation on hand-built props; this suite proves the data
 * reaches it.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { uiRoles } from '@/components/ui';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
let mockSearchParams: Record<string, string | string[]> = {};
// Every mounted focus callback, so a test can play "the tab came back".
const mockFocusCallbacks = new Map<() => void | (() => void), void | (() => void)>();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => {
      mockFocusCallbacks.set(callback, callback());
      return () => {
        const cleanup = mockFocusCallbacks.get(callback);
        mockFocusCallbacks.delete(callback);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
  },
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import StatsRoute from '../app/(tabs)/stats-history';
import * as exerciseAnalytics from '@/src/data/exercise-analytics';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const BENCH = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const SQUAT_ROW = `stats-exercise-row-${SQUAT}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const renderStats = async () => {
  render(<StatsRoute />);
  await screen.findByTestId('stats-history-screen');
};

const renderSeededStats = async () => {
  await loadMaestroFixture('exercise-block-history');
  await renderStats();
  await screen.findByTestId(SQUAT_ROW);
};

const replayFocus = () =>
  act(async () => {
    mockFocusCallbacks.forEach((cleanup, callback) => {
      if (typeof cleanup === 'function') cleanup();
      mockFocusCallbacks.set(callback, callback());
    });
  });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const exerciseOrder = () =>
  screen
    .getAllByTestId(/^stats-exercise-name-/)
    .map((node) => String(node.props.testID).replace('stats-exercise-name-', ''));

// A Lat Pulldown session through the app's draft → complete path.
const logPulldown = async (daysAgo: number) => {
  const completedAt = new Date(Date.now() - daysAgo * DAY_MS);
  const startedAt = new Date(completedAt.getTime() - 30 * 60 * 1000);
  const sessionId = `stats_pulldown_${daysAgo}`;
  await persistSessionDraftSnapshot(
    {
      sessionId,
      gymId: null,
      startedAt,
      exercises: [
        {
          id: `${sessionId}_pulldown`,
          exerciseDefinitionId: PULLDOWN,
          name: 'Lat Pulldown',
          sets: [{ id: `${sessionId}_set`, weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: null }],
        },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft(sessionId, { completedAt, now: completedAt });
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockClear();
  mockSearchParams = { period: '7' };
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  mockFocusCallbacks.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  closeLocalData();
});

describe('Stats over real data', () => {
  it.each([['7', 7], [['7'], 7], ['30', 28], ['all', 28]] as const)
  ('opens the requested %s period using the saved window for legacy values', async (period, days) => {
    mockSearchParams = { period: typeof period === 'string' ? period : [...period] };
    await renderSeededStats();
    expect(screen.getByTestId(`stats-period-chip-${days}`)).toHaveProp('accessibilityState', { selected: true });
  });

  it.each(['success', 'failure'])('keeps the previous summary visible during a focus refresh and its %s', async outcome => {
    await renderSeededStats();
    const previous = await statsRepository.computeStatsSummary({ periodWeeks: 1 });
    await logPulldown(0.05);
    const next = await statsRepository.computeStatsSummary({ periodWeeks: 1 });
    const read = deferred<typeof next>();
    jest.spyOn(statsRepository, 'computeStatsSummary').mockReturnValueOnce(read.promise);
    await replayFocus();
    expect(within(screen.getByTestId('stats-card-sessions')).getByText(String(previous.current.totals.sessionCount))).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
    await act(async () => {
      if (outcome === 'success') read.resolve(next); else read.reject(Error('Refresh failed'));
    });
    if (outcome === 'success') expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*7/);
    else {
      expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Refresh failed/);
      expect(within(screen.getByTestId('stats-card-sessions')).getByText(String(previous.current.totals.sessionCount))).toBeTruthy();
    }
  });

  it('hides the old summary during a period switch and ignores a superseded focus read', async () => {
    await renderSeededStats();
    const old = await statsRepository.computeStatsSummary({ periodWeeks: 1 });
    const next = await statsRepository.computeStatsSummary({ periodWeeks: 4 });
    const focusRead = deferred<typeof old>();
    const periodRead = deferred<typeof next>();
    jest.spyOn(statsRepository, 'computeStatsSummary')
      .mockReturnValueOnce(focusRead.promise).mockReturnValueOnce(periodRead.promise);
    await replayFocus();
    fireEvent.press(screen.getByTestId('stats-period-chip-28'));
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(screen.queryByTestId('stats-card-sessions')).toBeNull();
    expect(screen.getByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => periodRead.resolve(next));
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*11/);
    await act(async () => focusRead.resolve(old));
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*11/);
  });

  it('shows no empty-history panel while the initial read or look-back reload is pending', async () => {
    await renderSeededStats();
    const initial = deferred<Awaited<ReturnType<typeof exerciseAnalytics.computeSelectedExerciseWeeklyEffort>>>();
    const reload = deferred<Awaited<ReturnType<typeof exerciseAnalytics.computeSelectedExerciseWeeklyEffort>>>();
    jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseWeeklyEffort')
      .mockReturnValueOnce(initial.promise).mockReturnValueOnce(reload.promise);
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    await act(async () => initial.resolve([]));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toBeTruthy();
    act(() => updatePreferences({ historyLookbackWeeks: 4 }));
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
    await act(async () => reload.resolve([]));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toHaveTextContent(/4-week/);
  });

  it('defaults to the configured window, collapses a one-week choice, and refreshes it while mounted', async () => {
    mockSearchParams = {};
    await renderSeededStats();
    expect(screen.getByTestId('stats-period-chip-28')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-so-far')).toHaveTextContent('So far');
    act(() => updatePreferences({ targetWindowWeeks: 1 }));
    expect(screen.queryByTestId('stats-period-chip-28')).toBeNull();
    expect(screen.getByTestId('stats-period-chip-7')).toHaveProp('accessibilityState', { selected: true });
    act(() => updatePreferences({ targetWindowWeeks: 4 }));
    expect(screen.getByTestId('stats-period-chip-28')).toHaveProp('accessibilityState', { selected: true });
    await waitFor(() => expect(screen.getByTestId('stats-card-sets')).toHaveTextContent(/^Sets14/));
  });

  it.each([1, 4, 52, 104])('queries and displays the same %i-week history, showing older records at 104', async weeks => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(450);
    await logPulldown(.05);
    updatePreferences({ historyLookbackWeeks: weeks, heatmapView: 'daily' });
    const read = jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseDailyEffort');
    await renderStats();
    fireEvent.press(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId('stats-exercise-history-window')).toHaveTextContent(`Daily · ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`);
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining(calendarWeekBounds(weeks)));
    const panel = within(screen.getByTestId('stats-exercise-history-heatmap-panel-daily'));
    expect(panel.getAllByTestId(/^stats-exercise-history-heatmap-cell-/)).toHaveLength((weeks - 1) * 7 + 6);
    const olderKey = localDateKey(new Date(Date.now() - 450 * DAY_MS));
    if (weeks === 104) {
      expect(panel.getByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`).props.accessibilityLabel).toContain('Volume 600');
    } else expect(panel.queryByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`)).toBeNull();
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop', { includeHiddenElements: true }));
  });

  it('keeps a selected day within bounds and resets it to today when history is shortened', async () => {
    await renderSeededStats();
    act(() => updatePreferences({ historyLookbackWeeks: 104, heatmapView: 'daily' }));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    const selectedKey = localDateKey(new Date(Date.now() - 40 * DAY_MS));
    fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${selectedKey}`));
    act(() => updatePreferences({ historyLookbackWeeks: 52 }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${selectedKey}`)).toHaveProp('accessibilityState', { selected: true });
    act(() => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${localDateKey(new Date())}`))
      .toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop', { includeHiddenElements: true }));
  });

  it('shows the empty state on an empty database', async () => {
    await renderStats();

    expect(await screen.findByTestId('stats-exercise-list-empty')).toBeTruthy();
  });

  it('lists the seeded exercises with the 7-day working-set card', async () => {
    await renderSeededStats();

    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    // One figure, the working sets (the squat warm-up is no set), against the
    // adjacent previous 7 days of the same fixture.
    expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets9+6 vs prev 1 wk');
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*6\s*\+3 vs prev 1 wk/);
    expect(screen.getByTestId('stats-exercise-sort-sets-indicator')).toBeTruthy();
    // A row's own figures, from the same week.
    expect(screen.getByTestId(`stats-exercise-name-${SQUAT}`)).toHaveTextContent('Barbell Back Squat');
    expect(screen.getByTestId(`stats-exercise-sets-${SQUAT}`)).toHaveTextContent(/^7$/);
    // Sets and Volume read the 7 working sets; the warm-up adds to neither.
    expect(screen.getByTestId(`stats-exercise-volume-${SQUAT}`)).toHaveTextContent('7100');
    expect(screen.getByTestId(`stats-exercise-1rm-${SQUAT}`)).toHaveTextContent('320.6');
    expect(screen.queryByTestId(`stats-exercise-sessions-${SQUAT}`)).toBeNull();
    expect(screen.getByTestId(SQUAT_ROW).props.accessibilityLabel).toContain('7 sets. Volume');
  });

  it('re-queries the 30-day period, dropping the fixture invalid set, and back', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-period-chip-28'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets14+14 vs prev 4 wks')
    );
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*11/);

    fireEvent.press(screen.getByTestId('stats-period-chip-7'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets9+6 vs prev 1 wk')
    );
  });

  it('opens on the period and breakdown the route asks for', async () => {
    mockSearchParams = { period: '30', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets14+14 vs prev 4 wks')
    );
    expect(screen.getByTestId('stats-period-chip-28')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-view-mode-chip-muscle')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-family-header-legs')).toBeTruthy();
  });

  it('lists only exercises with a performed set in the period', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);

    expect(screen.queryByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeNull();

    fireEvent.press(screen.getByTestId('stats-period-chip-28'));
    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeTruthy();
  });

  it('sorts by most recent from each exercise’s last completed session', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    fireEvent.press(await screen.findByTestId('stats-period-chip-28'));
    await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`);

    fireEvent.press(screen.getByTestId('stats-exercise-sort-exercise'));

    // Carry (0.2 days ago), Squat (0.25), Bench (2), Pulldown (20).
    expect(exerciseOrder()).toEqual([
      EXERCISE_BLOCK_HISTORY_FIXTURE.unmappedExerciseId,
      SQUAT,
      BENCH,
      PULLDOWN,
    ]);
  });

  it('reads the database again on focus, showing a session logged elsewhere', async () => {
    await renderSeededStats();
    expect(screen.queryByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeNull();

    // Logged on another tab while Stats was in the background.
    await logPulldown(0.05);
    await replayFocus();

    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*7/));
  });

  it('opens the Sessions list from the Sessions card', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-card-sessions'));

    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('clears the search when the breakdown changes', async () => {
    await renderSeededStats();

    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.queryByTestId(`stats-exercise-row-${BENCH}`)).toBeNull();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));

    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', '');
  });

  it('shows an error panel when the summary read fails (a failed read)', async () => {
    jest.spyOn(statsRepository, 'computeStatsSummary').mockRejectedValueOnce(new Error('Summary boom'));
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    // The summary feeds the muscle breakdown.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(await screen.findByTestId('stats-error-state')).toHaveTextContent(/Summary boom/);
  });

  it('breaks the seeded week down by muscle family', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));

    expect(await screen.findByTestId('stats-family-header-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-sets-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-volume-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-header-button-chest')).toBeTruthy();
    // Squat's 7 working sets (all but the warm-up) land on each muscle it maps
    // to; the warm-up adds neither a set nor volume.
    expect(screen.getByTestId('stats-muscle-sets-quads')).toHaveTextContent(/^Sets7/);
    expect(screen.getByTestId('stats-muscle-row-quads').props.accessibilityLabel).toContain('volume 3550');
  });

  it('uses the saved shared target for different muscles without changing counts or volume', async () => {
    await renderSeededStats();
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    await screen.findByTestId('stats-muscle-row-quads');
    const volume = screen.getByTestId('stats-muscle-row-quads').props.accessibilityLabel;
    for (const id of ['quads', 'glutes_max']) {
      expect(screen.getByTestId(`stats-muscle-row-${id}-shade`)).toHaveStyle({ backgroundColor: uiRoles.viz4 });
    }
    act(() => updatePreferences({ weeklyWorkingSetTarget: 16 }));
    for (const id of ['quads', 'glutes_max']) {
      expect(screen.getByTestId(`stats-muscle-row-${id}-shade`)).toHaveStyle({ backgroundColor: uiRoles.viz2 });
      expect(screen.getByTestId(`stats-muscle-row-${id}`).props.accessibilityLabel).toContain('16 W/sets per week');
      expect(screen.getByTestId(`stats-muscle-sets-${id}`)).toHaveTextContent(/^Sets7/);
    }
    expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets9+6 vs prev 1 wk');
    expect(screen.getByTestId('stats-muscle-row-quads').props.accessibilityLabel.replace('16 W/sets', '8 W/sets')).toBe(volume);
  });

  it("opens a seeded exercise's history with all four metrics and both views, and dismisses it", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    const title = await screen.findByTestId('stats-exercise-history-title');
    expect(title).toHaveTextContent(/Squat/);
    await screen.findByText('Weekly training load');
    for (const metric of ['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight']) {
      expect(screen.getByTestId(`stats-exercise-history-metric-chip-${metric}`)).toBeTruthy();
    }

    await act(async () => {
      updatePreferences({ heatmapView: 'daily' });
    });
    expect(await screen.findByText('52-week history')).toBeTruthy();
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();

    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();
  });

  it('shows an overlay error when the exercise history read fails (a failed read)', async () => {
    jest
      .spyOn(exerciseAnalytics, 'computeSelectedExerciseWeeklyEffort')
      .mockRejectedValueOnce(new Error('DB error'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    expect(await screen.findByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/);
  });

  it("opens a muscle family's history from the seeded breakdown", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-family-header-legs'));

    const title = await screen.findByTestId('stats-muscle-history-title');
    expect(title).toHaveTextContent('Legs');
    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-metric-chip-estimatedRM1')).toBeNull();
    expect(
      within(screen.getByTestId('stats-muscle-history-overlay')).queryByTestId(
        'stats-muscle-history-metric-chip-highestWeight'
      )
    ).toBeNull();
  });

  it("opens one muscle's history from its row, switching metric and view", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-muscle-row-quads'));

    expect(await screen.findByTestId('stats-muscle-history-title')).toHaveTextContent(/Quads/);
    expect(await screen.findByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toHaveProp('accessibilityState', {
      selected: true,
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount'));
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toHaveProp('accessibilityState', {
      selected: true,
    });

    await act(async () => {
      updatePreferences({ heatmapView: 'daily' });
    });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-daily')).toHaveProp('pointerEvents', 'auto');
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
  });

  it('shows an overlay error when the muscle history read fails, and dismisses it (a failed read)', async () => {
    jest
      .spyOn(statsRepository, 'computeSelectedMuscleWeeklyEffort')
      .mockRejectedValueOnce(new Error('Weekly boom'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-family-header-button-chest'));

    expect(await screen.findByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
  });
});
