import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  computeFailureIntensityProgress,
  type StatsScreenShellProps,
  formatCountDelta,
  formatSetCountPairDelta,
  formatVolumeDelta,
  sortExerciseListItems,
} from '../(tabs)/stats-history';
import { uiColors } from '@/components/ui';
import type { SelectedMuscleWeeklyEffort, StatsSummary } from '@/src/data';

jest.mock('@/src/data', () => ({
  computeSelectedExerciseWeeklyEffort: jest.fn(),
  computeSelectedExerciseDailyEffort: jest.fn(() => Promise.resolve([])),
  computeSelectedMuscleWeeklyEffort: jest.fn(),
  computeSelectedMuscleDailyEffortMetrics: jest.fn(() => Promise.resolve([])),
  computeStatsSummary: jest.fn(),
}));

jest.mock('@/src/exercise-catalog/cache', () => ({
  useExerciseCatalog: jest.fn(() => ({
    status: 'ready',
    exercises: [],
    muscleGroups: [],
    muscleGroupsById: {},
    lastError: null,
  })),
}));

jest.mock('@/src/exercise-catalog/stats-cache', () => {
  const reload = jest.fn();
  return {
    __reload: reload,
    useExerciseCatalogStats: jest.fn(() => ({
      status: 'ready',
      stats: { aggregatesById: new Map(), everDoneIds: new Set(), lastCompletedAtById: new Map() },
      lastError: null,
      reload,
    })),
  };
});

jest.mock('expo-router', () => {
  const mockPush = jest.fn();
  let latestFocusCallback: (() => void) | null = null;

  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => {
      latestFocusCallback = callback;
    },
    __mockPush: mockPush,
    __triggerFocus: () => {
      latestFocusCallback?.();
    },
  };
});

const {
  computeSelectedExerciseWeeklyEffort: mockComputeSelectedExerciseWeeklyEffort,
  computeSelectedExerciseDailyEffort: mockComputeSelectedExerciseDailyEffort,
  computeSelectedMuscleWeeklyEffort: mockComputeSelectedMuscleWeeklyEffort,
  computeSelectedMuscleDailyEffortMetrics: mockComputeSelectedMuscleDailyEffortMetrics,
  computeStatsSummary: mockComputeStatsSummary,
} = jest.requireMock('@/src/data') as {
  computeSelectedExerciseWeeklyEffort: jest.Mock;
  computeSelectedExerciseDailyEffort: jest.Mock;
  computeSelectedMuscleWeeklyEffort: jest.Mock;
  computeSelectedMuscleDailyEffortMetrics: jest.Mock;
  computeStatsSummary: jest.Mock;
};

const { __mockPush: mockPush, __triggerFocus: triggerFocus } = jest.requireMock(
  'expo-router'
) as { __mockPush: jest.Mock; __triggerFocus: () => void };

const { __reload: mockReloadExerciseCatalogStats } = jest.requireMock(
  '@/src/exercise-catalog/stats-cache'
) as { __reload: jest.Mock };

const buildSummary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
  current: {
    period: {
      days: 7,
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: new Date('2026-05-19T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 4,
      setCount: 50,
      workingSetCount: 38,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          setCount: 12,
          nearFailureCount: 3,
          totalVolume: 1800,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              setCount: 12,
              nearFailureCount: 3,
              totalVolume: 1800,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          setCount: 10,
          nearFailureCount: 4,
          totalVolume: 900,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              setCount: 8,
              nearFailureCount: 4,
              totalVolume: 600,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              setCount: 2,
              nearFailureCount: 0,
              totalVolume: 300,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          setCount: 0,
          nearFailureCount: 0,
          totalVolume: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              setCount: 0,
              nearFailureCount: 0,
              totalVolume: 0,
            },
          ],
        },
      ],
    },
  },
  previous: {
    period: {
      days: 7,
      start: new Date('2026-05-05T15:00:00.000Z'),
      end: new Date('2026-05-12T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 3,
      setCount: 40,
      workingSetCount: 30,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          setCount: 8,
          nearFailureCount: 2,
          totalVolume: 1500,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              setCount: 8,
              nearFailureCount: 2,
              totalVolume: 1500,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          setCount: 8,
          nearFailureCount: 3,
          totalVolume: 600,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              setCount: 6,
              nearFailureCount: 3,
              totalVolume: 400,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              setCount: 2,
              nearFailureCount: 0,
              totalVolume: 200,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          setCount: 0,
          nearFailureCount: 0,
          totalVolume: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              setCount: 0,
              nearFailureCount: 0,
              totalVolume: 0,
            },
          ],
        },
      ],
    },
  },
  ...overrides,
});

