/**
 * Stats without a database: the formatting, intensity and sort rules as pure
 * functions, and the screen shell's presentation on hand-built props (deltas,
 * shades, accessibility labels, sort cycling, the history page it opens). The
 * route over real data — queries, caches, focus reloads, navigation — is
 * `stats-screen-local-data.test.tsx`; the history page it pushes is
 * `progress-history-page.test.tsx`.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Modal, StyleSheet } from 'react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  type StatsScreenShellProps,
  type ExerciseListItem,
  type ExerciseSortHeader,
  describeExerciseSortMode,
  formatCountDelta,
  formatOneRepMaxDelta,
  formatPeriodComparison,
  formatVolumeDelta,
  nextExerciseSortMode,
  sortExerciseListItems,
} from '../app/(tabs)/stats-history';
import { breakdownParam, periodParam } from '@/components/stats/use-progress-filters';
import ProgressRoute from '../app/(tabs)/progress';
import { ListRow, uiGeometry, uiRoles } from '@/components/ui';
import {
  resolveComparisonLayout,
  type ComparisonPeriodFigures,
} from '@/components/stats/comparison-columns';
import { compareProgressVolume, type ProgressComparison } from '@/src/data/progress-comparisons';
import type { StatsSummary, ProgressComparisons } from '@/src/data';

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
  period: 'this-week',
  onSelectPeriod: jest.fn(),
  onPressSessionsCard: jest.fn(),
  onOpenMuscleHistory: jest.fn(),
  onOpenExerciseHistory: jest.fn(),
  isLoading: false,
  errorMessage: null,
  viewMode: 'muscle',
  onSelectViewMode: jest.fn(),
  tableMetric: 'workingSetCount',
  onSelectTableMetric: jest.fn(),
  exerciseMetric: 'workingSetCount',
  onSelectExerciseMetric: jest.fn(),
  exerciseListItems: [],
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

it.each([['this-week' as const, 'This week', 'week', '4 weeks', 'week'],
  ['window' as const, '4 weeks', '4 weeks', 'This week', 'weeks']])(
  'announces the %s comparison and its alternative without a visible subtitle', (period, shown, wording, alternative, unit) => {
    renderStatsScreenShell({ period, targetWindowWeeks: 4 });
    expect(screen.getByTestId('stats-period-chip')).toHaveProp('accessibilityLabel',
      `Stats period: ${shown}, vs previous ${wording}, full previous calendar ${unit}. Activate to show ${alternative}.`);
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent(shown);
    expect(screen.queryByText(`vs previous ${wording}`)).toBeNull();
    expect(screen.queryByTestId('stats-comparison-label')).toBeNull();
  });

it('leaves the period chip inert when the Progress period is one week', () => {
  renderStatsScreenShell({ period: 'window', targetWindowWeeks: 1 });
  const chip = screen.getByTestId('stats-period-chip');
  expect(chip).toHaveTextContent('This week');
  expect(chip).toHaveProp('accessibilityState', { disabled: true });
  expect(chip.props.accessibilityLabel).not.toContain('Activate');
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

  // A 1RM change is the signed difference in kg, in 1RM's own format
  // ([[comparison.change-display]]).
  it('formats a 1RM change in kg, telling a first estimate from an absent one', () => {
    expect(formatOneRepMaxDelta(104.7, 100)).toEqual({ text: '+4.7', tone: 'positive' });
    expect(formatOneRepMaxDelta(95, 100)).toEqual({ text: '−5.0', tone: 'negative' });
    expect(formatOneRepMaxDelta(100, 100)).toEqual({ text: '±0', tone: 'neutral' });
    expect(formatOneRepMaxDelta(100, null)).toEqual({ text: 'new', tone: 'new' });
    expect(formatOneRepMaxDelta(null, 100)).toEqual({ text: '—', tone: 'neutral' });
    expect(formatOneRepMaxDelta(null, null)).toEqual({ text: '—', tone: 'neutral' });
    expect(formatOneRepMaxDelta(Number.POSITIVE_INFINITY, 100)).toEqual({ text: '—', tone: 'neutral' });
    // The sign follows the figure drawn: both periods show `100.0`, so the
    // change is level rather than a `+0.0` in the improvement's colour.
    expect(formatOneRepMaxDelta(100.04, 100)).toEqual({ text: '±0', tone: 'neutral' });
    expect(formatOneRepMaxDelta(99.96, 100)).toEqual({ text: '±0', tone: 'neutral' });
    expect(formatOneRepMaxDelta(100.06, 100)).toEqual({ text: '+0.1', tone: 'positive' });
  });
});

/** A period's figures, defaulting to a genuine nothing. */
const periodFigures = (overrides: Partial<ComparisonPeriodFigures> = {}): ComparisonPeriodFigures => ({
  workingSetCount: 0, totalVolume: 0, volumeSetCount: 0, estimatedOneRepMax: null, ...overrides,
});

const listItem = (
  id: string,
  overrides: {
    name?: string;
    current?: Partial<ComparisonPeriodFigures>;
    previous?: Partial<ComparisonPeriodFigures>;
    lastCompletedAt?: Date | null;
  } = {}
): ExerciseListItem => ({
  id,
  name: overrides.name ?? id,
  current: periodFigures(overrides.current),
  previous: periodFigures(overrides.previous),
  lastCompletedAt: overrides.lastCompletedAt ?? null,
});

