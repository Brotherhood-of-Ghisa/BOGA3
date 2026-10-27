import { formatCalendarDate, formatCalendarWeekHeading, formatMonthYear } from '@/src/utils/local-time';
import { useDateFormat } from '@/src/preferences/hooks';
// Newest-first weekly rows over [[comparison.history-window]]; colour retains the
// adapter's independent intensity/target meaning. Empty Monday-owned months collapse
// to one placeholder; occupied months retain rest weeks. Known training weeks
// (zeros included; rest, future and unavailable excluded) supply the scale and reference lines: Sets and
// Volume run zero to the window maximum, strength is symmetric around the median.
// Figure visibility follows [[copy.blank-history]].
// Numeric labels follow the reference values when available, otherwise the scale.
// They use measured widths, centre on their ticks within the plot,
// and yield to the centre label on overlap; all ticks and spoken values remain.
// Date captions sit above the plot row; its existing date gutter stays reserved.
import React, { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FigureText, uiGeometry, uiRoles, uiSpace, uiText, uiTextTone, uiTypography } from '@/components/ui';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

import { calculateLinearPercentile } from '@/src/session-insights/calculations';

import { HEAT_RAMP, type CalendarHeatmapMetric } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { HeatmapData, WeekCell } from './heatmapData';

const DATE_WIDTH = 96;

interface Props {
  data: HeatmapData;
  metric: CalendarHeatmapMetric;
  /** Opens a week's sessions. */
  onOpenWeek?: (weekStartDateKey: string) => void;
  testIDPrefix: string;
  formatValue: (value: number) => string;
  formatReferenceValue?: (value: number) => string;
  metricLabel?: string;
  // Inline history states share the list's scroll, never a nested ScrollView.
  header?: ReactNode;
}

type WeeklyHistoryRow = WeekCell | { monthKey: string };

type Reference = { id: string; label: string; value: number; text: string; position: number };
const REFERENCE_PERCENTILES = [['p25', '25th percentile', .25], ['median', 'median', .5], ['p75', '75th percentile', .75]] as const;

const isKnownTraining = (week: WeekCell) => !week.unavailable && (week.hasTraining ?? week.value > 0);

const weekValue = (week: WeekCell, formatValue: Props['formatValue']) =>
  isKnownTraining(week) ? formatValue(week.value) : '';

// Axis observations and bar/reference endpoints share this mapping.
function weeklyScale(values: number[], metric: CalendarHeatmapMetric) {
  const min = values[0] ?? 0;
  const max = values[values.length - 1] ?? 0;
  if (max <= 0) return { axisValues: [0], position: () => 0 };
  if (metric === 'workingSetCount' || metric === 'totalVolume') {
    return { axisValues: [0, max / 2, max], position: (value: number) => value / max * 100 };
  }
  const median = calculateLinearPercentile(values, .5);
  const radius = Math.max(median - .9 * min, max - median);
  // Never form median + radius: the upper boundary can exceed finite JS numbers.
  return { axisValues: [min, median, max],
    position: (value: number) => radius === 0 ? 50 : 50 + (value - median) / radius * 50 };
}

