// Pure future competition scorer; protocol-3 publication does not call it.
// Every numerator comes from the existing kernel, with the SAME dated B.
import { isValidSessionWeight } from '../bodyweight/as-of.ts';
import { groupLoadContext } from '../exercise-calculations/analytics.ts';
import { calculateSetMetrics } from '../exercise-calculations/load-metrics.ts';
import { checkGroupLinkCompatibility } from './metric-contract.ts';
import type { GroupPerformanceInput } from './performance-score.ts';
import { isCompetitionValue, isNormalizedCompetition, validateCompetitionRules,
  type CompetitionRules, type CompetitionValue } from './competition-contract.ts';

/** Performed-set projections only; the publisher separately applies working/counting. */
export function scoreCompetitionPerformance(performance: GroupPerformanceInput, rules: CompetitionRules): CompetitionValue[] {
  if (!validateCompetitionRules(rules).ok) return [];
  const compatibility = checkGroupLinkCompatibility(performance.source, rules);
  if (!performance.live || !compatibility.compatible || performance.performanceStatus !== null) return [];
  const normalized = isNormalizedCompetition(rules);
  // Off/zero must not even read a private context, including malformed input.
  const bodyweight = normalized && isValidSessionWeight(performance) ? performance.bodyWeightKg : null;
  if (normalized && bodyweight === null) return [];
  const metrics = calculateSetMetrics({ ...groupLoadContext(normalized, {
    bodyweightContribution: rules.bodyweightContribution,
    loadInputMode: performance.source.loadInputMode as 'total_load' | 'per_side_load',
  }, bodyweight), weightValue: performance.weightValue, repsValue: performance.repsValue, performanceStatus: null });
  if (!metrics.eligible || metrics.load.status !== 'known') return [];
  const candidates: CompetitionValue[] = normalized ? [
    { metric: 'volume', value: (metrics.volumeKgReps ?? 0) / bodyweight! * 100, unit: 'percent_bw_reps' },
    { metric: 'e1rm', value: (metrics.estimatedTotalOneRepMaxKg ?? 0) / bodyweight! * 100, unit: 'percent_bw' },
  ] : [
    { metric: 'volume', value: (metrics.volumeKgReps ?? 0) * compatibility.enteredWeightFactor, unit: 'kg_reps' },
    { metric: 'e1rm', value: (metrics.estimatedOneRepMaxKg ?? 0) * compatibility.enteredWeightFactor, unit: 'kg' },
  ];
  return candidates.filter(value => isCompetitionValue(value, normalized));
}
