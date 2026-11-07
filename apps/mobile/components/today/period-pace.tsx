import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';

import { changeToneInk } from '@/components/ui/change-tone';
import { FigureText } from '@/components/ui/figure-text';
import { useTextRoles } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';
import type { TodayProgressPeriod } from '@/src/progress-summary';

import {
  CHART_HEIGHT,
  formatPeriodDayLabel,
  formatPeriodRange,
  formatPaceValue,
  paceUnit,
  periodPaceDelta,
  periodChartAccessibilityLabel,
  periodChartAccessibilityValue,
  periodChartGeometry,
  periodDayAtX,
  periodDayFigures,
  periodFiguresAccessibilityLabel,
  toPolyline,
  type PeriodChartGeometry,
} from './progress-format';
import { StepAround } from './step-arrows';
import { TonnageReferenceLayer } from './tonnage-reference-layer';
import { REFERENCE_GAP, REFERENCE_HEIGHT } from './tonnage-references';
import type { ProgressMetric } from '@/src/preferences/model';

// Until the first layout pass reports the card's width (and in Jest, where
// none runs): roughly a 390pt phone's card.
const FALLBACK_CHART_WIDTH = 326;
// A filling chart never draws shorter than this; the card scrolls instead.
export const MIN_FILL_CHART_HEIGHT = 72;
const WEEK_TICK = 4;

