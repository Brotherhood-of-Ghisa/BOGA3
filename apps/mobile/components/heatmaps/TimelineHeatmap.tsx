// Timeline: the selected metric week by week across the history window, oldest
// on the left. Volume and Sets draw zero-based columns; 1RM and Top weight draw
// a line that breaks on rest weeks ([[comparison.timeline-history]]). A month is
// labelled at the first week that starts in it. The window fits the width down
// to `MIN_TIMELINE_COLUMN_WIDTH` per week, then scrolls sideways, opening on the
// newest week. Tapping a week selects it, a second tap clears it, as a Weekly
// row does; the readout above shows the selected week, else the newest.
// VoiceOver reads the plot as one adjustable element stepping through weeks.
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
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
  testIDPrefix: string;
  formatValue: (value: number) => string;
  metricLabel: string;
  /** The y axis unit, e.g. `kg`. */
  unitLabel: string;
  header?: ReactNode;
}

const PLOT_HEIGHT = 160;
// Until the first layout pass reports the plot's width (and in Jest, where
// none runs): roughly a 390pt phone's plot beside its axis.
const FALLBACK_PLOT_WIDTH = 300;
// Plex Mono advances 0.6em per character.
const TICK_CHAR_WIDTH = uiTypography.size.xxs * 0.6;
const DOT_RADIUS = 4;

const readoutValue = (week: TimelineWeek, formatValue: Props['formatValue']) =>
  week.state === 'training' && week.value !== null ? formatValue(week.value) : '';

const weekDescription = (week: TimelineWeek, metricLabel: string, formatValue: Props['formatValue']) => {
  const figure = week.state === 'unavailable' ? `${metricLabel} unavailable`
    : week.state === 'rest' ? 'Rest week' : `${metricLabel} ${readoutValue(week, formatValue)}`;
  return `Week of ${weekRangeLabel(week.monday)} ${week.monday.getUTCFullYear()}, ${figure}${week.isCurrentWeek ? ', Current week' : ''}`;
};

function Readout({ week, formatValue, unitLabel, currentYear, testID }: {
  week: TimelineWeek; formatValue: Props['formatValue']; unitLabel: string; currentYear: number; testID: string;
}) {
  const year = week.monday.getUTCFullYear();
  const value = readoutValue(week, formatValue);
  return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.readout}>
    <View>
      <Text allowFontScaling={false} style={styles.readoutWeek} testID={`${testID}-readout-week`}>
        {weekRangeLabel(week.monday)}{year === currentYear ? '' : ` ${year}`}
      </Text>
      {week.isCurrentWeek ? <Text allowFontScaling={false} style={styles.note}>Current week</Text> : null}
    </View>
    <Text allowFontScaling={false} style={styles.readoutValue} testID={`${testID}-readout-value`}>
      {value}{value ? <Text allowFontScaling={false} style={heatmapStyles.legendText}> {unitLabel}</Text> : null}
    </Text>
  </View>;
}

export function TimelineHeatmap({ data, metric, selectedWeekKey, onSelectWeek, testIDPrefix, formatValue, metricLabel, unitLabel, header }: Props) {
  const testID = `${testIDPrefix}-timeline`;
  const series = useMemo(() => buildTimelineSeries(data.weekly, metric), [data.weekly, metric]);
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const scroll = useRef<ScrollViewInstance>(null);
  const geometry = useMemo(() => timelineGeometry(series, plotWidth, PLOT_HEIGHT), [series, plotWidth]);
  const weeks = series.weeks;
  const selectedIndex = weeks.findIndex(week => week.weekStartDateKey === selectedWeekKey);
  const shownIndex = selectedIndex >= 0 ? selectedIndex : weeks.length - 1;
  const shown = weeks[shownIndex];
  const overflows = geometry.width > plotWidth + 0.5;
  const tickLabels = geometry.ticks.map(tick => formatValue(tick.value));
  const axisWidth = Math.ceil(Math.max(uiSpace.lg, ...tickLabels.map(label => label.length * TICK_CHAR_WIDTH)) + uiSpace.xs);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== plotWidth) setPlotWidth(measured);
  };
  const toggle = (index: number) => {
    const key = weeks[index].weekStartDateKey;
    onSelectWeek(key === selectedWeekKey ? null : key);
  };
  const onPress = (event: GestureResponderEvent) => {
    if (weeks.length > 0) toggle(timelineWeekIndexAt(event.nativeEvent.locationX, geometry.columnWidth, weeks.length));
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const next = weeks[shownIndex + step];
    if (next) onSelectWeek(next.weekStartDateKey);
  };

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID={testID}>
    {header}
    {shown ? <Readout week={shown} formatValue={formatValue} unitLabel={unitLabel}
      currentYear={Number(data.todayDateKey.slice(0, 4))} testID={testID} /> : null}
    <Text allowFontScaling={false} style={heatmapStyles.legendText} testID={`${testID}-unit`}>{unitLabel}</Text>
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
            accessibilityValue={shown ? { text: weekDescription(shown, metricLabel, formatValue) } : undefined}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
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
  </ScrollView>;
}

function TimelinePlot({ geometry, selectedIndex, testID }: {
  geometry: ReturnType<typeof timelineGeometry>; selectedIndex: number; testID: string;
}) {
  const { width, height, columnWidth } = geometry;
  const selectedPoint = geometry.points[selectedIndex];
  return <View pointerEvents="none">
    <Svg height={height} width={width}>
      {selectedIndex >= 0 ? <Rect fill={uiRoles.ruleSoft} height={height} testID={`${testID}-selected`}
        width={columnWidth} x={selectedIndex * columnWidth} y={0} /> : null}
      {geometry.ticks.map((tick, index) => <Line key={tick.value} stroke={index === 0 ? uiRoles.rule : uiRoles.ruleSoft}
        strokeWidth={1} x1={0} x2={width} y1={tick.y} y2={tick.y} />)}
      {geometry.bars.map(bar => <Path key={bar.weekStartDateKey} d={barPath(bar)} fill={uiRoles.viz4}
        testID={`${testID}-bar-${bar.weekStartDateKey}`} />)}
      {geometry.segments.map((run, index) => <Polyline key={index} fill="none" points={run.map(point => `${point.x},${point.y}`).join(' ')}
        stroke={uiRoles.viz4} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} testID={`${testID}-line-${index}`} />)}
      {geometry.isolated.map(point => <Circle key={point.x} cx={point.x} cy={point.y} fill={uiRoles.viz4} r={DOT_RADIUS}
        stroke={uiRoles.surface} strokeWidth={2} testID={`${testID}-dot`} />)}
      {selectedPoint ? <Circle cx={selectedPoint.x} cy={selectedPoint.y} fill={uiRoles.ink} r={DOT_RADIUS + 0.5}
        stroke={uiRoles.surface} strokeWidth={2} testID={`${testID}-selected-dot`} /> : null}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: uiSpace.sm, padding: uiSpace.lg },
  readout: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: uiSpace.sm, marginBottom: uiSpace.sm },
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
