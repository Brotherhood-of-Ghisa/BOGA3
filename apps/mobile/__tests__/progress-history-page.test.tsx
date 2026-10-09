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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockScreenOptions: { title?: string } = {};
let mockSearchParams: Record<string, string | string[]> = {};

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

const mockCatalog = {
  status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  exercises: [{ id: 'ex1', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [], searchText: '' }],
  muscleGroups: [{ id: 'front_delts', displayName: 'Side delts', familyName: 'Shoulders', sortOrder: 20 }],
  muscleGroupsById: {
    front_delts: { id: 'front_delts', displayName: 'Side delts', familyName: 'Shoulders', sortOrder: 20 },
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
  selectedWeekKey: null,
  onSelectWeek: jest.fn(),
  onRetry: jest.fn(),
  todayDateKey: '2026-06-05',
  timeline: { weekSetsTarget: { muscleGroupIds: ['side_delts'] }, onViewSessions: jest.fn(), onOpenSession: jest.fn() },
  ...overrides,
});

const renderHistoryView = (overrides: Partial<HistoryViewProps<CalendarHeatmapMetric>> = {}) =>
  render(<HistoryView {...buildViewProps(overrides)} />);

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

describe('HistoryView', () => {
  it('renders the carried-over states: loading, error with retry, empty, then the chart', () => {
    const onRetry = jest.fn();
    const onSelectWeek = jest.fn();
    const { rerender, toJSON } = render(<HistoryView {...buildViewProps({ isLoading: true, onRetry, onSelectWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent('Loading Side delts history...');
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    captureUiEvidence('stats-muscle-history-loading', toJSON());

    rerender(<HistoryView {...buildViewProps({ errorMessage: 'Nope', onRetry, onSelectWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Nope/);
    fireEvent.press(screen.getByTestId('stats-muscle-history-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    captureUiEvidence('stats-muscle-history-error', toJSON());

    rerender(<HistoryView {...buildViewProps({ weeklyEffort: [], onRetry, onSelectWeek })} />);
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No history yet/);
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No Side delts training/);
    captureUiEvidence('stats-muscle-history-empty', toJSON());

    rerender(<HistoryView {...buildViewProps({
      weeklyEffort: [buildWeeklyEffort()], selectedWeekKey: '2026-05-11', onRetry, onSelectWeek,
    })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    captureUiEvidence('stats-muscle-history-populated', toJSON());

    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-11'));
    expect(onSelectWeek).toHaveBeenCalledWith(null); // deselect since it's already selected
  });

  it('names the subject in neither state while the catalogue is still resolving it', () => {
    renderHistoryView({ subject: null, isLoading: true });
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent('Loading history...');
    renderHistoryView({ subject: null, weeklyEffort: [] });
    expect(screen.getAllByTestId('stats-muscle-history-empty')[0]).toHaveTextContent(/No training was found/);
  });

  it('puts the view and metric selectors in one row, and draws no view title', () => {
    const onSelectView = jest.fn();
    renderHistoryView({ view: 'daily', dailyMetrics: DAILY_METRICS, weeklyEffort: [buildWeeklyEffort()] });
    // Both controls, side by side, above the chart.
    expect(screen.getByTestId('stats-muscle-history-view-chip-row')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-row')).toBeTruthy();
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
    'uses fixed black and white for the active %s history metric in %s mode', (kind, view) => {
      const onSelectMetric = jest.fn();
      const props = buildViewProps({
        kind,
        metricOptions: kind === 'exercise' ? EXERCISE_HISTORY_METRIC_OPTIONS : MUSCLE_HISTORY_METRIC_OPTIONS,
        view,
        onSelectMetric,
      });
      const { rerender } = render(<HistoryView {...props} />);
      const prefix = `stats-${kind}-history-metric-chip`;
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ backgroundColor: uiRoles.selection });
      expect(within(screen.getByTestId(`${prefix}-totalVolume`)).getByText('Volume')).toHaveStyle({ color: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.surface });
      fireEvent.press(screen.getByTestId(`${prefix}-workingSetCount`));
      expect(onSelectMetric).toHaveBeenCalledWith('workingSetCount');

      rerender(<HistoryView {...props} metric="workingSetCount" />);
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveStyle({ backgroundColor: uiRoles.selection });
      expect(screen.getByTestId(`${prefix}-workingSetCount`)).toHaveProp('accessibilityState', { selected: true });
      expect(within(screen.getByTestId(`${prefix}-workingSetCount`)).getByText('Sets')).toHaveStyle({ color: uiRoles.surface });
      expect(screen.getByTestId(`${prefix}-totalVolume`)).toHaveStyle({ backgroundColor: uiRoles.surface });
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

    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '2026-06-03, Volume 1200');

    rerender(<HistoryView {...buildViewProps({ ...shared, view: 'daily', isLoading: true })} />);
    expect(screen.getByTestId('stats-muscle-history-loading')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-empty')).toBeNull();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '2026-06-03, Volume 1200');

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
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '2026-06-03, Volume 1200');
  });

  it('shows the active muscle metric directly in read-only daily tiles', () => {
    const props = {
      weeklyEffort: [buildWeeklyEffort()], dailyMetrics: DAILY_METRICS, view: 'daily' as const,
      muscleTargets: { muscleIds: ['front_delts'], weeklyTarget: 8 },
    };
    const { rerender } = render(<HistoryView {...buildViewProps({ ...props, metric: 'totalVolume' })} />);

    // Values are visible and announced directly, without a selection action.
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03')).toHaveProp('accessibilityLabel', '2026-06-03, Volume 1200');
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03-value')).toHaveTextContent(/1200/);
    expect(screen.getByText('Volume per day')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-week-banner')).toBeNull();

    rerender(<HistoryView {...buildViewProps({ ...props, metric: 'workingSetCount' })} />);
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03-value')).toHaveTextContent(/2/);
    // Muscle Sets colour grades the weekly target, so the ramp names it (0%…100%).
    expect(screen.getByText('Weekly target')).toBeTruthy();
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
      .mockResolvedValue({ weekly: [buildWeeklyEffort()], daily: DAILY_METRICS });
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
  ])('renders the unavailable state in route for %s', async (_case, params) => {
    mockSearchParams = params;
    render(<ProgressHistoryRoute />);
    await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
    expect(mockScreenOptions.title).toBe(PROGRESS_HISTORY_TITLE);
    expect(stats.computeSelectedMuscleHistoryEffort).not.toHaveBeenCalled();
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
    await act(async () => { updatePreferences({ weeklyWorkingSetTarget: 4 }); });
    render(<ProgressHistoryScreen subject={{ kind: 'muscle', id: 'front_delts' }} todayDateKey="2026-06-05" />);
    await waitFor(() => expect(screen.getByText('Volume per day')).toBeTruthy());
    expect(stats.computeSelectedMuscleHistoryEffort).toHaveBeenCalledWith(
      expect.objectContaining({ muscleGroupIds: ['front_delts'] })
    );
    // Only Sets is target-graded, and the page grades this one muscle alone.
    await act(async () => { fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')); });
    expect(screen.getByText('Weekly target')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-06-03'))
      .toHaveProp('accessibilityLabel', expect.stringContaining('50% of weekly muscle target'));
  });
});
