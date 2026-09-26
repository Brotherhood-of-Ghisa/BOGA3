import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { DailyHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import {
  SegmentedControl,
  Sheet,
  StatePanel,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import type {
  CalendarHeatmapMetric,
  DailyEffortMetrics,
  SelectedMuscleWeeklyEffort,
} from '@/src/data';

// The history of one exercise, one muscle or one muscle family on Progress: a
// `Sheet` holding the metric and view controls, the week banner and the daily
// or weekly heatmap (DLM-T09). One component for the muscle and the exercise
// sheet; `kind` names its testIDs (`stats-<kind>-history-…`) and its copy.

export type HistoryKind = 'muscle' | 'exercise';
export type HeatmapView = 'weekly' | 'daily';
export type MuscleHistoryMetric = Extract<CalendarHeatmapMetric, 'totalVolume' | 'workingSetCount'>;

export type HistoryMetricOption<TMetric extends CalendarHeatmapMetric> = {
  value: TMetric;
  label: string;
};

const METRIC_LABELS: Record<CalendarHeatmapMetric, string> = {
  totalVolume: 'Volume',
  workingSetCount: 'W/sets',
  estimatedRM1: '1RM',
  highestWeight: 'Top weight',
};

// Every entered-load metric. Muscle history has no 1RM or top weight: those
// are exercise-level (`ux-rules.md` §12.7).
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

const HEATMAP_VIEW_OPTIONS: readonly { value: HeatmapView; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

// The sheet's body takes this share of the window; with the handle and the
// bottom inset the sheet covers about three quarters of the screen.
const BODY_SHARE_OF_SCREEN = 0.7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Progress figures are full integers, never `2.5k` (DLM-T08-D2).
const formatFigure = (value: number): string => String(Math.round(value));

const formatWeekDateRange = (weekStartDateKey: string): string => {
  const [y, m, d] = weekStartDateKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
};

const formatWeekValue = (week: SelectedMuscleWeeklyEffort, metric: CalendarHeatmapMetric): string => {
  switch (metric) {
    case 'totalVolume': return formatFigure(week.totalVolume);
    case 'workingSetCount': return String(week.workingSetCount);
    case 'estimatedRM1': return week.estimatedRM1 !== null ? formatFigure(week.estimatedRM1) : '—';
    case 'highestWeight': return week.highestWeight !== null ? formatFigure(week.highestWeight) : '—';
  }
};

// One day's value for the daily heatmap's detail card: working sets are a raw
// count, the rest are weights.
const formatDayValue = (value: number, metric: CalendarHeatmapMetric): string =>
  metric === 'workingSetCount' ? String(value) : formatFigure(value);

function WeekSelectionBanner({
  weeklyEffort,
  selectedWeekKey,
  metric,
  testID,
}: {
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  selectedWeekKey: string | null;
  metric: CalendarHeatmapMetric;
  testID: string;
}) {
  const week =
    selectedWeekKey !== null
      ? (weeklyEffort.find((w) => w.weekStartDateKey === selectedWeekKey) ?? null)
      : null;

  return (
    <View style={styles.banner} testID={testID}>
      {selectedWeekKey !== null ? (
        <>
          <Text allowFontScaling={false} style={styles.bannerRange} testID={`${testID}-range`}>
            {formatWeekDateRange(selectedWeekKey)}
          </Text>
          <Text allowFontScaling={false} style={styles.bannerLabel} testID={`${testID}-value`}>
            {METRIC_LABELS[metric]}:{' '}
            <Text allowFontScaling={false} style={styles.bannerFigure}>{week !== null ? formatWeekValue(week, metric) : '—'}</Text>
          </Text>
        </>
      ) : (
        <Text allowFontScaling={false} style={styles.bannerLabel} testID={`${testID}-placeholder`}>
          Tap a week to see details
        </Text>
      )}
    </View>
  );
}

function HistoryHeatmap({
  dailyMetrics,
  metric,
  view,
  selectedWeekKey,
  onSelectWeek,
  testIDPrefix,
  todayDateKey,
}: {
  dailyMetrics: DailyEffortMetrics[];
  metric: CalendarHeatmapMetric;
  view: HeatmapView;
  selectedWeekKey: string | null;
  onSelectWeek: (weekKey: string | null) => void;
  testIDPrefix: string;
  todayDateKey?: string;
}) {
  // Both views span the full available history and scroll horizontally.
  const data = useMemo(
    () => buildHeatmapData(dailyMetrics, metric, { todayDateKey, weeks: 'all' }),
    [dailyMetrics, metric, todayDateKey]
  );
  const formatDailyValue = useCallback((value: number) => formatDayValue(value, metric), [metric]);
  const dailyHeatmap = useMemo(
    () => (
      <DailyHeatmap
        data={data}
        testIDPrefix={testIDPrefix}
        metricLabel={METRIC_LABELS[metric]}
        formatValue={formatDailyValue}
        legendLabel={`${METRIC_LABELS[metric]} per day`}
      />
    ),
    [data, formatDailyValue, metric, testIDPrefix]
  );
  const weeklyHeatmap = useMemo(
    () => (
      <WeeklyHeatmap
        data={data}
        selectedWeekKey={selectedWeekKey}
        onSelectWeek={onSelectWeek}
        testIDPrefix={testIDPrefix}
      />
    ),
    [data, onSelectWeek, selectedWeekKey, testIDPrefix]
  );
  const dailyVisible = view === 'daily';

  // Both trees stay mounted so a switch reuses the laid-out chart and keeps its
  // selection and scroll; the inactive one is transparent, inert and hidden
  // from assistive tech (`ux-rules.md` §12.9).
  return (
    <View style={styles.heatmapLayers}>
      <View
        accessibilityElementsHidden={!dailyVisible}
        importantForAccessibility={dailyVisible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={dailyVisible ? 'auto' : 'none'}
        style={[styles.heatmapLayer, dailyVisible ? styles.heatmapLayerActive : styles.heatmapLayerInactive]}
        testID={`${testIDPrefix}-heatmap-panel-daily`}>
        {dailyHeatmap}
      </View>
      <View
        accessibilityElementsHidden={dailyVisible}
        importantForAccessibility={dailyVisible ? 'no-hide-descendants' : 'auto'}
        pointerEvents={dailyVisible ? 'none' : 'auto'}
        style={[styles.heatmapLayer, dailyVisible ? styles.heatmapLayerInactive : styles.heatmapLayerActive]}
        testID={`${testIDPrefix}-heatmap-panel-weekly`}>
        {weeklyHeatmap}
      </View>
    </View>
  );
}

export type HistorySheetProps<TMetric extends CalendarHeatmapMetric> = {
  kind: HistoryKind;
  // Above the title: "Exercise History", "Muscle History", "Muscle Group History".
  eyebrow: string;
  // The exercise, muscle or family name.
  title: string;
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
  windowDays: number;
  selectedWeekKey: string | null;
  onSelectWeek: (weekKey: string | null) => void;
  // The backdrop, Android back and the VoiceOver escape; there is no close
  // button (`design-language.md` §4).
  onDismiss: () => void;
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
  onSelectView,
  weeklyEffort,
  dailyMetrics,
  isLoading,
  errorMessage,
  windowDays,
  selectedWeekKey,
  onSelectWeek,
  onDismiss,
  todayDateKey,
}: HistorySheetProps<TMetric>) {
  const { height } = useWindowDimensions();
  const prefix = `stats-${kind}-history`;

  return (
    <Sheet dismissLabel={`Dismiss ${kind} history`} onDismiss={onDismiss} testID={prefix} visible>
      <View style={[styles.body, { height: Math.round(height * BODY_SHARE_OF_SCREEN) }]} testID={`${prefix}-overlay`}>
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.eyebrow}>
            {eyebrow}
          </Text>
          <Text
            accessibilityRole="header"
            adjustsFontSizeToFit
            allowFontScaling={false}
            ellipsizeMode="clip"
            minimumFontScale={0.82}
            numberOfLines={2}
            style={styles.title}
            testID={`${prefix}-title`}>
            {title}
          </Text>
        </View>

        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text allowFontScaling={false} style={styles.controlLabel}>
              Metric
            </Text>
            <SegmentedControl
              accessibilityLabel="Select effort metric"
              // Four metrics: `Top weight` outgrows an equal quarter.
              layout="fit"
              onChange={onSelectMetric}
              options={metricOptions}
              testIDPrefix={`${prefix}-metric-chip`}
              value={metric}
            />
          </View>
          <View style={styles.controlGroup}>
            <Text allowFontScaling={false} style={styles.controlLabel}>
              View
            </Text>
            <SegmentedControl
              accessibilityLabel="Select heatmap view"
              onChange={onSelectView}
              options={HEATMAP_VIEW_OPTIONS}
              testIDPrefix={`${prefix}-view-chip`}
              value={view}
            />
          </View>
        </View>

        {view === 'weekly' ? (
          <WeekSelectionBanner
            metric={metric}
            selectedWeekKey={selectedWeekKey}
            testID={`${prefix}-week-banner`}
            weeklyEffort={weeklyEffort}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          testID={`${prefix}-scroll`}>
          {isLoading ? (
            <StatePanel body={`Loading ${title} history...`} fill={false} kind="loading" testID={`${prefix}-loading`} />
          ) : null}

          {!isLoading && errorMessage ? (
            <StatePanel
              body={errorMessage}
              fill={false}
              kind="error"
              testID={`${prefix}-error`}
              title={`Could not load ${kind} history`}
            />
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {weeklyEffort.length === 0 ? (
                <StatePanel
                  body={`No ${title} training was found in the last ${windowDays} days.`}
                  fill={false}
                  testID={`${prefix}-empty`}
                  title="No history yet"
                />
              ) : null}

              <HistoryHeatmap
                dailyMetrics={dailyMetrics}
                metric={metric}
                onSelectWeek={onSelectWeek}
                selectedWeekKey={selectedWeekKey}
                testIDPrefix={prefix}
                todayDateKey={todayDateKey}
                view={view}
              />
            </>
          ) : null}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const microLabel = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700',
  fontSize: uiTypography.size.xxs,
  lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  textTransform: 'uppercase',
  color: uiRoles.inkMuted,
} as const;

const styles = StyleSheet.create({
  body: {
    flexShrink: 1,
  },
  header: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  eyebrow: microLabel,
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  controls: {
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  controlGroup: {
    gap: uiSpace.sm,
  },
  controlLabel: microLabel,
  // A `rule-soft` band across the sheet: the week's range, then its figure.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiRoles.ruleSoft,
  },
  bannerRange: {
    flexShrink: 1,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  bannerLabel: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  bannerFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    color: uiRoles.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  heatmapLayers: {
    position: 'relative',
  },
  heatmapLayer: {
    left: 0,
    right: 0,
    top: 0,
  },
  heatmapLayerActive: {
    position: 'relative',
    opacity: 1,
    zIndex: 1,
  },
  heatmapLayerInactive: {
    position: 'absolute',
    opacity: 0,
    zIndex: 0,
  },
});
