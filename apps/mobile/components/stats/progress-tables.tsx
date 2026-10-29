import { Fragment, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Icon, ListRow, StatePanel, uiBorder, uiGeometry, uiRoles, uiText } from '@/components/ui';
import type { ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import {
  COLUMN_KEYS, COLUMN_NAMES, ComparisonHeaders, ComparisonValues, compareOptionalNumbers, comparisonSortValues,
  hasComparisonMetric, metricUnit, resolveComparisonLayout, type ComparisonColumnKey,
  type ComparisonLayout,
} from './comparison-columns';
import { StatsTable, StatsTableFamily, StatsTableHeaderLabel, StatsTableSortHeader, statsTableStyles } from './stats-table';

import { EXERCISE_LIST_FAMILY_ORDER } from '@/src/exercise-catalog/list-model';
import { exerciseSearchTextMatches, normalizeExerciseSearchWords } from '@/src/exercise-catalog/search';

// The figure the table shows, and the filter Progress remembers for it. A
// muscle has no 1RM, so the Muscle table offers Progress's two metrics only.
export type ProgressTableMetric = ProgressMetric;

export type ProgressTablesProps = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  grouped?: boolean; searchQuery?: string; sortMode?: MuscleSortMode;
  onSort?: (header: MuscleSortHeader) => void;
  onSelect: (id: string) => void;
  onMuscleHistory: (row: ProgressMuscleComparison, target: ComponentRef<typeof View> | number | null, view?: HeatmapView) => void;
  onExerciseHistory: (row: ProgressExerciseComparison, target: ComponentRef<typeof View> | null) => void;
};

export type MuscleSortHeader = 'muscle' | ComparisonColumnKey;
export type MuscleSortMode = `${'name' | ComparisonColumnKey}-${'asc' | 'desc'}`;

export const nextMuscleSortMode = (mode: MuscleSortMode, header: MuscleSortHeader): MuscleSortMode => {
  const key = header === 'muscle' ? 'name' : header;
  return mode === `${key}-asc` ? `${key}-desc` : mode === `${key}-desc` ? `${key}-asc`
    : `${key}-${key === 'name' ? 'asc' : 'desc'}`;
};

/** Fixed catalogue family order, custom families alphabetically, Other last. */
export const compareProgressFamilies = (left: string, right: string): number => {
  const rank = (family: string) => {
    if (family === 'Other') return Number.MAX_SAFE_INTEGER;
    const index = EXERCISE_LIST_FAMILY_ORDER.indexOf(family as typeof EXERCISE_LIST_FAMILY_ORDER[number]);
    return index < 0 ? EXERCISE_LIST_FAMILY_ORDER.length : index;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
};

/** How many of the user's muscles sit in each family. */
export const countFamilyMuscles = (families: Iterable<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const family of families) counts.set(family, (counts.get(family) ?? 0) + 1);
  return counts;
};

/**
 * Whether a family gets a header: only above two or more of the user's muscles
 * ([[muscle.family-sections]]). A header over one muscle repeats it. With no
 * counts every family has one, as does `Other`, which is not a muscle family.
 */
export const familyHasHeader = (family: string, counts?: ReadonlyMap<string, number>): boolean =>
  counts === undefined || family === 'Other' || (counts.get(family) ?? 0) >= 2;

/**
 * Families in section order: those with no header first, so a muscle with none
 * never sits under the previous family's header; then the fixed family order.
 */
export const compareFamilySections = (left: string, right: string, counts?: ReadonlyMap<string, number>): number =>
  Number(familyHasHeader(left, counts)) - Number(familyHasHeader(right, counts)) || compareProgressFamilies(left, right);

export const sortProgressMuscles = (muscles: ProgressMuscleComparison[], mode: MuscleSortMode,
  metric: ProgressMetric, grouped: boolean, familyCounts?: ReadonlyMap<string, number>): ProgressMuscleComparison[] => {
  const descending = mode.endsWith('-desc');
  const key = mode.slice(0, mode.lastIndexOf('-')) as 'name' | ComparisonColumnKey;
  const counts = familyCounts ?? countFamilyMuscles(muscles.map(row => row.familyName));
  return [...muscles].sort((left, right) => {
    const family = grouped ? compareFamilySections(left.familyName, right.familyName, counts) : 0;
    if (family) return family;
    const name = left.displayName.localeCompare(right.displayName);
    const value = key === 'name' ? (descending ? -name : name)
      : compareOptionalNumbers(comparisonSortValues(left, metric)[key], comparisonSortValues(right, metric)[key], descending);
    return value || name || left.muscleGroupId.localeCompare(right.muscleGroupId);
  });
};

