import { Fragment, useRef, type ComponentRef, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Icon, StatePanel, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { ProgressComparison, ProgressExerciseComparison, ProgressMuscleComparison, ProgressPeriodValues } from '@/src/data';
import { compactVolumeFigure } from '@/src/exercise-calculations/analytics';
import { muscleTargetAttainment } from '@/src/preferences/targets';
import { formatCountDelta, formatVolumeDelta } from './comparison-format';

export type ProgressTableMetric = 'workingSetCount' | 'totalVolume';
const shades = [uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4];
const figures = (row: ProgressComparison, metric: ProgressTableMetric) => metric === 'workingSetCount'
  ? [String(row.current.workingSetCount), String(row.previous.workingSetCount), formatCountDelta(row.current.workingSetCount, row.previous.workingSetCount).text]
  : [compactVolumeFigure(row.current.totalVolume, row.current.knownVolume), compactVolumeFigure(row.previous.totalVolume, row.previous.knownVolume), formatVolumeDelta(row.current.totalVolume, row.previous.totalVolume).text];
const hasMetric = (row: ProgressComparison, metric: ProgressTableMetric) => metric === 'workingSetCount'
  ? row.current.workingSetCount > 0 || row.previous.workingSetCount > 0
  : row.current.volumeSetCount > 0 || row.previous.volumeSetCount > 0;
const coverage = (values: ProgressPeriodValues) => values.totalVolume !== null ? null
  : values.knownVolume === null ? 'Volume unavailable; subtotal exceeds numeric range'
  : `Volume incomplete. Known subtotal from ${values.knownVolumeSetCount} of ${values.volumeSetCount} included sets`;

type Props = {
  muscles: ProgressMuscleComparison[]; metric: ProgressTableMetric; selectedId: string | null;
  weeks: number; weeklyTarget: number; onSelect: (id: string) => void;
  onMuscleHistory: (row: ProgressMuscleComparison, target: ComponentRef<typeof View> | null) => void;
  onExerciseHistory: (row: ProgressExerciseComparison, target: ComponentRef<typeof View> | null) => void;
  headingRef: RefObject<ComponentRef<typeof View> | null>; onContributionLayout: (event: LayoutChangeEvent) => void;
};

export function ProgressTables(props: Props) {
  const { muscles, metric, selectedId, weeks, weeklyTarget, onSelect, onMuscleHistory, onExerciseHistory, headingRef, onContributionLayout } = props;
  const { width } = useWindowDimensions();
  const selected = muscles.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasMetric(row, metric)) ?? [];
  // Plex Mono has a fixed advance. Reserve the widest full figure in each
  // column before assigning the name; narrow screens put figures below it.
  const allRows = [...muscles, ...exercises];
  const columns = [0, 1, 2].map(index => Math.max(uiGeometry.tapTarget,
    ...allRows.map(row => figures(row, metric)[index].length * uiTypography.size.md * .61 + uiSpace.sm)));
  const numericWidth = columns.reduce((sum, value) => sum + value, 0) + uiSpace.sm * 2;
  const vertical = numericWidth > width - uiSpace.lg * 2 - uiSpace.sm;
  const stacked = width - uiSpace.lg * 2 < numericWidth + uiGeometry.tapTarget + uiSpace.xxl * 2 + uiSpace.sm * 3;
  return <>
    <View testID="stats-muscle-table" style={styles.table}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.title}>Work by muscle</Text>
      <Headers name="Muscle" columns={columns} stacked={stacked} vertical={vertical} metric={metric} action />
      {muscles.map((row, index) => <Fragment key={row.muscleGroupId}>
        {index === 0 || muscles[index - 1].familyName !== row.familyName ? <Text
          allowFontScaling={false} accessibilityRole="header" style={styles.family}
          testID={`stats-family-header-${row.familyName.toLowerCase().replace(/\s+/g, '-')}`}>{row.familyName}</Text> : null}
        <MuscleRow row={row} metric={metric} columns={columns} stacked={stacked} vertical={vertical}
          selected={row.muscleGroupId === selectedId} weeks={weeks} weeklyTarget={weeklyTarget}
          onSelect={onSelect} onHistory={onMuscleHistory} />
      </Fragment>)}
    </View>
    {selected ? <View onLayout={onContributionLayout} testID="stats-contributions" style={styles.table}>
      <View ref={headingRef} accessible accessibilityRole="header" accessibilityLabel={`${selected.displayName} contributions`}>
        <Text allowFontScaling={false} style={styles.title} testID="stats-contributions-title">{selected.displayName} contributions</Text>
      </View>
      <Headers name="Exercise" columns={columns} stacked={stacked} vertical={vertical} metric={metric} />
      {exercises.length === 0 ? <StatePanel fill={false} testID="stats-contributions-empty"
        body={`No ${metric === 'workingSetCount' ? 'working sets' : 'volume-included sets'} for ${selected.displayName} in either period`} /> : exercises.map(row =>
        <ExerciseRow key={row.exerciseDefinitionId} row={row} metric={metric} columns={columns}
          stacked={stacked} vertical={vertical} onHistory={onExerciseHistory} />)}
      <View style={[styles.row, styles.dataRow, styles.total, stacked && styles.stacked]} testID="stats-contributions-total">
        <Text allowFontScaling={false} style={[styles.name, styles.nameCell]}>Total</Text>
        <Values row={selected} metric={metric} columns={columns} stacked={stacked} vertical={vertical} prefix="stats-contributions-total" />
        <RowCoverage row={selected} metric={metric} prefix="stats-contributions-total" />
      </View>
    </View> : null}
  </>;
}

