// heatmapData.ts
// Adapter: turns the app's per-day effort metrics into the daily + weekly arrays
// that <DailyHeatmap/> and <WeeklyHeatmap/> render. Reuses the shared metric +
// bucket helpers so the heat ramp matches the rest of the stats screen.
// No React / react-native imports — safe to unit-test in isolation.

import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import type { CalendarHeatmapMetric, DailyEffortMetrics } from '@/src/data';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import { historyWeekBounds, localDateKey } from '@/src/utils/calendar-weeks';

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
  /** Matching exercise PRs: the all-time session records for the selected metric. */
  prCount?: number;
  unavailable?: boolean;
  hasTraining?: boolean;
  targetAttainment?: number;
  workingSetCountsByMuscle?: Record<string, number>;
  /** The sessions behind the day's figure; empty on a rest day. */
  sessionIds: string[];
}

export interface WeekCell {
  weekStartDateKey: string;
  monday: Date;
  isCurrentWeek: boolean;
  /** Training days that contributed to the selected metric this week. */
  sessions: number;
  level: CalendarHeatmapBucket;
  value: number;
  prCount?: number;
  unavailable?: boolean;
  hasTraining?: boolean;
  targetAttainment?: number;
}

export interface HeatmapData {
  daily: DayCell[];
  weekly: WeekCell[];
  todayDateKey: string;
  /** Set when colour grades the weekly muscle target; `averaged` across several muscles. */
  targetGrading?: { averaged: boolean };
}

