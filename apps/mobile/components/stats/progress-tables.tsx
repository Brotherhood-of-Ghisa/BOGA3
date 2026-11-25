import { Fragment, useRef, type ComponentRef } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Icon, StatePanel, makeStyles, uiBorder } from '@/components/ui';
import type { ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import {
  COLUMN_KEYS, COLUMN_NAMES, ComparisonHeaders, ComparisonValues, compareOptionalNumbers, comparisonSortValues,
  hasComparisonMetric, metricUnit, comparisonValuesLabel, resolveComparisonLayout, type ComparisonColumnKey,
  type ComparisonLayout,
} from './comparison-columns';
import { StatsTable, StatsTableRow, StatsTableName, StatsTableDisclosure, StatsTableFamily, StatsTableHeaderLabel, StatsTableSortHeader, statsTableStyles } from './stats-table';

import { EXERCISE_LIST_FAMILY_ORDER } from '@/src/exercise-catalog/list-model';
import { exerciseSearchTextMatches, normalizeExerciseSearchWords } from '@/src/exercise-catalog/search';
import type { SelectedProgressItem } from './progress-selection';

// The figure the table shows, and the filter Progress remembers for it. A
// muscle has no 1RM, so the Muscle table offers Progress's two metrics only.
export type ProgressTableMetric = ProgressMetric;

export type ProgressTablesProps = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  grouped?: boolean; searchQuery?: string; sortMode?: MuscleSortMode;
  onSort?: (header: MuscleSortHeader) => void;
  onSelect: (id: string) => void;
  selection?: {
    items: readonly SelectedProgressItem[] | null;
    onBegin: (item: SelectedProgressItem, target: ComponentRef<typeof View> | null) => void;
    onToggle: (item: SelectedProgressItem) => void;
  };
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
 * A family gets a header only above two or more of the user's muscles.
 * A header over one muscle repeats it. With no counts every family has one,
 * as does `Other`, which is not a muscle family.
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
    grouped = true, searchQuery = '', sortMode = 'now-desc', onSort, selection } = props;
  const styles = useStyles();
  const selecting = selection?.items != null;
  // Selection needs the full list, even when a search leaves just one match.
  const words = normalizeExerciseSearchWords(selecting ? '' : searchQuery);
  // Counted over all the user's muscles, so a search does not take a header away.
  const familyCounts = countFamilyMuscles(muscles.map(row => row.familyName));
  const rows = sortProgressMuscles(muscles.filter(row => exerciseSearchTextMatches(words,
    `${row.displayName} ${row.familyName}`.toLowerCase())), sortMode, metric, grouped, familyCounts);
  const { width } = useWindowDimensions();
  const selected = selecting ? undefined : rows.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const activeSort = sortMode.slice(0, sortMode.lastIndexOf('-')) as 'name' | ComparisonColumnKey;
  const layout = resolveComparisonLayout(width, [...rows, ...exercises], metric, true, { compact: true, activeSort });
  return <View testID="stats-muscle-table-container"><StatsTable testID="stats-muscle-table">
    <ComparisonHeaders compact layout={layout} metric={metric} testID="stats-muscle-table-header"
      name={<MuscleSortHeaderCell header="muscle" label="Muscle" metric={metric} mode={sortMode} onSort={onSort} />}
      column={(column, columnWidth) => <MuscleSortHeaderCell header={column.key} label={column.label}
        metric={metric} mode={sortMode} onSort={onSort} width={columnWidth} />} />
    {rows.length === 0 ? <StatePanel fill={false} body="No muscles match the search query." testID="stats-muscle-list-empty" /> : null}
    {rows.map((row, index) => <Fragment key={row.muscleGroupId}>
      {grouped && familyHasHeader(row.familyName, familyCounts) && (index === 0 || rows[index - 1].familyName !== row.familyName) ?
        <StatsTableFamily compact name={row.familyName} testID={`stats-family-header-${row.familyName.toLowerCase().replace(/\s+/g, '-')}`} /> : null}
      <View testID={`stats-muscle-block-${row.muscleGroupId}`}>
        <MuscleRow row={row} metric={metric} layout={layout} expanded={row === selected}
          onSelect={onSelect} onHistory={onMuscleHistory} selection={selection} />
        {row === selected ? <View
          testID="stats-contributions" style={styles.contributions}>
          <ProgressContributionRows header={false} muscle={selected} metric={metric} layout={layout} onHistory={onExerciseHistory} />
        </View> : null}
        {row === selected ? <View pointerEvents="none" style={styles.selected} /> : null}
      </View>
    </Fragment>)}
  </StatsTable></View>;
}

