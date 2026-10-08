import type { BuildHeatmapDataOptions } from '@/components/heatmaps';
import type { HeatmapView } from '@/src/preferences/model';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DailyHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import {
  PageSheet,
  SegmentedControl,
  StatePanel,
  uiSpace,
} from '@/components/ui';
import type {
  CalendarHeatmapMetric,
  DailyEffortMetrics,
  SelectedMuscleWeeklyEffort,
} from '@/src/data';

// The history of one exercise or one muscle on Progress: a sub-page
// (`PageSheet`) holding the metric control and the saved Daily
// or Weekly heatmap. One component for the muscle and the exercise
// sheet; `kind` names its testIDs (`stats-<kind>-history-…`) and its copy.

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
  chartHidden,
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
  chartHidden: boolean;
}) {
  // Both views span the saved window and scroll vertically.
  const data = useMemo(
    () => buildHeatmapData(dailyMetrics, metric, { todayDateKey, weeks: lookbackWeeks, muscleTargets }),
    [dailyMetrics, metric, todayDateKey, lookbackWeeks, muscleTargets]
  );
  const formatDailyValue = useCallback((value: number) => formatDayValue(value, metric), [metric]);
  const dailyHeatmap = useMemo(
    () => (
      <DailyHeatmap
        data={data}
        testIDPrefix={testIDPrefix}
        metricLabel={metricLabel}
        formatValue={formatDailyValue}
        legendLabel={`${metricLabel} per day`}
      />
    ),
    [data, formatDailyValue, metricLabel, testIDPrefix]
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
        header={chartHidden ? null : status}
      />
    ),
    [data, formatDailyValue, onSelectWeek, selectedWeekKey, testIDPrefix, metric, metricLabel, status, chartHidden]
  );
  const dailyVisible = view === 'daily';

  // Both trees stay mounted so a switch reuses the laid-out chart and keeps its
  // selection and scroll; the inactive one is transparent, inert and hidden
  // from assistive tech.
  return (
    <View style={styles.heatmapLayers}>
      <View
        accessibilityElementsHidden={!dailyVisible}
        importantForAccessibility={dailyVisible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={dailyVisible ? 'auto' : 'none'}
        style={[styles.heatmapLayer, dailyVisible ? styles.heatmapLayerActive : styles.heatmapLayerInactive]}
        testID={`${testIDPrefix}-heatmap-panel-daily`}>
        <ScrollView contentContainerStyle={styles.dailyContent} showsVerticalScrollIndicator={false}
          style={styles.scroll} testID={`${testIDPrefix}-scroll`}>
          {status}
          <View accessibilityElementsHidden={chartHidden} importantForAccessibility={chartHidden ? 'no-hide-descendants' : 'auto'}
            pointerEvents={chartHidden ? 'none' : 'auto'} style={chartHidden ? styles.hiddenChart : undefined}>
            {dailyHeatmap}
          </View>
        </ScrollView>
      </View>
      <View
        accessibilityElementsHidden={dailyVisible}
        importantForAccessibility={dailyVisible ? 'no-hide-descendants' : 'auto'}
        pointerEvents={dailyVisible ? 'none' : 'auto'}
        style={[styles.heatmapLayer, dailyVisible ? styles.heatmapLayerInactive : styles.heatmapLayerActive]}
        testID={`${testIDPrefix}-heatmap-panel-weekly`}>
        {chartHidden ? <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>{status}</ScrollView> : null}
        <View accessibilityElementsHidden={chartHidden} importantForAccessibility={chartHidden ? 'no-hide-descendants' : 'auto'}
          pointerEvents={chartHidden ? 'none' : 'auto'} style={chartHidden ? styles.hiddenWeeklyChart : styles.weeklyChart}>
          {weeklyHeatmap}
        </View>
      </View>
    </View>
  );
}

export type HistorySheetProps<TMetric extends CalendarHeatmapMetric> = {
  kind: HistoryKind;
  // Above the title: "Exercise History" or "Muscle History".
  eyebrow: string;
  // The exercise or muscle name.
  title: string;
  metricOptions: readonly HistoryMetricOption<TMetric>[];
  metric: TMetric;
  onSelectMetric: (metric: TMetric) => void;
  view: HeatmapView;
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  dailyMetrics: DailyEffortMetrics[];
  isLoading: boolean;
  errorMessage: string | null;
  // The loaded window, named in the empty state.
  lookbackWeeks: number;
  muscleTargets?: BuildHeatmapDataOptions['muscleTargets'];
  selectedWeekKey: string | null;
  onSelectWeek: (weekKey: string | null) => void;
  // Called once the sheet has gone (X, swipe down, Back or escape), so the host
  // clears its target and restores focus after the native modal has closed.
  onDismiss: () => void;
  onRetry?: () => void;
  todayDateKey?: string;
};

export function HistorySheet<TMetric extends CalendarHeatmapMetric>({
  kind,
  eyebrow,
  title,
  metricOptions,
  metric,
  onSelectMetric,
  view,
  weeklyEffort,
  dailyMetrics,
  isLoading,
  errorMessage,
  lookbackWeeks,
  muscleTargets,
  selectedWeekKey,
  onSelectWeek,
  onDismiss,
  onRetry,
  todayDateKey,
}: HistorySheetProps<TMetric>) {
  const prefix = `stats-${kind}-history`;
  const metricLabel = metricOptions.find(option => option.value === metric)?.label ?? METRIC_LABELS[metric];
  // The host mounts the sheet open and unmounts it from `onDismiss`.
  const [visible, setVisible] = useState(true);

  return (
    <PageSheet closeLabel={`Close ${kind} history`} eyebrow={eyebrow} onDismiss={() => setVisible(false)}
      onDismissed={onDismiss} testID={prefix} title={title} visible={visible}>
      <View style={styles.body} testID={`${prefix}-overlay`}>
        <View style={styles.controls}>
          <SegmentedControl
            accessibilityLabel="Select effort metric"
            // Four metrics: `Top weight` outgrows an equal quarter.
            layout="fit"
            selectedGround="selection"
            onChange={onSelectMetric}
            options={metricOptions}
            testIDPrefix={`${prefix}-metric-chip`}
            value={metric}
          />
        </View>

        <HistoryHeatmap
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
          chartHidden={!!errorMessage || (isLoading && dailyMetrics.length === 0)}
          status={<>
          {isLoading ? (
            <StatePanel body={`Loading ${title} history...`} fill={false} kind="loading" testID={`${prefix}-loading`} />
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
              body={`No ${title} training was found in the selected ${lookbackWeeks}-week history window.`}
              fill={false}
              testID={`${prefix}-empty`}
              title="No history yet"
            />
          ) : null}

          </>}
        />
      </View>
    </PageSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  controls: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  dailyContent: { gap: uiSpace.lg, paddingVertical: uiSpace.lg, paddingHorizontal: uiSpace.sm },
  hiddenChart: { height: 0, opacity: 0, overflow: 'hidden' },
  weeklyChart: { flex: 1 },
  hiddenWeeklyChart: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
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
