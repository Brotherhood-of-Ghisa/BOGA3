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
import { uiSpace, uiRoles } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';

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
  setAccountLocalPreferenceAccount,
} from '@/src/preferences/account-local';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';
import StatsRoute from '../app/(tabs)/stats-history';
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

const showHeatmap = () => {
  if (screen.queryByTestId('stats-muscle-view-chip-list')) fireEvent.press(screen.getByTestId('stats-muscle-view-chip'));
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

// The shared layout is currently supplied through Muscle; its Settings provider is integrated separately.
const showExerciseHeatmap = () => {
  chooseFilter('view-mode', 'Muscle');
  showHeatmap();
  chooseFilter('view-mode', 'Exercise');
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
  it('uses the shared layout for exercise families, keeps history detail, and restores it after 1RM List', async () => {
    await renderSeededStats();
    expect(screen.queryByTestId('stats-exercise-map')).toBeNull();
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    expect(screen.getAllByTestId(/^stats-exercise-family-/)).toHaveLength(7);
    const family = screen.getByTestId('stats-exercise-family-Legs');
    fireEvent.press(family);
    expect(family).toHaveProp('accessibilityState', { selected: true, expanded: true });
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    const tile = () => screen.getByTestId(`stats-exercise-tile-Legs-${SQUAT}`, { includeHiddenElements: true });
    const fill = StyleSheet.flatten(tile().props.style).backgroundColor;
    expect(screen.getByTestId(`stats-exercise-target-${SQUAT}`)).toHaveTextContent('88% target');
    expect(screen.getByTestId(SQUAT_ROW)).toHaveProp('accessibilityLabel', expect.stringContaining('Primary muscle target 88%.'));
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    expect(tile()).toHaveStyle({ backgroundColor: fill });
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=sets`);
    mockIsFocused = false;
    screen.rerender(<StatsRoute />);
    mockIsFocused = true;
    screen.rerender(<StatsRoute />);
    await screen.findByTestId('stats-exercise-map-detail');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    chooseFilter('metric', 'Volume');
    chooseFilter('metric', '1RM');
    expect(screen.queryByTestId('stats-exercise-map')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-view-chip')).toBeNull();
    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    chooseFilter('metric', 'Sets');
    await screen.findByTestId('stats-exercise-map-detail');
    expect(screen.getByTestId('stats-exercise-family-Legs')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-muscle-map')).toBeTruthy();
    chooseFilter('view-mode', 'Exercise');
    expect(screen.getByTestId('stats-exercise-map')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-view-chip')).toBeNull();
  });

  it('keeps exercise map figures and history gym-scoped, with its independent Volume metric', async () => {
    await loadMaestroFixture('exercise-block-history');
    const gym = EXERCISE_BLOCK_HISTORY_FIXTURE.gymId;
    localDataClient().prepare("UPDATE sessions SET gym_id = NULL WHERE id = 'maestro_exercise_block_history_squat_2'").run();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    fireEvent.press(screen.getByTestId('stats-exercise-family-Legs'));
    const tile = () => screen.getByTestId(`stats-exercise-tile-Legs-${SQUAT}`, { includeHiddenElements: true });
    const fill = StyleSheet.flatten(tile().props.style).backgroundColor;
    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId(`stats-gym-option-${gym}`));
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^5$/);
    expect(tile()).toHaveStyle({ backgroundColor: fill });
    chooseFilter('metric', 'Volume');
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=volume&gymId=${gym}`);
    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId('stats-gym-option-no-gym'));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=volume&gymId=no-gym`);
  });

  it('weights Secondary exercise rows, keeps its unfiltered target under search/gym, and opens full history with the selected metric', async () => {
    await loadMaestroFixture('exercise-block-history');
    const gym = EXERCISE_BLOCK_HISTORY_FIXTURE.gymId;
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('secondary_squat_biceps', ?, 'biceps', 0.5, 'secondary')").run(SQUAT);
    localDataClient().prepare("UPDATE sessions SET gym_id = NULL WHERE id IN ('maestro_exercise_block_history_squat_2', 'maestro_exercise_block_history_bench_1')").run();
    // Full per-side exercise Volume is twice its per-muscle Volume, so summing muscle rows would be wrong.
    localDataClient().prepare("UPDATE exercise_definitions SET load_input_mode = 'per_side_load' WHERE id = ?").run(BENCH);
    await act(async () => invalidateExerciseCatalogCache());
    await bootLocalApp();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    fireEvent.press(screen.getByTestId('stats-exercise-family-Arms'));
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^4$/);
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^3.5$/);
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-now`)).toHaveTextContent(/^0.5$/);
    expect(screen.getByTestId('stats-exercise-secondary-target')).toHaveTextContent('25% target');
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}`)).toHaveProp('accessibilityLabel', expect.stringContaining('Secondary muscle target 25%.'));
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}`)).toHaveProp('accessibilityLabel', expect.stringContaining('Secondary contribution.'));
    expect(screen.getByTestId('stats-exercise-secondary-summary').props.onPress).toBeUndefined();
    expect(screen.queryByTestId('stats-exercise-row-Secondary')).toBeNull();
    const tile = () => screen.getByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true });
    const fill = StyleSheet.flatten(tile().props.style).backgroundColor;
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^3.5$/);
    expect(tile()).toHaveStyle({ backgroundColor: fill });
    fireEvent.changeText(screen.getByTestId('stats-search-input'), '');
    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId(`stats-gym-option-${gym}`));
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^2.5$/);
    expect(tile()).toHaveStyle({ backgroundColor: fill });
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Bench');
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('stats-exercise-secondary-target')).toHaveTextContent('25% target');
    expect(screen.queryByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-previous`)).toHaveTextContent(/^0.5$/);
    fireEvent.press(screen.getByTestId(`stats-exercise-row-${BENCH}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${BENCH}&metric=sets&gymId=${gym}`);
    chooseFilter('metric', 'Volume');
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-previous`)).toHaveTextContent(/^1450$/);
    fireEvent.press(screen.getByTestId(`stats-exercise-row-${BENCH}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${BENCH}&metric=volume&gymId=${gym}`);
  });

  it('uses independent working/Volume eligibility for Secondary and keeps a zero Volume contribution readable', async () => {
    await renderSeededStats();
    localDataClient().prepare("UPDATE exercise_sets SET set_type = 'warm_up' WHERE id = 'maestro_exercise_block_history_bench_1_a_work_1'").run();
    await act(async () => updatePreferences({ volumeEfforts: ['warm_up'] }));
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    fireEvent.press(screen.getByTestId('stats-exercise-family-Arms'));
    await waitFor(() => expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^0$/));
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-previous`)).toHaveTextContent(/^0.5$/);
    chooseFilter('metric', 'Volume');
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^620$/);
    expect(screen.getByTestId('stats-exercise-secondary-summary-change')).toHaveTextContent('new');
    expect(screen.getByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: withAlpha(uiRoles.gain, .16) });
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0' WHERE set_type = 'warm_up'").run();
    await replayFocus();
    await waitFor(() => expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent(/^0$/));
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-now`)).toHaveTextContent(/^0$/);
    expect(screen.queryByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toBeNull();
  });

  it('keeps unavailable Secondary aggregate Volume instead of a complete-looking partial sum', async () => {
    await loadMaestroFixture('exercise-block-history');
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('secondary_squat_biceps', ?, 'biceps', 0.5, 'secondary')").run(SQUAT);
    const huge = '9' + '0'.repeat(307);
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = ?, reps_value = '1' WHERE id = 'maestro_exercise_block_history_bench_1_a_work_1'").run(huge);
    localDataClient().prepare("INSERT INTO exercise_sets (id, session_exercise_id, order_index, weight_value, reps_value, set_type) SELECT 'secondary_overflow_extra', session_exercise_id, 1, weight_value, reps_value, set_type FROM exercise_sets WHERE id = 'maestro_exercise_block_history_bench_1_a_work_1'").run();
    await act(async () => invalidateExerciseCatalogCache());
    await bootLocalApp();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    chooseFilter('metric', 'Volume');
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    fireEvent.press(screen.getByTestId('stats-exercise-family-Arms'));
    expect(screen.getByTestId('stats-exercise-secondary-summary-now')).toHaveTextContent('—');
    expect(screen.getByTestId('stats-exercise-secondary-summary-change')).toHaveTextContent('—');
    expect(screen.getByTestId(`stats-exercise-row-${BENCH}-now`)).toHaveTextContent('—');
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).not.toHaveTextContent('—');
    expect(screen.queryByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toBeNull();
  });

  it('waits for the muscle source, reports its failure, and retries before drawing an exercise map', async () => {
    await loadMaestroFixture('exercise-block-history');
    const pending = deferred<Awaited<ReturnType<typeof statsRepository.computeProgressComparisons>>>();
    interceptReads({ 1: [() => pending.promise] });
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    showExerciseHeatmap();
    expect(screen.queryByTestId('stats-exercise-map')).toBeNull();
    await screen.findByTestId('stats-loading-state');
    await act(async () => pending.reject(new Error('muscle read failed')));
    await screen.findByTestId('stats-error-state');
    expect(screen.queryByTestId('stats-exercise-map')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-map-empty')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-retry'));
    await screen.findByTestId('stats-exercise-map');
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
  });

  it('waits for fresh exercise figures when the effort policy changes even after the muscle source is ready', async () => {
    await renderSeededStats();
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    const real = exerciseCatalogStats.loadExerciseCatalogStatsRawHistory;
    const pending = deferred<Awaited<ReturnType<typeof real>>>();
    jest.spyOn(exerciseCatalogStats, 'loadExerciseCatalogStatsRawHistory').mockImplementationOnce(() => pending.promise);
    await act(async () => updatePreferences({ workingSetEfforts: [] }));
    await waitForGone(() => screen.queryByTestId('stats-exercise-map'));
    await screen.findByTestId('stats-loading-state');
    await act(async () => pending.resolve(await real()));
    await screen.findByTestId('stats-exercise-map');
    expect(screen.getByTestId('stats-exercise-map-empty')).toHaveTextContent('No exercises with working sets in either period.');
  });

  it('does not fabricate an empty map on an exercise-history read failure and retries the source', async () => {
    await loadMaestroFixture('exercise-block-history');
    const read = jest.spyOn(exerciseCatalogStats, 'loadExerciseCatalogStatsRawHistory').mockRejectedValue(new Error('exercise read failed'));
    await renderStats();
    showExerciseHeatmap();
    await screen.findByTestId('stats-error-state');
    expect(screen.queryByTestId('stats-exercise-map')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-map-empty')).toBeNull();
    read.mockRestore();
    fireEvent.press(screen.getByTestId('stats-retry'));
    await screen.findByTestId('stats-exercise-map');
    await waitForGone(() => screen.queryByTestId('stats-error-state'));
  });

  it('keeps known zero-volume exercises readable without a fabricated area', async () => {
    await loadMaestroFixture('exercise-block-history');
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0'").run();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    chooseFilter('metric', 'Volume');
    showExerciseHeatmap();
    await screen.findByTestId('stats-exercise-map');
    expect(screen.queryByTestId(`stats-exercise-tile-Legs-${SQUAT}`, { includeHiddenElements: true })).toBeNull();
    fireEvent.press(screen.getByTestId('stats-exercise-family-Legs'));
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent(/^0$/);
    expect(screen.getByTestId(SQUAT_ROW)).toHaveProp('accessibilityLabel', expect.stringContaining('Now 0'));
    fireEvent.press(screen.getByTestId('stats-exercise-family-Core'));
    expect(screen.getByTestId('stats-exercise-list-empty')).toHaveTextContent('No exercises for this family.');
  });

  it('starts in the muscle list, preserves filters and selection when switching, and reopens in the list', async () => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-table');
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
    expect(screen.getByTestId('stats-muscle-view-chip-list')).toHaveTextContent('List');
    expect(screen.getAllByTestId(/^stats-muscle-select-/)).toHaveLength(25);
    chooseFilter('metric', 'Volume');
    fireEvent.press(screen.getByTestId('stats-muscle-select-quads'));
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent('3550');
    fireEvent.press(screen.getByTestId('stats-muscle-view-chip'));
    expect(screen.getByTestId('stats-muscle-map')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    fireEvent.press(screen.getByTestId('stats-contributions-view-daily'));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=quads&metric=volume&view=daily');
    mockIsFocused = false;
    screen.rerender(<StatsRoute />);
    mockIsFocused = true;
    screen.rerender(<StatsRoute />);
    expect(screen.getByTestId('stats-muscle-map')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-view-chip'));
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
    expect(within(screen.getByTestId('stats-muscle-block-quads')).getByTestId('stats-contributions')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-muscle-select-quads'));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    showHeatmap();
    screen.unmount();
    await renderStats();
    await screen.findByTestId('stats-muscle-table');
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
  });

  it.each(['Sets', 'Volume'] as const)('keeps list history and inline contributors on the selected %s metric', async metric => {
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-table');
    chooseFilter('metric', metric);
    fireEvent.press(screen.getByTestId('stats-muscle-history-quads'));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?muscleGroupId=quads&metric=${metric === 'Sets' ? 'sets' : 'volume'}`);
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
    expect(screen.getByTestId('stats-gym')).toHaveTextContent('All gyms');
    expect(squatNow()).toHaveTextContent(/^7$/);

    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId(`stats-gym-option-${gym}`));
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    expect(screen.getByTestId('stats-gym')).toHaveTextContent('Maestro Block History Gym');
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).toContain(`exerciseDefinitionId=${SQUAT}`);
    expect(String(mockPush.mock.lastCall?.[0])).toContain(`gymId=${gym}`);

    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId('stats-gym-option-no-gym'));
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^2$/));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).toContain('gymId=no-gym');

    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId('stats-gym-option-all'));
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^7$/));
    fireEvent.press(screen.getByTestId(SQUAT_ROW));
    expect(String(mockPush.mock.lastCall?.[0])).not.toContain('gymId=');
    fireEvent.press(screen.getByTestId('stats-gym'));
    fireEvent.press(screen.getByTestId(`stats-gym-option-${gym}`));
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    // Both muscle layouts keep the whole exercise despite the Exercise gym filter.
    chooseFilter('view-mode', 'Muscle');
    expect(screen.queryByTestId('stats-gym')).toBeNull();
    expect(await screen.findByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^7$/);
    showHeatmap();
    expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent(/^7$/);
    fireEvent.press(screen.getByTestId('stats-muscle-tile-quads'));
    expect(screen.getByTestId(`stats-contribution-${SQUAT}-now`)).toHaveTextContent(/^7$/);
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=sets&view=timeline`);
    chooseFilter('view-mode', 'Exercise');
    expect(screen.getByTestId('stats-exercise-map')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-exercise-family-Legs'));
    await waitFor(() => expect(squatNow()).toHaveTextContent(/^5$/));
    expect(screen.getByTestId('stats-gym')).toHaveTextContent('Maestro Block History Gym');
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

  it.each(['Sets', 'Volume'] as const)('counts confirmed in-progress %s in both muscle layouts, dated now', async metric => {
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
    showHeatmap();
    expect(screen.getByTestId('stats-muscle-row-back_lats-now')).toHaveTextContent(now);
    fireEvent.press(screen.getByTestId('stats-muscle-tile-back_lats'));
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

  it('fills unused muscle tiles red while preserving delta ink and contribution selection', async () => {
    await renderSeededStats();
    chooseFilter('view-mode', 'Muscle');
    showHeatmap();
    for (const metric of ['workingSetCount', 'totalVolume']) {
      chooseFilter('metric', metric === 'workingSetCount' ? 'Sets' : 'Volume');
      expect(screen.getByTestId('stats-muscle-row-calves')).toHaveStyle({ backgroundColor: withAlpha(uiRoles.loss, 0.16) });
      expect(screen.getByTestId('stats-muscle-row-calves-now')).toHaveTextContent(/^0$/);
      expect(screen.getByTestId('stats-muscle-row-calves-change')).toHaveStyle({ color: uiRoles.ink });
      expect(screen.queryAllByLabelText(/Colour:/)).toEqual([]);
    }
    fireEvent.press(screen.getByTestId('stats-muscle-tile-chest'));
    expect(screen.getByTestId('stats-contributions')).toHaveTextContent(/Chest/);
    expect(screen.getByTestId('stats-muscle-tile-chest')).toHaveProp('accessibilityState', { selected: true, expanded: true });
  });

  it.each(['Sets', 'Volume'] as const)('opens all three muscle views with the selected %s metric', async metric => {
    await renderSeededStats();
    chooseFilter('view-mode', 'Muscle');
    showHeatmap();
    chooseFilter('metric', metric);
    fireEvent.press(await screen.findByTestId('stats-muscle-tile-quads'));
    for (const view of ['timeline', 'daily', 'weekly'] as const) {
      fireEvent.press(screen.getByTestId(`stats-contributions-view-${view}`));
      expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?muscleGroupId=quads&metric=${metric === 'Sets' ? 'sets' : 'volume'}&view=${view}`);
      expect(screen.getByTestId('stats-contributions')).toHaveTextContent(/Quads/);
    }
  });

  it('keeps seeded families inert and opens only an individual muscle', async () => {
    await renderSeededStats();

    chooseFilter('view-mode', 'Muscle');
    showHeatmap();
    fireEvent.press(await screen.findByTestId('stats-family-header-legs'));
    fireEvent.press(screen.getByTestId('stats-family-header-chest'));
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('stats-muscle-tile-quads'));
    fireEvent.press(screen.getByTestId('stats-muscle-tile-quads'));
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-contributions-view-timeline'));
    // The link carries the filter row's metric, so the page opens on it.
    expect(mockPush).toHaveBeenCalledWith('/progress-history?muscleGroupId=quads&metric=sets&view=timeline');
    // The page draws the history: Progress never does.
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
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

  const renderMuscleMap = async () => {
    mockSearchParams = { period: '7' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    showHeatmap();
  };
  const select = (id: string) => fireEvent.press(screen.getByTestId(`stats-muscle-tile-${id}`));
  const value = (id: string, column: string) => screen.getByTestId(`stats-muscle-row-${id}-${column}`);
  const previous = (id: string) => screen.getByTestId(`stats-muscle-tile-${id}`).props.accessibilityLabel.match(/previous (.*?), change/)[1] as string;
  const contribution = (column: string) => screen.getByTestId(`stats-contribution-${SQUAT}-${column}`);

  it('pins every selector and exercise search outside either scroll, with Sessions last even for an empty search', async () => {
    await renderMuscleMap();
    const assertPinned = (scrollId: string) => {
      const controls = within(screen.getByTestId('stats-controls'));
      const scroll = within(screen.getByTestId(scrollId));
      const muscle = scrollId === 'stats-scroll';
      // One row of three chips in either breakdown — breakdown, period and the
      // table's metric; exercise search is its own pinned row below it.
      expect(within(screen.getByTestId('stats-view-switch')).getAllByRole('button'))
        .toHaveLength(3);
      const ids = ['stats-view-mode-chip', 'stats-period-chip', 'stats-metric-chip',
        ...(muscle ? ['stats-muscle-view-chip'] : ['stats-search-input'])];
      for (const id of ids) {
        expect(controls.getByTestId(id)).toBeTruthy();
        expect(scroll.queryByTestId(id)).toBeNull();
      }
      if (muscle) expect(controls.queryByTestId('stats-search-input')).toBeNull();
      expect(screen.queryByTestId('stats-browse-exercises')).toBeNull();
      const content = scroll.getAllByTestId(
        /^stats-(muscle-table|exercise-list|exercise-list-empty|exercise-map|exercise-map-empty|sessions-link)$/
      );
      expect(content.at(-1)).toHaveProp('testID', 'stats-sessions-link');
    };
    assertPinned('stats-scroll');
    chooseFilter('view-mode', 'Exercise');
    assertPinned('stats-exercise-list-scroll');
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'no matching exercise');
    expect(screen.getByTestId('stats-exercise-map-empty')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-view-chip')).toBeNull();
    assertPinned('stats-exercise-list-scroll');
    fireEvent.press(screen.getByTestId('stats-sessions-link'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('reopens on the last visit\u2019s breakdown and metric, on the configured period, and lets a deep link override', async () => {
    mockSearchParams = {};
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    showHeatmap();
    chooseFilter('metric', 'Volume');
    chooseFilter('period', 'This week');
    chooseFilter('view-mode', 'Exercise');

    // Relaunch: a cold store, re-read from the device's key-value storage.
    screen.unmount();
    __resetAccountLocalPreferencesForTests();
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Exercise');
    // The period is not remembered: every visit opens on Settings' Progress
    // period, so the week chosen above is gone.
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
    chooseFilter('view-mode', 'Muscle');
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');

    // The deep link wins on entry only: the next choice is the user's again.
    screen.unmount();
    __resetAccountLocalPreferencesForTests();
    mockSearchParams = { breakdown: 'exercise', period: '7' };
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Exercise');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    chooseFilter('view-mode', 'Muscle');
    chooseFilter('period', '4 weeks');
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('4 weeks');
  });

  it('re-enters a mounted Progress on a deep link that changes a param, field by field', async () => {
    mockSearchParams = {};
    await loadMaestroFixture('exercise-block-history');
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    showHeatmap();
    chooseFilter('view-mode', 'Exercise');
    chooseFilter('period', 'This week');

    // Done replaced to a bare /progress; a later boga3://progress?breakdown=muscle
    // lands on the same screen. The breakdown re-enters, the period choice stays.
    mockSearchParams = { breakdown: 'muscle' };
    screen.rerender(<StatsRoute />);
    await screen.findByTestId('stats-muscle-row-quads-now');
    showHeatmap();
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

  it('reveals one contribution table and leaves repeated tile activations in Progress', async () => {
    await renderMuscleMap();
    const map = screen.getByTestId('stats-muscle-map');
    const size = StyleSheet.flatten(map.props.style);
    select('quads');
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    expect(screen.getAllByTestId('stats-contributions')).toHaveLength(1);
    expect(screen.getByTestId('stats-contributions')).toHaveTextContent(/Quads/);
    expect(StyleSheet.flatten(map.props.style)).toEqual(size);
    select('chest');
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: false, expanded: false });
    expect(screen.getByTestId('stats-contributions')).toHaveTextContent(/Chest/);
    select('chest');
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-contributions-view-timeline'));
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=chest&metric=sets&view=timeline');
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
  });

  it('shows a secondary muscle its half-steps unrounded, in the row and the change', async () => {
    mockSearchParams = { period: '7' };
    await loadMaestroFixture('exercise-block-history');
    // Quads becomes a secondary mapping, keeping the fixture's real sets
    // (7 now, 2 before) and the production aggregation/rendering path.
    localDataClient().prepare("UPDATE exercise_muscle_mappings SET role = 'secondary' WHERE muscle_group_id = 'quads'").run();
    await renderStats();
    await screen.findByTestId('stats-muscle-row-quads-now');
    showHeatmap();

    expect(value('quads', 'now')).toHaveTextContent(/^3\.5$/);
    expect(previous('quads')).toMatch(/^1$/);
    expect(value('quads', 'change')).toHaveTextContent('+2.5');
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
    showHeatmap();
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

  it('refreshes the muscle-map target from Settings and scales it with the period', async () => {
    await renderMuscleMap();
    const label = () => screen.getByTestId('stats-muscle-tile-quads').props.accessibilityLabel;
    const tile = () => screen.getByTestId('stats-muscle-row-quads');
    expect(label()).toContain('Target 8 working sets for this period.');
    expect(tile()).toHaveStyle({ backgroundColor: HEAT_RAMP[4] });
    await act(async () => updatePreferences({ weeklyWorkingSetTarget: 16 }));
    await waitFor(() => expect(label()).toContain('Target 16 working sets for this period.'));
    expect(tile()).toHaveStyle({ backgroundColor: HEAT_RAMP[2] });
    chooseFilter('period', '4 weeks');
    expect(label()).toContain('Target 64 working sets for this period.');
    expect(tile()).toHaveStyle({ backgroundColor: HEAT_RAMP[1] });
    await act(async () => updatePreferences({ weeklyWorkingSetTarget: 4 }));
    await waitFor(() => expect(label()).toContain('Target 16 working sets for this period.'));
    expect(tile()).toHaveStyle({ backgroundColor: HEAT_RAMP[3] });
  });

  it('defaults to the complete taxonomy map and reconciles repeated blocks in both periods', async () => {
    await renderMuscleMap();
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.getAllByTestId(/^stats-muscle-tile-/)).toHaveLength(25);
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
    const muscleLink = screen.getByRole('link', { name: 'Open Quads Timeline' });
    const exerciseLink = screen.getByRole('link', { name: 'Open Barbell Back Squat history' });
    expect(muscleLink.props.hitSlop).toBe(uiSpace.md);
    for (const [link, name] of [[exerciseLink, 'Barbell Back Squat']] as const) {
      expect(link).toHaveStyle({ minWidth: 44, minHeight: 44 });
      expect(within(link).getByText(name)).not.toHaveStyle({ textDecorationLine: 'underline' });
    }
    // Both links push their own page by id, leaving the open block as it is.
    // Volume is the chosen metric here, and both links carry it over.
    fireEvent.press(muscleLink);
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=quads&metric=volume&view=timeline');
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    fireEvent.press(screen.getByRole('link', { name: 'Open Barbell Back Squat history' }));
    expect(mockPush).toHaveBeenLastCalledWith(`/progress-history?exerciseDefinitionId=${SQUAT}&metric=volume&view=timeline`);
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
  });

  it('keeps a previous-only contributor and an empty muscle with working history links', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(8);
    mockSearchParams = { period: '7', breakdown: 'muscle' };
    await renderStats();
    await screen.findByTestId('stats-muscle-row-back_lats-now');
    showHeatmap();
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
    fireEvent.press(screen.getByTestId('stats-contributions-view-timeline'));
    // An empty muscle still opens its page; its empty state is that page's.
    expect(mockPush).toHaveBeenLastCalledWith('/progress-history?muscleGroupId=calves&metric=volume&view=timeline');
  });

  it('uses independent saved eligibility and retains zero-load Volume contributors', async () => {
    await renderMuscleMap();
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
    await renderMuscleMap();
    select('quads');
    const window = await statsRepository.computeProgressComparisons({ periodWeeks: 4 });
    const windowNow = String(window.muscles.find(row => row.muscleGroupId === 'quads')!.current.workingSetCount);
    const summaryReads = jest.spyOn(statsRepository, 'computeProgressComparisons');
    const historyReads = jest.spyOn(exerciseCatalogStats, 'loadExerciseCatalogStatsRawHistory');
    chooseFilter('period', '4 weeks');
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
    expect(contribution('now')).toHaveTextContent(windowNow);
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
    chooseFilter('period', 'This week');
    expect(contribution('now')).toHaveTextContent('7');
    // A period switch reads nothing: not the summary, not the exercise history.
    await act(async () => {});
    expect(summaryReads).not.toHaveBeenCalled();
    expect(historyReads).not.toHaveBeenCalled();
  });

  it('shows the loading panel and no figures until the read lands', async () => {
    mockSearchParams = { period: '7' };
    await loadMaestroFixture('exercise-block-history');
    const week = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const oneWeek = deferred<typeof week>();
    const window = deferred<typeof week>();
    interceptReads({ 1: [() => oneWeek.promise], 4: [() => window.promise] });
    await renderStats();
    // The delay itself is timed in use-delayed-flag.test.ts; here, on real
    // timers, only that the panel comes and no table is drawn meanwhile.
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
    expect(await screen.findByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => oneWeek.resolve(week));
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
    expect(value('quads', 'now')).toHaveTextContent('7');
    // The window's read is still out, so its period waits behind the panel.
    chooseFilter('period', '4 weeks');
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
    expect(await screen.findByTestId('stats-loading-state')).toBeTruthy();
    await act(async () => window.reject(Error('Window failed')));
    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Could not load progress/);
    expect(screen.queryByTestId('stats-loading-state')).toBeNull();
  });

  it('keeps selection during Retry and ignores a superseded focus read', async () => {
    await renderMuscleMap();
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
    expect(screen.getByTestId('stats-muscle-tile-quads')).toHaveProp('accessibilityState', { selected: true, expanded: true });
  });

  it('retains a same-context snapshot alongside a failed refocus, with an inline Retry', async () => {
    await renderMuscleMap();
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
    await renderMuscleMap();
    select('quads');
    chooseFilter('metric', 'Volume');
    localDataClient().prepare("UPDATE exercise_sets SET weight_value = '0' WHERE session_exercise_id LIKE '%squat%'").run();
    await replayFocus();
    await waitFor(() => expect(contribution('now')).toHaveTextContent(/^0$/));
    expect(value('quads', 'now')).toHaveTextContent(/^0$/);
  });

  it('hides a superseded policy snapshot and resets selection when accounts change', async () => {
    await renderMuscleMap();
    select('quads');
    const old = await statsRepository.computeProgressComparisons({ periodWeeks: 1 });
    const pending = deferred<typeof old>();
    const pendingWindow = deferred<typeof old>();
    interceptReads({ 1: [() => pending.promise], 4: [() => pendingWindow.promise] });
    await act(async () => updatePreferences({ workingSetEfforts: [] }));
    expect(screen.queryByTestId('stats-muscle-map')).toBeNull();
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
    await renderMuscleMap();
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
    await renderMuscleMap();
    const db = localDataClient();
    // The largest Weight the one parser accepts is a plain decimal (no
    // exponent) under `Number.MAX_VALUE`. Each set's own Volume stays finite
    // at one rep; their sum does not, which is what `—` is for.
    const huge = `1${'0'.repeat(308)}`;
    db.prepare("UPDATE exercise_sets SET weight_value = ?, reps_value = '1' WHERE session_exercise_id IN "
      + '(SELECT id FROM session_exercises WHERE exercise_definition_id = ?)').run(huge, SQUAT);
    await replayFocus();
    chooseFilter('view-mode', 'Exercise');
    fireEvent.press(screen.getByTestId('stats-exercise-family-Legs'));
    chooseFilter('metric', 'Volume');
    await waitFor(() => expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-now`)).toHaveTextContent('—'));
    expect(screen.getByTestId(`stats-exercise-row-${SQUAT}-change`)).toHaveTextContent('—');
  });

});
