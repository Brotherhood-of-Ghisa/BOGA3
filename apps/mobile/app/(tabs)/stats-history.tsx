import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { DailyHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import {
  Card,
  Icon,
  ListRow,
  Screen,
  ScreenScroll,
  SearchField,
  SegmentedChips,
  SegmentedControl,
  Stat,
  StatePanel,
  uiColors,
  uiFonts,
  uiGeometry,
  uiRadius,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
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
  setCount: number;
  nearFailureCount: number;
  totalVolume: number;
  estimatedOneRepMax: number | null;
  lastCompletedAt: Date | null;
};

export type ExerciseSortHeader = 'exercise' | 'sets' | 'volume';
export type ExerciseSortMode =
  | 'recency-desc'
  | 'recency-asc'
  | 'sets-desc'
  | 'sets-asc'
  | 'working-sets-desc'
  | 'working-sets-asc'
  | 'volume-desc'
  | 'volume-asc';

export const DEFAULT_EXERCISE_SORT_MODE: ExerciseSortMode = 'sets-desc';

const EXERCISE_SORT_CYCLES: Record<ExerciseSortHeader, ExerciseSortMode[]> = {
  exercise: ['recency-desc', 'recency-asc'],
  sets: ['sets-desc', 'sets-asc', 'working-sets-desc', 'working-sets-asc'],
  volume: ['volume-desc', 'volume-asc'],
};

const EXERCISE_SORT_HEADER_BY_MODE: Record<ExerciseSortMode, ExerciseSortHeader> = {
  'recency-desc': 'exercise',
  'recency-asc': 'exercise',
  'sets-desc': 'sets',
  'sets-asc': 'sets',
  'working-sets-desc': 'sets',
  'working-sets-asc': 'sets',
  'volume-desc': 'volume',
  'volume-asc': 'volume',
};

export type StatsViewMode = 'exercise' | 'muscle';
const VIEW_MODE_OPTIONS = [
  { value: 'exercise' as StatsViewMode, label: 'By Exercise' },
  { value: 'muscle' as StatsViewMode, label: 'By Muscle' },
] as const;

const firstRouteParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const resolveStatsInitialPeriod = (
  value: string | string[] | undefined
): StatsPeriodDays => (firstRouteParam(value) === '30' ? 30 : 7);

export const resolveStatsInitialBreakdown = (
  value: string | string[] | undefined
): StatsViewMode => (firstRouteParam(value) === 'muscle' ? 'muscle' : 'exercise');
export type MuscleHistoryMetric = Extract<
  CalendarHeatmapMetric,
  'totalVolume' | 'workingSetCount'
>;

type DisplayMuscleFamily = {
  family: StatsMuscleFamilyPerformance;
  visibleMuscles: StatsMusclePerformance[];
};

const formatSignedCount = (value: number): string => {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
};

export const formatCountDelta = (current: number, previous: number): DeltaDisplay => {
  const difference = current - previous;
  return {
    text: formatSignedCount(difference),
    tone: difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral',
  };
};

export const formatSetCountPair = (setCount: number, nearFailureCount: number): string =>
  `${formatNumber(setCount)} (${formatNumber(nearFailureCount)})`;

export const formatSetCountPairDelta = (
  currentSetCount: number,
  currentNearFailureCount: number,
  previousSetCount: number,
  previousNearFailureCount: number
): DeltaDisplay => {
  const setDifference = currentSetCount - previousSetCount;
  const nearFailureDifference = currentNearFailureCount - previousNearFailureCount;
  const toneDifference = setDifference === 0 ? nearFailureDifference : setDifference;
  return {
    text: `${formatSignedCount(setDifference)} (${formatSignedCount(nearFailureDifference)})`,
    tone:
      toneDifference > 0 ? 'positive' : toneDifference < 0 ? 'negative' : 'neutral',
  };
};

export const formatVolumeDelta = (current: number, previous: number): DeltaDisplay => {
  if (current === 0 && previous === 0) {
    return { text: '—', tone: 'neutral' };
  }
  if (previous === 0) {
    return { text: 'new', tone: 'new' };
  }

  const percentDifference = Math.round(((current - previous) / previous) * 100);
  if (percentDifference === 0) {
    return { text: '±0%', tone: 'neutral' };
  }
  return {
    text: `${percentDifference > 0 ? '+' : '−'}${Math.abs(percentDifference)}%`,
    tone: percentDifference > 0 ? 'positive' : 'negative',
  };
};

export const fullScaleFailureCount = (periodDays: StatsPeriodDays): number =>
  (8 * periodDays) / 7;

export const computeFailureIntensityProgress = (
  nearFailureCount: number,
  periodDays: StatsPeriodDays
): number => {
  const fullScale = fullScaleFailureCount(periodDays);
  if (!Number.isFinite(nearFailureCount) || nearFailureCount <= 0 || !Number.isFinite(fullScale)) {
    return 0;
  }
  return Math.min(1, nearFailureCount / fullScale);
};

const describeCountDifference = (difference: number, label: string): string => {
  if (difference > 0) return `up ${formatNumber(difference)} ${label}`;
  if (difference < 0) return `down ${formatNumber(Math.abs(difference))} ${label}`;
  return `no change in ${label}`;
};

const describeVolumeDifference = (delta: DeltaDisplay): string => {
  if (delta.text === '—') return 'no volume in either period';
  if (delta.text === 'new') return 'new volume this period';
  if (delta.text === '±0%') return 'no percentage change in volume';
  return `${delta.tone === 'positive' ? 'up' : 'down'} ${delta.text.replace(/[+−]/, '')} in volume`;
};

const buildMuscleRowAccessibilityLabel = ({
  actionLabel,
  setCount,
  nearFailureCount,
  previousSetCount,
  previousNearFailureCount,
  volume,
  volumeDelta,
  periodDays,
}: {
  actionLabel: string;
  setCount: number;
  nearFailureCount: number;
  previousSetCount: number;
  previousNearFailureCount: number;
  volume: number;
  volumeDelta: DeltaDisplay;
  periodDays: StatsPeriodDays;
}): string =>
  [
    actionLabel,
    `${formatNumber(setCount)} sets, ${formatNumber(nearFailureCount)} near-failure sets`,
    `${describeCountDifference(setCount - previousSetCount, 'sets')} and ${describeCountDifference(
      nearFailureCount - previousNearFailureCount,
      'near-failure sets'
    )}`,
    `volume ${formatTotalWeight(volume)}, ${describeVolumeDifference(volumeDelta)}`,
    `failure background reaches its strongest shade at ${formatNumber(
      fullScaleFailureCount(periodDays)
    )} near-failure sets for the selected ${periodDays}-day period`,
  ].join('. ');

export const nextExerciseSortMode = (
  activeMode: ExerciseSortMode,
  pressedHeader: ExerciseSortHeader
): ExerciseSortMode => {
  const cycle = EXERCISE_SORT_CYCLES[pressedHeader];
  if (EXERCISE_SORT_HEADER_BY_MODE[activeMode] !== pressedHeader) return cycle[0];

  const currentIndex = cycle.indexOf(activeMode);
  return cycle[(currentIndex + 1) % cycle.length];
};

export const describeExerciseSortMode = (mode: ExerciseSortMode): string => {
  switch (mode) {
    case 'recency-desc':
      return 'Most recent exercise';
    case 'recency-asc':
      return 'Least recent exercise';
    case 'sets-desc':
      return 'Sets — high to low';
    case 'sets-asc':
      return 'Sets — low to high';
    case 'working-sets-desc':
      return 'Working sets — high to low';
    case 'working-sets-asc':
      return 'Working sets — low to high';
    case 'volume-desc':
      return 'Volume — high to low';
    case 'volume-asc':
      return 'Volume — low to high';
  }
};

const compareExerciseIdentity = (left: ExerciseListItem, right: ExerciseListItem): number => {
  const nameComparison = left.name.localeCompare(right.name);
  return nameComparison === 0 ? left.id.localeCompare(right.id) : nameComparison;
};

const compareNumbers = (left: number, right: number, descending: boolean): number => {
  if (left === right) return 0;
  if (descending) return left > right ? -1 : 1;
  return left < right ? -1 : 1;
};

const compareOptionalNumbers = (
  left: number | null,
  right: number | null,
  descending: boolean
): number => {
  const validLeft = left !== null && Number.isFinite(left) ? left : null;
  const validRight = right !== null && Number.isFinite(right) ? right : null;
  if (validLeft === null && validRight === null) return 0;
  if (validLeft === null) return 1;
  if (validRight === null) return -1;
  return compareNumbers(validLeft, validRight, descending);
};

const completedTimestamp = (item: ExerciseListItem): number | null => {
  const timestamp = item.lastCompletedAt?.getTime() ?? null;
  return timestamp !== null && Number.isFinite(timestamp) ? timestamp : null;
};

export const sortExerciseListItems = (
  items: ExerciseListItem[],
  mode: ExerciseSortMode = DEFAULT_EXERCISE_SORT_MODE
): ExerciseListItem[] =>
  [...items].sort((left, right) => {
    let comparison = 0;
    switch (mode) {
      case 'recency-desc':
        comparison = compareOptionalNumbers(completedTimestamp(left), completedTimestamp(right), true);
        break;
      case 'recency-asc':
        comparison = compareOptionalNumbers(completedTimestamp(left), completedTimestamp(right), false);
        break;
      case 'sets-desc':
        comparison = compareNumbers(left.setCount, right.setCount, true);
        break;
      case 'sets-asc':
        comparison = compareNumbers(left.setCount, right.setCount, false);
        break;
      case 'working-sets-desc':
        comparison = compareNumbers(left.nearFailureCount, right.nearFailureCount, true);
        break;
      case 'working-sets-asc':
        comparison = compareNumbers(left.nearFailureCount, right.nearFailureCount, false);
        break;
      case 'volume-desc':
        comparison = compareNumbers(left.totalVolume, right.totalVolume, true);
        break;
      case 'volume-asc':
        comparison = compareNumbers(left.totalVolume, right.totalVolume, false);
        break;
    }
    return comparison === 0 ? compareExerciseIdentity(left, right) : comparison;
  });

const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, '');
};