beforeEach(() => {
  mockComputeSelectedExerciseWeeklyEffort.mockReset();
  mockComputeSelectedExerciseDailyEffort.mockReset().mockResolvedValue([]);
  mockComputeSelectedMuscleWeeklyEffort.mockReset();
  mockComputeSelectedMuscleDailyEffortMetrics.mockReset().mockResolvedValue([]);
  mockComputeStatsSummary.mockReset();
  mockPush.mockReset();
  mockReloadExerciseCatalogStats.mockClear();
});

const buildShellProps = (
  overrides: Partial<StatsScreenShellProps> = {}
): StatsScreenShellProps => ({
  summary: buildSummary(),
  periodDays: 7,
  onSelectPeriod: jest.fn(),
  onPressSessionsCard: jest.fn(),
  onPressMuscleHistory: jest.fn(),
  onDismissMuscleHistory: jest.fn(),
  onSelectMuscleHistoryWeek: jest.fn(),
  isLoading: false,
  errorMessage: null,
  selectedMuscle: null,
  muscleHistoryWeeklyEffort: [],
  muscleHistoryDailyMetrics: [],
  isMuscleHistoryLoading: false,
  muscleHistoryErrorMessage: null,
  selectedMuscleHistoryWeekKey: null,
  muscleHistoryMetric: 'totalVolume',
  muscleHistoryView: 'weekly',
  onSelectMuscleHistoryMetric: jest.fn(),
  onSelectMuscleHistoryView: jest.fn(),
  viewMode: 'muscle',
  onSelectViewMode: jest.fn(),
  exerciseListItems: [],
  selectedExercise: null,
  exerciseHistoryWeeklyEffort: [],
  exerciseHistoryDailyMetrics: [],
  isExerciseHistoryLoading: false,
  exerciseHistoryErrorMessage: null,
  selectedExerciseHistoryWeekKey: null,
  exerciseHistoryMetric: 'totalVolume',
  exerciseHistoryView: 'weekly',
  onPressExerciseHistory: jest.fn(),
  onDismissExerciseHistory: jest.fn(),
  onSelectExerciseHistoryWeek: jest.fn(),
  onSelectExerciseHistoryMetric: jest.fn(),
  onSelectExerciseHistoryView: jest.fn(),
  historyTodayDateKey: '2026-06-05',
  searchQuery: '',
  onSearchQueryChange: jest.fn(),
  ...overrides,
});

const renderStatsScreenShell = (overrides: Partial<StatsScreenShellProps> = {}) =>
  render(<StatsScreenShell {...buildShellProps(overrides)} />);

const buildWeeklyEffort = (): SelectedMuscleWeeklyEffort => ({
  weekStartDateKey: '2026-05-11',
  monthKey: '2026-05',
  weekOfMonth: 2,
  totalVolume: 1100,
  workingSetCount: 2,
  estimatedRM1: 150,
  highestWeight: 120,
});

const captureUiEvidence = (name: string, tree: unknown) => {
  const evidenceDir = process.env.UI_EVIDENCE_DIR;
  if (!evidenceDir) return;

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, `${name}.json`), JSON.stringify(tree, null, 2));
};

describe('formatCountDelta', () => {
  it('renders an absolute neutral delta when both periods are equal', () => {
    expect(formatCountDelta(0, 0)).toEqual({ text: '±0', tone: 'neutral' });
  });

  it('renders only the absolute increase when the previous count was zero', () => {
    expect(formatCountDelta(4, 0)).toEqual({ text: '+4', tone: 'positive' });
  });

  it('renders positive and negative count deltas without percentages', () => {
    expect(formatCountDelta(8, 6)).toEqual({ text: '+2', tone: 'positive' });
    expect(formatCountDelta(3, 6)).toEqual({ text: '−3', tone: 'negative' });
  });
});

describe('stats row metric formatters', () => {
  it('formats positive, negative, mixed, and unchanged set-count pairs as absolute changes', () => {
    expect(formatSetCountPairDelta(12, 3, 8, 2)).toEqual({
      text: '+4 (+1)',
      tone: 'positive',
    });
    expect(formatSetCountPairDelta(6, 1, 8, 2)).toEqual({
      text: '−2 (−1)',
      tone: 'negative',
    });
    expect(formatSetCountPairDelta(8, 1, 8, 2)).toEqual({
      text: '±0 (−1)',
      tone: 'negative',
    });
    expect(formatSetCountPairDelta(8, 2, 8, 2)).toEqual({
      text: '±0 (±0)',
      tone: 'neutral',
    });
  });

  it('formats volume as percentage-only change with explicit zero baselines', () => {
    expect(formatVolumeDelta(0, 0)).toEqual({ text: '—', tone: 'neutral' });
    expect(formatVolumeDelta(100, 0)).toEqual({ text: 'new', tone: 'new' });
    expect(formatVolumeDelta(0, 100)).toEqual({ text: '−100%', tone: 'negative' });
    expect(formatVolumeDelta(100, 100)).toEqual({ text: '±0%', tone: 'neutral' });
    expect(formatVolumeDelta(117, 100)).toEqual({ text: '+17%', tone: 'positive' });
  });
});

