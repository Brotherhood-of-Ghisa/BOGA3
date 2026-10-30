// Pure competition scorer; protocol-4 publication calls it. This boundary
// receives no personal contribution or personal 1RM: every target supplies its
// own declared rules. Every numerator comes from the existing kernel, with the
// SAME dated B.
import { isValidSessionWeight, type ResolvedSessionWeight } from '../bodyweight/as-of.ts';
import { groupLoadContext } from '../exercise-calculations/analytics.ts';
import { calculateSetMetricCandidates } from '../exercise-calculations/load-metrics.ts';
import { checkGroupLinkCompatibility, type GroupLinkSource } from './link-compatibility.ts';
import { isCompetitionValue, isNormalizedCompetition, validateCompetitionRules,
  type CompetitionRules, type CompetitionValue } from './competition-contract.ts';

export type CompetitionPerformanceInput = ResolvedSessionWeight & {
  weightValue: string;
  repsValue: string;
  performanceStatus: string | null;
  live: boolean;
  source: GroupLinkSource;
};

/** Service aggregators must preserve non-finite candidates until they can
 * make the affected member/metric unavailable, rather than sum a partial total. */
export function projectCompetitionPerformance(performance: CompetitionPerformanceInput, rules: CompetitionRules):
  { values: CompetitionValue[]; kernelOverflow: boolean } {
  const absent = { values: [], kernelOverflow: false };
  if (!validateCompetitionRules(rules).ok) return absent;
  const compatibility = checkGroupLinkCompatibility(performance.source, rules);
  if (!performance.live || !compatibility.compatible || performance.performanceStatus !== null) return absent;
  const normalized = isNormalizedCompetition(rules);
  // Off/zero must not even read a private context, including malformed input.
  const bodyweight = normalized && isValidSessionWeight(performance) ? performance.bodyWeightKg : null;
  if (normalized && bodyweight === null) return absent;
  const metrics = calculateSetMetricCandidates({ ...groupLoadContext(normalized, {
    bodyweightContribution: rules.bodyweightContribution,
    loadInputMode: performance.source.loadInputMode as 'total_load' | 'per_side_load',
  }, bodyweight), weightValue: performance.weightValue, repsValue: performance.repsValue, performanceStatus: null });
  if (!metrics.eligible) return absent;
  if (metrics.load.status !== 'known') {
    return metrics.load.status === 'invalid' && metrics.load.reason === 'numeric_overflow'
      ? { values: [
        { metric: 'volume', value: Infinity, unit: normalized ? 'percent_bw_reps' : 'kg_reps' },
        { metric: 'e1rm', value: Infinity, unit: normalized ? 'percent_bw' : 'kg' },
      ], kernelOverflow: true } : absent;
  }
  const candidates: CompetitionValue[] = normalized ? [
    { metric: 'volume', value: (metrics.volumeKgReps ?? 0) / bodyweight! * 100, unit: 'percent_bw_reps' },
    { metric: 'e1rm', value: (metrics.estimatedTotalOneRepMaxKg ?? 0) / bodyweight! * 100, unit: 'percent_bw' },
  ] : [
    { metric: 'volume', value: metrics.volumeKgReps ?? 0, unit: 'kg_reps' },
    { metric: 'e1rm', value: (metrics.estimatedOneRepMaxKg ?? 0) * compatibility.enteredWeightFactor, unit: 'kg' },
  ];
  const kernelOverflow = [metrics.volumeKgReps, metrics.estimatedOneRepMaxKg, metrics.estimatedTotalOneRepMaxKg]
    .some(value => value !== null && !Number.isFinite(value));
  return { values: candidates, kernelOverflow };
}

/** Performed-set projections only; the publisher separately applies working/counting. */
export function scoreCompetitionPerformance(performance: CompetitionPerformanceInput, rules: CompetitionRules): CompetitionValue[] {
  const projection = projectCompetitionPerformance(performance, rules);
  return projection.kernelOverflow ? [] : projection.values.filter(value => isCompetitionValue(value, isNormalizedCompetition(rules)));
}