// Full integers in Plex Mono, never `2.5k`: the numbers are the point
// (`design-language.md` §6, DLM-T08-D2).
const formatTotalWeight = (value: number): string => String(Math.round(value));

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
  muscleHistoryMetric: MuscleHistoryMetric;
  muscleHistoryView: HeatmapView;
  onSelectMuscleHistoryMetric: (metric: MuscleHistoryMetric) => void;
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
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
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
  searchQuery,
  onSearchQueryChange,
}: StatsScreenShellProps) {
  const [exerciseSortMode, setExerciseSortMode] = useState<ExerciseSortMode>(
    DEFAULT_EXERCISE_SORT_MODE
  );
  const sessionDelta = summary
    ? formatCountDelta(
        summary.current.totals.sessionCount,
        summary.previous.totals.sessionCount
      )
    : null;
  const setsDelta = summary
    ? formatSetCountPairDelta(
        summary.current.totals.setCount,
        summary.current.totals.workingSetCount,
        summary.previous.totals.setCount,
        summary.previous.totals.workingSetCount
      )
    : null;

  const filteredFamilies = useMemo((): DisplayMuscleFamily[] => {
    if (!summary) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      return summary.current.totals.muscleFamilies.map((family) => ({
        family,
        visibleMuscles: family.muscles,
      }));
    }
    return summary.current.totals.muscleFamilies
      .map((family) => {
        const familyMatches = family.familyName.toLowerCase().includes(query);
        const matchingMuscles = family.muscles.filter((muscle) =>
          muscle.displayName.toLowerCase().includes(query)
        );
        const filteredMuscles = familyMatches ? family.muscles : matchingMuscles;
        if (filteredMuscles.length > 0) {
          return {
            family,
            visibleMuscles: filteredMuscles,
          };
        }
        return null;
      })
      .filter((family): family is DisplayMuscleFamily => family !== null);
  }, [summary, searchQuery]);

  const filteredExerciseListItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filteredItems = query
      ? exerciseListItems.filter((item) => item.name.toLowerCase().includes(query))
      : exerciseListItems;
    return sortExerciseListItems(filteredItems, exerciseSortMode);
  }, [exerciseListItems, exerciseSortMode, searchQuery]);

  const handlePressExerciseSortHeader = useCallback((header: ExerciseSortHeader) => {
    setExerciseSortMode((activeMode) => nextExerciseSortMode(activeMode, header));
  }, []);

  // One scroll for the whole screen, so the controls and the summary travel
  // with the list instead of sitting on top of it.
  const scrollTestID = viewMode === 'exercise' ? 'stats-exercise-list-scroll' : 'stats-scroll';

  return (
    <Screen testID="stats-history-screen">
      <ScreenScroll keyboardShouldPersistTaps="handled" testID={scrollTestID}>
        <View style={styles.controlGroup} testID="stats-time-range-controls">
          <Text allowFontScaling={false} style={styles.microLabel}>Time range</Text>
          <SegmentedControl
            accessibilityLabel="Select stats time range"
            options={PERIOD_OPTIONS}
            value={periodDays}
            onChange={onSelectPeriod}
            testIDPrefix="stats-period-chip"
          />
        </View>
        <View style={styles.controlGroup} testID="stats-breakdown-controls">
          <Text allowFontScaling={false} style={styles.microLabel}>Breakdown</Text>
          <SegmentedControl
            accessibilityLabel="Select stats breakdown"
            options={VIEW_MODE_OPTIONS}
            value={viewMode}
            onChange={onSelectViewMode}
            testIDPrefix="stats-view-mode-chip"
          />
        </View>

        {summary ? (
          <View style={styles.summaryGrid}>
            <Card
              accessibilityLabel="Open sessions list"
              onPress={onPressSessionsCard}
              style={styles.summaryCard}
              testID="stats-card-sessions">
              <View style={styles.summaryCardBody}>
                <View style={styles.summaryFigures}>
                  <Stat label="Sessions" value={formatNumber(summary.current.totals.sessionCount)} />
                  {sessionDelta ? <Delta delta={sessionDelta} /> : null}
                </View>
                <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />
              </View>
            </Card>

            <Card style={styles.summaryCard} testID="stats-card-sets">
              <View style={styles.summaryCardBody}>
                <View style={styles.summaryFigures}>
                  <Stat
                    label="Sets (W/Sets)"
                    value={formatSetCountPair(
                      summary.current.totals.setCount,
                      summary.current.totals.workingSetCount
                    )}
                  />
                  {setsDelta ? <Delta delta={setsDelta} /> : null}
                </View>
              </View>
            </Card>
          </View>
        ) : null}

        <SearchField
          accessibilityLabel={viewMode === 'exercise' ? 'Exercise filter input' : 'Muscle filter input'}
          autoCapitalize="none"
          clearLabel="Clear search input"
          onChangeText={onSearchQueryChange}
          placeholder={viewMode === 'exercise' ? 'Filter by exercise...' : 'Filter by muscle...'}
          testID="stats-search-input"
          value={searchQuery}
        />

        {viewMode === 'exercise' ? (
          <ExerciseListView
            items={filteredExerciseListItems}
            onPressExercise={onPressExerciseHistory}
            isFiltered={Boolean(searchQuery.trim())}
            sortMode={exerciseSortMode}
            onPressSortHeader={handlePressExerciseSortHeader}
          />
        ) : (
          <>
            {errorMessage ? (
              <Card>
                <StatePanel
                  body={errorMessage}
                  fill={false}
                  kind="error"
                  testID="stats-error-state"
                  title="Could not load stats"
                />
              </Card>
            ) : null}

            {!errorMessage && isLoading && !summary ? (
              <Card>
                <StatePanel body="Loading stats…" fill={false} kind="loading" testID="stats-loading-state" />
              </Card>
            ) : null}

            {summary ? (
              filteredFamilies.length === 0 ? (
                <Card>
                  <StatePanel
                    body={
                      searchQuery.trim()
                        ? 'No muscle groups match the search query.'
                        : 'No muscle taxonomy loaded yet. Add some exercises to see this section.'
                    }
                    fill={false}
                    testID="stats-muscle-empty"
                  />
                </Card>
              ) : (
                <MuscleFamilyList
                  families={filteredFamilies}
                  previousFamilies={summary.previous.totals.muscleFamilies}
                  periodDays={periodDays}
                  onPressMuscleHistory={onPressMuscleHistory}
                />
              )
            ) : null}
          </>
        )}
      </ScreenScroll>

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
    </Screen>
  );
}

