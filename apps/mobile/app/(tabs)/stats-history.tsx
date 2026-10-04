import { formatOneRepMax, formatVolume } from '@/src/exercise-calculations/format';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { compactVolumeFigure, formatVolumeWithCoverage } from '@/src/exercise-calculations/analytics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  EXERCISE_HISTORY_METRIC_OPTIONS,
  HistorySheet,
  MUSCLE_HISTORY_METRIC_OPTIONS,
  type MuscleHistoryMetric,
} from '@/components/stats/history-sheet';
import {
  Card,
  Icon,
  ListRow,
  Screen,
  ScreenScroll,
  SearchField,
  SegmentedControl,
  Stat,
  StatePanel,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import {
  type CalendarHeatmapMetric,
  type DailyEffortMetrics,
  type SelectedExerciseWeeklyEffort,
  type SelectedMuscleWeeklyEffort,
  type StatsMuscleFamilyPerformance,
  type StatsMusclePerformance,
  type StatsSummary,
} from '@/src/data';
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { HeatmapView } from '@/src/preferences/model';
import { groupedTargetAttainment, muscleTargetAttainment } from '@/src/preferences/targets';
import { useHistory } from '@/components/stats/use-history';
import { useStatsSummary } from '@/components/stats/use-summary';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

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
  workingSetCount: number;
  totalVolume: number | null;
  knownVolume?: number | null;
  estimatedOneRepMax: number | null;
  lastCompletedAt: Date | null;
};

export type ExerciseSortHeader = 'exercise' | 'sets' | 'volume';
export type ExerciseSortMode =
  | 'recency-desc'
  | 'recency-asc'
  | 'sets-desc'
  | 'sets-asc'
  | 'volume-desc'
  | 'volume-asc';

export const DEFAULT_EXERCISE_SORT_MODE: ExerciseSortMode = 'sets-desc';

const EXERCISE_SORT_CYCLES: Record<ExerciseSortHeader, ExerciseSortMode[]> = {
  exercise: ['recency-desc', 'recency-asc'],
  sets: ['sets-desc', 'sets-asc'],
  volume: ['volume-desc', 'volume-asc'],
};

const EXERCISE_SORT_HEADER_BY_MODE: Record<ExerciseSortMode, ExerciseSortHeader> = {
  'recency-desc': 'exercise',
  'recency-asc': 'exercise',
  'sets-desc': 'sets',
  'sets-asc': 'sets',
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

export const resolveStatsInitialBreakdown = (
  value: string | string[] | undefined
): StatsViewMode => (firstRouteParam(value) === 'muscle' ? 'muscle' : 'exercise');

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

/** What the summary cards' deltas compare against: the adjacent earlier period. */
export const formatPeriodComparison = (periodDays: number): string => `vs prev ${periodDays / 7} ${periodDays === 7 ? 'wk' : 'wks'}`;

export const formatVolumeDelta = (current: number | null, previous: number | null): DeltaDisplay => {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { text: 'Incomplete', tone: 'neutral' };
  if (current === 0 && previous === 0) {
    return { text: '—', tone: 'neutral' };
  }
  if (previous === 0) {
    return { text: 'new', tone: 'new' };
  }

  const percentDifference = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(percentDifference)) return { text: 'Increased', tone: 'positive' };
  if (percentDifference === 0) {
    return { text: '±0%', tone: 'neutral' };
  }
  return {
    text: `${percentDifference > 0 ? '+' : '−'}${Math.abs(percentDifference)}%`,
    tone: percentDifference > 0 ? 'positive' : 'negative',
  };
};

const describeCountDifference = (difference: number, label: string): string => {
  if (difference > 0) return `up ${formatNumber(difference)} ${label}`;
  if (difference < 0) return `down ${formatNumber(Math.abs(difference))} ${label}`;
  return `no change in ${label}`;
};

const describeVolumeDifference = (delta: DeltaDisplay): string => {
  if (delta.text === 'Increased') return 'increased volume; percentage exceeds numeric range';
  if (delta.text === 'Incomplete') return 'incomplete volume; comparison unavailable';
  if (delta.text === '—') return 'no volume in either period';
  if (delta.text === 'new') return 'new volume this period';
  if (delta.text === '±0%') return 'no percentage change in volume';
  return `${delta.tone === 'positive' ? 'up' : 'down'} ${delta.text.replace(/[+−]/, '')} in volume`;
};