// Family headers carry no totals: overlapping muscle rows cannot be summed.
// List shares Exercise's separate sortable columns and responsive rows, with
// history and contribution disclosure kept as separate 44pt targets.
export function ProgressTables(props: ProgressTablesProps) {
  const { muscles, metric, selectedId, onSelect, onMuscleHistory, onExerciseHistory,
    grouped = true, searchQuery = '', sortMode = 'now-desc', onSort } = props;
  const words = normalizeExerciseSearchWords(searchQuery);
  // Counted over all the user's muscles, so a search does not take a header away.
  const familyCounts = countFamilyMuscles(muscles.map(row => row.familyName));
  const rows = sortProgressMuscles(muscles.filter(row => exerciseSearchTextMatches(words,
    `${row.displayName} ${row.familyName}`.toLowerCase())), sortMode, metric, grouped, familyCounts);
  const { width } = useWindowDimensions();
  const selected = rows.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const layout = resolveComparisonLayout(width, [...rows, ...exercises], metric, true, true);
  return <View testID="stats-muscle-table-container"><StatsTable testID="stats-muscle-table">
    <ComparisonHeaders layout={layout} metric={metric} testID="stats-muscle-table-header"
      name={<MuscleSortHeaderCell header="muscle" label="Muscle" metric={metric} mode={sortMode} onSort={onSort} />}
      column={(column, columnWidth) => <MuscleSortHeaderCell header={column.key} label={column.label}
        metric={metric} mode={sortMode} onSort={onSort} width={columnWidth} />} />
    {rows.length === 0 ? <StatePanel fill={false} body="No muscles match the search query." testID="stats-muscle-list-empty" /> : null}
    {rows.map((row, index) => <Fragment key={row.muscleGroupId}>
      {grouped && familyHasHeader(row.familyName, familyCounts) && (index === 0 || rows[index - 1].familyName !== row.familyName) ?
        <StatsTableFamily name={row.familyName} testID={`stats-family-header-${row.familyName.toLowerCase().replace(/\s+/g, '-')}`} /> : null}
      <View testID={`stats-muscle-block-${row.muscleGroupId}`}>
        <MuscleRow row={row} metric={metric} layout={layout} selected={row.muscleGroupId === selectedId}
          onSelect={onSelect} onHistory={onMuscleHistory} />
        {row.muscleGroupId === selectedId && selected ? <View
          testID="stats-contributions" style={styles.contributions}>
          <ProgressContributionRows muscle={selected} metric={metric} layout={layout} onHistory={onExerciseHistory} />
        </View> : null}
        {row.muscleGroupId === selectedId ? <View pointerEvents="none" style={styles.selected} /> : null}
      </View>
    </Fragment>)}
  </StatsTable></View>;
}

