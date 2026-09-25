// DailyHeatmap.tsx — "Daily heat map" (Direction A), React Native.
// One square = one day · 7 weekday rows × N week columns · today anchored at right.
// Tapping a square selects that DAY and shows its detail (date + metric value);
// the daily view is for per-day inspection, the weekly view for weekly rollups.

import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';

import { HEAT_RAMP } from './heatmap-metric';
import type { DayCell, HeatmapData } from './heatmapData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type WeekColumn = { weekStartDateKey: string; monthIndex: number; days: (DayCell | null)[] };

interface Props {
  data: HeatmapData;
  testIDPrefix: string;
  /** Label for the selected metric (e.g. "Volume"), shown in the day detail. */
  metricLabel: string;
  /** Formats a single day's metric value for the detail card. */
  formatValue: (value: number) => string;
  accent?: string;
  legendLabel?: string;
}

const formatDayTitle = (dateKey: string): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

export function DailyHeatmap({
  data,
  testIDPrefix,
  metricLabel,
  formatValue,
  accent = uiColors.actionPrimary,
  legendLabel = 'Volume per day',
}: Props) {
  const [gridW, setGridW] = useState(0);
  const [pickedDateKey, setPickedDateKey] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const GUT = 20;
  const GAP = 3;
  // Tile size is keyed to a ~3-month viewport: ~13 week columns fill the visible width,
  // and older history is reachable by scrolling horizontally.
  const WEEKS_VISIBLE = 13;
  const MIN_CELL = 14;
  const AXIS_H = 18;

  // Default selection = today; falls back to the most recent day with data.
  const selectedDateKey = pickedDateKey ?? data.todayDateKey;
  const selectedDay = useMemo(
    () => data.daily.find((d) => d.dateKey === selectedDateKey) ?? null,
    [data.daily, selectedDateKey]
  );

  // chunk daily → week columns of 7 rows (Mon..Sun)
  const cols = useMemo<WeekColumn[]>(() => {
    const out: WeekColumn[] = [];
    let cur: WeekColumn | null = null;
    for (const d of data.daily) {
      if (!cur || cur.weekStartDateKey !== d.weekStartDateKey) {
        cur = {
          weekStartDateKey: d.weekStartDateKey,
          monthIndex: Number(d.weekStartDateKey.split('-')[1]) - 1,
          days: Array(7).fill(null),
        };
        out.push(cur);
      }
      cur.days[d.dow] = d;
    }
    return out;
  }, [data.daily]);

  const colCount = cols.length || 52;
  const cell = gridW > 0 ? Math.max(MIN_CELL, (gridW - GUT) / WEEKS_VISIBLE - GAP) : MIN_CELL;
  const colW = cell + GAP;
  const rowH = cell + GAP;

  // month axis: label the first column of each new month
  const monthMarks = cols.map((c, i) => {
    const prev = i ? cols[i - 1].monthIndex : -1;
    return c.monthIndex !== prev ? MONTHS[c.monthIndex] : null;
  });

  const heatmapTestID = `${testIDPrefix}-heatmap`;
  const onLayout = (e: LayoutChangeEvent) => setGridW(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap} testID={heatmapTestID}>
      <View style={styles.headerRow}>
        <Text allowFontScaling={false} style={styles.h1}>Last 12 months</Text>
        <Text allowFontScaling={false} style={styles.muted}>each square = one day</Text>
      </View>

      {/* fixed weekday column + horizontally scrollable (month axis + grid) */}
      <View style={styles.body} onLayout={onLayout}>
        <View style={{ width: GUT }}>
          {/* spacer aligns the weekday labels with the grid rows (below the month axis) */}
          <View style={{ height: AXIS_H }} />
          {['M', '', 'W', '', 'F', '', ''].map((w, r) => (
            <Text allowFontScaling={false} key={r} style={[styles.wd, { height: rowH, lineHeight: rowH }]}>
              {w}
            </Text>
          ))}
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          style={styles.scroll}
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          <View style={{ width: colCount * colW }}>
            {/* month axis — labels overflow their column so they aren't clipped */}
            <View style={[styles.axis, { width: colCount * colW }]}>
              {monthMarks.map((m, i) =>
                m ? (
                  <Text
                    allowFontScaling={false}
                    key={i}
                    numberOfLines={1}
                    style={[styles.axisLabel, { left: i * colW }]}>
                    {m}
                  </Text>
                ) : null
              )}
            </View>

            {/* grid */}
            <View style={styles.grid}>
              {cols.map((c) => (
                <View key={c.weekStartDateKey} style={{ width: colW }}>
                  {c.days.map((d, r) => {
                    if (!d) {
                      return (
                        <View
                          key={r}
                          style={{ width: cell, height: cell, marginBottom: r < 6 ? GAP : 0 }}
                        />
                      );
                    }
                    const selected = d.dateKey === selectedDateKey;
                    return (
                      <Pressable
                        key={r}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setPickedDateKey(d.dateKey)}
                        testID={`${heatmapTestID}-cell-${d.dateKey}`}
                        style={{
                          width: cell,
                          height: cell,
                          marginBottom: r < 6 ? GAP : 0,
                          borderRadius: uiRadius.sm,
                          backgroundColor: HEAT_RAMP[d.level],
                          borderWidth: d.isToday || selected ? 1.6 : StyleSheet.hairlineWidth,
                          borderColor: d.isToday
                            ? accent
                            : selected
                              ? uiColors.heatmapSelectedBorder
                              : d.level === 0
                                ? uiColors.heatmapNeutralBorder
                                : 'transparent',
                        }}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* selected-day detail */}
      {selectedDay ? (
        <View style={styles.detail} testID={`${heatmapTestID}-day-detail`}>
          <View>
            <Text allowFontScaling={false} style={styles.kicker}>
              {selectedDay.isToday ? 'Today' : DOW[selectedDay.dow]}
            </Text>
            <Text allowFontScaling={false} style={styles.detailTitle} testID={`${heatmapTestID}-day-detail-date`}>
              {formatDayTitle(selectedDay.dateKey)}
            </Text>
          </View>
          <View style={styles.detailRight}>
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: uiRadius.sm,
                backgroundColor: HEAT_RAMP[selectedDay.level],
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: uiColors.heatmapNeutralBorder,
              }}
            />
            <Text
              allowFontScaling={false}
              style={[
                styles.detailVal,
                { color: selectedDay.level ? uiColors.textPrimary : uiColors.textMuted },
              ]}
              testID={`${heatmapTestID}-day-detail-value`}>
              {selectedDay.level
                ? `${metricLabel}: ${formatValue(selectedDay.value)}`
                : 'Rest day'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* legend */}
      <View style={styles.legend}>
        <Text allowFontScaling={false} style={styles.muted}>{legendLabel}</Text>
        <View style={styles.legendRamp}>
          <Text allowFontScaling={false} style={styles.muted}>Less</Text>
          {HEAT_RAMP.map((color, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: uiRadius.sm,
                backgroundColor: color,
                borderWidth: i === 0 ? StyleSheet.hairlineWidth : 0,
                borderColor: uiColors.heatmapNeutralBorder,
              }}
            />
          ))}
          <Text allowFontScaling={false} style={styles.muted}>More</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: uiSpace.xs, paddingBottom: uiSpace.sm },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: uiSpace.lg,
  },
  h1: { fontSize: uiTypography.size.base, fontWeight: '600', color: uiColors.textPrimary },
  muted: { fontSize: uiTypography.size.sm, color: uiColors.textMuted },
  body: { flexDirection: 'row' },
  scroll: { flex: 1 },
  axis: { height: 18, position: 'relative' },
  axisLabel: {
    position: 'absolute',
    top: 0,
    width: 32,
    fontSize: uiTypography.size.xs,
    lineHeight: 14,
    color: uiColors.textMuted,
    fontWeight: '500',
  },
  grid: { flexDirection: 'row' },
  wd: { fontSize: uiTypography.size.xs, color: uiColors.textMuted, textAlign: 'center' },
  detail: {
    marginTop: uiSpace.lg,
    backgroundColor: uiColors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: uiTypography.size.xs,
    fontWeight: '600',
    color: uiColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailTitle: { fontSize: uiTypography.size.base, fontWeight: '600', color: uiColors.textPrimary, marginTop: uiSpace.xs },
  detailRight: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  detailVal: { fontSize: uiTypography.size.base, fontWeight: '600' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: uiSpace.lg,
  },
  legendRamp: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
});

export default DailyHeatmap;
