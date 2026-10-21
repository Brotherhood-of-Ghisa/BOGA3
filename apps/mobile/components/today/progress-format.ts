// The Progress card's words and chart geometry (pure). The figures come from
// `src/progress-summary`; this file only says them.

import type { LatestSessionSummary, SessionPersonalRecord, TodayProgressPeriod } from '@/src/progress-summary';
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
import { formatMonthDayTime, formatDateRange } from '@/src/utils/local-time';

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

/** The local Monday–Sunday range in the selected date format. */
export const formatWeekRange = (window: LocalWindow, dateFormat: ExerciseDateFormat): string => {
  const sunday = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  return formatDateRange(window.start, sunday, dateFormat);
};

/** A count's signed absolute difference: `+4`, `−3`, `±0`. */
export const formatSignedCount = (difference: number): string => {
  if (difference > 0) return `+${difference}`;
  if (difference < 0) return `−${Math.abs(difference)}`;
  return '±0';
};

/** Which way the pace went, for the colour every change figure takes. */
export const paceTone = (difference: number): ChangeTone =>
  difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral';

export const paceDifference = (period: TodayProgressPeriod): number =>
  period.toDate.workingSets - period.previous.toSameDay.workingSets;

/** Names the configured preceding block alongside the signed count. */
export const formatPacePhrase = (period: TodayProgressPeriod): string => {
  const difference = paceDifference(period);
  const relation = difference > 0 ? 'ahead of' : difference < 0 ? 'behind' : 'level with';
  return `${relation} the previous ${period.weeks === 1 ? 'week' : `${period.weeks} weeks`}`;
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

/** The period chart's spoken summary; the chart itself is one image. */
export const periodChartAccessibilityLabel = (period: TodayProgressPeriod): string => {
  const sameDay = Math.min(period.elapsedDays, period.previous.totalDays);
  return [
    `Cumulative sets: ${period.weeks} ${period.weeks === 1 ? 'week' : 'weeks'}, ${period.toDate.workingSets} by day ${period.elapsedDays}`,
    `against ${period.previous.toSameDay.workingSets} by day ${sameDay} in the preceding block;`,
    `The preceding block finished at ${period.previous.total.workingSets}.`,
    `On course for ${period.projectedWorkingSets}.`,
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

export const weekFigureAccessibilityLabel = (label: string, counts: { current: number; previous: number }): string =>
  `${label} ${counts.current}, vs ${counts.previous} last week`;

// --- The period chart's geometry -------------------------------------------

export type ChartPoint = { x: number; y: number };

export type PeriodChartGeometry = {
  plot: { width: number; top: number; bottom: number };
  current: ChartPoint[];
  previous: ChartPoint[];
  projection: { from: ChartPoint; to: ChartPoint };
  today: { current: ChartPoint; previous: ChartPoint };
  periodEndX: number;
};

// Room on the right for the preceding block's label at the end of its line.
export const CHART_RIGHT_GUTTER = 40;
export const CHART_HEIGHT = 104;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 86;

/**
 * Day of the configured block on x (its first Monday at 0) and cumulative working sets on y, scaled to the highest of the
 * projection, the previous period's total and today's figure.
 */
export const periodChartGeometry = (period: TodayProgressPeriod, width: number): PeriodChartGeometry => {
  const plotWidth = Math.max(0, width - CHART_RIGHT_GUTTER);
  const days = Math.max(period.totalDays, period.previous.totalDays);
  const yMax = Math.max(1, period.projectedWorkingSets, period.previous.total.workingSets, period.toDate.workingSets);
  const x = (dayIndex: number) => (days > 1 ? (dayIndex / (days - 1)) * plotWidth : 0);
  const y = (value: number) => PLOT_TOP + (1 - value / yMax) * (PLOT_BOTTOM - PLOT_TOP);
  const toPoints = (values: number[]) => values.map((value, index) => ({ x: x(index), y: y(value) }));

  const current = toPoints(period.cumulativeWorkingSets);
  const previous = toPoints(period.previous.cumulativeWorkingSets);
  const todayIndex = period.elapsedDays - 1;
  const todayCurrent = current[todayIndex] ?? { x: x(todayIndex), y: y(period.toDate.workingSets) };
  const sameDayIndex = Math.min(period.elapsedDays, period.previous.totalDays) - 1;
  const todayPrevious = previous[sameDayIndex] ?? { x: x(sameDayIndex), y: y(period.previous.toSameDay.workingSets) };

  return {
    plot: { width: plotWidth, top: PLOT_TOP, bottom: PLOT_BOTTOM },
    current,
    previous,
    projection: { from: todayCurrent, to: { x: x(period.totalDays - 1), y: y(period.projectedWorkingSets) } },
    today: { current: todayCurrent, previous: todayPrevious },
    periodEndX: x(period.totalDays - 1),
  };
};

export const toPolyline = (points: ChartPoint[]): string =>
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
