import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, type ComponentRef, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Keyboard,
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
  uiSpace,
} from '@/components/ui';
import { type ProgressComparisons, type ProgressMuscleComparison } from '@/src/data';
import type { ExerciseAggregate } from '@/src/data/exercise-catalog-stats';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { ExerciseBodyView } from '@/components/stats/exercise-body-view';
import {
  buildExerciseBodyMuscle,
  buildExerciseBodyMuscles,
  type ExerciseContributionEntry,
} from '@/components/stats/exercise-body-data';
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { HeatmapView, ProgressExerciseMetric, ProgressMetric, ProgressMuscleLayout } from '@/src/preferences/model';
import {
  compareFamilySections, countFamilyMuscles, familyHasHeader, nextMuscleSortMode, type MuscleSortMode,
} from '@/components/stats/progress-tables';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import { NO_MUSCLE_REPORT, reportedPrimaryFamilyName } from '@/src/exercise-catalog/reported-muscles';
import { ProgressMuscleView } from '@/components/stats/progress-muscle-view';
import {
  COLUMN_KEYS,
  COLUMN_NAMES,
  ComparisonHeaders,
  ComparisonValues,
  comparisonFigures,
  comparisonSortValues,
  compareOptionalNumbers,
  hasComparisonMetric,
  metricUnit,
  resolveComparisonLayout,
  type ComparisonColumnKey,
  type ComparisonPeriodFigures,
} from '@/components/stats/comparison-columns';
import {
  StatsTable,
  StatsTableFamily,
  StatsTableSortHeader,
  statsTableStyles,
} from '@/components/stats/stats-table';
import { type ProgressPeriod, useProgressFilters } from '@/components/stats/use-progress-filters';
import { progressHistoryHref } from '@/src/navigation/routes';
import type { MuscleTickerStatus } from '@/components/stats/muscle-ticker';
import { useMuscleTickers } from '@/components/stats/use-muscle-tickers';
import type { ProgressMuscleTickers } from '@/src/data/progress-muscle-tickers';
import { useStatsSummary } from '@/components/stats/use-summary';
import { useDelayedFlag } from '@/components/stats/use-delayed-flag';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { exerciseSearchTextMatches, normalizeExerciseSearchWords } from '@/src/exercise-catalog/search';
import { useExerciseCatalogComparison } from '@/src/exercise-catalog/stats-cache';
import { ProgressFilters } from '@/components/stats/progress-filters';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';

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
  muscleTickers?: ProgressMuscleTickers | null;
  muscleTickerStatus?: MuscleTickerStatus;
  onRetry?: () => void;
  period: ProgressPeriod;
  targetWindowWeeks?: number;
  onSelectPeriod: (period: ProgressPeriod) => void;
  onPressSessionsCard: () => void;
  // A muscle or exercise name opens its history page; Progress keeps its own
  // state and scroll behind it.
  onOpenMuscleHistory: (muscle: MuscleHistoryTarget, view?: HeatmapView) => void;
  onOpenExerciseHistory: (exercise: ExerciseHeatmapTarget) => void;
  isLoading: boolean;
  errorMessage: string | null;
  viewMode: StatsViewMode;
  onSelectViewMode: (mode: StatsViewMode) => void;
  muscleLayout: ProgressMuscleLayout;
  tableMetric: ProgressMetric;
  onSelectTableMetric: (metric: ProgressMetric) => void;
  // The Exercise table's own metric, which may be one the Muscle table cannot show.
  exerciseMetric: ProgressExerciseMetric;
  onSelectExerciseMetric: (metric: ProgressExerciseMetric) => void;
  exerciseListItems: ExerciseListItem[];
  /** Catalogue search haystacks by exercise id (name + muscle groups). */
  exerciseSearchIndex: ReadonlyMap<string, string>;
  exerciseFamilies?: ReadonlyMap<string, string>;
  exerciseMappings?: readonly Pick<ExerciseCatalogExercise, 'id' | 'mappings'>[];
  /** The user's muscle setup ([[muscle.report-groups]]); unset shows every anatomy entry as its own muscle. */
  muscleReport?: MuscleReportAssignment;
  exerciseDataReady?: boolean;
  exerciseDataError?: string | null;
  // False while the history page is on top: returning restores reader focus.
  isFocused?: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  /** The tables' gym filter, three-state (`src/utils/gym-scope-route.ts`). */
  gymId?: string | null;
  gymOptions?: readonly GymScopeOption[];
  onSelectGym?: (gymId: string | null | undefined) => void;
  /** Whether muscle figures count secondary work ([[muscle.secondary-filter]]); this visit's choice. */
  countSecondary?: boolean;
  onChangeCountSecondary?: (countSecondary: boolean) => void;
};

