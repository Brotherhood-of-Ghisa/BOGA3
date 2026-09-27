// Pure M27 boundary shared by mobile and Deno consumers. No persistence,
// platform, auth or UI dependencies; every runtime import names its .ts file.
import { estimateOneRepMax, parseSetReps, parseSetWeight } from './index.ts';
import {
  canonicalizeWeightForReps,
  isConfirmedPerformedSet,
  type SessionSetPerformanceStatus,
} from '../session-recorder/set-semantics.ts';

export type WeightUnit = 'kg' | 'lb';
export type ExternalLoadMode = 'added' | 'assistance' | 'unquantified_assistance';
export type ResistanceBasis = 'entered_load' | 'total_resistance';
export type OneRepConvention = 'exact_inverse' | 'capacity';

export const KG_PER_LB = 0.45359237;

export type LoadContext = {
  bodyweightCoefficient: number;
  bodyWeightKg?: number | null;
  loadInputMode: string;
};

export type EffectiveLoadInput = LoadContext & {
  weightValue: string | null | undefined;
  /** Absent unit is the existing kg-only schema, never a guessed import unit. */
  weightUnit?: string | null;
  /** Null/absent legacy mode is unresolved when the coefficient is positive. */
  externalLoadMode?: string | null;
};

export type MissingLoadReason =
  | 'body_weight_missing'
  | 'legacy_interpretation'
  | 'unquantified_assistance';
export type InvalidLoadReason =
  | 'amount_invalid'
  | 'unit_invalid'
  | 'coefficient_invalid'
  | 'load_input_mode_invalid'
  | 'external_load_mode_invalid'
  | 'assistance_requires_bodyweight'
  | 'body_weight_invalid'
  | 'negative_resistance'
  | 'numeric_overflow';

export type UnavailableLoad =
  | { status: 'missing'; reason: MissingLoadReason }
  | { status: 'invalid'; reason: InvalidLoadReason };

export type KnownLoad = {
  status: 'known';
  resistanceBasis: ResistanceBasis;
  enteredWeightKg: number;
  /** Signed, in total external-load space. B is never scaled by this factor. */
  totalExternalAdjustmentKg: number;
  bodyContributionKg: number;
  resistanceKg: number;
  muscleResistancePerSideKg: number;
};

export type EffectiveLoad = KnownLoad | UnavailableLoad;

const invalid = (reason: InvalidLoadReason): UnavailableLoad => ({ status: 'invalid', reason });
const missing = (reason: MissingLoadReason): UnavailableLoad => ({ status: 'missing', reason });
const positiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const isWeightUnit = (value: unknown): value is WeightUnit => value === 'kg' || value === 'lb';

/** No formatting/rounding: callers retain their original raw amount and unit. */
export const weightToKg = (weight: number, unit: WeightUnit): number | null => {
  if (!Number.isFinite(weight) || weight < 0 || !isWeightUnit(unit)) return null;
  const kg = weight * (unit === 'lb' ? KG_PER_LB : 1);
  return Number.isFinite(kg) ? kg : null;
};

const validateContext = (context: LoadContext): UnavailableLoad | null => {
  const c = context.bodyweightCoefficient;
  if (!Number.isFinite(c) || c < 0 || c > 1) return invalid('coefficient_invalid');
  if (context.loadInputMode !== 'total_load' && context.loadInputMode !== 'per_side_load') {
    return invalid('load_input_mode_invalid');
  }
  return null;
};

/**
 * Resolves one raw load. Callers determine performed/planned eligibility before
 * aggregating. Conventional per-side exercise metrics retain entered-load
 * semantics; bodyweight metrics always use total resistance.
 */
export const resolveEffectiveLoad = (input: EffectiveLoadInput): EffectiveLoad => {
  const contextError = validateContext(input);
  if (contextError) return contextError;
  const unit = input.weightUnit === undefined ? 'kg' : input.weightUnit;
  if (!isWeightUnit(unit)) return invalid('unit_invalid');
  const amount = parseSetWeight(input.weightValue);
  if (amount === null) return invalid('amount_invalid');
  const enteredWeightKg = weightToKg(amount, unit);
  if (enteredWeightKg === null) return invalid('numeric_overflow');
  const c = input.bodyweightCoefficient;
  const mode = input.externalLoadMode ?? (c === 0 ? 'added' : null);
  if (mode === null) return missing('legacy_interpretation');
  if (mode === 'unquantified_assistance') return missing('unquantified_assistance');
  if (mode !== 'added' && mode !== 'assistance') return invalid('external_load_mode_invalid');
  if (mode === 'assistance' && c === 0) return invalid('assistance_requires_bodyweight');
  if (c > 0 && input.bodyWeightKg == null) return missing('body_weight_missing');
  if (c > 0 && !positiveFinite(input.bodyWeightKg)) return invalid('body_weight_invalid');

  const externalFactor = input.loadInputMode === 'per_side_load' ? 2 : 1;
  const totalExternalAdjustmentKg = enteredWeightKg * externalFactor * (mode === 'assistance' ? -1 : 1);
  const bodyContributionKg = c === 0 ? 0 : c * (input.bodyWeightKg as number);
  const resistanceKg = c === 0 ? enteredWeightKg : bodyContributionKg + totalExternalAdjustmentKg;
  const muscleResistancePerSideKg = c > 0
    ? resistanceKg / 2
    : enteredWeightKg / (input.loadInputMode === 'total_load' ? 2 : 1);
  if (![totalExternalAdjustmentKg, bodyContributionKg, resistanceKg, muscleResistancePerSideKg].every(Number.isFinite)) {
    return invalid('numeric_overflow');
  }
  if (resistanceKg < 0) return invalid('negative_resistance');
  return {
    status: 'known',
    resistanceBasis: c === 0 ? 'entered_load' : 'total_resistance',
    enteredWeightKg,
    totalExternalAdjustmentKg,
    bodyContributionKg,
    resistanceKg,
    muscleResistancePerSideKg,
  };
};

