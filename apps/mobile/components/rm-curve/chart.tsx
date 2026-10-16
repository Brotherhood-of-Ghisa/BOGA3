import { useRef, useState } from 'react';
import { Platform, Pressable, Text, type ViewInstance } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { RegimeCurve } from '@/src/strength-regimes/assessment';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { axisLabel, curveGeometry, pointsAt, PLOT_HEIGHT } from './geometry';
import { curveStyles as styles } from './styles';

export const periodColour = (period: RegimeCurve['period']) => period === 'newer' ? uiRoles.regimeNewer : uiRoles.regimeOlder;

/** Exact coordinates; complete-session date partitions share curve and point identity. */
export function RmCurveChart({ model, selectedId, onPick, plotRef, curves = [], boundary = null }: {
  curves?: RegimeCurve[]; boundary?: number | null;
  model: RmCurveModel; selectedId: string | null; onPick: (ids: string[]) => void; plotRef: (node: ViewInstance | null) => void;
}) {
  const [width, setWidth] = useState(300);
  const host = useRef<ViewInstance | null>(null);
  const plot = curveGeometry(model, width, curves);
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
        {plot.lines.map(line => <Polyline key={line.period} testID={`rm-fit-${line.period}`} points={line.line} fill="none"
          stroke={periodColour(line.period)} strokeWidth={2} strokeDasharray={line.period === 'newer' ? '6 4' : undefined} opacity={line.opacity} />)}
        {plot.points.map((p, index) => {
          const newer = boundary !== null && model.observations[index].completedAt.getTime() >= boundary;
          const colour = boundary === null && !curves.length ? uiRoles.inkMuted : periodColour(newer ? 'newer' : 'older');
          return newer ? <Polyline key={p.id} testID={`rm-point-${p.id}`} points={`${p.x},${p.y - 5} ${p.x + 5},${p.y} ${p.x},${p.y + 5} ${p.x - 5},${p.y} ${p.x},${p.y - 5}`}
            fill={uiRoles.surface} stroke={colour} strokeWidth={2} />
            : <Circle key={p.id} testID={`rm-point-${p.id}`} cx={p.x} cy={p.y} r={4}
              fill={uiRoles.surface} stroke={colour} strokeWidth={2} />;
        })}
        {plot.points.filter(p => p.id === selectedId).map(p => <Polyline key={p.id} testID="rm-selection-caret"
          points={`${p.x - 4},${p.y - 12} ${p.x},${p.y - 8} ${p.x + 4},${p.y - 12}`}
          fill="none" stroke={uiRoles.ink} strokeWidth={2} />)}
      </Svg>
    </Pressable>
    <Text allowFontScaling={false} style={styles.micro}>REPS + RIR</Text>
  </>;
}
