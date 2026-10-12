import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  Card,
  Icon,
  ListRow,
  Screen,
  ScreenScroll,
  SearchField,
  StatePanel,
  ToggleChip,
  uiRoles,
  uiSpace,
} from '@/components/ui';
import { type ProgressComparisons } from '@/src/data';
import type { ExerciseAggregate } from '@/src/data/exercise-catalog-stats';
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { ProgressExerciseMetric, ProgressMetric } from '@/src/preferences/model';
import { ProgressTables } from '@/components/stats/progress-tables';
import {
  COLUMN_KEYS,
  COLUMN_NAMES,
  ComparisonHeaders,
  ComparisonValues,
  comparisonFigures,
  comparisonSortValues,
  hasComparisonMetric,
  metricUnit,
  resolveComparisonLayout,
  type ComparisonColumnKey,
  type ComparisonPeriodFigures,
} from '@/components/stats/comparison-columns';
import {
  StatsTable,
  StatsTableHeaderLabel,
  statsTableStyles,
} from '@/components/stats/stats-table';
import { type ProgressPeriod, useProgressFilters } from '@/components/stats/use-progress-filters';
import { progressHistoryHref } from '@/src/navigation/routes';
import { useStatsSummary } from '@/components/stats/use-summary';
import { useDelayedFlag } from '@/components/stats/use-delayed-flag';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogComparison } from '@/src/exercise-catalog/stats-cache';

export type MuscleHistoryTarget = { muscleGroupId: string };
export type ExerciseHeatmapTarget = { exerciseDefinitionId: string };

/** One exercise's two periods, drawn in the columns both breakdowns share. */
export type ExerciseListItem = {
  id: string;
  name: string;
  current: ComparisonPeriodFigures;
  previous: ComparisonPeriodFigures;
  lastCompletedAt: Date | null;
};

// The name column sorts by recency; each figure column sorts by its own figure
// for the metric in force, so the sort survives a metric change.
export type ExerciseSortHeader = 'exercise' | ComparisonColumnKey;
export type ExerciseSortMode =
  | 'recency-desc'
  | 'recency-asc'
  | 'now-desc'
  | 'now-asc'
  | 'previous-desc'
  | 'previous-asc'
  | 'change-desc'
  | 'change-asc';

export const DEFAULT_EXERCISE_SORT_MODE: ExerciseSortMode = 'now-desc';

const EXERCISE_SORT_CYCLES: Record<ExerciseSortHeader, ExerciseSortMode[]> = {
  exercise: ['recency-desc', 'recency-asc'],
  now: ['now-desc', 'now-asc'],
  previous: ['previous-desc', 'previous-asc'],
  change: ['change-desc', 'change-asc'],
};

const EXERCISE_SORT_HEADER_BY_MODE: Record<ExerciseSortMode, ExerciseSortHeader> = {
  'recency-desc': 'exercise',
  'recency-asc': 'exercise',
  'now-desc': 'now',
  'now-asc': 'now',
  'previous-desc': 'previous',
  'previous-asc': 'previous',
  'change-desc': 'change',
  'change-asc': 'change',
};

export type StatsViewMode = 'exercise' | 'muscle';
// The filter row holds three chips at phone width, so each carries one word.
// `Sets` unqualified is the working-set count ([[set.count-display]]).
const VIEW_MODE_OPTIONS = [
  { value: 'exercise' as StatsViewMode, label: 'Exercise' },
  { value: 'muscle' as StatsViewMode, label: 'Muscle' },
] as const;
const METRIC_OPTIONS = [
  { value: 'workingSetCount' as ProgressMetric, label: 'Sets' },
  { value: 'totalVolume' as ProgressMetric, label: 'Volume' },
] as const;
// An exercise has a 1RM estimate; a muscle does not, so only this breakdown
// offers the third ([[comparison.change-display]] says how its change reads).
const EXERCISE_METRIC_OPTIONS = [
  { value: 'workingSetCount' as ProgressExerciseMetric, label: 'Sets' },
  { value: 'totalVolume' as ProgressExerciseMetric, label: 'Volume' },
  { value: 'estimatedOneRepMax' as ProgressExerciseMetric, label: '1RM' },
] as const;