// Both presentations keep one contribution-row and empty-state implementation.
export function ProgressContributionRows({ muscle, metric, layout, onHistory, splitByEffort = false, axis = true }: {
  muscle: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout;
  onHistory: ProgressTablesProps['onExerciseHistory']; splitByEffort?: boolean; axis?: boolean;
}) {
  const exercises = muscle.exercises.filter(row => hasComparisonMetric(row, metric));
  return <>
    <Headers axis={axis} name="Exercise" layout={layout} metric={metric} testID="stats-contributions-header" />
    {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
      body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${muscle.displayName} in either period`} /> : (splitByEffort ? (['primary', 'secondary'] as const).map(role => {
        const rows = exercises.filter(row => row.role === role);
        return rows.length > 0 ? <Fragment key={role}>
          <StatsTableFamily name={role === 'primary' ? 'Primary effort' : 'Secondary effort'} />
          {rows.map(row => <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout} onHistory={onHistory} axis={axis} hideRole />)}
        </Fragment> : null;
      }) : exercises.map(row =>
        <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout} onHistory={onHistory} axis={axis} />))}
  </>;
}

const describeMuscleSort = (mode: MuscleSortMode) => {
  if (mode.startsWith('name-')) return mode === 'name-asc' ? 'name A to Z' : 'name Z to A';
  const key = mode.slice(0, mode.lastIndexOf('-')) as ComparisonColumnKey;
  return `${COLUMN_NAMES[COLUMN_KEYS.indexOf(key)]} — ${mode.endsWith('-asc') ? 'low to high' : 'high to low'}`;
};

function MuscleSortHeaderCell({ header, label, metric, mode, onSort, width }: {
  header: MuscleSortHeader; label: string; metric: ProgressMetric; mode: MuscleSortMode;
  onSort: ProgressTablesProps['onSort']; width?: number;
}) {
  const key = header === 'muscle' ? 'name' : header;
  const named = header === 'muscle' ? 'Muscle' : `${COLUMN_NAMES[COLUMN_KEYS.indexOf(header)]}, ${metricUnit(metric)}`;
  return <StatsTableSortHeader label={label} active={mode.startsWith(`${key}-`)} descending={mode.endsWith('-desc')}
    description={named} currentSort={describeMuscleSort(mode)} nextSort={describeMuscleSort(nextMuscleSortMode(mode, header))}
    onPress={() => onSort?.(header)} testID={`stats-muscle-sort-${header}`} numeric={header !== 'muscle'}
    style={width === undefined ? statsTableStyles.nameCell : { width }} />;
}

// Contributor headers are labels; the parent muscle determines their context.
function Headers({ name, layout, metric, testID, axis }: {
  name: string; layout: ComparisonLayout; metric: ProgressTableMetric; testID: string; axis: boolean;
}) {
  return <ComparisonHeaders axis={axis} layout={layout} metric={metric} testID={testID}
    name={<StatsTableHeaderLabel label={name} />} />;
}

function MuscleRow({ row, metric, layout, selected, onSelect, onHistory }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout; selected: boolean;
  onSelect: ProgressTablesProps['onSelect']; onHistory: ProgressTablesProps['onMuscleHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  return <ListRow density="list" testID={prefix} meta={layout.stacked ? undefined : values} trailing={
    <Pressable accessibilityRole="button" accessibilityLabel={`${selected ? 'Hide' : 'Show'} ${row.displayName} contributions`}
      accessibilityState={{ expanded: selected }} onPress={() => onSelect(row.muscleGroupId)} style={styles.chevron}
      testID={`stats-muscle-select-${row.muscleGroupId}`}>
      <Icon name={selected ? 'chevron-down' : 'chevron-right'} size="sm" color={uiRoles.ink} />
    </Pressable>}>
    <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={styles.nameLink} testID={`stats-muscle-history-${row.muscleGroupId}`}>
      <Text allowFontScaling={false} style={[uiText.bodyStrong, statsTableStyles.name]}>{row.displayName}</Text>
    </Pressable>
    {layout.stacked ? values : null}
  </ListRow>;
}

function ExerciseRow({ row, metric, layout, onHistory, hideRole, axis }: {
  row: ProgressExerciseComparison; metric: ProgressTableMetric; layout: ComparisonLayout; onHistory: ProgressTablesProps['onExerciseHistory']; hideRole?: boolean; axis: boolean;
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-contribution-${row.exerciseDefinitionId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  const history = <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={styles.nameLink}>
      <Text allowFontScaling={false} style={[uiText.bodyStrong, statsTableStyles.name]}>{row.displayName}</Text>
      {hideRole ? null : <Text allowFontScaling={false} style={uiText.meta}>{row.role === 'primary' ? 'Primary' : 'Secondary'}</Text>}
    </Pressable>;
  return <ListRow density="list" testID={prefix} meta={layout.stacked ? undefined : values} trailing={axis ? null : undefined}>
    {history}{layout.stacked ? values : null}
  </ListRow>;
}

const styles = StyleSheet.create({
  contributions: { backgroundColor: uiRoles.ruleSoft, borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width, borderColor: uiRoles.rule },
  // The selected muscle keeps its ink rule, and its contributions hang off it.
  selected: { position: 'absolute', left: 0, top: 0, bottom: 0, width: uiBorder.width * 3, backgroundColor: uiRoles.ink },
  nameLink: { minWidth: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, justifyContent: 'center' },
  chevron: { width: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
});
