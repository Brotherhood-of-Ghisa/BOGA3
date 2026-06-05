// WeeklyHeatmap.tsx — "Weekly heatmap" (Direction B), React Native.
// One bar = one week · height = selected-metric value · color = intensity.
// 12-week average baseline · selection lifted to the overlay's WeekSelectionBanner.

import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';

import { HEAT_RAMP } from './heatmap-metric';
import type { HeatmapData } from './heatmapData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAXH = 78;

interface Props {
  data: HeatmapData;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  testIDPrefix: string;
  accent?: string;
  legendLabel?: string;
}

export function WeeklyHeatmap({
  data,
  selectedWeekKey,
  onSelectWeek,
  testIDPrefix,
  accent = uiColors.actionPrimary,
  legendLabel = 'Intensity (per week)',
}: Props) {
  const weeks = data.weekly;
  const [chartW, setChartW] = useState(0);
  const GAP = 1.7;

  const maxValue = Math.max(1, ...weeks.map((w) => w.value));
  const recent = weeks.slice(-12);
  const avg = recent.reduce((s, w) => s + w.value, 0) / Math.max(1, recent.length);
  const avgY = MAXH - (avg / maxValue) * MAXH;

  const colW = chartW > 0 ? chartW / Math.max(1, weeks.length) : 7;
  const cell = Math.max(3, colW - GAP);

  const monthMarks = weeks.map((w, i) => {
    const m = w.monday.getUTCMonth();
    const prev = i ? weeks[i - 1].monday.getUTCMonth() : -1;
    return m !== prev ? MONTHS[m] : null;
  });

  const selectedIndex = useMemo(
    () => weeks.findIndex((w) => w.weekStartDateKey === selectedWeekKey),
    [weeks, selectedWeekKey]
  );

  const heatmapTestID = `${testIDPrefix}-heatmap`;
  const onLayout = (e: LayoutChangeEvent) => setChartW(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap} testID={heatmapTestID}>
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Weekly training load</Text>
      </View>

      {/* chart */}
      <View style={{ height: MAXH, marginTop: 4 }} onLayout={onLayout}>
        {/* 12-wk average baseline */}
        <View style={[styles.baseline, { top: avgY }]} />
        <Text style={[styles.baseLabel, { top: avgY - 14 }]}>12-wk avg</Text>

        <View style={styles.bars}>
          {weeks.map((w) => {
            const h = Math.max(2, (w.value / maxValue) * MAXH);
            const on = w.weekStartDateKey === selectedWeekKey;
            return (
              <Pressable
                key={w.weekStartDateKey}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => onSelectWeek(on ? null : w.weekStartDateKey)}
                testID={`${heatmapTestID}-cell-${w.weekStartDateKey}`}
                style={{ width: colW, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <View
                  style={{
                    width: cell,
                    height: h,
                    borderRadius: 2,
                    backgroundColor: w.level ? HEAT_RAMP[w.level] : uiColors.heatmapNeutralBg,
                    borderWidth: w.isCurrentWeek || on ? 1.4 : 0,
                    borderColor: w.isCurrentWeek
                      ? accent
                      : on
                        ? uiColors.heatmapSelectedBorder
                        : 'transparent',
                    opacity: on || w.isCurrentWeek ? 1 : 0.92,
                  }}
                />
              </Pressable>
            );
          })}
        </View>

        {/* selected marker */}
        {selectedIndex >= 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -14,
              left: (selectedIndex + 0.5) * colW - 16,
              width: 32,
              alignItems: 'center',
            }}>
            <Text
              style={{
                fontSize: 9,
                fontWeight: '700',
                color:
                  weeks[selectedIndex]?.isCurrentWeek ? accent : uiColors.textSecondary,
              }}>
              ▼
            </Text>
          </View>
        ) : null}
      </View>

      {/* month axis */}
      <View style={styles.axis}>
        {monthMarks.map((m, i) => (
          <View key={i} style={{ width: colW }}>
            {m ? <Text style={styles.axisLabel}>{m}</Text> : null}
          </View>
        ))}
      </View>
      {weeks.length > 0 ? (
        <Text style={[styles.muted, { marginTop: 1 }]}>
          {MONTHS[weeks[0].monday.getUTCMonth()]} {weeks[0].monday.getUTCFullYear()}
        </Text>
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
    marginBottom: 18,
  },
  h1: { fontSize: 15, fontWeight: '600', color: uiColors.textPrimary },
  muted: { fontSize: 10, color: uiColors.textMuted },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1.5,
    borderColor: uiColors.textMuted,
    borderStyle: 'dashed',
  },
  baseLabel: {
    position: 'absolute',
    right: 0,
    fontSize: 9,
    color: uiColors.textSecondary,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 2,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%' },
  axis: {
    flexDirection: 'row',
    marginTop: 5,
    height: 16,
    borderTopWidth: 1,
    borderColor: uiColors.borderMuted,
    paddingTop: 4,
  },
  axisLabel: { fontSize: 10, color: uiColors.textMuted },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  legendRamp: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

export default WeeklyHeatmap;
