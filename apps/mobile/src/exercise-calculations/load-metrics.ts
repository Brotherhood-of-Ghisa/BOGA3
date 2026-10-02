// Pure calculation boundary shared by mobile and Deno consumers. It knows
// nothing about persistence, UI labels, or data provenance.
import { estimateOneRepMax, parseSetReps, parseSetWeight } from './index.ts';
import {
  canonicalizeWeightForReps,
  isConfirmedPerformedSet,
  type SessionSetPerformanceStatus,
} from './set-semantics.ts';

export type CalculationPolicy = 'ordinary' | 'personal' | 'group';
export type LoadInputMode = 'total_load' | 'per_side_load';

export type LoadContext = {
  policy: CalculationPolicy;
  bodyweightContribution: number;
  bodyWeightKg?: number | null;
  loadInputMode: LoadInputMode;
};

export type SetMetricInput = LoadContext & {
  weightValue: string | null | undefined;
  repsValue: string | null | undefined;
  setType?: string | null;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type MissingLoadReason = 'body_weight_missing';
export type InvalidLoadReason =
  | 'weight_invalid'
  | 'policy_invalid'
  | 'contribution_invalid'
  | 'load_input_mode_invalid'
  | 'body_weight_invalid'
  | 'numeric_overflow';

export type UnavailableLoad =
  | { status: 'missing'; reason: MissingLoadReason }
  | { status: 'invalid'; reason: InvalidLoadReason };

export type CalculatedLoad = {
  status: 'known';
  enteredWeightKg: number;
  bodyweightPartKg: number;
  calculatedLoadKg: number;
  perSideCalculatedLoadKg: number;
};

export type LoadResult = CalculatedLoad | UnavailableLoad;

type SetMetricValues = {
  volumeKgReps: number | null;
  estimatedOneRepMaxKg: number | null;
  estimatedTotalOneRepMaxKg: number | null;
};

export type SetMetrics = SetMetricValues & (
  | { eligible: false; reps: null; load: null }
  | { eligible: true; reps: number; load: LoadResult }
);

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

const unavailableMetrics: SetMetricValues = {
  volumeKgReps: null,
  estimatedOneRepMaxKg: null,
  estimatedTotalOneRepMaxKg: null,
};

const invalid = (reason: InvalidLoadReason): UnavailableLoad => ({ status: 'invalid', reason });
const missing = (): UnavailableLoad => ({ status: 'missing', reason: 'body_weight_missing' });
const isLoadInputMode = (value: unknown): value is LoadInputMode =>
  value === 'total_load' || value === 'per_side_load';

const validateContext = (context: LoadContext): UnavailableLoad | null => {
  if (context.policy !== 'ordinary' && context.policy !== 'personal' && context.policy !== 'group') {
    return invalid('policy_invalid');
  }
  if (!isLoadInputMode(context.loadInputMode)) return invalid('load_input_mode_invalid');
  if (!Number.isFinite(context.bodyweightContribution) ||
      context.bodyweightContribution < 0 || context.bodyweightContribution > 1) {
    return invalid('contribution_invalid');
  }
  return null;
};

/**
 * Resolves the load used by Volume and 1RM. Ordinary policy ignores stored
 * contribution and body weight. Personal policy substitutes zero for a missing
 * reading. Group policy keeps a positive-contribution score unavailable until
 * a valid reading exists.
 */
export const resolveCalculatedLoad = (input: LoadContext & {
  weightValue: string | null | undefined;
}): LoadResult => {
  const contextError = validateContext(input);
  if (contextError) return contextError;

  const enteredWeightKg = parseSetWeight(input.weightValue);
  if (enteredWeightKg === null) return invalid('weight_invalid');

  const contribution = input.policy === 'ordinary' ? 0 : input.bodyweightContribution;
  if (contribution === 0) {
    return {
      status: 'known',
      enteredWeightKg,
      bodyweightPartKg: 0,
      calculatedLoadKg: enteredWeightKg,
      perSideCalculatedLoadKg: input.loadInputMode === 'total_load'
        ? enteredWeightKg / 2
        : enteredWeightKg,
    };
  }

  if (input.bodyWeightKg == null && input.policy === 'group') return missing();
  const bodyWeightKg = input.bodyWeightKg ?? 0;
  if (!Number.isFinite(bodyWeightKg) || bodyWeightKg < 0) return invalid('body_weight_invalid');

  const enteredWeightFactor = input.loadInputMode === 'per_side_load' ? 2 : 1;
  const bodyweightPartKg = contribution * bodyWeightKg;
  const calculatedLoadKg = bodyweightPartKg + enteredWeightFactor * enteredWeightKg;
  const perSideCalculatedLoadKg = calculatedLoadKg / 2;
  if (![bodyweightPartKg, calculatedLoadKg, perSideCalculatedLoadKg].every(Number.isFinite)) {
    return invalid('numeric_overflow');
  }
  return {
    status: 'known',
    enteredWeightKg,
    bodyweightPartKg,
    calculatedLoadKg,
    perSideCalculatedLoadKg,
  };
};

/** Actual performed values only. Warm-ups count; effort does not alter maths. */
export const calculateSetMetrics = (input: SetMetricInput): SetMetrics => {
  const weight = canonicalizeWeightForReps(input.weightValue ?? '', input.repsValue ?? '');
  const reps = parseSetReps(input.repsValue);
  if (reps === null || parseSetWeight(weight) === null || !isConfirmedPerformedSet({
    weight,
    reps: input.repsValue ?? '',
    performanceStatus: input.performanceStatus,
  })) {
    return { eligible: false, reps: null, load: null, ...unavailableMetrics };
  }

  const load = resolveCalculatedLoad({ ...input, weightValue: weight });
  if (load.status !== 'known') return { eligible: true, reps, load, ...unavailableMetrics };

  const volumeKgReps = load.calculatedLoadKg * reps;
  const estimatedTotalOneRepMaxKg = estimateOneRepMax(load.calculatedLoadKg, reps);
  const contribution = input.policy === 'ordinary' ? 0 : input.bodyweightContribution;
  const enteredWeightFactor = contribution > 0 && input.loadInputMode === 'per_side_load' ? 2 : 1;
  const estimatedOneRepMaxKg = estimatedTotalOneRepMaxKg === null ? null
    : (estimatedTotalOneRepMaxKg - load.bodyweightPartKg) / enteredWeightFactor;
  if (![volumeKgReps, estimatedOneRepMaxKg, estimatedTotalOneRepMaxKg].every(
    value => value === null || Number.isFinite(value)
  )) {
    return { eligible: true, reps, load: invalid('numeric_overflow'), ...unavailableMetrics };
  }
  return {
    eligible: true,
    reps,
    load,
    volumeKgReps,
    estimatedOneRepMaxKg,
    estimatedTotalOneRepMaxKg,
  };
};

export const summarizeVolume = (sets: readonly SetMetrics[]): VolumeCoverage => {
  let knownVolumeKgReps = 0;
  let eligibleSetCount = 0;
  let knownSetCount = 0;
  let missingSetCount = 0;
  let invalidSetCount = 0;
  let overflow = false;

  for (const set of sets) {
    if (!set.eligible) continue;
    eligibleSetCount += 1;
    if (set.load.status === 'missing') missingSetCount += 1;
    else if (set.load.status === 'invalid') invalidSetCount += 1;
    else if (set.volumeKgReps !== null) {
      knownSetCount += 1;
      const next = knownVolumeKgReps + set.volumeKgReps;
      if (Number.isFinite(next)) knownVolumeKgReps = next;
      else overflow = true;
    }
  }

  const complete = missingSetCount === 0 && invalidSetCount === 0 && !overflow;
  return {
    knownVolumeKgReps: overflow ? null : knownVolumeKgReps,
    totalVolumeKgReps: complete ? knownVolumeKgReps : null,
    eligibleSetCount,
    knownSetCount,
    missingSetCount,
    invalidSetCount,
    complete,
    overflow,
  };
};