// One ramp for every failure-intensity row, family or muscle (`ux-rules.md`
// §13.13): the shade says only "how much"; nesting tells family from muscle.
const FAILURE_SHADES = [uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4] as const;

const selectFailureShade = (progress: number): string | null => {
  if (progress <= 0) return null;
  const index = Math.min(FAILURE_SHADES.length - 1, Math.ceil(progress * FAILURE_SHADES.length) - 1);
  return FAILURE_SHADES[index];
};

function Delta({ delta, onViz = false }: { delta: DeltaDisplay; onViz?: boolean }) {
  // The sign carries the direction (G3); "new" is the one delta set in `ink`.
  // On a `viz` ground every text is `ink`.
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.delta, (delta.tone === 'new' || onViz) && styles.deltaInk]}>
      {delta.text}
    </Text>
  );
}

function RowMetric({
  label,
  value,
  delta,
  onViz,
  testID,
}: {
  label: string;
  value: string;
  delta: DeltaDisplay;
  onViz: boolean;
  testID: string;
}) {
  return (
    <View style={styles.rowMetric} testID={testID}>
      <Stat align="end" ground={onViz ? 'viz' : 'plain'} label={label} rank="secondary" value={value} />
      <Delta delta={delta} onViz={onViz} />
    </View>
  );
}

