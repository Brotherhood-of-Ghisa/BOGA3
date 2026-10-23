import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import { historyWeekBounds, localDateKey, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';
import { collectMuscleSetContributions, type MuscleAnalyticsInput, type MuscleSetContribution } from './muscle-analytics';

export type MuscleTrainingStarts = Record<string, { workingSetCount?: Date; totalVolume?: Date }>;
export type MuscleTickerObservation = { at: Date; value: number | null };
export type MuscleTickerSeries = { observations: MuscleTickerObservation[]; reference: number | null };
export type ProgressMuscleTickers = {
  start: Date; end: Date; rollingWeeks: number;
  muscles: Record<string, { workingSetCount: MuscleTickerSeries; totalVolume: MuscleTickerSeries }>;
};
export type MuscleTickerOptions = { historyWeeks: number; rollingWeeks: number; weeklyTarget: number; now?: Date; gymId?: string | null };

export const muscleTickerBounds = (options: MuscleTickerOptions) => {
  const now = options.now ?? new Date();
  const visible = historyWeekBounds(options.historyWeeks, now);
  return { ...visible, readStart: shiftCalendarWeeks(visible.start, -options.rollingWeeks) };
};

// Range sums avoid rescanning years of sets per day. A tree also recovers after
// an overflowing old window leaves, without subtracting rounded large totals.
const volumeRangeSum = (rows: MuscleSetContribution[]) => {
  const size = 2 ** Math.ceil(Math.log2(Math.max(rows.length, 1)));
  const tree: (number | null)[] = Array(size * 2).fill(0);
  rows.forEach((row, index) => { tree[size + index] = row.volumeIncluded ? row.weightedVolume ?? 0 : 0; });
  for (let index = size - 1; index > 0; index--) tree[index] = addFiniteVolume(tree[index * 2], tree[index * 2 + 1]);
  return (from: number, to: number) => {
    let total: number | null = 0;
    for (let left = from + size, right = to + size; left < right; left = Math.floor(left / 2), right = Math.floor(right / 2)) {
      if (left % 2) total = addFiniteVolume(total, tree[left++]);
      if (right % 2) total = addFiniteVolume(total, tree[--right]);
    }
    return total;
  };
};

const muscleObservations = (rows: MuscleSetContribution[], days: Date[], weeks: number, firstTraining: Date | undefined, metric: 'workingSetCount' | 'totalVolume') => {
  const volume = metric === 'totalVolume' ? volumeRangeSum(rows) : null;
  const counts = [0];
  for (const row of rows) counts.push(counts[counts.length - 1] + (row.working ? row.roleWeight : 0));
  const observations: MuscleTickerObservation[] = [];
  let from = 0;
  let to = 0;
  for (const at of days) {
    const start = shiftCalendarWeeks(at, -weeks);
    while (from < rows.length && rows[from].sessionCompletedAt < start) from++;
    while (to < rows.length && rows[to].sessionCompletedAt <= at) to++;
    const complete = firstTraining !== undefined && shiftCalendarWeeks(firstTraining, weeks) <= at;
    observations.push({ at, value: complete ? metric === 'workingSetCount' ? counts[to] - counts[from] : volume!(from, to) : null });
  }
  return observations;
};

const medianReference = (observations: MuscleTickerObservation[]) => {
  const known = observations.flatMap(row => row.value === null ? [] : [row.value]).sort((a, b) => a - b);
  if (known.length < MIN_HISTORY_OBSERVATIONS) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : known[middle - 1] / 2 + known[middle] / 2;
};

export function aggregateProgressMuscleTickers(input: MuscleAnalyticsInput, options: MuscleTickerOptions,
  firstTraining: MuscleTrainingStarts): ProgressMuscleTickers {
  const { start, end } = muscleTickerBounds(options);
  const byMuscle = new Map<string, MuscleSetContribution[]>();
  for (const row of collectMuscleSetContributions(input)) {
    const rows = byMuscle.get(row.muscleGroupId) ?? [];
    rows.push(row);
    byMuscle.set(row.muscleGroupId, rows);
  }
  const muscles: ProgressMuscleTickers['muscles'] = {};
  for (const [id, rows] of byMuscle) {
    const observations = (metric: 'workingSetCount' | 'totalVolume') => {
      const eligible = rows.filter(row => metric === 'workingSetCount' ? row.working : row.volumeIncluded);
      const days = new Map<string, Date>();
      for (const row of eligible) {
        if (row.sessionCompletedAt >= start && row.sessionCompletedAt <= end) {
          days.set(localDateKey(row.sessionCompletedAt), row.sessionCompletedAt);
        }
      }
      return muscleObservations(eligible, [...days.values()], options.rollingWeeks, firstTraining[id]?.[metric], metric);
    };
    const volume = observations('totalVolume');
    muscles[id] = {
      workingSetCount: { observations: observations('workingSetCount'), reference: options.weeklyTarget * options.rollingWeeks },
      totalVolume: { observations: volume, reference: medianReference(volume) },
    };
  }
  return { start, end, rollingWeeks: options.rollingWeeks, muscles };
}
