import { formatOneRepMax } from '@/src/exercise-calculations/format';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';
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
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { ProgressMetric } from '@/src/preferences/model';
import { ProgressTables } from '@/components/stats/progress-tables';
import {
  StatsTable,
  StatsTableFigures,
  StatsTableHeader,
  StatsTableHeaderLabel,
  statsTableStyles,
} from '@/components/stats/stats-table';
import { type ProgressPeriod, useProgressFilters } from '@/components/stats/use-progress-filters';
import { progressHistoryHref } from '@/src/navigation/routes';
import { useStatsSummary } from '@/components/stats/use-summary';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

export type MuscleHistoryTarget = { muscleGroupId: string };
export type ExerciseHeatmapTarget = { exerciseDefinitionId: string };

export type ExerciseListItem = {
  id: string;
  name: string;
  workingSetCount: number;
  totalVolume: number | null;
  estimatedOneRepMax: number | null;
  lastCompletedAt: Date | null;
};

export type ExerciseSortHeader = 'exercise' | 'sets' | 'volume' | 'oneRepMax';
export type ExerciseSortMode =
  | 'recency-desc'
  | 'recency-asc'
  | 'sets-desc'
  | 'sets-asc'
  | 'volume-desc'
  | 'volume-asc'
  | 'oneRepMax-desc'
  | 'oneRepMax-asc';

export const DEFAULT_EXERCISE_SORT_MODE: ExerciseSortMode = 'sets-desc';

const EXERCISE_SORT_CYCLES: Record<ExerciseSortHeader, ExerciseSortMode[]> = {
  exercise: ['recency-desc', 'recency-asc'],
  sets: ['sets-desc', 'sets-asc'],
  volume: ['volume-desc', 'volume-asc'],
  oneRepMax: ['oneRepMax-desc', 'oneRepMax-asc'],
};

