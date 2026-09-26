// DailyHeatmap.tsx — "Daily heat map" (Direction A), React Native.
// One square = one day · 7 weekday rows × N week columns · today anchored at right.
// Tapping a square selects that DAY and shows its detail (date + metric value);
// the daily view is for per-day inspection, the weekly view for weekly rollups.

import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

import { HEAT_RAMP } from './heatmap-metric';
import { HEAT_MARK, heatmapStyles } from './heatmap-style';
import { HeatmapLegend } from './HeatmapLegend';
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
  legendLabel?: string;
}

const formatDayTitle = (dateKey: string): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

// Today is a 1px `ink` ring and the selected day a 2px `ink` border, so the two
// never look alike (DLM-T09-D3); an empty day keeps a `rule` hairline.
const cellBorder = (day: DayCell, selected: boolean) => {
  if (selected) return { borderWidth: HEAT_MARK.selectedWidth, borderColor: HEAT_MARK.color };
  if (day.isToday) return { borderWidth: HEAT_MARK.todayWidth, borderColor: HEAT_MARK.color };
  if (day.level === 0) return { borderWidth: StyleSheet.hairlineWidth, ...heatmapStyles.restCell };
  return null;
};

export function DailyHeatmap({
  data,
  testIDPrefix,
  metricLabel,
  formatValue,
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
    <View style={heatmapStyles.wrap} testID={heatmapTestID}>
      <View style={heatmapStyles.headerRow}>
        <Text allowFontScaling={false} style={heatmapStyles.title}>Last 12 months</Text>
        <Text allowFontScaling={false} style={heatmapStyles.caption}>each square = one day</Text>
      </View>

      {/* fixed weekday column + horizontally scrollable (month axis + grid) */}
      <View style={styles.body} onLayout={onLayout}>
        <View style={{ width: GUT }}>
          {/* spacer aligns the weekday labels with the grid rows (below the month axis) */}
          <View style={{ height: AXIS_H }} />
          {['M', '', 'W', '', 'F', '', ''].map((w, r) => (
            <Text
              allowFontScaling={false}
              key={r}
              style={[heatmapStyles.legendText, styles.weekday, { height: rowH, lineHeight: rowH }]}>
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
                    style={[heatmapStyles.legendText, styles.axisLabel, { left: i * colW }]}>
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
                        style={[
                          styles.cell,
                          {
                            width: cell,
                            height: cell,
                            marginBottom: r < 6 ? GAP : 0,
                            backgroundColor: HEAT_RAMP[d.level],
                          },
                          cellBorder(d, selected),
                        ]}
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
        <Card style={styles.detail} testID={`${heatmapTestID}-day-detail`}>
          <View style={styles.detailLeft}>
            <Text allowFontScaling={false} style={styles.kicker}>
              {selectedDay.isToday ? 'Today' : DOW[selectedDay.dow]}
            </Text>
            <Text allowFontScaling={false} style={styles.detailTitle} testID={`${heatmapTestID}-day-detail-date`}>
              {formatDayTitle(selectedDay.dateKey)}
            </Text>
          </View>
          <View style={styles.detailRight}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: HEAT_RAMP[selectedDay.level] },
                selectedDay.level === 0 ? heatmapStyles.restCell : null,
              ]}
            />
            <Text allowFontScaling={false} style={styles.detailLabel} testID={`${heatmapTestID}-day-detail-value`}>
              {selectedDay.level ? (
                <>
                  {metricLabel}: <Text allowFontScaling={false} style={styles.detailFigure}>{formatValue(selectedDay.value)}</Text>
                </>
              ) : (
                'Rest day'
              )}
            </Text>
          </View>
        </Card>
      ) : null}

      <HeatmapLegend label={legendLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row' },
  scroll: { flex: 1 },
  weekday: { textAlign: 'center' },
  axis: { height: 18, position: 'relative' },
  axisLabel: { position: 'absolute', top: 0, width: 32 },
  grid: { flexDirection: 'row' },
  cell: { borderRadius: uiGeometry.radius.control },
  detail: {
    marginTop: uiSpace.lg,
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  detailLeft: { gap: uiSpace.xs },
  kicker: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  detailTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  detailRight: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: uiGeometry.radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  detailLabel: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  detailFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    color: uiRoles.ink,
  },
});

export default DailyHeatmap;
