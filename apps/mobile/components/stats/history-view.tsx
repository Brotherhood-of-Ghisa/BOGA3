import { useDateFormat } from '@/src/preferences/hooks';
import type { HeatmapView } from '@/src/preferences/model';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  DailyHeatmap, TimelineHeatmap, WeeklyHeatmap, buildHeatmapData, weekLabel,
  type BuildHeatmapDataOptions, type DayCell, type FocusedTimelineWeek,
} from '@/components/heatmaps';
import { WeekSetList, type WeekSetExerciseLink } from '@/components/stats/week-set-list';
import { useWeekSets, type WeekSetsTarget } from '@/components/stats/week-sets';
import {
  SegmentedControl,
  StatePanel,
  uiSpace,
} from '@/components/ui';
import type {
  CalendarHeatmapMetric,
  DailyEffortMetrics,
  SelectedMuscleWeeklyEffort,
} from '@/src/data';

// The body of the history page (`app/progress-history.tsx`): the view and
// metric selectors in one row, then the chosen Timeline, Grid or Weekly view. The
// subject's name is the page's native title, so nothing here repeats it.
// Pending/error bodies mount only their StatePanel; chart work starts after
// data. One component for the muscle and the exercise page; `kind` names its
// testIDs (`stats-<kind>-history-…`) and its copy.

export type HistoryKind = 'muscle' | 'exercise';
export type MuscleHistoryMetric = Extract<CalendarHeatmapMetric, 'totalVolume' | 'workingSetCount'>;

export type HistoryMetricOption<TMetric extends CalendarHeatmapMetric> = {
  value: TMetric;
  label: string;
};

const METRIC_LABELS: Record<CalendarHeatmapMetric, string> = {
  totalVolume: 'Volume',
  workingSetCount: 'Sets',
  estimatedRM1: '1RM',
  highestWeight: 'Top weight',
};

// Every entered-load metric. Muscle history has no 1RM or top weight: those
// are exercise-level.
export const EXERCISE_HISTORY_METRIC_OPTIONS: readonly HistoryMetricOption<CalendarHeatmapMetric>[] = [
  { value: 'totalVolume', label: METRIC_LABELS.totalVolume },
  { value: 'workingSetCount', label: METRIC_LABELS.workingSetCount },
  { value: 'estimatedRM1', label: METRIC_LABELS.estimatedRM1 },
  { value: 'highestWeight', label: METRIC_LABELS.highestWeight },
];

export const MUSCLE_HISTORY_METRIC_OPTIONS: readonly HistoryMetricOption<MuscleHistoryMetric>[] = [
  { value: 'totalVolume', label: METRIC_LABELS.totalVolume },
  { value: 'workingSetCount', label: METRIC_LABELS.workingSetCount },
];

// One day's value inside its calendar tile, in the metric's format.
const formatDayValue = (value: number, metric: CalendarHeatmapMetric): string => {
  switch (metric) {
    case 'workingSetCount': return String(value);
    case 'totalVolume': return formatVolume(value);
    case 'estimatedRM1': return formatOneRepMax(value);
    case 'highestWeight': return formatWeight(value);
  }
};

// The Timeline readout's unit word for a figure.
const UNIT_LABELS: Record<CalendarHeatmapMetric, (value: number) => string> = {
  totalVolume: () => 'volume',
  workingSetCount: value => value === 1 ? 'set' : 'sets',
  estimatedRM1: () => '',
  highestWeight: () => '',
};

// What the Timeline needs beyond the heatmaps: the subject whose week it
// lists, and where its cards go — a card to its session and, on a muscle's
// list, its button to the exercise's history. The page's ⋮ opens the focused
// week's sessions, through the `onOpenWeek` the other views share.
export type TimelineLinks = {
  weekSetsTarget: WeekSetsTarget;
  onOpenSession: (sessionId: string) => void;
  exerciseLink?: WeekSetExerciseLink;
};

const VIEWS: readonly HeatmapView[] = ['timeline', 'daily', 'weekly'];

