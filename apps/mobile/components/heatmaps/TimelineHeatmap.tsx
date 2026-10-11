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
// weeks.
import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { IconButton, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { CalendarHeatmapMetric } from '@/src/data';

import { heatmapStyles } from './heatmap-style';
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

interface Props {
  data: HeatmapData;
  metric: CalendarHeatmapMetric;
  /** The week the host holds; `null` focuses the newest week in the window. */
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string) => void;
  testIDPrefix: string;
  formatValue: (value: number) => string;
  metricLabel: string;
  /** The readout's unit word for a figure, e.g. `kg`, `1 set`/`2 sets`, `volume`. */
  unitLabel: (value: number) => string;
  header?: ReactNode;
  children?: ReactNode;
}

const PLOT_HEIGHT = 160;
// Until the first layout pass reports the plot's width (and in Jest, where
// none runs): roughly a 390pt phone's plot beside its axis.
const FALLBACK_PLOT_WIDTH = 300;
// Plex Mono advances 0.6em per character.
const TICK_CHAR_WIDTH = uiTypography.size.xxs * 0.6;

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

// `Volume 100`, `Sets 6`, `1RM 112.5 kg`: a unit that repeats the metric is not spoken twice.
const weekDescription = (week: TimelineWeek, figure: Figure, metricLabel: string) => {
  const unit = figure.unit && !metricLabel.toLowerCase().startsWith(figure.unit.toLowerCase()) ? ` ${figure.unit}` : '';
  // Spoken weeks always carry their year, whichever one it is.
  const range = `${weekRangeLabel(week.monday)} ${week.monday.getUTCFullYear()}`;
  return `Week of ${range}, ${metricLabel} ${figure.value}${unit}${week.isCurrentWeek ? ', Current week' : ''}`;
};

// The focused week, its figure, and the two steps away from it. The label is
// read by neither arrow nor plot: the plot's adjustable value speaks for it.
function Readout({ week, figure, currentYear, onStep, hasPrevious, hasNext, testID }: {
  week: TimelineWeek; figure: Figure; currentYear: number;
  onStep: (delta: number) => void; hasPrevious: boolean; hasNext: boolean; testID: string;
}) {
  return <View style={styles.readout}>
    <View style={styles.weekNav}>
      <IconButton accessibilityLabel="Previous week" disabled={!hasPrevious} name="chevron-left"
        onPress={() => onStep(-1)} testID={`${testID}-previous-week`} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.weekColumn}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.readoutWeek}
          testID={`${testID}-readout-week`}>{weekLabel(week.monday, currentYear)}</Text>
        {week.isCurrentWeek ? <Text allowFontScaling={false} style={styles.note}>Current week</Text> : null}
      </View>
      <IconButton accessibilityLabel="Next week" disabled={!hasNext} name="chevron-right"
        onPress={() => onStep(1)} testID={`${testID}-next-week`} />
    </View>
    <Text importantForAccessibility="no" accessibilityElementsHidden allowFontScaling={false}
      style={styles.readoutValue} testID={`${testID}-readout-value`}>
      {figure.value}{figure.unit ? <Text allowFontScaling={false} style={heatmapStyles.legendText}> {figure.unit}</Text> : null}
    </Text>
  </View>;
}