export interface BuildHeatmapDataOptions {
  /** Defaults to the local "today". Pass a `YYYY-MM-DD` key to make tests deterministic. */
  todayDateKey?: string;
  /**
   * Minimum complete weeks through today ([[comparison.history-window]]). Default 52.
   * Pass `'all'` to span from the earliest day present in `dailyMetrics` (falling back
   * to the 52-week default when there is less data), so the grid grows with the data.
   */
  weeks?: number | 'all';
  muscleTargets?: { muscleIds: readonly string[]; weeklyTarget: number };
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

// Volume + working sets accumulate over the week; 1RM + top weight are best-of.
const isAdditiveMetric = (metric: CalendarHeatmapMetric): boolean =>
  metric === 'totalVolume' || metric === 'workingSetCount';

/** Best-of aggregation; a missing value counts as zero. */
const bestOf = (left: number | null, right: number | null | undefined): number =>
  Math.max(left ?? 0, right ?? 0);

const DEFAULT_WEEKS = 52;

const windowStart = (today: Date, weeks: number): Date => {
  const localToday = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return dateKeyToUtcDate(localDateKey(historyWeekBounds(weeks, localToday).start));
};

const earliestDay = (dailyMetrics: DailyEffortMetrics[]): Date | null => {
  let earliest: Date | null = null;
  for (const day of dailyMetrics) {
    const date = dateKeyToUtcDate(day.dateKey);
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
};

/**
 * First day of the grid. `'all'` spans from the earliest day in the data
 * (Monday-aligned), but never shows a window shorter than the default 52 weeks.
 */
const resolveGridStart = (dailyMetrics: DailyEffortMetrics[], today: Date, weeks: number | 'all' | undefined): Date => {
  if (weeks !== 'all') {
    return windowStart(today, weeks ?? DEFAULT_WEEKS);
  }
  const defaultStart = windowStart(today, DEFAULT_WEEKS);
  const earliest = earliestDay(dailyMetrics);
  const earliestStart = earliest ? startOfMondayWeek(earliest) : defaultStart;
  return earliestStart < defaultStart ? earliestStart : defaultStart;
};

const eachDay = (start: Date, end: Date): Date[] => {
  const days: Date[] = [];
  for (let date = new Date(start); date <= end; date = addUtcDays(date, 1)) {
    days.push(date);
  }
  return days;
};

/** Min/max of the positive values (min 0 when there are none). */
const positiveRange = (values: number[]): { min: number; max: number } => {
  const positive = values.filter((value) => value > 0);
  if (positive.length === 0) return { min: 0, max: 0 };
  return { min: positive.reduce((a, b) => Math.min(a, b)), max: positive.reduce((a, b) => Math.max(a, b)) };
};

/**
 * Buckets each cell onto the heat ramp, calibrated across the observed range of
 * positive values in its series (see getCalendarHeatmapBucket).
 */
const withLevels = <T extends { value: number }>(cells: T[]): (T & { level: CalendarHeatmapBucket })[] => {
  const { min, max } = positiveRange(cells.map((cell) => cell.value));
  return cells.map((cell) => ({ ...cell, level: getCalendarHeatmapBucket(cell.value, min, max) }));
};

const toDayCell = (
  date: Date,
  source: DailyEffortMetrics | undefined,
  metric: CalendarHeatmapMetric,
  todayDateKey: string
): Omit<DayCell, 'level'> => {
  const dateKey = formatUtcDateKey(date);
  const metricValue = source ? getMetricValue(source, metric) : 0;
  const unavailable = metricValue === null;
  const value = metricValue ?? 0;
  return {
    dateKey,
    weekStartDateKey: formatUtcDateKey(startOfMondayWeek(date)),
    dow: mondayIndex(date),
    isToday: dateKey === todayDateKey,
    value,
    prCount: metric === 'workingSetCount' ? 0 : source?.personalRecordCounts?.[metric] ?? 0,
    unavailable,
    hasTraining: source !== undefined,
    workingSetCountsByMuscle: source?.workingSetCountsByMuscle,
    sessionIds: source?.sessionIds ?? [],
  };
};

type WeekTotals = {
  monday: Date;
  sessions: number;
  value: number;
  prCount: number;
  unavailable: boolean;
  hasKnown: boolean;
  workingSetCountsByMuscle: Record<string, number>;
};

const emptyWeek = (weekStartDateKey: string): WeekTotals => ({
  monday: dateKeyToUtcDate(weekStartDateKey),
  sessions: 0,
  value: 0,
  prCount: 0,
  unavailable: false,
  hasKnown: false,
  workingSetCountsByMuscle: {},
});

const addDayToWeek = (week: WeekTotals, day: DayCell, metric: CalendarHeatmapMetric): void => {
  week.prCount += day.prCount ?? 0;
  for (const [id, count] of Object.entries(day.workingSetCountsByMuscle ?? {})) {
    week.workingSetCountsByMuscle[id] = (week.workingSetCountsByMuscle[id] ?? 0) + count;
  }
  const combine = isAdditiveMetric(metric) ? addFiniteVolume : bestOf;
  if (day.hasTraining) week.sessions++;
  if (day.hasTraining && !day.unavailable) week.hasKnown = true;
  if (metric === 'totalVolume' && day.unavailable) week.unavailable = true;
  if (day.value > 0) {
    const next = combine(week.value, day.value);
    if (next === null) week.unavailable = true;
    week.value = next ?? 0;
  }
};

/** Groups days → weeks (in grid order), aggregating the metric the way the weekly effort does. */
const accumulateWeeks = (daily: DayCell[], metric: CalendarHeatmapMetric): Map<string, WeekTotals> => {
  const weeks = new Map<string, WeekTotals>();
  for (const day of daily) {
    let week = weeks.get(day.weekStartDateKey);
    if (!week) {
      week = emptyWeek(day.weekStartDateKey);
      weeks.set(day.weekStartDateKey, week);
    }
    addDayToWeek(week, day, metric);
  }
  return weeks;
};

const toWeekCell = (weekStartDateKey: string, week: WeekTotals, todayWeekKey: string): Omit<WeekCell, 'level'> => {
  // A week of training days that all lack the metric is unavailable, not a rest week.
  const unavailable = week.unavailable || (week.sessions > 0 && !week.hasKnown);
  return {
    weekStartDateKey,
    monday: week.monday,
    isCurrentWeek: weekStartDateKey === todayWeekKey,
    sessions: week.sessions,
    value: unavailable ? 0 : week.value,
    prCount: week.prCount,
    unavailable,
    hasTraining: week.sessions > 0,
  };
};

/**
 * Build the daily grid (Monday-aligned selected week span, rest days included) and
 * the matching weekly series for one selected metric.
 */
export function buildHeatmapData(
  dailyMetrics: DailyEffortMetrics[],
  metric: CalendarHeatmapMetric,
  options: BuildHeatmapDataOptions = {}
): HeatmapData {
  const todayDateKey = options.todayDateKey ?? getCurrentLocalDateKey();
  const today = dateKeyToUtcDate(todayDateKey);
  const sourceByDateKey = new Map(dailyMetrics.map((day) => [day.dateKey, day]));

  const daily = withLevels(
    eachDay(resolveGridStart(dailyMetrics, today, options.weeks), today).map((date) =>
      toDayCell(date, sourceByDateKey.get(formatUtcDateKey(date)), metric, todayDateKey)
    )
  );

  const todayWeekKey = formatUtcDateKey(startOfMondayWeek(today));
  const totals = accumulateWeeks(daily, metric);
  const weekly = withLevels(
    [...totals].map(([weekStartDateKey, week]) => toWeekCell(weekStartDateKey, week, todayWeekKey))
  );

  const target = metric === 'workingSetCount' ? options.muscleTargets : undefined;
  if (!target) return { daily, weekly, todayDateKey };
  const grade = (counts: Record<string, number> | undefined) =>
    groupedTargetAttainment(target.muscleIds, counts ?? {}, target.weeklyTarget);
  const targetDaily = daily.map(day => withTargetLevel(day, grade(day.workingSetCountsByMuscle)));
  const targetWeekly = weekly.map(week => withTargetLevel(week, grade(totals.get(week.weekStartDateKey)?.workingSetCountsByMuscle)));
  return { daily: targetDaily, weekly: targetWeekly, todayDateKey,
    targetGrading: { averaged: target.muscleIds.length > 1 } };
}

const withTargetLevel = <T extends { level: CalendarHeatmapBucket }>(cell: T, targetAttainment: number) =>
  ({ ...cell, targetAttainment, level: Math.min(4, Math.ceil(targetAttainment * 4)) as CalendarHeatmapBucket });
