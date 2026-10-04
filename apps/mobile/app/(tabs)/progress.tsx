import { formatOneRepMax, formatVolume } from '@/src/exercise-calculations/format';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { formatVolumeWithCoverage } from '@/src/exercise-calculations/analytics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentRef, useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  type ScrollViewInstance,
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
  type ProgressComparisons,
} from '@/src/data';
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { HeatmapView } from '@/src/preferences/model';
import { ProgressTables, type ProgressTableMetric } from '@/components/stats/progress-tables';
import { isIndividualMuscleHistoryTarget, useHistory } from '@/components/stats/use-history';
import { useStatsSummary } from '@/components/stats/use-summary';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

export type MuscleHistoryTarget = {
  muscleGroupIds: [string];
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
): StatsViewMode => (firstRouteParam(value) === 'exercise' ? 'exercise' : 'muscle');

export { formatCountDelta, formatVolumeDelta } from '@/components/stats/comparison-format';
export const formatPeriodComparison = (periodDays: number): string =>
  periodDays === 7 ? 'vs previous week' : `vs previous ${periodDays / 7} weeks`;

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

// Full figures in Plex Mono, never `2.5k`: the numbers are the point
// (`design-language.md` §6, DLM-T08-D2).
const formatTotalWeight = (value: number | null): string => value === null ? '— · incomplete' : formatVolume(value);

export type StatsScreenShellProps = {
  summary: ProgressComparisons | null;
  onRetry?: () => void;
  periodDays: number;
  targetWindowWeeks?: number;
  historyLookbackWeeks?: number;
  weeklyWorkingSetTarget?: number;
  onSelectPeriod: (period: number) => void;
  onPressSessionsCard: () => void;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
  onDismissMuscleHistory: () => void;
  onRetryMuscleHistory?: () => void;
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
  onRetryExerciseHistory?: () => void;
  onSelectExerciseHistoryWeek: (weekKey: string | null) => void;
  onSelectExerciseHistoryMetric: (metric: CalendarHeatmapMetric) => void;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  historyTodayDateKey?: string;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
};

