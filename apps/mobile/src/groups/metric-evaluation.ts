// Pure prepare -> score adapter for the whole-exercise publisher. PostgreSQL
// owns the source token, revision and pin fingerprints; this is the only place
// the evaluator resolves target-specific load mathematics.
import { validateGroupExerciseRules, type GroupMetric, type GroupMetricValue } from './metric-contract.ts';
import { scoreGroupPerformance } from './performance-score.ts';
import { isValidSessionWeight } from '../bodyweight/snapshot.ts';
import type { GroupMetricRulesWire, GroupPerformanceSnapshotWire } from './metric-wire.ts';

export type GroupMetricSourceSet = Omit<GroupPerformanceSnapshotWire, 'reps' | 'body_weight_status' | 'body_weight_source'> & {
  member_user_id: string;
  /** Raw service-only graph input. Validation happens before a public payload. */
  body_weight_source: string | null;
  reps_value: string;
  live: boolean;
  /** SQL-owned live membership, shared-session and current-link eligibility.
   * Unlinked sources remain in the graph for record/certification validation. */
  counting: boolean;
  set_created_at_ms: number;
  // A pin is computed from only the dependencies of its metric. In particular,
  // reps excludes B/provenance, while bodyweight strength includes them.
  fingerprints: Partial<Record<GroupMetric, string>>;
};
export type GroupMetricEvaluationGraph = {
  group_id: string;
  group_exercise_id: string;
  name: string;
  rules: GroupMetricRulesWire;
  source_token: string;
  sets: GroupMetricSourceSet[];
};
export type EvaluatedGroupMetricSet = GroupMetricValue & {
  member_user_id: string;
  set_id: string;
  session_id: string;
  session_exercise_id: string;
  exercise_definition_id: string;
  achieved_at_ms: number;
  exercise_order_index: number;
  set_order_index: number;
  set_created_at_ms: number;
  fingerprint: string;
  counting: boolean;
  performance: GroupPerformanceSnapshotWire;
  effective_resistance_kg: number | null;
  external_adjustment_kg: number | null;
  added_percent_bodyweight: number | null;
};
export type GroupMetricEvaluation = {
  group_id: string;
  group_exercise_id: string;
  rules_revision: number;
  source_token: string;
  scores: EvaluatedGroupMetricSet[];
};

export function evaluateGroupMetricGraph(graph: GroupMetricEvaluationGraph): GroupMetricEvaluation {
  const wire = graph.rules;
  const checked = validateGroupExerciseRules({ name: graph.name, loadInputMode: wire.load_input_mode,
    bodyweightCoefficient: wire.bodyweight_coefficient, movementStandard: wire.movement_standard,
    loadingMethod: wire.loading_method, defaultMetric: wire.default_metric });
  if (!checked.ok || !Number.isSafeInteger(wire.rules_revision) || wire.rules_revision < 1 || !graph.source_token) {
    throw new Error('Invalid group evaluation rules snapshot');
  }
  const keys = new Set<string>();
  const scores: EvaluatedGroupMetricSet[] = [];
  for (const row of graph.sets) {
    if (typeof row.live !== 'boolean' || typeof row.counting !== 'boolean') {
      throw new Error('Missing group source eligibility');
    }
    const key = JSON.stringify([row.member_user_id, row.set_id]);
    if (keys.has(key)) throw new Error('Duplicate group evaluation source set');
    keys.add(key);
    const snapshot = {
      bodyWeightKg: row.body_weight_kg, bodyWeightSource: row.body_weight_source,
      bodyWeightMeasurementId: row.body_weight_measurement_id,
      bodyWeightMeasuredAt: row.body_weight_measured_at_ms === null ? null : new Date(row.body_weight_measured_at_ms),
    };
    const validBodyWeight = isValidSessionWeight(snapshot);
    const bodyWeightStatus = validBodyWeight ? 'known' : Object.values(snapshot).every(value => value === null) ? 'missing' : 'invalid';
    const result = scoreGroupPerformance({ weightValue: row.weight_value, weightUnit: row.weight_unit,
      repsValue: row.reps_value, externalLoadMode: row.external_load_mode,
      performanceStatus: row.performance_status, live: row.live,
      ...snapshot,
      source: { loadInputMode: row.source_load_input_mode, movementStandard: row.movement_standard,
        loadingMethod: row.loading_method } }, checked.value);
    for (const score of result.scores) {
      const fingerprint = row.fingerprints[score.metric];
      if (!fingerprint) throw new Error('Missing dependency fingerprint for an eligible group score');
      const performance: GroupPerformanceSnapshotWire = {
        session_id: row.session_id, session_exercise_id: row.session_exercise_id,
        exercise_definition_id: row.exercise_definition_id, set_id: row.set_id,
        weight_value: row.weight_value, weight_unit: row.weight_unit, external_load_mode: row.external_load_mode,
        reps_value: row.reps_value, reps: Number(row.reps_value), performance_status: row.performance_status,
        source_load_input_mode: row.source_load_input_mode, movement_standard: row.movement_standard,
        loading_method: row.loading_method, body_weight_status: bodyWeightStatus,
        body_weight_kg: validBodyWeight ? row.body_weight_kg : null,
        body_weight_source: validBodyWeight ? row.body_weight_source as GroupPerformanceSnapshotWire['body_weight_source'] : null,
        body_weight_measurement_id: validBodyWeight ? row.body_weight_measurement_id : null,
        body_weight_measured_at_ms: validBodyWeight ? row.body_weight_measured_at_ms : null, achieved_at_ms: row.achieved_at_ms,
        exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index,
      };
      scores.push({ ...score, member_user_id: row.member_user_id, set_id: row.set_id,
        session_id: row.session_id, session_exercise_id: row.session_exercise_id,
        exercise_definition_id: row.exercise_definition_id, achieved_at_ms: row.achieved_at_ms,
        exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index,
        set_created_at_ms: row.set_created_at_ms, fingerprint, counting: row.counting, performance,
        effective_resistance_kg: result.effectiveResistanceKg,
        external_adjustment_kg: result.externalAdjustmentKg,
        added_percent_bodyweight: result.addedPercentBodyweight });
    }
  }
  return { group_id: graph.group_id, group_exercise_id: graph.group_exercise_id,
    rules_revision: wire.rules_revision, source_token: graph.source_token, scores };
}
