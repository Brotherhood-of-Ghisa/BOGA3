import { useRef, useState } from 'react';
import { Platform, Pressable, Text, View, type ViewInstance } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { axisLabel, curveGeometry, pointsAt, PLOT_HEIGHT } from './geometry';
import { curveStyles as styles } from './styles';

const recencyColours = [uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4];

/** Exact coordinates, a fixed reference, recency only; the set list provides every value. */
export function RmCurveChart({ model, selectedId, onPick, plotRef }: {
  model: RmCurveModel; selectedId: string | null; onPick: (ids: string[]) => void; plotRef: (node: ViewInstance | null) => void;
}) {
  const [width, setWidth] = useState(300);
  const host = useRef<ViewInstance | null>(null);
  const plot = curveGeometry(model, width);
  return <>
    <Pressable ref={node => { host.current = node; plotRef(node); }} testID="rm-curve-plot" accessibilityRole="button"
      accessibilityLabel={`${model.observations.length} observed sets. RIR0-equivalent repetitions versus load. Open the set list for values.`}
      accessibilityHint="Tap near a point to select; coincident points open a choice list."
      onLayout={event => { if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width); }}
      onAccessibilityTap={() => onPick(plot.points.map(p => p.id))}
      onPress={event => {
        const x = event.nativeEvent?.locationX, y = event.nativeEvent?.locationY;
        const mouse = event.nativeEvent as { clientX?: number; clientY?: number };
        const clientX = mouse?.clientX ?? NaN, clientY = mouse?.clientY ?? NaN;
        // Mouse page coordinates drift when the document scrolls; measure in the viewport.
        if (Platform.OS === 'web' && host.current && Number.isFinite(clientX) && Number.isFinite(clientY)) {
          host.current.measureInWindow((left, top) => onPick(pointsAt(plot, clientX - left, clientY - top, uiGeometry.tapTarget)));
          return;
        }
        if (Number.isFinite(x) && Number.isFinite(y)) { onPick(pointsAt(plot, x, y, uiGeometry.tapTarget)); return; }
        onPick(plot.points.map(p => p.id));
      }}>
      <Svg width={width} height={PLOT_HEIGHT} accessible={false}>
        {[0, 1, 2, 3, 4].map(i => <Line key={i} x1={plot.x(0)} x2={plot.x(plot.maxReps)}
          y1={plot.y(plot.maxLoad * (i / 4))} y2={plot.y(plot.maxLoad * (i / 4))} stroke={uiRoles.ruleSoft} />)}
        {[0, 1, 2, 3, 4].map(i => <SvgText key={i} x={plot.x(0) - uiSpace.xs}
          y={plot.y(plot.maxLoad * (i / 4)) + uiSpace.xs} textAnchor="end" fill={uiRoles.inkMuted}
          fontFamily={uiFonts.figure.family} fontWeight="500" fontSize={uiTypography.size.xxs}>
          {axisLabel(plot.maxLoad * (i / 4))}
        </SvgText>)}
        {[0, 1, 2, 3, 4].map(i => <SvgText key={i} x={plot.x(plot.maxReps * (i / 4))} y={PLOT_HEIGHT - uiSpace.xs}
          textAnchor={i === 4 ? 'end' : 'middle'} fill={uiRoles.inkMuted} fontFamily={uiFonts.figure.family} fontWeight="500" fontSize={uiTypography.size.xxs}>
          {axisLabel(plot.maxReps * (i / 4))}
        </SvgText>)}
        {model.curve.length > 0 ? <Polyline testID="rm-reference-line" points={plot.line} fill="none" stroke={uiRoles.ink} strokeWidth={2} /> : null}
        {plot.points.map(p => <Circle key={p.id} testID={`rm-point-${p.id}`} cx={p.x} cy={p.y} r={5}
          fill={recencyColours[p.recency]} stroke={uiRoles.ink} strokeWidth={1} />)}
        {plot.points.filter(p => p.id === selectedId).map(p => <Polyline key={p.id} testID="rm-selection-caret"
          points={`${p.x - 4},${p.y - 12} ${p.x},${p.y - 8} ${p.x + 4},${p.y - 12}`}
          fill="none" stroke={uiRoles.ink} strokeWidth={2} />)}
      </Svg>
    </Pressable>
    <Text allowFontScaling={false} style={styles.micro}>REPETITIONS · RIR0 EQUIVALENT</Text>
    <View style={styles.legend}><Text allowFontScaling={false} style={styles.body}>Earlier</Text>
      {recencyColours.map(colour => <View key={colour} style={[styles.dot, { backgroundColor: colour }]} />)}
      <Text allowFontScaling={false} style={styles.body}>Newer</Text></View>
  </>;
}
