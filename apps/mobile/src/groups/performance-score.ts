// Shared target-specific group scoring. This boundary receives no personal
// coefficient or personal 1RM: every target supplies its own declared rules.
import { isValidSessionWeight, type SessionWeightSnapshot } from '../bodyweight/snapshot.ts';
import { calculateEffectiveSetMetrics, isBodyweightRepsEligible, type EffectiveSetInput } from '../exercise-calculations/effective-load.ts';
import { checkGroupLinkCompatibility, type GroupExerciseRules, type GroupLinkSource, type GroupMetricValue } from './metric-contract.ts';

export type GroupPerformanceInput = SessionWeightSnapshot & {
  weightValue: string;
  repsValue: string;
  weightUnit: string;
  externalLoadMode: string | null;
  performanceStatus: string | null;
  live: boolean;
  source: GroupLinkSource;
};
export type GroupPerformanceScore = {
  /** Raw finite scores; persistence applies the declared six-decimal rank precision. */
  scores: GroupMetricValue[];
  effectiveResistanceKg: number | null;
  externalAdjustmentKg: number | null;
  addedPercentBodyweight: number | null;
};
const empty = (): GroupPerformanceScore => ({ scores: [], effectiveResistanceKg: null,
  externalAdjustmentKg: null, addedPercentBodyweight: null });

export function scoreGroupPerformance(performance: GroupPerformanceInput, rules: GroupExerciseRules): GroupPerformanceScore {
  const compatibility = checkGroupLinkCompatibility(performance.source, rules);
  if (!performance.live || !compatibility.compatible || performance.performanceStatus !== null) return empty();
  const bodyweight = isValidSessionWeight(performance) ? performance.bodyWeightKg : null;
  const input: EffectiveSetInput = {
    ...performance,
    bodyWeightKg: bodyweight,
    performanceStatus: null,
    bodyweightCoefficient: rules.bodyweightCoefficient,
    // The raw amount was entered in the personal exercise's distribution.
    // A group's display convention cannot double or halve its body contribution.
    loadInputMode: performance.source.loadInputMode,
  };
  const metrics = calculateEffectiveSetMetrics(input);
  const result = empty();
  if (!metrics.eligible) return result;
  if (rules.bodyweightCoefficient > 0 && isBodyweightRepsEligible(input, true)) {
    result.scores.push({ metric: 'bodyweight_reps', value: metrics.reps, unit: 'reps' });
  }
  if (metrics.load.status !== 'known') return result;
  result.effectiveResistanceKg = metrics.load.resistanceKg;
  result.externalAdjustmentKg = metrics.load.totalExternalAdjustmentKg;
  if (rules.bodyweightCoefficient > 0 && performance.externalLoadMode === 'added' && bodyweight !== null && Number.isFinite(bodyweight) && bodyweight > 0) {
    const percent = metrics.load.totalExternalAdjustmentKg / bodyweight * 100;
    result.addedPercentBodyweight = Number.isFinite(percent) ? percent : null;
  }
  if (rules.bodyweightCoefficient > 0) {
    if (metrics.estimatedOneRepMaxKg !== null) result.scores.push({ metric: 'absolute_strength', value: metrics.estimatedOneRepMaxKg, unit: 'kg' });
    if (metrics.relativeEstimatedOneRepMax !== null) result.scores.push({ metric: 'relative_strength', value: metrics.relativeEstimatedOneRepMax, unit: 'x_bw' });
  } else {
    const weight = metrics.load.enteredWeightKg * compatibility.externalLoadFactor;
    const rm = metrics.estimatedOneRepMaxKg === null ? null : metrics.estimatedOneRepMaxKg * compatibility.externalLoadFactor;
    // Conventional comparisons preserve the group's declared entered-load
    // convention, while raw source distribution remains in the performance.
    result.effectiveResistanceKg = Number.isFinite(weight) ? weight : null;
    if (Number.isFinite(weight) && weight > 0) result.scores.push({ metric: 'weight', value: weight, unit: 'kg' });
    if (rm !== null && Number.isFinite(rm) && rm > 0) result.scores.push({ metric: 'e1rm', value: rm, unit: 'kg' });
  }
  return result;
}
