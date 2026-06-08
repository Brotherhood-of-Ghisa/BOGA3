import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DailyHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { SegmentedChips, uiColors } from '@/components/ui';
import {
  computeSelectedExerciseDailyEffort,
  computeSelectedExerciseWeeklyEffort,
  computeSelectedMuscleDailyEffortMetrics,
  computeSelectedMuscleWeeklyEffort,
  computeStatsSummary,
  type CalendarHeatmapMetric,
  type DailyEffortMetrics,
  type SelectedExerciseWeeklyEffort,
  type SelectedMuscleWeeklyEffort,
  type StatsMuscleFamilyPerformance,
  type StatsMusclePerformance,
  type StatsPeriodDays,
  type StatsSummary,
} from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

const PERIOD_OPTIONS = [
  { value: 7 as StatsPeriodDays, label: 'Last 7 days' },
  { value: 30 as StatsPeriodDays, label: 'Last 30 days' },
] as const;

const MUSCLE_HISTORY_WINDOW_DAYS = 365;
const EXERCISE_HISTORY_WINDOW_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DeltaDisplay = {
  text: string;
  tone: 'positive' | 'negative' | 'neutral' | 'new';
};

export type MuscleHistoryTarget = {
  muscleGroupIds: string[];
  displayName: string;
  familyName: string;
};

export type ExerciseHeatmapTarget = {
  exerciseDefinitionId: string;
  displayName: string;
};

export type ExerciseListItem = {
  id: string;
  name: string;
  sessionCount: number;
  totalVolume: number;
  estimatedOneRepMax: number | null;
};

export type StatsViewMode = 'exercise' | 'muscle';

export const formatDelta = (current: number, previous: number): DeltaDisplay => {
  if (current === 0 && previous === 0) {
    return { text: '—', tone: 'neutral' };
  }

  if (previous === 0) {
    return { text: `+${formatNumber(current)} (new)`, tone: 'new' };
  }

  const diff = current - previous;
  if (diff === 0) {
    return { text: '±0', tone: 'neutral' };
  }

  const pct = Math.round((diff / previous) * 100);
  const sign = diff > 0 ? '+' : '−';
  const magnitude = formatNumber(Math.abs(diff));
  return {
    text: `${sign}${magnitude} (${diff > 0 ? '+' : '−'}${Math.abs(pct)}%)`,
    tone: diff > 0 ? 'positive' : 'negative',
  };
};

const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, '');
};

