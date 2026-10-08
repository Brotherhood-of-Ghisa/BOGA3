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
import { Modal } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Icon, uiBorder, uiRoles } from '@/components/ui';

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

let mockUserId: string | null = null;
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: mockUserId ? { id: mockUserId } : null }) }));

import { setAccountLocalPreferenceAccount, ensureAccountLocalPreferencesLoaded } from '@/src/preferences/account-local';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import StatsRoute from '../app/(tabs)/stats-history';
import * as exerciseAnalytics from '@/src/data/exercise-analytics';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { closeLocalData, loadMaestroFixture, resetLocalData, localDataClient } from './helpers/local-data';

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
  mockUserId = null;
  mockPush.mockClear();
  mockSearchParams = { period: '7', breakdown: 'exercise' };
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
    mockSearchParams = { period: typeof period === 'string' ? period : [...period], breakdown: 'exercise' };
    await renderSeededStats();
    expect(screen.getByTestId(`stats-period-chip-${days}`)).toHaveProp('accessibilityState', { selected: true });
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
    expect(screen.queryByTestId('stats-exercise-history-heatmap')).toBeNull();
    await act(async () => initial.resolve([]));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toBeTruthy();
    act(() => updatePreferences({ historyLookbackWeeks: 4 }));
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-heatmap')).toBeNull();
    expect(screen.getAllByTestId('stats-exercise-history-heatmap', { includeHiddenElements: true })).toHaveLength(2);
    await act(async () => reload.resolve([]));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toHaveTextContent(/4-week/);
  });

  it('defaults to the configured window, collapses a one-week choice, and refreshes it while mounted', async () => {
    mockSearchParams = { breakdown: 'exercise' };
    await renderSeededStats();
    expect(screen.getByTestId('stats-period-chip-28')).toHaveProp('accessibilityState', { selected: true });
    act(() => updatePreferences({ targetWindowWeeks: 1 }));
    expect(screen.queryByTestId('stats-period-chip-28')).toBeNull();
    expect(screen.getByTestId('stats-period-chip-7')).toHaveProp('accessibilityState', { selected: true });
    act(() => updatePreferences({ targetWindowWeeks: 4 }));
    expect(screen.getByTestId('stats-period-chip-28')).toHaveProp('accessibilityState', { selected: true });
    await waitFor(() => expect(screen.getByTestId(`stats-exercise-sets-${SQUAT}`)).toHaveTextContent('11'));
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
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining(calendarWeekBounds(weeks)));
    const panel = within(screen.getByTestId('stats-exercise-history-heatmap-panel-daily'));
    expect(panel.getAllByTestId(/^stats-exercise-history-heatmap-cell-\d{4}-\d{2}-\d{2}$/)).toHaveLength((weeks - 1) * 7 + 6);
    const olderKey = localDateKey(new Date(Date.now() - 450 * DAY_MS));
    if (weeks === 104) {
      expect(panel.getByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`).props.accessibilityLabel).toContain('Volume 600');
    } else expect(panel.queryByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`)).toBeNull();
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
  });

  it('updates read-only daily tiles when the saved history window is shortened', async () => {
    await renderSeededStats();
    act(() => updatePreferences({ historyLookbackWeeks: 104, heatmapView: 'daily' }));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    const dateKey = localDateKey(new Date(Date.now() - 40 * DAY_MS));
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toHaveProp('accessibilityRole', 'text');
    act(() => updatePreferences({ historyLookbackWeeks: 52 }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toHaveProp('accessibilityRole', 'text');
    act(() => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${localDateKey(new Date())}`))
      .toHaveProp('accessibilityRole', 'text');
    expect(screen.queryByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
  }, 30_000);

  it('shows the empty state on an empty database', async () => {
    await renderStats();

    expect(await screen.findByTestId('stats-exercise-list-empty')).toBeTruthy();
  });

  it('lists the seeded exercises with the 7-day working-set card', async () => {
    await renderSeededStats();

    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    // One figure, the working sets (the squat warm-up is no set), against the
    // adjacent previous 7 days of the same fixture.
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
  });

  it('opens the Sessions list from the Sessions card', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-sessions-link'));

    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('shows an error panel when the summary read fails (a failed read)', async () => {
    jest.spyOn(statsRepository, 'computeProgressComparisons').mockRejectedValueOnce(new Error('Summary boom'));
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    // The summary feeds the muscle breakdown.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    const error = await screen.findByTestId('stats-error-state');
    expect(error).toHaveTextContent(/Could not load progress/);
    expect(error).not.toHaveTextContent(/Summary boom/);
    expect(screen.getByTestId('stats-retry')).toBeTruthy();
  });

  it("opens a seeded exercise's history with all four metrics and both views, and dismisses it", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    const title = await screen.findByTestId('stats-exercise-history-title');
    expect(title).toHaveTextContent(/Squat/);
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
    expect(screen.queryByText('Weekly training load')).toBeNull();
    for (const metric of ['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight']) {
      expect(screen.getByTestId(`stats-exercise-history-metric-chip-${metric}`)).toBeTruthy();
    }

    await act(async () => {
      updatePreferences({ heatmapView: 'weekly' });
    });
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByText('Weekly training load')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();

    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();
  });

  it('retries a failed exercise history read for the same definition without closing the sheet', async () => {
    jest
      .spyOn(exerciseAnalytics, 'computeSelectedExerciseWeeklyEffort')
      .mockRejectedValueOnce(new Error('DB error'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    expect(await screen.findByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/);
    fireEvent.press(screen.getByTestId('stats-exercise-history-retry'));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-error')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
    expect(screen.getByTestId('stats-exercise-history-title')).toHaveTextContent(/Squat/);
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
  });

  it('opens a saved Weekly choice without a banner and retains it on reopening', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'weekly', historyLookbackWeeks: 104 }));
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(await screen.findByText('Weekly training load')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(await screen.findByText('Weekly training load')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();
  });

  it('selects and clears a weekly row over real data and returns to the same search/sort', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'weekly', historyLookbackWeeks: 8 }));
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-volume'));
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
    fireEvent.press(screen.getByTestId('stats-exercise-history-metric-chip-workingSetCount'));
    const current = localDateKey(calendarWeekBounds(1).start);
    const row = screen.getByTestId(`stats-exercise-history-heatmap-cell-${current}`);
    // The existing successful-load selection starts on the current week.
    fireEvent.press(row);
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    fireEvent.press(row);
    const expected = (await exerciseAnalytics.computeSelectedExerciseWeeklyEffort({ ...calendarWeekBounds(8), exerciseDefinitionId: SQUAT }))
      .find(week => week.weekStartDateKey === current)!;
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${current}`)).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-value-${current}`)).toHaveTextContent(String(expected.workingSetCount));
    fireEvent.press(row);
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.queryByText(/Tap a week/)).toBeNull();
    await act(async () => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
    expect(screen.getAllByTestId(/^stats-exercise-history-heatmap-cell-\d{4}-\d{2}-\d{2}$/)).toHaveLength(1);
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.getByTestId('stats-exercise-sort-volume')).toHaveProp('accessibilityState', { selected: true });
  });

  it('keeps populated and empty muscle rows neutral while preserving contribution selection', async () => {
    await renderSeededStats();
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    for (const metric of ['workingSetCount', 'totalVolume']) {
      fireEvent.press(screen.getByTestId(`stats-metric-chip-${metric}`));
      for (const row of screen.getAllByTestId(/^stats-muscle-row-[^-]+$/)) {
        expect(row).not.toHaveStyle({ backgroundColor: uiRoles.viz2 });
        expect(row).not.toHaveStyle({ backgroundColor: uiRoles.viz4 });
      }
      expect(screen.queryAllByLabelText(/Colour:/)).toEqual([]);
    }
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ borderLeftColor: uiRoles.ink });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: true });
  });

  it('keeps seeded families inert and opens only an individual muscle', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-family-header-legs'));
    fireEvent.press(screen.getByTestId('stats-family-header-chest'));
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-muscle-history-quads'));

    const title = await screen.findByTestId('stats-muscle-history-title');
    expect(title).toHaveTextContent('Quads');
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
    fireEvent.press(await screen.findByTestId('stats-muscle-history-quads'));

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
      updatePreferences({ heatmapView: 'weekly' });
    });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.queryByLabelText('Select heatmap view')).toBeNull();
  });

  it('retries a failed muscle history read and dismisses it back to the same breakdown', async () => {
    jest
      .spyOn(statsRepository, 'computeSelectedMuscleWeeklyEffort')
      .mockRejectedValueOnce(new Error('Weekly boom'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-muscle-history-chest'));

    expect(await screen.findByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    await waitFor(() => expect(screen.queryByTestId('stats-muscle-history-error')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('stats-muscle-history-loading')).toBeNull());
    expect(screen.getByTestId('stats-muscle-history-title')).toHaveTextContent('Chest');

    fireEvent.press(screen.getByTestId('stats-muscle-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
    expect(screen.getByTestId('stats-view-mode-chip-exercise')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-chest')).toBeTruthy();
  });

  const renderMuscles = async () => {
    mockSearchParams = { period: '7' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
  };
  const select = (id: string) => fireEvent.press(screen.getByTestId(`stats-muscle-select-${id}`));
  const value = (id: string, column: string) => screen.getByTestId(`stats-muscle-row-${id}-${column}`);
  const contribution = (column: string) => screen.getByTestId(`stats-contribution-${SQUAT}-${column}`);

  it('pins every selector and exercise search outside either scroll, with Sessions last even for an empty search', async () => {
    await renderMuscles();
    const assertPinned = (scrollId: string) => {
      const controls = within(screen.getByTestId('stats-controls'));
      const scroll = within(screen.getByTestId(scrollId));
      expect(within(screen.getByTestId('stats-view-switch')).getAllByRole('tab')).toHaveLength(2);
      const ids = ['stats-view-mode-chip-row', 'stats-period-chip-row',
        scrollId === 'stats-scroll' ? 'stats-metric-chip-row' : 'stats-search-input'];
      for (const id of ids) {
        expect(controls.getByTestId(id)).toBeTruthy();
        expect(scroll.queryByTestId(id)).toBeNull();
      }
      for (const tab of controls.getAllByRole('tab')) {
        expect(tab).toHaveStyle({ backgroundColor: tab.props.accessibilityState.selected ? uiRoles.viz4 : uiRoles.surface });
      }
      expect(screen.queryByTestId('stats-browse-exercises')).toBeNull();
      const content = scroll.getAllByTestId(
        /^stats-(muscle-table|exercise-list|exercise-list-empty|sessions-link)$/
      );
      expect(content.at(-1)).toHaveProp('testID', 'stats-sessions-link');
    };
    assertPinned('stats-scroll');
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-exercise'));
    assertPinned('stats-exercise-list-scroll');
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'no matching exercise');
    expect(screen.getByTestId('stats-exercise-list-empty')).toBeTruthy();
    assertPinned('stats-exercise-list-scroll');
    fireEvent.press(screen.getByTestId('stats-sessions-link'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('discloses one block directly under its muscle and collapses on a repeated chevron', async () => {
    await renderMuscles();
    const order = () => within(screen.getByTestId('stats-muscle-table'))
      .getAllByTestId(/^stats-muscle-row-[a-z_]+$|^stats-contributions$|^stats-family-header-/)
      .map(node => node.props.testID as string);
    const collapsed = order();
    expect(within(screen.getByTestId('stats-muscle-select-quads')).UNSAFE_getByType(Icon).props.name)
      .toBe('chevron-right');
    const expanded = (id: string) => {
      const result = [...collapsed];
      result.splice(result.indexOf(`stats-muscle-row-${id}`) + 1, 0, 'stats-contributions');
      return result;
    };
    select('quads');
    expect(order()).toEqual(expanded('quads'));
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    expect(within(screen.getByTestId('stats-muscle-select-quads')).UNSAFE_getByType(Icon).props.name)
      .toBe('chevron-down');
    expect(screen.getByTestId('stats-muscle-table')).toHaveStyle({ gap: 0 });
    expect(screen.getByTestId('stats-contributions')).toHaveStyle({ backgroundColor: uiRoles.ruleSoft,
      borderTopWidth: uiBorder.width, borderBottomWidth: uiBorder.width, borderColor: uiRoles.rule });
    select('chest');
    expect(order()).toEqual(expanded('chest'));
    expect(screen.getAllByTestId('stats-contributions')).toHaveLength(1);
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: false });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityLabel', 'Hide Chest contributions');
    select('chest');
    expect(order()).toEqual(collapsed);
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(within(screen.getByTestId('stats-muscle-select-chest')).UNSAFE_getByType(Icon).props.name)
      .toBe('chevron-right');
  });

  it.each(['workingSetCount', 'totalVolume'])('reconciles multiple %s contributors in both periods without a Total row', async metric => {
    await loadMaestroFixture('exercise-block-history');
    // Give the fixture's second exercise the same muscle, retaining its real
    // current/previous sets and the production aggregation/rendering path.
    localDataClient().prepare("UPDATE exercise_muscle_mappings SET muscle_group_id = 'quads' WHERE exercise_definition_id = ? AND muscle_group_id = 'chest'").run(BENCH);
    mockSearchParams = { period: '7' };
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    select('quads');
    fireEvent.press(screen.getByTestId(`stats-metric-chip-${metric}`));
    const block = screen.getByTestId('stats-contributions');
    expect(within(block).getAllByRole('link')).toHaveLength(2);
    for (const column of ['now', 'previous']) {
      const figures = within(block).getAllByTestId(new RegExp(`^stats-contribution-.+-${column}$`));
      expect(figures.reduce((sum, figure) => sum + Number(figure.props.children), 0))
        .toBe(Number(value('quads', column).props.children));
    }
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(block).queryByText('Total')).toBeNull();
  });

  it('defaults to the complete taxonomy table and reconciles repeated blocks in both periods', async () => {
    await renderMuscles();
    expect(screen.getByTestId('stats-metric-chip-workingSetCount')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent(/^7$/);
    expect(value('quads', 'previous')).toHaveTextContent(/^2$/);
    expect(value('quads', 'change')).toHaveTextContent('+5');
    select('quads');
    expect(screen.getAllByTestId(`stats-contribution-${SQUAT}`)).toHaveLength(1);
    for (const column of ['now', 'previous', 'change']) {
      expect(contribution(column).props.children).toBe(value('quads', column).props.children);
    }
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(screen.getByTestId('stats-contributions')).queryByText('Total')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    expect(value('quads', 'now')).toHaveTextContent('3550');
    expect(contribution('now')).toHaveTextContent('3550');
    for (const column of ['now', 'previous', 'change']) {
      expect(contribution(column).props.children).toBe(value('quads', column).props.children);
    }
    const muscleLink = screen.getByRole('link', { name: 'Open Quads history' });
    const exerciseLink = screen.getByRole('link', { name: 'Open Barbell Back Squat history' });
    for (const [link, name] of [[muscleLink, 'Quads'], [exerciseLink, 'Barbell Back Squat']] as const) {
      expect(link).toHaveStyle({ minWidth: 44, minHeight: 44 });
      expect(within(link).getByText(name)).not.toHaveStyle({ textDecorationLine: 'underline' });
    }
    fireEvent.press(muscleLink);
    await screen.findByTestId('stats-muscle-history-title');
    fireEvent.press(screen.getByTestId('stats-muscle-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
    expect(screen.getByTestId('stats-exercise-history-title')).toHaveTextContent('Barbell Back Squat');
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(screen.getByTestId('stats-metric-chip-totalVolume')).toHaveProp('accessibilityState', { selected: true });
  });

  it('keeps a previous-only contributor and an empty muscle with working history links', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(8);
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await renderStats();
    await screen.findByTestId('stats-muscle-row-back_lats-now');
    expect(value('back_lats', 'now')).toHaveTextContent(/^0$/);
    expect(value('back_lats', 'previous')).toHaveTextContent(/^1$/);
    expect(value('back_lats', 'change')).toHaveTextContent('−1');
    select('back_lats');
    expect(screen.getByTestId(`stats-contribution-${PULLDOWN}-previous`)).toHaveTextContent(/^1$/);
    expect(screen.queryByTestId('stats-contributions-empty')).toBeNull();
    select('calves');
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No working sets for Calves in either period');
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No volume-included sets for Calves in either period');
    fireEvent.press(screen.getByTestId('stats-muscle-history-calves'));
    expect(await screen.findByTestId('stats-muscle-history-empty')).toBeTruthy();
  });

  it('uses independent saved eligibility and retains zero-load Volume contributors', async () => {
    await renderMuscles();
    select('quads');
    await act(async () => updatePreferences({ workingSetEfforts: [], volumeEfforts: ['warm_up'] }));
    await waitFor(() => expect(value('quads', 'now')).toHaveTextContent(/^0$/));
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent(/No working sets/);
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    expect(contribution('now')).toHaveTextContent('225');
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent('225');
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0' WHERE set_type = 'warm_up'").run();
    await replayFocus();
    await waitFor(() => expect(contribution('now')).toHaveTextContent(/^0$/));
    expect(screen.getByTestId(`stats-contribution-${SQUAT}`)).toBeTruthy();
    expect(screen.queryByTestId('stats-contributions-empty')).toBeNull();
    await act(async () => updatePreferences({ volumeEfforts: [] }));
    await waitFor(() => expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent(/No volume-included sets/));
    expect(value('quads', 'now')).toHaveTextContent(/^0$/);
    expect(screen.queryByTestId(`stats-contribution-${SQUAT}`)).toBeNull();
  });

  it('keeps selection during Retry, hides another period, and ignores older reads', async () => {
    await renderMuscles();
    select('quads');
    const old = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const next = await statsRepository.computeProgressComparisons({ periodWeeks: 4 });
    const oldRead = deferred<typeof old>();
    const nextRead = deferred<typeof next>();
    jest.spyOn(statsRepository, 'computeProgressComparisons').mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(nextRead.promise);
    await replayFocus();
    expect(contribution('now')).toHaveTextContent('7');
    fireEvent.press(screen.getByTestId('stats-period-chip-28'));
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    expect(screen.queryByTestId('stats-contributions-empty')).toBeNull();
    expect(screen.getByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => nextRead.reject(Error('New window failed')));
    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    await act(async () => oldRead.resolve(old));
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-retry'));
    await waitFor(() => expect(contribution('now')).toHaveTextContent(String(next.muscles.find(row => row.muscleGroupId === 'quads')!.current.workingSetCount)));
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
  });

  it('retains a same-context snapshot alongside a failed refocus, with an inline Retry', async () => {
    await renderMuscles();
    select('quads');
    jest.spyOn(statsRepository, 'computeProgressComparisons').mockRejectedValueOnce(Error('Refresh failed'));
    await replayFocus();
    expect(await screen.findByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    expect(contribution('now')).toHaveTextContent('7');
    fireEvent.press(screen.getByTestId('stats-retry'));
    await waitFor(() => expect(screen.queryByTestId('stats-error-state')).toBeNull());
    expect(contribution('now')).toHaveTextContent('7');
  });

  it('refreshes table, contributions and open history together after a data edit/refocus', async () => {
    await renderMuscles();
    select('quads');
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    fireEvent.press(screen.getByTestId('stats-muscle-history-quads'));
    await waitFor(() => expect(screen.queryByTestId('stats-muscle-history-loading')).toBeNull());
    const read = jest.spyOn(statsRepository, 'computeSelectedMuscleDailyEffortMetrics');
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0' WHERE session_exercise_id LIKE '%squat%'").run();
    await replayFocus();
    await waitFor(() => expect(read).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('stats-muscle-history-loading')).toBeNull());
    fireEvent.press(screen.getByTestId('stats-muscle-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    await waitFor(() => expect(contribution('now')).toHaveTextContent(/^0$/));
    expect(value('quads', 'now')).toHaveTextContent(/^0$/);
  });

  it('hides a superseded policy snapshot and resets selection when accounts change', async () => {
    await renderMuscles();
    select('quads');
    const old = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const pending = deferred<typeof old>();
    jest.spyOn(statsRepository, 'computeProgressComparisons').mockReturnValueOnce(pending.promise);
    await act(async () => updatePreferences({ workingSetEfforts: [] }));
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    await act(async () => { mockUserId = 'B'; setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); invalidateBodyWeightContext(); });
    screen.rerender(<StatsRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-table')).toBeTruthy());
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    await act(async () => pending.resolve(old));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent('7');
  });

  it('retains exercise search and sort through muscle browsing', async () => {
    await renderSeededStats();
    fireEvent.press(screen.getByTestId('stats-exercise-sort-volume'));
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-exercise'));
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.getByTestId('stats-exercise-sort-volume')).toHaveProp('accessibilityState', { selected: true });
  });

  it('leaves sets whose load cannot be calculated out of Volume, with no coverage note', async () => {
    await renderMuscles();
    const db = localDataClient();
    db.prepare("INSERT OR REPLACE INTO user_settings (id, bodyweight_calculations_enabled) VALUES ('settings', 1)").run();
    db.prepare('UPDATE exercise_definitions SET bodyweight_contribution = 2 WHERE id = ?').run(SQUAT);
    await replayFocus();
    select('quads');
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    // Squat, the only quads lift, is left out in both periods ([[copy.no-inline-explanation]]):
    // a Volume of 0 against 0, never a note or an invented percentage.
    await waitFor(() => expect(contribution('now')).toHaveTextContent('0'));
    expect(value('quads', 'now')).toHaveTextContent('0');
    expect(value('quads', 'previous')).toHaveTextContent('0');
    expect(value('quads', 'change')).toHaveTextContent('—');
    expect(contribution('change')).toHaveTextContent('—');
    expect(screen.queryByText(/incomplete|Known subtotal/i)).toBeNull();
    for (const prefix of ['stats-muscle-row-quads', `stats-contribution-${SQUAT}`]) {
      expect(screen.queryByTestId(`${prefix}-coverage`)).toBeNull();
    }
  });

});
