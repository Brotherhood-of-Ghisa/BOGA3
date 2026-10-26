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

let mockScreenOptions: {
  title?: string;
  headerTitle?: (props: { children: string }) => mockReact.ReactNode;
  headerRight?: () => mockReact.ReactNode;
} = {};
let mockSearchParams: Record<string, string | string[]> = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  // The native header, as the route declares it: its rendered title and items
  // are mounted in place, so the page's week and its ⋮ are reachable.
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return mockReact.createElement(mockReact.Fragment, null,
        options.headerTitle?.({ children: options.title ?? '' }), options.headerRight?.());
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
import { loadExerciseSessionFacts } from '@/src/data/exercise-session-facts';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { progressHistoryHref } from '@/src/navigation/routes';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, historyWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { closeLocalData, loadMaestroFixture, localDataClient, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const DAY_MS = 24 * 60 * 60 * 1000;

// The Grid virtualizes its months, so the sample it was handed is what the
// window claim is about, not the handful of months laid out in a test render.
const renderedDailySample = (subject: 'exercise' | 'muscle' = 'exercise') => {
  const list = screen.UNSAFE_getAllByType(FlatList).find(node => node.props.testID === `stats-${subject}-history-scroll`);
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

// A Lat Pulldown workout still in progress: one confirmed set, one planned.
const startPulldown = async (startedDaysAgo: number) => {
  const startedAt = new Date(Date.now() - startedDaysAgo * DAY_MS);
  await persistSessionDraftSnapshot(
    {
      sessionId: 'history_pulldown_in_progress',
      gymId: null,
      startedAt,
      exercises: [
        {
          id: 'history_pulldown_in_progress_pulldown',
          exerciseDefinitionId: PULLDOWN,
          name: 'Lat Pulldown',
          sets: [
            { id: 'history_pulldown_in_progress_done', weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: null },
            { id: 'history_pulldown_in_progress_planned', weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: 'planned' },
          ],
        },
      ],
    },
    { now: startedAt }
  );
};

/** Opens the page exactly as Progress pushes it: one id, no name. */
const openHistory = async (params: Record<string, string>) => {
  mockSearchParams = params;
  render(<ProgressHistoryRoute />);
  await screen.findByTestId('progress-history-screen');
};

type HistoryKind = 'exercise' | 'muscle';
type HistoryMetric = 'totalVolume' | 'workingSetCount' | 'estimatedRM1' | 'highestWeight';
const metricChip = (kind: HistoryKind) => screen.getByTestId(`stats-${kind}-history-metric-chip`);
/** The metric in force: the one chip's label carries it as `<chip>-<value>`. */
const shownMetric = (kind: HistoryKind) => {
  const prefix = `stats-${kind}-history-metric-chip-`;
  return (within(metricChip(kind)).getByTestId(new RegExp(`^${prefix}`)).props.testID as string).slice(prefix.length);
};
/** Steps the metric chip, which wraps round, until it shows `metric`. */
const chooseMetric = async (kind: HistoryKind, metric: HistoryMetric) => {
  for (let presses = 0; presses < 4 && shownMetric(kind) !== metric; presses += 1) {
    await act(async () => { fireEvent.press(metricChip(kind)); });
  }
  expect(shownMetric(kind)).toBe(metric);
};

// A muscle page's gym sits in its Filters sheet, which stays open across
// choices: open it, act, dismiss it. An exercise's gym is its own picker.
const inFilters = <T,>(inside: () => T): T => {
  fireEvent.press(screen.getByTestId('progress-history-filters'));
  const result = inside();
  fireEvent(screen.getByTestId('progress-history-filters-sheet'), 'accessibilityEscape');
  return result;
};
const GYM_BUTTON = { exercise: 'stats-exercise-history-gym', muscle: 'progress-history-filters' } as const;
const chooseGym = (kind: HistoryKind, key: string) => {
  if (kind === 'muscle') {
    inFilters(() => fireEvent.press(screen.getByTestId(`stats-gym-option-${key}`)));
  } else {
    fireEvent.press(screen.getByTestId(GYM_BUTTON.exercise));
    fireEvent.press(screen.getByTestId(`stats-exercise-history-gym-option-${key}`));
  }
};
/** The gym the page's button names: the picker's own, or the Filters' changed choices. */
const gymButtonLabel = (kind: HistoryKind, gym: string) =>
  kind === 'exercise' ? `Gym: ${gym}` : gym === 'All gyms' ? 'Filters' : `Filters: ${gym}`;
const allGymsLabel = (kind: HistoryKind): string => {
  if (kind === 'muscle') return inFilters(() => screen.getByTestId('stats-gym-option-all').props.accessibilityLabel);
  fireEvent.press(screen.getByTestId(GYM_BUTTON.exercise));
  return screen.getByTestId('stats-exercise-history-gym-option-all').props.accessibilityLabel;
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
  it.each([9, 11])('includes the complete-week start and excludes the preceding instant on October %i', async day => {
    jest.setSystemTime(new Date(2026, 9, day, 12));
    await loadMaestroFixture('exercise-block-history');
    const start = historyWeekBounds(1).start;
    const daysAgo = (Date.now() - start.getTime()) / DAY_MS;
    await logPulldown(daysAgo);
    await logPulldown(daysAgo + 1 / DAY_MS);
    act(() => updatePreferences({ historyLookbackWeeks: 1, heatmapView: 'daily' }));
    await openHistory({ exerciseDefinitionId: PULLDOWN });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    const sampled = renderedDailySample();
    expect(sampled.filter(tile => tile.day?.hasTraining).map(tile => [tile.dateKey, tile.day?.value]))
      .toEqual([[localDateKey(start), 600]]);
    expect(sampled.map(tile => tile.dateKey).sort()[0]).toBe(localDateKey(start));
  });

  it('reads the exercise graph once alongside cached PR facts and preserves standalone metric projections', async () => {
    await loadMaestroFixture('exercise-block-history');
    await loadExerciseSessionFacts(SQUAT);
    const read = jest.spyOn(localDataClient(), 'prepare');
    const options = { ...calendarWeekBounds(52), exerciseDefinitionId: SQUAT };
    const history = await exerciseAnalytics.computeSelectedExerciseHistoryEffort(options);
    expect(read.mock.calls.filter(([sql]) => sql.includes('from "exercise_sets"'))).toHaveLength(1);
    expect(history.daily.map(({ personalRecordCounts: _records, ...day }) => day))
      .toEqual(await exerciseAnalytics.computeSelectedExerciseDailyEffort(options));
    expect(history.weekly).toEqual(await exerciseAnalytics.computeSelectedExerciseWeeklyEffort(options));
    expect(history.daily.length).toBeGreaterThan(0);
  });

  it.each([
    ['exercise', { exerciseDefinitionId: PULLDOWN }],
    ['muscle', { muscleGroupId: 'back_lats' }],
  ] as const)('counts the workout in progress on today, by its confirmed sets, on %s history', async (subject, params) => {
    await loadMaestroFixture('exercise-block-history');
    // Started last week: only the date finishing it now would give puts it on today.
    await startPulldown(8);
    act(() => updatePreferences({ heatmapView: 'daily' }));
    await openHistory({ ...params, metric: 'sets' });
    await waitForGone(() => screen.queryByTestId(`stats-${subject}-history-loading`));

    expect(renderedDailySample(subject).filter(tile => tile.day?.hasTraining).map(tile => [tile.dateKey, tile.day?.value]))
      .toEqual([[localDateKey(new Date()), 1]]);
  });

  it('titles an exercise page with its name and offers all four metrics in both views', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'daily' }));
    await openHistory({ exerciseDefinitionId: SQUAT });

    await waitFor(() => expect(mockScreenOptions.title).toMatch(/Squat/));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily')).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByTestId('stats-exercise-history-heatmap')).toBeTruthy();
    // The one metric chip steps through all four, then wraps back to Volume.
    const stepped = [shownMetric('exercise')];
    for (let press = 0; press < 4; press += 1) {
      await act(async () => { fireEvent.press(metricChip('exercise')); });
      stepped.push(shownMetric('exercise'));
    }
    expect(stepped).toEqual(['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight', 'totalVolume']);
    // Neither view draws a title of its own, and the window has no caption.
    expect(screen.queryByText('Daily training load')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-window')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-weekly')); });
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(screen.queryByText('Weekly training load')).toBeNull();
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily', { includeHiddenElements: true })).toBeTruthy();
  });

  it.each(['exercise', 'muscle'] as const)('opens %s history on the linked gym, and the picker changes the days counted', async kind => {
    await loadMaestroFixture('exercise-block-history');
    const noGymSession = 'maestro_exercise_block_history_squat_2';
    localDataClient().prepare('UPDATE sessions SET gym_id = NULL WHERE id = ?').run(noGymSession);
    // The fixture places that session four days before it was loaded.
    const noGymDay = localDateKey(new Date(Date.now() - 4 * DAY_MS));
    act(() => updatePreferences({ heatmapView: 'daily' }));
    await openHistory({ ...(kind === 'exercise' ? { exerciseDefinitionId: SQUAT } : { muscleGroupId: 'quads' }), gymId: 'no-gym' });
    await waitForGone(() => screen.queryByTestId(`stats-${kind}-history-loading`));
    const trainingDays = () => renderedDailySample(kind).filter(tile => tile.day?.hasTraining).map(tile => tile.dateKey);
    expect(trainingDays()).toEqual([noGymDay]);
    // The gym sits in the body's selector row, not the native header.
    expect(within(screen.getByTestId(`stats-${kind}-history-overlay`)).getByTestId(GYM_BUTTON[kind]))
      .toHaveProp('accessibilityLabel', gymButtonLabel(kind, 'No gym'));

    chooseGym(kind, EXERCISE_BLOCK_HISTORY_FIXTURE.gymId);
    await waitFor(() => expect(trainingDays().length).toBeGreaterThan(1));
    expect(trainingDays()).not.toContain(noGymDay);

    chooseGym(kind, 'all');
    await waitFor(() => expect(trainingDays()).toContain(noGymDay));
    expect(screen.getByTestId(GYM_BUTTON[kind])).toHaveProp('accessibilityLabel', gymButtonLabel(kind, 'All gyms'));
    // `All gyms` counts every session of the window, each gym's own beside it.
    expect(allGymsLabel(kind)).toMatch(/^All gyms, \d+ sessions$/);
  });

  it('draws no gym filter for an exercise with no gym to choose', async () => {
    await loadMaestroFixture('exercise-block-history');
    localDataClient().prepare('UPDATE sessions SET gym_id = NULL').run();
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));
    expect(screen.queryByTestId('stats-exercise-history-gym')).toBeNull();
  });

  it('opens session history from exercise Options and carries the current gym choice', async () => {
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'));

    const openSessionHistory = () => {
      fireEvent.press(screen.getByTestId('progress-history-options-button'));
      fireEvent.press(screen.getByRole('button', { name: 'History' }));
      expect(screen.queryByTestId('progress-history-options-sheet')).toBeNull();
    };
    openSessionHistory();
    expect(mockPush).toHaveBeenLastCalledWith(`/exercise-history?exerciseDefinitionId=${SQUAT}`);

    chooseGym('exercise', EXERCISE_BLOCK_HISTORY_FIXTURE.gymId);
    openSessionHistory();
    expect(mockPush).toHaveBeenLastCalledWith(`/exercise-history?exerciseDefinitionId=${SQUAT}&gymId=${EXERCISE_BLOCK_HISTORY_FIXTURE.gymId}`);
  });

  it('keeps session history reachable when the Progress read fails', async () => {
    await loadMaestroFixture('exercise-block-history');
    jest.spyOn(exerciseAnalytics, 'computeSelectedExerciseHistoryEffort').mockRejectedValueOnce(new Error('DB error'));
    await openHistory({ exerciseDefinitionId: SQUAT });
    expect(await screen.findByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/);
    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    fireEvent.press(screen.getByTestId('progress-history-exercise-history'));
    expect(mockPush).toHaveBeenLastCalledWith(`/exercise-history?exerciseDefinitionId=${SQUAT}`);
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

  it('opens the saved Timeline with the focused week\'s sets, whose cards and the ⋮\'s View sessions navigate', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    await openHistory({ exerciseDefinitionId: SQUAT });

    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-heatmap-panel-timeline')).toHaveProp('pointerEvents', 'auto'));
    expect(screen.getByTestId('stats-exercise-history-view-chip-timeline')).toHaveProp('accessibilityState', { selected: true });
    // The selection starts on the current week, where the fixture's squat sessions are.
    const cards = await screen.findAllByTestId(/^stats-exercise-history-week-sets-card-[^-]+$/);
    expect(cards.length).toBeGreaterThan(0);
    // An exercise's own cards link to no other exercise.
    expect(screen.queryAllByTestId(/^stats-exercise-history-week-sets-card-[^-]+-exercise$/)).toEqual([]);
    fireEvent.press(cards[0]);
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringMatching(/^\/completed-session\//));
    // The header's ⋮ opens the focused week's sessions — as a Weekly row does.
    expect(screen.queryByTestId('progress-history-view-sessions')).toBeNull();
    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    fireEvent.press(screen.getByTestId('progress-history-view-sessions'));
    expect(mockPush).toHaveBeenLastCalledWith(`/sessions?week=${localDateKey(calendarWeekBounds(1).start)}`);

    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-daily')); });
    expect(screen.getByTestId('stats-exercise-history-heatmap-panel-daily')).toHaveProp('pointerEvents', 'auto');
  });

  it('focuses the newest week from the start, and the arrows move the list with it', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    await openHistory({ exerciseDefinitionId: SQUAT });
    const cards = () => screen.queryAllByTestId(/^stats-exercise-history-week-sets-card-[^-]+$/);
    const before = (await screen.findAllByTestId(/^stats-exercise-history-week-sets-card-[^-]+$/)).length;

    // Nothing is selected yet, so the newest week is the focused one: marked in
    // the chart, named in the readout, and listed below.
    const readout = () => screen.getByTestId('stats-exercise-history-timeline-readout-week', { includeHiddenElements: true }).props.children;
    expect(screen.getByTestId('stats-exercise-history-timeline-selected')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-timeline-next-week')).toBeDisabled();
    const newest = readout();

    // One week back is a different week, and the list follows it; forward again
    // returns to the newest, with the same sets.
    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-timeline-previous-week')); });
    expect(readout()).not.toBe(newest);
    await act(async () => { fireEvent.press(screen.getByTestId('stats-exercise-history-timeline-next-week')); });
    expect(readout()).toBe(newest);
    await waitFor(() => expect(cards()).toHaveLength(before));
    expect(screen.queryByTestId('stats-exercise-history-week-sets-empty')).toBeNull();
  });

  it('retries a failed week read in place', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    jest.spyOn(statsRepository, 'computeSelectedMuscleDailyEffort').mockRejectedValueOnce(new Error('DB busy'));
    await openHistory({ muscleGroupId: 'quads' });

    expect(await screen.findByTestId('stats-muscle-history-week-sets-error')).toHaveTextContent(/DB busy/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-week-sets-retry'));
    expect((await screen.findAllByTestId(/^stats-muscle-history-week-sets-card-[^-]+$/)).length).toBeGreaterThan(0);
  });

  it('lists a muscle\'s week by the exercises that worked it', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    await openHistory({ muscleGroupId: 'quads' });

    const cards = await screen.findAllByTestId(/^stats-muscle-history-week-sets-card-[^-]+$/);
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Squat/).length).toBeGreaterThan(0);
  });

  it('opens a muscle card\'s exercise history on the metric shown, and its session from the card', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    await openHistory({ muscleGroupId: 'quads', gymId: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId });

    const squat = { exerciseDefinitionId: SQUAT, gymId: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId };
    const buttons = await screen.findAllByLabelText(/^Open .*Squat.* progress$/);
    fireEvent.press(buttons[0]);
    expect(mockPush).toHaveBeenLastCalledWith(progressHistoryHref(squat, 'totalVolume'));

    await chooseMetric('muscle', 'workingSetCount');
    fireEvent.press((await screen.findAllByLabelText(/^Open .*Squat.* progress$/))[0]);
    expect(mockPush).toHaveBeenLastCalledWith(progressHistoryHref(squat, 'workingSetCount'));

    fireEvent.press(screen.getAllByTestId(/^stats-muscle-history-week-sets-card-[^-]+$/)[0]);
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringMatching(/^\/completed-session\//));
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

    // The sessions behind each day come from the same read.
    const days = await exerciseAnalytics.computeSelectedExerciseDailyEffort({ ...calendarWeekBounds(8), exerciseDefinitionId: SQUAT });
    const single = days.find(day => day.sessionIds?.length === 1)!;
    expect(single.sessionIds).toHaveLength(1);
    fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${single.dateKey}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/completed-session/${single.sessionIds![0]}`);
    const several = days.find(day => (day.sessionIds?.length ?? 0) > 1)!;
    expect(several.sessionIds!.length).toBeGreaterThan(1);
    fireEvent.press(screen.getByTestId(`stats-exercise-history-heatmap-cell-${several.dateKey}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/sessions?day=${several.dateKey}`);

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
    expect(screen.getAllByTestId(/^stats-exercise-history-heatmap-cell-\d{4}-\d{2}-\d{2}$/)).toHaveLength(2);
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
    await act(async () => initial.resolve({ weekly: [], daily: [], gyms: [] }));
    expect(await screen.findByTestId('stats-exercise-history-empty')).toBeTruthy();
    act(() => updatePreferences({ historyLookbackWeeks: 4 }));
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-history-heatmap')).toBeNull();
    // Pending with no data mounts no chart at all, in either view.
    expect(screen.queryAllByTestId('stats-exercise-history-heatmap', { includeHiddenElements: true })).toHaveLength(0);
    await act(async () => reload.resolve({ weekly: [], daily: [], gyms: [] }));
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
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining(historyWeekBounds(weeks)));
    const panel = within(screen.getByTestId('stats-exercise-history-heatmap-panel-daily'));
    expect(renderedDailySample()).toHaveLength(weeks * 7 + 6);
    const olderKey = localDateKey(new Date(Date.now() - 450 * DAY_MS));
    if (weeks === 104) {
      expect(renderedDailySample().find(day => day.dateKey === olderKey)?.day?.value).toBe(600);
    } else expect(panel.queryByTestId(`stats-exercise-history-heatmap-cell-${olderKey}`)).toBeNull();
  });

  it('shortens the calendar window while collapsing rest months and keeping training days open', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ historyLookbackWeeks: 104, heatmapView: 'daily' }));
    await openHistory({ exerciseDefinitionId: SQUAT });
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    const dateKey = localDateKey(new Date(Date.now() - 40 * DAY_MS));
    expect(renderedDailySample().find(day => day.dateKey === dateKey)?.day?.hasTraining).toBe(false);
    expect(screen.queryByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toBeNull();
    act(() => updatePreferences({ historyLookbackWeeks: 52 }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    expect(renderedDailySample().find(day => day.dateKey === dateKey)?.day?.hasTraining).toBe(false);
    expect(screen.queryByTestId(`stats-exercise-history-heatmap-cell-${dateKey}`)).toBeNull();
    act(() => updatePreferences({ historyLookbackWeeks: 1 }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-history-loading'), { timeout: 10_000 });
    // Today holds a Squat session, so it opens it.
    expect(screen.getByTestId(`stats-exercise-history-heatmap-cell-${localDateKey(new Date())}`))
      .toHaveProp('accessibilityRole', 'button');
    expect(renderedDailySample().some(day => day.dateKey === dateKey)).toBe(false);
  }, 120_000);

  it('titles a muscle page with its name and offers only the two muscle metrics', async () => {
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ muscleGroupId: 'quads' });

    await waitFor(() => expect(mockScreenOptions.title).toBe('Quads'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    expect(shownMetric('muscle')).toBe('totalVolume');
    expect(metricChip('muscle')).toHaveProp('accessibilityLabel', 'Effort metric: Volume. Activate to show Sets.');
    // The chip steps Volume → Sets and wraps straight back: no exercise-only metric.
    const stepped: string[] = [];
    for (let press = 0; press < 2; press += 1) {
      await act(async () => { fireEvent.press(metricChip('muscle')); });
      stepped.push(shownMetric('muscle'));
    }
    expect(stepped).toEqual(['workingSetCount', 'totalVolume']);

    await chooseMetric('muscle', 'workingSetCount');
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-weekly')).toHaveProp('pointerEvents', 'auto');
    expect(shownMetric('muscle')).toBe('workingSetCount');
  });

  it('shows a secondary muscle\'s day cells its half-steps, unrounded', async () => {
    await loadMaestroFixture('exercise-block-history');
    // Quads becomes a secondary mapping, keeping the fixture's real sets
    // ([[muscle.set-count]]) and the production aggregation/rendering path.
    localDataClient().prepare("UPDATE exercise_muscle_mappings SET role = 'secondary' WHERE muscle_group_id = 'quads'").run();
    act(() => updatePreferences({ heatmapView: 'daily' }));
    await openHistory({ muscleGroupId: 'quads' });
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    await chooseMetric('muscle', 'workingSetCount');

    const trained = renderedDailySample('muscle').filter(tile => tile.day?.hasTraining);
    expect(trained.length).toBeGreaterThan(0);
    // Every day is a half-step, and at least one is a genuine half.
    expect(trained.every(tile => (tile.day!.value * 2) % 1 === 0)).toBe(true);
    expect(trained.some(tile => tile.day!.value % 1 === 0.5)).toBe(true);
    for (const tile of trained) {
      expect(screen.getByTestId(`stats-muscle-history-heatmap-cell-${tile.dateKey}-value`))
        .toHaveTextContent(String(tile.day!.value));
    }
  });

  it('counts only primary work, chart and week list alike, when Progress hid secondary sets, until its Filters count them again', async () => {
    await loadMaestroFixture('exercise-block-history');
    // Quads keeps its real sets but only as a secondary mapping ([[muscle.secondary-filter]]).
    localDataClient().prepare("UPDATE exercise_muscle_mappings SET role = 'secondary' WHERE muscle_group_id = 'quads'").run();
    act(() => updatePreferences({ heatmapView: 'timeline' }));
    const history = jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort');
    const week = jest.spyOn(statsRepository, 'computeSelectedMuscleDailyEffort');
    await openHistory({ muscleGroupId: 'quads', secondary: 'hidden' });
    await waitFor(() => expect(history).toHaveBeenCalledWith(expect.objectContaining({ muscleGroupIds: ['quads'], countSecondary: false })));
    await waitFor(() => expect(week).toHaveBeenCalledWith(expect.objectContaining({ muscleGroupIds: ['quads'], countSecondary: false })));
    expect(await screen.findByTestId('stats-muscle-history-empty')).toBeTruthy();
    expect(screen.queryAllByTestId(/^stats-muscle-history-week-sets-card-[^-]+$/)).toHaveLength(0);
    // The page's own Filters open on Progress's choice and change it for this visit.
    expect(screen.getByTestId('progress-history-filters')).toHaveProp('accessibilityLabel', 'Filters: secondary sets not counted');
    expect(inFilters(() => screen.getByTestId('stats-secondary-toggle').props.accessibilityState.checked)).toBe(false);
    inFilters(() => fireEvent.press(screen.getByTestId('stats-secondary-toggle')));
    await waitFor(() => expect(history).toHaveBeenLastCalledWith(expect.not.objectContaining({ countSecondary: false })));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-empty'));
    expect((await screen.findAllByTestId(/^stats-muscle-history-week-sets-card-[^-]+$/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('progress-history-filters')).toHaveProp('accessibilityLabel', 'Filters');
  });

  it('combines the linked gym with secondary sets, keeping the gym rows while either choice re-reads', async () => {
    await loadMaestroFixture('exercise-block-history');
    const gym = EXERCISE_BLOCK_HISTORY_FIXTURE.gymId;
    const real = statsRepository.computeSelectedMuscleHistoryEffort;
    let release: () => void = () => undefined;
    const history = jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort').mockImplementation(options =>
      options.countSecondary === false ? real(options)
        : new Promise(resolve => { release = () => resolve(real(options)); }));
    await openHistory({ muscleGroupId: 'quads', gymId: gym, secondary: 'hidden' });
    await waitFor(() => expect(history).toHaveBeenCalledWith(expect.objectContaining({ gymId: gym, countSecondary: false })));
    await waitFor(() => expect(screen.getByTestId('progress-history-filters').props.accessibilityLabel)
      .toBe('Filters: Maestro Block History Gym, secondary sets not counted'));

    fireEvent.press(screen.getByTestId('progress-history-filters'));
    fireEvent.press(screen.getByTestId('stats-secondary-toggle'));
    await waitFor(() => expect(history).toHaveBeenLastCalledWith(expect.not.objectContaining({ countSecondary: false })));
    // The read is pending: the open sheet keeps its gym rows.
    expect(screen.getByTestId(`stats-gym-option-${gym}`)).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId(`stats-gym-option-${gym}`)).toHaveTextContent(/Maestro Block History Gym/);
    await act(async () => release());
    fireEvent.press(screen.getByTestId('stats-gym-option-all'));
    fireEvent(screen.getByTestId('progress-history-filters-sheet'), 'accessibilityEscape');
    await waitFor(() => expect(history.mock.lastCall?.[0]).not.toHaveProperty('gymId'));
    expect(history.mock.lastCall?.[0]).not.toHaveProperty('countSecondary');
    await act(async () => release());
    expect(screen.getByTestId('progress-history-filters')).toHaveProp('accessibilityLabel', 'Filters');
  });

  it('offers secondary sets only on a muscle page: an exercise page keeps a plain gym button', async () => {
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ exerciseDefinitionId: SQUAT });
    expect(await screen.findByTestId('stats-exercise-history-gym')).toBeTruthy();
    expect(screen.queryByTestId('progress-history-filters')).toBeNull();
    expect(screen.queryByTestId('stats-secondary-toggle')).toBeNull();
  });

  it('retries a failed muscle history read without leaving the page', async () => {
    jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort').mockRejectedValueOnce(new Error('Weekly boom'));
    await loadMaestroFixture('exercise-block-history');
    await openHistory({ muscleGroupId: 'chest' });

    expect(await screen.findByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-error'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    expect(mockScreenOptions.title).toBe('Pectoralis');
  });

  it('renders the unavailable state for a muscle the catalogue no longer holds', async () => {
    await loadMaestroFixture('exercise-block-history');
    const read = jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort');
    await openHistory({ muscleGroupId: 'deleted_muscle' });

    await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
    expect(read).not.toHaveBeenCalled();
  });
});