describe('computeFailureIntensityProgress', () => {
  it.each([
    [0, 7, 0],
    [4, 7, 0.5],
    [8, 7, 1],
    [9, 7, 1],
    [8, 30, 8 / (240 / 7)],
    [34, 30, 34 / (240 / 7)],
    [35, 30, 1],
  ] as const)('scales %s failures across %s days', (failures, days, expected) => {
    expect(computeFailureIntensityProgress(failures, days)).toBeCloseTo(expected, 6);
  });

  it('defensively clamps negative and non-finite values to zero', () => {
    expect(computeFailureIntensityProgress(-1, 7)).toBe(0);
    expect(computeFailureIntensityProgress(Number.NaN, 7)).toBe(0);
    expect(computeFailureIntensityProgress(Number.POSITIVE_INFINITY, 7)).toBe(0);
  });
});

describe('sortExerciseListItems', () => {
  it('sorts by set count descending with exercise name as the tie-breaker', () => {
    const sorted = sortExerciseListItems([
      { id: 'z', name: 'Z Press', setCount: 4, nearFailureCount: 1, totalVolume: 10, estimatedOneRepMax: null },
      { id: 'b', name: 'Bench Press', setCount: 7, nearFailureCount: 2, totalVolume: 10, estimatedOneRepMax: null },
      { id: 'a', name: 'Arnold Press', setCount: 4, nearFailureCount: 0, totalVolume: 10, estimatedOneRepMax: null },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['b', 'a', 'z']);
  });
});

describe('StatsScreenShell', () => {
  it('renders summary cards with absolute count deltas only', () => {
    renderStatsScreenShell();

    const sessionsCard = screen.getByTestId('stats-card-sessions');
    expect(sessionsCard).toHaveTextContent(/Sessions/);
    expect(sessionsCard).toHaveTextContent(/4/);
    expect(sessionsCard).toHaveTextContent(/\+1/);
    expect(sessionsCard).not.toHaveTextContent('%');

    const setsCard = screen.getByTestId('stats-card-sets');
    expect(setsCard).toHaveTextContent(/Sets \(W\/Sets\)/i);
    expect(setsCard).toHaveTextContent(/50 \(38\)/);
    expect(setsCard).toHaveTextContent(/\+10 \(\+8\)/);
    expect(setsCard).not.toHaveTextContent('%');
  });

  it('renders family and muscle rows with set/failure counts and percentage-only volume deltas', () => {
    renderStatsScreenShell();

    const shouldersSets = screen.getByTestId('stats-family-sets-shoulders');
    expect(shouldersSets).toHaveTextContent(/10 \(4\)/);
    expect(shouldersSets).toHaveTextContent(/\+2 \(\+1\)/);
    expect(shouldersSets).not.toHaveTextContent('%');

    const shouldersVolume = screen.getByTestId('stats-family-volume-shoulders');
    expect(shouldersVolume).toHaveTextContent(/900/);
    expect(shouldersVolume).toHaveTextContent(/\+50%/);
    expect(shouldersVolume).not.toHaveTextContent('+300');

    // Nested muscle row also carries its own delta.
    const frontDeltsSets = screen.getByTestId('stats-muscle-sets-front_delts');
    expect(frontDeltsSets).toHaveTextContent(/8 \(4\)/);
    expect(frontDeltsSets).toHaveTextContent(/\+2 \(\+1\)/);

    expect(screen.queryByText('Total weight')).toBeNull();
    expect(screen.queryByTestId('stats-family-sessions-shoulders')).toBeNull();
    expect(screen.queryByTestId('stats-muscle-sessions-front_delts')).toBeNull();
  });

  it('colours each trained family and muscle row with one uniform failure shade', () => {
    const { rerender } = render(
      <StatsScreenShell {...buildShellProps({ periodDays: 7, viewMode: 'muscle' })} />
    );

    expect(screen.getByTestId('stats-family-header-shoulders')).toHaveStyle({
      backgroundColor: uiColors.failureBackgroundFamily2,
    });
    expect(screen.getByTestId('stats-muscle-row-front_delts')).toHaveStyle({
      backgroundColor: uiColors.failureBackgroundMuscle2,
    });
    expect(
      screen.queryByTestId(/failure-bar/, { includeHiddenElements: true })
    ).toBeNull();

    rerender(
      <StatsScreenShell {...buildShellProps({ periodDays: 30, viewMode: 'muscle' })} />
    );
    expect(screen.getByTestId('stats-family-header-shoulders')).toHaveStyle({
      backgroundColor: uiColors.failureBackgroundFamily1,
    });

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          periodDays: 7,
          viewMode: 'exercise',
          exerciseListItems: [
            {
              id: 'bench',
              name: 'Bench Press',
              setCount: 8,
              nearFailureCount: 4,
              totalVolume: 1000,
              estimatedOneRepMax: 100,
            },
          ],
        })}
      />
    );
    expect(
      screen.queryByTestId(/failure-bar/, { includeHiddenElements: true })
    ).toBeNull();
  });

  it('exposes set counts, deltas, and background intensity scale in row accessibility labels', () => {
    renderStatsScreenShell();

    expect(screen.getByTestId('stats-family-header-shoulders').props.accessibilityLabel).toContain(
      '10 sets, 4 near-failure sets. up 2 sets and up 1 near-failure sets'
    );
    expect(screen.getByTestId('stats-family-header-shoulders').props.accessibilityLabel).toContain(
      'strongest shade at 8 near-failure sets for the selected 7-day period'
    );
    expect(screen.getByTestId('stats-muscle-row-front_delts').props.accessibilityLabel).toContain(
      '8 sets, 4 near-failure sets'
    );
  });

  it('collapses a family whose only muscle matches the family name', () => {
    renderStatsScreenShell();

    // Chest contains only one muscle named "Chest" — the nested row must be hidden.
    expect(screen.getByTestId('stats-family-card-chest')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-row-chest')).toBeNull();

    // Shoulders has multiple muscles → nested rows still render.
    expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-rear_delts')).toBeTruthy();

    // Untrained family with a single non-matching muscle still expands.
    expect(screen.getByTestId('stats-family-card-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-calves')).toHaveTextContent(/Calves/);
  });

  it('invokes onSelectPeriod when switching period chips', () => {
    const onSelectPeriod = jest.fn();
    renderStatsScreenShell({ onSelectPeriod });

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    expect(onSelectPeriod).toHaveBeenCalledWith(30);
  });

  it('shows an error panel when summary load fails', () => {
    renderStatsScreenShell({ summary: null, errorMessage: 'Boom' });

    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Boom/);
  });

  it('invokes onPressSessionsCard when the Sessions card is tapped', () => {
    const onPress = jest.fn();
    renderStatsScreenShell({ onPressSessionsCard: onPress });

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('opens muscle history from expanded muscle rows and collapsed single-muscle headers', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({ onPressMuscleHistory });

    fireEvent.press(screen.getByTestId('stats-muscle-row-front_delts'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts'],
      displayName: 'Front Delts',
      familyName: 'Shoulders',
    });

    fireEvent.press(screen.getByTestId('stats-family-header-button-chest'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['chest'],
      displayName: 'Chest',
      familyName: 'Chest',
    });
  });

  it('opens family-level muscle history from a multi-muscle family header', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({ onPressMuscleHistory });

    fireEvent.press(screen.getByTestId('stats-family-header-shoulders'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts', 'rear_delts'],
      displayName: 'Shoulders',
      familyName: 'Shoulders',
    });
  });

  it('keeps family header history targets complete when muscle search hides non-matching rows', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({
      searchQuery: 'front',
      onPressMuscleHistory,
    });

    expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-row-rear_delts')).toBeNull();

    fireEvent.press(screen.getByTestId('stats-family-header-shoulders'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts', 'rear_delts'],
      displayName: 'Shoulders',
      familyName: 'Shoulders',
    });
  });

  it('renders muscle-history overlay states: loading, error, empty, populated, and dismiss', () => {
    const onDismissMuscleHistory = jest.fn();
    const onSelectMuscleHistoryWeek = jest.fn();
    const { rerender, toJSON } = render(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          isMuscleHistoryLoading: true,
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );

    expect(screen.getByTestId('stats-muscle-history-title')).toHaveTextContent(
      /Front Delts/
    );
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent(/Loading/);
    captureUiEvidence('stats-muscle-history-loading', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryErrorMessage: 'Nope',
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Nope/);
    captureUiEvidence('stats-muscle-history-error', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryWeeklyEffort: [],
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No history yet/);
    captureUiEvidence('stats-muscle-history-empty', toJSON());

    const effort = [buildWeeklyEffort()];
    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryWeeklyEffort: effort,
          selectedMuscleHistoryWeekKey: '2026-05-11',
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    captureUiEvidence('stats-muscle-history-populated', toJSON());

    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-11'));
    expect(onSelectMuscleHistoryWeek).toHaveBeenCalledWith(null); // deselect since it's already selected

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop'));
    expect(onDismissMuscleHistory).toHaveBeenCalledTimes(1);
  });

  it('renders exactly Volume and W/sets metric chips in the muscle overlay', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
    });

    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-metric-chip-estimatedRM1')).toBeNull();
    expect(screen.queryByTestId('stats-muscle-history-metric-chip-highestWeight')).toBeNull();
  });

  it('reports muscle-history metric changes', () => {
    const onSelectMuscleHistoryMetric = jest.fn();
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryMetric: 'totalVolume',
      onSelectMuscleHistoryMetric,
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount'));
    expect(onSelectMuscleHistoryMetric).toHaveBeenCalledWith('workingSetCount');
  });

  it('renders the Daily/Weekly view toggle and reports changes', () => {
    const onSelectMuscleHistoryView = jest.fn();
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryView: 'weekly',
      onSelectMuscleHistoryView,
    });

    expect(screen.getByTestId('stats-muscle-history-view-chip-weekly')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-view-chip-daily')).toBeTruthy();

    fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-daily'));
    expect(onSelectMuscleHistoryView).toHaveBeenCalledWith('daily');
  });

  it('keeps both heatmap views warm so switching preserves the daily chart state', () => {
    const dailyMetrics = [
      {
        dateKey: '2026-05-13',
        totalVolume: 1200,
        workingSetCount: 2,
        estimatedRM1: 95,
        highestWeight: 80,
      },
    ];
    const sharedProps = {
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryDailyMetrics: dailyMetrics,
    };
    const { rerender } = render(
      <StatsScreenShell
        {...buildShellProps({ ...sharedProps, muscleHistoryView: 'daily' })}
      />
    );

    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13'));
    expect(screen.getByTestId('stats-muscle-history-heatmap-day-detail-date')).toHaveTextContent(
      'May 13, 2026'
    );

    rerender(
      <StatsScreenShell
        {...buildShellProps({ ...sharedProps, muscleHistoryView: 'weekly' })}
      />
    );
    expect(
      screen.getByTestId('stats-muscle-history-heatmap-panel-daily', {
        includeHiddenElements: true,
      })
    ).toHaveStyle({ position: 'absolute', opacity: 0 });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-weekly')).toHaveStyle({
      position: 'relative',
      opacity: 1,
    });

    rerender(
      <StatsScreenShell
        {...buildShellProps({ ...sharedProps, muscleHistoryView: 'daily' })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-heatmap-day-detail-date')).toHaveTextContent(
      'May 13, 2026'
    );
  });

  it('selects a single day and shows the selected muscle metric in daily view', () => {
    const props = {
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryDailyMetrics: [
        {
          dateKey: '2026-05-13',
          totalVolume: 1200,
          workingSetCount: 2,
          estimatedRM1: 95,
          highestWeight: 80,
        },
      ],
      muscleHistoryView: 'daily' as const,
    };
    const { rerender } = render(
      <StatsScreenShell
        {...buildShellProps({
          ...props,
          muscleHistoryMetric: 'totalVolume',
        })}
      />
    );

    // The weekly rollup banner is hidden in daily view.
    expect(screen.queryByTestId('stats-muscle-history-week-banner')).toBeNull();

    // One square per day → addressable by its date key; tapping shows the DAY detail.
    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13'));
    expect(screen.getByTestId('stats-muscle-history-heatmap-day-detail-date')).toHaveTextContent(
      'May 13, 2026'
    );
    expect(screen.getByTestId('stats-muscle-history-heatmap-day-detail-value')).toHaveTextContent(
      /Volume: 1\.2k/
    );
    expect(screen.getByText('Volume per day')).toBeTruthy();

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          ...props,
          muscleHistoryMetric: 'workingSetCount',
        })}
      />
    );
    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13'));
    expect(screen.getByTestId('stats-muscle-history-heatmap-day-detail-value')).toHaveTextContent(
      /W\/sets: 2/
    );
    expect(screen.getByText('W/sets per day')).toBeTruthy();
  });

  it('shows the selected metric in the week selection banner', () => {
    const props = {
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: '2026-05-11',
    };
    const { rerender } = render(
      <StatsScreenShell
        {...buildShellProps({
          ...props,
          muscleHistoryMetric: 'totalVolume',
        })}
      />
    );

    const banner = screen.getByTestId('stats-muscle-history-week-banner');
    expect(banner).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-week-banner-range')).toHaveTextContent(/May/);
    expect(screen.getByTestId('stats-muscle-history-week-banner-value')).toHaveTextContent(
      /Volume: 1\.1k/
    );

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          ...props,
          muscleHistoryMetric: 'workingSetCount',
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-week-banner-value')).toHaveTextContent(
      /W\/sets: 2/
    );
  });

  it('shows a placeholder in the banner when no week is selected', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: null,
    });

    expect(screen.getByTestId('stats-muscle-history-week-banner')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-week-banner-placeholder')).toBeTruthy();
  });
});

