import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
// Timeline: the selected metric week by week across the history window, oldest
// on the left, as zero-based columns. A month
// is labelled at the first week that starts in it. The window fits the width
// down to `MIN_TIMELINE_COLUMN_WIDTH` per week, then scrolls sideways, opening
// on the newest week. Exactly one week is focused — the selected one, else the
// newest — and tapping a column focuses it: its column fills `ink` on a
// `ruleSoft` band. The readout above names the focused week, between the arrows
// that step to the previous and next one (which scroll it into view);
// `children` (the week's sets) follow the chart. The page's ⋮ opens that week's
// sessions. VoiceOver reads the plot as one adjustable element stepping through
// weeks. The landscape viewport can pan and zoom horizontally. Pinches settle
// on whole weeks and the zoom buttons move one week at a time.
import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { Card, FigureText, IconButton, uiGeometry, uiSpace, uiTypography, useUiRoles } from '@/components/ui';
import { contrastRatio } from '@/components/ui/lch';
import { useUiGround } from '@/components/ui/ground';
import { groundInks, useUiGroundTone, useUiText } from '@/components/ui/text-roles';
import type { CalendarHeatmapMetric } from '@/src/data';

import type { HeatmapData } from './heatmapData';
import {
  barPath,
  buildTimelineSeries,
  timelineGeometry,
  timelineWeekIndexAt,
  weekLabel,
  weekRangeLabel,
  type TimelineWeek,
} from './timeline';
import { useTimelineZoom } from './use-timeline-zoom';

export type TimelineDetailsArea = { width: number; height: number; initialX: number; maxX: number };

interface Props {
  data: HeatmapData;
  metric: CalendarHeatmapMetric;
  /** The week the host holds; `null` focuses the newest week in the window. */
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string) => void;
  testIDPrefix: string;
  formatValue: (value: number) => string;
  metricLabel: string;
  /** The readout's unit word for a figure, e.g. `1 set`/`2 sets`, `volume`; empty for none. */
  unitLabel: (value: number) => string;
  header?: ReactNode;
  children?: ReactNode;
  display?: {
    expanded: boolean;
    action?: ReactNode;
    onInspect?: () => void;
    details?: (area: TimelineDetailsArea) => ReactNode;
  };
}

const PLOT_HEIGHT = 160;
const OVERLAY_TOP = uiGeometry.tapTarget + uiSpace.lg + uiSpace.md;
const MONTH_AXIS_HEIGHT = uiTypography.lineHeight.xxs * 2 + uiSpace.xs;
const LANDSCAPE_CHART_INSETS = uiSpace.lg * 2 + uiGeometry.tapTarget + uiSpace.md + uiSpace.xs + MONTH_AXIS_HEIGHT;
// Until the first layout pass reports the plot's width (and in Jest, where
// none runs): roughly a 390pt phone's plot beside its axis.
const FALLBACK_PLOT_WIDTH = 300;
// A tick is a micro-label: Archivo's digits advance about 0.6em, plus the
// label's tracking.
const TICK_CHAR_WIDTH = uiTypography.size.xxs * (0.6 + uiGeometry.microLabelTracking);

const isSum = (metric: CalendarHeatmapMetric) => metric === 'totalVolume' || metric === 'workingSetCount';

type Figure = { value: string; unit: string | null };

// The readout's words for rest and unavailable weeks: `0` or `No sets` by metric,
// else `Unavailable`.
const weekFigure = (week: TimelineWeek, metric: CalendarHeatmapMetric, formatValue: Props['formatValue'],
  unitLabel: Props['unitLabel']): Figure => {
  if (week.state === 'unavailable' || week.value === null) return { value: 'Unavailable', unit: null };
  if (week.state === 'rest' && !isSum(metric)) return { value: 'No sets', unit: null };
  return { value: formatValue(week.value), unit: unitLabel(week.value) };
};

// `Volume 100`, `Sets 6`, `1RM 112.5`: a unit that repeats the metric is not spoken twice.
const weekDescription = (week: TimelineWeek, figure: Figure, metricLabel: string, dateFormat: ExerciseDateFormat) => {
  const unit = figure.unit && !metricLabel.toLowerCase().startsWith(figure.unit.toLowerCase()) ? ` ${figure.unit}` : '';
  // Spoken weeks always carry their year, whichever one it is.
  const range = weekRangeLabel(week.monday, dateFormat);
  return `Week of ${range}, ${metricLabel} ${figure.value}${unit}${week.isCurrentWeek ? ', Current week' : ''}`;
};

