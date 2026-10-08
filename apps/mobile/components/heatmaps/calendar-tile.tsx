import { StyleSheet, Text, View } from 'react-native';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui';
import { HEAT_RAMP } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';
import type { DayCell, WeekCell } from './heatmapData';

type Props = {
  cell?: DayCell | WeekCell;
  dateLabel: string;
  mondayDate?: number;
  future: boolean;
  adjacent?: boolean;
  weekly?: boolean;
  current: boolean;
  metricLabel: string;
  formatValue: (value: number) => string;
  targetAveraged?: boolean;
  testID: string;
};

export function calendarValue(cell: DayCell | WeekCell | undefined, future: boolean, formatValue: Props['formatValue']): string {
  if (future) return '';
  if (!cell) return '';
  if (cell.unavailable) return '?';
  return (cell.hasTraining ?? cell.value > 0) ? formatValue(cell.value) : '';
}

function description({ cell, future, metricLabel, formatValue }: Props) {
  if (future) return 'Future, no observed value';
  if (!cell) return 'Outside history window';
  if (cell.unavailable) return `${metricLabel} unavailable`;
  return (cell.hasTraining ?? cell.value > 0) ? `${metricLabel} ${formatValue(cell.value)}` : 'Rest';
}

export function CalendarTile(props: Props) {
  const { cell, dateLabel, mondayDate, future, adjacent, weekly, current, formatValue, targetAveraged, testID } = props;
  const value = calendarValue(cell, future, formatValue);
  const target = cell?.targetAttainment;
  return <View accessible accessibilityRole="text"
    accessibilityLabel={`${dateLabel}, ${description(props)}${current ? weekly ? ', Current week' : ', Today' : ''}${target === undefined ? '' : `, ${Math.round(target * 100)}% of weekly muscle target${targetAveraged ? ', averaged across muscles' : ''}`}`}
    testID={testID}
    style={[styles.tile, { backgroundColor: HEAT_RAMP[cell?.level ?? 0] },
      cell?.unavailable ? styles.unavailable : null]}>
    {mondayDate === undefined ? null : <Text allowFontScaling={false} style={[styles.date, adjacent ? styles.adjacentFigure : null]} testID={`${testID}-date`}>{mondayDate}</Text>}
    <Text allowFontScaling={false} style={[styles.value, adjacent ? styles.adjacentFigure : null]} numberOfLines={1} testID={`${testID}-value`}>
      {value}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, minHeight: uiGeometry.tapTarget,
    borderRadius: uiGeometry.radius.control, borderWidth: StyleSheet.hairlineWidth,
    ...heatmapStyles.restCell, justifyContent: 'center' },
  adjacentFigure: { fontWeight: '500' },
  unavailable: { borderStyle: 'dashed', borderWidth: uiBorder.width, borderColor: uiRoles.inkMuted },
  date: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.ink, paddingLeft: uiBorder.width },
  value: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.ink, textAlign: 'center' },
});