function MuscleRow({
  level,
  name,
  nameTestID,
  untrained,
  shade,
  sets,
  setsDelta,
  setsTestID,
  volume,
  volumeDelta,
  volumeTestID,
  accessibilityLabel,
  onPress,
  divider,
  testID,
}: {
  level: 'family' | 'muscle';
  name: string;
  nameTestID?: string;
  untrained: boolean;
  shade: string | null;
  sets: string;
  setsDelta: DeltaDisplay;
  setsTestID: string;
  volume: string;
  volumeDelta: DeltaDisplay;
  volumeTestID: string;
  accessibilityLabel: string;
  onPress: () => void;
  divider: boolean;
  testID: string;
}) {
  const onViz = shade !== null;
  return (
    // The shade is one uniform ground for the whole row; the row itself stays
    // the pressable, so its testID and accessibility are unchanged.
    <View style={shade !== null ? { backgroundColor: shade } : null} testID={`${testID}-shade`}>
      <ListRow
        accessibilityLabel={accessibilityLabel}
        density="list"
        divider={divider}
        leading={level === 'muscle' ? <View style={styles.nestIndent} /> : undefined}
        meta={
          <View style={styles.rowMetrics}>
            <RowMetric delta={setsDelta} label="Sets" onViz={onViz} testID={setsTestID} value={sets} />
            <RowMetric delta={volumeDelta} label="Volume" onViz={onViz} testID={volumeTestID} value={volume} />
          </View>
        }
        onPress={onPress}
        testID={testID}>
        <Text
          allowFontScaling={false}
          adjustsFontSizeToFit
          ellipsizeMode="clip"
          minimumFontScale={0.82}
          numberOfLines={2}
          style={[level === 'family' ? styles.familyName : styles.muscleName, untrained && styles.nameUntrained]}
          testID={nameTestID}>
          {name}
        </Text>
      </ListRow>
    </View>
  );
}

