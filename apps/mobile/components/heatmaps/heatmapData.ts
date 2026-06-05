// heatmapData.ts
// Adapter: turns the app's per-day effort metrics into the daily + weekly arrays
// that <DailyHeatmap/> and <WeeklyHeatmap/> render. Reuses the shared metric +
// bucket helpers so the heat ramp matches the rest of the stats screen.
// No React / react-native imports — safe to unit-test in isolation.

import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';

import {
  getCalendarHeatmapBucket,
  getCurrentLocalDateKey,
  getMetricValue,
  type CalendarHeatmapBucket,
} from './heatmap-metric';

export interface DayCell {
  dateKey: string;
  weekStartDateKey: string;
  /** 0 = Monday … 6 = Sunday — the row index in the daily grid. */
  dow: number;
  isToday: boolean;
  level: CalendarHeatmapBucket;
  value: number;
}

export interface WeekCell {
  weekStartDateKey: string;
  monday: Date;
  isCurrentWeek: boolean;
  /** Training days that contributed to the selected metric this week. */
  sessions: number;
  level: CalendarHeatmapBucket;
  value: number;
}

export interface HeatmapData {
  daily: DayCell[];
  weekly: WeekCell[];
  todayDateKey: string;
}

export interface BuildHeatmapDataOptions {
  /** Defaults to the local "today". Pass a `YYYY-MM-DD` key to make tests deterministic. */
  todayDateKey?: string;
  /** History window in weeks (Monday-aligned span ending today). Default 52. */
  weeks?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dateKeyToUtcDate = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDateKey = (date: Date): string => {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addUtcDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * MS_PER_DAY);

/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (date: Date): number => (date.getUTCDay() + 6) % 7;

const startOfMondayWeek = (date: Date): Date => addUtcDays(date, -mondayIndex(date));

// Volume + near-failure accumulate over the week; 1RM + top weight are best-of.
const isAdditiveMetric = (metric: CalendarHeatmapMetric): boolean =>
  metric === 'totalVolume' || metric === 'nearFailureCount';

/**
 * Build the daily grid (full Monday-aligned 52-week span, rest days included) and
 * the matching weekly series for one selected metric.
 */
export function buildHeatmapData(
  dailyMetrics: DailyEffortMetrics[],
  metric: CalendarHeatmapMetric,
  options: BuildHeatmapDataOptions = {}
): HeatmapData {
  const todayDateKey = options.todayDateKey ?? getCurrentLocalDateKey();
  const windowWeeks = options.weeks ?? 52;

  const today = dateKeyToUtcDate(todayDateKey);
  const todayWeekKey = formatUtcDateKey(startOfMondayWeek(today));
  const gridStart = addUtcDays(startOfMondayWeek(today), -(windowWeeks - 1) * 7);

  // dateKey → selected-metric value (0 when the metric has nothing to show)
  const valueByDateKey = new Map<string, number>();
  for (const day of dailyMetrics) {
    valueByDateKey.set(day.dateKey, getMetricValue(day, metric) ?? 0);
  }

  // Max positive daily value within the window — calibrates the daily heat ramp.
  let maxDaily = 0;
  for (let d = new Date(gridStart); d <= today; d = addUtcDays(d, 1)) {
    const v = valueByDateKey.get(formatUtcDateKey(d)) ?? 0;
    if (v > maxDaily) maxDaily = v;
  }

  const daily: DayCell[] = [];
  for (let d = new Date(gridStart); d <= today; d = addUtcDays(d, 1)) {
    const dateKey = formatUtcDateKey(d);
    const value = valueByDateKey.get(dateKey) ?? 0;
    daily.push({
      dateKey,
      weekStartDateKey: formatUtcDateKey(startOfMondayWeek(d)),
      dow: mondayIndex(d),
      isToday: dateKey === todayDateKey,
      level: getCalendarHeatmapBucket(value, maxDaily),
      value,
    });
  }

  // Group days → weeks, aggregating the metric the way the weekly effort does.
  const additive = isAdditiveMetric(metric);
  const weekOrder: string[] = [];
  const weekAcc = new Map<string, { value: number; sessions: number; monday: Date }>();
  for (const day of daily) {
    let acc = weekAcc.get(day.weekStartDateKey);
    if (!acc) {
      acc = { value: 0, sessions: 0, monday: dateKeyToUtcDate(day.weekStartDateKey) };
      weekAcc.set(day.weekStartDateKey, acc);
      weekOrder.push(day.weekStartDateKey);
    }
    if (day.value > 0) {
      acc.sessions += 1;
      acc.value = additive ? acc.value + day.value : Math.max(acc.value, day.value);
    }
  }

  let maxWeekly = 0;
  for (const key of weekOrder) {
    const v = weekAcc.get(key)!.value;
    if (v > maxWeekly) maxWeekly = v;
  }

  const weekly: WeekCell[] = weekOrder.map((weekStartDateKey) => {
    const acc = weekAcc.get(weekStartDateKey)!;
    return {
      weekStartDateKey,
      monday: acc.monday,
      isCurrentWeek: weekStartDateKey === todayWeekKey,
      sessions: acc.sessions,
      level: getCalendarHeatmapBucket(acc.value, maxWeekly),
      value: acc.value,
    };
  });

  return { daily, weekly, todayDateKey };
}
