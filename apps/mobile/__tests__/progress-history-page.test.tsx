/* eslint-disable import/first */

/**
 * The Progress history page: the subject in the native title, its view and
 * metric selectors in one row, and the states the body carries over from the
 * sheet it replaced. The body renders on hand-built props; the route resolves
 * its subject from params and the catalogue cache, with the reads mocked at the
 * real repository boundary. Its races are `progress-history-races.test.tsx`;
 * the route over real data is `stats-screen-local-data.test.tsx`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as mockReact from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockScreenOptions: {
  title?: string;
  headerTitle?: (props: { children: string }) => mockReact.ReactNode;
  headerRight?: () => mockReact.ReactNode;
} = {};
let mockSearchParams: Record<string, string | string[]> = {};
const mockPush = jest.fn();
const mockSetParams = jest.fn();

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
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

const mockCatalog = {
  status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  exercises: [
    { id: 'ex1', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [], searchText: '' },
    {
      id: 'ex2', name: 'Overhead Press', loadInputMode: 'total_load', deletedAt: null, searchText: '',
      // Listed secondary first: the ⋮ still offers the primary first.
      mappings: [
        { id: 'm1', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        { id: 'm2', muscleGroupId: 'core', weight: 0.2, role: 'stabilizer' },
        { id: 'm3', muscleGroupId: 'front_delts', weight: 1, role: 'primary' },
      ],
    },
  ],
  muscleGroups: [
    { id: 'front_delts', displayName: 'Side delts', familyName: 'Shoulders', sortOrder: 20, reportGroup: null, tracked: 1 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 30, reportGroup: null, tracked: 1 },
    { id: 'core', displayName: 'Core', familyName: 'Core', sortOrder: 40, reportGroup: null, tracked: 1 },
  ],
  muscleGroupsById: {
    front_delts: { id: 'front_delts', displayName: 'Side delts', familyName: 'Shoulders', sortOrder: 20 },
    triceps: { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 30 },
    core: { id: 'core', displayName: 'Core', familyName: 'Core', sortOrder: 40 },
  },
  lastError: null,
};

jest.mock('@/src/exercise-catalog/cache', () => ({
  ensureExerciseCatalogLoaded: jest.fn().mockResolvedValue(undefined),
  useExerciseCatalog: () => mockCatalog,
  // The local-data helper resets every cache between tests; this one is mocked.
  __resetExerciseCatalogCacheForTests: jest.fn(),
}));

import {
  default as ProgressHistoryRoute,
  PROGRESS_HISTORY_TITLE,
  ProgressHistoryScreen,
  resolveHistoryMetric,
  resolveHistorySubject,
} from '../app/progress-history';
import {
  EXERCISE_HISTORY_METRIC_OPTIONS,
  HISTORY_VIEW_OPTIONS,
  HistoryView,
  MUSCLE_HISTORY_METRIC_OPTIONS,
  type HistoryViewProps,
} from '@/components/stats/history-view';
import * as heatmapData from '@/components/heatmaps/heatmapData';
import { uiRoles } from '@/components/ui';
import type { CalendarHeatmapMetric, DailyEffortMetrics, SelectedMuscleWeeklyEffort } from '@/src/data';
import * as stats from '@/src/data/stats';
import { getAccountLocalPreferenceState, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { progressHistoryHref } from '@/src/navigation/routes';
import { closeLocalData, resetLocalData } from './helpers/local-data';
import { buildMuscleSetup } from '@/src/exercise-catalog/muscle-setup';

const buildWeeklyEffort = (): SelectedMuscleWeeklyEffort => ({
  weekStartDateKey: '2026-05-11',
  monthKey: '2026-05',
  weekOfMonth: 2,
  totalVolume: 1100,
  workingSetCount: 2,
  estimatedRM1: 150,
  highestWeight: 120,
});

// In the current month: the Grid virtualizes its months, so only the newest
// one is laid out in a test render.
const DAILY_METRICS: DailyEffortMetrics[] = [
  {
    dateKey: '2026-06-03', totalVolume: 1200, workingSetCount: 2, estimatedRM1: 95, highestWeight: 80,
    // Per-muscle counts are what a Sets target is graded against.
    workingSetCountsByMuscle: { front_delts: 2 },
  },
];

const buildViewProps = (
  overrides: Partial<HistoryViewProps<CalendarHeatmapMetric>> = {}
): HistoryViewProps<CalendarHeatmapMetric> => ({
  kind: 'muscle',
  subject: 'Side delts',
  metricOptions: MUSCLE_HISTORY_METRIC_OPTIONS,
  metric: 'totalVolume',
  onSelectMetric: jest.fn(),
  view: 'weekly',
  onSelectView: jest.fn(),
  weeklyEffort: [],
  dailyMetrics: [],
  isLoading: false,
  errorMessage: null,
  lookbackWeeks: 52,
  onOpenDay: jest.fn(),
  onOpenWeek: jest.fn(),
  onRetry: jest.fn(),
  todayDateKey: '2026-06-05',
  timeline: { weekSetsTarget: { muscleGroupIds: ['side_delts'] }, onOpenSession: jest.fn() },
  ...overrides,
});

const renderHistoryView = (overrides: Partial<HistoryViewProps<CalendarHeatmapMetric>> = {}) =>
  render(<HistoryView {...buildViewProps(overrides)} />);

type HistoryKind = HistoryViewProps<CalendarHeatmapMetric>['kind'];
const metricChip = (kind: HistoryKind) => screen.getByTestId(`stats-${kind}-history-metric-chip`);
/** The metric in force: the one chip's label carries it as `<chip>-<value>`. */
const shownMetric = (kind: HistoryKind) => {
  const prefix = `stats-${kind}-history-metric-chip-`;
  return (within(metricChip(kind)).getByTestId(new RegExp(`^${prefix}`)).props.testID as string).slice(prefix.length);
};
/** Steps the metric chip, which wraps round, until it shows `metric`. */
const chooseMetric = async (kind: HistoryKind, metric: CalendarHeatmapMetric) => {
  for (let presses = 0; presses < EXERCISE_HISTORY_METRIC_OPTIONS.length && shownMetric(kind) !== metric; presses += 1) {
    await act(async () => { fireEvent.press(metricChip(kind)); });
  }
  expect(shownMetric(kind)).toBe(metric);
};
/** The nearest host view holding `node`: the row a control sits in. */
const hostRow = (node: ReturnType<typeof screen.getByTestId>) => {
  let parent = node.parent;
  while (parent && typeof parent.type !== 'string') parent = parent.parent;
  return parent;
};

