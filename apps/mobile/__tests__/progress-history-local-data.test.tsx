/* eslint-disable import/first */

/**
 * The history page over real data: the production route, repositories and
 * catalogue cache over the migrated in-memory SQLite database, seeded through
 * the Maestro harness with the `exercise-block-history` fixture. Only the
 * native database open and the router are replaced (helpers/local-data.ts);
 * the read failures are forced with `jest.spyOn` on the real module, the only
 * states real data cannot produce.
 *
 * `progress-history-page.test.tsx` covers the page's presentation on
 * hand-built props; this suite proves the data reaches it, through the params
 * Progress pushes. Progress's own reads are `stats-screen-local-data.test.tsx`.
 */

import * as mockReact from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockScreenOptions: { title?: string } = {};
let mockSearchParams: Record<string, string | string[]> = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import ProgressHistoryRoute from '../app/progress-history';
import type { CalendarMonth } from '@/components/heatmaps/daily-calendar';
import * as exerciseAnalytics from '@/src/data/exercise-analytics';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { closeLocalData, loadMaestroFixture, localDataClient, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const DAY_MS = 24 * 60 * 60 * 1000;

// The Grid virtualizes its months, so the sample it was handed is what the
// window claim is about, not the handful of months laid out in a test render.
const renderedDailySample = () => {
  const list = screen.UNSAFE_getAllByType(FlatList).find(node => node.props.testID === 'stats-exercise-history-scroll');
  const months: CalendarMonth[] = list!.props.data;
  return months.flatMap(month => month.weeks.flatMap(week => week.days)).filter(day => day.day);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

// A Lat Pulldown session through the app's draft → complete path.
const logPulldown = async (daysAgo: number) => {
  const completedAt = new Date(Date.now() - daysAgo * DAY_MS);
  const startedAt = new Date(completedAt.getTime() - 30 * 60 * 1000);
  const sessionId = `history_pulldown_${daysAgo}`;
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

/** Opens the page exactly as Progress pushes it: one id, no name. */
const openHistory = async (params: Record<string, string>) => {
  mockSearchParams = params;
  render(<ProgressHistoryRoute />);
  await screen.findByTestId('progress-history-screen');
};

beforeEach(async () => {
  resetLocalData();
  mockScreenOptions = {};
  mockSearchParams = {};
  mockPush.mockClear();
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  closeLocalData();
});

describe('The history page over real data', () => {
  it('reads exercise history once and preserves both standalone projections over real data', async () => {
    await loadMaestroFixture('exercise-block-history');
    const read = jest.spyOn(localDataClient(), 'prepare');
    const options = { ...calendarWeekBounds(52), exerciseDefinitionId: SQUAT };
    const history = await exerciseAnalytics.computeSelectedExerciseHistoryEffort(options);
    expect(read.mock.calls.filter(([sql]) => sql.includes('from "exercise_sets"'))).toHaveLength(1);
    expect(history.daily).toEqual(await exerciseAnalytics.computeSelectedExerciseDailyEffort(options));
    expect(history.weekly).toEqual(await exerciseAnalytics.computeSelectedExerciseWeeklyEffort(options));
    expect(history.daily.length).toBeGreaterThan(0);
  });

  it('titles an exercise page with its name and offers all four metrics in both views', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'daily' }));
    await openHistory({ exerciseDefinitionId: SQUAT });

    await waitFor(() => expect(mockScreenOptions.title).toMatch(/Squat/));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
    for (const metric of ['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight']) {
      expect(screen.getByTestId(`stats-exercise-history-metric-chip-${metric}`)).toBeTruthy();
    }
    // Neither view draws a title of its own, and the window has no caption.
    expect(screen.queryByText('Daily training load')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-weekly')); });
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.queryByText('Weekly training load')).toBeNull();
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily', { includeHiddenElements: true })).toBeTruthy();
  });

  it('retries a failed exercise history read for the same definition, staying on the page', async () => {
    jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseHistoryEffort').mockRejectedValueOnce(new Error('DB error'));
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ exerciseDefinitionId: SQUAT });

    expect(await screen.findByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/);
    fireEvent.press(screen.getByTestId('stats-exercise-history-retry'));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-error'));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    expect(mockScreenOptions.title).toMatch(/Squat/);
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
  });

  it('opens in the saved Weekly view without a banner, and again on the next visit', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'weekly', historyLookbackWeeks: 104 }));
    await openHistory({ exerciseDefinitionId: SQUAT });

    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly'))
      .toHaveProp('pointerEvents', 'auto'));
    expect(screen.getByTestId('stats-exercise-history-view-chip-weekly')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();

    // Back, then open it again: a fresh page in the same saved view.
    screen.unmount();
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly'))
      .toHaveProp('pointerEvents', 'auto'));
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
  });

  it('opens a Grid day\'s session and a Weekly row\'s week over real data, and follows a shortened window', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'daily', historyLookbackWeeks: 8 }));
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));

    // [[session.history-open]]: the sessions behind each day come from the same read.
    const days = await exerciseAnalytics.computeSelectedExerciseDailyEffort({ ...calendarWeekBounds(8), exerciseDefinitionId: SQUAT });
    const single = days.find(day => day.sessionIds?.length === 1)!;
    expect(single.sessionIds).toHaveLength(1);
    fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${single.dateKey}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/completed-session/${single.sessionIds![0]}`);
    const several = days.find(day => (day.sessionIds?.length ?? 0) > 1);
    if (several) {
      fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${several.dateKey}`));
      expect(mockPush).toHaveBeenLastCalledWith(`/sessions?day=${several.dateKey}`);
    }

    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-weekly')); });
    const current = localDateKey(calendarWeekBounds(1).start);
    const row = screen.getByTestId(`stats-exercise-history-heatmap-cell-${current}`);
    fireEvent.press(row);
    expect(mockPush).toHaveBeenLastCalledWith(`/sessions?week=${current}`);
    expect(row.props.accessibilityState?.selected).toBeFalsy();
    expect(screen.queryByTestId('stats-exercise-history-week-banner')).toBeNull();
    expect(screen.queryByText(/Tap a week/)).toBeNull();

    await act(async () => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    expect(screen.getAllByTestId(/^stats-exercise-history-heatmap-cell-\d{4}-\d{2}-\d{2}$/)).toHaveLength(1);
  });

  it('shows no empty-history panel while the initial read or look-back reload is pending', async () => {
    await loadMaestroFixture('exercise-block-history');
    const initial = deferred<Awaited<ReturnType<typeof exerciseAnalytics.computeSelectedExerciseHistoryEffort>>>();
    const reload = deferred<Awaited<ReturnType<typeof exerciseAnalytics.computeSelectedExerciseHistoryEffort>>>();
    jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseHistoryEffort')
      .mockReturnValueOnce(initial.promise).mockReturnValueOnce(reload.promise);
    await openHistory({ exerciseDefinitionId: SQUAT });

    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-heatmap')).toBeNull();
    await act(async () => initial.resolve({ weekly: [], daily: [] }));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toBeTruthy();
    act(() => updatePreferences({ historyLookbackWeeks: 4 }));
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-heatmap')).toBeNull();
    // Pending with no data mounts no chart at all, in either view.
    expect(screen.queryAllByTestId('stats-exercise-history-heatmap', { includeHiddenElements: true })).toHaveLength(0);
    await act(async () => reload.resolve({ weekly: [], daily: [] }));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toHaveTextContent(/4-week/);
  });

  it.each([1, 4, 52, 104])('queries and displays the same %i-week history, showing older records at 104', async weeks => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(450);
    await logPulldown(.05);
    act(() => updatePreferences({ historyLookbackWeeks: weeks, heatmapView: 'daily' }));
    const read = jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseHistoryEffort');
    await openHistory({ exerciseDefinitionId: PULLDOWN });

    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining(calendarWeekBounds(weeks)));
    const panel = within(screen.getByTestId('stats-exercise-history-heatmap-panel-daily'));
    expect(renderedDailySample()).toHaveLength((weeks - 1) * 7 + 6);
    const olderKey = localDateKey(new Date(Date.now() - 450 * DAY_MS));
    if (weeks === 104) {
      expect(renderedDailySample().find(day => day.dateKey === olderKey)?.day?.value).toBe(600);
    } else expect(panel.queryByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`)).toBeNull();
  });

  // The 104-week heatmap re-render trips the default ceiling when jest
  // workers run alongside the fast aggregate's other lanes; this test alone
  // needs ~18 s worst-case and the lane's load has cost it 40-90 s.
  it('updates daily tiles when the saved history window is shortened: rest days read, training days open', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ historyLookbackWeeks: 104, heatmapView: 'daily' }));
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    const dateKey = localDateKey(new Date(Date.now() - 40 * DAY_MS));
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toHaveProp('accessibilityRole', 'text');
    act(() => updatePreferences({ historyLookbackWeeks: 52 }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toHaveProp('accessibilityRole', 'text');
    act(() => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    // Today holds a Squat session, so it opens it ([[session.history-open]]).
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${localDateKey(new Date())}`))
      .toHaveProp('accessibilityRole', 'button');
    expect(screen.queryByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toBeNull();
  }, 120_000);

  it('titles a muscle page with its name and offers only the two muscle metrics', async () => {
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ muscleGroupId: 'quads' });

    await waitFor(() => expect(mockScreenOptions.title).toBe('Quads'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-metric-chip-estimatedRM1')).toBeNull();
    expect(within(screen.getByTestId('stats-muscle-history-overlay'))
      .queryByTestId('stats-muscle-history-metric-chip-highestWeight')).toBeNull();

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount'));
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toHaveProp('accessibilityState', { selected: true });
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toHaveProp('accessibilityState', { selected: true });
  });

  it('retries a failed muscle history read without leaving the page', async () => {
    jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort').mockRejectedValueOnce(new Error('Weekly boom'));
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ muscleGroupId: 'chest' });

    expect(await screen.findByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-error'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    expect(mockScreenOptions.title).toBe('Chest');
  });

  it('renders the unavailable state for a muscle the catalogue no longer holds', async () => {
    await loadMaestroFixture('exercise-block-history');
    const read = jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort');
    await openHistory({ muscleGroupId: 'deleted_muscle' });

    await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
    expect(read).not.toHaveBeenCalled();
  });
});