const buildMuscleRowAccessibilityLabel = ({
  actionLabel,
  workingSetCount,
  previousWorkingSetCount,
  volume,
  volumeDelta,
  targetDescription,
}: {
  actionLabel: string;
  workingSetCount: number;
  previousWorkingSetCount: number;
  volume: number | null;
  volumeDelta: DeltaDisplay;
  targetDescription: string;
}): string =>
  [
    actionLabel,
    `${formatNumber(workingSetCount)} sets`,
    describeCountDifference(workingSetCount - previousWorkingSetCount, 'sets'),
    `volume ${formatTotalWeight(volume)}, ${describeVolumeDifference(volumeDelta)}`,
    targetDescription,
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
        comparison = compareNumbers(left.workingSetCount, right.workingSetCount, true);
        break;
      case 'sets-asc':
        comparison = compareNumbers(left.workingSetCount, right.workingSetCount, false);
        break;
      case 'volume-desc':
        comparison = compareOptionalNumbers(left.totalVolume, right.totalVolume, true);
        break;
      case 'volume-asc':
        comparison = compareOptionalNumbers(left.totalVolume, right.totalVolume, false);
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

// Full figures in Plex Mono, never `2.5k`: the numbers are the point
// (`design-language.md` §6, DLM-T08-D2).
const formatTotalWeight = (value: number | null): string => value === null ? '— · incomplete' : formatVolume(value);

export type StatsScreenShellProps = {
  summary: StatsSummary | null;
  periodDays: number;
  targetWindowWeeks?: number;
  historyLookbackWeeks?: number;
  weeklyWorkingSetTarget?: number;
  onSelectPeriod: (period: number) => void;
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
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  historyTodayDateKey?: string;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
};

export function StatsScreenShell({
  summary,
  periodDays,
  targetWindowWeeks = 4,
  historyLookbackWeeks = 52,
  weeklyWorkingSetTarget = 8,
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
    ? formatCountDelta(
        summary.current.totals.workingSetCount,
        summary.previous.totals.workingSetCount
      )
    : null;

  // Read outside the memo: the compiler takes `summary.current` for a ref.
  const muscleFamilies = summary ? summary.current.totals.muscleFamilies : null;
  const filteredFamilies = useMemo((): DisplayMuscleFamily[] => {
    if (!muscleFamilies) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      return muscleFamilies.map((family) => ({
        family,
        visibleMuscles: family.muscles,
      }));
    }
    return muscleFamilies
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
  }, [muscleFamilies, searchQuery]);

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
            options={targetWindowWeeks === 1 ? [{ value: 7, label: 'This week' }] : [
              { value: targetWindowWeeks * 7, label: `${targetWindowWeeks} weeks` }, { value: 7, label: 'This week' }]}
            value={periodDays}
            onChange={onSelectPeriod}
            testIDPrefix="stats-period-chip"
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
                  {sessionDelta ? <Delta comparison={formatPeriodComparison(periodDays)} delta={sessionDelta} /> : null}
                </View>
                <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />
              </View>
            </Card>

            <Card style={styles.summaryCard} testID="stats-card-sets">
              <View style={styles.summaryCardBody}>
                <View style={styles.summaryFigures}>
                  <Stat
                    label="Sets"
                    value={formatNumber(summary.current.totals.workingSetCount)}
                  />
                  {setsDelta ? <Delta comparison={formatPeriodComparison(periodDays)} delta={setsDelta} /> : null}
                </View>
              </View>
            </Card>
          </View>
        ) : null}

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
                  weeklyWorkingSetTarget={weeklyWorkingSetTarget}
                  onPressMuscleHistory={onPressMuscleHistory}
                />
              )
            ) : null}
          </>
        )}
      </ScreenScroll>

      {selectedMuscle ? (
        <HistorySheet
          dailyMetrics={muscleHistoryDailyMetrics}
          errorMessage={muscleHistoryErrorMessage}
          eyebrow={selectedMuscle.muscleGroupIds.length > 1 ? 'Muscle Group History' : 'Muscle History'}
          isLoading={isMuscleHistoryLoading}
          kind="muscle"
          metric={muscleHistoryMetric}
          metricOptions={MUSCLE_HISTORY_METRIC_OPTIONS}
          onDismiss={onDismissMuscleHistory}
          onSelectMetric={onSelectMuscleHistoryMetric}
          onSelectWeek={onSelectMuscleHistoryWeek}
          selectedWeekKey={selectedMuscleHistoryWeekKey}
          title={selectedMuscle.displayName}
          todayDateKey={historyTodayDateKey}
          view={muscleHistoryView}
          weeklyEffort={muscleHistoryWeeklyEffort}
          lookbackWeeks={historyLookbackWeeks}
          muscleTargets={{ muscleIds: selectedMuscle.muscleGroupIds, weeklyTarget: weeklyWorkingSetTarget }}
        />
      ) : null}
      {selectedExercise ? (
        <HistorySheet
          dailyMetrics={exerciseHistoryDailyMetrics}
          errorMessage={exerciseHistoryErrorMessage}
          eyebrow="Exercise History"
          isLoading={isExerciseHistoryLoading}
          kind="exercise"
          metric={exerciseHistoryMetric}
          metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS}
          onDismiss={onDismissExerciseHistory}
          onSelectMetric={onSelectExerciseHistoryMetric}
          onSelectWeek={onSelectExerciseHistoryWeek}
          selectedWeekKey={selectedExerciseHistoryWeekKey}
          title={selectedExercise.displayName}
          todayDateKey={historyTodayDateKey}
          view={exerciseHistoryView}
          weeklyEffort={exerciseHistoryWeeklyEffort}
          lookbackWeeks={historyLookbackWeeks}
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

function Delta({
  delta,
  onViz = false,
  comparison,
}: {
  delta: DeltaDisplay;
  onViz?: boolean;
  /** Names what the delta is against (`vs prev 1 wk`), after the figure. */
  comparison?: string;
}) {
  // The sign carries the direction (G3); "new" is the one delta set in `ink`.
  // On a `viz` ground every text is `ink`.
  return (
    <Text
      allowFontScaling={false}
      accessibilityLabel={comparison ? `${delta.text} ${comparison.replace('vs prev', 'versus previous').replace(/wks$/, 'weeks').replace(/wk$/, 'week')}, same elapsed calendar span` : undefined}
      numberOfLines={1}
      style={[styles.delta, (delta.tone === 'new' || onViz) && styles.deltaInk]}>
      {comparison ? `${delta.text} ${comparison}` : delta.text}
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
  volumeIncomplete,
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
  volumeIncomplete: boolean;
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
            <RowMetric delta={volumeDelta} label={volumeIncomplete && volume !== '—' ? 'Known vol' : 'Volume'} onViz={onViz} testID={volumeTestID} value={volume} />
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
  weeklyWorkingSetTarget,
  onPressMuscleHistory,
}: {
  families: DisplayMuscleFamily[];
  previousFamilies: StatsMuscleFamilyPerformance[];
  periodDays: number;
  weeklyWorkingSetTarget: number;
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
          weeklyWorkingSetTarget={weeklyWorkingSetTarget}
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
  weeklyWorkingSetTarget,
  onPressMuscleHistory,
}: {
  family: StatsMuscleFamilyPerformance;
  visibleMuscles: StatsMusclePerformance[];
  previousFamily: StatsMuscleFamilyPerformance | null;
  previousMusclesById: Map<string, StatsMusclePerformance>;
  periodDays: number;
  weeklyWorkingSetTarget: number;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  const testIdSlug = family.familyName.toLowerCase().replace(/\s+/g, '-');
  const volumeDelta = formatVolumeDelta(family.totalVolume, previousFamily ? previousFamily.totalVolume : 0);
  const collapsed = isFamilyCollapsible(family);
  const collapsedMuscle = collapsed ? family.muscles[0] : null;

  return (
    <Card testID={`stats-family-card-${testIdSlug}`}>
      <MuscleRow
        accessibilityLabel={buildMuscleRowAccessibilityLabel({
          actionLabel: `Open ${family.familyName} history`,
          workingSetCount: family.workingSetCount,
          previousWorkingSetCount: previousFamily?.workingSetCount ?? 0,
          volume: family.totalVolume,
          volumeDelta,
          targetDescription: `Colour: average attainment of ${family.muscles.length} muscle targets over ${periodDays / 7} weeks, capped per muscle at 100%`,
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
        sets={formatNumber(family.workingSetCount)}
        setsDelta={formatCountDelta(family.workingSetCount, previousFamily?.workingSetCount ?? 0)}
        setsTestID={`stats-family-sets-${testIdSlug}`}
        shade={selectFailureShade(groupedTargetAttainment(family.muscles.map(muscle => muscle.muscleGroupId),
          Object.fromEntries(family.muscles.map(muscle => [muscle.muscleGroupId, muscle.workingSetCount])), weeklyWorkingSetTarget, periodDays / 7))}
        testID={
          collapsedMuscle
            ? `stats-family-header-button-${collapsedMuscle.muscleGroupId}`
            : `stats-family-header-${testIdSlug}`
        }
        untrained={family.workingSetCount === 0 && family.totalVolume === 0}
        volume={compactVolumeFigure(family.totalVolume, family.knownVolume)}
        volumeIncomplete={family.totalVolume === null}
        volumeDelta={volumeDelta}
        volumeTestID={`stats-family-volume-${testIdSlug}`}
      />
      {collapsed
        ? null
        : visibleMuscles.map((muscle) => {
            const previousMuscle = previousMusclesById.get(muscle.muscleGroupId) ?? null;
            const muscleVolumeDelta = formatVolumeDelta(
              muscle.totalVolume,
              previousMuscle ? previousMuscle.totalVolume : 0
            );
            return (
              <MuscleRow
                accessibilityLabel={buildMuscleRowAccessibilityLabel({
                  actionLabel: `Open ${muscle.displayName} history`,
                  workingSetCount: muscle.workingSetCount,
                  previousWorkingSetCount: previousMuscle?.workingSetCount ?? 0,
                  volume: muscle.totalVolume,
                  volumeDelta: muscleVolumeDelta,
                  targetDescription: `Colour: ${weeklyWorkingSetTarget} W/sets per week × ${periodDays / 7} weeks`,
                })}
                divider
                key={muscle.muscleGroupId}
                level="muscle"
                name={muscle.displayName}
                onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(muscle))}
                sets={formatNumber(muscle.workingSetCount)}
                setsDelta={formatCountDelta(muscle.workingSetCount, previousMuscle?.workingSetCount ?? 0)}
                setsTestID={`stats-muscle-sets-${muscle.muscleGroupId}`}
                shade={selectFailureShade(
                  muscleTargetAttainment(muscle.workingSetCount, weeklyWorkingSetTarget, periodDays / 7)
                )}
                testID={`stats-muscle-row-${muscle.muscleGroupId}`}
                untrained={muscle.workingSetCount === 0 && muscle.totalVolume === 0}
                volume={compactVolumeFigure(muscle.totalVolume, muscle.knownVolume)}
                volumeIncomplete={muscle.totalVolume === null}
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
            item.workingSetCount
          )} sets. Volume ${formatVolumeWithCoverage(
            item.totalVolume, item.knownVolume
          )}${
            item.estimatedOneRepMax === null
              ? '. Estimated one rep max unavailable'
              : `. Estimated one rep max ${formatOneRepMax(item.estimatedOneRepMax)} kg`
          }`}
          density="list"
          meta={
            <View style={styles.tableColumns}>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.setsColumn]}
                testID={`stats-exercise-sets-${item.id}`}>
                {formatNumber(item.workingSetCount)}
              </Text>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.volumeColumn]}
                testID={`stats-exercise-volume-${item.id}`}>
                {item.totalVolume !== null ? formatTotalWeight(item.totalVolume) : item.knownVolume != null && item.knownVolume > 0 ? formatTotalWeight(item.knownVolume) : '—'}
              </Text>
              <Text
                allowFontScaling={false}
                style={[styles.tableFigure, styles.oneRepMaxColumn]}
                testID={`stats-exercise-1rm-${item.id}`}>
                {item.estimatedOneRepMax === null ? '—' : formatOneRepMax(item.estimatedOneRepMax)}
              </Text>
            </View>
          }
          onPress={() => onPressExercise({ exerciseDefinitionId: item.id, displayName: item.name })}
          testID={`stats-exercise-row-${item.id}`}>
          <Text allowFontScaling={false} style={styles.exerciseName} testID={`stats-exercise-name-${item.id}`}>
            {item.name}
          </Text>
          {item.totalVolume === null ? <Text allowFontScaling={false} style={styles.exerciseMetricNote}
            testID={`stats-exercise-coverage-${item.id}`}>Volume incomplete</Text> : null}
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
      return 'Sets';
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

export default function StatsRoute() {
  const { user } = useAuth();
  return <StatsContent key={user?.id ?? 'local'} />;
}

function StatsContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ period?: string | string[]; breakdown?: string | string[] }>();
  const { values } = useAccountLocalPreferenceState();
  const [thisWeek, setThisWeek] = useState(firstRouteParam(params.period) === '7');
  const weeks = thisWeek ? 1 : values.targetWindowWeeks;
  const periodDays = weeks * 7;
  const catalogPeriod = useMemo(() => ({ weeks }), [weeks]);
  const catalog = useExerciseCatalog();
  const { stats, reload } = useExerciseCatalogStats(catalogPeriod);
  const revision = useBodyWeightContextRevision();
  const summary = useStatsSummary(weeks, revision, reload);
  const muscle = useHistory<MuscleHistoryTarget>(values.historyLookbackWeeks, revision);
  const exercise = useHistory<ExerciseHeatmapTarget>(values.historyLookbackWeeks, revision);
  const [muscleMetric, setMuscleMetric] = useState<MuscleHistoryMetric>('totalVolume');
  const [exerciseMetric, setExerciseMetric] = useState<CalendarHeatmapMetric>('totalVolume');
  const [viewMode, setViewMode] = useState<StatsViewMode>(() => resolveStatsInitialBreakdown(params.breakdown));
  const [searchQuery, setSearchQuery] = useState('');
  const exerciseListItems = useMemo<ExerciseListItem[]>(() => catalog.exercises
    .filter(item => stats.aggregatesById.has(item.id))
    .map(item => {
      const aggregate = stats.aggregatesById.get(item.id)!;
      return { id: item.id, name: item.name, workingSetCount: aggregate.workingSetCount,
        totalVolume: aggregate.totalVolume, knownVolume: aggregate.knownVolume,
        estimatedOneRepMax: aggregate.estimatedOneRepMax, lastCompletedAt: stats.lastCompletedAtById.get(item.id) ?? null };
    }), [catalog.exercises, stats]);
  return <StatsScreenShell {...summary} periodDays={periodDays} targetWindowWeeks={values.targetWindowWeeks}
    historyLookbackWeeks={values.historyLookbackWeeks} weeklyWorkingSetTarget={values.weeklyWorkingSetTarget}
    onSelectPeriod={days => setThisWeek(days === 7)} onPressSessionsCard={() => router.push('/sessions')}
    onPressMuscleHistory={muscle.select} onDismissMuscleHistory={muscle.dismiss} onSelectMuscleHistoryWeek={muscle.selectWeek}
    selectedMuscle={muscle.selected} muscleHistoryWeeklyEffort={muscle.weekly} muscleHistoryDailyMetrics={muscle.daily}
    isMuscleHistoryLoading={muscle.loading} muscleHistoryErrorMessage={muscle.error} selectedMuscleHistoryWeekKey={muscle.weekKey}
    muscleHistoryMetric={muscleMetric} muscleHistoryView={values.heatmapView} onSelectMuscleHistoryMetric={setMuscleMetric}
    viewMode={viewMode} onSelectViewMode={mode => { setViewMode(mode); setSearchQuery(''); exercise.dismiss(); muscle.dismiss(); }}
    exerciseListItems={exerciseListItems} selectedExercise={exercise.selected} exerciseHistoryWeeklyEffort={exercise.weekly}
    exerciseHistoryDailyMetrics={exercise.daily} isExerciseHistoryLoading={exercise.loading} exerciseHistoryErrorMessage={exercise.error}
    selectedExerciseHistoryWeekKey={exercise.weekKey} exerciseHistoryMetric={exerciseMetric} exerciseHistoryView={values.heatmapView}
    onPressExerciseHistory={exercise.select} onDismissExerciseHistory={exercise.dismiss} onSelectExerciseHistoryWeek={exercise.selectWeek}
    onSelectExerciseHistoryMetric={setExerciseMetric} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />;
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
    backgroundColor: uiRoles.paper,
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
    // Let Recent wrap below the label when both cannot fit beside Sets.
    flexWrap: 'wrap',
    alignContent: 'center',
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
  exerciseMetricNote: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
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