function Headers({ name, columns, stacked, vertical, metric, action = false }: { name: string; columns: number[]; stacked: boolean; vertical: boolean; metric: ProgressTableMetric; action?: boolean }) {
  return <View style={[styles.row, styles.headers, stacked && styles.stacked]}>
    <Text allowFontScaling={false} style={[styles.label, styles.nameCell]}>{name}</Text>
    {!vertical ? <View style={[styles.values, stacked && styles.fullWidth]}>
      {['Now', 'Previous', 'Change'].map((label, index) => <Text key={label} allowFontScaling={false}
        style={[styles.label, styles.numeric, { width: columns[index] }, stacked && styles.grow]}>{label}{metric === 'totalVolume' && index < 2 ? '\nkg·reps' : ''}</Text>)}
    </View> : null}
    {action && !stacked ? <View style={{ width: uiGeometry.tapTarget }} /> : null}
  </View>;
}

function Values({ row, metric, columns, stacked, vertical, prefix }: { row: ProgressComparison; metric: ProgressTableMetric; columns: number[]; stacked: boolean; vertical: boolean; prefix: string }) {
  return <View testID={`${prefix}-values`} style={[styles.values, stacked && styles.fullWidth, vertical && styles.verticalValues]}>
    {figures(row, metric).map((value, index) => <View key={index}
      style={[!vertical && { width: columns[index] }, stacked && !vertical && styles.grow, vertical && styles.valueLine]}>
      {vertical ? <Text allowFontScaling={false} style={[styles.label, styles.nameCell]}>{['Now', 'Previous', 'Change'][index]}{metric === 'totalVolume' && index < 2 ? ' (kg·reps)' : ''}</Text> : null}
      <View style={vertical ? { width: columns[index] } : undefined}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.figure, styles.numeric]} testID={`${prefix}-${['now', 'previous', 'change'][index]}`}>{value}</Text>
      </View>
    </View>)}
  </View>;
}

function RowCoverage({ row, metric, prefix }: { row: ProgressComparison; metric: ProgressTableMetric; prefix: string }) {
  if (metric !== 'totalVolume') return null;
  const current = coverage(row.current);
  const previous = coverage(row.previous);
  if (!current && !previous) return null;
  return <View style={styles.coverageRow} testID={`${prefix}-coverage`}>
    {current ? <Text allowFontScaling={false} style={styles.coverage}>Now: {current}</Text> : null}
    {previous ? <Text allowFontScaling={false} style={styles.coverage}>Previous: {previous}</Text> : null}
  </View>;
}

