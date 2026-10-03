// Pure prepare -> score adapter for the whole-exercise publisher. PostgreSQL
// owns the source token, revision and pin fingerprints; this is the only place
// the evaluator resolves target-specific load mathematics.
import { validateGroupExerciseRules, type GroupMetric, type GroupMetricValue } from './metric-contract.ts';
import { scoreGroupPerformance } from './performance-score.ts';
import { isWorkingSetType } from '../exercise-calculations/set-semantics.ts';
import type { GroupMetricRulesWire, GroupPerformanceSnapshotWire } from './metric-wire.ts';

/** Service-only graph row. Private reading fields are consumed here and never
 * copied into the public performance snapshot or persisted group payloads. */
export type GroupMetricSourceSet = Omit<GroupPerformanceSnapshotWire, 'reps'> & {
  member_user_id: string;
  body_weight_kg: number | null;
  body_weight_source: string | null;
  body_weight_measurement_id: string | null;
  body_weight_measured_at_ms: number | null;
  reps_value: string;
  /** The synced effort (`warm_up`, `rir_<n>` or null), as stored. */
  set_type: string | null;
  live: boolean;
  /** SQL-owned live membership, shared-session and current-link eligibility.
   * Unlinked sources remain in the graph for record/certification validation. */
  counting: boolean;
  set_created_at_ms: number;
  // A pin is computed from only the dependencies of its metric. Weight excludes
  // bodyweight context; 1RM includes it only when the group policy uses it.
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
  /** The app's working-set rule over the set's effort. A score that is not
   * working keeps its row (stored records are checked against it) but never
   * counts on a board, so it can never become a record. */
  working: boolean;
  performance: GroupPerformanceSnapshotWire;
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
    bodyweightCalculationsEnabled: wire.bodyweight_calculations_enabled,
    bodyweightContribution: wire.bodyweight_contribution, defaultMetric: wire.default_metric });
  if (!checked.ok || !Number.isSafeInteger(wire.rules_revision) || wire.rules_revision < 1 || !graph.source_token) {
    throw new Error('Invalid group evaluation rules snapshot');
  }
  const keys = new Set<string>();
  const scores: EvaluatedGroupMetricSet[] = [];
  for (const row of graph.sets) {
    if (typeof row.live !== 'boolean' || typeof row.counting !== 'boolean') {
      throw new Error('Missing group source eligibility');
    }
    if (row.set_type !== null && typeof row.set_type !== 'string') {
      throw new Error('Missing group source set type');
    }
    const key = JSON.stringify([row.member_user_id, row.set_id]);
    if (keys.has(key)) throw new Error('Duplicate group evaluation source set');
    keys.add(key);
    const snapshot = {
      bodyWeightKg: row.body_weight_kg,
      bodyWeightSource: row.body_weight_source === 'reading' ? 'reading' as const : null,
      bodyWeightMeasurementId: row.body_weight_measurement_id,
      bodyWeightMeasuredAt: row.body_weight_measured_at_ms === null ? null : new Date(row.body_weight_measured_at_ms),
    };
    const result = scoreGroupPerformance({ weightValue: row.weight_value,
      repsValue: row.reps_value,
      performanceStatus: row.performance_status, live: row.live,
      ...snapshot,
      source: { loadInputMode: row.source_load_input_mode } }, checked.value);
    for (const score of result.scores) {
      const fingerprint = row.fingerprints[score.metric];
      if (!fingerprint) throw new Error('Missing dependency fingerprint for an eligible group score');
      const performance: GroupPerformanceSnapshotWire = {
        session_id: row.session_id, session_exercise_id: row.session_exercise_id,
        exercise_definition_id: row.exercise_definition_id, set_id: row.set_id,
        weight_value: row.weight_value,
        reps_value: row.reps_value, reps: Number(row.reps_value), performance_status: row.performance_status,
        source_load_input_mode: row.source_load_input_mode,
        achieved_at_ms: row.achieved_at_ms,
        exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index,
      };
      scores.push({ ...score, member_user_id: row.member_user_id, set_id: row.set_id,
        session_id: row.session_id, session_exercise_id: row.session_exercise_id,
        exercise_definition_id: row.exercise_definition_id, achieved_at_ms: row.achieved_at_ms,
        exercise_order_index: row.exercise_order_index, set_order_index: row.set_order_index,
        set_created_at_ms: row.set_created_at_ms, fingerprint, counting: row.counting,
        working: isWorkingSetType(row.set_type), performance });
    }
  }
  return { group_id: graph.group_id, group_exercise_id: graph.group_exercise_id,
    rules_revision: wire.rules_revision, source_token: graph.source_token, scores };
}
