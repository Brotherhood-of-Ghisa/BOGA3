/**
 * Stats without a database: the formatting, intensity and sort rules as pure
 * functions, and the screen shell's presentation on hand-built props (deltas,
 * shades, accessibility labels, sort cycling, overlay states). The route over
 * real data — queries, caches, focus reloads, navigation — is
 * `stats-screen-local-data.test.tsx`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  computeFailureIntensityProgress,
  type StatsScreenShellProps,
  type ExerciseListItem,
  describeExerciseSortMode,
  formatCountDelta,
  formatPeriodComparison,
  formatVolumeDelta,
  nextExerciseSortMode,
  sortExerciseListItems,
  resolveStatsInitialBreakdown,
  resolveStatsInitialPeriod,
} from '../app/(tabs)/stats-history';
import ProgressRoute from '../app/(tabs)/progress';
import { uiGeometry, uiRoles } from '@/components/ui';
import type { SelectedMuscleWeeklyEffort, StatsSummary } from '@/src/data';

const buildSummary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
  current: {
    period: {
      days: 7,
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: new Date('2026-05-19T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 4,
      workingSetCount: 38,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          workingSetCount: 3,
          totalVolume: 1800,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              workingSetCount: 3,
              totalVolume: 1800,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          workingSetCount: 4,
          totalVolume: 900,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              workingSetCount: 4,
              totalVolume: 600,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              workingSetCount: 0,
              totalVolume: 300,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          workingSetCount: 0,
          totalVolume: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              workingSetCount: 0,
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
      workingSetCount: 30,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          workingSetCount: 2,
          totalVolume: 1500,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              workingSetCount: 2,
              totalVolume: 1500,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          workingSetCount: 3,
          totalVolume: 600,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              workingSetCount: 3,
              totalVolume: 400,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              workingSetCount: 0,
              totalVolume: 200,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          workingSetCount: 0,
          totalVolume: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              workingSetCount: 0,
              totalVolume: 0,
            },
          ],
        },
      ],
    },
  },
  ...overrides,
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
  historyTodayDateKey: '2026-06-05',
  searchQuery: '',
  onSearchQueryChange: jest.fn(),
  ...overrides,
});

/** Which arrow a sort header's indicator shows; the icon is decorative, so hidden. */
const sortArrow = (header: 'exercise' | 'sets' | 'volume'): 'up' | 'down' | null => {
  const find = (direction: 'up' | 'down') =>
    screen.queryByTestId(`stats-exercise-sort-${header}-indicator-${direction}`, {
      includeHiddenElements: true,
    });
  return find('up') ? 'up' : find('down') ? 'down' : null;
};

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

describe('Progress route parity', () => {
  it('uses the existing Stats / History implementation without an analytics fork', () => {
    expect(ProgressRoute).toBe(StatsRoute);
  });
});