// Period choices and accessibility wording follow [[comparison.window]].
// `This week` is the only choice when Settings' Progress period is one week,
// which leaves the chip inert rather than offering the same span twice.
const periodOptions = (targetWindowWeeks: number) => {
  const thisWeek = { value: 'this-week' as ProgressPeriod, label: 'This week',
    accessibilityLabel: `This week, ${formatPeriodComparison(7)}, full previous calendar week` };
  if (targetWindowWeeks === 1) return [thisWeek];
  return [{ value: 'window' as ProgressPeriod, label: `${targetWindowWeeks} weeks`,
    accessibilityLabel: `${targetWindowWeeks} weeks, ${formatPeriodComparison(targetWindowWeeks * 7)}, full previous calendar weeks` },
    thisWeek];
};

export { formatCountDelta, formatOneRepMaxDelta, formatVolumeDelta } from '@/components/stats/comparison-format';
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
  if (mode === 'recency-desc') return 'Most recent exercise';
  if (mode === 'recency-asc') return 'Least recent exercise';
  const header = EXERCISE_SORT_HEADER_BY_MODE[mode];
  return `${exerciseSortHeaderLabel(header)} — ${mode.endsWith('-asc') ? 'low to high' : 'high to low'}`;
};

const compareExerciseIdentity = (left: ExerciseListItem, right: ExerciseListItem): number => {
  const nameComparison = left.name.localeCompare(right.name);
  return nameComparison === 0 ? left.id.localeCompare(right.id) : nameComparison;
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
  if (validLeft === validRight) return 0;
  if (descending) return validLeft > validRight ? -1 : 1;
  return validLeft < validRight ? -1 : 1;
};

const completedTimestamp = (item: ExerciseListItem): number | null => {
  const timestamp = item.lastCompletedAt?.getTime() ?? null;
  return timestamp !== null && Number.isFinite(timestamp) ? timestamp : null;
};

/**
 * The list in the order the pressed header asks for. A row with nothing in the
 * sorted column — no estimate, or a change that is `new` or unavailable —
 * sorts last in both directions, so a column never leads with blanks; ties
 * fall back to the name, then the id, so the order is total.
 */
export const sortExerciseListItems = (
  items: ExerciseListItem[],
  mode: ExerciseSortMode = DEFAULT_EXERCISE_SORT_MODE,
  metric: ProgressExerciseMetric = 'workingSetCount'
): ExerciseListItem[] => {
  const header = EXERCISE_SORT_HEADER_BY_MODE[mode];
  const descending = !mode.endsWith('-asc');
  const sortValue = (item: ExerciseListItem) => header === 'exercise'
    ? completedTimestamp(item)
    : comparisonSortValues(item, metric)[header];
  return items
    .map(item => ({ item, value: sortValue(item) }))
    .sort((left, right) => compareOptionalNumbers(left.value, right.value, descending)
      || compareExerciseIdentity(left.item, right.item))
    .map(({ item }) => item);
};

export type StatsScreenShellProps = {
  summary: ProgressComparisons | null;
  onRetry?: () => void;
  period: ProgressPeriod;
  targetWindowWeeks?: number;
  onSelectPeriod: (period: ProgressPeriod) => void;
  onPressSessionsCard: () => void;
  // A muscle or exercise name opens its history page; Progress keeps its own
  // state and scroll behind it.
  onOpenMuscleHistory: (muscle: MuscleHistoryTarget) => void;
  onOpenExerciseHistory: (exercise: ExerciseHeatmapTarget) => void;
  isLoading: boolean;
  errorMessage: string | null;
  viewMode: StatsViewMode;
  onSelectViewMode: (mode: StatsViewMode) => void;
  tableMetric: ProgressMetric;
  onSelectTableMetric: (metric: ProgressMetric) => void;
  // The Exercise table's own metric, which may be one the Muscle table cannot show.
  exerciseMetric: ProgressExerciseMetric;
  onSelectExerciseMetric: (metric: ProgressExerciseMetric) => void;
  exerciseListItems: ExerciseListItem[];
  // False while the history page is on top: returning restores reader focus.
  isFocused?: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
};

