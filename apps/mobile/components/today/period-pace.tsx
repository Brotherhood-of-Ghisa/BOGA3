import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { changeToneColour } from '@/components/ui/change-tone';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { useDateFormat } from '@/src/preferences/hooks';
import type { TodayProgressPeriod } from '@/src/progress-summary';

import {
  CHART_HEIGHT,
  formatPeriodDayLabel,
  formatPeriodRange,
  formatSignedCount,
  paceTone,
  periodChartAccessibilityLabel,
  periodChartAccessibilityValue,
  periodChartGeometry,
  periodDayAtX,
  periodDayFigures,
  periodFiguresAccessibilityLabel,
  todayLabelAnchor,
  toPolyline,
  type PeriodChartGeometry,
} from './progress-format';
import { StepArrows } from './step-arrows';
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
  const { plot, current, previous, projection, today, selected, weekStartsX } = geometry;
  const area = [{ x: 0, y: plot.bottom }, ...current, { x: today.current.x, y: plot.bottom }];
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
      {selected.current.x === today.current.x ? null : (
        <Circle cx={today.current.x} cy={today.current.y} fill={uiRoles.ink} r={2.5} testID="today-progress-chart-today" />
      )}
      {selected.current.x === today.current.x ? null : (
        <Line
          stroke={uiRoles.inkFaint}
          strokeWidth={1}
          testID="today-progress-chart-selection"
          x1={selected.current.x}
          x2={selected.current.x}
          y1={plot.top}
          y2={plot.bottom}
        />
      )}
      <Circle cx={selected.previous.x} cy={selected.previous.y} fill={uiRoles.surface} r={3.5} stroke={uiRoles.inkFaint} strokeWidth={2} />
      {/* A projected day is hollow: the projection's figure, not a count. */}
      <Circle
        cx={selected.current.x}
        cy={selected.current.y}
        fill={selected.projected ? uiRoles.surface : uiRoles.ink}
        r={4.5}
        stroke={selected.projected ? uiRoles.ink : uiRoles.surface}
        strokeWidth={2}
      />
      <SvgText {...axisLabel} fill={uiRoles.ink} letterSpacing={1} textAnchor={todayAnchor} x={today.current.x} y={plot.bottom + AXIS_LABEL_OFFSET}>
        TODAY
      </SvgText>
    </>
  );
}

