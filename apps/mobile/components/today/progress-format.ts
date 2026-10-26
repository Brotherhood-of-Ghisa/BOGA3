// The Progress card's words and chart geometry (pure). The figures come from
// `src/progress-summary`; this file only says them.

import type {
  LatestSessionSummary,
  SessionExerciseLine,
  SessionPersonalRecord,
  TodayProgressPeriod,
} from '@/src/progress-summary';
import type { LocalWindow } from '@/src/utils/local-calendar';
import { formatCompactDuration } from '@/src/data/session-list';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import type { RecordKind } from '@/src/exercise-calculations/records';
import type { ChangeTone } from '@/components/ui';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import {
  buildSessionRecordLine,
  PERSONAL_RECORD_NOUN,
  sessionRecordLineText,
  type SessionRecordLine,
} from '@/src/session-insights/record-line';
import {
  formatCompactDate,
  formatCompactDateRange,
  formatCompactDateTime,
  formatDateRange,
  formatMonthDayTime,
} from '@/src/utils/local-time';

/** A window of whole weeks (a week, a period) as its Monday–Sunday range, in the selected date format. */
export const formatWeekRange = (window: LocalWindow, dateFormat: ExerciseDateFormat): string => {
  const sunday = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  return formatDateRange(window.start, sunday, dateFormat);
};

/** A count's signed absolute difference: `+4`, `−3`, `0`. */
export const formatSignedCount = (difference: number): string => {
  if (difference > 0) return `+${difference}`;
  if (difference < 0) return `−${Math.abs(difference)}`;
  return '0';
};

/** Which way the pace went, for the colour every change figure takes. */
export const paceTone = (difference: number): ChangeTone =>
  difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral';

/** A window of whole weeks (a week, a period) by its Monday and Sunday, in Today's format: `5 Oct – 1 Nov 26`. */
export const formatPeriodRange = (window: LocalWindow): string => {
  const sunday = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  return formatCompactDateRange(window.start, sunday);
};

const dayOf = (window: LocalWindow, dayIndex: number) =>
  new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate() + dayIndex);

/** One day of the period against the same day of the previous period. */
export type PeriodDayFigures = {
  /** 0 is the period's first day. */
  dayIndex: number;
  date: Date;
  previousDate: Date;
  /** After today the figure is the projection's. */
  when: 'past' | 'today' | 'projected';
  workingSets: number;
  previousWorkingSets: number;
  difference: number;
};

/** The day the chart selects, clamped into the period; null is today. */
export const clampPeriodDay = (period: TodayProgressPeriod, dayIndex: number | null): number =>
  dayIndex === null ? period.dayOfPeriod - 1 : Math.min(Math.max(dayIndex, 0), period.daysInPeriod - 1);

/**
 * A day's cumulative working sets: counted through today, and after it the
 * projection's linear rate (the sets so far per elapsed day), which reaches
 * `projectedWorkingSets` on the last day.
 */
export const periodDayFigures = (period: TodayProgressPeriod, dayIndex: number | null): PeriodDayFigures => {
  const day = clampPeriodDay(period, dayIndex);
  const todayIndex = period.dayOfPeriod - 1;
  const when = day < todayIndex ? 'past' : day === todayIndex ? 'today' : 'projected';
  const workingSets =
    when === 'projected'
      ? Math.round((period.toDate.workingSets / period.dayOfPeriod) * (day + 1))
      : (period.cumulativeWorkingSets[day] ?? period.toDate.workingSets);
  const previousWorkingSets =
    when === 'today' ? period.previous.toSameDay.workingSets : (period.previous.cumulativeWorkingSets[day] ?? 0);
  return {
    dayIndex: day,
    date: dayOf(period.window, day),
    previousDate: dayOf(period.previous.window, day),
    when,
    workingSets,
    previousWorkingSets,
    difference: workingSets - previousWorkingSets,
  };
};

/**
 * `Today`, `9 Oct 26`. A projected day shows as its date alone (the hollow
 * dot on the chart marks it); spoken, it says so: `27 Oct 26 (projected)`.
 */
