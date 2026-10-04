import { sessionBodyWeightForCalculation, type SessionWeightContext } from '../bodyweight/as-of.ts';
import { parseSetWeight } from './index.ts';
import { formatVolume } from './format.ts';
import { compareWeightRecord } from './records.ts';
import { canonicalizeWeightForReps, isWorkingSet, isVolumeSet } from './set-semantics.ts';
import type { EffortCalculationPolicy } from './effort-policy.ts';
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
  effortPolicy?: EffortCalculationPolicy,
): LoadContext => ({
  effortPolicy,
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

/**
 * The sets a stat reads (`isWorkingSet`): filter before summarizing. Per-set
 * figures still come from `calculateAnalyticsSetMetrics` on any row.
 */
export const workingSetsOnly = <T extends AnalyticsSetInput>(sets: readonly T[], policy?: EffortCalculationPolicy): T[] =>
  sets.filter(set => isWorkingSet({
    weight: set.weightValue ?? '', reps: set.repsValue ?? '',
    performanceStatus: set.performanceStatus, setType: set.setType,
  }, policy));

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
  const volumeCoverage = summarizeVolume(metrics.filter((_, index) => isVolumeSet({
    weight: sets[index].weightValue ?? '', reps: sets[index].repsValue ?? '',
    performanceStatus: sets[index].performanceStatus, setType: sets[index].setType,
  }, context.effortPolicy)));
  let estimatedOneRepMax: number | null = null;
  let topWeightSet: { weight: number; reps: number } | null = null;
  for (const [index, metric] of metrics.entries()) {
    if (!metric.eligible || !isWorkingSet({ weight: sets[index].weightValue ?? '', reps: sets[index].repsValue ?? '',
      performanceStatus: sets[index].performanceStatus, setType: sets[index].setType }, context.effortPolicy)) continue;
    if (metric.estimatedOneRepMaxKg !== null) {
      estimatedOneRepMax = Math.max(estimatedOneRepMax ?? 0, metric.estimatedOneRepMaxKg);
    }
    const weight = enteredWeightKg(sets[index]);
    // The Weight record's order (`records.ts`); the first set keeps a full tie.
    if (weight !== null && (topWeightSet === null || compareWeightRecord({ weight, reps: metric.reps }, topWeightSet) > 0)) {
      topWeightSet = { weight, reps: metric.reps };
    }
  }
  return { metrics, volumeCoverage, estimatedOneRepMax, topWeightSet };
}

export function formatVolumeWithCoverage(total: number | null, known: number | null = 0): string {
  if (total !== null && Number.isFinite(total)) return formatVolume(total);
  return known !== null && Number.isFinite(known) && known > 0 ? `${formatVolume(known)} · incomplete` : '— · unavailable';
}

/** Preserve unknown/overflow across rollups; omitted subtotals start at zero. */
export function addFiniteVolume(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left === null || right === null) return null;
  const sum = (left ?? 0) + (right ?? 0);
  return Number.isFinite(sum) ? sum : null;
}

/** Compact session figures and a full-width coverage note travel together. */
export function sessionVolumeSummary(coverage: VolumeCoverage): { volume: string; volumeNote?: string } {
  if (coverage.totalVolumeKgReps !== null) return { volume: formatVolume(coverage.totalVolumeKgReps) };
  if (coverage.knownSetCount === 0 || coverage.knownVolumeKgReps === null) {
    return { volume: '—', volumeNote: coverage.overflow
      ? 'Volume unavailable. The combined load exceeds the supported numeric range.'
      : 'Volume unavailable. Some included sets have missing or invalid load information.' };
  }
  return { volume: formatVolume(coverage.knownVolumeKgReps),
    volumeNote: `Volume incomplete. Known subtotal from ${coverage.knownSetCount} of ${coverage.eligibleSetCount} included sets.` };
}

/** Numeric slot only: callers must render coverage alongside this figure. */
export function compactVolumeFigure(total: number | null, known?: number | null): string {
  if (total !== null && Number.isFinite(total)) return formatVolume(total);
  return known != null && Number.isFinite(known) && known > 0 ? formatVolume(known) : '—';
}
