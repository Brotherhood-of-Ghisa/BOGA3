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
  type ExerciseSortHeader,
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
import { resolveLayout } from '@/components/stats/progress-tables';
import { compareProgressVolume, type ProgressComparison } from '@/src/data/progress-comparisons';
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
      current: { workingSetCount: row.workingSetCount, totalVolume: row.totalVolume, volumeSetCount: row.totalVolume ? 1 : 0 },
      previous: { workingSetCount: old?.workingSetCount ?? 0, totalVolume: old?.totalVolume ?? 0, volumeSetCount: old?.totalVolume ? 1 : 0 },
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
const sortArrow = (header: ExerciseSortHeader): 'up' | 'down' | null => {
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

it.each([[7, 'week'], [28, '4 weeks']])('announces the %i-day comparison without a visible subtitle', (periodDays, wording) => {
  renderStatsScreenShell({ periodDays });
  const label = `${periodDays === 7 ? 'This week' : '4 weeks'}, vs previous ${wording}, same elapsed calendar span`;
  expect(screen.getByRole('tab', { name: label })).toHaveProp('accessibilityState', { selected: true });
  expect(screen.queryByText(`vs previous ${wording}`)).toBeNull();
  expect(screen.queryByTestId('stats-comparison-label')).toBeNull();
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
    expect(nextExerciseSortMode('volume-asc', 'oneRepMax')).toBe('oneRepMax-desc');
    expect(nextExerciseSortMode('oneRepMax-desc', 'oneRepMax')).toBe('oneRepMax-asc');
    expect(nextExerciseSortMode('oneRepMax-asc', 'oneRepMax')).toBe('oneRepMax-desc');
    expect(nextExerciseSortMode('oneRepMax-desc', 'sets')).toBe('sets-desc');
  });

  it('formats unambiguous accessibility descriptions for every sort state', () => {
    expect([
      'recency-desc',
      'recency-asc',
      'sets-desc',
      'sets-asc',
      'volume-desc',
      'volume-asc',
      'oneRepMax-desc',
      'oneRepMax-asc',
    ].map((mode) => describeExerciseSortMode(mode as Parameters<typeof describeExerciseSortMode>[0])))
      .toEqual([
        'Most recent exercise',
        'Least recent exercise',
        'Sets — high to low',
        'Sets — low to high',
        'Volume — high to low',
        'Volume — low to high',
        '1RM — high to low',
        '1RM — low to high',
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

  it('sorts estimated 1RM in both directions, keeping rows without one last', () => {
    const items = [
      item('none-b', { name: 'Same', estimatedOneRepMax: null }),
      item('heavy', { name: 'Heavy', estimatedOneRepMax: 140 }),
      item('none-a', { name: 'Same', estimatedOneRepMax: null }),
      item('light', { name: 'Light', estimatedOneRepMax: 60 }),
      item('mid', { name: 'Mid', estimatedOneRepMax: 100 }),
    ];

    expect(sortExerciseListItems(items, 'oneRepMax-desc').map(({ id }) => id)).toEqual([
      'heavy', 'mid', 'light', 'none-a', 'none-b',
    ]);
    // Ascending flips the estimates but still parks the missing rows at the
    // bottom, so the arrow never reveals a run of em dashes.
    expect(sortExerciseListItems(items, 'oneRepMax-asc').map(({ id }) => id)).toEqual([
      'light', 'mid', 'heavy', 'none-a', 'none-b',
    ]);
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
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(screen.getByTestId('stats-contributions')).queryByText('Total')).toBeNull();
    expect(onPressMuscleHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: false });
    fireEvent.press(screen.getByTestId('stats-muscle-history-chest'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({ muscleGroupIds: ['chest'], displayName: 'Chest', familyName: 'Chest' });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveStyle({ width: 44, minHeight: 44 });
    expect(screen.getByTestId('stats-muscle-history-chest')).toHaveStyle({ minWidth: 44, minHeight: 44 });
    expect(within(screen.getByTestId('stats-muscle-history-chest')).getByText('Chest'))
      .not.toHaveStyle({ textDecorationLine: 'underline' });
  });

  it('keeps muscle rows neutral in either metric', () => {
    renderStatsScreenShell();
    expect(screen.getByTestId('stats-muscle-row-chest')).not.toHaveStyle({ backgroundColor: uiRoles.viz2 });
    fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
    expect(screen.getByTestId('stats-muscle-row-chest')).not.toHaveStyle({ backgroundColor: uiRoles.viz2 });
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
    'uses fixed black and white for the active %s history metric in %s mode', (kind, view) => {
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
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ backgroundColor: uiRoles.selection });
      expect(within(screen.getByTestId(`${prefix}-totalVolume`)).getByText('Volume')).toHaveStyle({ color: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.surface });
      fireEvent.press(screen.getByTestId(`${prefix}-workingSetCount`));
      expect(onSelectMetric).toHaveBeenCalledWith('workingSetCount');

      rerender(<StatsScreenShell {...props} muscleHistoryMetric="workingSetCount" exerciseHistoryMetric="workingSetCount" />);
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.selection });
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
    // Muscle Sets colour grades the weekly target, so the ramp names it (0%…100%).
    expect(screen.getByText('Weekly target')).toBeTruthy();
    expect(screen.queryByText('Sets per day')).toBeNull();
  });

  it.each(['totalVolume', 'workingSetCount'] as const)('omits the selected-week banner for %s and keeps Metric controls', metric => {
    renderStatsScreenShell({
      selectedMuscle: { muscleGroupIds: ['front_delts'], displayName: 'Front Delts', familyName: 'Shoulders' },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: '2026-05-11',
      muscleHistoryMetric: metric,
    });
    expect(screen.queryByTestId('stats-muscle-history-week-banner')).toBeNull();
    expect(screen.getByTestId(`stats-muscle-history-metric-chip-${metric}`)).toBeTruthy();
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
    expect(screen.queryByTestId('stats-exercise-header-oneRepMax')).toBeNull();
    expect(screen.getByTestId('stats-exercise-sort-oneRepMax').props.accessibilityRole).toBe(
      'button'
    );
    expect(screen.getByTestId('stats-exercise-sort-oneRepMax').props.accessibilityLabel).toContain(
      '1RM. Activate to sort 1RM — high to low.'
    );
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
    // A numeric header that outgrows its column clips on one line rather than
    // wrapping; only Exercise is allowed to wrap `Recent` under its label.
    expect(header.getByText('1RM').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('stats-exercise-sort-oneRepMax')).not.toHaveStyle({
      flexWrap: 'wrap',
    });
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
    expect(screen.getByTestId('stats-exercise-sort-oneRepMax-indicator')).toHaveStyle({ opacity: 0 });
    expect(sortArrow('oneRepMax')).toBe('down');
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

  it('sorts by 1RM on tap, flips on the second tap, and sinks rows with no estimate', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseListItems: [
        buildExerciseListItem('mid', 'Mid', { estimatedOneRepMax: 100 }),
        buildExerciseListItem('none', 'None', { estimatedOneRepMax: null }),
        buildExerciseListItem('heavy', 'Heavy', { estimatedOneRepMax: 140 }),
      ],
    });

    const header = () => screen.getByTestId('stats-exercise-sort-oneRepMax');
    expect(header().props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(header());
    expect(sortedExerciseIds()).toEqual(['heavy', 'mid', 'none']);
    expect(header().props.accessibilityState).toEqual({ selected: true });
    expect(header().props.accessibilityLabel).toContain(
      'Current sort: 1RM — high to low. Activate to sort 1RM — low to high.'
    );
    expect(sortArrow('oneRepMax')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-oneRepMax-indicator')).not.toHaveStyle({
      opacity: 0,
    });
    expect(screen.getByTestId('stats-exercise-sort-sets-indicator')).toHaveStyle({ opacity: 0 });

    fireEvent.press(header());
    expect(sortedExerciseIds()).toEqual(['mid', 'heavy', 'none']);
    expect(header().props.accessibilityLabel).toContain('Current sort: 1RM — low to high');
    expect(sortArrow('oneRepMax')).toBe('up');
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

it('shows Volume with no coverage note and uses ordinary strength copy for bodyweight arithmetic', () => {
  render(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise', exerciseListItems: [{
    id: 'bw', name: 'Pull-up', workingSetCount: 2,
    totalVolume: 800, estimatedOneRepMax: 127.7, lastCompletedAt: null,
  }, {
    id: 'huge', name: 'Overflowed', workingSetCount: 1,
    totalVolume: null, estimatedOneRepMax: null, lastCompletedAt: null,
  }] })} />);
  expect(screen.getByTestId('stats-exercise-volume-bw')).toHaveTextContent('800');
  expect(screen.queryByTestId('stats-exercise-coverage-bw')).toBeNull();
  expect(screen.queryByText(/Added 1RM|BW \+/i)).toBeNull();
  expect(screen.getByTestId('stats-exercise-row-bw').props.accessibilityLabel)
    .toBe('Open Pull-up heatmap. 2 sets. Volume 800. Estimated one rep max 127.7 kg');
  // A sum that is not finite is dashed, never explained ([[copy.no-inline-explanation]]).
  expect(screen.getByTestId('stats-exercise-volume-huge')).toHaveTextContent('—');
  expect(screen.queryByTestId('stats-exercise-coverage-huge')).toBeNull();
  expect(screen.queryByText(/incomplete/i)).toBeNull();
});


