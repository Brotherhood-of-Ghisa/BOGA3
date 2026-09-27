import { canonicalizeWeightForReps } from '@/src/session-recorder/set-semantics';
import { parseSetWeight } from '@/src/exercise-calculations';
import type { SessionBodyWeightSnapshot } from '@/src/data/session-drafts';
import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import { calculateAnalyticsSetMetrics, exerciseLoadContext } from '@/src/exercise-calculations/analytics';
import { estimateExternalLoad, type LoadContext, type WeightUnit } from '@/src/exercise-calculations/effective-load';

export type LoadingEstimateSource = SessionBodyWeightSnapshot & {
  id: string;
  sessionId: string;
  completedAt: Date;
  weightValue: string;
  weightUnit: string;
  loadInputMode: string;
  externalLoadMode: string | null;
  reps: number;
  bodyWeightKg: number | null;
  estimatedOneRepMaxKg: number;
  effectiveLoadKg: number;
};

/** Historical B belongs to each source; target B never rescales this estimate. */
export function loadingEstimateSources(entries: ExerciseHistorySessionEntry[]): LoadingEstimateSource[] {
  const sources: LoadingEstimateSource[] = [];
  for (const entry of entries) {
    const context = entry.loadContext ?? exerciseLoadContext();
    for (const set of entry.sets) {
      const metric = calculateAnalyticsSetMetrics({ ...set, ...context });
      if (!metric.eligible || metric.load.status !== 'known' || metric.estimatedOneRepMaxKg === null) continue;
      sources.push({ id: `${entry.sessionExerciseId}:${set.setId}`, sessionId: entry.sessionId,
        completedAt: entry.completedAt, weightValue: canonicalizeWeightForReps(set.weightValue, set.repsValue), weightUnit: set.weightUnit ?? 'kg',
        externalLoadMode: set.externalLoadMode ?? null, reps: metric.reps,
        bodyWeightSource: entry.bodyWeightSource, bodyWeightMeasurementId: entry.bodyWeightMeasurementId, bodyWeightMeasuredAt: entry.bodyWeightMeasuredAt,
        bodyWeightKg: context.bodyWeightKg ?? null, estimatedOneRepMaxKg: metric.estimatedOneRepMaxKg,
        effectiveLoadKg: metric.load.resistanceKg, loadInputMode: context.loadInputMode });
    }
  }
  return sources.sort((a, b) => b.estimatedOneRepMaxKg - a.estimatedOneRepMaxKg ||
    b.completedAt.getTime() - a.completedAt.getTime() || a.id.localeCompare(b.id));
}

export function projectLoadingEstimate(source: LoadingEstimateSource, context: LoadContext,
  target: { reps: string; bodyWeightKg: string; unit: WeightUnit }) {
  if (!/^\d+$/.test(target.reps.trim()) || Number(target.reps) <= 0 || !Number.isSafeInteger(Number(target.reps))) {
    throw new Error('Enter a positive whole number of target reps.');
  }
  const bodyWeightKg = parseSetWeight(target.bodyWeightKg);
  if (context.bodyweightCoefficient > 0 && (bodyWeightKg === null || !Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0)) {
    throw new Error('Enter a positive target body weight in kg.');
  }
  const result = estimateExternalLoad({ ...context, bodyWeightKg, estimatedOneRepMaxKg: source.estimatedOneRepMaxKg,
    targetReps: Number(target.reps), weightUnit: target.unit, oneRepConvention: 'capacity' });
  if (result.status !== 'known') throw new Error('This load cannot be estimated from the supplied exercise rules.');
  return result;
}
