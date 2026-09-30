// Shared target-specific group scoring. This boundary receives no personal
// contribution or personal 1RM: every target supplies its own declared rules.
import { isValidSessionWeight, type ResolvedSessionWeight } from '../bodyweight/as-of.ts';
import { groupLoadContext } from '../exercise-calculations/analytics.ts';
import { parseSetWeight } from '../exercise-calculations/index.ts';
import { calculateSetMetrics, type SetMetricInput } from '../exercise-calculations/load-metrics.ts';
import { canonicalizeWeightForReps } from '../session-recorder/set-semantics.ts';
import { checkGroupLinkCompatibility, type GroupExerciseRules, type GroupLinkSource, type GroupMetricValue } from './metric-contract.ts';

export type GroupPerformanceInput = ResolvedSessionWeight & {
  weightValue: string;
  repsValue: string;
  performanceStatus: string | null;
  live: boolean;
  source: GroupLinkSource;
};
export type GroupPerformanceScore = {
  /** Raw finite scores; persistence applies the declared six-decimal rank precision. */
  scores: GroupMetricValue[];
};
const empty = (): GroupPerformanceScore => ({ scores: [] });

export function scoreGroupPerformance(performance: GroupPerformanceInput, rules: GroupExerciseRules): GroupPerformanceScore {
  const compatibility = checkGroupLinkCompatibility(performance.source, rules);
  if (!performance.live || !compatibility.compatible || performance.performanceStatus !== null) return empty();
  const bodyweight = isValidSessionWeight(performance) ? performance.bodyWeightKg : null;
  const input: SetMetricInput = {
    ...groupLoadContext(rules.bodyweightCalculationsEnabled, {
      bodyweightContribution: rules.bodyweightContribution,
      loadInputMode: performance.source.loadInputMode as 'total_load' | 'per_side_load',
    }, bodyweight),
    weightValue: performance.weightValue,
    repsValue: performance.repsValue,
    performanceStatus: null,
  };
  const metrics = calculateSetMetrics(input);
  const result = empty();
  if (!metrics.eligible) return result;
  const weight = parseSetWeight(canonicalizeWeightForReps(performance.weightValue, performance.repsValue));
  if (weight !== null && weight > 0) result.scores.push({ metric: 'weight', value: weight, unit: 'kg' });
  if (metrics.load.status !== 'known') return result;
  const rm = metrics.estimatedOneRepMaxKg === null
    ? null
    : metrics.estimatedOneRepMaxKg * compatibility.enteredWeightFactor;
  // Weight stays raw. The same 1RM slot uses the group's current calculation
  // policy, so enabling a contribution changes the math without changing UI.
  if (rm !== null && Number.isFinite(rm) && rm > 0) result.scores.push({ metric: 'e1rm', value: rm, unit: 'kg' });
  return result;
}