describe('StatsRoute', () => {
  it('loads the summary on focus and re-loads when the period changes', async () => {
    mockComputeStatsSummary
      .mockResolvedValueOnce(buildSummary())
      .mockResolvedValueOnce(
        buildSummary({
          current: {
            ...buildSummary().current,
            totals: {
              sessionCount: 12,
              setCount: 120,
              workingSetCount: 100,
              muscleFamilies: buildSummary().current.totals.muscleFamilies,
            },
          },
        })
      );

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenCalledWith({ periodDays: 7 });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenLastCalledWith({ periodDays: 30 });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/12/);
    });
  });

  it('recomputes the exercise list from the DB on focus (not just on catalog invalidation)', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toBeTruthy();
    });
    expect(mockReloadExerciseCatalogStats).toHaveBeenCalled();
  });

  it('navigates to the sessions list when the Sessions card is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('loads selected-muscle weekly heatmap data when a muscle row is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedMuscleWeeklyEffort.mockResolvedValue([buildWeeklyEffort()]);
    mockComputeSelectedMuscleDailyEffortMetrics.mockResolvedValue([]);

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => expect(screen.getByTestId('stats-view-mode-chip')).toBeTruthy());
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('stats-muscle-row-front_delts'));

    await waitFor(() => {
      expect(mockComputeSelectedMuscleWeeklyEffort).toHaveBeenCalledWith({
        muscleGroupIds: ['front_delts'],
        start: expect.any(Date),
        end: expect.any(Date),
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-history-title')).toHaveTextContent(
        /Front Delts/
      );
    });
    expect(mockComputeSelectedMuscleDailyEffortMetrics).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts'],
      start: expect.any(Date),
      end: expect.any(Date),
    });
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    expect(
      screen.getByTestId('stats-muscle-history-metric-chip-totalVolume').props.accessibilityState
    ).toEqual({ selected: true });

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount'));
    expect(
      screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount').props
        .accessibilityState
    ).toEqual({ selected: true });
  });

  it('shows an overlay error when selected-muscle heatmap data fails to load', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedMuscleWeeklyEffort.mockRejectedValue(new Error('Weekly boom'));

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => expect(screen.getByTestId('stats-view-mode-chip')).toBeTruthy());
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-family-header-button-chest')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('stats-family-header-button-chest'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop'));
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
  });
});