describe('sortExerciseListItems', () => {
  it('cycles each header exactly and starts a newly selected header at its first state', () => {
    expect(nextExerciseSortMode('now-desc', 'now')).toBe('now-asc');
    expect(nextExerciseSortMode('now-asc', 'now')).toBe('now-desc');

    expect(nextExerciseSortMode('now-desc', 'exercise')).toBe('recency-desc');
    expect(nextExerciseSortMode('recency-desc', 'exercise')).toBe('recency-asc');
    expect(nextExerciseSortMode('recency-asc', 'exercise')).toBe('recency-desc');
    expect(nextExerciseSortMode('now-asc', 'previous')).toBe('previous-desc');
    expect(nextExerciseSortMode('previous-desc', 'previous')).toBe('previous-asc');
    expect(nextExerciseSortMode('previous-asc', 'previous')).toBe('previous-desc');
    expect(nextExerciseSortMode('previous-asc', 'change')).toBe('change-desc');
    expect(nextExerciseSortMode('change-desc', 'change')).toBe('change-asc');
    expect(nextExerciseSortMode('change-asc', 'change')).toBe('change-desc');
    expect(nextExerciseSortMode('change-desc', 'now')).toBe('now-desc');
  });

  it('formats unambiguous accessibility descriptions for every sort state', () => {
    expect([
      'recency-desc',
      'recency-asc',
      'now-desc',
      'now-asc',
      'previous-desc',
      'previous-asc',
      'change-desc',
      'change-asc',
    ].map((mode) => describeExerciseSortMode(mode as Parameters<typeof describeExerciseSortMode>[0])))
      .toEqual([
        'Most recent exercise',
        'Least recent exercise',
        'Now — high to low',
        'Now — low to high',
        'Previous — high to low',
        'Previous — low to high',
        'Change — high to low',
        'Change — low to high',
      ]);
  });

  it('sorts recency in both directions with equal and missing timestamps deterministic', () => {
    const items = [
      listItem('missing', { name: 'Missing' }),
      listItem('older-b', { name: 'Same', lastCompletedAt: new Date('2026-01-01T00:00:00Z') }),
      listItem('newest', { name: 'Newest', lastCompletedAt: new Date('2026-03-01T00:00:00Z') }),
      listItem('older-a', { name: 'Same', lastCompletedAt: new Date('2026-01-01T00:00:00Z') }),
    ];

    expect(sortExerciseListItems(items, 'recency-desc').map(({ id }) => id)).toEqual([
      'newest', 'older-a', 'older-b', 'missing',
    ]);
    expect(sortExerciseListItems(items, 'recency-asc').map(({ id }) => id)).toEqual([
      'older-a', 'older-b', 'newest', 'missing',
    ]);
  });

  // Each figure column sorts by the metric in force, so one column means three
  // orders and the arrow never has to move when the metric chip is tapped.
  it('sorts a period column by the metric in force, in both directions', () => {
    const items = [
      listItem('alpha', { name: 'Alpha', current: { workingSetCount: 1, totalVolume: 300, volumeSetCount: 1 } }),
      listItem('beta', { name: 'Beta', current: { workingSetCount: 3, totalVolume: 100, volumeSetCount: 1 } }),
      listItem('gamma', { name: 'Gamma', current: { workingSetCount: 2, totalVolume: 200, volumeSetCount: 1 } }),
    ];

    expect(sortExerciseListItems(items, 'now-desc', 'workingSetCount').map(({ id }) => id)).toEqual(['beta', 'gamma', 'alpha']);
    expect(sortExerciseListItems(items, 'now-asc', 'workingSetCount').map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortExerciseListItems(items, 'now-desc', 'totalVolume').map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortExerciseListItems(items, 'now-asc', 'totalVolume').map(({ id }) => id)).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('sorts the earlier period by its own figures', () => {
    const items = [
      listItem('kept', { name: 'Kept', current: { workingSetCount: 1 }, previous: { workingSetCount: 9 } }),
      listItem('started', { name: 'Started', current: { workingSetCount: 9 }, previous: { workingSetCount: 1 } }),
    ];
    expect(sortExerciseListItems(items, 'previous-desc', 'workingSetCount').map(({ id }) => id)).toEqual(['kept', 'started']);
    expect(sortExerciseListItems(items, 'previous-asc', 'workingSetCount').map(({ id }) => id)).toEqual(['started', 'kept']);
  });

  it('sorts estimated 1RM in both directions, keeping rows without one last', () => {
    const items = [
      listItem('none-b', { name: 'Same' }),
      listItem('heavy', { name: 'Heavy', current: { estimatedOneRepMax: 140 } }),
      listItem('none-a', { name: 'Same' }),
      listItem('light', { name: 'Light', current: { estimatedOneRepMax: 60 } }),
      listItem('mid', { name: 'Mid', current: { estimatedOneRepMax: 100 } }),
    ];

    expect(sortExerciseListItems(items, 'now-desc', 'estimatedOneRepMax').map(({ id }) => id)).toEqual([
      'heavy', 'mid', 'light', 'none-a', 'none-b',
    ]);
    // Ascending flips the estimates but still parks the missing rows at the
    // bottom, so the arrow never reveals a run of em dashes.
    expect(sortExerciseListItems(items, 'now-asc', 'estimatedOneRepMax').map(({ id }) => id)).toEqual([
      'light', 'mid', 'heavy', 'none-a', 'none-b',
    ]);
  });

  // A change the column cannot put a number on — `new`, or an unavailable
  // comparison — sorts last in both directions, like an absent figure.
  it('sorts the change column by the figure it draws, sinking the ones it cannot', () => {
    const sets = [
      listItem('up', { name: 'Up', current: { workingSetCount: 9 }, previous: { workingSetCount: 1 } }),
      listItem('down', { name: 'Down', current: { workingSetCount: 1 }, previous: { workingSetCount: 4 } }),
      listItem('level', { name: 'Level', current: { workingSetCount: 3 }, previous: { workingSetCount: 3 } }),
    ];
    expect(sortExerciseListItems(sets, 'change-desc', 'workingSetCount').map(({ id }) => id)).toEqual(['up', 'level', 'down']);
    expect(sortExerciseListItems(sets, 'change-asc', 'workingSetCount').map(({ id }) => id)).toEqual(['down', 'level', 'up']);

    const volume = [
      listItem('doubled', { name: 'Doubled', current: { totalVolume: 200, volumeSetCount: 1 }, previous: { totalVolume: 100, volumeSetCount: 1 } }),
      listItem('new', { name: 'New', current: { totalVolume: 500, volumeSetCount: 1 } }),
      listItem('halved', { name: 'Halved', current: { totalVolume: 50, volumeSetCount: 1 }, previous: { totalVolume: 100, volumeSetCount: 1 } }),
    ];
    expect(sortExerciseListItems(volume, 'change-desc', 'totalVolume').map(({ id }) => id)).toEqual(['doubled', 'halved', 'new']);
    expect(sortExerciseListItems(volume, 'change-asc', 'totalVolume').map(({ id }) => id)).toEqual(['halved', 'doubled', 'new']);

    const oneRepMax = [
      listItem('gained', { name: 'Gained', current: { estimatedOneRepMax: 110 }, previous: { estimatedOneRepMax: 100 } }),
      listItem('lost', { name: 'Lost', current: { estimatedOneRepMax: 90 }, previous: { estimatedOneRepMax: 100 } }),
      listItem('first', { name: 'First', current: { estimatedOneRepMax: 200 } }),
    ];
    expect(sortExerciseListItems(oneRepMax, 'change-desc', 'estimatedOneRepMax').map(({ id }) => id)).toEqual(['gained', 'lost', 'first']);
  });

  it('uses name then ID tie-breakers and never mutates the input array', () => {
    const items = [
      listItem('z', { name: 'Same', current: { workingSetCount: 4 } }),
      listItem('b', { name: 'Bench Press', current: { workingSetCount: 7 } }),
      listItem('a', { name: 'Same', current: { workingSetCount: 4 } }),
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
    const onOpenMuscleHistory = jest.fn();
    renderStatsScreenShell({ onOpenMuscleHistory });
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.queryByTestId('stats-card-sets')).toBeNull();
    fireEvent.press(screen.getByTestId('stats-family-header-chest'));
    fireEvent.press(screen.getByTestId('stats-muscle-row-chest-now'));
    expect(onOpenMuscleHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: true });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityLabel', 'Hide Chest contributions');
    expect(screen.queryByTestId('stats-contributions-title')).toBeNull();
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
    expect(screen.queryByTestId('stats-contributions-total')).toBeNull();
    expect(within(screen.getByTestId('stats-contributions')).queryByText('Total')).toBeNull();
    expect(onOpenMuscleHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
    expect(screen.queryByTestId('stats-contributions')).toBeNull();
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveProp('accessibilityState', { expanded: false });
    fireEvent.press(screen.getByTestId('stats-muscle-history-chest'));
    expect(onOpenMuscleHistory).toHaveBeenCalledWith({ muscleGroupId: 'chest' });
    expect(screen.getByTestId('stats-muscle-select-chest')).toHaveStyle({ width: 44, minHeight: 44 });
    expect(screen.getByTestId('stats-muscle-history-chest')).toHaveStyle({ minWidth: 44, minHeight: 44 });
    expect(within(screen.getByTestId('stats-muscle-history-chest')).getByText('Chest'))
      .not.toHaveStyle({ textDecorationLine: 'underline' });
  });

  it('keeps muscle rows neutral in either metric', () => {
    const view = renderStatsScreenShell();
    expect(screen.getByTestId('stats-muscle-row-chest')).not.toHaveStyle({ backgroundColor: uiRoles.viz2 });
    view.rerender(<StatsScreenShell {...buildShellProps({ tableMetric: 'totalVolume' })} />);
    expect(screen.getByTestId('stats-muscle-row-chest')).not.toHaveStyle({ backgroundColor: uiRoles.viz2 });
    // An improvement takes `gain`; the periods beside it stay ink
    // (`design-language.md` §6).
    expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveTextContent('+20%');
    expect(screen.getByTestId('stats-muscle-row-chest-change')).toHaveStyle({ color: uiRoles.gain });
    expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveStyle({ color: uiRoles.ink });
  });

});

describe('Stats route parameters', () => {
  it('reads an entry breakdown, and tells no breakdown from an unknown one', () => {
    expect(breakdownParam('muscle')).toBe('muscle');
    expect(breakdownParam(['exercise'])).toBe('exercise');
    expect(breakdownParam('unknown')).toBe('muscle');
    // No param at all is the only case that defers to the remembered filter.
    expect(breakdownParam(undefined)).toBeNull();
  });

  it('reads an entry period, keeping ?period=7 as This week', () => {
    expect(periodParam('7')).toBe('this-week');
    expect(periodParam(['7'])).toBe('this-week');
    expect(periodParam('30')).toBe('window');
    expect(periodParam(undefined)).toBeNull();
  });
});

describe('StatsScreenShell — view mode toggle', () => {
  const buildExerciseListItem = (
    id: string,
    name: string,
    overrides: {
      current?: Partial<ComparisonPeriodFigures>;
      previous?: Partial<ComparisonPeriodFigures>;
      lastCompletedAt?: Date | null;
    } = {}
  ): ExerciseListItem => listItem(id, {
    name,
    current: { workingSetCount: 2, totalVolume: 2500, volumeSetCount: 2, estimatedOneRepMax: 110, ...overrides.current },
    previous: { workingSetCount: 1, totalVolume: 2000, volumeSetCount: 1, estimatedOneRepMax: 100, ...overrides.previous },
    lastCompletedAt: overrides.lastCompletedAt ?? null,
  });

  const sortedExerciseIds = (): string[] =>
    screen
      .getAllByTestId(/^stats-exercise-name-/)
      .map((node) => String(node.props.testID).replace('stats-exercise-name-', ''));

  it('retains period and explicit browse controls with minimal copy, and offers its own metric', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.getByTestId('stats-period-chip')).toHaveTextContent('This week');
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('Exercise');
    // The exercise table shows one metric at a time, like the muscle table,
    // and is the only breakdown that can offer 1RM.
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.getByTestId('stats-metric-chip')).toHaveProp('accessibilityLabel',
      'Progress metric: Sets. Activate to show Volume.');
    expect(screen.getByTestId('stats-search-input')).toBeTruthy();
    expect(screen.queryByText('Time range')).toBeNull();
    expect(screen.queryByText('Breakdown')).toBeNull();
    expect(screen.getByTestId('stats-sessions-link')).toBeTruthy();
  });

  it('cycles its metric through 1RM, which the muscle table never offers', () => {
    const onSelectExerciseMetric = jest.fn();
    const onSelectTableMetric = jest.fn();
    const view = renderStatsScreenShell({ viewMode: 'exercise', exerciseMetric: 'totalVolume',
      onSelectExerciseMetric, onSelectTableMetric });
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Volume');
    fireEvent.press(screen.getByTestId('stats-metric-chip'));
    expect(onSelectExerciseMetric).toHaveBeenCalledWith('estimatedOneRepMax');
    expect(onSelectTableMetric).not.toHaveBeenCalled();

    view.rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise',
      exerciseMetric: 'estimatedOneRepMax', onSelectExerciseMetric })} />);
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('1RM');
    fireEvent.press(screen.getByTestId('stats-metric-chip'));
    expect(onSelectExerciseMetric).toHaveBeenLastCalledWith('workingSetCount');

    // The muscle table keeps its own two, and its own remembered choice.
    view.rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'muscle',
      exerciseMetric: 'estimatedOneRepMax', onSelectTableMetric })} />);
    expect(screen.getByTestId('stats-metric-chip')).toHaveTextContent('Sets');
    expect(screen.getByTestId('stats-metric-chip')).toHaveProp('accessibilityLabel',
      'Progress metric: Sets. Activate to show Volume.');
  });

  it('renders one compact four-column header with the default Now sort clearly active', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseListItems: [
        buildExerciseListItem('missing', 'Long exercise name that may wrap', {
          current: { estimatedOneRepMax: null },
          previous: { estimatedOneRepMax: null },
        }),
      ],
    });

    expect(screen.getByTestId('stats-exercise-table-header')).toBeTruthy();
    const header = within(screen.getByTestId('stats-exercise-table-header'));
    expect(header.getByText('Exercise')).toBeTruthy();
    expect(header.getByText('Now')).toBeTruthy();
    expect(header.getByText('Prev')).toBeTruthy();
    expect(header.getByText('Change')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-sort-change').props.accessibilityRole).toBe(
      'button'
    );
    expect(screen.getByTestId('stats-exercise-sort-change').props.accessibilityLabel).toContain(
      'Change, working sets. Activate to sort Change — high to low.'
    );
    expect(screen.queryByTestId('stats-exercise-sort-status')).toBeNull();
    expect(screen.queryByText(/^Sorted by:/)).toBeNull();
    expect(screen.getByTestId('stats-exercise-sort-now').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('stats-exercise-sort-now').props.accessibilityLabel).toContain(
      'Current sort: Now — high to low. Activate to sort Now — low to high.'
    );
    expect(screen.getByTestId('stats-exercise-sort-exercise').props.accessibilityLabel).toContain(
      'Activate to sort Most recent exercise.'
    );
    expect(screen.getByTestId('stats-exercise-sort-now')).toHaveStyle({
      flexDirection: 'row',
      minHeight: uiGeometry.tapTarget,
    });
    expect(header.getByText('Now').props.numberOfLines).toBe(1);
    // A numeric header that outgrows its column clips on one line rather than
    // wrapping; only Exercise is allowed to wrap `Recent` under its label.
    expect(header.getByText('Change').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('stats-exercise-sort-change')).not.toHaveStyle({
      flexWrap: 'wrap',
    });
    expect(screen.getByTestId('stats-exercise-row-missing').props.accessibilityLabel).toBe(
      'Open Long exercise name that may wrap heatmap. Now 2, previous 1, change +1. working sets.'
    );
    // Inactive headers keep a transparent indicator laid out, so activating a
    // column never shifts it.
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveStyle({
      opacity: 0,
      width: 64,
    });
    expect(sortArrow('exercise')).toBe('down');
    expect(sortArrow('now')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-now-indicator')).not.toHaveStyle({ opacity: 0 });
    expect(screen.getByTestId('stats-exercise-sort-previous-indicator')).toHaveStyle({ opacity: 0 });
    expect(sortArrow('previous')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-change-indicator')).toHaveStyle({ opacity: 0 });
    expect(sortArrow('change')).toBe('down');
    expect(screen.getByTestId('stats-exercise-name-missing').props.numberOfLines).toBeUndefined();
  });

  it('draws each metric in the same three columns, change coloured by direction', () => {
    const items = [
      buildExerciseListItem('up', 'Up', {
        current: { workingSetCount: 6, totalVolume: 3000, estimatedOneRepMax: 104.7 },
        previous: { workingSetCount: 4, totalVolume: 2500, estimatedOneRepMax: 100 },
      }),
      buildExerciseListItem('down', 'Down', {
        current: { workingSetCount: 2, totalVolume: 1000, estimatedOneRepMax: 95 },
        previous: { workingSetCount: 5, totalVolume: 2000, estimatedOneRepMax: 100 },
      }),
    ];
    const view = renderStatsScreenShell({ viewMode: 'exercise', exerciseListItems: items });
    const cell = (id: string, column: string) => screen.getByTestId(`stats-exercise-row-${id}-${column}`);
    expect(cell('up', 'now')).toHaveTextContent('6');
    expect(cell('up', 'previous')).toHaveTextContent('4');
    expect(cell('up', 'change')).toHaveTextContent('+2');
    expect(cell('up', 'change')).toHaveStyle({ color: uiRoles.gain });
    expect(cell('down', 'change')).toHaveTextContent('−3');
    expect(cell('down', 'change')).toHaveStyle({ color: uiRoles.loss });
    expect(cell('up', 'now')).toHaveStyle({ color: uiRoles.ink });

    view.rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise',
      exerciseMetric: 'totalVolume', exerciseListItems: items })} />);
    expect(cell('up', 'now')).toHaveTextContent('3000');
    expect(cell('up', 'change')).toHaveTextContent('+20%');
    expect(cell('down', 'change')).toHaveTextContent('−50%');

    view.rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise',
      exerciseMetric: 'estimatedOneRepMax', exerciseListItems: items })} />);
    expect(cell('up', 'now')).toHaveTextContent('104.7');
    expect(cell('up', 'previous')).toHaveTextContent('100.0');
    expect(cell('up', 'change')).toHaveTextContent('+4.7');
    expect(cell('down', 'change')).toHaveTextContent('−5.0');
    expect(screen.getByTestId('stats-exercise-row-up').props.accessibilityLabel).toBe(
      'Open Up heatmap. Now 104.7, previous 100.0, change +4.7. kg.'
    );
    // The whole row is one target, so the figures inside offer no second
    // element of their own.
    expect(screen.getByTestId('stats-exercise-row-up-figures').props.accessible).toBeUndefined();
  });

  it('blames the metric, not the search, when no exercise has the metric at all', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseMetric: 'estimatedOneRepMax',
      searchQuery: 'press',
      exerciseListItems: [buildExerciseListItem('press', 'Bench Press', {
        current: { estimatedOneRepMax: null }, previous: { estimatedOneRepMax: null },
      })],
    });
    // The search matches the row's name; it is the metric that empties the table.
    expect(screen.getByTestId('stats-exercise-list-empty')).toHaveTextContent(
      'No exercises with 1RM estimates in either period.'
    );
  });

  it('leaves out an exercise with nothing for the metric in either period', () => {
    const items = [
      buildExerciseListItem('lifted', 'Lifted'),
      listItem('cardio', { name: 'Cardio', current: { workingSetCount: 0, totalVolume: 0, volumeSetCount: 0 } }),
    ];
    const view = renderStatsScreenShell({ viewMode: 'exercise', exerciseListItems: items });
    expect(screen.getByTestId('stats-exercise-row-lifted')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-row-cardio')).toBeNull();

    // Nothing at all for the metric is its own empty state, not "no history".
    view.rerender(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise',
      exerciseMetric: 'estimatedOneRepMax',
      exerciseListItems: [listItem('cardio', { name: 'Cardio', current: { workingSetCount: 3 } })] })} />);
    expect(screen.getByTestId('stats-exercise-list-empty')).toHaveTextContent(
      'No exercises with 1RM estimates in either period.'
    );
  });

  it('reorders rows and updates compact active indicators through every header cycle', () => {
    const onOpenExerciseHistory = jest.fn();
    renderStatsScreenShell({
      viewMode: 'exercise',
      onOpenExerciseHistory,
      exerciseListItems: [
        buildExerciseListItem('alpha', 'Alpha', {
          current: { workingSetCount: 10, totalVolume: 100, estimatedOneRepMax: null },
          previous: { workingSetCount: 1, totalVolume: 400 },
          lastCompletedAt: new Date('2026-01-01T00:00:00Z'),
        }),
        buildExerciseListItem('beta', 'Beta', {
          current: { workingSetCount: 5, totalVolume: 300, estimatedOneRepMax: 90 },
          previous: { workingSetCount: 3, totalVolume: 200 },
          lastCompletedAt: new Date('2026-03-01T00:00:00Z'),
        }),
        buildExerciseListItem('gamma', 'Gamma', {
          current: { workingSetCount: 7, totalVolume: 200, estimatedOneRepMax: 120 },
          previous: { workingSetCount: 2, totalVolume: 300 },
          lastCompletedAt: new Date('2026-02-01T00:00:00Z'),
        }),
      ],
    });

    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-now'));
    expect(sortedExerciseIds()).toEqual(['beta', 'gamma', 'alpha']);
    expect(screen.getByTestId('stats-exercise-sort-now').props.accessibilityLabel).toContain(
      'Current sort: Now — low to high'
    );
    expect(sortArrow('now')).toBe('up');
    fireEvent.press(screen.getByTestId('stats-exercise-sort-now'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    expect(screen.getByTestId('stats-exercise-sort-now').props.accessibilityLabel).toContain(
      'Current sort: Now — high to low'
    );
    expect(sortArrow('now')).toBe('down');

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

    // The earlier period has its own order, and the change its own again.
    fireEvent.press(screen.getByTestId('stats-exercise-sort-previous'));
    expect(sortedExerciseIds()).toEqual(['beta', 'gamma', 'alpha']);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-previous'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortArrow('previous')).toBe('up');

    fireEvent.press(screen.getByTestId('stats-exercise-sort-change'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'gamma', 'beta']);
    expect(sortArrow('change')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-exercise-indicator')).toHaveStyle({ opacity: 0 });
    expect(onOpenExerciseHistory).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('stats-exercise-row-gamma'));
    expect(onOpenExerciseHistory).toHaveBeenCalledWith({ exerciseDefinitionId: 'gamma' });
  });

  it('sorts by 1RM on tap, flips on the second tap, and sinks rows with no estimate', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exerciseMetric: 'estimatedOneRepMax',
      exerciseListItems: [
        buildExerciseListItem('mid', 'Mid', { current: { estimatedOneRepMax: 100 } }),
        buildExerciseListItem('none', 'None', { current: { estimatedOneRepMax: null }, previous: { estimatedOneRepMax: 100 } }),
        buildExerciseListItem('heavy', 'Heavy', { current: { estimatedOneRepMax: 140 } }),
      ],
    });

    const header = () => screen.getByTestId('stats-exercise-sort-now');
    expect(header().props.accessibilityLabel).toContain('Now, kg.');

    expect(sortedExerciseIds()).toEqual(['heavy', 'mid', 'none']);
    expect(header().props.accessibilityState).toEqual({ selected: true });
    expect(header().props.accessibilityLabel).toContain(
      'Current sort: Now — high to low. Activate to sort Now — low to high.'
    );
    expect(sortArrow('now')).toBe('down');
    expect(screen.getByTestId('stats-exercise-sort-now-indicator')).not.toHaveStyle({
      opacity: 0,
    });
    expect(screen.getByTestId('stats-exercise-sort-change-indicator')).toHaveStyle({ opacity: 0 });

    fireEvent.press(header());
    expect(sortedExerciseIds()).toEqual(['mid', 'heavy', 'none']);
    expect(header().props.accessibilityLabel).toContain('Current sort: Now — low to high');
    expect(sortArrow('now')).toBe('up');
    expect(screen.getByTestId('stats-exercise-row-none-now')).toHaveTextContent('—');
    expect(screen.getByTestId('stats-exercise-row-none-change')).toHaveTextContent('—');
  });

  it('preserves sort state while new period data, search, and Breakdown props arrive', () => {
    const initialItems = [
      buildExerciseListItem('alpha', 'Alpha', { current: { totalVolume: 100 } }),
      buildExerciseListItem('beta', 'Beta', { current: { totalVolume: 300 } }),
    ];
    const view = render(
      <StatsScreenShell
        {...buildShellProps({ viewMode: 'exercise', exerciseMetric: 'totalVolume', exerciseListItems: initialItems })}
      />
    );

    fireEvent.press(screen.getByTestId('stats-exercise-sort-previous'));
    expect(sortedExerciseIds()).toEqual(['alpha', 'beta']);
    fireEvent.press(screen.getByTestId('stats-exercise-sort-now'));
    expect(sortedExerciseIds()).toEqual(['beta', 'alpha']);

    view.rerender(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'muscle',
          period: 'window',
          exerciseMetric: 'totalVolume',
          exerciseListItems: [
            buildExerciseListItem('alpha', 'Alpha', { current: { totalVolume: 500 } }),
            buildExerciseListItem('beta', 'Beta', { current: { totalVolume: 50 } }),
          ],
        })}
      />
    );
    view.rerender(
      <StatsScreenShell
        {...buildShellProps({
          viewMode: 'exercise',
          period: 'window',
          searchQuery: 'a',
          exerciseMetric: 'totalVolume',
          exerciseListItems: [
            buildExerciseListItem('alpha', 'Alpha', { current: { totalVolume: 500 } }),
            buildExerciseListItem('beta', 'Beta', { current: { totalVolume: 50 } }),
          ],
        })}
      />
    );

    expect(screen.getByTestId('stats-exercise-sort-now').props.accessibilityLabel).toContain(
      'Current sort: Now — high to low'
    );
    expect(sortedExerciseIds()).toEqual(['alpha', 'beta']);
  });

  it('hides the stats scroll view when viewMode is exercise', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.queryByTestId('stats-scroll')).toBeNull();
  });

  it('opens an exercise row’s history page by id, drawing no sheet of its own', () => {
    const onOpenExerciseHistory = jest.fn();
    renderStatsScreenShell({ viewMode: 'exercise', onOpenExerciseHistory, exerciseListItems: [
      buildExerciseListItem('ex1', 'Bench Press'),
    ] });
    fireEvent.press(screen.getByTestId('stats-exercise-row-ex1'));
    expect(onOpenExerciseHistory).toHaveBeenCalledWith({ exerciseDefinitionId: 'ex1' });
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

});