const sameFocusedWeek = (left: FocusedTimelineWeek | null, right: FocusedTimelineWeek | null): boolean =>
  left === right || (left !== null && right !== null && left.weekStartDateKey === right.weekStartDateKey
    && left.label === right.label && left.hasTraining === right.hasTraining);

function HistoryHeatmap({
  dailyMetrics,
  metric,
  metricLabel,
  view,
  onOpenDay,
  onOpenWeek,
  testIDPrefix,
  todayDateKey,
  lookbackWeeks,
  muscleTargets,
  status,
  timeline,
  onFocusWeek,
}: {
  dailyMetrics: DailyEffortMetrics[];
  metric: CalendarHeatmapMetric;
  metricLabel: string;
  view: HeatmapView;
  onOpenDay?: (day: DayCell) => void;
  onOpenWeek?: (weekStartDateKey: string) => void;
  testIDPrefix: string;
  todayDateKey?: string;
  lookbackWeeks: number;
  muscleTargets?: BuildHeatmapDataOptions['muscleTargets'];
  status: ReactNode;
  timeline: TimelineLinks;
  onFocusWeek?: (week: FocusedTimelineWeek | null) => void;
}) {
  const dateFormat = useDateFormat();
  // Every view spans the saved window and scrolls vertically.
  const data = useMemo(
    () => buildHeatmapData(dailyMetrics, metric, { todayDateKey, weeks: lookbackWeeks, muscleTargets }),
    [dailyMetrics, metric, todayDateKey, lookbackWeeks, muscleTargets]
  );
  const formatDailyValue = useCallback((value: number) => formatDayValue(value, metric), [metric]);
  // Only the Timeline selects a week; one a shortened window drops is no
  // selection. Exactly one week is focused there — the selected one, else the
  // newest — and the chart's marks, the week list and the page's title and ⋮
  // all follow it. It is read only while the Timeline shows.
  const [selection, setSelection] = useState<string | null>(null);
  const selectedWeekKey = data.weekly.some(week => week.weekStartDateKey === selection) ? selection : null;
  const focusedWeekKey = selectedWeekKey ?? data.weekly[data.weekly.length - 1]?.weekStartDateKey ?? null;
  const [weekSetsRevision, setWeekSetsRevision] = useState(0);
  const retryWeekSets = useCallback(() => setWeekSetsRevision(revision => revision + 1), []);
  const weekSets = useWeekSets(view === 'timeline' ? timeline.weekSetsTarget : null, focusedWeekKey, weekSetsRevision);
  const { onOpenSession, exerciseLink } = timeline;
  // The page offers the focused week's sessions from its ⋮, so
  // it is told which week that is — and told it is gone when the chart is.
  const focusedWeek = useMemo<FocusedTimelineWeek | null>(() => {
    const week = view === 'timeline' ? data.weekly.find(candidate => candidate.weekStartDateKey === focusedWeekKey) : undefined;
    return week ? {
      weekStartDateKey: week.weekStartDateKey,
      label: weekLabel(week.monday, dateFormat),
      hasTraining: week.hasTraining ?? week.value > 0,
    } : null;
  }, [data, focusedWeekKey, view, dateFormat]);
  // Reported by value, not by identity: the window is rebuilt on every render,
  // so an equal week must not re-render the page around the chart.
  const reported = useRef<FocusedTimelineWeek | null>(null);
  const report = useRef(onFocusWeek);
  useEffect(() => { report.current = onFocusWeek; }, [onFocusWeek]);
  useEffect(() => {
    if (sameFocusedWeek(reported.current, focusedWeek)) return;
    reported.current = focusedWeek;
    onFocusWeek?.(focusedWeek);
  }, [focusedWeek, onFocusWeek]);
  // A failed read drops the chart entirely, and the page's week goes with it.
  useEffect(() => () => report.current?.(null), []);
  const timelineChart = useMemo(
    () => (
      <TimelineHeatmap
        data={data}
        metric={metric}
        selectedWeekKey={selectedWeekKey}
        onSelectWeek={setSelection}
        testIDPrefix={testIDPrefix}
        formatValue={formatDailyValue}
        metricLabel={metricLabel}
        unitLabel={UNIT_LABELS[metric]}
        header={status}>
        <WeekSetList {...weekSets} exerciseLink={exerciseLink} onOpenSession={onOpenSession} onRetry={retryWeekSets}
          testID={`${testIDPrefix}-week-sets`} />
      </TimelineHeatmap>
    ),
    [data, metric, selectedWeekKey, testIDPrefix, formatDailyValue, metricLabel, status, weekSets, onOpenSession, exerciseLink, retryWeekSets]
  );
  const dailyHeatmap = useMemo(
    () => (
      <DailyHeatmap
        data={data}
        testIDPrefix={testIDPrefix}
        metricLabel={metricLabel}
        formatValue={formatDailyValue}
        legendLabel={`${metricLabel} per day`}
        header={status}
        onOpenDay={onOpenDay}
        onOpenWeek={onOpenWeek}
      />
    ),
    [data, formatDailyValue, metricLabel, testIDPrefix, status, onOpenDay, onOpenWeek]
  );
  const weeklyHeatmap = useMemo(
    () => (
      <WeeklyHeatmap
        data={data}
        metric={metric}
        onOpenWeek={onOpenWeek}
        testIDPrefix={testIDPrefix}
        formatValue={formatDailyValue}
        metricLabel={metricLabel}
        formatReferenceValue={metric === 'totalVolume' ? formatVolume : formatOneRepMax}
        header={status}
      />
    ),
    [data, formatDailyValue, onOpenWeek, testIDPrefix, metric, metricLabel, status]
  );
  const charts: Record<HeatmapView, ReactNode> = { timeline: timelineChart, daily: dailyHeatmap, weekly: weeklyHeatmap };
  const [visited, setVisited] = useState<Partial<Record<HeatmapView, true>>>({ [view]: true });
  if (!visited[view]) setVisited(previous => ({ ...previous, [view]: true }));

  // Visited trees stay mounted so a switch reuses the laid-out chart and keeps its
  // Timeline selection and scroll; the inactive ones are transparent, inert and hidden
  // from assistive tech.
  return (
    <View style={styles.heatmapLayers}>
      {VIEWS.map(layer => {
        const active = layer === view;
        return (
          <View
            key={layer}
            accessibilityElementsHidden={!active}
            importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
            pointerEvents={active ? 'auto' : 'none'}
            style={[styles.heatmapLayer, active ? styles.heatmapLayerActive : styles.heatmapLayerInactive]}
            testID={`${testIDPrefix}-heatmap-panel-${layer}`}>
            {visited[layer] ? charts[layer] : null}
          </View>
        );
      })}
    </View>
  );
}