const formatTotalWeight = (value: number): string => {
  if (value === 0) return '0';
  if (value >= 1000) {
    const inK = value / 1000;
    return `${inK.toFixed(inK >= 100 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return formatNumber(Math.round(value));
};

const deltaToneStyle = (tone: DeltaDisplay['tone']) => {
  switch (tone) {
    case 'positive':
      return styles.deltaPositive;
    case 'negative':
      return styles.deltaNegative;
    case 'new':
      return styles.deltaNew;
    case 'neutral':
    default:
      return styles.deltaNeutral;
  }
};

export type StatsScreenShellProps = {
  summary: StatsSummary | null;
  periodDays: StatsPeriodDays;
  onSelectPeriod: (period: StatsPeriodDays) => void;
  onPressSessionsCard: () => void;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
  onDismissMuscleHistory: () => void;
  onSelectMuscleHistoryWeek: (weekKey: string | null) => void;
  isLoading: boolean;
  errorMessage: string | null;
  selectedMuscle: MuscleHistoryTarget | null;
  muscleHistoryWeeklyEffort: SelectedMuscleWeeklyEffort[];
  muscleHistoryDailyMetrics: DailyEffortMetrics[];
  isMuscleHistoryLoading: boolean;
  muscleHistoryErrorMessage: string | null;
  selectedMuscleHistoryWeekKey: string | null;
  muscleHistoryMetric: CalendarHeatmapMetric;
  muscleHistoryView: HeatmapView;
  onSelectMuscleHistoryMetric: (metric: CalendarHeatmapMetric) => void;
  onSelectMuscleHistoryView: (view: HeatmapView) => void;
  viewMode: StatsViewMode;
  onSelectViewMode: (mode: StatsViewMode) => void;
  exerciseListItems: ExerciseListItem[];
  selectedExercise: ExerciseHeatmapTarget | null;
  exerciseHistoryWeeklyEffort: SelectedExerciseWeeklyEffort[];
  exerciseHistoryDailyMetrics: DailyEffortMetrics[];
  isExerciseHistoryLoading: boolean;
  exerciseHistoryErrorMessage: string | null;
  selectedExerciseHistoryWeekKey: string | null;
  exerciseHistoryMetric: CalendarHeatmapMetric;
  exerciseHistoryView: HeatmapView;
  onPressExerciseHistory: (exercise: ExerciseHeatmapTarget) => void;
  onDismissExerciseHistory: () => void;
  onSelectExerciseHistoryWeek: (weekKey: string | null) => void;
  onSelectExerciseHistoryMetric: (metric: CalendarHeatmapMetric) => void;
  onSelectExerciseHistoryView: (view: HeatmapView) => void;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  historyTodayDateKey?: string;
};

export function StatsScreenShell({
  summary,
  periodDays,
  onSelectPeriod,
  onPressSessionsCard,
  onPressMuscleHistory,
  onDismissMuscleHistory,
  onSelectMuscleHistoryWeek,
  isLoading,
  errorMessage,
  selectedMuscle,
  muscleHistoryWeeklyEffort,
  muscleHistoryDailyMetrics,
  isMuscleHistoryLoading,
  muscleHistoryErrorMessage,
  selectedMuscleHistoryWeekKey,
  muscleHistoryMetric,
  muscleHistoryView,
  onSelectMuscleHistoryMetric,
  onSelectMuscleHistoryView,
  viewMode,
  onSelectViewMode,
  exerciseListItems,
  selectedExercise,
  exerciseHistoryWeeklyEffort,
  exerciseHistoryDailyMetrics,
  isExerciseHistoryLoading,
  exerciseHistoryErrorMessage,
  selectedExerciseHistoryWeekKey,
  exerciseHistoryMetric,
  exerciseHistoryView,
  onPressExerciseHistory,
  onDismissExerciseHistory,
  onSelectExerciseHistoryWeek,
  onSelectExerciseHistoryMetric,
  onSelectExerciseHistoryView,
  historyTodayDateKey,
}: StatsScreenShellProps) {
  const sessionDelta = summary
    ? formatDelta(summary.current.totals.sessionCount, summary.previous.totals.sessionCount)
    : null;
  const setsDelta = summary
    ? formatDelta(summary.current.totals.totalSets, summary.previous.totals.totalSets)
    : null;

  return (
    <View style={styles.screen} testID="stats-history-screen">
      <View style={styles.headerRow}>
        <SegmentedChips
          accessibilityLabel="Select stats period"
          options={PERIOD_OPTIONS}
          value={periodDays}
          onChange={onSelectPeriod}
          testIDPrefix="stats-period-chip"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'muscle' ? 'Switch to exercise view' : 'Switch to muscle view'}
          onPress={() => onSelectViewMode(viewMode === 'muscle' ? 'exercise' : 'muscle')}
          style={styles.viewModeChip}
          testID="stats-view-mode-chip">
          <Text style={styles.viewModeChipText}>
            {viewMode === 'muscle' ? 'By Exercise' : 'By Muscle'}
          </Text>
        </Pressable>
      </View>

      {summary ? (
        <View style={styles.summaryGrid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open sessions list"
            onPress={onPressSessionsCard}
            style={({ pressed }) => [styles.summaryCard, pressed && styles.summaryCardPressed]}
            testID="stats-card-sessions">
            <Text style={styles.summaryLabel}>Sessions</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.current.totals.sessionCount)}
            </Text>
            {sessionDelta ? (
              <Text style={[styles.summaryDelta, deltaToneStyle(sessionDelta.tone)]}>
                {sessionDelta.text}
              </Text>
            ) : null}
          </Pressable>

          <View style={styles.summaryCard} testID="stats-card-sets">
            <Text style={styles.summaryLabel}>Working sets</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.current.totals.totalSets)}
            </Text>
            {setsDelta ? (
              <Text style={[styles.summaryDelta, deltaToneStyle(setsDelta.tone)]}>
                {setsDelta.text}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {viewMode === 'exercise' ? (
        <ExerciseListView
          items={exerciseListItems}
          onPressExercise={onPressExerciseHistory}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          testID="stats-scroll">
          {errorMessage ? (
            <View style={styles.statePanel} testID="stats-error-state">
              <Text style={styles.stateTitle}>Could not load stats</Text>
              <Text style={styles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!errorMessage && isLoading && !summary ? (
            <View style={styles.statePanel} testID="stats-loading-state">
              <Text style={styles.stateBody}>Loading stats…</Text>
            </View>
          ) : null}

          {summary ? (
            <MuscleFamilyList
              families={summary.current.totals.muscleFamilies}
              previousFamilies={summary.previous.totals.muscleFamilies}
              onPressMuscleHistory={onPressMuscleHistory}
            />
          ) : null}
        </ScrollView>
      )}

      {selectedMuscle ? (
        <MuscleHistoryOverlay
          muscle={selectedMuscle}
          weeklyEffort={muscleHistoryWeeklyEffort}
          dailyMetrics={muscleHistoryDailyMetrics}
          isLoading={isMuscleHistoryLoading}
          errorMessage={muscleHistoryErrorMessage}
          selectedWeekKey={selectedMuscleHistoryWeekKey}
          metric={muscleHistoryMetric}
          view={muscleHistoryView}
          onSelectMetric={onSelectMuscleHistoryMetric}
          onSelectView={onSelectMuscleHistoryView}
          onDismiss={onDismissMuscleHistory}
          onSelectWeek={onSelectMuscleHistoryWeek}
          todayDateKey={historyTodayDateKey}
        />
      ) : null}
      {selectedExercise ? (
        <ExerciseHistoryOverlay
          exercise={selectedExercise}
          weeklyEffort={exerciseHistoryWeeklyEffort}
          dailyMetrics={exerciseHistoryDailyMetrics}
          isLoading={isExerciseHistoryLoading}
          errorMessage={exerciseHistoryErrorMessage}
          selectedWeekKey={selectedExerciseHistoryWeekKey}
          metric={exerciseHistoryMetric}
          view={exerciseHistoryView}
          onSelectMetric={onSelectExerciseHistoryMetric}
          onSelectView={onSelectExerciseHistoryView}
          onDismiss={onDismissExerciseHistory}
          onSelectWeek={onSelectExerciseHistoryWeek}
          todayDateKey={historyTodayDateKey}
        />
      ) : null}
    </View>
  );
}

function MuscleFamilyList({
  families,
  previousFamilies,
  onPressMuscleHistory,
}: {
  families: StatsMuscleFamilyPerformance[];
  previousFamilies: StatsMuscleFamilyPerformance[];
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  if (families.length === 0) {
    return (
      <View style={styles.statePanel} testID="stats-muscle-empty">
        <Text style={styles.stateBody}>
          No muscle taxonomy loaded yet. Add some exercises to see this section.
        </Text>
      </View>
    );
  }

  const previousByFamilyName = new Map(previousFamilies.map((family) => [family.familyName, family]));
  const previousMusclesById = new Map<string, StatsMusclePerformance>();
  for (const family of previousFamilies) {
    for (const muscle of family.muscles) {
      previousMusclesById.set(muscle.muscleGroupId, muscle);
    }
  }

  return (
    <View style={styles.familyList}>
      {families.map((family) => (
        <MuscleFamilyCard
          key={family.familyName}
          family={family}
          previousFamily={previousByFamilyName.get(family.familyName) ?? null}
          previousMusclesById={previousMusclesById}
          onPressMuscleHistory={onPressMuscleHistory}
        />
      ))}
    </View>
  );
}

function isFamilyCollapsible(family: StatsMuscleFamilyPerformance): boolean {
  if (family.muscles.length !== 1) return false;
  return family.muscles[0].displayName.trim().toLowerCase() === family.familyName.trim().toLowerCase();
}

function MuscleFamilyCard({
  family,
  previousFamily,
  previousMusclesById,
  onPressMuscleHistory,
}: {
  family: StatsMuscleFamilyPerformance;
  previousFamily: StatsMuscleFamilyPerformance | null;
  previousMusclesById: Map<string, StatsMusclePerformance>;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  const familyUntrained = family.sessionCount === 0 && family.totalWeight === 0;
  const testIdSlug = family.familyName.toLowerCase().replace(/\s+/g, '-');
  const sessionsDelta = formatDelta(family.sessionCount, previousFamily?.sessionCount ?? 0);
  const weightDelta = formatDelta(family.totalWeight, previousFamily?.totalWeight ?? 0);
  const collapsed = isFamilyCollapsible(family);
  const collapsedMuscle = collapsed ? family.muscles[0] : null;
  const headerContent = (
    <>
      <Text
        style={[styles.familyName, familyUntrained && styles.muscleTextUntrained]}
        testID={`stats-family-name-${testIdSlug}`}>
        {family.familyName}
      </Text>
      <View style={styles.familyMetrics}>
        <Metric
          label="Sessions"
          value={formatNumber(family.sessionCount)}
          delta={sessionsDelta}
          testID={`stats-family-sessions-${testIdSlug}`}
          muted={familyUntrained}
        />
        <Metric
          label="Total weight"
          value={formatTotalWeight(family.totalWeight)}
          delta={weightDelta}
          testID={`stats-family-weight-${testIdSlug}`}
          muted={familyUntrained}
        />
      </View>
    </>
  );

  return (
    <View style={styles.familyCard} testID={`stats-family-card-${testIdSlug}`}>
      {collapsedMuscle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${collapsedMuscle.displayName} history`}
          onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(collapsedMuscle))}
          style={({ pressed }) => [styles.familyHeader, pressed && styles.actionableRowPressed]}
          testID={`stats-family-header-button-${collapsedMuscle.muscleGroupId}`}>
          {headerContent}
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${family.familyName} history`}
          onPress={() => onPressMuscleHistory(toFamilyHistoryTarget(family))}
          style={({ pressed }) => [styles.familyHeader, pressed && styles.actionableRowPressed]}
          testID={`stats-family-header-${testIdSlug}`}>
          {headerContent}
        </Pressable>
      )}
      {collapsed ? null : (
        <View style={styles.muscleList}>
          {family.muscles.map((muscle) => {
            const muscleUntrained = muscle.sessionCount === 0 && muscle.totalWeight === 0;
            const previousMuscle = previousMusclesById.get(muscle.muscleGroupId) ?? null;
            const muscleSessionsDelta = formatDelta(
              muscle.sessionCount,
              previousMuscle?.sessionCount ?? 0
            );
            const muscleWeightDelta = formatDelta(
              muscle.totalWeight,
              previousMuscle?.totalWeight ?? 0
            );
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${muscle.displayName} history`}
                key={muscle.muscleGroupId}
                onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(muscle))}
                style={({ pressed }) => [styles.muscleRow, pressed && styles.actionableRowPressed]}
                testID={`stats-muscle-row-${muscle.muscleGroupId}`}>
                <Text
                  style={[styles.muscleName, muscleUntrained && styles.muscleTextUntrained]}
                  numberOfLines={1}>
                  {muscle.displayName}
                </Text>
                <View style={styles.muscleMetrics}>
                  <Metric
                    label="Sessions"
                    value={formatNumber(muscle.sessionCount)}
                    delta={muscleSessionsDelta}
                    testID={`stats-muscle-sessions-${muscle.muscleGroupId}`}
                    muted={muscleUntrained}
                    small
                  />
                  <Metric
                    label="Total weight"
                    value={formatTotalWeight(muscle.totalWeight)}
                    delta={muscleWeightDelta}
                    testID={`stats-muscle-weight-${muscle.muscleGroupId}`}
                    muted={muscleUntrained}
                    small
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const toMuscleHistoryTarget = (muscle: StatsMusclePerformance): MuscleHistoryTarget => ({
  muscleGroupIds: [muscle.muscleGroupId],
  displayName: muscle.displayName,
  familyName: muscle.familyName,
});

