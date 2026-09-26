// WeeklyHeatmap.tsx — "Weekly heatmap" (Direction B), React Native.
// One bar = one week · height = selected-metric value · color = intensity.
// 12-week average baseline · selection lifted to the history sheet's week banner.

import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, uiGeometry, uiRoles, uiSpace } from '@/components/ui';

import { HEAT_RAMP } from './heatmap-metric';
import { HEAT_MARK, heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
import type { HeatmapData, WeekCell } from './heatmapData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAXH = 78;

interface Props {
  data: HeatmapData;
  selectedWeekKey: string | null;
  onSelectWeek: (weekStartDateKey: string | null) => void;
  testIDPrefix: string;
  legendLabel?: string;
}

// The current week is a 1px `ink` ring and the selected week a 2px `ink`
// border, the daily grid's today and selected marks (DLM-T09-D3).
const barBorder = (week: WeekCell, selected: boolean) => {
  if (selected) return { borderWidth: HEAT_MARK.selectedWidth, borderColor: HEAT_MARK.color };
  if (week.isCurrentWeek) return { borderWidth: HEAT_MARK.todayWidth, borderColor: HEAT_MARK.color };
  return null;
};

export function WeeklyHeatmap({
  data,
  selectedWeekKey,
  onSelectWeek,
  testIDPrefix,
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
    <View style={heatmapStyles.wrap} testID={heatmapTestID}>
      <View style={heatmapStyles.headerRow}>
        <Text allowFontScaling={false} style={heatmapStyles.title}>Weekly training load</Text>
      </View>

      {/* horizontally scrollable chart + month axis */}
      <View onLayout={onLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {/* paddingTop leaves room for the selected-week marker (top: -14) above the bars */}
          <View style={{ width: contentW, paddingTop: uiSpace.lg }}>
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
                      style={[styles.column, { width: colW }]}>
                      <View
                        style={[
                          styles.bar,
                          { width: cell, height: h, backgroundColor: HEAT_RAMP[w.level] },
                          barBorder(w, on),
                        ]}
                        testID={`${heatmapTestID}-bar-${w.weekStartDateKey}`}
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
                    allowFontScaling={false}
                    style={[
                      heatmapStyles.legendText,
                      styles.baseLabel,
                      { top: avgY < 14 ? Math.round(avgY) + 2 : Math.round(avgY) - 14 },
                    ]}>
                    12-wk avg
                  </Text>
                </>
              ) : null}

              {/* the selected week's marker: a filled `ink` caret above its bar */}
              {selectedIndex >= 0 ? (
                <View
                  style={[styles.marker, { left: (selectedIndex + 0.5) * colW - 16 }]}
                  testID={`${heatmapTestID}-selected-marker`}>
                  <Icon color={HEAT_MARK.color} name="caret-down" size="xs" />
                </View>
              ) : null}
            </View>

            {/* month axis — labels overflow their column so they aren't clipped */}
            <View style={[styles.axis, { width: contentW }]}>
              {monthMarks.map((m, i) =>
                m ? (
                  <Text
                    allowFontScaling={false}
                    key={i}
                    numberOfLines={1}
                    style={[heatmapStyles.legendText, styles.axisLabel, { left: i * colW }]}>
                    {m}
                  </Text>
                ) : null
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      <HeatmapLegend label={legendLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%' },
  column: { alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  bar: { borderRadius: uiGeometry.radius.control },
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
    marginRight: uiSpace.xs,
    backgroundColor: uiRoles.inkFaint,
  },
  // On `surface` so it reads over a bar as well as over the ground.
  baseLabel: {
    position: 'absolute',
    right: 0,
    color: uiRoles.inkMuted,
    backgroundColor: uiRoles.surface,
    paddingHorizontal: uiSpace.xs,
  },
  marker: {
    position: 'absolute',
    top: -14,
    width: 32,
    alignItems: 'center',
  },
  axis: {
    position: 'relative',
    marginTop: uiSpace.xs,
    height: 22,
    borderTopWidth: 1,
    borderColor: uiRoles.rule,
  },
  axisLabel: { position: 'absolute', top: 4, width: 32 },
});

export default WeeklyHeatmap;