function MuscleFamilyList({
  families,
  previousFamilies,
  periodDays,
  onPressMuscleHistory,
}: {
  families: DisplayMuscleFamily[];
  previousFamilies: StatsMuscleFamilyPerformance[];
  periodDays: StatsPeriodDays;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  const previousByFamilyName = new Map(previousFamilies.map((family) => [family.familyName, family]));
  const previousMusclesById = new Map<string, StatsMusclePerformance>();
  for (const family of previousFamilies) {
    for (const muscle of family.muscles) {
      previousMusclesById.set(muscle.muscleGroupId, muscle);
    }
  }

  return (
    <View style={styles.familyList}>
      {families.map(({ family, visibleMuscles }) => (
        <MuscleFamilyCard
          key={family.familyName}
          family={family}
          visibleMuscles={visibleMuscles}
          previousFamily={previousByFamilyName.get(family.familyName) ?? null}
          previousMusclesById={previousMusclesById}
          periodDays={periodDays}
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
  visibleMuscles,
  previousFamily,
  previousMusclesById,
  periodDays,
  onPressMuscleHistory,
}: {
  family: StatsMuscleFamilyPerformance;
  visibleMuscles: StatsMusclePerformance[];
  previousFamily: StatsMuscleFamilyPerformance | null;
  previousMusclesById: Map<string, StatsMusclePerformance>;
  periodDays: StatsPeriodDays;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  const testIdSlug = family.familyName.toLowerCase().replace(/\s+/g, '-');
  const volumeDelta = formatVolumeDelta(family.totalVolume, previousFamily?.totalVolume ?? 0);
  const collapsed = isFamilyCollapsible(family);
  const collapsedMuscle = collapsed ? family.muscles[0] : null;

  return (
    <Card testID={`stats-family-card-${testIdSlug}`}>
      <MuscleRow
        accessibilityLabel={buildMuscleRowAccessibilityLabel({
          actionLabel: `Open ${family.familyName} history`,
          setCount: family.setCount,
          nearFailureCount: family.nearFailureCount,
          previousSetCount: previousFamily?.setCount ?? 0,
          previousNearFailureCount: previousFamily?.nearFailureCount ?? 0,
          volume: family.totalVolume,
          volumeDelta,
          periodDays,
        })}
        divider={false}
        level="family"
        name={family.familyName}
        nameTestID={`stats-family-name-${testIdSlug}`}
        onPress={() =>
          onPressMuscleHistory(
            collapsedMuscle ? toMuscleHistoryTarget(collapsedMuscle) : toFamilyHistoryTarget(family)
          )
        }
        sets={formatSetCountPair(family.setCount, family.nearFailureCount)}
        setsDelta={formatSetCountPairDelta(
          family.setCount,
          family.nearFailureCount,
          previousFamily?.setCount ?? 0,
          previousFamily?.nearFailureCount ?? 0
        )}
        setsTestID={`stats-family-sets-${testIdSlug}`}
        shade={selectFailureShade(computeFailureIntensityProgress(family.nearFailureCount, periodDays))}
        testID={
          collapsedMuscle
            ? `stats-family-header-button-${collapsedMuscle.muscleGroupId}`
            : `stats-family-header-${testIdSlug}`
        }
        untrained={family.setCount === 0 && family.totalVolume === 0}
        volume={formatTotalWeight(family.totalVolume)}
        volumeDelta={volumeDelta}
        volumeTestID={`stats-family-volume-${testIdSlug}`}
      />
      {collapsed
        ? null
        : visibleMuscles.map((muscle) => {
            const previousMuscle = previousMusclesById.get(muscle.muscleGroupId) ?? null;
            const muscleVolumeDelta = formatVolumeDelta(
              muscle.totalVolume,
              previousMuscle?.totalVolume ?? 0
            );
            return (
              <MuscleRow
                accessibilityLabel={buildMuscleRowAccessibilityLabel({
                  actionLabel: `Open ${muscle.displayName} history`,
                  setCount: muscle.setCount,
                  nearFailureCount: muscle.nearFailureCount,
                  previousSetCount: previousMuscle?.setCount ?? 0,
                  previousNearFailureCount: previousMuscle?.nearFailureCount ?? 0,
                  volume: muscle.totalVolume,
                  volumeDelta: muscleVolumeDelta,
                  periodDays,
                })}
                divider
                key={muscle.muscleGroupId}
                level="muscle"
                name={muscle.displayName}
                onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(muscle))}
                sets={formatSetCountPair(muscle.setCount, muscle.nearFailureCount)}
                setsDelta={formatSetCountPairDelta(
                  muscle.setCount,
                  muscle.nearFailureCount,
                  previousMuscle?.setCount ?? 0,
                  previousMuscle?.nearFailureCount ?? 0
                )}
                setsTestID={`stats-muscle-sets-${muscle.muscleGroupId}`}
                shade={selectFailureShade(
                  computeFailureIntensityProgress(muscle.nearFailureCount, periodDays)
                )}
                testID={`stats-muscle-row-${muscle.muscleGroupId}`}
                untrained={muscle.setCount === 0 && muscle.totalVolume === 0}
                volume={formatTotalWeight(muscle.totalVolume)}
                volumeDelta={muscleVolumeDelta}
                volumeTestID={`stats-muscle-volume-${muscle.muscleGroupId}`}
              />
            );
          })}
    </Card>
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

const EXERCISE_HISTORY_METRIC_OPTIONS: readonly { value: CalendarHeatmapMetric; label: string }[] = [
  { value: 'totalVolume', label: 'Volume' },
  { value: 'workingSetCount', label: 'W/sets' },
  { value: 'estimatedRM1', label: '1RM' },
  { value: 'highestWeight', label: 'Top weight' },
];

const METRIC_LABELS: Record<CalendarHeatmapMetric, string> = {
  totalVolume: 'Volume',
  workingSetCount: 'W/sets',
  estimatedRM1: '1RM',
  highestWeight: 'Top weight',
};

const MUSCLE_HISTORY_METRIC_OPTIONS: readonly { value: MuscleHistoryMetric; label: string }[] = [
  { value: 'totalVolume', label: METRIC_LABELS.totalVolume },
  { value: 'workingSetCount', label: METRIC_LABELS.workingSetCount },
];

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
    case 'workingSetCount': return String(week.workingSetCount);
    case 'estimatedRM1': return week.estimatedRM1 !== null ? formatTotalWeight(week.estimatedRM1) : '—';
    case 'highestWeight': return week.highestWeight !== null ? formatTotalWeight(week.highestWeight) : '—';
  }
};

// Formats a single value for the chosen metric (working sets is a raw count;
// the rest are weights). Used by the daily heatmap's per-day detail card.
const formatMetricNumber = (value: number, metric: CalendarHeatmapMetric): string =>
  metric === 'workingSetCount' ? String(value) : formatTotalWeight(value);

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
    <View style={overlayStyles.weekBanner} testID="stats-muscle-history-week-banner">
      {dateRange !== null ? (
        <>
          <Text allowFontScaling={false} style={overlayStyles.weekBannerRange} testID="stats-muscle-history-week-banner-range">
            {dateRange}
          </Text>
          <Text allowFontScaling={false} style={overlayStyles.weekBannerValue} testID="stats-muscle-history-week-banner-value">
            {METRIC_LABELS[metric]}: {value ?? '—'}
          </Text>
        </>
      ) : (
        <Text allowFontScaling={false} style={overlayStyles.weekBannerPlaceholder} testID="stats-muscle-history-week-banner-placeholder">
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
  const formatDailyValue = useCallback(
    (value: number) => formatMetricNumber(value, metric),
    [metric]
  );
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

  return (
    <View style={overlayStyles.heatmapTransition}>
      <View
        accessibilityElementsHidden={!dailyVisible}
        importantForAccessibility={dailyVisible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={dailyVisible ? 'auto' : 'none'}
        style={[
          overlayStyles.heatmapLayer,
          dailyVisible ? overlayStyles.heatmapLayerActive : overlayStyles.heatmapLayerInactive,
        ]}
        testID={`${testIDPrefix}-heatmap-panel-daily`}>
        {dailyHeatmap}
      </View>
      <View
        accessibilityElementsHidden={dailyVisible}
        importantForAccessibility={dailyVisible ? 'no-hide-descendants' : 'auto'}
        pointerEvents={dailyVisible ? 'none' : 'auto'}
        style={[
          overlayStyles.heatmapLayer,
          dailyVisible ? overlayStyles.heatmapLayerInactive : overlayStyles.heatmapLayerActive,
        ]}
        testID={`${testIDPrefix}-heatmap-panel-weekly`}>
        {weeklyHeatmap}
      </View>
    </View>
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
  metric: MuscleHistoryMetric;
  view: HeatmapView;
  onSelectMetric: (metric: MuscleHistoryMetric) => void;
  onSelectView: (view: HeatmapView) => void;
  onDismiss: () => void;
  onSelectWeek: (weekKey: string | null) => void;
  todayDateKey?: string;
}) {
  return (
    <View style={overlayStyles.overlayRoot} testID="stats-muscle-history-overlay">
      <Pressable
        accessibilityLabel="Dismiss muscle history"
        accessibilityRole="button"
        onPress={onDismiss}
        style={overlayStyles.overlayBackdrop}
        testID="stats-muscle-history-backdrop"
      />
      <View style={overlayStyles.overlayCard}>
        <View style={overlayStyles.overlayHeader}>
          <View style={overlayStyles.overlayTitleGroup}>
            <Text allowFontScaling={false} style={overlayStyles.overlayEyebrow}>
              {muscle.muscleGroupIds.length > 1 ? 'Muscle Group History' : 'Muscle History'}
            </Text>
            <Text
              allowFontScaling={false}
              adjustsFontSizeToFit
              ellipsizeMode="clip"
              minimumFontScale={0.82}
              numberOfLines={2}
              style={overlayStyles.overlayTitle}
              testID="stats-muscle-history-title">
              {muscle.displayName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close muscle history"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              overlayStyles.overlayCloseButton,
              pressed && overlayStyles.actionableRowPressed,
            ]}
            testID="stats-muscle-history-close">
            <Icon color={uiColors.actionNeutralSubtleText} name="x" size="sm" />
          </Pressable>
        </View>

        <View style={overlayStyles.overlayMetricSelector}>
          <SegmentedChips
            accessibilityLabel="Select effort metric"
            options={MUSCLE_HISTORY_METRIC_OPTIONS}
            value={metric}
            onChange={onSelectMetric}
            testIDPrefix="stats-muscle-history-metric-chip"
            compact
          />
        </View>

        <View style={overlayStyles.overlayViewSelector}>
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
          contentContainerStyle={overlayStyles.overlayContent}
          showsVerticalScrollIndicator={false}
          testID="stats-muscle-history-scroll">
          {isLoading ? (
            <View style={overlayStyles.overlayStatePanel} testID="stats-muscle-history-loading">
              <Text allowFontScaling={false} style={overlayStyles.stateBody}>Loading {muscle.displayName} history...</Text>
            </View>
          ) : null}

          {!isLoading && errorMessage ? (
            <View style={overlayStyles.overlayStatePanel} testID="stats-muscle-history-error">
              <Text allowFontScaling={false} style={overlayStyles.stateTitle}>Could not load muscle history</Text>
              <Text allowFontScaling={false} style={overlayStyles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {weeklyEffort.length === 0 ? (
                <View style={overlayStyles.overlayStatePanel} testID="stats-muscle-history-empty">
                  <Text allowFontScaling={false} style={overlayStyles.stateTitle}>No history yet</Text>
                  <Text allowFontScaling={false} style={overlayStyles.stateBody}>
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
  isFiltered,
  sortMode,
  onPressSortHeader,
}: {
  items: ExerciseListItem[];
  onPressExercise: (exercise: ExerciseHeatmapTarget) => void;
  isFiltered: boolean;
  sortMode: ExerciseSortMode;
  onPressSortHeader: (header: ExerciseSortHeader) => void;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <StatePanel
          body={isFiltered ? 'No exercises match the search query.' : 'No exercises with recorded history yet.'}
          fill={false}
          testID="stats-exercise-list-empty"
        />
      </Card>
    );
  }

  return (
    <Card testID="stats-exercise-list">
      <View style={styles.tableHeader} testID="stats-exercise-table-header">
        <ExerciseSortHeaderCell
          header="exercise"
          label="Exercise"
          sortMode={sortMode}
          onPress={onPressSortHeader}
          style={styles.nameColumn}
        />
        <View style={styles.tableColumns}>
          <ExerciseSortHeaderCell
            header="sets"
            label="Sets"
            sortMode={sortMode}
            onPress={onPressSortHeader}
            style={styles.setsColumn}
            numeric
          />
          <ExerciseSortHeaderCell
            header="volume"
            label="Vol"
            sortMode={sortMode}
            onPress={onPressSortHeader}
            style={styles.volumeColumn}
            numeric
          />
          <View
            accessibilityRole="header"
            style={[styles.headerCell, styles.headerCellNumeric, styles.oneRepMaxColumn]}
            testID="stats-exercise-header-oneRepMax">
            <Text allowFontScaling={false} numberOfLines={1} style={styles.headerLabel}>
              1RM
            </Text>
          </View>
        </View>
      </View>
      {items.map((item) => (
        <ListRow
          key={item.id}
          accessibilityLabel={`Open ${item.name} heatmap. ${formatNumber(
            item.setCount
          )} sets, ${formatNumber(item.nearFailureCount)} working sets. Volume ${formatTotalWeight(
            item.totalVolume
          )}${
            item.estimatedOneRepMax === null
              ? '. Estimated one rep max unavailable'
              : `. Estimated one rep max ${formatTotalWeight(item.estimatedOneRepMax)}`
          }`}
          density="list"
          meta={
            <View style={styles.tableColumns}>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.setsColumn]}
                testID={`stats-exercise-sets-${item.id}`}>
                {formatSetCountPair(item.setCount, item.nearFailureCount)}
              </Text>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.volumeColumn]}
                testID={`stats-exercise-volume-${item.id}`}>
                {formatTotalWeight(item.totalVolume)}
              </Text>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.oneRepMaxColumn]}
                testID={`stats-exercise-1rm-${item.id}`}>
                {item.estimatedOneRepMax === null ? '—' : formatTotalWeight(item.estimatedOneRepMax)}
              </Text>
            </View>
          }
          onPress={() => onPressExercise({ exerciseDefinitionId: item.id, displayName: item.name })}
          testID={`stats-exercise-row-${item.id}`}>
          <Text allowFontScaling={false} style={styles.exerciseName} testID={`stats-exercise-name-${item.id}`}>
            {item.name}
          </Text>
        </ListRow>
      ))}
    </Card>
  );
}

const exerciseSortDirection = (mode: ExerciseSortMode): 'up' | 'down' =>
  mode.endsWith('-asc') ? 'up' : 'down';

const exerciseSortHeaderLabel = (header: ExerciseSortHeader): string => {
  switch (header) {
    case 'exercise':
      return 'Exercise';
    case 'sets':
      return 'Sets and working sets';
    case 'volume':
      return 'Volume';
  }
};

function ExerciseSortHeaderCell({
  header,
  label,
  sortMode,
  onPress,
  style,
  numeric = false,
}: {
  header: ExerciseSortHeader;
  label: string;
  sortMode: ExerciseSortMode;
  onPress: (header: ExerciseSortHeader) => void;
  style: StyleProp<ViewStyle>;
  numeric?: boolean;
}) {
  const isActive = EXERCISE_SORT_HEADER_BY_MODE[sortMode] === header;
  const nextMode = nextExerciseSortMode(sortMode, header);
  // An inactive header still lays out a (transparent) indicator, so the
  // column does not shift when it becomes the active sort.
  const direction = isActive ? exerciseSortDirection(sortMode) : 'down';
  const accessibilityLabel = isActive
    ? `${exerciseSortHeaderLabel(header)}. Current sort: ${describeExerciseSortMode(
        sortMode
      )}. Activate to sort ${describeExerciseSortMode(nextMode)}.`
    : `${exerciseSortHeaderLabel(header)}. Activate to sort ${describeExerciseSortMode(nextMode)}.`;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => onPress(header)}
      style={({ pressed }) => [
        styles.headerCell,
        style,
        numeric && styles.headerCellNumeric,
        pressed && styles.headerCellPressed,
      ]}
      testID={`stats-exercise-sort-${header}`}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[styles.headerLabel, isActive && styles.headerLabelActive]}>
        {label}
      </Text>
      <View
        accessible={false}
        style={[
          styles.headerIndicator,
          header === 'exercise' && styles.headerIndicatorRecency,
          !isActive && styles.headerIndicatorHidden,
        ]}
        testID={`stats-exercise-sort-${header}-indicator`}>
        {header === 'exercise' ? (
          <Text allowFontScaling={false} accessible={false} style={styles.headerLabel}>
            Recent
          </Text>
        ) : null}
        <Icon
          color={uiRoles.ink}
          name={direction === 'up' ? 'arrow-up' : 'arrow-down'}
          size="xs"
          testID={`stats-exercise-sort-${header}-indicator-${direction}`}
        />
      </View>
    </Pressable>
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
    <View style={overlayStyles.overlayRoot} testID="stats-exercise-history-overlay">
      <Pressable
        accessibilityLabel="Dismiss exercise history"
        accessibilityRole="button"
        onPress={onDismiss}
        style={overlayStyles.overlayBackdrop}
        testID="stats-exercise-history-backdrop"
      />
      <View style={overlayStyles.overlayCard}>
        <View style={overlayStyles.overlayHeader}>
          <View style={overlayStyles.overlayTitleGroup}>
            <Text allowFontScaling={false} style={overlayStyles.overlayEyebrow}>Exercise History</Text>
            <Text
              allowFontScaling={false}
              adjustsFontSizeToFit
              ellipsizeMode="clip"
              minimumFontScale={0.82}
              numberOfLines={2}
              style={overlayStyles.overlayTitle}
              testID="stats-exercise-history-title">
              {exercise.displayName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close exercise history"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              overlayStyles.overlayCloseButton,
              pressed && overlayStyles.actionableRowPressed,
            ]}
            testID="stats-exercise-history-close">
            <Icon color={uiColors.actionNeutralSubtleText} name="x" size="sm" />
          </Pressable>
        </View>

        <View style={overlayStyles.overlayMetricSelector}>
          <SegmentedChips
            accessibilityLabel="Select effort metric"
            options={EXERCISE_HISTORY_METRIC_OPTIONS}
            value={metric}
            onChange={onSelectMetric}
            testIDPrefix="stats-exercise-history-metric-chip"
            compact
          />
        </View>

        <View style={overlayStyles.overlayViewSelector}>
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
          contentContainerStyle={overlayStyles.overlayContent}
          showsVerticalScrollIndicator={false}
          testID="stats-exercise-history-scroll">
          {isLoading ? (
            <View style={overlayStyles.overlayStatePanel} testID="stats-exercise-history-loading">
              <Text allowFontScaling={false} style={overlayStyles.stateBody}>Loading {exercise.displayName} history...</Text>
            </View>
          ) : null}

          {!isLoading && errorMessage ? (
            <View style={overlayStyles.overlayStatePanel} testID="stats-exercise-history-error">
              <Text allowFontScaling={false} style={overlayStyles.stateTitle}>Could not load exercise history</Text>
              <Text allowFontScaling={false} style={overlayStyles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {weeklyEffort.length === 0 ? (
                <View style={overlayStyles.overlayStatePanel} testID="stats-exercise-history-empty">
                  <Text allowFontScaling={false} style={overlayStyles.stateTitle}>No history yet</Text>
                  <Text allowFontScaling={false} style={overlayStyles.stateBody}>
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

export default function StatsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    period?: string | string[];
    breakdown?: string | string[];
  }>();
  const [periodDays, setPeriodDays] = useState<StatsPeriodDays>(() =>
    resolveStatsInitialPeriod(params.period)
  );
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleHistoryTarget | null>(null);
  const [muscleHistoryWeeklyEffort, setMuscleHistoryWeeklyEffort] = useState<SelectedMuscleWeeklyEffort[]>([]);
  const [muscleHistoryDailyMetrics, setMuscleHistoryDailyMetrics] = useState<DailyEffortMetrics[]>([]);
  const [isMuscleHistoryLoading, setIsMuscleHistoryLoading] = useState(false);
  const [muscleHistoryErrorMessage, setMuscleHistoryErrorMessage] = useState<string | null>(null);
  const [selectedMuscleHistoryWeekKey, setSelectedMuscleHistoryWeekKey] = useState<string | null>(null);
  const [muscleHistoryMetric, setMuscleHistoryMetric] = useState<MuscleHistoryMetric>('totalVolume');
  const [muscleHistoryView, setMuscleHistoryView] = useState<HeatmapView>('weekly');
  const muscleHistoryRequestIdRef = useRef(0);

  const [viewMode, setViewMode] = useState<StatsViewMode>(() =>
    resolveStatsInitialBreakdown(params.breakdown)
  );
  const [searchQuery, setSearchQuery] = useState('');
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
    useExerciseCatalogStats(periodDays);

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
    setSearchQuery('');
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
    const { aggregatesById, lastCompletedAtById } = exerciseCatalogStats;
    return exercises
      .filter((ex) => (aggregatesById.get(ex.id)?.setCount ?? 0) > 0)
      .map((ex) => {
        const agg = aggregatesById.get(ex.id) ?? null;
        return {
          id: ex.id,
          name: ex.name,
          setCount: agg?.setCount ?? 0,
          nearFailureCount: agg?.nearFailureCount ?? 0,
          totalVolume: agg?.totalVolume ?? 0,
          estimatedOneRepMax: agg?.estimatedOneRepMax ?? null,
          lastCompletedAt: lastCompletedAtById.get(ex.id) ?? null,
        };
      });
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
      searchQuery,
      onSearchQueryChange: setSearchQuery,
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
      searchQuery,
    ]
  );

  return <StatsScreenShell {...shellProps} />;
}

// The width the Exercise header reserves for its `Recent` + arrow indicator,
// visible or not, so the label never moves when the sort changes.
const RECENCY_INDICATOR_WIDTH = 64;

const microLabel = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700',
  fontSize: uiTypography.size.xxs,
  lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  textTransform: 'uppercase',
  color: uiRoles.inkMuted,
} as const;