export function TimelineHeatmap({ data, metric, selectedWeekKey, onSelectWeek, testIDPrefix, formatValue,
  metricLabel, unitLabel, header, children }: Props) {
  const testID = `${testIDPrefix}-timeline`;
  const series = useMemo(() => buildTimelineSeries(data.weekly, metric), [data.weekly, metric]);
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const scroll = useRef<ScrollViewInstance>(null);
  const geometry = useMemo(() => timelineGeometry(series, plotWidth, PLOT_HEIGHT), [series, plotWidth]);
  const weeks = series.weeks;
  const selectedIndex = weeks.findIndex(week => week.weekStartDateKey === selectedWeekKey);
  // One week is always focused, so the readout, the band, the `ink` column and
  // the page's ⋮ never disagree about which week is being read.
  const focusedIndex = selectedIndex >= 0 ? selectedIndex : weeks.length - 1;
  const focused = weeks[focusedIndex];
  const figure = focused ? weekFigure(focused, metric, formatValue, unitLabel) : null;
  const overflows = geometry.width > plotWidth + 0.5;
  // A whole tick drops the metric's decimal: `150`, not `150.0`.
  const tickLabels = geometry.ticks.map(tick => Number.isInteger(tick.value) ? String(tick.value) : formatValue(tick.value));
  const axisWidth = Math.ceil(Math.max(uiSpace.lg, ...tickLabels.map(label => label.length * TICK_CHAR_WIDTH)) + uiSpace.xs);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== plotWidth) setPlotWidth(measured);
  };
  const onPress = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    // A VoiceOver double tap presses the whole plot with no location: the
    // announced week is the focused one already, so nothing moves.
    if (weeks.length === 0 || !Number.isFinite(x)) return;
    onSelectWeek(weeks[timelineWeekIndexAt(x, geometry.columnWidth, weeks.length)].weekStartDateKey);
  };
  // The arrows walk the window one week at a time and bring their week into
  // view, which a tap never needs to: it landed on a visible column.
  const onStep = (delta: number) => {
    const index = focusedIndex + delta;
    const next = weeks[index];
    if (!next) return;
    onSelectWeek(next.weekStartDateKey);
    if (overflows) {
      scroll.current?.scrollTo({
        x: Math.max(0, index * geometry.columnWidth - (plotWidth - geometry.columnWidth) / 2), animated: true,
      });
    }
  };
  // Swipes step through weeks.
  const onAccessibilityAction = (event: AccessibilityActionEvent) =>
    onStep(event.nativeEvent.actionName === 'increment' ? 1 : -1);

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID={testID}>
    {header}
    {focused && figure ? <Readout week={focused} figure={figure} onStep={onStep}
      hasPrevious={focusedIndex > 0} hasNext={focusedIndex < weeks.length - 1}
      currentYear={Number(data.todayDateKey.slice(0, 4))} testID={testID} /> : null}
    <View style={styles.chartRow}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.axis, { width: axisWidth }]}>
        {geometry.ticks.map((tick, index) => <Text key={tick.value} allowFontScaling={false} numberOfLines={1}
          style={[styles.tick, { top: tick.y - uiTypography.lineHeight.xxs / 2 }]}
          testID={`${testID}-tick-${tick.value}`}>{tickLabels[index]}</Text>)}
      </View>
      <View style={styles.plot} onLayout={onLayout}>
        <ScrollView ref={scroll} horizontal scrollEnabled={overflows} showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => { if (overflows) scroll.current?.scrollToEnd({ animated: false }); }}
          testID={`${testID}-scroll`}>
          <Pressable accessible accessibilityRole="adjustable"
            accessibilityLabel={`${metricLabel} by week, ${weeks.length} weeks`}
            accessibilityValue={focused && figure ? { text: weekDescription(focused, figure, metricLabel) } : undefined}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onAccessibilityAction}
            onPress={onPress} testID={`${testID}-plot`} style={{ width: geometry.width }}>
            <TimelinePlot geometry={geometry} focusedIndex={focusedIndex} testID={testID} />
            <View pointerEvents="none" style={styles.months}>
              {geometry.months.map(month => <View key={month.index} style={[styles.month, { left: month.x }]}>
                <Text allowFontScaling={false} style={heatmapStyles.legendText} testID={`${testID}-month-${month.index}`}>{month.label}</Text>
                {month.year === undefined ? null : <Text allowFontScaling={false} style={heatmapStyles.legendText}>{month.year}</Text>}
              </View>)}
            </View>
          </Pressable>
        </ScrollView>
      </View>
    </View>
    {children}
  </ScrollView>;
}

function TimelinePlot({ geometry, focusedIndex, testID }: {
  geometry: ReturnType<typeof timelineGeometry>; focusedIndex: number; testID: string;
}) {
  const { width, height, columnWidth } = geometry;
  return <View pointerEvents="none">
    <Svg height={height} width={width}>
      {focusedIndex >= 0 ? <Rect fill={uiRoles.ruleSoft} height={height} testID={`${testID}-selected`}
        width={columnWidth} x={focusedIndex * columnWidth} y={0} /> : null}
      {geometry.ticks.map((tick, index) => <Line key={tick.value} stroke={index === 0 ? uiRoles.rule : uiRoles.ruleSoft}
        strokeWidth={1} x1={0} x2={width} y1={tick.y} y2={tick.y} />)}
      {geometry.bars.map(bar => <Path key={bar.weekStartDateKey} d={barPath(bar)}
        fill={bar.index === focusedIndex ? uiRoles.ink : uiRoles.viz4} testID={`${testID}-bar-${bar.weekStartDateKey}`} />)}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: uiSpace.md, padding: uiSpace.lg },
  readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: uiSpace.sm },
  // The focused week between its two steps. The arrows are flush with the
  // gutter, so the label leads the row.
  weekNav: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -uiSpace.md, flexShrink: 1 },
  weekColumn: { alignItems: 'flex-start', flexShrink: 1 },
  readoutWeek: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg, color: uiRoles.ink },
  note: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.xs, lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
  readoutValue: { fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.xl, lineHeight: uiTypography.lineHeight.xl, color: uiRoles.ink },
  chartRow: { flexDirection: 'row', gap: uiSpace.sm },
  axis: { height: PLOT_HEIGHT },
  tick: { position: 'absolute', right: 0, textAlign: 'right', fontFamily: uiFonts.figure.family, fontWeight: '500',
    fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkFaint },
  plot: { flex: 1 },
  months: { height: uiTypography.lineHeight.xxs * 2 + uiSpace.xs, marginTop: uiSpace.xs },
  month: { position: 'absolute', top: 0 },
});

export default TimelineHeatmap;