describe('formatPeriodComparison', () => {
  it('names the adjacent earlier period of the selected range', () => {
    expect(formatPeriodComparison(7)).toBe('vs prev 1 wk');
    expect(formatPeriodComparison(28)).toBe('vs prev 4 wks');
  });
});

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
  const item = (
    id: string,
    overrides: Partial<Omit<ExerciseListItem, 'id'>> = {}
  ): ExerciseListItem => ({
    id,
    name: id,
    workingSetCount: 0,
    totalVolume: 0,
    estimatedOneRepMax: null,
    lastCompletedAt: null,
    ...overrides,
  });

  it('cycles each header exactly and starts a newly selected header at its first state', () => {
    expect(nextExerciseSortMode('sets-desc', 'sets')).toBe('sets-asc');
    expect(nextExerciseSortMode('sets-asc', 'sets')).toBe('sets-desc');

    expect(nextExerciseSortMode('sets-desc', 'exercise')).toBe('recency-desc');
    expect(nextExerciseSortMode('recency-desc', 'exercise')).toBe('recency-asc');
    expect(nextExerciseSortMode('recency-asc', 'exercise')).toBe('recency-desc');
    expect(nextExerciseSortMode('sets-asc', 'volume')).toBe('volume-desc');
    expect(nextExerciseSortMode('volume-desc', 'volume')).toBe('volume-asc');
    expect(nextExerciseSortMode('volume-asc', 'volume')).toBe('volume-desc');
  });

  it('formats unambiguous accessibility descriptions for every sort state', () => {
    expect([
      'recency-desc',
      'recency-asc',
      'sets-desc',
      'sets-asc',
      'volume-desc',
      'volume-asc',
    ].map((mode) => describeExerciseSortMode(mode as Parameters<typeof describeExerciseSortMode>[0])))
      .toEqual([
        'Most recent exercise',
        'Least recent exercise',
        'Sets — high to low',
        'Sets — low to high',
        'Volume — high to low',
        'Volume — low to high',
      ]);
  });

  it('sorts recency in both directions with equal and missing timestamps deterministic', () => {
    const items = [
      item('missing', { name: 'Missing' }),
      item('older-b', { name: 'Same', lastCompletedAt: new Date('2026-01-01T00:00:00Z') }),
      item('newest', { name: 'Newest', lastCompletedAt: new Date('2026-03-01T00:00:00Z') }),
      item('older-a', { name: 'Same', lastCompletedAt: new Date('2026-01-01T00:00:00Z') }),
    ];

    expect(sortExerciseListItems(items, 'recency-desc').map(({ id }) => id)).toEqual([
      'newest', 'older-a', 'older-b', 'missing',
    ]);
    expect(sortExerciseListItems(items, 'recency-asc').map(({ id }) => id)).toEqual([
      'older-a', 'older-b', 'newest', 'missing',
    ]);
  });

  it('sorts set (working-set) and volume values in both directions', () => {
    const items = [
      item('alpha', { name: 'Alpha', workingSetCount: 1, totalVolume: 300 }),
      item('beta', { name: 'Beta', workingSetCount: 3, totalVolume: 100 }),
      item('gamma', { name: 'Gamma', workingSetCount: 2, totalVolume: 200 }),
    ];

    expect(sortExerciseListItems(items, 'sets-desc').map(({ id }) => id)).toEqual(['beta', 'gamma', 'alpha']);
    expect(sortExerciseListItems(items, 'sets-asc').map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortExerciseListItems(items, 'volume-desc').map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortExerciseListItems(items, 'volume-asc').map(({ id }) => id)).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('uses name then ID tie-breakers and never mutates the input array', () => {
    const items = [
      item('z', { name: 'Same', workingSetCount: 4 }),
      item('b', { name: 'Bench Press', workingSetCount: 7 }),
      item('a', { name: 'Same', workingSetCount: 4 }),
    ];
    const originalOrder = [...items];
    const sorted = sortExerciseListItems(items);

    expect(sorted.map(({ id }) => id)).toEqual(['b', 'a', 'z']);
    expect(items).toEqual(originalOrder);
    expect(sorted).not.toBe(items);
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
    // One figure: the working sets, with a single absolute delta.
    expect(setsCard).toHaveTextContent(/^Sets38\+8 vs prev 1 wk$/);
    expect(setsCard).not.toHaveTextContent('%');
  });

  it('renders family and muscle rows with set/failure counts and percentage-only volume deltas', () => {
    renderStatsScreenShell();

    const shouldersSets = screen.getByTestId('stats-family-sets-shoulders');
    expect(shouldersSets).toHaveTextContent(/^Sets4\+1$/);
    expect(shouldersSets).not.toHaveTextContent('%');

    const shouldersVolume = screen.getByTestId('stats-family-volume-shoulders');
    expect(shouldersVolume).toHaveTextContent(/900/);
    expect(shouldersVolume).toHaveTextContent(/\+50%/);
    expect(shouldersVolume).not.toHaveTextContent('+300');

    // Nested muscle row also carries its own delta.
    const frontDeltsSets = screen.getByTestId('stats-muscle-sets-front_delts');
    expect(frontDeltsSets).toHaveTextContent(/^Sets4\+1$/);

    expect(screen.queryByText('Total weight')).toBeNull();
    expect(screen.queryByTestId('stats-family-sessions-shoulders')).toBeNull();
    expect(screen.queryByTestId('stats-muscle-sessions-front_delts')).toBeNull();
  });

  it('colours each trained family and muscle row with one uniform failure shade', () => {
    const { rerender } = render(
      <StatsScreenShell {...buildShellProps({ periodDays: 7, viewMode: 'muscle' })} />
    );

    // One ramp for families and muscles alike (DLM-T08-D3): the shade is the
    // row's ground, a band around the pressable row.
    expect(screen.getByTestId('stats-family-header-shoulders-shade')).toHaveStyle({
      backgroundColor: uiRoles.viz1,
    });
    expect(screen.getByTestId('stats-muscle-row-front_delts-shade')).toHaveStyle({
      backgroundColor: uiRoles.viz2,
    });
    // On a `viz` ground the legends and deltas turn `ink`: `ink-faint` and
    // `ink-muted` are illegible there.
    const shadedSets = within(screen.getByTestId('stats-family-sets-shoulders'));
    expect(StyleSheet.flatten(shadedSets.getByText('Sets').props.style).color).toBe(uiRoles.ink);
    expect(StyleSheet.flatten(shadedSets.getByText('+1').props.style).color).toBe(uiRoles.ink);
    expect(
      screen.queryByTestId(/failure-bar/, { includeHiddenElements: true })
    ).toBeNull();

    rerender(
      <StatsScreenShell {...buildShellProps({ periodDays: 30, viewMode: 'muscle' })} />
    );
    expect(screen.getByTestId('stats-family-header-shoulders-shade')).toHaveStyle({
      backgroundColor: uiRoles.viz1,
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
              workingSetCount: 4,
              totalVolume: 1000,
              estimatedOneRepMax: 100,
              lastCompletedAt: null,
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
      '4 sets. up 1 sets'
    );
    expect(screen.getByTestId('stats-family-header-shoulders').props.accessibilityLabel).toContain(
      'average attainment of 2 muscle targets over 1 weeks, capped per muscle at 100%'
    );
    expect(screen.getByTestId('stats-muscle-row-front_delts').props.accessibilityLabel).toContain(
      '4 sets. up 1 sets'
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

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop', { includeHiddenElements: true }));
    expect(onDismissMuscleHistory).toHaveBeenCalledTimes(1);
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
      /Volume: 1200/
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
      /Sets: 2/
    );
    expect(screen.getByText('Sets per day')).toBeTruthy();
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
      /Volume: 1100/
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
      /Sets: 2/
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

describe('Stats route parameters', () => {
  it('validates initial period and breakdown query values', () => {
    expect(resolveStatsInitialPeriod('30')).toBe(28);
    expect(resolveStatsInitialPeriod(['7'])).toBe(7);
    expect(resolveStatsInitialPeriod('all')).toBe(28);
    expect(resolveStatsInitialBreakdown('muscle')).toBe('muscle');
    expect(resolveStatsInitialBreakdown(['exercise'])).toBe('exercise');
    expect(resolveStatsInitialBreakdown('unknown')).toBe('exercise');
  });
});

describe('StatsScreenShell — view mode toggle', () => {
  const buildExerciseListItem = (
    id: string,
    name: string,
    overrides: Partial<ExerciseListItem> = {}
  ): ExerciseListItem => ({
    id,
    name,
    workingSetCount: 2,
    totalVolume: 2500,
    estimatedOneRepMax: 110,
    lastCompletedAt: null,
    ...overrides,
  });

  const sortedExerciseIds = (): string[] =>
    screen
      .getAllByTestId(/^stats-exercise-name-/)
      .map((node) => String(node.props.testID).replace('stats-exercise-name-', ''));

  it('renders separate labelled Time range and Breakdown control rows', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });

    expect(screen.getByTestId('stats-time-range-controls')).toHaveTextContent(/Time range/);
    expect(screen.getByTestId('stats-breakdown-controls')).toHaveTextContent(/Breakdown/);
    expect(screen.getByTestId('stats-period-chip-7')).toHaveTextContent('This week');
    expect(screen.getByTestId('stats-period-chip-28')).toHaveTextContent('4 weeks');
    expect(screen.getByTestId('stats-view-mode-chip-exercise')).toHaveTextContent('By Exercise');
    expect(screen.getByTestId('stats-view-mode-chip-muscle')).toHaveTextContent('By Muscle');
  });

  it('exposes exactly one selected breakdown option and invokes each explicit choice once', () => {
    const onSelectViewMode = jest.fn();
    const view = render(
      <StatsScreenShell
        {...buildShellProps({ viewMode: 'exercise', onSelectViewMode })}
      />
    );

    expect(screen.getByTestId('stats-view-mode-chip-exercise').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('stats-view-mode-chip-muscle').props.accessibilityState).toEqual({
      selected: false,
    });
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-exercise'));
    expect(onSelectViewMode).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(onSelectViewMode).toHaveBeenCalledTimes(1);
    expect(onSelectViewMode).toHaveBeenLastCalledWith('muscle');

    view.rerender(
      <StatsScreenShell
        {...buildShellProps({ viewMode: 'muscle', onSelectViewMode })}
      />
    );
    expect(screen.getByTestId('stats-view-mode-chip-exercise').props.accessibilityState).toEqual({
      selected: false,
    });
    expect(screen.getByTestId('stats-view-mode-chip-muscle').props.accessibilityState).toEqual({
      selected: true,
    });
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(onSelectViewMode).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-exercise'));
    expect(onSelectViewMode).toHaveBeenCalledTimes(2);
    expect(onSelectViewMode).toHaveBeenLastCalledWith('exercise');
  });

  it('makes each control a tab list under its own label (DLM-T08-D1)', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });

    // Both are the same joined control now; the labels, not two shapes, tell
    // Time range from Breakdown (`ux-rules.md` §13.1, §13.8).
    for (const [group, row, label] of [
      ['stats-time-range-controls', 'stats-period-chip-row', 'Select stats time range'],
      ['stats-breakdown-controls', 'stats-view-mode-chip-row', 'Select stats breakdown'],
    ] as const) {
      const control = within(screen.getByTestId(group)).getByTestId(row);
      expect(control.props.accessibilityRole).toBe('tablist');
      expect(control.props.accessibilityLabel).toBe(label);
    }
    for (const segment of ['stats-period-chip-7', 'stats-view-mode-chip-exercise']) {
      expect(screen.getByTestId(segment).props.accessibilityRole).toBe('tab');
      expect(screen.getByTestId(segment)).toHaveStyle({ flex: 1 });
    }
  });

  it('keeps delta signs and drops their green and red (G3, DLM-T08-D4)', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });

    const sessions = within(screen.getByTestId('stats-card-sessions'));
    const sets = within(screen.getByTestId('stats-card-sets'));
    for (const node of [sessions.getByText('+1 vs prev 1 wk'), sets.getByText('+8 vs prev 1 wk')]) {
      expect(StyleSheet.flatten(node.props.style).color).toBe(uiRoles.inkMuted);
    }
    // The Sessions card is a link to the list, marked by a chevron.
    expect(screen.getByTestId('stats-card-sessions').props.accessibilityRole).toBe('link');
  });

  it('renders one compact four-column header with the default Sets sort clearly active', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseListItems: [
        buildExerciseListItem('missing', 'Long exercise name that may wrap', {
          estimatedOneRepMax: null,
        }),
      ],
    });

    expect(screen.getByTestId('stats-exercise-table-header')).toBeTruthy();
    const header = within(screen.getByTestId('stats-exercise-table-header'));
    expect(header.getByText('Exercise')).toBeTruthy();
    expect(header.getByText('Sets')).toBeTruthy();
    expect(screen.getByText('Vol')).toBeTruthy();
    expect(screen.getByText('1RM')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-header-oneRepMax').props.accessibilityRole).toBe(
      'header'
    );
    expect(screen.queryByTestId('stats-exercise-sort-oneRepMax')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-sort-status')).toBeNull();
    expect(screen.queryByText(/^Sorted by:/)).toBeNull();
    expect(screen.getByTestId('stats-exercise-sort-sets').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('stats-exercise-sort-sets').props.accessibilityLabel).toContain(
      'Current sort: Sets — high to low. Activate to sort Sets — low to high.'
    );
    expect(screen.getByTestId('stats-exercise-sort-exercise').props.accessibilityLabel).toContain(
      'Activate to sort Most recent exercise.'
    );
    expect(screen.getByTestId('stats-exercise-sort-sets')).toHaveStyle({
      flexDirection: 'row',
      minHeight: uiGeometry.tapTarget,
    });
    expect(header.getByText('Sets').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('stats-exercise-1rm-missing')).toHaveTextContent('—');
    expect(screen.getByTestId('stats-exercise-row-missing').props.accessibilityLabel).toContain(
      'Estimated one rep max unavailable'
    );
    // Inactive headers keep a transparent indicator laid out, so activating a
    // column never shifts it.
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveStyle({
      opacity: 0,
      width: 64,
    });
    expect(sortArrow('exercise')).toBe('down');
    expect(sortArrow('sets')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-sets-indicator')).not.toHaveStyle({ opacity: 0 });
    expect(screen.getByTestId('stats-exercise-sort-volume-indicator')).toHaveStyle({ opacity: 0 });
    expect(sortArrow('volume')).toBe('down');
    expect(screen.getByTestId('stats-exercise-name-missing').props.numberOfLines).toBeUndefined();
  });

  it('reorders rows and updates compact active indicators through every header cycle', () => {
    const onPressExerciseHistory = jest.fn();
    renderStatsScreenShell({
      viewMode: 'exercise',
      onPressExerciseHistory,
      exerciseListItems: [
        buildExerciseListItem('alpha', 'Alpha', {
          workingSetCount: 10,
          totalVolume: 100,
          estimatedOneRepMax: null,
          lastCompletedAt: new Date('2026-01-01T00:00:00Z'),
        }),
        buildExerciseListItem('beta', 'Beta', {
          workingSetCount: 5,
          totalVolume: 300,
          estimatedOneRepMax: 90,
          lastCompletedAt: new Date('2026-03-01T00:00:00Z'),
        }),
        buildExerciseListItem('gamma', 'Gamma', {
          workingSetCount: 7,
          totalVolume: 200,
          estimatedOneRepMax: 120,
          lastCompletedAt: new Date('2026-02-01T00:00:00Z'),
        }),
      ],
    });

    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-sets'));
    expect(sortedExerciseIds()).toEqual(['beta', 'gamma', 'alpha']);
    expect(screen.getByTestId('stats-exercise-sort-sets').props.accessibilityLabel).toContain(
      'Current sort: Sets — low to high'
    );
    expect(sortArrow('sets')).toBe('up');
    fireEvent.press(screen.getByTestId('stats-exercise-sort-sets'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    expect(screen.getByTestId('stats-exercise-sort-sets').props.accessibilityLabel).toContain(
      'Current sort: Sets — high to low'
    );
    expect(sortArrow('sets')).toBe('down');

    fireEvent.press(screen.getByTestId('stats-exercise-sort-exercise'));
    expect(sortedExerciseIds()).toEqual(['beta', 'gamma', 'alpha']);
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveTextContent('Recent');
    expect(sortArrow('exercise')).toBe('down');
    fireEvent.press(screen.getByTestId('stats-exercise-sort-exercise'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortArrow('exercise')).toBe('up');

    fireEvent.press(screen.getByTestId('stats-exercise-sort-volume'));
    expect(sortedExerciseIds()).toEqual(['beta', 'gamma', 'alpha']);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-volume'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);

    expect(sortArrow('volume')).toBe('up');
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveStyle({ opacity: 0 });
    expect(onPressExerciseHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-exercise-row-gamma'));
    expect(onPressExerciseHistory).toHaveBeenCalledWith({
      exerciseDefinitionId: 'gamma',
      displayName: 'Gamma',
    });
  });

  it('preserves sort state while new period data, search, and Breakdown props arrive', () => {
    const initialItems = [
      buildExerciseListItem('alpha', 'Alpha', { totalVolume: 100 }),
      buildExerciseListItem('beta', 'Beta', { totalVolume: 300 }),
    ];
    const view = render(
      <StatsScreenShell
        {...buildShellProps({ viewMode: 'exercise', exerciseListItems: initialItems })}
      />
    );

    fireEvent.press(screen.getByTestId('stats-exercise-sort-volume'));
    expect(sortedExerciseIds()).toEqual(['beta', 'alpha']);

    view.rerender(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'muscle',
          periodDays: 30,
          exerciseListItems: [
            buildExerciseListItem('alpha', 'Alpha', { totalVolume: 500 }),
            buildExerciseListItem('beta', 'Beta', { totalVolume: 50 }),
          ],
        })}
      />
    );
    view.rerender(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'exercise',
          periodDays: 30,
          searchQuery: 'a',
          exerciseListItems: [
            buildExerciseListItem('alpha', 'Alpha', { totalVolume: 500 }),
            buildExerciseListItem('beta', 'Beta', { totalVolume: 50 }),
          ],
        })}
      />
    );

    expect(screen.getByTestId('stats-exercise-sort-volume').props.accessibilityLabel).toContain(
      'Current sort: Volume — high to low'
    );
    expect(sortedExerciseIds()).toEqual(['alpha', 'beta']);
  });

  it('hides the stats scroll view when viewMode is exercise', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.queryByTestId('stats-scroll')).toBeNull();
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

  it('has no close button: the sheet is dismissed from its backdrop (G5)', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
    });
    expect(screen.getByTestId('stats-exercise-history')).toBeTruthy();
    expect(
      screen.getByTestId('stats-exercise-history-backdrop', { includeHiddenElements: true })
    ).toHaveProp('accessibilityLabel', 'Dismiss exercise history');
    expect(screen.queryByTestId('stats-exercise-history-close', { includeHiddenElements: true })).toBeNull();
  });
});