function MuscleRow({ row, metric, columns, stacked, vertical, selected, weeks, weeklyTarget, onSelect, onHistory }: {
  row: ProgressMuscleComparison; metric: ProgressTableMetric; columns: number[]; stacked: boolean; vertical: boolean; selected: boolean;
  weeks: number; weeklyTarget: number; onSelect: Props['onSelect']; onHistory: Props['onMuscleHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  const attainment = muscleTargetAttainment(row.current.workingSetCount, weeklyTarget, weeks);
  const shade = attainment <= 0 ? undefined : shades[Math.ceil(attainment * shades.length) - 1];
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  return <View style={[styles.row, styles.dataRow, stacked && styles.stacked, { backgroundColor: shade }, selected && styles.selected]}
    testID={prefix}>
    <View style={[styles.nameActions, !stacked && styles.nameCell]}>
      <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
        onPress={() => onHistory(row, name.current)} style={styles.nameLink} testID={`stats-muscle-history-${row.muscleGroupId}`}>
        <Text allowFontScaling={false} style={[styles.name, styles.link]}>{row.displayName}</Text>
      </Pressable>
      {stacked ? <Selection row={row} selected={selected} onSelect={onSelect} /> : null}
    </View>
    <View accessible accessibilityLabel={`Now ${figures(row, metric)[0]}, previous ${figures(row, metric)[1]}, change ${figures(row, metric)[2]}. ${metric === 'totalVolume' ? 'kg·reps per side. ' : 'Working sets. '}Colour: ${row.current.workingSetCount} of ${weeklyTarget * weeks} working sets; ${weeklyTarget} per week over ${weeks} weeks${metric === 'totalVolume' ? `. Now ${coverage(row.current) ?? 'complete volume'}. Previous ${coverage(row.previous) ?? 'complete volume'}` : ''}`}
      style={stacked ? styles.fullWidth : undefined}>
      <Values row={row} metric={metric} columns={columns} stacked={stacked} vertical={vertical} prefix={prefix} />
    </View>
    {!stacked ? <Selection row={row} selected={selected} onSelect={onSelect} /> : null}
    <RowCoverage row={row} metric={metric} prefix={prefix} />
  </View>;
}

function Selection({ row, selected, onSelect }: { row: ProgressMuscleComparison; selected: boolean; onSelect: Props['onSelect'] }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Show ${row.displayName} contributions`}
    accessibilityState={{ selected }} onPress={() => onSelect(row.muscleGroupId)} style={styles.chevron}
    testID={`stats-muscle-select-${row.muscleGroupId}`}>
    <Icon name={selected ? 'chevron-down' : 'chevron-right'} size="sm" color={uiRoles.ink} />
  </Pressable>;
}

function ExerciseRow({ row, metric, columns, stacked, vertical, onHistory }: {
  row: ProgressExerciseComparison; metric: ProgressTableMetric; columns: number[]; stacked: boolean; vertical: boolean; onHistory: Props['onExerciseHistory'];
}) {
  const name = useRef<ComponentRef<typeof View>>(null);
  return <View style={[styles.row, styles.dataRow, stacked && styles.stacked]} testID={`stats-contribution-${row.exerciseDefinitionId}`}>
    <Pressable ref={name} accessibilityRole="link" accessibilityLabel={`Open ${row.displayName} history`}
      onPress={() => onHistory(row, name.current)} style={[styles.nameLink, styles.nameCell]}>
      <Text allowFontScaling={false} style={[styles.name, styles.link]}>{row.displayName}</Text>
      <Text allowFontScaling={false} style={styles.role}>{row.role === 'primary' ? 'Primary' : 'Secondary'}</Text>
    </Pressable>
    <Values row={row} metric={metric} columns={columns} stacked={stacked} vertical={vertical} prefix={`stats-contribution-${row.exerciseDefinitionId}`} />
    <RowCoverage row={row} metric={metric} prefix={`stats-contribution-${row.exerciseDefinitionId}`} />
  </View>;
}

const styles = StyleSheet.create({
  table: { gap: uiSpace.sm },
  title: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl, color: uiRoles.ink, paddingVertical: uiSpace.sm },
  family: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase', color: uiRoles.inkMuted, paddingTop: uiSpace.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm, borderBottomWidth: uiBorder.width,
    borderColor: uiRoles.rule, paddingHorizontal: uiSpace.xs },
  dataRow: { flexWrap: 'wrap' },
  stacked: { flexDirection: 'column', alignItems: 'stretch', paddingBottom: uiSpace.sm },
  selected: { borderLeftWidth: uiBorder.width * 3, borderLeftColor: uiRoles.ink },
  headers: { borderBottomWidth: uiBorder.width, paddingVertical: uiSpace.sm },
  label: { fontFamily: uiFonts.display.family, fontWeight: '600', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
  nameCell: { flex: 1, minWidth: uiGeometry.tapTarget },
  nameActions: { flexDirection: 'row', alignItems: 'center' },
  nameLink: { flex: 1, minWidth: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, justifyContent: 'center', paddingVertical: uiSpace.sm },
  name: { fontFamily: uiFonts.display.family, fontWeight: '600', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  link: { textDecorationLine: 'underline' },
  chevron: { width: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
  values: { flexDirection: 'row', gap: uiSpace.sm, alignItems: 'flex-start', paddingVertical: uiSpace.sm },
  fullWidth: { alignSelf: 'stretch' },
  grow: { flexGrow: 1 },
  verticalValues: { flexDirection: 'column' },
  valueLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: uiSpace.sm },
  numeric: { textAlign: 'right' },
  figure: { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md, color: uiRoles.ink },
  coverageRow: { width: '100%', alignSelf: 'stretch', paddingBottom: uiSpace.sm },
  coverage: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.ink },
  role: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
  total: { backgroundColor: uiRoles.surface },
});
