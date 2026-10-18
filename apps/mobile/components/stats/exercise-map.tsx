import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatePanel, changeToneColour, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';
import type { ProgressMetric } from '@/src/preferences/model';
import { comparisonFigures } from './comparison-columns';
import { exerciseMapLayout, exerciseMapTileRects, exerciseMapTileKey, exerciseMapTileRow, type ExerciseMapEntry, type ExerciseMapFamily, type ExerciseMapSecondary, type ExerciseMapTile } from './exercise-map-data';
import { MUSCLE_MAP_HEADER, MUSCLE_MAP_INSET, type MapRect } from './muscle-map-layout';
import type { MuscleMapFamily } from './muscle-map-reference';

type Props = {
  families: ExerciseMapFamily[];
  metric: ProgressMetric;
  selectedFamily: MuscleMapFamily | null;
  onSelectFamily: (family: MuscleMapFamily) => void;
  renderDetail: (entries: ExerciseMapEntry[], secondary?: ExerciseMapSecondary) => ReactNode;
  emptyBody: string;
};

/** Family-sized targets disclose full rows; visual children retain exact metric areas. */
export function ExerciseMap({ families, metric, selectedFamily, onSelectFamily, renderDetail, emptyBody }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = measuredWidth ?? windowWidth - uiSpace.lg * 2;
  const layout = useMemo(() => exerciseMapLayout(width), [width]);
  const selected = families.find(family => family.name === selectedFamily);
  return <View style={styles.body}>
    {families.every(family => family.exercises.length === 0 && !family.secondary) ? <StatePanel body={emptyBody} fill={false} testID="stats-exercise-map-empty" /> : null}
    <View testID="stats-exercise-map" style={{ height: layout.height }}
      onLayout={event => { if (event.nativeEvent.layout.width > 0) setMeasuredWidth(event.nativeEvent.layout.width); }}>
      {families.map(family => {
        const outer = layout.families[family.name];
        const bounds = { x: MUSCLE_MAP_INSET, y: MUSCLE_MAP_HEADER, width: outer.width - MUSCLE_MAP_INSET * 2,
          height: outer.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET };
        const tiles = exerciseMapTileRects([...family.exercises, ...(family.secondary ? [family.secondary] : [])], bounds, metric);
        const count = family.exercises.length + (family.secondary?.exercises.length ?? 0);
        return <Pressable key={family.name} testID={`stats-exercise-family-${family.name}`}
          accessibilityRole="button" accessibilityState={{ selected: family.name === selectedFamily, expanded: family.name === selectedFamily }}
          accessibilityLabel={`Show ${family.name} exercises. ${count} exercises.${family.secondary ? ' Includes secondary contributions.' : ''}`}
          accessibilityHint="Shows exercise figures below the map."
          onPress={() => onSelectFamily(family.name)} style={[styles.family, positioned(outer)]}>
          <Text allowFontScaling={false} style={styles.familyName}>{family.name}</Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tiles.map(({ entry, bounds: tile }) => <ExerciseTile key={exerciseMapTileKey(entry)} entry={entry} bounds={tile} metric={metric} family={family.name} />)}
          </View>
        </Pressable>;
      })}
    </View>
    {selected ? <View testID="stats-exercise-map-detail" style={styles.detail}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>{selected.name}</Text>
      {selected.exercises.length > 0 || !selected.secondary ? renderDetail(selected.exercises) : null}
      {selected.secondary ? renderDetail(selected.secondary.exercises, selected.secondary) : null}
    </View> : null}
  </View>;
}

const positioned = (bounds: MapRect) => ({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height });

function ExerciseTile({ entry, bounds, metric, family }: {
  entry: ExerciseMapTile; bounds: MapRect; metric: ProgressMetric; family: MuscleMapFamily;
}) {
  const figures = comparisonFigures(exerciseMapTileRow(entry), metric);
  const name = 'item' in entry ? entry.item.name : 'Secondary';
  const tileID = 'item' in entry ? `stats-exercise-tile-${family}-${entry.item.id}` : `stats-exercise-secondary-${family}`;
  const level = Math.ceil(entry.targetAttainment * (HEAT_RAMP.length - 1));
  const backgroundColor = metric === 'workingSetCount' ? HEAT_RAMP[level]
    : figures.change.tone === 'neutral' ? uiRoles.ruleSoft : withAlpha(changeToneColour(figures.change.tone), 0.16);
  const compactHeight = uiSpace.xs * 2 + uiTypography.lineHeight.sm + uiTypography.lineHeight.base;
  const detailed = bounds.height >= compactHeight + uiTypography.lineHeight.sm + uiTypography.lineHeight.xs;
  const readable = bounds.width >= uiGeometry.tapTarget && bounds.height >= compactHeight;
  return <View testID={tileID} style={[styles.tile, positioned(bounds), { backgroundColor }]}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tileRule]} />
    {readable ? <View style={styles.tileContent}>
      <Text allowFontScaling={false} numberOfLines={detailed ? 2 : 1} style={styles.name}>{name}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.figure}
        testID={`${tileID}-now`}>{figures.now}</Text>
      {detailed ? <Text allowFontScaling={false} numberOfLines={1} style={[styles.change,
        { color: metric === 'workingSetCount' ? uiRoles.ink : changeToneColour(figures.change.tone) }]}>{figures.change.text}</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
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
  change: { fontFamily: uiFonts.figure.family, fontSize: uiTypography.size.xs, lineHeight: uiTypography.lineHeight.xs },
  detail: { gap: uiSpace.sm },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
});