it('drops the muscle table title and the header unit, keeping the unit spoken', () => {
  renderStatsScreenShell();
  expect(screen.queryByText('Work by muscle')).toBeNull();
  const header = () => within(screen.getByTestId('stats-muscle-table-header'));
  expect(header().getByText('Muscle')).toBeTruthy();
  expect(header().queryByText(/kg·reps/)).toBeNull();
  expect(screen.getByLabelText('Now, working sets')).toBeTruthy();

  fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
  expect(header().queryByText(/kg·reps/)).toBeNull();
  expect(header().getByText('Now')).toBeTruthy();
  expect(header().getByText('Prev')).toBeTruthy();
  for (const column of ['Now', 'Previous', 'Change']) {
    expect(screen.getByLabelText(`${column}, kg·reps`)).toBeTruthy();
  }
  expect(screen.getByTestId('stats-muscle-row-chest-figures').props.accessibilityLabel)
    .toBe('Now 1800, previous 1500, change +20%. kg·reps.');
});

it('draws both breakdowns in one table style', () => {
  const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);
  const labelStyle = (testID: string, label: string) =>
    StyleSheet.flatten(within(screen.getByTestId(testID)).getByText(label).props.style);

  const muscleView = renderStatsScreenShell();
  const muscleTable = flat('stats-muscle-table');
  const muscleHeader = flat('stats-muscle-table-header');
  const muscleLabel = labelStyle('stats-muscle-table-header', 'Muscle');
  const muscleName = labelStyle('stats-muscle-row-chest', 'Chest');
  const { width: _muscleColumn, ...muscleFigure } = flat('stats-muscle-row-chest-now') as { width: number };
  muscleView.unmount();

  renderStatsScreenShell({ viewMode: 'exercise', exerciseListItems: [{
    id: 'ex1', name: 'Bench Press', workingSetCount: 2, totalVolume: 2500,
    estimatedOneRepMax: 110, lastCompletedAt: null,
  }] });
  const { width: _exerciseColumn, ...exerciseFigure } = flat('stats-exercise-sets-ex1') as { width: number };
  // One card, one header row, one micro-label, one name and one figure style;
  // only the column widths belong to each table (issue #636).
  expect(muscleTable).toEqual(flat('stats-exercise-list'));
  expect(muscleHeader).toEqual(flat('stats-exercise-table-header'));
  expect(muscleLabel).toEqual(labelStyle('stats-exercise-table-header', 'Exercise'));
  expect(muscleName).toEqual(labelStyle('stats-exercise-row-ex1', 'Bench Press'));
  expect(muscleFigure).toEqual(exerciseFigure);
});

