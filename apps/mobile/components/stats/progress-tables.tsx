import { Fragment, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Icon, ListRow, StatePanel, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import {
  ComparisonHeaders, ComparisonValues, hasComparisonMetric, resolveComparisonLayout,
  type ComparisonLayout,
} from './comparison-columns';
import { StatsTable, StatsTableHeaderLabel, statsTableStyles } from './stats-table';

// The figure the table shows, and the filter Progress remembers for it. A
// muscle has no 1RM, so the Muscle table offers Progress's two metrics only.
export type ProgressTableMetric = ProgressMetric;

export type ProgressTablesProps = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  onSelect: (id: string) => void;
  onMuscleHistory: (row: ProgressMuscleComparison, target: ComponentRef<typeof View> | number | null, view?: HeatmapView) => void;
  onExerciseHistory: (row: ProgressExerciseComparison, target: ComponentRef<typeof View> | null) => void;
};

// Progress's muscle breakdown, in the table style both breakdowns share
// (`stats-table.tsx`) over the columns both draw (`comparison-columns.tsx`):
// no title, and no unit in the headers. A muscle's name opens its history and
// a separate trailing chevron discloses one contribution block directly under
// the row: sibling targets of at least 44pt, never one pressable row.
// Contributors reconcile with their muscle row in both periods, but no Total
// row is drawn. A family is an inert band above its muscles, never a figure of
// its own: a set mapped to two muscles of one family counts in both rows, so a
// family sum would overstate the work ([[muscle.set-count]]).
export function ProgressTables(props: ProgressTablesProps) {
  const { muscles, metric, selectedId, onSelect, onMuscleHistory, onExerciseHistory } = props;
  const { width } = useWindowDimensions();
  const selected = muscles.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const layout = resolveComparisonLayout(width, [...muscles, ...exercises], metric);
  return <StatsTable testID="stats-muscle-table">
    <Headers name="Muscle" layout={layout} metric={metric} testID="stats-muscle-table-header" />
    {muscles.map((row, index) => <Fragment key={row.muscleGroupId}>
      {index === 0 || muscles[index - 1].familyName !== row.familyName ? <Text
        allowFontScaling={false} accessibilityRole="header" style={styles.family}
        testID={`stats-family-header-${row.familyName.toLowerCase().replace(/\s+/g, '-')}`}>{row.familyName}</Text> : null}
      <View style={row.muscleGroupId === selectedId ? styles.selected : undefined}
        testID={`stats-muscle-block-${row.muscleGroupId}`}>
        <MuscleRow row={row} metric={metric} layout={layout} selected={row.muscleGroupId === selectedId}
          onSelect={onSelect} onHistory={onMuscleHistory} />
        {row.muscleGroupId === selectedId && selected ? <View
          testID="stats-contributions" style={styles.contributions}>
          <ProgressContributionRows muscle={selected} metric={metric} layout={layout} onHistory={onExerciseHistory} />
        </View> : null}
      </View>
    </Fragment>)}
  </StatsTable>;
}

// Both presentations keep one contribution-row and empty-state implementation.
export function ProgressContributionRows({ muscle, metric, layout, onHistory }: {
  muscle: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout;
  onHistory: ProgressTablesProps['onExerciseHistory'];
}) {
  const exercises = muscle.exercises.filter(row => hasComparisonMetric(row, metric));
  return <>
    <Headers name="Exercise" layout={layout} metric={metric} testID="stats-contributions-header" />
    {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
      body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${muscle.displayName} in either period`} /> : exercises.map(row =>
        <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout} onHistory={onHistory} />)}
  </>;
}

// The Muscle table's headers are plain spoken labels: it has no sort.
function Headers({ name, layout, metric, testID }: {
  name: string; layout: ComparisonLayout; metric: ProgressTableMetric; testID: string;
}) {
  return <ComparisonHeaders layout={layout} metric={metric} testID={testID}
    name={<StatsTableHeaderLabel label={name} />} />;
}

function MuscleRow({ row, metric, layout, selected, onSelect, onHistory }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; layout: ComparisonLayout; selected: boolean;
  onSelect: ProgressTablesProps['onSelect']; onHistory: ProgressTablesProps['onMuscleHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  return <ListRow density="list" testID={prefix} meta={layout.stacked ? undefined : values}
    trailing={<Pressable accessibilityRole="button" accessibilityLabel={`${selected ? 'Hide' : 'Show'} ${row.displayName} contributions`}
      accessibilityState={{ expanded: selected }} onPress={() => onSelect(row.muscleGroupId)} style={styles.chevron}
      testID={`stats-muscle-select-${row.muscleGroupId}`}>
      <Icon name={selected ? 'chevron-down' : 'chevron-right'} size="sm" color={uiRoles.ink} />
    </Pressable>}>
    <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={styles.nameLink} testID={`stats-muscle-history-${row.muscleGroupId}`}>
      <Text allowFontScaling={false} style={statsTableStyles.name}>{row.displayName}</Text>
    </Pressable>
    {layout.stacked ? values : null}
  </ListRow>;
}

function ExerciseRow({ row, metric, layout, onHistory }: {
  row: ProgressExerciseComparison; metric: ProgressTableMetric; layout: ComparisonLayout; onHistory: ProgressTablesProps['onExerciseHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-contribution-${row.exerciseDefinitionId}`;
  const values = <ComparisonValues row={row} metric={metric} layout={layout} prefix={prefix} />;
  // No control of its own, and the chevron's axis still kept clear, so a
  // contributor's figures stay under its muscle's.
  return <ListRow density="list" testID={prefix} meta={layout.stacked ? undefined : values} trailing={null}>
    <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={styles.nameLink}>
      <Text allowFontScaling={false} style={statsTableStyles.name}>{row.displayName}</Text>
      <Text allowFontScaling={false} style={styles.role}>{row.role === 'primary' ? 'Primary' : 'Secondary'}</Text>
    </Pressable>
    {layout.stacked ? values : null}
  </ListRow>;
}

const styles = StyleSheet.create({
  contributions: { backgroundColor: uiRoles.ruleSoft, borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width, borderColor: uiRoles.rule },
  // The family band: the table's micro-label on a section rule, with no
  // figures and nothing to press.
  family: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase', color: uiRoles.inkMuted, paddingTop: uiSpace.md, paddingBottom: uiSpace.sm,
    paddingHorizontal: uiSpace.md, borderTopWidth: uiBorder.width, borderColor: uiRoles.rule },
  // The selected muscle keeps its ink rule, and its contributions hang off it.
  selected: { borderLeftWidth: uiBorder.width * 3, borderLeftColor: uiRoles.ink },
  nameLink: { minWidth: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, justifyContent: 'center' },
  chevron: { width: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
  role: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
});
