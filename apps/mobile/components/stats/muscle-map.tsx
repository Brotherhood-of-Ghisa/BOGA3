import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { changeToneColour, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import type { ProgressMuscleComparison } from '@/src/data';
import type { ProgressMetric } from '@/src/preferences/model';
import { muscleTargetAttainment } from '@/src/preferences/targets';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';
import { comparisonFigures, metricUnit } from './comparison-columns';
import { muscleMapLayout, muscleMapTileInset, type MapRect } from './muscle-map-layout';
import { MUSCLE_MAP_REFERENCE } from './muscle-map-reference';

type Props = {
  muscles: ProgressMuscleComparison[];
  metric: ProgressMetric;
  workingSetTarget: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/** Fixed family areas; every activation selects contributions. */
export function MuscleMap({ muscles, metric, selectedId, workingSetTarget, onSelect }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = measuredWidth ?? windowWidth - uiSpace.lg * 2;
  const layout = useMemo(() => muscleMapLayout(width), [width]);
  const rows = new Map(muscles.map(row => [row.muscleGroupId, row]));
  return <View testID="stats-muscle-map" style={{ height: layout.height }}
    onLayout={event => { if (event.nativeEvent.layout.width > 0) setMeasuredWidth(event.nativeEvent.layout.width); }}>
    {Object.entries(layout.families).map(([family, bounds]) => <View key={family} style={[styles.family, positioned(bounds)]}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.familyName}
        testID={`stats-family-header-${family.toLowerCase().replace(/\s+/g, '-')}`}>{family}</Text>
      {MUSCLE_MAP_REFERENCE.filter(reference => reference.family === family).map(reference => {
        const row = rows.get(reference.id);
        if (!row) return null;
        const tile = layout.muscles[reference.id];
        return <MuscleTile key={row.muscleGroupId} row={row} label={reference.label} metric={metric}
          bounds={{ ...tile, x: tile.x - bounds.x, y: tile.y - bounds.y }} selected={row.muscleGroupId === selectedId}
          workingSetTarget={workingSetTarget} onSelect={onSelect} />;
      })}
    </View>)}
  </View>;
}

const positioned = (bounds: MapRect) => ({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height });

function MuscleTile({ row, label, metric, bounds, selected, workingSetTarget, onSelect }: {
  row: ProgressMuscleComparison; label: string; metric: ProgressMetric; bounds: MapRect; selected: boolean;
  onSelect: Props['onSelect']; workingSetTarget: number;
}) {
  const figures = comparisonFigures(row, metric);
  const action = `Show ${row.displayName} contributions`;
  const prefix = `stats-muscle-row-${row.muscleGroupId}`;
  const currentSets = metric === 'workingSetCount' ? row.current.workingSetCount : row.current.volumeSetCount;
  const fillTone = currentSets === 0 ? 'negative' : figures.change.tone;
  const targetGraded = metric === 'workingSetCount' && currentSets > 0;
  const level = Math.ceil(muscleTargetAttainment(currentSets, workingSetTarget) * (HEAT_RAMP.length - 1));
  const backgroundColor = targetGraded ? HEAT_RAMP[level]
    : fillTone === 'neutral' ? uiRoles.ruleSoft : withAlpha(changeToneColour(fillTone), 0.16);
  const compact = bounds.width < uiGeometry.tapTarget * 2;
  const large = bounds.width >= uiGeometry.tapTarget * 2 + uiSpace.xl && bounds.height >= uiGeometry.tapTarget * 3;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, expanded: selected }}
    accessibilityLabel={`${action}. Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${metricUnit(metric)}.${metric === 'workingSetCount' ? ` Target ${workingSetTarget} working sets for this period.` : ''}`}
    accessibilityHint="Shows exercises below the muscle map."
    onPress={() => onSelect(row.muscleGroupId)}
    testID={`stats-muscle-tile-${row.muscleGroupId}`} style={[styles.tile, positioned(bounds)]}>
    <View testID={prefix} style={[styles.tileBody, { backgroundColor }]}>
      <Text allowFontScaling={false} style={styles.name}>{label}</Text>
      <Text allowFontScaling={false} testID={`${prefix}-now`} style={[styles.now, compact && styles.compact, large && styles.large]}>{figures.now}</Text>
      <Text allowFontScaling={false} testID={`${prefix}-change`} style={[styles.change, { color: targetGraded ? uiRoles.ink : changeToneColour(figures.change.tone) }]}>{figures.change.text}</Text>
    </View>
    {selected ? <View testID={`stats-muscle-selection-${row.muscleGroupId}`} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selection]} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  selection: { borderWidth: uiBorder.width * 3, borderColor: uiRoles.ink },
  family: { position: 'absolute', borderWidth: uiBorder.width, borderColor: uiRoles.rule, backgroundColor: uiRoles.surface },
  familyName: { paddingHorizontal: uiSpace.xs, paddingTop: uiSpace.xs, fontFamily: uiFonts.display.family,
    fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted, textTransform: 'uppercase' },
  tile: { position: 'absolute', padding: muscleMapTileInset, minWidth: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget },
  tileBody: { flex: 1, padding: uiSpace.xs, justifyContent: 'center' },
  name: { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.ink },
  now: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink, paddingTop: uiSpace.xs },
  compact: { fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm },
  large: { fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl },
  change: { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, paddingTop: uiSpace.xs },
});
