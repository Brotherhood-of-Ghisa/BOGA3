import type { ExerciseDateFormat } from '../preferences/model';
import { formatOneRepMax, formatVolume } from '../exercise-calculations/format';
import { formatCalendarWeek, formatCalendarWeekHeading, formatCompactDateRange } from '../utils/local-time';
import type { CoWMetric } from './cow-scoring';
import type { CoWDefinitionWire, CoWRankingWire, CoWResultWire } from './cow-wire';
import { COMPETITION_UNIT_LABELS } from './competition-view-model';

export const COW_METRIC_LABELS: Record<CoWMetric, string> = { e1rm: '1RM', improvement: 'Improvement', volume: 'Volume' };
export const COW_FORM_LABELS: Record<CoWMetric, string> = { e1rm: 'Highest 1RM', improvement: '1RM improvement (%)', volume: 'Total Volume' };
export const COW_METRICS: readonly CoWMetric[] = ['e1rm', 'improvement', 'volume'];
export const coWMetric = (value: string | null | undefined, metrics: readonly CoWMetric[]): CoWMetric =>
  metrics.find(metric => metric === value) ?? metrics[0];

/** A server calendar key already names the group day; never reinterpret its UTC instant locally. */
export function coWDateRange(week: string, dateFormat: ExerciseDateFormat, today = false): string {
  if (!today) return formatCalendarWeekHeading(week, dateFormat);
  const start = new Date(`${week}T12:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return formatCompactDateRange(start, end);
}
export const coWAccessibleDates = (week: string, format: ExerciseDateFormat) => formatCalendarWeek(week, format);
export function coWStatus(cow: CoWDefinitionWire, resultState?: CoWResultWire['state']): string {
  if (resultState === 'pending' && cow.state === 'active') return 'Updating';
  return { scheduled: 'Upcoming', active: 'Live', finalizing: 'Finalizing', final: 'Final', unavailable: 'Unavailable', cancelled: 'Cancelled' }[cow.state];
}
export function coWMetricHeading(ranking: Pick<CoWRankingWire, 'metric' | 'unit'>): string {
  const unit = ranking.unit === 'percent' ? '%' : ranking.unit ? COMPETITION_UNIT_LABELS[ranking.unit] : '';
  return [COW_METRIC_LABELS[ranking.metric], unit].filter(Boolean).join(' ');
}
export function coWFigure(value: number, metric: CoWMetric): string {
  if (metric === 'volume') return formatVolume(value);
  if (metric === 'e1rm') return formatOneRepMax(value);
  const magnitude = formatOneRepMax(Math.abs(value));
  return `${Number(magnitude) === 0 ? '' : value > 0 ? '+' : '−'}${magnitude}%`;
}