// The screen body, in the design language (DLM-T08).
const styles = StyleSheet.create({
  controlGroup: {
    gap: uiSpace.sm,
  },
  microLabel,
  summaryGrid: {
    flexDirection: 'row',
    gap: uiSpace.md,
  },
  summaryCard: {
    flex: 1,
  },
  summaryCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    padding: uiSpace.md,
  },
  summaryFigures: {
    flex: 1,
    gap: uiSpace.xs,
  },
  delta: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  deltaInk: {
    color: uiRoles.ink,
  },
  familyList: {
    gap: uiSpace.md,
  },
  familyName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  muscleName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  nameUntrained: {
    color: uiRoles.inkMuted,
  },
  // A nested muscle row starts one step in from its family.
  nestIndent: {
    width: uiSpace.sm,
  },
  rowMetrics: {
    flexDirection: 'row',
    gap: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  rowMetric: {
    alignItems: 'flex-end',
    minWidth: uiSpace.xxl * 2,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.md,
  },
  tableColumns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  headerCell: {
    minHeight: uiGeometry.tapTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  headerCellNumeric: {
    justifyContent: 'flex-end',
  },
  headerCellPressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  headerLabel: microLabel,
  headerLabelActive: {
    color: uiRoles.ink,
  },
  headerIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  headerIndicatorRecency: {
    width: RECENCY_INDICATOR_WIDTH,
  },
  headerIndicatorHidden: {
    opacity: 0,
  },
  // The table's columns: the name takes the rest; the figures sit in fixed,
  // right-aligned columns so digits align down the list. `Vol` fits a
  // six-digit volume (`123456`) in Plex Mono.
  nameColumn: {
    flex: 1,
    minWidth: 0,
  },
  setsColumn: {
    width: 60,
  },
  volumeColumn: {
    width: 52,
  },
  oneRepMaxColumn: {
    width: 40,
  },
  exerciseName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
    paddingVertical: uiSpace.xs,
  },
  tableFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
    textAlign: 'right',
  },
});

// The history overlays and their heatmaps: legacy until DLM-T09 restyles them.
const overlayStyles = StyleSheet.create({
  heatmapTransition: {
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
  actionableRowPressed: {
    opacity: 0.7,
  },
  stateTitle: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: uiSpace.lg,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  overlayCard: {
    height: '75%',
    borderRadius: uiRadius.md,
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
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    gap: uiSpace.md,
  },
  overlayTitleGroup: {
    flexShrink: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  overlayEyebrow: {
    fontSize: uiTypography.size.xs,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  overlayTitle: {
    fontSize: uiTypography.size.xl,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  overlayCloseButton: {
    width: 32,
    height: 32,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayMetricSelector: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  overlayViewSelector: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  weekBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceMuted,
    gap: uiSpace.sm,
  },
  weekBannerRange: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  weekBannerValue: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.actionPrimary,
  },
  weekBannerPlaceholder: {
    fontSize: uiTypography.size.sm,
    fontWeight: '500',
    color: uiColors.textSecondary,
  },
  overlayContent: {
    padding: uiSpace.lg,
    gap: uiSpace.lg,
  },
  overlayStatePanel: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceInfo,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
});
