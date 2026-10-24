import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { changeToneColour } from '@/components/ui/change-tone';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { useDateFormat } from '@/src/preferences/hooks';
import type { TodayProgressPeriod } from '@/src/progress-summary';

import {
  CHART_HEIGHT,
  formatPacePhrase,
  formatSignedCount,
  formatWeekRange,
  paceDifference,
  paceTone,
  periodChartAccessibilityLabel,
  periodChartGeometry,
  periodRangesAccessibilityLabel,
  todayLabelAnchor,
  toPolyline,
  type PeriodChartGeometry,
} from './progress-format';
import { todayText } from './text-styles';

// Until the first layout pass reports the card's width (and in Jest, where
// none runs): roughly a 390pt phone's card.
const FALLBACK_CHART_WIDTH = 326;
// The `TODAY` label's baseline, under the plot.
const AXIS_LABEL_OFFSET = 15;
// A filling chart never draws shorter than this; the card scrolls instead.
export const MIN_FILL_CHART_HEIGHT = 72;
const WEEK_TICK = 4;

const axisLabel = { fontFamily: uiFonts.display.family, fontWeight: '700' as const, fontSize: uiTypography.size.xxs };

function PeriodChart({ geometry }: { geometry: PeriodChartGeometry }) {
  const { plot, current, previous, projection, today, weekStartsX } = geometry;
  const area = [{ x: 0, y: plot.bottom }, ...current, { x: today.current.x, y: plot.bottom }];
  const previousEnd = previous[previous.length - 1];
  const todayAnchor = todayLabelAnchor(today.current.x, plot.width);

  return (
    <>
      <Line stroke={uiRoles.rule} strokeWidth={1} x1={0} x2={plot.width} y1={plot.bottom} y2={plot.bottom} />
      {weekStartsX.map((x) => (
        <Line key={x} stroke={uiRoles.rule} strokeWidth={1} x1={x} x2={x} y1={plot.bottom} y2={plot.bottom + WEEK_TICK} />
      ))}
      <Line stroke={uiRoles.ruleSoft} strokeWidth={1} x1={today.current.x} x2={today.current.x} y1={plot.top} y2={plot.bottom} />
      <Polygon fill={uiRoles.viz0} points={toPolyline(area)} />
      <Polyline
        fill="none"
        points={toPolyline(previous)}
        stroke={uiRoles.inkFaint}
        strokeDasharray="5 4"
        strokeLinejoin="round"
        strokeWidth={2}
        testID="today-progress-chart-previous"
      />
      <Line
        stroke={uiRoles.inkGhost}
        strokeDasharray="2 4"
        strokeLinecap="round"
        strokeWidth={2}
        testID="today-progress-chart-projection"
        x1={projection.from.x}
        x2={projection.to.x}
        y1={projection.from.y}
        y2={projection.to.y}
      />
      <Polyline
        fill="none"
        points={toPolyline(current)}
        stroke={uiRoles.ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        testID="today-progress-chart-current"
      />
      <Circle cx={today.current.x} cy={today.current.y} fill={uiRoles.ink} r={4.5} stroke={uiRoles.surface} strokeWidth={2} />
      <Circle cx={today.previous.x} cy={today.previous.y} fill={uiRoles.surface} r={3.5} stroke={uiRoles.inkFaint} strokeWidth={2} />
      {previousEnd ? (
        <SvgText {...axisLabel} fill={uiRoles.inkMuted} letterSpacing={1} x={previousEnd.x + 6} y={previousEnd.y + 4}>
          LAST
        </SvgText>
      ) : null}
      <SvgText {...axisLabel} fill={uiRoles.ink} letterSpacing={1} textAnchor={todayAnchor} x={today.current.x} y={plot.bottom + AXIS_LABEL_OFFSET}>
        TODAY
      </SvgText>
    </>
  );
}

// The fixed period ([[comparison.window]]): its range against the previous
// period's; its working sets so far against the previous period at the same
// day ([[comparison.change-display]]) beside the previous period's whole
// total; and the cumulative lines by day. `fill` lets the chart take the
// height the block is given (Today's cards layout) instead of its own.
export function PeriodPace({ period, fill = false }: { period: TodayProgressPeriod; fill?: boolean }) {
  const dateFormat = useDateFormat();
  const [size, setSize] = useState({ width: FALLBACK_CHART_WIDTH, height: CHART_HEIGHT });
  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    const height = fill ? Math.round(event.nativeEvent.layout.height) : CHART_HEIGHT;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) setSize({ width, height });
  };
  const { width, height } = size;
  const difference = paceDifference(period);

  return (
    <View style={[styles.block, fill ? styles.fill : null]} testID="today-progress-period">
      <View accessible accessibilityLabel={periodRangesAccessibilityLabel(period, dateFormat)} style={styles.ranges}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]} testID="today-progress-period-range">
          {formatWeekRange(period.window, dateFormat)}
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint]} testID="today-progress-period-previous-range">
          vs {formatWeekRange(period.previous.window, dateFormat)}
        </Text>
      </View>
      <View style={styles.figures}>
        <View style={styles.column}>
          <View style={styles.currentRow}>
            <Text allowFontScaling={false} style={todayText.headlineFigure} testID="today-progress-period-working-sets">
              {period.toDate.workingSets}
              <Text allowFontScaling={false} style={todayText.detailFigure}> sets</Text>
            </Text>
            {/* The pace difference takes its direction's colour, like every
                other change figure (`design-language.md` §6). */}
            <Text allowFontScaling={false} testID="today-progress-period-difference"
              style={[todayText.differenceFigure, { color: changeToneColour(paceTone(difference)) }]}>
              {formatSignedCount(difference)}
            </Text>
          </View>
          <Text allowFontScaling={false} style={todayText.mutedLine} testID="today-progress-period-pace">
            {formatPacePhrase(period)}
          </Text>
        </View>
        <View style={[styles.column, styles.previousTotal]}>
          <Text allowFontScaling={false} style={todayText.differenceFigure} testID="today-progress-period-previous-total">
            {period.previous.total.workingSets}
            <Text allowFontScaling={false} style={todayText.detailFigure}> sets</Text>
          </Text>
          <Text allowFontScaling={false} style={todayText.mutedLine}>
            last period
          </Text>
        </View>
      </View>
      <View
        accessible
        accessibilityLabel={periodChartAccessibilityLabel(period)}
        accessibilityRole="image"
        onLayout={onLayout}
        style={fill ? styles.fillChart : null}
        testID="today-progress-chart">
        <Svg height={height} style={styles.chart} width={width}>
          <PeriodChart geometry={periodChartGeometry(period, width, height)} />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  ranges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: uiSpace.sm,
  },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: uiSpace.sm,
  },
  column: {
    gap: uiSpace.xs,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  previousTotal: {
    alignItems: 'flex-end',
  },
  chart: {
    overflow: 'visible',
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  fillChart: {
    flex: 1,
    minHeight: MIN_FILL_CHART_HEIGHT,
  },
});