// A title's figures are as heavy as its words (the `title` text role's weight).
const TITLE_FIGURE = { fontWeight: uiTypography.weight.bold };

// The focused week, its figure, and the two steps away from it. The label is
// read by neither arrow nor plot: the plot's adjustable value speaks for it.
function Readout({ week, figure, onStep, hasPrevious, hasNext, testID, action, zoomControls }: {
  week: TimelineWeek; figure: Figure;
  onStep: (delta: number) => void; hasPrevious: boolean; hasNext: boolean; testID: string; action?: ReactNode; zoomControls?: ReactNode;
}) {
  const dateFormat = useDateFormat();
  const text = useUiText();
  const tone = useUiGroundTone();
  return <View style={styles.readout}>
    <View style={styles.weekNav}>
      <IconButton accessibilityLabel="Previous week" disabled={!hasPrevious} name="chevron-left"
        onPress={() => onStep(-1)} testID={`${testID}-previous-week`} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.weekColumn}>
        <Text allowFontScaling={false} style={[text.title, tone.ink]}
          testID={`${testID}-readout-week`}><FigureText figureStyle={TITLE_FIGURE}>{weekLabel(week.monday, dateFormat)}</FigureText></Text>
      </View>
      <IconButton accessibilityLabel="Next week" disabled={!hasNext} name="chevron-right"
        onPress={() => onStep(1)} testID={`${testID}-next-week`} />
    </View>
    <View style={styles.readoutEnd}>
      {zoomControls}
      <Text importantForAccessibility="no" accessibilityElementsHidden allowFontScaling={false}
        style={[text.figureLarge, tone.ink]} testID={`${testID}-readout-value`}>
        {figure.value}{figure.unit ? <Text allowFontScaling={false} style={[text.label, tone.faint]}> {figure.unit}</Text> : null}
      </Text>
      {action}
    </View>
  </View>;
}

function ZoomButtons({ zoom, testID }: { zoom: ReturnType<typeof useTimelineZoom>; testID: string }) {
  return <View style={styles.zoomButtons}>
    <Card>
      <IconButton accessibilityLabel="Zoom out" name="minus" disabled={zoom.window.span >= zoom.maxSpan}
        onPress={() => zoom.zoom(1)} testID={`${testID}-zoom-out`} />
    </Card>
    <Card>
      <IconButton accessibilityLabel="Zoom in" name="plus" disabled={zoom.window.span <= 1}
        onPress={() => zoom.zoom(-1)} testID={`${testID}-zoom-in`} />
    </Card>
  </View>;
}