// The pinned search row keeps its controls reachable above either table; the
// view's choices sit behind its Filters button. Muscle 3D has no table to
// search, so its row holds the button alone.
function ProgressSearchControls({ viewMode, tableVisible, exerciseSpatial, grouped, onToggleGroup, query, onChangeQuery,
  gymId, gymOptions, onSelectGym, countSecondary = true, onChangeCountSecondary }: Pick<StatsScreenShellProps,
  'viewMode' | 'gymId' | 'gymOptions' | 'onSelectGym' | 'countSecondary' | 'onChangeCountSecondary'> & {
  tableVisible: boolean; exerciseSpatial: boolean; grouped: boolean; onToggleGroup: () => void; query: string; onChangeQuery: (query: string) => void;
}) {
  const exercise = viewMode === 'exercise';
  const searchable = exercise || tableVisible;
  // Exercise List counts no muscle, so secondary work changes nothing there.
  const secondaryApplies = !exercise || exerciseSpatial;
  return <View style={[styles.searchRow, searchable ? null : styles.filtersOnly]}>
    {searchable ? <View style={styles.search}>
      <SearchField accessibilityLabel={exercise ? 'Exercise filter input' : 'Muscle filter input'}
        autoCapitalize="none" clearLabel="Clear search input" onChangeText={onChangeQuery}
        placeholder={exercise ? 'Search exercises or muscles' : 'Search muscles'}
        testID={exercise ? 'stats-search-input' : 'stats-muscle-search-input'} value={query} />
    </View> : null}
    <ProgressFilters testID="stats-filters"
      grouping={tableVisible ? { value: grouped, onChange: onToggleGroup } : undefined}
      secondary={secondaryApplies && onChangeCountSecondary ? { value: countSecondary, onChange: onChangeCountSecondary } : undefined}
      gym={searchable && onSelectGym ? { value: gymId, options: gymOptions ?? [], onChange: onSelectGym } : undefined} />
  </View>;
}