const captureUiEvidence = (name: string, tree: unknown) => {
  const evidenceDir = process.env.UI_EVIDENCE_DIR;
  if (!evidenceDir) return;

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, `${name}.json`), JSON.stringify(tree, null, 2));
};

describe('resolveHistorySubject', () => {
  it('reads back the id its own href carries, for each kind', () => {
    for (const [subject, expected] of [
      [{ muscleGroupId: 'front_delts' }, { kind: 'muscle', id: 'front_delts' }],
      [{ exerciseDefinitionId: 'ex 1' }, { kind: 'exercise', id: 'ex 1' }],
    ] as const) {
      const query = String(progressHistoryHref(subject)).split('?')[1];
      const [name, value] = query.split('=');
      expect(resolveHistorySubject({ [name]: decodeURIComponent(value) })).toEqual(expected);
    }
  });

  it('reads a muscle\'s hidden secondary sets back from its href, and ignores them on an exercise', () => {
    const params = (href: string) => Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(resolveHistorySubject(params(String(progressHistoryHref({ muscleGroupId: 'quads', countSecondary: false })))))
      .toEqual({ kind: 'muscle', id: 'quads', countSecondary: false });
    expect(resolveHistorySubject({ muscleGroupId: 'quads', secondary: 'shown' })).toEqual({ kind: 'muscle', id: 'quads' });
    expect(resolveHistorySubject({ exerciseDefinitionId: 'lift', secondary: 'hidden' })).toEqual({ kind: 'exercise', id: 'lift' });
  });

  it.each(['gym a/b', null, undefined])('round-trips muscle gym scope %s', gymId => {
    const params = Object.fromEntries(new URLSearchParams(String(progressHistoryHref({ muscleGroupId: 'quads', gymId })).split('?')[1]));
    expect(resolveHistorySubject(params)).toEqual({ kind: 'muscle', id: 'quads', ...(gymId === undefined ? {} : { gymId }) });
  });

  it('takes one id per kind, and nothing from a malformed link', () => {
    expect(resolveHistorySubject({ exerciseDefinitionId: 'ex1' })).toEqual({ kind: 'exercise', id: 'ex1' });
    expect(resolveHistorySubject({ muscleGroupId: 'front_delts' })).toEqual({ kind: 'muscle', id: 'front_delts' });
    expect(resolveHistorySubject({ exerciseDefinitionId: ['ex1', 'ex2'] })).toEqual({ kind: 'exercise', id: 'ex1' });
    // Both, neither, and a blank id all name no subject.
    expect(resolveHistorySubject({ exerciseDefinitionId: 'ex1', muscleGroupId: 'front_delts' })).toBeNull();
    expect(resolveHistorySubject({})).toBeNull();
    expect(resolveHistorySubject({ muscleGroupId: ' ' })).toBeNull();
  });
});

