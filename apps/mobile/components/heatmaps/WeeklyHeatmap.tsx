// WeeklyHeatmap.tsx — "Weekly heatmap" (Direction B), React Native.
// One bar = one week · height = selected-metric value · color = intensity.
// 12-week average baseline · selection lifted to the overlay's WeekSelectionBanner.

import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
  const scrollRef = useRef<ScrollView>(null);
  const GAP = 4;
  // Bar width is keyed to a ~3-month viewport (~13 week columns fill the visible width),
  // matching the daily view; older history is reachable by scrolling horizontally.
  const WEEKS_VISIBLE = 13;
  const MIN_CELL = 14;

  const maxValue = Math.max(1, ...weeks.map((w) => w.value));
  // Bar heights + the average baseline are normalized across the *observed* activity
  // band [min, max], matching the color scale. Without this, high-floor metrics (1RM,
  // top weight) pin every bar to the top and the avg line lands off-screen above them.
  const activeValues = weeks.map((w) => w.value).filter((v) => v > 0);
  const minValue = activeValues.length ? Math.min(...activeValues) : 0;
  const span = maxValue - minValue;
  const BAR_FLOOR = MAXH * 0.12; // keep the smallest logged bar (and the avg line) visible
  const barHeight = (v: number): number => {
    if (v <= 0) return 2;
    const t = span > 0 ? (v - minValue) / span : 1;
    return BAR_FLOOR + t * (MAXH - BAR_FLOOR);
  };

  // 12-week average over weeks that actually logged activity — rest weeks (value 0)
  // would otherwise drag the baseline down and misrepresent typical training load.
  // Only meaningful with enough observations, so require at least 6 active weeks.
  const MIN_AVG_WEEKS = 6;
  const recentActive = weeks.slice(-12).filter((w) => w.value > 0);
  const showAvg = recentActive.length >= MIN_AVG_WEEKS;
  const avg = recentActive.reduce((s, w) => s + w.value, 0) / Math.max(1, recentActive.length);
  const avgY = MAXH - barHeight(avg);

  const cell = chartW > 0 ? Math.max(MIN_CELL, chartW / WEEKS_VISIBLE - GAP) : MIN_CELL;
  const colW = cell + GAP;
  const contentW = weeks.length * colW;
  // Dash segments for the 12-wk avg rule, sized to span the scrollable content width.
  const dashCount = Math.max(2, Math.floor(contentW / 9));

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

      {/* horizontally scrollable chart + month axis */}
      <View onLayout={onLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {/* paddingTop leaves room for the selected-week marker (top: -14) above the bars */}
          <View style={{ width: contentW, paddingTop: 14 }}>
            {/* chart */}
            <View style={{ height: MAXH }}>
              <View style={styles.bars}>
                {weeks.map((w) => {
                  const h = barHeight(w.value);
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
                          borderRadius: 3,
                          backgroundColor: w.level ? HEAT_RAMP[w.level] : uiColors.heatmapNeutralBg,
                          borderWidth: w.isCurrentWeek || on ? 1.6 : 0,
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

              {/* 12-wk average baseline — only when there is activity to average over the
                  last 12 weeks. Drawn after the bars so the dashed line and its label sit
                  on top of them. Rendered as discrete dash segments (not a zero-height
                  dashed border, which renders unreliably on iOS) and snapped to a whole
                  pixel. When near the top, the label flips below the line. */}
              {showAvg ? (
                <>
                  <View style={[styles.baseline, { top: Math.round(avgY) }]}>
                    {Array.from({ length: dashCount }).map((_, i) => (
                      <View key={i} style={styles.dash} />
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.baseLabel,
                      { top: avgY < 14 ? Math.round(avgY) + 2 : Math.round(avgY) - 14 },
                    ]}>
                    12-wk avg
                  </Text>
                </>
              ) : null}

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

            {/* month axis — labels overflow their column so they aren't clipped */}
            <View style={[styles.axis, { width: contentW }]}>
              {monthMarks.map((m, i) =>
                m ? (
                  <Text key={i} numberOfLines={1} style={[styles.axisLabel, { left: i * colW }]}>
                    {m}
                  </Text>
                ) : null
              )}
            </View>
          </View>
        </ScrollView>
      </View>

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
    height: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dash: {
    width: 5,
    height: 1.5,
    marginRight: 4,
    backgroundColor: uiColors.textMuted,
  },
  baseLabel: {
    position: 'absolute',
    right: 0,
    fontSize: 9,
    color: uiColors.textSecondary,
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%' },
  axis: {
    position: 'relative',
    marginTop: 5,
    height: 22,
    borderTopWidth: 1,
    borderColor: uiColors.borderMuted,
  },
  axisLabel: {
    position: 'absolute',
    top: 4,
    width: 32,
    fontSize: 10,
    lineHeight: 16,
    color: uiColors.textMuted,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  legendRamp: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

export default WeeklyHeatmap;