export function StatsScreenShell({
  summary,
  onRetry,
  period,
  targetWindowWeeks = 4,
  onSelectPeriod,
  onPressSessionsCard,
  onOpenMuscleHistory,
  onOpenExerciseHistory,
  isLoading,
  errorMessage,
  viewMode,
  onSelectViewMode,
  tableMetric,
  onSelectTableMetric,
  exerciseMetric,
  onSelectExerciseMetric,
  exerciseListItems,
  isFocused = true,
  searchQuery,
  onSearchQueryChange,
}: StatsScreenShellProps) {
  const [exerciseSortMode, setExerciseSortMode] = useState<ExerciseSortMode>(
    DEFAULT_EXERCISE_SORT_MODE
  );
  const [contributionId, setContributionId] = useState<string | null>(null);
  // The row whose history was opened, held only until the return it is for:
  // any other way back to Progress (a tab, the Sessions link) leaves the
  // reader where it landed.
  const launchTarget = useRef<ComponentRef<typeof View> | null>(null);
  const focusRequest = useRef(0);
  useEffect(() => () => { focusRequest.current += 1; }, []);
  const focus = useCallback((target: ComponentRef<typeof View> | null) => {
    const request = ++focusRequest.current;
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (request !== focusRequest.current) return;
      const handle = target && findNodeHandle(target);
      if (enabled && handle) AccessibilityInfo.setAccessibilityFocus(handle);
    });
  }, []);
  const wasFocused = useRef(isFocused);
  useEffect(() => {
    const returned = isFocused && !wasFocused.current;
    wasFocused.current = isFocused;
    if (!returned) return;
    const row = launchTarget.current;
    launchTarget.current = null;
    if (row) focus(row);
  }, [focus, isFocused]);
  const showContributions = (id: string) => {
    setContributionId(current => current === id ? null : id);
  };
  // The press that opens history: the keyboard goes, the row is remembered for
  // the return, and any pending focus request for an earlier row is dropped.
  const openHistory = useCallback(
    <T,>(open: (target: T) => void, target: T, row: ComponentRef<typeof View> | null) => {
      focusRequest.current += 1;
      Keyboard.dismiss();
      launchTarget.current = row;
      open(target);
    },
    []
  );

  // A row with nothing for the metric in either period is not drawn, as in the
  // Muscle table's contributions.
  const filteredExerciseListItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matching = exerciseListItems.filter(item => hasComparisonMetric(item, exerciseMetric)
      && (query === '' || item.name.toLowerCase().includes(query)));
    return sortExerciseListItems(matching, exerciseSortMode, exerciseMetric);
  }, [exerciseListItems, exerciseMetric, exerciseSortMode, searchQuery]);

  const handlePressExerciseSortHeader = useCallback((header: ExerciseSortHeader) => {
    setExerciseSortMode((activeMode) => nextExerciseSortMode(activeMode, header));
  }, []);

  const scrollTestID = viewMode === 'exercise' ? 'stats-exercise-list-scroll' : 'stats-scroll';
  const showLoading = useDelayedFlag(isLoading && !summary && !errorMessage, LOADING_PANEL_DELAY_MS);

  return (
    <Screen testID="stats-history-screen">
      <View style={styles.controls} testID="stats-controls">
        <View style={styles.filters} testID="stats-view-switch">
          <ToggleChip accessibilityLabel="Stats breakdown" options={VIEW_MODE_OPTIONS}
            value={viewMode} onChange={onSelectViewMode} testID="stats-view-mode-chip" />
          <ToggleChip accessibilityLabel="Stats period" options={periodOptions(targetWindowWeeks)}
            value={targetWindowWeeks === 1 ? 'this-week' : period} onChange={onSelectPeriod} testID="stats-period-chip" />
          {viewMode === 'muscle' ? (
            <ToggleChip accessibilityLabel="Progress metric" options={METRIC_OPTIONS}
              value={tableMetric} onChange={onSelectTableMetric} testID="stats-metric-chip" />
          ) : (
            <ToggleChip accessibilityLabel="Progress metric" options={EXERCISE_METRIC_OPTIONS}
              value={exerciseMetric} onChange={onSelectExerciseMetric} testID="stats-metric-chip" />
          )}
        </View>
        {viewMode === 'exercise' ? (
          <SearchField accessibilityLabel="Exercise filter input" autoCapitalize="none" clearLabel="Clear search input"
            onChangeText={onSearchQueryChange} placeholder="Filter by exercise..." testID="stats-search-input" value={searchQuery} />
        ) : null}
      </View>
      <ScreenScroll contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" testID={scrollTestID}>
        {errorMessage ? <StatePanel fill={false} kind="error" title="Could not load progress"
          testID="stats-error-state" action={onRetry ? { label: 'Retry', onPress: onRetry, testID: 'stats-retry' } : undefined} /> : null}
        {showLoading ? <StatePanel body="Loading progress…" fill={false}
          kind="loading" testID="stats-loading-state" /> : null}
        {viewMode === 'exercise' ? (
          <ExerciseListView items={filteredExerciseListItems} metric={exerciseMetric}
            onPressExercise={(row, target) => openHistory(onOpenExerciseHistory, row, target)}
            emptyBody={exerciseEmptyBody(exerciseListItems, exerciseMetric)}
            sortMode={exerciseSortMode} onPressSortHeader={handlePressExerciseSortHeader} />
        ) : summary ? <ProgressTables muscles={summary.muscles} metric={tableMetric} selectedId={contributionId}
          onSelect={showContributions}
          onMuscleHistory={(row, target) => openHistory(onOpenMuscleHistory, { muscleGroupId: row.muscleGroupId }, target)}
          onExerciseHistory={(row, target) => openHistory(onOpenExerciseHistory, { exerciseDefinitionId: row.exerciseDefinitionId }, target)}
          /> : null}
        <ListRow onPress={onPressSessionsCard} accessibilityLabel="Open sessions list" testID="stats-sessions-link"
          meta={<Icon name="chevron-right" size="sm" />}><Text allowFontScaling={false} style={statsTableStyles.name}>Sessions</Text></ListRow>
      </ScreenScroll>

    </Screen>
  );
}

