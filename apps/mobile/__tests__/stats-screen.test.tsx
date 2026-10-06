/**
 * Stats without a database: the formatting, intensity and sort rules as pure
 * functions, and the screen shell's presentation on hand-built props (deltas,
 * shades, accessibility labels, sort cycling, overlay states). The route over
 * real data — queries, caches, focus reloads, navigation — is
 * `stats-screen-local-data.test.tsx`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Modal, StyleSheet } from 'react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  type StatsScreenShellProps,
  type ExerciseListItem,
  type MuscleHistoryTarget,
  describeExerciseSortMode,
  formatCountDelta,
  formatPeriodComparison,
  formatVolumeDelta,
  nextExerciseSortMode,
  sortExerciseListItems,
  resolveStatsInitialBreakdown,
} from '../app/(tabs)/stats-history';
import ProgressRoute from '../app/(tabs)/progress';
import { ListRow, uiGeometry, uiRoles } from '@/components/ui';
import { compareProgressVolume } from '@/src/data/progress-comparisons';
import type { SelectedMuscleWeeklyEffort, StatsSummary, ProgressComparisons } from '@/src/data';

const buildLegacySummary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
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

const buildSummary = (): ProgressComparisons => {
  const summary = buildLegacySummary();
  const previous = new Map(summary.previous.totals.muscleFamilies.flatMap(family => family.muscles).map(row => [row.muscleGroupId, row]));
  return { ...summary, muscles: summary.current.totals.muscleFamilies.flatMap(family => family.muscles).map(row => {
    const old = previous.get(row.muscleGroupId);
    return { muscleGroupId: row.muscleGroupId, displayName: row.displayName, familyName: row.familyName, sortOrder: row.sortOrder,
      current: { workingSetCount: row.workingSetCount, totalVolume: row.totalVolume, knownVolume: row.totalVolume, volumeSetCount: row.totalVolume ? 1 : 0, knownVolumeSetCount: row.totalVolume ? 1 : 0 },
      previous: { workingSetCount: old?.workingSetCount ?? 0, totalVolume: old?.totalVolume ?? 0, knownVolume: old?.totalVolume ?? 0, volumeSetCount: old?.totalVolume ? 1 : 0, knownVolumeSetCount: old?.totalVolume ? 1 : 0 },
      workingSetChange: row.workingSetCount - (old?.workingSetCount ?? 0), volumeChange: compareProgressVolume(row.totalVolume, old?.totalVolume ?? 0), exercises: [] };
  }) };
};

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
    expect(formatPeriodComparison(7)).toBe('vs previous week');
    expect(formatPeriodComparison(28)).toBe('vs previous 4 weeks');
  });
});

it.each([[7, 'week'], [28, '4 weeks']])('announces the %i-day comparison once', (periodDays, wording) => {
  renderStatsScreenShell({ periodDays });
  expect(screen.getByTestId('stats-comparison-label')).toHaveProp('accessibilityLabel', `vs previous ${wording}, same elapsed calendar span`);
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
  it('separates names, numbers and selected chevrons, keeping families inert', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({ onPressMuscleHistory });
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.queryByTestId('stats-card-sets')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-family-header-chest'));
    fireEvent.press(screen.getByTestId('stats-muscle-row-chest-now'));
    expect(onPressMuscleHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: true });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityLabel', 'Hide Chest contributions');
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
    fireEvent.press(screen.getByTestId('stats-contributions-total'));
    expect(onPressMuscleHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: false });
    fireEvent.press(screen.getByTestId('stats-muscle-history-chest'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({ muscleGroupIds: ['chest'], displayName: 'Chest', familyName: 'Chest' });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveStyle({ width: 44, minHeight: 44 });
    expect(screen.getByTestId('stats-muscle-history-chest')).toHaveStyle({ minWidth: 44, minHeight: 44 });
  });

  it('grades counts against the saved quota and selected weeks in either metric', () => {
    renderStatsScreenShell();
    expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ backgroundColor: uiRoles.viz2 });
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ backgroundColor: uiRoles.viz2 });
    expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveTextContent('+20%');
    expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveStyle({ color: uiRoles.ink });
  });

  it('does not render a sheet handed a legacy multi-muscle target', () => {
    renderStatsScreenShell({ selectedMuscle: {
      muscleGroupIds: ['front_delts', 'rear_delts'], displayName: 'Shoulders', familyName: 'Shoulders',
    } as unknown as MuscleHistoryTarget });
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
  });

  it('renders muscle-history overlay states: loading, error, empty, populated, and dismiss', () => {
    const onDismissMuscleHistory = jest.fn();
    const onRetryMuscleHistory = jest.fn();
    const onSelectMuscleHistoryWeek = jest.fn();
    const { rerender, toJSON } = render(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'] as [string],
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
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    captureUiEvidence('stats-muscle-history-loading', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'] as [string],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryErrorMessage: 'Nope',
          onRetryMuscleHistory,
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Nope/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    expect(onRetryMuscleHistory).toHaveBeenCalledTimes(1);
    captureUiEvidence('stats-muscle-history-error', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'] as [string],
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
            muscleGroupIds: ['front_delts'] as [string],
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

    fireEvent.press(screen.getByTestId('stats-muscle-history-close'));
    fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
    expect(onDismissMuscleHistory).toHaveBeenCalledTimes(1);
  });

  it.each([['muscle', 'daily'], ['muscle', 'weekly'], ['exercise', 'daily'], ['exercise', 'weekly']] as const)(
    'uses the theme accent for the active %s history metric in %s mode', (kind, view) => {
      const onSelectMetric = jest.fn();
      const props = buildShellProps({
        selectedMuscle: kind === 'muscle' ? { muscleGroupIds: ['chest'], displayName: 'Chest', familyName: 'Chest' } : null,
        selectedExercise: kind === 'exercise' ? { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' } : null,
        muscleHistoryView: view,
        exerciseHistoryView: view,
        onSelectMuscleHistoryMetric: onSelectMetric,
        onSelectExerciseHistoryMetric: onSelectMetric,
      });
      const { rerender } = render(<StatsScreenShell {...props} />);
      const prefix = `stats-${kind}-history-metric-chip`;
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ backgroundColor: uiRoles.accent });
      expect(within(screen.getByTestId(`${prefix}-totalVolume`)).getByText('Volume')).toHaveStyle({ color: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.surface });
      fireEvent.press(screen.getByTestId(`${prefix}-workingSetCount`));
      expect(onSelectMetric).toHaveBeenCalledWith('workingSetCount');

      rerender(<StatsScreenShell {...props} muscleHistoryMetric="workingSetCount" exerciseHistoryMetric="workingSetCount" />);
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.accent });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveProp('accessibilityState', { selected: true });
      expect(within(screen.getByTestId(`${prefix}-workingSetCount`)).getByText('Sets')).toHaveStyle({ color: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ backgroundColor: uiRoles.surface });
    });

  it('keeps both heatmap views warm through loading, retry and view changes', () => {
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
        muscleGroupIds: ['front_delts'] as [string],
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

    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');

    rerender(<StatsScreenShell {...buildShellProps({ ...sharedProps, muscleHistoryView: 'daily', isMuscleHistoryLoading: true })} />);
    expect(screen.getByTestId('stats-muscle-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');

    rerender(<StatsScreenShell {...buildShellProps({ ...sharedProps, muscleHistoryView: 'daily', muscleHistoryErrorMessage: 'Read failed', onRetryMuscleHistory: jest.fn() })} />);
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Read failed/);
    expect(screen.queryByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toBeNull();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13', { includeHiddenElements: true })).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    rerender(<StatsScreenShell {...buildShellProps({ ...sharedProps, muscleHistoryView: 'daily', isMuscleHistoryLoading: true })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');

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
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');
  });

  it('shows the active muscle metric directly in read-only daily tiles', () => {
    const props = {
      selectedMuscle: {
        muscleGroupIds: ['front_delts'] as [string],
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

    // Values are visible and announced directly, without a selection action.
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13')).toHaveProp('accessibilityLabel', '2026-05-13, Volume 1200');
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13-value')).toHaveTextContent(
      /1200/
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
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-13-value')).toHaveTextContent(
      /2/
    );
    expect(screen.getByText('Sets per day')).toBeTruthy();
  });

  it('shows the selected metric in the week selection banner', () => {
    const props = {
      selectedMuscle: {
        muscleGroupIds: ['front_delts'] as [string],
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

  it('omits the banner and instruction when no week is selected', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'] as [string],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: null,
    });

    expect(screen.queryByTestId('stats-muscle-history-week-banner')).toBeNull();
    expect(screen.queryByText(/Tap a week/)).toBeNull();
  });
});

describe('Stats route parameters', () => {
  it('validates initial breakdown query values', () => {
    expect(resolveStatsInitialBreakdown('muscle')).toBe('muscle');
    expect(resolveStatsInitialBreakdown(['exercise'])).toBe('exercise');
    expect(resolveStatsInitialBreakdown('unknown')).toBe('muscle');
    expect(resolveStatsInitialBreakdown(undefined)).toBe('muscle');
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

  it('retains period and explicit browse controls with minimal copy', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.getByTestId('stats-period-chip-7')).toHaveTextContent('This week');
    expect(screen.getByTestId('stats-view-mode-chip-muscle')).toHaveTextContent('By Muscle');
    expect(screen.queryByText('Time range')).toBeNull();
    expect(screen.queryByText('Breakdown')).toBeNull();
    expect(screen.getByTestId('stats-sessions-link')).toBeTruthy();
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
    const exerciseHeader = screen.getByTestId('stats-exercise-sort-exercise');
    expect(exerciseHeader.props.accessibilityState).toEqual({ selected: true });
    expect(within(exerciseHeader).getByText('Exercise')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveTextContent('Recent');
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).not.toHaveStyle({ opacity: 0 });
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
    expect(screen.queryByTestId('stats-exercise-history-empty')).toBeNull();
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

  it('opens history as a page sheet closed by its X or a swipe down', () => {
    renderStatsScreenShell({
      selectedExercise: { exerciseDefinitionId: 'ex1', displayName: 'Bench Press' },
    });
    expect(screen.getByTestId('stats-exercise-history')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-history-modal')).toHaveProp('presentationStyle', 'pageSheet');
    expect(screen.getByTestId('stats-exercise-history-header')).toHaveTextContent('Exercise HistoryBench Press');
    expect(screen.getByTestId('stats-exercise-history-close')).toHaveProp('accessibilityLabel', 'Close exercise history');
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

  it('calls onSearchQueryChange when typing and shows clear button', () => {
    const onSearchQueryChange = jest.fn();
    const { rerender } = render(
      <StatsScreenShell
        {...buildShellProps({
          searchQuery: '',
          viewMode: 'exercise', onSearchQueryChange,
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
          viewMode: 'exercise', searchQuery: 'Bench', onSearchQueryChange,
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


it.each([320, 430])('keeps full figures at %ipt, using another line only when needed', width => {
  const dimensions = ReactNative.Dimensions.get('window');
  act(() => ReactNative.Dimensions.set({ window: { width, height: 900, scale: 1, fontScale: 1 } }));
  const summary = buildSummary();
  summary.muscles[0].displayName = 'A very long individual muscle name';
  summary.muscles[0].current.totalVolume = 123456789;
  summary.muscles[0].previous.totalVolume = 987654321;
  renderStatsScreenShell({ summary });
  fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
  expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ flexDirection: width === 320 ? 'column' : 'row' });
  expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveTextContent('123456789');
  expect(screen.getByTestId('stats-muscle-row-chest-previous')).toHaveTextContent('987654321');
  expect(screen.getByTestId('stats-muscle-history-chest')).toHaveStyle({ minWidth: 44, minHeight: 44 });
  expect(screen.getByTestId('stats-muscle-select-chest')).toHaveStyle({ width: 44, minHeight: 44 });
  expect(screen.getByText('A very long individual muscle name').props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId('stats-muscle-row-chest-now').props.numberOfLines).toBe(1);
  act(() => ReactNative.Dimensions.set({ window: dimensions }));
});


it('keeps a twelve-digit Volume baseline and long percent readable on a small phone', () => {
  const dimensions = ReactNative.Dimensions.get('window');
  act(() => ReactNative.Dimensions.set({ window: { width: 320, height: 900, scale: 1, fontScale: 1 } }));
  const summary = buildSummary();
  summary.muscles[0].current.totalVolume = 100000000000;
  summary.muscles[0].previous.totalVolume = 1;
  renderStatsScreenShell({ summary });
  fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
  expect(screen.getByTestId('stats-muscle-row-chest-values')).toHaveStyle({ flexDirection: 'column' });
  expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveTextContent('100000000000');
  expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveTextContent('+9999999999900%');
  expect(within(screen.getByTestId('stats-muscle-row-chest')).getByText('Change')).toBeTruthy();
  act(() => ReactNative.Dimensions.set({ window: dimensions }));
});

it('returns screen-reader focus to the retained exercise row that launched history', async () => {
  const enabled = jest.spyOn(ReactNative.AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const focused = jest.spyOn(ReactNative.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  const launch = { canonical: { nativeTag: 77 } };
  const props = buildShellProps({ viewMode: 'exercise', exerciseListItems: [{ id: 'lift', name: 'Lift', workingSetCount: 1,
    totalVolume: 100, estimatedOneRepMax: null, lastCompletedAt: null }] });
  const view = render(<StatsScreenShell {...props} />);
  // The native Pressable mock has no host instance; supply its ref callback
  // so this check exercises the screen's launch/dismiss focus wiring.
  const row = screen.UNSAFE_getAllByType(ListRow).find(item => item.props.testID === 'stats-exercise-row-lift')!;
  act(() => row.props.ref(launch));
  fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  view.rerender(<StatsScreenShell {...props} selectedExercise={{ exerciseDefinitionId: 'lift', displayName: 'Lift' }} />);
  fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
  expect(focused).not.toHaveBeenCalled();
  fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
  await act(async () => {});
  expect(focused).toHaveBeenLastCalledWith(77);
  enabled.mockRestore(); focused.mockRestore();
});


it('retains the disclosure control when a wide contributor changes the row layout', () => {
  const dimensions = ReactNative.Dimensions.get('window');
  act(() => ReactNative.Dimensions.set({ window: { width: 430, height: 900, scale: 1, fontScale: 1 } }));
  const summary = buildSummary();
  const muscle = summary.muscles[0];
  muscle.exercises = [{ ...muscle, exerciseDefinitionId: 'wide', displayName: 'Wide contributor', role: 'primary',
    current: { ...muscle.current, workingSetCount: 1234567890123456 } }];
  renderStatsScreenShell({ summary });
  const disclosure = screen.getByTestId('stats-muscle-select-chest');
  expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ flexDirection: 'row' });
  fireEvent.press(disclosure);
  expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ flexDirection: 'column' });
  expect(screen.getByTestId('stats-muscle-select-chest')).toBe(disclosure);
  fireEvent.press(disclosure);
  expect(screen.getByTestId('stats-muscle-select-chest')).toBe(disclosure);
  expect(screen.getByTestId('stats-muscle-row-chest')).toHaveStyle({ flexDirection: 'row' });
  act(() => ReactNative.Dimensions.set({ window: dimensions }));
});

it.each(['reopen', 'unmount'])('ignores a pending focus check after %s', async action => {
  let resolve!: (enabled: boolean) => void;
  const enabled = jest.spyOn(ReactNative.AccessibilityInfo, 'isScreenReaderEnabled')
    .mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
  const focused = jest.spyOn(ReactNative.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  const props = buildShellProps({ viewMode: 'exercise', exerciseListItems: [
    { id: 'lift', name: 'Lift', workingSetCount: 1, totalVolume: 100, estimatedOneRepMax: null, lastCompletedAt: null },
  ] });
  const view = render(<StatsScreenShell {...props} />);
  const row = screen.UNSAFE_getAllByType(ListRow).find(item => item.props.testID === 'stats-exercise-row-lift')!;
  act(() => row.props.ref({ canonical: { nativeTag: 77 } }));
  fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  view.rerender(<StatsScreenShell {...props} selectedExercise={{ exerciseDefinitionId: 'lift', displayName: 'Lift' }} />);
  fireEvent.press(screen.getByTestId('stats-exercise-history-close'));
  fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
  if (action === 'unmount') view.unmount();
  else fireEvent.press(screen.getByTestId('stats-exercise-row-lift', { includeHiddenElements: true }));
  await act(async () => resolve(true));
  expect(focused).not.toHaveBeenCalled();
  enabled.mockRestore(); focused.mockRestore();
});
