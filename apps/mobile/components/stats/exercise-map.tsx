import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatePanel, changeToneColour, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';
import type { ProgressMuscleComparison } from '@/src/data';
import { shortenExerciseName } from '@/src/exercise-catalog/shorten-exercise-name';
import type { ProgressExerciseMetric, ProgressMetric } from '@/src/preferences/model';
import { comparisonFigures } from './comparison-columns';
import {
  exerciseMapLayout,
  exerciseMapTileRects,
  exerciseMapTileKey,
  exerciseMapTileRow,
  type ExerciseBodyMuscleDetail,
  type ExerciseMapEntry,
  type ExerciseMapFamily,
  type ExerciseMapSecondary,
  type ExerciseMapTile,
} from './exercise-map-data';
import { MuscleBodyCard } from './muscle-body-card';
import { MUSCLE_MAP_HEADER, MUSCLE_MAP_INSET, type MapRect } from './muscle-map-layout';
import type { MuscleMapFamily } from './muscle-map-reference';

type Props = {
  families: ExerciseMapFamily[];
  metric: ProgressExerciseMetric;
  selectedFamily: MuscleMapFamily | null;
  onSelectFamily: (family: MuscleMapFamily) => void;
  renderDetail: (entries: ExerciseMapEntry[], secondary?: ExerciseMapSecondary, labels?: ReadonlyMap<string, number>) => ReactNode;
  emptyBody: string;
};

/** Family-sized targets disclose full rows; visual children retain exact Volume areas. */
export function ExerciseMap({ families, metric, selectedFamily, onSelectFamily, renderDetail, emptyBody }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = measuredWidth ?? windowWidth - uiSpace.lg * 2;
  const layout = useMemo(() => exerciseMapLayout(width), [width]);
  const [overflow, setOverflow] = useState<ReadonlySet<string>>(new Set());
  const numbers = useMemo(() => new Map([...new Set(families.flatMap(family =>
    [...family.exercises, ...(family.secondary?.exercises ?? [])].map(entry => entry.item.id)))].sort().map((id, index) => [id, index + 1])), [families]);
  const markOverflow = useCallback((key: string, value: boolean) => setOverflow(current => {
    if (current.has(key) === value) return current;
    const next = new Set(current);
    if (value) next.add(key); else next.delete(key);
    return next;
  }), []);
  const showSecondary = metric !== 'estimatedOneRepMax';
  const selected = families.find(family => family.name === selectedFamily);
  return <View style={styles.body}>
    {families.every(family => family.exercises.length === 0 && (!showSecondary || !family.secondary)) ? <StatePanel body={showSecondary ? emptyBody : 'No primary exercises in either period.'} fill={false} testID="stats-exercise-map-empty" /> : null}
    <View testID="stats-exercise-map" style={{ height: layout.height }}
      onLayout={event => { if (event.nativeEvent.layout.width > 0) setMeasuredWidth(event.nativeEvent.layout.width); }}>
      {families.map(family => {
        const outer = layout.families[family.name];
        const bounds = { x: MUSCLE_MAP_INSET, y: MUSCLE_MAP_HEADER, width: outer.width - MUSCLE_MAP_INSET * 2,
          height: outer.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET };
        const tiles = exerciseMapTileRects([...family.exercises, ...(family.secondary ? [family.secondary] : [])], bounds);
        const count = family.exercises.length + (showSecondary ? family.secondary?.exercises.length ?? 0 : 0);
        return <Pressable key={family.name} testID={`stats-exercise-family-${family.name}`}
          accessibilityRole="button" accessibilityState={{ selected: family.name === selectedFamily, expanded: family.name === selectedFamily }}
          accessibilityLabel={`Show ${family.name} exercises. ${count} exercises.${showSecondary && family.secondary ? ' Includes secondary contributions.' : ''}`}
          accessibilityHint="Shows exercise figures below the map."
          onPress={() => onSelectFamily(family.name)} style={[styles.family, positioned(outer)]}>
          <Text allowFontScaling={false} style={styles.familyName}>{family.name}</Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tiles.map(({ entry, bounds: tile }) => !showSecondary && !('item' in entry) ? null : <ExerciseTile key={exerciseMapTileKey(entry)} entry={entry} bounds={tile} metric={metric} family={family.name}
              number={'item' in entry ? numbers.get(entry.item.id) : undefined}
              overflows={'item' in entry && overflow.has(`${family.name}:${entry.item.id}`)} onOverflow={markOverflow} />)}
          </View>
          {family.name === selectedFamily ? <View testID={`stats-exercise-selection-${family.name}`} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selection]} /> : null}
        </Pressable>;
      })}
    </View>
    {selected ? <View testID="stats-exercise-map-detail" style={styles.detail}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>{selected.name}</Text>
      {selected.exercises.length > 0 || !showSecondary || !selected.secondary ? <>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>Primary effort</Text>
        {renderDetail(selected.exercises, undefined, new Map(selected.exercises.filter(entry => overflow.has(`${selected.name}:${entry.item.id}`)).map(entry => [entry.item.id, numbers.get(entry.item.id)!])))}
      </> : null}
      {showSecondary && selected.secondary ? renderDetail(selected.secondary.exercises, selected.secondary) : null}
    </View> : null}
  </View>;
}

