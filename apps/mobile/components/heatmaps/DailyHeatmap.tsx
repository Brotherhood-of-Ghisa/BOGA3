// DailyHeatmap.tsx — "Daily heat map" (Direction A), React Native.
// One square = one day · 7 weekday rows × N week columns · today anchored at right.
// Tapping a square selects that DAY and shows its detail (date + metric value);
// the daily view is for per-day inspection, the weekly view for weekly rollups.

import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';

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
  const GUT = 16;
  const GAP = 1.4;

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
  const cell = gridW > 0 ? Math.max(3, (gridW - GUT) / colCount - GAP) : 5;
  const colW = cell + GAP;

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
        <Text style={styles.h1}>Last 12 months</Text>
        <Text style={styles.muted}>each square = one day</Text>
      </View>

      {/* month axis */}
      <View style={[styles.axis, { marginLeft: GUT }]}>
        {monthMarks.map((m, i) => (
          <View key={i} style={{ width: colW }}>
            {m ? <Text style={styles.axisLabel}>{m}</Text> : null}
          </View>
        ))}
      </View>

      {/* grid */}
      <View style={styles.grid} onLayout={onLayout}>
        <View style={{ width: GUT }}>
          {['M', '', 'W', '', 'F', '', ''].map((w, r) => (
            <Text key={r} style={[styles.wd, { height: cell, marginBottom: r < 6 ? GAP : 0 }]}>
              {w}
            </Text>
          ))}
        </View>
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
                    borderRadius: 1.5,
                    backgroundColor: HEAT_RAMP[d.level],
                    borderWidth: d.isToday || selected ? 1.4 : StyleSheet.hairlineWidth,
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

      {/* Today caption */}
      <View style={styles.todayRow}>
        <Text style={[styles.todayTxt, { color: accent }]}>▲ TODAY</Text>
      </View>

      {/* selected-day detail */}
      {selectedDay ? (
        <View style={styles.detail} testID={`${heatmapTestID}-day-detail`}>
          <View>
            <Text style={styles.kicker}>
              {selectedDay.isToday ? 'Today' : DOW[selectedDay.dow]}
            </Text>
            <Text style={styles.detailTitle} testID={`${heatmapTestID}-day-detail-date`}>
              {formatDayTitle(selectedDay.dateKey)}
            </Text>
          </View>
          <View style={styles.detailRight}>
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                backgroundColor: HEAT_RAMP[selectedDay.level],
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: uiColors.heatmapNeutralBorder,
              }}
            />
            <Text
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
        <Text style={styles.muted}>{legendLabel}</Text>
        <View style={styles.legendRamp}>
          <Text style={styles.muted}>Less</Text>
          {HEAT_RAMP.map((color, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: color,
                borderWidth: i === 0 ? StyleSheet.hairlineWidth : 0,
                borderColor: uiColors.heatmapNeutralBorder,
              }}
            />
          ))}
          <Text style={styles.muted}>More</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 8 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  h1: { fontSize: 15, fontWeight: '600', color: uiColors.textPrimary },
  muted: { fontSize: 12, color: uiColors.textMuted },
  axis: { flexDirection: 'row', height: 14 },
  axisLabel: { fontSize: 10, color: uiColors.textMuted, fontWeight: '500' },
  grid: { flexDirection: 'row' },
  wd: { fontSize: 9, color: uiColors.textMuted },
  todayRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  todayTxt: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  detail: {
    marginTop: 14,
    backgroundColor: uiColors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: 10,
    fontWeight: '600',
    color: uiColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailTitle: { fontSize: 15, fontWeight: '600', color: uiColors.textPrimary, marginTop: 2 },
  detailRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailVal: { fontSize: 14, fontWeight: '600' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  legendRamp: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

export default DailyHeatmap;
