import { sessionBodyWeightForCalculation, type SessionWeightContext } from '../bodyweight/as-of.ts';
import { parseSetWeight } from './index.ts';
import { canonicalizeWeightForReps } from '../session-recorder/set-semantics.ts';
import {
  calculateSetMetrics, summarizeVolume,
  type LoadContext, type LoadInputMode, type SetMetricInput, type VolumeCoverage,
} from './load-metrics.ts';

export const ordinaryLoadContext = (loadInputMode: LoadInputMode = 'total_load'): LoadContext => ({
  policy: 'ordinary',
  bodyweightContribution: 0,
  loadInputMode,
});

/** Personal policy uses zero for a missing applicable reading. */
export const personalLoadContext = (
  enabled: boolean,
  definition?: { bodyweightContribution?: number; loadInputMode?: LoadInputMode } | null,
  session?: SessionWeightContext | null,
): LoadContext => ({
  policy: enabled ? 'personal' : 'ordinary',
  bodyweightContribution: enabled ? definition?.bodyweightContribution ?? 0 : 0,
  loadInputMode: definition?.loadInputMode ?? 'total_load',
  bodyWeightKg: enabled ? sessionBodyWeightForCalculation(session) : null,
});

/** Group policy keeps positive-contribution scores absent without a reading. */
export const groupLoadContext = (
  enabled: boolean,
  definition: { bodyweightContribution: number; loadInputMode: LoadInputMode },
  bodyWeightKg: number | null,
): LoadContext => ({
  policy: enabled ? 'group' : 'ordinary',
  bodyweightContribution: enabled ? definition.bodyweightContribution : 0,
  loadInputMode: definition.loadInputMode,
  bodyWeightKg: enabled ? bodyWeightKg : null,
});

export type AnalyticsSetInput = Omit<SetMetricInput, keyof LoadContext>;

/** Resolve derived metrics from the entered Weight and internal calculation context. */
export function calculateAnalyticsSetMetrics(input: SetMetricInput) {
  return calculateSetMetrics(input);
}

/** Raw entered Weight is already kg; bodyweight contribution never changes it. */
export function enteredWeightKg(set: AnalyticsSetInput): number | null {
  const value = parseSetWeight(canonicalizeWeightForReps(set.weightValue ?? '', set.repsValue ?? ''));
  return value;
}

export function summarizeExerciseLoad(
  sets: readonly AnalyticsSetInput[],
  context: LoadContext = ordinaryLoadContext(),
) {
  const metrics = sets.map(set => calculateAnalyticsSetMetrics({ ...set, ...context }));
  const volumeCoverage = summarizeVolume(metrics);
  let estimatedOneRepMax: number | null = null;
  let topWeightSet: { weight: number; reps: number } | null = null;
  for (const [index, metric] of metrics.entries()) {
    if (!metric.eligible) continue;
    if (metric.estimatedOneRepMaxKg !== null) {
      estimatedOneRepMax = Math.max(estimatedOneRepMax ?? 0, metric.estimatedOneRepMaxKg);
    }
    const weight = enteredWeightKg(sets[index]);
    if (weight !== null && (topWeightSet === null || weight > topWeightSet.weight ||
      (weight === topWeightSet.weight && metric.reps > topWeightSet.reps))) {
      topWeightSet = { weight, reps: metric.reps };
    }
  }
  return { metrics, volumeCoverage, estimatedOneRepMax, topWeightSet };
}

export function formatVolumeWithCoverage(total: number | null, known: number | null = 0): string {
  if (total !== null && Number.isFinite(total)) return String(Math.round(total));
  return known !== null && Number.isFinite(known) && known > 0 ? `${Math.round(known)} · incomplete` : '— · unavailable';
}

/** Preserve unknown/overflow across rollups; omitted subtotals start at zero. */
export function addFiniteVolume(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left === null || right === null) return null;
  const sum = (left ?? 0) + (right ?? 0);
  return Number.isFinite(sum) ? sum : null;
}

/** Compact session figures and a full-width coverage note travel together. */
export function sessionVolumeSummary(coverage: VolumeCoverage): { volume: string; volumeNote?: string } {
  if (coverage.totalVolumeKgReps !== null) return { volume: String(Math.round(coverage.totalVolumeKgReps)) };
  if (coverage.knownSetCount === 0 || coverage.knownVolumeKgReps === null) {
    return { volume: '—', volumeNote: coverage.overflow
      ? 'Volume unavailable. The combined load exceeds the supported numeric range.'
      : 'Volume unavailable. Some performed sets have missing or invalid load information.' };
  }
  return { volume: String(Math.round(coverage.knownVolumeKgReps)),
    volumeNote: `Volume incomplete. Known subtotal from ${coverage.knownSetCount} of ${coverage.eligibleSetCount} performed sets.` };
}

/** Numeric slot only: callers must render coverage alongside this figure. */
export function compactVolumeFigure(total: number | null, known?: number | null): string {
  if (total !== null && Number.isFinite(total)) return String(Math.round(total));
  return known != null && Number.isFinite(known) && known > 0 ? String(Math.round(known)) : '—';
}
