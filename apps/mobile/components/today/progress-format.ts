// The Progress card's words and chart geometry (pure). The figures come from
// `src/progress-summary`; this file only says them (`ux-rules.md` §7, §13).

import type { LatestSessionSummary, SessionPersonalRecord, TodayProgressMonth } from '@/src/progress-summary';
import type { LocalWindow } from '@/src/utils/local-calendar';
import { formatCompactDuration } from '@/src/data/session-list';
import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import type { RecordKind } from '@/src/exercise-calculations/records';
import {
  buildSessionRecordLine,
  PERSONAL_RECORD_NOUN,
  sessionRecordLineText,
  type SessionRecordLine,
} from '@/src/session-insights/record-line';
import { formatMonthDayTime } from '@/src/utils/local-time';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const monthName = (date: Date): string => MONTHS[date.getMonth()];
export const shortMonthName = (date: Date): string => monthName(date).slice(0, 3);

const dayLabel = (date: Date, withMonth: boolean): string =>
  `${WEEKDAYS[date.getDay()]} ${date.getDate()}${withMonth ? ` ${shortMonthName(date)}` : ''}`;

/** `Mon 13 – Sun 19`; a week across two months names both (`Mon 29 Sep – Sun 5 Oct`). */
export const formatWeekRange = (window: LocalWindow): string => {
  const sunday = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  const acrossMonths = sunday.getMonth() !== window.start.getMonth();
  return `${dayLabel(window.start, acrossMonths)} – ${dayLabel(sunday, acrossMonths)}`;
};

/** A count's signed absolute difference (`ux-rules.md` §13.2): `+4`, `−3`, `±0`. */
export const formatSignedCount = (difference: number): string => {
  if (difference > 0) return `+${difference}`;
  if (difference < 0) return `−${Math.abs(difference)}`;
  return '±0';
};

export const paceDifference = (month: TodayProgressMonth): number =>
  month.toDate.workingSets - month.previous.toSameDay.workingSets;