describe('resolveHistoryMetric', () => {
  it('reads back the metric its own href carries, and nothing from a link without one', () => {
    const carried = String(progressHistoryHref({ muscleGroupId: 'front_delts' }, 'workingSetCount'));
    expect(resolveHistoryMetric(new URLSearchParams(carried.split('?')[1]).get('metric')!)).toBe('workingSetCount');
    expect(resolveHistoryMetric('volume')).toBe('totalVolume');
    // Progress's link is the only producer: anything else opens on Volume.
    expect(resolveHistoryMetric(undefined)).toBeNull();
    expect(resolveHistoryMetric('1rm')).toBeNull();
    expect(String(progressHistoryHref({ muscleGroupId: 'front_delts' }))).not.toMatch(/metric=/);
  });
});

describe('HistoryView', () => {
  it('renders the carried-over states: loading, error with retry, empty, then the chart', () => {
    const onRetry = jest.fn();
    const onOpenWeek = jest.fn();
    const { rerender, toJSON } = render(<HistoryView {...buildViewProps({ isLoading: true, onRetry, onOpenWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent('Loading Side delts history...');
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    captureUiEvidence('stats-muscle-history-loading', toJSON());

    rerender(<HistoryView {...buildViewProps({ errorMessage: 'Nope', onRetry, onOpenWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Nope/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    captureUiEvidence('stats-muscle-history-error', toJSON());

    rerender(<HistoryView {...buildViewProps({ weeklyEffort: [], onRetry, onOpenWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No history yet/);
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No Side delts training/);
    captureUiEvidence('stats-muscle-history-empty', toJSON());

    rerender(<HistoryView {...buildViewProps({
      weeklyEffort: [buildWeeklyEffort()], dailyMetrics: DAILY_METRICS, onRetry, onOpenWeek,
    })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    captureUiEvidence('stats-muscle-history-populated', toJSON());

    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-01'));
    expect(onOpenWeek).toHaveBeenCalledWith('2026-06-01');
  });

  it('names the subject in neither state while the catalogue is still resolving it', () => {
    renderHistoryView({ subject: null, isLoading: true });
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent('Loading history...');
    renderHistoryView({ subject: null, weeklyEffort: [] });
    expect(screen.getAllByTestId('stats-muscle-history-empty')[0]).toHaveTextContent(/No training was found/);
  });

  it('puts the view selector, metric chip and the page\'s filters in one row, and draws no view title', () => {
    const onSelectView = jest.fn();
    renderHistoryView({
      view: 'daily', dailyMetrics: DAILY_METRICS, weeklyEffort: [buildWeeklyEffort()],
      filters: <View testID="page-filters" />,
    });
    // The controls, side by side, above the chart: one row holds all three.
    const row = hostRow(screen.getByTestId('stats-muscle-history-view-chip-row'));
    expect(row).toBeTruthy();
    expect(hostRow(metricChip('muscle'))).toBe(row);
    expect(hostRow(screen.getByTestId('page-filters'))).toBe(row);
    expect(shownMetric('muscle')).toBe('totalVolume');
    // The removed headings: the selectors say what is shown.
    expect(screen.queryByText('Daily training load')).toBeNull();
    expect(screen.queryByText('Weekly training load')).toBeNull();

    screen.unmount();
    renderHistoryView({ view: 'weekly', weeklyEffort: [buildWeeklyEffort()], onSelectView });
    expect(screen.queryByText('Weekly training load')).toBeNull();
    expect(screen.getByTestId('stats-muscle-history-view-chip-weekly')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-daily'));
    expect(onSelectView).toHaveBeenCalledWith('daily');
  });

  it('keeps a 44pt target on the icon view segments', () => {
    renderHistoryView({ view: 'daily' });
    // 32 × 24pt segments: the control carries the rest as hit slop.
    expect(screen.getByTestId('stats-muscle-history-view-chip-daily')).toHaveProp('hitSlop', 12);
  });

  it('labels each view option by name, drawing it as an icon', () => {
    expect(HISTORY_VIEW_OPTIONS.map(option => [option.value, option.label, option.icon])).toEqual([
      ['timeline', 'Timeline', 'timeline-columns'],
      ['daily', 'Grid', 'calendar-grid'],
      ['weekly', 'Weekly', 'weekly-bars'],
    ]);
    renderHistoryView({ view: 'daily' });
    // The label is the accessible name of an icon-only segment.
    expect(screen.getByTestId('stats-muscle-history-view-chip-daily')).toHaveProp('accessibilityLabel', 'Grid');
    expect(within(screen.getByTestId('stats-muscle-history-view-chip-daily')).queryByText('Grid')).toBeNull();
  });

  it.each([['muscle', 'daily'], ['muscle', 'weekly'], ['exercise', 'daily'], ['exercise', 'weekly']] as const)(
    'shows the active %s history metric on one ink-on-surface chip in %s mode, the view keeping the fixed black ground', (kind, view) => {
      const onSelectMetric = jest.fn();
      const props = buildViewProps({
        kind,
        metricOptions: kind === 'exercise' ? EXERCISE_HISTORY_METRIC_OPTIONS : MUSCLE_HISTORY_METRIC_OPTIONS,
        view,
        onSelectMetric,
      });
      const { rerender } = render(<HistoryView {...props} />);
      const prefix = `stats-${kind}-history-metric-chip`;
      // The view selector still marks its active segment on the fixed black ground.
      expect(screen.getByTestId(`stats-${kind}-history-view-chip-${view}`)).toHaveStyle({ backgroundColor: uiRoles.selection });
      // One chip shows only the metric in force, as ink on surface, and names the next.
      expect(metricChip(kind)).toHaveStyle({ backgroundColor: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveTextContent('Volume');
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ color: uiRoles.ink });
      expect(screen.queryByTestId(`${prefix}-workingSetCount`)).toBeNull();
      expect(metricChip(kind)).toHaveProp('accessibilityLabel', 'Effort metric: Volume. Activate to show Sets.');
      fireEvent.press(metricChip(kind));
      expect(onSelectMetric).toHaveBeenLastCalledWith('workingSetCount');

      // Sets steps on to an exercise's 1RM, and wraps a muscle's two back to Volume.
      const after = kind === 'exercise' ? { value: 'estimatedRM1', label: '1RM' } : { value: 'totalVolume', label: 'Volume' };
      rerender(<HistoryView {...props} metric="workingSetCount" />);
      expect(shownMetric(kind)).toBe('workingSetCount');
      expect(metricChip(kind)).toHaveStyle({ backgroundColor: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveTextContent('Sets');
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ color: uiRoles.ink });
      expect(screen.queryByTestId(`${prefix}-totalVolume`)).toBeNull();
      expect(metricChip(kind)).toHaveProp('accessibilityLabel', `Effort metric: Sets. Activate to show ${after.label}.`);
      fireEvent.press(metricChip(kind));
      expect(onSelectMetric).toHaveBeenLastCalledWith(after.value);
    });

  it('offers every entered-load metric for an exercise and the two muscle metrics for a muscle', () => {
    expect(EXERCISE_HISTORY_METRIC_OPTIONS.map(option => option.label)).toEqual(['Volume', 'Sets', '1RM', 'Top weight']);
    expect(MUSCLE_HISTORY_METRIC_OPTIONS.map(option => option.label)).toEqual(['Volume', 'Sets']);
  });

  it.each(['muscle', 'exercise'] as const)('opens %s loading and error chrome without computing either chart', kind => {
    const build = jest.spyOn(heatmapData, 'buildHeatmapData');
    const props = buildViewProps({
      kind,
      metricOptions: kind === 'exercise' ? EXERCISE_HISTORY_METRIC_OPTIONS : MUSCLE_HISTORY_METRIC_OPTIONS,
      isLoading: true,
    });
    const { rerender } = render(<HistoryView {...props} />);
    expect(screen.getByTestId(`stats-${kind}-history-loading`)).toBeTruthy();
    expect(build).not.toHaveBeenCalled();
    rerender(<HistoryView {...props} isLoading={false} errorMessage="Failed read" />);
    expect(screen.getByTestId(`stats-${kind}-history-error`)).toBeTruthy();
    expect(build).not.toHaveBeenCalled();
    build.mockRestore();
  });

  it('keeps both heatmap views warm through loading, retry and view changes', () => {
    const shared = { weeklyEffort: [buildWeeklyEffort()], dailyMetrics: DAILY_METRICS };
    const { rerender } = render(<HistoryView {...buildViewProps({ ...shared, view: 'daily' })} />);

    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '03-06-2026, Volume 1200');

    // A reload over a drawn chart keeps it, with no loading panel above it.
    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'daily', isLoading: true })} />);
    expect(screen.queryByTestId('stats-muscle-history-loading')).toBeNull();
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '03-06-2026, Volume 1200');

    // An error drops the chart entirely rather than hiding it: no chart work
    // behind a state panel.
    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'daily', errorMessage: 'Read failed' })} />);
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Read failed/);
    expect(screen.queryByTestId('stats-muscle-history-heatmap-cell-2026-06-03', { includeHiddenElements: true })).toBeNull();
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'daily' })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toBeTruthy();

    // A visited view stays mounted behind the active one.
    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'weekly' })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-daily', { includeHiddenElements: true }))
      .toHaveStyle({ position: 'absolute', opacity: 0 });
    expect(screen.getByTestId('stats-muscle-history-heatmap-panel-weekly')).toHaveStyle({ position: 'relative', opacity: 1 });

    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'daily' })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '03-06-2026, Volume 1200');
  });

  it('shows the active muscle metric directly in read-only daily tiles', () => {
    const props = {
      weeklyEffort: [buildWeeklyEffort()], dailyMetrics: DAILY_METRICS, view: 'daily' as const,
      muscleTargets: { muscleIds: ['front_delts'], weeklyTarget: 8 },
    };
    const { rerender } = render(<HistoryView {...buildViewProps({ ...props, metric: 'totalVolume' })} />);

    // Values are visible and announced directly, without a selection action.
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '03-06-2026, Volume 1200');
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03-value')).toHaveTextContent(/1200/);
    expect(screen.getByText('% of max')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-week-banner')).toBeNull();

    rerender(<HistoryView {...buildViewProps({ ...props, metric: 'workingSetCount' })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03-value')).toHaveTextContent(/2/);
    // Muscle Sets colour grades the weekly target, so the ramp names it (0%…100%).
    expect(screen.getByText('% of target')).toBeTruthy();
    expect(screen.queryByText('Sets per day')).toBeNull();
  });
});