it('bands a muscle family without giving it a figure of its own', () => {
  renderStatsScreenShell();
  const band = screen.getByTestId('stats-family-header-shoulders');
  expect(band).toHaveTextContent('Shoulders');
  expect(band.props.accessibilityRole).toBe('header');
  expect(band.props.onPress).toBeUndefined();
  // Only its muscles carry figures: a set mapped to two muscles of one family
  // counts in both rows, so a family sum would overstate the work.
  expect(within(band).queryByText(/\d/)).toBeNull();
  expect(screen.queryByTestId('stats-family-header-shoulders-figures')).toBeNull();
  expect(screen.getByTestId('stats-muscle-row-front_delts-figures')).toBeTruthy();
  expect(screen.getByTestId('stats-muscle-row-rear_delts-figures')).toBeTruthy();
});

describe('resolveLayout', () => {
  const row = (current: number, previous: number): ProgressComparison => ({
    current: { workingSetCount: current, totalVolume: current, volumeSetCount: 1 },
    previous: { workingSetCount: previous, totalVolume: previous, volumeSetCount: 1 },
    workingSetChange: current - previous,
    volumeChange: compareProgressVolume(current, previous),
  });

  it('keeps the figures beside the name on a current phone, in either metric', () => {
    expect(resolveLayout(375, [row(120, 100)], 'workingSetCount').stacked).toBe(false);
    expect(resolveLayout(390, [row(123456, 100000)], 'totalVolume').stacked).toBe(false);
  });

  it('moves the figures to their own line when the name loses its floor', () => {
    // 320pt: three labelled columns and the chevron leave the name too little,
    // whichever metric is shown.
    expect(resolveLayout(320, [row(120, 100)], 'workingSetCount').stacked).toBe(true);
    expect(resolveLayout(320, [row(123456, 100000)], 'totalVolume').stacked).toBe(true);
  });

  it('caps a column so three of them and the chevron never outgrow the row', () => {
    const layout = resolveLayout(390, [row(188271603422374, 1)], 'totalVolume');
    const figures = layout.columns.reduce((sum, value) => sum + value, 0);
    expect(figures).toBeLessThanOrEqual(390 - 44);
    expect(Math.max(...layout.columns)).toBeLessThan(String(188271603422374).length * 13 * 0.61);
  });

  it('gives a column at least its own header label', () => {
    const [now, previous, change] = resolveLayout(430, [row(1, 1)], 'workingSetCount').columns;
    expect(now).toBeLessThan(previous);
    expect(previous).toBeLessThan(change);
  });
});