/** `ahead of Sep's pace` / `behind Sep's pace` / `level with Sep's pace`. */
export const formatPacePhrase = (month: TodayProgressMonth): string => {
  const difference = paceDifference(month);
  const relation = difference > 0 ? 'ahead of' : difference < 0 ? 'behind' : 'level with';
  return `${relation} ${shortMonthName(month.previous.window.start)}'s pace`;
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

const ordinal = (day: number): string => {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th');
  return `${day}${suffix}`;
};

/** The month chart's spoken summary; the chart itself is one image. */
export const monthChartAccessibilityLabel = (month: TodayProgressMonth): string => {
  const sameDay = Math.min(month.dayOfMonth, month.previous.daysInMonth);
  return [
    `Cumulative sets: ${monthName(month.window.start)} ${month.toDate.workingSets} by the ${ordinal(month.dayOfMonth)}`,
    `against ${monthName(month.previous.window.start)} ${month.previous.toSameDay.workingSets} by the ${ordinal(sameDay)};`,
    `${monthName(month.previous.window.start)} finished at ${month.previous.total.workingSets}.`,
    `On course for ${month.projectedWorkingSets}.`,
  ].join(' ');
};

const RECORD_KIND_LABELS: Record<RecordKind, string> = { oneRepMax: '1RM', weight: 'Weight', volume: 'Volume' };

const formatRecordValue = (record: SessionPersonalRecord): string => {
  if (record.kind === 'oneRepMax') return formatOneRepMax(record.value);
  if (record.kind === 'volume') return formatVolume(record.value);
  return record.reps === null ? formatWeight(record.value) : `${formatWeight(record.value)} × ${record.reps}`;
};

/** `Bench Press 1RM 102.5`, `Squat Weight 140.0 × 5`, `Deadlift Volume 4200`: figures carry no unit. */
export const formatPersonalRecordLead = (record: SessionPersonalRecord): string =>
  [record.exerciseName.trim(), RECORD_KIND_LABELS[record.kind], formatRecordValue(record)].filter(Boolean).join(' ');

/** The latest session's PRs: the one PR named, else only counted. */
export const latestRecordLine = (latest: LatestSessionSummary): SessionRecordLine | null =>
  buildSessionRecordLine(latest.records, formatPersonalRecordLead, PERSONAL_RECORD_NOUN);

/** `12 sets · 4 exercises`: the working sets (`ux-rules.md` §5.11). */
export const formatLatestFigures = (latest: LatestSessionSummary): string =>
  `${plural(latest.workingSets, 'set', 'sets')} · ${plural(latest.exerciseCount, 'exercise', 'exercises')}`;

export const formatLatestDuration = (latest: LatestSessionSummary): string =>
  formatCompactDuration(latest.durationSec);

export const latestSessionAccessibilityLabel = (latest: LatestSessionSummary): string => {
  const gym = latest.gymName?.trim();
  return [
    `Completed session on ${formatMonthDayTime(latest.startedAt.getTime())}`,
    formatLatestDuration(latest),
    plural(latest.workingSets, 'set', 'sets'),
    plural(latest.exerciseCount, 'exercise', 'exercises'),
    gym ? `at ${gym}` : null,
    sessionRecordLineText(latestRecordLine(latest)),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
};

export const weekFigureAccessibilityLabel = (label: string, counts: { current: number; previous: number }): string =>
  `${label} ${counts.current}, vs ${counts.previous} last week`;

// --- The month chart's geometry -------------------------------------------

export type ChartPoint = { x: number; y: number };

export type MonthChartGeometry = {
  plot: { width: number; top: number; bottom: number };
  current: ChartPoint[];
  previous: ChartPoint[];
  projection: { from: ChartPoint; to: ChartPoint };
  today: { current: ChartPoint; previous: ChartPoint };
  monthEndX: number;
};

// Room on the right for the previous month's name at the end of its line.
export const CHART_RIGHT_GUTTER = 34;
export const CHART_HEIGHT = 104;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 86;

/**
 * Day of month on x (the 1st at 0; the longer of the two months spans the
 * plot) and cumulative working sets on y, scaled to the highest of the
 * projection, the previous month's total and today's figure.
 */
export const monthChartGeometry = (month: TodayProgressMonth, width: number): MonthChartGeometry => {
  const plotWidth = Math.max(0, width - CHART_RIGHT_GUTTER);
  const days = Math.max(month.daysInMonth, month.previous.daysInMonth);
  const yMax = Math.max(1, month.projectedWorkingSets, month.previous.total.workingSets, month.toDate.workingSets);
  const x = (dayIndex: number) => (days > 1 ? (dayIndex / (days - 1)) * plotWidth : 0);
  const y = (value: number) => PLOT_TOP + (1 - value / yMax) * (PLOT_BOTTOM - PLOT_TOP);
  const toPoints = (values: number[]) => values.map((value, index) => ({ x: x(index), y: y(value) }));

  const current = toPoints(month.cumulativeWorkingSets);
  const previous = toPoints(month.previous.cumulativeWorkingSets);
  const todayIndex = month.dayOfMonth - 1;
  const todayCurrent = current[todayIndex] ?? { x: x(todayIndex), y: y(month.toDate.workingSets) };
  const sameDayIndex = Math.min(month.dayOfMonth, month.previous.daysInMonth) - 1;
  const todayPrevious = previous[sameDayIndex] ?? { x: x(sameDayIndex), y: y(month.previous.toSameDay.workingSets) };

  return {
    plot: { width: plotWidth, top: PLOT_TOP, bottom: PLOT_BOTTOM },
    current,
    previous,
    projection: { from: todayCurrent, to: { x: x(month.daysInMonth - 1), y: y(month.projectedWorkingSets) } },
    today: { current: todayCurrent, previous: todayPrevious },
    monthEndX: x(month.daysInMonth - 1),
  };
};

export const toPolyline = (points: ChartPoint[]): string =>
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