// Both presentations keep one contribution-row and empty-state implementation.
export function ProgressContributionRows({ muscle, metric, layout, onHistory, splitByEffort = false, axis = true, header = true }: {
  muscle: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout;
  onHistory: ProgressTablesProps['onExerciseHistory']; splitByEffort?: boolean; axis?: boolean; header?: boolean;
}) {
  const exercises = muscle.exercises.filter(row => hasComparisonMetric(row, metric));
  return <>
    {header ? <Headers axis={axis} name="Exercise" layout={layout} metric={metric} testID="stats-contributions-header" /> : null}
    {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
      body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${muscle.displayName} in either period`} /> : (splitByEffort ? (['primary', 'secondary'] as const).map(role => {
        const rows = exercises.filter(row => row.role === role);
        return rows.length > 0 ? <Fragment key={role}>
          <StatsTableFamily compact name={role === 'primary' ? 'Primary effort' : 'Secondary effort'} />
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
  return <StatsTableSortHeader compact label={label} active={mode.startsWith(`${key}-`)} descending={mode.endsWith('-desc')}
    description={named} currentSort={describeMuscleSort(mode)} nextSort={describeMuscleSort(nextMuscleSortMode(mode, header))}
    onPress={() => onSort?.(header)} testID={`stats-muscle-sort-${header}`} numeric={header !== 'muscle'}
    style={width === undefined ? statsTableStyles.nameCell : { width }} />;
}

// Contributor headers are labels; the parent muscle determines their context.
function Headers({ name, layout, metric, testID, axis }: {
  name: string; layout: ComparisonLayout; metric: ProgressTableMetric; testID: string; axis: boolean;
}) {
  return <ComparisonHeaders compact axis={axis} layout={layout} metric={metric} testID={testID}
    name={<StatsTableHeaderLabel label={name} />} />;
}

function MuscleRow({ row, metric, layout, expanded, onSelect, onHistory, selection }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout; expanded: boolean;
  onSelect: ProgressTablesProps['onSelect']; onHistory: ProgressTablesProps['onMuscleHistory'];
  selection: ProgressTablesProps['selection'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const item = { id: row.muscleGroupId, name: row.displayName };
  const prefix = `stats-muscle-row-${item.id}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} compact speak={!layout.stacked} />;
  const selecting = selection?.items != null;
  const checked = selection?.items?.some(selected => selected.id === item.id) ?? false;
  const begin = () => selection?.onBegin(item, name.current);
  const label = <StatsTableName name={item.name} selected={expanded || checked} />;
  return <StatsTableRow testID={prefix} meta={layout.stacked ? undefined : values} selected={checked}
    trailing={selecting ? null : <StatsTableDisclosure expanded={expanded}
      accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${item.name} contributions`}
      onPress={() => onSelect(item.id)} testID={`stats-muscle-select-${item.id}`} />}
    contentAction={{ ref: name, accessibilityRole: selecting ? 'checkbox' : 'link',
      accessibilityLabel: selecting ? item.name : `Open ${item.name} history`,
      accessibilityState: selecting ? { checked } : undefined,
      accessibilityValue: layout.stacked ? { text: comparisonValuesLabel(row, metric) } : undefined,
      onPress: () => selecting ? selection.onToggle(item) : onHistory(row, name.current),
      onLongPress: selection ? begin : undefined,
      accessibilityActions: selection ? [{ name: 'selectMuscle', label: 'Select for combined progress' }] : undefined,
      onAccessibilityAction: selection ? event => { if (event.nativeEvent.actionName === 'selectMuscle') begin(); } : undefined,
      testID: `stats-muscle-history-${item.id}` }}>
    {/* Keep the name mounted through the native long press and its release. */}
    <View style={statsTableStyles.selectionName}>
      {selecting ? <Icon colorRole="ink" name={checked ? 'set-done' : 'set-current'} size="sm" testID={`stats-muscle-check-${item.id}`} /> : null}
      <View style={statsTableStyles.nameCell}>{label}</View>
    </View>
    {layout.stacked ? values : null}
  </StatsTableRow>;
}

function ExerciseRow({ row, metric, layout, onHistory, hideRole, axis }: {
  row: ProgressExerciseComparison; metric: ProgressTableMetric; layout: ComparisonLayout; onHistory: ProgressTablesProps['onExerciseHistory']; hideRole?: boolean; axis: boolean;
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const role = hideRole ? undefined : row.role === 'primary' ? 'Primary' : 'Secondary';
  const historyValue = [role, layout.stacked ? comparisonValuesLabel(row, metric) : undefined].filter(Boolean).join('. ');
  const prefix = `stats-contribution-${row.exerciseDefinitionId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} compact speak={!layout.stacked} />;
  return <StatsTableRow testID={prefix} meta={layout.stacked ? undefined : values} trailing={axis ? null : undefined}
    contentAction={{ ref: name, accessibilityRole: 'link',
      accessibilityLabel: `Open ${row.displayName} history`,
      accessibilityValue: historyValue ? { text: historyValue } : undefined,
      onPress: () => onHistory(row, name.current) }}>
    <StatsTableName name={row.displayName} metadata={role} />
    {layout.stacked ? values : null}
  </StatsTableRow>;
}

const useStyles = makeStyles((roles) => ({
  contributions: { backgroundColor: roles.ruleSoft },
  // The selected muscle keeps its ink rule, and its contributions hang off it.
  selected: { position: 'absolute', left: 0, top: 0, bottom: 0, width: uiBorder.width * 3, backgroundColor: roles.ink },
}));
