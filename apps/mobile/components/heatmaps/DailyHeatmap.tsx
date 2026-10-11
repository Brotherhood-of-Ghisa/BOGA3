// The virtualized month list owns scrolling. Calendar layout follows
// Figure visibility follows [[copy.blank-history]].
import React, { useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { buildCalendarMonths, type CalendarMonth, type CalendarWeek } from './daily-calendar';
import { CalendarTile } from './calendar-tile';
import { heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { DayCell, HeatmapData } from './heatmapData';

const ROW_LABEL_WIDTH = uiSpace.xl;
const ROW_LABEL_GUTTER = ROW_LABEL_WIDTH + uiSpace.xs;
const HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'];
interface Props {
  data: HeatmapData;
  testIDPrefix: string;
  metricLabel: string;
  formatValue: (value: number) => string;
  legendLabel?: string;
  header?: ReactNode;
  /** Opens a day's sessions. */
  onOpenDay?: (day: DayCell) => void;
  /** Opens a Week tile's sessions. */
  onOpenWeek?: (weekStartDateKey: string) => void;
}

type Openers = Pick<Props, 'onOpenDay' | 'onOpenWeek'>;

const dayHint = (day: DayCell) => day.sessionIds.length === 1 ? 'Opens the session' : "Opens the day's sessions";
// A day opens by its sessions.
const dayOpener = (day: DayCell, onOpenDay: Props['onOpenDay']) =>
  onOpenDay && day.sessionIds.length > 0 ? () => onOpenDay(day) : undefined;

function CalendarRow({ row, monthKey, data, metricLabel, formatValue, testID, gap, onOpenDay, onOpenWeek }: {
  row: CalendarWeek; monthKey: string;
  data: HeatmapData; metricLabel: string; formatValue: Props['formatValue']; testID: string; gap: number;
} & Openers) {
  const week = row.week;
  return <View style={styles.row} testID={`${testID}-row-${row.weekStartDateKey}`}>
    <Text allowFontScaling={false} accessibilityLabel={`Week of ${row.weekStartDateKey}`} style={styles.rowLabel}
      testID={`${testID}-row-label-${row.weekStartDateKey}`}>{row.startDay}</Text>
    <View style={[styles.cells, { gap }]}>
      {row.days.map(day => day.day && !day.future ? <CalendarTile key={day.dateKey} cell={day.day} dateLabel={day.dateKey}
        future={day.future}
        current={!!day.day?.isToday}
        metricLabel={metricLabel} formatValue={formatValue} targetAveraged={data.targetGrading?.averaged}
        onPress={dayOpener(day.day, onOpenDay)}
        accessibilityHint={dayHint(day.day)}
        testID={`${testID}-cell-${day.dateKey}`} />
        : <View key={day.dateKey} style={styles.blankTile} testID={`${testID}-empty-${monthKey}-${day.dateKey}`} />)}
      {week ? <CalendarTile weekly cell={week} dateLabel={`Week of ${row.weekStartDateKey}`} future={row.weekStartDateKey > data.todayDateKey}
        current={!!week.isCurrentWeek}
        metricLabel={metricLabel} formatValue={formatValue} targetAveraged={data.targetGrading?.averaged}
        onPress={onOpenWeek && week.hasTraining ? () => onOpenWeek(row.weekStartDateKey) : undefined}
        accessibilityHint="Opens the week's sessions"
        testID={`${testID}-week-${monthKey}-${row.weekStartDateKey}`} />
        : <View style={[styles.blankTile, heatmapStyles.weekColumn]} testID={`${testID}-empty-week-${monthKey}-${row.weekStartDateKey}`} />}
    </View>
  </View>;
}

function Month({ month, ...props }: { month: CalendarMonth } & Omit<Parameters<typeof CalendarRow>[0], 'row' | 'monthKey'>) {
  return <View style={styles.month} testID={`${props.testID}-month-${month.key}`}>
    <Text allowFontScaling={false} accessibilityRole="header" style={styles.monthTitle} testID={`${props.testID}-month-title-${month.key}`}>{month.title}</Text>
    <View style={styles.calendar}>
      <View style={styles.row}>
        <View style={styles.labelSpacer} />
        <View style={[styles.cells, { gap: props.gap }]}>{HEADERS.map(label => <Text key={label} allowFontScaling={false} style={[styles.column, label === 'Week' && heatmapStyles.weekColumn]}>{label}</Text>)}</View>
      </View>
      {month.weeks.map(row => <CalendarRow key={row.weekStartDateKey} {...props} row={row} monthKey={month.key} />)}
      {/* Eight equal columns, with an extra Week margin: place the rule at
          the midpoint of the wider gap, accounting for its own width. */}
      <View pointerEvents="none" style={styles.gridOverlay}>
        <View style={[styles.weekSeparator, { transform: [{ translateX: (props.gap - uiSpace.sm) * 3 / 8 + uiBorder.width / 2 }] }]} testID={`${props.testID}-week-separator-${month.key}`} />
      </View>
    </View>
  </View>;
}

export function DailyHeatmap({ data, testIDPrefix, metricLabel, formatValue, legendLabel = 'Volume per day', header, onOpenDay, onOpenWeek }: Props) {
  const [width, setWidth] = useState(0);
  const gap = Math.max(0, Math.min(uiSpace.xs, (width - uiSpace.sm * 3 - ROW_LABEL_GUTTER - HEADERS.length * uiGeometry.tapTarget) / (HEADERS.length - 1)));
  const months = useMemo(() => buildCalendarMonths(data), [data]);
  const testID = `${testIDPrefix}-heatmap`;
  // No view title: the page's selectors say which view and metric this is.
  return <View style={styles.wrap} onLayout={event => setWidth(event.nativeEvent.layout.width)} testID={testID}>
    <FlatList
      data={months}
      keyExtractor={month => month.key}
      renderItem={({ item }) => <Month month={item} data={data}
        metricLabel={metricLabel} formatValue={formatValue} testID={testID} gap={gap} onOpenDay={onOpenDay} onOpenWeek={onOpenWeek} />}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID={`${testIDPrefix}-scroll`}
      ListHeaderComponent={<View style={styles.header}>{header}</View>}
      ListFooterComponent={<HeatmapLegend label={legendLabel} target={!!data.targetGrading} />}
    />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingVertical: uiSpace.lg, paddingHorizontal: uiSpace.sm, gap: uiSpace.lg },
  header: { gap: uiSpace.lg, paddingTop: uiSpace.xs },
  month: { gap: uiSpace.xs, paddingBottom: uiSpace.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: uiRoles.rule },
  monthTitle: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
  calendar: { position: 'relative', gap: uiSpace.xs },
  weekSeparator: { position: 'absolute', top: 0, bottom: 0, right: '12.5%', width: uiBorder.width, backgroundColor: uiRoles.rule },
  row: { flexDirection: 'row', gap: uiSpace.xs, alignItems: 'center' },
  cells: { flex: 1, minWidth: 0, flexDirection: 'row' },
  labelSpacer: { width: ROW_LABEL_WIDTH },
  rowLabel: { width: ROW_LABEL_WIDTH, textAlign: 'right', fontFamily: uiFonts.figure.family, fontWeight: '400',
    fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
  gridOverlay: { position: 'absolute', left: ROW_LABEL_GUTTER, right: 0, top: 0, bottom: 0 },
  blankTile: { flex: 1, minWidth: 0, minHeight: uiGeometry.tapTarget },
  column: { flex: 1, minWidth: 0, textAlign: 'center', fontFamily: uiFonts.display.family,
    fontWeight: '600', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
});

export default DailyHeatmap;
