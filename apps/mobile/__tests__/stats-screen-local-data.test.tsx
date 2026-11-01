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
 * reaches it. The history page Progress pushes has its own suites
 * (`progress-history-local-data.test.tsx`, `progress-history-page.test.tsx`);
 * here, a row press is proved by the push it makes.
 */

import type { CalendarMonth } from '@/components/heatmaps/daily-calendar';
import * as mockReact from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { uiGeometry } from '@/components/ui';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
let mockIsFocused = true;
let mockSearchParams: Record<string, string | string[]> = {};
// Every mounted focus callback, so a test can play "the tab came back".
const mockFocusCallbacks = new Map<() => void | (() => void), void | (() => void)>();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  // False while the pushed history page is on top.
  useIsFocused: () => mockIsFocused,
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

import {
  __resetAccountLocalPreferencesForTests,
  ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState,
  setAccountLocalPreferenceAccount,
} from '@/src/preferences/account-local';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import StatsRoute from '../app/(tabs)/stats-history';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { computeMuscleScores } from '@/components/stats/muscle-body-projection';
import * as exerciseAnalytics from '@/src/data/exercise-analytics';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import * as statsRepository from '@/src/data/stats';
import * as exerciseCatalogStats from '@/src/data/exercise-catalog-stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData, localDataClient } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const BENCH = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const SQUAT_ROW = `stats-exercise-row-${SQUAT}`;
const renderedDailySample = () => {
  const list = screen.UNSAFE_getAllByType(FlatList).find(node => node.props.testID === 'stats-exercise-history-scroll');
  const months: CalendarMonth[] = list!.props.data;
  return months.flatMap(month => month.weeks.flatMap(week => week.days)).filter(day => day.day);
};

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

const showBody = () => act(async () => { updatePreferences({ progressMuscleLayout: '3d' }); });

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

type ProgressRead = () => ReturnType<typeof statsRepository.computeProgressComparisons>;
// A focus reads both periods the chip offers. This stands in for each period's
// next reads, in order; any other read goes to the database. One call a test.
const interceptReads = (reads: Record<number, ProgressRead[]>) => {
  const real = statsRepository.computeProgressComparisons;
  return jest.spyOn(statsRepository, 'computeProgressComparisons').mockImplementation(options => {
    const weeks = options?.periodWeeks;
    const next = weeks === undefined ? undefined : reads[weeks]?.shift();
    return next ? next() : real(options);
  });
};

// Each filter is one chip showing the value in force; a tap swaps it for the
// other. These say which value the test wants, and tap only when it is not on.
const chipValue = (filter: 'view-mode' | 'period' | 'metric'): string =>
  within(screen.getByTestId(`stats-${filter}-chip`)).getByText(/.+/).props.children as string;
const chooseFilter = (filter: 'view-mode' | 'period' | 'metric', label: string) => {
  if (chipValue(filter) !== label) fireEvent.press(screen.getByTestId(`stats-${filter}-chip`));
  expect(chipValue(filter)).toBe(label);
};

// Group by, Count secondary sets and the gym sit in the Filters sheet, which
// stays open across choices; each helper opens it, acts, and dismisses it.
const inFilters = <T,>(inside: () => T): T => {
  fireEvent.press(screen.getByTestId('stats-filters'));
  const result = inside();
  fireEvent(screen.getByTestId('stats-filters-sheet'), 'accessibilityEscape');
  return result;
};
const toggleGroup = () => inFilters(() => fireEvent.press(screen.getByTestId('stats-group-toggle')));
const groupChecked = () => inFilters(() => screen.getByTestId('stats-group-toggle').props.accessibilityState.checked);
const chooseGym = (key: string) => inFilters(() => fireEvent.press(screen.getByTestId(`stats-gym-option-${key}`)));
const chosenGym = () => inFilters(() => screen.getAllByTestId(/^stats-gym-option-/)
  .find(row => row.props.accessibilityState?.checked)?.props.testID.replace('stats-gym-option-', ''));

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

// A Lat Pulldown workout still in progress: one confirmed set, one planned.
const startPulldown = async (startedDaysAgo: number) => {
  const startedAt = new Date(Date.now() - startedDaysAgo * DAY_MS);
  await persistSessionDraftSnapshot(
    {
      sessionId: 'stats_pulldown_in_progress',
      gymId: null,
      startedAt,
      exercises: [
        {
          id: 'stats_pulldown_in_progress_pulldown',
          exerciseDefinitionId: PULLDOWN,
          name: 'Lat Pulldown',
          sets: [
            { id: 'stats_pulldown_in_progress_done', weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: null },
            { id: 'stats_pulldown_in_progress_planned', weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: 'planned' },
          ],
        },
      ],
    },
    { now: startedAt }
  );
};

