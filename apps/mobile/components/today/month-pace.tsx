import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { TodayProgressMonth } from '@/src/progress-summary';

import {
  CHART_HEIGHT,
  formatPacePhrase,
  formatSessionCount,
  formatSignedCount,
  monthChartAccessibilityLabel,
  monthChartGeometry,
  monthName,
  paceDifference,
  shortMonthName,
  toPolyline,
  type MonthChartGeometry,
} from './progress-format';
import { todayText } from './text-styles';

// Until the first layout pass reports the card's width (and in Jest, where
// none runs): roughly a 390pt phone's card.
const FALLBACK_CHART_WIDTH = 326;
const AXIS_LABEL_Y = 101;
// An axis label this close to today's is dropped rather than overlapped.
const AXIS_LABEL_CLEARANCE = 18;
// A label's baseline this far down still shows its 10pt caps inside the chart.
const CURRENT_LABEL_MIN_Y = 10;

const axisLabel = { fontFamily: uiFonts.display.family, fontWeight: '700' as const, fontSize: uiTypography.size.xxs };

function MonthChart({ month, geometry }: { month: TodayProgressMonth; geometry: MonthChartGeometry }) {
  const { plot, current, previous, projection, today, monthEndX } = geometry;
  const area = [{ x: 0, y: plot.bottom }, ...current, { x: today.current.x, y: plot.bottom }];
  const previousEnd = previous[previous.length - 1];
  const showFirstDay = today.current.x >= AXIS_LABEL_CLEARANCE;
  const showLastDay = monthEndX - today.current.x >= AXIS_LABEL_CLEARANCE;
  const currentLabelAfter = today.current.x < 40;
  // Above today's dot, or beside it when the dot is at the top of the plot.
  const currentLabelY = Math.max(CURRENT_LABEL_MIN_Y, today.current.y - 9);

  return (
    <>
      <Line stroke={uiRoles.rule} strokeWidth={1} x1={0} x2={plot.width} y1={plot.bottom} y2={plot.bottom} />
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
          {shortMonthName(month.previous.window.start).toUpperCase()}
        </SvgText>
      ) : null}
      <SvgText
        {...axisLabel}
        fill={uiRoles.ink}
        letterSpacing={1}
        textAnchor={currentLabelAfter ? 'start' : 'end'}
        x={today.current.x + (currentLabelAfter ? 6 : -6)}
        y={currentLabelY}>
        {shortMonthName(month.window.start).toUpperCase()}
      </SvgText>
      {showFirstDay ? (
        <SvgText {...axisLabel} fill={uiRoles.inkFaint} x={0} y={AXIS_LABEL_Y}>
          1
        </SvgText>
      ) : null}
      <SvgText {...axisLabel} fill={uiRoles.ink} textAnchor="middle" x={today.current.x} y={AXIS_LABEL_Y}>
        {String(month.dayOfMonth)}
      </SvgText>
      {showLastDay ? (
        <SvgText {...axisLabel} fill={uiRoles.inkFaint} textAnchor="end" x={monthEndX} y={AXIS_LABEL_Y}>
          {String(month.daysInMonth)}
        </SvgText>
      ) : null}
    </>
  );
}

// `<Month> so far`: the month's working sets against the previous month at the
// same day (a signed absolute difference, never a percentage), the cumulative
// line by day, and one summary line.
export function MonthPace({ month }: { month: TodayProgressMonth }) {
  const [width, setWidth] = useState(FALLBACK_CHART_WIDTH);
  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };
  const previousName = shortMonthName(month.previous.window.start);
  const previousSameDay = month.previous.toSameDay;

  return (
    <View style={styles.block} testID="today-progress-month">
      <View style={styles.heading}>
        <View style={styles.headline}>
          <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
            {monthName(month.window.start)} so far
          </Text>
          <Text allowFontScaling={false} style={todayText.headlineFigure} testID="today-progress-month-working-sets">
            {month.toDate.workingSets}
            <Text allowFontScaling={false} style={todayText.detailFigure}> sets</Text>
          </Text>
        </View>
        <View style={styles.difference}>
          <Text allowFontScaling={false} style={todayText.differenceFigure} testID="today-progress-month-difference">
            {formatSignedCount(paceDifference(month))}
          </Text>
          <Text allowFontScaling={false} style={todayText.mutedLine} testID="today-progress-month-pace">
            {formatPacePhrase(month)}
          </Text>
        </View>
      </View>
      <View
        accessible
        accessibilityLabel={monthChartAccessibilityLabel(month)}
        accessibilityRole="image"
        onLayout={onLayout}
        testID="today-progress-chart">
        <Svg height={CHART_HEIGHT} style={styles.chart} width={width}>
          <MonthChart geometry={monthChartGeometry(month, width)} month={month} />
        </Svg>
      </View>
      <Text allowFontScaling={false} style={todayText.mutedLine} testID="today-progress-month-summary">
        On course for <Text allowFontScaling={false} style={todayText.inlineFigure}>{month.projectedWorkingSets}</Text> vs {previousName}&apos;s{' '}
        <Text allowFontScaling={false} style={todayText.inlineFigure}>{month.previous.total.workingSets}</Text> ·{' '}
        {formatSessionCount(month.toDate.sessions)} vs {previousSameDay.sessions} ·{' '}
        <Text allowFontScaling={false} style={month.toDate.prs > 0 ? todayText.record : todayText.inlineFigure}>{month.toDate.prs}</Text>
        {month.toDate.prs === 1 ? ' PR' : ' PRs'} vs{' '}
        <Text allowFontScaling={false} style={todayText.inlineFigure}>{previousSameDay.prs}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: uiSpace.sm,
  },
  headline: {
    gap: uiSpace.xs,
  },
  difference: {
    alignItems: 'flex-end',
    gap: uiSpace.xs,
  },
  chart: {
    overflow: 'visible',
  },
});