function PeriodChart({ geometry }: { geometry: PeriodChartGeometry }) {
  const roles = useUiRoles();
  const { plot, current, previous, projection, today, selected, weekStartsX } = geometry;
  const lastCurrent = current[current.length - 1];
  const area = lastCurrent ? [{ x: 0, y: plot.bottom }, ...current, { x: lastCurrent.x, y: plot.bottom }] : [];

  return (
    <>
      <Line stroke={roles.rule} strokeWidth={1} x1={0} x2={plot.width} y1={plot.bottom} y2={plot.bottom} />
      {weekStartsX.map((x) => (
        <Line key={x} stroke={roles.rule} strokeWidth={1} x1={x} x2={x} y1={plot.bottom} y2={plot.bottom + WEEK_TICK} />
      ))}
      {today.current ? <Line stroke={roles.ruleSoft} strokeWidth={1} x1={today.current.x} x2={today.current.x} y1={plot.top} y2={plot.bottom} /> : null}
      {area.length ? <Polygon fill={roles.viz0} points={toPolyline(area)} /> : null}
      <Polyline
        fill="none"
        points={toPolyline(previous)}
        stroke={roles.inkFaint}
        strokeDasharray="5 4"
        strokeLinejoin="round"
        strokeWidth={2}
        testID="today-progress-chart-previous"
      />
      {projection ? <Line
        stroke={roles.inkGhost}
        strokeDasharray="2 4"
        strokeLinecap="round"
        strokeWidth={2}
        testID="today-progress-chart-projection"
        x1={projection.from.x}
        x2={projection.to.x}
        y1={projection.from.y}
        y2={projection.to.y}
      /> : null}
      <Polyline
        fill="none"
        points={toPolyline(current)}
        stroke={roles.ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        testID="today-progress-chart-current"
      />
      {selected.x === today.current?.x ? null : (
        <Line
          stroke={roles.inkFaint}
          strokeWidth={1}
          testID="today-progress-chart-selection"
          x1={selected.x}
          x2={selected.x}
          y1={plot.top}
          y2={plot.bottom}
        />
      )}
      <TonnageReferenceLayer annotations={geometry.references} width={plot.width} />
      {!today.current || selected.x === today.current.x ? null : (
        <Circle cx={today.current.x} cy={today.current.y} fill={roles.ink} r={2.5} testID="today-progress-chart-today" />
      )}
      {selected.previous ? <Circle cx={selected.previous.x} cy={selected.previous.y} fill={roles.surface} r={3.5} stroke={roles.inkFaint} strokeWidth={2} /> : null}
      {/* A projected day is hollow: the projection's figure, not a count. */}
      {selected.current ? <Circle
        cx={selected.current.x}
        cy={selected.current.y}
        fill={selected.projected ? roles.surface : roles.ink}
        r={4.5}
        stroke={selected.projected ? roles.ink : roles.onInk}
        strokeWidth={2}
      /> : null}
    </>
  );
}

// The fixed period (`TodayProgressPeriod`) against the previous period: the
// selected day's working sets (today until the chart is touched; after today,
// the projection's) against the previous period's at the same day, and their
// difference ([[comparison.change-display]]); then the cumulative lines by day.
// The arrows either side of the compared range step to an earlier or later
// period, never later than the previous one. The chart takes the height the
// block is given.
// Tons adds the references of [[comparison.tonnage-references]]; their quiet
// passive labels stay legible over the series; selection markers stay above.
export function PeriodPace({
  period,
  onShowCompared,
  metric,
}: {
  period: TodayProgressPeriod;
  metric: ProgressMetric;
  /** Compares against the period this many periods back. */
  onShowCompared?: (periodsBack: number) => void;
}) {
  const styles = useStyles();
  const roles = useUiRoles();
  const { text, tone } = useTextRoles();
  const [size, setSize] = useState({ width: FALLBACK_CHART_WIDTH, height: CHART_HEIGHT });
  // The selected day belongs to the period it was picked in; another period
  // (a new day, a changed Progress period) starts again at today.
  const [selection, setSelection] = useState<{ periodKey: string; dayIndex: number } | null>(null);
  const periodKey = `${period.window.start.getTime()}:${period.daysInPeriod}:${period.dayOfPeriod}`;
  const figures = periodDayFigures(period, selection?.periodKey === periodKey ? selection.dayIndex : null, metric);
  const { width, height } = size;
  const geometry = periodChartGeometry(period, width, height, figures);
  // Leave a right-hand column for every annotation, even on a short phone.
  const referenceMinimumHeight = (geometry.references.length + 1) * (REFERENCE_HEIGHT + REFERENCE_GAP);

  const onLayout = (event: LayoutChangeEvent) => {
    const measuredWidth = Math.round(event.nativeEvent.layout.width);
    const measuredHeight = Math.round(event.nativeEvent.layout.height);
    if (measuredWidth > 0 && measuredHeight > 0 && (measuredWidth !== width || measuredHeight !== height)) {
      setSize({ width: measuredWidth, height: measuredHeight });
    }
  };
  const select = (dayIndex: number) => setSelection({ periodKey, dayIndex });
  const onTouch = (event: GestureResponderEvent) =>
    select(periodDayAtX(event.nativeEvent.locationX, geometry.plot.width, period.daysInPeriod));
  const onAccessibilityAction = (event: AccessibilityActionEvent) =>
    select(figures.dayIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
  const label = formatPeriodDayLabel(figures);
  const delta = periodPaceDelta(figures);
  const canCompareNewer = period.compareBack > 1;
  const compareActions = onShowCompared
    ? [
        { name: 'older', label: 'Previous period' },
        ...(canCompareNewer ? [{ name: 'newer', label: 'Next period' }] : []),
      ]
    : undefined;
  const onCompareAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'older') onShowCompared?.(period.compareBack + 1);
    if (event.nativeEvent.actionName === 'newer' && canCompareNewer) onShowCompared?.(period.compareBack - 1);
  };
  const comparedRange = (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[text.label, tone.faint]}
      testID="today-progress-period-previous-range">
      {formatPeriodRange(period.previous.window)}
    </Text>
  );

  return (
    <View style={[styles.block, styles.fill]} testID="today-progress-period">
      {/* The metric is selected in the weekly box; chart units are passive. */}
      <View
        accessibilityActions={compareActions}
        accessibilityLabel={periodFiguresAccessibilityLabel(period, figures)}
        accessible={false}
        onAccessibilityAction={onCompareAction}
        style={styles.figures}
        testID="today-progress-period-figures">
        <View style={[styles.column, styles.currentColumn]}>
          <Text allowFontScaling={false} style={[text.label, tone.ink]} testID="today-progress-period-range">
            {formatPeriodRange(period.window)}
          </Text>
          {/* One line whatever the day's label: the figure shrinks rather
              than wraps, so the card keeps its height as the selection moves. */}
          <View style={[styles.currentRow, metric === 'totalVolume' ? styles.tonnageRow : null]} testID="today-progress-period-working-sets">
            <Text allowFontScaling={false} numberOfLines={1} style={text.meta} testID="today-progress-period-day"><FigureText>{`${label} `}</FigureText></Text>
            <Text accessibilityLabel={periodFiguresAccessibilityLabel(period, figures)}
              accessibilityActions={compareActions} onAccessibilityAction={onCompareAction}
              adjustsFontSizeToFit={metric === 'workingSetCount'} allowFontScaling={false} numberOfLines={1} style={[text.figureHero, styles.currentFigure]}>
              {formatPaceValue(figures.value, metric)}
              <Text allowFontScaling={false} style={text.meta}> {paceUnit(metric)}</Text>
            </Text>
          </View>
        </View>
        {/* `vs` between the two periods, a rule above and below it. */}
        <View style={styles.versus}>
          <View style={styles.versusRule} />
          <Text allowFontScaling={false} style={[text.label, tone.faint]}>vs</Text>
          <View style={styles.versusRule} />
        </View>
        <View style={[styles.column, styles.comparedColumn]}>
          {onShowCompared ? (
            <StepAround
              noun="period"
              onNewer={canCompareNewer ? () => onShowCompared(period.compareBack - 1) : null}
              onOlder={() => onShowCompared(period.compareBack + 1)}
              testID="today-progress-period-compare">
              {comparedRange}
            </StepAround>
          ) : (
            comparedRange
          )}
          <View style={styles.previousRow}>
            <Text allowFontScaling={false} style={text.figureLarge} testID="today-progress-period-previous-sets">
              {formatPaceValue(figures.previousValue, metric)}
              <Text allowFontScaling={false} style={text.meta}> {paceUnit(metric)}</Text>
            </Text>
            {/* The difference takes its direction's colour, like every other
                change figure (`design-language.md` §6). */}
            <Text allowFontScaling={false} testID="today-progress-period-difference"
              style={[text.figureLarge, { color: changeToneInk(roles, delta.tone) }]}>
              {delta.text}
            </Text>
          </View>
        </View>
      </View>
      {/* Lifting a finger off the chart selects the day under it; a drag the
          scroller takes (the cards' swipe) selects nothing. The Svg takes no
          touches, so `locationX` is across this view. */}
      <View
        accessible
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={periodChartAccessibilityLabel(period, metric)}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: periodChartAccessibilityValue(period, figures) }}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={onLayout}
        onResponderRelease={onTouch}
        onStartShouldSetResponder={() => true}
        style={[styles.fillChart, geometry.references.length > 0 && {
          minHeight: Math.max(MIN_FILL_CHART_HEIGHT, referenceMinimumHeight),
        }]}
        testID="today-progress-chart">
        {/* The drawing sits over the box rather than in it, so the last
            measured height never props the box up: the box takes only the
            height the card leaves it. */}
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg height={height} style={styles.chart} width={width}>
            <PeriodChart geometry={geometry} />
          </Svg>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  block: {
    gap: uiSpace.md,
  },
  // The current period, `vs`, then the compared period.
  figures: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
  },
  column: {
    gap: uiSpace.xs,
    justifyContent: 'space-between',
  },
  currentColumn: {
    flex: 1,
    minWidth: 0,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tonnageRow: { flexDirection: 'column', alignItems: 'flex-start' },
  currentFigure: {
    flexShrink: 1,
  },
  versus: {
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  versusRule: {
    flex: 1,
    width: 1,
    backgroundColor: roles.rule,
  },
  // Clear of `vs` on the left; on the right the arrow reaches past the edge, so its glyph sits on the figures' line.
  comparedColumn: {
    flexShrink: 0,
    marginLeft: uiSpace.xs,
    marginRight: -uiSpace.sm,
  },
  // The compared period's figure, the difference at the edge.
  previousRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.sm,
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
}));