beforeEach(() => {
  resetLocalData();
  mockUserId = null;
  mockPush.mockClear();
  mockIsFocused = true;
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
  it('grades 3D Sets by the selected period target while keeping Volume comparisons independent of targets and History', async () => {
    jest.setSystemTime(new Date(2026, 9, 26, 12));
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(30);
    await logPulldown(1);
    await logPulldown(.05);
    const db = localDataClient();
    db.prepare("UPDATE sessions SET gym_id = ? WHERE id = 'stats_pulldown_1'").run(EXERCISE_BLOCK_HISTORY_FIXTURE.gymId);
    db.prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('pulldown_biceps', ?, 'biceps', 0.5, 'secondary') ON CONFLICT (exercise_definition_id, muscle_group_id) DO UPDATE SET weight = 0.5, role = 'secondary'").run(PULLDOWN);
    await act(async () => updatePreferences({ progressMuscleLayout: '3d' }));
    await renderStats();
    fireEvent.press(await screen.findByTestId('stats-muscle-body-target-back_lats'));
    expect(screen.queryByTestId('stats-muscle-body-legend')).toBeNull();
    const change = () => screen.getByTestId('stats-muscle-body-comparison-change');
    const scores = () => {
      const props = screen.UNSAFE_getByType(MuscleBodyCard).props;
      return computeMuscleScores(props.muscles, props.metric, props.setTargets);
    };
    expect(change()).toHaveTextContent(/^0$/);
    expect(scores().get('back_lats')).toBe(-.75);
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^1$/);
    expect(screen.getByTestId('stats-muscle-body-comparison-previous')).toHaveTextContent(/^1$/);
    chooseFilter('period', '4 weeks');
    expect(change()).toHaveTextContent(/^\+1$/);
    expect(scores().get('back_lats')).toBe(-.875);
    await act(async () => updatePreferences({ weeklyWorkingSetTarget: 4 }));
    expect(scores().get('back_lats')).toBe(-.75);
    await act(async () => updatePreferences({ muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { detailed: { back_lats: 1 }, broad: { back_lats: 99 } } }));
    expect(scores().get('back_lats')).toBe(0);
    chooseFilter('metric', 'Volume');
    expect(change()).toHaveTextContent(/^\+100%$/);
    const before = screen.UNSAFE_getByType(MuscleBodyCard).props.muscles;
    const beforeScores = scores();
    await act(async () => updatePreferences({ historyLookbackWeeks: 1, weeklyWorkingSetTarget: 999 }));
    expect(screen.UNSAFE_getByType(MuscleBodyCard).props.muscles).toEqual(before);
    expect(scores()).toEqual(beforeScores);
    expect(change()).toHaveTextContent(/^\+100%$/);
    chooseFilter('period', 'This week');
    expect(change()).toHaveTextContent(/^0%$/);
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-biceps'));
    // Biceps shares the secondary half-pool with the pulldown's other secondary.
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^75$/);
    inFilters(() => fireEvent.press(screen.getByTestId('stats-volume-primary-only-toggle')));
    expect(await screen.findByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^0$/);
    expect(change()).toHaveTextContent(/^—$/);
    expect(scores().get('biceps')).toBeNull();
  });

  it('holds Group by and Gym in the Filters sheet, whose compact button fills while either is changed', async () => {
    await renderSeededStats();
    const button = () => screen.getByTestId('stats-filters');
    expect(StyleSheet.flatten(button().props.style).minHeight).toBe(uiGeometry.compactControlHeight);
    expect(button()).toHaveProp('accessibilityLabel', 'Filters');
    expect(screen.queryByTestId('stats-group-toggle')).toBeNull();
    fireEvent.press(button());
    expect(screen.getByTestId('stats-filters-sheet')).toBeTruthy();
    expect(screen.getByTestId('stats-group-toggle')).toHaveProp('accessibilityState', { checked: true });
    // Exercise List counts no muscle, so it offers no secondary choice.
    expect(screen.queryByTestId('stats-secondary-toggle')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-group-toggle'));
    // The sheet stays open across choices.
    expect(screen.getByTestId('stats-group-toggle')).toHaveProp('accessibilityState', { checked: false });
    fireEvent(screen.getByTestId('stats-filters-sheet'), 'accessibilityEscape');
    expect(screen.queryAllByTestId(/^stats-exercise-family-header-/)).toHaveLength(0);
    expect(button()).toHaveProp('accessibilityLabel', 'Filters: not grouped');
    expect(button()).toHaveTextContent('Filters');
  });

  it('groups exercises by catalogue primary family, sorts within it and retains each breakdown’s controls', async () => {
    await renderSeededStats();
    const familyHeaders = () => screen.queryAllByTestId(/^stats-exercise-family-header-/).map(row => row.props.children);
    expect(familyHeaders()).toEqual(['Chest', 'Legs', 'Other']);
    expect(exerciseOrder().indexOf(BENCH)).toBeLessThan(exerciseOrder().indexOf(SQUAT));
    fireEvent.press(screen.getByTestId('stats-exercise-sort-previous'));
    expect(familyHeaders()).toEqual(['Chest', 'Legs', 'Other']);
    toggleGroup();
    expect(familyHeaders()).toEqual([]);
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    expect(exerciseOrder()).toEqual([SQUAT]);

    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-muscle-search-input')).toHaveProp('value', '');
    expect(groupChecked()).toBe(true);
    fireEvent.changeText(screen.getByTestId('stats-muscle-search-input'), ' LEGS ');
    expect(screen.getAllByTestId(/^stats-family-header-/)).toHaveLength(2);
    expect(screen.getByTestId('stats-family-header-legs')).toHaveTextContent('Legs');
    fireEvent.press(screen.getByTestId('stats-muscle-sort-now'));
    const order = () => screen.queryAllByTestId(/^stats-muscle-block-/).map(row => row.props.testID);
    toggleGroup();
    expect(screen.queryAllByTestId(/^stats-family-header-/)).toHaveLength(0);
    const values = screen.getAllByTestId(/^stats-muscle-row-.*-now$/).map(row => Number(row.props.children));
    expect(values).toEqual([...values].sort((left, right) => left - right));
    fireEvent.changeText(screen.getByTestId('stats-muscle-search-input'), 'nothing matches');
    expect(screen.getByTestId('stats-muscle-list-empty')).toBeTruthy();
    expect(order()).toEqual([]);
    fireEvent.press(screen.getByTestId('stats-muscle-search-input-clear'));
    expect(order().length).toBeGreaterThan(0);

    chooseFilter('view-mode', 'Exercise');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(groupChecked()).toBe(false);
    expect(screen.getByTestId('stats-exercise-sort-previous')).toHaveProp('accessibilityState', { selected: true });
    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-muscle-sort-now').props.accessibilityLabel).toContain('low to high');
    expect(groupChecked()).toBe(false);
  });

  it('shows separate Sets columns and toggles Now, Previous, Muscle and Change sorts over real data', async () => {
    await renderSeededStats();
    chooseFilter('view-mode', 'Muscle');
    toggleGroup();
    const values = (column: string) => screen.getAllByTestId(new RegExp(`^stats-muscle-row-.*-${column}$`))
      .map(row => Number(String(row.props.children).replace('−', '-')));
    const expectSorted = (column: string, descending: boolean) => {
      const numbers = values(column);
      expect(numbers).toEqual([...numbers].sort((left, right) => descending ? right - left : left - right));
    };
    expectSorted('now', true);
    expect(screen.getByTestId('stats-muscle-sort-previous')).toHaveProp('accessibilityState', { selected: false });
    expect(within(screen.getByTestId('stats-muscle-sort-now')).getByText('Now')).toBeTruthy();
    expect(within(screen.getByTestId('stats-muscle-sort-previous')).getByText('Prev')).toBeTruthy();
    expect(screen.queryAllByTestId(/^stats-muscle-row-.*-periods$/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^stats-muscle-ticker-/)).toHaveLength(0);
    expect(screen.getByTestId('stats-muscle-sort-now')).toHaveStyle({ minHeight: uiGeometry.tapTarget });
    fireEvent.press(screen.getByTestId('stats-muscle-sort-now'));
    expectSorted('now', false);
    expect(screen.getByTestId('stats-muscle-sort-now-indicator-up', { includeHiddenElements: true })).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-sort-now'));
    expectSorted('now', true);
    expect(screen.getByTestId('stats-muscle-sort-now-indicator-down', { includeHiddenElements: true })).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-sort-previous'));
    expectSorted('previous', true);
    fireEvent.press(screen.getByTestId('stats-muscle-sort-previous'));
    expectSorted('previous', false);
    expect(screen.getByTestId('stats-muscle-sort-previous-indicator-up', { includeHiddenElements: true })).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-sort-muscle'));
    const names = () => screen.getAllByRole('link').map(row => row.props.accessibilityLabel);
    expect(names()).toEqual([...names()].sort((left, right) => left.localeCompare(right)));
    fireEvent.press(screen.getByTestId('stats-muscle-sort-muscle'));
    expect(names()).toEqual([...names()].sort((left, right) => right.localeCompare(left)));
    expect(screen.getByTestId('stats-muscle-sort-now-indicator')).toHaveStyle({ opacity: 0 });
    fireEvent.press(screen.getByTestId('stats-muscle-sort-change'));
    expectSorted('change', true);
    fireEvent.press(screen.getByTestId('stats-muscle-sort-change'));
    expectSorted('change', false);
    expect(screen.getByTestId('stats-muscle-sort-change-indicator-up', { includeHiddenElements: true })).toBeTruthy();
    chooseFilter('metric', 'Volume');
    for (const [column, label] of [['now', 'Now'], ['previous', 'Prev'], ['change', 'Change']]) {
      expect(within(screen.getByTestId(`stats-muscle-sort-${column}`)).getByText(label)).toBeTruthy();
    }
    expect(screen.queryAllByTestId(/^stats-muscle-row-.*-periods$/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^stats-muscle-ticker-/)).toHaveLength(0);
  });

  it('gives each Secondary ½ across Muscle and its history when included, without changing Exercise totals', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ progressCountSecondary: true }));
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('primary_bench_biceps', ?, 'biceps', 1, 'primary')").run(BENCH);
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('secondary_squat_biceps', ?, 'biceps', 0.5, 'secondary')").run(SQUAT);
    await act(async () => invalidateExerciseCatalogCache());
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    chooseFilter('view-mode', 'Muscle');
    const bicepsNow = () => screen.getByTestId('stats-muscle-row-biceps-now');
    // Bench's whole primary plus 7 squat sets at ½ each: 4 whole sets drawn.
    await waitFor(() => expect(bicepsNow()).toHaveTextContent(/^4$/));
    const secondaryOn = () => inFilters(() => !screen.getByTestId('stats-secondary-toggle').props.accessibilityState.checked);
    expect(secondaryOn()).toBe(true);
    fireEvent.press(screen.getByRole('link', { name: 'Open Biceps history' }));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=biceps&metric=sets&secondary=shown&secondaryVolume=shown');

    inFilters(() => fireEvent.press(screen.getByTestId('stats-secondary-toggle')));
    await waitFor(() => expect(bicepsNow()).toHaveTextContent(/^1$/));
    expect(secondaryOn()).toBe(false);
    expect(screen.getByTestId('stats-filters')).toHaveProp('accessibilityLabel', 'Filters: secondary sets not counted');
    fireEvent.press(screen.getByRole('link', { name: 'Open Biceps history' }));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=biceps&metric=sets&secondary=hidden&secondaryVolume=shown');

    await showBody();
    fireEvent.press(await screen.findByTestId('stats-muscle-body-target-biceps'));
    expect(screen.getByTestId(`stats-contribution-${BENCH}-now`)).toHaveTextContent(/^1$/);
    expect(screen.queryByTestId(`stats-contribution-${SQUAT}`)).toBeNull();
    inFilters(() => fireEvent.press(screen.getByTestId('stats-secondary-toggle')));
    expect(await screen.findByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent(/^3$/);
    chooseFilter('view-mode', 'Exercise');
    expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    inFilters(() => expect(screen.queryByTestId('stats-secondary-toggle')).toBeNull());
  });

  it('keeps effort-grouped muscle contributions separate from the full Exercise list, which defaults to Sets', async () => {
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ progressCountSecondary: true }));
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('primary_bench_biceps', ?, 'biceps', 1, 'primary')").run(BENCH);
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('secondary_squat_biceps', ?, 'biceps', 0.5, 'secondary')").run(SQUAT);
    await act(async () => invalidateExerciseCatalogCache());
    await showBody();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    const allExercises = exerciseOrder();
    chooseFilter('view-mode', 'Muscle');
    fireEvent.press(await screen.findByTestId('stats-muscle-body-target-biceps'));
    const muscle = within(screen.getByTestId('stats-contributions'));
    expect(muscle.getAllByTestId('stats-contributions-header')).toHaveLength(1);
    expect(muscle.getByText('Primary effort')).toHaveProp('accessibilityRole', 'header');
    expect(muscle.getByText('Secondary effort')).toHaveProp('accessibilityRole', 'header');
    expect(muscle.getAllByTestId(new RegExp(`^stats-contribution-(${BENCH}|${SQUAT})$`)).map(row => row.props.testID))
      .toEqual([`stats-contribution-${BENCH}`, `stats-contribution-${SQUAT}`]);
    expect(muscle.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent(/^3$/);
    expect(muscle.queryByText('Total')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-calves'));
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No working sets for Calves in either period');
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-quads'));
    expect(screen.queryByTestId(`stats-contribution-${BENCH}`)).toBeNull();

    chooseFilter('view-mode', 'Exercise');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
    expect(exerciseOrder()).toEqual(allExercises);
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    expect(screen.queryByText('Primary effort')).toBeNull();
    expect(screen.queryByText('Secondary effort')).toBeNull();
    chooseFilter('metric', 'Volume');
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^7100$/);
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'nothing matches');
    expect(screen.getByTestId('stats-exercise-list-empty')).toHaveTextContent('No exercises match the search query.');
    fireEvent.changeText(screen.getByTestId('stats-search-input'), '');
    chooseFilter('metric', '1RM');
    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Quads');
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent(/^7$/);
  });

  it('keeps Exercise usable while the independent Muscle source fails', async () => {
    await loadMaestroFixture('exercise-block-history');
    const pending = deferred<Awaited<ReturnType<typeof statsRepository.computeProgressComparisons>>>();
    interceptReads({ 1: [() => pending.promise] });
    await showBody();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    await act(async () => pending.reject(new Error('muscle read failed')));
    expect(screen.queryByTestId('stats-error-state')).toBeNull();
    expect(screen.getByTestId(SQUAT_ROW)).toBeTruthy();
    chooseFilter('view-mode', 'Muscle');
    await screen.findByTestId('stats-error-state');
    fireEvent.press(screen.getByTestId('stats-retry'));
    await screen.findByTestId('stats-muscle-body-card');
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
  });

  it('reports an exercise-history read failure without a false empty list and retries the source', async () => {
    await loadMaestroFixture('exercise-block-history');
    const read = jest.spyOn(exerciseCatalogStats, 'loadExerciseCatalogStatsRawHistory').mockRejectedValue(new Error('exercise read failed'));
    await renderStats();
    await showBody();
    await screen.findByTestId('stats-error-state');
    expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-list-empty')).toBeNull();
    read.mockRestore();
    fireEvent.press(screen.getByTestId('stats-retry'));
    await screen.findByTestId(SQUAT_ROW);
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
  });

  it('retains filters and selection across List and 3D, and restores the saved layout', async () => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-table');
    chooseFilter('metric', 'Volume');
    fireEvent.press(screen.getByTestId('stats-muscle-select-quads'));
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent('3550');
    await showBody();
    expect(screen.getByTestId('stats-muscle-body-card')).toBeTruthy();
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent('3550');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    fireEvent.press(screen.getByTestId('stats-contributions-view-daily'));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=quads&metric=volume&secondary=hidden&secondaryVolume=shown&view=daily');
    await act(async () => updatePreferences({ progressMuscleLayout: 'list' }));
    expect(within(screen.getByTestId('stats-muscle-block-quads')).getByTestId('stats-contributions')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-select-quads'));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    await showBody();
    screen.unmount();
    await renderStats();
    await screen.findByTestId('stats-muscle-body-card');
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    // The layout is a saved setting; the metric chosen on the page was only for that visit.
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
  });

  it.each(['Sets', 'Volume'] as const)('keeps list history and inline contributors on the selected %s metric', async metric => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-table');
    chooseFilter('metric', metric);
    fireEvent.press(screen.getByTestId('stats-muscle-history-quads'));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?muscleGroupId=quads&metric=${metric === 'Sets' ? 'sets' : 'volume'}&secondary=hidden&secondaryVolume=shown`);
    fireEvent.press(screen.getByTestId('stats-muscle-select-quads'));
    const block = within(screen.getByTestId('stats-muscle-block-quads'));
    expect(block.getByTestId('stats-contributions')).toBeTruthy();
    expect(block.getByTestId(`stats-contribution-${SQUAT}-now`).props.children)
      .toBe(screen.getByTestId('stats-muscle-row-quads-now').props.children);
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=${metric === 'Sets' ? 'sets' : 'volume'}&view=timeline`);
  });

  it.each([['7', 7], [['7'], 7], ['30', 28], ['all', 28]] as const)
  ('opens the requested %s period using the saved window for legacy values', async (period, days) => {
    mockSearchParams = { period: typeof period === 'string' ? period : [...period], breakdown: 'exercise' };
    await renderSeededStats();
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent(days === 7 ? 'This week' : '4 weeks');
  });

  it('defaults to the configured window, collapses a one-week choice, and refreshes it while mounted', async () => {
    mockSearchParams = { breakdown: 'exercise' };
    await renderSeededStats();
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
    act(() => updatePreferences({ targetWindowWeeks: 1 }));
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    expect(screen.getByTestId('stats-period-chip')).toHaveProp('accessibilityState', { disabled: true });
    act(() => updatePreferences({ targetWindowWeeks: 4 }));
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
    await waitFor(() => expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent('11'));
  });

  it('filters the exercise rows by the chosen gym, every gym by default, and opens history on that gym', async () => {
    await loadMaestroFixture('exercise-block-history');
    const gym = EXERCISE_BLOCK_HISTORY_FIXTURE.gymId;
    localDataClient().prepare("UPDATE sessions SET gym_id = NULL WHERE id = 'maestro_exercise_block_history_squat_2'").run();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    const squatNow = () => screen.getByTestId(`stats-exercise-row-${SQUAT}-now`);
    expect(chosenGym()).toBe('all');
    expect(squatNow()).toHaveTextContent(/^7$/);

    chooseGym(gym);
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    expect(chosenGym()).toBe(gym);
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).toContain(`exerciseDefinitionId=${SQUAT}`);
    expect(String(mockPush.mock.lastCall?.[0])).toContain(`gymId=${gym}`);

    chooseGym('no-gym');
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^2$/));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).toContain('gymId=no-gym');

    chooseGym('all');
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^7$/));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).not.toContain('gymId=');
    chooseGym(gym);
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    // The Muscle table shares the gym; the 3D muscle body uses all gyms.
    chooseFilter('view-mode', 'Muscle');
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^5$/));
    expect(chosenGym()).toBe(gym);
    fireEvent.press(screen.getByRole('link', { name: 'Open Quads history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?muscleGroupId=quads&metric=sets&gymId=${gym}&secondary=hidden&secondaryVolume=shown`);
    chooseGym('no-gym');
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^2$/));
    fireEvent.press(screen.getByRole('link', { name: 'Open Quads history' }));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=quads&metric=sets&gymId=no-gym&secondary=hidden&secondaryVolume=shown');
    chooseGym('all');
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^7$/));
    chooseGym(gym);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^5$/));
    await showBody();
    // Muscle 3D counts every gym, so its Filters hold only secondary sets.
    expect(inFilters(() => [screen.queryAllByTestId(/^stats-gym-option-/).length, screen.queryByTestId('stats-secondary-toggle') !== null]))
      .toEqual([0, true]);
    await screen.findByTestId('stats-muscle-body-card');
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-quads'));
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    const body = screen.UNSAFE_getByType(MuscleBodyCard).props;
    const allGyms = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    expect(computeMuscleScores(body.muscles, body.metric, body.setTargets))
      .toEqual(computeMuscleScores(allGyms.muscles, body.metric, body.setTargets));
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=sets&view=timeline`);
    chooseFilter('view-mode', 'Exercise');
    expect(screen.queryByTestId('stats-muscle-body-card')).toBeNull();
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    expect(chosenGym()).toBe(gym);
  });

  it('hides the previous gym’s Muscle snapshot and ignores its late read', async () => {
    await loadMaestroFixture('exercise-block-history');
    localDataClient().prepare("UPDATE sessions SET gym_id = NULL WHERE id = 'maestro_exercise_block_history_squat_2'").run();
    await renderStats();
    chooseFilter('view-mode', 'Muscle');
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^7$/));
    const real = statsRepository.computeProgressComparisons;
    const old = await real({ periodWeeks: 1 });
    const pending = deferred<typeof old>();
    const read = jest.spyOn(statsRepository, 'computeProgressComparisons').mockImplementation(options =>
      options.gymId === EXERCISE_BLOCK_HISTORY_FIXTURE.gymId ? pending.promise : real(options));
    chooseGym(EXERCISE_BLOCK_HISTORY_FIXTURE.gymId);
    await waitFor(() => expect(read).toHaveBeenCalledWith(expect.objectContaining({ gymId: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId })));
    expect(screen.queryByTestId('stats-muscle-row-quads-now')).toBeNull();
    chooseGym('no-gym');
    await waitFor(() => expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^2$/));
    await act(async () => pending.resolve(old));
    expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^2$/);
  });

  it('shows the empty state on an empty database', async () => {
    await renderStats();

    expect(await screen.findByTestId('stats-exercise-list-empty')).toBeTruthy();
  });

  it('lists the seeded exercises with the 7-day comparison, one metric at a time', async () => {
    await renderSeededStats();

    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    // The period in force against the adjacent previous 7 days of the same
    // fixture, ordered by Now ([[comparison.window]]).
    expect(screen.getByTestId('stats-exercise-sort-now-indicator')).toBeTruthy();
    // A row's own figures, from the same week. The squat warm-up is no working
    // set, so it feeds none of the three metrics.
    expect(screen.getByTestId(`stats-exercise-name-${SQUAT}`)).toHaveTextContent('Barbell Back Squat');
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    expect(screen.queryByTestId(`stats-exercise-sessions-${SQUAT}`)).toBeNull();
    // The earlier week of the same fixture is the baseline, read from the one
    // loaded history: the row's three figures always come from one read.
    expect(screen.getByTestId(SQUAT_ROW).props.accessibilityLabel)
      .toContain('Now 7, previous 2, change +5. working sets.');

    chooseFilter('metric', 'Volume');
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent('7100');
    chooseFilter('metric', '1RM');
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent('320.6');
  });

  it('lists only exercises with a performed set in the period', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);

    expect(screen.queryByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeNull();

    chooseFilter('period', '4 weeks');
    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeTruthy();
  });

  it('sorts by most recent from each exercise’s last completed session', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    await screen.findByTestId('stats-period-chip');
    chooseFilter('period', '4 weeks');
    await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`);

    toggleGroup();
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

  it.each(['Sets', 'Volume'] as const)('counts confirmed in-progress %s in the muscle List and 3D contributions, dated now', async metric => {
    await loadMaestroFixture('exercise-block-history');
    // Started last week: only the date finishing it now would give puts it in this one.
    await startPulldown(8);
    await renderStats();

    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}-now`)).toHaveTextContent(/^1$/);
    expect(screen.getByTestId(`stats-exercise-row-${PULLDOWN}-previous`)).toHaveTextContent(/^0$/);
    chooseFilter('view-mode', 'Muscle');
    chooseFilter('metric', metric);
    const now = metric === 'Sets' ? /^1$/ : /^300$/;
    expect(await screen.findByTestId('stats-muscle-row-back_lats-now')).toHaveTextContent(now);
    expect(screen.getByTestId('stats-muscle-row-back_lats-previous')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('stats-muscle-row-back_lats-now')).toHaveTextContent(now);
    await showBody();
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-back_lats'));
    expect(screen.getByTestId(`stats-contribution-${PULLDOWN}-now`)).toHaveTextContent(now);
    fireEvent.press(screen.getByRole('link', { name: 'Open Lat Pulldown history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${PULLDOWN}&metric=${metric === 'Sets' ? 'sets' : 'volume'}&view=timeline`);
  });

  it('opens the Sessions list from the Sessions card', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-sessions-link'));

    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('shows an error panel when the summary read fails (a failed read)', async () => {
    interceptReads({ 1: [() => Promise.reject(new Error('Summary boom'))] });
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    // The summary feeds the muscle breakdown.
    chooseFilter('view-mode', 'Muscle');
    const error = await screen.findByTestId('stats-error-state');
    expect(error).toHaveTextContent(/Could not load progress/);
    expect(error).not.toHaveTextContent(/Summary boom/);
    expect(screen.getByTestId('stats-retry')).toBeTruthy();
    // The other period's read is its own: it still draws.
    chooseFilter('period', '4 weeks');
    expect(screen.queryByTestId('stats-error-state')).toBeNull();
    expect(screen.getByTestId('stats-muscle-table')).toBeTruthy();
  });

  it.each(['Sets', 'Volume'] as const)('opens all three muscle views with the selected %s metric', async metric => {
    await renderSeededStats();
    chooseFilter('view-mode', 'Muscle');
    await showBody();
    chooseFilter('metric', metric);
    fireEvent.press(await screen.findByTestId('stats-muscle-body-target-quads'));
    for (const view of ['timeline', 'daily', 'weekly'] as const) {
      fireEvent.press(screen.getByTestId(`stats-contributions-view-${view}`));
      expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?muscleGroupId=quads&metric=${metric === 'Sets' ? 'sets' : 'volume'}&secondary=hidden&secondaryVolume=shown&view=${view}`);
      expect(screen.getByTestId('stats-contributions')).toHaveTextContent(/Quads/);
    }
  });

  it('pushes an exercise row’s history page and keeps its own search and sort behind it', async () => {
    await renderSeededStats();
    fireEvent.press(screen.getByTestId('stats-exercise-sort-change'));
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');

    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(mockPush).toHaveBeenCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=sets`);
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();

    // Away while the page is on top, then back: the same screen, as left.
    mockIsFocused = false;
    screen.rerender(<StatsRoute />);
    mockIsFocused = true;
    screen.rerender(<StatsRoute />);
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.getByTestId('stats-exercise-sort-change')).toHaveProp('accessibilityState', { selected: true });
  });

  const renderMuscleList = async () => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
  };
  const select = (id: string) => fireEvent.press(screen.getByTestId(`stats-muscle-select-${id}`));
  const value = (id: string, column: string) => screen.getByTestId(`stats-muscle-row-${id}-${column}`);
  const previous = (id: string) => String(value(id, 'previous').props.children);
  const contribution = (column: string) => screen.getByTestId(`stats-contribution-${SQUAT}-${column}`);

  it('pins every selector and exercise search outside either scroll, with Sessions last even for an empty search', async () => {
    await renderMuscleList();
    const assertPinned = (scrollId: string) => {
      const controls = within(screen.getByTestId('stats-controls'));
      const scroll = within(screen.getByTestId(scrollId));
      const muscle = scrollId === 'stats-scroll';
      // One row of three chips in either breakdown — breakdown, period and the
      // table's metric; exercise search is its own pinned row below it.
      expect(within(screen.getByTestId('stats-view-switch')).getAllByRole('button'))
        .toHaveLength(3);
      const ids = ['stats-view-mode-chip', 'stats-period-chip', 'stats-metric-chip',
        ...(muscle ? [] : ['stats-search-input'])];
      for (const id of ids) {
        expect(controls.getByTestId(id)).toBeTruthy();
        expect(scroll.queryByTestId(id)).toBeNull();
      }
      if (muscle) expect(controls.queryByTestId('stats-search-input')).toBeNull();
      expect(screen.queryByTestId('stats-browse-exercises')).toBeNull();
      const content = scroll.getAllByTestId(
        /^stats-(muscle-table|exercise-list|exercise-list-empty|muscle-body-card|sessions-link)$/
      );
      expect(content.at(-1)).toHaveProp('testID', 'stats-sessions-link');
    };
    assertPinned('stats-scroll');
    chooseFilter('view-mode', 'Exercise');
    assertPinned('stats-exercise-list-scroll');
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'no matching exercise');
    expect(screen.getByTestId('stats-exercise-list-empty')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-view-chip')).toBeNull();
    assertPinned('stats-exercise-list-scroll');
    fireEvent.press(screen.getByTestId('stats-sessions-link'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('opens each visit on Settings\u2019 defaults, never on the last visit\u2019s choices, and lets a deep link override', async () => {
    mockSearchParams = {};
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    chooseFilter('metric', 'Volume');
    chooseFilter('period', 'This week');
    chooseFilter('view-mode', 'Exercise');
    expect(getAccountLocalPreferenceState().values).toMatchObject(
      { progressBreakdown: 'muscle', progressMetric: 'workingSetCount', progressPeriod: 'window' });

    // Relaunch: a cold store, re-read from the device's key-value storage.
    screen.unmount();
    __resetAccountLocalPreferencesForTests();
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Muscle');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');

    // Settings' defaults are what the next visit opens on.
    await act(async () => updatePreferences({ progressBreakdown: 'exercise', progressPeriod: 'this-week',
      progressMetric: 'totalVolume', progressExerciseMetric: 'estimatedOneRepMax' }));
    screen.unmount();
    __resetAccountLocalPreferencesForTests();
    await renderStats();
    await screen.findByTestId('stats-exercise-list-scroll');
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Exercise');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('1RM');
    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');

    // The deep link wins on entry only: the next choice is the user's again.
    screen.unmount();
    __resetAccountLocalPreferencesForTests();
    mockSearchParams = { breakdown: 'muscle', period: '28' };
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Muscle');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
    chooseFilter('period', 'This week');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
  });

  it('replaces this visit\u2019s choice with a Settings default changed while Progress stays mounted', async () => {
    mockSearchParams = {};
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    chooseFilter('metric', 'Volume');
    chooseFilter('period', 'This week');
    // An unrelated default leaves the visit's choices alone.
    await act(async () => updatePreferences({ progressExerciseMetric: 'totalVolume' }));
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    // A changed default drops that field's choice, so the default just set shows.
    await act(async () => updatePreferences({ progressMetric: 'totalVolume' }));
    await act(async () => updatePreferences({ progressMetric: 'workingSetCount' }));
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    await act(async () => updatePreferences({ progressPeriod: 'this-week' }));
    await act(async () => updatePreferences({ progressPeriod: 'window' }));
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
  });

  it('re-enters a mounted Progress on a deep link that changes a param, field by field', async () => {
    mockSearchParams = {};
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    chooseFilter('view-mode', 'Exercise');
    chooseFilter('period', 'This week');

    // Done replaced to a bare /progress; a later boga3://progress?breakdown=muscle
    // lands on the same screen. The breakdown re-enters, the period choice stays.
    mockSearchParams = { breakdown: 'muscle' };
    screen.rerender(<StatsRoute />);
    await screen.findByTestId('stats-muscle-row-quads-now');
    expect(chipValue('view-mode')).toBe('Muscle');
    expect(chipValue('period')).toBe('This week');

    // The same params again are not a new entry: the choice made since stands.
    chooseFilter('view-mode', 'Exercise');
    mockSearchParams = { breakdown: 'muscle' };
    screen.rerender(<StatsRoute />);
    expect(chipValue('view-mode')).toBe('Exercise');

    mockSearchParams = { breakdown: 'muscle', period: '30' };
    screen.rerender(<StatsRoute />);
    expect(chipValue('period')).toBe('4 weeks');
    expect(chipValue('view-mode')).toBe('Exercise');

    // A param going away re-enters too, on the stored breakdown (the chip's
    // last tap) rather than the link's.
    chooseFilter('view-mode', 'Muscle');
    mockSearchParams = { breakdown: 'exercise' };
    screen.rerender(<StatsRoute />);
    expect(chipValue('view-mode')).toBe('Exercise');
    mockSearchParams = {};
    screen.rerender(<StatsRoute />);
    expect(chipValue('view-mode')).toBe('Muscle');
    expect(chipValue('period')).toBe('4 weeks');
  });

  it('shows optional secondary half-credit as whole sets, in the row and the change', async () => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    act(() => updatePreferences({ progressCountSecondary: true }));
    // Quads becomes a secondary mapping, keeping the fixture's real sets
    // (7 now, 2 before) and the production aggregation/rendering path.
    localDataClient().prepare("UPDATE exercise_muscle_mappings SET role = 'secondary' WHERE muscle_group_id = 'quads'").run();
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    // 3.5 and 1 allocated sets, drawn rounded down; the change is between the figures shown.
    expect(value('quads', 'now')).toHaveTextContent(/^3$/);
    expect(previous('quads')).toMatch(/^1$/);
    expect(value('quads', 'change')).toHaveTextContent('+2');
    // The contributor block still reconciles with its muscle row.
    select('quads');
    for (const column of ['now', 'change']) {
      expect(contribution(column).props.children).toBe(value('quads', column).props.children);
    }
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
    chooseFilter('metric', metric === 'workingSetCount' ? 'Sets' : 'Volume');
    const block = screen.getByTestId('stats-contributions');
    expect(within(block).getAllByRole('link', { name: / history$/ })).toHaveLength(2);
    for (const column of ['now', 'previous']) {
      const figures = within(block).getAllByTestId(new RegExp(`^stats-contribution-.+-${column}$`));
      expect(figures.reduce((sum, figure) => sum + Number(figure.props.children), 0))
        .toBe(Number(column === 'previous' ? previous('quads') : value('quads', column).props.children));
    }
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(block).queryByText('Total')).toBeNull();
  });

  it('defaults to the complete taxonomy list and reconciles repeated blocks in both periods', async () => {
    await renderMuscleList();
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.getAllByTestId(/^stats-muscle-select-/)).toHaveLength(25);
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent(/^7$/);
    expect(previous('quads')).toMatch(/^2$/);
    expect(value('quads', 'change')).toHaveTextContent('+5');
    select('quads');
    expect(screen.getAllByTestId(`stats-contribution-${SQUAT}`)).toHaveLength(1);
    for (const column of ['now', 'change']) {
      expect(contribution(column).props.children).toBe(value('quads', column).props.children);
    }
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(screen.getByTestId('stats-contributions')).queryByText('Total')).toBeNull();
    chooseFilter('metric', 'Volume');
    expect(value('quads', 'now')).toHaveTextContent('3550');
    expect(contribution('now')).toHaveTextContent('3550');
    for (const column of ['now', 'change']) {
      expect(contribution(column).props.children).toBe(value('quads', column).props.children);
    }
    const muscleLink = screen.getByRole('link', { name: 'Open Quads history' });
    const exerciseLink = screen.getByRole('link', { name: 'Open Barbell Back Squat history' });
    for (const [link, name] of [[exerciseLink, 'Barbell Back Squat']] as const) {
      expect(link).toHaveStyle({ minWidth: 44, minHeight: 44 });
      expect(within(link).getByText(name)).not.toHaveStyle({ textDecorationLine: 'underline' });
    }
    // Both links push their own page by id, leaving the open block as it is.
    // Volume is the chosen metric here, and both links carry it over.
    fireEvent.press(muscleLink);
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=quads&metric=volume&secondary=hidden&secondaryVolume=shown');
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=volume&view=timeline`);
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
  });

  it('keeps a previous-only contributor and an empty muscle with working history links', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(8);
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await renderStats();
    await screen.findByTestId('stats-muscle-row-back_lats-now');
    expect(value('back_lats', 'now')).toHaveTextContent(/^0$/);
    expect(previous('back_lats')).toMatch(/^1$/);
    expect(value('back_lats', 'change')).toHaveTextContent('−1');
    select('back_lats');
    expect(screen.getByTestId(`stats-contribution-${PULLDOWN}-previous`)).toHaveTextContent(/^1$/);
    expect(screen.queryByTestId('stats-contributions-empty')).toBeNull();
    select('calves');
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No working sets for Calves in either period');
    chooseFilter('metric', 'Volume');
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No volume-included sets for Calves in either period');
    fireEvent.press(screen.getByTestId('stats-muscle-history-calves'));
    // An empty muscle still opens its page; its empty state is that page's.
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=calves&metric=volume&secondary=hidden&secondaryVolume=shown');
  });

  it('uses independent saved eligibility and retains zero-load Volume contributors', async () => {
    await renderMuscleList();
    select('quads');
    await act(async () => updatePreferences({ workingSetEfforts: [], volumeEfforts: ['warm_up'] }));
    await waitFor(() => expect(value('quads', 'now')).toHaveTextContent(/^0$/));
    expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent(/No working sets/);
    chooseFilter('metric', 'Volume');
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

  it('draws the other period from the focus read, with no loading state and no second read', async () => {
    await renderMuscleList();
    select('quads');
    const window = await statsRepository.computeProgressComparisons({ periodWeeks: 4 });
    const windowNow = String(window.muscles.find(row => row.muscleGroupId === 'quads')!.current.workingSetCount);
    const summaryReads = jest.spyOn(statsRepository, 'computeProgressComparisons');
    const historyReads = jest.spyOn(exerciseCatalogStats, 'loadExerciseCatalogStatsRawHistory');
    chooseFilter('period', '4 weeks');
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
    expect(contribution('now')).toHaveTextContent(windowNow);
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
    chooseFilter('period', 'This week');
    expect(contribution('now')).toHaveTextContent('7');
    // A period switch reads nothing: not the summary, not the exercise history.
    await act(async () => {});
    expect(summaryReads).not.toHaveBeenCalled();
    expect(historyReads).not.toHaveBeenCalled();
  });

  it('shows the loading panel and no figures until the read lands', async () => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    const week = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const oneWeek = deferred<typeof week>();
    const window = deferred<typeof week>();
    interceptReads({ 1: [() => oneWeek.promise], 4: [() => window.promise] });
    await renderStats();
    // The delay itself is timed in use-delayed-flag.test.ts; here, on real
    // timers, only that the panel comes and no table is drawn meanwhile.
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    expect(await screen.findByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => oneWeek.resolve(week));
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent('7');
    // The window's read is still out, so its period waits behind the panel.
    chooseFilter('period', '4 weeks');
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    expect(await screen.findByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => window.reject(Error('Window failed')));
    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
  });

  it('keeps selection during Retry and ignores a superseded focus read', async () => {
    await renderMuscleList();
    select('quads');
    const old = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const superseded = deferred<typeof old>();
    interceptReads({ 1: [() => superseded.promise, () => Promise.reject(Error('Refresh failed'))] });
    await replayFocus();
    await replayFocus();
    expect(await screen.findByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    expect(contribution('now')).toHaveTextContent('7');
    // The first focus's read lands last, with figures the newer focus never saw.
    await act(async () => superseded.resolve({ ...old, muscles: old.muscles.map(row => row.muscleGroupId === 'quads'
      ? { ...row, current: { ...row.current, workingSetCount: 99 } } : row) }));
    expect(value('quads', 'now')).toHaveTextContent('7');
    fireEvent.press(screen.getByTestId('stats-retry'));
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
    expect(value('quads', 'now')).toHaveTextContent('7');
    expect(screen.getByTestId('stats-muscle-select-quads')).toHaveProp('accessibilityState', { expanded: true });
  });

  it('retains a same-context snapshot alongside a failed refocus, with an inline Retry', async () => {
    await renderMuscleList();
    select('quads');
    interceptReads({ 1: [() => Promise.reject(Error('Refresh failed'))] });
    await replayFocus();
    expect(await screen.findByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    expect(contribution('now')).toHaveTextContent('7');
    fireEvent.press(screen.getByTestId('stats-retry'));
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
    expect(contribution('now')).toHaveTextContent('7');
  });

  it('refreshes the table and its contributions together after a data edit/refocus', async () => {
    await renderMuscleList();
    select('quads');
    chooseFilter('metric', 'Volume');
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0' WHERE session_exercise_id LIKE '%squat%'").run();
    await replayFocus();
    await waitFor(() => expect(contribution('now')).toHaveTextContent(/^0$/));
    expect(value('quads', 'now')).toHaveTextContent(/^0$/);
  });

  it('hides a superseded policy snapshot and resets selection when accounts change', async () => {
    await renderMuscleList();
    select('quads');
    const old = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const pending = deferred<typeof old>();
    const pendingWindow = deferred<typeof old>();
    interceptReads({ 1: [() => pending.promise], 4: [() => pendingWindow.promise] });
    await act(async () => updatePreferences({ workingSetEfforts: [] }));
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    await act(async () => { mockUserId = 'B'; setAccountLocalPreferenceAccount('B', true); await ensureAccountLocalPreferencesLoaded(); invalidateBodyWeightContext(); });
    screen.rerender(<StatsRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-table')).toBeTruthy());
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    await act(async () => { pending.resolve(old); pendingWindow.resolve(old); });
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent('7');
  });

  it('retains exercise search and sort through muscle browsing', async () => {
    await renderSeededStats();
    fireEvent.press(screen.getByTestId('stats-exercise-sort-change'));
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    chooseFilter('view-mode', 'Muscle');
    chooseFilter('view-mode', 'Exercise');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.getByTestId('stats-exercise-sort-change')).toHaveProp('accessibilityState', { selected: true });
  });

  it('leaves sets whose load cannot be calculated out of Volume, with no coverage note', async () => {
    await renderMuscleList();
    const db = localDataClient();
    db.prepare("INSERT OR REPLACE INTO user_settings (id, bodyweight_calculations_enabled) VALUES ('settings', 1)").run();
    db.prepare('UPDATE exercise_definitions SET bodyweight_contribution = 2 WHERE id = ?').run(SQUAT);
    await replayFocus();
    select('quads');
    chooseFilter('metric', 'Volume');
    // Squat, the only quads lift, is left out in both periods ([[copy.no-inline-explanation]]):
    // a Volume of 0 against 0, never a note or an invented percentage.
    await waitFor(() => expect(contribution('now')).toHaveTextContent('0'));
    expect(value('quads', 'now')).toHaveTextContent('0');
    expect(previous('quads')).toBe('0');
    expect(value('quads', 'change')).toHaveTextContent('—');
    expect(contribution('change')).toHaveTextContent('—');
    expect(screen.queryByText(/incomplete|Known subtotal/i)).toBeNull();
    for (const prefix of ['stats-muscle-row-quads', `stats-contribution-${SQUAT}`]) {
      expect(screen.queryByTestId(`${prefix}-coverage`)).toBeNull();
    }
  });

  // A Volume sum that overflows is unavailable, not zero: the exercise table
  // reads its figures from the same aggregates as the muscle table, so a `—`
  // must survive the mapping into a row ([[copy.no-inline-explanation]]).
  it('keeps an overflowed Volume unavailable in the exercise table', async () => {
    await renderMuscleList();
    const db = localDataClient();
    // The largest Weight the one parser accepts is a plain decimal (no
    // exponent) under `Number.MAX_VALUE`. Each set's own Volume stays finite
    // at one rep; their sum does not, which is what `—` is for.
    const huge = `1${'0'.repeat(308)}`;
    db.prepare("UPDATE exercise_sets SET weight_value = ?, reps_value = '1' WHERE session_exercise_id IN "
      + '(SELECT id FROM session_exercises WHERE exercise_definition_id = ?)').run(huge, SQUAT);
    await replayFocus();
    chooseFilter('view-mode', 'Exercise');
    chooseFilter('metric', 'Volume');
    await waitFor(() => expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent('—'));
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-change`)).toHaveTextContent('—');
  });

});