function WeeklyAxis({ values, position, formatValue, testID, children }: {
  values: number[]; position: (value: number) => number; formatValue: Props['formatValue']; testID: string; children: ReactNode;
}) {
  const [plotWidth, setPlotWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  // Measure every label first; prefer the middle, then lower, then upper.
  const annotations = [...new Set([values[Math.floor(values.length / 2)], ...values])].map(value => {
    const text = formatValue(value);
    const width = labelWidths[text] ?? 0;
    const coordinate = position(value) / 100 * plotWidth;
    return { value, text, width, left: Math.max(0, Math.min(plotWidth - width, coordinate - width / 2)) };
  });
  const measured = plotWidth > 0 && annotations.every(annotation => annotation.width > 0);
  const visible: typeof annotations = [];
  for (const annotation of annotations) {
    if (measured && visible.every(other => annotation.left >= other.left + other.width + uiSpace.xs
      || other.left >= annotation.left + annotation.width + uiSpace.xs)) visible.push(annotation);
  }
  return <View style={styles.axis} onLayout={event => setPlotWidth(event.nativeEvent.layout.width)} testID={`${testID}-axis`}>
    {annotations.map(annotation => <React.Fragment key={annotation.value}>
      <View accessible accessibilityRole="text" accessibilityLabel={`Axis ${annotation.text}`}
        testID={`${testID}-axis-tick-${annotation.value}`}
        style={[styles.axisReference, { left: `${position(annotation.value)}%` }]} />
      <Text allowFontScaling={false} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        testID={`${testID}-axis-value-${annotation.value}`}
        onLayout={event => {
          const width = event.nativeEvent.layout.width;
          setLabelWidths(previous => previous[annotation.text] === width ? previous : { ...previous, [annotation.text]: width });
        }}
        style={[uiText.label, uiTextTone.faint, styles.axisLabel, { maxWidth: plotWidth || undefined,
          transform: [{ translateX: annotation.left }], opacity: visible.includes(annotation) ? 1 : 0 }]}>{annotation.text}</Text>
    </React.Fragment>)}
    {children}
  </View>;
}

// Discrete vertical dashes render consistently on iOS, including at zero.
function ReferenceRule({ position, testID }: { position: number; testID?: string }) {
  return <View pointerEvents="none" style={[styles.reference, { left: `${position}%` }]} testID={testID}>
    {Array.from({ length: 5 }, (_, index) => <View key={index} style={styles.dash} />)}
  </View>;
}

function WeeklyRow({ week, onPress, formatValue, metricLabel, targetAveraged, position, references, valueWidth, testID }: {
  week: WeekCell; onPress?: () => void; formatValue: Props['formatValue']; metricLabel: string;
  targetAveraged?: boolean; position: (value: number) => number; references: Reference[]; valueWidth: number; testID: string;
}) {
  const dateFormat = useDateFormat();
  const [beforeYear, year, afterYear] = formatCalendarWeekHeading(week.weekStartDateKey, dateFormat).split(/(\d{4})/);
  const value = weekValue(week, formatValue);
  const prCount = week.prCount ?? 0;
  const description = week.unavailable ? `${metricLabel} unavailable` : !isKnownTraining(week) ? 'Rest week' : `${metricLabel} ${value}`;
  const shared = {
    accessibilityLabel: `Week of ${formatCalendarDate(week.weekStartDateKey, dateFormat)}, ${description}${prCount > 0 ? `, ${prCount} PR${prCount === 1 ? '' : 's'}` : ''}${week.isCurrentWeek ? ', Current week' : ''}${week.targetAttainment === undefined ? '' : `, ${Math.round(week.targetAttainment * 100)}% of weekly muscle target${targetAveraged ? ', averaged across muscles' : ''}`}`,
    testID: `${testID}-cell-${week.weekStartDateKey}`,
    style: styles.week,
  };
  const content = <>
    <Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, uiTextTone.ink]} testID={`${testID}-date-${week.weekStartDateKey}`}>
      <FigureText>{beforeYear}</FigureText>
      <Text allowFontScaling={false} style={uiTextTone.muted} testID={`${testID}-date-year-${week.weekStartDateKey}`}><FigureText>{year}</FigureText></Text>
      <FigureText>{afterYear}</FigureText>
    </Text>
    <View style={styles.row} testID={`${testID}-plot-row-${week.weekStartDateKey}`}>
      <View style={styles.date} testID={`${testID}-date-gutter-${week.weekStartDateKey}`} />
      <View style={styles.plot} testID={`${testID}-plot-${week.weekStartDateKey}`}>
        <View style={styles.track} testID={`${testID}-track-${week.weekStartDateKey}`}>
          <View testID={`${testID}-bar-${week.weekStartDateKey}`} style={[styles.bar,
            { width: `${isKnownTraining(week) && week.value > 0 ? position(week.value) : 0}%`,
              backgroundColor: isKnownTraining(week) && week.value > 0 ? HEAT_RAMP[week.level] : 'transparent' }]} />
        </View>
        {references.map(reference => <ReferenceRule key={reference.id} position={reference.position} testID={`${testID}-reference-${reference.id}-${week.weekStartDateKey}`} />)}
      </View>
      <Text allowFontScaling={false} style={[uiText.figure, styles.value, { width: valueWidth }]} testID={`${testID}-value-${week.weekStartDateKey}`}>{value}</Text>
      {prCount > 0 ? <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.record, styles.prs]} testID={`${testID}-prs-${week.weekStartDateKey}`}><FigureText figureStyle={uiTextTone.record}>{`${prCount} PR${prCount === 1 ? '' : 's'}`}</FigureText></Text> : null}
    </View>
  </>;
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityHint="Opens the week's sessions" onPress={onPress} {...shared}
      style={({ pressed }) => [styles.week, pressed ? heatmapStyles.pressed : null]}>{content}</Pressable>
    : <View accessible accessibilityRole="text" {...shared}>{content}</View>;
}

