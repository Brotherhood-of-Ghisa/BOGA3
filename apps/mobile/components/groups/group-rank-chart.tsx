import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { todayText } from '@/components/today/text-styles';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { GroupRankSeries } from '@/src/groups/home-view-model';

// Until the first layout pass reports the plot's width (and in Jest, where
// none runs): roughly a 390pt phone's card minus the rank axis.
const FALLBACK_PLOT_WIDTH = 300;
const ROW_HEIGHT = 20;
const MARKER_RADIUS = 8;
const AXIS_WIDTH = 16;

const rowY = (rank: number): number => (rank - 0.5) * ROW_HEIGHT;

const columnX = (index: number, count: number, width: number): number =>
  count <= 1 ? width / 2 : MARKER_RADIUS + (index * (width - MARKER_RADIUS * 2)) / (count - 1);

export type GroupRankChartProps = {
  series: GroupRankSeries;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** A formatted week date or month name for each column. */
  columnLabels: string[];
  accessibilityLabel: string;
};

/**
 * Place over time: one line per member across the periods, rank 1 at the top,
 * each point marked with the member's initial. The selected period's column
 * sits on a `ruleSoft` band with its markers filled; tapping a column, or its
 * label, selects it. The table under the chart reads that period.
 */
export function GroupRankChart({ series, selectedIndex, onSelect, columnLabels, accessibilityLabel }: GroupRankChartProps) {
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setPlotWidth(width);
  };
  const count = series.periods.length;
  const height = series.depth * ROW_HEIGHT;
  const bandWidth = count > 0 ? plotWidth / count : plotWidth;
  const pick = (event: GestureResponderEvent) => {
    const index = Math.min(count - 1, Math.max(0, Math.floor(event.nativeEvent.locationX / bandWidth)));
    onSelect(index);
  };

  return (
    <View style={styles.chart} testID="group-rank-chart">
      <View style={styles.plotRow}>
        <View style={[styles.axis, { height }]}>
          {Array.from({ length: series.depth }, (_, index) => (
            <Text allowFontScaling={false} key={index} style={[todayText.microLabel, todayText.microLabelFaint, styles.axisLabel]}>
              {index + 1}
            </Text>
          ))}
        </View>
        <Pressable
          accessibilityHint="Selects a period"
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="adjustable"
          onLayout={onLayout}
          onPress={pick}
          style={styles.plot}
          testID="group-rank-chart-plot">
          <Svg height={height} width={plotWidth}>
            <Rect
              fill={uiRoles.ruleSoft}
              height={height}
              width={bandWidth}
              x={selectedIndex * bandWidth}
              y={0}
            />
            {series.lines.map((line) => (
              <Polyline
                fill="none"
                key={line.userId}
                points={line.ranks.map((rank, index) => `${columnX(index, count, plotWidth)},${rowY(rank)}`).join(' ')}
                stroke={line.isMe ? uiRoles.ink : uiRoles.viz2}
                strokeWidth={line.isMe ? 2 : 1.5}
              />
            ))}
            {series.lines.map((line) =>
              line.ranks.map((rank, index) => {
                const selected = index === selectedIndex;
                return (
                  <Circle
                    cx={columnX(index, count, plotWidth)}
                    cy={rowY(rank)}
                    fill={selected ? (line.isMe ? uiRoles.ink : uiRoles.viz4) : uiRoles.surface}
                    key={`${line.userId}-${index}`}
                    r={MARKER_RADIUS}
                    stroke={line.isMe ? uiRoles.ink : uiRoles.viz3}
                    strokeWidth={line.isMe ? 2 : 1}
                  />
                );
              }),
            )}
            {series.lines.map((line) =>
              line.ranks.map((rank, index) => (
                <SvgText
                  fill={index === selectedIndex ? uiRoles.surface : uiRoles.inkMuted}
                  fontFamily={uiFonts.figure.family}
                  fontSize={uiTypography.size.xxs}
                  fontWeight="600"
                  key={`${line.userId}-${index}-initial`}
                  textAnchor="middle"
                  x={columnX(index, count, plotWidth)}
                  y={rowY(rank) + 4}>
                  {line.initial}
                </SvgText>
              )),
            )}
          </Svg>
        </Pressable>
      </View>
      <View style={styles.columnLabels}>
        {columnLabels.map((label, index) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: index === selectedIndex }}
            key={label}
            onPress={() => onSelect(index)}
            style={styles.columnLabel}
            testID={`group-rank-chart-label-${index}`}>
            <Text
              allowFontScaling={false}
              style={[
                todayText.microLabel,
                index === selectedIndex ? todayText.microLabelStrong : todayText.microLabelFaint,
                styles.columnLabelText,
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    gap: uiSpace.sm,
  },
  plotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.xs,
  },
  axis: {
    width: AXIS_WIDTH,
    justifyContent: 'space-around',
  },
  axisLabel: {
    textAlign: 'right',
  },
  plot: {
    flex: 1,
    minWidth: 0,
  },
  columnLabels: {
    flexDirection: 'row',
    marginLeft: AXIS_WIDTH + uiSpace.xs,
  },
  // The label is the column's second target: a tap selects that period.
  columnLabel: {
    flex: 1,
    minWidth: 0,
    paddingVertical: uiSpace.xs,
  },
  columnLabelText: {
    textAlign: 'center',
  },
});