// The three history views, labelled by their icons: the weekly columns
// (Timeline), the month calendars (Grid) and the weekly bars. Switching writes
// the saved `heatmapView` preference, so the choice survives leaving the page.
export const HISTORY_VIEW_OPTIONS = [
  { value: 'timeline' as HeatmapView, label: 'Timeline', icon: 'timeline-columns' as const },
  { value: 'daily' as HeatmapView, label: 'Grid', icon: 'calendar-grid' as const },
  { value: 'weekly' as HeatmapView, label: 'Weekly', icon: 'weekly-bars' as const },
];

export type HistoryViewProps<TMetric extends CalendarHeatmapMetric> = {
  kind: HistoryKind;
  // The exercise or muscle name. The page's native title carries it; the body
  // uses it only inside its loading and empty copy, and leaves it out of both
  // while the catalogue is still resolving the name.
  subject: string | null;
  metricOptions: readonly HistoryMetricOption<TMetric>[];
  metric: TMetric;
  onSelectMetric: (metric: TMetric) => void;
  view: HeatmapView;
  onSelectView: (view: HeatmapView) => void;
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  dailyMetrics: DailyEffortMetrics[];
  isLoading: boolean;
  errorMessage: string | null;
  // The loaded window, named in the empty state.
  lookbackWeeks: number;
  muscleTargets?: BuildHeatmapDataOptions['muscleTargets'];
  // A day or week with training opens its sessions.
  onOpenDay?: (day: DayCell) => void;
  onOpenWeek?: (weekStartDateKey: string) => void;
  onRetry?: () => void;
  todayDateKey?: string;
  timeline: TimelineLinks;
  // The Timeline's focused week, for the page's ⋮; `null` while
  // another view shows, or when no chart does.
  onFocusWeek?: (week: FocusedTimelineWeek | null) => void;
};