export function WeeklyHeatmap({ data, metric, onOpenWeek, testIDPrefix, formatValue,
  formatReferenceValue = formatValue, metricLabel = 'Value', header }: Props) {
  const windowWeeks = useMemo(() => data.weekly.filter(week => week.weekStartDateKey <= data.todayDateKey), [data.weekly, data.todayDateKey]);
  const rows = useMemo(() => {
    const months = new Map<string, WeekCell[]>();
    for (const week of [...windowWeeks].reverse()) {
      const monthKey = week.weekStartDateKey.slice(0, 7);
      const weeks = months.get(monthKey) ?? [];
      weeks.push(week);
      months.set(monthKey, weeks);
    }
    return [...months].flatMap<WeeklyHistoryRow>(([monthKey, weeks]) =>
      weeks.some(week => week.hasTraining ?? week.value > 0) ? weeks : [{ monthKey }]);
  }, [windowWeeks]);
  const trainingWeeks = windowWeeks.filter(isKnownTraining);
  const values = trainingWeeks.map(week => week.value).sort((a, b) => a - b);
  const max = values[values.length - 1] ?? 0;
  const { axisValues, position } = weeklyScale(values, metric);
  // References need MIN_HISTORY_OBSERVATIONS and a positive maximum; Sets draws only the median.
  const references: Reference[] = values.length >= MIN_HISTORY_OBSERVATIONS && max > 0
    ? REFERENCE_PERCENTILES.filter(([id]) => metric !== 'workingSetCount' || id === 'median').map(([id, label, percentile]) => {
      const value = calculateLinearPercentile(values, percentile);
      return { id, label, value, text: formatReferenceValue(value), position: position(value) };
    }) : [];
  const valueWidth = Math.min(96, Math.max(36, ...windowWeeks.map(week => weekValue(week, formatValue).length * uiTypography.size.base * 0.6)));
  const testID = `${testIDPrefix}-heatmap`;

  return <FlatList<WeeklyHistoryRow>
    testID={testID} style={styles.list} contentContainerStyle={styles.content}
    data={rows} keyExtractor={item => 'monthKey' in item ? item.monthKey : item.weekStartDateKey}
    initialNumToRender={12} windowSize={5} showsVerticalScrollIndicator={false}
    ListHeaderComponent={<View>{header}<HeatmapLegend target={!!data.targetGrading} /><>
      {/* No view title: the page's selectors say which view and metric this is. */}
      <View style={styles.axisRow}>
        <View style={styles.date} />
        <WeeklyAxis key={metric} values={references.length ? references.map(reference => reference.value) : axisValues}
          position={position} formatValue={references.length ? formatReferenceValue : formatValue} testID={testID}>
          {references.map(reference => <View key={reference.id} testID={`${testID}-${reference.id}`}
            accessible accessibilityRole="text"
            accessibilityLabel={`${windowWeeks.length}-week ${reference.label} ${reference.text}`}
            style={[styles.axisReference, { left: `${reference.position}%` }]} />)}
        </WeeklyAxis>
        <View style={{ width: valueWidth }} />
      </View>
    </></View>}
    renderItem={({ item }) => {
      if ('monthKey' in item) {
        const title = formatMonthYear(new Date(`${item.monthKey}-01T12:00:00`));
        return <View accessible accessibilityRole="text" accessibilityLabel={`${title}, No training`}
          style={styles.row} testID={`${testID}-empty-month-${item.monthKey}`}>
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink]}><FigureText>{title}</FigureText></Text>
          <View style={styles.monthRule} />
        </View>;
      }
      return <WeeklyRow week={item}
        onPress={onOpenWeek && item.hasTraining ? () => onOpenWeek(item.weekStartDateKey) : undefined}
        formatValue={formatValue} metricLabel={metricLabel} targetAveraged={data.targetGrading?.averaged}
        position={position} references={references} valueWidth={valueWidth} testID={testID} />;
    }}
  />;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: uiSpace.lg },
  week: { minHeight: uiGeometry.tapTarget },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: uiGeometry.tapTarget, gap: uiSpace.sm, paddingVertical: uiSpace.sm },
  date: { width: DATE_WIDTH },
  monthRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: uiRoles.rule },
  plot: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  track: { height: uiSpace.lg, backgroundColor: uiRoles.ruleSoft, borderRadius: uiGeometry.radius.control },
  bar: { height: '100%', borderRadius: uiGeometry.radius.control },
  value: { textAlign: 'right' },
  // Keep the existing metric/bar axis when adding record counts.
  prs: { position: 'absolute', top: '50%', marginTop: uiSpace.sm + uiTypography.lineHeight.base / 2, right: 0,
    textAlign: 'right' },
  reference: { position: 'absolute', top: -uiSpace.sm, bottom: -uiSpace.sm, width: 1, justifyContent: 'space-around' },
  dash: { width: 1, flex: 1, maxHeight: 5, marginBottom: uiSpace.xs, backgroundColor: uiRoles.inkMuted },
  axisReference: { position: 'absolute', bottom: 0, height: uiSpace.sm, width: 1, backgroundColor: uiRoles.inkMuted },
  axisRow: { flexDirection: 'row', gap: uiSpace.sm, marginTop: uiSpace.xs },
  axis: { flex: 1, height: uiTypography.lineHeight.xxs + uiSpace.sm },
  axisLabel: { position: 'absolute', left: 0 },
});

export default WeeklyHeatmap;