const EXERCISE_SORT_HEADER_BY_MODE: Record<ExerciseSortMode, ExerciseSortHeader> = {
  'recency-desc': 'exercise',
  'recency-asc': 'exercise',
  'sets-desc': 'sets',
  'sets-asc': 'sets',
  'volume-desc': 'volume',
  'volume-asc': 'volume',
  'oneRepMax-desc': 'oneRepMax',
  'oneRepMax-asc': 'oneRepMax',
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

// `This week` is the only choice when Settings' Progress period is one week,
// which leaves the chip inert rather than offering the same span twice.
const periodOptions = (targetWindowWeeks: number) => {
  const thisWeek = { value: 'this-week' as ProgressPeriod, label: 'This week',
    accessibilityLabel: `This week, ${formatPeriodComparison(7)}, same elapsed calendar span` };
  if (targetWindowWeeks === 1) return [thisWeek];
  return [{ value: 'window' as ProgressPeriod, label: `${targetWindowWeeks} weeks`,
    accessibilityLabel: `${targetWindowWeeks} weeks, ${formatPeriodComparison(targetWindowWeeks * 7)}, same elapsed calendar span` },
    thisWeek];
};

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
    case 'oneRepMax-desc':
      return '1RM — high to low';
    case 'oneRepMax-asc':
      return '1RM — low to high';
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
      // Rows with no estimate sort last in both directions
      // (`compareOptionalNumbers`), so the column never leads with blanks.
      case 'oneRepMax-desc':
        comparison = compareOptionalNumbers(left.estimatedOneRepMax, right.estimatedOneRepMax, true);
        break;
      case 'oneRepMax-asc':
        comparison = compareOptionalNumbers(left.estimatedOneRepMax, right.estimatedOneRepMax, false);
        break;
    }
    return comparison === 0 ? compareExerciseIdentity(left, right) : comparison;
  });

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

  const scrollTestID = viewMode === 'exercise' ? 'stats-exercise-list-scroll' : 'stats-scroll';

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
          ) : null}
        </View>
        {viewMode === 'exercise' ? (
          <SearchField accessibilityLabel="Exercise filter input" autoCapitalize="none" clearLabel="Clear search input"
            onChangeText={onSearchQueryChange} placeholder="Filter by exercise..." testID="stats-search-input" value={searchQuery} />
        ) : null}
      </View>
      <ScreenScroll keyboardShouldPersistTaps="handled" testID={scrollTestID}>
        {errorMessage ? <StatePanel fill={false} kind="error" title="Could not load progress"
          testID="stats-error-state" action={onRetry ? { label: 'Retry', onPress: onRetry, testID: 'stats-retry' } : undefined} /> : null}
        {isLoading && !summary && !errorMessage ? <StatePanel body="Loading progress…" fill={false}
          kind="loading" testID="stats-loading-state" /> : null}
        {viewMode === 'exercise' ? (
          <ExerciseListView items={filteredExerciseListItems} onPressExercise={(row, target) => openHistory(onOpenExerciseHistory, row, target)}
            isFiltered={Boolean(searchQuery.trim())} sortMode={exerciseSortMode} onPressSortHeader={handlePressExerciseSortHeader} />
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
    <StatsTable testID="stats-exercise-list">
      <StatsTableHeader testID="stats-exercise-table-header">
        <ExerciseSortHeaderCell
          header="exercise"
          label="Exercise"
          sortMode={sortMode}
          onPress={onPressSortHeader}
          style={[statsTableStyles.nameCell, styles.nameColumn]}
        />
        <StatsTableFigures>
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
          <ExerciseSortHeaderCell
            header="oneRepMax"
            label="1RM"
            sortMode={sortMode}
            onPress={onPressSortHeader}
            style={styles.oneRepMaxColumn}
            numeric
          />
        </StatsTableFigures>
      </StatsTableHeader>
      {items.map((item) => (
        <ListRow
          key={item.id}
          ref={target => { if (target) links.current.set(item.id, target); else links.current.delete(item.id); }}
          accessibilityLabel={`Open ${item.name} heatmap. ${String(
            item.workingSetCount
          )} sets. Volume ${formatVolumeFigure(item.totalVolume)}${
            item.estimatedOneRepMax === null
              ? '. Estimated one rep max unavailable'
              : `. Estimated one rep max ${formatOneRepMax(item.estimatedOneRepMax)} kg`
          }`}
          density="list"
          meta={
            <StatsTableFigures>
              <Text
                allowFontScaling={false}
                style={[statsTableStyles.figure, styles.setsColumn]}
                testID={`stats-exercise-sets-${item.id}`}>
                {String(item.workingSetCount)}
              </Text>
              <Text
                allowFontScaling={false}
                style={[statsTableStyles.figure, styles.volumeColumn]}
                testID={`stats-exercise-volume-${item.id}`}>
                {formatVolumeFigure(item.totalVolume)}
              </Text>
              <Text
                allowFontScaling={false}
                style={[statsTableStyles.figure, styles.oneRepMaxColumn]}
                testID={`stats-exercise-1rm-${item.id}`}>
                {item.estimatedOneRepMax === null ? '—' : formatOneRepMax(item.estimatedOneRepMax)}
              </Text>
            </StatsTableFigures>
          }
          onPress={() => onPressExercise({ exerciseDefinitionId: item.id }, links.current.get(item.id) ?? null)}
          testID={`stats-exercise-row-${item.id}`}>
          <Text allowFontScaling={false} style={statsTableStyles.name} testID={`stats-exercise-name-${item.id}`}>
            {item.name}
          </Text>
        </ListRow>
      ))}
    </StatsTable>
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
    case 'oneRepMax':
      return '1RM';
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
  const catalogPeriod = useMemo(() => ({ weeks }), [weeks]);
  const catalog = useExerciseCatalog();
  const { stats, reload } = useExerciseCatalogStats(catalogPeriod);
  const revision = useBodyWeightContextRevision();
  const summary = useStatsSummary(weeks, revision, reload);
  const [searchQuery, setSearchQuery] = useState('');
  const exerciseListItems = useMemo<ExerciseListItem[]>(() => catalog.exercises
    .filter(item => stats.aggregatesById.has(item.id))
    .map(item => {
      const aggregate = stats.aggregatesById.get(item.id)!;
      return { id: item.id, name: item.name, workingSetCount: aggregate.workingSetCount,
        totalVolume: aggregate.totalVolume,
        estimatedOneRepMax: aggregate.estimatedOneRepMax, lastCompletedAt: stats.lastCompletedAtById.get(item.id) ?? null };
    }), [catalog.exercises, stats]);
  return <StatsScreenShell {...summary} period={filters.period} targetWindowWeeks={values.targetWindowWeeks}
    onSelectPeriod={filters.selectPeriod} onPressSessionsCard={() => router.push('/sessions')}
    onOpenMuscleHistory={muscle => router.push(progressHistoryHref(muscle))}
    onOpenExerciseHistory={exercise => router.push(progressHistoryHref(exercise))}
    viewMode={filters.breakdown} onSelectViewMode={filters.selectBreakdown}
    tableMetric={filters.metric} onSelectTableMetric={filters.selectMetric} isFocused={isFocused}
    exerciseListItems={exerciseListItems} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />;
}

// The width the Exercise header reserves for its `Recent` + arrow indicator,
// visible or not, so the label never moves when the sort changes.
const RECENCY_INDICATOR_WIDTH = 64;

// The screen body, in the design language.
const styles = StyleSheet.create({
  controls: { paddingHorizontal: uiSpace.lg, paddingTop: uiSpace.lg, paddingBottom: uiSpace.md, gap: uiSpace.md },
  filters: { flexDirection: 'row', alignItems: 'stretch', gap: uiSpace.sm },
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
  // The table's columns: the name takes the rest; the figures sit in fixed,
  // right-aligned columns so digits align down the list. `Vol` fits a
  // six-digit volume (`123456`) in Plex Mono, and `1RM` a six-character
  // estimate (`1234.5`) — 46.8pt — which also clears the 41pt its header label
  // plus sort arrow need now that the column sorts.
  nameColumn: {
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
    width: 48,
  },
});