/** A figure cell's reserved column width, as drawn. */
const columnWidth = (testID: string): number =>
  (StyleSheet.flatten(screen.getByTestId(testID).props.style) as { width: number }).width;

it.each([320, 430])('keeps full figures at %ipt, using another line only when needed', width => {
  const dimensions = ReactNative.Dimensions.get('window');
  act(() => ReactNative.Dimensions.set({ window: { width, height: 900, scale: 1, fontScale: 1 } }));
  const summary = buildSummary();
  summary.muscles[0].displayName = 'A very long individual muscle name';
  summary.muscles[0].current.totalVolume = 123456789;
  summary.muscles[0].previous.totalVolume = 987654321;
  renderStatsScreenShell({ summary });
  fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
  // Nine digits beside a long name do not fit a small phone's row, so the
  // figures take their own full-width line under it; neither is abbreviated.
  const stackedFigures = { width: '100%' };
  if (width === 320) expect(screen.getByTestId('stats-muscle-row-chest-figures')).toHaveStyle(stackedFigures);
  else expect(screen.getByTestId('stats-muscle-row-chest-figures')).not.toHaveStyle(stackedFigures);
  expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveTextContent('123456789');
  expect(screen.getByTestId('stats-muscle-row-chest-previous')).toHaveTextContent('987654321');
  expect(screen.getByTestId('stats-muscle-history-chest')).toHaveStyle({ minWidth: 44, minHeight: 44 });
  expect(screen.getByTestId('stats-muscle-select-chest')).toHaveStyle({ width: 44, minHeight: 44 });
  expect(screen.getByText('A very long individual muscle name').props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId('stats-muscle-row-chest-now').props.numberOfLines).toBeUndefined();
  act(() => ReactNative.Dimensions.set({ window: dimensions }));
});