// An empty table says which of the three it is: no history at all, nothing
// for the metric in force, or nothing matching the search. The metric comes
// first, so a search whose exercises do exist is not blamed for a metric none
// of them has.
const exerciseEmptyBody = (items: ExerciseListItem[], metric: ProgressExerciseMetric): string => {
  if (items.length === 0) return 'No exercises with recorded history yet.';
  if (!items.some(item => hasComparisonMetric(item, metric))) {
    const figure = metric === 'workingSetCount' ? 'working sets'
      : metric === 'totalVolume' ? 'volume-included sets' : '1RM estimates';
    return `No exercises with ${figure} in either period.`;
  }
  // Something has the metric, so only the search can have emptied the table.
  return 'No exercises match the search query.';
};

function ExerciseListView({
  items,
  metric,
  onPressExercise,
  emptyBody,
  sortMode,
  onPressSortHeader,
}: {
  items: ExerciseListItem[];
  metric: ProgressExerciseMetric;
  onPressExercise: (exercise: ExerciseHeatmapTarget, target: ComponentRef<typeof View> | null) => void;
  emptyBody: string;
  sortMode: ExerciseSortMode;
  onPressSortHeader: (header: ExerciseSortHeader) => void;
}) {
  const links = useRef(new Map<string, ComponentRef<typeof View>>());
  const { width } = useWindowDimensions();
  if (items.length === 0) {
    return (
      <Card>
        <StatePanel body={emptyBody} fill={false} testID="stats-exercise-list-empty" />
      </Card>
    );
  }

  // The rows carry no trailing control, so no axis is reserved for one; the
  // headers sort, so each column keeps room for its indicator.
  const layout = resolveComparisonLayout(width, items, metric, false, true);
  return (
    <StatsTable testID="stats-exercise-list">
      <ComparisonHeaders
        axis={false}
        column={(position, columnWidth) => (
          <ExerciseSortHeaderCell
            header={position.key}
            label={position.label}
            metric={metric}
            numeric
            onPress={onPressSortHeader}
            sortMode={sortMode}
            style={{ width: columnWidth }}
          />
        )}
        layout={layout}
        metric={metric}
        name={
          <ExerciseSortHeaderCell
            header="exercise"
            label="Exercise"
            metric={metric}
            onPress={onPressSortHeader}
            sortMode={sortMode}
            style={styles.nameColumn}
          />
        }
        testID="stats-exercise-table-header"
      />
      {items.map((item) => {
        const values = (
          <ComparisonValues
            layout={layout}
            metric={metric}
            prefix={`stats-exercise-row-${item.id}`}
            row={item}
            speak={false}
          />
        );
        return (
          <ListRow
            key={item.id}
            ref={target => { if (target) links.current.set(item.id, target); else links.current.delete(item.id); }}
            accessibilityLabel={exerciseRowLabel(item, metric)}
            density="list"
            meta={layout.stacked ? undefined : values}
            onPress={() => onPressExercise({ exerciseDefinitionId: item.id }, links.current.get(item.id) ?? null)}
            testID={`stats-exercise-row-${item.id}`}>
            <Text allowFontScaling={false} style={statsTableStyles.name} testID={`stats-exercise-name-${item.id}`}>
              {item.name}
            </Text>
            {layout.stacked ? values : null}
          </ListRow>
        );
      })}
    </StatsTable>
  );
}

