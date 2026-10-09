// Timeline: the selected metric week by week across the history window, oldest
// on the left, as zero-based columns ([[comparison.timeline-history]]). A month
// is labelled at the first week that starts in it. The window fits the width
// down to `MIN_TIMELINE_COLUMN_WIDTH` per week, then scrolls sideways, opening
// on the newest week. Tapping a week selects it, a second tap clears it, as a
// Weekly row does: its column fills `ink` on a `ruleSoft` band. The readout
// above shows the selected week, else the newest, with `View sessions` for a
// week with training; `children` (the week's sets) follow the chart. VoiceOver reads
// the plot as one adjustable element stepping through weeks.
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

import { ActionButton, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { CalendarHeatmapMetric } from '@/src/data';

import { heatmapStyles } from './heatmap-style';
import type { HeatmapData } from './heatmapData';
import {
  barPath,
  buildTimelineSeries,
  timelineGeometry,
  timelineWeekIndexAt,
  weekRangeLabel,
  type TimelineWeek,
} from './timeline';

interface Props {
  data: HeatmapData;
  metric: CalendarHeatmapMetric;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  /** Opens the sessions of a trained week; without it the readout has no button. */
  onViewSessions?: (weekStartDateKey: string) => void;
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

// The readout's words for rest and unavailable weeks follow [[comparison.timeline-history]].
const weekFigure = (week: TimelineWeek, metric: CalendarHeatmapMetric, formatValue: Props['formatValue'],
  unitLabel: Props['unitLabel']): Figure => {
  if (week.state === 'unavailable' || week.value === null) return { value: 'Unavailable', unit: null };
  if (week.state === 'rest' && !isSum(metric)) return { value: 'No sets', unit: null };
  return { value: formatValue(week.value), unit: unitLabel(week.value) };
};

// `Volume 100`, `Sets 6`, `1RM 112.5 kg`: a unit that repeats the metric is not spoken twice.
const weekDescription = (week: TimelineWeek, figure: Figure, metricLabel: string) => {
  const unit = figure.unit && !metricLabel.toLowerCase().startsWith(figure.unit.toLowerCase()) ? ` ${figure.unit}` : '';
  return `Week of ${weekRangeLabel(week.monday)} ${week.monday.getUTCFullYear()}, ${metricLabel} ${figure.value}${unit}${week.isCurrentWeek ? ', Current week' : ''}`;
};

function Readout({ week, figure, currentYear, onViewSessions, testID }: {
  week: TimelineWeek; figure: Figure; currentYear: number;
  onViewSessions?: Props['onViewSessions']; testID: string;
}) {
  const year = week.monday.getUTCFullYear();
  const label = `${weekRangeLabel(week.monday)}${year === currentYear ? '' : ` ${year}`}`;
  return <View style={styles.readout}>
    <View style={styles.readoutWeekColumn}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text allowFontScaling={false} style={styles.readoutWeek} testID={`${testID}-readout-week`}>{label}</Text>
        {week.isCurrentWeek ? <Text allowFontScaling={false} style={styles.note}>Current week</Text> : null}
      </View>
      {onViewSessions && week.state !== 'rest' ? <ActionButton size="compact" variant="outline" label="View sessions"
        accessibilityLabel={`View sessions, week of ${label}`} onPress={() => onViewSessions(week.weekStartDateKey)}
        testID={`${testID}-view-sessions`} /> : null}
    </View>
    <Text importantForAccessibility="no" accessibilityElementsHidden allowFontScaling={false}
      style={styles.readoutValue} testID={`${testID}-readout-value`}>
      {figure.value}{figure.unit ? <Text allowFontScaling={false} style={heatmapStyles.legendText}> {figure.unit}</Text> : null}
    </Text>
  </View>;
}

export function TimelineHeatmap({ data, metric, selectedWeekKey, onSelectWeek, onViewSessions, testIDPrefix, formatValue,
  metricLabel, unitLabel, header, children }: Props) {
  const testID = `${testIDPrefix}-timeline`;
  const series = useMemo(() => buildTimelineSeries(data.weekly, metric), [data.weekly, metric]);
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const scroll = useRef<ScrollViewInstance>(null);
  const geometry = useMemo(() => timelineGeometry(series, plotWidth, PLOT_HEIGHT), [series, plotWidth]);
  const weeks = series.weeks;
  const selectedIndex = weeks.findIndex(week => week.weekStartDateKey === selectedWeekKey);
  const shownIndex = selectedIndex >= 0 ? selectedIndex : weeks.length - 1;
  const shown = weeks[shownIndex];
  const figure = shown ? weekFigure(shown, metric, formatValue, unitLabel) : null;
  const overflows = geometry.width > plotWidth + 0.5;
  // A whole tick drops the metric's decimal: `150`, not `150.0`.
  const tickLabels = geometry.ticks.map(tick => Number.isInteger(tick.value) ? String(tick.value) : formatValue(tick.value));
  const axisWidth = Math.ceil(Math.max(uiSpace.lg, ...tickLabels.map(label => label.length * TICK_CHAR_WIDTH)) + uiSpace.xs);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== plotWidth) setPlotWidth(measured);
  };
  const onPress = (event: GestureResponderEvent) => {
    if (weeks.length === 0) return;
    const key = weeks[timelineWeekIndexAt(event.nativeEvent.locationX, geometry.columnWidth, weeks.length)].weekStartDateKey;
    onSelectWeek(key === selectedWeekKey ? null : key);
  };
  // Swipes step through weeks; a double tap toggles the announced week, never
  // the one under the element's centre.
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'activate') {
      if (shown) onSelectWeek(shown.weekStartDateKey === selectedWeekKey ? null : shown.weekStartDateKey);
      return;
    }
    const next = weeks[shownIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1)];
    if (next) onSelectWeek(next.weekStartDateKey);
  };

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID={testID}>
    {header}
    {shown && figure ? <Readout week={shown} figure={figure} onViewSessions={onViewSessions}
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
            accessibilityValue={shown && figure ? { text: weekDescription(shown, figure, metricLabel) } : undefined}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
            onAccessibilityAction={onAccessibilityAction}
            onPress={onPress} testID={`${testID}-plot`} style={{ width: geometry.width }}>
            <TimelinePlot geometry={geometry} selectedIndex={selectedIndex} testID={testID} />
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

function TimelinePlot({ geometry, selectedIndex, testID }: {
  geometry: ReturnType<typeof timelineGeometry>; selectedIndex: number; testID: string;
}) {
  const { width, height, columnWidth } = geometry;
  return <View pointerEvents="none">
    <Svg height={height} width={width}>
      {selectedIndex >= 0 ? <Rect fill={uiRoles.ruleSoft} height={height} testID={`${testID}-selected`}
        width={columnWidth} x={selectedIndex * columnWidth} y={0} /> : null}
      {geometry.ticks.map((tick, index) => <Line key={tick.value} stroke={index === 0 ? uiRoles.rule : uiRoles.ruleSoft}
        strokeWidth={1} x1={0} x2={width} y1={tick.y} y2={tick.y} />)}
      {geometry.bars.map(bar => <Path key={bar.weekStartDateKey} d={barPath(bar)}
        fill={bar.index === selectedIndex ? uiRoles.ink : uiRoles.viz4} testID={`${testID}-bar-${bar.weekStartDateKey}`} />)}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: uiSpace.md, padding: uiSpace.lg },
  readout: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: uiSpace.sm },
  readoutWeekColumn: { alignItems: 'flex-start', gap: uiSpace.sm },
  readoutWeek: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.ink },
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
