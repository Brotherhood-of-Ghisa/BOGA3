import { useId, useRef, useState } from 'react';
import { Platform, Pressable, Text, type ViewInstance } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Polyline, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ObservationUncertainty, RegimeCurve } from '@/src/strength-regimes/assessment';
import { FIXED_REGIME_UNCERTAINTY } from '@/src/strength-regimes/fit';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { axisLabel, curveGeometry, pointsAt, PLOT_HEIGHT } from './geometry';
import { curveStyles as styles } from './styles';

export const periodColour = (period: RegimeCurve['period']) => period === 'newer' ? uiRoles.regimeNewer : uiRoles.regimeOlder;

/** Exact coordinates; complete-session date partitions share curve and point identity. */
export function RmCurveChart({ model, selectedId, onPick, curves = [], boundary = null, uncertainty = FIXED_REGIME_UNCERTAINTY }: {
  curves?: RegimeCurve[]; boundary?: number | null;
  uncertainty?: ObservationUncertainty | null;
  model: RmCurveModel; selectedId: string | null; onPick: (ids: string[]) => void;
}) {
  const [width, setWidth] = useState(300);
  const haloId = useId();
  const host = useRef<ViewInstance | null>(null);
  const plot = curveGeometry(model, width, curves, uncertainty);
  const colours = { neutral: uiRoles.inkMuted, older: periodColour('older'), newer: periodColour('newer') };
  const marks = plot.points.map((p, index) => {
    const observation = model.observations[index];
    const newer = boundary !== null && observation.completedAt.getTime() >= boundary;
    const tone: keyof typeof colours = boundary === null && !curves.length ? 'neutral' : newer ? 'newer' : 'older';
    return { ...p, newer, tone };
  });
  return <>
    <Pressable ref={host} testID="rm-curve-plot" accessibilityRole="button"
      accessibilityLabel={`${model.observations.length} observed sets. RIR0-equivalent repetitions versus load. Halo width follows RIR error; height follows load variation. RIR zero has no sideways spread. Halos show modelled spread, not confidence. Select a set for values.`}
      accessibilityHint="Tap near a point to select; use Previous set and Next set to browse overlapping sets."
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
        <Defs>
          <ClipPath id={`${haloId}-clip`}>
            <Rect x={plot.x(0)} y={plot.y(plot.maxLoad)} width={plot.x(plot.maxReps) - plot.x(0)}
              height={plot.y(0) - plot.y(plot.maxLoad)} />
          </ClipPath>
          {Object.entries(colours).map(([tone, colour]) => <RadialGradient key={tone} id={`${haloId}-${tone}`}>
            <Stop offset="0" stopColor={colour} stopOpacity={0.3} />
            <Stop offset="0.5" stopColor={colour} stopOpacity={0.15} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </RadialGradient>)}
        </Defs>
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
        {/* One error scale beyond the marker footprint; this is not a probability contour. */}
        <G clipPath={`url(#${haloId}-clip)`}>
          {marks.filter(p => p.halo !== null).map(p => <Ellipse key={p.id} testID={`rm-halo-${p.id}`}
            cx={p.x} cy={p.y} rx={(p.newer ? 5 : 4) + p.halo!.rx} ry={(p.newer ? 5 : 4) + p.halo!.ry}
            fill={`url(#${haloId}-${p.tone})`} />)}
        </G>
        {marks.map(p => p.newer ? <Polyline key={p.id} testID={`rm-point-${p.id}`} points={`${p.x},${p.y - 5} ${p.x + 5},${p.y} ${p.x},${p.y + 5} ${p.x - 5},${p.y} ${p.x},${p.y - 5}`}
            fill={uiRoles.surface} stroke={colours[p.tone]} strokeWidth={2} />
            : <Circle key={p.id} testID={`rm-point-${p.id}`} cx={p.x} cy={p.y} r={4}
              fill={uiRoles.surface} stroke={colours[p.tone]} strokeWidth={2} />)}
        {plot.points.filter(p => p.id === selectedId).map(p => <Polyline key={p.id} testID="rm-selection-caret"
          points={`${p.x - 4},${p.y - 12} ${p.x},${p.y - 8} ${p.x + 4},${p.y - 12}`}
          fill="none" stroke={uiRoles.ink} strokeWidth={2} />)}
      </Svg>
    </Pressable>
    <Text allowFontScaling={false} style={styles.micro}>REPS + RIR</Text>
  </>;
}