export type EffectiveSetInput = EffectiveLoadInput & {
  repsValue: string | null | undefined;
  setType?: string | null;
  performanceStatus?: SessionSetPerformanceStatus;
};

type SetMetricValues = {
  volumeKgReps: number | null;
  estimatedOneRepMaxKg: number | null;
  relativeEstimatedOneRepMax: number | null;
};

export type EffectiveSetMetrics = SetMetricValues & (
  | { eligible: false; reps: null; load: null }
  | { eligible: true; reps: number; load: EffectiveLoad }
);

const unavailableMetrics: SetMetricValues = {
  volumeKgReps: null, estimatedOneRepMaxKg: null, relativeEstimatedOneRepMax: null,
};

/** Actual performed values only. Warm-ups count; RIR does not alter the math. */
export const calculateEffectiveSetMetrics = (input: EffectiveSetInput): EffectiveSetMetrics => {
  const weight = canonicalizeWeightForReps(input.weightValue ?? '', input.repsValue ?? '');
  const reps = parseSetReps(input.repsValue);
  if (reps === null || parseSetWeight(weight) === null || !isConfirmedPerformedSet({
    weight, reps: input.repsValue ?? '', performanceStatus: input.performanceStatus,
  })) {
    return { eligible: false, reps: null, load: null, ...unavailableMetrics };
  }
  const load = resolveEffectiveLoad({ ...input, weightValue: weight });
  if (load.status !== 'known') return { eligible: true, reps, load, ...unavailableMetrics };
  const volumeKgReps = load.resistanceKg * reps;
  const estimatedOneRepMaxKg = estimateOneRepMax(load.resistanceKg, reps);
  const relativeEstimatedOneRepMax = estimatedOneRepMaxKg !== null && positiveFinite(input.bodyWeightKg)
    ? estimatedOneRepMaxKg / input.bodyWeightKg
    : null;
  if (![volumeKgReps, estimatedOneRepMaxKg, relativeEstimatedOneRepMax].every(
    value => value === null || Number.isFinite(value)
  )) {
    return { eligible: true, reps, load: invalid('numeric_overflow'), ...unavailableMetrics };
  }
  return { eligible: true, reps, load, volumeKgReps, estimatedOneRepMaxKg, relativeEstimatedOneRepMax };
};

export type VolumeCoverage = {
  knownVolumeKgReps: number | null;
  totalVolumeKgReps: number | null;
  eligibleSetCount: number;
  knownSetCount: number;
  missingSetCount: number;
  invalidSetCount: number;
  complete: boolean;
  overflow: boolean;
};

/** A known subtotal is never labelled as a complete total when coverage is missing. */
export const summarizeEffectiveVolume = (sets: readonly EffectiveSetMetrics[]): VolumeCoverage => {
  let knownVolumeKgReps = 0;
  let eligibleSetCount = 0;
  let knownSetCount = 0;
  let missingSetCount = 0;
  let invalidSetCount = 0;
  let overflow = false;
  for (const set of sets) {
    if (!set.eligible) continue;
    eligibleSetCount++;
    if (set.load.status === 'missing') missingSetCount++;
    else if (set.load.status === 'invalid') invalidSetCount++;
    else if (set.volumeKgReps !== null) {
      knownSetCount++;
      const next = knownVolumeKgReps + set.volumeKgReps;
      if (Number.isFinite(next)) knownVolumeKgReps = next;
      else overflow = true;
    }
  }
  const complete = missingSetCount === 0 && invalidSetCount === 0 && !overflow;
  return {
    knownVolumeKgReps: overflow ? null : knownVolumeKgReps,
    totalVolumeKgReps: complete ? knownVolumeKgReps : null,
    eligibleSetCount, knownSetCount, missingSetCount, invalidSetCount, complete, overflow,
  };
};

