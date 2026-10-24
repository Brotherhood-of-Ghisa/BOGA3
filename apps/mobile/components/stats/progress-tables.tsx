import { Fragment, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Icon, ListRow, StatePanel, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import {
  COLUMN_KEYS, COLUMN_NAMES, ComparisonHeaders, ComparisonValues, compareOptionalNumbers, comparisonSortValues,
  hasComparisonMetric, metricUnit, resolveComparisonLayout, type ComparisonColumnKey,
  type ComparisonLayout,
} from './comparison-columns';
import { StatsTable, StatsTableFamily, StatsTableHeaderLabel, StatsTableSortHeader, statsTableStyles } from './stats-table';

import type { ProgressMuscleTickers, MuscleTickerSeries } from '@/src/data/progress-muscle-tickers';
import { useDateFormat } from '@/src/preferences/hooks';
import { MuscleTicker, muscleTickerDescription, type MuscleTickerStatus } from './muscle-ticker';
import { EXERCISE_LIST_FAMILY_ORDER } from '@/src/exercise-catalog/list-model';
import { exerciseSearchTextMatches, normalizeExerciseSearchWords } from '@/src/exercise-catalog/search';

// The figure the table shows, and the filter Progress remembers for it. A
// muscle has no 1RM, so the Muscle table offers Progress's two metrics only.
export type ProgressTableMetric = ProgressMetric;

export type ProgressTablesProps = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  tickers?: ProgressMuscleTickers | null; tickerWeeks?: number; tickerStatus?: MuscleTickerStatus;
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

export const sortProgressMuscles = (muscles: ProgressMuscleComparison[], mode: MuscleSortMode,
  metric: ProgressMetric, grouped: boolean): ProgressMuscleComparison[] => {
  const descending = mode.endsWith('-desc');
  const key = mode.slice(0, mode.lastIndexOf('-')) as 'name' | ComparisonColumnKey;
  return [...muscles].sort((left, right) => {
    const family = grouped ? compareProgressFamilies(left.familyName, right.familyName) : 0;
    if (family) return family;
    const name = left.displayName.localeCompare(right.displayName);
    const value = key === 'name' ? (descending ? -name : name)
      : compareOptionalNumbers(comparisonSortValues(left, metric)[key], comparisonSortValues(right, metric)[key], descending);
    return value || name || left.muscleGroupId.localeCompare(right.muscleGroupId);
  });
};

// Family headers carry no totals: overlapping muscle rows cannot be summed.
// List rows pair Now over Previous, with history beside the name. Only Now
// sorts the paired periods; history and disclosure keep separate 44pt targets.
export function ProgressTables(props: ProgressTablesProps) {
  const { muscles, metric, selectedId, onSelect, onMuscleHistory, onExerciseHistory,
    grouped = true, searchQuery = '', sortMode = 'now-desc', onSort, tickers, tickerWeeks = 4, tickerStatus = 'loaded' } = props;
  const [tableWidth, setTableWidth] = useState(0);
  const words = normalizeExerciseSearchWords(searchQuery);
  const rows = sortProgressMuscles(muscles.filter(row => exerciseSearchTextMatches(words,
    `${row.displayName} ${row.familyName}`.toLowerCase())), sortMode, metric, grouped);
  const { width } = useWindowDimensions();
  const selected = rows.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const layout: ComparisonLayout = {
    ...resolveComparisonLayout(tableWidth ? tableWidth + uiSpace.lg * 2 : width, [...rows, ...exercises], metric, true, true),
    stacked: false, pairedPeriods: true,
  };
  return <View onLayout={event => setTableWidth(event.nativeEvent.layout.width)} testID="stats-muscle-table-container"><StatsTable testID="stats-muscle-table">
    <ComparisonHeaders layout={layout} metric={metric} testID="stats-muscle-table-header"
      name={<MuscleSortHeaderCell header="muscle" label="Muscle" metric={metric} mode={sortMode} onSort={onSort} />}
      column={(column, columnWidth) => <MuscleSortHeaderCell header={column.key} label={column.label}
        metric={metric} mode={sortMode} onSort={onSort} width={columnWidth} />} />
    {rows.length === 0 ? <StatePanel fill={false} body="No muscles match the search query." testID="stats-muscle-list-empty" /> : null}
    {rows.map((row, index) => <Fragment key={row.muscleGroupId}>
      {grouped && (index === 0 || rows[index - 1].familyName !== row.familyName) ?
        <StatsTableFamily name={row.familyName} testID={`stats-family-header-${row.familyName.toLowerCase().replace(/\s+/g, '-')}`} /> : null}
      <View testID={`stats-muscle-block-${row.muscleGroupId}`}>
        <MuscleRow row={row} metric={metric} layout={layout} selected={row.muscleGroupId === selectedId}
          onSelect={onSelect} onHistory={onMuscleHistory} ticker={tickers?.muscles[row.muscleGroupId]?.[metric]}
          tickerWindow={tickers} tickerStatus={tickerStatus} tickerWeeks={tickerWeeks} tickerWidthCap={tableWidth / 3} />
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
export function ProgressContributionRows({ muscle, metric, layout, onHistory, splitByEffort = false }: {
  muscle: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout;
  onHistory: ProgressTablesProps['onExerciseHistory']; splitByEffort?: boolean;
}) {
  const exercises = muscle.exercises.filter(row => hasComparisonMetric(row, metric));
  return <>
    <Headers name="Exercise" layout={layout} metric={metric} testID="stats-contributions-header" />
    {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
      body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${muscle.displayName} in either period`} /> : (splitByEffort ? (['primary', 'secondary'] as const).map(role => {
        const rows = exercises.filter(row => row.role === role);
        return rows.length > 0 ? <Fragment key={role}>
          <StatsTableFamily name={role === 'primary' ? 'Primary effort' : 'Secondary effort'} />
          {rows.map(row => <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout} onHistory={onHistory} hideRole />)}
        </Fragment> : null;
      }) : exercises.map(row =>
        <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout} onHistory={onHistory} />))}
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
function Headers({ name, layout, metric, testID }: {
  name: string; layout: ComparisonLayout; metric: ProgressTableMetric; testID: string;
}) {
  return <ComparisonHeaders layout={layout} metric={metric} testID={testID}
    name={<StatsTableHeaderLabel label={name} />} />;
}

function MuscleRow({ row, metric, layout, selected, onSelect, onHistory, ticker, tickerWindow, tickerWeeks, tickerWidthCap, tickerStatus }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout; selected: boolean;
  onSelect: ProgressTablesProps['onSelect']; onHistory: ProgressTablesProps['onMuscleHistory'];
  ticker?: MuscleTickerSeries; tickerWindow?: ProgressMuscleTickers | null; tickerWeeks: number; tickerWidthCap: number; tickerStatus: MuscleTickerStatus;
}) {
  const [nameWidth, setNameWidth] = useState(0);
  const dateFormat = useDateFormat();
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  return <View style={styles.compactRow} testID={prefix}>
    <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      accessibilityHint={muscleTickerDescription(ticker, tickerWeeks, metric, dateFormat, tickerStatus)}
      onLayout={event => setNameWidth(event.nativeEvent.layout.width)}
      onPress={() => onHistory(row, name.current)} style={[styles.nameLink, styles.inlineHistory]} testID={`stats-muscle-history-${row.muscleGroupId}`}>
      <Text allowFontScaling={false} numberOfLines={2} style={[statsTableStyles.name, styles.compactName]}>{row.displayName}</Text>
      {ticker && tickerWindow ? <MuscleTicker series={ticker} start={tickerWindow.start} end={tickerWindow.end}
        width={Math.min(tickerWidthCap, Math.max(0, nameWidth - uiGeometry.tapTarget - uiSpace.sm) * 0.5)} testID={`stats-muscle-ticker-${row.muscleGroupId}`} /> : null}
    </Pressable>
    {values}
    <Pressable accessibilityRole="button" accessibilityLabel={`${selected ? 'Hide' : 'Show'} ${row.displayName} contributions`}
      accessibilityState={{ expanded: selected }} onPress={() => onSelect(row.muscleGroupId)} style={styles.chevron}
      testID={`stats-muscle-select-${row.muscleGroupId}`}>
      <Icon name={selected ? 'chevron-down' : 'chevron-right'} size="sm" color={uiRoles.ink} />
    </Pressable>
  </View>;
}

function ExerciseRow({ row, metric, layout, onHistory, hideRole }: {
  row: ProgressExerciseComparison; metric: ProgressTableMetric; layout: ComparisonLayout; onHistory: ProgressTablesProps['onExerciseHistory']; hideRole?: boolean;
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-contribution-${row.exerciseDefinitionId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  // No control of its own, and the chevron's axis still kept clear, so a
  // contributor's figures stay under its muscle's.
  const history = <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={styles.nameLink}>
      <Text allowFontScaling={false} numberOfLines={layout.pairedPeriods ? 2 : undefined} style={statsTableStyles.name}>{row.displayName}</Text>
      {hideRole ? null : <Text allowFontScaling={false} style={styles.role}>{row.role === 'primary' ? 'Primary' : 'Secondary'}</Text>}
    </Pressable>;
  if (layout.pairedPeriods) return <View style={styles.compactRow} testID={prefix}>
    <View style={statsTableStyles.nameCell}>{history}</View>
    {values}<View style={styles.chevron} />
  </View>;
  return <ListRow density="list" testID={prefix} meta={layout.stacked ? undefined : values} trailing={null}>
    {history}{layout.stacked ? values : null}
  </ListRow>;
}

const styles = StyleSheet.create({
  contributions: { backgroundColor: uiRoles.ruleSoft, borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width, borderColor: uiRoles.rule },
  // The selected muscle keeps its ink rule, and its contributions hang off it.
  selected: { position: 'absolute', left: 0, top: 0, bottom: 0, width: uiBorder.width * 3, backgroundColor: uiRoles.ink },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.md, paddingHorizontal: uiSpace.md,
    minHeight: uiGeometry.tapTarget, borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
  inlineHistory: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  compactName: { flex: 1, minWidth: 0 },
  nameLink: { minWidth: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, justifyContent: 'center' },
  chevron: { width: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
  role: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
});
