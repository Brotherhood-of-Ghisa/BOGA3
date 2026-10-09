import type { BuildHeatmapDataOptions } from '@/components/heatmaps';
import type { HeatmapView } from '@/src/preferences/model';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DailyHeatmap, TimelineHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { WeekSetList } from '@/components/stats/week-set-list';
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

// The Timeline readout's unit word for a figure ([[comparison.timeline-history]]).
const UNIT_LABELS: Record<CalendarHeatmapMetric, (value: number) => string> = {
  totalVolume: () => 'volume',
  workingSetCount: value => value === 1 ? 'set' : 'sets',
  estimatedRM1: () => 'kg',
  highestWeight: () => 'kg',
};

// What the Timeline needs beyond the heatmaps: the subject whose week it
// lists, and where its buttons and cards go.
export type TimelineLinks = {
  weekSetsTarget: WeekSetsTarget;
  onViewSessions: (weekStartDateKey: string) => void;
  onOpenSession: (sessionId: string) => void;
};

const VIEWS: readonly HeatmapView[] = ['timeline', 'daily', 'weekly'];

function HistoryHeatmap({
  dailyMetrics,
  metric,
  metricLabel,
  view,
  selectedWeekKey,
  onSelectWeek,
  testIDPrefix,
  todayDateKey,
  lookbackWeeks,
  muscleTargets,
  status,
  timeline,
}: {
  dailyMetrics: DailyEffortMetrics[];
  metric: CalendarHeatmapMetric;
  metricLabel: string;
  view: HeatmapView;
  selectedWeekKey: string | null;
  onSelectWeek: (weekKey: string | null) => void;
  testIDPrefix: string;
  todayDateKey?: string;
  lookbackWeeks: number;
  muscleTargets?: BuildHeatmapDataOptions['muscleTargets'];
  status: ReactNode;
  timeline: TimelineLinks;
}) {
  // Every view spans the saved window and scrolls vertically.
  const data = useMemo(
    () => buildHeatmapData(dailyMetrics, metric, { todayDateKey, weeks: lookbackWeeks, muscleTargets }),
    [dailyMetrics, metric, todayDateKey, lookbackWeeks, muscleTargets]
  );
  const formatDailyValue = useCallback((value: number) => formatDayValue(value, metric), [metric]);
  // The list follows the readout's week: the selected one, else the newest. It
  // is read only while the Timeline shows it.
  const listedWeekKey = selectedWeekKey ?? data.weekly[data.weekly.length - 1]?.weekStartDateKey ?? null;
  const [weekSetsRevision, setWeekSetsRevision] = useState(0);
  const retryWeekSets = useCallback(() => setWeekSetsRevision(revision => revision + 1), []);
  const weekSets = useWeekSets(view === 'timeline' ? timeline.weekSetsTarget : null, listedWeekKey, weekSetsRevision);
  const { onViewSessions, onOpenSession } = timeline;
  const timelineChart = useMemo(
    () => (
      <TimelineHeatmap
        data={data}
        metric={metric}
        selectedWeekKey={selectedWeekKey}
        onSelectWeek={onSelectWeek}
        onViewSessions={onViewSessions}
        testIDPrefix={testIDPrefix}
        formatValue={formatDailyValue}
        metricLabel={metricLabel}
        unitLabel={UNIT_LABELS[metric]}
        header={status}>
        <WeekSetList {...weekSets} onOpenSession={onOpenSession} onRetry={retryWeekSets} testID={`${testIDPrefix}-week-sets`} />
      </TimelineHeatmap>
    ),
    [data, metric, selectedWeekKey, onSelectWeek, onViewSessions, testIDPrefix, formatDailyValue, metricLabel, status, weekSets, onOpenSession, retryWeekSets]
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
      />
    ),
    [data, formatDailyValue, metricLabel, testIDPrefix, status]
  );
  const weeklyHeatmap = useMemo(
    () => (
      <WeeklyHeatmap
        data={data}
        selectedWeekKey={selectedWeekKey}
        onSelectWeek={onSelectWeek}
        testIDPrefix={testIDPrefix}
        formatValue={formatDailyValue}
        metricLabel={metricLabel}
        formatReferenceValue={metric === 'totalVolume' ? formatVolume : formatOneRepMax}
        header={status}
      />
    ),
    [data, formatDailyValue, onSelectWeek, selectedWeekKey, testIDPrefix, metric, metricLabel, status]
  );
  const charts: Record<HeatmapView, ReactNode> = { timeline: timelineChart, daily: dailyHeatmap, weekly: weeklyHeatmap };
  const [visited, setVisited] = useState<Partial<Record<HeatmapView, true>>>({ [view]: true });
  if (!visited[view]) setVisited(previous => ({ ...previous, [view]: true }));

  // Visited trees stay mounted so a switch reuses the laid-out chart and keeps its
  // selection and scroll; the inactive ones are transparent, inert and hidden
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
  selectedWeekKey: string | null;
  onSelectWeek: (weekKey: string | null) => void;
  onRetry?: () => void;
  todayDateKey?: string;
  timeline: TimelineLinks;
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
  selectedWeekKey,
  onSelectWeek,
  onRetry,
  todayDateKey,
  timeline,
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
        onSelectWeek={onSelectWeek}
        selectedWeekKey={selectedWeekKey}
        testIDPrefix={prefix}
        todayDateKey={todayDateKey}
        view={view}
        status={status}
        timeline={timeline}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  // The view and metric selectors share one row and one height.
  controls: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
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
