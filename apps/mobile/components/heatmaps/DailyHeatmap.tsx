// Newest-first, read-only month calendars. The host owns the single vertical
// scroller. Week values reuse the Weekly adapter results; a continuous rule
// separates Sun from Week. Rest/future values stay blank, known zero stays numeric.
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { buildCalendarMonths, type CalendarMonth, type CalendarWeek } from './daily-calendar';
import { CalendarTile } from './calendar-tile';
import { heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { HeatmapData } from './heatmapData';

const HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'];
interface Props {
  data: HeatmapData;
  testIDPrefix: string;
  metricLabel: string;
  formatValue: (value: number) => string;
  legendLabel?: string;
}

function CalendarRow({ row, monthKey, data, metricLabel, formatValue, testID, gap }: {
  row: CalendarWeek; monthKey: string;
  data: HeatmapData; metricLabel: string; formatValue: Props['formatValue']; testID: string; gap: number;
}) {
  return <View style={[styles.row, { gap }]}>
    {row.days.map((day, index) => <CalendarTile key={day.dateKey} cell={day.day} dateLabel={day.dateKey}
      mondayDate={index === 0 ? day.dayOfMonth : undefined} future={day.future} adjacent={!day.inMonth}
      current={!!day.day?.isToday}
      metricLabel={metricLabel} formatValue={formatValue} targetAveraged={data.targetGrading?.averaged}
      testID={day.inMonth && day.day ? `${testID}-cell-${day.dateKey}` : `${testID}-adjacent-${monthKey}-cell-${day.dateKey}`} />)}
    <CalendarTile weekly cell={row.week} dateLabel={`Week of ${row.weekStartDateKey}`} future={row.weekStartDateKey > data.todayDateKey}
      current={!!row.week?.isCurrentWeek}
      metricLabel={metricLabel} formatValue={formatValue} targetAveraged={data.targetGrading?.averaged}
      testID={`${testID}-week-${monthKey}-${row.weekStartDateKey}`} />
  </View>;
}

function Month({ month, ...props }: { month: CalendarMonth } & Omit<Parameters<typeof CalendarRow>[0], 'row' | 'monthKey'>) {
  return <View style={styles.month} testID={`${props.testID}-month-${month.key}`}>
    <Text allowFontScaling={false} accessibilityRole="header" style={styles.monthTitle} testID={`${props.testID}-month-title-${month.key}`}>{month.title}</Text>
    <View style={styles.calendar}>
      <View style={[styles.row, { gap: props.gap }]}>{HEADERS.map(label => <Text key={label} allowFontScaling={false} style={styles.column}>{label}</Text>)}</View>
      {month.weeks.map(row => <CalendarRow key={row.weekStartDateKey} {...props} row={row} monthKey={month.key} />)}
      <View pointerEvents="none" style={[styles.weekSeparator, { transform: [{ translateX: props.gap * 3 / 8 }] }]} testID={`${props.testID}-week-separator-${month.key}`} />
    </View>
  </View>;
}

export function DailyHeatmap({ data, testIDPrefix, metricLabel, formatValue, legendLabel = 'Volume per day' }: Props) {
  const [width, setWidth] = useState(0);
  const gap = Math.max(0, Math.min(uiSpace.xs, (width - HEADERS.length * uiGeometry.tapTarget) / (HEADERS.length - 1)));
  const months = useMemo(() => buildCalendarMonths(data), [data]);
  const testID = `${testIDPrefix}-heatmap`;
  return <View style={styles.wrap} onLayout={event => setWidth(event.nativeEvent.layout.width)} testID={testID}>
    <Text allowFontScaling={false} style={heatmapStyles.title}>Daily training load</Text>
    {months.map(month => <Month key={month.key} month={month} data={data}
      metricLabel={metricLabel} formatValue={formatValue} testID={testID} gap={gap} />)}
    <HeatmapLegend label={legendLabel} target={!!data.targetGrading} />
    {data.daily.some(day => day.unavailable) ? <Text allowFontScaling={false} style={heatmapStyles.legendText}>
      ?: unavailable
    </Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { paddingTop: uiSpace.xs, paddingBottom: uiSpace.sm, gap: uiSpace.lg },
  month: { gap: uiSpace.xs, paddingBottom: uiSpace.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: uiRoles.rule },
  monthTitle: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl, color: uiRoles.ink },
  calendar: { position: 'relative', gap: uiSpace.xs },
  weekSeparator: { position: 'absolute', top: 0, bottom: 0, right: '12.5%', width: uiBorder.width, backgroundColor: uiRoles.rule },
  row: { flexDirection: 'row', gap: uiSpace.xs },
  column: { flex: 1, minWidth: 0, textAlign: 'center', fontFamily: uiFonts.display.family,
    fontWeight: '600', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
});

export default DailyHeatmap;
