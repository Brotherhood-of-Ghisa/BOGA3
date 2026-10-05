// Versioned kg-only metric boundary: comparison rules and the performed-set
// snapshot. Calculation dependencies remain private to the evaluator.
import type { LoadInputMode } from '../exercise-core/index.ts';
import type { GroupMetric } from './metric-contract.ts';

export type GroupMetricRulesWire = {
  bodyweight_calculations_enabled: boolean;
  bodyweight_contribution: number;
  load_input_mode: LoadInputMode;
  default_metric: GroupMetric;
  rules_revision: number;
};
export type GroupMetricExerciseWire = GroupMetricRulesWire & {
  legacy: boolean;
  group_exercise_id: string;
  name: string;
  source_exercise_id: string | null;
  archived_at_ms: number | null;
  published_revision: number | null;
  rebuilding: boolean;
};

/** Only the performed set is exposed; private calculation context never is. */
export type GroupPerformanceSnapshotWire = {
  session_id: string;
  session_exercise_id: string;
  exercise_definition_id: string;
  set_id: string;
  weight_value: string;
  reps_value: string;
  reps: number;
  performance_status: string | null;
  source_load_input_mode: LoadInputMode;
  achieved_at_ms: number;
  exercise_order_index: number;
  set_order_index: number;
};
