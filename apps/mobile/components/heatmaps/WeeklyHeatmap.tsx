// Newest-first weekly rows. Length uses a shared zero origin; colour retains
// the adapter's independent intensity/target meaning. Reference calculations
// follow [[comparison.weekly-reference]]; figure visibility follows [[copy.blank-history]].
import React, { useMemo, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

import { calculateLinearPercentile } from '@/src/session-insights/calculations';

import { HEAT_RAMP } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { HeatmapData, WeekCell } from './heatmapData';
import { weekRangeLabel } from './timeline';

const DATE_WIDTH = 96;

interface Props {
  data: HeatmapData;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  testIDPrefix: string;
  formatValue: (value: number) => string;
  formatReferenceValue?: (value: number) => string;
  metricLabel?: string;
  legendLabel?: string;
  // Inline history states share the list's scroll, never a nested ScrollView.
  header?: ReactNode;
}

type Reference = { id: string; label: string; value: string; position: number };
const REFERENCE_PERCENTILES = [['p25', '25th percentile', .25], ['median', 'median', .5], ['p75', '75th percentile', .75]] as const;

const isKnownTraining = (week: WeekCell) => !week.unavailable && (week.hasTraining ?? week.value > 0);

const weekValue = (week: WeekCell, formatValue: Props['formatValue']) =>
  isKnownTraining(week) ? formatValue(week.value) : '';

// Discrete vertical dashes render consistently on iOS, including at zero.
function ReferenceRule({ position, testID }: { position: number; testID?: string }) {
  return <View pointerEvents="none" style={[styles.reference, { left: `${position}%` }]} testID={testID}>
    {Array.from({ length: 5 }, (_, index) => <View key={index} style={styles.dash} />)}
  </View>;
}

function WeeklyRow({ week, selected, onPress, formatValue, metricLabel, targetAveraged, max, references, valueWidth, currentYear, testID }: {
  week: WeekCell; selected: boolean; onPress: () => void; formatValue: Props['formatValue']; metricLabel: string;
  targetAveraged?: boolean; max: number; references: Reference[]; valueWidth: number; currentYear: number; testID: string;
}) {
  const year = week.monday.getUTCFullYear();
  const endYear = new Date(week.monday.getTime() + 6 * 86400000).getUTCFullYear();
  const value = weekValue(week, formatValue);
  const description = week.unavailable ? `${metricLabel} unavailable` : !isKnownTraining(week) ? 'Rest week' : `${metricLabel} ${value}`;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={`Week of ${week.weekStartDateKey}, ${description}${week.isCurrentWeek ? ', Current week' : ''}${week.targetAttainment === undefined ? '' : `, ${Math.round(week.targetAttainment * 100)}% of weekly muscle target${targetAveraged ? ', averaged across muscles' : ''}`}`}
    onPress={onPress} testID={`${testID}-cell-${week.weekStartDateKey}`} style={styles.row}>
    <View style={styles.date}>
      {selected ? <View style={styles.marker} testID={`${testID}-selected-marker`}><Icon color={uiRoles.ink} name="caret-down" size="xs" /></View> : null}
      <Text allowFontScaling={false} style={styles.dateText}>{weekRangeLabel(week.monday)}</Text>
      {week.isCurrentWeek ? <Text allowFontScaling={false} style={styles.note}>Current week</Text> : null}
      {year !== currentYear || year !== endYear ? <Text allowFontScaling={false} style={styles.year}>{year === endYear ? year : `${year}–${endYear}`}</Text> : null}
    </View>
    <View style={styles.plot}>
      <View style={styles.track}>
        <View testID={`${testID}-bar-${week.weekStartDateKey}`} style={[styles.bar,
          { width: `${max > 0 && !week.unavailable ? week.value / max * 100 : 0}%`,
            backgroundColor: isKnownTraining(week) && week.value > 0 ? HEAT_RAMP[week.level] : 'transparent' }]} />
      </View>
      {references.map(reference => <ReferenceRule key={reference.id} position={reference.position} testID={`${testID}-reference-${reference.id}-${week.weekStartDateKey}`} />)}
    </View>
    <Text allowFontScaling={false} style={[styles.value, { width: valueWidth }]} testID={`${testID}-value-${week.weekStartDateKey}`}>{value}</Text>
  </Pressable>;
}

export function WeeklyHeatmap({ data, selectedWeekKey, onSelectWeek, testIDPrefix, formatValue,
  formatReferenceValue = formatValue, metricLabel = 'Value', legendLabel = 'Intensity (per week)', header }: Props) {
  // The adapter is chronological; reverse only the displayed copy.
  const weeks = useMemo(() => [...data.weekly].reverse(), [data.weekly]);
  const max = data.weekly.reduce((largest, week) => week.unavailable ? largest : Math.max(largest, week.value), 0);
  const trainingWeeks = data.weekly.filter(week => week.weekStartDateKey <= data.todayDateKey && isKnownTraining(week));
  const values = trainingWeeks.map(week => week.value).sort((a, b) => a - b);
  // Reference eligibility follows [[comparison.weekly-reference]].
  const references: Reference[] = values.length >= MIN_HISTORY_OBSERVATIONS && max > 0
    ? REFERENCE_PERCENTILES.filter(([id]) => metricLabel !== 'Sets' || id === 'median').map(([id, label, percentile]) => {
      const value = calculateLinearPercentile(values, percentile);
      return { id, label, value: formatReferenceValue(value), position: value / max * 100 };
    }) : [];
  const valueWidth = Math.min(96, Math.max(36, ...weeks.map(week => weekValue(week, formatValue).length * uiTypography.size.base * 0.6)));
  const testID = `${testIDPrefix}-heatmap`;

  return <FlatList
    testID={testID} style={styles.list} contentContainerStyle={styles.content}
    data={weeks} keyExtractor={week => week.weekStartDateKey}
    initialNumToRender={12} windowSize={5} showsVerticalScrollIndicator={false}
    extraData={selectedWeekKey}
    ListHeaderComponent={<View>{header}<>
      <Text allowFontScaling={false} style={[heatmapStyles.title, styles.title]}>Weekly training load</Text>
      <View style={styles.axisRow}>
        <View style={styles.date} />
        <View style={styles.axis} testID={`${testID}-axis`}>
          {(max > 0 ? [0, 0.5, 1] : [0]).map(fraction => <Text key={fraction} allowFontScaling={false} style={[styles.axisLabel, { textAlign: fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center' }]}>{formatValue(max * fraction)}</Text>)}
          {references.map(reference => <View key={reference.id} testID={`${testID}-${reference.id}`}
            accessible accessibilityRole="text"
            accessibilityLabel={`${data.weekly.length}-week ${reference.label} ${reference.value}`}
            style={[styles.axisReference, { left: `${reference.position}%` }]} />)}
        </View>
        <View style={{ width: valueWidth }} />
      </View>
    </></View>}
    renderItem={({ item }) => <WeeklyRow week={item} selected={item.weekStartDateKey === selectedWeekKey}
      onPress={() => onSelectWeek(item.weekStartDateKey === selectedWeekKey ? null : item.weekStartDateKey)}
      formatValue={formatValue} metricLabel={metricLabel} targetAveraged={data.targetGrading?.averaged}
      max={max} references={references} valueWidth={valueWidth} currentYear={Number(data.todayDateKey.slice(0, 4))} testID={testID} />}
    ListFooterComponent={<View style={styles.footer}>
      <HeatmapLegend label={legendLabel} target={!!data.targetGrading} />
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
  value: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink, textAlign: 'right' },
  reference: { position: 'absolute', top: -uiSpace.sm, bottom: -uiSpace.sm, width: 1, justifyContent: 'space-around' },
  dash: { width: 1, flex: 1, maxHeight: 5, marginBottom: uiSpace.xs, backgroundColor: uiRoles.inkMuted },
  axisReference: { position: 'absolute', bottom: 0, height: uiSpace.sm, width: 1, backgroundColor: uiRoles.inkMuted },
  axisRow: { flexDirection: 'row', gap: uiSpace.sm, marginTop: uiSpace.sm },
  axis: { flex: 1, flexDirection: 'row', paddingBottom: uiSpace.sm },
  axisLabel: { ...heatmapStyles.legendText, flex: 1, flexShrink: 1 },
  footer: { gap: uiSpace.xs, paddingTop: uiSpace.lg },
});

export default WeeklyHeatmap;