export function TimelineHeatmap({ data, metric, selectedWeekKey, onSelectWeek, testIDPrefix, formatValue,
  metricLabel, unitLabel, header, children, display }: Props) {
  const dateFormat = useDateFormat();
  const text = useUiText();
  const tone = useUiGroundTone();
  const testID = `${testIDPrefix}-timeline`;
  const series = useMemo(() => buildTimelineSeries(data.weekly, metric), [data.weekly, metric]);
  const expanded = display?.expanded === true;
  const viewport = useTimelineViewport(expanded);
  const { plotWidth, plotHeight, scroll, scrollX } = viewport;
  const weeks = series.weeks;
  const selectedIndex = weeks.findIndex(week => week.weekStartDateKey === selectedWeekKey);
  // One week is always focused, so the readout, the band, the `ink` column and
  // the page's ⋮ never disagree about which week is being read.
  const focusedIndex = selectedIndex >= 0 ? selectedIndex : weeks.length - 1;
  const zoom = useTimelineZoom({ expanded, width: plotWidth, count: weeks.length,
    oldestWeek: weeks[0]?.weekStartDateKey, focusedIndex });
  const visibleWindow = expanded ? zoom.window : undefined;
  const geometry = useMemo(() => timelineGeometry(series, plotWidth, plotHeight, visibleWindow),
    [series, plotWidth, plotHeight, visibleWindow]);
  const focused = weeks[focusedIndex];
  const figure = focused ? weekFigure(focused, metric, formatValue, unitLabel) : null;
  const overflows = geometry.width > plotWidth + 0.5;
  // A whole tick drops the metric's decimal: `150`, not `150.0`.
  const tickLabels = geometry.ticks.map(tick => Number.isInteger(tick.value) ? String(tick.value) : formatValue(tick.value));
  const axisWidth = Math.ceil(Math.max(uiSpace.lg, ...tickLabels.map(label => label.length * TICK_CHAR_WIDTH)) + uiSpace.xs);

  const onPress = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    // A VoiceOver double tap presses the whole plot with no location: the
    // announced week is the focused one already, so nothing moves.
    if (weeks.length === 0 || !Number.isFinite(x)) return;
    const index = expanded ? zoom.weekAt(x) : timelineWeekIndexAt(x, geometry.columnWidth, weeks.length);
    onSelectWeek(weeks[index].weekStartDateKey);
    display?.onInspect?.();
  };
  // The arrows walk the window one week at a time and bring their week into
  // view, which a tap never needs to: it landed on a visible column.
  const onStep = (delta: number) => {
    const index = focusedIndex + delta;
    const next = weeks[index];
    if (!next) return;
    onSelectWeek(next.weekStartDateKey);
    if (expanded) zoom.focus(index);
    else if (overflows) {
      scroll.current?.scrollTo({
        x: Math.max(0, index * geometry.columnWidth - (plotWidth - geometry.columnWidth) / 2), animated: true,
      });
    }
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const { actionName } = event.nativeEvent;
    if (actionName === 'showDetails') display?.onInspect?.();
    else onStep(actionName === 'increment' ? 1 : -1);
  };
  const actions: AccessibilityActionInfo[] = [{ name: 'increment' }, { name: 'decrement' }];
  if (display?.onInspect) actions.push({ name: 'showDetails', label: 'Show week details' });
  const selectedX = (focusedIndex - (visibleWindow?.start ?? 0)) * geometry.columnWidth;
  const selectedCenter = selectedX + geometry.columnWidth / 2 - (expanded ? 0 : scrollX);
  const windowWidth = plotWidth < 420 ? plotWidth : Math.min(360, Math.max(240, plotWidth / 2 - uiSpace.xs));
  const maxX = plotWidth - windowWidth;
  const detailsArea = {
    width: windowWidth, height: Math.max(uiGeometry.tapTarget, viewport.height - OVERLAY_TOP - uiSpace.sm), maxX,
    initialX: selectedCenter < plotWidth / 2 ? maxX : 0,
  };

  const visibleWeeks = Math.round(zoom.window.span);
  const plot = (
    <Pressable accessible accessibilityRole="adjustable"
      accessibilityLabel={`${metricLabel} by week, ${weeks.length} weeks`}
      accessibilityHint={expanded ? `${visibleWeeks} ${visibleWeeks === 1 ? 'week' : 'weeks'} visible` : undefined}
      accessibilityValue={focused && figure ? { text: weekDescription(focused, figure, metricLabel, dateFormat) } : undefined}
      accessibilityActions={actions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress} testID={`${testID}-plot`} style={{ width: geometry.width }}>
      <TimelinePlot geometry={geometry} focusedIndex={focusedIndex} selectedX={selectedX} testID={testID} />
      <View pointerEvents="none" style={styles.months}>
        {geometry.months.map(month => <View key={month.index} style={[styles.month, { left: month.x }]}>
          <Text allowFontScaling={false} style={[text.label, tone.faint]} testID={`${testID}-month-${month.index}`}>{month.label}</Text>
          {month.year === undefined ? null : <Text allowFontScaling={false} style={[text.label, tone.faint]}>{month.year}</Text>}
        </View>)}
      </View>
    </Pressable>
  );

  return (
    <View style={styles.scroll} onLayout={viewport.onViewportLayout}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID={testID}>
        {header}
        {focused && figure ? <Readout week={focused} figure={figure} onStep={onStep}
          hasPrevious={focusedIndex > 0} hasNext={focusedIndex < weeks.length - 1}
          action={display?.action} zoomControls={expanded ? <ZoomButtons zoom={zoom} testID={testID} /> : undefined} testID={testID} /> : null}
        <View style={styles.chartRow}>
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: axisWidth, height: plotHeight }}>
            {geometry.ticks.map((tick, index) => <Text key={tick.value} allowFontScaling={false} numberOfLines={1}
              style={[text.label, tone.faint, styles.tick, { top: tick.y - uiTypography.lineHeight.xxs / 2 }]}
              testID={`${testID}-tick-${tick.value}`}>{tickLabels[index]}</Text>)}
          </View>
          <View style={styles.plot} onLayout={viewport.onPlotLayout}>
            {expanded ? <GestureDetector gesture={zoom.gesture}>{plot}</GestureDetector> : (
              <ScrollView ref={scroll} horizontal scrollEnabled={overflows} showsHorizontalScrollIndicator={false}
                onContentSizeChange={() => viewport.keepFocusedWeekVisible(geometry, selectedIndex)}
                onScroll={event => viewport.setScrollX(event.nativeEvent.contentOffset.x)}
                scrollEventThrottle={32}
                testID={`${testID}-scroll`}>
                {plot}
              </ScrollView>
            )}
          </View>
        </View>
        {children}
      </ScrollView>
      {display?.details ? (
        <View pointerEvents="box-none" style={[styles.overlay, { left: uiSpace.lg + uiSpace.sm + axisWidth }]}>
          {display.details(detailsArea)}
        </View>
      ) : null}
    </View>
  );
}

