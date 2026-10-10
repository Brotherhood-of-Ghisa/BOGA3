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

/** A Monday–Sunday week as `29 Sep – 5 Oct`, or `6 – 12 Oct` within one month. */
export const weekRangeLabel = (monday: Date): string => {
  const end = new Date(monday.getTime() + 6 * 86400000);
  const first = `${monday.getUTCDate()}${monday.getUTCMonth() === end.getUTCMonth() ? '' : ` ${MONTHS[monday.getUTCMonth()]}`}`;
  return `${first} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
};

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

/** Narrowest week column before the plot scrolls sideways. */
export const MIN_TIMELINE_COLUMN_WIDTH = 6;
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
/** The data end of a column is rounded; its baseline end stays square. */
export const BAR_RADIUS = 4;
/** Room a month label needs (`SEP`, `2026`) before the next one starts. */
export const MONTH_LABEL_WIDTH = 30;

export type TimelineBar = { weekStartDateKey: string; index: number; x: number; y: number; width: number; height: number };

export interface TimelineGeometry {
  columnWidth: number;
  /** The drawn width: the plot width, or wider when the window scrolls. */
  width: number;
  height: number;
  bars: TimelineBar[];
  ticks: { value: number; y: number }[];
  /** The month labels that fit: none overlaps another or runs off the end. */
  months: (TimelineMonth & { x: number })[];
}

// January and the first label carry the year, so they win a collision; the
// rest fill in oldest first wherever they still fit.
const fittingMonths = (months: (TimelineMonth & { x: number })[], width: number) => {
  const fits = (month: { x: number }, kept: { x: number }[]) => month.x + MONTH_LABEL_WIDTH <= width
    && kept.every(other => Math.abs(other.x - month.x) >= MONTH_LABEL_WIDTH);
  const kept: (TimelineMonth & { x: number })[] = [];
  for (const month of [...months.filter(m => m.year !== undefined), ...months.filter(m => m.year === undefined)]) {
    if (fits(month, kept)) kept.push(month);
  }
  return kept.sort((a, b) => a.index - b.index);
};

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
    months: fittingMonths(series.months.map(month => ({ ...month, x: month.index * columnWidth })), columnWidth * count),
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
