// Newest-first weekly rows. Length uses a shared zero origin; colour retains
// the adapter's independent intensity/target meaning. The sheet owns this list.
import React, { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

import { HEAT_RAMP } from './heatmap-metric';
import { HEAT_MARK, heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { HeatmapData, WeekCell } from './heatmapData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_WIDTH = 96;

interface Props {
  data: HeatmapData;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  testIDPrefix: string;
  formatValue: (value: number) => string;
  formatAverageValue?: (value: number) => string;
  metricLabel?: string;
  legendLabel?: string;
  // Inline history states share the list's scroll, never a nested ScrollView.
  header?: ReactNode;
}

const isKnownTraining = (week: WeekCell) => !week.unavailable && (week.hasTraining ?? week.value > 0);

const weekLabel = (week: WeekCell): string => {
  const start = week.monday;
  const end = new Date(start.getTime() + 6 * 86400000);
  const first = `${start.getUTCDate()}${start.getUTCMonth() === end.getUTCMonth() ? '' : ` ${MONTHS[start.getUTCMonth()]}`}`;
  return `${first} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
};

const weekValue = (week: WeekCell, formatValue: Props['formatValue']) => {
  if (week.unavailable) return '?';
  return isKnownTraining(week) ? formatValue(week.value) : 'Rest';
};

const barBorder = (week: WeekCell, selected: boolean) => {
  if (selected) return { borderWidth: HEAT_MARK.selectedWidth, borderColor: HEAT_MARK.color };
  if (week.isCurrentWeek) return { borderWidth: HEAT_MARK.todayWidth, borderColor: HEAT_MARK.color };
  return null;
};

// Discrete vertical dashes render consistently on iOS, including at zero.
function AverageRule({ position, testID }: { position: number; testID?: string }) {
  return <View pointerEvents="none" style={[styles.average, { left: `${position}%` }]} testID={testID}>
    {Array.from({ length: 5 }, (_, index) => <View key={index} style={styles.dash} />)}
  </View>;
}

function WeeklyRow({ week, selected, onPress, formatValue, metricLabel, targetAveraged, max, averagePosition, valueWidth, currentYear, testID }: {
  week: WeekCell; selected: boolean; onPress: () => void; formatValue: Props['formatValue']; metricLabel: string;
  targetAveraged?: boolean; max: number; averagePosition: number | null; valueWidth: number; currentYear: number; testID: string;
}) {
  const year = week.monday.getUTCFullYear();
  const endYear = new Date(week.monday.getTime() + 6 * 86400000).getUTCFullYear();
  const value = weekValue(week, formatValue);
  const description = week.unavailable ? `${metricLabel} unavailable` : value === 'Rest' ? 'Rest week' : `${metricLabel} ${value}`;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={`Week of ${week.weekStartDateKey}, ${description}${week.isCurrentWeek ? ', Current week' : ''}${week.targetAttainment === undefined ? '' : `, ${Math.round(week.targetAttainment * 100)}% of weekly muscle target${targetAveraged ? ', averaged across muscles' : ''}`}`}
    onPress={onPress} testID={`${testID}-cell-${week.weekStartDateKey}`} style={styles.row}>
    <View style={styles.date}>
      {selected ? <View style={styles.marker} testID={`${testID}-selected-marker`}><Icon color={HEAT_MARK.color} name="caret-down" size="xs" /></View> : null}
      <Text allowFontScaling={false} style={styles.dateText}>{weekLabel(week)}</Text>
      {week.isCurrentWeek ? <Text allowFontScaling={false} style={styles.note}>Current week</Text> : null}
      {year !== currentYear || year !== endYear ? <Text allowFontScaling={false} style={styles.year}>{year === endYear ? year : `${year}–${endYear}`}</Text> : null}
    </View>
    <View style={styles.plot}>
      <View style={styles.track}>
        {/* A missing value has no filled length. Zero/rest still get an outline
            when current or selected, so both marks remain visible. */}
        <View testID={`${testID}-bar-${week.weekStartDateKey}`} style={[styles.bar,
          { width: `${max > 0 && !week.unavailable ? week.value / max * 100 : 0}%`,
            backgroundColor: isKnownTraining(week) && week.value > 0 ? HEAT_RAMP[week.level] : 'transparent' },
          barBorder(week, selected),
          (week.unavailable || week.value === 0) && (selected || week.isCurrentWeek) ? styles.emptyMark : null]} />
      </View>
      {averagePosition !== null ? <AverageRule position={averagePosition} /> : null}
    </View>
    <Text allowFontScaling={false} style={[styles.value, { width: valueWidth }]} testID={`${testID}-value-${week.weekStartDateKey}`}>{value}</Text>
  </Pressable>;
}

export function WeeklyHeatmap({ data, selectedWeekKey, onSelectWeek, testIDPrefix, formatValue,
  formatAverageValue = formatValue, metricLabel = 'Value', legendLabel = 'Intensity (per week)', header }: Props) {
  // Never reverse the adapter array: its tail owns the recent-12 average.
  const weeks = useMemo(() => [...data.weekly].reverse(), [data.weekly]);
  const max = data.weekly.reduce((largest, week) => week.unavailable ? largest : Math.max(largest, week.value), 0);
  const recent = data.weekly.slice(-12).filter(isKnownTraining);
  const average = recent.reduce((mean, week, index) => mean + (week.value - mean) / (index + 1), 0);
  // Six genuine zero observations are valid, but an all-zero scale cannot
  // carry a meaningful reference. Never substitute an artificial full bar.
  const showAverage = recent.length >= 6 && max > 0;
  const averagePosition = showAverage ? average / max * 100 : null;
  const averageLabel = formatAverageValue(average);
  const valueWidth = Math.min(96, Math.max(36, ...weeks.map(week => weekValue(week, formatValue).length * uiTypography.size.base * 0.6)));
  const testID = `${testIDPrefix}-heatmap`;
  const [plotWidth, setPlotWidth] = useState(0);
  const labelWidth = (`Avg ${averageLabel}`).length * uiTypography.size.sm * 0.6;
  const labelLeft = Math.max(0, Math.min(plotWidth - labelWidth, (averagePosition ?? 0) / 100 * plotWidth - labelWidth / 2));

  return <FlatList
    testID={testID} style={styles.list} contentContainerStyle={styles.content}
    data={weeks} keyExtractor={week => week.weekStartDateKey}
    initialNumToRender={12} windowSize={5} showsVerticalScrollIndicator={false}
    extraData={selectedWeekKey}
    ListHeaderComponent={<View>{header}<>
      <Text allowFontScaling={false} style={[heatmapStyles.title, styles.title]}>Weekly training load</Text>
      <Text allowFontScaling={false} style={styles.note}>{metricLabel}{metricLabel === 'Volume' ? ' (kg·reps)' : metricLabel === '1RM' || metricLabel === 'Top weight' ? ' (kg)' : ''} per week</Text>
      {showAverage ? <View style={styles.averageRow}>
        <View style={styles.date} />
        <View style={styles.axisPlot} onLayout={event => setPlotWidth(event.nativeEvent.layout.width)}>
          <Text allowFontScaling={false} style={[styles.averageLabel, { marginLeft: labelLeft }]} accessibilityLabel={`12-week average ${averageLabel}`} testID={`${testID}-average-label`}>Avg {averageLabel}</Text>
        </View>
        <View style={{ width: valueWidth }} />
      </View> : null}
      <View style={styles.axisRow}>
        <View style={styles.date} />
        <View style={styles.axis} testID={`${testID}-axis`}>
          {(max > 0 ? [0, 0.5, 1] : [0]).map(fraction => <Text key={fraction} allowFontScaling={false} style={[styles.axisLabel, { textAlign: fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center' }]}>{formatValue(max * fraction)}</Text>)}
          {averagePosition !== null ? <View testID={`${testID}-average`} style={[styles.axisAverage, { left: `${averagePosition}%` }]} /> : null}
        </View>
        <View style={{ width: valueWidth }} />
      </View>
    </></View>}
    renderItem={({ item }) => <WeeklyRow week={item} selected={item.weekStartDateKey === selectedWeekKey}
      onPress={() => onSelectWeek(item.weekStartDateKey === selectedWeekKey ? null : item.weekStartDateKey)}
      formatValue={formatValue} metricLabel={metricLabel} targetAveraged={data.targetGrading?.averaged}
      max={max} averagePosition={averagePosition} valueWidth={valueWidth} currentYear={Number(data.todayDateKey.slice(0, 4))} testID={testID} />}
    ListFooterComponent={<View style={styles.footer}>
      <HeatmapLegend label={legendLabel} target={!!data.targetGrading} />
      {weeks.some(week => week.unavailable) ? <Text allowFontScaling={false} style={styles.note}>?: unavailable; excluded from the average</Text> : null}
    </View>}
  />;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: uiSpace.lg },
  title: { marginTop: uiSpace.xs, marginBottom: uiSpace.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: uiGeometry.tapTarget, gap: uiSpace.sm, paddingVertical: uiSpace.sm },
  date: { width: DATE_WIDTH },
  dateText: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.ink },
  note: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.xs, lineHeight: uiTypography.lineHeight.xs, color: uiRoles.inkMuted },
  year: { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
  marker: { position: 'absolute', left: -uiSpace.lg, top: uiSpace.xs, transform: [{ rotate: '-90deg' }] },
  plot: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  track: { height: uiSpace.lg, backgroundColor: uiRoles.ruleSoft, borderRadius: uiGeometry.radius.control },
  bar: { height: '100%', borderRadius: uiGeometry.radius.control },
  emptyMark: { width: '100%' },
  value: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink, textAlign: 'right' },
  average: { position: 'absolute', top: -uiSpace.sm, bottom: -uiSpace.sm, width: 1, justifyContent: 'space-around' },
  dash: { width: 1, flex: 1, maxHeight: 5, marginBottom: uiSpace.xs, backgroundColor: uiRoles.inkMuted },
  averageLabel: heatmapStyles.caption,
  averageRow: { flexDirection: 'row', gap: uiSpace.sm, marginTop: uiSpace.md },
  axisPlot: { flex: 1 },
  axisAverage: { position: 'absolute', bottom: 0, height: uiSpace.sm, width: 1, backgroundColor: uiRoles.inkMuted },
  axisRow: { flexDirection: 'row', gap: uiSpace.sm, marginTop: uiSpace.sm },
  axis: { flex: 1, flexDirection: 'row', paddingBottom: uiSpace.sm },
  axisLabel: { ...heatmapStyles.legendText, flex: 1, flexShrink: 1 },
  footer: { gap: uiSpace.xs, paddingTop: uiSpace.lg },
});

export default WeeklyHeatmap;
