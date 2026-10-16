import { estimateOneRepMax } from './index.ts';
import { getSessionSetRir, isEffortChoice } from './effort-policy.ts';
import { calculateSetMetrics, type LoadInputMode, type SetMetricInput } from './load-metrics.ts';
import { isWorkingSet } from './set-semantics.ts';

export type RmCurveExclusion = 'not_working' | 'missing_effort' | 'unknown_effort' | 'invalid_metrics' | 'equivalent_reps_overflow';
export type RmCurveValues = {
  reps: number; rir: number; equivalentReps: number; weightKg: number;
  loadKg: number; calculatedLoadKg: number; analyticalTotalRm: number; existingOneRepMax: number;
};

/** Chart-only projection; logged reps and the ordinary displayed 1RM stay intact. */
export function projectRmCurveSet(input: SetMetricInput): RmCurveValues | RmCurveExclusion {
  if (!isWorkingSet({ weight: input.weightValue ?? '', reps: input.repsValue ?? '',
    setType: input.setType, performanceStatus: input.performanceStatus }, input.effortPolicy)) return 'not_working';
  const rir = getSessionSetRir(input.setType);
  if (rir === null) return input.setType == null || isEffortChoice(input.setType) ? 'missing_effort' : 'unknown_effort';
  const metrics = calculateSetMetrics(input);
  if (!metrics.eligible || metrics.load.status !== 'known' || metrics.estimatedOneRepMaxKg === null) return 'invalid_metrics';
  const equivalentReps = metrics.reps + rir;
  if (!Number.isSafeInteger(equivalentReps)) return 'equivalent_reps_overflow';
  const analyticalTotalRm = estimateOneRepMax(metrics.load.calculatedLoadKg, equivalentReps);
  if (analyticalTotalRm === null || !Number.isFinite(analyticalTotalRm)) return 'invalid_metrics';
  const factor = input.loadInputMode === 'per_side_load' ? 2 : 1;
  return { reps: metrics.reps, rir, equivalentReps, weightKg: metrics.load.enteredWeightKg,
    calculatedLoadKg: metrics.load.calculatedLoadKg, loadKg: metrics.load.calculatedLoadKg / factor,
    analyticalTotalRm, existingOneRepMax: metrics.estimatedOneRepMaxKg };
}

/** Invert the adopted kernel, including its measured-single branch. */
export function predictRmCurveLoad(rm: number | null, reps: number, mode: LoadInputMode): number | null {
  if (rm === null || !Number.isFinite(rm) || rm <= 0 || !Number.isSafeInteger(reps) || reps < 1 ||
    (mode !== 'total_load' && mode !== 'per_side_load')) return null;
  const unitRm = estimateOneRepMax(1, reps);
  const prediction = unitRm === null ? NaN : rm / unitRm / (mode === 'per_side_load' ? 2 : 1);
  return Number.isFinite(prediction) && prediction > 0 ? prediction : null;
}

export function rmCurveResidual(point: RmCurveValues, rm: number | null, mode: LoadInputMode) {
  const predictedLoadKg = predictRmCurveLoad(rm, point.equivalentReps, mode);
  if (predictedLoadKg === null) return null;
  const signedKg = point.loadKg - predictedLoadKg;
  const percentage = 100 * (point.loadKg / predictedLoadKg - 1);
  return Number.isFinite(signedKg) ? { predictedLoadKg, signedKg,
    percentage: Number.isFinite(percentage) ? percentage : null } : null;
}

/** Integer knots only; bounded sampling also admits legacy very-high RIR. */
export function rmCurveKnots(rm: number | null, mode: LoadInputMode, maxReps: number) {
  if (!Number.isSafeInteger(maxReps) || maxReps < 1) return [];
  const upper = Math.max(20, maxReps);
  const reps = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
  for (let i = 1; i < 64; i++) reps.add(Math.min(upper, Math.round(20 * Math.exp(Math.log(upper / 20) * i / 64))));
  reps.add(upper);
  return [...reps].sort((a, b) => a - b).flatMap(reps => {
    const loadKg = predictRmCurveLoad(rm, reps, mode);
    return loadKg === null ? [] : [{ reps, loadKg }];
  });
}