/** 3D anatomical exercise explorer: shades muscles from filtered exercises and scopes the exercise table on muscle tap. */
export function ExerciseBodyView({
  muscles,
  metric,
  selectedMuscleId,
  selectedMuscle,
  onSelectMuscle,
  renderAll,
  renderDetail,
}: {
  muscles: readonly ProgressMuscleComparison[];
  metric: ProgressMetric;
  selectedMuscleId: string | null;
  selectedMuscle: ExerciseBodyMuscleDetail | null;
  onSelectMuscle: (muscleGroupId: string) => void;
  renderAll: () => ReactNode;
  renderDetail: (entries: ExerciseMapEntry[], secondary?: ExerciseMapSecondary, labels?: ReadonlyMap<string, number>) => ReactNode;
}) {
  return <View style={styles.body}>
    <MuscleBodyCard muscles={muscles} metric={metric} selectedId={selectedMuscleId} onSelect={onSelectMuscle} />
    {selectedMuscle ? <View testID="stats-exercise-body-detail" style={styles.detail}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>{selectedMuscle.displayName}</Text>
      {selectedMuscle.exercises.length > 0 || !selectedMuscle.secondary ? <><Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>Primary effort</Text>{renderDetail(selectedMuscle.exercises)}</> : null}
      {selectedMuscle.secondary ? renderDetail(selectedMuscle.secondary.exercises, selectedMuscle.secondary) : null}
    </View> : renderAll()}
  </View>;
}

const positioned = (bounds: MapRect) => ({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height });

function ExerciseTile({ entry, bounds, metric, family, number, overflows, onOverflow }: {
  entry: ExerciseMapTile; bounds: MapRect; metric: ProgressExerciseMetric; family: MuscleMapFamily;
  number?: number; overflows: boolean; onOverflow: (key: string, value: boolean) => void;
}) {
  const figures = comparisonFigures(exerciseMapTileRow(entry), metric);
  const name = 'item' in entry ? shortenExerciseName(entry.item.name) : 'Secondary effort';
  const tileID = 'item' in entry ? `stats-exercise-tile-${family}-${entry.item.id}` : `stats-exercise-secondary-${family}`;
  const level = Math.ceil(entry.targetAttainment * (HEAT_RAMP.length - 1));
  const backgroundColor = metric === 'workingSetCount' ? HEAT_RAMP[level]
    : figures.change.tone === 'neutral' ? uiRoles.ruleSoft : withAlpha(changeToneColour(figures.change.tone), 0.16);
  const nameHeight = Math.min(uiTypography.lineHeight.sm * 2, bounds.height - uiSpace.xs * 2 - uiTypography.lineHeight.base);
  const readable = bounds.width >= uiGeometry.tapTarget && nameHeight >= uiTypography.lineHeight.sm;
  return <View testID={tileID} style={[styles.tile, positioned(bounds), { backgroundColor }]}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tileRule]} />
    <Text allowFontScaling={false} accessible={false} testID={`${tileID}-measure`}
      style={[styles.name, styles.measure, { width: Math.max(0, bounds.width - uiSpace.xs * 2) }]}
      onTextLayout={event => {
        const lines = event.nativeEvent.lines;
        const overflow = !readable || lines.length > 2 || lines.reduce((height, line) => height + line.height, 0) > nameHeight;
        if ('item' in entry) onOverflow(`${family}:${entry.item.id}`, overflow);
      }}>{name}</Text>
    {readable ? <View style={styles.tileContent}>
      <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>{overflows && number ? `[${number}]` : name}</Text>
      <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.figure}>
        <Text allowFontScaling={false} testID={`${tileID}-now`}>{figures.now}</Text><Text allowFontScaling={false} style={[styles.change, { color: metric === 'workingSetCount' ? uiRoles.ink : changeToneColour(figures.change.tone) }]}> / {figures.change.text}</Text>
      </Text>
    </View> : number && bounds.width >= uiTypography.size.sm * String(number).length * 2 && bounds.height >= uiTypography.lineHeight.sm
      ? <Text allowFontScaling={false} style={styles.name}>[{number}]</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', opacity: 0 },
  selection: { borderWidth: uiBorder.width * 3, borderColor: uiRoles.ink },
  body: { gap: uiSpace.lg },
  family: { position: 'absolute', borderWidth: uiBorder.width, borderColor: uiRoles.rule, backgroundColor: uiRoles.surface },
  familyName: { paddingHorizontal: uiSpace.xs, paddingTop: uiSpace.xs, fontFamily: uiFonts.display.family,
    fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted, textTransform: 'uppercase' },
  tile: { position: 'absolute', overflow: 'hidden' },
  tileContent: { flex: 1, padding: uiSpace.xs, justifyContent: 'center' },
  tileRule: { borderWidth: uiBorder.width, borderColor: uiRoles.surface },
  name: { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.ink },
  figure: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  change: { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.xs, lineHeight: uiTypography.lineHeight.xs },
  detail: { gap: uiSpace.sm },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
});
