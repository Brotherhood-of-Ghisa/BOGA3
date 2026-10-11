import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { HEAT_RAMP } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';
import type { DayCell, WeekCell } from './heatmapData';

type Props = {
  cell?: DayCell | WeekCell;
  dateLabel: string;
  future: boolean;
  weekly?: boolean;
  current: boolean;
  metricLabel: string;
  formatValue: (value: number) => string;
  targetAveraged?: boolean;
  testID: string;
  /** Opens what the tile counts; a tile without it reads as text. */
  onPress?: () => void;
  accessibilityHint?: string;
};

export function calendarValue(cell: DayCell | WeekCell | undefined, future: boolean, formatValue: Props['formatValue']): string {
  if (future || !cell || cell.unavailable) return '';
  return (cell.hasTraining ?? cell.value > 0) ? formatValue(cell.value) : '';
}

function description({ cell, future, metricLabel, formatValue }: Props) {
  if (future) return 'Future, no observed value';
  if (!cell) return 'Outside history window';
  if (cell.unavailable) return `${metricLabel} unavailable`;
  return (cell.hasTraining ?? cell.value > 0) ? `${metricLabel} ${formatValue(cell.value)}` : 'Rest';
}

export function CalendarTile(props: Props) {
  const { cell, dateLabel, future, weekly, current, formatValue, targetAveraged, testID, onPress, accessibilityHint } = props;
  const value = calendarValue(cell, future, formatValue);
  const target = cell?.targetAttainment;
  const prCount = cell?.prCount ?? 0;
  const content = <>
    <Text allowFontScaling={false} style={styles.value} numberOfLines={1} testID={`${testID}-value`}>{value}</Text>
    {!weekly && !future && prCount > 0 ? <Svg accessible={false} accessibilityElementsHidden pointerEvents="none"
      width={uiSpace.sm} height={uiSpace.sm} viewBox="0 0 8 8" style={styles.pr} testID={`${testID}-pr`}>
      <Path d="M0 0H8V8Z" fill={uiRoles.record} />
    </Svg> : null}
  </>;
  const shared = {
    accessibilityLabel: `${dateLabel}, ${description(props)}${prCount > 0 ? `, ${prCount} PR${prCount === 1 ? '' : 's'}` : ''}${current ? weekly ? ', Current week' : ', Today' : ''}${target === undefined ? '' : `, ${Math.round(target * 100)}% of weekly muscle target${targetAveraged ? ', averaged across muscles' : ''}`}`,
    testID,
    style: [styles.tile, weekly && heatmapStyles.weekColumn, { backgroundColor: HEAT_RAMP[cell?.level ?? 0] },
      cell?.unavailable ? styles.unavailable : null],
  };
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress} {...shared}
      style={({ pressed }) => [shared.style, pressed ? heatmapStyles.pressed : null]}>{content}</Pressable>
    : <View accessible accessibilityRole="text" {...shared}>{content}</View>;
}

const styles = StyleSheet.create({
  pr: { position: 'absolute', top: uiSpace.xs, right: uiSpace.xs },
  tile: { flex: 1, minWidth: 0, minHeight: uiGeometry.tapTarget,
    borderRadius: uiGeometry.radius.control, borderWidth: StyleSheet.hairlineWidth,
    ...heatmapStyles.restCell, justifyContent: 'center' },
  unavailable: { borderStyle: 'dashed', borderWidth: uiBorder.width, borderColor: uiRoles.rule },
  value: { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs, color: uiRoles.ink, textAlign: 'center' },
});