describe('StatsScreenShell — view mode toggle', () => {
  const buildExerciseListItem = (id: string, name: string) => ({
    id,
    name,
    setCount: 5,
    nearFailureCount: 2,
    totalVolume: 2500,
    estimatedOneRepMax: 110,
  });

  it('renders the view mode chip', () => {
    renderStatsScreenShell();
    expect(screen.getByTestId('stats-view-mode-chip')).toBeTruthy();
  });

  it('calls onSelectViewMode when view mode chip is pressed', () => {
    const onSelectViewMode = jest.fn();
    renderStatsScreenShell({ onSelectViewMode });
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
    expect(onSelectViewMode).toHaveBeenCalledTimes(1);
  });

  it('shows the exercise list when viewMode is exercise', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseListItems: [buildExerciseListItem('ex1', 'Bench Press')],
    });
    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-row-ex1')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-name-ex1')).toHaveTextContent('Bench Press');
    expect(screen.getByTestId('stats-exercise-sets-ex1')).toHaveTextContent(/5 \(2\)/);
    expect(screen.queryByTestId('stats-exercise-sessions-ex1')).toBeNull();
    expect(screen.getByTestId('stats-exercise-row-ex1').props.accessibilityLabel).toContain(
      '5 sets, 2 near-failure sets'
    );
  });

  it('hides the stats scroll view when viewMode is exercise', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.queryByTestId('stats-scroll')).toBeNull();
  });

  it('shows empty state when exercise mode has no exercises', () => {
    renderStatsScreenShell({ viewMode: 'exercise', exerciseListItems: [] });
    expect(screen.getByTestId('stats-exercise-list-empty')).toBeTruthy();
  });

  it('calls onPressExerciseHistory when an exercise row is tapped', () => {
    const onPressExerciseHistory = jest.fn();
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseListItems: [buildExerciseListItem('ex1', 'Bench Press')],
      onPressExerciseHistory,
    });
    fireEvent.press(screen.getByTestId('stats-exercise-row-ex1'));
    expect(onPressExerciseHistory).toHaveBeenCalledWith({
      exerciseDefinitionId: 'ex1',
      displayName: 'Bench Press',
    });
  });

  it('renders ExerciseHistoryOverlay when selectedExercise is set', () => {
    const weeklyEffort = [buildWeeklyEffort()];
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
      exerciseHistoryWeeklyEffort: weeklyEffort,
      isExerciseHistoryLoading: false,
      exerciseHistoryErrorMessage: null,
    });
    expect(screen.getByTestId('stats-exercise-history-overlay')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-title')).toHaveTextContent('Bench Press');
    expect(screen.getByTestId('stats-exercise-history-heatmap-cell-2026-05-11')).toBeTruthy();
  });

  it('keeps all metric selector chips in the exercise overlay', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
      exerciseHistoryWeeklyEffort: [buildWeeklyEffort()],
    });

    expect(screen.getByTestId('stats-exercise-history-metric-chip-totalVolume')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-metric-chip-workingSetCount')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-metric-chip-estimatedRM1')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-metric-chip-highestWeight')).toBeTruthy();
  });

  it('shows loading state in exercise overlay', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Squat' },
      isExerciseHistoryLoading: true,
    });
    expect(screen.getByTestId('stats-exercise-history-loading')).toBeTruthy();
  });

  it('shows error state in exercise overlay', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Squat' },
      exerciseHistoryErrorMessage: 'Load failed',
      isExerciseHistoryLoading: false,
    });
    expect(screen.getByTestId('stats-exercise-history-error')).toHaveTextContent(/Load failed/);
  });

  it('shows empty state in exercise overlay when no history', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Squat' },
      exerciseHistoryWeeklyEffort: [],
      isExerciseHistoryLoading: false,
      exerciseHistoryErrorMessage: null,
    });
    expect(screen.getByTestId('stats-exercise-history-empty')).toBeTruthy();
  });

  it('calls onDismissExerciseHistory when backdrop is pressed', () => {
    const onDismissExerciseHistory = jest.fn();
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
      onDismissExerciseHistory,
    });
    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop'));
    expect(onDismissExerciseHistory).toHaveBeenCalledTimes(1);
  });

  it('calls onDismissExerciseHistory when close button is pressed', () => {
    const onDismissExerciseHistory = jest.fn();
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
      onDismissExerciseHistory,
    });
    fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
    expect(onDismissExerciseHistory).toHaveBeenCalledTimes(1);
  });
});