describe('StatsScreenShell — search & filtering', () => {
  const buildExerciseListItem = (id: string, name: string) => ({
    id,
    name,
    workingSetCount: 2,
    totalVolume: 2500,
    estimatedOneRepMax: 110,
    lastCompletedAt: null,
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

    expect(screen.queryByTestId('stats-search-input-clear')).toBeNull();

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          searchQuery: 'Bench',
          onSearchQueryChange,
        })}
      />
    );
    expect(screen.getByTestId('stats-search-input-clear').props.accessibilityLabel).toBe(
      'Clear search input'
    );
    fireEvent.press(screen.getByTestId('stats-search-input-clear'));
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

it('keeps partial volume readable and uses ordinary strength copy for bodyweight arithmetic', () => {
  render(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise', exerciseListItems: [{
    id: 'bw', name: 'Pull-up', workingSetCount: 2,
    totalVolume: null, knownVolume: 800, estimatedOneRepMax: 127.7, lastCompletedAt: null,
  }] })} />);
  expect(screen.getByTestId('stats-exercise-volume-bw')).toHaveTextContent('800');
  expect(screen.getByTestId('stats-exercise-coverage-bw')).toHaveTextContent('Volume incomplete');
  expect(screen.queryByText(/Added 1RM|BW \+/i)).toBeNull();
  expect(screen.getByTestId('stats-exercise-row-bw').props.accessibilityLabel)
    .toBe('Open Pull-up heatmap. 2 sets. Volume 800 · incomplete. Estimated one rep max 127.7 kg');
});