// The fixed period (`TodayProgressPeriod`) against the previous period: the
// selected day's working sets (today until the chart is touched; after today,
// the projection's) against the previous period's at the same day, and their
// difference ([[comparison.change-display]]); then the cumulative lines by day.
// The arrows by `vs` compare against an earlier or later period, never later
// than the previous one. `fill` lets the chart take the height the block is
// given (Today's cards layout) instead of its own.
export function PeriodPace({
  period,
  fill = false,
  onShowCompared,
}: {
  period: TodayProgressPeriod;
  fill?: boolean;
  /** Compares against the period this many periods back. */
  onShowCompared?: (periodsBack: number) => void;
}) {
  const dateFormat = useDateFormat();
  const [size, setSize] = useState({ width: FALLBACK_CHART_WIDTH, height: CHART_HEIGHT });
  // The selected day belongs to the period it was picked in; another period
  // (a new day, a changed Progress period) starts again at today.
  const [selection, setSelection] = useState<{ periodKey: string; dayIndex: number } | null>(null);
  const periodKey = `${period.window.start.getTime()}:${period.daysInPeriod}:${period.dayOfPeriod}`;
  const figures = periodDayFigures(period, selection?.periodKey === periodKey ? selection.dayIndex : null);
  const { width, height } = size;
  const geometry = periodChartGeometry(period, width, height, figures);

  const onLayout = (event: LayoutChangeEvent) => {
    const measuredWidth = Math.round(event.nativeEvent.layout.width);
    const measuredHeight = fill ? Math.round(event.nativeEvent.layout.height) : CHART_HEIGHT;
    if (measuredWidth > 0 && measuredHeight > 0 && (measuredWidth !== width || measuredHeight !== height)) {
      setSize({ width: measuredWidth, height: measuredHeight });
    }
  };
  const select = (dayIndex: number) => setSelection({ periodKey, dayIndex });
  const onTouch = (event: GestureResponderEvent) =>
    select(periodDayAtX(event.nativeEvent.locationX, geometry.plot.width, period.daysInPeriod));
  const onAccessibilityAction = (event: AccessibilityActionEvent) =>
    select(figures.dayIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
  const label = formatPeriodDayLabel(figures, dateFormat);

  return (
    <View style={[styles.block, fill ? styles.fill : null]} testID="today-progress-period">
      <View accessible accessibilityLabel={periodFiguresAccessibilityLabel(period, figures, dateFormat)} style={styles.figures}>
        <View style={[styles.column, styles.currentColumn]}>
          <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]} testID="today-progress-period-range">
            {formatPeriodRange(period.window, dateFormat)}
          </Text>
          {/* One line whatever the day's label: the figure shrinks rather
              than wraps, so the card keeps its height as the selection moves. */}
          <View style={styles.currentRow} testID="today-progress-period-working-sets">
            <Text allowFontScaling={false} style={todayText.detailFigure} testID="today-progress-period-day">{label} </Text>
            <Text adjustsFontSizeToFit allowFontScaling={false} numberOfLines={1} style={[todayText.headlineFigure, styles.currentFigure]}>
              {figures.workingSets}
              <Text allowFontScaling={false} style={todayText.detailFigure}> sets</Text>
            </Text>
          </View>
        </View>
        <View style={styles.column}>
          <View style={styles.comparedRow}>
            <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint]} testID="today-progress-period-previous-range">
              vs {formatPeriodRange(period.previous.window, dateFormat)}
            </Text>
            {onShowCompared ? (
              <StepArrows
                noun="period"
                onNewer={period.compareBack > 1 ? () => onShowCompared(period.compareBack - 1) : null}
                onOlder={() => onShowCompared(period.compareBack + 1)}
                testID="today-progress-period-compare"
              />
            ) : null}
          </View>
          <View style={styles.previousRow}>
            <Text allowFontScaling={false} style={todayText.differenceFigure} testID="today-progress-period-previous-sets">
              {figures.previousWorkingSets}
              <Text allowFontScaling={false} style={todayText.detailFigure}> sets</Text>
            </Text>
            {/* The difference takes its direction's colour, like every other
                change figure (`design-language.md` §6). */}
            <Text allowFontScaling={false} testID="today-progress-period-difference"
              style={[todayText.differenceFigure, { color: changeToneColour(paceTone(figures.difference)) }]}>
              {formatSignedCount(figures.difference)}
            </Text>
          </View>
        </View>
      </View>
      {/* Lifting a finger off the chart selects the day under it, and in the
          list layout so does dragging across it; a drag the scroller takes
          (the screen's scroll, the cards' swipe) selects nothing. The Svg
          takes no touches, so `locationX` is across this view. */}
      <View
        accessible
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={periodChartAccessibilityLabel(period)}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: periodChartAccessibilityValue(period, figures, dateFormat) }}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={onLayout}
        onResponderMove={fill ? undefined : onTouch}
        onResponderRelease={onTouch}
        onStartShouldSetResponder={() => true}
        style={fill ? styles.fillChart : null}
        testID="today-progress-chart">
        {/* Filling, the drawing sits over the box rather than in it, so the
            last measured height never props the box up: the box takes only
            the height the card leaves it. */}
        <View pointerEvents="none" style={fill ? StyleSheet.absoluteFill : null}>
          <Svg height={height} style={styles.chart} width={width}>
            <PeriodChart geometry={geometry} />
          </Svg>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  column: {
    gap: uiSpace.xs,
    justifyContent: 'space-between',
  },
  currentColumn: {
    flexShrink: 1,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currentFigure: {
    flexShrink: 1,
  },
  // `vs` and its arrows: the arrows' row is no taller than the label's.
  comparedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.xs,
    marginVertical: -3,
  },
  // The previous period's figure under its `vs`, the difference at the edge.
  previousRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  chart: {
    overflow: 'visible',
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  fillChart: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: MIN_FILL_CHART_HEIGHT,
  },
});