describe('StatsRoute — exercise heatmap integration', () => {
  const exerciseInCatalog = { id: 'bench-press', name: 'Bench Press', mappings: [] };
  const exerciseAggregate = {
    exerciseDefinitionId: 'bench-press',
    sessionCount: 8,
    setCount: 12,
    nearFailureCount: 4,
    totalVolume: 4000,
    estimatedOneRepMax: 120,
  };

  beforeEach(() => {
    (jest.requireMock('@/src/exercise-catalog/cache').useExerciseCatalog as jest.Mock).mockReturnValue({
      status: 'ready',
      exercises: [exerciseInCatalog],
      muscleGroups: [],
      muscleGroupsById: {},
      lastError: null,
    });
    (jest.requireMock('@/src/exercise-catalog/stats-cache').useExerciseCatalogStats as jest.Mock).mockReturnValue({
      status: 'ready',
      stats: {
        aggregatesById: new Map([['bench-press', exerciseAggregate]]),
        everDoneIds: new Set(['bench-press']),
        lastCompletedAtById: new Map(),
      },
      lastError: null,
      reload: jest.fn(),
    });
  });

  it('shows exercise list by default', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    render(<StatsRoute />);

    await act(async () => { triggerFocus(); });
    await waitFor(() =>
      expect(screen.getByTestId('stats-exercise-list')).toBeTruthy()
    );
    expect(screen.getByTestId('stats-exercise-row-bench-press')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-name-bench-press')).toHaveTextContent('Bench Press');
  });

  it('loads exercise heatmap data and opens overlay when exercise row is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedExerciseWeeklyEffort.mockResolvedValue([buildWeeklyEffort()]);

    render(<StatsRoute />);
    await act(async () => { triggerFocus(); });
    await waitFor(() => expect(screen.getByTestId('stats-exercise-row-bench-press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('stats-exercise-row-bench-press'));

    await waitFor(() =>
      expect(mockComputeSelectedExerciseWeeklyEffort).toHaveBeenCalledWith({
        exerciseDefinitionId: 'bench-press',
        start: expect.any(Date),
        end: expect.any(Date),
      })
    );
    expect(mockComputeSelectedExerciseDailyEffort).toHaveBeenCalledWith({
      exerciseDefinitionId: 'bench-press',
      start: expect.any(Date),
      end: expect.any(Date),
    });
    await waitFor(() =>
      expect(screen.getByTestId('stats-exercise-history-title')).toHaveTextContent('Bench Press')
    );
  });

  it('dismisses exercise overlay on backdrop press', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedExerciseWeeklyEffort.mockResolvedValue([buildWeeklyEffort()]);

    render(<StatsRoute />);
    await act(async () => { triggerFocus(); });
    await waitFor(() => expect(screen.getByTestId('stats-exercise-row-bench-press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('stats-exercise-row-bench-press'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-exercise-history-overlay')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop'));
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();
  });

  it('shows exercise overlay error when data fails to load', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedExerciseWeeklyEffort.mockRejectedValue(new Error('DB error'));

    render(<StatsRoute />);
    await act(async () => { triggerFocus(); });
    await waitFor(() => expect(screen.getByTestId('stats-exercise-row-bench-press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('stats-exercise-row-bench-press'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/)
    );
  });
});

describe('StatsScreenShell — search & filtering', () => {
  const buildExerciseListItem = (id: string, name: string) => ({
    id,
    name,
    setCount: 5,
    nearFailureCount: 2,
    totalVolume: 2500,
    estimatedOneRepMax: 110,
  });

  it('renders search input with dynamic placeholder depending on viewMode', () => {
    const { rerender } = render(
      <StatsScreenShell {...buildShellProps({ viewMode: 'exercise' })} />
    );
    expect(screen.getByPlaceholderText('Filter by exercise...')).toBeTruthy();

    rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'muscle' })} />);
    expect(screen.getByPlaceholderText('Filter by muscle...')).toBeTruthy();
  });

  it('calls onSearchQueryChange when typing and shows clear button', () => {
    const onSearchQueryChange = jest.fn();
    const { rerender } = render(
      <StatsScreenShell
        {...buildShellProps({
          searchQuery: '',
          onSearchQueryChange,
        })}
      />
    );

    const input = screen.getByTestId('stats-search-input');
    fireEvent.changeText(input, 'Bench');
    expect(onSearchQueryChange).toHaveBeenCalledWith('Bench');

    expect(screen.queryByTestId('stats-search-clear-button')).toBeNull();

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          searchQuery: 'Bench',
          onSearchQueryChange,
        })}
      />
    );
    expect(screen.getByTestId('stats-search-clear-button')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-search-clear-button'));
    expect(onSearchQueryChange).toHaveBeenLastCalledWith('');
  });

  it('filters exercises based on searchQuery', () => {
    render(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'exercise',
          searchQuery: 'bench',
          exerciseListItems: [
            buildExerciseListItem('ex1', 'Bench Press'),
            buildExerciseListItem('ex2', 'Squat'),
          ],
        })}
      />
    );

    expect(screen.getByTestId('stats-exercise-row-ex1')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-row-ex2')).toBeNull();
  });

  it('shows correct empty state when no exercises match', () => {
    render(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'exercise',
          searchQuery: 'deadlift',
          exerciseListItems: [
            buildExerciseListItem('ex1', 'Bench Press'),
          ],
        })}
      />
    );

    expect(screen.queryByTestId('stats-exercise-row-ex1')).toBeNull();
    expect(screen.getByTestId('stats-exercise-list-empty')).toHaveTextContent(
      'No exercises match the search query.'
    );
  });

  it('filters muscle families and groups based on searchQuery', () => {
    render(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'muscle',
          searchQuery: 'front',
          summary: buildSummary(),
        })}
      />
    );

    // Shoulders has "Front Delts" which matches, so Shoulders family should render
    expect(screen.getByTestId('stats-family-card-shoulders')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();

    // Rear Delts doesn't match "front", so it should be hidden
    expect(screen.queryByTestId('stats-muscle-row-rear_delts')).toBeNull();

    // Chest has "Chest" muscle, which doesn't match "front", so Chest family should be hidden
    expect(screen.queryByTestId('stats-family-card-chest')).toBeNull();
  });

  it('shows correct empty state when no muscles match query', () => {
    render(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'muscle',
          searchQuery: 'biceps',
          summary: buildSummary(),
        })}
      />
    );

    expect(screen.queryByTestId('stats-family-card-shoulders')).toBeNull();
    expect(screen.queryByTestId('stats-family-card-chest')).toBeNull();
    expect(screen.getByTestId('stats-muscle-empty')).toHaveTextContent(
      'No muscle groups match the search query.'
    );
  });
});

describe('StatsRoute — view mode toggle search query reset', () => {
  it('resets search query when view mode chip is pressed', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    render(<StatsRoute />);

    await act(async () => { triggerFocus(); });
    await waitFor(() => expect(screen.getByTestId('stats-search-input')).toBeTruthy());

    // Type in search query
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Chest');
    expect(screen.getByTestId('stats-search-input').props.value).toBe('Chest');

    // Switch view modes
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
    expect(screen.getByTestId('stats-search-input').props.value).toBe('');
  });
});
