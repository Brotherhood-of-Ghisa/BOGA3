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
  /**
   * History window in weeks (Monday-aligned span ending today). Default 52.
   * Pass `'all'` to span from the earliest day present in `dailyMetrics` (falling back
   * to the 52-week default when there is less data), so the grid grows with the data.
   */
  weeks?: number | 'all';
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
  const DEFAULT_WEEKS = 52;

  const today = dateKeyToUtcDate(todayDateKey);
  const todayWeekKey = formatUtcDateKey(startOfMondayWeek(today));
  const defaultGridStart = addUtcDays(startOfMondayWeek(today), -(DEFAULT_WEEKS - 1) * 7);

  let gridStart: Date;
  if (options.weeks === 'all') {
    // Span from the earliest day in the data (Monday-aligned), but never show a window
    // shorter than the default 52 weeks.
    let earliest: Date | null = null;
    for (const day of dailyMetrics) {
      const d = dateKeyToUtcDate(day.dateKey);
      if (!earliest || d < earliest) earliest = d;
    }
    const earliestStart = earliest ? startOfMondayWeek(earliest) : defaultGridStart;
    gridStart = earliestStart < defaultGridStart ? earliestStart : defaultGridStart;
  } else {
    const windowWeeks = options.weeks ?? DEFAULT_WEEKS;
    gridStart = addUtcDays(startOfMondayWeek(today), -(windowWeeks - 1) * 7);
  }

  // dateKey → selected-metric value (0 when the metric has nothing to show)
  const valueByDateKey = new Map<string, number>();
  for (const day of dailyMetrics) {
    valueByDateKey.set(day.dateKey, getMetricValue(day, metric) ?? 0);
  }

  // Min/max positive daily value within the window — calibrates the daily heat ramp
  // across the observed range of activity (see getCalendarHeatmapBucket).
  let maxDaily = 0;
  let minDaily = Infinity;
  for (let d = new Date(gridStart); d <= today; d = addUtcDays(d, 1)) {
    const v = valueByDateKey.get(formatUtcDateKey(d)) ?? 0;
    if (v > 0) {
      if (v > maxDaily) maxDaily = v;
      if (v < minDaily) minDaily = v;
    }
  }
  if (minDaily === Infinity) minDaily = 0;

  const daily: DayCell[] = [];
  for (let d = new Date(gridStart); d <= today; d = addUtcDays(d, 1)) {
    const dateKey = formatUtcDateKey(d);
    const value = valueByDateKey.get(dateKey) ?? 0;
    daily.push({
      dateKey,
      weekStartDateKey: formatUtcDateKey(startOfMondayWeek(d)),
      dow: mondayIndex(d),
      isToday: dateKey === todayDateKey,
      level: getCalendarHeatmapBucket(value, minDaily, maxDaily),
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
  let minWeekly = Infinity;
  for (const key of weekOrder) {
    const v = weekAcc.get(key)!.value;
    if (v > 0) {
      if (v > maxWeekly) maxWeekly = v;
      if (v < minWeekly) minWeekly = v;
    }
  }
  if (minWeekly === Infinity) minWeekly = 0;

  const weekly: WeekCell[] = weekOrder.map((weekStartDateKey) => {
    const acc = weekAcc.get(weekStartDateKey)!;
    return {
      weekStartDateKey,
      monday: acc.monday,
      isCurrentWeek: weekStartDateKey === todayWeekKey,
      sessions: acc.sessions,
      level: getCalendarHeatmapBucket(acc.value, minWeekly, maxWeekly),
      value: acc.value,
    };
  });

  return { daily, weekly, todayDateKey };
}