export function StatsScreenShell({
  summary,
  muscleTickers,
  muscleTickerStatus,
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
  muscleLayout,
  tableMetric,
  onSelectTableMetric,
  exerciseMetric,
  onSelectExerciseMetric,
  exerciseListItems,
  exerciseSearchIndex,
  exerciseFamilies,
  exerciseMappings = [],
  muscleReport = NO_MUSCLE_REPORT,
  exerciseDataReady = true,
  exerciseDataError = null,
  isFocused = true,
  searchQuery,
  onSearchQueryChange,
  gymId,
  gymOptions = [],
  onSelectGym,
  countSecondary = true,
  onChangeCountSecondary,
}: StatsScreenShellProps) {
  const [exerciseSortMode, setExerciseSortMode] = useState<ExerciseSortMode>(
    DEFAULT_EXERCISE_SORT_MODE
  );
  const [muscleSortMode, setMuscleSortMode] = useState<MuscleSortMode>('now-desc');
  const [grouped, setGrouped] = useState({ exercise: true, muscle: true });
  const [muscleSearch, setMuscleSearch] = useState('');
  const tableVisible = muscleLayout === 'list' || (viewMode === 'exercise' && muscleLayout === '3d' && exerciseMetric === 'estimatedOneRepMax');
  const exerciseSpatial = muscleLayout !== 'list' && !(muscleLayout === '3d' && exerciseMetric === 'estimatedOneRepMax');
  const [contributionId, setContributionId] = useState<string | null>(null);
  // The row whose history was opened, held only until the return it is for:
  // any other way back to Progress (a tab, the Sessions link) leaves the
  // reader where it landed.
  const launchTarget = useRef<ComponentRef<typeof View> | number | null>(null);
  const focusRequest = useRef(0);
  useEffect(() => () => { focusRequest.current += 1; }, []);
  const focus = useCallback((target: ComponentRef<typeof View> | number | null) => {
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
    <T,>(open: (target: T) => void, target: T, row: ComponentRef<typeof View> | number | null) => {
      focusRequest.current += 1;
      Keyboard.dismiss();
      launchTarget.current = row;
      open(target);
    },
    []
  );

  const filteredExerciseListItems = useMemo(() => {
    const searchWords = normalizeExerciseSearchWords(searchQuery);
    const matching = exerciseListItems.filter(item => hasComparisonMetric(item, exerciseMetric)
      && exerciseSearchTextMatches(searchWords, exerciseSearchIndex.get(item.id) ?? item.name));
    return sortExerciseListItems(matching, exerciseSortMode, exerciseMetric);
  }, [exerciseListItems, exerciseSearchIndex, exerciseMetric, exerciseSortMode, searchQuery]);

  const handlePressExerciseSortHeader = useCallback((header: ExerciseSortHeader) => {
    setExerciseSortMode((activeMode) => nextExerciseSortMode(activeMode, header));
  }, []);

  const scrollTestID = viewMode === 'exercise' ? 'stats-exercise-list-scroll' : 'stats-scroll';
  const bodyActive = viewMode === 'exercise' && exerciseSpatial;
  const { activeError, bodyReady, pending } = progressPresentationState({ bodyActive, summary, isLoading,
    errorMessage, exerciseDataReady, exerciseDataError });
  const showLoading = useDelayedFlag(pending, LOADING_PANEL_DELAY_MS);
  // Family headers follow the user's muscles ([[muscle.family-sections]]); unknown until they load.
  const familyMuscleCounts = useMemo(
    () => summary ? countFamilyMuscles(summary.muscles.map(muscle => muscle.familyName)) : undefined, [summary]);
  const exerciseList = (items: ExerciseListItem[], splitByEffort = false, secondary?: readonly ExerciseContributionEntry[], emptyOverride?: string) => <ExerciseListView items={items} metric={exerciseMetric}
    secondary={secondary} splitByEffort={splitByEffort}
    grouped={tableVisible && grouped.exercise} families={exerciseFamilies} familyMuscleCounts={familyMuscleCounts}
    onPressExercise={(row, target) => openHistory(onOpenExerciseHistory, row, target)}
    emptyBody={emptyOverride ?? exerciseEmptyBody(exerciseListItems, exerciseMetric)}
    sortMode={exerciseSortMode} onPressSortHeader={handlePressExerciseSortHeader} />;

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
        <ProgressSearchControls viewMode={viewMode} tableVisible={tableVisible} exerciseSpatial={exerciseSpatial} grouped={grouped[viewMode]}
          onToggleGroup={() => setGrouped(current => ({ ...current, [viewMode]: !current[viewMode] }))}
          query={viewMode === 'exercise' ? searchQuery : muscleSearch}
          onChangeQuery={viewMode === 'exercise' ? onSearchQueryChange : setMuscleSearch}
          gymId={gymId} gymOptions={gymOptions} onSelectGym={onSelectGym}
          countSecondary={countSecondary} onChangeCountSecondary={onChangeCountSecondary} />
      </View>
      <ScreenScroll key={viewMode === 'exercise' ? `exercise-${exerciseSpatial}` : muscleLayout} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" testID={scrollTestID}>
        {activeError ? <StatePanel fill={false} kind="error" title="Could not load progress"
          testID="stats-error-state" action={onRetry ? { label: 'Retry', onPress: onRetry, testID: 'stats-retry' } : undefined} /> : null}
        {showLoading ? <StatePanel body="Loading progress…" fill={false}
          kind="loading" testID="stats-loading-state" /> : null}
        {viewMode === 'exercise' ? <ExerciseBreakdown metric={exerciseMetric} muscleLayout={muscleLayout} ready={bodyReady}
          exercises={exerciseMappings} muscles={summary?.muscles ?? []} countSecondary={countSecondary} report={muscleReport}
          items={filteredExerciseListItems}
          selectedMuscleId={contributionId} onSelectMuscle={showContributions} renderList={exerciseList} /> : summary ? <ProgressMuscleView muscles={summary.muscles} metric={tableMetric} selectedId={contributionId} muscleLayout={muscleLayout}
          tickers={muscleTickers} tickerStatus={muscleTickerStatus} tickerWeeks={targetWindowWeeks} report={muscleReport}
          grouped={grouped.muscle} searchQuery={muscleSearch}
          sortMode={muscleSortMode} onSort={header => setMuscleSortMode(mode => nextMuscleSortMode(mode, header))}
          onSelect={showContributions}
          onMuscleHistory={(row, target, view) => openHistory(muscle => onOpenMuscleHistory(muscle, view), { muscleGroupId: row.muscleGroupId }, target)}
          onExerciseHistory={(row, target) => openHistory(onOpenExerciseHistory, { exerciseDefinitionId: row.exerciseDefinitionId }, target)}
          /> : null}
        <ListRow onPress={onPressSessionsCard} accessibilityLabel="Open sessions list" testID="stats-sessions-link"
          meta={<Icon name="chevron-right" size="sm" />}><Text allowFontScaling={false} style={statsTableStyles.name}>Sessions</Text></ListRow>
      </ScreenScroll>

    </Screen>
  );
}

