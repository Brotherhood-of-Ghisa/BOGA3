import { Fragment, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Icon, ListRow, StatePanel, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { ProgressComparison, ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { formatCountDelta, formatVolumeDelta } from './comparison-format';
import {
  StatsTable, StatsTableFigures, StatsTableHeader, StatsTableHeaderLabel,
  statsTableColumnWidth, statsTableStyles,
} from './stats-table';

// The figure the table shows, and the filter Progress remembers for it.
export type ProgressTableMetric = ProgressMetric;
const figures = (row: ProgressComparison, metric: ProgressTableMetric) => metric === 'workingSetCount'
  ? [String(row.current.workingSetCount), String(row.previous.workingSetCount), formatCountDelta(row.current.workingSetCount, row.previous.workingSetCount).text]
  : [formatVolumeFigure(row.current.totalVolume), formatVolumeFigure(row.previous.totalVolume), formatVolumeDelta(row.current.totalVolume, row.previous.totalVolume).text];
const hasMetric = (row: ProgressComparison, metric: ProgressTableMetric) => metric === 'workingSetCount'
  ? row.current.workingSetCount > 0 || row.previous.workingSetCount > 0
  : row.current.volumeSetCount > 0 || row.previous.volumeSetCount > 0;

// The columns, drawn and spoken. `Prev` is abbreviated like the exercise
// table's `Vol` so three figure columns and the name fit one line on a small
// phone; the unit belongs to the spoken label, never the header.
const COLUMN_LABELS = ['Now', 'Prev', 'Change'] as const;
const COLUMN_NAMES = ['Now', 'Previous', 'Change'] as const;
const COLUMN_KEYS = ['now', 'previous', 'change'] as const;
const unit = (metric: ProgressTableMetric) => metric === 'totalVolume' ? 'kg·reps' : 'working sets';

type Props = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  onSelect: (id: string) => void;
  onMuscleHistory: (row: ProgressMuscleComparison, target: ComponentRef<typeof View> | null) => void;
  onExerciseHistory: (row: ProgressExerciseComparison, target: ComponentRef<typeof View> | null) => void;
};

type Layout = { columns: number[]; stacked: boolean };

// Progress's muscle breakdown, in the table style both breakdowns share
// (`stats-table.tsx`): no title, and no unit in the headers. A muscle's name
// opens its history and a separate trailing chevron discloses one contribution
// block directly under the row: sibling targets of at least 44pt, never one
// pressable row. Contributors reconcile with their muscle row in both periods,
// but no Total row is drawn. A family is an inert band above its muscles, never
// a figure of its own: a set mapped to two muscles of one family counts in
// both rows, so a family sum would overstate the work ([[muscle.set-count]]).
// Figures never shrink: when they do not fit beside the name they move to a
// full-width second line, and one too wide for its column wraps inside it.
export function ProgressTables(props: Props) {
  const { muscles, metric, selectedId, onSelect, onMuscleHistory, onExerciseHistory } = props;
  const { width } = useWindowDimensions();
  const selected = muscles.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasMetric(row, metric)) ?? [];
  const layout = resolveLayout(width, [...muscles, ...exercises], metric);
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
          <Headers name="Exercise" layout={layout} metric={metric} testID="stats-contributions-header" />
          {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
            body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${selected.displayName} in either period`} /> : exercises.map(row =>
            <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} layout={layout}
              onHistory={onExerciseHistory} />)}
        </View> : null}
      </View>
    </Fragment>)}
  </StatsTable>;
}

/**
 * The figure columns, and whether they still fit beside the name. A column is
 * as wide as its widest full figure, capped so three of them plus the
 * chevron's axis never outgrow the row; the name keeps a tap target and a step
 * of its own, or the figures take their own line under it.
 */
export const resolveLayout = (
  width: number, rows: ProgressComparison[], metric: ProgressTableMetric,
): Layout => {
  const rowContent = width - uiSpace.lg * 2 - uiBorder.width * 2 - uiSpace.md * 2;
  const gaps = uiSpace.sm * (COLUMN_LABELS.length - 1);
  const cap = (rowContent - uiGeometry.tapTarget - uiSpace.md - gaps) / COLUMN_LABELS.length;
  const columns = COLUMN_LABELS.map((label, index) => Math.min(cap,
    statsTableColumnWidth(label, rows.map(row => figures(row, metric)[index]))));
  const nameRoom = rowContent - uiGeometry.tapTarget - uiSpace.md * 2
    - columns.reduce((sum, value) => sum + value, 0) - gaps;
  return { columns, stacked: nameRoom < uiGeometry.tapTarget + uiSpace.xl };
};

// The header row mirrors a data row: the name cell, the figure columns, and the
// chevron's empty axis, stacking with the rows so a label stays over its column.
function Headers({ name, layout, metric, testID }: {
  name: string; layout: Layout; metric: ProgressTableMetric; testID: string;
}) {
  const columns = <StatsTableFigures style={layout.stacked && styles.stackedFigures}>
    {COLUMN_LABELS.map((label, index) => <View key={label} accessible accessibilityRole="header"
      accessibilityLabel={`${COLUMN_NAMES[index]}, ${unit(metric)}`}
      style={[statsTableStyles.headerCell, statsTableStyles.headerCellNumeric, { width: layout.columns[index] }]}>
      <StatsTableHeaderLabel label={label} />
    </View>)}
  </StatsTableFigures>;
  return <StatsTableHeader testID={testID}>
    <View style={[statsTableStyles.headerCell, statsTableStyles.nameCell, layout.stacked && styles.stackedName]}>
      <StatsTableHeaderLabel label={name} />
      {layout.stacked ? columns : null}
    </View>
    {layout.stacked ? null : columns}
    <View style={styles.axis} />
  </StatsTableHeader>;
}

function Values({ row, metric, layout, prefix }: {
  row: ProgressComparison; metric: ProgressTableMetric; layout: Layout; prefix: string;
}) {
  return <View accessible accessibilityLabel={`Now ${figures(row, metric)[0]}, previous ${figures(row, metric)[1]}, change ${figures(row, metric)[2]}. ${unit(metric)}.`}
    style={layout.stacked && styles.stackedFigures} testID={`${prefix}-figures`}>
    <StatsTableFigures testID={`${prefix}-values`}>
      {figures(row, metric).map((value, index) => <Text key={COLUMN_KEYS[index]} allowFontScaling={false}
        style={[statsTableStyles.figure, { width: layout.columns[index] }]}
        testID={`${prefix}-${COLUMN_KEYS[index]}`}>{value}</Text>)}
    </StatsTableFigures>
  </View>;
}

function MuscleRow({ row, metric, layout, selected, onSelect, onHistory }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; layout: Layout; selected: boolean;
  onSelect: Props['onSelect']; onHistory: Props['onMuscleHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  const values = <Values row={row} metric={metric} layout={layout} prefix={prefix} />;
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
  row: ProgressExerciseComparison; metric: ProgressTableMetric; layout: Layout; onHistory: Props['onExerciseHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const prefix = `stats-contribution-${row.exerciseDefinitionId}`;
  const values = <Values row={row} metric={metric} layout={layout} prefix={prefix} />;
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
  axis: { width: uiGeometry.tapTarget },
  stackedName: { alignItems: 'stretch' },
  stackedFigures: { alignSelf: 'stretch', width: '100%', justifyContent: 'flex-end', paddingBottom: uiSpace.xs },
  role: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
});