it.each([375, 430])('uses the full row width for parent and contribution figures below names at %ipt', width => {
  const dimensions = ReactNative.Dimensions.get('window');
  act(() => ReactNative.Dimensions.set({ window: { width, height: 900, scale: 1, fontScale: 1 } }));
  const summary = buildSummary();
  const muscle = summary.muscles[0];
  muscle.current.totalVolume = 188271603422374;
  muscle.previous.totalVolume = 6172839456170;
  muscle.exercises = [{ exerciseDefinitionId: 'bench', displayName: 'Long exercise name', role: 'primary',
    current: muscle.current, previous: muscle.previous, workingSetChange: muscle.workingSetChange, volumeChange: muscle.volumeChange }];
  renderStatsScreenShell({ summary });
  fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
  fireEvent.press(screen.getByTestId('stats-metric-chip-totalVolume'));
  expect(screen.getByTestId('stats-muscle-row-chest-figures')).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('stats-contribution-bench-figures')).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('stats-muscle-row-chest-figures').props.accessibilityLabel)
    .toMatch(/^Now 188271603422374, previous 6172839456170, change .*\. kg·reps\.$/);
  expect(screen.getByTestId('stats-contribution-bench-now')).toHaveTextContent('188271603422374');
  expect(screen.getByTestId('stats-contribution-bench-previous')).toHaveTextContent('6172839456170');
  // A contributor's figures stay on its muscle's columns, whatever the width.
  for (const key of ['now', 'previous', 'change']) {
    expect(columnWidth(`stats-contribution-bench-${key}`))
      .toBe(columnWidth(`stats-muscle-row-chest-${key}`));
  }
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
  // Every digit is kept: the figures take their own line, and one too wide for
  // its capped column wraps inside it rather than shrinking or abbreviating.
  expect(screen.getByTestId('stats-muscle-row-chest-figures')).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveTextContent('100000000000');
  expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveTextContent('+9999999999900%');
  expect(columnWidth('stats-muscle-row-chest-change')).toBeLessThan(320);
  // The columns are named once, in the table's header.
  expect(within(screen.getByTestId('stats-muscle-table-header')).getByText('Change')).toBeTruthy();
  expect(within(screen.getByTestId('stats-muscle-row-chest')).queryByText('Change')).toBeNull();
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
  const figures = () => screen.getByTestId('stats-muscle-row-chest-figures');
  expect(figures()).not.toHaveStyle({ width: '100%' });
  fireEvent.press(disclosure);
  expect(figures()).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('stats-muscle-select-chest')).toBe(disclosure);
  fireEvent.press(disclosure);
  expect(screen.getByTestId('stats-muscle-select-chest')).toBe(disclosure);
  expect(figures()).not.toHaveStyle({ width: '100%' });
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

it('uses fixed black and white for active Progress filters', () => {
  renderStatsScreenShell({ periodDays: 28 });
  for (const id of ['stats-view-mode-chip-muscle', 'stats-period-chip-28', 'stats-metric-chip-workingSetCount']) {
    const segment = screen.getByTestId(id);
    expect(segment).toHaveStyle({ backgroundColor: '#000000' });
    expect(segment).toHaveProp('accessibilityState', { selected: true });
    expect(StyleSheet.flatten(within(segment).getByText(/.+/).props.style).color).toBe('#FFFFFF');
  }
});