function progressPresentationState({ bodyActive, summary, isLoading, errorMessage, exerciseDataReady, exerciseDataError }: {
  bodyActive: boolean; summary: ProgressComparisons | null; isLoading: boolean; errorMessage: string | null;
  exerciseDataReady: boolean; exerciseDataError: string | null;
}) {
  const activeError = bodyActive ? errorMessage ?? exerciseDataError : errorMessage;
  const bodyReady = summary !== null && exerciseDataReady && !activeError;
  const pending = bodyActive ? !bodyReady && !activeError : isLoading && !summary && !activeError;
  return { activeError, bodyReady, pending };
}

function ExerciseBreakdown({
  metric, muscleLayout, ready, exercises, muscles, items, countSecondary, report,
  selectedMuscleId, onSelectMuscle, renderList,
}: {
  metric: ProgressExerciseMetric; muscleLayout: ProgressMuscleLayout; ready: boolean; countSecondary: boolean;
  report: MuscleReportAssignment;
  exercises: readonly Pick<ExerciseCatalogExercise, 'id' | 'mappings'>[];
  muscles: readonly ProgressMuscleComparison[];
  items: ExerciseListItem[];
  selectedMuscleId: string | null; onSelectMuscle: (id: string) => void;
  renderList: (items: ExerciseListItem[], splitByEffort?: boolean, secondary?: readonly ExerciseContributionEntry[], emptyOverride?: string) => ReactNode;
}) {
  const bodyMuscles = useMemo(
    () => buildExerciseBodyMuscles({ items, exercises, muscles, countSecondary, report }),
    [items, exercises, muscles, countSecondary, report]
  );
  const selectedMuscle = useMemo(
    () => buildExerciseBodyMuscle({ muscleGroupId: selectedMuscleId, items, exercises, muscles, countSecondary, report }),
    [selectedMuscleId, items, exercises, muscles, countSecondary, report]
  );
  if (muscleLayout === 'list') return renderList(items);
  if (metric === 'estimatedOneRepMax') return renderList(items);
  if (!ready) return null;
  return <ExerciseBodyView muscles={bodyMuscles} metric={metric}
    selectedMuscleId={selectedMuscle?.muscleGroupId ?? null} selectedMuscle={selectedMuscle} onSelectMuscle={onSelectMuscle} report={report}
    renderAll={() => renderList(items)}
    renderDetail={(entries, secondary) => renderList(entries.map(entry => entry.item),
      true, secondary, entries.length === 0 ? 'No exercises for this muscle.' : undefined)} />;
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
  secondary,
  grouped,
  families,
  familyMuscleCounts,
  splitByEffort,
}: {
  items: ExerciseListItem[];
  grouped: boolean;
  splitByEffort: boolean;
  families?: ReadonlyMap<string, string>;
  /** The user's muscles per family: a family with fewer than two gets no header. */
  familyMuscleCounts?: ReadonlyMap<string, number>;
  secondary?: readonly ExerciseContributionEntry[];
  metric: ProgressExerciseMetric;
  onPressExercise: (exercise: ExerciseHeatmapTarget, target: ComponentRef<typeof View> | null) => void;
  emptyBody: string;
  sortMode: ExerciseSortMode;
  onPressSortHeader: (header: ExerciseSortHeader) => void;
}) {
  const links = useRef(new Map<string, ComponentRef<typeof View>>());
  const { width } = useWindowDimensions();
  const secondaryRows = metric === 'estimatedOneRepMax' ? [] : secondary?.map(entry => entry.item) ?? [];
  if (items.length === 0 && secondaryRows.length === 0) {
    return (
      <Card>
        <StatePanel body={emptyBody} fill={false} testID="stats-exercise-list-empty" />
      </Card>
    );
  }

  // The rows carry no trailing control, so no axis is reserved for one; the
  // headers sort, so each column keeps room for its indicator.
  const layout = resolveComparisonLayout(width, [...items, ...secondaryRows], metric, false, true);
  const familyName = (item: ExerciseListItem) => families?.get(item.id) ?? 'Other';
  const primaryRows = grouped ? [...items].sort((left, right) => compareFamilySections(familyName(left), familyName(right), familyMuscleCounts)) : items;
  const rows = [...primaryRows.map(item => ({ item, isSecondary: false })),
    ...secondaryRows.map(item => ({ item, isSecondary: true }))];
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
      {rows.map(({ item, isSecondary }, index) => {
        const sectionStart = index === 0 || rows[index - 1].isSecondary !== isSecondary;
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
          <Fragment key={item.id}>
          {splitByEffort && sectionStart ? <StatsTableFamily name={isSecondary ? 'Secondary effort' : 'Primary effort'}
            testID={`stats-exercise-effort-${isSecondary ? 'secondary' : 'primary'}`} /> : null}
          {grouped && familyHasHeader(familyName(item), familyMuscleCounts) && (index === 0 || familyName(rows[index - 1].item) !== familyName(item)) ?
            <StatsTableFamily name={familyName(item)} testID={`stats-exercise-family-header-${familyName(item)}`} /> : null}
          <ListRow
            ref={target => { if (target) links.current.set(item.id, target); else links.current.delete(item.id); }}
            accessibilityLabel={`${isSecondary ? 'Secondary contribution. ' : ''}${exerciseRowLabel(item, metric)}`}
            density="list"
            meta={layout.stacked ? undefined : values}
            onPress={() => onPressExercise({ exerciseDefinitionId: item.id }, links.current.get(item.id) ?? null)}
            testID={`stats-exercise-row-${item.id}`}>
            <Text allowFontScaling={false} style={statsTableStyles.name} testID={`stats-exercise-name-${item.id}`}>
              {item.name}
            </Text>
            {layout.stacked ? values : null}
          </ListRow>
          </Fragment>
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

const exerciseSortHeaderLabel = (header: ExerciseSortHeader): string =>
  header === 'exercise' ? 'Exercise' : COLUMN_NAMES[COLUMN_KEYS.indexOf(header)];

function ExerciseSortHeaderCell({ header, label, metric, sortMode, onPress, style, numeric = false }: {
  header: ExerciseSortHeader; label: string; metric: ProgressExerciseMetric; sortMode: ExerciseSortMode;
  onPress: (header: ExerciseSortHeader) => void; style: StyleProp<ViewStyle>; numeric?: boolean;
}) {
  return <StatsTableSortHeader label={label} active={EXERCISE_SORT_HEADER_BY_MODE[sortMode] === header}
    descending={!sortMode.endsWith('-asc')}
    description={`${exerciseSortHeaderLabel(header)}${numeric ? `, ${metricUnit(metric)}` : ''}`}
    currentSort={describeExerciseSortMode(sortMode)} nextSort={describeExerciseSortMode(nextExerciseSortMode(sortMode, header))}
    onPress={() => onPress(header)} testID={`stats-exercise-sort-${header}`} style={style} numeric={numeric} recent={header === 'exercise'} />;
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
  // The tables' gym ([[gym.view-filter]]); this visit's choice only.
  const [gymId, setGymId] = useState<string | null | undefined>(undefined);
  // Secondary work in muscle figures ([[muscle.secondary-filter]]); this visit's choice only.
  const [countSecondary, setCountSecondary] = useState(true);
  const { current: thisPeriod, previous: lastPeriod, gymOptions, reload, hasSnapshot: exerciseSnapshot, lastError: exerciseError } = useExerciseCatalogComparison(weeks, gymId);
  const revision = useBodyWeightContextRevision();
  const summaryGymId = filters.breakdown === 'muscle' && values.progressMuscleLayout === 'list' ? gymId : undefined;
  // Exercise 3D shades from the exercise rows and reads only the muscle list
  // here, so the choice re-reads the summary for the Muscle breakdown alone.
  const summary = useStatsSummary(weeks, values.targetWindowWeeks, revision, reload,
    { gymId: summaryGymId, countSecondary: filters.breakdown === 'muscle' ? countSecondary : true });
  const tickers = useMuscleTickers(filters.breakdown === 'muscle' && values.progressMuscleLayout === 'list', summaryGymId, countSecondary);
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
  const muscleReport = catalog.muscleSetup?.assignment ?? NO_MUSCLE_REPORT;
  const exerciseFamilies = useMemo(() => {
    const byId = new Map(catalog.muscleGroups.map(muscle => [muscle.id, muscle]));
    return new Map(catalog.exercises.map(exercise => [exercise.id, reportedPrimaryFamilyName(exercise, muscleReport, byId)]));
  }, [catalog.exercises, catalog.muscleGroups, muscleReport]);
  // Search matches the user's muscles, as every exercise search does.
  const exerciseSearchIndex = useMemo(
    () => new Map(catalog.exercises.map(item => [item.id, item.searchText])), [catalog.exercises]);
  return <StatsScreenShell {...summary} muscleTickers={tickers.data} muscleTickerStatus={tickers.status} onRetry={() => { summary.onRetry(); void ensureExerciseCatalogLoaded(); }}
    exerciseFamilies={exerciseFamilies} exerciseMappings={catalog.exercises} muscleReport={muscleReport} exerciseSearchIndex={exerciseSearchIndex} exerciseDataReady={catalog.status === 'ready' && exerciseSnapshot}
    exerciseDataError={catalog.lastError ?? exerciseError} period={filters.period} targetWindowWeeks={values.targetWindowWeeks}
    onSelectPeriod={filters.selectPeriod} onPressSessionsCard={() => router.push('/sessions')}
    onOpenMuscleHistory={(muscle, view) => router.push(progressHistoryHref({ ...muscle, gymId: summaryGymId, countSecondary }, filters.metric, view))}
    onOpenExerciseHistory={exercise => router.push(progressHistoryHref(
      { ...exercise, gymId: filters.breakdown === 'exercise' ? gymId : summaryGymId },
      filters.breakdown === 'exercise' && filters.exerciseMetric !== 'estimatedOneRepMax' ? filters.exerciseMetric : filters.metric,
      filters.breakdown === 'muscle' ? 'timeline' : undefined))}
    viewMode={filters.breakdown} onSelectViewMode={filters.selectBreakdown}
    muscleLayout={values.progressMuscleLayout}
    tableMetric={filters.metric} onSelectTableMetric={filters.selectMetric}
    exerciseMetric={filters.exerciseMetric} onSelectExerciseMetric={filters.selectExerciseMetric}
    isFocused={isFocused}
    exerciseListItems={exerciseListItems} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery}
    gymId={gymId} gymOptions={gymOptions} onSelectGym={setGymId}
    countSecondary={countSecondary} onChangeCountSecondary={setCountSecondary} />;
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

// The screen body, in the design language.
const styles = StyleSheet.create({
  controls: { paddingHorizontal: uiSpace.lg, paddingTop: uiSpace.lg, paddingBottom: uiSpace.md, gap: uiSpace.md },
  filters: { flexDirection: 'row', alignItems: 'stretch', gap: uiSpace.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  search: { flex: 1, minWidth: 0 },
  filtersOnly: { justifyContent: 'flex-end' },
  // The page's last row clears the display's rounded corner above the tab bar,
  // which otherwise clips it: one more step of the spacing scale than the
  // gutter `ScreenScroll` already applies.
  scrollContent: { paddingBottom: uiSpace.xxl },
  // The name takes whatever the three figure columns leave, and lets `Recent`
  // wrap below the label when both cannot fit beside `Now`.
  nameColumn: {
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    alignContent: 'center',
  },
});
