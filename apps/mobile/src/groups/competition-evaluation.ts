// Service-only adapter. SQL owns source/pin checks and atomic publication;
// public readers must construct allowlisted protocol-4 projections separately.
import { isWorkingSetType } from '../exercise-calculations/set-semantics.ts';
import { isNormalizedCompetition, validateCompetitionRules, type CompetitionMetric,
  type CompetitionValue } from './competition-contract.ts';
import { scoreCompetitionPerformance } from './competition-score.ts';
import type { CompetitionRulesWire } from './competition-wire.ts';
import { evaluateGroupMetricGraph, type EvaluatedGroupMetricSet, type GroupMetricEvaluationGraph,
  type GroupMetricSourceSet } from './metric-evaluation.ts';
import type { GroupPerformanceSnapshotWire } from './metric-wire.ts';

export type CompetitionSourceSet = Omit<GroupMetricSourceSet, 'fingerprints'> & {
  fingerprints: Partial<Record<CompetitionMetric, string>>;
};
export type CompetitionEvaluationGraph = Omit<GroupMetricEvaluationGraph, 'rules' | 'sets'> & {
  contract_version: 4;
  rules: CompetitionRulesWire;
  sets: CompetitionSourceSet[];
};
export type EvaluatedCompetitionSet = Omit<EvaluatedGroupMetricSet, 'metric' | 'value' | 'unit'> & CompetitionValue;
export type CompetitionEvaluation = {
  contract_version: 4;
  group_id: string;
  group_exercise_id: string;
  rules_revision: number;
  source_token: string;
  scores: EvaluatedCompetitionSet[];
};

function privateContext(row: CompetitionSourceSet, normalized: boolean) {
  if (!normalized) return { bodyWeightKg: null, bodyWeightSource: null,
    bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null };
  return { bodyWeightKg: row.body_weight_kg,
    bodyWeightSource: row.body_weight_source === 'reading' ? 'reading' as const : null,
    bodyWeightMeasurementId: row.body_weight_measurement_id,
    bodyWeightMeasuredAt: row.body_weight_measured_at_ms === null ? null : new Date(row.body_weight_measured_at_ms) };
}

function performanceSnapshot(row: CompetitionSourceSet): GroupPerformanceSnapshotWire {
  return { session_id: row.session_id, session_exercise_id: row.session_exercise_id,
    exercise_definition_id: row.exercise_definition_id, set_id: row.set_id,
    weight_value: row.weight_value, reps_value: row.reps_value, reps: Number(row.reps_value),
    performance_status: row.performance_status, source_load_input_mode: row.source_load_input_mode,
    achieved_at_ms: row.achieved_at_ms, exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index };
}

export function evaluateCompetitionGraph(graph: CompetitionEvaluationGraph): CompetitionEvaluation {
  const wire = graph.rules;
  const checked = validateCompetitionRules({ name: graph.name, loadInputMode: wire.load_input_mode,
    bodyweightCalculationsEnabled: wire.bodyweight_calculations_enabled,
    bodyweightContribution: wire.bodyweight_contribution, defaultMetric: wire.default_metric });
  if (graph.contract_version !== 4 || !checked.ok || !Number.isSafeInteger(wire.rules_revision) ||
    wire.rules_revision < 1 || !graph.source_token) throw new Error('Invalid competition evaluation rules snapshot');
  const keys = new Set<string>();
  const scores: EvaluatedCompetitionSet[] = [];
  for (const row of graph.sets) {
    if (typeof row.live !== 'boolean' || typeof row.counting !== 'boolean') throw new Error('Missing competition source eligibility');
    if (row.set_type !== null && typeof row.set_type !== 'string') throw new Error('Missing competition source set type');
    const key = JSON.stringify([row.member_user_id, row.set_id]);
    if (keys.has(key)) throw new Error('Duplicate competition evaluation source set');
    keys.add(key);
    const values = scoreCompetitionPerformance({ weightValue: row.weight_value, repsValue: row.reps_value,
      performanceStatus: row.performance_status, live: row.live, source: { loadInputMode: row.source_load_input_mode },
      ...privateContext(row, isNormalizedCompetition(checked.value)) }, checked.value);
    for (const value of values) {
      const fingerprint = row.fingerprints[value.metric];
      if (!fingerprint) throw new Error('Missing dependency fingerprint for an eligible competition score');
      scores.push({ ...value, member_user_id: row.member_user_id, set_id: row.set_id,
        session_id: row.session_id, session_exercise_id: row.session_exercise_id,
        exercise_definition_id: row.exercise_definition_id, achieved_at_ms: row.achieved_at_ms,
        exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index,
        set_created_at_ms: row.set_created_at_ms, fingerprint, counting: row.counting,
        working: isWorkingSetType(row.set_type), performance: performanceSnapshot(row) });
    }
  }
  return { contract_version: 4, group_id: graph.group_id, group_exercise_id: graph.group_exercise_id,
    rules_revision: wire.rules_revision, source_token: graph.source_token, scores };
}

/** Pending installations continue to evaluate their existing protocol-3 graph. */
export function evaluateGroupComparisonGraph(graph: GroupMetricEvaluationGraph | CompetitionEvaluationGraph) {
  if (!('contract_version' in graph)) return evaluateGroupMetricGraph(graph);
  if (graph.contract_version !== 4) throw new Error('Unsupported competition evaluation contract');
  return evaluateCompetitionGraph(graph);
}