const toFamilyHistoryTarget = (family: StatsMuscleFamilyPerformance): MuscleHistoryTarget => ({
  muscleGroupIds: family.muscles.map((m) => m.muscleGroupId),
  displayName: family.familyName,
  familyName: family.familyName,
});

const METRIC_OPTIONS: readonly { value: CalendarHeatmapMetric; label: string }[] = [
  { value: 'totalVolume', label: 'Volume' },
  { value: 'nearFailureCount', label: 'Near failure' },
  { value: 'estimatedRM1', label: '1RM' },
  { value: 'highestWeight', label: 'Top weight' },
];

const METRIC_LABELS: Record<CalendarHeatmapMetric, string> = {
  totalVolume: 'Volume',
  nearFailureCount: 'Near failure',
  estimatedRM1: '1RM',
  highestWeight: 'Top weight',
};

export type HeatmapView = 'weekly' | 'daily';

const HEATMAP_VIEW_OPTIONS: readonly { value: HeatmapView; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

const MS_PER_DAY_BANNER = 24 * 60 * 60 * 1000;

const formatWeekDateRange = (weekStartDateKey: string): string => {
  const [y, m, d] = weekStartDateKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * MS_PER_DAY_BANNER);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const startStr = fmt.format(start);
  const endStr = fmt.format(end);
  return `${startStr} – ${endStr}`;
};

