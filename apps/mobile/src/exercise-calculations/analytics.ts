import { sessionBodyWeightForCalculation, type SessionWeightContext } from '../bodyweight/snapshot.ts';
import { parseSetWeight } from './index.ts';
import { canonicalizeWeightForReps } from '../session-recorder/set-semantics.ts';
import {
  calculateEffectiveSetMetrics, isWeightUnit, summarizeEffectiveVolume, weightToKg,
  type EffectiveSetInput, type LoadContext, type VolumeCoverage,
} from './effective-load.ts';

/** Older conventional callers can omit context; data adapters supply it once per graph. */
export const exerciseLoadContext = (
  definition?: { bodyweightCoefficient?: number; loadInputMode?: string; localBodyweightMetadataKnown?: boolean } | null,
  session?: SessionWeightContext | null,
): LoadContext => ({
  bodyweightCoefficient: definition?.localBodyweightMetadataKnown === false ? NaN : definition?.bodyweightCoefficient ?? 0,
  loadInputMode: definition?.loadInputMode ?? 'total_load',
  bodyWeightKg: sessionBodyWeightForCalculation(session),
});

export type AnalyticsSetInput = Omit<EffectiveSetInput, keyof LoadContext> & { localBodyweightMetadataKnown?: boolean };

/** Local upgrade placeholders are not a source of load units or interpretation. */
export function calculateAnalyticsSetMetrics(input: EffectiveSetInput & { localBodyweightMetadataKnown?: boolean }) {
  return calculateEffectiveSetMetrics(input.localBodyweightMetadataKnown === false
    ? { ...input, bodyweightCoefficient: NaN } : input);
}

/** Top external weight remains an added-load record, never an assistance record. */
export function enteredAddedWeightKg(set: AnalyticsSetInput, context: LoadContext): number | null {
  if (set.localBodyweightMetadataKnown === false) return null;
  if (set.externalLoadMode !== 'added' && !(context.bodyweightCoefficient === 0 && set.externalLoadMode == null)) return null;
  const unit = set.weightUnit === undefined ? 'kg' : set.weightUnit;
  const value = parseSetWeight(canonicalizeWeightForReps(set.weightValue ?? '', set.repsValue ?? ''));
  return value === null || !isWeightUnit(unit) ? null : weightToKg(value, unit);
}

export function summarizeExerciseLoad(sets: readonly AnalyticsSetInput[], context: LoadContext = exerciseLoadContext()) {
  const metrics = sets.map(set => calculateAnalyticsSetMetrics({ ...set, ...context }));
  const volumeCoverage = summarizeEffectiveVolume(metrics);
  let estimatedOneRepMax: number | null = null;
  let topWeightSet: { weight: number; reps: number } | null = null;
  for (const [index, metric] of metrics.entries()) {
    if (!metric.eligible) continue;
    if (metric.estimatedOneRepMaxKg !== null) {
      estimatedOneRepMax = Math.max(estimatedOneRepMax ?? 0, metric.estimatedOneRepMaxKg);
    }
    const weight = enteredAddedWeightKg(sets[index], context);
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

/** Preserve unknown/overflow across rollups; omitted legacy subtotals start at zero. */
export function addFiniteVolume(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left === null || right === null) return null;
  const sum = (left ?? 0) + (right ?? 0);
  return Number.isFinite(sum) ? sum : null;
}

/** Raw external amount with its meaning; derived resistance never replaces it. */
export function formatEnteredLoad(
  weight: number | null, context: LoadContext, externalLoadMode?: string | null,
  weightUnit?: string | null, formatWeight: (weight: number) => string = value => value.toFixed(1),
): string {
  const bodyweight = context.bodyweightCoefficient > 0;
  if (externalLoadMode === 'unquantified_assistance') return 'Unquantified assistance';
  const body = context.bodyweightCoefficient === 1 ? 'BW' : `${Number((100 * context.bodyweightCoefficient).toFixed(3))}% BW`;
  const prefix = !bodyweight ? '' : externalLoadMode === 'added' ? `${body} + ` : externalLoadMode === 'assistance' ? `${body} − ` : 'Original ';
  const unit = bodyweight || weightUnit === 'lb' ? ` ${weightUnit ?? 'kg'}` : '';
  const side = bodyweight && context.loadInputMode === 'per_side_load' ? '/side' : '';
  return `${prefix}${weight === null ? '—' : formatWeight(weight)}${unit}${side}`;
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