export const formatPeriodDayLabel = (
  figures: PeriodDayFigures,
  { spoken = false }: { spoken?: boolean } = {}
): string => {
  if (figures.when === 'today') return 'Today';
  const date = formatCompactDate(figures.date);
  return spoken && figures.when === 'projected' ? `${date} (projected)` : date;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The laps a share bar draws: up to last week's total, up to twice it, up to three times. */
export const WEEK_SHARE_LAPS = 3;

/**
 * A share bar: this week in laps of last week's total. `lap` 0 fills toward
 * last week's total; past it, lap 1 fills toward twice it over a full lap 0;
 * lap 2 toward three times, where the bar stops. With no last week, any figure
 * has passed it: a full lap 1.
 */
export const weekShare = (counts: { current: number; previous: number }): { lap: number; fraction: number } => {
  if (counts.current === 0) return { lap: 0, fraction: 0 };
  if (counts.previous === 0) return { lap: 1, fraction: 1 };
  const ratio = counts.current / counts.previous;
  const lap = Math.min(Math.ceil(ratio) - 1, WEEK_SHARE_LAPS - 1);
  return { lap, fraction: Math.min(ratio - lap, 1) };
};

const setCount = (count: number) => plural(count, 'set', 'sets');

/** The compared period, spoken: `last period`, or how far back Today stepped. */
export const comparedPeriodName = (period: Pick<TodayProgressPeriod, 'compareBack'>): string =>
  period.compareBack === 1 ? 'last period' : `period ${period.compareBack} back`;

/** Both periods and the selected day's figures, spoken as one heading. */
export const periodFiguresAccessibilityLabel = (period: TodayProgressPeriod, figures: PeriodDayFigures): string =>
  [
    `${period.weeks}-week period, ${formatPeriodRange(period.window)}:`,
    `${formatPeriodDayLabel(figures, { spoken: true })} ${setCount(figures.workingSets)},`,
    `against the ${comparedPeriodName(period)}, ${formatPeriodRange(period.previous.window)}:`,
    `${setCount(figures.previousWorkingSets)} by ${formatCompactDate(figures.previousDate)},`,
    formatSignedCount(figures.difference),
  ].join(' ');

/** The period chart's spoken summary; the chart itself is one adjustable image. */
export const periodChartAccessibilityLabel = (period: TodayProgressPeriod): string =>
  [
    `Cumulative sets: this period ${period.toDate.workingSets} by day ${period.dayOfPeriod} of ${period.daysInPeriod}`,
    `against the ${comparedPeriodName(period)} ${period.previous.toSameDay.workingSets} by day ${period.dayOfPeriod};`,
    `the ${comparedPeriodName(period)} finished at ${period.previous.total.workingSets}.`,
    `On course for ${period.projectedWorkingSets}.`,
  ].join(' ');

/** The selected day, as the adjustable chart's value. */
export const periodChartAccessibilityValue = (
  period: Pick<TodayProgressPeriod, 'compareBack'>,
  figures: PeriodDayFigures
): string =>
  `${formatPeriodDayLabel(figures, { spoken: true })}: ${setCount(figures.workingSets)}, ${comparedPeriodName(period)} ${figures.previousWorkingSets}`;

const RECORD_KIND_LABELS: Record<RecordKind, string> = { oneRepMax: '1RM', weight: 'Weight', volume: 'Volume' };

const formatRecordValue = (record: SessionPersonalRecord): string => {
  if (record.kind === 'oneRepMax') return formatOneRepMax(record.value);
  if (record.kind === 'volume') return formatVolume(record.value);
  return record.reps === null ? formatWeight(record.value) : `${formatWeight(record.value)} × ${record.reps}`;
};

/** `Bench Press 1RM 102.5`, `Squat Weight 140.0 × 5`, `Deadlift Volume 4200`: figures carry no unit. */
export const formatPersonalRecordLead = (record: SessionPersonalRecord): string =>
  [record.exerciseName.trim(), RECORD_KIND_LABELS[record.kind], formatRecordValue(record)].filter(Boolean).join(' ');

/** What a session summary row says: the latest session on Today, a row on Sessions. */
export type SessionSummaryFigures = Pick<
  LatestSessionSummary,
  'startedAt' | 'durationSec' | 'gymName' | 'workingSets' | 'exerciseCount' | 'records'
>;

/** A session's PRs: the one PR named, else only counted. */
export const sessionSummaryRecordLine = (session: SessionSummaryFigures): SessionRecordLine | null =>
  buildSessionRecordLine(session.records, formatPersonalRecordLead, PERSONAL_RECORD_NOUN);

/** `12 sets · 4 exercises`: the working sets (`training-metrics-contract.md` "Counted set"). */
export const formatSessionSummaryFigures = (session: SessionSummaryFigures): string =>
  `${plural(session.workingSets, 'set', 'sets')} · ${plural(session.exerciseCount, 'exercise', 'exercises')}`;

export const formatSessionSummaryDuration = (session: SessionSummaryFigures): string =>
  formatCompactDuration(session.durationSec);

export const sessionSummaryAccessibilityLabel = (
  session: SessionSummaryFigures,
  dateFormat: ExerciseDateFormat
): string => {
  const gym = session.gymName?.trim();
  return [
    `Completed session on ${formatMonthDayTime(session.startedAt.getTime(), dateFormat)}`,
    formatSessionSummaryDuration(session),
    plural(session.workingSets, 'set', 'sets'),
    plural(session.exerciseCount, 'exercise', 'exercises'),
    gym ? `at ${gym}` : null,
    sessionRecordLineText(sessionSummaryRecordLine(session)),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
};

export const weekFigureAccessibilityLabel = (
  label: string,
  counts: { current: number; previous: number },
  previousWeek = 'last week',
): string => `${label} ${counts.current}, vs ${counts.previous} ${previousWeek}`;

// --- The period chart's geometry ------------------------------------------

export type ChartPoint = { x: number; y: number };

export type PeriodChartGeometry = {
  plot: { width: number; top: number; bottom: number };
  current: ChartPoint[];
  previous: ChartPoint[];
  projection: { from: ChartPoint; to: ChartPoint };
  today: { current: ChartPoint; previous: ChartPoint };
  /** The selected day: on the current line through today, on the projection after it. */
  selected: { current: ChartPoint; previous: ChartPoint; projected: boolean };
  /** Where each week after the first starts. */
  weekStartsX: number[];
};

// Room on the right for the dots at the lines' ends.
export const CHART_RIGHT_GUTTER = 8;
export const CHART_HEIGHT = 126;
const PLOT_TOP = 6;
// Below the plot: the week ticks. The chart carries no axis labels.
export const CHART_AXIS_ROOM = 6;

/**
 * Day of the period on x (the first day at 0, the last at the plot's edge)
 * and cumulative working sets on y, scaled to the highest of the projection,
 * the previous period's total and today's figure.
 */
export const periodChartGeometry = (
  period: TodayProgressPeriod,
  width: number,
  height: number = CHART_HEIGHT,
  selected: PeriodDayFigures = periodDayFigures(period, null)
): PeriodChartGeometry => {
  const plotWidth = Math.max(0, width - CHART_RIGHT_GUTTER);
  const plotBottom = Math.max(PLOT_TOP, height - CHART_AXIS_ROOM);
  const days = period.daysInPeriod;
  const yMax = Math.max(1, period.projectedWorkingSets, period.previous.total.workingSets, period.toDate.workingSets);
  const x = (dayIndex: number) => (days > 1 ? (dayIndex / (days - 1)) * plotWidth : 0);
  const y = (value: number) => PLOT_TOP + (1 - value / yMax) * (plotBottom - PLOT_TOP);
  const toPoints = (values: number[]) => values.map((value, index) => ({ x: x(index), y: y(value) }));

  const current = toPoints(period.cumulativeWorkingSets);
  const previous = toPoints(period.previous.cumulativeWorkingSets);
  const todayIndex = period.dayOfPeriod - 1;
  const todayCurrent = current[todayIndex] ?? { x: x(todayIndex), y: y(period.toDate.workingSets) };
  const todayPrevious = previous[todayIndex] ?? { x: x(todayIndex), y: y(period.previous.toSameDay.workingSets) };

  return {
    plot: { width: plotWidth, top: PLOT_TOP, bottom: plotBottom },
    current,
    previous,
    projection: { from: todayCurrent, to: { x: x(days - 1), y: y(period.projectedWorkingSets) } },
    today: { current: todayCurrent, previous: todayPrevious },
    selected: {
      current: { x: x(selected.dayIndex), y: y(selected.workingSets) },
      previous: { x: x(selected.dayIndex), y: y(selected.previousWorkingSets) },
      projected: selected.when === 'projected',
    },
    weekStartsX: Array.from({ length: period.weeks - 1 }, (_, week) => x((week + 1) * 7)),
  };
};

/** The day under a touch at `x` across the plot: the nearest, within the period. */
export const periodDayAtX = (x: number, plotWidth: number, daysInPeriod: number): number => {
  if (plotWidth <= 0 || daysInPeriod <= 1) return 0;
  return Math.min(Math.max(Math.round((x / plotWidth) * (daysInPeriod - 1)), 0), daysInPeriod - 1);
};

export const toPolyline = (points: ChartPoint[]): string =>
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

// --- The session card ------------------------------------------------------

/** `100.0 × 5`: a best set's Weight as entered and its reps. */
export const formatBestSet = (bestSet: { weightKg: number; reps: number }): string =>
  `${formatWeight(bestSet.weightKg)} × ${bestSet.reps}`;

/** `1 PR`, `2 PRs`: the session's PRs, one per record kind ([[set.eligibility]]). */
export const formatRecordCount = (count: number): string => plural(count, 'PR', 'PRs');

const exerciseLineText = (line: SessionExerciseLine): string =>
  [
    line.name,
    plural(line.workingSets, 'set', 'sets'),
    line.bestSet ? `best ${line.bestSet.weightKg} by ${line.bestSet.reps}, 1RM ${formatOneRepMax(line.bestSet.oneRepMaxKg)}` : null,
    line.oneRepMaxRecord ? 'a 1RM PR' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

/** The session card's body, spoken: when, what, where, its PRs, then each exercise. */
export const todaySessionAccessibilityLabel = (session: LatestSessionSummary): string => {
  const gym = session.gymName?.trim();
  return [
    `Session on ${formatCompactDateTime(session.startedAt.getTime())}`,
    plural(session.exerciseCount, 'exercise', 'exercises'),
    plural(session.workingSets, 'set', 'sets'),
    formatRecordCount(session.records.length),
    gym ? `at ${gym}` : null,
    ...session.exercises.map(exerciseLineText),
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
};