function useTimelineViewport(expanded: boolean) {
  const scroll = useRef<ScrollViewInstance>(null);
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const [height, setHeight] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const plotHeight = expanded ? Math.max(PLOT_HEIGHT, height - LANDSCAPE_CHART_INSETS) : PLOT_HEIGHT;
  const onPlotLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0) setPlotWidth(measured);
  };
  const keepFocusedWeekVisible = (geometry: ReturnType<typeof timelineGeometry>, selectedIndex: number) => {
    const max = geometry.width - plotWidth;
    if (max <= 0.5) { setScrollX(0); return; }
    if (selectedIndex < 0) {
      scroll.current?.scrollToEnd({ animated: false });
      setScrollX(max);
      return;
    }
    const start = selectedIndex * geometry.columnWidth;
    if (start >= scrollX && start + geometry.columnWidth <= scrollX + plotWidth) return;
    const x = Math.min(max, Math.max(0, start - (plotWidth - geometry.columnWidth) / 2));
    scroll.current?.scrollTo({ x, animated: false });
    setScrollX(x);
  };
  const onViewportLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);
  return { scroll, plotWidth, plotHeight, height, scrollX, setScrollX, onPlotLayout, onViewportLayout, keepFocusedWeekVisible };
}

function TimelinePlot({ geometry, focusedIndex, selectedX, testID }: {
  geometry: ReturnType<typeof timelineGeometry>; focusedIndex: number; selectedX: number; testID: string;
}) {
  const roles = useUiRoles();
  const { width, height, columnWidth } = geometry;
  // The focused bar is drawn in the ground's ink, on a `ruleSoft` band where
  // that bar reads on it (not on Ink + paper's dark page, whose ink is light).
  const focusedFill = groundInks(roles, useUiGround()).ink;
  const band = contrastRatio(focusedFill, roles.ruleSoft) >= 3;
  return <View pointerEvents="none">
    <Svg height={height} width={width}>
      {focusedIndex >= 0 && band ? <Rect fill={roles.ruleSoft} height={height} testID={`${testID}-selected`}
        width={columnWidth} x={selectedX} y={0} /> : null}
      {geometry.ticks.map((tick, index) => <Line key={tick.value} stroke={index === 0 ? roles.rule : roles.ruleSoft}
        strokeWidth={1} x1={0} x2={width} y1={tick.y} y2={tick.y} />)}
      {geometry.bars.map(bar => <Path key={bar.weekStartDateKey} d={barPath(bar)}
        fill={bar.index === focusedIndex ? focusedFill : roles.viz4} testID={`${testID}-bar-${bar.weekStartDateKey}`} />)}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  overlay: {
    position: 'absolute', top: OVERLAY_TOP, bottom: uiSpace.sm, right: uiSpace.lg,
  },
  zoomButtons: { flexDirection: 'row', gap: uiSpace.xs, flexShrink: 0 },
  readoutEnd: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  content: { gap: uiSpace.md, padding: uiSpace.lg },
  readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: uiSpace.sm },
  // The focused week between its two steps. The arrows are flush with the
  // gutter, so the label leads the row.
  weekNav: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -uiSpace.md, flexShrink: 1 },
  weekColumn: { alignItems: 'flex-start', flexShrink: 1 },
  chartRow: { flexDirection: 'row', gap: uiSpace.sm },
  tick: { position: 'absolute', right: 0, textAlign: 'right' },
  plot: { flex: 1 },
  months: { height: MONTH_AXIS_HEIGHT, marginTop: uiSpace.xs },
  month: { position: 'absolute', top: 0 },
});

export default TimelineHeatmap;