describe('ProgressHistoryScreen', () => {
  beforeEach(async () => {
    resetLocalData();
    mockScreenOptions = {};
    mockSearchParams = {};
    mockCatalog.status = 'ready';
    setAccountLocalPreferenceAccount('A', true);
    await act(async () => { updatePreferences({ heatmapView: 'daily', historyLookbackWeeks: 52, weeklyWorkingSetTarget: 8 }); });
    jest.spyOn(stats, 'computeSelectedMuscleHistoryEffort')
      .mockResolvedValue({ weekly: [buildWeeklyEffort()], daily: DAILY_METRICS, gyms: [] });
  });
  afterEach(() => { jest.restoreAllMocks(); closeLocalData(); });

  it.each([
    ['exercise', { exerciseDefinitionId: 'ex1' }, 'Bench Press'],
    ['muscle', { muscleGroupId: 'front_delts' }, 'Side delts'],
  ] as const)('titles the %s page with its subject', async (kind, params, title) => {
    mockSearchParams = params;
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(mockScreenOptions.title).toBe(title));
    expect(screen.getByTestId(`stats-${kind}-history-overlay`)).toBeTruthy();
    expect(screen.queryByTestId('progress-history-unavailable')).toBeNull();
  });

  it('opens on the metric Progress carried over, and on Volume without one', async () => {
    mockSearchParams = { muscleGroupId: 'front_delts', metric: 'sets' };
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(shownMetric('muscle')).toBe('workingSetCount'));

    screen.unmount();
    mockSearchParams = { exerciseDefinitionId: 'ex1' };
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(shownMetric('exercise')).toBe('totalVolume'));
  });

  it('opens a link that lands on the mounted route as a new page, on its own metric', async () => {
    mockSearchParams = { muscleGroupId: 'front_delts', metric: 'sets' };
    const { rerender } = render(<ProgressHistoryRoute />);
    await waitFor(() => expect(shownMetric('muscle')).toBe('workingSetCount'));

    mockSearchParams = { exerciseDefinitionId: 'ex1', metric: 'volume' };
    rerender(<ProgressHistoryRoute />);
    await waitFor(() => expect(shownMetric('exercise')).toBe('totalVolume'));
    expect(mockScreenOptions.title).toBe('Bench Press');
  });

  it('titles the page with the subject alone, and puts the focused week\'s sessions behind the header ⋮', async () => {
    await act(async () => { updatePreferences({ heatmapView: 'timeline' }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    // The newest week in the window is focused, and it is the week trained.
    await waitFor(() => expect(screen.getByTestId('progress-history-options-button')).toBeTruthy());
    expect(mockScreenOptions.title).toBe('Side delts');
    // The title is drawn in the sheet-title role; with no muscle setup to switch through, it is no button.
    expect(screen.getByTestId('progress-history-title-text')).toHaveTextContent('Side delts');
    expect(screen.getByTestId('progress-history-title')).toHaveProp('accessibilityRole', 'header');
    expect(screen.queryByTestId('progress-history-view-sessions')).toBeNull();

    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    // The sheet is titled with the subject; the row names the week it opens.
    expect(screen.getByTestId('progress-history-options-sheet')).toHaveTextContent(/^Side delts/);
    expect(screen.getByTestId('progress-history-view-sessions')).toHaveTextContent(/View sessions.*01-06-2026 – 07-06-2026/);
    // A muscle's own page links to no other muscle.
    expect(screen.queryByTestId(/^progress-history-muscle-/)).toBeNull();
    expect(screen.queryByTestId('progress-history-rm-curve')).toBeNull();
    expect(screen.queryByTestId('progress-history-exercise-history')).toBeNull();
    fireEvent.press(screen.getByTestId('progress-history-view-sessions'));
    expect(mockPush).toHaveBeenLastCalledWith('/sessions?week=2026-06-01');
    // Closed by the choice it answered.
    expect(screen.queryByTestId('progress-history-view-sessions')).toBeNull();
  });

  it('makes a muscle page\'s title a switch between the user\'s muscles, in Progress\'s family sections, in place', async () => {
    const setup = buildMuscleSetup(mockCatalog.muscleGroups);
    Object.assign(mockCatalog, { muscleSetup: setup });
    mockPush.mockClear();
    try {
      render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
      await waitFor(() => expect(screen.queryByTestId('stats-muscle-history-loading')).toBeNull());
      const title = screen.getByLabelText('Side delts, switch muscle');
      fireEvent.press(title);
      const sheet = screen.getByTestId('progress-history-muscle-sheet');
      // One muscle per family: no family header repeats its muscle ([[muscle.family-sections]]).
      expect(sheet).toHaveTextContent(/^Muscle(Side delts|Triceps|Core){3}$/);
      expect(within(sheet).queryAllByRole('header').map(header => header.props.children)).not.toContain('Core');
      expect(screen.getByTestId('progress-history-muscle-option-front_delts')).toHaveProp('accessibilityState', { checked: true });
      // The current muscle is no change.
      fireEvent.press(screen.getByTestId('progress-history-muscle-option-front_delts'));
      expect(mockSetParams).not.toHaveBeenCalled();
      fireEvent.press(title);
      fireEvent.press(screen.getByTestId('progress-history-muscle-option-triceps'));
      expect(mockSetParams).toHaveBeenCalledWith({ muscleGroupId: 'triceps' });
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      Object.assign(mockCatalog, { muscleSetup: undefined });
      mockSetParams.mockClear();
    }
  });

  it('draws an exercise page\'s title in the same role, with no muscle switch', async () => {
    Object.assign(mockCatalog, { muscleSetup: buildMuscleSetup(mockCatalog.muscleGroups) });
    try {
      render(<ProgressHistoryScreen subject={{ kind: 'exercise', id: 'ex1' }} todayDateKey="2026-06-05" />);
      await waitFor(() => expect(screen.queryByTestId('stats-exercise-history-loading')).toBeNull());
      expect(screen.getByTestId('progress-history-title-text')).toHaveTextContent('Bench Press');
      expect(screen.getByTestId('progress-history-title')).toHaveProp('accessibilityRole', 'header');
    } finally {
      Object.assign(mockCatalog, { muscleSetup: undefined });
    }
  });

  it('offers no ⋮ on a muscle\'s rest week, which has nothing to open', async () => {
    await act(async () => { updatePreferences({ heatmapView: 'timeline' }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('progress-history-options-button')).toBeTruthy());

    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-timeline-previous-week')); });
    expect(screen.queryByTestId('progress-history-options-button')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-timeline-next-week')); });
    expect(screen.getByTestId('progress-history-options-button')).toBeTruthy();
  });

  it('offers no ⋮ on a muscle page while a view that selects no week shows', async () => {
    await act(async () => { updatePreferences({ heatmapView: 'weekly' }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-history-view-chip-weekly'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(screen.queryByTestId('progress-history-options-button')).toBeNull();
    // Options are merged across renders, so the key must be named to clear it.
    expect(mockScreenOptions).toHaveProperty('headerRight', undefined);
    // The page's own choices are no header item: its secondary-set chip sits in the body's selector row.
    expect(within(screen.getByTestId('stats-muscle-history-overlay')).getByTestId('stats-muscle-history-secondary'))
      .toHaveProp('accessibilityState', { checked: true });
  });

  it('drops the ⋮ when the Timeline is left for another view on a muscle page', async () => {
    await act(async () => { updatePreferences({ heatmapView: 'timeline' }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('progress-history-options-button')).toBeTruthy());

    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    expect(screen.queryByTestId('progress-history-options-button')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-timeline')); });
    expect(screen.getByTestId('progress-history-options-button')).toBeTruthy();
  });

  it('links an exercise to each muscle it counts towards, primary first, from the ⋮ in any view', async () => {
    render(<ProgressHistoryScreen subject={{ kind: 'exercise', id: 'ex2', gymId: 'gym-a' }} initialMetric="workingSetCount"
      todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('progress-history-options-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    const rows = screen.getAllByTestId(/^progress-history-muscle-/);
    // A stabilizer counts nothing towards its muscle, so it is not offered.
    expect(rows.map(row => row.props.testID)).toEqual(['progress-history-muscle-front_delts', 'progress-history-muscle-triceps']);
    expect(rows[0]).toHaveTextContent(/Side delts.*Primary/);
    expect(rows[1]).toHaveTextContent(/Triceps.*Secondary/);
    // The daily view focuses no week, so there are no sessions to open.
    expect(screen.queryByTestId('progress-history-view-sessions')).toBeNull();

    fireEvent.press(rows[1]);
    // The muscle opens on the metric the exercise was showing.
    expect(mockPush).toHaveBeenLastCalledWith(progressHistoryHref({ muscleGroupId: 'triceps', gymId: 'gym-a' }, 'workingSetCount'));
    expect(screen.queryByTestId(/^progress-history-muscle-/)).toBeNull();
  });

  it('opens a muscle on Volume from an exercise-only metric', async () => {
    render(<ProgressHistoryScreen subject={{ kind: 'exercise', id: 'ex2' }} initialMetric={null}
      todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('progress-history-options-button')).toBeTruthy());
    await chooseMetric('exercise', 'estimatedRM1');

    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    fireEvent.press(screen.getByTestId('progress-history-muscle-front_delts'));
    expect(mockPush).toHaveBeenLastCalledWith(progressHistoryHref({ muscleGroupId: 'front_delts' }));
  });

  it('offers the RM curve even without counted muscles or a focused training week', async () => {
    render(<ProgressHistoryScreen subject={{ kind: 'exercise', id: 'ex1' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(mockScreenOptions.title).toBe('Bench Press'));
    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    fireEvent.press(screen.getByTestId('progress-history-rm-curve'));
    expect(mockPush).toHaveBeenLastCalledWith('/rm-curve?exerciseDefinitionId=ex1');
    expect(screen.queryByTestId('progress-history-options-sheet')).toBeNull();
  });

  it('keeps its declared title until the catalogue resolves the name', async () => {
    mockCatalog.status = 'loading';
    mockSearchParams = { exerciseDefinitionId: 'unknown-yet' };
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(mockScreenOptions.title).toBe(PROGRESS_HISTORY_TITLE));
    expect(screen.queryByTestId('progress-history-unavailable')).toBeNull();
  });

  it.each([
    ['no id', {}],
    ['both ids', { exerciseDefinitionId: 'ex1', muscleGroupId: 'front_delts' }],
    ['an id the catalogue does not hold', { muscleGroupId: 'gone' }],
    ['an exercise the catalogue does not hold', { exerciseDefinitionId: 'gone' }],
  ])('renders the unavailable state in route for %s', async (_case, params) => {
    mockSearchParams = params;
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
    expect(mockScreenOptions.title).toBe(PROGRESS_HISTORY_TITLE);
    // The chrome of the subject that vanished goes with it, rather than being
    // merged through: no stale name or live options button.
    expect(mockScreenOptions).toHaveProperty('headerRight', undefined);
    expect(screen.queryByTestId('progress-history-exercise-history')).toBeNull();
    expect(stats.computeSelectedMuscleHistoryEffort).not.toHaveBeenCalled();
  });

  it.each(['daily', 'weekly'] as const)('opens the Timeline override without changing saved %s, then lets the selector work', async saved => {
    await act(async () => { updatePreferences({ heatmapView: saved }); });
    mockSearchParams = { muscleGroupId: 'front_delts', metric: 'sets', view: ['timeline'] };
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-history-view-chip-timeline'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(shownMetric('muscle')).toBe('workingSetCount');
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe(saved);
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    await waitFor(() => expect(screen.getByTestId('stats-muscle-history-view-chip-weekly'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('weekly');
  });

  it.each(['daily', 'weekly'] as const)('opens the %s override with Volume without writing the saved view', async view => {
    const saved = view === 'daily' ? 'weekly' : 'daily';
    await act(async () => { updatePreferences({ heatmapView: saved }); });
    mockSearchParams = { muscleGroupId: 'front_delts', metric: 'volume', view };
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId(`stats-muscle-history-view-chip-${view}`))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(shownMetric('muscle')).toBe('totalVolume');
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe(saved);
  });

  it('applies the exercise Timeline override and resolves a mounted link without an override back to the saved view', async () => {
    mockSearchParams = { exerciseDefinitionId: 'ex1', metric: 'volume', view: 'timeline' };
    const page = render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-view-chip-timeline'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('daily');
    mockSearchParams = { exerciseDefinitionId: 'ex1', metric: 'volume', view: 'invalid' };
    page.rerender(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-view-chip-daily'))
      .toHaveProp('accessibilityState', { selected: true }));
  });

  it('combines gym and entry-view params, remounting either change without saving the view', async () => {
    await act(async () => { updatePreferences({ heatmapView: 'weekly' }); });
    mockSearchParams = { exerciseDefinitionId: 'ex1', gymId: 'gym-a', metric: 'volume', view: 'timeline' };
    const page = render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-view-chip-timeline'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(screen.UNSAFE_getByType(HistoryView).props.timeline.weekSetsTarget)
      .toEqual({ exerciseDefinitionId: 'ex1', gymId: 'gym-a' });
    await chooseMetric('exercise', 'workingSetCount');

    mockSearchParams = { ...mockSearchParams, view: 'daily' };
    page.rerender(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('stats-exercise-history-view-chip-daily'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(shownMetric('exercise')).toBe('totalVolume');
    await chooseMetric('exercise', 'workingSetCount');

    mockSearchParams = { ...mockSearchParams, gymId: 'no-gym' };
    page.rerender(<ProgressHistoryRoute />);
    await waitFor(() => expect(shownMetric('exercise')).toBe('totalVolume'));
    expect(screen.UNSAFE_getByType(HistoryView).props.timeline.weekSetsTarget)
      .toEqual({ exerciseDefinitionId: 'ex1', gymId: null });
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('weekly');
  });

  it('switching the view saves it, so the next history page opens in it', async () => {
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-history-view-chip-daily'))
      .toHaveProp('accessibilityState', { selected: true }));
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('weekly');
    expect(screen.getByTestId('stats-muscle-history-view-chip-weekly')).toHaveProp('accessibilityState', { selected: true });
  });

  it('keeps a view whose save failed as a draft, and says so with a Retry', async () => {
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByTestId('stats-muscle-history-view-chip-daily'))
      .toHaveProp('accessibilityState', { selected: true }));
    expect(screen.queryByTestId('progress-history-preferences-error')).toBeNull();

    const write = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-weekly')); });
    // The choice holds as a draft, and the failure is not silent: this is the
    // only screen that offers the view now.
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('daily');
    expect(getAccountLocalPreferenceState().pending.heatmapView).toBe('weekly');
    expect(screen.getByTestId('stats-muscle-history-view-chip-weekly')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('progress-history-preferences-error')).toHaveTextContent(/could not be saved/);

    write.mockRestore();
    await act(async () => { fireEvent.press(screen.getByTestId('progress-history-preferences-retry')); });
    expect(getAccountLocalPreferenceState().values.heatmapView).toBe('weekly');
    expect(screen.queryByTestId('progress-history-preferences-error')).toBeNull();
  });

  it('grades a muscle page’s Sets against the saved weekly target for that one muscle', async () => {
    await act(async () => { updatePreferences({ weeklyWorkingSetTarget: 8, muscleTargetMode: 'per-muscle',
      muscleTargetOverrides: { detailed: { front_delts: 4 }, broad: { front_delts: 16 } } }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByText('% of max')).toBeTruthy());
    expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledWith(
      expect.objectContaining({ muscleGroupIds: ['front_delts'] })
    );
    // Only Sets is target-graded, and the page grades this one muscle alone.
    await chooseMetric('muscle', 'workingSetCount');
    expect(screen.getByText('% of target')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03'))
      .toHaveProp('accessibilityLabel', expect.stringContaining('50% of weekly muscle target'));
  });
});
