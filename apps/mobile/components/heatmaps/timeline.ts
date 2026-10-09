// timeline.ts — the Timeline history view's data and geometry: one value per
// week of the adapter's weekly series (`heatmapData.ts`), its y scale, month
// labels and the plotted marks. Pure, no React / react-native imports.
// Rest-week display follows [[comparison.timeline-history]].

import type { CalendarHeatmapMetric } from '@/src/data';

import type { WeekCell } from './heatmapData';

/** Summed metrics draw zero-based columns; best-of metrics draw a line. */
export type TimelineMark = 'bar' | 'line';
export type TimelineWeekState = 'training' | 'rest' | 'unavailable';

export interface TimelineWeek {
  weekStartDateKey: string;
  monday: Date;
  isCurrentWeek: boolean;
  state: TimelineWeekState;
  /** `null` is a gap: an unavailable figure, or a rest week of a best-of metric. */
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
  mark: TimelineMark;
  weeks: TimelineWeek[];
  /** Ascending; the first and last are the y domain. Empty when nothing is plotted. */
  ticks: number[];
  months: TimelineMonth[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TARGET_TICK_INTERVALS = 4;

export const timelineMark = (metric: CalendarHeatmapMetric): TimelineMark =>
  metric === 'totalVolume' || metric === 'workingSetCount' ? 'bar' : 'line';

const weekState = (week: WeekCell): TimelineWeekState => {
  if (week.unavailable) return 'unavailable';
  return week.hasTraining ?? week.value > 0 ? 'training' : 'rest';
};

const weekValue = (state: TimelineWeekState, value: number, mark: TimelineMark): number | null => {
  if (state === 'unavailable') return null;
  if (state === 'rest') return mark === 'bar' ? 0 : null;
  return value;
};

const toTimelineWeek = (week: WeekCell, mark: TimelineMark): TimelineWeek => {
  const state = weekState(week);
  return {
    weekStartDateKey: week.weekStartDateKey,
    monday: week.monday,
    isCurrentWeek: week.isCurrentWeek,
    state,
    value: weekValue(state, week.value, mark),
  };
};

// The first week starting in a month carries its label: its Monday is one of
// the month's first seven days.
/** A Monday–Sunday week as `29 Sep – 5 Oct`, or `6 – 12 Oct` within one month. */
export const weekRangeLabel = (monday: Date): string => {
  const end = new Date(monday.getTime() + 6 * 86400000);
  const first = `${monday.getUTCDate()}${monday.getUTCMonth() === end.getUTCMonth() ? '' : ` ${MONTHS[monday.getUTCMonth()]}`}`;
  return `${first} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
};

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

const ticksBetween = (low: number, high: number, integer: boolean): number[] => {
  const step = niceStep(high - low, integer);
  const first = Math.floor(low / step) * step;
  const last = Math.ceil(high / step) * step;
  const count = Math.round((last - first) / step);
  return Array.from({ length: count + 1 }, (_, index) => Number((first + index * step).toPrecision(12)));
};

// Columns share a zero origin. A line spans the plotted values, padded when
// they are all equal and never below zero.
export const timelineTicks = (values: number[], mark: TimelineMark, integer: boolean): number[] => {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  if (mark === 'bar') return max > 0 ? ticksBetween(0, max, integer) : [0];
  const min = Math.min(...values);
  const pad = min === max ? Math.max(1, Math.abs(max) * 0.05) : 0;
  return ticksBetween(Math.max(0, min - pad), max + pad, integer);
};

/** The weekly series (sums for Volume/Sets, best-of for 1RM/Top weight) as the timeline plots it. */
export function buildTimelineSeries(weekly: WeekCell[], metric: CalendarHeatmapMetric): TimelineSeries {
  const mark = timelineMark(metric);
  const weeks = weekly.map(week => toTimelineWeek(week, mark));
  const values = weeks.flatMap(week => week.value === null ? [] : [week.value]);
  return { mark, weeks, ticks: timelineTicks(values, mark, metric === 'workingSetCount'), months: timelineMonths(weeks) };
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Narrowest week column before the plot scrolls sideways. */
export const MIN_TIMELINE_COLUMN_WIDTH = 6;
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
/** The data end of a column is rounded; its baseline end stays square. */
export const BAR_RADIUS = 4;

export type TimelinePoint = { x: number; y: number };
export type TimelineBar = { weekStartDateKey: string; x: number; y: number; width: number; height: number };

export interface TimelineGeometry {
  columnWidth: number;
  /** The drawn width: the plot width, or wider when the window scrolls. */
  width: number;
  height: number;
  bars: TimelineBar[];
  /** A line's point per week, `null` at a gap; empty for columns. */
  points: (TimelinePoint | null)[];
  /** Runs of consecutive plotted weeks; a gap ends a run. */
  segments: TimelinePoint[][];
  /** Points with no plotted neighbour, drawn as dots so they stay visible. */
  isolated: TimelinePoint[];
  ticks: { value: number; y: number }[];
  /** The month labels that fit: none overlaps another or runs off the end. */
  months: (TimelineMonth & { x: number })[];
}

/** Room a month label needs (`SEP`, `2026`) before the next one starts. */
export const MONTH_LABEL_WIDTH = 30;

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

const scaleY = (ticks: number[], height: number) => {
  const low = ticks[0] ?? 0;
  const span = (ticks[ticks.length - 1] ?? 0) - low || 1;
  return (value: number) => height - ((value - low) / span) * height;
};

const lineRuns = (points: (TimelinePoint | null)[]): TimelinePoint[][] => {
  const runs: TimelinePoint[][] = [];
  let run: TimelinePoint[] = [];
  for (const point of points) {
    if (point) run.push(point);
    else if (run.length > 0) { runs.push(run); run = []; }
  }
  if (run.length > 0) runs.push(run);
  return runs;
};

const columnBars = (series: TimelineSeries, columnWidth: number, y: (value: number) => number, height: number): TimelineBar[] => {
  const width = Math.max(1, Math.min(MAX_BAR_WIDTH, columnWidth - BAR_GAP));
  return series.weeks.flatMap((week, index) => {
    if (week.value === null || week.value <= 0) return [];
    const top = y(week.value);
    return [{ weekStartDateKey: week.weekStartDateKey, x: index * columnWidth + (columnWidth - width) / 2, y: top, width, height: height - top }];
  });
};

export function timelineGeometry(series: TimelineSeries, plotWidth: number, height: number): TimelineGeometry {
  const count = Math.max(1, series.weeks.length);
  const columnWidth = Math.max(MIN_TIMELINE_COLUMN_WIDTH, plotWidth / count);
  const y = scaleY(series.ticks, height);
  const centre = (index: number) => index * columnWidth + columnWidth / 2;
  const points = series.mark === 'line'
    ? series.weeks.map((week, index) => week.value === null ? null : { x: centre(index), y: y(week.value) })
    : [];
  const segments = lineRuns(points);
  return {
    columnWidth,
    width: columnWidth * count,
    height,
    bars: series.mark === 'bar' ? columnBars(series, columnWidth, y, height) : [],
    points,
    segments: segments.filter(run => run.length > 1),
    isolated: segments.filter(run => run.length === 1).map(([point]) => point),
    ticks: series.ticks.map(value => ({ value, y: y(value) })),
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
