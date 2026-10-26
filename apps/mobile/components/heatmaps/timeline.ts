import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatCalendarWeek, formatCalendarWeekHeading } from '@/src/utils/local-time';
// timeline.ts — the Timeline history view's data and geometry: one value per
// week of the adapter's weekly series (`heatmapData.ts`), its zero-based y
// scale, month labels and the columns. Pure, no React / react-native imports.
// Week values are the week's sum for Volume and Sets, its best for 1RM and Top
// weight; a rest week gets no column.

import type { CalendarHeatmapMetric } from '@/src/data';

import type { WeekCell } from './heatmapData';

export type TimelineWeekState = 'training' | 'rest' | 'unavailable';

export interface TimelineWeek {
  weekStartDateKey: string;
  monday: Date;
  isCurrentWeek: boolean;
  state: TimelineWeekState;
  /** Zero for a rest week; `null` (a gap) when the figure is unavailable. */
  value: number | null;
}

export interface TimelineMonth {
  /** Index of the first week that starts in the month. */
  index: number;
  label: string;
  /** Set on January and on the first labelled month. */
  year?: number;
}

export interface TimelineSeries {
  weeks: TimelineWeek[];
  /** Ascending from zero; the last is the top of the scale. */
  ticks: number[];
  months: TimelineMonth[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TARGET_TICK_INTERVALS = 4;

const weekState = (week: WeekCell): TimelineWeekState => {
  if (week.unavailable) return 'unavailable';
  return week.hasTraining ?? week.value > 0 ? 'training' : 'rest';
};

const toTimelineWeek = (week: WeekCell): TimelineWeek => {
  const state = weekState(week);
  return {
    weekStartDateKey: week.weekStartDateKey,
    monday: week.monday,
    isCurrentWeek: week.isCurrentWeek,
    state,
    value: state === 'unavailable' ? null : state === 'rest' ? 0 : week.value,
  };
};

/** The focused week, as the readout names it and the page's ⋮ opens it. */
export interface FocusedTimelineWeek {
  weekStartDateKey: string;
  /** Full numeric date range for the page's session action. */
  label: string;
  /** False for a rest week, which has no sessions to open. */
  hasTraining: boolean;
}

/** The adapter's UTC calendar date represents a day, never an instant. */
export const weekRangeLabel = (monday: Date, dateFormat: ExerciseDateFormat): string =>
  formatCalendarWeek(monday.toISOString().slice(0, 10), dateFormat);

export const weekLabel = (monday: Date, dateFormat: ExerciseDateFormat): string =>
  formatCalendarWeekHeading(monday.toISOString().slice(0, 10), dateFormat);

// The first week starting in a month carries its label: its Monday is one of
// the month's first seven days.
const timelineMonths = (weeks: TimelineWeek[]): TimelineMonth[] => {
  const months: TimelineMonth[] = [];
  weeks.forEach((week, index) => {
    if (week.monday.getUTCDate() > 7) return;
    const month = week.monday.getUTCMonth();
    const year = months.length === 0 || month === 0 ? week.monday.getUTCFullYear() : undefined;
    months.push({ index, label: MONTHS[month], ...(year === undefined ? {} : { year }) });
  });
  return months;
};

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** The smallest 1/2/2.5/5 × 10ⁿ step giving at most `TARGET_TICK_INTERVALS` intervals. */
export const niceStep = (span: number, integer: boolean): number => {
  const rough = span / TARGET_TICK_INTERVALS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const steps = integer ? NICE_STEPS.filter(step => step !== 2.5) : NICE_STEPS;
  const step = steps.find(candidate => candidate * magnitude >= rough)! * magnitude;
  return integer ? Math.max(1, Math.round(step)) : step;
};

/** Zero up to the first nice step at or above the largest value. */
export const timelineTicks = (values: number[], integer: boolean): number[] => {
  const max = Math.max(0, ...values);
  if (max === 0) return [0];
  const step = niceStep(max, integer);
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)));
};

/** The weekly series (sums for Volume/Sets, best-of for 1RM/Top weight) as the timeline plots it. */
export function buildTimelineSeries(weekly: WeekCell[], metric: CalendarHeatmapMetric): TimelineSeries {
  const weeks = weekly.map(toTimelineWeek);
  const values = weeks.flatMap(week => week.value === null ? [] : [week.value]);
  return { weeks, ticks: timelineTicks(values, metric === 'workingSetCount'), months: timelineMonths(weeks) };
}

// ── Geometry ────────────────────────────────────────────────────────────────

/**
 * Narrowest week column before the plot scrolls sideways. A column is the whole
 * tap target for its week, so a long window shows fewer, hittable weeks and
 * scrolls rather than slicing the width into unhittable slivers: this holds a
 * `MAX_BAR_WIDTH` bar with its gap, and leaves a 52-week window about a dozen
 * weeks on a phone.
 */
export const MIN_TIMELINE_COLUMN_WIDTH = 32;
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
/** The data end of a column is rounded; its baseline end stays square. */
export const BAR_RADIUS = 4;
/**
 * Room a month label needs (`SEP`, `2026`). A month is labelled at most every
 * fourth column, so the column floor keeps four times this much between any
 * two labels: none is ever dropped for a collision, and the last one fits
 * inside the drawn width because its column is the width's final one.
 */
export const MONTH_LABEL_WIDTH = 30;

export type TimelineBar = { weekStartDateKey: string; index: number; x: number; y: number; width: number; height: number };

export interface TimelineGeometry {
  columnWidth: number;
  /** The drawn width: the plot width, or wider when the window scrolls. */
  width: number;
  height: number;
  bars: TimelineBar[];
  ticks: { value: number; y: number }[];
  /** Every month that starts in the window, at its column. */
  months: (TimelineMonth & { x: number })[];
}

const columnBars = (series: TimelineSeries, columnWidth: number, height: number): TimelineBar[] => {
  const top = series.ticks[series.ticks.length - 1] || 1;
  const width = Math.max(1, Math.min(MAX_BAR_WIDTH, columnWidth - BAR_GAP));
  return series.weeks.flatMap((week, index) => {
    if (week.value === null || week.value <= 0) return [];
    const barHeight = (week.value / top) * height;
    return [{ weekStartDateKey: week.weekStartDateKey, index, x: index * columnWidth + (columnWidth - width) / 2, y: height - barHeight, width, height: barHeight }];
  });
};

export function timelineGeometry(series: TimelineSeries, plotWidth: number, height: number): TimelineGeometry {
  const count = Math.max(1, series.weeks.length);
  const columnWidth = Math.max(MIN_TIMELINE_COLUMN_WIDTH, plotWidth / count);
  const top = series.ticks[series.ticks.length - 1] || 1;
  return {
    columnWidth,
    width: columnWidth * count,
    height,
    bars: columnBars(series, columnWidth, height),
    ticks: series.ticks.map(value => ({ value, y: height - (value / top) * height })),
    months: series.months.map(month => ({ ...month, x: month.index * columnWidth })),
  };
}

/** The week under a tap at `x` on the drawn plot. */
export const timelineWeekIndexAt = (x: number, columnWidth: number, count: number): number =>
  Math.min(count - 1, Math.max(0, Math.floor(x / columnWidth)));

/** SVG path of a column with a rounded top and a square baseline. */
export const barPath = ({ x, y, width, height }: TimelineBar): string => {
  const radius = Math.min(BAR_RADIUS, width / 2, height);
  const bottom = y + height;
  const right = x + width;
  return `M ${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${right - radius}Q${right},${y} ${right},${y + radius}V${bottom}Z`;
};