export function StatsScreenShell({
  summary,
  onRetry,
  periodDays,
  targetWindowWeeks = 4,
  historyLookbackWeeks = 52,
  weeklyWorkingSetTarget = 8,
  onSelectPeriod,
  onPressSessionsCard,
  onPressMuscleHistory,
  onDismissMuscleHistory,
  onRetryMuscleHistory,
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
  onRetryExerciseHistory,
  onSelectExerciseHistoryWeek,
  onSelectExerciseHistoryMetric,
  historyTodayDateKey,
  searchQuery,
  onSearchQueryChange,
}: StatsScreenShellProps) {
  const [exerciseSortMode, setExerciseSortMode] = useState<ExerciseSortMode>(
    DEFAULT_EXERCISE_SORT_MODE
  );
  const [tableMetric, setTableMetric] = useState<ProgressTableMetric>('workingSetCount');
  const [contributionId, setContributionId] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const heading = useRef<ComponentRef<typeof View>>(null);
  const contributionY = useRef<number | null>(null);
  const pendingScroll = useRef(false);
  const launchTarget = useRef<ComponentRef<typeof View> | null>(null);
  const focus = (target: ComponentRef<typeof View> | null) => {
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      const handle = target && findNodeHandle(target);
      if (enabled && handle) AccessibilityInfo.setAccessibilityFocus(handle);
    });
  };
  const showContributions = (id: string) => {
    pendingScroll.current = true;
    setContributionId(id);
    requestAnimationFrame(() => {
      if (pendingScroll.current && contributionY.current !== null) {
        scroll.current?.scrollTo({ y: contributionY.current, animated: true });
        focus(heading.current);
        pendingScroll.current = false;
      }
    });
  };
  const dismissMuscle = () => { onDismissMuscleHistory(); focus(launchTarget.current); };
  const dismissExercise = () => { onDismissExerciseHistory(); focus(launchTarget.current); };

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
      <ScreenScroll ref={scroll} keyboardShouldPersistTaps="handled" testID={scrollTestID}>
        <SegmentedControl
          accessibilityLabel="Select stats time range"
          options={targetWindowWeeks === 1 ? [{ value: 7, label: 'This week' }] : [
            { value: targetWindowWeeks * 7, label: `${targetWindowWeeks} weeks` }, { value: 7, label: 'This week' }]}
          value={periodDays} onChange={onSelectPeriod} testIDPrefix="stats-period-chip" />
        {viewMode === 'muscle' ? <>
          <SegmentedControl accessibilityLabel="Select progress metric"
            options={[{ value: 'workingSetCount', label: 'Working sets' }, { value: 'totalVolume', label: 'Volume' }]}
            value={tableMetric} onChange={setTableMetric} testIDPrefix="stats-metric-chip" />
          <Text allowFontScaling={false} style={styles.comparison}
            accessibilityLabel={`${formatPeriodComparison(periodDays)}, same elapsed calendar span`}
            testID="stats-comparison-label">{formatPeriodComparison(periodDays)}</Text>
        </> : <SegmentedControl accessibilityLabel="Select stats breakdown" options={VIEW_MODE_OPTIONS}
          value={viewMode} onChange={onSelectViewMode} testIDPrefix="stats-view-mode-chip" />}
        {errorMessage ? <StatePanel body={errorMessage} fill={false} kind="error" title="Could not load progress"
          testID="stats-error-state" action={onRetry ? { label: 'Retry', onPress: onRetry, testID: 'stats-retry' } : undefined} /> : null}
        {isLoading && !summary && !errorMessage ? <StatePanel body="Loading progress…" fill={false}
          kind="loading" testID="stats-loading-state" /> : null}
        {viewMode === 'exercise' ? <>
          <SearchField accessibilityLabel="Exercise filter input" autoCapitalize="none" clearLabel="Clear search input"
            onChangeText={onSearchQueryChange} placeholder="Filter by exercise..." testID="stats-search-input" value={searchQuery} />
          <ExerciseListView items={filteredExerciseListItems} onPressExercise={(row, target) => { launchTarget.current = target; onPressExerciseHistory(row); }}
            isFiltered={Boolean(searchQuery.trim())} sortMode={exerciseSortMode} onPressSortHeader={handlePressExerciseSortHeader} />
        </> : summary ? <ProgressTables muscles={summary.muscles} metric={tableMetric} selectedId={contributionId}
          weeks={periodDays / 7} weeklyTarget={weeklyWorkingSetTarget} onSelect={showContributions}
          onMuscleHistory={(row, target) => { launchTarget.current = target; onPressMuscleHistory({ muscleGroupIds: [row.muscleGroupId], displayName: row.displayName, familyName: row.familyName }); }}
          onExerciseHistory={(row, target) => { launchTarget.current = target; onPressExerciseHistory({ exerciseDefinitionId: row.exerciseDefinitionId, displayName: row.displayName }); }}
          headingRef={heading} onContributionLayout={event => {
            contributionY.current = event.nativeEvent.layout.y;
            if (pendingScroll.current) {
              scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true });
              focus(heading.current);
              pendingScroll.current = false;
            }
          }} /> : null}
        {viewMode === 'muscle' ? <ListRow onPress={() => onSelectViewMode('exercise')}
          accessibilityLabel="Browse exercises" testID="stats-browse-exercises"
          meta={<Icon name="chevron-right" size="sm" />}><Text allowFontScaling={false} style={styles.exerciseName}>Browse exercises</Text></ListRow> : null}
        <ListRow onPress={onPressSessionsCard} accessibilityLabel="Open sessions list" testID="stats-sessions-link"
          meta={<Icon name="chevron-right" size="sm" />}><Text allowFontScaling={false} style={styles.exerciseName}>Sessions</Text></ListRow>
      </ScreenScroll>

      {selectedMuscle && isIndividualMuscleHistoryTarget(selectedMuscle) ? (
        <HistorySheet
          dailyMetrics={muscleHistoryDailyMetrics}
          errorMessage={muscleHistoryErrorMessage}
          eyebrow="Muscle History"
          isLoading={isMuscleHistoryLoading}
          kind="muscle"
          metric={muscleHistoryMetric}
          metricOptions={MUSCLE_HISTORY_METRIC_OPTIONS}
          onDismiss={dismissMuscle}
          onRetry={onRetryMuscleHistory}
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
          onDismiss={dismissExercise}
          onRetry={onRetryExerciseHistory}
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

function ExerciseListView({
  items,
  onPressExercise,
  isFiltered,
  sortMode,
  onPressSortHeader,
}: {
  items: ExerciseListItem[];
  onPressExercise: (exercise: ExerciseHeatmapTarget, target: ComponentRef<typeof View> | null) => void;
  isFiltered: boolean;
  sortMode: ExerciseSortMode;
  onPressSortHeader: (header: ExerciseSortHeader) => void;
}) {
  const links = useRef(new Map<string, ComponentRef<typeof View>>());
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
          ref={target => { if (target) links.current.set(item.id, target); else links.current.delete(item.id); }}
          accessibilityLabel={`Open ${item.name} heatmap. ${String(
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
                {String(item.workingSetCount)}
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
          onPress={() => onPressExercise({ exerciseDefinitionId: item.id, displayName: item.name }, links.current.get(item.id) ?? null)}
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
  const historyRevision = revision + summary.refreshRevision;
  const muscle = useHistory<MuscleHistoryTarget>(values.historyLookbackWeeks, historyRevision);
  const exercise = useHistory<ExerciseHeatmapTarget>(values.historyLookbackWeeks, historyRevision);
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
    onPressMuscleHistory={muscle.select} onDismissMuscleHistory={muscle.dismiss} onRetryMuscleHistory={muscle.retry} onSelectMuscleHistoryWeek={muscle.selectWeek}
    selectedMuscle={muscle.selected} muscleHistoryWeeklyEffort={muscle.weekly} muscleHistoryDailyMetrics={muscle.daily}
    isMuscleHistoryLoading={muscle.loading} muscleHistoryErrorMessage={muscle.error} selectedMuscleHistoryWeekKey={muscle.weekKey}
    muscleHistoryMetric={muscleMetric} muscleHistoryView={values.heatmapView} onSelectMuscleHistoryMetric={setMuscleMetric}
    viewMode={viewMode} onSelectViewMode={mode => { setViewMode(mode); exercise.dismiss(); muscle.dismiss(); }}
    exerciseListItems={exerciseListItems} selectedExercise={exercise.selected} exerciseHistoryWeeklyEffort={exercise.weekly}
    exerciseHistoryDailyMetrics={exercise.daily} isExerciseHistoryLoading={exercise.loading} exerciseHistoryErrorMessage={exercise.error}
    selectedExerciseHistoryWeekKey={exercise.weekKey} exerciseHistoryMetric={exerciseMetric} exerciseHistoryView={values.heatmapView}
    onPressExerciseHistory={exercise.select} onDismissExerciseHistory={exercise.dismiss} onRetryExerciseHistory={exercise.retry} onSelectExerciseHistoryWeek={exercise.selectWeek}
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
  comparison: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
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