// The whole row is one target, so it speaks its own figures; the cells inside
// stay plain rather than offering a second, unreachable element.
const exerciseRowLabel = (item: ExerciseListItem, metric: ProgressExerciseMetric): string => {
  const figures = comparisonFigures(item, metric);
  return `Open ${item.name} heatmap. Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${metricUnit(metric)}.`;
};

const exerciseSortDirection = (mode: ExerciseSortMode): 'up' | 'down' =>
  mode.endsWith('-asc') ? 'up' : 'down';

// A figure column is named as the columns name themselves (`Previous`, not the
// header's abbreviated `Prev`).
const exerciseSortHeaderLabel = (header: ExerciseSortHeader): string =>
  header === 'exercise' ? 'Exercise' : COLUMN_NAMES[COLUMN_KEYS.indexOf(header)];

function ExerciseSortHeaderCell({
  header,
  label,
  metric,
  sortMode,
  onPress,
  style,
  numeric = false,
}: {
  header: ExerciseSortHeader;
  label: string;
  metric: ProgressExerciseMetric;
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
  // A figure column names its unit, like the Muscle table's spoken headers.
  const named = numeric
    ? `${exerciseSortHeaderLabel(header)}, ${metricUnit(metric)}`
    : exerciseSortHeaderLabel(header);
  const accessibilityLabel = isActive
    ? `${named}. Current sort: ${describeExerciseSortMode(sortMode)}. Activate to sort ${describeExerciseSortMode(nextMode)}.`
    : `${named}. Activate to sort ${describeExerciseSortMode(nextMode)}.`;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => onPress(header)}
      style={({ pressed }) => [
        statsTableStyles.headerCell,
        style,
        numeric && statsTableStyles.headerCellNumeric,
        pressed && styles.headerCellPressed,
      ]}
      testID={`stats-exercise-sort-${header}`}>
      <StatsTableHeaderLabel active={isActive} label={label} />
      <View
        accessible={false}
        style={[
          styles.headerIndicator,
          header === 'exercise' && styles.headerIndicatorRecency,
          !isActive && styles.headerIndicatorHidden,
        ]}
        testID={`stats-exercise-sort-${header}-indicator`}>
        {header === 'exercise' ? (
          <StatsTableHeaderLabel label="Recent" />
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
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ period?: string | string[]; breakdown?: string | string[] }>();
  const { values } = useAccountLocalPreferenceState();
  const filters = useProgressFilters(params);
  const weeks = filters.period === 'this-week' ? 1 : values.targetWindowWeeks;
  const catalog = useExerciseCatalog();
  const { current: thisPeriod, previous: lastPeriod, reload } = useExerciseCatalogComparison(weeks);
  const revision = useBodyWeightContextRevision();
  const summary = useStatsSummary(weeks, values.targetWindowWeeks, revision, reload);
  const [searchQuery, setSearchQuery] = useState('');
  // An exercise is listed when either period counted a set for it: one that
  // stopped is as much a comparison as one that started.
  const exerciseListItems = useMemo<ExerciseListItem[]>(() => catalog.exercises
    .filter(item => thisPeriod.aggregatesById.has(item.id) || lastPeriod.aggregatesById.has(item.id))
    .map(item => ({
      id: item.id,
      name: item.name,
      current: periodFigures(thisPeriod.aggregatesById.get(item.id)),
      previous: periodFigures(lastPeriod.aggregatesById.get(item.id)),
      lastCompletedAt: thisPeriod.lastCompletedAtById.get(item.id) ?? null,
    })), [catalog.exercises, thisPeriod, lastPeriod]);
  return <StatsScreenShell {...summary} period={filters.period} targetWindowWeeks={values.targetWindowWeeks}
    onSelectPeriod={filters.selectPeriod} onPressSessionsCard={() => router.push('/sessions')}
    onOpenMuscleHistory={muscle => router.push(progressHistoryHref(muscle, filters.metric))}
    onOpenExerciseHistory={exercise => router.push(progressHistoryHref(exercise, filters.metric))}
    viewMode={filters.breakdown} onSelectViewMode={filters.selectBreakdown}
    tableMetric={filters.metric} onSelectTableMetric={filters.selectMetric}
    exerciseMetric={filters.exerciseMetric} onSelectExerciseMetric={filters.selectExerciseMetric}
    isFocused={isFocused}
    exerciseListItems={exerciseListItems} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />;
}

// A period the exercise has no aggregate for is a genuine nothing: zero sets,
// zero volume and no estimate. One it does keeps its own figures — a
// `totalVolume` of null is a sum that overflowed, which stays unavailable
// rather than becoming a zero ([[copy.no-inline-explanation]]).
const periodFigures = (aggregate: ExerciseAggregate | undefined): ComparisonPeriodFigures =>
  aggregate
    ? { workingSetCount: aggregate.workingSetCount, totalVolume: aggregate.totalVolume,
      volumeSetCount: aggregate.volumeSetCount, estimatedOneRepMax: aggregate.estimatedOneRepMax }
    : { workingSetCount: 0, totalVolume: 0, volumeSetCount: 0, estimatedOneRepMax: null };

// A read that lands sooner than this never draws the loading panel, so a fast
// switch does not push the table down and back up.
const LOADING_PANEL_DELAY_MS = 100;

// The width the Exercise header reserves for its `Recent` + arrow indicator,
// visible or not, so the label never moves when the sort changes.
const RECENCY_INDICATOR_WIDTH = 64;

// The screen body, in the design language.
const styles = StyleSheet.create({
  controls: { paddingHorizontal: uiSpace.lg, paddingTop: uiSpace.lg, paddingBottom: uiSpace.md, gap: uiSpace.md },
  filters: { flexDirection: 'row', alignItems: 'stretch', gap: uiSpace.sm },
  // The page's last row clears the display's rounded corner above the tab bar,
  // which otherwise clips it: one more step of the spacing scale than the
  // gutter `ScreenScroll` already applies.
  scrollContent: { paddingBottom: uiSpace.xxl },
  headerCellPressed: {
    backgroundColor: uiRoles.paper,
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
  // The name takes whatever the three figure columns leave, and lets `Recent`
  // wrap below the label when both cannot fit beside `Now`.
  nameColumn: {
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    alignContent: 'center',
  },
});