const formatMetricValue = (week: SelectedMuscleWeeklyEffort, metric: CalendarHeatmapMetric): string => {
  switch (metric) {
    case 'totalVolume': return formatTotalWeight(week.totalVolume);
    case 'nearFailureCount': return String(week.nearFailureCount);
    case 'estimatedRM1': return week.estimatedRM1 !== null ? formatTotalWeight(week.estimatedRM1) : '—';
    case 'highestWeight': return week.highestWeight !== null ? formatTotalWeight(week.highestWeight) : '—';
  }
};

// Formats a single value for the chosen metric (near-failure is a raw count;
// the rest are weights). Used by the daily heatmap's per-day detail card.
const formatMetricNumber = (value: number, metric: CalendarHeatmapMetric): string =>
  metric === 'nearFailureCount' ? String(value) : formatTotalWeight(value);

function WeekSelectionBanner({
  weeklyEffort,
  selectedWeekKey,
  metric,
}: {
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  selectedWeekKey: string | null;
  metric: CalendarHeatmapMetric;
}) {
  const week =
    selectedWeekKey !== null
      ? (weeklyEffort.find((w) => w.weekStartDateKey === selectedWeekKey) ?? null)
      : null;
  const dateRange = selectedWeekKey !== null ? formatWeekDateRange(selectedWeekKey) : null;
  const value = week !== null ? formatMetricValue(week, metric) : null;

  return (
    <View style={styles.weekBanner} testID="stats-muscle-history-week-banner">
      {dateRange !== null ? (
        <>
          <Text style={styles.weekBannerRange} testID="stats-muscle-history-week-banner-range">
            {dateRange}
          </Text>
          <Text style={styles.weekBannerValue} testID="stats-muscle-history-week-banner-value">
            {METRIC_LABELS[metric]}: {value ?? '—'}
          </Text>
        </>
      ) : (
        <Text style={styles.weekBannerPlaceholder} testID="stats-muscle-history-week-banner-placeholder">
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
  return view === 'daily' ? (
    <DailyHeatmap
      data={data}
      testIDPrefix={testIDPrefix}
      metricLabel={METRIC_LABELS[metric]}
      formatValue={(value) => formatMetricNumber(value, metric)}
    />
  ) : (
    <WeeklyHeatmap
      data={data}
      selectedWeekKey={selectedWeekKey}
      onSelectWeek={onSelectWeek}
      testIDPrefix={testIDPrefix}
    />
  );
}

function MuscleHistoryOverlay({
  muscle,
  weeklyEffort,
  dailyMetrics,
  isLoading,
  errorMessage,
  selectedWeekKey,
  metric,
  view,
  onSelectMetric,
  onSelectView,
  onDismiss,
  onSelectWeek,
  todayDateKey,
}: {
  muscle: MuscleHistoryTarget;
  weeklyEffort: SelectedMuscleWeeklyEffort[];
  dailyMetrics: DailyEffortMetrics[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedWeekKey: string | null;
  metric: CalendarHeatmapMetric;
  view: HeatmapView;
  onSelectMetric: (metric: CalendarHeatmapMetric) => void;
  onSelectView: (view: HeatmapView) => void;
  onDismiss: () => void;
  onSelectWeek: (weekKey: string | null) => void;
  todayDateKey?: string;
}) {
  return (
    <View style={styles.overlayRoot} testID="stats-muscle-history-overlay">
      <Pressable
        accessibilityLabel="Dismiss muscle history"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.overlayBackdrop}
        testID="stats-muscle-history-backdrop"
      />
      <View style={styles.overlayCard}>
        <View style={styles.overlayHeader}>
          <View style={styles.overlayTitleGroup}>
            <Text style={styles.overlayEyebrow}>
              {muscle.muscleGroupIds.length > 1 ? 'Muscle Group History' : 'Muscle History'}
            </Text>
            <Text style={styles.overlayTitle} testID="stats-muscle-history-title">
              {muscle.displayName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close muscle history"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.overlayCloseButton,
              pressed && styles.actionableRowPressed,
            ]}
            testID="stats-muscle-history-close">
            <Text style={styles.overlayCloseButtonText}>X</Text>
          </Pressable>
        </View>

        <View style={styles.overlayMetricSelector}>
          <SegmentedChips
            accessibilityLabel="Select effort metric"
            options={METRIC_OPTIONS}
            value={metric}
            onChange={onSelectMetric}
            testIDPrefix="stats-muscle-history-metric-chip"
            compact
          />
        </View>

        <View style={styles.overlayViewSelector}>
          <SegmentedChips
            accessibilityLabel="Select heatmap view"
            options={HEATMAP_VIEW_OPTIONS}
            value={view}
            onChange={onSelectView}
            testIDPrefix="stats-muscle-history-view-chip"
            compact
          />
        </View>

        {view === 'weekly' ? (
          <WeekSelectionBanner
            weeklyEffort={weeklyEffort}
            selectedWeekKey={selectedWeekKey}
            metric={metric}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={styles.overlayContent}
          showsVerticalScrollIndicator={false}
          testID="stats-muscle-history-scroll">
          {isLoading ? (
            <View style={styles.overlayStatePanel} testID="stats-muscle-history-loading">
              <Text style={styles.stateBody}>Loading {muscle.displayName} history...</Text>
            </View>
          ) : null}

          {!isLoading && errorMessage ? (
            <View style={styles.overlayStatePanel} testID="stats-muscle-history-error">
              <Text style={styles.stateTitle}>Could not load muscle history</Text>
              <Text style={styles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {weeklyEffort.length === 0 ? (
                <View style={styles.overlayStatePanel} testID="stats-muscle-history-empty">
                  <Text style={styles.stateTitle}>No history yet</Text>
                  <Text style={styles.stateBody}>
                    No {muscle.displayName} training was found in the last{' '}
                    {MUSCLE_HISTORY_WINDOW_DAYS} days.
                  </Text>
                </View>
              ) : null}

              <HistoryHeatmap
                dailyMetrics={dailyMetrics}
                metric={metric}
                view={view}
                selectedWeekKey={selectedWeekKey}
                onSelectWeek={onSelectWeek}
                testIDPrefix="stats-muscle-history"
                todayDateKey={todayDateKey}
              />
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}


function ExerciseListView({
  items,
  onPressExercise,
}: {
  items: ExerciseListItem[];
  onPressExercise: (exercise: ExerciseHeatmapTarget) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.statePanel} testID="stats-exercise-list-empty">
        <Text style={styles.stateBody}>
          No exercises with recorded history yet.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      testID="stats-exercise-list-scroll">
      <View style={styles.familyList} testID="stats-exercise-list">
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name} heatmap`}
            onPress={() =>
              onPressExercise({ exerciseDefinitionId: item.id, displayName: item.name })
            }
            style={({ pressed }) => [styles.exerciseRow, pressed && styles.actionableRowPressed]}
            testID={`stats-exercise-row-${item.id}`}>
            <Text style={styles.exerciseName} numberOfLines={1} testID={`stats-exercise-name-${item.id}`}>
              {item.name}
            </Text>
            <View style={styles.muscleMetrics}>
              <Metric
                label="Sessions"
                value={formatNumber(item.sessionCount)}
                testID={`stats-exercise-sessions-${item.id}`}
                muted={false}
                small
              />
              <Metric
                label="Volume"
                value={formatTotalWeight(item.totalVolume)}
                testID={`stats-exercise-volume-${item.id}`}
                muted={false}
                small
              />
              {item.estimatedOneRepMax !== null ? (
                <Metric
                  label="1RM"
                  value={formatTotalWeight(item.estimatedOneRepMax)}
                  testID={`stats-exercise-1rm-${item.id}`}
                  muted={false}
                  small
                />
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ExerciseHistoryOverlay({
  exercise,
  weeklyEffort,
  dailyMetrics,
  isLoading,
  errorMessage,
  selectedWeekKey,
  metric,
  view,
  onSelectMetric,
  onSelectView,
  onDismiss,
  onSelectWeek,
  todayDateKey,
}: {
  exercise: ExerciseHeatmapTarget;
  weeklyEffort: SelectedExerciseWeeklyEffort[];
  dailyMetrics: DailyEffortMetrics[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedWeekKey: string | null;
  metric: CalendarHeatmapMetric;
  view: HeatmapView;
  onSelectMetric: (metric: CalendarHeatmapMetric) => void;
  onSelectView: (view: HeatmapView) => void;
  onDismiss: () => void;
  onSelectWeek: (weekKey: string | null) => void;
  todayDateKey?: string;
}) {
  return (
    <View style={styles.overlayRoot} testID="stats-exercise-history-overlay">
      <Pressable
        accessibilityLabel="Dismiss exercise history"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.overlayBackdrop}
        testID="stats-exercise-history-backdrop"
      />
      <View style={styles.overlayCard}>
        <View style={styles.overlayHeader}>
          <View style={styles.overlayTitleGroup}>
            <Text style={styles.overlayEyebrow}>Exercise History</Text>
            <Text style={styles.overlayTitle} testID="stats-exercise-history-title">
              {exercise.displayName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close exercise history"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.overlayCloseButton,
              pressed && styles.actionableRowPressed,
            ]}
            testID="stats-exercise-history-close">
            <Text style={styles.overlayCloseButtonText}>X</Text>
          </Pressable>
        </View>

        <View style={styles.overlayMetricSelector}>
          <SegmentedChips
            accessibilityLabel="Select effort metric"
            options={METRIC_OPTIONS}
            value={metric}
            onChange={onSelectMetric}
            testIDPrefix="stats-exercise-history-metric-chip"
            compact
          />
        </View>

        <View style={styles.overlayViewSelector}>
          <SegmentedChips
            accessibilityLabel="Select heatmap view"
            options={HEATMAP_VIEW_OPTIONS}
            value={view}
            onChange={onSelectView}
            testIDPrefix="stats-exercise-history-view-chip"
            compact
          />
        </View>

        {view === 'weekly' ? (
          <WeekSelectionBanner
            weeklyEffort={weeklyEffort}
            selectedWeekKey={selectedWeekKey}
            metric={metric}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={styles.overlayContent}
          showsVerticalScrollIndicator={false}
          testID="stats-exercise-history-scroll">
          {isLoading ? (
            <View style={styles.overlayStatePanel} testID="stats-exercise-history-loading">
              <Text style={styles.stateBody}>Loading {exercise.displayName} history...</Text>
            </View>
          ) : null}

          {!isLoading && errorMessage ? (
            <View style={styles.overlayStatePanel} testID="stats-exercise-history-error">
              <Text style={styles.stateTitle}>Could not load exercise history</Text>
              <Text style={styles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {weeklyEffort.length === 0 ? (
                <View style={styles.overlayStatePanel} testID="stats-exercise-history-empty">
                  <Text style={styles.stateTitle}>No history yet</Text>
                  <Text style={styles.stateBody}>
                    No {exercise.displayName} training was found in the last{' '}
                    {EXERCISE_HISTORY_WINDOW_DAYS} days.
                  </Text>
                </View>
              ) : null}

              <HistoryHeatmap
                dailyMetrics={dailyMetrics}
                metric={metric}
                view={view}
                selectedWeekKey={selectedWeekKey}
                onSelectWeek={onSelectWeek}
                testIDPrefix="stats-exercise-history"
                todayDateKey={todayDateKey}
              />
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
  delta,
  testID,
  muted,
  small,
}: {
  label: string;
  value: string;
  delta?: DeltaDisplay;
  testID: string;
  muted: boolean;
  small?: boolean;
}) {
  return (
    <View style={styles.metric} testID={testID}>
      <Text style={[small ? styles.metricLabelSmall : styles.metricLabel, muted && styles.metricLabelMuted]}>
        {label}
      </Text>
      <Text style={[small ? styles.metricValueSmall : styles.metricValue, muted && styles.metricValueMuted]}>
        {value}
      </Text>
      {delta ? (
        <Text style={[small ? styles.metricDeltaSmall : styles.metricDelta, deltaToneStyle(delta.tone)]}>
          {delta.text}
        </Text>
      ) : null}
    </View>
  );
}

export default function StatsRoute() {
  const router = useRouter();
  const [periodDays, setPeriodDays] = useState<StatsPeriodDays>(7);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleHistoryTarget | null>(null);
  const [muscleHistoryWeeklyEffort, setMuscleHistoryWeeklyEffort] = useState<SelectedMuscleWeeklyEffort[]>([]);
  const [muscleHistoryDailyMetrics, setMuscleHistoryDailyMetrics] = useState<DailyEffortMetrics[]>([]);
  const [isMuscleHistoryLoading, setIsMuscleHistoryLoading] = useState(false);
  const [muscleHistoryErrorMessage, setMuscleHistoryErrorMessage] = useState<string | null>(null);
  const [selectedMuscleHistoryWeekKey, setSelectedMuscleHistoryWeekKey] = useState<string | null>(null);
  const [muscleHistoryMetric, setMuscleHistoryMetric] = useState<CalendarHeatmapMetric>('totalVolume');
  const [muscleHistoryView, setMuscleHistoryView] = useState<HeatmapView>('weekly');
  const muscleHistoryRequestIdRef = useRef(0);

  const [viewMode, setViewMode] = useState<StatsViewMode>('exercise');
  const [selectedExercise, setSelectedExercise] = useState<ExerciseHeatmapTarget | null>(null);
  const [exerciseHistoryWeeklyEffort, setExerciseHistoryWeeklyEffort] = useState<SelectedExerciseWeeklyEffort[]>([]);
  const [exerciseHistoryDailyMetrics, setExerciseHistoryDailyMetrics] = useState<DailyEffortMetrics[]>([]);
  const [isExerciseHistoryLoading, setIsExerciseHistoryLoading] = useState(false);
  const [exerciseHistoryErrorMessage, setExerciseHistoryErrorMessage] = useState<string | null>(null);
  const [selectedExerciseHistoryWeekKey, setSelectedExerciseHistoryWeekKey] = useState<string | null>(null);
  const [exerciseHistoryMetric, setExerciseHistoryMetric] = useState<CalendarHeatmapMetric>('totalVolume');
  const [exerciseHistoryView, setExerciseHistoryView] = useState<HeatmapView>('weekly');
  const exerciseHistoryRequestIdRef = useRef(0);

  const catalogSnapshot = useExerciseCatalog();
  const { stats: exerciseCatalogStats, reload: reloadExerciseCatalogStats } =
    useExerciseCatalogStats('all');

  const loadSummary = useCallback(async (period: StatsPeriodDays) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const next = await computeStatsSummary({ periodDays: period });
      setSummary(next);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Both the muscle summary and the exercise list recompute from the DB on
      // focus, so directly-seeded or out-of-band data (e.g. a session logged in
      // another tab) is reflected without relying on a catalog-invalidation event.
      void loadSummary(periodDays);
      reloadExerciseCatalogStats();
    }, [loadSummary, periodDays, reloadExerciseCatalogStats])
  );

  const handleSelectPeriod = useCallback(
    (next: StatsPeriodDays) => {
      setPeriodDays(next);
      void loadSummary(next);
    },
    [loadSummary]
  );

  const handlePressSessionsCard = useCallback(() => {
    router.push('/sessions');
  }, [router]);

  const handlePressMuscleHistory = useCallback(async (muscle: MuscleHistoryTarget) => {
    const requestId = muscleHistoryRequestIdRef.current + 1;
    muscleHistoryRequestIdRef.current = requestId;
    const end = new Date();
    const start = new Date(end.getTime() - MUSCLE_HISTORY_WINDOW_DAYS * MS_PER_DAY);

    setSelectedMuscle(muscle);
    setMuscleHistoryWeeklyEffort([]);
    setMuscleHistoryDailyMetrics([]);
    setSelectedMuscleHistoryWeekKey(null);
    setMuscleHistoryErrorMessage(null);
    setIsMuscleHistoryLoading(true);

    try {
      const [nextEffort, nextDaily] = await Promise.all([
        computeSelectedMuscleWeeklyEffort({
          muscleGroupIds: muscle.muscleGroupIds,
          start,
          end,
        }),
        computeSelectedMuscleDailyEffortMetrics({
          muscleGroupIds: muscle.muscleGroupIds,
          start,
          end,
        }),
      ]);
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setMuscleHistoryWeeklyEffort(nextEffort);
      setMuscleHistoryDailyMetrics(nextDaily);
    } catch (error) {
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setMuscleHistoryErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setIsMuscleHistoryLoading(false);
    }
  }, []);

  const handleDismissMuscleHistory = useCallback(() => {
    muscleHistoryRequestIdRef.current += 1;
    setSelectedMuscle(null);
    setMuscleHistoryWeeklyEffort([]);
    setMuscleHistoryDailyMetrics([]);
    setSelectedMuscleHistoryWeekKey(null);
    setMuscleHistoryErrorMessage(null);
    setIsMuscleHistoryLoading(false);
  }, []);

  const handleSelectMuscleHistoryWeek = useCallback((weekKey: string | null) => {
    setSelectedMuscleHistoryWeekKey(weekKey);
  }, []);

  const handleSelectViewMode = useCallback((mode: StatsViewMode) => {
    setViewMode(mode);
    setSelectedExercise(null);
    setExerciseHistoryWeeklyEffort([]);
    setExerciseHistoryDailyMetrics([]);
    setSelectedExerciseHistoryWeekKey(null);
    setExerciseHistoryErrorMessage(null);
    setIsExerciseHistoryLoading(false);
  }, []);

  const handlePressExerciseHistory = useCallback(async (exercise: ExerciseHeatmapTarget) => {
    const requestId = exerciseHistoryRequestIdRef.current + 1;
    exerciseHistoryRequestIdRef.current = requestId;
    const end = new Date();
    const start = new Date(end.getTime() - EXERCISE_HISTORY_WINDOW_DAYS * MS_PER_DAY);

    setSelectedExercise(exercise);
    setExerciseHistoryWeeklyEffort([]);
    setExerciseHistoryDailyMetrics([]);
    setSelectedExerciseHistoryWeekKey(null);
    setExerciseHistoryErrorMessage(null);
    setIsExerciseHistoryLoading(true);

    try {
      const [nextEffort, nextDaily] = await Promise.all([
        computeSelectedExerciseWeeklyEffort({
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          start,
          end,
        }),
        computeSelectedExerciseDailyEffort({
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          start,
          end,
        }),
      ]);
      if (exerciseHistoryRequestIdRef.current !== requestId) return;
      setExerciseHistoryWeeklyEffort(nextEffort);
      setExerciseHistoryDailyMetrics(nextDaily);
    } catch (error) {
      if (exerciseHistoryRequestIdRef.current !== requestId) return;
      setExerciseHistoryErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      if (exerciseHistoryRequestIdRef.current !== requestId) return;
      setIsExerciseHistoryLoading(false);
    }
  }, []);

  const handleDismissExerciseHistory = useCallback(() => {
    exerciseHistoryRequestIdRef.current += 1;
    setSelectedExercise(null);
    setExerciseHistoryWeeklyEffort([]);
    setExerciseHistoryDailyMetrics([]);
    setSelectedExerciseHistoryWeekKey(null);
    setExerciseHistoryErrorMessage(null);
    setIsExerciseHistoryLoading(false);
  }, []);

  const handleSelectExerciseHistoryWeek = useCallback((weekKey: string | null) => {
    setSelectedExerciseHistoryWeekKey(weekKey);
  }, []);

  const exerciseListItems = useMemo<ExerciseListItem[]>(() => {
    const { exercises } = catalogSnapshot;
    const { aggregatesById, everDoneIds } = exerciseCatalogStats;
    return exercises
      .filter((ex) => everDoneIds.has(ex.id))
      .map((ex) => {
        const agg = aggregatesById.get(ex.id) ?? null;
        return {
          id: ex.id,
          name: ex.name,
          sessionCount: agg?.sessionCount ?? 0,
          totalVolume: agg?.totalVolume ?? 0,
          estimatedOneRepMax: agg?.estimatedOneRepMax ?? null,
        };
      })
      .sort((a, b) => b.sessionCount - a.sessionCount);
  }, [catalogSnapshot, exerciseCatalogStats]);

  // useMemo prevents unnecessary re-renders of the shell when the route re-renders.
  const shellProps = useMemo<StatsScreenShellProps>(
    () => ({
      summary,
      periodDays,
      onSelectPeriod: handleSelectPeriod,
      onPressSessionsCard: handlePressSessionsCard,
      onPressMuscleHistory: handlePressMuscleHistory,
      onDismissMuscleHistory: handleDismissMuscleHistory,
      onSelectMuscleHistoryWeek: handleSelectMuscleHistoryWeek,
      isLoading,
      errorMessage,
      selectedMuscle,
      muscleHistoryWeeklyEffort,
      muscleHistoryDailyMetrics,
      isMuscleHistoryLoading,
      muscleHistoryErrorMessage,
      selectedMuscleHistoryWeekKey,
      muscleHistoryMetric,
      muscleHistoryView,
      onSelectMuscleHistoryMetric: setMuscleHistoryMetric,
      onSelectMuscleHistoryView: setMuscleHistoryView,
      viewMode,
      onSelectViewMode: handleSelectViewMode,
      exerciseListItems,
      selectedExercise,
      exerciseHistoryWeeklyEffort,
      exerciseHistoryDailyMetrics,
      isExerciseHistoryLoading,
      exerciseHistoryErrorMessage,
      selectedExerciseHistoryWeekKey,
      exerciseHistoryMetric,
      exerciseHistoryView,
      onPressExerciseHistory: handlePressExerciseHistory,
      onDismissExerciseHistory: handleDismissExerciseHistory,
      onSelectExerciseHistoryWeek: handleSelectExerciseHistoryWeek,
      onSelectExerciseHistoryMetric: setExerciseHistoryMetric,
      onSelectExerciseHistoryView: setExerciseHistoryView,
    }),
    [
      summary,
      periodDays,
      handleSelectPeriod,
      handlePressSessionsCard,
      handlePressMuscleHistory,
      handleDismissMuscleHistory,
      handleSelectMuscleHistoryWeek,
      isLoading,
      errorMessage,
      selectedMuscle,
      muscleHistoryWeeklyEffort,
      muscleHistoryDailyMetrics,
      isMuscleHistoryLoading,
      muscleHistoryErrorMessage,
      selectedMuscleHistoryWeekKey,
      muscleHistoryMetric,
      muscleHistoryView,
      viewMode,
      handleSelectViewMode,
      exerciseListItems,
      selectedExercise,
      exerciseHistoryWeeklyEffort,
      exerciseHistoryDailyMetrics,
      isExerciseHistoryLoading,
      exerciseHistoryErrorMessage,
      selectedExerciseHistoryWeekKey,
      exerciseHistoryMetric,
      exerciseHistoryView,
      handlePressExerciseHistory,
      handleDismissExerciseHistory,
      handleSelectExerciseHistoryWeek,
    ]
  );

  return <StatsScreenShell {...shellProps} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
    position: 'relative',
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  viewModeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  viewModeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    gap: 12,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '500',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 12,
    gap: 4,
  },
  summaryCardPressed: {
    opacity: 0.7,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 26,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  summaryDelta: {
    fontSize: 12,
    fontWeight: '600',
  },
  familyList: {
    gap: 12,
  },
  familyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  familyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  familyName: {
    fontSize: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  familyMetrics: {
    flexDirection: 'row',
    gap: 16,
  },
  muscleList: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 12,
  },
  actionableRowPressed: {
    opacity: 0.7,
  },
  muscleName: {
    fontSize: 14,
    fontWeight: '500',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  muscleMetrics: {
    flexDirection: 'row',
    gap: 12,
  },
  muscleTextUntrained: {
    color: uiColors.textSecondary,
  },
  metric: {
    alignItems: 'flex-end',
    minWidth: 60,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricLabelSmall: {
    fontSize: 9,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricLabelMuted: {
    color: uiColors.textSecondary,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.textPrimary,
    marginTop: 2,
  },
  metricValueSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textPrimary,
    marginTop: 2,
  },
  metricValueMuted: {
    color: uiColors.textSecondary,
  },
  metricDelta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  metricDeltaSmall: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  statePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 16,
    gap: 6,
  },
  stateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  overlayCard: {
    height: '75%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  overlayTitleGroup: {
    flexShrink: 1,
    gap: 2,
  },
  overlayEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  overlayCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCloseButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.actionNeutralSubtleText,
  },
  overlayMetricSelector: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  overlayViewSelector: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  weekBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceMuted,
    gap: 8,
  },
  weekBannerRange: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  weekBannerValue: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.actionPrimary,
  },
  weekBannerPlaceholder: {
    fontSize: 12,
    fontWeight: '500',
    color: uiColors.textSecondary,
  },
  overlayContent: {
    padding: 16,
    gap: 16,
  },
  overlayStatePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceInfo,
    padding: 12,
    gap: 6,
  },
  deltaPositive: {
    color: uiColors.textSuccess,
  },
  deltaNegative: {
    color: uiColors.actionDangerText,
  },
  deltaNeutral: {
    color: uiColors.textSecondary,
  },
  deltaNew: {
    color: uiColors.actionPrimary,
  },
});