describe('StatsScreenShell — search & filtering', () => {
  const buildExerciseListItem = (id: string, name: string): ExerciseListItem => listItem(id, {
    name,
    current: { workingSetCount: 2, totalVolume: 2500, volumeSetCount: 2, estimatedOneRepMax: 110 },
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
  render(<StatsScreenShell {...buildShellProps({ viewMode: 'exercise', exerciseMetric: 'totalVolume',
    exerciseListItems: [
      listItem('bw', { name: 'Pull-up', current: { workingSetCount: 2, totalVolume: 800, volumeSetCount: 2, estimatedOneRepMax: 127.7 } }),
      listItem('huge', { name: 'Overflowed', current: { workingSetCount: 1, totalVolume: null, volumeSetCount: 1 } }),
    ] })} />);
  expect(screen.getByTestId('stats-exercise-row-bw-now')).toHaveTextContent('800');
  expect(screen.queryByTestId('stats-exercise-coverage-bw')).toBeNull();
  expect(screen.queryByText(/Added 1RM|BW \+/i)).toBeNull();
  expect(screen.getByTestId('stats-exercise-row-bw').props.accessibilityLabel)
    .toBe('Open Pull-up heatmap. Now 800, previous 0, change new. kg·reps.');
  // A sum that is not finite is dashed, never explained ([[copy.no-inline-explanation]]).
  expect(screen.getByTestId('stats-exercise-row-huge-now')).toHaveTextContent('—');
  expect(screen.getByTestId('stats-exercise-row-huge-change')).toHaveTextContent('—');
  expect(screen.queryByTestId('stats-exercise-coverage-huge')).toBeNull();
  expect(screen.queryByText(/incomplete/i)).toBeNull();
});


it('drops the muscle table title and the header unit, keeping the unit spoken', () => {
  const view = renderStatsScreenShell();
  expect(screen.queryByText('Work by muscle')).toBeNull();
  const header = () => within(screen.getByTestId('stats-muscle-table-header'));
  expect(header().getByText('Muscle')).toBeTruthy();
  expect(header().queryByText(/kg·reps/)).toBeNull();
  expect(screen.getByLabelText('Now, working sets')).toBeTruthy();

  view.rerender(<StatsScreenShell {...buildShellProps({ tableMetric: 'totalVolume' })} />);
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

  renderStatsScreenShell({ viewMode: 'exercise', exerciseListItems: [
    listItem('ex1', { name: 'Bench Press', current: { workingSetCount: 2, totalVolume: 2500, volumeSetCount: 2, estimatedOneRepMax: 110 } }),
  ] });
  const { width: _exerciseColumn, ...exerciseFigure } = flat('stats-exercise-row-ex1-now') as { width: number };
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

describe('resolveComparisonLayout', () => {
  const row = (current: number, previous: number): ProgressComparison => ({
    current: { workingSetCount: current, totalVolume: current, volumeSetCount: 1 },
    previous: { workingSetCount: previous, totalVolume: previous, volumeSetCount: 1 },
    workingSetChange: current - previous,
    volumeChange: compareProgressVolume(current, previous),
  });

  it('keeps the figures beside the name on a current phone, in either metric', () => {
    expect(resolveComparisonLayout(375, [row(120, 100)], 'workingSetCount').stacked).toBe(false);
    expect(resolveComparisonLayout(390, [row(123456, 100000)], 'totalVolume').stacked).toBe(false);
  });

  it('moves the figures to their own line when the name loses its floor', () => {
    // 320pt: three labelled columns and the chevron leave the name too little,
    // whichever metric is shown.
    expect(resolveComparisonLayout(320, [row(120, 100)], 'workingSetCount').stacked).toBe(true);
    expect(resolveComparisonLayout(320, [row(123456, 100000)], 'totalVolume').stacked).toBe(true);
  });

  it('drops the chevron axis for a table whose rows carry no control', () => {
    // The Exercise table reserves no trailing column, so its name keeps the
    // 44pt the Muscle table holds for its disclosure: a six-digit Volume still
    // fits beside the name at 360pt there, where the Muscle table must stack.
    expect(resolveComparisonLayout(360, [row(123456, 100000)], 'totalVolume', false).stacked).toBe(false);
    expect(resolveComparisonLayout(360, [row(123456, 100000)], 'totalVolume').stacked).toBe(true);
    // The cap a column is held to grows by that axis too.
    const huge = [row(188271603422374, 1)];
    expect(Math.max(...resolveComparisonLayout(390, huge, 'totalVolume', false).columns))
      .toBeGreaterThan(Math.max(...resolveComparisonLayout(390, huge, 'totalVolume').columns));
  });

  it('keeps a sortable column wide enough for its own arrow', () => {
    // The Exercise table draws a sort indicator beside each header label; a
    // column sized to the label alone would push the arrow into the next one.
    const plain = resolveComparisonLayout(390, [row(1, 1)], 'workingSetCount', false);
    const sortable = resolveComparisonLayout(390, [row(1, 1)], 'workingSetCount', false, true);
    for (const [index, width] of sortable.columns.entries()) {
      expect(width).toBeGreaterThan(plain.columns[index]);
    }
  });

  it('caps a column so three of them and the chevron never outgrow the row', () => {
    const layout = resolveComparisonLayout(390, [row(188271603422374, 1)], 'totalVolume');
    const figures = layout.columns.reduce((sum: number, value: number) => sum + value, 0);
    expect(figures).toBeLessThanOrEqual(390 - 44);
    expect(Math.max(...layout.columns)).toBeLessThan(String(188271603422374).length * 13 * 0.61);
  });

  it('gives a column at least its own header label', () => {
    const [now, previous, change] = resolveComparisonLayout(430, [row(1, 1)], 'workingSetCount').columns;
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
  renderStatsScreenShell({ summary, tableMetric: 'totalVolume' });
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
  renderStatsScreenShell({ summary, tableMetric: 'totalVolume' });
  fireEvent.press(screen.getByTestId('stats-muscle-select-chest'));
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
  renderStatsScreenShell({ summary, tableMetric: 'totalVolume' });
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
  const props = buildShellProps({ viewMode: 'exercise', exerciseListItems: [
    listItem('lift', { name: 'Lift', current: { workingSetCount: 1, totalVolume: 100, volumeSetCount: 1 } }),
  ] });
  const view = render(<StatsScreenShell {...props} />);
  // The native Pressable mock has no host instance; supply its ref callback
  // so this check exercises the screen's launch/return focus wiring.
  const row = screen.UNSAFE_getAllByType(ListRow).find(item => item.props.testID === 'stats-exercise-row-lift')!;
  act(() => row.props.ref(launch));
  fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  // The history page is on top: Progress is unfocused and stays mounted.
  view.rerender(<StatsScreenShell {...props} isFocused={false} />);
  await act(async () => {});
  expect(focused).not.toHaveBeenCalled();
  view.rerender(<StatsScreenShell {...props} isFocused />);
  await act(async () => {});
  expect(focused).toHaveBeenLastCalledWith(77);
  enabled.mockRestore(); focused.mockRestore();
});

it('leaves the reader where it landed when the return was not from history', async () => {
  const enabled = jest.spyOn(ReactNative.AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const focused = jest.spyOn(ReactNative.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  const props = buildShellProps({ viewMode: 'exercise', exerciseListItems: [
    listItem('lift', { name: 'Lift', current: { workingSetCount: 1, totalVolume: 100, volumeSetCount: 1 } }),
  ] });
  const view = render(<StatsScreenShell {...props} />);
  const row = screen.UNSAFE_getAllByType(ListRow).find(item => item.props.testID === 'stats-exercise-row-lift')!;
  act(() => row.props.ref({ canonical: { nativeTag: 77 } }));
  fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  // Back from history once: the row is restored and then forgotten.
  view.rerender(<StatsScreenShell {...props} isFocused={false} />);
  view.rerender(<StatsScreenShell {...props} isFocused />);
  await act(async () => {});
  expect(focused).toHaveBeenCalledTimes(1);
  // Any later return — a tab, the Sessions link — leaves the reader alone.
  view.rerender(<StatsScreenShell {...props} isFocused={false} />);
  view.rerender(<StatsScreenShell {...props} isFocused />);
  await act(async () => {});
  expect(focused).toHaveBeenCalledTimes(1);
  enabled.mockRestore(); focused.mockRestore();
});

it('leaves focus alone on a first load, with no row to return to', async () => {
  const enabled = jest.spyOn(ReactNative.AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const focused = jest.spyOn(ReactNative.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  const props = buildShellProps({ viewMode: 'exercise' });
  const view = render(<StatsScreenShell {...props} isFocused={false} />);
  view.rerender(<StatsScreenShell {...props} isFocused />);
  await act(async () => {});
  expect(focused).not.toHaveBeenCalled();
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
    listItem('lift', { name: 'Lift', current: { workingSetCount: 1, totalVolume: 100, volumeSetCount: 1 } }),
  ] });
  const view = render(<StatsScreenShell {...props} />);
  const row = screen.UNSAFE_getAllByType(ListRow).find(item => item.props.testID === 'stats-exercise-row-lift')!;
  act(() => row.props.ref({ canonical: { nativeTag: 77 } }));
  fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  view.rerender(<StatsScreenShell {...props} isFocused={false} />);
  view.rerender(<StatsScreenShell {...props} isFocused />);
  if (action === 'unmount') view.unmount();
  else fireEvent.press(screen.getByTestId('stats-exercise-row-lift'));
  await act(async () => resolve(true));
  expect(focused).not.toHaveBeenCalled();
  enabled.mockRestore(); focused.mockRestore();
});

it('draws the three filter chips as one equal-width outline row', () => {
  renderStatsScreenShell({ period: 'window', targetWindowWeeks: 4 });
  const row = screen.getByTestId('stats-view-switch');
  expect(row).toHaveStyle({ flexDirection: 'row' });
  for (const [id, label] of [['stats-view-mode-chip', 'Muscle'], ['stats-period-chip', '4 weeks'],
    ['stats-metric-chip', 'Sets']] as const) {
    const chip = screen.getByTestId(id);
    expect(within(row).getByTestId(id)).toBeTruthy();
    expect(chip).toHaveStyle({ flex: 1, backgroundColor: uiRoles.surface, borderColor: uiRoles.rule });
    expect(chip).toHaveTextContent(label);
    expect(StyleSheet.flatten(within(chip).getByText(label).props.style).color).toBe(uiRoles.ink);
  }
});