export function HistoryView<TMetric extends CalendarHeatmapMetric>({
  kind,
  subject,
  metricOptions,
  metric,
  onSelectMetric,
  view,
  onSelectView,
  weeklyEffort,
  dailyMetrics,
  isLoading,
  errorMessage,
  lookbackWeeks,
  muscleTargets,
  onOpenDay,
  onOpenWeek,
  onRetry,
  todayDateKey,
  timeline,
  onFocusWeek,
}: HistoryViewProps<TMetric>) {
  const prefix = `stats-${kind}-history`;
  const metricLabel = metricOptions.find(option => option.value === metric)?.label ?? METRIC_LABELS[metric];
  const named = subject ? `${subject} ` : '';

  const status = <>
    {isLoading ? (
      <StatePanel body={`Loading ${named}history...`} fill={false} kind="loading" testID={`${prefix}-loading`} />
    ) : null}

    {!isLoading && errorMessage ? (
      <StatePanel
        action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${prefix}-retry` } : undefined}
        body={errorMessage}
        fill={false}
        kind="error"
        testID={`${prefix}-error`}
        title={`Could not load ${kind} history`}
      />
    ) : null}

    {!isLoading && !errorMessage && weeklyEffort.length === 0 ? (
      <StatePanel
        body={`No ${named}training was found in the selected ${lookbackWeeks}-week history window.`}
        fill={false}
        testID={`${prefix}-empty`}
        title="No history yet"
      />
    ) : null}

  </>;

  return (
    <View style={styles.body} testID={`${prefix}-overlay`}>
      {/* Both selectors in one row: the view as icons, so the metric names —
          up to four, `Top weight` the widest — keep the rest of the row. */}
      <View style={styles.controls}>
        <SegmentedControl
          accessibilityLabel="Select history view"
          density="compact"
          // Icon segments are 32pt wide: hit slop keeps the 44pt target
          // (`design-language.md`, "Tap targets").
          hitSlop={uiSpace.md}
          layout="inline"
          onChange={onSelectView}
          options={HISTORY_VIEW_OPTIONS}
          selectedGround="selection"
          testIDPrefix={`${prefix}-view-chip`}
          value={view}
        />
        <SegmentedControl
          accessibilityLabel="Select effort metric"
          density="compact"
          hitSlop={uiSpace.sm}
          // Four metrics: `Top weight` outgrows an equal quarter.
          layout="fit"
          onChange={onSelectMetric}
          options={metricOptions}
          selectedGround="selection"
          style={styles.metricControl}
          testIDPrefix={`${prefix}-metric-chip`}
          value={metric}
        />
      </View>

      {!!errorMessage || (isLoading && dailyMetrics.length === 0) ? (
        <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>{status}</ScrollView>
      ) : <HistoryHeatmap
        dailyMetrics={dailyMetrics}
        lookbackWeeks={lookbackWeeks}
        muscleTargets={muscleTargets}
        metric={metric}
        metricLabel={metricLabel}
        onOpenDay={onOpenDay}
        onOpenWeek={onOpenWeek}
        testIDPrefix={prefix}
        todayDateKey={todayDateKey}
        view={view}
        status={status}
        timeline={timeline}
        onFocusWeek={onFocusWeek}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  // The view and metric selectors share one row and one height, clear of the
  // native header above them.
  controls: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  metricControl: {
    flex: 1,
    minWidth: 0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  heatmapLayers: {
    flex: 1,
    position: 'relative',
  },
  heatmapLayer: {
    left: 0,
    right: 0,
    top: 0,
  },
  heatmapLayerActive: {
    flex: 1,
    position: 'relative',
    opacity: 1,
    zIndex: 1,
  },
  heatmapLayerInactive: {
    position: 'absolute',
    bottom: 0,
    opacity: 0,
    zIndex: 0,
  },
});