/** B is deliberately not an eligibility dependency for the unweighted reps board. */
export const isBodyweightRepsEligible = (input: EffectiveSetInput, compatibleMovement: boolean): boolean => {
  if (!compatibleMovement || validateContext(input) || input.bodyweightCoefficient <= 0) return false;
  // Explicit assistance is never an unassisted performance, even at zero.
  if (input.externalLoadMode !== 'added') return false;
  if (!isWeightUnit(input.weightUnit === undefined ? 'kg' : input.weightUnit)) return false;
  const weight = canonicalizeWeightForReps(input.weightValue ?? '', input.repsValue ?? '');
  return parseSetWeight(weight) === 0 && parseSetReps(input.repsValue) !== null &&
    isConfirmedPerformedSet({ weight, reps: input.repsValue ?? '', performanceStatus: input.performanceStatus });
};

/** Exact algebraic inverse of the existing Wathan estimate, including at 1 rep. */
export const resistanceAtReps = (estimatedOneRepMaxKg: number, targetReps: number): number | null => {
  if (!positiveFinite(estimatedOneRepMaxKg) || !Number.isInteger(targetReps) || targetReps <= 0) return null;
  const resistance = estimatedOneRepMaxKg * ((48.8 + 53.8 * Math.exp(-0.075 * targetReps)) / 100);
  return Number.isFinite(resistance) && resistance > 0 ? resistance : null;
};

export type ExternalLoadProjection = UnavailableLoad | {
  status: 'known';
  oneRepConvention: OneRepConvention;
  targetReps: number;
  targetBodyWeightKg: number | null;
  predictedResistanceKg: number;
  totalExternalAdjustmentKg: number;
  externalLoadMode: 'added' | 'assistance';
  enteredAmount: number;
  weightUnit: WeightUnit;
};

/**
 * Projection uses an explicitly supplied target B. It never updates the source
 * score. The capacity convention uses M itself at one rep; exact_inverse is
 * available to callers needing an algebraic round-trip at that boundary.
 */
export const estimateExternalLoad = (input: LoadContext & {
  estimatedOneRepMaxKg: number;
  targetReps: number;
  weightUnit: WeightUnit;
  oneRepConvention: OneRepConvention;
}): ExternalLoadProjection => {
  const contextError = validateContext(input);
  if (contextError) return contextError;
  if (!isWeightUnit(input.weightUnit)) return invalid('unit_invalid');
  if (input.oneRepConvention !== 'exact_inverse' && input.oneRepConvention !== 'capacity') {
    return invalid('amount_invalid');
  }
  const inverse = resistanceAtReps(input.estimatedOneRepMaxKg, input.targetReps);
  if (inverse === null) return invalid('amount_invalid');
  const c = input.bodyweightCoefficient;
  if (c > 0 && input.bodyWeightKg == null) return missing('body_weight_missing');
  if (c > 0 && !positiveFinite(input.bodyWeightKg)) return invalid('body_weight_invalid');
  const predictedResistanceKg = input.targetReps === 1 && input.oneRepConvention === 'capacity'
    ? input.estimatedOneRepMaxKg : inverse;
  const externalFactor = input.loadInputMode === 'per_side_load' ? 2 : 1;
  // Conventional estimates are already in entered-load space.
  const rawExternalAdjustmentKg = c === 0
    ? predictedResistanceKg * externalFactor
    : predictedResistanceKg - c * (input.bodyWeightKg as number);
  // Forward/inverse floating-point cancellation must not turn a bodyweight-only
  // round-trip into microscopic assistance. This is machine-precision cleanup,
  // not display or plate rounding; meaningful positive/negative loads survive.
  const cancellationTolerance = 2 * Number.EPSILON * Math.max(predictedResistanceKg, c * (input.bodyWeightKg ?? 0));
  const totalExternalAdjustmentKg = c > 0 && Math.abs(rawExternalAdjustmentKg) <= cancellationTolerance
    ? 0 : rawExternalAdjustmentKg;
  const enteredAmount = Math.abs(totalExternalAdjustmentKg) / externalFactor /
    (input.weightUnit === 'lb' ? KG_PER_LB : 1);
  if (![totalExternalAdjustmentKg, enteredAmount].every(Number.isFinite)) return invalid('numeric_overflow');
  return {
    status: 'known', oneRepConvention: input.oneRepConvention, targetReps: input.targetReps,
    targetBodyWeightKg: c > 0 ? input.bodyWeightKg as number : null,
    predictedResistanceKg, totalExternalAdjustmentKg,
    externalLoadMode: totalExternalAdjustmentKg < 0 ? 'assistance' : 'added',
    enteredAmount, weightUnit: input.weightUnit,
  };
};
